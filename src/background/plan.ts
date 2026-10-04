import { parseDash, type DashRep } from '../parsers/dash';
import { parseHls, type HlsMedia } from '../parsers/hls';
import { extOf, reachableFrom } from '../parsers/url';
import { isAudioFormat, sourceFormat } from '../shared/formats';
import { RAW_THRESHOLD, type ErrorCode, type OutputFormat, type Plan, type TrackPlan } from '../shared/plan';
import type { Settings } from '../shared/settings';
import { scaleBox, scaleSource } from '../shared/scale';
import type { JobMode, MediaItem, Variant } from '../shared/types';

export class PlanError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

export interface PlanOptions {
  mode: JobMode;
  /** Chosen output (video container or audio format); defaults to the user's settings. */
  format?: OutputFormat;
  variantId?: string;
  /** Make a smaller quality (e.g. 360 for 360p) by shrinking the picture. */
  scale?: number;
  settings: Settings;
  fetchText: (url: string) => Promise<string>;
}

const audioOut = (o: PlanOptions): OutputFormat => (isAudioFormat(o.format) ? o.format : o.settings.audioFormat);
const videoOut = (o: PlanOptions): OutputFormat => {
  const f = o.format && !isAudioFormat(o.format) ? o.format : o.settings.videoFormat;
  // Shrunk pictures are H.264, which WebM can't hold.
  return scaling(o) && f === 'webm' ? 'mp4' : f;
};

/** Shrinking: only for a video. */
const scaling = (o: PlanOptions) => (o.mode === 'video' && o.scale ? o.scale : undefined);

/** The quality to download: the one chosen, or the one to shrink from. */
function chosenVariant(variants: Variant[], o: PlanOptions): Variant | undefined {
  const lines = scaling(o);
  if (lines) return scaleSource(variants, lines);
  return variants.find((v) => v.id === o.variantId) ?? variants[0];
}

/** Plan fields for a shrunk picture; refused when the source is too big to work on in memory. */
function scaled(o: PlanOptions, source: Variant | undefined, estimatedSize: number | undefined): Pick<Plan, 'scale'> {
  const lines = scaling(o);
  if (!lines) return {};
  if ((estimatedSize ?? 0) > RAW_THRESHOLD) throw new PlanError('too_large');
  return { scale: scaleBox(lines, source) };
}

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
      return { ...common, audio: track, output: audioOut(o), raw: false, audioOnly: true };
    }
    const lightest = [...variants].sort((a, b) => (a.bandwidth ?? 0) - (b.bandwidth ?? 0))[0];
    const { track } = await hlsTrack(lightest?.url ?? item.url, o.fetchText);
    return { ...common, video: track, output: audioOut(o), raw: false, audioOnly: true };
  }

  const variant = chosenVariant(variants, o);
  const { track: video, media } = await hlsTrack(variant?.url ?? item.url, o.fetchText);
  let audio: TrackPlan | undefined;
  if (variant?.audioGroup) {
    const group = item.audioTracks.filter((a) => a.groupId === variant.audioGroup && a.url);
    const choice = group.find((a) => a.isDefault) ?? group[0];
    if (choice) audio = (await hlsTrack(choice.url, o.fetchText)).track;
  }
  const duration = media.duration || item.duration || 0;
  const estimatedSize = variant?.bandwidth ? Math.round((variant.bandwidth * duration) / 8) : undefined;
  const scale = scaled(o, variant, estimatedSize);
  const raw = tooBig(estimatedSize, !!audio);
  return {
    ...common,
    video,
    ...(audio ? { audio } : {}),
    ...scale,
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
  const pickedId = chosenVariant(item.variants, o)?.id ?? o.variantId;
  const videoRep = mpd.video.find((r) => r.id === pickedId) ?? [...mpd.video].sort(byBw)[0];
  const audioRep = [...mpd.audio].sort(byBw)[0];
  const common = { kind: 'stream' as const, pageUrl: item.pageUrl };

  if (o.mode === 'audio') {
    const src = audioRep ?? videoRep;
    if (!src) throw new PlanError('unknown');
    const t = dashTrack(src, item.url);
    return { ...common, ...(audioRep ? { audio: t } : { video: t }), output: audioOut(o), raw: false, audioOnly: true };
  }
  if (!videoRep) throw new PlanError('unknown');
  const video = dashTrack(videoRep, item.url);
  const audio = audioRep ? dashTrack(audioRep, item.url) : undefined;
  const webm = video.container === 'webm' || audio?.container === 'webm';
  const estimatedSize = Math.round(((videoRep.bandwidth + (audioRep?.bandwidth ?? 0)) * mpd.duration) / 8) || undefined;
  const scale = scaled(o, item.variants.find((v) => v.id === videoRep.id), estimatedSize);
  const raw = tooBig(estimatedSize, !!audio);
  return {
    ...common,
    video,
    ...(audio ? { audio } : {}),
    ...scale,
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
        output: o.mode === 'audio' ? audioOut(o) : videoOut(o),
        raw: false,
        audioOnly: o.mode === 'audio',
        pageUrl: item.pageUrl,
      };
    case 'file': {
      // A video offered in several qualities: each one is its own file.
      const variant = o.mode === 'audio' ? undefined : chosenVariant(item.variants, o);
      const url = variant?.url || item.url;
      const size = variant?.size ?? item.size;
      const src = sourceFormat(extOf(url), item.mime);
      const wanted = o.mode === 'audio' ? audioOut(o) : videoOut(o);
      const scale = scaled(o, variant, size);
      // Converting works in memory: past ~1.5 GB the file is saved as it is.
      const big = (size ?? 0) > RAW_THRESHOLD;
      // The sound of a huge video would mean loading all of it in memory first.
      if (big && o.mode === 'audio' && !item.audioOnly) throw new PlanError('too_large');
      const keep = !scale.scale && (wanted === src || big) && (o.mode === 'video' || !!item.audioOnly);
      return {
        kind: 'file',
        video: { segments: [{ url }], container: 'file' },
        output: keep ? (src ?? wanted) : wanted,
        raw: false,
        ...(keep ? { direct: true } : {}),
        ...scale,
        audioOnly: o.mode === 'audio',
        ...(size ? { estimatedSize: size } : {}),
        pageUrl: item.pageUrl,
      };
    }
  }
}
