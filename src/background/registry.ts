import type { MediaItem } from '../shared/types';
import { normalizeMediaUrl } from '../parsers/url';

export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

interface TabState {
  items: MediaItem[];
  drmFrames: string[];
  /** Frames that streamed from a host the policy blocks: no playback capture there. */
  blockedFrames?: string[];
  pageTitle?: string;
  thumbnail?: string;
}

const MAX_ITEMS = 40;
const key = (tabId: number) => `tab:${tabId}`;

/** chrome.storage.session adapter: survives service-worker restarts, cleared on browser exit. */
export const sessionKV: KV = {
  async get(k) {
    return (await chrome.storage.session.get(k))[k];
  },
  // Over quota (1 MB before Chrome 112), the in-memory cache still serves this session.
  set: (k, v) => chrome.storage.session.set({ [k]: v }).catch(() => {}),
  remove: (k) => chrome.storage.session.remove(k),
};

function titleFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, '') || new URL(url).hostname;
  } catch {
    return 'video';
  }
}

/** Media playlists a master stands for (including renditions hidden from its quality list). */
function refsOf(i: MediaItem): Set<string> {
  return new Set([...i.variants.map((v) => v.url), ...i.audioTracks.map((a) => a.url), ...(i.related ?? [])].map(normalizeMediaUrl));
}

/** Per-tab media registry, cached in memory and persisted to session storage. */
export class Registry {
  private cache = new Map<number, TabState>();
  private listeners: ((tabId: number) => void)[] = [];
  /** Serializes writes per tab so concurrent webRequest events never lose updates. */
  private locks = new Map<number, Promise<unknown>>();

  constructor(private kv: KV) {}

  onChange(cb: (tabId: number) => void): void {
    this.listeners.push(cb);
  }

  private emit(tabId: number) {
    for (const l of this.listeners) l(tabId);
  }

  private async load(tabId: number): Promise<TabState> {
    let s = this.cache.get(tabId);
    if (!s) {
      s = ((await this.kv.get(key(tabId))) as TabState | undefined) ?? { items: [], drmFrames: [] };
      this.cache.set(tabId, s);
    }
    return s;
  }

  private async mutate<T>(tabId: number, fn: (s: TabState) => T | Promise<T>, changed: (r: T) => boolean): Promise<T> {
    const prev = this.locks.get(tabId) ?? Promise.resolve();
    const run = prev.then(async () => {
      const s = await this.load(tabId);
      const r = await fn(s);
      if (changed(r)) {
        await this.kv.set(key(tabId), s);
        this.emit(tabId);
      }
      return r;
    });
    this.locks.set(tabId, run.catch(() => undefined));
    return run;
  }

  async get(tabId: number): Promise<MediaItem[]> {
    await (this.locks.get(tabId) ?? Promise.resolve());
    const s = await this.load(tabId);
    return s.items.map((i) => ({
      ...i,
      title: i.title || s.pageTitle || titleFromUrl(i.url),
      ...(i.thumbnail || s.thumbnail ? { thumbnail: i.thumbnail ?? s.thumbnail } : {}),
    }));
  }

  async find(tabId: number, id: string): Promise<MediaItem | undefined> {
    return (await this.get(tabId)).find((i) => i.id === id);
  }

  /** Inserts or merges an item. Returns true when the visible state changed. */
  upsert(tabId: number, item: MediaItem): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        const norm = normalizeMediaUrl(item.url);
        // A media playlist already listed as a variant/audio of a master is absorbed.
        const absorbed = s.items.some((i) => i.id !== item.id && refsOf(i).has(norm));
        if (absorbed) return false;

        if (item.kind === 'capture' && s.blockedFrames?.includes(item.frameUrl)) return false;
        if (item.kind === 'capture' && s.drmFrames.includes(item.frameUrl)) item = { ...item, protection: 'drm' };

        // A master removes the media playlists it references.
        const refs = refsOf(item);
        if (refs.size) {
          s.items = s.items.filter((i) => i.id === item.id || !refs.has(normalizeMediaUrl(i.url)));
        }

        const idx = s.items.findIndex((i) => i.id === item.id);
        if (idx >= 0) {
          const prev = s.items[idx]!;
          const merged: MediaItem = { ...prev, ...item, detectedAt: prev.detectedAt };
          if (JSON.stringify(merged) === JSON.stringify(prev)) return false;
          s.items[idx] = merged;
          return true;
        }
        s.items.push(item);
        s.items.sort((a, b) => a.detectedAt - b.detectedAt);
        if (s.items.length > MAX_ITEMS) s.items = s.items.slice(-MAX_ITEMS);
        return true;
      },
      (r) => r,
    );
  }

  patch(tabId: number, id: string, partial: Partial<MediaItem>): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        const i = s.items.findIndex((x) => x.id === id);
        if (i < 0) return false;
        s.items[i] = { ...s.items[i]!, ...partial };
        return true;
      },
      (r) => r,
    );
  }

  /** Removes items matching `pred` (e.g. capture items whose video disappeared). */
  removeWhere(tabId: number, pred: (i: MediaItem) => boolean): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        const before = s.items.length;
        s.items = s.items.filter((i) => !pred(i));
        return s.items.length !== before;
      },
      (r) => r,
    );
  }

  markFrameDrm(tabId: number, frameUrl: string): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        let changed = false;
        if (!s.drmFrames.includes(frameUrl)) {
          s.drmFrames.push(frameUrl);
          changed = true;
        }
        for (const i of s.items) {
          if (i.kind === 'capture' && i.frameUrl === frameUrl && i.protection !== 'drm') {
            i.protection = 'drm';
            changed = true;
          }
        }
        return changed;
      },
      (r) => r,
    );
  }

  blockFrame(tabId: number, frameUrl: string): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        const before = s.items.length;
        const known = (s.blockedFrames ??= []).includes(frameUrl);
        if (!known) s.blockedFrames.push(frameUrl);
        s.items = s.items.filter((i) => !(i.kind === 'capture' && i.frameUrl === frameUrl));
        return !known || s.items.length !== before;
      },
      (r) => r,
    );
  }

  async isDrmFrame(tabId: number, frameUrl: string): Promise<boolean> {
    return (await this.load(tabId)).drmFrames.includes(frameUrl);
  }

  setPageInfo(tabId: number, info: { title?: string; thumbnail?: string }): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        const before = `${s.pageTitle}|${s.thumbnail}`;
        if (info.title) s.pageTitle = info.title;
        if (info.thumbnail) s.thumbnail = info.thumbnail;
        return before !== `${s.pageTitle}|${s.thumbnail}`;
      },
      (r) => r,
    );
  }

  clear(tabId: number): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        s.items = [];
        s.drmFrames = [];
        s.blockedFrames = [];
        delete s.pageTitle;
        delete s.thumbnail;
        return true;
      },
      () => true,
    );
  }

  async remove(tabId: number): Promise<void> {
    await (this.locks.get(tabId) ?? Promise.resolve());
    this.cache.delete(tabId);
    this.locks.delete(tabId);
    await this.kv.remove(key(tabId));
    this.emit(tabId);
  }
}
