import { hostOf } from '../parsers/url';
import { isAudioFormat, isImageFormat, VIDEO_FORMATS } from '../shared/formats';
import { audioChoices } from '../shared/audio';
import { canShrink, scaleChoices, SHRUNK_FORMATS } from '../shared/scale';
import { buildFilename, folderFor } from '../shared/filename';
import { canClip, clipLabel, clock, sameClip } from '../shared/clip';
import { uid } from '../shared/ids';
import type { BgToContent, ContentToBg, DownloadExtra, OffscreenToBg } from '../shared/messages';
import { planSubs, subsIds, type Clip, type ErrorCode, type OutputFormat, type Plan, type VideoFormat } from '../shared/plan';
import { DEFAULT_SETTINGS, getSettings, type Settings } from '../shared/settings';
import { holdOf, playbackCap, type Hold } from '../shared/schedule';
import type { Job, JobMode, JobStatus, MediaItem } from '../shared/types';
import { fetchTextAs, sweepHeaderRules, withPageHeaders } from './headers';
import { addHistory } from './history';
import { notifyFinished } from './notify';
import { scheduleOffscreenClose, sendOffscreen } from './offscreen-client';
import { buildPlan, imageClip, joinedParts, PlanError, validClip } from './plan';
import { hiddenPlayerUrl } from '../features/youtube';
import { allowHiddenPlayer } from './headers';
import { ensureOffscreen } from './offscreen-client';
import type { Registry } from './registry';
import { findVisible } from './visible';
import { deleteParts, storedJobs } from '../shared/parts';
import { capturedJobs, deleteJob, isCaptionTrack, listTrackMimes, mergeKeep, sessionOf, trackTail } from '../shared/idb';
import { storedEnd } from '../shared/mediatime';
import { rank } from '../shared/rank';
import { cuesOf, toSrt } from '../shared/subtitles';
import { listItem, numbered, type YtList } from '../shared/ytlist';
import { sponsorParts, withoutSponsors } from '../shared/sponsors';

const STORE_KEY = 'jobs';
/** A job's download plan, kept apart (it can be big) for resuming. */
const PLAN_KEY = (id: string) => `plan:${id}`;
/** Set for the browser session: missing at startup means the browser was restarted. */
const BOOT_KEY = 'booted';
const WAKE_ALARM = 'grabby-resume';
/** Rings when the time window chosen for downloads opens. */
export const SCHEDULE_ALARM = 'grabby-schedule';
const MAX_PARALLEL = 2;
/** Tries in a row for the network before giving up (about 40 min of waiting in all). */
const MAX_ATTEMPTS = 24;
const KEEP_FINISHED_MS = 30 * 60_000;
const STALL_MS = 120_000;
/** A recording that receives nothing for this long is wrapped up, or carried on later. */
const CAPTURE_STALL_MS = 60_000;
/** A recording that carries on starts again this far back: what was stored last may be missing. */
const CAPTURE_OVERLAP = 8;
/** Hidden players recording at the same time (each plays at high speed). */
const MAX_HIDDEN = 2;

const ACTIVE: JobStatus[] = ['downloading', 'capturing', 'processing', 'saving'];
/** Share of the progress bar for recording a playback; assembling it takes the rest. */
const CAPTURE_SHARE = 0.9;
const FINISHED: JobStatus[] = ['done', 'error', 'canceled'];

const INTERRUPT_REASONS: Record<string, ErrorCode> = {
  SERVER_FORBIDDEN: 'http_403',
  SERVER_UNAUTHORIZED: 'http_403',
  SERVER_BAD_CONTENT: 'http_404',
  SERVER_FAILED: 'http_other',
  USER_CANCELED: 'canceled',
};

/** The name a file gets from its job: the title, and which part of the video it holds. */
export function titleOf(job: Pick<Job, 'title' | 'clip' | 'parts' | 'at' | 'sheet'>): string {
  if (job.sheet !== undefined) return `${job.title} (${(typeof chrome !== 'undefined' && chrome.i18n?.getMessage('sheetName')) || 'contact sheet'})`;
  if (job.at !== undefined) return `${job.title} (${clock(job.at).replace(':', 'm')})`;
  if (job.parts?.length) return `${job.title} (${job.parts.map(clipLabel).join(' + ')})`;
  return job.clip ? `${job.title} (${clipLabel(job.clip)})` : job.title;
}

/** The expected size of a part of a video: its share of the whole. */
function partOf(size: number, clip: Clip | undefined, duration: number | undefined): number {
  return clip && duration ? Math.round((size * (clip.end - clip.start)) / duration) : size;
}

/**
 * How far a recording really got, in seconds of the video: the latest session before `below`
 * that stored something, up to where all its tracks (those of the video itself) hold data.
 * The player runs ahead of what is stored (and what was in flight when it stopped is lost).
 */
export async function storedUntil(jobId: string, keep: number[] | undefined, below = Infinity): Promise<number | undefined> {
  const tracks = (await listTrackMimes(jobId)).filter((t) => !isCaptionTrack(t.track));
  const session = Math.max(-1, ...tracks.map((t) => sessionOf(t.track)).filter((s) => s < below));
  if (session < 0) return undefined;
  const own = tracks.filter((t) => sessionOf(t.track) === session);
  const kept = own.filter((t) => keep?.includes(t.track));
  let end: number | undefined;
  for (const t of kept.length ? kept : own) {
    const { init, last } = await trackTail(jobId, t.track);
    const at = init ? storedEnd(t.mime, new Uint8Array(init), last.map((c) => new Uint8Array(c.data))) : undefined;
    if (at === undefined) return undefined;
    end = Math.min(end ?? Infinity, at);
  }
  return end;
}

/** A recording that carries on from what was stored starts again this far before it. */
const STORED_MARGIN = 1;

/** Waits between tries for the network: 3 s, 6 s, 12 s… up to 2 min. */
export function retryDelay(attempt: number): number {
  return Math.min(120_000, 3000 * 2 ** Math.max(0, attempt - 1));
}

function interruptCode(reason: string | undefined): ErrorCode {
  if (!reason) return 'unknown';
  if (reason.startsWith('NETWORK_')) return 'network';
  return INTERRUPT_REASONS[reason] ?? 'unknown';
}

/**
 * The browser's "ask where to save each file" setting wins over Grabby's: while its dialog
 * is open, the file already downloads but has no name yet. Noticed here so the popup can
 * explain it and point to that setting.
 */
export const BROWSER_ASKS_KEY = 'browserAsks';
function watchSavePrompt(downloadId: number) {
  setTimeout(async () => {
    const [d] = await chrome.downloads.search({ id: downloadId }).catch(() => []);
    if (!d) return;
    if (d.filename) await chrome.storage.local.set({ [BROWSER_ASKS_KEY]: false });
    else if (d.state === 'in_progress' && d.bytesReceived > 0) await chrome.storage.local.set({ [BROWSER_ASKS_KEY]: true });
  }, 1500);
}

export class JobManager {
  private jobs = new Map<string, Job>();
  /** Header rules held by running jobs (in memory; orphans are swept once idle). */
  private releases = new Map<string, () => Promise<void>>();
  private lastUpdate = new Map<string, number>();
  /** What each download was asked for ("tab:media"), in case the page drops it meanwhile. */
  private items = new Map<string, MediaItem>();
  /** Stalled recordings the page was asked to end. */
  private stopAsked = new Set<string>();
  /** Last byte count of each job and when it was seen, to measure the speed. */
  private rate = new Map<string, { at: number; bytes: number }>();
  /** Plans of jobs that may be resumed (also in storage, for after a restart). */
  private plans = new Map<string, Plan>();
  private listeners: (() => void)[] = [];
  /** "Quand télécharger": the time window, Wi-Fi only, the speed limit (kept in step with the settings). */
  private gate: Pick<Settings, 'scheduleOn' | 'scheduleFrom' | 'scheduleTo' | 'wifiOnly' | 'rateLimit'> = DEFAULT_SETTINGS;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  readonly ready: Promise<void>;

