import type { MediaItem } from '../shared/types';

/** Requests only tell which origin a stream was loaded from, not the frame's full address. */
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

/**
 * Items shown to the user. Capture items are a fallback: they are hidden when the
 * same player already exposes a real stream (HLS/DASH) that we can download directly.
 */
export function visibleItems(items: MediaItem[]): MediaItem[] {
  const streamFrames = new Set(items.filter((i) => i.kind === 'hls' || i.kind === 'dash').map((i) => originOf(i.frameUrl)));
  return items.filter((i) => i.kind !== 'capture' || i.experimental || !streamFrames.has(originOf(i.frameUrl)));
}

export const downloadableCount = (items: MediaItem[]): number =>
  visibleItems(items).filter((i) => i.protection === 'none' && !i.live).length;
