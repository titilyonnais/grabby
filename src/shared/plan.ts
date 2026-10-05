/** A byte range is inclusive: [start, end]. */
export interface SegRef {
  url: string;
  range?: [number, number];
}

export type Container = 'ts' | 'fmp4' | 'file' | 'webm';
/** Containers the user can pick for a video. */
export type VideoFormat = 'mp4' | 'mkv' | 'webm' | 'mov' | 'avi' | 'ts';
/** Audio-only outputs. */
export type AudioFormat = 'm4a' | 'mp3' | 'opus' | 'ogg' | 'flac' | 'wav';
export type OutputFormat = VideoFormat | AudioFormat;

export interface TrackPlan {
  init?: SegRef;
  segments: SegRef[];
  container: Container;
  codecs?: string;
}

export interface Plan {
  kind: 'stream' | 'file' | 'capture';
  video?: TrackPlan;
  audio?: TrackPlan;
  output: OutputFormat;
  /** Skip ffmpeg and save the concatenated stream as-is (huge files). */
  raw: boolean;
  /** A file already in the requested format: the browser downloads it as is. */
  direct?: boolean;
  /**
   * A big file saved as is, fetched by Grabby in several ranges at once (much faster than one
   * connection) and resumable; falls back to the browser's download if the server can't.
   */
  fast?: boolean;
  /** Extract audio only. */
  audioOnly: boolean;
  estimatedSize?: number;
  pageUrl: string;
  /** Shrink the picture to fit this box (re-encoded in H.264): a quality the source lacks. */
  scale?: { w: number; h: number };
  /** Capture: recorded tracks that belong to the video (others are ads or abandoned players). */
  keepTracks?: number[];
}

export const RAW_THRESHOLD = 1.5e9;

export type ErrorCode =
  | 'http_403'
  | 'http_404'
  | 'http_other'
  | 'network'
  | 'ffmpeg'
  | 'protected'
  | 'live'
  | 'too_large'
  | 'capture_failed'
  | 'capture_unavailable'
  | 'canceled'
  /** A paused download's links no longer work and the page isn't open to find new ones. */
  | 'expired'
  /** Internal: the server can't send ranges (a fast download goes back to the browser's). */
  | 'no_ranges'
  | 'unknown';
