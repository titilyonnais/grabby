/**
 * Offscreen document: downloads stream segments, assembles them with ffmpeg.wasm and
 * hands a Blob URL back to the service worker, which saves it with chrome.downloads.
 */
import type { BgToOffscreen, OffscreenToBg } from '../shared/messages';
import { planSubs, type Chapter, type Clip, type ErrorCode, type OutputFormat, type Plan, type PlanSubs, type SegRef, type TrackPlan } from '../shared/plan';
import { clipChapters, ffmetadata, partChapters } from '../shared/chapters';
import { clipLabel } from '../shared/clip';
import { isImageFormat } from '../shared/formats';
import type { JobStatus } from '../shared/types';
import { deleteJob } from '../shared/idb';
import { cutBefore } from '../shared/mediatime';
import { deleteParts, putPart, storedBlobs, storedSizes } from '../shared/parts';
import { imageAttempts, inputExt, muxAttempts, type Attempt, type ClipArgs, type MuxInputs } from './args';
import { assembleSessions, capturedCaptions, type CapturedTrack } from './capture';
import { fetchAll, HttpError, limiter, rangeSupport, rangesOf, streamFile } from './fetcher';
import { type FFmpeg, getFFmpeg } from './muxer';
import { Pacer } from './pacer';
import { clipCues, cuesOf, toSrt, type Cue } from '../shared/subtitles';
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
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
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

/** Subtitle tracks of a stream are stored from this track number on (one each). */
const SUBS_TRACK = 100;
/** Other sound tracks of a stream are stored from this track number on. */
const AUDIOS_TRACK = 10;

/**
 * The cues of each subtitle track, on the video's clock. A track that can't be fetched
 * doesn't sink the video: it is saved without it.
 */
async function subtitlesOf(jobId: string, plan: Plan, o: TrackRun): Promise<{ sub: PlanSubs; cues: Cue[] }[]> {
  const out: { sub: PlanSubs; cues: Cue[] }[] = [];
  let captured = 0;
  for (const [i, sub] of planSubs(plan).entries()) {
    let parts: Uint8Array[];
    if (sub.captured) {
      // Loaded by the recorded player: stored with the recording, in the order asked for.
      const text = await capturedCaptions(jobId, captured++);
      if (!text) continue;
      parts = [text];
    } else {
      try {
        await fetchTrack(jobId, SUBS_TRACK + i, sub.track, o);
      } catch (e) {
        if (o.signal.aborted) throw e;
        console.warn('[grabby] subtitles left out', e);
        continue;
      }
      parts = await Promise.all((await storedBlobs(jobId, SUBS_TRACK + i)).map(async (b) => new Uint8Array(await b.arrayBuffer())));
    }
    const cues = cuesOf(parts, sub.track.container, sub.clock);
    if (cues.length) out.push({ sub, cues });
  }
  return out;
}

/**
 * Where each part of what is saved comes from on the video's clock: one span for a part (it
 * starts `lead` before it), one per part joined end to end, none for the whole video.
 */
type Spans = { from: number; length: number }[] | null;

/** Cues moved onto the clock of what is saved. */
function cuesFor(cues: Cue[], spans: Spans): Cue[] {
  if (!spans) return cues;
  let at = 0;
  const out: Cue[] = [];
  for (const s of spans) {
    for (const c of clipCues(cues, s.from, s.length)) out.push({ ...c, start: c.start + at, end: c.end + at });
    at += s.length;
  }
  return out;
}

/** The subtitles as SubRip, on the clock of what is saved. */
function srtOf(cues: Cue[], spans: Spans): string | null {
  const kept = cuesFor(cues, spans);
  return kept.length ? toSrt(kept) : null;
}

/**
 * A part cut without re-encoding the picture starts on the keyframe before it: how much
 * earlier, in seconds (0 when it can't tell). Read from the first packet ffmpeg copies.
 */
async function keyframeLead(f: FFmpeg, dir: string, path: string, at: number, signal: AbortSignal): Promise<number> {
  if (!(at > 0)) return 0;
  const probe = `${dir}/key.txt`;
  try {
    const start = await startOf(f, path, signal);
    const code = await f.exec(['-y', '-ss', String(at), '-copyts', '-i', path, '-map', '0:v:0', '-c', 'copy', '-frames:v', '1', '-f', 'framecrc', probe], undefined, signal);
    if (code !== 0) return 0;
    const text = new TextDecoder().decode(await f.read(probe));
    const tb = /#tb 0: (\d+)\/(\d+)/.exec(text);
    const pkt = /^0,\s*(-?\d+),\s*(-?\d+),/m.exec(text);
    if (!tb || !pkt) return 0;
    const key = (Number(pkt[2]) * Number(tb[1])) / Number(tb[2]);
    const lead = start + at - key;
    // Keyframes are a few seconds apart at most: anything else is a misreading.
    return lead > 0.001 && lead < 30 ? Math.round(lead * 1000) / 1000 : 0;
  } catch (e) {
    if (signal.aborted) throw e;
    return 0;
  }
}

