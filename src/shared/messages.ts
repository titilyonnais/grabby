import type { HistoryEntry, Job, JobMode, JobStatus, MediaItem } from './types';
import type { ErrorCode, OutputFormat, Plan } from './plan';
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
}

export interface PageInfo {
  title: string;
  thumbnail?: string;
  videos: PageVideo[];
  /** github build only: YouTube player metadata. */
  youtube?: { title: string; thumbnail?: string; duration?: number };
}

/* ---------- content script → service worker ---------- */
export type ContentToBg =
  | { type: 'page-info'; info: PageInfo }
  | { type: 'drm'; keySystem: string }
  | { type: 'capture-progress'; jobId: string; progress: number; bytes: number }
  | { type: 'capture-done'; jobId: string; tracks: { track: number; mime: string }[] }
  | { type: 'capture-error'; jobId: string; error: ErrorCode };

/* ---------- service worker → content script ---------- */
export type BgToContent =
  | { type: 'scan' }
  | { type: 'capture-start'; jobId: string; videoIndex: number }
  | { type: 'capture-stop'; jobId: string };

/* ---------- popup ⇄ service worker (port "popup") ---------- */
export type BlockedReason = 'youtube' | 'restricted';

export interface PopupState {
  tabId: number;
  pageUrl: string;
  blocked?: BlockedReason;
  items: MediaItem[];
  jobs: Job[];
  history: HistoryEntry[];
  settings: Settings;
}

export type PopupToBg =
  | { type: 'subscribe'; tabId: number }
  | { type: 'download'; mediaId: string; variantId?: string; mode: JobMode }
  | { type: 'cancel'; jobId: string }
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
