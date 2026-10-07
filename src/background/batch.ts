/**
 * "Coller une liste d'adresses": each page is opened in a tab behind the others, two at a
 * time; once Grabby finds its video there, the download starts (the site's rule, else the
 * settings), then the tab closes — unless the video is recorded from that very page.
 */
import { parseUrls, type BatchItem, type BatchMode } from '../shared/batch';
import { uid } from '../shared/ids';
import { getSettings } from '../shared/settings';
import type { JobManager } from './jobs';
import { pickFor, startQuick } from './quick';
import type { Registry } from './registry';
import { visibleItems } from './visible';

export const BATCH_ALARM = 'grabby-batch';
const KEY = 'batch';
const MAX = 500;
/** Pages opened at once. */
const AT_ONCE = 2;
/** How long a page has to show a video. */
const WAIT_MS = 60_000;
/** Once a video shows, a little longer: the page's main one may come right after a preview. */
const SETTLE_MS = 2500;

export class Batch {
  private lock: Promise<unknown> = Promise.resolve();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private registry: Registry,
    private jobs: JobManager,
    private changed: () => void,
  ) {}

  /** One change at a time (tabs and storage events come in bursts). */
  private serial<T>(fn: (list: BatchItem[]) => Promise<T> | T): Promise<T> {
    const run = this.lock.then(async () => {
      const list = ((await chrome.storage.local.get(KEY))[KEY] as BatchItem[] | undefined) ?? [];
      const before = JSON.stringify(list);
      const out = await fn(list);
      if (JSON.stringify(list) !== before) {
        await chrome.storage.local.set({ [KEY]: list });
        this.changed();
      }
      return out;
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<BatchItem[]> {
    return ((await chrome.storage.local.get(KEY))[KEY] as BatchItem[] | undefined) ?? [];
  }

  /** Adds the addresses of a text; returns how many were new. */
  async add(text: string, mode: BatchMode): Promise<number> {
    const urls = parseUrls(text);
    const n = await this.serial((list) => {
      let added = 0;
      for (const url of urls) {
        if (list.length >= MAX) break;
        if (list.some((i) => i.url === url && i.status !== 'failed')) continue;
        list.push({ id: uid(), url, mode, status: 'waiting', added: Date.now() });
        added++;
      }
      return added;
    });
    await this.pump();
    return n;
  }

  async remove(id: string): Promise<void> {
    await this.serial((list) => {
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return;
      const [gone] = list.splice(i, 1);
      if (gone?.status === 'opening' && gone.tabId !== undefined) void chrome.tabs.remove(gone.tabId).catch(() => {});
    });
    await this.pump();
  }

  /** Clears the ones done (started or failed), or everything that isn't being opened. */
  async clear(all: boolean): Promise<void> {
    await this.serial((list) => {
      const keep = list.filter((i) => i.status === 'opening' || (!all && i.status === 'waiting'));
      list.splice(0, list.length, ...keep);
    });
  }

  async retry(id: string): Promise<void> {
    await this.serial((list) => {
      const i = list.find((x) => x.id === id);
      if (i?.status !== 'failed') return;
      i.status = 'waiting';
      delete i.error;
      delete i.found;
    });
    await this.pump();
  }

  /** Opens the next pages, and gives up on those that showed no video in time. */
  async pump(): Promise<void> {
    // Pages whose time is up, or whose video showed a while ago (the worker may have slept
    // through their timers): decided now.
    const now = Date.now();
    const due = (await this.list()).filter((i) => i.status === 'opening' && ((i.until ?? 0) < now || (i.found !== undefined && now - i.found > SETTLE_MS)));
    for (const i of due) await this.decide(i.id, false);
    const open = await this.serial(async (list) => {
      const busy = list.filter((i) => i.status === 'opening').length;
      const next = list.filter((i) => i.status === 'waiting').slice(0, Math.max(0, AT_ONCE - busy));
      for (const i of next) {
        try {
          const tab = await chrome.tabs.create({ url: i.url, active: false });
          i.status = 'opening';
          i.tabId = tab.id!;
          i.until = Date.now() + WAIT_MS;
          this.later(i.id, WAIT_MS + 200);
        } catch {
          i.status = 'failed';
          i.error = 'failed';
        }
      }
      return list.some((i) => i.status === 'opening');
    });
    // The worker may sleep meanwhile: an alarm brings it back to give up on pages in time.
    if (open) void chrome.alarms.create(BATCH_ALARM, { delayInMinutes: 1 }).catch(() => {});
  }

  private later(id: string, ms: number) {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.decide(id);
      }, ms),
    );
  }

  /** No video in time: why, as the page tells it. Its tab closes. */
  private giveUp(i: BatchItem) {
    i.status = 'failed';
    i.error ??= 'no_video';
    if (i.tabId !== undefined) void chrome.tabs.remove(i.tabId).catch(() => {});
    delete i.tabId;
    delete i.until;
    delete i.found;
  }

  /** A tab's videos changed: one of our pages may have shown its video. */
  async onTab(tabId: number): Promise<void> {
    const list = await this.list();
    const i = list.find((x) => x.status === 'opening' && x.tabId === tabId);
    if (!i || i.found) return;
    const items = visibleItems(await this.registry.get(tabId));
    if (!items.length) return;
    await this.serial((l) => {
      const x = l.find((y) => y.id === i.id);
      if (x && !x.found) x.found = Date.now();
    });
    this.later(i.id, SETTLE_MS);
  }

  /** Time to choose: the page's best video starts, or the page gives up. */
  private async decide(id: string, next = true): Promise<void> {
    await this.serial(async (list) => {
      const i = list.find((x) => x.id === id);
      if (i?.status !== 'opening' || i.tabId === undefined) return;
      const tabId = i.tabId;
      const items = visibleItems(await this.registry.get(tabId));
      const item = pickFor(items);
      if (!item) {
        if ((i.until ?? 0) > Date.now()) return;
        i.error = items.some((x) => x.protection !== 'none') ? 'protected' : items.some((x) => x.live) ? 'live' : 'no_video';
        this.giveUp(i);
        return;
      }
      const job = await startQuick(this.jobs, tabId, item, await getSettings(), i.mode === 'auto' ? undefined : i.mode);
      i.title = item.title;
      delete i.until;
      delete i.found;
      if (!job) {
        i.status = 'failed';
        i.error = 'failed';
        void chrome.tabs.remove(tabId).catch(() => {});
        delete i.tabId;
        return;
      }
      i.status = 'started';
      i.jobId = job.id;
      delete i.tabId;
      // A video played by the page itself is recorded there: its tab stays until it's done.
      if (job.kind === 'capture' && !job.hidden) this.jobs.adoptTab(job.id, tabId);
      else void chrome.tabs.remove(tabId).catch(() => {});
    });
    if (next) await this.pump();
  }

  /** The user closed one of the pages being opened. */
  async onTabRemoved(tabId: number): Promise<void> {
    await this.serial((list) => {
      const i = list.find((x) => x.status === 'opening' && x.tabId === tabId);
      if (!i) return;
      i.status = 'failed';
      i.error = 'closed';
      delete i.tabId;
      delete i.until;
      delete i.found;
    });
    await this.pump();
  }
}
