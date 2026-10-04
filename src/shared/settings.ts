import type { VideoFormat } from './plan';

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  videoFormat: VideoFormat;
  audioFormat: 'm4a' | 'mp3';
  /** System notification when a download finishes. */
  notify: boolean;
  saveAs: boolean;
  subfolder: boolean;
  template: string;
  firstRunAck: boolean;
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
};

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...((res[KEY] as Partial<Settings>) ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
