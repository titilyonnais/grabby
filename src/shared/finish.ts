/**
 * What is done to a file once it is made: the little editor (crop, turn, speed, sound off),
 * a size to fit in, subtitles written into the picture, one file per chapter. The ffmpeg
 * arguments are built here, so they can be checked without a browser.
 */
import type { Chapter } from './plan';
import type { Cue } from './subtitles';

/** A part of the picture to keep, as shares of its width and height (0 to 1). */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface Edit {
  crop?: Crop;
  /** Turned clockwise. */
  rotate?: Rotation;
  /** Mirrored left to right. */
  flip?: boolean;
  /** Played faster or slower (0.25 to 4). */
  speed?: number;
  /** Without its sound. */
  mute?: boolean;
  /** « Son plus propre »: less hiss and hum, a steadier voice. */
  clean?: boolean;
}

export interface Finish {
  edit?: Edit;
  /** Made to fit in this many megabytes. */
  compress?: number;
  /** The subtitles written into the picture. */
  burn?: boolean;
  /** One file per chapter. */
  split?: boolean;
}

export const COMPRESS_SIZES = [10, 25, 50, 100] as const;
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const ROTATIONS: Rotation[] = [0, 90, 180, 270];

const share = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);

/** A crop worth doing: inside the picture, at least a tenth of it, and not all of it. */
export function cleanCrop(input: unknown): Crop | undefined {
  const c = input as Partial<Crop> | undefined;
  const x = share(c?.x);
  const y = share(c?.y);
  const w = share(c?.w);
  const h = share(c?.h);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  const crop = { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
  if (crop.w < 0.1 || crop.h < 0.1) return undefined;
  if (crop.x < 0.005 && crop.y < 0.005 && crop.w > 0.995 && crop.h > 0.995) return undefined;
  return crop;
}

export function cleanEdit(input: unknown, audioOnly: boolean): Edit | undefined {
  const e = input as Partial<Edit> | undefined;
  if (!e || typeof e !== 'object') return undefined;
  const out: Edit = {};
  const speed = typeof e.speed === 'number' && Number.isFinite(e.speed) ? Math.min(4, Math.max(0.25, Math.round(e.speed * 100) / 100)) : 1;
  if (speed !== 1) out.speed = speed;
  if (e.clean === true && e.mute !== true) out.clean = true;
  if (!audioOnly) {
    const crop = cleanCrop(e.crop);
    if (crop) out.crop = crop;
    if (e.rotate === 90 || e.rotate === 180 || e.rotate === 270) out.rotate = e.rotate;
    if (e.flip === true) out.flip = true;
    if (e.mute === true) out.mute = true;
  }
  return Object.keys(out).length ? out : undefined;
}

/** What a download may ask for, checked: anything else is left out. */
export function cleanFinish(input: unknown, audioOnly: boolean): Finish | undefined {
  const f = input as Partial<Finish> | undefined;
  if (!f || typeof f !== 'object') return undefined;
  const out: Finish = {};
  const edit = cleanEdit(f.edit, audioOnly);
  if (edit) out.edit = edit;
  if (typeof f.compress === 'number' && Number.isFinite(f.compress) && f.compress >= 1 && f.compress <= 4000) out.compress = Math.round(f.compress);
  if (f.burn === true && !audioOnly) out.burn = true;
  if (f.split === true) out.split = true;
  return Object.keys(out).length ? out : undefined;
}

/** The picture or the sound has to be made again (slow): editing, a size, burned subtitles. */
export function needsEncode(f: Finish | undefined): boolean {
  return !!(f?.edit || f?.compress || f?.burn);
}

/** Changing the speed of the sound: atempo takes 0.5 to 2, so steps are chained. */
export function atempo(speed: number): string[] {
  const out: string[] = [];
  let left = speed;
  while (left > 2 + 1e-9) {
    out.push('atempo=2');
    left /= 2;
  }
  while (left < 0.5 - 1e-9) {
    out.push('atempo=0.5');
    left /= 0.5;
  }
  if (Math.abs(left - 1) > 1e-9) out.push(`atempo=${Math.round(left * 10000) / 10000}`);
  return out;
}

const num = (n: number) => String(Math.round(n * 10000) / 10000);

/**
 * « Son plus propre »: the rumble under the voice cut, the steady hiss taken out (spectral
 * denoise), the very top cut, then the level evened out gently (no pumping on music).
 */
export const CLEAN_SOUND = ['highpass=f=70', 'afftdn=nr=12:nf=-35', 'lowpass=f=15000', 'dynaudnorm=f=250:g=15:p=0.9'];

/** The sound's filters, in order: made cleaner, then played at its new speed. */
export function audioFilters(e: Edit | undefined): string[] {
  return [...(e?.clean ? CLEAN_SOUND : []), ...(e?.speed && e.speed !== 1 ? atempo(e.speed) : [])];
}

/** The font subtitles are written with (shipped with Grabby, see THIRD_PARTY_NOTICES). */
export const FONT_DIR = '/fonts';
export const FONT_FILE = 'NotoSans-Regular.ttf';
export const FONT_NAME = 'Noto Sans';
/** Writings the font has no letters for: burned in, they would show as boxes. */
const NOT_DRAWN = new Set(['zh', 'ja', 'ko', 'ar', 'fa', 'ur', 'he', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'pa', 'th', 'lo', 'km', 'my', 'am', 'ka', 'hy', 'si']);
/** Subtitles in this language can be written into the picture with the font shipped. */
export const canBurn = (lang: string | undefined): boolean => !lang || !NOT_DRAWN.has(lang.toLowerCase().split(/[-_]/)[0]!);

/**
 * The picture's filters, in order: the part kept, turned, mirrored, made smaller (a size to
 * fit), the subtitles written in (on the turned picture, so they read upright), then the speed.
 */
export function videoFilters(e: Edit | undefined, o: { height?: number; burn?: string } = {}): string[] {
  const out: string[] = [];
  const c = e?.crop;
  // Even sizes: H.264 needs them.
  if (c) out.push(`crop=trunc(iw*${num(c.w)}/2)*2:trunc(ih*${num(c.h)}/2)*2:trunc(iw*${num(c.x)}):trunc(ih*${num(c.y)})`);
  if (e?.rotate === 90) out.push('transpose=1');
  else if (e?.rotate === 180) out.push('hflip', 'vflip');
  else if (e?.rotate === 270) out.push('transpose=2');
  if (e?.flip) out.push('hflip');
  // Never made bigger.
  if (o.height) out.push(`scale=-2:'min(${o.height},ih)':flags=lanczos`);
  if (o.burn) out.push(`subtitles=${o.burn}:fontsdir=${FONT_DIR}:force_style='FontName=${FONT_NAME},FontSize=22,Outline=2,Shadow=0,MarginV=24'`);
  if (e?.speed && e.speed !== 1) out.push(`setpts=PTS/${num(e.speed)}`);
  return out;
}

/** A size to fit: the bitrates (kbit/s) and the height that fit it, from the length. */
export interface Budget {
  video: number;
  audio: number;
  /** Lines of the picture (a smaller picture looks better than a starved big one). */
  height?: number;
}

/**
 * The bitrates for a file of `mb` megabytes lasting `seconds`: a little is kept back for the
 * container, the sound gets what it needs to stay clear, the picture the rest, and its height
 * goes down with what it gets.
 */
export function budget(mb: number, seconds: number, o: { video: boolean; sound: boolean; height?: number }): Budget {
  const total = (mb * 8 * 1024 * 1024 * 0.94) / 1000 / Math.max(1, seconds);
  if (!o.video) return { video: 0, audio: Math.max(24, Math.min(192, Math.floor(total))) };
  const audio = !o.sound ? 0 : total >= 1200 ? 128 : total >= 500 ? 96 : total >= 200 ? 64 : 32;
  const video = Math.max(40, Math.floor(total - audio));
  const fit = video >= 4000 ? 1080 : video >= 1800 ? 720 : video >= 900 ? 480 : video >= 450 ? 360 : 240;
  const height = o.height ? Math.min(o.height, fit) : fit;
  return { video, audio, ...(height < (o.height ?? Infinity) || !o.height ? { height } : {}) };
}

/** What a file made again from `input` must be. */
export interface EncodeJob {
  input: string;
  outBase: string;
  /** The made file's kind (its extension). */
  ext: string;
  audioOnly: boolean;
  edit?: Edit;
  /** Seconds, for a size to fit. */
  duration?: number;
  compress?: number;
  /** Lines of the source picture. */
  height?: number;
  /** A .srt file in ffmpeg's memory, written into the picture. */
  burn?: string;
  /** An ffmetadata file with the chapters moved to the new speed. */
  chapters?: string;
  /** The input has sound. */
  sound?: boolean;
}

/** Audio encoders for a sound file whose bitrate is chosen. */
const AUDIO_AT: Record<string, (k: number) => string[]> = {
  m4a: (k) => ['-c:a', 'aac', '-b:a', `${k}k`],
  mp3: (k) => ['-c:a', 'libmp3lame', '-b:a', `${k}k`],
  opus: (k) => ['-c:a', 'opus', '-strict', '-2', '-ar', '48000', '-ac', '2', '-b:a', `${Math.max(32, k)}k`],
  ogg: (k) => ['-c:a', 'libvorbis', '-b:a', `${Math.max(48, k)}k`],
};

/** Sound files that can be made smaller (FLAC and WAV are lossless: they become M4A). */
export const COMPRESSIBLE_AUDIO = new Set(Object.keys(AUDIO_AT));

/** The kind of file an edited video is saved as: H.264 and AAC go in these as they are. */
export function editedExt(ext: string): string {
  return ['mkv', 'mov', 'ts'].includes(ext) ? ext : 'mp4';
}

/**
 * The ffmpeg runs to make the file again, best first: the sound copied when nothing changes
 * it, else encoded. A video is H.264 (the only encoder fast enough in the browser).
 */
export function encodeAttempts(j: EncodeJob): { args: string[]; out: string; ext: string }[] {
  const speed = j.edit?.speed && j.edit.speed !== 1 ? j.edit.speed : undefined;
  const tempo = audioFilters(j.edit);
  const chapterIn = j.chapters ? ['-i', j.chapters] : [];
  // Chapters: moved to the new speed, or kept as they are.
  const chapterMap = j.chapters ? ['-map_chapters', '1'] : speed ? ['-map_chapters', '-1'] : [];
  if (j.audioOnly) {
    const ext = COMPRESSIBLE_AUDIO.has(j.ext) || !j.compress ? j.ext : 'm4a';
    const kbps = j.compress && j.duration ? budget(j.compress, j.duration / (speed ?? 1), { video: false, sound: true }).audio : 0;
    const enc = kbps ? AUDIO_AT[ext]!(kbps) : (AUDIO_AT[ext]?.(ext === 'mp3' ? 192 : 160) ?? (ext === 'flac' ? ['-c:a', 'flac'] : ['-c:a', 'pcm_s16le']));
    const out = `${j.outBase}.${ext}`;
    // The cover picture stays (copied).
    const body = ['-y', '-i', j.input, ...chapterIn, '-map', '0:a:0', '-map', '0:v?', '-c:v', 'copy', ...chapterMap, '-map_metadata', '0', ...(tempo.length ? ['-af', tempo.join(',')] : []), ...enc];
    return [
      { ext, out, args: [...body, ...(ext === 'mp3' ? ['-id3v2_version', '3'] : []), out] },
      // A cover that can't be copied must not cost the file.
      { ext, out, args: ['-y', '-i', j.input, ...chapterIn, '-map', '0:a:0', ...chapterMap, '-map_metadata', '0', ...(tempo.length ? ['-af', tempo.join(',')] : []), ...enc, out] },
    ];
  }
  const ext = editedExt(j.ext);
  const out = `${j.outBase}.${ext}`;
  const mute = !!j.edit?.mute || j.sound === false;
  const b = j.compress && j.duration ? budget(j.compress, j.duration / (speed ?? 1), { video: true, sound: !mute, ...(j.height ? { height: j.height } : {}) }) : undefined;
  const filters = videoFilters(j.edit, { ...(b?.height ? { height: b.height } : {}), ...(j.burn ? { burn: j.burn } : {}) });
  const picture = [
    ...(filters.length ? ['-vf', filters.join(',')] : []),
    // « Encodage plus rapide »: superfast when no size is aimed at (a little bigger, much quicker);
    // veryfast when the bitrate is counted (it then makes the better picture).
    '-c:v', 'libx264', '-preset', b ? 'veryfast' : 'superfast', '-pix_fmt', 'yuv420p',
    ...(b ? ['-b:v', `${b.video}k`, '-maxrate', `${Math.round(b.video * 1.3)}k`, '-bufsize', `${b.video * 2}k`] : ['-crf', '23']),
  ];
  // Subtitle tracks are dropped when their times no longer fit, or when they are burned in (shown twice otherwise).
  const dropSubs = !!speed || !!j.burn;
  const maps = ['-map', '0:v:0', ...(mute ? [] : ['-map', '0:a?']), ...(dropSubs ? [] : ['-map', '0:s?'])];
  const subs = dropSubs ? ['-sn'] : ['-c:s', ext === 'mkv' ? 'copy' : ext === 'ts' ? 'copy' : 'mov_text'];
  const tail = [...chapterMap, '-map_metadata', '0', ...(ext === 'mp4' || ext === 'mov' ? ['-movflags', '+faststart'] : []), out];
  const sound = (copy: boolean) => (mute ? ['-an'] : copy ? ['-c:a', 'copy'] : [...(tempo.length ? ['-af', tempo.join(',')] : []), '-c:a', 'aac', '-b:a', `${b?.audio ?? 160}k`]);
  const head = ['-y', '-i', j.input, ...chapterIn, ...maps];
  const tries = [];
  // The sound is copied when it stays as it is (and the container takes it).
  if (!tempo.length && !b && !mute) tries.push({ ext, out, args: [...head, ...picture, ...sound(true), ...subs, ...tail] });
  tries.push({ ext, out, args: [...head, ...picture, ...sound(false), ...subs, ...tail] });
  // Subtitle tracks a container can't take must not cost the file.
  tries.push({ ext, out, args: ['-y', '-i', j.input, ...chapterIn, '-map', '0:v:0', ...(mute ? [] : ['-map', '0:a:0?']), ...picture, ...sound(false), '-sn', ...tail] });
  return tries;
}

/** Times on the new clock of a file played `speed` times faster. */
export function speedCues(cues: Cue[], speed: number): Cue[] {
  if (!speed || speed === 1) return cues;
  return cues.map((c) => ({ ...c, start: c.start / speed, end: c.end / speed }));
}

export function speedChapters(chapters: Chapter[], speed: number): Chapter[] {
  if (!speed || speed === 1) return chapters;
  return chapters.map((c) => ({ ...c, start: c.start / speed }));
}

/** One file per chapter: where each one starts and how long it lasts (very short ones joined to the next). */
export function chapterPieces(chapters: Chapter[], duration: number): { start: number; length: number; title: string; n: number }[] {
  const sorted = [...chapters].filter((c) => Number.isFinite(c.start) && c.start >= 0 && c.start < duration).sort((a, b) => a.start - b.start);
  const out: { start: number; length: number; title: string; n: number }[] = [];
  sorted.forEach((c, i) => {
    const end = Math.min(duration, sorted[i + 1]?.start ?? duration);
    if (end - c.start < 1) return;
    out.push({ start: c.start, length: end - c.start, title: c.title.trim() || String(out.length + 1), n: out.length + 1 });
  });
  return out;
}

/** The ffmpeg run that cuts one chapter out of a file, as it is (no encoding), with its tags. */
export function pieceArgs(input: string, out: string, p: { start: number; length: number; title: string; n: number }, total: number, tags: { album?: string; artist?: string }): string[] {
  return [
    '-y', '-ss', num(p.start), '-i', input, '-t', num(p.length),
    '-map', '0', '-c', 'copy', '-map_chapters', '-1',
    '-metadata', `title=${p.title}`, '-metadata', `track=${p.n}/${total}`,
    ...(tags.album ? ['-metadata', `album=${tags.album}`] : []),
    ...(tags.artist ? ['-metadata', `artist=${tags.artist}`] : []),
    ...(out.endsWith('.mp3') ? ['-id3v2_version', '3'] : []),
    out,
  ];
}

/** "03 - Le titre": a chapter's file name, numbered so they sort in order. */
export function pieceName(n: number, total: number, title: string): string {
  return `${String(n).padStart(Math.max(2, String(total).length), '0')} - ${title}`;
}

/** How long a file lasts, read from what ffmpeg prints about it. */
export function durationIn(log: string): number | undefined {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(log);
  if (!m) return undefined;
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return s > 0 ? s : undefined;
}

/** The picture's height, read from what ffmpeg prints about the file. */
export function heightIn(log: string): number | undefined {
  const m = /Stream #[^\n]*Video:[^\n]*?\s(\d{2,5})x(\d{2,5})/.exec(log);
  return m ? Number(m[2]) : undefined;
}

/** The file has sound (ffmpeg's description of it). */
export function hasSoundIn(log: string): boolean {
  return /Stream #[^\n]*Audio:/.test(log);
}
