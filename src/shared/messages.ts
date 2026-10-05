import type { HistoryEntry, Job, JobMode, JobStatus, MediaItem } from './types';
import type { ErrorCode, OutputFormat, Plan, VideoFormat } from './plan';
import type { Settings } from './settings';

/** A <video> element found in a frame by the scanner. */
export interface PageVideo {
  index: number;
  src: string;
  duration: number;
  width: number;
  height: number;
  isMse: boolean;
  isProtected: boolean;
  poster?: string;
  muted?: boolean;
  loop?: boolean;
  autoplay?: boolean;
  controls?: boolean;
}

/** What the YouTube player says about the current video. */
export interface YtInfo {
  id: string;
  title: string;
  duration: number;
  embeddable: boolean;
  /** One entry per resolution, best first. `sizes` include the matching audio track. */
  qualities: { label: string; height: number; quality: string; avc: boolean; vp9: boolean; sizes: Partial<Record<VideoFormat, number>> }[];
}

export interface PageInfo {
  title: string;
  thumbnail?: string;
  videos: PageVideo[];
  /** A still of this frame's main player, for pages that offer no preview image. */
  snapshot?: string;
  /** Top frame: the biggest picture on screen, the very last fallback. */
  image?: string;
  /** HLS/DASH manifest URLs this frame has loaded (Performance API), a second detection path. */
  streams?: string[];
  /** Video URLs the page names without playing them: metadata, <source>, direct links. */
  declared?: string[];
  /** YouTube player metadata. */
  youtube?: { id: string; title: string; thumbnail?: string; duration?: number; player?: YtInfo };
}

/* ---------- content script → service worker ---------- */
export type ContentToBg =
  | { type: 'page-info'; info: PageInfo }
  | { type: 'drm'; keySystem: string }
  | { type: 'capture-progress'; jobId: string; progress: number; bytes: number }
  | { type: 'capture-done'; jobId: string; tracks: { track: number; mime: string }[]; keep?: number[] }
  | { type: 'capture-error'; jobId: string; error: ErrorCode }
  /** The "done" bubble's button. */
  | { type: 'show-download'; downloadId: number };

/* ---------- service worker → content script ---------- */
export type BgToContent =
  | { type: 'scan' }
  | { type: 'capture-start'; jobId: string; videoIndex: number }
  | { type: 'capture-stop'; jobId: string }
  /** Bubble in the page the user is looking at when a download ends. */
  | { type: 'toast'; ok: boolean; title: string; detail: string; action?: string; downloadId?: number };

/* ---------- popup ⇄ service worker (port "popup") ---------- */
export type BlockedReason = 'restricted';

export interface PopupState {
  tabId: number;
  pageUrl: string;
  blocked?: BlockedReason;
  items: MediaItem[];
  jobs: Job[];
  history: HistoryEntry[];
  settings: Settings;
  /** The browser asks where to save every file (its own setting, which wins over ours). */
  browserAsks?: boolean;
}

export type PopupToBg =
  | { type: 'subscribe'; tabId: number }
  | { type: 'download'; mediaId: string; variantId?: string; mode: JobMode; format?: OutputFormat; scale?: number }
  | { type: 'cancel'; jobId: string }
  /** Opens the browser's download settings ("ask where to save"). */
  | { type: 'open-browser-downloads' }
  | { type: 'finish-capture'; jobId: string }
  | { type: 'retry'; jobId: string }
  | { type: 'dismiss'; jobId: string }
  | { type: 'show'; downloadId: number }
  | { type: 'clear-history' }
  | { type: 'settings'; patch: Partial<Settings> };

export type BgToPopup = { type: 'state'; state: PopupState };

/* ---------- service worker ⇄ offscreen ---------- */
export type BgToOffscreen =
  | { target: 'offscreen'; type: 'run'; jobId: string; plan: Plan }
  | { target: 'offscreen'; type: 'cancel'; jobId: string }
  | { target: 'offscreen'; type: 'release'; jobId: string }
  /** Plays a YouTube video in a hidden player, recorded by the page hook. */
  | { target: 'offscreen'; type: 'yt-start'; jobId: string; src: string }
  | { target: 'offscreen'; type: 'yt-stop'; jobId: string }
  | { target: 'offscreen'; type: 'ping' };

export type OffscreenToBg =
  | {
      target: 'bg';
      type: 'job-progress';
      jobId: string;
      status: JobStatus;
      progress: number;
      bytes: number;
      speed: number;
    }
  | { target: 'bg'; type: 'job-ready'; jobId: string; blobUrl: string; ext: OutputFormat; size: number }
  | { target: 'bg'; type: 'job-error'; jobId: string; error: ErrorCode }
  /** capture-sink → SW: may this job write capture chunks? */
  | { target: 'bg'; type: 'sink-check'; jobId: string };
