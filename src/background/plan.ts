import { sheetLayout } from '../shared/sheet';
import { browserLanguage, browserWords, languageName, trackTitle } from '../shared/sublabels';
import { parseDash, type DashRep } from '../parsers/dash';
import { parseHls, type HlsMedia } from '../parsers/hls';
import { extOf, reachableFrom } from '../parsers/url';
import { hlsRendition } from '../shared/audio';
import { CHAPTER_FORMATS, isAudioFormat, isImageFormat, sourceFormat } from '../shared/formats';
import { RAW_THRESHOLD, subsIds, type Clip, type ErrorCode, type OutputFormat, type Plan, type PlanSubs, type SubsChoice, type TrackPlan } from '../shared/plan';
import { SUB_CODEC, type SubsClock } from '../shared/subtitles';
import type { Settings } from '../shared/settings';
import { scaleBox, scaleSource } from '../shared/scale';
import type { JobMode, MediaItem, Variant } from '../shared/types';
import { finishWords, type Finish } from '../shared/finish';

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
  /** Subtitles to save with the video. */
  subtitles?: SubsChoice;
  /** Sound tracks (ids from `audioChoices`): the first is the main one, the others are added. */
  audios?: string[];
  /** Leave the video's chapters out. */
  noChapters?: boolean;
  /** Several parts of the video, joined in one file. */
  parts?: Clip[];
  /** A still picture (JPEG): where in the video. */
  at?: number;
  /** A contact sheet (JPEG): a picture every so many seconds (0: chosen from its length). */
  sheet?: number;
  /** What is done to the file once it is made. */
  finish?: Finish;
  /** A live stream: recorded until stopped, at most this many minutes. */
  live?: number;
  settings: Settings;
  fetchText: (url: string) => Promise<string>;
}

