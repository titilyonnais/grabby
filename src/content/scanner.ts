/**
 * Grabby scanner — isolated content script (all frames).
 * Reports <video> elements and page metadata to the service worker, relays DRM signals
 * from the MAIN-world hook, and streams capture chunks into the extension's storage.
 */
import { showToast } from './toast';
import { hiddenJobFromUrl, hiddenSessionFromUrl, readYouTubeInfo } from '../features/youtube';
import { SESSION_SPAN } from '../shared/idb';
import { deepVideos } from '../shared/dom';
import type { BgToContent, ContentToBg, PageInfo, PageVideo, YtInfo } from '../shared/messages';
import { cleanTitle } from '../shared/title';

type HookUp =
  | { type: 'drm'; keySystem: string }
  | { type: 'chunk'; track: number; mime: string; init: boolean; data: ArrayBuffer }
  | { type: 'progress'; progress: number; time?: number; keep?: number[] }
  | { type: 'end'; keep?: number[] }
  | { type: 'yt'; info: YtInfo }
  | { type: 'error'; error: 'capture_unavailable' | 'protected' | 'capture_failed' };

const send = (msg: ContentToBg) => chrome.runtime.sendMessage(msg).catch(() => {});

/* Private channel to the MAIN-world hook (see hook.ts): offered before page scripts run. */
const channel = new MessageChannel();
const hook = channel.port1;
window.postMessage({ __grabby: 'hello' }, '*', [channel.port2]);
const MANIFEST = /\.(m3u8|mpd)($|[?#])/i;
const streams = new Set<string>();
const isTop = window === window.top;

/* ------------------------------------------------------------- scanning */

function absolute(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u, location.href).href;
  } catch {
    return undefined;
  }
}

function meta(...props: string[]): string | undefined {
  for (const prop of props) {
    const v = document.querySelector<HTMLMetaElement>(`meta[property="${prop}"], meta[name="${prop}"]`)?.content;
    if (v) return v;
  }
  return undefined;
}

/** schema.org VideoObject (JSON-LD): many sites describe their video there. */
function videoObject(): { name?: string; thumbnail?: string; contentUrl?: string } {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const found = findVideoObject(JSON.parse(s.textContent ?? ''));
      if (found) {
        const t = found.thumbnailUrl;
        const thumb = Array.isArray(t) ? t[0] : typeof t === 'object' && t ? (t as { url?: string }).url : t;
        return {
          ...(typeof found.name === 'string' ? { name: found.name } : {}),
          ...(typeof thumb === 'string' ? { thumbnail: thumb } : {}),
          ...(typeof found.contentUrl === 'string' ? { contentUrl: found.contentUrl } : {}),
        };
      }
    } catch {
      /* invalid JSON-LD */
    }
  }
  return {};
}

type Ld = { '@type'?: string | string[]; '@graph'?: unknown[]; name?: unknown; thumbnailUrl?: unknown; contentUrl?: unknown };
function findVideoObject(node: unknown, depth = 0): Ld | undefined {
  if (!node || typeof node !== 'object' || depth > 4) return undefined;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findVideoObject(n, depth + 1);
      if (f) return f;
    }
    return undefined;
  }
  const o = node as Ld;
  const type = Array.isArray(o['@type']) ? o['@type'] : [o['@type']];
  if (type.includes('VideoObject')) return o;
  return findVideoObject(o['@graph'], depth + 1);
}

/**
 * A still of the main player, for pages without a preview image. Players built on
 * MediaSource are same-origin, so the frame can be read; DRM output is black and skipped.
 */
let snapKey = '';
let snapData: string | undefined;
function snapshot(): string | undefined {
  const v = deepVideos()
    .filter((x) => x.readyState >= 2 && x.videoWidth > 0 && !x.mediaKeys)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!v || v.clientWidth < 200) return snapData;
  const key = v.currentSrc || v.src;
  if (key === snapKey) return snapData;
  try {
    const w = 320;
    const h = Math.max(1, Math.round((w * v.videoHeight) / v.videoWidth));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(v, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4 * 97) sum += px[i]! + px[i + 1]! + px[i + 2]!;
    if (sum / (px.length / (4 * 97)) / 3 < 14) return snapData; // black frame (DRM, not started)
    snapKey = key;
    snapData = c.toDataURL('image/jpeg', 0.72);
  } catch {
    snapKey = key; // cross-origin file: can't be read, don't retry
  }
  return snapData;
}

