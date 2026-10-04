import { extOf, hostOf } from '../parsers/url';
import { buildFilename } from '../shared/filename';
import { uid } from '../shared/ids';
import type { BgToContent, ContentToBg, OffscreenToBg } from '../shared/messages';
import type { ErrorCode, OutputFormat, Plan } from '../shared/plan';
import { getSettings, type Settings } from '../shared/settings';
import type { Job, JobMode, JobStatus } from '../shared/types';
import { fetchTextAs, withPageHeaders } from './headers';
import { addHistory } from './history';
import { scheduleOffscreenClose, sendOffscreen } from './offscreen-client';
import { buildPlan, PlanError } from './plan';
import type { Registry } from './registry';

const STORE_KEY = 'jobs';
const MAX_PARALLEL = 2;
const KEEP_FINISHED_MS = 30 * 60_000;
const STALL_MS = 120_000;

const ACTIVE: JobStatus[] = ['downloading', 'capturing', 'processing', 'saving'];
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

export class JobManager {
  private jobs = new Map<string, Job>();
  private capturePlans = new Map<string, Plan>();
  private releases = new Map<string, () => Promise<void>>();
  /** Jobs whose final file comes from an offscreen Blob URL (must be revoked). */
  private blobJobs = new Set<string>();
  private lastUpdate = new Map<string, number>();
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

