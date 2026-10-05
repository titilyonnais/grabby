import { RAW_THRESHOLD, type Clip } from './plan';
import type { MediaItem } from './types';

/**
 * A part can be cut out of any video whose length is known: a stream fetches only its
 * segments, a recording plays only that part, a file is cut once downloaded.
 */
export function canClip(item: MediaItem): boolean {
  if (item.protection !== 'none' || item.live) return false;
  if (!item.duration || item.duration < 3) return false;
  // Cutting a file means loading all of it in memory.
  return item.kind !== 'file' || (item.size ?? 0) <= RAW_THRESHOLD;
}

/** "1:05", "12:40", "1:02:03": how a player shows a time. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** What the user typed ("1:05", "65", "1:02:03", "1.05") in seconds, or null. */
export function parseClock(text: string): number | null {
  const parts = text.trim().replace(/[.,h]/g, ':').split(':');
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** For a file name, without the colons Windows refuses: "1m05-2m40", "1h02m03-1h05m00". */
export function clipLabel(clip: Clip): string {
  const part = (seconds: number) => {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}h${String(m).padStart(2, '0')}m${ss}` : `${m}m${ss}`;
  };
  return `${part(clip.start)}-${part(clip.end)}`;
}

export const sameClip = (a?: Clip, b?: Clip): boolean => (!a && !b) || (!!a && !!b && a.start === b.start && a.end === b.end);
