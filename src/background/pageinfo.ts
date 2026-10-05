import { videoFormatsFor } from '../shared/formats';
import { classify } from '../parsers/classify';
import { hashId } from '../shared/ids';
import type { PageInfo, PageVideo, YtInfo } from '../shared/messages';
import type { MediaItem, SubtitleTrack } from '../shared/types';
import { describeSubtitleUrl } from '../shared/subtitles';
import { handleMediaUrl } from './detector';
import type { DetectContext } from './manifests';
import type { Registry } from './registry';
import { listOf, type YtList } from '../shared/ytlist';
import { clock } from '../shared/clip';

const MIN_CAPTURE_WIDTH = 120;

/**
 * Hover previews and decorative loops: short, muted, looping, without controls and small.
 * (Full-width background loops and GIF-like posts stay listed: they can be wanted.)
 */
export function isPreview(v: PageVideo): boolean {
  const short = !Number.isFinite(v.duration) || v.duration <= 60;
  return !!v.loop && !!v.muted && !v.controls && short && v.width > 0 && v.width < 400;
}

const isYouTubeHost = (url: string) => /^https?:\/\/([\w-]+\.)*youtube\.com\//i.test(url);

/** A list from a page, kept only as far as it makes sense. */
function cleanList(l: YtList): YtList | null {
  if (!l || (l.kind !== 'playlist' && l.kind !== 'channel') || !Array.isArray(l.entries)) return null;
  const raw = l.entries.map((e) => ({ href: `https://www.youtube.com/watch?v=${String(e?.id)}`, title: String(e?.title ?? ''), ...(Number(e?.duration) > 0 ? { duration: clock(Number(e.duration)) } : {}) }));
  return listOf(l.kind, String(l.title ?? ''), raw);
}

/** The video of a YouTube watch page, with the player's qualities and sizes. */
async function upsertYouTube(registry: Registry, ctx: DetectContext, frameId: number, info: PageInfo): Promise<string> {
  const yt = info.youtube!;
  const p = yt.player;
  const main = info.videos.find((v) => v.isMse) ?? info.videos[0];
  const variants = (p?.qualities ?? []).map((q) => ({
    id: q.quality,
    label: q.label,
    height: q.height,
    url: '',
    sizes: q.sizes,
    codecs: [q.avc && 'avc1', q.vp9 && 'vp9'].filter(Boolean).join(','),
  }));
  const item = captureItem(ctx, frameId, main?.index ?? 0, {
    title: yt.title,
    experimental: true,
    formats: ['mp4', 'webm', 'mkv'],
    variants,
    ...(yt.thumbnail ? { thumbnail: yt.thumbnail } : {}),
    ...((p?.duration ?? yt.duration) ? { duration: p?.duration ?? yt.duration } : {}),
    // Recorded discreetly by a hidden player when YouTube allows embedding it.
    ...(p?.embeddable ? { ytId: p.id } : {}),
    ...(variants[0]?.sizes.mp4 ? { size: variants[0].sizes.mp4 } : {}),
    ...(p?.captions?.length ? { subtitles: youtubeSubs(p.captions, p.translations) } : {}),
    ...(p?.author ? { author: p.author.slice(0, 200) } : {}),
    ...(p?.chapters?.length ? { chapters: p.chapters.slice(0, 200) } : {}),
  });
  // One item per YouTube video id (the page URL changes between videos).
  item.id = hashId(`yt:${ctx.pageUrl}`);
  await registry.upsert(ctx.tabId, item);
  return item.id;
}

/** A player's <track>s as subtitle choices. */
function trackSubs(v: PageVideo): SubtitleTrack[] {
  const seen = new Set<string>();
  return (v.tracks ?? [])
    .filter((t) => typeof t.src === 'string' && /^https?:/i.test(t.src) && !seen.has(t.src) && seen.add(t.src))
    .map((t) => {
      const guess = describeSubtitleUrl(t.src);
      const lang = typeof t.lang === 'string' && t.lang ? t.lang.slice(0, 20) : guess.lang;
      return {
        id: hashId(t.src),
        url: t.src,
        label: (typeof t.label === 'string' && t.label.slice(0, 80)) || lang || guess.label,
        ...(lang ? { lang } : {}),
        ...(t.isDefault ? { isDefault: true } : {}),
      };
    });
}

/**
 * YouTube's subtitles, the ones made by speech recognition said so. When none is in the
 * browser's language but YouTube can translate into it, a translated track is offered too.
 */