  private update(id: string, patch: Partial<Job>): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    // Never resurrect finished jobs from late events.
    if (FINISHED.includes(job.status) && patch.status && !FINISHED.includes(patch.status) && patch.status !== 'queued') {
      return job;
    }
    Object.assign(job, patch);
    this.lastUpdate.set(id, Date.now());
    this.changed();
    return job;
  }

  private changed() {
    const now = Date.now();
    for (const [id, j] of this.jobs) {
      if (FINISHED.includes(j.status) && now - (this.lastUpdate.get(id) ?? j.startedAt) > KEEP_FINISHED_MS) this.jobs.delete(id);
    }
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      void chrome.storage.session.set({ [STORE_KEY]: [...this.jobs.values()] });
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
    if (saved.some((j) => j.downloadId !== undefined && ACTIVE.includes(j.status))) this.startPolling();
    this.pump();
  }

  /* -------------------------------------------------------------- commands */

  async start(tabId: number, mediaId: string, variantId: string | undefined, mode: JobMode): Promise<Job | undefined> {
    await this.ready;
    const item = await this.registry.find(tabId, mediaId);
    if (!item) return undefined;
    const dup = [...this.jobs.values()].find(
      (j) =>
        j.tabId === tabId && j.mediaId === mediaId && j.mode === mode && j.variantId === variantId &&
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
      ...(mode === 'video' && variant ? { quality: variant.label } : {}),
      ...(item.frameId !== undefined ? { frameId: item.frameId } : {}),
      ...(item.videoIndex !== undefined ? { videoIndex: item.videoIndex } : {}),
    };
    this.jobs.set(job.id, job);
    this.lastUpdate.set(job.id, Date.now());
    this.changed();
    this.pump();
    return job;
  }

  async retry(jobId: string): Promise<void> {
    const j = this.jobs.get(jobId);
    if (!j || !FINISHED.includes(j.status)) return;
    this.jobs.delete(jobId);
    await this.start(j.tabId, j.mediaId, j.variantId, j.mode);
  }

  dismiss(jobId: string): void {
    const j = this.jobs.get(jobId);
    if (j && FINISHED.includes(j.status)) {
      this.jobs.delete(jobId);
      this.changed();
    }
  }

  async cancel(jobId: string): Promise<void> {
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
    const job = this.jobs.get(jobId);
    if (job?.status === 'capturing') await this.toContent(job, { type: 'capture-stop', jobId });
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
    this.update(jobId, { status: error === 'canceled' ? 'canceled' : 'error', error, speed: 0 });
    void this.cleanup(jobId);
    this.pump();
  }

  private async run(job: Job) {
    this.update(job.id, { status: 'downloading', progress: 0 });
    try {
      const item = await this.registry.find(job.tabId, job.mediaId);
      if (!item) return this.fail(job.id, 'unknown');
      const settings = await getSettings();
      const plan = await buildPlan(item, {
        mode: job.mode,
        settings,
        fetchText: (u) => fetchTextAs(u, item.pageUrl),
        ...(job.variantId ? { variantId: job.variantId } : {}),
      });
      if (this.jobs.get(job.id)?.status === 'canceled') return;
      this.update(job.id, { raw: plan.raw, ...(plan.estimatedSize ? { bytes: 0 } : {}) });

      if (plan.kind === 'file' && (!plan.audioOnly || item.audioOnly)) {
        const ext = item.audioOnly ? extOf(item.url) || 'mp3' : plan.output;
        return await this.direct(job, item.url, ext, settings);
      }
      if (plan.kind === 'capture') return await this.startCapture(job, plan);

      const urls = [plan.video, plan.audio].flatMap((t) => (t ? [...(t.init ? [t.init.url] : []), ...t.segments.map((s) => s.url)] : []));
      const perHost = [...new Map(urls.map((u) => [hostOf(u), u])).values()];
      this.releases.set(job.id, await withPageHeaders(job.pageUrl, perHost));
      this.blobJobs.add(job.id);
      await sendOffscreen({ target: 'offscreen', type: 'run', jobId: job.id, plan });
    } catch (e) {
      this.fail(job.id, e instanceof PlanError ? e.code : 'network');
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
    const downloadId = await chrome.downloads.download({ url, filename, saveAs: settings.saveAs, conflictAction: 'uniquify' });
    this.update(job.id, { downloadId, filename, sourceUrl: url, ext });
    this.startPolling();
  }

  private async fetchFallback(job: Job) {
    const url = job.sourceUrl!;
    const { downloadId: _dropped, ...rest } = job;
    this.jobs.set(job.id, { ...rest, viaFetch: true, status: 'downloading', progress: 0, bytes: 0, speed: 0 });
    this.changed();
    await this.releases.get(job.id)?.();
    this.releases.set(job.id, await withPageHeaders(job.pageUrl, [url]));
    this.blobJobs.add(job.id);
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
    this.capturePlans.set(job.id, plan);
    this.update(job.id, { status: 'capturing' });
    const ok = await this.toContent(job, { type: 'capture-start', jobId: job.id, videoIndex: job.videoIndex });
    if (!ok) this.fail(job.id, 'capture_unavailable');
    this.pump();
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
    this.capturePlans.delete(jobId);
    await release?.();
    if (this.blobJobs.delete(jobId) || this.jobs.get(jobId)?.kind === 'capture') {
      await sendOffscreen({ target: 'offscreen', type: 'release', jobId }).catch(() => {});
    }
  }

  /* --------------------------------------------------------------- events */

  async onContentMessage(msg: ContentToBg): Promise<void> {
    if (!('jobId' in msg)) return;
    const job = this.jobs.get(msg.jobId);
    if (!job || job.status !== 'capturing') return;
    if (msg.type === 'capture-progress') {
      this.update(job.id, { progress: msg.progress, bytes: msg.bytes });
    } else if (msg.type === 'capture-error') {
      this.fail(job.id, msg.error);
    } else if (msg.type === 'capture-done') {
      const plan = this.capturePlans.get(job.id);
      if (!plan || !msg.tracks.length) return this.fail(job.id, 'capture_failed');
      this.update(job.id, { status: 'processing', progress: 0 });
      this.blobJobs.add(job.id);
      await sendOffscreen({ target: 'offscreen', type: 'run', jobId: job.id, plan }).catch(() => this.fail(job.id, 'unknown'));
    }
  }

  async onOffscreenMessage(msg: OffscreenToBg): Promise<void> {
    if (msg.type === 'sink-check') return;
    const job = this.jobs.get(msg.jobId);
    if (!job || FINISHED.includes(job.status)) return;
    if (msg.type === 'job-progress') {
      this.update(job.id, { status: msg.status, progress: msg.progress, bytes: msg.bytes, speed: msg.speed });
    } else if (msg.type === 'job-error') {
      this.fail(job.id, msg.error);
    } else if (msg.type === 'job-ready') {
      const settings = await getSettings();
      const filename = this.filename(job, msg.ext as OutputFormat, settings);
      this.update(job.id, { status: 'saving', progress: 1, bytes: msg.size, speed: 0, filename });
      try {
        const downloadId = await chrome.downloads.download({ url: msg.blobUrl, filename, saveAs: settings.saveAs, conflictAction: 'uniquify' });
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
      await this.cleanup(job.id);
      this.pump();
    } else if (d.state?.current === 'interrupted') {
      const code = interruptCode(d.error?.current);
      // The download manager bypasses our Referer/Origin rules: retry through an extension fetch.
      if (job.sourceUrl && !job.viaFetch && !this.blobJobs.has(job.id) && ['http_403', 'http_404', 'http_other'].includes(code)) {
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
        const elapsed = Math.max(0.5, (now - j.startedAt) / 1000);
        this.update(j.id, {
          bytes: info.bytesReceived,
          progress: info.totalBytes > 0 ? info.bytesReceived / info.totalBytes : 0,
          speed: info.bytesReceived / elapsed,
        });
      }
      for (const j of this.jobs.values()) {
        if (['downloading', 'processing'].includes(j.status) && j.downloadId === undefined && now - (this.lastUpdate.get(j.id) ?? now) > STALL_MS) {
          this.fail(j.id, 'network');
        }
      }
      if (!this.isBusy()) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
    }, 500);
  }
}
