import type { AudioFormat, VideoFormat } from './plan';

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  videoFormat: VideoFormat;
  audioFormat: AudioFormat;
  /** System notification when a download finishes. */
  notify: boolean;
  saveAs: boolean;
  subfolder: boolean;
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
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  videoFormat: 'mp4',
  audioFormat: 'm4a',
  notify: true,
  saveAs: false,
  subfolder: false,
  template: '{title}',
  firstRunAck: false,
  scheduleOn: false,
  scheduleFrom: 22 * 60,
  scheduleTo: 7 * 60,
  wifiOnly: false,
  rateLimit: 0,
  updateCheck: false,
};

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...((res[KEY] as Partial<Settings>) ?? {}) };
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
