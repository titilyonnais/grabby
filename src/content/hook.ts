/**
 * Grabby page hook — runs in the page's MAIN world at document_start.
 *
 * - Reports Encrypted Media Extensions usage (DRM) so protected players are never offered.
 * - Tracks MediaSource/SourceBuffer objects so a non-encrypted adaptive player can be
 *   recorded ("capture mode") when the user explicitly asks for it.
 *
 * It never alters what the page plays and records nothing unless a capture is armed.
 * Messages go to the isolated content script through window.postMessage.
 */
import { deepVideos, isInitSegment } from '../shared/dom';

type Up =
  | { type: 'drm'; keySystem: string }
  | { type: 'chunk'; track: number; mime: string; init: boolean; data: ArrayBuffer }
  | { type: 'progress'; progress: number }
  | { type: 'end' }
  | { type: 'error'; error: 'capture_unavailable' | 'protected' | 'capture_failed' };

type Down = { type: 'arm'; videoIndex: number } | { type: 'stop' };

(() => {
  const w = window as Window & { __grabbyHook?: boolean };
  if (w.__grabbyHook) return;
  w.__grabbyHook = true;

  const post = (msg: Up, transfer: Transferable[] = []) => window.postMessage({ __grabby: 'up', ...msg }, '*', transfer);

  /* --------------------------------------------------------------- DRM */
  const protectedEls = new WeakSet<HTMLMediaElement>();
  const nav = Navigator.prototype as Navigator & { requestMediaKeySystemAccess?: Navigator['requestMediaKeySystemAccess'] };
  const rmksa = nav.requestMediaKeySystemAccess;
  if (rmksa) {
    nav.requestMediaKeySystemAccess = function (this: Navigator, keySystem: string, configs: MediaKeySystemConfiguration[]) {
      post({ type: 'drm', keySystem });
      return rmksa.call(this, keySystem, configs);
    };
  }
  const setMediaKeys = HTMLMediaElement.prototype.setMediaKeys;
  if (setMediaKeys) {
    HTMLMediaElement.prototype.setMediaKeys = function (this: HTMLMediaElement, keys: MediaKeys | null) {
      if (keys) {
        protectedEls.add(this);
        post({ type: 'drm', keySystem: 'setMediaKeys' });
      }
      return setMediaKeys.call(this, keys);
    };
  }

  /* --------------------------------------------------------------- MSE */
  interface SbInfo {
    mime: string;
    ms: MediaSource;
    lastInit?: ArrayBuffer;
  }
  const blobToMs = new Map<string, MediaSource>();
  const msBuffers = new WeakMap<MediaSource, SourceBuffer[]>();
  const sbInfo = new WeakMap<SourceBuffer, SbInfo>();

  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (obj: Blob | MediaSource) {
    const url = createObjectURL.call(URL, obj);
    if (typeof MediaSource !== 'undefined' && obj instanceof MediaSource) blobToMs.set(url, obj);
    return url;
  };

  if (typeof MediaSource !== 'undefined') {
    const addSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (this: MediaSource, mime: string) {
      const sb = addSourceBuffer.call(this, mime);
      sbInfo.set(sb, { mime, ms: this });
      const list = msBuffers.get(this) ?? [];
      list.push(sb);
      msBuffers.set(this, list);
      return sb;
    };

    const appendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (this: SourceBuffer, data: BufferSource) {
      try {
        onAppend(this, data);
      } catch {
        // never break the player
      }
      return appendBuffer.call(this, data);
    };
  }

  function bytesOf(data: BufferSource): Uint8Array {
    return data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  }

  /* ----------------------------------------------------------- capture */
  interface Capture {
    ms: MediaSource;
    video: HTMLVideoElement;
    tracks: Map<SourceBuffer, number>;
    rate: number;
    onTime: () => void;
    onEnd: () => void;
    onRate: () => void;
  }
  let capture: Capture | null = null;

  function onAppend(sb: SourceBuffer, data: BufferSource) {
    const info = sbInfo.get(sb);
    if (!info) return;
    const bytes = bytesOf(data);
    const init = isInitSegment(bytes);
    if (init) info.lastInit = bytes.slice().buffer;
    if (!capture || capture.ms !== info.ms) return;
    const track = capture.tracks.get(sb);
    if (track === undefined) return;
    const copy = bytes.slice().buffer;
    post({ type: 'chunk', track, mime: info.mime, init, data: copy }, [copy]);
  }

  function stop(sendEnd: boolean) {
    if (!capture) return;
    const c = capture;
    capture = null;
    c.video.removeEventListener('timeupdate', c.onTime);
    c.video.removeEventListener('ended', c.onEnd);
    c.video.removeEventListener('ratechange', c.onRate);
    try {
      c.video.playbackRate = 1;
    } catch {
      /* ignore */
    }
    if (sendEnd) post({ type: 'end' });
  }

  function arm(videoIndex: number) {
    stop(false);
    const video = deepVideos()[videoIndex];
    if (!video) return post({ type: 'error', error: 'capture_unavailable' });
    if (protectedEls.has(video) || video.mediaKeys) return post({ type: 'error', error: 'protected' });
    const ms = blobToMs.get(video.currentSrc || video.src);
    const buffers = ms ? msBuffers.get(ms) : undefined;
    if (!ms || !buffers?.length) return post({ type: 'error', error: 'capture_unavailable' });

    const tracks = new Map<SourceBuffer, number>();
    buffers.forEach((sb, i) => {
      tracks.set(sb, i);
      const info = sbInfo.get(sb)!;
      if (info.lastInit) {
        const copy = info.lastInit.slice(0);
        post({ type: 'chunk', track: i, mime: info.mime, init: true, data: copy }, [copy]);
      }
    });

    const c: Capture = {
      ms,
      video,
      tracks,
      rate: 1,
      onTime: () => {
        const d = video.duration;
        if (Number.isFinite(d) && d > 0) post({ type: 'progress', progress: Math.min(1, video.currentTime / d) });
      },
      onEnd: () => stop(true),
      onRate: () => {
        // Players sometimes reset the rate; keep the accelerated one while capturing.
        if (capture === c && video.playbackRate < c.rate) video.playbackRate = c.rate;
      },
    };
    capture = c;

    // Flush what is already buffered so the player re-appends everything from the start.
    for (const sb of buffers) {
      try {
        if (!sb.updating && sb.buffered.length) sb.remove(0, Infinity);
      } catch {
        /* some players lock buffers; capture still records what comes next */
      }
    }
    video.muted = true;
    for (const rate of [16, 8, 4, 2]) {
      try {
        video.playbackRate = rate;
        c.rate = rate;
        break;
      } catch {
        /* rate not supported, try lower */
      }
    }
    video.addEventListener('timeupdate', c.onTime);
    video.addEventListener('ended', c.onEnd);
    video.addEventListener('ratechange', c.onRate);
    video.currentTime = 0;
    void video.play().catch(() => {});
  }

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return;
    const d = e.data as ({ __grabby?: string } & Down) | null;
    if (!d || d.__grabby !== 'down') return;
    if (d.type === 'arm' && Number.isInteger(d.videoIndex)) arm(d.videoIndex);
    else if (d.type === 'stop') stop(true);
  });
})();
