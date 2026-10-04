import { hostOf } from '../parsers/url';
import { isAudioFormat, VIDEO_FORMATS } from '../shared/formats';
import { canShrink, scaleChoices, SHRUNK_FORMATS } from '../shared/scale';
import { buildFilename } from '../shared/filename';
import { uid } from '../shared/ids';
import type { BgToContent, ContentToBg, OffscreenToBg } from '../shared/messages';
import type { ErrorCode, OutputFormat, Plan, VideoFormat } from '../shared/plan';
import { getSettings, type Settings } from '../shared/settings';
import type { Job, JobMode, JobStatus, MediaItem } from '../shared/types';
import { fetchTextAs, sweepHeaderRules, withPageHeaders } from './headers';
import { addHistory } from './history';
import { notifyFinished } from './notify';
import { scheduleOffscreenClose, sendOffscreen } from './offscreen-client';
import { buildPlan, PlanError } from './plan';
import { hiddenPlayerUrl } from '../features/youtube';
import { allowHiddenPlayer } from './headers';
import { ensureOffscreen } from './offscreen-client';
import type { Registry } from './registry';
import { findVisible } from './visible';

const STORE_KEY = 'jobs';
const MAX_PARALLEL = 2;
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
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      void chrome.storage.session.set({ [STORE_KEY]: [...this.jobs.values()] }).catch(() => {});
    }, 300);
    for (const l of this.listeners) l();
    if (this.isBusy()) this.startPolling();
    else scheduleOffscreenClose(() => this.isBusy());
  }

  private async restore() {
    const saved = ((await chrome.storage.session.get(STORE_KEY))[STORE_KEY] as Job[] | undefined) ?? [];
    const now = Date.now();
    for (const j of saved) {
      this.jobs.set(j.id, j);
      this.lastUpdate.set(j.id, now);
    }
    if (saved.some((j) => ACTIVE.includes(j.status))) this.startPolling();
    this.pump();
  }

  /* -------------------------------------------------------------- commands */

  async start(
    tabId: number,
    mediaId: string,
    variantId: string | undefined,
    mode: JobMode,
    format?: OutputFormat,
    scale?: number,
  ): Promise<Job | undefined> {
    await this.ready;
    const item = findVisible(await this.registry.get(tabId), mediaId) ?? this.items.get(`${tabId}:${mediaId}`);
    if (!item) return undefined;
    // Only the smaller qualities the card offers.
    if (scale !== undefined && (mode !== 'video' || !canShrink(item) || !scaleChoices(item.variants).includes(scale))) scale = undefined;
    const dup = [...this.jobs.values()].find(
      (j) =>
        j.tabId === tabId && j.mediaId === mediaId && j.mode === mode && j.variantId === variantId && j.scale === scale &&
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
    if (!(await this.start(j.tabId, j.mediaId, j.variantId, j.mode, j.format, j.scale))) this.changed();
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
    this.update(job.id, { status: 'downloading', progress: 0 });
    try {
      // Queued while the page moved on (a new page in the same tab): what was asked still stands.
      const item = findVisible(await this.registry.get(job.tabId), job.mediaId) ?? this.items.get(`${job.tabId}:${job.mediaId}`);
      if (!item) return this.fail(job.id, 'unknown');
      const settings = await getSettings();
      const plan = await buildPlan(item, {
        mode: job.mode,
        ...(job.format ? { format: job.format } : {}),
        settings,
        fetchText: (u) => fetchTextAs(u, item.pageUrl),
        ...(job.variantId ? { variantId: job.variantId } : {}),
        ...(job.scale ? { scale: job.scale } : {}),
      });
      if (this.gone(job.id)) return;
      this.update(job.id, {
        raw: plan.raw,
        // A file's size comes from the server; a stream's is estimated from its bitrate.
        ...(plan.estimatedSize ? { bytes: 0, total: plan.estimatedSize, totalApprox: plan.kind !== 'file' } : {}),
      });

      if (plan.kind === 'file' && plan.direct) return await this.direct(job, plan.video?.segments[0]?.url ?? item.url, plan.output, settings);
      if (plan.kind === 'capture') {
        return __TARGET__ === 'github' && item.ytId ? await this.startHidden(job, plan, item) : await this.startCapture(job, plan);
      }

      const urls = [plan.video, plan.audio].flatMap((t) => (t ? [...(t.init ? [t.init.url] : []), ...t.segments.map((s) => s.url)] : []));
      const perHost = [...new Map(urls.map((u) => [hostOf(u), u])).values()];
      this.releases.set(job.id, await withPageHeaders(job.pageUrl, perHost));
      if (this.gone(job.id)) return void this.cleanup(job.id);
      this.update(job.id, { blob: true });
      await sendOffscreen({ target: 'offscreen', type: 'run', jobId: job.id, plan });
    } catch (e) {
      if (!this.gone(job.id)) this.fail(job.id, e instanceof PlanError ? e.code : 'network');
    }
  }

  private filename(job: Job, ext: string, s: Settings): string {
    return buildFilename(
      s.template,
      { title: job.title, site: hostOf(job.pageUrl).replace(/^www\./, ''), date: new Date(), ...(job.quality ? { quality: job.quality } : {}) },
      ext,
      s.subfolder ? 'Grabby' : undefined,
    );
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
   * github build, YouTube: a hidden copy of the player records the video at high speed
   * while the user keeps watching theirs. Codecs are chosen so the file needs no re-encoding.
   */
  private async startHidden(job: Job, plan: Plan, item: MediaItem) {
    if (__TARGET__ !== 'github') return;
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

  private async cleanup(jobId: string) {
    const release = this.releases.get(jobId);
    this.releases.delete(jobId);
    await release?.();
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
    if (msg.type === 'job-progress') {
      this.update(job.id, { status: msg.status, progress: msg.progress, bytes: msg.bytes, speed: msg.speed });
    } else if (msg.type === 'job-error') {
      this.fail(job.id, msg.error);
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
      } catch {
        this.fail(job.id, 'unknown');
      }
    }
  }

  private async onDownloadChanged(d: chrome.downloads.DownloadDelta) {
    await this.ready;
    const job = [...this.jobs.values()].find((j) => j.downloadId === d.id);
    if (!job || FINISHED.includes(job.status)) return;
    if (d.filename?.current) {
      this.update(job.id, { filename: d.filename.current.split(/[\\/]/).pop() ?? job.filename });
    }
    if (d.state?.current === 'complete') {
      const [info] = await chrome.downloads.search({ id: d.id });
      const size = info?.fileSize || info?.totalBytes || job.bytes;
      this.update(job.id, { status: 'done', progress: 1, speed: 0, bytes: size });
      await addHistory({
        id: job.id,
        filename: job.filename,
        title: job.title,
        pageUrl: job.pageUrl,
        size,
        date: Date.now(),
        downloadId: d.id,
      });
      void notifyFinished(this.jobs.get(job.id) ?? job);
      await this.cleanup(job.id);
      this.pump();
    } else if (d.state?.current === 'interrupted') {
      const code = interruptCode(d.error?.current);
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
          this.fail(j.id, 'network');
        } else if (j.status === 'capturing' && idle > CAPTURE_STALL_MS) {
          if (!this.stopAsked.has(j.id)) {
            // Ask the page to stop and hand over what it has; give it 10 s before assembling anyway.
            this.stopAsked.add(j.id);
            this.lastUpdate.set(j.id, now - CAPTURE_STALL_MS + 10_000);
            void this.finishCapture(j.id);
          } else void this.assembleCapture(j);
        }
      }
      if (!this.isBusy()) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
    }, 500);
  }
}
