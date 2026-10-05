import { parseDash, type DashRep } from '../parsers/dash';
import { parseHls, type HlsMedia } from '../parsers/hls';
import { extOf, reachableFrom } from '../parsers/url';
import { isAudioFormat, sourceFormat } from '../shared/formats';
import { RAW_THRESHOLD, type Clip, type ErrorCode, type OutputFormat, type Plan, type TrackPlan } from '../shared/plan';
import type { Settings } from '../shared/settings';
import { scaleBox, scaleSource } from '../shared/scale';
import type { JobMode, MediaItem, Variant } from '../shared/types';

/**
 * From this size a file saved as is is fetched by Grabby in several ranges at once (and can
 * be paused and resumed) instead of by the browser over a single connection.
 */
export const FAST_MIN = 8 * 2 ** 20;

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
  /** Keep only this part of the video. */
  clip?: Clip;
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
    segments: parsed.segments.map(({ url, range, duration }) => ({ url, ...(range ? { range } : {}), ...(duration > 0 ? { dur: duration } : {}) })),
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

/**
 * The segments of a track that cover [start, end], and where `start` falls in the first of
 * them. Without durations for every segment, the whole track is kept (cut after download).
 */
export function clipTrack(track: TrackPlan, clip: Clip): { track: TrackPlan; offset: number } {
  if (!track.segments.length || track.segments.some((s) => !s.dur)) return { track, offset: clip.start };
  let t = 0;
  let first = -1;
  let last = -1;
  let firstStart = 0;
  track.segments.forEach((s, i) => {
    const from = t;
    t += s.dur!;
    if (t > clip.start && from < clip.end) {
      if (first < 0) {
        first = i;
        firstStart = from;
      }
      last = i;
    }
  });
  if (first < 0) return { track, offset: clip.start };
  return { track: { ...track, segments: track.segments.slice(first, last + 1) }, offset: Math.max(0, clip.start - firstStart) };
}

/** A sensible part: within the video, at least a second long. */
export function validClip(clip: Clip | undefined, duration?: number): Clip | undefined {
  if (!clip || !Number.isFinite(clip.start) || !Number.isFinite(clip.end)) return undefined;
  const start = Math.max(0, clip.start);
  const end = duration ? Math.min(duration, clip.end) : clip.end;
  if (end - start < 1) return undefined;
  // The whole video: nothing to cut.
  if (duration && start < 0.5 && end > duration - 0.5) return undefined;
  return { start, end };
}

function applyClip(plan: Plan, clip: Clip, o: PlanOptions, duration?: number): Plan {
  const out: Plan = { ...plan, clip: { duration: clip.end - clip.start } };
  for (const key of ['video', 'audio'] as const) {
    const t = plan[key];
    if (!t) continue;
    const c = clipTrack(t, clip);
    out[key] = c.track;
    out.clip![key] = c.offset;
  }
  if (plan.estimatedSize && duration) out.estimatedSize = Math.round((plan.estimatedSize * (clip.end - clip.start)) / duration);
  // A part of a huge video can fit in memory: then it is assembled (and cut) normally.
  // Otherwise its segments are put end to end, cut to the nearest segment.
  if (plan.raw && (out.estimatedSize ?? Infinity) <= RAW_THRESHOLD) {
    out.raw = false;
    out.output = videoOut(o);
  }
  return out;
}

/** Turns a detected item + user choice into a concrete download plan. */
export async function buildPlan(item: MediaItem, o: PlanOptions): Promise<Plan> {
  if (item.protection !== 'none') throw new PlanError('protected');
  if (item.live) throw new PlanError('live');
  const clip = item.kind === 'capture' ? undefined : validClip(o.clip, item.duration);
  if (!clip) return planFor(item, o);
  // Cutting needs ffmpeg, which works in memory: a huge file can't be cut.
  if (item.kind === 'file' && (item.size ?? 0) > RAW_THRESHOLD) throw new PlanError('too_large');
  const plan = await planFor(item, o);
  if (plan.kind === 'file') {
    // Fetched whole by Grabby, then cut: never handed to the browser as it is.
    delete plan.direct;
    delete plan.fast;
    plan.raw = false;
  }
  return applyClip(plan, clip, o, item.duration);
}

async function planFor(item: MediaItem, o: PlanOptions): Promise<Plan> {
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
      const fast = keep && (size ?? 0) >= FAST_MIN;
      return {
        kind: 'file',
        video: { segments: [{ url }], container: 'file' },
        output: keep ? (src ?? wanted) : wanted,
        // Fast: the pieces are put end to end, no ffmpeg.
        raw: fast,
        ...(keep ? { direct: true } : {}),
        ...(fast ? { fast: true } : {}),
        ...scale,
        audioOnly: o.mode === 'audio',
        ...(size ? { estimatedSize: size } : {}),
        pageUrl: item.pageUrl,
      };
    }
  }
}
