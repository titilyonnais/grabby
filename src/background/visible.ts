import type { MediaItem } from '../shared/types';

/**
 * Items shown to the user. Capture items are a fallback: they are hidden when the
 * same frame already exposes a real stream (HLS/DASH) that we can download directly.
 */
export function visibleItems(items: MediaItem[]): MediaItem[] {
  const streamFrames = new Set(items.filter((i) => i.kind === 'hls' || i.kind === 'dash').map((i) => i.frameUrl));
  return items.filter((i) => i.kind !== 'capture' || i.experimental || !streamFrames.has(i.frameUrl));
}

export const downloadableCount = (items: MediaItem[]): number =>
  visibleItems(items).filter((i) => i.protection === 'none' && !i.live).length;
