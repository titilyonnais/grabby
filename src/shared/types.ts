import type { OutputFormat, Plan, VideoFormat } from './plan';

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
  /** Expected file size per output format, when the source tells us (YouTube). */
  sizes?: Partial<Record<VideoFormat, number>>;
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
  /** Every rendition URL a master references, even those merged out of `variants`. */
  related?: string[];
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
  /** Named by the page (metadata, link) but not seen playing: listed after what plays. */
  linked?: boolean | undefined;
  /** Containers offered for this video (none: saved as-is). */
  formats?: VideoFormat[];
  /** github build: YouTube video id, recorded by a hidden player. */
  ytId?: string;
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
  /** Direct downloads: source URL and extension, for the fetch fallback. */
  sourceUrl?: string;
  ext?: string;
  /** The browser download manager was refused; retried through an extension fetch. */
  viaFetch?: boolean;
  /** Capture jobs: where the <video> lives. */
  frameId?: number;
  videoIndex?: number;
  /** Container chosen for a video. */
  format?: OutputFormat;
  /** Recorded by a hidden player (YouTube), not the one the user watches. */
  hidden?: boolean;
  /** Capture jobs: the assembly plan, kept (and persisted) until the recording ends. */
  capturePlan?: Plan;
  /** The final file is an offscreen Blob URL that must be released once saved. */
  blob?: boolean;
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