/** Last resort: the biggest picture on screen (artwork, backdrop), when nothing else exists. */
function largestImage(): string | undefined {
  let best: { url: string; area: number } | undefined;
  const consider = (url: string | undefined, el: Element) => {
    if (!url || !/^(https?:|data:image\/)/.test(url)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 240 || r.height < 120 || r.bottom < 0 || r.top > innerHeight * 1.5) return;
    const ratio = r.width / r.height;
    if (ratio < 1.1 || ratio > 2.6) return; // posters of other titles, banners
    const area = r.width * r.height;
    if (!best || area > best.area) best = { url, area };
  };
  for (const img of document.images) consider(img.currentSrc || img.src, img);
  for (const el of document.querySelectorAll<HTMLElement>('[style*="background-image"]')) {
    const m = /url\(["']?([^"')]+)["']?\)/.exec(el.style.backgroundImage);
    consider(absolute(m?.[1]), el);
  }
  return best?.url;
}

/** Links straight to a video or audio file ("Download", galleries of clips on small sites). */
const MEDIA_LINK = /\.(mp4|m4v|webm|mov|mkv|ogv|mp3|m4a|ogg|oga|opus|wav|flac|m3u8|mpd)$/i;
const MAX_DECLARED = 12;

/**
 * Video URLs the page names without having played them: sharing metadata, schema.org
 * `contentUrl`, the <source> list of a player (other qualities, or not loaded yet), direct links.
 * The service worker checks each one's first bytes before listing it.
 */
function declaredMedia(ld: { contentUrl?: string }): string[] {
  const urls = new Set<string>();
  const add = (u: string | undefined) => {
    const abs = absolute(u);
    if (abs && /^https?:/i.test(abs) && abs !== location.href) urls.add(abs);
  };
  if (isTop) {
    add(meta('og:video:secure_url', 'og:video:url', 'og:video'));
    add(meta('twitter:player:stream'));
    add(ld.contentUrl);
  }
  // Every <source> of a player: the qualities it offers (Plyr, video.js…) besides the one playing.
  for (const v of deepVideos()) {
    for (const s of v.querySelectorAll('source')) if (s.src !== v.currentSrc) add(s.src);
  }
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (urls.size >= MAX_DECLARED) break;
    if (MEDIA_LINK.test(a.pathname)) add(a.href);
  }
  return [...urls].slice(0, MAX_DECLARED);
}

/** The subtitle files a player declares (<track>), up to 20. */
function subtitleTracks(v: HTMLVideoElement): Pick<PageVideo, 'tracks'> {
  const tracks: NonNullable<PageVideo['tracks']> = [];
  for (const t of v.querySelectorAll('track')) {
    const kind = (t.getAttribute('kind') || 'subtitles').toLowerCase();
    const src = absolute(t.getAttribute('src'));
    if ((kind !== 'subtitles' && kind !== 'captions') || !src || !/^https?:/i.test(src)) continue;
    tracks.push({
      src,
      ...(t.srclang ? { lang: t.srclang } : {}),
      ...(t.label ? { label: t.label } : {}),
      ...(t.default ? { isDefault: true } : {}),
    });
    if (tracks.length >= 20) break;
  }
  return tracks.length ? { tracks } : {};
}

let ytPlayer: YtInfo | undefined;

function collect(): PageInfo {
  const videos: PageVideo[] = deepVideos().map((v, index) => {
    const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
    const rect = v.getBoundingClientRect();
    return {
      index,
      src,
      duration: v.duration,
      width: Math.round(rect.width || v.videoWidth),
      height: Math.round(rect.height || v.videoHeight),
      isMse: src.startsWith('blob:'),
      isProtected: !!v.mediaKeys,
      muted: v.muted,
      loop: v.loop,
      autoplay: v.autoplay,
      controls: v.controls,
      ...(v.poster ? { poster: absolute(v.poster)! } : {}),
      ...subtitleTracks(v),
    };
  });
  const ld = isTop ? videoObject() : {};
  const raw = (isTop && (meta('og:title', 'twitter:title') || ld.name)) || document.title || '';
  const info: PageInfo = { title: cleanTitle(raw, location.hostname), videos };
  if (streams.size) info.streams = [...streams].slice(-20);
  const declared = declaredMedia(ld);
  if (declared.length) info.declared = declared;
  const thumb = isTop
    ? absolute(meta('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src') ?? document.querySelector<HTMLLinkElement>('link[rel="image_src"]')?.href ?? ld.thumbnail)
    : undefined;
  if (thumb) info.thumbnail = thumb;
  else {
    const still = videos.length ? snapshot() : undefined;
    if (still) info.snapshot = still;
    const image = isTop && !still ? largestImage() : undefined;
    if (image) info.image = image;
  }
  if (isTop) {
    const yt = readYouTubeInfo(document, location.href);
    if (yt) info.youtube = { ...yt, ...(ytPlayer && yt.id === ytPlayer.id ? { player: ytPlayer } : {}) };
  }
  return info;
}

