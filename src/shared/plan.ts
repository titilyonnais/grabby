/** A byte range is inclusive: [start, end]. */
export interface SegRef {
  url: string;
  range?: [number, number];
}

export type Container = 'ts' | 'fmp4' | 'file' | 'webm';
export type OutputFormat = 'mp4' | 'm4a' | 'mp3' | 'webm' | 'ts';

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
  /** Extract audio only. */
  audioOnly: boolean;
  estimatedSize?: number;
  pageUrl: string;
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
  | 'unknown';
