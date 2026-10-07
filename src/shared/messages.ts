import type { HistoryEntry, Job, JobMode, JobStatus, JobStep, MediaItem } from './types';
import type { Chapter, Clip, ErrorCode, OutputFormat, Plan, SubsChoice, VideoFormat } from './plan';
import type { Release } from './release';
import type { YtList } from './ytlist';
import type { Finish } from './finish';

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
  /** A folder of the downloads folder chosen by a rule ("Musique"). */
  folder?: string;
  /** What is done to the file once it is made: edits, compression, one file per chapter. */
  finish?: Finish;
  /** A live stream: recorded until stopped (or this many minutes). */
  live?: number;
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
  /** A live stream (recorded from the page's player). */
  live?: boolean;
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
  | { type: 'show-download'; downloadId: number }
  /** The button over a video: `src`, the video's address when it has one. */
  | { type: 'grab'; src?: string; mode?: 'video' | 'audio'; variantId?: string }
  /** « Photo »: the picture on screen, read by the page (`dataUrl`) or to be cut from a screenshot (`rect`, CSS pixels). */
  | { type: 'snap'; dataUrl?: string; rect?: { x: number; y: number; w: number; h: number }; dpr?: number; time?: number; noFrame?: boolean }
  /** YouTube's buttons under the player: the downloads of this video, to show their progress. */
  | { type: 'page-jobs' }
  /** YouTube's menu under the player: the qualities of the video on screen (answered with PageMedia | null). */
  | { type: 'page-media' }
  /** « Plus d'options » in that menu: Grabby's window, opened on this page. */
  | { type: 'open-grabby' };

/** The video on screen as YouTube's menu under the player shows it. */
export interface PageMedia {
  title: string;
  /** Best first; `bytes`: the expected size in the user's video format. */
  qualities: { id: string; label: string; bytes?: number }[];
  format: string;
  audioFormat: string;
}

/* ---------- service worker → content script ---------- */
export type BgToContent =
  | { type: 'scan' }
  /** « Capture instantanée »: a photo of the video on screen (the keyboard shortcut). */
  | { type: 'photo' }
  /** `session`: which recording session of the job (0 first); `from`: where it starts again. */
  | { type: 'capture-start'; jobId: string; videoIndex: number; clip?: Clip; session?: number; from?: number; live?: boolean }
  /** "Aperçu": the page's own player plays the part chosen. */
  | { type: 'preview'; videoIndex: number; start: number; end?: number }
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
  | { type: 'dismiss'; jobId: string }
  | { type: 'show'; downloadId: number }
  | { type: 'open-file'; downloadId: number }
  | { type: 'open-shortcuts' }
  | { type: 'redo'; id: string }
  | { type: 'clear-history' }
  /** Taken out of the library; `restore`: « Annuler », put back. */
  | { type: 'history-remove'; ids: string[] }
  | { type: 'history-restore'; entries: HistoryEntry[] }
  | { type: 'history-mark'; ids: string[]; patch: { fav?: boolean; tags?: string[]; addTag?: string; removeTag?: string } }
  | { type: 'settings'; patch: Partial<Settings> };

export type BgToPopup = { type: 'state'; state: PopupState };

/* ---------- service worker ⇄ offscreen ---------- */
export type BgToOffscreen =
  /** `verify`: the file is read again once made (see verify.ts). */
  | { target: 'offscreen'; type: 'run'; jobId: string; plan: Plan; rate?: number; verify?: boolean }
  /** The speed limit changed (bytes per second, 0: none). */
  | { target: 'offscreen'; type: 'rate'; rate: number }
  | { target: 'offscreen'; type: 'cancel'; jobId: string }
  /** A live stream: stop reading its playlist and make the file from what was fetched. */
  | { target: 'offscreen'; type: 'live-stop'; jobId: string }
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
      /** What is being done to the file (editor, size, chapters), once it is made. */
      step?: JobStep;
    }
  | {
      target: 'bg';
      type: 'job-ready';
      jobId: string;
      blobUrl: string;
      ext: OutputFormat;
      size: number;
      /** .srt files to save next to it. */
      subtitles?: { srt: string; lang?: string }[];
      /** One file per chapter: the first one is `blobUrl` (named `name`), these are the others. */
      pieces?: { blobUrl: string; name: string }[];
      name?: string;
    }
  | { target: 'bg'; type: 'job-error'; jobId: string; error: ErrorCode }
  | { target: 'bg'; type: 'job-paused'; jobId: string }
  /** capture-sink → SW: may this job write capture chunks? */
  | { target: 'bg'; type: 'sink-check'; jobId: string; probe?: string };
