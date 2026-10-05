import { normalizeMediaUrl } from '../parsers/url';
import type { BgToContent } from '../shared/messages';
import { rank } from '../shared/rank';
import { getSettings } from '../shared/settings';
import type { MediaItem } from '../shared/types';
import type { JobManager } from './jobs';
import type { Registry } from './registry';
import { visibleItems } from './visible';

const same = (a: string, b: string) => normalizeMediaUrl(a) === normalizeMediaUrl(b);

/**
 * The video a right-click (on `srcUrl`) or the keyboard shortcut means: the one with that
 * address when it is listed, else the page's best one. Only what can be downloaded.
 */
export function pickFor(items: MediaItem[], srcUrl?: string): MediaItem | undefined {
  const ok = rank(items).filter((i) => i.protection === 'none' && !i.live);
  if (srcUrl && /^https?:/i.test(srcUrl)) {
    const hit = ok.find((i) => same(i.url, srcUrl) || i.variants.some((v) => v.url && same(v.url, srcUrl)) || i.related?.some((r) => same(r, srcUrl)));
    if (hit) return hit;
  }
  return ok[0];
}

/** Starts the download straight away, in the user's preferred format and the best quality. */
export async function quickDownload(registry: Registry, jobs: JobManager, tabId: number, srcUrl?: string): Promise<void> {
  const items = visibleItems(await registry.get(tabId));
  const item = pickFor(items, srcUrl);
  const say = (ok: boolean, title: string, detail: string) =>
    chrome.tabs.sendMessage(tabId, { type: 'toast', ok, title, detail } satisfies BgToContent, { frameId: 0 }).catch(() => {});
  if (!item) {
    const locked = items.some((i) => i.protection !== 'none');
    await say(false, chrome.i18n.getMessage('quickNone'), chrome.i18n.getMessage(locked ? 'quickProtected' : 'quickNoneBody'));
    return;
  }
  const settings = await getSettings();
  const audio = !!item.audioOnly;
  const job = await jobs.start(tabId, item.id, item.variants[0]?.id, audio ? 'audio' : 'video', audio ? settings.audioFormat : settings.videoFormat);
  if (job) await say(true, chrome.i18n.getMessage('quickStarted'), item.title);
}
