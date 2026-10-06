/**
 * "Sauvegarder ses réglages": settings, rules, history and followed channels in one JSON
 * file, to take to another computer or browser. Importing merges: nothing already there is
 * lost, and only what makes sense is read from the file.
 */
import { cleanRules } from '../shared/rules';
import { DEFAULT_SETTINGS, getSettings, setSettings, type Settings } from '../shared/settings';
import type { HistoryEntry } from '../shared/types';
import { getHistory } from './history';
import { getWatches, syncWatchAlarm, type Watch } from './watch';

export interface Backup {
  app: 'grabby';
  version: string;
  exported: string;
  settings: Partial<Settings>;
  history: HistoryEntry[];
  watches: Watch[];
}

export async function exportBackup(): Promise<Backup> {
  const [settings, history, watches] = await Promise.all([getSettings(), getHistory(), getWatches()]);
  return { app: 'grabby', version: chrome.runtime.getManifest().version, exported: new Date().toISOString(), settings, history, watches };
}

/** The settings of a file: known ones, of the right kind; the rest stays as it is. */
export function cleanSettings(input: unknown): Partial<Settings> {
  if (!input || typeof input !== 'object') return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = src[k];
    if (v === undefined || k === 'rules' || k === 'firstRunAck') continue;
    if (typeof v === typeof def && (typeof v !== 'string' || v.length <= 200) && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v;
  }
  if ('rules' in src) out.rules = cleanRules(src.rules);
  return out as Partial<Settings>;
}

const str = (v: unknown, max = 2000): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** History entries of a file: what describes a download; never another browser's download ids. */
export function cleanHistory(input: unknown): HistoryEntry[] {
  if (!Array.isArray(input)) return [];
  const out: HistoryEntry[] = [];
  for (const e of input.slice(0, 1000) as Record<string, unknown>[]) {
    const id = str(e?.id, 60);
    const filename = str(e?.filename, 400);
    const title = str(e?.title, 400);
    const pageUrl = str(e?.pageUrl);
    if (!id || !filename || title === undefined || pageUrl === undefined) continue;
    const thumb = str(e.thumbnail, 120_000);
    out.push({
      id,
      filename,
      title,
      pageUrl: /^https?:/i.test(pageUrl) ? pageUrl : '',
      size: typeof e.size === 'number' && e.size >= 0 ? e.size : 0,
      date: typeof e.date === 'number' ? e.date : 0,
      ...(thumb && /^(https?:|data:image\/)/i.test(thumb) ? { thumbnail: thumb } : {}),
      ...(str(e.quality, 20) ? { quality: str(e.quality, 20)! } : {}),
      ...(e.mode === 'audio' || e.mode === 'video' ? { mode: e.mode } : {}),
      ...(typeof e.format === 'string' && /^[a-z0-9]{2,5}$/.test(e.format) ? { format: e.format as HistoryEntry['format'] } : {}),
    });
  }
  return out;
}

export function cleanWatches(input: unknown): Watch[] {
  if (!Array.isArray(input)) return [];
  const out: Watch[] = [];
  for (const w of input.slice(0, 50) as Record<string, unknown>[]) {
    const kind = w?.kind === 'playlist' ? 'playlist' : w?.kind === 'channel' ? 'channel' : null;
    const key = str(w?.key, 80);
    if (!kind || !key || !/^[\w-]+$/.test(key)) continue;
    out.push({
      id: str(w.id, 40) || key,
      kind,
      key,
      title: str(w.title, 200) || key,
      mode: w.mode === 'audio' ? 'audio' : 'video',
      quality: str(w.quality, 20) || 'hd1080',
      ...(typeof w.format === 'string' && /^[a-z0-9]{2,5}$/.test(w.format) ? { format: w.format as Watch['format'] } : {}),
      since: typeof w.since === 'number' ? w.since : Date.now(),
      seen: Array.isArray(w.seen) ? w.seen.filter((s): s is string => typeof s === 'string' && /^[\w-]{11}$/.test(s)).slice(0, 300) : [],
      got: typeof w.got === 'number' ? w.got : 0,
    });
  }
  return out;
}

export interface ImportResult {
  settings: number;
  rules: number;
  history: number;
  watches: number;
}

/** Reads a backup into this browser; null when the file isn't one of Grabby's. */
export async function importBackup(data: unknown): Promise<ImportResult | null> {
  if (!data || typeof data !== 'object' || (data as { app?: unknown }).app !== 'grabby') return null;
  const b = data as Partial<Backup>;
  const settings = cleanSettings(b.settings);
  const history = cleanHistory(b.history);
  const watches = cleanWatches(b.watches);
  if (Object.keys(settings).length) await setSettings(settings);
  const mine = await getHistory();
  const known = new Set(mine.map((e) => e.id));
  const added = history.filter((e) => !known.has(e.id));
  if (added.length) await chrome.storage.local.set({ history: [...mine, ...added].sort((a, b2) => b2.date - a.date).slice(0, 500) });
  const followed = await getWatches();
  const newWatches = watches.filter((w) => !followed.some((f) => f.kind === w.kind && f.key === w.key));
  if (newWatches.length) {
    await chrome.storage.local.set({ watches: [...followed, ...newWatches].slice(0, 50) });
    await syncWatchAlarm();
  }
  return { settings: Object.keys(settings).length, rules: settings.rules?.length ?? 0, history: added.length, watches: newWatches.length };
}
