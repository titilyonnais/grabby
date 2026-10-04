import { extOf } from '../parsers/url';
import type { Container, OutputFormat } from '../shared/plan';

export interface MuxInputs {
  /** File holding video (possibly with audio muxed in). */
  video?: string;
  /** Separate audio file. */
  audio?: string;
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
    case 'file': {
      const e = url ? extOf(url) : '';
      return e || 'bin';
    }
  }
}

/** Audio encoders per output, used when the source codec doesn't fit the container. */
const AUDIO_ENCODE: Record<string, string[]> = {
  m4a: ['-c:a', 'aac', '-b:a', '192k'],
  mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  opus: ['-c:a', 'libopus', '-b:a', '160k'],
  ogg: ['-c:a', 'libvorbis', '-q:a', '6'],
  flac: ['-c:a', 'flac'],
  wav: ['-c:a', 'pcm_s16le'],
};

/** Audio codec each video container falls back to when the source's doesn't fit. */
const VIDEO_AUDIO_FALLBACK: Record<string, string[]> = {
  webm: ['-c:a', 'libopus', '-b:a', '160k'],
  avi: ['-c:a', 'libmp3lame', '-q:a', '2'],
};

/**
 * ffmpeg invocations to try in order until one succeeds. Stream copy first (fast, lossless),
 * then audio re-encode (codec not allowed in the container), then MKV (accepts anything).
 * The picture is never re-encoded: that would take far too long in the browser.
 */
export function muxAttempts(inputs: MuxInputs, output: OutputFormat, audioOnly: boolean, outBase: string): Attempt[] {
  const mk = (ext: string, body: string[]): Attempt => ({ ext, out: `${outBase}.${ext}`, args: ['-y', ...body, `${outBase}.${ext}`] });

  if (audioOnly) {
    const src = inputs.audio ?? inputs.video;
    if (!src) throw new Error('no input');
    const ext = AUDIO_ENCODE[output] ? output : 'm4a';
    const base = ['-i', src, '-vn', '-map', '0:a:0'];
    // Lossless formats and MP3 are always encoded; the others first try a plain copy.
    const copy = ['m4a', 'opus', 'ogg'].includes(ext) ? [mk(ext, [...base, '-c:a', 'copy'])] : [];
    return [...copy, mk(ext, [...base, ...AUDIO_ENCODE[ext]!])];
  }

  if (!inputs.video) throw new Error('no video input');
  const ins = ['-i', inputs.video, ...(inputs.audio ? ['-i', inputs.audio] : [])];
  const maps = inputs.audio ? ['-map', '0:v:0', '-map', '1:a:0'] : ['-map', '0:v:0?', '-map', '0:a:0?'];
  if (output === 'mkv') return [mk('mkv', [...ins, ...maps, '-c', 'copy'])];
  const container = ['webm', 'mov', 'avi', 'ts'].includes(output) ? output : 'mp4';
  // MP4/MOV play before they are fully loaded when the index comes first.
  const tag = container === 'mp4' || container === 'mov' ? ['-movflags', '+faststart'] : [];
  const audio = VIDEO_AUDIO_FALLBACK[container] ?? ['-c:a', 'aac', '-b:a', '192k'];
  return [
    mk(container, [...ins, ...maps, '-c', 'copy', ...tag]),
    mk(container, [...ins, ...maps, '-c:v', 'copy', ...audio, ...tag]),
    mk('mkv', [...ins, ...maps, '-c', 'copy']),
  ];
}
