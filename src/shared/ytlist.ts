import { hashId } from './ids';
import type { MediaItem } from './types';

/**
 * YouTube playlists and channels: the videos the page lists (read from the page itself, the
 * ones it has loaded so far), each one then recorded like a single video.
 */

export interface YtEntry {
  id: string;
  title: string;
  /** Seconds, when the list shows it. */
  duration?: number;
}

export interface YtList {
  /** A playlist, or a channel's videos. */
  kind: 'playlist' | 'channel';
  title: string;
  entries: YtEntry[];
}

/** One video of a list as the page shows it (what the content script reads). */
export interface RawEntry {
  href: string;
  title?: string;
  duration?: string;
}

export const MAX_LIST = 500;

/** Qualities a whole list can be recorded in (YouTube's names), best first. */
export const LIST_QUALITIES = [
  { id: 'hd1080', label: '1080p', height: 1080 },
  { id: 'hd720', label: '720p', height: 720 },
  { id: 'large', label: '480p', height: 480 },
  { id: 'medium', label: '360p', height: 360 },
] as const;

const ID = /^[\w-]{11}$/;

/** "1:02:03" → 3723; null for what isn't a duration ("LIVE", "SHORTS"). */
export function parseDuration(s: string | undefined): number | null {
  const m = s ? /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s*$/.exec(s) : null;
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** The video a link opens (watch pages only: no Shorts, no live without a length). */
export function watchId(href: string, base = 'https://www.youtube.com/'): string | null {
  try {
    const u = new URL(href, base);
    if (!/(^|\.)youtube\.com$/.test(u.hostname) || u.pathname !== '/watch') return null;
    const v = u.searchParams.get('v');
    return v && ID.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** What kind of list a YouTube address shows, if any. */
export function listKind(href: string): YtList['kind'] | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
  if (u.pathname === '/playlist' && u.searchParams.get('list')) return 'playlist';
  // A mix ("RD…") is made up by YouTube as it plays, endlessly: not a list to download.
  if (u.pathname === '/watch' && u.searchParams.get('list') && !/^RD/.test(u.searchParams.get('list')!)) return 'playlist';
  if (/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(videos|streams)\/?$/.test(u.pathname)) return 'channel';
  return null;
}

/** The list from what the page shows: each video once, in the page's order. */
export function listOf(kind: YtList['kind'], title: string, raw: RawEntry[]): YtList | null {
  const seen = new Set<string>();
  const entries: YtEntry[] = [];
  for (const r of raw) {
    const id = watchId(r.href);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const d = parseDuration(r.duration);
    // Live now (no length) can't be recorded from start to end.
    if (r.duration !== undefined && d === null && /live|direct/i.test(r.duration)) continue;
    entries.push({ id, title: (r.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || `YouTube ${id}`, ...(d ? { duration: d } : {}) });
    if (entries.length >= MAX_LIST) break;
  }
  if (entries.length < 2) return null;
  return { kind, title: title.replace(/\s*-\s*YouTube\s*$/, '').trim().slice(0, 200) || 'YouTube', entries };
}

/** "07 - Title": numbered so that the files sort in the list's order. */
export function numbered(title: string, index: number, count: number): string {
  return `${String(index + 1).padStart(Math.max(2, String(count).length), '0')} - ${title}`;
}

/** The video renderers of each kind of list page (YouTube changes them from time to time). */
const RENDERERS: Record<YtList['kind'], string> = {
  playlist: 'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer',
  channel: 'ytd-rich-item-renderer, ytd-grid-video-renderer, yt-lockup-view-model',
};

const DURATION_SEL = 'ytd-thumbnail-overlay-time-status-renderer, badge-shape, .yt-badge-shape__text, .badge-shape-wiz__text, #time-status';

/** Reads the list a YouTube page shows (top frame, in the page). */
export function readYtList(doc: Document, href: string): YtList | null {
  const kind = listKind(href);
  if (!kind) return null;
  // A video page with a list: its side panel (not the recommendations around it).
  const scope: ParentNode = (href.includes('/watch') ? doc.querySelector('ytd-playlist-panel-renderer #items') : null) ?? doc;
  const raw: RawEntry[] = [];
  for (const el of Array.from(scope.querySelectorAll(RENDERERS[kind]))) {
    const a = el.querySelector('a#video-title, a#video-title-link, a#wc-endpoint, a[href*="/watch?v="]');
    if (!a) continue;
    const titleEl = el.querySelector('#video-title, .yt-lockup-metadata-view-model__title, h3');
    const title = titleEl?.getAttribute('title') || titleEl?.textContent || a.getAttribute('title') || a.getAttribute('aria-label') || '';
    const time = Array.from(el.querySelectorAll(DURATION_SEL)).map((x) => x.textContent?.trim() ?? '').find((x) => x) || undefined;
    raw.push({ href: a.getAttribute('href') ?? '', title, ...(time ? { duration: time } : {}) });
  }
  const panelTitle = href.includes('/watch') ? doc.querySelector('ytd-playlist-panel-renderer h3 yt-formatted-string, ytd-playlist-panel-renderer .title')?.textContent : null;
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
  return listOf(kind, panelTitle || og || doc.title, raw);
}

/**
 * A video of a list as a download: recorded by a hidden player, in the quality chosen for
 * the whole list (YouTube gives the nearest one when it doesn't have it).
 */
export function listItem(entry: YtEntry, tabId: number, quality: string, title = entry.title): MediaItem {
  const q = LIST_QUALITIES.find((x) => x.id === quality) ?? LIST_QUALITIES[0];
  const watch = `https://www.youtube.com/watch?v=${entry.id}`;
  return {
    id: hashId(`ytlist:${entry.id}`),
    tabId,
    frameUrl: watch,
    pageUrl: watch,
    kind: 'capture',
    url: watch,
    title,
    thumbnail: `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`,
    ...(entry.duration ? { duration: entry.duration } : {}),
    // H.264 up to 1080p (every video has it): the most compatible files.
    variants: [{ id: q.id, label: q.label, height: q.height, url: '', codecs: 'avc1' }],
    audioTracks: [],
    protection: 'none',
    live: false,
    detectedAt: Date.now(),
    experimental: true,
    formats: ['mp4', 'webm', 'mkv'],
    ytId: entry.id,
    frameId: 0,
    videoIndex: 0,
    fromList: { id: entry.id, title: entry.title, ...(entry.duration ? { duration: entry.duration } : {}) },
  };
}
