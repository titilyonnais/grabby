import type { HistoryEntry } from './types';

const DAY = 86_400_000;
const AUDIO = /\.(m4a|mp3|opus|ogg|flac|wav)$/i;
const IMAGE = /\.(jpe?g|png|gif|webp)$/i;

export type StatKind = 'video' | 'audio' | 'image';

export interface Numbers {
  files: number;
  bytes: number;
  /** Saved in the last 7 days. */
  week: number;
  /** Files per week, the oldest first (`weeks` of them, the last one is this week). */
  perWeek: number[];
  /** Where they came from, the most first. */
  sites: { site: string; n: number; bytes: number }[];
  kinds: Record<StatKind, { n: number; bytes: number }>;
  formats: { format: string; n: number }[];
  /** The hour of the day most files were saved at (0-23), when there are some. */
  hour?: number;
  /** In a row: the most days with something saved each day, and the current run. */
  streak: { best: number; now: number };
}

export const statKind = (e: HistoryEntry): StatKind => (AUDIO.test(e.filename) || e.mode === 'audio' ? 'audio' : IMAGE.test(e.filename) ? 'image' : 'video');
const siteOf = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0] ?? '';
const dayOf = (ts: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
/** Monday, 0:00, of the week of `ts`. */
export const weekOf = (ts: number) => {
  const d = new Date(dayOf(ts));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};

/** « Statistiques »: what the library holds, counted from its entries alone (nothing leaves the computer). */
export function libraryNumbers(entries: HistoryEntry[], now = Date.now(), weeks = 12): Numbers {
  const kinds: Numbers['kinds'] = {
    video: { n: 0, bytes: 0 },
    audio: { n: 0, bytes: 0 },
    image: { n: 0, bytes: 0 },
  };
  const sites = new Map<string, { n: number; bytes: number }>();
  const formats = new Map<string, number>();
  const hours = Array.from({ length: 24 }, () => 0);
  const perWeek = Array.from({ length: weeks }, () => 0);
  const thisWeek = weekOf(now);
  const days = new Set<number>();
  let bytes = 0;
  let week = 0;
  for (const e of entries) {
    const size = e.size || 0;
    bytes += size;
    const k = kinds[statKind(e)];
    k.n++;
    k.bytes += size;
    const site = siteOf(e.pageUrl);
    if (site && /^https?:/i.test(e.pageUrl)) {
      const s = sites.get(site) ?? { n: 0, bytes: 0 };
      s.n++;
      s.bytes += size;
      sites.set(site, s);
    }
    const ext = /\.([a-z0-9]{2,4})$/i.exec(e.filename)?.[1]?.toLowerCase();
    if (ext) formats.set(ext, (formats.get(ext) ?? 0) + 1);
    if (now - e.date < 7 * DAY && e.date <= now) week++;
    // Weeks apart, counted on Mondays (a change of clock time doesn't shift it).
    const back = Math.round((thisWeek - weekOf(e.date)) / (7 * DAY));
    if (back >= 0 && back < weeks) perWeek[weeks - 1 - back]!++;
    hours[new Date(e.date).getHours()]!++;
    days.add(dayOf(e.date));
  }
  // Days in a row with something saved.
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = 0;
  for (const d of sorted) {
    run = prev && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const today = dayOf(now);
  const last = sorted[sorted.length - 1];
  const current = last !== undefined && Math.round((today - last) / DAY) <= 1 ? run : 0;
  const top = Math.max(...hours);
  return {
    files: entries.length,
    bytes,
    week,
    perWeek,
    sites: [...sites].map(([site, s]) => ({ site, ...s })).sort((a, b) => b.n - a.n || b.bytes - a.bytes),
    kinds,
    formats: [...formats].map(([format, n]) => ({ format, n })).sort((a, b) => b.n - a.n),
    ...(top > 0 ? { hour: hours.indexOf(top) } : {}),
    streak: { best, now: current },
  };
}
