import type { Job, MediaItem } from '../shared/types';
import { downloadableCount } from './visible';

const ACCENT = '#FF5B4F';
const PROGRESS = '#2F6BFF';
const DONE = '#1F9D55';
const FAILED = '#D93025';
const RUNNING: Job['status'][] = ['queued', 'downloading', 'capturing', 'processing', 'saving'];
/** How long ✓ / ! stays on the icon after a download ends. */
const FLASH_MS = 6000;

interface Override {
  text: string;
  color: string;
  title: string;
}

/** What the icon shows while downloads run: it applies to every tab, over the video count. */
let override: Override | null = null;
const counts = new Map<number, number>();
let running = new Set<string>();
let flashTimer: ReturnType<typeof setTimeout> | undefined;
let lastJobs: Job[] = [];

const defaultTitle = () => chrome.runtime.getManifest().action?.default_title ?? 'Grabby';

async function paint(tabId: number): Promise<void> {
  const n = counts.get(tabId) ?? 0;
  const text = override ? override.text : n ? String(Math.min(n, 99)) : '';
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: override?.color ?? ACCENT });
      await chrome.action.setBadgeTextColor?.({ tabId, color: '#FFFFFF' });
    }
    await chrome.action.setTitle({ tabId, title: override?.title ?? defaultTitle() });
  } catch {
    // tab closed meanwhile
  }
}

async function paintAll(): Promise<void> {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(tabs.map((t) => (t.id !== undefined ? paint(t.id) : undefined)));
}

/** Number of videos found in a tab (shown when no download is running). */
export async function updateBadge(tabId: number, items: MediaItem[]): Promise<void> {
  counts.set(tabId, downloadableCount(items));
  await paint(tabId);
}

export function forgetBadge(tabId: number): void {
  counts.delete(tabId);
}

/** A newly activated or loaded tab shows the current download state too. */
export function paintTab(tabId: number): Promise<void> {
  return paint(tabId);
}

/** Pure: what the icon says for a set of jobs (unit-tested). */
export function progressBadge(jobs: Job[]): Override | null {
  const active = jobs.filter((j) => RUNNING.includes(j.status));
  if (!active.length) return null;
  const started = active.filter((j) => j.status !== 'queued');
  if (!started.length) return { text: '…', color: PROGRESS, title: chrome.i18n.getMessage('badgeQueued') };
  const p = started.reduce((sum, j) => sum + j.progress, 0) / started.length;
  const pct = String(Math.min(99, Math.floor(p * 100)));
  const name = active.length === 1 ? active[0]!.title : chrome.i18n.getMessage('badgeMany', [String(active.length)]);
  return { text: `${pct}%`, color: PROGRESS, title: chrome.i18n.getMessage('badgeProgress', [pct, name]) };
}

/** Called on every job change: progress while it runs, then ✓ (or !) for a few seconds. */
export function showJobs(jobs: Job[]): void {
  lastJobs = jobs;
  const now = new Set(jobs.filter((j) => RUNNING.includes(j.status)).map((j) => j.id));
  const ended = jobs.filter((j) => running.has(j.id) && !now.has(j.id) && j.status !== 'canceled');
  running = now;

  let next = progressBadge(jobs);
  if (!next && ended.length) {
    const ok = ended.every((j) => j.status === 'done');
    next = ok
      ? { text: '✓', color: DONE, title: chrome.i18n.getMessage('notifyDone') }
      : { text: '!', color: FAILED, title: chrome.i18n.getMessage('notifyFailed') };
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      override = progressBadge(lastJobs);
      void paintAll();
    }, FLASH_MS);
  } else if (next) {
    clearTimeout(flashTimer);
  } else if (flashTimer && override) {
    return; // the ✓ stays until its timer ends
  }
  if (next?.text === override?.text && next?.title === override?.title) return;
  override = next;
  void paintAll();
}
