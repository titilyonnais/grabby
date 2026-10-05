import type { MediaItem } from './types';

/**
 * Best candidate first: downloadable, then what plays over what the page only links to,
 * adaptive streams with qualities, full-length videos over short clips, then biggest.
 */
export function rank(items: MediaItem[]): MediaItem[] {
  const score = (i: MediaItem) =>
    (i.protection === 'none' && !i.live ? 1000 : 0) +
    (i.linked ? -100 : 0) +
    (i.variants.length > 1 ? 100 : 0) +
    (i.duration ? (i.duration >= 30 ? 60 : i.duration < 10 ? -150 : 0) : 0) +
    (i.kind !== 'capture' ? 10 : 0) +
    (i.audioOnly ? -50 : 0);
  return [...items].sort(
    (a, b) => score(b) - score(a) || (b.duration ?? 0) - (a.duration ?? 0) || (b.size ?? 0) - (a.size ?? 0) || b.detectedAt - a.detectedAt,
  );
}
