/**
 * Offscreen document: downloads stream segments, assembles them with ffmpeg.wasm and
 * hands a Blob URL back to the service worker, which saves it with chrome.downloads.
 */
import type { BgToOffscreen, OffscreenToBg } from '../shared/messages';
import type { ErrorCode, OutputFormat, Plan, SegRef, TrackPlan } from '../shared/plan';
import type { JobStatus } from '../shared/types';
import { deleteJob } from '../shared/idb';
import { deleteParts, putPart, storedBlobs, storedSizes } from '../shared/parts';
import { inputExt, muxAttempts, type MuxInputs } from './args';
import { assembleCapture } from './capture';
import { fetchAll, HttpError, rangeSupport, rangesOf, streamFile } from './fetcher';
import { type FFmpeg, getFFmpeg } from './muxer';
import { Pacer } from './pacer';
import { clipCues, joinVtt, toSrt } from '../shared/subtitles';
import { startHiddenPlayer, stopHiddenPlayer } from '../features/youtube-player';

const controllers = new Map<string, AbortController>();
const HEARTBEAT_MS = 10_000;
const blobUrls = new Map<string, string>();

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ts: 'video/mp2t',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  wav: 'audio/wav',
};

type NoTarget<T> = T extends unknown ? Omit<T, 'target'> : never;

const toBg = (msg: NoTarget<OffscreenToBg>) =>
  chrome.runtime.sendMessage({ target: 'bg', ...msg } as OffscreenToBg).catch(() => {});

type Reporter = ReturnType<typeof reporter>;

function reporter(jobId: string) {
  const start = performance.now();
  let last = 0;
  let bytes = 0;
  let state: { status: JobStatus; progress: number } = { status: 'downloading', progress: 0 };
  return {
    addBytes(n: number) {
      bytes += n;
    },
    get bytes() {
      return bytes;
    },
    send(status: JobStatus, progress: number, force = false) {
      state = { status, progress: Math.max(0, Math.min(1, progress)) };
      const now = performance.now();
      if (!force && now - last < 250) return;
      last = now;
      const speed = bytes / Math.max(0.25, (now - start) / 1000);
      void toBg({ type: 'job-progress', jobId, ...state, bytes, speed });
    },
    /** Tells the service worker the job is alive, e.g. while it waits for ffmpeg. */
    beat() {
      if (performance.now() - last > HEARTBEAT_MS / 2) this.send(state.status, state.progress, true);
    },
  };
}

function errorCode(e: unknown): ErrorCode {
  if (e instanceof HttpError) return e.status === 403 || e.status === 401 ? 'http_403' : e.status === 404 || e.status === 410 ? 'http_404' : 'http_other';
  if (e instanceof DOMException && e.name === 'AbortError') return 'canceled';
  if (e instanceof Error && e.message.startsWith('ffmpeg')) return 'ffmpeg';
  if (e instanceof TypeError) return 'network';
  return 'unknown';
}

const segCount = (t?: TrackPlan) => (t ? t.segments.length + (t.init ? 1 : 0) : 0);

/** Pieces from a server that can't send ranges are stored this big. */
const STREAM_PIECE = 8 * 2 ** 20;

interface TrackRun {
  signal: AbortSignal;
  rep: Reporter;
  pacer: Pacer;
  /** The file is saved as is: without ranges, the browser's own download does it as well. */
  fast: boolean;
  /** How many pieces the track turned out to have (a file split into ranges), and its size. */
  setCount: (n: number, bytes?: number) => void;
  onPart: () => void;
  /** Data came in: the bar moves with the bytes when the size is known. */
  onBytes: () => void;
}

/**
 * Fetches every piece of a track that isn't stored yet and stores it. A single file is
 * split into ranges fetched in parallel when its server allows it; otherwise it is read in
 * one go (and can't resume halfway, so it starts over).
 */
async function fetchTrack(jobId: string, trackNo: number, track: TrackPlan, o: TrackRun): Promise<void> {
  const single = track.container === 'file' && track.segments.length === 1 && !track.init && !track.segments[0]!.range;
  let refs: SegRef[] = [...(track.init ? [track.init] : []), ...track.segments];
  if (single) {
    const url = track.segments[0]!.url;
    const ranges = await rangeSupport(url, { signal: o.signal });
    if (ranges && ranges.size > 0) refs = rangesOf(url, ranges.size);
    else {
      if (o.fast) throw Object.assign(new Error('no ranges'), { code: 'no_ranges' as ErrorCode });
      return streamTrack(jobId, trackNo, url, o);
    }
    o.setCount(refs.length, ranges.size);
  } else o.setCount(refs.length);
  const have = await storedSizes(jobId, trackNo);
  for (const [i, n] of have) {
    if (i >= refs.length) continue;
    o.rep.addBytes(n);
    o.onPart();
  }
  const todo = refs.map((_, i) => i).filter((i) => !have.has(i));
  await fetchAll(refs, todo, {
    signal: o.signal,
    pacer: o.pacer,
    onBytes: (n) => {
      o.rep.addBytes(n);
      o.onBytes();
    },
    onPart: async (i, data) => {
      await putPart(jobId, trackNo, i, data);
      o.onPart();
    },
  });
}