/** Where a file's timestamps start, in seconds, as ffmpeg reads it (0 when it can't tell). */
async function startOf(f: FFmpeg, path: string, signal: AbortSignal): Promise<number> {
  await f.exec(['-hide_banner', '-i', path], undefined, signal);
  const m = /Duration:[^\n]*?start:\s*(-?\d+(?:\.\d+)?)/.exec(f.lastLogs());
  return m ? Number(m[1]) : 0;
}

/** Writes the tracks of one recording session into ffmpeg's memory, video and audio apart. */
async function loadCaptured(f: FFmpeg, dir: string, name: string, tracks: CapturedTrack[], audioOnly: boolean, rep: Reporter) {
  const inputs: MuxInputs = {};
  for (const t of tracks) {
    const ext = t.mime.includes('webm') ? 'webm' : 'mp4';
    const key = t.kind === 'audio' && !inputs.audio ? 'audio' : !inputs.video ? 'video' : null;
    if (!key) continue;
    inputs[key] = `${dir}/${name}${key[0]}.${ext}`;
    await f.create(inputs[key]!);
    await f.append(inputs[key]!, t.data);
    rep.addBytes(t.data.byteLength);
  }
  if (!inputs.video && !audioOnly) {
    inputs.video = inputs.audio;
    delete inputs.audio;
  }
  return inputs;
}

/**
 * Where a session's file stops for the next one, whose picture starts at `joint`: before the
 * frame shown there (see cutBefore). `joint` itself when the frames can't be read.
 */
async function stopBefore(f: FFmpeg, dir: string, path: string, start: number, joint: number, signal: AbortSignal): Promise<number> {
  const probe = `${dir}/cut.txt`;
  try {
    // -ss counts from the start of the file, not on the video's clock.
    const from = Math.max(0, joint - 6 - start);
    const code = await f.exec(['-y', '-ss', String(from), '-copyts', '-i', path, '-map', '0:v:0', '-c', 'copy', '-frames:v', '1200', '-f', 'framecrc', probe], undefined, signal);
    if (code !== 0) return joint;
    const at = cutBefore(new TextDecoder().decode(await f.read(probe)), joint);
    // A frame is decoded at most a few frames before it is shown: anything else is a misreading.
    return at !== undefined && at <= joint && at > joint - 1 ? at : joint;
  } catch (e) {
    if (signal.aborted) throw e;
    return joint;
  }
}

/**
 * A recording made in several sessions: each one is put in a file keeping the video's own
 * clock, then they are joined. The joint is where every track of the next session has
 * started (its sound usually starts a few seconds before its picture, which waits for a
 * keyframe): the session before stops there, the next one starts there. The next one began a
 * little before what the session before had stored, so nothing is missing and nothing plays
 * twice. Returns the joined file and where it starts on the video's clock.
 */
