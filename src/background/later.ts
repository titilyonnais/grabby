import { hostOf } from '../parsers/url';
import { withLater, type LaterItem } from '../shared/later';
import type { Batch } from './batch';

export type { LaterItem };

const KEY = 'later';
const AT_KEY = 'laterAt';
export const LATER_ALARM = 'grabby-later';

export async function getLater(): Promise<LaterItem[]> {
  return ((await chrome.storage.local.get(KEY))[KEY] as LaterItem[] | undefined) ?? [];
}

/** When the list is downloaded by itself (none: when asked). */
export async function laterAt(): Promise<number | undefined> {
  const at = (await chrome.storage.local.get(AT_KEY))[AT_KEY] as number | undefined;
  return typeof at === 'number' && at > Date.now() - 60_000 ? at : undefined;
}

export async function addLater(item: Omit<LaterItem, 'id' | 'added'>): Promise<void> {
  if (!/^https?:\/\//i.test(item.url)) return;
  const thumb = item.thumbnail && /^https:\/\//i.test(item.thumbnail) && item.thumbnail.length < 2000 ? item.thumbnail : undefined;
  const { thumbnail: _t, ...rest } = item;
  await chrome.storage.local.set({ [KEY]: withLater(await getLater(), { ...rest, ...(thumb ? { thumbnail: thumb } : {}), title: item.title || hostOf(item.url) }) });
}

export async function removeLater(id: string): Promise<void> {
  await chrome.storage.local.set({ [KEY]: (await getLater()).filter((l) => l.id !== id) });
}

/** The list (or some of it) handed to the pasted-addresses queue: opened behind, two at a time. */
export async function launchLater(batch: Batch, ids?: string[]): Promise<number> {
  const list = await getLater();
  const go = ids ? list.filter((l) => ids.includes(l.id)) : list;
  if (!go.length) return 0;
  for (const mode of ['auto', 'video', 'audio'] as const) {
    const urls = go.filter((l) => l.mode === mode).map((l) => l.url);
    if (urls.length) await batch.add(urls.join('\n'), mode);
  }
  await chrome.storage.local.set({ [KEY]: list.filter((l) => !go.includes(l)) });
  if (!ids || !list.some((l) => !go.includes(l))) await scheduleLater(undefined);
  return go.length;
}

export async function scheduleLater(at: number | undefined): Promise<void> {
  if (at === undefined) {
    await chrome.storage.local.remove(AT_KEY);
    await chrome.alarms.clear(LATER_ALARM);
    return;
  }
  await chrome.storage.local.set({ [AT_KEY]: at });
  await chrome.alarms.create(LATER_ALARM, { when: at });
}
