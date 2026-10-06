import type { Finish } from './finish';
import type { Chapter, Clip, OutputFormat, Plan, SubsChoice, VideoFormat } from './plan';
import type { Hold } from './schedule';
import type { YtEntry } from './ytlist';

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
  /** Size of this quality's file, when known (files offered in several qualities). */
  size?: number;
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

/** Subtitles a stream offers (WebVTT). */
export interface SubtitleTrack {
  id: string;
  label: string;
  lang?: string;
  /** HLS: its playlist. DASH: the manifest (the track is its representation `id`). */
  url: string;
  isDefault?: boolean;
  forced?: boolean;
  /** Made by speech recognition (YouTube). */
  auto?: boolean;
  /** Translated by YouTube into this language (from the track in `lang`). */
  tlang?: string;
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
  /** Subtitles that can be saved with the video. */
  subtitles?: SubtitleTrack[];
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
  /** True when the item comes from the experimental YouTube feature. */
  experimental?: boolean;
  /** Named by the page (metadata, link) but not seen playing: listed after what plays. */
  linked?: boolean | undefined;
  /** Containers offered for this video (none: saved as-is). */
  formats?: VideoFormat[];
  /** YouTube video id, recorded by a hidden player. */
  ytId?: string;
  /** Who made it (a YouTube channel): written in the file. */
  author?: string;
  /** Its chapters (YouTube, a page's <track kind="chapters">). */
  chapters?: Chapter[];
  /** A video of a YouTube playlist or channel (not the one on screen). */
  fromList?: YtEntry;
}

export type JobStatus =
  | 'queued'
  | 'downloading'
  | 'capturing'
  | 'processing'
  | 'saving'
  /** Stopped with what it has kept: by the user, or waiting for the network to come back. */
  | 'paused'
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
  /** 0–1 over the whole job (download, then assembly), never going back. */
  progress: number;
  bytes: number;
  /** Bytes per second, smoothed. */
  speed: number;
  /** Expected size of the download, when known. */
  total?: number;
  /** `total` is an estimate (stream bitrate, YouTube's figure), not the server's. */
  totalApprox?: boolean;
  filename: string;
  title: string;
  pageUrl: string;
  quality?: string;
  /** The channel or author, when the site tells it (file names). */
  author?: string;
  /** YouTube: sponsored parts left out of the file (SponsorBlock). */
  sponsors?: number;
  /** Its place in the queue, when the user moved it (otherwise when it was asked for). */
  order?: number;
  /** A contact sheet: a picture every so many seconds (0: chosen from the video's length). */
  sheet?: number;
  /** A folder of the downloads folder chosen by a rule (instead of the settings'). */
  folder?: string;
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
  /** A smaller quality made by shrinking the picture (e.g. 360 for 360p). */
  scale?: number;
  /** Only this part of the video is kept. */
  clip?: Clip;
  /** Several parts joined in one file (`clip` is unset then). */
  parts?: Clip[];
  /** Sound tracks chosen (`audioChoices` ids), the main one first. */
  audios?: string[];
  /** The video's chapters are left out. */
  noChapters?: boolean;
  /** A still picture: where in the video. */
  at?: number;
  /** Subtitles saved with the video. */
  subtitles?: SubsChoice;
  /** Recorded by a hidden player (YouTube), not the one the user watches. */
  hidden?: boolean;
  /** Capture jobs: the assembly plan, kept (and persisted) until the recording ends. */
  capturePlan?: Plan;
  /** The final file is an offscreen Blob URL that must be released once saved. */
  blob?: boolean;
  /**
   * Why a paused job is paused: the user, a lost connection, the browser restarting, or (a
   * recording) its page was closed.
   */
  pausedBy?: 'user' | 'network' | 'restart' | 'page';
  /** Recordings: which session is recording (each pause ends one, the resume starts the next). */
  session?: number;
  /** Recordings: where in the video the recording has got to, in seconds. */
  captureAt?: number;
  /** Recordings: how long the video is (where a recording without a part ends). */
  duration?: number;
  /** Recordings by a hidden player (YouTube): the tracks of the video itself, not the ads. */
  keepTracks?: number[];
  /** YouTube: the video, and the codecs of the chosen quality (for a hidden player to carry on). */
  ytId?: string;
  ytCodecs?: string;
  /** A tab Grabby opened itself to carry on a recording (closed when it is done). */
  openedTab?: number;
  /** Recordings: bytes stored by the sessions before the current one. */
  bytesBefore?: number;
  /** A job waiting for the network: when it tries again on its own. */
  retryAt?: number;
  /** Tries in a row that failed for the network (reset when data comes in). */
  attempts?: number;
  /** Its links were renewed once already after they stopped working. */
  replanned?: boolean;
  /** Taken up again after a pause: links that fail now may just have expired. */
  resumed?: boolean;
  /** Started at least once (a job that never did waits for the time window or Wi-Fi). */
  begun?: boolean;
  /** Waiting to start: outside the time window chosen, or for Wi-Fi. */
  held?: Hold;
  /** "Start now": the user didn't want to wait for the window. */
  startNow?: boolean;
  /** A video of a YouTube playlist or channel: enough to find it again. */
  entry?: YtEntry;
  /** What is done to the file once it is made (editor, size, AI). */
  finish?: Finish;
  /** A live stream recorded until stopped: at most this many minutes. */
  live?: number;
  /** A live stream: when its recording started. */
  liveSince?: number;
  /** What is being done to the file once it is made. */
  step?: JobStep;
}

/** The steps after a file is made: the model downloaded, subtitles written or translated… */
export type JobStep = 'model' | 'transcribe' | 'translate' | 'summary' | 'encode' | 'split';

export interface HistoryEntry {
  id: string;
  filename: string;
  title: string;
  pageUrl: string;
  size: number;
  date: number;
  downloadId?: number;
  /** The video's picture, when the page had one (small enough to keep). */
  thumbnail?: string;
  /** "1080p", "360p"… */
  quality?: string;
  /** What was asked for, to download it again the same way. */
  mode?: JobMode;
  format?: OutputFormat;
  /** Set when the state is built: the file was moved, deleted or erased from the browser's list. */
  missing?: boolean;
}
