/**
 * Grabby page hook — runs in the page's MAIN world at document_start.
 *
 * - Reports Encrypted Media Extensions usage (DRM) so protected players are never offered.
 * - Tracks MediaSource/SourceBuffer objects so a non-encrypted adaptive player can be
 *   recorded ("capture mode") when the user explicitly asks for it.
 *
 * To make short clips instant, the first appends of each player are kept in memory up to a
 * small page-wide budget (nothing at all once DRM is seen). The data only leaves the page
 * when the user starts a capture; it never alters what the page plays otherwise.
 */
import { youtubeHook } from '../features/youtube-hook';
import { deepVideos, isInitSegment } from '../shared/dom';

type Up =
  | { type: 'drm'; keySystem: string }
  | { type: 'chunk'; track: number; mime: string; init: boolean; data: ArrayBuffer }
  | { type: 'progress'; progress: number }
  | { type: 'end'; keep?: number[] }
  | { type: 'error'; error: 'capture_unavailable' | 'protected' | 'capture_failed' }
  | { type: 'yt'; info: import('../shared/messages').YtInfo };

type Down = { type: 'arm'; videoIndex: number } | { type: 'stop' };

const LOG_BUDGET = 48 * 1024 * 1024;

(() => {
  const w = window as Window & { __grabbyHook?: boolean };
  if (w.__grabbyHook) return;
  w.__grabbyHook = true;

  /*
   * Private channel to the isolated scanner. The scanner offers a MessagePort at
   * document_start, before any page script runs, so the page can neither read nor forge
   * this traffic. Messages sent before the port arrives are queued.
   */
  let port: MessagePort | null = null;
  const early: [Up, Transferable[]][] = [];
  const post = (msg: Up, transfer: Transferable[] = []) => {
    if (port) port.postMessage(msg, transfer);
    else if (early.length < 50) early.push([msg, transfer]);
  };
  const onHello = (e: MessageEvent) => {
    const d = e.data as { __grabby?: string } | null;
    if (e.source !== window || d?.__grabby !== 'hello' || !e.ports[0]) return;
    window.removeEventListener('message', onHello, true);
    e.stopImmediatePropagation();
    port = e.ports[0];
    port.onmessage = (m: MessageEvent) => {
      const d = m.data as Down | null;
      if (d?.type === 'arm' && Number.isInteger(d.videoIndex)) arm(d.videoIndex);
      else if (d?.type === 'stop') stop(true);
    };
    for (const [msg, transfer] of early.splice(0)) port.postMessage(msg, transfer);
  };
  window.addEventListener('message', onHello, true);

  /* ----------------------------------------------------------- MSE state */
  interface LogEntry {
    init: boolean;
    data: ArrayBuffer;
  }
  interface SbInfo {
    mime: string;
    ms: MediaSource;
    lastInit?: ArrayBuffer;
    /** Every append since creation, while the page budget allows it. */
    log: LogEntry[] | null;
  }
  const blobToMs = new Map<string, MediaSource>();
  /** "Record everything" mode (hidden players): appends of every player, per-player track ids. */
  let recordAll = false;
  /** Bumped when the stream changes under us (quality switch): older chunks are dropped. */
  let generation = 0;
  let onSwitch: (() => void) | null = null;
  /** Something was recorded in the current generation. */
  let recorded = false;
  const recordedInit = new WeakMap<SourceBuffer, Uint8Array>();
  const msSerial = new WeakMap<MediaSource, number>();
  let nextSerial = 0;
  const trackId = (ms: MediaSource, sb: SourceBuffer) =>
    generation * 1024 + (msSerial.get(ms) ?? 0) * 16 + Math.max(0, msBuffers.get(ms)?.indexOf(sb) ?? 0);
  const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
  const msBuffers = new WeakMap<MediaSource, SourceBuffer[]>();
  const sbInfo = new WeakMap<SourceBuffer, SbInfo>();
  const logged = new Set<SbInfo>();
  let logBytes = 0;
  let drmSeen = false;

  function dropLog(info: SbInfo) {
    for (const e of info.log ?? []) logBytes -= e.data.byteLength;
    info.log = null;
    logged.delete(info);
  }

  function dropLogs(ms?: MediaSource) {
    for (const info of [...logged]) if (!ms || info.ms === ms) dropLog(info);
  }

  /** Frees the budget held by other (older) players first; false if it still doesn't fit. */
  function makeRoom(info: SbInfo, need: number): boolean {
    for (const other of [...logged]) {
      if (logBytes + need <= LOG_BUDGET) break;
      if (other.ms !== info.ms) dropLog(other);
    }
    return logBytes + need <= LOG_BUDGET;
  }

  /** A detached MediaSource can't play again: release everything kept for it. */
  function forget(ms: MediaSource) {
    dropLogs(ms);
    for (const [url, m] of blobToMs) if (m === ms) blobToMs.delete(url);
  }

  /* --------------------------------------------------------------- DRM */
  const protectedEls = new WeakSet<HTMLMediaElement>();
  const onDrm = (keySystem: string) => {
    drmSeen = true;
    dropLogs();
    post({ type: 'drm', keySystem });
  };
  // Asking which DRM systems exist (requestMediaKeySystemAccess) proves nothing: players
  // and ad SDKs probe it for clear videos too. Only keys attached to an element, or media
  // that turns out to be encrypted, mean protected playback. (Not wrapping that probe also
  // keeps the browser's PlayReady warnings from being attributed to Grabby.)
  document.addEventListener(
    'encrypted',
    (e) => {
      if (e.target instanceof HTMLMediaElement) protectedEls.add(e.target);
      onDrm('encrypted');
    },
    true,
  );
  const setMediaKeys = HTMLMediaElement.prototype.setMediaKeys;
  if (setMediaKeys) {
    HTMLMediaElement.prototype.setMediaKeys = function (this: HTMLMediaElement, keys: MediaKeys | null) {
      if (keys) {
        protectedEls.add(this);
        onDrm('setMediaKeys');
      }
      return setMediaKeys.call(this, keys);
    };
  }

  /* ------------------------------------------------------------ MSE hooks */
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (obj: Blob | MediaSource) {
    const url = createObjectURL.call(URL, obj);
    if (typeof MediaSource !== 'undefined' && obj instanceof MediaSource) {
      blobToMs.set(url, obj);
      // Bound what a page creating many players can make us retain.
      if (blobToMs.size > 16) blobToMs.delete(blobToMs.keys().next().value!);
    }
    return url;
  };

  if (typeof MediaSource !== 'undefined') {
    const addSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (this: MediaSource, mime: string) {
      const sb = addSourceBuffer.call(this, mime);
      const info: SbInfo = { mime, ms: this, log: drmSeen ? null : [] };
      sbInfo.set(sb, info);
      if (info.log) logged.add(info);
      const list = msBuffers.get(this);
      if (list) list.push(sb);
      else {
        msBuffers.set(this, [sb]);
        msSerial.set(this, nextSerial++);
        // Players also switch quality by rebuilding their MediaSource from the current position.
        if (recordAll && recorded && onSwitch) queueMicrotask(onSwitch);
        this.addEventListener('sourceclose', () => forget(this), { once: true });
      }
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

  /* -------------------------------------------------------------- capture */
  interface Capture {
    ms: MediaSource;
    video: HTMLVideoElement;
    tracks: Map<SourceBuffer, number>;
    rate: number;
    /** The page's own sound setting, given back when the recording ends. */
    wasMuted: boolean;
    /** Progress even while the video is paused or waiting: silence would mean the page died. */
    beat?: ReturnType<typeof setInterval>;
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

    if (recordAll) {
      if (init) {
        const prev = recordedInit.get(sb);
        recordedInit.set(sb, bytes.slice());
        // A different init on a buffer already recorded: the player switched quality.
        if (prev && !sameBytes(prev, bytes) && onSwitch) onSwitch();
      }
      const copy = bytes.slice().buffer;
      post({ type: 'chunk', track: trackId(info.ms, sb), mime: info.mime, init, data: copy }, [copy]);
      recorded = true;
      return;
    }

    if (capture && capture.ms === info.ms) {
      const track = capture.tracks.get(sb);
      if (track === undefined) return;
      const copy = bytes.slice().buffer;
      post({ type: 'chunk', track, mime: info.mime, init, data: copy }, [copy]);
      return;
    }

    if (info.log && !drmSeen) {
      if (!makeRoom(info, bytes.byteLength)) {
        dropLogs(info.ms);
        return;
      }
      info.log.push({ init, data: bytes.slice().buffer });
      logBytes += bytes.byteLength;
    }
  }

  function stop(sendEnd: boolean) {
    if (!capture) return;
    const c = capture;
    capture = null;
    clearInterval(c.beat);
    c.video.removeEventListener('timeupdate', c.onTime);
    c.video.removeEventListener('ended', c.onEnd);
    c.video.removeEventListener('ratechange', c.onRate);
    try {
      c.video.playbackRate = 1;
      c.video.muted = c.wasMuted;
    } catch {
      /* ignore */
    }
    if (sendEnd) post({ type: 'end' });
  }

  /** True when every SourceBuffer holds data up to the end of the media. */
  function fullyBuffered(video: HTMLVideoElement, buffers: SourceBuffer[]): boolean {
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return false;
    return buffers.every((sb) => {
      try {
        const b = sb.buffered;
        return b.length > 0 && b.start(0) <= 0.5 && b.end(b.length - 1) >= d - 0.5;
      } catch {
        return false;
      }
    });
  }

  function speedUp(c: Capture) {
    c.video.muted = true;
    for (const rate of [16, 8, 4, 2]) {
      try {
        c.video.playbackRate = rate;
        c.rate = rate;
        break;
      } catch {
        /* rate not supported, try lower */
      }
    }
  }

  function arm(videoIndex: number) {
    stop(false);
    const video = deepVideos()[videoIndex];
    if (!video) return post({ type: 'error', error: 'capture_unavailable' });
    if (drmSeen || protectedEls.has(video) || video.mediaKeys) return post({ type: 'error', error: 'protected' });
    const ms = blobToMs.get(video.currentSrc || video.src);
    const buffers = ms ? msBuffers.get(ms) : undefined;
    if (!ms || !buffers?.length) return post({ type: 'error', error: 'capture_unavailable' });

    const tracks = new Map<SourceBuffer, number>();
    buffers.forEach((sb, i) => tracks.set(sb, i));
    const infos = buffers.map((sb) => sbInfo.get(sb)!);
    const haveLog = infos.every((i) => i.log && i.log.length > 0);

    const c: Capture = {
      ms,
      video,
      tracks,
      rate: 1,
      wasMuted: video.muted,
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

    if (haveLog) {
      // Replay what the player already appended, from its very first byte.
      infos.forEach((info, track) => {
        for (const e of info.log!) {
          logBytes -= e.data.byteLength;
          post({ type: 'chunk', track, mime: info.mime, init: e.init, data: e.data }, [e.data]);
        }
        info.log = [];
      });
      dropLogs(ms);
      if (fullyBuffered(video, buffers)) {
        post({ type: 'progress', progress: 1 });
        post({ type: 'end' });
        return;
      }
      capture = c;
      speedUp(c);
    } else {
      // Log unavailable (long video): restart from zero so the player appends everything again.
      infos.forEach((info, track) => {
        if (info.lastInit) {
          const copy = info.lastInit.slice(0);
          post({ type: 'chunk', track, mime: info.mime, init: true, data: copy }, [copy]);
        }
      });
      dropLogs(ms);
      capture = c;
      for (const sb of buffers) {
        try {
          if (!sb.updating && sb.buffered.length) sb.remove(0, Infinity);
        } catch {
          /* some players lock buffers; capture still records what comes next */
        }
      }
      speedUp(c);
      video.currentTime = 0;
    }
    video.addEventListener('timeupdate', c.onTime);
    c.beat = setInterval(c.onTime, 5000);
    video.addEventListener('ended', c.onEnd);
    video.addEventListener('ratechange', c.onRate);
    void video.play().catch(() => {});
  }

  {
    youtubeHook({
      post,
      recordAll: (cb) => {
        recordAll = true;
        onSwitch = cb;
        dropLogs();
      },
      restart: () => {
        generation++;
        recorded = false;
      },
      tracksOf: (video) => {
        const ms = blobToMs.get(video.currentSrc || video.src);
        return ms ? (msBuffers.get(ms) ?? []).map((sb) => trackId(ms, sb)) : [];
      },
    });
  }
})();
