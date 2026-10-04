import { qualityLabel } from './format';
import type { VideoFormat } from './plan';
import type { MediaItem, Variant } from './types';

/** A shrunk picture is H.264: these hold it (WebM doesn't), whatever the source's codec. */
export const SHRUNK_FORMATS: VideoFormat[] = ['mp4', 'mkv', 'mov', 'avi', 'ts'];

/** Qualities Grabby can make itself by shrinking a bigger one. */
export const SCALE_LINES = [1440, 1080, 720, 480, 360, 240, 144];

/** 1080 for a "1080p" quality, named the way people do (a 1920×800 film is 1080p); 0 if unknown. */
export function variantLines(v: Pick<Variant, 'width' | 'height'>): number {
  return v.height ? Number.parseInt(qualityLabel(v.height, undefined, v.width), 10) || 0 : 0;
}

/** Videos Grabby can shrink: downloaded files and streams (not recordings, not YouTube). */
export function canShrink(item: MediaItem): boolean {
  return (item.kind === 'file' || item.kind === 'hls' || item.kind === 'dash') && !item.audioOnly && !item.ytId && !item.experimental;
}

/** Smaller qualities than the best one offered, that the source doesn't offer itself. */
export function scaleChoices(variants: Variant[]): number[] {
  const lines = variants.map(variantLines);
  const best = Math.max(0, ...lines);
  return SCALE_LINES.filter((l) => l < best && !lines.includes(l));
}

/** Box the picture must fit in for a quality: 640×360 for 360p, 360×640 for a vertical video. */
export function scaleBox(lines: number, source?: Pick<Variant, 'width' | 'height'>): { w: number; h: number } {
  const long = Math.round((lines * 16) / 9 / 2) * 2;
  const vertical = !!source?.width && !!source.height && source.height > source.width;
  return vertical ? { w: lines, h: long } : { w: long, h: lines };
}

/**
 * The quality to shrink from: the smallest one still at least as big as the target (less to
 * download and to decode), else the best.
 */
export function scaleSource(variants: Variant[], lines: number): Variant | undefined {
  const big = variants.filter((v) => variantLines(v) >= lines).sort((a, b) => variantLines(a) - variantLines(b));
  return big[0] ?? variants[0];
}
