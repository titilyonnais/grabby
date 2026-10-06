/**
 * Followed YouTube channels and playlists: their public RSS feed (the 15 latest videos),
 * the one YouTube offers to everyone — no account, no key, no token.
 */
import { child, children, parseXml, type XmlNode } from '../parsers/xml';
import type { OutputFormat } from './plan';

export type WatchKind = 'channel' | 'playlist';

export interface FeedEntry {
  id: string;
  title: string;
  /** When it was published (ms). */
  published: number;
}

const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const PLAYLIST_ID = /^(PL|UU|OL|FL)[\w-]{10,64}$/;

export function feedUrl(kind: WatchKind, key: string): string {
  return `https://www.youtube.com/feeds/videos.xml?${kind === 'channel' ? 'channel_id' : 'playlist_id'}=${encodeURIComponent(key)}`;
}

/** The feed's title and videos, newest first; null for what isn't a YouTube feed. */
export function parseFeed(xml: string): { title: string; entries: FeedEntry[] } | null {
  let doc: XmlNode;
  try {
    doc = parseXml(xml);
  } catch {
    return null;
  }
  // The parser hands back the root element itself.
  const feed = doc.name === 'feed' ? doc : child(doc, 'feed');
  if (!feed) return null;
  const entries: FeedEntry[] = [];
  for (const e of children(feed, 'entry')) {
    const id = child(e, 'videoId')?.text.trim() ?? '';
    if (!VIDEO_ID.test(id)) continue;
    const published = Date.parse(child(e, 'published')?.text.trim() ?? '');
    entries.push({ id, title: (child(e, 'title')?.text ?? '').trim().slice(0, 300) || id, published: Number.isFinite(published) ? published : 0 });
  }
  entries.sort((a, b) => b.published - a.published);
  return { title: (child(feed, 'title')?.text ?? '').trim().slice(0, 200), entries };
}

/**
 * What an address points at: a playlist (its id), a channel (its id when the address has
 * it), or a page whose channel has to be read (`page`: a @handle, a video).
 */
export function watchTarget(input: string): { kind: WatchKind; key: string } | { page: string } | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/i.test(u.hostname) && u.hostname !== 'youtu.be') return null;
  const list = u.searchParams.get('list') ?? '';
  // Mixes (RD…), "Watch later" and liked videos have no public feed.
  if (PLAYLIST_ID.test(list)) return { kind: 'playlist', key: list };
  const channel = /^\/channel\/([^/?#]+)/.exec(u.pathname)?.[1] ?? '';
  if (CHANNEL_ID.test(channel)) return { kind: 'channel', key: channel };
  if (u.hostname === 'youtu.be' || /^\/(@[^/]+|c\/[^/]+|user\/[^/]+|watch|shorts\/[\w-]{11}|live\/[\w-]{11})/.test(u.pathname)) {
    return { page: `https://www.youtube.com${u.hostname === 'youtu.be' ? `/watch?v=${u.pathname.slice(1, 12)}` : u.pathname + u.search}` };
  }
  return null;
}

/** The channel a YouTube page belongs to, read from its HTML (the page's own data). */
export function channelIdIn(html: string): string | null {
  const patterns = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /<meta itemprop="(?:identifier|channelId)" content="(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m) return m[1]!;
  }
  return null;
}

/** The videos of a feed not seen yet and published since following it (a little margin). */
export function newEntries(entries: readonly FeedEntry[], seen: readonly string[], since: number): FeedEntry[] {
  const known = new Set(seen);
  return entries.filter((e) => !known.has(e.id) && e.published >= since - 60 * 60_000);
}

/** A followed channel or playlist. */
export interface Watch {
  id: string;
  kind: WatchKind;
  /** The channel's id (UC…) or the playlist's. */
  key: string;
  title: string;
  mode: 'video' | 'audio';
  /** A LIST_QUALITIES id. */
  quality: string;
  format?: OutputFormat;
  /** When it was followed: older videos are never taken. */
  since: number;
  seen: string[];
  lastCheck?: number;
  /** Videos started from it so far. */
  got: number;
  /** The last check failed: the feed couldn't be read. */
  error?: boolean;
}
