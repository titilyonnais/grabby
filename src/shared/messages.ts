import type { HistoryEntry, Job, JobMode, JobStatus, MediaItem } from './types';
import type { Chapter, Clip, ErrorCode, OutputFormat, Plan, SubsChoice, VideoFormat } from './plan';
import type { Release } from './release';
import type { YtList } from './ytlist';

/** What a download asks for besides the quality and the format. */
export interface DownloadExtra {
  /** A smaller quality made by shrinking the picture (e.g. 360 for 360p). */
  scale?: number;
  /** Only this part of the video. */
  clip?: Clip;
  /** Several parts joined in one file. */
  parts?: Clip[];
  subtitles?: SubsChoice;
  /** Sound tracks (other languages), the main one first. */
  audios?: string[];
  /** Leave the chapters out. */
  noChapters?: boolean;
  /** A still picture: where in the video. */
  at?: number;
  /** A contact sheet (JPEG): a picture every so many seconds (0: chosen from its length). */
  sheet?: number;
}
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
  /** Its subtitle files (<track kind="subtitles|captions" src>). */
  tracks?: { src: string; lang?: string; label?: string; isDefault?: boolean }[];
  /** Its chapters (<track kind="chapters">, once the browser has read it). */
  chapters?: Chapter[];
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
  /** Its subtitles: the player's own list (`auto`: made by speech recognition). */
  captions?: { url: string; lang: string; name: string; auto: boolean }[];
  /** Languages YouTube can translate its subtitles into. */
  translations?: string[];
  /** Their names, as YouTube writes them (code → name). */
  translationNames?: Record<string, string>;
  /** Its channel. */
  author?: string;
  /** Chapters its description lists. */
  chapters?: Chapter[];
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
  /** A YouTube playlist or channel: the videos it lists. */
  ytList?: YtList;
}

/* ---------- content script → service worker ---------- */
export type ContentToBg =
  | { type: 'page-info'; info: PageInfo }
  | { type: 'drm'; keySystem: string }
  /** `time`: where the recording is in the video; `keep`: the tracks of the video itself (YouTube). */
  | { type: 'capture-progress'; jobId: string; progress: number; bytes: number; time?: number; keep?: number[] }
  | { type: 'capture-done'; jobId: string; tracks: { track: number; mime: string }[]; keep?: number[] }
  | { type: 'capture-error'; jobId: string; error: ErrorCode }
  /** The "done" bubble's button. */
  | { type: 'show-download'; downloadId: number };

/* ---------- service worker → content script ---------- */
export type BgToContent =
  | { type: 'scan' }
  /** `session`: which recording session of the job (0 first); `from`: where it starts again. */
  | { type: 'capture-start'; jobId: string; videoIndex: number; clip?: Clip; session?: number; from?: number }
  /** `hold`: paused, the recording stops without being finished. */
  | { type: 'capture-stop'; jobId: string; hold?: boolean }
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
  /** A newer Grabby is out (only when the user asked to be told). */
  update?: Release;
  /** Where installing a new version got to ("Update" clicked). */
  install?: InstallState;
  /** The YouTube playlist or channel on screen. */
  ytList?: YtList;
}

export type PopupToBg =
  | { type: 'subscribe'; tabId: number }
  | ({ type: 'download'; mediaId: string; variantId?: string; mode: JobMode; format?: OutputFormat } & DownloadExtra)
  /** Every video of the playlist (or channel) on screen, in this quality (none: the sound only). */
  | { type: 'download-list'; quality: string; mode: JobMode; format?: OutputFormat }
  | { type: 'cancel'; jobId: string }
  | { type: 'pause'; jobId: string }
  | { type: 'resume'; jobId: string }
  /** A waiting download moved in the queue: before `before`, or last. */
  | { type: 'reorder'; jobId: string; before?: string }
  | { type: 'pause-all' }
  /** The video's own picture (its thumbnail), at its best. */
  | { type: 'save-thumb'; mediaId: string }
  | { type: 'resume-all' }
  /** Opens the browser's download settings ("ask where to save"). */
  | { type: 'open-browser-downloads' }
  | { type: 'finish-capture'; jobId: string }
  | { type: 'retry'; jobId: string }
  /** A download waiting for its time window (or Wi-Fi) starts anyway. */
  | { type: 'start-now'; jobId: string }
  /** Hides the "new version" notice until the next one. */
  | { type: 'update-seen'; version: string }
  | { type: 'update-install' }
  | { type: 'dismiss'; jobId: string }
  | { type: 'show'; downloadId: number }
  | { type: 'open-file'; downloadId: number }
  | { type: 'open-shortcuts' }
  | { type: 'redo'; id: string }
  | { type: 'clear-history' }
  | { type: 'history-remove'; id: string }
  | { type: 'settings'; patch: Partial<Settings> };

export type BgToPopup = { type: 'state'; state: PopupState };

/* ---------- service worker ⇄ offscreen ---------- */
export type BgToOffscreen =
  | { target: 'offscreen'; type: 'run'; jobId: string; plan: Plan; rate?: number }
  /** The speed limit changed (bytes per second, 0: none). */
  | { target: 'offscreen'; type: 'rate'; rate: number }
  | { target: 'offscreen'; type: 'cancel'; jobId: string }
  /** Stops fetching, keeping what is stored. */
  | { target: 'offscreen'; type: 'pause'; jobId: string }
  | { target: 'offscreen'; type: 'release'; jobId: string }
  /** Plays a YouTube video in a hidden player, recorded by the page hook. */
  | { target: 'offscreen'; type: 'yt-start'; jobId: string; src: string }
  /** `hold`: paused; the player is left a moment so what it recorded last can be stored. */
  | { target: 'offscreen'; type: 'yt-stop'; jobId: string; hold?: boolean }
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
  | { target: 'bg'; type: 'job-ready'; jobId: string; blobUrl: string; ext: OutputFormat; size: number; /** .srt files to save next to it. */ subtitles?: { srt: string; lang?: string }[] }
  | { target: 'bg'; type: 'job-error'; jobId: string; error: ErrorCode }
  | { target: 'bg'; type: 'job-paused'; jobId: string }
  /** capture-sink → SW: may this job write capture chunks? */
  | { target: 'bg'; type: 'sink-check'; jobId: string };

/** Installing a new version through the update helper. */
export type InstallStep = 'working' | 'done' | 'uptodate' | 'helper_missing' | 'busy' | 'failed';
export interface InstallState {
  step: InstallStep;
  version?: string;
  /** failed: the helper's code (offline, bad_digest…). */
  error?: string;
}
