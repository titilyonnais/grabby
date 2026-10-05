import { extOf } from '../parsers/url';
import type { Container, OutputFormat } from '../shared/plan';
import { iso3, SUB_CODEC } from '../shared/subtitles';
import { CHAPTER_FORMATS } from '../shared/formats';

/** A file to put in as a track of its own, with its language and name. */
export interface TrackInput {
  path: string;
  lang?: string;
  title?: string;
}

export interface MuxInputs {
  /** File holding video (possibly with audio muxed in). */
  video?: string;
  /** Separate audio file. */
  audio?: string;
  /** More sound tracks (other languages), after the main one. */
  audios?: TrackInput[];
  /** Subtitles (.srt) to put in the video, one track each. */
  subs?: TrackInput[];
  /** Chapters, as an ffmetadata file. */
  chapters?: string;
  /** A picture for a sound file's cover. */
  cover?: string;
  /** What the file says it is. */
  meta?: { title?: string; artist?: string };
  /** The main sound track's language (and name, when there are several). */
  audioMeta?: { lang?: string; title?: string };
  /** A single input holding several sound tracks (parts joined): all of them are kept. */
  allAudio?: boolean;
}

/** Containers that hold chapters (and audio formats, for a sound file). */
const CHAPTERS = CHAPTER_FORMATS;
/** Sound files that hold a cover picture. */
const COVERS = new Set(['m4a', 'mp3', 'flac']);

function metaArgs(meta: MuxInputs['meta']): string[] {
  return [...(meta?.title ? ['-metadata', `title=${meta.title}`] : []), ...(meta?.artist ? ['-metadata', `artist=${meta.artist}`] : [])];
}

/** Language and name of the `n`-th track of a kind (`a`: sound, `s`: subtitles). */
function trackMeta(kind: 'a' | 's', n: number, t: { lang?: string; title?: string }): string[] {
  const lang = iso3(t.lang);
  return [...(lang ? [`-metadata:s:${kind}:${n}`, `language=${lang}`] : []), ...(t.title ? [`-metadata:s:${kind}:${n}`, `title=${t.title}`] : [])];
}

/** Keep only part: how long, and where it starts in each input. */
export interface ClipArgs {
  duration: number;
  video?: number;
  audio?: number;
  /**
   * A copied picture starts on the keyframe before the part, this much earlier: the sound
   * (a separate input) starts there too, so the first seconds are not silent.
   */
  lead?: number;
  /** Where the part starts in each of the other sound tracks. */
  audios?: number[];
}

const secs = (n: number) => String(Math.round(n * 1000) / 1000);
/** Seeking before an input is fast: ffmpeg skips what comes before (to a keyframe when copying). */
const seek = (at?: number) => (at && at > 0 ? ['-ss', secs(at)] : []);

/**
 * Where a separate sound input starts: with the picture's keyframe, `lead` before the part
 * (its clock shifted back by as much, so both stay in step).
 */