export function youtubeSubs(captions: NonNullable<YtInfo['captions']>, translations: string[] = [], ui = uiLanguage()): SubtitleTrack[] {
  const own = captions
    .filter((c) => typeof c.url === 'string' && /^https:\/\/([\w-]+\.)*youtube\.com\//.test(c.url))
    .slice(0, 40)
    .map<SubtitleTrack>((c) => ({
      id: hashId(c.url),
      url: c.url,
      // YouTube's own name already says when they are made automatically.
      label: c.name || c.lang,
      lang: c.lang,
      ...(c.auto ? { auto: true } : {}),
    }));
  const base = (l: string) => l.toLowerCase().split(/[-_]/)[0]!;
  const into = translations.find((t) => base(t) === base(ui));
  const source = own.find((c) => !c.auto) ?? own[0];
  if (!into || !source || own.some((c) => !c.auto && base(c.lang!) === base(ui))) return own;
  return [...own, { id: hashId(`${source.url}#tlang=${into}`), url: source.url, label: source.label, lang: source.lang!, ...(source.auto ? { auto: true } : {}), tlang: into }];
}

const uiLanguage = (): string => (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) || 'en';

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

/** Probing costs a request each: a page naming dozens of files gets its first ones checked. */
const MAX_DECLARED = 12;

/** Merges what a content script saw in a frame (titles, <video> elements, MSE players). */
export async function handlePageInfo(registry: Registry, sender: chrome.runtime.MessageSender, info: PageInfo): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || tabId < 0) return;
  const frameId = sender.frameId ?? 0;
  const pageUrl = sender.tab?.url ?? '';
  const frameUrl = sender.url ?? pageUrl;
  const ctx: DetectContext = { tabId, frameUrl, pageUrl };

  if (frameId === 0) {
    await registry.setPageInfo(tabId, {
      title: info.title,
      ...(info.thumbnail ? { thumbnail: info.thumbnail } : {}),
      ...(info.image ? { image: info.image } : {}),
    });
    // A playlist or a channel: its videos, checked again (the page may say anything).
    if (isYouTubeHost(pageUrl)) await registry.setYtList(tabId, info.ytList ? cleanList(info.ytList) : null);
  }

  for (const url of info.streams ?? []) {
    if (typeof url === 'string' && /^https?:/i.test(url)) {
      await handleMediaUrl(registry, url, ctx, {});
    }
  }

  // Videos the page names but hasn't played (yet): each is checked from its first bytes.
  for (const url of (info.declared ?? []).slice(0, MAX_DECLARED)) {
    if (typeof url === 'string' && /^https?:/i.test(url)) {
      await handleMediaUrl(registry, url, ctx, { requestType: 'declared' });
    }
  }

  const keep = new Set<string>();

  // Hover previews and decorative loops: remember them so their files stay unlisted.
  const previews = info.videos.filter(isPreview);
  if (previews.length) {
    await registry.addPreviews(
      tabId,
      previews.map((v) => ({ url: v.src, frameUrl, ...(Number.isFinite(v.duration) ? { duration: v.duration } : {}) })),
    );
  }
  if (info.snapshot) await registry.setFrameThumb(tabId, frameUrl, info.snapshot);

  if (info.youtube) {
    keep.add(await upsertYouTube(registry, ctx, frameId, info));
  } else if (!isYouTubeHost(pageUrl)) {
    for (const v of info.videos) {
      if (previews.includes(v)) continue;
      if (v.isMse) {
        if (v.width && v.width < MIN_CAPTURE_WIDTH) continue;
        const live = v.duration === Infinity;
        const item = captureItem(ctx, frameId, v.index, {
          live,
          protection: v.isProtected ? 'drm' : 'none',
          formats: videoFormatsFor(''),
          ...(Number.isFinite(v.duration) && v.duration > 0 ? { duration: v.duration } : {}),
          ...(v.poster ? { thumbnail: v.poster } : {}),
          ...(trackSubs(v).length ? { subtitles: trackSubs(v) } : {}),
          ...(v.chapters?.length ? { chapters: v.chapters.slice(0, 200) } : {}),
        });
        keep.add(item.id);
        await registry.upsert(tabId, item);
      } else if (/^https?:/i.test(v.src)) {
        const subs = trackSubs(v);
        if (subs.length) await registry.setVideoSubs(tabId, v.src, subs);
        if (v.chapters?.length) await registry.setVideoChapters(tabId, v.src, v.chapters.slice(0, 200));
        // A <video src> is a video even when its URL doesn't say so (".pmp4", no extension).
        await handleMediaUrl(registry, v.src, ctx, classify({ url: v.src }) ? {} : { contentType: 'video/mp4' });
      }
    }
  }

  // Drop capture items for videos that disappeared from this frame.
  await registry.removeWhere(tabId, (i) => i.kind === 'capture' && i.frameUrl === frameUrl && !keep.has(i.id));
}
