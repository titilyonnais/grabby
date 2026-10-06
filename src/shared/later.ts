import type { BatchMode } from './batch';
import { uid } from './ids';

/** « À télécharger plus tard »: videos kept aside, downloaded in one go (or at a time chosen). */
export interface LaterItem {
  id: string;
  /** The page of the video (opened behind when it is time), or the video's own address. */
  url: string;
  title: string;
  thumbnail?: string;
  added: number;
  mode: BatchMode;
}

const MAX = 300;

/** Kept aside once: the same page again only moves up the list. */
export function withLater(list: LaterItem[], item: Omit<LaterItem, 'id' | 'added'>, now = Date.now()): LaterItem[] {
  const same = list.find((l) => l.url === item.url);
  const next: LaterItem = { ...item, id: same?.id ?? uid(), added: now, title: item.title.slice(0, 300) };
  return [next, ...list.filter((l) => l.url !== item.url)].slice(0, MAX);
}

/** The next time of day `minutes` past midnight comes (today, or tomorrow when it is past). */
export function nextTime(minutes: number, now = new Date()): number {
  const at = new Date(now);
  at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime();
}
