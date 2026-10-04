/**
 * Offscreen document: downloads stream segments, assembles them with ffmpeg.wasm and
 * hands a Blob URL back to the service worker, which saves it with chrome.downloads.
 */
import type { BgToOffscreen, OffscreenToBg } from '../shared/messages';
import type { ErrorCode, OutputFormat, Plan, TrackPlan } from '../shared/plan';
import type { JobStatus } from '../shared/types';
import { deleteJob } from '../shared/idb';
import { inputExt, muxAttempts } from './args';
import { assembleCapture } from './capture';
import { fetchInOrder, fetchSegment, fetchStream, HttpError } from './fetcher';
import { getFFmpeg } from './muxer';
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

/** Raw mode (huge streams): concatenate into a Blob, skipping ffmpeg's memory limits. */
async function runRaw(rep: Reporter, plan: Plan, signal: AbortSignal) {
  const track = plan.video ?? plan.audio;
  if (!track) throw new Error('no track');
  const type = MIME[plan.output] ?? 'application/octet-stream';
  // A single file (direct-download fallback): stream it with byte-level progress.
  if (track.segments.length === 1 && !track.init && !track.segments[0]!.range) {
    let last = 0;
    const parts = await fetchStream(track.segments[0]!.url, {
      signal,
      onProgress: (received, total) => {
        rep.addBytes(received - last);
        last = received;
        rep.send('downloading', total ? received / total : 0);
      },
    });
    return { blob: new Blob(parts, { type }), ext: plan.output };
  }
  const parts: BlobPart[] = [];
  const total = segCount(track);
  let done = 0;
  if (track.init) {
    parts.push(await fetchSegment(track.init, { signal }));
    done++;
  }
  await fetchInOrder(track.segments, {
    signal,
    onBytes: (n) => rep.addBytes(n),
    onData: (_i, data) => {
      parts.push(data);
      done++;
      rep.send('downloading', done / total);
    },
  });
  return { blob: new Blob(parts, { type }), ext: plan.output };
}

async function run(jobId: string, plan: Plan) {
  const ctl = new AbortController();
  controllers.set(jobId, ctl);
  const signal = ctl.signal;
  const rep = reporter(jobId);
  const dir = `/j${jobId}`;
  const ff = plan.raw ? null : getFFmpeg();
  // Share of the progress bar for fetching: shrinking the picture is the long part.
  const fetched = plan.scale ? 0.3 : 0.9;
  // A recording is already stored: its bar continues from where the recording left it.
  if (plan.kind === 'capture') rep.send('processing', fetched, true);
  else rep.send('downloading', 0, true);
  const heartbeat = setInterval(() => rep.beat(), HEARTBEAT_MS);
  try {
    let result: { blob: Blob; ext: string };

    if (plan.raw) {
      result = await runRaw(rep, plan, signal);
    } else {
      const f = ff!;
      await f.mkdir(dir);
      const inputs: { video?: string; audio?: string } = {};
      let output: OutputFormat = plan.output;

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
        const total = segCount(plan.video) + segCount(plan.audio);
        let done = 0;
        for (const [key, track] of [['video', plan.video], ['audio', plan.audio]] as const) {
          if (!track) continue;
          const path = `${dir}/${key[0]}.${inputExt(track.container, track.segments[0]?.url)}`;
          inputs[key] = path;
          await f.create(path);
          if (track.init) {
            const init = await fetchSegment(track.init, { signal });
            rep.addBytes(init.length);
            await f.append(path, init);
            done++;
          }
          await fetchInOrder(track.segments, {
            signal,
            onBytes: (n) => rep.addBytes(n),
            onData: async (_i, data) => {
              await f.append(path, data);
              done++;
              rep.send('downloading', (done / total) * fetched);
            },
          });
        }
      }

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      rep.send('processing', fetched, true);
      let made: { out: string; ext: string } | null = null;
      for (const attempt of muxAttempts(inputs, output, plan.audioOnly, `${dir}/out`, plan.scale)) {
        const code = await f.exec(attempt.args, (p) => rep.send('processing', fetched + p * (1 - fetched)));
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
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

    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = URL.createObjectURL(result.blob);
    blobUrls.set(jobId, url);
    rep.send('saving', 1, true);
    await toBg({ type: 'job-ready', jobId, blobUrl: url, ext: result.ext as OutputFormat, size: result.blob.size });
  } catch (e) {
    const code = (e as { code?: ErrorCode }).code ?? errorCode(e);
    if (code !== 'canceled') console.warn('[grabby] job failed', jobId, e);
    await toBg({ type: 'job-error', jobId, error: code });
    if (ff) await ff.rmdir(dir).catch(() => {});
  } finally {
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
      controllers.get(msg.jobId)?.abort();
      break;
    case 'release': {
      const url = blobUrls.get(msg.jobId);
      if (url) URL.revokeObjectURL(url);
      blobUrls.delete(msg.jobId);
      void deleteJob(msg.jobId).catch(() => {});
      break;
    }
    case 'yt-start':
      if (__TARGET__ === 'github') startHiddenPlayer(msg.jobId, msg.src);
      break;
    case 'yt-stop':
      if (__TARGET__ === 'github') stopHiddenPlayer(msg.jobId);
      break;
    case 'ping':
      break;
  }
});
