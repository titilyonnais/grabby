/**
 * Experimental YouTube support, page (MAIN) world.
 *
 * On a watch page: reads the player's own description of the video (qualities, codecs,
 * sizes) for the popup. Inside the hidden player Grabby adds to the page: picks the codecs
 * for the requested format, forces the quality, plays muted at high speed and reports
 * which recorded tracks are the video (not an ad).
 */
import type { CapturedCaption, Chapter, VideoFormat } from '../shared/plan';
import type { YtInfo } from '../shared/messages';
import { descriptionChapters } from '../shared/chapters';
import { captionsFromUrl } from './youtube';

export interface HookApi {
  post(
    msg:
      | { type: 'yt'; info: YtInfo }
      | { type: 'progress'; progress: number; time?: number; keep?: number[] }
      | { type: 'end'; keep: number[] }
      | { type: 'error'; error: 'capture_unavailable' | 'capture_failed' },
  ): void;
  /** Sends every MediaSource append from now on, tagged per player; `onSwitch` runs on a quality change. */
  recordAll(onSwitch: () => void): void;
  /** Starts a new generation of tracks: what was recorded before is left out of the file. */
  restart(): void;
  /** Tracks recorded for the MediaSource currently playing in `video`. */
  tracksOf(video: HTMLVideoElement): number[];
  /** The subtitles the player loaded (the `k`-th language asked for), kept with the recording. */
  caption(data: ArrayBuffer, k: number): void;
}

interface Format {
  itag: number;
  mimeType: string;
  qualityLabel?: string;
  contentLength?: string;
  fps?: number;
}

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text?: string }[] };
}

interface PlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
      translationLanguages?: { languageCode?: string; languageName?: { simpleText?: string; runs?: { text?: string }[] } }[];
    };
  };
  videoDetails?: { videoId?: string; title?: string; lengthSeconds?: string; isLive?: boolean; author?: string; shortDescription?: string };
  playabilityStatus?: { status?: string; playableInEmbed?: boolean };
  streamingData?: { adaptiveFormats?: Format[] };
}

type Player = HTMLElement & {
  getPlayerResponse?: () => PlayerResponse | undefined;
  getAvailableQualityData?: () => { quality: string; qualityLabel: string }[];
  setPlaybackQualityRange?: (min: string, max: string) => void;
  setPlaybackQuality?: (q: string) => void;
  getPlaybackQuality?: () => string;
  playVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  mute?: () => void;
  getPlayerState?: () => number;
  loadModule?: (name: string) => void;
  setOption?: (module: string, option: string, value: unknown) => void;
  getOption?: (module: string, option: string, args?: unknown) => unknown;
};

const LEVELS: [number, string][] = [
  [4320, 'highres'],
  [2160, 'hd2160'],
  [1440, 'hd1440'],
  [1080, 'hd1080'],
  [720, 'hd720'],
  [480, 'large'],
  [360, 'medium'],
  [240, 'small'],
  [144, 'tiny'],
];
const levelFor = (lines: number) => LEVELS.find(([h]) => lines >= h)?.[1] ?? 'tiny';
const lines = (f: Format) => parseInt(f.qualityLabel ?? '', 10) || 0;
const size = (f?: Format) => Number(f?.contentLength) || 0;

