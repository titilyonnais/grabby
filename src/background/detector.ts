import { classify, isAudioResource } from '../parsers/classify';
import { isYouTubeUrl, youtubeBlocked } from '../shared/policy';
import { fetchTextAs } from './headers';
import { fileItem, resolveDash, resolveHls, type DetectContext } from './manifests';
import type { Registry } from './registry';
import { rememberTabUrl, tabUrl } from './tabs';

function header(headers: chrome.webRequest.HttpHeader[] | undefined, name: string): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value;
}

function totalFromRange(v: string | undefined): number | undefined {
  const m = v ? /\/(\d+)\s*$/.exec(v) : null;
  return m ? Number(m[1]) : undefined;
}

/** Returns true if detection must be skipped for this request (YouTube in the store build). */
export function blockedByPolicy(...urls: (string | undefined)[]): boolean {
  return youtubeBlocked() && urls.some((u) => !!u && isYouTubeUrl(u));
}

export async function handleMediaUrl(
  registry: Registry,
  url: string,
  ctx: DetectContext,
  info: { contentType?: string; size?: number; totalSize?: number },
): Promise<void> {
  const kind = classify({ url, ...info });
  if (!kind) return;
  if (kind === 'hls') {
    const item = await resolveHls(url, ctx, fetchTextAs);
    if (item) await registry.upsert(ctx.tabId, item);
  } else if (kind === 'dash') {
    const item = await resolveDash(url, ctx, fetchTextAs);
    if (item) await registry.upsert(ctx.tabId, item);
  } else {
    const size = info.totalSize ?? info.size;
    await registry.upsert(
      ctx.tabId,
      fileItem(url, ctx, {
        ...(info.contentType ? { mime: info.contentType.split(';')[0]!.trim() } : {}),
        ...(size ? { size } : {}),
        audioOnly: isAudioResource(url, info.contentType),
      }),
    );
  }
}

/** Observes (never modifies) responses to find media resources in every tab. */
export function startDetector(registry: Registry): void {
  const ownOrigin = new URL(chrome.runtime.getURL('')).origin;

  chrome.webRequest.onHeadersReceived.addListener(
    (d): undefined => {
      if (d.tabId < 0) return;
      if (d.statusCode !== 200 && d.statusCode !== 206) return;
      if (d.type === 'main_frame') {
        // A new document always arrives before its own sub-resources: reset here, in order.
        rememberTabUrl(d.tabId, d.url);
        void registry.clear(d.tabId);
        return;
      }
      if (d.initiator === ownOrigin) return;
      const contentType = header(d.responseHeaders, 'content-type');
      const len = Number(header(d.responseHeaders, 'content-length') ?? 0) || undefined;
      const totalSize = totalFromRange(header(d.responseHeaders, 'content-range'));
      if (!classify({ url: d.url, ...(contentType ? { contentType } : {}), ...(len ? { size: len } : {}), ...(totalSize ? { totalSize } : {}) })) return;

      void (async () => {
        const pageUrl = await tabUrl(d.tabId);
        const frameUrl = (d as { documentUrl?: string }).documentUrl ?? (d.frameId === 0 ? pageUrl : d.initiator ?? pageUrl);
        if (blockedByPolicy(d.url, pageUrl, frameUrl)) return;
        await handleMediaUrl(registry, d.url, { tabId: d.tabId, frameUrl, pageUrl }, {
          ...(contentType ? { contentType } : {}),
          ...(len ? { size: len } : {}),
          ...(totalSize ? { totalSize } : {}),
        });
      })();
    },
    { urls: ['<all_urls>'], types: ['main_frame', 'media', 'xmlhttprequest', 'other', 'object'] },
    ['responseHeaders'],
  );
}
