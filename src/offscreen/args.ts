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

/**
 * ffmpeg invocations to try in order until one succeeds. Stream copy first (fast, lossless),
 * then audio re-encode (codec not allowed in the container), then MKV (accepts anything).
 */
export function muxAttempts(inputs: MuxInputs, output: OutputFormat, audioOnly: boolean, outBase: string): Attempt[] {
  const mk = (ext: string, body: string[]): Attempt => ({ ext, out: `${outBase}.${ext}`, args: ['-y', ...body, `${outBase}.${ext}`] });

  if (audioOnly) {
    const src = inputs.audio ?? inputs.video;
    if (!src) throw new Error('no input');
    if (output === 'mp3') return [mk('mp3', ['-i', src, '-vn', '-c:a', 'libmp3lame', '-q:a', '2'])];
    return [
      mk('m4a', ['-i', src, '-vn', '-c:a', 'copy']),
      mk('m4a', ['-i', src, '-vn', '-c:a', 'aac', '-b:a', '192k']),
    ];
  }

  if (!inputs.video) throw new Error('no video input');
  const ins = ['-i', inputs.video, ...(inputs.audio ? ['-i', inputs.audio] : [])];
  const maps = inputs.audio ? ['-map', '0:v:0', '-map', '1:a:0'] : ['-map', '0:v:0?', '-map', '0:a:0?'];
  if (output === 'mkv') return [mk('mkv', [...ins, ...maps, '-c', 'copy'])];
  const container = output === 'webm' ? 'webm' : 'mp4';
  // MP4 holds H.264, VP9 and AV1 video, and AAC or Opus audio: a plain copy covers them.
  const tag = container === 'mp4' ? ['-movflags', '+faststart'] : [];
  return [
    mk(container, [...ins, ...maps, '-c', 'copy', ...tag]),
    mk(container, [...ins, ...maps, '-c:v', 'copy', '-c:a', container === 'webm' ? 'libopus' : 'aac', '-b:a', '192k', ...tag]),
    mk('mkv', [...ins, ...maps, '-c', 'copy']),
  ];
}
