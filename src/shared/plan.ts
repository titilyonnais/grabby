/** A byte range is inclusive: [start, end]. */
export interface SegRef {
  url: string;
  range?: [number, number];
  /** How long it plays, in seconds, when the manifest tells (to fetch only part of a video). */
  dur?: number;
}

/** A part of the video to keep, in seconds from its start. */
export interface Clip {
  start: number;
  end: number;
}

/** `vtt`: subtitles as text files (WebVTT, SubRip or TTML, told apart by their content). */
export type Container = 'ts' | 'fmp4' | 'file' | 'webm' | 'vtt';
/** Containers the user can pick for a video. */
export type VideoFormat = 'mp4' | 'mkv' | 'webm' | 'mov' | 'avi' | 'ts';
/** Audio-only outputs. */
export type AudioFormat = 'm4a' | 'mp3' | 'opus' | 'ogg' | 'flac' | 'wav';
/** Pictures made from the video: a still (JPEG) or a short animation (GIF, WebP). */
export type ImageFormat = 'jpg' | 'gif' | 'webp';
export type OutputFormat = VideoFormat | AudioFormat | ImageFormat;

/** A chapter of a video: where it starts (seconds) and its name. */
export interface Chapter {
  start: number;
  title: string;
}

/** Subtitles loaded by the recorded player itself (YouTube): which ones. */
export interface CapturedCaption {
  lang: string;
  /** Made by speech recognition. */
  auto?: boolean;
  /** Translated by YouTube into this language. */
  tlang?: string;
}

/** One subtitle track of a plan. */
export interface PlanSubs {
  track: TrackPlan;
  clock?: import('./subtitles').SubsClock;
  label: string;
  lang?: string;
  separate: boolean;
  /** Loaded by the recorded player itself (YouTube). */
  captured?: CapturedCaption;
}

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
  /**
   * Keep only part of the video: how long, and where it starts in what each track fetched
   * (only the segments it covers are fetched, so each track starts a little before it).
   */
  clip?: { start: number; duration: number; video?: number; audio?: number; /** Set when assembling: the copied picture starts this much earlier (its keyframe). */ lead?: number; /** Where it starts in each of the other sound tracks. */ audios?: number[] };
  /**
   * Subtitles (fetched as more tracks): put in the video, or saved next to it as .srt files
   * (always, when the video can't hold them or isn't assembled). A single object in plans
   * saved by 1.7: read them with `planSubs`.
   */
  subtitles?: PlanSubs[];
  /** More sound tracks (other languages), after the main one. */
  audios?: { track: TrackPlan; label: string; lang?: string }[];
  /** The main sound track's language and name, when the stream says. */
  audioInfo?: { lang?: string; label?: string };
  /** Chapters, on the video's clock. */
  chapters?: Chapter[];
  /** What the file says it is: its title, who made it, a picture for a sound file's cover. */
  meta?: { title?: string; artist?: string; cover?: string };
  /** Several parts joined in one file, on the video's clock (`clip` then covers them all). */
  parts?: Clip[];
  /** A picture: a still at `at` seconds (JPEG), or an animation of the part (GIF, WebP). */
  image?: { at?: number };
}

/** The subtitle tracks of a plan (one object in plans saved before several were possible). */
export function planSubs(plan: Pick<Plan, 'subtitles'> | undefined): PlanSubs[] {
  const s = plan?.subtitles as PlanSubs[] | PlanSubs | undefined;
  return !s ? [] : Array.isArray(s) ? s : [s];
}

/** The user's subtitle choice: which tracks, and as separate files or not. */
export interface SubsChoice {
  ids: string[];
  separate: boolean;
  /** Before 1.8: a single track. */
  id?: string;
}

/** The tracks of a subtitle choice (also one made before several were possible). */
export function subsIds(c: SubsChoice | undefined): string[] {
  if (!c) return [];
  return c.ids?.length ? c.ids : c.id ? [c.id] : [];
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
