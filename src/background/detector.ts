import { isAdUrl } from '../parsers/adhosts';
import { classify, isAudioResource } from '../parsers/classify';
import { extOf, normalizeMediaUrl } from '../parsers/url';
import { fetchTextAs } from './headers';
import { fileItem, resolveDash, resolveHls, type DetectContext } from './manifests';
import { probeFile } from './probe';
import type { Registry } from './registry';
import { rememberTabUrl, tabUrl } from './tabs';
import { isSubtitleFile } from '../shared/subtitles';

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

const sameMedia = (a: string, b: string) => normalizeMediaUrl(a) === normalizeMediaUrl(b);
/** MP3/AAC streams hold only sound; Ogg does too, except Theora video (.ogv, video/ogg). */
function isAudioProbe(probe: { container: string } | null | undefined, url: string, contentType = ''): boolean {
  if (!probe) return false;
  if (probe.container === 'mp3' || probe.container === 'aac') return true;
  return probe.container === 'ogg' && extOf(url) !== 'ogv' && !contentType.toLowerCase().startsWith('video/');
}

/** Shorter files are UI sounds, loaders or bumpers. */
const MIN_FILE_SECONDS = 2;

export async function handleMediaUrl(
  registry: Registry,
  url: string,
  ctx: DetectContext,
  info: { contentType?: string; size?: number; totalSize?: number; requestType?: string },
): Promise<void> {
  const kind = classify({ url, ...info });
  if (!kind) return;
  const declared = info.requestType === 'declared';
  // Named by the page: nothing to learn if it is already listed (it may even be playing).
  if (declared && (await registry.get(ctx.tabId)).some((i) => sameMedia(i.url, url) || i.related?.some((r) => sameMedia(r, url)))) return;
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
    const size = info.totalSize ?? info.size ?? probe?.size;
    await registry.upsert(
      ctx.tabId,
      fileItem(url, ctx, {
        ...(info.contentType ? { mime: info.contentType.split(';')[0]!.trim() } : {}),
        ...(size ? { size } : {}),
        ...(probe?.duration ? { duration: probe.duration } : {}),
        ...(probe?.width && probe.height ? { width: probe.width, height: probe.height } : {}),
        ...(probe?.encrypted ? { protection: 'drm' as const } : {}),
        audioOnly: isAudioResource(url, info.contentType) || isAudioProbe(probe, url, info.contentType),
        ...(declared ? { linked: true } : {}),
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
      const contentType = header(d.responseHeaders, 'content-type');
      const len = Number(header(d.responseHeaders, 'content-length') ?? 0) || undefined;
      const totalSize = totalFromRange(header(d.responseHeaders, 'content-range'));
      const requestType = d.type;
      // Subtitles a player loads: offered with the video of that frame.
      if (isSubtitleFile(d.url, contentType)) {
        void (async () => {
          const pageUrl = await tabUrl(d.tabId);
          const frameUrl = (d as { documentUrl?: string }).documentUrl ?? (d.frameId === 0 ? pageUrl : d.initiator ?? pageUrl);
          await registry.addFrameSub(d.tabId, frameUrl, d.url);
        })();
        return;
      }
      if (!classify({ url: d.url, requestType, ...(contentType ? { contentType } : {}), ...(len ? { size: len } : {}), ...(totalSize ? { totalSize } : {}) })) return;

      void (async () => {
        const pageUrl = await tabUrl(d.tabId);
        const frameUrl = (d as { documentUrl?: string }).documentUrl ?? (d.frameId === 0 ? pageUrl : d.initiator ?? pageUrl);
        await handleMediaUrl(registry, d.url, { tabId: d.tabId, frameUrl, pageUrl }, {
          requestType,
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
