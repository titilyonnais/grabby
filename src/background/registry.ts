import type { MediaItem, SubtitleTrack } from '../shared/types';
import { describeSubtitleUrl, segmentPattern } from '../shared/subtitles';
import { hashId } from '../shared/ids';
import { hostOf, normalizeMediaUrl } from '../parsers/url';
import { looksLikeId } from '../shared/title';

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
  /** Hover previews / background loops seen in the page: their files aren't listed. */
  previews?: Preview[];
  /** Still images grabbed from each frame's player, used when the page offers none. */
  frameThumbs?: Record<string, string>;
  pageTitle?: string;
  thumbnail?: string;
  /** Biggest picture of the page: used only when nothing better exists. */
  image?: string;
  /** Subtitles a <video src> declares (<track>), by the video's address. */
  videoSubs?: Record<string, SubtitleTrack[]>;
  /** Subtitle files each frame loaded (its player fetching them), by frame. */
  frameSubs?: Record<string, string[]>;
}

const MAX_FRAME_SUBS = 12;

/** Subtitle files a frame loaded, without the segments of a stream's subtitles. */
function frameSubtitles(urls: string[] | undefined): SubtitleTrack[] {
  if (!urls?.length) return [];
  const count = new Map<string, number>();
  for (const u of urls) count.set(segmentPattern(u), (count.get(segmentPattern(u)) ?? 0) + 1);
  return urls
    .filter((u) => (count.get(segmentPattern(u)) ?? 0) < 3)
    .map((url) => ({ id: hashId(url), url, ...describeSubtitleUrl(url) }));
}

export interface Preview {
  url: string;
  frameUrl: string;
  duration?: number;
}

