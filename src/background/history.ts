import type { HistoryEntry } from '../shared/types';

const KEY = 'history';
const MAX = 50;
/** Thumbnails kept in the history: page URLs or small stills, not big data: URLs. */
const MAX_THUMB = 120_000;
/** How long a "is the file still there?" answer is reused (state is rebuilt several times a second). */
const PRESENCE_MS = 5000;

export async function getHistory(): Promise<HistoryEntry[]> {
  return ((await chrome.storage.local.get(KEY))[KEY] as HistoryEntry[] | undefined) ?? [];
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  const { thumbnail, ...rest } = entry;
  const kept: HistoryEntry = thumbnail && thumbnail.length <= MAX_THUMB ? { ...rest, thumbnail } : rest;
  const list = [kept, ...(await getHistory()).filter((e) => e.id !== entry.id)].slice(0, MAX);
  await chrome.storage.local.set({ [KEY]: list });
  presence = null;
}

export async function removeHistory(id: string): Promise<void> {
  await chrome.storage.local.set({ [KEY]: (await getHistory()).filter((e) => e.id !== id) });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

let presence: { at: number; missing: Set<number> } | null = null;

/** The history, each entry marked when its file can no longer be shown in its folder. */
export async function historyWithPresence(): Promise<HistoryEntry[]> {
  const list = await getHistory();
  if (!presence || Date.now() - presence.at > PRESENCE_MS) {
    const missing = new Set<number>();
    await Promise.all(
      list.map(async (e) => {
        if (e.downloadId === undefined) return;
        const [d] = await chrome.downloads.search({ id: e.downloadId }).catch(() => []);
        if (!d || d.exists === false || d.state !== 'complete') missing.add(e.downloadId);
      }),
    );
    presence = { at: Date.now(), missing };
  }
  const gone = presence.missing;
  return list.map((e) => (e.downloadId !== undefined && gone.has(e.downloadId) ? { ...e, missing: true } : e));
}
