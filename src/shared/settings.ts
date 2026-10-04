export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  audioFormat: 'm4a' | 'mp3';
  saveAs: boolean;
  subfolder: boolean;
  template: string;
  firstRunAck: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  audioFormat: 'm4a',
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
