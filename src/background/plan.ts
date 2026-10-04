import { parseDash, type DashRep } from '../parsers/dash';
import { parseHls, type HlsMedia } from '../parsers/hls';
import { extOf, reachableFrom } from '../parsers/url';
import { RAW_THRESHOLD, type ErrorCode, type OutputFormat, type Plan, type TrackPlan, type VideoFormat } from '../shared/plan';
import type { Settings } from '../shared/settings';
import type { JobMode, MediaItem } from '../shared/types';

export class PlanError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

export interface PlanOptions {
  mode: JobMode;
  /** Container for a video; defaults to the user's preferred one. */
  format?: VideoFormat;
  variantId?: string;
  settings: Settings;
  fetchText: (url: string) => Promise<string>;
}

const audioOut = (s: Settings): OutputFormat => s.audioFormat;
const videoOut = (o: PlanOptions): OutputFormat => o.format ?? o.settings.videoFormat;

async function hlsTrack(url: string, fetchText: PlanOptions['fetchText']): Promise<{ track: TrackPlan; media: HlsMedia }> {
  const parsed = parseHls(await fetchText(url), url);
  if (parsed.type !== 'media') {
    // A master where we expected a media playlist: follow its best variant.
    const best = parsed.variants.filter((v) => reachableFrom(url, v.url)).sort((a, b) => b.bandwidth - a.bandwidth)[0];
    if (!best || parsed.encrypted) throw new PlanError(parsed.encrypted ? 'protected' : 'unknown');
    return hlsTrack(best.url, fetchText);
  }
  if (parsed.encrypted) throw new PlanError('protected');
  if (!parsed.endList) throw new PlanError('live');
  const track: TrackPlan = {
    segments: parsed.segments.map(({ url, range }) => (range ? { url, range } : { url })),
    container: parsed.map ? 'fmp4' : 'ts',
    ...(parsed.map ? { init: parsed.map } : {}),
  };
  return { track: checkReachable(url, track), media: parsed };
}

async function planHls(item: MediaItem, o: PlanOptions): Promise<Plan> {
  const variants = item.variants;
  const pick = (id?: string) => variants.find((v) => v.id === id) ?? variants[0];
  const common = { kind: 'stream' as const, pageUrl: item.pageUrl };

  if (o.mode === 'audio') {
    const variant = pick(o.variantId);
    const group = item.audioTracks.filter((a) => !variant?.audioGroup || a.groupId === variant.audioGroup);
    const audioTrack = group.find((a) => a.isDefault) ?? group[0];
    if (audioTrack) {
      const { track } = await hlsTrack(audioTrack.url, o.fetchText);
      return { ...common, audio: track, output: audioOut(o.settings), raw: false, audioOnly: true };
    }
    const lightest = [...variants].sort((a, b) => (a.bandwidth ?? 0) - (b.bandwidth ?? 0))[0];
    const { track } = await hlsTrack(lightest?.url ?? item.url, o.fetchText);
    return { ...common, video: track, output: audioOut(o.settings), raw: false, audioOnly: true };
  }

  const variant = pick(o.variantId);
  const { track: video, media } = await hlsTrack(variant?.url ?? item.url, o.fetchText);
  let audio: TrackPlan | undefined;
  if (variant?.audioGroup) {
    const group = item.audioTracks.filter((a) => a.groupId === variant.audioGroup && a.url);
    const choice = group.find((a) => a.isDefault) ?? group[0];
    if (choice) audio = (await hlsTrack(choice.url, o.fetchText)).track;
  }
  const duration = media.duration || item.duration || 0;
  const estimatedSize = variant?.bandwidth ? Math.round((variant.bandwidth * duration) / 8) : undefined;
  const raw = tooBig(estimatedSize, !!audio);
  return {
    ...common,
    video,
    ...(audio ? { audio } : {}),
    output: raw ? (video.container === 'ts' ? 'ts' : 'mp4') : videoOut(o),
    raw,
    audioOnly: false,
    ...(estimatedSize ? { estimatedSize } : {}),
  };
}

