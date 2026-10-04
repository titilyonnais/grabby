import type { MediaItem } from '../shared/types';

/** Requests only tell which origin a stream was loaded from, not the frame's full address. */
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

const isStream = (i: MediaItem) => i.kind === 'hls' || i.kind === 'dash';

/**
 * Items shown to the user:
 * - capture items are a fallback, hidden when the same player exposes a real stream;
 * - files a stream is made of (single-file renditions fetched by byte range, e.g. Reddit's
 *   CMAF files) are hidden behind that stream: same player, same duration;
 * - one file reached through several addresses (redirects, mirrors, "download" links) is
 *   listed once, preferring the copy that plays.
 */
export function visibleItems(items: MediaItem[]): MediaItem[] {
  const streams = items.filter(isStream);
  const streamFrames = new Set(streams.map((i) => originOf(i.frameUrl)));
  const partOfStream = (i: MediaItem) =>
    i.kind === 'file' &&
    !!i.duration &&
    streams.some((s) => !!s.duration && Math.abs(s.duration - i.duration!) < 0.5 && originOf(s.frameUrl) === originOf(i.frameUrl));

  const sameFile = new Map<string, MediaItem>();
  for (const i of items) {
    if (i.kind !== 'file' || !i.size || !i.duration) continue;
    const key = `${i.size}|${Math.round(i.duration * 10)}`;
    const kept = sameFile.get(key);
    if (!kept || (kept.linked && !i.linked)) sameFile.set(key, i);
  }
  const duplicate = (i: MediaItem) => {
    if (i.kind !== 'file' || !i.size || !i.duration) return false;
    return sameFile.get(`${i.size}|${Math.round(i.duration * 10)}`) !== i;
  };

  return items.filter((i) => {
    if (i.kind === 'capture') return i.experimental || !streamFrames.has(originOf(i.frameUrl));
    return !partOfStream(i) && !duplicate(i);
  });
}

export const downloadableCount = (items: MediaItem[]): number =>
  visibleItems(items).filter((i) => i.protection === 'none' && !i.live).length;
