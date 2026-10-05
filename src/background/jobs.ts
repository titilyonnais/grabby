import { hostOf } from '../parsers/url';
import { isAudioFormat, VIDEO_FORMATS } from '../shared/formats';
import { canShrink, scaleChoices, SHRUNK_FORMATS } from '../shared/scale';
import { buildFilename } from '../shared/filename';
import { canClip, clipLabel, sameClip } from '../shared/clip';
import { uid } from '../shared/ids';
import type { BgToContent, ContentToBg, OffscreenToBg } from '../shared/messages';
import type { Clip, ErrorCode, OutputFormat, Plan, SubsChoice, VideoFormat } from '../shared/plan';
import { getSettings, type Settings } from '../shared/settings';
import type { Job, JobMode, JobStatus, MediaItem } from '../shared/types';
import { fetchTextAs, sweepHeaderRules, withPageHeaders } from './headers';
import { addHistory } from './history';
import { notifyFinished } from './notify';
import { scheduleOffscreenClose, sendOffscreen } from './offscreen-client';
import { buildPlan, PlanError, validClip } from './plan';
import { hiddenPlayerUrl } from '../features/youtube';
import { allowHiddenPlayer } from './headers';
import { ensureOffscreen } from './offscreen-client';
import type { Registry } from './registry';
import { findVisible } from './visible';
import { deleteParts, storedJobs } from '../shared/parts';

