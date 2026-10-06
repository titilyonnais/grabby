import type { AudioFormat, VideoFormat } from './plan';
import type { FolderMode } from './filename';
import type { Rule } from './rules';

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  videoFormat: VideoFormat;
  audioFormat: AudioFormat;
  /** System notification when a download finishes. */
  notify: boolean;
  saveAs: boolean;
  /** Before 1.9: files in a "Grabby" folder. Read once into `folder`. */
  subfolder?: boolean;
  /** Where files go in the downloads folder. */
  folder: FolderMode;
  template: string;
  firstRunAck: boolean;
  /** Downloads start only between these times (minutes since midnight). */
  scheduleOn: boolean;
  scheduleFrom: number;
  scheduleTo: number;
  /** Wait for Wi-Fi (only where the browser tells the connection type). */
  wifiOnly: boolean;
  /** Bytes per second for everything Grabby fetches; 0: no limit. */
  rateLimit: number;
  /** Once a day, ask GitHub whether a newer version is out. */
  updateCheck: boolean;
  /** What the keyboard shortcut and the right-click menu download: the video, or its sound only. */
  quickMode: 'video' | 'audio';
  /** Sound files: the loudness evened out (every file as loud as the others). */
  normalize: boolean;
  /** YouTube: the parts marked as sponsored (SponsorBlock) left out of the file. */
  skipSponsors: boolean;
  /** Automatic choices per site (see rules.ts). */
  rules: Rule[];
  /** A Grabby button over the videos of the pages. */
  overlayButton: boolean;
  /** The user agreed to download the local AI's models (transcription, translation). */
  aiModels: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  videoFormat: 'mp4',
  audioFormat: 'm4a',
  notify: true,
  saveAs: false,
  folder: 'none',
  template: '{title}',
  firstRunAck: false,
  scheduleOn: false,
  scheduleFrom: 22 * 60,
  scheduleTo: 7 * 60,
  wifiOnly: false,
  rateLimit: 0,
  updateCheck: false,
  quickMode: 'video',
  normalize: false,
  skipSponsors: false,
  rules: [],
  overlayButton: true,
  aiModels: false,
};

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(KEY);
  const stored = (res[KEY] as Partial<Settings>) ?? {};
  // Set before 1.9 as "in a Grabby folder".
  const folder = stored.folder ?? (stored.subfolder ? 'grabby' : 'none');
  return { ...DEFAULT_SETTINGS, ...stored, folder, rules: Array.isArray(stored.rules) ? stored.rules : [] };
}

let writing: Promise<unknown> = Promise.resolve();

/** Changes some settings. One write at a time: two quick changes can't undo each other. */
export function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const done = writing.then(async () => {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
  writing = done.catch(() => undefined);
  return done;
}