  constructor(private registry: Registry) {
    this.ready = this.restore();
    chrome.downloads.onChanged.addListener((d) => void this.onDownloadChanged(d));
    chrome.storage.onChanged.addListener((changes, area) => {
      const next = area === 'local' ? (changes.settings?.newValue as Partial<Settings> | undefined) : undefined;
      if (!next) return;
      const rate = this.gate.rateLimit;
      this.gate = { ...DEFAULT_SETTINGS, ...next };
      // Downloads under way slow down (or speed up) at once.
      if (this.gate.rateLimit !== rate && this.isBusy()) void sendOffscreen({ target: 'offscreen', type: 'rate', rate: this.gate.rateLimit }).catch(() => {});
      this.pump();
    });
  }

  /* ------------------------------------------------------------------ state */

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  list(tabId?: number): Job[] {
    const all = [...this.jobs.values()].sort((a, b) => queueRank(a) - queueRank(b));
    return tabId === undefined ? all : all.filter((j) => j.tabId === tabId);
  }

  isCapturing(jobId: string): boolean {
    return this.jobs.get(jobId)?.status === 'capturing';
  }

  isBusy(): boolean {
    return [...this.jobs.values()].some((j) => ACTIVE.includes(j.status) || (j.status === 'queued' && !j.held));
  }

  /** Jobs waiting to try again on their own (network, browser restart). */
  private waiting(): Job[] {
    return [...this.jobs.values()].filter((j) => j.status === 'paused' && j.pausedBy !== 'user' && j.retryAt !== undefined);
  }

  /** A download can be paused while it fetches or records (not while it assembles). */
  static canPause(j: Job): boolean {
    return j.status === 'downloading' || j.status === 'queued' || j.status === 'capturing';
  }

  /** True once the job was canceled or dropped: long-running steps check it after each await. */
  private gone(id: string): boolean {
    const j = this.jobs.get(id);
    return !j || FINISHED.includes(j.status);
  }

