import { parseDash } from '../parsers/dash';
import { parseHls } from '../parsers/hls';
import { normalizeMediaUrl, reachableFrom } from '../parsers/url';
import { qualityLabel } from '../shared/format';
import { hashId } from '../shared/ids';
import type { AudioTrack, MediaItem, Variant } from '../shared/types';

export interface DetectContext {
  tabId: number;
  frameUrl: string;
  pageUrl: string;
}

type FetchText = (url: string, pageUrl: string) => Promise<string>;

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; p: Promise<MediaItem | null> }>();

function cached(url: string, make: () => Promise<MediaItem | null>): Promise<MediaItem | null> {
  const key = normalizeMediaUrl(url);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.p;
  const p = make().catch(() => null);
  cache.set(key, { at: now, p });
  if (cache.size > 200) {
    for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k);
  }
  return p;
}

const baseItem = (url: string, ctx: DetectContext, kind: MediaItem['kind']): MediaItem => ({
  id: hashId(normalizeMediaUrl(url)),
  tabId: ctx.tabId,
  frameUrl: ctx.frameUrl,
  pageUrl: ctx.pageUrl,
  kind,
  url,
  title: '',
  variants: [],
  audioTracks: [],
  protection: 'none',
  live: false,
  detectedAt: Date.now(),
});

export function resolveHls(url: string, ctx: DetectContext, fetchText: FetchText): Promise<MediaItem | null> {
  return cached(url, async () => {
    const parsed = parseHls(await fetchText(url, ctx.pageUrl), url);
    const item = baseItem(url, ctx, 'hls');
    item.mime = 'application/vnd.apple.mpegurl';

    if (parsed.type === 'master') {
      item.related = [...parsed.variants.map((v) => v.url), ...parsed.audio.flatMap((a) => (a.url ? [a.url] : []))];
      const sorted = parsed.variants.filter((v) => reachableFrom(url, v.url)).sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth);
      const seen = new Set<string>();
      item.variants = sorted
        .map<Variant>((v) => ({
          id: hashId(v.url),
          label: qualityLabel(v.height, v.bandwidth) || 'Auto',
          url: v.url,
          bandwidth: v.bandwidth,
          ...(v.width ? { width: v.width } : {}),
          ...(v.height ? { height: v.height } : {}),
          ...(v.codecs ? { codecs: v.codecs } : {}),
          ...(v.audio ? { audioGroup: v.audio } : {}),
        }))
        .filter((v) => (seen.has(v.label) ? false : (seen.add(v.label), true)));
      item.audioTracks = parsed.audio
        .filter((a) => a.url && reachableFrom(url, a.url))
        .map<AudioTrack>((a) => ({
          id: hashId(a.url!),
          label: a.name,
          url: a.url!,
          groupId: a.groupId,
          isDefault: a.isDefault,
          ...(a.lang ? { lang: a.lang } : {}),
        }));
      if (parsed.encrypted) item.protection = 'encrypted';
      // Probe the best variant for duration, liveness and encryption.
      const best = item.variants[0];
      if (best) {
        const media = parseHls(await fetchText(best.url, ctx.pageUrl), best.url);
        if (media.type === 'media') {
          item.duration = media.duration;
          item.live = !media.endList;
          if (media.encrypted) item.protection = 'encrypted';
          if (best.bandwidth) item.size = Math.round((best.bandwidth * media.duration) / 8);
        }
      }
      if (!item.variants.length && item.audioTracks.length) item.audioOnly = true;
    } else {
      item.duration = parsed.duration;
      item.live = !parsed.endList;
      if (parsed.encrypted) item.protection = 'encrypted';
      if (!parsed.segments.length) return null;
    }
    return item;
  });
}

export function resolveDash(url: string, ctx: DetectContext, fetchText: FetchText): Promise<MediaItem | null> {
  return cached(url, async () => {
    const mpd = parseDash(await fetchText(url, ctx.pageUrl), url);
    const item = baseItem(url, ctx, 'dash');
    item.mime = 'application/dash+xml';
    item.duration = mpd.duration;
    item.live = mpd.dynamic;
    if (mpd.protected) item.protection = 'drm';
    const seen = new Set<string>();
    item.variants = [...mpd.video]
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth)
      .map<Variant>((r) => ({
        id: r.id,
        label: qualityLabel(r.height, r.bandwidth) || r.id,
        url,
        bandwidth: r.bandwidth,
        ...(r.width ? { width: r.width } : {}),
        ...(r.height ? { height: r.height } : {}),
        ...(r.codecs ? { codecs: r.codecs } : {}),
      }))
      .filter((v) => (seen.has(v.label) ? false : (seen.add(v.label), true)));
    item.audioTracks = [...mpd.audio]
      .sort((a, b) => b.bandwidth - a.bandwidth)
      .map<AudioTrack>((r) => ({
        id: r.id,
        label: [r.lang, qualityLabel(undefined, r.bandwidth)].filter(Boolean).join(' · '),
        url,
        bandwidth: r.bandwidth,
        ...(r.lang ? { lang: r.lang } : {}),
      }));
    const best = mpd.video.find((r) => r.id === item.variants[0]?.id);
    const audioBw = mpd.audio[0]?.bandwidth ?? 0;
    if (best && mpd.duration) item.size = Math.round(((best.bandwidth + audioBw) * mpd.duration) / 8);
    if (!mpd.video.length && mpd.audio.length) item.audioOnly = true;
    if (!mpd.video.length && !mpd.audio.length) return null;
    return item;
  });
}

export function fileItem(
  url: string,
  ctx: DetectContext,
  info: { mime?: string; size?: number; audioOnly?: boolean },
): MediaItem {
  const item = baseItem(url, ctx, 'file');
  if (info.mime) item.mime = info.mime;
  if (info.size) item.size = info.size;
  if (info.audioOnly) item.audioOnly = true;
  return item;
}