/** Qualities offered for a video, from the player's format list (pure, unit-tested). */
export function describeFormats(r: PlayerResponse): YtInfo | null {
  const d = r.videoDetails;
  const formats = r.streamingData?.adaptiveFormats ?? [];
  if (!d?.videoId) return null;
  // A live stream: recorded from the page's own player, as it plays.
  if (d.isLive) return { id: d.videoId, title: d.title ?? '', duration: 0, embeddable: false, qualities: [], live: true, ...(d.author ? { author: d.author } : {}) };
  if (!formats.length) return null;
  const video = formats.filter((f) => f.mimeType.startsWith('video/') && lines(f) > 0);
  const audio = formats.filter((f) => f.mimeType.startsWith('audio/'));
  const aac = audio.find((f) => f.itag === 140) ?? audio.find((f) => f.mimeType.includes('mp4a'));
  const opus = audio.find((f) => f.itag === 251) ?? audio.find((f) => f.mimeType.includes('opus'));

  const byLines = new Map<number, Format[]>();
  for (const f of video) byLines.set(lines(f), [...(byLines.get(lines(f)) ?? []), f]);
  const best = (list: Format[], codec: RegExp) =>
    list.filter((f) => codec.test(f.mimeType)).sort((a, b) => (b.fps ?? 0) - (a.fps ?? 0))[0];

  const qualities = [...byLines.entries()]
    .sort(([a], [b]) => b - a)
    .map(([h, list]) => {
      const avc = best(list, /avc1/);
      const vp9 = best(list, /vp0?9/);
      const label = [...list].sort((a, b) => (b.fps ?? 0) - (a.fps ?? 0))[0]!.qualityLabel!;
      const sizes: Partial<Record<VideoFormat, number>> = {};
      // MP4: H.264 when YouTube has it, otherwise VP9 (copied into MP4, no re-encoding).
      const mp4Video = avc ?? vp9;
      if (mp4Video && size(mp4Video)) sizes.mp4 = size(mp4Video) + size(aac);
      if (vp9 && size(vp9)) sizes.webm = size(vp9) + size(opus);
      return { label: label.replace(/^(\d+p)(\d+)?.*$/, '$1$2'), height: h, quality: levelFor(h), avc: !!avc, vp9: !!vp9, sizes };
    });
  const captions = (r.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).flatMap((c) => {
    const name = c.name?.simpleText ?? c.name?.runs?.map((x) => x.text ?? '').join('') ?? c.languageCode ?? '';
    if (!c.baseUrl || !c.languageCode) return [];
    try {
      // WebVTT, from YouTube's own address for these subtitles.
      const u = new URL(c.baseUrl, 'https://www.youtube.com');
      if (!/(^|\.)youtube\.com$/.test(u.hostname)) return [];
      u.searchParams.set('fmt', 'vtt');
      return [{ url: u.href, lang: c.languageCode, name, auto: c.kind === 'asr' }];
    } catch {
      return [];
    }
  });
  const offered = r.captions?.playerCaptionsTracklistRenderer?.translationLanguages ?? [];
  const translations = offered.flatMap((t) => (t.languageCode ? [t.languageCode] : []));
  // YouTube's own names, for the languages the browser can't name.
  const translationNames: Record<string, string> = {};
  for (const t of offered) {
    const name = t.languageName?.simpleText ?? t.languageName?.runs?.map((x) => x.text ?? '').join('');
    if (t.languageCode && name) translationNames[t.languageCode] = name.slice(0, 60);
  }
  const duration = Number(d.lengthSeconds) || 0;
  const chapters: Chapter[] = descriptionChapters(d.shortDescription, duration || undefined);
  return {
    id: d.videoId,
    title: d.title ?? '',
    duration,
    ...(d.author ? { author: d.author } : {}),
    ...(chapters.length ? { chapters } : {}),
    ...(captions.length ? { captions } : {}),
    ...(captions.length && translations.length ? { translations, translationNames } : {}),
    embeddable: r.playabilityStatus?.playableInEmbed !== false && r.playabilityStatus?.status === 'OK',
    qualities,
  };
}

const player = () => document.getElementById('movie_player') as Player | null;

/** Watch page: keeps the popup informed about the current video. */
function reportPlayerInfo(api: HookApi) {
  let last = '';
  const check = () => {
    const r = player()?.getPlayerResponse?.() ?? (window as { ytInitialPlayerResponse?: PlayerResponse }).ytInitialPlayerResponse;
    const info = r ? describeFormats(r) : null;
    if (!info) return;
    const sig = `${info.id}|${info.qualities.length}|${info.embeddable}|${info.captions?.length ?? 0}|${info.chapters?.length ?? 0}`;
    if (sig === last) return;
    last = sig;
    api.post({ type: 'yt', info });
  };
  setInterval(check, 1500);
  document.addEventListener('yt-navigate-finish', () => setTimeout(check, 300));
}