  private update(id: string, patch: Partial<Job>): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    // Never resurrect finished jobs from late events.
    if (FINISHED.includes(job.status) && patch.status && !FINISHED.includes(patch.status) && patch.status !== 'queued') {
      return job;
    }
    const running = !FINISHED.includes(patch.status ?? job.status);
    // One bar for the whole job: a new step (assembly after download) never sends it back.
    if (running && patch.progress !== undefined && patch.progress < job.progress) patch = { ...patch, progress: job.progress };
    if (running && patch.bytes !== undefined && patch.speed === undefined) patch = { ...patch, speed: this.speedOf(job, patch.bytes) };
    Object.assign(job, patch);
    this.lastUpdate.set(id, Date.now());
    this.changed();
    return job;
  }

  /** Current speed, smoothed over the last seconds; 0 once nothing arrives any more. */
  private speedOf(job: Job, bytes: number): number {
    const now = Date.now();
    const last = this.rate.get(job.id);
    if (!last || bytes < last.bytes) {
      this.rate.set(job.id, { at: now, bytes });
      return job.speed;
    }
    const dt = now - last.at;
    if (bytes === last.bytes) return dt > 3000 ? 0 : job.speed;
    if (dt < 250) return job.speed;
    this.rate.set(job.id, { at: now, bytes });
    const instant = ((bytes - last.bytes) * 1000) / dt;
    return job.speed ? job.speed * 0.6 + instant * 0.4 : instant;
  }

  private changed() {
    const now = Date.now();
    for (const [id, j] of this.jobs) {
      if (FINISHED.includes(j.status) && now - (this.lastUpdate.get(id) ?? j.startedAt) > KEEP_FINISHED_MS) this.jobs.delete(id);
    }
    // Kept across browser restarts, so an interrupted download can carry on. Written at most
    // every 300 ms but never put off: progress comes several times a second, and pushing the
    // write back each time meant it never happened while a download ran.
    this.persistTimer ??= setTimeout(() => {
      this.persistTimer = undefined;
      void chrome.storage.local.set({ [STORE_KEY]: [...this.jobs.values()] }).catch(() => {});
    }, 300);
    for (const l of this.listeners) l();
    if (this.isBusy() || this.waiting().length) this.startPolling();
    if (!this.isBusy()) scheduleOffscreenClose(() => this.isBusy());
  }

  private async restore() {
    this.gate = await getSettings();
    const saved = ((await chrome.storage.local.get(STORE_KEY))[STORE_KEY] as Job[] | undefined) ?? [];
    // No mark for this browser session yet: the browser (or the computer) restarted.
    const restarted = !(await chrome.storage.session.get(BOOT_KEY))[BOOT_KEY];
    await chrome.storage.session.set({ [BOOT_KEY]: true });
    const now = Date.now();
    for (const j of saved) {
      if (restarted) {
        // Results of the previous session are in the history; only unfinished work stays.
        if (FINISHED.includes(j.status)) continue;
        if (j.kind === 'capture' && j.status === 'paused' && (j.pausedBy === 'user' || j.pausedBy === 'page')) {
          // Paused on purpose: it waits for the user.
        } else if (j.kind === 'capture') {
          // A recording carries on where it got to (YouTube: in a new hidden player; another
          // site: in its page, opened again if needed). Its first part is kept.
          Object.assign(j, { status: 'paused', pausedBy: 'restart', retryAt: now + 3000, speed: 0 });
        } else if (!(j.status === 'paused' && j.pausedBy === 'user')) {
          // Its file was being written from memory that is gone: fetch what's missing again.
          if (j.blob) delete j.downloadId;
          Object.assign(j, { status: 'paused', pausedBy: 'restart', retryAt: now + 2000, speed: 0 });
        }
      }
      this.jobs.set(j.id, j);
      this.lastUpdate.set(j.id, now);
    }
    // Pieces no job owns any more (a job dropped while its pieces were being written), and
    // recordings left by jobs that are gone.
    void storedJobs()
      .then((ids) => Promise.all(ids.filter((id) => !this.jobs.has(id)).map((id) => deleteParts(id))))
      .catch(() => {});
    void capturedJobs()
      .then((ids) => Promise.all(ids.filter((id) => !this.jobs.has(id) || FINISHED.includes(this.jobs.get(id)!.status)).map((id) => deleteJob(id))))
      .catch(() => {});
    if (restarted || saved.length) this.changed();
    this.pump();
  }

  /**
   * A job waiting for the network may try again: its alarm rang (the worker may have slept),
   * or the connection just came back (`now`: no need to wait for its turn).
   */
  async wake(now = false): Promise<void> {
    await this.ready;
    this.retryDue(now);
    this.pump();
  }

  /** "Lancer maintenant": a job waiting for its time window (or Wi-Fi) starts anyway. */
  async startNow(jobId: string): Promise<void> {
    await this.ready;
    const j = this.jobs.get(jobId);
    if (!j || j.status !== 'queued') return;
    this.update(jobId, { startNow: true, held: undefined });
    this.pump();
  }

  /**
   * What new downloads wait for now, if anything. Recordings in a page aren't held: they
   * need the page playing, now.
   */
  private holdFor(j: Job): Hold | null {
    if (j.begun || j.startNow || (j.kind === 'capture' && !j.hidden)) return null;
    const conn = (globalThis.navigator as Navigator & { connection?: { type?: string } } | undefined)?.connection?.type;
    return holdOf(this.gate, new Date(), conn);
  }

  private retryDue(all = false) {
    const t = Date.now();
    // Offline: wait for the connection (the next check comes with the poll or the alarm).
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    for (const j of this.waiting()) if (all || j.retryAt! <= t) void this.resume(j.id, true);
  }

  private async savePlan(id: string, plan: Plan) {
    this.plans.set(id, plan);
    await chrome.storage.local.set({ [PLAN_KEY(id)]: plan }).catch(() => {});
  }

  private async planOf(id: string): Promise<Plan | undefined> {
    return this.plans.get(id) ?? ((await chrome.storage.local.get(PLAN_KEY(id)))[PLAN_KEY(id)] as Plan | undefined);
  }

  private forgetPlan(id: string) {
    this.plans.delete(id);
    void chrome.storage.local.remove(PLAN_KEY(id)).catch(() => {});
  }

  /* -------------------------------------------------------------- commands */

  async start(
    tabId: number,
    mediaId: string,
    variantId: string | undefined,
    mode: JobMode,
    format?: OutputFormat,
    extra: DownloadExtra = {},
  ): Promise<Job | undefined> {
    await this.ready;
    let { scale, clip } = extra;
    const item = findVisible(await this.registry.get(tabId), mediaId) ?? this.items.get(`${tabId}:${mediaId}`);
    if (!item) return undefined;
    const image = isImageFormat(format) && !item.audioOnly && mode === 'video' ? format : undefined;
    if (isImageFormat(format) && !image) return undefined;
    // A contact sheet: the whole video, in its smallest quality (each picture is small).
    const sheet = image === 'jpg' && extra.sheet !== undefined && item.duration && Number.isFinite(extra.sheet) ? Math.max(0, Math.round(extra.sheet)) : undefined;
    if (sheet !== undefined && item.variants.length) variantId = smallest(item.variants).id;
    // Only the smaller qualities the card offers.
    if (scale !== undefined && (mode !== 'video' || image || !canShrink(item) || !scaleChoices(item.variants).includes(scale))) scale = undefined;
    // Several parts joined (the recording, or the download, covers them all).
    const parts = !image && canClip(item) ? joinedParts(extra.parts, item.duration) : undefined;
    // A part of the video, when it can be cut and isn't the whole of it. A picture: its part.
    clip = sheet !== undefined
      ? undefined
      : image
      ? imageClip(image === 'jpg', extra.at ?? extra.clip?.start, extra.clip, item.duration)
      : parts
        ? { start: parts[0]!.start, end: parts[parts.length - 1]!.end }
        : canClip(item)
          ? validClip(clip, item.duration)
          : undefined;
    // Subtitles go with a video, and only the ones the stream offers.
    const subsWanted = subsIds(extra.subtitles).filter((id) => item.subtitles?.some((s) => s.id === id));
    const subtitles = mode === 'video' && !image && subsWanted.length ? { ids: subsWanted, separate: !!extra.subtitles?.separate } : undefined;
    // Sound tracks: the stream's own, the main one first.
    const offered = audioChoices(item).map((a) => a.id);
    const audios = !image && extra.audios?.length ? extra.audios.filter((id) => offered.includes(id)) : [];
    const noChapters = !!extra.noChapters && !!item.chapters?.length;
    const at = image === 'jpg' && sheet === undefined ? clip!.start : undefined;
    const same = (a?: string[], b?: string[]) => (a ?? []).join() === (b ?? []).join();
    const dup = [...this.jobs.values()].find(
      (j) =>
        j.tabId === tabId && j.mediaId === mediaId && j.mode === mode && j.variantId === variantId && j.scale === scale && sameClip(j.clip, clip) &&
        same(subsIds(j.subtitles), subtitles?.ids) && same(j.audios, audios) && (j.format ?? '') === (format ?? '') &&
        same(j.parts?.map(clipLabel), parts?.map(clipLabel)) && j.sheet === sheet && j.at === at && !FINISHED.includes(j.status),
    );
    if (dup) return dup;

    const variant = item.variants.find((v) => v.id === variantId) ?? item.variants[0];
    const job: Job = {
      id: uid(),
      tabId,
      mediaId,
      mode,
      status: 'queued',
      progress: 0,
      bytes: 0,
      speed: 0,
      filename: '',
      title: item.title,
      pageUrl: item.pageUrl,
      kind: item.kind,
      startedAt: Date.now(),
      ...(item.author ? { author: item.author.slice(0, 120) } : {}),
      ...(variantId ? { variantId } : {}),
      ...(clip ? { clip } : {}),
      ...(parts ? { parts } : {}),
      ...(subtitles ? { subtitles } : {}),
      ...(audios.length ? { audios } : {}),
      ...(noChapters ? { noChapters } : {}),
      ...(at !== undefined ? { at } : {}),
      ...(sheet !== undefined ? { sheet } : {}),
      ...(scale ? { scale, quality: `${scale}p` } : mode === 'video' && variant && !image ? { quality: variant.label } : {}),
      // A recording's size is known beforehand only when the site tells it (YouTube).
      ...(item.kind === 'capture' && mode === 'video' && !image && (variant?.sizes?.[format as VideoFormat] ?? item.size)
        ? { total: partOf(variant?.sizes?.[format as VideoFormat] ?? item.size!, clip, item.duration), totalApprox: true }
        : {}),
      ...(item.kind === 'capture' && item.duration ? { duration: item.duration } : {}),
      ...(item.ytId ? { ytId: item.ytId, ...(variant?.codecs ? { ytCodecs: variant.codecs } : {}) } : {}),
      ...(format && (image || (mode === 'audio' ? isAudioFormat(format) : (scale ? SHRUNK_FORMATS : (item.formats ?? VIDEO_FORMATS)).includes(format as VideoFormat)))
        ? { format }
        : {}),
      ...(item.ytId ? { hidden: true } : {}),
      ...(item.fromList ? { entry: item.fromList } : {}),
      ...(item.frameId !== undefined ? { frameId: item.frameId } : {}),
      ...(item.videoIndex !== undefined ? { videoIndex: item.videoIndex } : {}),
    };
    this.jobs.set(job.id, job);
    this.items.delete(`${tabId}:${mediaId}`);
    this.items.set(`${tabId}:${mediaId}`, item);
    if (this.items.size > 40) this.items.delete(this.items.keys().next().value!);
    this.lastUpdate.set(job.id, Date.now());
    this.changed();
    this.pump();
    return job;
  }

  async retry(jobId: string): Promise<void> {
    await this.ready;
    const j = this.jobs.get(jobId);
    if (!j || !FINISHED.includes(j.status)) return;
    this.jobs.delete(jobId);
    // A video of a list: found again from what the job kept.
    if (j.entry && !this.items.has(`${j.tabId}:${j.mediaId}`)) this.items.set(`${j.tabId}:${j.mediaId}`, listItem(j.entry, j.tabId, j.variantId ?? '', j.title));
    // The video may be gone from the page: the card still has to update.
    if (!(await this.start(j.tabId, j.mediaId, j.variantId, j.mode, j.format, {
        ...(j.scale ? { scale: j.scale } : {}),
        ...(j.parts ? { parts: j.parts } : j.clip ? { clip: j.clip } : {}),
        ...(j.subtitles ? { subtitles: j.subtitles } : {}),
        ...(j.audios ? { audios: j.audios } : {}),
        ...(j.noChapters ? { noChapters: true } : {}),
        ...(j.at !== undefined ? { at: j.at } : {}),
        ...(j.sheet !== undefined ? { sheet: j.sheet } : {}),
      }))) this.changed();
  }

  async dismiss(jobId: string): Promise<void> {
    await this.ready;
    const j = this.jobs.get(jobId);
    if (j && FINISHED.includes(j.status)) {
      this.jobs.delete(jobId);
      this.changed();
    }
  }

  async cancel(jobId: string): Promise<void> {
    await this.ready;
    const job = this.jobs.get(jobId);
    if (!job || FINISHED.includes(job.status)) return;
    const prev = job.status;
    this.update(jobId, { status: 'canceled', speed: 0 });
    if (job.downloadId !== undefined) await chrome.downloads.cancel(job.downloadId).catch(() => {});
    if (prev === 'capturing') await this.toContent(job, { type: 'capture-stop', jobId });
    if (prev !== 'queued') await sendOffscreen({ target: 'offscreen', type: 'cancel', jobId }).catch(() => {});
    await this.cleanup(jobId);
    this.pump();
  }

  async pause(jobId: string): Promise<void> {
    await this.ready;
    const job = this.jobs.get(jobId);
    if (!job || !JobManager.canPause(job)) return;
    const browser = job.downloadId !== undefined && !job.blob;
    const prev = job.status;
    this.update(jobId, { status: 'paused', pausedBy: 'user', speed: 0, retryAt: undefined });
    if (prev === 'capturing') {
      await this.holdCapture(job);
      return this.pump();
    }
    if (browser) await chrome.downloads.pause(job.downloadId!).catch(() => {});
    else if (prev === 'downloading') await sendOffscreen({ target: 'offscreen', type: 'pause', jobId }).catch(() => {});
    await this.releaseRules(jobId);
    this.pump();
  }

  /**
   * A waiting download moved in the queue (before `before`, or last). The waiting ones swap
   * their places among themselves: the others keep theirs.
   */
  async reorder(jobId: string, before?: string): Promise<void> {
    await this.ready;
    const waiting = this.list().filter((j) => j.status === 'queued');
    const moving = waiting.find((j) => j.id === jobId);
    if (!moving || before === jobId) return;
    const places = reorderedPlaces(waiting.map((j) => ({ id: j.id, rank: queueRank(j) })), jobId, before);
    let moved = false;
    for (const [id, rank] of places) {
      const j = this.jobs.get(id)!;
      if (queueRank(j) === rank) continue;
      j.order = rank;
      moved = true;
    }
    if (!moved) return;
    this.changed();
    this.pump();
  }

  /** "Tout mettre en pause": every download that can be paused. */
  async pauseAll(): Promise<void> {
    await this.ready;
    // The waiting ones first: none of them starts in the place of one being paused.
    const all = this.list().filter((j) => JobManager.canPause(j));
    all.sort((a, b) => Number(b.status === 'queued') - Number(a.status === 'queued'));
    for (const j of all) await this.pause(j.id);
  }

  /** "Tout reprendre": every paused download, in the queue's order. */
  async resumeAll(): Promise<void> {
    await this.ready;
    for (const j of this.list().filter((x) => x.status === 'paused')) await this.resume(j.id);
  }

  /** Carries on with a paused job: from where it stopped, with what was already stored. */
  async resume(jobId: string, auto = false): Promise<void> {
    await this.ready;
    const job = this.jobs.get(jobId);
    if (job?.status !== 'paused') return;
    // A try for the network that fails again waits longer next time.
    const attempts = auto && job.pausedBy === 'network' ? job.attempts ?? 0 : 0;
    if (job.kind === 'capture') {
      // Recorded to the end already (stopped while assembling): only the file is left to make.
      const end = job.clip?.end ?? job.duration;
      const stored = this.recordedAll(job) ? await storedUntil(job.id, job.keepTracks).catch(() => undefined) : undefined;
      if (this.recordedAll(job) && (stored === undefined || end === undefined || stored >= end - 1.5)) {
        this.update(jobId, { status: 'capturing', pausedBy: undefined, retryAt: undefined, attempts });
        return this.assembleCapture(job, true);
      }
      // A new session, after the ones already stored (none yet: this is still the first).
      const session = job.captureAt !== undefined || job.bytes > 0 ? (job.session ?? 0) + 1 : (job.session ?? 0);
      this.update(jobId, { status: 'queued', pausedBy: undefined, retryAt: undefined, attempts, resumed: true, session });
      return this.pump();
    }
    if (job.downloadId !== undefined && !job.blob) {
      const [d] = await chrome.downloads.search({ id: job.downloadId }).catch(() => []);
      if (d && (d.state === 'in_progress' || d.canResume)) {
        try {
          this.releases.set(jobId, await withPageHeaders(job.pageUrl, [job.sourceUrl ?? d.url]));
          await chrome.downloads.resume(job.downloadId);
          this.update(jobId, { status: 'downloading', pausedBy: undefined, retryAt: undefined, attempts });
          this.startPolling();
          return;
        } catch {
          await this.releaseRules(jobId);
        }
      }
      // The browser can't take it up again: start it over.
      if (d) await chrome.downloads.erase({ id: job.downloadId }).catch(() => {});
      delete job.downloadId;
    }
    this.update(jobId, { status: 'queued', pausedBy: undefined, retryAt: undefined, attempts, resumed: true });
    this.pump();
  }

  /** Lost the network (or the page's server went quiet): try again a bit later, on its own. */
  private retryLater(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || FINISHED.includes(job.status)) return;
    const attempts = (job.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS) return this.fail(jobId, 'network');
    const retryAt = Date.now() + retryDelay(attempts);
    const recording = job.status === 'capturing';
    this.update(jobId, { status: 'paused', pausedBy: 'network', retryAt, attempts, speed: 0 });
    if (recording) void this.holdCapture(job);
    void this.releaseRules(jobId);
    // The worker may sleep meanwhile: the alarm brings it back.
    void chrome.alarms?.create(WAKE_ALARM, { when: retryAt + 500 })?.catch?.(() => {});
    this.pump();
  }

  async finishCapture(jobId: string): Promise<void> {
    await this.ready;
    const job = this.jobs.get(jobId);
    // Paused: the file is made from what was recorded so far.
    if (job?.status === 'paused' && job.kind === 'capture' && job.bytes > 0) {
      this.update(jobId, { status: 'capturing', pausedBy: undefined, retryAt: undefined });
      return this.assembleCapture(job, true);
    }
    if (job?.status !== 'capturing') return;
    // A hidden player (YouTube): stopped, and what it recorded becomes the file.
    if (job.hidden) {
      await sendOffscreen({ target: 'offscreen', type: 'yt-stop', jobId }).catch(() => {});
      return this.assembleCapture(job, job.bytes > 0);
    }
    // The page may be gone already: assemble whatever was stored.
    if (!(await this.toContent(job, { type: 'capture-stop', jobId }))) await this.assembleCapture(job);
  }

  /** The tab closed or left the page: recordings there can't continue. */
  async onTabGone(tabId: number): Promise<void> {
    await this.ready;
    for (const j of this.list(tabId)) {
      if (j.status !== 'capturing') continue;
      // A YouTube recording plays in its own hidden player: it doesn't need the page.
      if (j.hidden) continue;
      if (this.recordedAll(j) || !j.bytes) await this.assembleCapture(j);
      else {
        // Not finished: it waits (Resume opens the page again, Finish keeps what was recorded).
        this.update(j.id, { status: 'paused', pausedBy: 'page', speed: 0, retryAt: undefined });
        if (j.openedTab === tabId) delete j.openedTab;
      }
    }
  }

  /* ------------------------------------------------------------ execution */

  private pump() {
    const running = [...this.jobs.values()].filter((j) => ['downloading', 'processing', 'saving'].includes(j.status)).length;
    let free = MAX_PARALLEL - running;
    let hidden = [...this.jobs.values()].filter((j) => j.status === 'capturing' && j.hidden).length;
    // A page records one player at a time.
    const busyTabs = new Set([...this.jobs.values()].filter((j) => j.status === 'capturing' && !j.hidden).map((j) => j.tabId));
    let opens: number | undefined;
    for (const j of this.list()) {
      if (j.status !== 'queued') continue;
      const hold = this.holdFor(j);
      if (hold) {
        if (JSON.stringify(hold) !== JSON.stringify(j.held)) this.update(j.id, { held: hold });
        if (hold.why === 'schedule') opens = Math.min(opens ?? Infinity, hold.until);
        continue;
      }
      if (j.held) this.update(j.id, { held: undefined });
      if (free <= 0) continue;
      if (j.kind === 'capture') {
        if (j.hidden ? hidden >= MAX_HIDDEN : busyTabs.has(j.tabId)) continue;
        if (j.hidden) hidden++;
        else busyTabs.add(j.tabId);
      }
      free--;
      void this.run(j);
    }
    // The worker may sleep until then: the alarm brings it back when the window opens.
    if (opens !== undefined) void chrome.alarms?.create(SCHEDULE_ALARM, { when: opens + 1000 })?.catch?.(() => {});
  }

  private fail(jobId: string, error: ErrorCode) {
    const job = this.update(jobId, { status: error === 'canceled' ? 'canceled' : 'error', error, speed: 0 });
    if (job && error !== 'canceled') void notifyFinished(job);
    void this.cleanup(jobId);
    this.pump();
  }

  private async run(job: Job) {
    this.update(job.id, { status: 'downloading', speed: 0, begun: true, held: undefined });
    try {
      // Queued while the page moved on (a new page in the same tab): what was asked still stands.
      const item = (await this.itemOf(job)) ?? null;
      // A recording carrying on keeps its plan; its page may have to be found again.
      if (!item && !(await this.planOf(job.id)) && !(job.kind === 'capture' && job.capturePlan)) return this.fail(job.id, 'expired');
      const settings = await getSettings();
      // Resumed: the same plan, so the pieces already stored still fit.
      let plan = (await this.planOf(job.id)) ?? job.capturePlan ?? (await this.planFor(job, item, settings));
      if (this.gone(job.id)) return;
      this.update(job.id, {
        raw: plan.raw,
        // A file's size comes from the server; a stream's is estimated from its bitrate.
        ...(plan.estimatedSize ? { bytes: 0, total: plan.estimatedSize, totalApprox: plan.kind !== 'file' } : {}),
      });
      // The browser's own download can't be slowed down: with a speed limit Grabby fetches
      // the file itself, and saves it as it is.
      if (plan.kind === 'file' && plan.direct && !plan.fast && this.gate.rateLimit) plan = { ...plan, raw: true };

      if (plan.kind === 'capture') {
        const capturePlan = job.capturePlan ?? plan;
        if (job.ytId || item?.ytId) return await this.startHidden(job, capturePlan, item ?? undefined);
        return await this.startCapture(job, capturePlan);
      }
      // Kept for a resume, even after a restart when the page is long gone.
      await this.savePlan(job.id, plan);
      if (plan.kind === 'file' && plan.direct && !plan.fast && !plan.raw) return await this.direct(job, plan.video?.segments[0]?.url ?? item!.url, plan.output, settings);

      const urls = [plan.video, plan.audio, ...(plan.audios ?? []).map((a) => a.track), ...planSubs(plan).map((s) => s.track)].flatMap((t) =>
        t ? [...(t.init ? [t.init.url] : []), ...t.segments.map((s) => s.url)] : [],
      );
      const perHost = [...new Map(urls.map((u) => [hostOf(u), u])).values()];
      this.releases.set(job.id, await withPageHeaders(job.pageUrl, perHost));
      if (this.gone(job.id)) return void this.cleanup(job.id);
      this.update(job.id, { blob: true });
      await sendOffscreen({ target: 'offscreen', type: 'run', jobId: job.id, plan, rate: this.gate.rateLimit });
    } catch (e) {
      if (this.gone(job.id)) return;
      if (e instanceof PlanError) this.fail(job.id, e.code);
      else this.retryLater(job.id);
    }
  }

  private async itemOf(job: Job): Promise<MediaItem | undefined> {
    return (
      findVisible(await this.registry.get(job.tabId), job.mediaId) ??
      this.items.get(`${job.tabId}:${job.mediaId}`) ??
      // A video of a list: found again from what the job kept (after the worker slept).
      (job.entry ? listItem(job.entry, job.tabId, job.variantId ?? '', job.title) : undefined)
    );
  }

  /**
   * Every video of a playlist (or a channel): one download each, numbered in the list's
   * order, recorded two at a time like any YouTube video.
   */
  async startList(tabId: number, list: YtList, quality: string, mode: JobMode, format?: OutputFormat): Promise<number> {
    await this.ready;
    let n = 0;
    for (const [i, entry] of list.entries.entries()) {
      // A channel's videos: the channel is who made them.
      const item = { ...listItem(entry, tabId, quality, numbered(entry.title, i, list.entries.length)), ...(list.kind === 'channel' ? { author: list.title } : {}) };
      this.items.set(`${tabId}:${item.id}`, item);
      if (await this.start(tabId, item.id, mode === 'video' ? item.variants[0]!.id : undefined, mode, format)) n++;
    }
    return n;
  }

  private async planFor(job: Job, item: MediaItem | null, settings: Settings): Promise<Plan> {
    if (!item) throw new PlanError('expired');
    const cut = await this.sponsorFree(job, item, settings);
    const plan = await buildPlan(item, {
      mode: job.mode,
      ...(job.format ? { format: job.format } : {}),
      settings,
      fetchText: (u) => fetchTextAs(u, item.pageUrl),
      ...(job.variantId ? { variantId: job.variantId } : {}),
      ...(job.scale ? { scale: job.scale } : {}),
      ...(cut.clip ? { clip: cut.clip } : {}),
      ...(cut.parts ? { parts: cut.parts } : {}),
      ...(job.subtitles ? { subtitles: job.subtitles } : {}),
      ...(job.audios ? { audios: job.audios } : {}),
      ...(job.noChapters ? { noChapters: true } : {}),
      ...(job.at !== undefined ? { at: job.at } : {}),
      ...(job.sheet !== undefined ? { sheet: job.sheet } : {}),
    });
    if (!cut.sponsors) return plan;
    this.update(job.id, { sponsors: cut.sponsors });
    return { ...plan, sponsors: cut.sponsors };
  }

  /**
   * YouTube, when the user asked for it: the sponsored parts (SponsorBlock) left out of what
   * was asked (the whole video, a part or several). Nothing found: what was asked, as is.
   */
  private async sponsorFree(job: Job, item: MediaItem, settings: Settings): Promise<{ clip?: Clip; parts?: Clip[]; sponsors?: number }> {
    const asked = { ...(job.clip ? { clip: job.clip } : {}), ...(job.parts ? { parts: job.parts } : {}) };
    const id = item.ytId ?? job.ytId;
    if (!settings.skipSponsors || !id || !item.duration || job.at !== undefined || job.sheet !== undefined || isImageFormat(job.format)) return asked;
    const sponsors = await sponsorParts(id);
    const ranges = job.parts ?? [job.clip ?? { start: 0, end: item.duration }];
    const kept = withoutSponsors(ranges, sponsors);
    const hit = sponsors.filter((s) => ranges.some((r) => s.start < r.end && s.end > r.start)).length;
    if (!hit || !kept.length) return asked;
    const parts = joinedParts(kept, item.duration);
    if (parts) return { parts, sponsors: hit };
    const clip = validClip(kept[0], item.duration);
    return clip ? { clip, sponsors: hit } : asked;
  }

  /**
   * A resumed download whose links stopped working (signed links expire): ask the page's
   * manifest again for fresh ones. The stored pieces are kept when the video is cut the same way.
   */
  private async replan(job: Job): Promise<boolean> {
    const item = await this.itemOf(job);
    if (!item || job.replanned) return false;
    try {
      const old = await this.planOf(job.id);
      const plan = await this.planFor(job, item, await getSettings());
      const shape = (p?: Plan) => [p?.video?.segments.length, p?.audio?.segments.length, !!p?.video?.init, !!p?.audio?.init].join();
      if (shape(old) !== shape(plan)) await sendOffscreen({ target: 'offscreen', type: 'release', jobId: job.id }).catch(() => {});
      await this.savePlan(job.id, plan);
    } catch {
      return false;
    }
    await this.releaseRules(job.id);
    this.update(job.id, { status: 'queued', replanned: true, speed: 0 });
    this.pump();
    return true;
  }

  private filename(job: Job, ext: string, s: Settings): string {
    const site = hostOf(job.pageUrl).replace(/^www\./, '');
    const kind = isImageFormat(ext) ? 'image' : job.mode === 'audio' ? 'audio' : 'video';
    return buildFilename(
      s.template,
      // A part says which one: "Title (1m05-2m40)"; parts joined, all of them; a still, its moment.
      {
        title: titleOf(job),
        site,
        date: new Date(),
        format: ext.toUpperCase(),
        ...(job.quality ? { quality: job.quality } : {}),
        ...(job.author ? { channel: job.author } : {}),
      },
      ext,
      folderFor(s.folder, { site, kind }, folderNames()),
    );
  }

  /** Subtitles kept apart: .srt files named like the video ("Title.fr.srt"), which players pick up. */
  private async saveSubtitles(job: Job, files: { srt: string; lang?: string }[], settings: Settings) {
    const used = new Map<string, number>();
    for (const file of files) {
      const lang = file.lang?.replace(/[^\w-]/g, '') ?? '';
      // Two tracks in the same language (written and automatic): the second one numbered.
      const n = (used.get(lang) ?? 0) + 1;
      used.set(lang, n);
      await this.saveSrt(job, file.srt, [lang, n > 1 ? String(n) : ''].filter(Boolean).join('.'), settings);
    }
  }

  private async saveSrt(job: Job, srt: string, tag: string, settings: Settings) {
    const lang = tag;
    const bytes = new TextEncoder().encode(`﻿${srt}`);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await chrome.downloads
      .download({
        url: `data:application/x-subrip;base64,${btoa(bin)}`,
        filename: this.filename(job, lang ? `${lang}.srt` : 'srt', settings),
        saveAs: settings.saveAs,
        conflictAction: 'uniquify',
      })
      .catch((e) => console.warn('[grabby] subtitles not saved', e));
  }

  private async direct(job: Job, url: string, ext: string, settings: Settings) {
    const filename = this.filename(job, ext, settings);
    this.releases.set(job.id, await withPageHeaders(job.pageUrl, [url]));
    if (this.gone(job.id)) return void this.cleanup(job.id);
    const downloadId = await chrome.downloads.download({ url, filename, saveAs: settings.saveAs, conflictAction: 'uniquify' });
    if (!settings.saveAs) watchSavePrompt(downloadId);
    if (this.gone(job.id)) {
      await chrome.downloads.cancel(downloadId).catch(() => {});
      return void this.cleanup(job.id);
    }
    this.update(job.id, { downloadId, filename, sourceUrl: url, ext });
    this.startPolling();
    // Saved as it is by the browser: its subtitles (kept apart) are made here.
    const plan = await this.planOf(job.id);
    if (planSubs(plan).length) await this.directSubtitles(job, plan!, settings);
  }

  /** The .srt of a file the browser saves as it is: its subtitle file, fetched and converted. */
  private async directSubtitles(job: Job, plan: Plan, settings: Settings) {
    const files: { srt: string; lang?: string }[] = [];
    for (const sub of planSubs(plan)) {
      try {
        const parts = await Promise.all(sub.track.segments.map(async (s) => new TextEncoder().encode(await fetchTextAs(s.url, job.pageUrl))));
        const cues = cuesOf(parts, sub.track.container, sub.clock);
        if (cues.length) files.push({ srt: toSrt(cues), ...(sub.lang ? { lang: sub.lang } : {}) });
      } catch (e) {
        console.warn('[grabby] subtitles left out', e);
      }
    }
    if (files.length) await this.saveSubtitles(job, files, settings);
  }

  private async fetchFallback(job: Job) {
    const url = job.sourceUrl!;
    const { downloadId: _dropped, ...rest } = job;
    this.jobs.set(job.id, { ...rest, viaFetch: true, blob: true, status: 'downloading', progress: 0, bytes: 0, speed: 0 });
    this.changed();
    await this.releases.get(job.id)?.();
    this.releases.set(job.id, await withPageHeaders(job.pageUrl, [url]));
    if (this.gone(job.id)) return void this.cleanup(job.id);
    const plan: Plan = {
      kind: 'file',
      video: { segments: [{ url }], container: 'file' },
      output: (job.ext ?? 'mp4') as OutputFormat,
      raw: true,
      audioOnly: false,
      pageUrl: job.pageUrl,
    };
    await this.savePlan(job.id, plan);
    await sendOffscreen({ target: 'offscreen', type: 'run', jobId: job.id, plan }).catch(() => this.fail(job.id, 'unknown'));
  }

  private async startCapture(job: Job, plan: Plan) {
    // Carrying on: the page may have been closed or reloaded (a restart) — find it again.
    if (job.session && !(await this.pageStillThere(job))) {
      if (!(await this.findPage(job))) {
        if (this.gone(job.id)) return;
        return job.bytes > 0 ? this.retryLater(job.id) : this.fail(job.id, 'capture_unavailable');
      }
    }
    if (job.videoIndex === undefined) return this.fail(job.id, 'capture_unavailable');
    this.update(job.id, { status: 'capturing', capturePlan: plan, bytesBefore: job.bytes });
    const ok = await this.toContent(job, {
      type: 'capture-start',
      jobId: job.id,
      videoIndex: job.videoIndex,
      ...(job.clip ? { clip: job.clip } : {}),
      ...(job.session ? { session: job.session, from: await this.resumeFrom(job) } : {}),
    });
    if (!ok && !this.gone(job.id)) {
      if (job.session && job.bytes > 0) this.retryLater(job.id);
      else this.fail(job.id, 'capture_unavailable');
    }
    this.pump();
  }

  /**
   * Where a recording that carries on starts again: a little before what was really stored
   * (else a little before where the player got to).
   */
  private async resumeFrom(job: Job): Promise<number> {
    const start = job.clip?.start ?? 0;
    const at = job.captureAt ?? start;
    const stored = await storedUntil(job.id, job.keepTracks, job.session ?? 0).catch(() => undefined);
    const from = stored !== undefined ? Math.min(at, stored) - STORED_MARGIN : at - CAPTURE_OVERLAP;
    return Math.max(start, from);
  }

  /** Recorded up to the end of the video (or of the part): nothing left but the file to make. */
  private recordedAll(job: Job): boolean {
    const end = job.clip?.end ?? job.duration;
    return end !== undefined && job.captureAt !== undefined && job.captureAt >= end - 0.5;
  }

  /** Ends the current recording session without finishing the file (pause, network, restart). */
  private async holdCapture(job: Job) {
    if (job.hidden) await sendOffscreen({ target: 'offscreen', type: 'yt-stop', jobId: job.id, hold: true }).catch(() => {});
    else await this.toContent(job, { type: 'capture-stop', jobId: job.id, hold: true });
  }

  private async pageStillThere(job: Job): Promise<boolean> {
    const tab = await chrome.tabs.get(job.tabId).catch(() => undefined);
    if (!tab || tab.url !== job.pageUrl) return false;
    const items = await this.registry.get(job.tabId);
    return items.some((i) => i.kind === 'capture' && i.videoIndex === job.videoIndex && (job.frameId === undefined || i.frameId === job.frameId));
  }

  /**
   * The page of a recording that carries on, after it was closed or the browser restarted:
   * an open tab showing it, else one Grabby opens in the background. Its player must show up.
   */
  private async findPage(job: Job): Promise<boolean> {
    const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
    let tab = tabs.find((t) => t.url === job.pageUrl && t.id !== undefined);
    if (!tab) {
      tab = await chrome.tabs.create({ url: job.pageUrl, active: false }).catch(() => undefined);
      if (tab?.id !== undefined) job.openedTab = tab.id;
    }
    if (tab?.id === undefined) return false;
    const tabId = tab.id;
    // Its player shows up once the page has loaded and started it.
    for (let i = 0; i < 40 && !this.gone(job.id); i++) {
      const players = rank((await this.registry.get(tabId)).filter((x) => x.kind === 'capture' && x.protection === 'none' && !x.live));
      const same = players.find((p) => p.videoIndex === job.videoIndex) ?? players[0];
      if (same) {
        this.update(job.id, {
          tabId,
          mediaId: same.id,
          ...(same.frameId !== undefined ? { frameId: same.frameId } : {}),
          ...(same.videoIndex !== undefined ? { videoIndex: same.videoIndex } : {}),
        });
        return true;
      }
      if (i === 4) chrome.tabs.sendMessage(tabId, { type: 'scan' } satisfies BgToContent).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  /**
   * YouTube: a hidden copy of the player records the video at high speed
   * while the user keeps watching theirs. Codecs are chosen so the file needs no re-encoding.
   */
  private async startHidden(job: Job, plan: Plan, item?: MediaItem) {
    const v = item?.variants.find((x) => x.id === job.variantId) ?? item?.variants[0];
    const videoId = job.ytId ?? item?.ytId;
    if (!videoId) return this.fail(job.id, 'capture_unavailable');
    const codecs = v?.codecs ?? job.ytCodecs ?? '';
    const audio = job.mode === 'audio';
    const webm = !audio && job.format === 'webm';
    // A picture is made from H.264 when YouTube has it (the quickest to decode).
    const vcodec = audio || (!webm && codecs.includes('avc1')) || isImageFormat(job.format) ? 'avc' : 'vp9';
    const captions = planSubs(plan).flatMap((s) => (s.captured ? [s.captured] : []));
    this.update(job.id, { status: 'capturing', capturePlan: plan, bytesBefore: job.bytes });
    const src = hiddenPlayerUrl({
      jobId: job.id,
      videoId,
      // Audio only: the smallest picture, the audio track is the same.
      quality: audio ? 'tiny' : (v?.id ?? job.variantId ?? 'hd1080'),
      vcodec,
      acodec: webm ? 'opus' : 'aac',
      ...(job.clip ? { part: job.clip } : {}),
      ...(job.session ? { session: job.session, from: await this.resumeFrom(job) } : {}),
      ...(captions.length ? { captions } : {}),
      ...(this.gate.rateLimit ? { maxRate: playbackCap(this.gate.rateLimit, this.bitrateOf(job) ?? 2_500_000) } : {}),
    });
    try {
      await allowHiddenPlayer();
      await ensureOffscreen();
      if (this.gone(job.id)) return;
      await sendOffscreen({ target: 'offscreen', type: 'yt-start', jobId: job.id, src });
    } catch {
      if (!this.gone(job.id)) this.fail(job.id, 'capture_unavailable');
    }
    this.pump();
  }

  /** Bits per second of a recording, from the size YouTube gives (when it does). */
  private bitrateOf(job: Job): number | undefined {
    const len = job.clip ? job.clip.end - job.clip.start : job.duration;
    return job.total && len ? (job.total * 8) / len : undefined;
  }

  /** Ends a recording: hands the stored chunks to the offscreen assembler. */
  private async assembleCapture(job: Job, hasTracks = job.bytes > 0, keep?: number[]) {
    if (job.status !== 'capturing') return;
    const plan = job.capturePlan;
    this.stopAsked.delete(job.id);
    if (job.hidden) void sendOffscreen({ target: 'offscreen', type: 'yt-stop', jobId: job.id }).catch(() => {});
    // The page gives its video back (normal speed, its sound) and stops recording.
    else void this.toContent(job, { type: 'capture-stop', jobId: job.id });
    if (!plan || !hasTracks) return this.fail(job.id, 'capture_failed');
    // A hidden player may also have recorded ads: keep only the tracks of the video itself
    // (told along the way, for every session of the recording).
    const kept = mergeKeep(job.keepTracks, keep);
    const final: Plan = { ...plan, ...(kept.length ? { keepTracks: kept } : {}) };
    if (job.openedTab !== undefined) {
      void chrome.tabs.remove(job.openedTab).catch(() => {});
      delete job.openedTab;
    }
    this.update(job.id, { status: 'processing', progress: CAPTURE_SHARE, speed: 0, blob: true, capturePlan: final });
    // Subtitles of a recording are fetched once it is over, with the page's headers.
    const urls = planSubs(final).flatMap((s) => s.track.segments.map((x) => x.url));
    if (urls.length) {
      this.releases.set(job.id, await withPageHeaders(job.pageUrl, [...new Map(urls.map((u) => [hostOf(u), u])).values()]));
    }
    await sendOffscreen({ target: 'offscreen', type: 'run', jobId: job.id, plan: final }).catch(() => this.fail(job.id, 'unknown'));
  }

  private async toContent(job: Job, msg: BgToContent): Promise<boolean> {
    try {
      await chrome.tabs.sendMessage(job.tabId, msg, { frameId: job.frameId ?? 0 });
      return true;
    } catch {
      return false;
    }
  }

  /** Gives back the header rules a job holds (paused: it takes new ones when it resumes). */
  private async releaseRules(jobId: string) {
    const release = this.releases.get(jobId);
    this.releases.delete(jobId);
    await release?.();
  }

  private async cleanup(jobId: string) {
    await this.releaseRules(jobId);
    this.forgetPlan(jobId);
    const job = this.jobs.get(jobId);
    // A page Grabby opened to carry on a recording.
    if (job?.openedTab !== undefined) {
      void chrome.tabs.remove(job.openedTab).catch(() => {});
      delete job.openedTab;
    }
    if (job?.hidden) await sendOffscreen({ target: 'offscreen', type: 'yt-stop', jobId }).catch(() => {});
    if (job?.blob || job?.kind === 'capture') {
      await sendOffscreen({ target: 'offscreen', type: 'release', jobId }).catch(() => {});
    }
    // Rules whose owner was lost in a service-worker restart.
    if (!this.isBusy()) await sweepHeaderRules().catch(() => {});
  }

  /* --------------------------------------------------------------- events */

  async onContentMessage(msg: ContentToBg): Promise<void> {
    if (!('jobId' in msg)) return;
    await this.ready;
    const job = this.jobs.get(msg.jobId);
    if (!job || job.status !== 'capturing') return;
    if (msg.type === 'capture-progress') {
      // Bytes of this session, after those of the sessions before it.
      const base = job.bytesBefore ?? 0;
      const keep = msg.keep?.length ? mergeKeep(job.keepTracks, msg.keep) : undefined;
      this.update(job.id, {
        progress: msg.progress * CAPTURE_SHARE,
        bytes: base + msg.bytes,
        ...(msg.time !== undefined ? { captureAt: msg.time, attempts: 0 } : {}),
        ...(keep && keep.join() !== job.keepTracks?.join() ? { keepTracks: keep } : {}),
      });
    } else if (msg.type === 'capture-error') {
      // A recording carrying on whose player isn't ready yet: what it has is kept, it tries again.
      if (job.session && job.bytes > 0 && msg.error === 'capture_unavailable') this.retryLater(job.id);
      else this.fail(job.id, msg.error);
    } else if (msg.type === 'capture-done') {
      await this.assembleCapture(job, msg.tracks.length > 0 || job.bytes > 0, msg.keep);
    }
  }

  async onOffscreenMessage(msg: OffscreenToBg): Promise<void> {
    if (msg.type === 'sink-check') return;
    await this.ready;
    const job = this.jobs.get(msg.jobId);
    if (!job || FINISHED.includes(job.status)) return;
    // Paused: what the offscreen document still says about it is late news.
    if (job.status === 'paused' && msg.type !== 'job-ready') return;
    if (msg.type === 'job-progress') {
      // Data is coming in again: the network tries start over from the shortest wait.
      const fresh = job.attempts && msg.bytes > job.bytes ? { attempts: 0 } : {};
      this.update(job.id, { status: msg.status, progress: msg.progress, bytes: msg.bytes, speed: msg.speed, ...fresh });
    } else if (msg.type === 'job-paused') {
      this.update(job.id, { status: 'paused', pausedBy: 'user', speed: 0 });
    } else if (msg.type === 'job-error') {
      await this.onJobError(job, msg.error);
    } else if (msg.type === 'job-ready') {
      const settings = await getSettings();
      const filename = this.filename(job, msg.ext as OutputFormat, settings);
      if (this.gone(job.id)) return;
      this.update(job.id, { status: 'saving', progress: 1, bytes: msg.size, total: msg.size, totalApprox: false, speed: 0, filename });
      try {
        const downloadId = await chrome.downloads.download({ url: msg.blobUrl, filename, saveAs: settings.saveAs, conflictAction: 'uniquify' });
        if (!settings.saveAs) watchSavePrompt(downloadId);
        if (this.gone(job.id)) return void chrome.downloads.cancel(downloadId).catch(() => {});
        this.update(job.id, { downloadId });
        this.startPolling();
        if (msg.subtitles) await this.saveSubtitles(job, msg.subtitles, settings);
      } catch {
        this.fail(job.id, 'unknown');
      }
    }
  }

  private async onJobError(job: Job, error: ErrorCode) {
    if (error === 'network') return this.retryLater(job.id);
    // The server can't send ranges: the browser downloads the file itself, as before.
    if (error === 'no_ranges') {
      const plan = await this.planOf(job.id);
      const url = plan?.video?.segments[0]?.url;
      if (!plan || !url) return this.fail(job.id, 'unknown');
      this.forgetPlan(job.id);
      await this.releaseRules(job.id);
      this.update(job.id, { blob: false });
      return this.direct(job, url, plan.output, await getSettings()).catch(() => this.fail(job.id, 'unknown'));
    }
    // Links that worked before and no longer do: they expired while the download waited.
    if ((error === 'http_403' || error === 'http_404') && job.resumed) {
      if (await this.replan(job)) return;
      return this.fail(job.id, 'expired');
    }
    this.fail(job.id, error);
  }

  private async onDownloadChanged(d: chrome.downloads.DownloadDelta) {
    await this.ready;
    const job = [...this.jobs.values()].find((j) => j.downloadId === d.id);
    if (!job || FINISHED.includes(job.status)) return;
    if (d.filename?.current) {
      this.update(job.id, { filename: d.filename.current.split(/[\\/]/).pop() ?? job.filename });
    }
    // Paused or resumed from the browser's own downloads page.
    if (d.paused?.current === true && job.status === 'downloading') this.update(job.id, { status: 'paused', pausedBy: 'user', speed: 0 });
    if (d.paused?.current === false && job.status === 'paused' && d.state?.current !== 'interrupted') {
      this.update(job.id, { status: 'downloading', pausedBy: undefined, retryAt: undefined });
      this.startPolling();
    }
    if (d.state?.current === 'complete') {
      const [info] = await chrome.downloads.search({ id: d.id });
      const size = info?.fileSize || info?.totalBytes || job.bytes;
      this.update(job.id, { status: 'done', progress: 1, speed: 0, bytes: size });
      const thumbnail = this.items.get(`${job.tabId}:${job.mediaId}`)?.thumbnail;
      await addHistory({
        id: job.id,
        filename: job.filename,
        title: job.title,
        pageUrl: job.pageUrl,
        size,
        date: Date.now(),
        downloadId: d.id,
        ...(thumbnail ? { thumbnail } : {}),
        ...(job.mode === 'video' && job.quality ? { quality: job.quality } : {}),
        mode: job.mode,
        ...(job.format ? { format: job.format } : {}),
      });
      void notifyFinished(this.jobs.get(job.id) ?? job);
      await this.cleanup(job.id);
      this.pump();
    } else if (d.state?.current === 'interrupted') {
      const code = interruptCode(d.error?.current);
      // Network lost, computer asleep: the browser can usually take it up where it stopped.
      if (code === 'network') return this.retryLater(job.id);
      // The download manager bypasses our Referer/Origin rules: retry through an extension fetch.
      if (job.sourceUrl && !job.viaFetch && !job.blob && ['http_403', 'http_404', 'http_other'].includes(code)) {
        await chrome.downloads.erase({ id: d.id }).catch(() => {});
        return this.fetchFallback(job);
      }
      this.fail(job.id, code);
    }
  }

  /** chrome.downloads has no progress event: poll active downloads and watch stalls. */
  private startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      const now = Date.now();
      this.retryDue();
      const direct = [...this.jobs.values()].filter((j) => j.downloadId !== undefined && j.status === 'downloading');
      for (const j of direct) {
        const [info] = await chrome.downloads.search({ id: j.downloadId! });
        if (!info) continue;
        this.update(j.id, {
          bytes: info.bytesReceived,
          progress: info.totalBytes > 0 ? info.bytesReceived / info.totalBytes : 0,
          ...(info.totalBytes > 0 ? { total: info.totalBytes, totalApprox: false } : {}),
        });
      }
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      for (const j of this.jobs.values()) {
        const idle = now - (this.lastUpdate.get(j.id) ?? now);
        // Offscreen jobs send a heartbeat even while queued behind ffmpeg: silence means it died.
        if (['downloading', 'processing'].includes(j.status) && j.downloadId === undefined && idle > STALL_MS) {
          // Nothing heard for long: the offscreen document died or the server went quiet.
          void sendOffscreen({ target: 'offscreen', type: 'pause', jobId: j.id }).catch(() => {});
          this.retryLater(j.id);
        } else if (j.status === 'capturing' && offline) {
          // No network: the recording stops here and carries on when it comes back.
          this.retryLater(j.id);
        } else if (j.status === 'capturing' && idle > CAPTURE_STALL_MS && j.bytes > 0 && !this.recordedAll(j) && j.captureAt !== undefined) {
          // Stuck halfway (the player gave up, the page froze): carry on in a new session.
          this.retryLater(j.id);
        } else if (j.status === 'capturing' && idle > CAPTURE_STALL_MS) {
          if (!this.stopAsked.has(j.id)) {
            // Ask the page to stop and hand over what it has; give it 10 s before assembling anyway.
            this.stopAsked.add(j.id);
            this.lastUpdate.set(j.id, now - CAPTURE_STALL_MS + 10_000);
            void this.finishCapture(j.id);
          } else void this.assembleCapture(j);
        }
      }
      if (!this.isBusy() && !this.waiting().length) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
    }, 500);
  }
}

