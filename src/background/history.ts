import type { HistoryEntry } from '../shared/types';

const KEY = 'history';
const MAX = 50;

export async function getHistory(): Promise<HistoryEntry[]> {
  return ((await chrome.storage.local.get(KEY))[KEY] as HistoryEntry[] | undefined) ?? [];
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  const list = [entry, ...(await getHistory()).filter((e) => e.id !== entry.id)].slice(0, MAX);
  await chrome.storage.local.set({ [KEY]: list });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
