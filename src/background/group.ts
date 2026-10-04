import { extOf } from '../parsers/url';
import { formatBytes } from '../shared/format';
import { sourceFormat } from '../shared/formats';
import { variantLines as lines } from '../shared/scale';
import type { AudioTrack, MediaItem, Variant } from '../shared/types';

/** Requests only tell which origin a media was loaded from, not the frame's full address. */
export const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

/** Shorter copies are not the same video: a teaser, an ad, a preview. */
const MIN_SECONDS = 5;
const sameLength = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, Math.min(a, b) * 0.002);

/** Items that may be the same video offered in several qualities. */
function groupable(i: MediaItem): boolean {
  return (
    (i.kind === 'file' || i.kind === 'hls') &&
    !i.audioOnly &&
    !i.live &&
    i.protection === 'none' &&
    !i.experimental &&
    (i.duration ?? 0) >= MIN_SECONDS &&
    // A stream stands for its qualities only when its master names them.
    (i.kind === 'file' || i.variants.some((v) => v.height))
  );
}

/** Files are grouped only with files of the same container, streams with streams. */
const family = (i: MediaItem) => (i.kind === 'hls' ? 'hls' : `file:${sourceFormat(extOf(i.url), i.mime) ?? '?'}`);

/** The qualities a member brings: a file is one quality, a stream its master's list. */
function variantsOf(i: MediaItem): Variant[] {
  if (i.kind === 'hls') {
    return i.variants.map((v) => ({ ...v, ...(v.audioGroup ? { audioGroup: `${i.id}:${v.audioGroup}` } : {}) }));
  }
  const own = i.variants[0];
  return [
    {
      id: i.id,
      label: own?.label || (i.size ? formatBytes(i.size) : ''),
      url: i.url,
      ...(own?.width ? { width: own.width } : {}),
      ...(own?.height ? { height: own.height } : {}),
      ...(i.size ? { size: i.size } : {}),
    },
  ];
}

const weight = (v: Variant) => v.size ?? v.bandwidth ?? 0;

/**
 * One card per video: copies of a video offered in several qualities by the same player
 * (several `<source>` files, one master playlist per quality…) are merged into the first
 * one that played, with every quality in its list, best first.
 */
export function groupSameVideo(items: MediaItem[]): MediaItem[] {
  const groups: MediaItem[][] = [];
  for (const i of items) {
    if (!groupable(i)) continue;
    const g = groups.find(
      (g) => family(g[0]!) === family(i) && originOf(g[0]!.frameUrl) === originOf(i.frameUrl) && sameLength(g[0]!.duration!, i.duration!),
    );
    if (g) g.push(i);
    else groups.push([i]);
  }

  const merged = new Map<MediaItem, MediaItem | null>();
  for (const g of groups) {
    if (g.length < 2) continue;
    const lead = g.find((i) => !i.linked) ?? g[0]!;
    const seen = new Set<string>();
    const variants = g
      .flatMap(variantsOf)
      .sort((a, b) => lines(b) - lines(a) || weight(b) - weight(a))
      .filter((v) => {
        // Two copies with the same name: the heavier (listed first) is kept.
        const label = v.label || v.url;
        if (seen.has(label)) return false;
        seen.add(label);
        return true;
      });
    if (variants.length < 2) continue;
    const audioTracks: AudioTrack[] = g.flatMap((i) => i.audioTracks.map((a) => (a.groupId ? { ...a, groupId: `${i.id}:${a.groupId}` } : a)));
    const best = variants[0]!;
    merged.set(lead, {
      ...lead,
      variants,
      audioTracks,
      related: [...new Set(g.flatMap((i) => [i.url, ...(i.related ?? [])]))],
      ...(best.size ? { size: best.size } : {}),
      linked: g.every((i) => i.linked) || undefined,
      thumbnail: lead.thumbnail ?? g.find((i) => i.thumbnail)?.thumbnail,
    } as MediaItem);
    for (const i of g) if (i !== lead) merged.set(i, null);
  }
  if (!merged.size) return items;
  return items.flatMap((i) => {
    const m = merged.get(i);
    return m === undefined ? [i] : m ? [m] : [];
  });
}