/** A file is a known preview: same URL, or (redirected CDN copy) same frame and length. */
function isPreviewFile(item: MediaItem, previews: Preview[] | undefined): boolean {
  if (item.kind !== 'file' || !previews?.length) return false;
  const norm = normalizeMediaUrl(item.url);
  return previews.some(
    (p) =>
      normalizeMediaUrl(p.url) === norm ||
      (p.frameUrl === item.frameUrl &&
        p.duration !== undefined &&
        item.duration !== undefined &&
        Math.abs(p.duration - item.duration) < 0.35 &&
        (item.size ?? 0) < 50e6),
  );
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

/** A readable name from the URL's last path segment, or '' when it's just an id. */
function titleFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    const name = decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_+]+/g, ' ').trim();
    return looksLikeId(name) ? '' : name;
  } catch {
    return '';
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

  /** Items with display fallbacks: page title (or `fallbackTitle`, the tab's), page image. */
  async get(tabId: number, fallbackTitle?: string): Promise<MediaItem[]> {
    await (this.locks.get(tabId) ?? Promise.resolve());
    const s = await this.load(tabId);
    const anyFrameThumb = Object.values(s.frameThumbs ?? {})[0];
    // Players of a frame: subtitles it loaded go with its only player.
    const players = new Map<string, number>();
    for (const i of s.items) if (i.kind === 'file' || i.kind === 'capture') players.set(i.frameUrl, (players.get(i.frameUrl) ?? 0) + 1);
    return s.items.map((i) => {
      const thumbnail = i.thumbnail ?? s.thumbnail ?? s.frameThumbs?.[i.frameUrl] ?? anyFrameThumb ?? s.image;
      const subtitles = i.subtitles?.length ? i.subtitles : this.subtitlesFor(s, i, players.get(i.frameUrl) === 1);
      return {
        ...i,
        ...(subtitles.length ? { subtitles } : {}),
        title: i.title || s.pageTitle || fallbackTitle || titleFromUrl(i.url) || hostOf(i.pageUrl) || 'video',
        ...(thumbnail ? { thumbnail } : {}),
      };
    });
  }

  /** Subtitles of a file (its <track>s) or of the only player of a frame (files it loaded). */
  private subtitlesFor(s: TabState, i: MediaItem, alone: boolean): SubtitleTrack[] {
    if (i.kind !== 'file' && i.kind !== 'capture') return [];
    if (i.kind === 'file') {
      for (const u of [i.url, ...i.variants.map((v) => v.url)]) {
        const own = u ? s.videoSubs?.[normalizeMediaUrl(u)] : undefined;
        if (own?.length) return own;
      }
    }
    return alone && !i.audioOnly ? frameSubtitles(s.frameSubs?.[i.frameUrl]) : [];
  }

  /** The <track>s of a <video src>, for its file once it is listed. */
  setVideoSubs(tabId: number, videoUrl: string, subs: SubtitleTrack[]): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        const key = normalizeMediaUrl(videoUrl);
        if (JSON.stringify(s.videoSubs?.[key] ?? []) === JSON.stringify(subs)) return false;
        const entries = Object.entries(s.videoSubs ?? {}).filter(([k]) => k !== key).slice(-20);
        s.videoSubs = Object.fromEntries([...entries, [key, subs]]);
        return s.items.some((i) => i.kind === 'file');
      },
      (r) => r,
    );
  }

  /** A subtitle file a frame loaded. */
  addFrameSub(tabId: number, frameUrl: string, url: string): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        const list = s.frameSubs?.[frameUrl] ?? [];
        if (list.includes(url)) return false;
        s.frameSubs = { ...(s.frameSubs ?? {}), [frameUrl]: [...list, url].slice(-MAX_FRAME_SUBS * 4) };
        return s.items.some((i) => i.frameUrl === frameUrl && (i.kind === 'file' || i.kind === 'capture'));
      },
      (r) => r,
    );
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
        if (isPreviewFile(item, s.previews)) return false;

        if (item.kind === 'capture' && s.blockedFrames?.includes(item.frameUrl)) return false;
        // A frame that set up DRM plays protected media: whatever it loads is protected too.
        if (s.drmFrames.includes(item.frameUrl)) item = { ...item, protection: 'drm' };

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
          if (i.frameUrl === frameUrl && i.protection !== 'drm') {
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

  /** Records preview videos of a frame and drops files already listed for them. */
  addPreviews(tabId: number, previews: Preview[]): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        const known = new Set((s.previews ?? []).map((p) => normalizeMediaUrl(p.url)));
        const fresh = previews.filter((p) => !known.has(normalizeMediaUrl(p.url)));
        if (!fresh.length) return false;
        s.previews = [...(s.previews ?? []), ...fresh].slice(-60);
        const before = s.items.length;
        s.items = s.items.filter((i) => !isPreviewFile(i, s.previews));
        return s.items.length !== before;
      },
      (r) => r,
    );
  }

  resetPageInfo(tabId: number): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        delete s.pageTitle;
        delete s.thumbnail;
        delete s.image;
        s.frameThumbs = {};
        return true;
      },
      () => true,
    );
  }

  setFrameThumb(tabId: number, frameUrl: string, thumb: string): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        if (s.frameThumbs?.[frameUrl] === thumb) return false;
        // Keep a few: they are data URLs.
        const entries = Object.entries(s.frameThumbs ?? {}).filter(([k]) => k !== frameUrl).slice(-3);
        s.frameThumbs = Object.fromEntries([...entries, [frameUrl, thumb]]);
        return true;
      },
      (r) => r,
    );
  }

  async isDrmFrame(tabId: number, frameUrl: string): Promise<boolean> {
    return (await this.load(tabId)).drmFrames.includes(frameUrl);
  }

  setPageInfo(tabId: number, info: { title?: string; thumbnail?: string; image?: string }): Promise<boolean> {
    return this.mutate(
      tabId,
      (s) => {
        const before = `${s.pageTitle}|${s.thumbnail}|${s.image}`;
        if (info.title) s.pageTitle = info.title;
        if (info.thumbnail) s.thumbnail = info.thumbnail;
        if (info.image) s.image = info.image;
        return before !== `${s.pageTitle}|${s.thumbnail}|${s.image}`;
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
        s.previews = [];
        s.frameThumbs = {};
        s.videoSubs = {};
        s.frameSubs = {};
        delete s.pageTitle;
        delete s.image;
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
