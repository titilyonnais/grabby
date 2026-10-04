import { isAdUrl } from '../parsers/adhosts';
import { classify, isAudioResource } from '../parsers/classify';
import { isYouTubeUrl, youtubeBlocked } from '../shared/policy';
import { fetchTextAs } from './headers';
import { fileItem, resolveDash, resolveHls, type DetectContext } from './manifests';
import { probeFile } from './probe';
import type { Registry } from './registry';
import { rememberTabUrl, tabUrl } from './tabs';

function header(headers: chrome.webRequest.HttpHeader[] | undefined, name: string): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value;
}

function totalFromRange(v: string | undefined): number | undefined {
  const m = v ? /\/(\d+)\s*$/.exec(v) : null;
  return m ? Number(m[1]) : undefined;
}

/**
 * A main_frame response that becomes a download (attachment, binary) or a prerendered
 * page the user hasn't opened yet leaves the current page in place.
 */
export function replacesPage(d: { responseHeaders?: chrome.webRequest.HttpHeader[]; documentLifecycle?: string }): boolean {
  if (d.documentLifecycle === 'prerender') return false;
  if (/^\s*attachment/i.test(header(d.responseHeaders, 'content-disposition') ?? '')) return false;
  const type = (header(d.responseHeaders, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  return !/^application\/(octet-stream|zip|x-zip-compressed|x-msdownload|x-7z-compressed|x-rar-compressed|x-tar|gzip|x-gzip)$/.test(type);
}

/** Returns true if detection must be skipped for this request (YouTube in the store build). */
export function blockedByPolicy(...urls: (string | undefined)[]): boolean {
  return youtubeBlocked() && urls.some((u) => !!u && isYouTubeUrl(u));
}

/** Shorter files are UI sounds, loaders or bumpers. */
const MIN_FILE_SECONDS = 2;

export async function handleMediaUrl(
  registry: Registry,
  url: string,
  ctx: DetectContext,
  info: { contentType?: string; size?: number; totalSize?: number },
): Promise<void> {
  const kind = classify({ url, ...info });
  if (!kind) return;
  // Ad creatives (and anything inside an ad frame) are never the video being watched.
  if (isAdUrl(url) || isAdUrl(ctx.frameUrl)) return;
  if (kind === 'hls') {
    const item = await resolveHls(url, ctx, fetchTextAs);
    if (item) await registry.upsert(ctx.tabId, item);
  } else if (kind === 'dash') {
    const item = await resolveDash(url, ctx, fetchTextAs);
    if (item) await registry.upsert(ctx.tabId, item);
  } else {
    // Look inside before listing: error pages, encrypted (DRM) media and tiny clips are
    // not downloadable videos.
    const probe = await probeFile(url, ctx.pageUrl);
    if (probe === null) return;
    if (probe?.duration !== undefined && probe.duration < MIN_FILE_SECONDS) return;
    const size = info.totalSize ?? info.size;
    await registry.upsert(
      ctx.tabId,
      fileItem(url, ctx, {
        ...(info.contentType ? { mime: info.contentType.split(';')[0]!.trim() } : {}),
        ...(size ? { size } : {}),
        ...(probe?.duration ? { duration: probe.duration } : {}),
        ...(probe?.encrypted ? { protection: 'drm' as const } : {}),
        audioOnly: isAudioResource(url, info.contentType),
      }),
    );
  }
}

/** Observes (never modifies) responses to find media resources in every tab. */
export function startDetector(registry: Registry, onNavigate: (tabId: number) => void = () => {}): void {
  const ownOrigin = new URL(chrome.runtime.getURL('')).origin;

  chrome.webRequest.onHeadersReceived.addListener(
    (d): undefined => {
      if (d.tabId < 0) return;
      if (d.statusCode !== 200 && d.statusCode !== 206) return;
      if (d.type === 'main_frame') {
        if (!replacesPage(d)) return;
        // A new document always arrives before its own sub-resources: reset here, in order.
        rememberTabUrl(d.tabId, d.url);
        void registry.clear(d.tabId);
        onNavigate(d.tabId);
        return;
      }
      if (d.initiator === ownOrigin) return;
      if (blockedByPolicy(d.url)) {
        // A frame streaming from YouTube's CDN (mirror, custom player…) never gets playback capture.
        const frameUrl = (d as { documentUrl?: string }).documentUrl;
        if (frameUrl) void registry.blockFrame(d.tabId, frameUrl);
        return;
      }
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
