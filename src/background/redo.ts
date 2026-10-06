import type { BgToContent } from '../shared/messages';
import type { HistoryEntry } from '../shared/types';
import type { JobManager } from './jobs';
import { pickFor } from './quick';
import type { Registry } from './registry';
import { visibleItems } from './visible';

/** How long a page opened again has to show its video. */
const WAIT_MS = 90_000;

/** Pages opened again from the history, waiting for their video: tab → what to download. */
const pending = new Map<number, { entry: HistoryEntry; until: number }>();

/**
 * "Download again": the page opens again in a tab behind the current one; as soon as Grabby
 * finds its video there, the download starts like the first time (same kind, format and
 * quality when the page still has it).
 */
export async function redo(entry: HistoryEntry): Promise<void> {
  if (!/^https?:/i.test(entry.pageUrl)) return;
  const tab = await chrome.tabs.create({ url: entry.pageUrl, active: false });
  if (tab.id !== undefined) pending.set(tab.id, { entry, until: Date.now() + WAIT_MS });
}

/** A tab's videos changed: a page opened again from the history starts its download. */
export async function redoIfWaiting(tabId: number, registry: Registry, jobs: JobManager): Promise<void> {
  const wait = pending.get(tabId);
  if (!wait) return;
  if (Date.now() > wait.until) {
    pending.delete(tabId);
    return;
  }
  const item = pickFor(visibleItems(await registry.get(tabId)));
  if (!item || !pending.has(tabId)) return;
  pending.delete(tabId);
  const { entry } = wait;
  const mode = entry.mode ?? (item.audioOnly ? 'audio' : 'video');
  const variant = item.variants.find((v) => v.label === entry.quality) ?? item.variants[0];
  const job = await jobs.start(tabId, item.id, variant?.id, mode, entry.format);
  if (job) {
    const msg: BgToContent = { type: 'toast', ok: true, title: chrome.i18n.getMessage('quickStarted'), detail: item.title };
    await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => {});
  }
}

export const forgetRedo = (tabId: number) => pending.delete(tabId);
