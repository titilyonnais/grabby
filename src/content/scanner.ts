/**
 * Grabby scanner — isolated content script (all frames).
 * Reports <video> elements and page metadata to the service worker, relays DRM signals
 * from the MAIN-world hook, and streams capture chunks into the extension's storage.
 */
import { readYouTubeInfo } from '../features/youtube';
import { deepVideos } from '../shared/dom';
import type { BgToContent, ContentToBg, PageInfo, PageVideo } from '../shared/messages';

type HookUp =
  | { type: 'drm'; keySystem: string }
  | { type: 'chunk'; track: number; mime: string; init: boolean; data: ArrayBuffer }
  | { type: 'progress'; progress: number }
  | { type: 'end' }
  | { type: 'error'; error: 'capture_unavailable' | 'protected' | 'capture_failed' };

const send = (msg: ContentToBg) => chrome.runtime.sendMessage(msg).catch(() => {});
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

function meta(prop: string): string | undefined {
  return document.querySelector<HTMLMetaElement>(`meta[property="${prop}"], meta[name="${prop}"]`)?.content || undefined;
}

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
      ...(v.poster ? { poster: absolute(v.poster)! } : {}),
    };
  });
  const info: PageInfo = {
    title: (isTop && meta('og:title')) || document.title || '',
    videos,
  };
  if (streams.size) info.streams = [...streams].slice(-20);
  const thumb = isTop ? absolute(meta('og:image')) : undefined;
  if (thumb) info.thumbnail = thumb;
  if (__TARGET__ === 'github' && isTop) {
    const yt = readYouTubeInfo(document, location.href);
    if (yt) info.youtube = yt;
  }
  return info;
}

let lastSent = '';
function report(force = false) {
  const info = collect();
  if (!isTop && !info.videos.length && !info.streams) return;
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

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserving, { once: true });
else startObserving();

/* ------------------------------------------------------------- capture */

interface Session {
  jobId: string;
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
    const sink: Sink = {
      put(track, seq, mime, init, data) {
        pending++;
        frame.contentWindow!.postMessage({ type: 'chunk', jobId, track, seq, mime, init, data }, origin, [data]);
      },
      flush: () => (pending === 0 ? Promise.resolve() : new Promise((r) => flushWaiters.push(r))),
      close: cleanup,
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
    flush: () => (pending === 0 ? Promise.resolve() : new Promise((r) => waiters.push(r))),
    close: () => port.disconnect(),
  };
}

async function startCapture(jobId: string, videoIndex: number) {
  session?.sink.close();
  const sink = await iframeSink(jobId).catch(() => portSink(jobId));
  session = { jobId, bytes: 0, seq: new Map(), tracks: new Map(), sink };
  window.postMessage({ __grabby: 'down', type: 'arm', videoIndex }, '*');
}

async function finish(s: Session) {
  await s.sink.flush();
  s.sink.close();
  if (session === s) session = null;
  const tracks = [...s.tracks].map(([track, mime]) => ({ track, mime }));
  await send(tracks.length ? { type: 'capture-done', jobId: s.jobId, tracks } : { type: 'capture-error', jobId: s.jobId, error: 'capture_failed' });
}

let lastProgress = 0;
window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window) return;
  const d = e.data as ({ __grabby?: string } & HookUp) | null;
  if (!d || d.__grabby !== 'up') return;
  switch (d.type) {
    case 'drm':
      void send({ type: 'drm', keySystem: String(d.keySystem).slice(0, 100) });
      scheduleReport(200);
      break;
    case 'chunk': {
      const s = session;
      if (!s || !(d.data instanceof ArrayBuffer) || !Number.isInteger(d.track)) return;
      const seq = s.seq.get(d.track) ?? 0;
      s.seq.set(d.track, seq + 1);
      s.tracks.set(d.track, String(d.mime));
      s.bytes += d.data.byteLength;
      s.sink.put(d.track, seq, String(d.mime), !!d.init, d.data);
      break;
    }
    case 'progress': {
      const s = session;
      const now = Date.now();
      if (!s || now - lastProgress < 400) return;
      lastProgress = now;
      void send({ type: 'capture-progress', jobId: s.jobId, progress: Number(d.progress) || 0, bytes: s.bytes });
      break;
    }
    case 'end':
      if (session) void finish(session);
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
});

/* --------------------------------------------------- service worker ⇄ us */

chrome.runtime.onMessage.addListener((msg: BgToContent) => {
  switch (msg.type) {
    case 'scan':
      report(true);
      break;
    case 'capture-start':
      void startCapture(msg.jobId, msg.videoIndex);
      break;
    case 'capture-stop':
      if (session?.jobId === msg.jobId) window.postMessage({ __grabby: 'down', type: 'stop' }, '*');
      break;
  }
});