async function joinSessions(
  f: FFmpeg,
  dir: string,
  sessions: { session: number; tracks: CapturedTrack[] }[],
  plan: Plan,
  rep: Reporter,
  signal: AbortSignal,
): Promise<{ inputs: MuxInputs; base: number }> {
  const files: { path: string; start: number; joint: number }[] = [];
  for (const [k, s] of sessions.entries()) {
    const ins = await loadCaptured(f, dir, `s${k}`, s.tracks, plan.audioOnly, rep);
    const list = [ins.video, ins.audio].filter((x): x is string => !!x);
    const starts: number[] = [];
    for (const i of list) starts.push(await startOf(f, i, signal));
    const out = `${dir}/p${k}.mkv`;
    const code = await f.exec(['-y', '-copyts', ...list.flatMap((i) => ['-i', i]), ...list.flatMap((_, n) => ['-map', String(n)]), '-c', 'copy', out], undefined, signal);
    if (signal.aborted) throw signal.reason;
    if (code !== 0) {
      console.warn('[grabby] session left out', k, f.lastLogs());
      continue;
    }
    files.push({ path: out, start: Math.min(...starts), joint: Math.max(...starts) });
  }
  if (!files.length) throw Object.assign(new Error('capture'), { code: 'capture_failed' });
  // A session that starts earlier than the one before it (the player went back) replaces it.
  const kept = files.filter((x, i) => !files.slice(i + 1).some((y) => y.start <= x.start + 0.05));
  const lines = ['ffconcat version 1.0'];
  for (const [i, x] of kept.entries()) {
    lines.push(`file '${x.path}'`);
    if (i > 0) lines.push(`inpoint ${x.joint.toFixed(3)}`);
    const next = kept[i + 1];
    if (!next) continue;
    lines.push(`outpoint ${(await stopBefore(f, dir, x.path, x.start, next.joint, signal)).toFixed(6)}`);
    // Where the next one goes stays the joint, not where this one stops.
    lines.push(`duration ${(next.joint - (i > 0 ? x.joint : x.start)).toFixed(6)}`);
  }
  console.debug('[grabby] sessions joined', JSON.stringify(lines.slice(1)));
  const list = `${dir}/sessions.txt`;
  await f.create(list);
  await f.append(list, new TextEncoder().encode(`${lines.join('\n')}\n`));
  const joined = `${dir}/joined.mkv`;
  const code = await f.exec(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0', '-c', 'copy', joined], undefined, signal);
  if (signal.aborted) throw signal.reason;
  if (code !== 0) throw new Error(`ffmpeg: sessions not joined\n${f.lastLogs()}`);
  return { inputs: { video: joined }, base: kept[0]!.start };
}

/** Tries ffmpeg runs in order until one works. */
async function run1(f: FFmpeg, attempts: Attempt[], rep: Reporter, fetched: number, signal: AbortSignal): Promise<Attempt> {
  rep.send('processing', fetched, true);
  for (const attempt of attempts) {
    console.debug('[grabby] ffmpeg', attempt.args.join(' '));
    const code = await f.exec(attempt.args, (p) => rep.send('processing', fetched + p * (1 - fetched)), signal);
    if (signal.aborted) throw signal.reason;
    if (code === 0) return attempt;
    console.warn('[grabby] ffmpeg attempt failed', attempt.args.join(' '), '\n', f.lastLogs());
  }
  throw new Error('ffmpeg failed');
}

/**
 * Several parts joined in one file: each one is cut from the inputs (its picture from the
 * keyframe before it, with its sound), then they are put end to end. Returns the joined
 * file, where each part comes from, and one chapter per part.
 */
async function joinParts(f: FFmpeg, dir: string, inputs: MuxInputs, plan: Plan, signal: AbortSignal): Promise<{ path: string; spans: NonNullable<Spans>; chapters: Chapter[] }> {
  const clip = plan.clip!;
  const pieces: { path: string; part: Clip; length: number; from: number }[] = [];
  const own: MuxInputs = {
    ...(inputs.video ? { video: inputs.video } : {}),
    ...(inputs.audio ? { audio: inputs.audio } : {}),
    ...(inputs.audios ? { audios: inputs.audios } : {}),
    ...(inputs.audioMeta ? { audioMeta: inputs.audioMeta } : {}),
  };
  for (const [i, part] of plan.parts!.entries()) {
    const shift = part.start - clip.start;
    const at = (x?: number) => (x === undefined ? undefined : Math.max(0, x + shift));
    const cut: ClipArgs = {
      duration: part.end - part.start,
      ...(clip.video !== undefined ? { video: at(clip.video)! } : {}),
      ...(clip.audio !== undefined ? { audio: at(clip.audio)! } : {}),
      ...(clip.audios ? { audios: clip.audios.map((x) => at(x)!) } : {}),
    };
    const lead = !plan.audioOnly && !plan.scale && own.video ? await keyframeLead(f, dir, own.video, cut.video ?? shift, signal) : 0;
    if (lead) cut.lead = lead;
    const ext = plan.audioOnly ? undefined : 'mkv';
    const attempts = muxAttempts(own, ext ? 'mkv' : plan.output, plan.audioOnly, `${dir}/part${i}`, plan.scale, cut);
    let made: Attempt | null = null;
    for (const a of attempts) {
      const code = await f.exec(a.args, undefined, signal);
      if (signal.aborted) throw signal.reason;
      if (code === 0) {
        made = a;
        break;
      }
    }
    if (!made) throw new Error(`ffmpeg: part ${i} not cut\n${f.lastLogs()}`);
    pieces.push({ path: made.out, part, length: cut.duration + lead, from: part.start - lead });
  }
  const list = `${dir}/parts.txt`;
  await f.create(list);
  await f.append(list, new TextEncoder().encode(`ffconcat version 1.0\n${pieces.map((p) => `file '${p.path}'`).join('\n')}\n`));
  const ext = pieces[0]!.path.split('.').pop()!;
  const path = `${dir}/parts.${ext}`;
  const code = await f.exec(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0', '-c', 'copy', path], undefined, signal);
  if (signal.aborted) throw signal.reason;
  if (code !== 0) throw new Error(`ffmpeg: parts not joined\n${f.lastLogs()}`);
  return {
    path,
    spans: pieces.map((p) => ({ from: p.from, length: p.length })),
    chapters: partChapters(pieces.map((p) => ({ clip: p.part, length: p.length })), (c) => clipLabel(c)),
  };
}

/** A sound file's cover: the video's picture, fetched (a page's picture may be gone: then none). */
async function coverFile(f: FFmpeg, dir: string, url: string, signal: AbortSignal): Promise<string | null> {
  try {
    if (!/^(https?|data):/i.test(url)) return null;
    const res = await fetch(url, { signal, credentials: 'omit' });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > 8 * 2 ** 20) return null;
    // Its kind, from its first bytes: ffmpeg needs the right extension for a picture.
    const ext = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : bytes[8] === 0x57 && bytes[9] === 0x45 ? 'webp' : null;
    if (!ext) return null;
    const path = `${dir}/cover.${ext}`;
    await f.create(path);
    await f.append(path, bytes);
    return path;
  } catch (e) {
    if (signal.aborted) throw e;
    return null;
  }
}

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
    /** Subtitles saved next to the file. */
    let apart: { srt: string; lang?: string }[] = [];

    if (plan.kind !== 'capture') {
      const tracks = [
        ...([[0, plan.video], [1, plan.audio]] as const).flatMap(([n, t]) => (t ? [{ n, t }] : [])),
        ...(plan.audios ?? []).map((a, i) => ({ n: AUDIOS_TRACK + i, t: a.track })),
      ];
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
    }
    // Subtitles: fetched like the rest (for a recording, once it is over).
    const subs = await subtitlesOf(jobId, plan, { signal, rep, pacer: new Pacer(), fast: false, setCount: () => {}, onPart: () => {}, onBytes: () => {} });
    if (signal.aborted) throw signal.reason;

    if (plan.raw) {
      apart = subs.flatMap(({ sub, cues }) => {
        const srt = srtOf(cues, plan.clip ? [{ from: plan.clip.start, length: plan.clip.duration }] : null);
        return srt ? [{ srt, ...(sub.lang ? { lang: sub.lang } : {}) }] : [];
      });
      rep.send('saving', 1, true);
      result = await joinRaw(jobId, plan);
    } else {
      const f = ff!;
      await f.mkdir(dir);
      if (plan.kind === 'capture') {
        rep.send('processing', 0, true);
        const sessions = await assembleSessions(jobId, plan.keepTracks);
        if (!sessions.length) throw Object.assign(new Error('capture'), { code: 'capture_failed' });
        if (sessions.length === 1) {
          Object.assign(inputs, await loadCaptured(f, dir, '', sessions[0]!.tracks, plan.audioOnly, rep));
          // A part: each track is cut from where the part starts in it.
          if (plan.clip) {
            const video = inputs.video ? plan.clip.start - (await startOf(f, inputs.video, signal)) : undefined;
            const audio = inputs.audio ? plan.clip.start - (await startOf(f, inputs.audio, signal)) : undefined;
            plan = { ...plan, clip: { ...plan.clip, ...(video !== undefined ? { video: Math.max(0, video) } : {}), ...(audio !== undefined ? { audio: Math.max(0, audio) } : {}) } };
          }
        } else {
          const joined = await joinSessions(f, dir, sessions, plan, rep, signal);
          Object.assign(inputs, joined.inputs);
          if (plan.clip) plan = { ...plan, clip: { ...plan.clip, video: Math.max(0, plan.clip.start - joined.base) } };
        }
      } else {
        rep.send('processing', fetched, true);
        for (const [key, track, n] of [['video', plan.video, 0], ['audio', plan.audio, 1]] as const) {
          if (!track) continue;
          inputs[key] = `${dir}/${key[0]}.${inputExt(track.container, track.segments[0]?.url)}`;
          await loadTrack(f, jobId, n, inputs[key]!, signal);
        }
        for (const [i, a] of (plan.audios ?? []).entries()) {
          const path = `${dir}/a${i + 2}.${inputExt(a.track.container, a.track.segments[0]?.url)}`;
          await loadTrack(f, jobId, AUDIOS_TRACK + i, path, signal);
          (inputs.audios ??= []).push({ path, title: a.label, ...(a.lang ? { lang: a.lang } : {}) });
        }
        if (plan.audioInfo && (inputs.audio || inputs.video)) {
          inputs.audioMeta = { ...(plan.audioInfo.lang ? { lang: plan.audioInfo.lang } : {}), ...(plan.audios?.length && plan.audioInfo.label ? { title: plan.audioInfo.label } : {}) };
        }
      }
      if (signal.aborted) throw signal.reason;

      let made: { out: string; ext: string };
      if (plan.image || isImageFormat(plan.output)) {
        made = await run1(f, imageAttempts(inputs.video ?? inputs.audio!, plan.output, `${dir}/out`, plan.clip?.video ?? 0, plan.clip?.duration ?? 1), rep, fetched, signal);
      } else {
        let spans: Spans = null;
        if (plan.parts?.length && plan.clip) {
          // Several parts: each one cut on its own, then put end to end.
          const joined = await joinParts(f, dir, inputs, plan, signal);
          // The pieces hold every sound track already (and their names).
          Object.assign(inputs, { video: joined.path, ...(inputs.audios?.length ? { allAudio: true } : {}) });
          delete inputs.audio;
          delete inputs.audios;
          spans = joined.spans;
          plan = { ...plan, chapters: joined.chapters };
          delete plan.clip;
        } else if (plan.clip) {
          // A part whose picture is copied starts on a keyframe, a little earlier: the sound,
          // the subtitles and the chapters start there too.
          const clip = plan.clip;
          let lead = 0;
          if (!plan.audioOnly && !plan.scale && inputs.video) {
            lead = await keyframeLead(f, dir, inputs.video, clip.video ?? 0, signal);
            if (lead) plan = { ...plan, clip: { ...clip, lead } };
          }
          spans = [{ from: clip.start - lead, length: clip.duration + lead }];
          if (plan.chapters) plan = { ...plan, chapters: clipChapters(plan.chapters, clip, lead) };
        }
        const total = spans ? spans.reduce((n, s) => n + s.length, 0) : Infinity;
        const inside: MuxInputs['subs'] = [];
        for (const [i, { sub, cues }] of subs.entries()) {
          const srt = srtOf(cues, spans);
          if (!srt) continue;
          if (sub.separate) {
            apart.push({ srt, ...(sub.lang ? { lang: sub.lang } : {}) });
            continue;
          }
          const path = `${dir}/s${i}.srt`;
          await f.create(path);
          await f.append(path, new TextEncoder().encode(srt));
          inside.push({ path, title: sub.label, ...(sub.lang ? { lang: sub.lang } : {}) });
        }
        if (inside.length) inputs.subs = inside;
        if (plan.chapters?.length) {
          inputs.chapters = `${dir}/chapters.txt`;
          await f.create(inputs.chapters);
          await f.append(inputs.chapters, new TextEncoder().encode(ffmetadata(plan.chapters, Number.isFinite(total) ? total : (plan.chapters.at(-1)!.start + 1))));
        }
        if (plan.meta) inputs.meta = { ...(plan.meta.title ? { title: plan.meta.title } : {}), ...(plan.meta.artist ? { artist: plan.meta.artist } : {}) };
        if (plan.meta?.cover && plan.audioOnly) {
          const cover = await coverFile(f, dir, plan.meta.cover, signal);
          if (cover) inputs.cover = cover;
        }
        if (signal.aborted) throw signal.reason;
        made = await run1(f, muxAttempts(inputs, plan.output, plan.audioOnly, `${dir}/out`, plan.scale, plan.clip), rep, fetched, signal);
        // Subtitles the video couldn't take (the MKV fallback can): next to it instead.
        if (inside.length && !['mkv', 'mp4', 'mov', 'webm'].includes(made.ext)) {
          for (const s of inside) {
            const srt = new TextDecoder().decode(await f.read(s.path));
            apart.push({ srt, ...(s.lang ? { lang: s.lang } : {}) });
          }
        }
      }
      const data = await f.read(made.out);
      await f.rmdir(dir);
      result = { blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: MIME[made.ext] ?? 'application/octet-stream' }), ext: made.ext };
    }

    if (signal.aborted) throw signal.reason;
    const url = URL.createObjectURL(result.blob);
    blobUrls.set(jobId, url);
    rep.send('saving', 1, true);
    await toBg({ type: 'job-ready', jobId, blobUrl: url, ext: result.ext as OutputFormat, size: result.blob.size, ...(apart.length ? { subtitles: apart } : {}) });
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
      limiter.set(msg.rate ?? 0);
      void run(msg.jobId, msg.plan);
      break;
    case 'rate':
      limiter.set(msg.rate);
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
      stopHiddenPlayer(msg.jobId, msg.hold);
      break;
    case 'ping':
      break;
  }
});
