/**
 * Experimental YouTube support, page (MAIN) world.
 *
 * On a watch page: reads the player's own description of the video (qualities, codecs,
 * sizes) for the popup. Inside the hidden player Grabby adds to the page: picks the codecs
 * for the requested format, forces the quality, plays muted at high speed and reports
 * which recorded tracks are the video (not an ad).
 */
import type { VideoFormat } from '../shared/plan';
import type { YtInfo } from '../shared/messages';

export interface HookApi {
  post(msg: { type: 'yt'; info: YtInfo } | { type: 'progress'; progress: number } | { type: 'end'; keep: number[] } | { type: 'error'; error: 'capture_unavailable' | 'capture_failed' }): void;
  /** Sends every MediaSource append from now on, tagged per player; `onSwitch` runs on a quality change. */
  recordAll(onSwitch: () => void): void;
  /** Starts a new generation of tracks: what was recorded before is left out of the file. */
  restart(): void;
  /** Tracks recorded for the MediaSource currently playing in `video`. */
  tracksOf(video: HTMLVideoElement): number[];
}

interface Format {
  itag: number;
  mimeType: string;
  qualityLabel?: string;
  contentLength?: string;
  fps?: number;
}

interface PlayerResponse {
  videoDetails?: { videoId?: string; title?: string; lengthSeconds?: string; isLive?: boolean };
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
  if (!d?.videoId || !formats.length || d.isLive) return null;
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
  return {
    id: d.videoId,
    title: d.title ?? '',
    duration: Number(d.lengthSeconds) || 0,
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
    const sig = `${info.id}|${info.qualities.length}|${info.embeddable}`;
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

/** Restarts after a quality change, a few times at most (then keeps the longest part). */
const MAX_RESTARTS = 6;

function hiddenPlayer(api: HookApi, params: URLSearchParams) {
  const quality = params.get('gyq') ?? 'hd1080';
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
      p?.seekTo?.(0, true);
    }, 400);
  });
  // Decoding many frames per second of 4K would overload the machine (and the player
  // reacts by rebuilding itself): the bigger the picture, the lower the speed.
  const maxRate = /hd2160|highres/.test(quality) ? 4 : quality === 'hd1440' ? 8 : 16;

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
    // Keep asking for the chosen quality: the player's own logic may lower it.
    if (!ad && ++checks % 8 === 0 && p.getPlaybackQuality?.() !== quality) p.setPlaybackQualityRange?.(quality, quality);
    // Fast and silent, ads included (they are dropped from the file).
    video.muted = true;
    if (video.playbackRate < maxRate) {
      for (const rate of [16, 8, 4].filter((r) => r <= maxRate)) {
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
      const progress = Math.min(1, video.currentTime / d);
      if (progress !== lastProgress) api.post({ type: 'progress', progress });
      lastProgress = progress;
      if (video.ended || p.getPlayerState?.() === 0 || video.currentTime >= d - 0.05) {
      console.debug('[grabby] hidden player end', JSON.stringify({ t: video.currentTime, d, restarts, keep: api.tracksOf(video) }));
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