const audioOut = (o: PlanOptions): OutputFormat => (isAudioFormat(o.format) ? o.format : o.settings.audioFormat);
const videoOut = (o: PlanOptions): OutputFormat => {
  const f = o.format && !isAudioFormat(o.format) && !isImageFormat(o.format) ? o.format : o.settings.videoFormat;
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

async function hlsTrack(url: string, fetchText: PlanOptions['fetchText'], live = false): Promise<{ track: TrackPlan; media: HlsMedia }> {
  const parsed = parseHls(await fetchText(url), url);
  if (parsed.type !== 'media') {
    // A master where we expected a media playlist: follow its best variant.
    const best = parsed.variants.filter((v) => reachableFrom(url, v.url)).sort((a, b) => b.bandwidth - a.bandwidth)[0];
    if (!best || parsed.encrypted) throw new PlanError(parsed.encrypted ? 'protected' : 'unknown');
    return hlsTrack(best.url, fetchText, live);
  }
  if (parsed.encrypted) throw new PlanError('protected');
  if (!parsed.endList && !live) throw new PlanError('live');
  // A live stream: its playlist is read again and again while it is recorded.
  if (!parsed.endList) return { track: { segments: [], container: parsed.map ? 'fmp4' : 'ts', ...(parsed.map ? { init: parsed.map } : {}), live: url }, media: parsed };
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
    const chosen = o.audios?.[0] ? hlsRendition(item, o.audios[0], variant?.audioGroup) : undefined;
    const audioTrack = chosen ?? group.find((a) => a.isDefault) ?? group[0];
    if (audioTrack) {
      const { track } = await hlsTrack(audioTrack.url, o.fetchText, !!o.live);
      return { ...common, audio: track, output: audioOut(o), raw: false, audioOnly: true };
    }
    const lightest = [...variants].sort((a, b) => (a.bandwidth ?? 0) - (b.bandwidth ?? 0))[0];
    const { track } = await hlsTrack(lightest?.url ?? item.url, o.fetchText, !!o.live);
    return { ...common, video: track, output: audioOut(o), raw: false, audioOnly: true };
  }

  const variant = chosenVariant(variants, o);
  const { track: video, media } = await hlsTrack(variant?.url ?? item.url, o.fetchText, !!o.live);
  let audio: TrackPlan | undefined;
  let audioInfo: Plan['audioInfo'];
  const audios: NonNullable<Plan['audios']> = [];
  if (o.audios?.length) {
    // The sound tracks chosen, in their order: the first one is the main one.
    for (const id of o.audios) {
      const r = hlsRendition(item, id, variant?.audioGroup);
      if (!r) continue;
      const { track } = await hlsTrack(r.url, o.fetchText, !!o.live);
      if (!audio) {
        audio = track;
        audioInfo = { label: r.label, ...(r.lang ? { lang: r.lang } : {}) };
      } else audios.push({ track, label: r.label, ...(r.lang ? { lang: r.lang } : {}) });
    }
  } else if (variant?.audioGroup) {
    const group = item.audioTracks.filter((a) => a.groupId === variant.audioGroup && a.url);
    const choice = group.find((a) => a.isDefault) ?? group[0];
    if (choice) {
      audio = (await hlsTrack(choice.url, o.fetchText, !!o.live)).track;
      audioInfo = { label: choice.label, ...(choice.lang ? { lang: choice.lang } : {}) };
    }
  }
  const duration = media.duration || item.duration || 0;
  const estimatedSize = variant?.bandwidth ? Math.round((variant.bandwidth * duration) / 8) : undefined;
  const scale = scaled(o, variant, estimatedSize);
  const raw = tooBig(estimatedSize, !!audio);
  return {
    ...common,
    video,
    ...(audio ? { audio } : {}),
    ...(audios.length && !raw ? { audios } : {}),
    ...(audioInfo?.lang ? { audioInfo } : {}),
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
  // The sound tracks chosen (the first is the main one), else the best one.
  const chosen = (o.audios ?? []).flatMap((id) => mpd.audio.filter((r) => r.id === id));
  const audioRep = chosen[0] ?? [...mpd.audio].sort(byBw)[0];
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
  const audios = raw || o.mode !== 'video' ? [] : chosen.slice(1).map((r) => ({ track: dashTrack(r, item.url), label: r.lang ?? r.id, ...(r.lang ? { lang: r.lang } : {}) }));
  return {
    ...common,
    video,
    ...(audio ? { audio } : {}),
    ...(audios.length ? { audios } : {}),
    ...(audioRep?.lang ? { audioInfo: { lang: audioRep.lang, label: audioRep.lang } } : {}),
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
  const out: Plan = { ...plan, clip: { start: clip.start, duration: clip.end - clip.start } };
  for (const key of ['video', 'audio'] as const) {
    const t = plan[key];
    if (!t) continue;
    const c = clipTrack(t, clip);
    out[key] = c.track;
    out.clip![key] = c.offset;
  }
  if (plan.audios?.length) {
    const cut = plan.audios.map((a) => ({ a, c: clipTrack(a.track, clip) }));
    out.audios = cut.map(({ a, c }) => ({ ...a, track: c.track }));
    out.clip!.audios = cut.map(({ c }) => c.offset);
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

/** The WebVTT segments of a subtitle track, or nothing when they can't be read. */
async function subsTrack(
  item: MediaItem,
  id: string,
  fetchText: PlanOptions['fetchText'],
): Promise<{ track: TrackPlan; clock?: SubsClock; captured?: { lang: string; auto?: boolean } } | null> {
  const sub = item.subtitles?.find((s) => s.id === id);
  if (!sub) return null;
  // YouTube: its hidden player shows them while it records, Grabby keeps what it loads.
  if (item.ytId && item.kind === 'capture') {
    if (!sub.lang) return null;
    return {
      track: { segments: [], container: 'vtt' },
      captured: { lang: sub.lang, ...(sub.auto ? { auto: true } : {}), ...(sub.tlang ? { tlang: sub.tlang } : {}) },
    };
  }
  if (item.kind === 'hls') {
    const parsed = parseHls(await fetchText(sub.url), sub.url);
    if (parsed.type !== 'media' || parsed.encrypted || !parsed.segments.length) return null;
    const segments = parsed.segments.map(({ url, range }) => (range ? { url, range } : { url }));
    // Subtitles packed in MP4 (EXT-X-MAP): their clock starts with the stream's first segment.
    if (parsed.map) return { track: checkReachable(sub.url, { init: parsed.map, segments, container: 'fmp4' }), clock: { fromFirst: true } };
    return { track: checkReachable(sub.url, { segments, container: 'vtt' }) };
  }
  if (item.kind === 'dash') {
    const rep = parseDash(await fetchText(item.url), item.url).text.find((r) => r.id === id);
    if (!rep?.segments.length) return null;
    const fmp4 = rep.packing === 'fmp4';
    // Without an init segment, only a whole MP4 file can be read.
    if (fmp4 && !rep.init && rep.segments.length !== 1) return null;
    return {
      track: checkReachable(item.url, { ...(fmp4 ? { init: rep.init! } : {}), segments: rep.segments, container: fmp4 ? 'fmp4' : 'vtt' }),
      ...(rep.pto ? { clock: { shift: -rep.pto } } : {}),
    };
  }
  // A file or a recorded player: a subtitle file the page names (<track>) or loaded.
  return { track: { segments: [{ url: sub.url }], container: 'vtt' } };
}

/** Adds the chosen subtitles to a video's plan; a track that can't be read is left out. */
async function withSubs(plan: Plan, item: MediaItem, o: PlanOptions): Promise<Plan> {
  const ids = subsIds(o.subtitles);
  if (!ids.length || o.mode !== 'video' || plan.audioOnly || plan.image) return plan;
  const found: { sub: NonNullable<MediaItem['subtitles']>[number]; got: NonNullable<Awaited<ReturnType<typeof subsTrack>>> }[] = [];
  for (const id of ids) {
    const sub = item.subtitles?.find((s) => s.id === id);
    const got = sub ? await subsTrack(item, sub.id, o.fetchText).catch(() => null) : null;
    if (sub && got) found.push({ sub, got });
  }
  if (!found.length) return plan;
  let out = plan;
  // Putting them in a file saved as is means assembling it: fetched by Grabby, then remuxed.
  if (plan.kind === 'file' && !o.subtitles!.separate && SUB_CODEC[plan.output] && (item.size ?? 0) <= RAW_THRESHOLD) {
    out = { ...plan, raw: false };
    delete out.direct;
    delete out.fast;
  }
  // Not assembled (saved as is, huge) or a container without subtitles: .srt files next to it.
  const separate = o.subtitles!.separate || !!out.raw || !!out.direct || !SUB_CODEC[out.output];
  const subtitles = found.map<PlanSubs>(({ sub, got }) => ({
    track: got.track,
    ...(got.clock ? { clock: got.clock } : {}),
    ...(got.captured ? { captured: got.captured } : {}),
    // Named after its language, in the browser's language, said when automatic or translated.
    label: trackTitle(sub, browserWords(), browserLanguage()),
    // Translated: in the language it was translated into.
    ...(sub.tlang ? { lang: sub.tlang } : sub.lang ? { lang: sub.lang } : {}),
    separate,
  }));
  return { ...out, subtitles };
}

/** The video's chapters, and what the file says it is (its cover for a sound file). */
function withMeta(plan: Plan, item: MediaItem, o: PlanOptions): Plan {
  let out: Plan = { ...plan };
  const chapters = !!item.chapters?.length && !o.noChapters && !plan.image && CHAPTER_FORMATS.has(plan.output);
  // A file saved as is gets its chapters by being fetched by Grabby, then remuxed.
  if (chapters && plan.kind === 'file' && (plan.direct || plan.raw) && (item.size ?? 0) <= RAW_THRESHOLD) {
    out = { ...out, raw: false };
    delete out.direct;
    delete out.fast;
  }
  if (chapters && !out.raw && !out.direct) out.chapters = item.chapters!;
  // A sound file evened out: a file saved as is (small enough) goes through ffmpeg too.
  if (o.settings.normalize && plan.audioOnly && !plan.image) {
    if (out.kind === 'file' && (out.direct || out.raw) && (item.size ?? 0) <= RAW_THRESHOLD) {
      out = { ...out, raw: false };
      delete out.direct;
      delete out.fast;
    }
    if (!out.raw && !out.direct) out.normalize = true;
  }
  if (!out.raw && !out.direct && !plan.image) {
    // A video of a list: its own title, not the numbered file name.
    const title = item.fromList?.title ?? item.title;
    out.meta = {
      ...(title ? { title } : {}),
      ...(item.author ? { artist: item.author } : {}),
      ...(plan.audioOnly && item.thumbnail ? { cover: item.thumbnail } : {}),
    };
  }
  return out;
}

export { languageName };

/** The longest an animated picture can be (it holds every frame as a picture). */
export const MAX_ANIMATION = 30;

/** The part of the video a picture is made from: a second for a still, the part (or its first seconds) for an animation. */
export function imageClip(still: boolean, at: number | undefined, clip: Clip | undefined, duration?: number): Clip {
  const len = duration ?? 0;
  if (still) {
    const t = Math.max(0, Math.min(at ?? 0, len ? Math.max(0, len - 1) : Infinity));
    return { start: t, end: t + 1 };
  }
  const c = clip && clip.end - clip.start >= 1 ? { start: Math.max(0, clip.start), end: len ? Math.min(len, clip.end) : clip.end } : { start: 0, end: len ? Math.min(len, 5) : 5 };
  return { start: c.start, end: Math.min(c.end, c.start + MAX_ANIMATION) };
}

/**
 * A picture made from the video: a still at `at` (its second is fetched), or an animation of
 * the part (the first seconds when none is chosen). Only the picture is fetched.
 */
async function imagePlan(item: MediaItem, o: PlanOptions): Promise<Plan> {
  const len = item.duration ?? 0;
  const clip = imageClip(o.format === 'jpg', o.at ?? o.clip?.start, o.clip, item.duration);
  const base = await planFor(item, { ...o, mode: 'video', format: o.settings.videoFormat });
  if (base.kind === 'file' && (item.size ?? 0) > RAW_THRESHOLD) throw new PlanError('too_large');
  const plan: Plan = { ...base, raw: false, audioOnly: false };
  delete plan.direct;
  delete plan.fast;
  delete plan.scale;
  // The sound of a stream isn't needed (a recording records it anyway).
  if (plan.kind === 'stream' && plan.video) delete plan.audio;
  // A contact sheet: pictures of the whole video, side by side.
  if (o.sheet !== undefined && len) return { ...plan, output: 'jpg', image: { sheet: sheetLayout(len, o.sheet) } };
  const cut = len ? applyClip(plan, clip, o, item.duration) : { ...plan, clip: { start: clip.start, duration: clip.end - clip.start, video: clip.start } };
  return { ...cut, output: o.format!, image: { at: clip.start } };
}

/** Turns a detected item + user choice into a concrete download plan. */
export async function buildPlan(item: MediaItem, o: PlanOptions): Promise<Plan> {
  if (item.protection !== 'none') throw new PlanError('protected');
  if (item.live) {
    // A live stream is recorded as it goes: a stream whose playlist grows, or the page's player.
    if (!o.live || item.kind === 'dash' || isImageFormat(o.format)) throw new PlanError('live');
    const plan = await planFor(item, o);
    return withMeta(withFinish({ ...plan, live: { max: Math.round(o.live * 60) } }, item, o), item, o);
  }
  if (isImageFormat(o.format)) {
    if (item.audioOnly) throw new PlanError('unknown');
    return imagePlan(item, o);
  }
  // Several parts joined: everything from the first to the last is fetched, then cut.
  const parts = joinedParts(o.parts, item.duration);
  if (parts) {
    const hull = { start: parts[0]!.start, end: parts[parts.length - 1]!.end };
    const plan = await clipped(item, o, hull);
    if (plan.clip) return withMeta(withFinish(await withSubs({ ...plan, parts }, item, o), item, o), item, o);
  }
  // Processing first: a file it makes go through ffmpeg gets its title and tags too.
  return withMeta(withFinish(await withSubs(await clipped(item, o), item, o), item, o), item, o);
}

/** What is done to the file afterwards needs ffmpeg: never a file saved as it is. */
function withFinish(plan: Plan, item: MediaItem, o: PlanOptions): Plan {
  if (!o.finish || plan.image) return plan;
  const i18n = typeof chrome !== 'undefined' ? chrome.i18n : undefined;
  let out: Plan = { ...plan, finish: o.finish, ...(o.settings.chromeAi ? { chromeAi: true } : {}), ...(i18n ? { words: finishWords((k, s) => i18n.getMessage(k, s), i18n.getUILanguage()) } : {}) };
  if (out.kind === 'file' && (out.direct || out.raw)) {
    if ((item.size ?? 0) > RAW_THRESHOLD) throw new PlanError('too_large');
    out = { ...out, raw: false };
    delete out.direct;
    delete out.fast;
  }
  if (out.raw) throw new PlanError('too_large');
  return out;
}

/** Parts to join: valid, in order, overlapping ones merged; fewer than two is not joining. */
export function joinedParts(parts: Clip[] | undefined, duration?: number): Clip[] | undefined {
  const valid = (parts ?? [])
    .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end))
    .map((p) => ({ start: Math.max(0, p.start), end: duration ? Math.min(duration, p.end) : p.end }))
    .filter((p) => p.end - p.start >= 1);
  valid.sort((a, b) => a.start - b.start);
  const out: Clip[] = [];
  for (const p of valid) {
    const last = out[out.length - 1];
    if (last && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else out.push({ ...p });
  }
  return out.length >= 2 ? out : undefined;
}

/** `hull`: the span of parts to join, cut even when it reaches both ends of the video. */
async function clipped(item: MediaItem, o: PlanOptions, hull?: Clip): Promise<Plan> {
  const clip = hull ?? validClip(o.clip, item.duration);
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