let lastSent = '';
function report(force = false) {
  const info = collect();
  if (!isTop && !info.videos.length && !info.streams && !info.declared) return;
  const sig = JSON.stringify(info);
  if (!force && sig === lastSent) return;
  lastSent = sig;
  void send({ type: 'page-info', info });
}

let timer: ReturnType<typeof setTimeout> | undefined;
function scheduleReport(delay = 600) {
  clearTimeout(timer);
  timer = setTimeout(() => report(), delay);
}

/** Resource timing sees every manifest the page fetched, even if a network event was missed. */
function watchResources() {
  try {
    const onEntries = (list: PerformanceEntryList) => {
      let added = false;
      for (const e of list) {
        if (MANIFEST.test(e.name) && /^https?:/.test(e.name) && !streams.has(e.name)) {
          streams.add(e.name);
          added = true;
        }
      }
      if (added) scheduleReport(150);
    };
    onEntries(performance.getEntriesByType('resource'));
    new PerformanceObserver((l) => onEntries(l.getEntries())).observe({ type: 'resource', buffered: true });
  } catch {
    /* Performance API unavailable */
  }
}

function startObserving() {
  watchResources();
  report();
  new MutationObserver(() => scheduleReport()).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  // Media events don't bubble but are visible in the capture phase.
  for (const ev of ['loadedmetadata', 'durationchange', 'play']) {
    document.addEventListener(ev, () => scheduleReport(200), true);
  }
}

// Inside the hidden YouTube player this frame only records, it reports nothing.
const hiddenJob = hiddenJobFromUrl(location.href);
if (!hiddenJob) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserving, { once: true });
  else startObserving();
}

/* ------------------------------------------------------------- capture */

interface Session {
  jobId: string;
  /** First track number of this recording session (sessions after a pause go on from there). */
  offset: number;
  bytes: number;
  seq: Map<number, number>;
  tracks: Map<number, string>;
  sink: Sink;
}
let session: Session | null = null;

interface Sink {
  put(track: number, seq: number, mime: string, init: boolean, data: ArrayBuffer): void;
  flush(): Promise<void>;
  close(): void;
}

/** Acks can be lost (frame torn down, extension reloaded): never wait forever. */
const withTimeout = (p: Promise<void>, ms = 15_000) =>
  Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);

/** Preferred sink: hidden extension iframe writing to IndexedDB (zero-copy transfer). */
function iframeSink(jobId: string): Promise<Sink> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.src = chrome.runtime.getURL('capture-sink.html');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    const origin = new URL(chrome.runtime.getURL('')).origin;
    let pending = 0;
    let flushWaiters: (() => void)[] = [];
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('sink timeout'));
    }, 4000);

    function onMessage(e: MessageEvent) {
      if (e.source !== frame.contentWindow || e.origin !== origin) return;
      const d = e.data as { grabbySink?: string } | null;
      if (d?.grabbySink === 'ready') {
        clearTimeout(timeout);
        frame.contentWindow!.postMessage({ type: 'open', jobId }, origin);
        resolve(sink);
      } else if (d?.grabbySink === 'ack') {
        pending--;
        if (pending === 0) {
          flushWaiters.forEach((f) => f());
          flushWaiters = [];
        }
      }
    }
    function cleanup() {
      window.removeEventListener('message', onMessage);
      frame.remove();
    }
    // If the page removes our frame mid-recording, the rest goes through the port.
    let fallback: Sink | null = null;
    const sink: Sink = {
      put(track, seq, mime, init, data) {
        const w = frame.isConnected ? frame.contentWindow : null;
        if (!w) return (fallback ??= portSink(jobId)).put(track, seq, mime, init, data);
        pending++;
        w.postMessage({ type: 'chunk', jobId, track, seq, mime, init, data }, origin, [data]);
      },
      flush: () =>
        Promise.all([
          withTimeout(pending === 0 || !frame.isConnected ? Promise.resolve() : new Promise<void>((r) => flushWaiters.push(r))),
          fallback?.flush(),
        ]).then(() => {}),
      close() {
        cleanup();
        fallback?.close();
      },
    };
    window.addEventListener('message', onMessage);
    (document.body ?? document.documentElement).appendChild(frame);
  });
}

/** Fallback sink when the page blocks extension frames: base64 over a port to the SW. */
function portSink(jobId: string): Sink {
  const port = chrome.runtime.connect({ name: 'capture' });
  let pending = 0;
  let waiters: (() => void)[] = [];
  port.onMessage.addListener((m: { ack?: boolean }) => {
    if (m.ack && --pending === 0) {
      waiters.forEach((f) => f());
      waiters = [];
    }
  });
  const toB64 = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  return {
    put(track, seq, mime, init, data) {
      pending++;
      port.postMessage({ jobId, track, seq, mime, init, b64: toB64(data) });
    },
    flush: () => withTimeout(pending === 0 ? Promise.resolve() : new Promise<void>((r) => waiters.push(r))),
    close: () => port.disconnect(),
  };
}

