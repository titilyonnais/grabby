import type { AudioFormat, OutputFormat, VideoFormat } from './plan';

/** Containers offered for a video, most compatible first. */
export const VIDEO_FORMATS: VideoFormat[] = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'ts'];
/** Audio-only outputs: copied when the source codec fits, encoded otherwise. */
export const AUDIO_FORMATS: AudioFormat[] = ['m4a', 'mp3', 'opus', 'ogg', 'flac', 'wav'];

export const FORMAT_NAMES: Record<OutputFormat, string> = {
  mp4: 'MP4',
  mkv: 'MKV',
  webm: 'WebM',
  mov: 'MOV',
  avi: 'AVI',
  ts: 'TS',
  m4a: 'M4A',
  mp3: 'MP3',
  opus: 'Opus',
  ogg: 'OGG',
  flac: 'FLAC',
  wav: 'WAV',
};

export const isAudioFormat = (f: string | undefined): f is AudioFormat => !!f && (AUDIO_FORMATS as string[]).includes(f);
export const isVideoFormat = (f: string | undefined): f is VideoFormat => !!f && (VIDEO_FORMATS as string[]).includes(f);

/**
 * Containers a video can be saved in without re-encoding its picture (re-encoding in the
 * browser would take far too long). VP9/AV1 fit MP4, WebM and MKV; H.264/HEVC fit all but WebM.
 */
export function videoFormatsFor(codecs = ''): VideoFormat[] {
  const c = codecs.toLowerCase();
  const web = /vp0?8|vp0?9|av01/.test(c);
  const classic = /avc|hvc|hev|h264|mp4v/.test(c);
  if (web && !classic) return ['mp4', 'webm', 'mkv'];
  return ['mp4', 'mkv', 'mov', 'avi', 'ts'];
}

const BY_MIME: Record<string, OutputFormat> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'video/mp2t': 'ts',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};
const BY_EXT: Record<string, OutputFormat> = { m4v: 'mp4', oga: 'ogg' };

/** The format a direct file already has (from its extension, else its MIME type). */
export function sourceFormat(ext: string, mime?: string): OutputFormat | undefined {
  const e = ext.toLowerCase();
  if (isVideoFormat(e) || isAudioFormat(e)) return e;
  if (BY_EXT[e]) return BY_EXT[e];
  return mime ? BY_MIME[mime.split(';')[0]!.trim().toLowerCase()] : undefined;
}
