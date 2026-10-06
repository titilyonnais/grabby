import { normalizeMediaUrl } from '../parsers/url';
import type { BgToContent } from '../shared/messages';
import { rank } from '../shared/rank';
import { applyRule, newRule, ruleFor } from '../shared/rules';
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
export async function quickDownload(registry: Registry, jobs: JobManager, tabId: number, srcUrl?: string, mode?: 'video' | 'audio'): Promise<void> {
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
  const job = await startWithRules(jobs, tabId, item, settings, mode);
  if (job) await say(true, chrome.i18n.getMessage('quickStarted'), item.title);
}

/**
 * A download started without the popup: what the site's rule says (else the settings: the
 * best quality, the video or its sound as chosen for the shortcut). `mode` forces one.
 */
export async function startWithRules(jobs: JobManager, tabId: number, item: MediaItem, settings: Settings, mode?: 'video' | 'audio') {
  const rule = ruleFor(settings.rules, item.pageUrl);
  const asked = mode ?? (rule ? rule.mode : settings.quickMode);
  const c = applyRule(item, { ...(rule ?? newRule()), mode: asked }, { video: settings.videoFormat, audio: settings.audioFormat });
  return jobs.start(tabId, item.id, c.variantId ?? item.variants[0]?.id, c.mode, c.format, {
    ...(c.subtitles.length ? { subtitles: { ids: c.subtitles, separate: false } } : {}),
    ...(c.folder ? { folder: c.folder } : {}),
  });
}