async function startCapture(jobId: string, videoIndex: number, clip?: { start: number; end: number }, n = 0, from?: number) {
  session?.sink.close();
  const sink = await iframeSink(jobId).catch(() => portSink(jobId));
  session = { jobId, offset: n * SESSION_SPAN, bytes: 0, seq: new Map(), tracks: new Map(), sink };
  hook.postMessage({ type: 'arm', videoIndex, ...(clip ? { clip } : {}), ...(from !== undefined ? { from } : {}) });
}

/** Paused: the recording stops, what it stored stays for the session that carries on. */
async function hold(s: Session) {
  hook.postMessage({ type: 'stop', hold: true });
  if (session === s) session = null;
  await s.sink.flush();
  s.sink.close();
}

const offsetKeep = (s: Session, keep: unknown) =>
  Array.isArray(keep) ? keep.filter(Number.isInteger).map((t: number) => s.offset + t) : undefined;

async function finish(s: Session, keep?: number[]) {
  await s.sink.flush();
  s.sink.close();
  if (session === s) session = null;
  const tracks = [...s.tracks].map(([track, mime]) => ({ track, mime }));
  await send(
    tracks.length
      ? { type: 'capture-done', jobId: s.jobId, tracks, ...(keep?.length ? { keep } : {}) }
      : { type: 'capture-error', jobId: s.jobId, error: 'capture_failed' },
  );
}

/** Starts storing chunks right away; they wait in memory until the sink is open. */
function openSession(jobId: string, n: number): Session {
  const ready = iframeSink(jobId).catch(() => portSink(jobId));
  let sink: Sink | null = null;
  const queue: Parameters<Sink['put']>[] = [];
  void ready.then((s) => {
    sink = s;
    for (const args of queue.splice(0)) s.put(...args);
  });
  return {
    jobId,
    offset: n * SESSION_SPAN,
    bytes: 0,
    seq: new Map(),
    tracks: new Map(),
    sink: {
      put: (...args) => (sink ? sink.put(...args) : void queue.push(args)),
      flush: async () => (await ready).flush(),
      close: () => void ready.then((s) => s.close()),
    },
  };
}

if (hiddenJob) session = openSession(hiddenJob, hiddenSessionFromUrl(location.href));

let lastProgress = 0;
hook.onmessage = (e: MessageEvent) => {
  const d = e.data as HookUp | null;
  if (!d) return;
  switch (d.type) {
    case 'drm':
      void send({ type: 'drm', keySystem: String(d.keySystem).slice(0, 100) });
      scheduleReport(200);
      break;
    case 'chunk': {
      const s = session;
      if (!s || !(d.data instanceof ArrayBuffer) || !Number.isInteger(d.track)) return;
      const track = s.offset + d.track;
      const seq = s.seq.get(track) ?? 0;
      s.seq.set(track, seq + 1);
      s.tracks.set(track, String(d.mime));
      s.bytes += d.data.byteLength;
      s.sink.put(track, seq, String(d.mime), !!d.init, d.data);
      break;
    }
    case 'progress': {
      const s = session;
      const now = Date.now();
      if (!s || now - lastProgress < 400) return;
      lastProgress = now;
      const keep = offsetKeep(s, d.keep);
      void send({
        type: 'capture-progress',
        jobId: s.jobId,
        progress: Number(d.progress) || 0,
        bytes: s.bytes,
        ...(Number.isFinite(d.time) ? { time: Number(d.time) } : {}),
        ...(keep?.length ? { keep } : {}),
      });
      break;
    }
    case 'end':
      if (session) void finish(session, offsetKeep(session, d.keep));
      break;
    case 'yt':
      if (isTop && d.info && typeof d.info.id === 'string') {
        ytPlayer = d.info;
        scheduleReport(100);
      }
      break;
    case 'error':
      if (session) {
        const s = session;
        session = null;
        s.sink.close();
        void send({ type: 'capture-error', jobId: s.jobId, error: d.error === 'protected' ? 'protected' : d.error });
      }
      break;
  }
};

/* --------------------------------------------------- service worker ⇄ us */

chrome.runtime.onMessage.addListener((msg: BgToContent) => {
  switch (msg.type) {
    case 'scan':
      report(true);
      break;
    case 'capture-start':
      void startCapture(msg.jobId, msg.videoIndex, msg.clip, Number.isInteger(msg.session) ? msg.session! : 0, msg.from);
      break;
    case 'capture-stop':
      if (session?.jobId !== msg.jobId) break;
      if (msg.hold) void hold(session);
      else hook.postMessage({ type: 'stop' });
      break;
    case 'toast':
      if (isTop) showToast(msg);
      break;
  }
});