function soundFrom(clip?: ClipArgs, at = clip?.audio ?? 0): string[] {
  const lead = clip?.lead ?? 0;
  if (!(lead > 0) || !clip) return seek(at);
  const from = Math.max(0, at - lead);
  return [...seek(from), '-itsoffset', secs(-(at - from))];
}

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
    const chapters = inputs.chapters && CHAPTERS.has(ext) ? inputs.chapters : undefined;
    const cover = inputs.cover && COVERS.has(ext) ? inputs.cover : undefined;
    const sound = [...seek(inputs.audio ? clip?.audio : clip?.video), '-i', src, ...(chapters ? ['-i', chapters] : [])];
    const tags = [...(chapters ? ['-map_chapters', '1'] : []), ...metaArgs(inputs.meta), ...(ext === 'mp3' ? ['-id3v2_version', '3'] : [])];
    // The cover: a still picture, written as JPEG (standard Huffman tables: see imageAttempts).
    const withCover = cover
      ? [...sound, '-i', cover, '-map', '0:a:0', '-map', `${chapters ? 2 : 1}:v:0`, '-c:v', 'mjpeg', '-huffman', '0', '-pix_fmt', 'yuvj420p', '-disposition:v:0', 'attached_pic']
      : [];
    const plain = [...sound, '-vn', '-map', '0:a:0'];
    // Lossless formats and MP3 are always encoded; the others first try a plain copy. Not M4A
    // from WebM/Ogg: that's Opus or Vorbis, which an MP4 file accepts but Apple players refuse.
    const opusOrVorbis = /\.(webm|ogg|opus|mka)$/i.test(src);
    // OGG means Vorbis here (Opus has its own choice): always encoded, never an Opus copy.
    const copyable = ext === 'm4a' ? !opusOrVorbis : ext === 'opus';
    const tries = (body: string[]) => [
      ...(copyable ? [mk(ext, [...body, '-c:a', 'copy', ...tags])] : []),
      mk(ext, [...body, ...AUDIO_ENCODE[ext]!, ...tags]),
    ];
    // A cover that can't be read must not cost the file: the same without it.
    return cover ? [...tries(withCover), ...tries(plain)] : tries(plain);
  }

  if (!inputs.video) throw new Error('no video input');
  const ins = [...seek(clip?.video), '-i', inputs.video, ...(inputs.audio ? [...soundFrom(clip), '-i', inputs.audio] : [])];
  let next = inputs.audio ? 2 : 1;
  const av = inputs.audio ? ['-map', '0:v:0', '-map', '1:a:0'] : ['-map', '0:v:0?', '-map', inputs.allAudio ? '0:a?' : '0:a:0?'];
  // Other languages: more sound inputs, after the main one.
  const audios = inputs.audios ?? [];
  for (const [i, a] of audios.entries()) ins.push(...soundFrom(clip, clip?.audios?.[i] ?? clip?.audio ?? 0), '-i', a.path);
  const audioMaps = audios.flatMap((_, i) => ['-map', `${next + i}:a:0`]);
  const audioMeta = [...(inputs.audioMeta ? trackMeta('a', 0, inputs.audioMeta) : []), ...audios.flatMap((a, i) => trackMeta('a', i + 1, a))];
  next += audios.length;
  // Subtitles: one more input each, written in the form the container takes.
  const subs = inputs.subs ?? [];
  for (const s of subs) ins.push('-i', s.path);
  const subsMap = subs.flatMap((_, i) => ['-map', `${next + i}:0`]);
  next += subs.length;
  const subsAs = (c: string) => (subs.length && SUB_CODEC[c] ? ['-c:s', SUB_CODEC[c]!, ...subs.flatMap((s, i) => trackMeta('s', i, s))] : []);
  const chapters = inputs.chapters ? next : undefined;
  if (inputs.chapters) ins.push('-i', inputs.chapters);
  const tags = (c: string) => [...(chapters !== undefined && CHAPTERS.has(c) ? ['-map_chapters', String(chapters)] : []), ...metaArgs(inputs.meta), ...audioMeta];
  const maps = [...av, ...audioMaps, ...subsMap];
  // H.264 doesn't go in WebM: a shrunk picture is saved as MP4 instead.
  const container = scale && output === 'webm' ? 'mp4' : ['mkv', 'webm', 'mov', 'avi', 'ts'].includes(output) ? output : 'mp4';
  const video = scale ? shrinkArgs(scale) : ['-c:v', 'copy'];
  const copy = scale ? [...video, '-c:a', 'copy'] : ['-c', 'copy'];
  if (container === 'mkv') return [mk('mkv', [...ins, ...maps, ...copy, ...subsAs('mkv'), ...tags('mkv')])];
  // MP4/MOV play before they are fully loaded when the index comes first.
  const tag = container === 'mp4' || container === 'mov' ? ['-movflags', '+faststart'] : [];
  const audio = VIDEO_AUDIO_FALLBACK[container] ?? ['-c:a', 'aac', '-b:a', '192k'];
  // A container without subtitles leaves them out (the plan saves them as a file instead).
  const own = SUB_CODEC[container] ? maps : [...av, ...audioMaps];
  return [
    mk(container, [...ins, ...own, ...copy, ...subsAs(container), ...tags(container), ...tag]),
    mk(container, [...ins, ...own, ...video, ...audio, ...subsAs(container), ...tags(container), ...tag]),
    mk('mkv', [...ins, ...maps, ...copy, ...subsAs('mkv'), ...tags('mkv')]),
  ];
}

/** How wide an animation is made: enough to see, small enough to share. */
const ANIMATION_WIDTH = 480;

/**
 * A picture made from the video, `at` seconds into the input: a still (JPEG, the frame
 * exactly there) or an animation of `duration` seconds (GIF with its own palette, WebP).
 */
export function imageAttempts(input: string, output: OutputFormat, outBase: string, at: number, duration: number): Attempt[] {
  const from = seek(at);
  const scale = `scale=${ANIMATION_WIDTH}:-2:flags=lanczos`;
  switch (output) {
    case 'jpg': {
      // Computing optimal Huffman tables crashes this ffmpeg.wasm build: the standard ones.
      const still = (q: string[]) => ['-y', ...from, '-i', input, '-frames:v', '1', '-c:v', 'mjpeg', '-huffman', '0', '-pix_fmt', 'yuvj420p', ...q, '-an', `${outBase}.jpg`];
      return [
        { ext: 'jpg', out: `${outBase}.jpg`, args: still(['-q:v', '2']) },
        { ext: 'jpg', out: `${outBase}.jpg`, args: still([]) },
      ];
    }
    case 'gif':
      return [
        {
          ext: 'gif',
          out: `${outBase}.gif`,
          args: ['-y', ...from, '-t', secs(duration), '-i', input, '-vf', `fps=12,${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`, '-loop', '0', '-an', `${outBase}.gif`],
        },
      ];
    case 'webp':
      return [
        {
          ext: 'webp',
          out: `${outBase}.webp`,
          args: ['-y', ...from, '-t', secs(duration), '-i', input, '-vf', `fps=15,${scale}`, '-c:v', 'libwebp_anim', '-quality', '75', '-loop', '0', '-an', `${outBase}.webp`],
        },
      ];
    default:
      throw new Error(`not a picture: ${output}`);
  }
}