const STORE_KEY = 'jobs';
/** A job's download plan, kept apart (it can be big) for resuming. */
const PLAN_KEY = (id: string) => `plan:${id}`;
/** Set for the browser session: missing at startup means the browser was restarted. */
const BOOT_KEY = 'booted';
const WAKE_ALARM = 'grabby-resume';
const MAX_PARALLEL = 2;
/** Tries in a row for the network before giving up (about 40 min of waiting in all). */
const MAX_ATTEMPTS = 24;
const KEEP_FINISHED_MS = 30 * 60_000;
const STALL_MS = 120_000;
/** A recording that receives nothing for this long is wrapped up with what it has. */
const CAPTURE_STALL_MS = 60_000;

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
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  readonly ready: Promise<void>;

  constructor(private registry: Registry) {
    this.ready = this.restore();
    chrome.downloads.onChanged.addListener((d) => void this.onDownloadChanged(d));
  }

  /* ------------------------------------------------------------------ state */

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  list(tabId?: number): Job[] {
    const all = [...this.jobs.values()].sort((a, b) => a.startedAt - b.startedAt);
    return tabId === undefined ? all : all.filter((j) => j.tabId === tabId);
  }

  isCapturing(jobId: string): boolean {
    return this.jobs.get(jobId)?.status === 'capturing';
  }

  isBusy(): boolean {
    return [...this.jobs.values()].some((j) => ACTIVE.includes(j.status) || j.status === 'queued');
  }

  /** Jobs waiting to try again on their own (network, browser restart). */
  private waiting(): Job[] {
    return [...this.jobs.values()].filter((j) => j.status === 'paused' && j.pausedBy !== 'user' && j.retryAt !== undefined);
  }

  /** A download can be paused while it fetches (not while it records or assembles). */
  static canPause(j: Job): boolean {
    return (j.status === 'downloading' || j.status === 'queued') && j.kind !== 'capture';
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
    const saved = ((await chrome.storage.local.get(STORE_KEY))[STORE_KEY] as Job[] | undefined) ?? [];
    // No mark for this browser session yet: the browser (or the computer) restarted.
    const restarted = !(await chrome.storage.session.get(BOOT_KEY))[BOOT_KEY];
    await chrome.storage.session.set({ [BOOT_KEY]: true });
    const now = Date.now();
    for (const j of saved) {
      if (restarted) {
        // Results of the previous session are in the history; only unfinished work stays.
        if (FINISHED.includes(j.status)) continue;
        if (j.kind === 'capture') {
          // A recording can't go on without its page.
          Object.assign(j, { status: 'error', error: 'capture_failed', speed: 0 });
        } else if (!(j.status === 'paused' && j.pausedBy === 'user')) {
          // Its file was being written from memory that is gone: fetch what's missing again.
          if (j.blob) delete j.downloadId;
          Object.assign(j, { status: 'paused', pausedBy: 'restart', retryAt: now + 2000, speed: 0 });
        }
      }
      this.jobs.set(j.id, j);
      this.lastUpdate.set(j.id, now);
    }
    // Pieces no job owns any more (a job dropped while its pieces were being written).
    void storedJobs()
      .then((ids) => Promise.all(ids.filter((id) => !this.jobs.has(id)).map((id) => deleteParts(id))))
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
    extra: { scale?: number; clip?: Clip; subtitles?: SubsChoice } = {},
  ): Promise<Job | undefined> {
    await this.ready;
    let { scale, clip } = extra;
    const item = findVisible(await this.registry.get(tabId), mediaId) ?? this.items.get(`${tabId}:${mediaId}`);
    if (!item) return undefined;
    // Only the smaller qualities the card offers.
    if (scale !== undefined && (mode !== 'video' || !canShrink(item) || !scaleChoices(item.variants).includes(scale))) scale = undefined;
    // A part of the video, when it can be cut and isn't the whole of it.
    clip = canClip(item) ? validClip(clip, item.duration) : undefined;
    // Subtitles go with a video, and only the ones the stream offers.
    const subtitles = mode === 'video' && extra.subtitles && item.subtitles?.some((s) => s.id === extra.subtitles!.id) ? extra.subtitles : undefined;
    const dup = [...this.jobs.values()].find(
      (j) =>
        j.tabId === tabId && j.mediaId === mediaId && j.mode === mode && j.variantId === variantId && j.scale === scale && sameClip(j.clip, clip) && j.subtitles?.id === subtitles?.id &&
        !FINISHED.includes(j.status),
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
      ...(variantId ? { variantId } : {}),
      ...(clip ? { clip } : {}),
      ...(subtitles ? { subtitles } : {}),
      ...(scale ? { scale, quality: `${scale}p` } : mode === 'video' && variant ? { quality: variant.label } : {}),
      // A recording's size is known beforehand only when the site tells it (YouTube).
      ...(item.kind === 'capture' && mode === 'video' && (variant?.sizes?.[format as VideoFormat] ?? item.size)
        ? { total: variant?.sizes?.[format as VideoFormat] ?? item.size, totalApprox: true }
        : {}),
      ...(format && (mode === 'audio' ? isAudioFormat(format) : (scale ? SHRUNK_FORMATS : (item.formats ?? VIDEO_FORMATS)).includes(format as VideoFormat))
        ? { format }
        : {}),
      ...(item.ytId ? { hidden: true } : {}),
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
    // The video may be gone from the page: the card still has to update.
    if (!(await this.start(j.tabId, j.mediaId, j.variantId, j.mode, j.format, {
        ...(j.scale ? { scale: j.scale } : {}),
        ...(j.clip ? { clip: j.clip } : {}),
        ...(j.subtitles ? { subtitles: j.subtitles } : {}),
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
    if (browser) await chrome.downloads.pause(job.downloadId!).catch(() => {});
    else if (prev === 'downloading') await sendOffscreen({ target: 'offscreen', type: 'pause', jobId }).catch(() => {});
    await this.releaseRules(jobId);
    this.pump();
  }

  /** Carries on with a paused job: from where it stopped, with what was already stored. */
  async resume(jobId: string, auto = false): Promise<void> {
    await this.ready;
    const job = this.jobs.get(jobId);
    if (job?.status !== 'paused') return;
    // A try for the network that fails again waits longer next time.
    const attempts = auto && job.pausedBy === 'network' ? job.attempts ?? 0 : 0;
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
    this.update(jobId, { status: 'paused', pausedBy: 'network', retryAt, attempts, speed: 0 });
    void this.releaseRules(jobId);
    // The worker may sleep meanwhile: the alarm brings it back.
    void chrome.alarms?.create(WAKE_ALARM, { when: retryAt + 500 })?.catch?.(() => {});
    this.pump();
  }

  async finishCapture(jobId: string): Promise<void> {
    await this.ready;
    const job = this.jobs.get(jobId);
    if (job?.status !== 'capturing') return;
    // The page may be gone already: assemble whatever was stored.
    if (!(await this.toContent(job, { type: 'capture-stop', jobId }))) await this.assembleCapture(job);
  }

  /** The tab closed or left the page: recordings there can't continue. */
  async onTabGone(tabId: number): Promise<void> {
    await this.ready;
    for (const j of this.list(tabId)) {
      if (j.status === 'capturing') await this.assembleCapture(j);
    }
  }

  /* ------------------------------------------------------------ execution */

  private pump() {
    const running = [...this.jobs.values()].filter((j) => ['downloading', 'processing', 'saving'].includes(j.status)).length;
    let free = MAX_PARALLEL - running;
    for (const j of this.list()) {
      if (free <= 0) break;
      if (j.status !== 'queued') continue;
      free--;
      void this.run(j);
    }
  }

  private fail(jobId: string, error: ErrorCode) {
    const job = this.update(jobId, { status: error === 'canceled' ? 'canceled' : 'error', error, speed: 0 });
    if (job && error !== 'canceled') void notifyFinished(job);
    void this.cleanup(jobId);
    this.pump();
  }

  private async run(job: Job) {
    this.update(job.id, { status: 'downloading', speed: 0 });
    try {
      // Queued while the page moved on (a new page in the same tab): what was asked still stands.
      const item = (await this.itemOf(job)) ?? null;
      if (!item && !(await this.planOf(job.id))) return this.fail(job.id, 'expired');
      const settings = await getSettings();
      // Resumed: the same plan, so the pieces already stored still fit.
      const plan = (await this.planOf(job.id)) ?? (await this.planFor(job, item, settings));
      if (this.gone(job.id)) return;
      this.update(job.id, {
        raw: plan.raw,
        // A file's size comes from the server; a stream's is estimated from its bitrate.
        ...(plan.estimatedSize ? { bytes: 0, total: plan.estimatedSize, totalApprox: plan.kind !== 'file' } : {}),
      });

      if (plan.kind === 'capture') {
        if (!item) return this.fail(job.id, 'capture_failed');
        return item.ytId ? await this.startHidden(job, plan, item) : await this.startCapture(job, plan);
      }
      // Kept for a resume, even after a restart when the page is long gone.
      await this.savePlan(job.id, plan);
      if (plan.kind === 'file' && plan.direct && !plan.fast) return await this.direct(job, plan.video?.segments[0]?.url ?? item!.url, plan.output, settings);

      const urls = [plan.video, plan.audio].flatMap((t) => (t ? [...(t.init ? [t.init.url] : []), ...t.segments.map((s) => s.url)] : []));
      const perHost = [...new Map(urls.map((u) => [hostOf(u), u])).values()];
      this.releases.set(job.id, await withPageHeaders(job.pageUrl, perHost));
      if (this.gone(job.id)) return void this.cleanup(job.id);
      this.update(job.id, { blob: true });
      await sendOffscreen({ target: 'offscreen', type: 'run', jobId: job.id, plan });
    } catch (e) {
      if (this.gone(job.id)) return;
      if (e instanceof PlanError) this.fail(job.id, e.code);
      else this.retryLater(job.id);
    }
  }

  private async itemOf(job: Job): Promise<MediaItem | undefined> {
    return findVisible(await this.registry.get(job.tabId), job.mediaId) ?? this.items.get(`${job.tabId}:${job.mediaId}`);
  }

  private planFor(job: Job, item: MediaItem | null, settings: Settings): Promise<Plan> {
    if (!item) throw new PlanError('expired');
    return buildPlan(item, {
      mode: job.mode,
      ...(job.format ? { format: job.format } : {}),
      settings,
      fetchText: (u) => fetchTextAs(u, item.pageUrl),
      ...(job.variantId ? { variantId: job.variantId } : {}),
      ...(job.scale ? { scale: job.scale } : {}),
      ...(job.clip ? { clip: job.clip } : {}),
      ...(job.subtitles ? { subtitles: job.subtitles } : {}),
    });
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
    return buildFilename(
      s.template,
      // A part says which one: "Title (1m05-2m40)".
      { title: job.clip ? `${job.title} (${clipLabel(job.clip)})` : job.title, site: hostOf(job.pageUrl).replace(/^www\./, ''), date: new Date(), ...(job.quality ? { quality: job.quality } : {}) },
      ext,
      s.subfolder ? 'Grabby' : undefined,
    );
  }

  /** Subtitles kept apart: an .srt named like the video ("Title.fr.srt"), which players pick up. */
  private async saveSubtitles(job: Job, srt: string, settings: Settings) {
    const plan = await this.planOf(job.id);
    const lang = plan?.subtitles?.lang?.replace(/[^\w-]/g, '');
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
    if (job.videoIndex === undefined) return this.fail(job.id, 'capture_unavailable');
    this.update(job.id, { status: 'capturing', capturePlan: plan });
    const ok = await this.toContent(job, { type: 'capture-start', jobId: job.id, videoIndex: job.videoIndex });
    if (!ok && !this.gone(job.id)) this.fail(job.id, 'capture_unavailable');
    this.pump();
  }

  /**
   * YouTube: a hidden copy of the player records the video at high speed
   * while the user keeps watching theirs. Codecs are chosen so the file needs no re-encoding.
   */
  private async startHidden(job: Job, plan: Plan, item: MediaItem) {
    const v = item.variants.find((x) => x.id === job.variantId) ?? item.variants[0];
    const codecs = v?.codecs ?? '';
    const audio = job.mode === 'audio';
    const webm = !audio && job.format === 'webm';
    const vcodec = audio || (!webm && codecs.includes('avc1')) ? 'avc' : 'vp9';
    this.update(job.id, { status: 'capturing', capturePlan: plan });
    const src = hiddenPlayerUrl({
      jobId: job.id,
      videoId: item.ytId!,
      // Audio only: the smallest picture, the audio track is the same.
      quality: audio ? 'tiny' : (v?.id ?? 'hd1080'),
      vcodec,
      acodec: webm ? 'opus' : 'aac',
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

  /** Ends a recording: hands the stored chunks to the offscreen assembler. */
  private async assembleCapture(job: Job, hasTracks = job.bytes > 0, keep?: number[]) {
    if (job.status !== 'capturing') return;
    const plan = job.capturePlan;
    this.stopAsked.delete(job.id);
    if (job.hidden) void sendOffscreen({ target: 'offscreen', type: 'yt-stop', jobId: job.id }).catch(() => {});
    // The page gives its video back (normal speed, its sound) and stops recording.
    else void this.toContent(job, { type: 'capture-stop', jobId: job.id });
    if (!plan || !hasTracks) return this.fail(job.id, 'capture_failed');
    // A hidden player may also have recorded ads: keep only the tracks of the video itself.
    const final: Plan = { ...plan, ...(keep?.length ? { keepTracks: keep } : {}) };
    this.update(job.id, { status: 'processing', progress: CAPTURE_SHARE, speed: 0, blob: true, capturePlan: final });
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
      this.update(job.id, { progress: msg.progress * CAPTURE_SHARE, bytes: msg.bytes });
    } else if (msg.type === 'capture-error') {
      this.fail(job.id, msg.error);
    } else if (msg.type === 'capture-done') {
      await this.assembleCapture(job, msg.tracks.length > 0, msg.keep);
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
      for (const j of this.jobs.values()) {
        const idle = now - (this.lastUpdate.get(j.id) ?? now);
        // Offscreen jobs send a heartbeat even while queued behind ffmpeg: silence means it died.
        if (['downloading', 'processing'].includes(j.status) && j.downloadId === undefined && idle > STALL_MS) {
          // Nothing heard for long: the offscreen document died or the server went quiet.
          void sendOffscreen({ target: 'offscreen', type: 'pause', jobId: j.id }).catch(() => {});
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
