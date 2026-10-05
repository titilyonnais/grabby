import { extOf } from '../parsers/url';
import type { Container, OutputFormat } from '../shared/plan';
import { iso3, SUB_CODEC } from '../shared/subtitles';

export interface MuxInputs {
  /** File holding video (possibly with audio muxed in). */
  video?: string;
  /** Separate audio file. */
  audio?: string;
  /** Subtitles (.srt) to put in the video. */
  subs?: { path: string; lang?: string; title?: string };
}

/** Keep only part: how long, and where it starts in each input. */
export interface ClipArgs {
  duration: number;
  video?: number;
  audio?: number;
}

const secs = (n: number) => String(Math.round(n * 1000) / 1000);
/** Seeking before an input is fast: ffmpeg skips what comes before (to a keyframe when copying). */
const seek = (at?: number) => (at && at > 0 ? ['-ss', secs(at)] : []);

export interface Attempt {
  args: string[];
  out: string;
  ext: string;
}

/** Extension used for an input file inside the ffmpeg FS (ffmpeg probes content anyway). */
export function inputExt(container: Container, url?: string): string {
  switch (container) {
    case 'ts':
      return 'ts';
    case 'fmp4':
      return 'mp4';
    case 'webm':
      return 'webm';
    case 'vtt':
      return 'vtt';
    case 'file': {
      const e = url ? extOf(url) : '';
      return e || 'bin';
    }
  }
}

/**
 * Opus through ffmpeg's own encoder: libopus in ffmpeg.wasm 0.12 crashes ("memory access
 * out of bounds") on anything that isn't already 48 kHz. Opus only takes 48 kHz, ≤ 2 channels.
 */
const OPUS = ['-c:a', 'opus', '-strict', '-2', '-ar', '48000', '-ac', '2', '-b:a', '160k'];

/** Audio encoders per output, used when the source codec doesn't fit the container. */
const AUDIO_ENCODE: Record<string, string[]> = {
  m4a: ['-c:a', 'aac', '-b:a', '192k'],
  mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  opus: OPUS,
  ogg: ['-c:a', 'libvorbis', '-q:a', '6'],
  flac: ['-c:a', 'flac'],
  wav: ['-c:a', 'pcm_s16le'],
};

/** Audio codec each video container falls back to when the source's doesn't fit. */
const VIDEO_AUDIO_FALLBACK: Record<string, string[]> = {
  webm: OPUS,
  avi: ['-c:a', 'libmp3lame', '-q:a', '2'],
};

/**
 * Shrinking the picture (a quality the source doesn't offer): H.264 fitted in the box, the
 * fastest settings that still look right, since ffmpeg.wasm encodes on a single thread.
 */
export function shrinkArgs(box: { w: number; h: number }): string[] {
  return [
    '-vf', `scale=w=${box.w}:h=${box.h}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
  ];
}

/**
 * ffmpeg invocations to try in order until one succeeds. Stream copy first (fast, lossless),
 * then audio re-encode (codec not allowed in the container), then MKV (accepts anything).
 * The picture is copied as it is, unless it must be shrunk (`scale`): re-encoding is slow
 * in the browser, so it is done only when the user asks for a smaller quality.
 */
export function muxAttempts(
  inputs: MuxInputs,
  output: OutputFormat,
  audioOnly: boolean,
  outBase: string,
  scale?: { w: number; h: number },
  clip?: ClipArgs,
): Attempt[] {
  // A part: stops after its length, its timestamps starting at zero.
  const cut = clip ? ['-t', secs(clip.duration), '-avoid_negative_ts', 'make_zero'] : [];
  const mk = (ext: string, body: string[]): Attempt => ({ ext, out: `${outBase}.${ext}`, args: ['-y', ...body, ...cut, `${outBase}.${ext}`] });

  if (audioOnly) {
    const src = inputs.audio ?? inputs.video;
    if (!src) throw new Error('no input');
    const ext = AUDIO_ENCODE[output] ? output : 'm4a';
    const base = [...seek(inputs.audio ? clip?.audio : clip?.video), '-i', src, '-vn', '-map', '0:a:0'];
    // Lossless formats and MP3 are always encoded; the others first try a plain copy. Not M4A
    // from WebM/Ogg: that's Opus or Vorbis, which an MP4 file accepts but Apple players refuse.
    const opusOrVorbis = /\.(webm|ogg|opus|mka)$/i.test(src);
    // OGG means Vorbis here (Opus has its own choice): always encoded, never an Opus copy.
    const copyable = ext === 'm4a' ? !opusOrVorbis : ext === 'opus';
    const copy = copyable ? [mk(ext, [...base, '-c:a', 'copy'])] : [];
    return [...copy, mk(ext, [...base, ...AUDIO_ENCODE[ext]!])];
  }

  if (!inputs.video) throw new Error('no video input');
  const ins = [...seek(clip?.video), '-i', inputs.video, ...(inputs.audio ? [...seek(clip?.audio), '-i', inputs.audio] : [])];
  const av = inputs.audio ? ['-map', '0:v:0', '-map', '1:a:0'] : ['-map', '0:v:0?', '-map', '0:a:0?'];
  // Subtitles: one more input, written in the form the container takes.
  const subsIn = inputs.subs ? ['-i', inputs.subs.path] : [];
  const subsMap = inputs.subs ? ['-map', `${inputs.audio ? 2 : 1}:0`] : [];
  const lang = iso3(inputs.subs?.lang);
  const subsMeta = [...(lang ? ['-metadata:s:s:0', `language=${lang}`] : []), ...(inputs.subs?.title ? ['-metadata:s:s:0', `title=${inputs.subs.title}`] : [])];
  const subsAs = (c: string) => (inputs.subs && SUB_CODEC[c] ? ['-c:s', SUB_CODEC[c]!, ...subsMeta] : []);
  const maps = [...av, ...(inputs.subs ? subsMap : [])];
  // H.264 doesn't go in WebM: a shrunk picture is saved as MP4 instead.
  const container = scale && output === 'webm' ? 'mp4' : ['mkv', 'webm', 'mov', 'avi', 'ts'].includes(output) ? output : 'mp4';
  const video = scale ? shrinkArgs(scale) : ['-c:v', 'copy'];
  const copy = scale ? [...video, '-c:a', 'copy'] : ['-c', 'copy'];
  const all = [...ins, ...subsIn];
  if (container === 'mkv') return [mk('mkv', [...all, ...maps, ...copy, ...subsAs('mkv')])];
  // MP4/MOV play before they are fully loaded when the index comes first.
  const tag = container === 'mp4' || container === 'mov' ? ['-movflags', '+faststart'] : [];
  const audio = VIDEO_AUDIO_FALLBACK[container] ?? ['-c:a', 'aac', '-b:a', '192k'];
  // A container without subtitles leaves them out (the plan saves them as a file instead).
  const own = SUB_CODEC[container] ? maps : av;
  return [
    mk(container, [...all, ...own, ...copy, ...subsAs(container), ...tag]),
    mk(container, [...all, ...own, ...video, ...audio, ...subsAs(container), ...tag]),
    mk('mkv', [...all, ...maps, ...copy, ...subsAs('mkv')]),
  ];
}