/**
 * ffmpeg.wasm works in memory: past ~1.5 GB a single track is concatenated as-is,
 * and two tracks that would need merging are refused (a lower quality fits).
 */
function tooBig(estimatedSize: number | undefined, twoTracks: boolean): boolean {
  if ((estimatedSize ?? 0) <= RAW_THRESHOLD) return false;
  if (twoTracks) throw new PlanError('too_large');
  return true;
}

/** Every URL a track will fetch must stay out of the local network if its playlist did. */
function checkReachable(source: string, track: TrackPlan): TrackPlan {
  const urls = [...(track.init ? [track.init.url] : []), ...track.segments.map((s) => s.url)];
  if (!urls.every((u) => reachableFrom(source, u))) throw new PlanError('unknown');
  return track;
}

function dashTrack(rep: DashRep, source: string): TrackPlan {
  return checkReachable(source, {
    segments: rep.segments,
    container: rep.mimeType.includes('webm') ? 'webm' : 'fmp4',
    ...(rep.init ? { init: rep.init } : {}),
    ...(rep.codecs ? { codecs: rep.codecs } : {}),
  });
}

async function planDash(item: MediaItem, o: PlanOptions): Promise<Plan> {
  const mpd = parseDash(await o.fetchText(item.url), item.url);
  if (mpd.protected) throw new PlanError('protected');
  if (mpd.dynamic) throw new PlanError('live');
  const byBw = (a: DashRep, b: DashRep) => b.bandwidth - a.bandwidth;
  const videoRep = mpd.video.find((r) => r.id === o.variantId) ?? [...mpd.video].sort(byBw)[0];
  const audioRep = [...mpd.audio].sort(byBw)[0];
  const common = { kind: 'stream' as const, pageUrl: item.pageUrl };

  if (o.mode === 'audio') {
    const src = audioRep ?? videoRep;
    if (!src) throw new PlanError('unknown');
    const t = dashTrack(src, item.url);
    return { ...common, ...(audioRep ? { audio: t } : { video: t }), output: audioOut(o.settings), raw: false, audioOnly: true };
  }
  if (!videoRep) throw new PlanError('unknown');
  const video = dashTrack(videoRep, item.url);
  const audio = audioRep ? dashTrack(audioRep, item.url) : undefined;
  const webm = video.container === 'webm' || audio?.container === 'webm';
  const estimatedSize = Math.round(((videoRep.bandwidth + (audioRep?.bandwidth ?? 0)) * mpd.duration) / 8) || undefined;
  const raw = tooBig(estimatedSize, !!audio);
  return {
    ...common,
    video,
    ...(audio ? { audio } : {}),
    output: raw && webm ? 'webm' : raw ? 'mp4' : videoOut(o),
    raw,
    audioOnly: false,
    ...(estimatedSize ? { estimatedSize } : {}),
  };
}

/** Turns a detected item + user choice into a concrete download plan. */
export async function buildPlan(item: MediaItem, o: PlanOptions): Promise<Plan> {
  if (item.protection !== 'none') throw new PlanError('protected');
  if (item.live) throw new PlanError('live');

  switch (item.kind) {
    case 'hls':
      return planHls(item, o);
    case 'dash':
      return planDash(item, o);
    case 'capture':
      return {
        kind: 'capture',
        output: o.mode === 'audio' ? audioOut(o.settings) : videoOut(o),
        raw: false,
        audioOnly: o.mode === 'audio',
        pageUrl: item.pageUrl,
      };
    case 'file': {
      const ext = extOf(item.url);
      return {
        kind: 'file',
        video: { segments: [{ url: item.url }], container: 'file' },
        output: o.mode === 'audio' ? audioOut(o.settings) : ((['mp4', 'webm', 'm4a', 'mp3'].includes(ext) ? ext : 'mp4') as OutputFormat),
        raw: false,
        audioOnly: o.mode === 'audio',
        ...(item.size ? { estimatedSize: item.size } : {}),
        pageUrl: item.pageUrl,
      };
    }
  }
}