/** A file whose server sends no ranges: read from the start, stored in big pieces as it comes. */
async function streamTrack(jobId: string, trackNo: number, url: string, o: TrackRun): Promise<void> {
  await deleteParts(jobId);
  let index = 0;
  let buf: Uint8Array<ArrayBuffer>[] = [];
  let held = 0;
  const store = async () => {
    if (!held) return;
    await putPart(jobId, trackNo, index++, new Blob(buf));
    buf = [];
    held = 0;
  };
  await streamFile(url, {
    signal: o.signal,
    onData: async (data, received, total) => {
      o.rep.addBytes(data.length);
      buf.push(data);
      held += data.length;
      if (held >= STREAM_PIECE) await store();
      // Unknown total: the bar stays busy until the end.
      o.rep.send('downloading', total ? received / total : 0);
    },
  });
  await store();
}

/** Raw mode (huge streams, files saved as is): the stored pieces end to end, still on disk. */
async function joinRaw(jobId: string, plan: Plan): Promise<{ blob: Blob; ext: string }> {
  const type = MIME[plan.output] ?? 'application/octet-stream';
  return { blob: new Blob(await storedBlobs(jobId, 0), { type }), ext: plan.output };
}

/** Writes a stored track into ffmpeg's memory, one piece at a time. */
async function loadTrack(f: FFmpeg, jobId: string, trackNo: number, path: string, signal: AbortSignal) {
  await f.create(path);
  for (const blob of await storedBlobs(jobId, trackNo)) {
    if (signal.aborted) throw signal.reason;
    await f.append(path, new Uint8Array(await blob.arrayBuffer()));
  }
}

/**
 * The subtitles as SubRip, on the clock of what is saved (a part starts at zero). A track
 * that can't be fetched doesn't sink the video: it is saved without them.
 */
async function subtitlesOf(jobId: string, plan: Plan, o: TrackRun): Promise<string | null> {
  if (!plan.subtitles) return null;
  try {
    await fetchTrack(jobId, SUBS_TRACK, plan.subtitles.track, o);
  } catch (e) {
    if (o.signal.aborted) throw e;
    console.warn('[grabby] subtitles left out', e);
    return null;
  }
  const texts = await Promise.all((await storedBlobs(jobId, SUBS_TRACK)).map((b) => b.text()));
  let cues = joinVtt(texts);
  if (plan.clip) cues = clipCues(cues, plan.clip.start, plan.clip.duration);
  return cues.length ? toSrt(cues) : null;
}

const SUBS_TRACK = 2;

/** Jobs paused by the user: their abort is not an error, and their pieces stay. */
const pausing = new Set<string>();

