/**
 * Followed channels and playlists: once an hour Grabby reads their public feed and records
 * each new video with the hidden player, in the quality and format chosen when following.
 */
import { channelIdIn, feedUrl, newEntries, parseFeed, watchTarget, type FeedEntry, type Watch } from '../shared/feeds';
import { uid } from '../shared/ids';
import { LIST_QUALITIES } from '../shared/ytlist';
import type { JobManager } from './jobs';

export const WATCH_ALARM = 'grabby-watch';
const KEY = 'watches';
const MAX_WATCHES = 50;
/** Video ids remembered per feed (a feed shows 15). */
const MAX_SEEN = 300;


export type { Watch };
export type WatchAddError = 'bad_url' | 'not_found' | 'offline' | 'already' | 'too_many';

let lock: Promise<unknown> = Promise.resolve();
/** One change at a time: two checks can't write over each other. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn);
  lock = run.catch(() => undefined);
  return run;
}

export async function getWatches(): Promise<Watch[]> {
  return ((await chrome.storage.local.get(KEY))[KEY] as Watch[] | undefined) ?? [];
}

async function save(list: Watch[]) {
  await chrome.storage.local.set({ [KEY]: list });
  await syncWatchAlarm(list);
}

/** Checked every hour while something is followed. */
export async function syncWatchAlarm(list?: Watch[]) {
  list ??= await getWatches();
  if (list.length) {
    if (!(await chrome.alarms.get(WATCH_ALARM).catch(() => undefined))) await chrome.alarms.create(WATCH_ALARM, { periodInMinutes: 60, delayInMinutes: 60 });
  } else await chrome.alarms.clear(WATCH_ALARM).catch(() => false);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Follows the channel or playlist of an address; its videos published so far are skipped. */
export async function addWatch(url: string, choice: Pick<Watch, 'mode' | 'quality' | 'format'>): Promise<Watch | WatchAddError> {
  let target = watchTarget(url);
  if (!target) return 'bad_url';
  if ('page' in target) {
    const html = await fetchText(target.page);
    if (html === null) return 'offline';
    const id = channelIdIn(html);
    if (!id) return 'not_found';
    target = { kind: 'channel', key: id };
  }
  const { kind, key } = target;
  const xml = await fetchText(feedUrl(kind, key));
  const feed = xml === null ? null : parseFeed(xml);
  if (!feed) return 'not_found';
  return serial(async () => {
    const list = await getWatches();
    if (list.some((w) => w.kind === kind && w.key === key)) return 'already' as const;
    if (list.length >= MAX_WATCHES) return 'too_many' as const;
    const watch: Watch = {
      id: uid(),
      kind,
      key,
      title: feed.title || key,
      mode: choice.mode === 'audio' ? 'audio' : 'video',
      quality: LIST_QUALITIES.some((q) => q.id === choice.quality) ? choice.quality : LIST_QUALITIES[0].id,
      ...(choice.format ? { format: choice.format } : {}),
      since: Date.now(),
      seen: feed.entries.map((e) => e.id),
      lastCheck: Date.now(),
      got: 0,
    };
    await save([...list, watch]);
    return watch;
  });
}

export function removeWatch(id: string): Promise<void> {
  return serial(async () => save((await getWatches()).filter((w) => w.id !== id)));
}

export function changeWatch(id: string, patch: Partial<Pick<Watch, 'mode' | 'quality' | 'format'>>): Promise<void> {
  return serial(async () =>
    save(
      (await getWatches()).map((w) =>
        w.id !== id
          ? w
          : {
              ...w,
              ...(patch.mode ? { mode: patch.mode === 'audio' ? 'audio' : 'video' } : {}),
              ...(patch.quality && LIST_QUALITIES.some((q) => q.id === patch.quality) ? { quality: patch.quality } : {}),
              ...('format' in patch ? (patch.format ? { format: patch.format } : { format: undefined }) : {}),
            },
      ),
    ),
  );
}

/** Reads every feed (or one) and starts the new videos. Returns how many started. */
export function checkWatches(jobs: JobManager, only?: string): Promise<number> {
  return serial(async () => {
    const list = await getWatches();
    let started = 0;
    const next: Watch[] = [];
    for (const w of list) {
      if (only && w.id !== only) {
        next.push(w);
        continue;
      }
      const xml = await fetchText(feedUrl(w.kind, w.key));
      const feed = xml === null ? null : parseFeed(xml);
      if (!feed) {
        next.push({ ...w, lastCheck: Date.now(), error: true });
        continue;
      }
      const fresh: FeedEntry[] = newEntries(feed.entries, w.seen, w.since).reverse();
      const n = fresh.length ? await jobs.startEntries(fresh, { quality: w.quality, mode: w.mode, ...(w.format ? { format: w.format } : {}), ...(w.kind === 'channel' ? { author: w.title } : {}) }) : 0;
      started += n;
      const { error: _e, ...rest } = w;
      next.push({
        ...rest,
        ...(feed.title ? { title: feed.title } : {}),
        seen: [...feed.entries.map((e) => e.id).filter((id) => !w.seen.includes(id)), ...w.seen].slice(0, MAX_SEEN),
        lastCheck: Date.now(),
        got: w.got + n,
      });
    }
    await save(next);
    return started;
  });
}
