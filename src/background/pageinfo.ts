import { classify } from '../parsers/classify';
import { hashId } from '../shared/ids';
import type { PageInfo } from '../shared/messages';
import type { MediaItem } from '../shared/types';
import { blockedByPolicy, handleMediaUrl } from './detector';
import { fileItem, type DetectContext } from './manifests';
import type { Registry } from './registry';

const MIN_CAPTURE_WIDTH = 120;

function captureItem(ctx: DetectContext, frameId: number, index: number, over: Partial<MediaItem>): MediaItem {
  return {
    id: hashId(`${ctx.frameUrl}#video${index}`),
    tabId: ctx.tabId,
    frameUrl: ctx.frameUrl,
    pageUrl: ctx.pageUrl,
    kind: 'capture',
    url: ctx.frameUrl,
    title: '',
    variants: [],
    audioTracks: [],
    protection: 'none',
    live: false,
    detectedAt: Date.now(),
    frameId,
    videoIndex: index,
    ...over,
  };
}

/** Merges what a content script saw in a frame (titles, <video> elements, MSE players). */
export async function handlePageInfo(registry: Registry, sender: chrome.runtime.MessageSender, info: PageInfo): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || tabId < 0) return;
  const frameId = sender.frameId ?? 0;
  const pageUrl = sender.tab?.url ?? '';
  const frameUrl = sender.url ?? pageUrl;
  if (blockedByPolicy(frameUrl, pageUrl)) return;
  const ctx: DetectContext = { tabId, frameUrl, pageUrl };

  if (frameId === 0) {
    await registry.setPageInfo(tabId, { title: info.title, ...(info.thumbnail ? { thumbnail: info.thumbnail } : {}) });
  }

  for (const url of info.streams ?? []) {
    if (typeof url === 'string' && /^https?:/i.test(url) && !blockedByPolicy(url)) {
      await handleMediaUrl(registry, url, ctx, {});
    }
  }

  const keep = new Set<string>();

  if (__TARGET__ === 'github' && info.youtube) {
    const main = info.videos.find((v) => v.isMse) ?? info.videos[0];
    const item = captureItem(ctx, frameId, main?.index ?? 0, {
      title: info.youtube.title,
      experimental: true,
      ...(info.youtube.thumbnail ? { thumbnail: info.youtube.thumbnail } : {}),
      ...(info.youtube.duration ? { duration: info.youtube.duration } : {}),
    });
    // One item per YouTube video id (the page URL changes between videos).
    item.id = hashId(`yt:${pageUrl}`);
    keep.add(item.id);
    await registry.upsert(tabId, item);
  } else {
    for (const v of info.videos) {
      if (v.isMse) {
        if (v.width && v.width < MIN_CAPTURE_WIDTH) continue;
        const live = v.duration === Infinity;
        const item = captureItem(ctx, frameId, v.index, {
          live,
          protection: v.isProtected ? 'drm' : 'none',
          ...(Number.isFinite(v.duration) && v.duration > 0 ? { duration: v.duration } : {}),
          ...(v.poster ? { thumbnail: v.poster } : {}),
        });
        keep.add(item.id);
        await registry.upsert(tabId, item);
      } else if (/^https?:/i.test(v.src)) {
        const kind = classify({ url: v.src });
        if (kind) {
          await handleMediaUrl(registry, v.src, ctx, {});
        } else {
          await registry.upsert(tabId, fileItem(v.src, ctx, {}));
        }
      }
    }
  }

  // Drop capture items for videos that disappeared from this frame.
  await registry.removeWhere(tabId, (i) => i.kind === 'capture' && i.frameUrl === frameUrl && !keep.has(i.id));
}
