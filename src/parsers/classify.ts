import { extOf, hasRangeParams } from './url';

export type ResourceKind = 'hls' | 'dash' | 'file';

export interface ResourceInfo {
  url: string;
  contentType?: string;
  /** Content-Length of this response. */
  size?: number;
  /** Total size from Content-Range, when the response is partial. */
  totalSize?: number;
}

const HLS_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'];
const DASH_TYPES = ['application/dash+xml'];
const SEGMENT_TYPES = ['video/mp2t', 'video/iso.segment', 'audio/iso.segment'];
const SEGMENT_EXTS = ['ts', 'm4s', 'cmfv', 'cmfa', 'aac'];
const MEDIA_EXTS = ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv', 'mp3', 'm4a', 'ogg', 'oga', 'opus', 'wav', 'flac'];
const MIN_SIZE = 64 * 1024;

/** Decides whether a network response is a downloadable media resource. */
export function classify(info: ResourceInfo): ResourceKind | null {
  const { url } = info;
  if (!/^https?:/i.test(url)) return null;
  const ct = (info.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const ext = extOf(url);

  if (ext === 'm3u8' || HLS_TYPES.includes(ct)) return 'hls';
  if (ext === 'mpd' || DASH_TYPES.includes(ct)) return 'dash';

  if (SEGMENT_TYPES.includes(ct) || SEGMENT_EXTS.includes(ext)) return null;
  if (hasRangeParams(url)) return null;

  const isMediaType = (ct.startsWith('video/') || ct.startsWith('audio/')) && !ct.includes('mpegurl');
  const isMediaExt = MEDIA_EXTS.includes(ext);
  const knownNonMedia = ct !== '' && !isMediaType && ct !== 'application/octet-stream' && ct !== 'binary/octet-stream';
  if (!isMediaType && !(isMediaExt && !knownNonMedia)) return null;

  const effective = info.totalSize ?? info.size;
  if (effective && effective > 0 && effective < MIN_SIZE) return null;
  return 'file';
}

export function isAudioResource(url: string, contentType?: string): boolean {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.startsWith('audio/')) return true;
  if (ct.startsWith('video/')) return false;
  return ['mp3', 'm4a', 'oga', 'opus', 'wav', 'flac'].includes(extOf(url));
}
