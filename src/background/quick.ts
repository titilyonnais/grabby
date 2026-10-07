import { normalizeMediaUrl } from '../parsers/url';
import type { BgToContent } from '../shared/messages';
import { rank } from '../shared/rank';
import { getSettings, type Settings } from '../shared/settings';
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
export async function quickDownload(registry: Registry, jobs: JobManager, tabId: number, srcUrl?: string, mode?: 'video' | 'audio', variantId?: string): Promise<void> {
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
  const job = await startQuick(jobs, tabId, item, settings, mode, variantId);
  if (job) await say(true, chrome.i18n.getMessage('quickStarted'), item.title);
}

/**
 * A download started without the popup: the best quality, the video or its sound as chosen
 * for the shortcut, in the settings' format. `mode` forces one, and `variantId` a quality
 * (YouTube's menu under the player).
 */
export async function startQuick(jobs: JobManager, tabId: number, item: MediaItem, settings: Settings, mode?: 'video' | 'audio', variantId?: string) {
  const audio = !!item.audioOnly || (mode ?? settings.quickMode) === 'audio';
  const chosen = audio ? undefined : variantId && item.variants.some((v) => v.id === variantId) ? variantId : item.variants[0]?.id;
  return jobs.start(tabId, item.id, chosen, audio ? 'audio' : 'video', audio ? settings.audioFormat : settings.videoFormat);
}
