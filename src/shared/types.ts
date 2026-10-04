export type MediaKind = 'file' | 'hls' | 'dash' | 'capture';
export type Protection = 'none' | 'drm' | 'encrypted';

export interface Variant {
  id: string;
  label: string;
  width?: number;
  height?: number;
  bandwidth?: number;
  codecs?: string;
  url: string;
  audioGroup?: string;
}

export interface AudioTrack {
  id: string;
  label: string;
  lang?: string;
  url: string;
  bandwidth?: number;
  groupId?: string;
  isDefault?: boolean;
}

export interface MediaItem {
  id: string;
  tabId: number;
  frameUrl: string;
  pageUrl: string;
  kind: MediaKind;
  url: string;
  mime?: string;
  title: string;
  thumbnail?: string;
  duration?: number;
  size?: number;
  variants: Variant[];
  audioTracks: AudioTrack[];
  protection: Protection;
  live: boolean;
  detectedAt: number;
  /** Capture items: index of the <video> element within its frame. */
  videoIndex?: number;
  /** Capture items: frame id inside the tab. */
  frameId?: number;
  /** True for audio-only resources (mp3, m4a, audio/*). */
  audioOnly?: boolean;
  /** True when the item comes from the experimental YouTube feature (github build). */
  experimental?: boolean;
}

export type JobStatus =
  | 'queued'
  | 'downloading'
  | 'capturing'
  | 'processing'
  | 'saving'
  | 'done'
  | 'error'
  | 'canceled';

export type JobMode = 'video' | 'audio';

export interface Job {
  id: string;
  tabId: number;
  mediaId: string;
  variantId?: string;
  mode: JobMode;
  status: JobStatus;
  progress: number;
  bytes: number;
  speed: number;
  filename: string;
  title: string;
  pageUrl: string;
  quality?: string;
  kind: MediaKind;
  error?: string;
  raw?: boolean;
  startedAt: number;
  downloadId?: number;
  /** Capture jobs: where the <video> lives. */
  frameId?: number;
  videoIndex?: number;
}

export interface HistoryEntry {
  id: string;
  filename: string;
  title: string;
  pageUrl: string;
  size: number;
  date: number;
  downloadId?: number;
}