/* ------------------------------------------------------------ hidden player */

/**
 * Makes the hidden player pick the codecs of the requested format: H.264 + AAC for MP4,
 * VP9 + Opus for WebM (the player chooses among what the browser says it can play).
 */
function restrictCodecs(vcodec: string | null, acodec: string | null) {
  const denied = (type: string) => {
    const t = type.toLowerCase();
    if (vcodec === 'avc' && /vp0?9|vp8|av01/.test(t)) return true;
    if (vcodec === 'vp9' && /avc1|av01/.test(t)) return true;
    if (acodec === 'aac' && /opus|vorbis/.test(t)) return true;
    if (acodec === 'opus' && /mp4a/.test(t)) return true;
    return false;
  };
  for (const MS of [window.MediaSource, (window as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource]) {
    if (!MS?.isTypeSupported) continue;
    const orig = MS.isTypeSupported.bind(MS);
    MS.isTypeSupported = (type: string) => !denied(type) && orig(type);
  }
  const canPlay = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (this: HTMLMediaElement, type: string) {
    return denied(type) ? '' : canPlay.call(this, type);
  };
  const mc = navigator.mediaCapabilities;
  if (mc?.decodingInfo) {
    const orig = mc.decodingInfo.bind(mc);
    mc.decodingInfo = (cfg: MediaDecodingConfiguration) => {
      const types = [cfg.video?.contentType, cfg.audio?.contentType].filter(Boolean) as string[];
      if (types.some(denied)) return Promise.resolve({ supported: false, smooth: false, powerEfficient: false } as MediaCapabilitiesDecodingInfo);
      return orig(cfg);
    };
  }
}

/**
 * At high speed most frames are dropped; the player would take it as a slow machine and
 * lower the quality. Nobody watches this player: report a smooth playback.
 */
function hideDroppedFrames() {
  const proto = HTMLVideoElement.prototype;
  const orig = proto.getVideoPlaybackQuality;
  if (orig) {
    proto.getVideoPlaybackQuality = function (this: HTMLVideoElement) {
      const q = orig.call(this);
      return { creationTime: q.creationTime, totalVideoFrames: q.totalVideoFrames, droppedVideoFrames: 0, corruptedVideoFrames: 0 } as VideoPlaybackQuality;
    };
  }
  try {
    Object.defineProperty(proto, 'webkitDroppedFrameCount', { get: () => 0, configurable: true });
  } catch {
    /* not present */
  }
}

/** What YouTube's player remembers about the viewer: quality, bandwidth, performance cap, volume… */
export const PLAYER_MEMORY = /^yt-player-/;

/**
 * The hidden player shares youtube.com's storage with the user's own tabs. What it would
 * remember (the quality asked for — 144p for a sound file —, the bandwidth measured at 16×,
 * the volume it muted) is kept in memory only: YouTube plays on afterwards as it did before.
 * What the user's tabs remembered is still read.
 */
export function shieldPlayerMemory(storage: Storage = window.localStorage): Map<string, string | null> {
  const own = new Map<string, string | null>();
  const proto = Object.getPrototypeOf(storage) as Storage;
  const { getItem, setItem, removeItem } = proto;
  proto.getItem = function (this: Storage, key: string) {
    if (this === storage && PLAYER_MEMORY.test(String(key)) && own.has(String(key))) return own.get(String(key)) ?? null;
    return getItem.call(this, key);
  };
  proto.setItem = function (this: Storage, key: string, value: string) {
    if (this === storage && PLAYER_MEMORY.test(String(key))) return void own.set(String(key), String(value));
    return setItem.call(this, key, value);
  };
  proto.removeItem = function (this: Storage, key: string) {
    if (this === storage && PLAYER_MEMORY.test(String(key))) return void own.set(String(key), null);
    return removeItem.call(this, key);
  };
  return own;
}

/** Restarts after a quality change, a few times at most (then keeps the longest part). */
const MAX_RESTARTS = 6;

const seconds = (v: string | null): number | undefined => {
  const n = v === null ? Number.NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * The subtitles the player loads once they are switched on: the response it gets for each
 * wanted track (a language, written or automatic, maybe translated) is passed on, with the
 * track's place in the list asked for. Nothing else is fetched.
 */
function keepCaptions(wanted: CapturedCaption[], onText: (data: ArrayBuffer, k: number) => void): { got: (k: number) => boolean } {
  const got = new Set<number>();
  const which = (url: string): number => {
    try {
      const u = new URL(url, location.href);
      if (!u.pathname.endsWith('/api/timedtext')) return -1;
      return wanted.findIndex(
        (c) => u.searchParams.get('lang') === c.lang && (u.searchParams.get('kind') === 'asr') === !!c.auto && (u.searchParams.get('tlang') ?? undefined) === c.tlang,
      );
    } catch {
      return -1;
    }
  };
  const keep = (k: number, data: ArrayBuffer) => {
    if (k < 0 || got.has(k) || !data.byteLength) return;
    got.add(k);
    onText(data, k);
  };
  const realFetch = window.fetch;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const p = realFetch.call(this, input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const k = which(url);
    if (k >= 0) {
      void p.then((r) => (r.ok ? r.clone().arrayBuffer() : null)).then((b) => b && keep(k, b)).catch(() => {});
    }
    return p;
  } as typeof window.fetch;
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const k = which(String(url));
    if (k >= 0) {
      this.addEventListener('load', () => {
        if (this.status !== 200) return;
        const r = this.response as unknown;
        if (r instanceof ArrayBuffer) keep(k, r.slice(0));
        else if (this.responseType === '' || this.responseType === 'text') keep(k, new TextEncoder().encode(this.responseText).buffer as ArrayBuffer);
      });
    }
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  return { got: (k) => got.has(k) };
}

function hiddenPlayer(api: HookApi, params: URLSearchParams) {
  const quality = params.get('gyq') ?? 'hd1080';
  // Subtitles to keep: switched on in this player one after the other, what it loads is passed on.
  const captions = captionsFromUrl(params.get('gysc'));
  const kept = captions.length ? keepCaptions(captions, (d, k) => api.caption(d, k)) : null;
  /** The first subtitles not received yet (-1: all of them are). */
  const nextCaption = () => (kept ? captions.findIndex((_, k) => !kept.got(k)) : -1);
  // A part of the video (gyb–gye), and where this recording starts (start: a part, or a
  // recording carrying on after a pause or a restart).
  const begin = seconds(params.get('gyb')) ?? 0;
  const partEnd = seconds(params.get('gye'));
  const from = seconds(params.get('start')) ?? 0;
  try {
    shieldPlayerMemory();
  } catch {
    /* storage refused: nothing to remember either */
  }
  restrictCodecs(params.get('gyv'), params.get('gya'));
  hideDroppedFrames();
  let restarts = 0;
  api.recordAll(() => {
    // Ads come and go with their own players: they are filtered out at the end anyway.
    if (restarts >= MAX_RESTARTS || player()?.classList.contains('ad-showing')) return;
    restarts++;
    console.debug('[grabby] player rebuilt, restarting', restarts);
    api.restart();
    // Let the player finish rebuilding (it restores its own position), then go back to 0.
    setTimeout(() => {
      const p = player();
      p?.setPlaybackQualityRange?.(quality, quality);
      p?.seekTo?.(from, true);
    }, 400);
  });
  // Decoding many frames per second of 4K would overload the machine (and the player
  // reacts by rebuilding itself): the bigger the picture, the lower the speed.
  // A speed limit set in Grabby caps it too (never under the normal speed).
  const capped = Number(params.get('gyr')) || 16;
  const maxRate = Math.max(1, Math.min(capped, /hd2160|highres/.test(quality) ? 4 : quality === 'hd1440' ? 8 : 16));

  let started = 0;
  let done = false;
  let lastProgress = -1;
  let checks = 0;
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (done) return;
    const p = player();
    const video = p?.querySelector('video') ?? document.querySelector('video');
    if (!p?.playVideo || !video) {
      if (Date.now() - t0 > 20_000) fail('capture_unavailable');
      return;
    }
    const ad = p.classList.contains('ad-showing');
    if (!started) {
      started = Date.now();
      p.mute?.();
      p.setPlaybackQualityRange?.(quality, quality);
      p.setPlaybackQuality?.(quality);
      p.playVideo();
    }
    if (document.querySelector('.ytp-error') && !ad) return fail('capture_unavailable');
    // Subtitles on, in the next wanted language (asked again until the player loads them).
    const k = nextCaption();
    if (k >= 0 && !ad && checks % 8 === 0) {
      const c = captions[k]!;
      try {
        p.loadModule?.('captions');
        // The player's own description of the track when it has one (needed to tell the
        // automatic track from the written one in the same language).
        const list = p.getOption?.('captions', 'tracklist', { includeAsr: true }) as { languageCode?: string; kind?: string }[] | undefined;
        const track = (Array.isArray(list) ? list.find((t) => t.languageCode === c.lang && (t.kind === 'asr') === !!c.auto) : undefined) ?? {
          languageCode: c.lang,
          ...(c.auto ? { kind: 'asr' } : {}),
        };
        // Translated by YouTube: the same track, with the language to translate into.
        p.setOption?.('captions', 'track', c.tlang ? { ...track, translationLanguage: { languageCode: c.tlang } } : track);
      } catch {
        /* the video plays on without them */
      }
    }
    // Keep asking for the chosen quality: the player's own logic may lower it.
    if (!ad && ++checks % 8 === 0 && p.getPlaybackQuality?.() !== quality) p.setPlaybackQualityRange?.(quality, quality);
    // Fast and silent, ads included (they are dropped from the file).
    video.muted = true;
    if (video.playbackRate < maxRate) {
      for (const rate of [16, 8, 4, 2, 1].filter((r) => r <= maxRate)) {
        try {
          video.playbackRate = rate;
          break;
        } catch {
          /* lower rate */
        }
      }
    }
    if (video.paused && !video.ended) void video.play().catch(() => {});
    if (ad) return;
    const d = video.duration;
    if (Number.isFinite(d) && d > 0) {
      const t = video.currentTime;
      const end = partEnd ?? d;
      const progress = Math.max(0, Math.min(1, (t - begin) / Math.max(0.001, end - begin)));
      // The tracks of the video itself go along: a recording paused before its end still knows them.
      if (progress !== lastProgress) api.post({ type: 'progress', progress, time: t, keep: api.tracksOf(video) });
      lastProgress = progress;
      const past = partEnd !== undefined ? t >= partEnd + 1 : t >= d - 0.05;
      // The end waits a little for subtitles still on their way.
      const waitCaptions = nextCaption() >= 0 && Date.now() - started < 12_000 + 4000 * captions.length;
      if ((video.ended || p.getPlayerState?.() === 0 || past) && !waitCaptions) {
        console.debug('[grabby] hidden player end', JSON.stringify({ t, d, restarts, keep: api.tracksOf(video) }));
        finish(video);
      }
    }
  }, 250);

  function finish(video: HTMLVideoElement) {
    done = true;
    clearInterval(tick);
    video.pause();
    api.post({ type: 'end', keep: api.tracksOf(video) });
  }
  function fail(error: 'capture_unavailable' | 'capture_failed') {
    console.debug('[grabby] hidden player failed', JSON.stringify({ error, state: player()?.getPlayerState?.(), message: document.querySelector('.ytp-error')?.textContent?.slice(0, 200) }));
    done = true;
    clearInterval(tick);
    api.post({ type: 'error', error });
  }
}

/** Entry point, called by the page hook at document_start. */
export function youtubeHook(api: HookApi): void {
  const host = location.hostname;
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return;
  const params = new URLSearchParams(location.search);
  if (location.pathname.startsWith('/embed/') && params.get('gy')) hiddenPlayer(api, params);
  else if (window === window.top) reportPlayerInfo(api);
}