/** The folders of each kind of file, in the browser's language ("Vidéos", "Musique", "Images"). */
export function folderNames(): Record<'video' | 'audio' | 'image', string> {
  const say = (k: string, fallback: string) => chrome.i18n.getMessage(k) || fallback;
  return { video: say('folder_video', 'Videos'), audio: say('folder_audio', 'Music'), image: say('folder_image', 'Pictures') };
}

/** Where a download is in the queue: where the user put it, or when it was asked for. */
export const queueRank = (j: Pick<Job, 'order' | 'startedAt'>): number => j.order ?? j.startedAt;

/**
 * The waiting downloads' places once one is moved before another (or last): the same places,
 * handed out in the new order (made distinct, so the order holds).
 */
export function reorderedPlaces(waiting: { id: string; rank: number }[], id: string, before?: string): Map<string, number> {
  const ranks = waiting.map((w) => w.rank).sort((a, b) => a - b);
  for (let i = 1; i < ranks.length; i++) if (ranks[i]! <= ranks[i - 1]!) ranks[i] = ranks[i - 1]! + 0.001;
  const ids = waiting.map((w) => w.id).filter((x) => x !== id);
  const at = before ? ids.indexOf(before) : -1;
  ids.splice(at < 0 ? ids.length : at, 0, id);
  return new Map(ids.map((x, i) => [x, ranks[i]!]));
}

/** The smallest quality offered (by its lines, else its bitrate). */
function smallest<T extends { height?: number; bandwidth?: number }>(variants: T[]): T {
  return variants.reduce((a, b) => ((b.height ?? Infinity) < (a.height ?? Infinity) || (b.height === a.height && (b.bandwidth ?? 0) < (a.bandwidth ?? 0)) ? b : a));
}