async function run(jobId: string, plan: Plan) {
  const ctl = new AbortController();
  controllers.set(jobId, ctl);
  const signal = ctl.signal;
  const rep = reporter(jobId);
  const dir = `/j${jobId}`;
  const ff = plan.raw ? null : getFFmpeg();
  if (ff) ff.users++;
  // Share of the progress bar for fetching: shrinking the picture is the long part.
  const fetched = plan.raw ? 1 : plan.scale ? 0.3 : 0.9;
  // A recording is already stored: its bar continues from where the recording left it.
  if (plan.kind === 'capture') rep.send('processing', fetched, true);
  else rep.send('downloading', 0, true);
  const heartbeat = setInterval(() => rep.beat(), HEARTBEAT_MS);
  try {
    let result: { blob: Blob; ext: string };
    const inputs: MuxInputs = {};
    let srt: string | null = null;

    if (plan.kind !== 'capture') {
      const tracks = ([[0, plan.video], [1, plan.audio]] as const).flatMap(([n, t]) => (t ? [{ n, t }] : []));
      // Pieces of every track, for one progress bar (a file's count is known once it's split).
      const counts = tracks.map(({ t }) => segCount(t));
      // A file split into ranges: its size is known, so the bar follows the bytes (its few big
      // pieces would otherwise all finish together, the bar jumping from 0 to the end).
      let size = 0;
      let done = 0;
      const progress = () => {
        const total = counts.reduce((a, b) => a + b, 0);
        const byParts = total ? done / total : 0;
        return Math.min(1, size ? Math.max(byParts, rep.bytes / size) : byParts) * fetched;
      };
      const pacer = new Pacer();
      for (const [k, { n, t }] of tracks.entries()) {
        await fetchTrack(jobId, n, t, {
          signal,
          rep,
          pacer,
          fast: !!plan.fast,
          setCount: (c, bytes) => {
            counts[k] = c;
            if (bytes && tracks.length === 1) size = bytes;
          },
          onPart: () => {
            done++;
            rep.send('downloading', progress());
          },
          onBytes: () => rep.send('downloading', progress()),
        });
      }
      srt = await subtitlesOf(jobId, plan, { signal, rep, pacer, fast: false, setCount: () => {}, onPart: () => {}, onBytes: () => {} });
    }
    if (signal.aborted) throw signal.reason;

    if (plan.raw) {
      rep.send('saving', 1, true);
      result = await joinRaw(jobId, plan);
    } else {
      const f = ff!;
      await f.mkdir(dir);
      if (plan.kind === 'capture') {
        rep.send('processing', 0, true);
        const tracks = await assembleCapture(jobId, plan.keepTracks);
        if (!tracks.length) throw Object.assign(new Error('capture'), { code: 'capture_failed' });
        for (const t of tracks) {
          const ext = t.mime.includes('webm') ? 'webm' : 'mp4';
          const key = t.kind === 'audio' && !inputs.audio ? 'audio' : !inputs.video ? 'video' : null;
          if (!key) continue;
          inputs[key] = `${dir}/${key[0]}.${ext}`;
          await f.create(inputs[key]!);
          await f.append(inputs[key]!, t.data);
          rep.addBytes(t.data.byteLength);
        }
        if (!inputs.video && !plan.audioOnly) {
          inputs.video = inputs.audio;
          delete inputs.audio;
        }
      } else {
        rep.send('processing', fetched, true);
        for (const [key, track, n] of [['video', plan.video, 0], ['audio', plan.audio, 1]] as const) {
          if (!track) continue;
          inputs[key] = `${dir}/${key[0]}.${inputExt(track.container, track.segments[0]?.url)}`;
          await loadTrack(f, jobId, n, inputs[key]!, signal);
        }
      }

      if (srt && !plan.subtitles!.separate) {
        inputs.subs = { path: `${dir}/s.srt`, title: plan.subtitles!.label, ...(plan.subtitles!.lang ? { lang: plan.subtitles!.lang } : {}) };
        await f.create(inputs.subs.path);
        await f.append(inputs.subs.path, new TextEncoder().encode(srt));
      }
      if (signal.aborted) throw signal.reason;
      rep.send('processing', fetched, true);
      let made: { out: string; ext: string } | null = null;
      for (const attempt of muxAttempts(inputs, plan.output, plan.audioOnly, `${dir}/out`, plan.scale, plan.clip)) {
        const code = await f.exec(attempt.args, (p) => rep.send('processing', fetched + p * (1 - fetched)), signal);
        if (signal.aborted) throw signal.reason;
        if (code === 0) {
          made = attempt;
          break;
        }
        console.warn('[grabby] ffmpeg attempt failed', attempt.args.join(' '), '\n', f.lastLogs());
      }
      if (!made) throw new Error('ffmpeg failed');
      const data = await f.read(made.out);
      await f.rmdir(dir);
      result = { blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: MIME[made.ext] ?? 'application/octet-stream' }), ext: made.ext };
    }

    if (signal.aborted) throw signal.reason;
    const url = URL.createObjectURL(result.blob);
    blobUrls.set(jobId, url);
    rep.send('saving', 1, true);
    // Kept apart when asked, or when the video couldn't take them (the MKV fallback can).
    const apart = srt && (plan.subtitles!.separate || plan.raw || !['mkv', 'mp4', 'mov', 'webm'].includes(result.ext)) ? srt : null;
    await toBg({ type: 'job-ready', jobId, blobUrl: url, ext: result.ext as OutputFormat, size: result.blob.size, ...(apart ? { subtitles: apart } : {}) });
  } catch (e) {
    if (ff) await ff.rmdir(dir).catch(() => {});
    if (pausing.has(jobId)) {
      await toBg({ type: 'job-paused', jobId });
    } else {
      const code = (e as { code?: ErrorCode }).code ?? errorCode(e);
      if (code !== 'canceled') console.warn('[grabby] job failed', jobId, e);
      await toBg({ type: 'job-error', jobId, error: code });
    }
  } finally {
    pausing.delete(jobId);
    if (ff) ff.users--;
    clearInterval(heartbeat);
    controllers.delete(jobId);
  }
}

chrome.runtime.onMessage.addListener((msg: BgToOffscreen) => {
  if (msg?.target !== 'offscreen') return;
  switch (msg.type) {
    case 'run':
      void run(msg.jobId, msg.plan);
      break;
    case 'cancel':
      controllers.get(msg.jobId)?.abort(new DOMException('Aborted', 'AbortError'));
      break;
    case 'pause':
      // Stops fetching; what is stored stays for the resume.
      if (controllers.has(msg.jobId)) {
        pausing.add(msg.jobId);
        controllers.get(msg.jobId)!.abort(new DOMException('Paused', 'AbortError'));
      }
      break;
    case 'release': {
      const url = blobUrls.get(msg.jobId);
      if (url) URL.revokeObjectURL(url);
      blobUrls.delete(msg.jobId);
      void deleteJob(msg.jobId).catch(() => {});
      void deleteParts(msg.jobId).catch(() => {});
      break;
    }
    case 'yt-start':
      startHiddenPlayer(msg.jobId, msg.src);
      break;
    case 'yt-stop':
      stopHiddenPlayer(msg.jobId);
      break;
    case 'ping':
      break;
  }
});
