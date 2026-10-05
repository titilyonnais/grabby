/** Promise-based client for the ffmpeg worker, with a serial lock around exec. */
type Pending = { ok: (v: unknown) => void; ko: (e: Error) => void; cmd: string };

export class FFmpeg {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private lock: Promise<unknown> = Promise.resolve();
  private logs: string[] = [];
  private progressCb: ((p: number) => void) | null = null;
  private loaded: Promise<void>;
  /** Set once the wasm module aborted (e.g. out of memory): it can't be reused. */
  broken = false;
  /** Jobs currently keeping files in this instance (a cancel may only kill it when alone). */
  users = 0;

  constructor() {
    this.worker = new Worker(new URL('./ffmpeg-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent) => {
      const d = e.data as { id?: number; ok?: boolean; res?: unknown; error?: string; type?: string; message?: string; progress?: number };
      if (d.type === 'log') {
        this.logs.push(d.message ?? '');
        if (this.logs.length > 40) this.logs.shift();
        return;
      }
      if (d.type === 'progress') {
        if (typeof d.progress === 'number' && d.progress >= 0 && d.progress <= 1) this.progressCb?.(d.progress);
        return;
      }
      const p = this.pending.get(d.id!);
      if (!p) return;
      this.pending.delete(d.id!);
      if (d.ok) p.ok(d.res);
      else {
        if (p.cmd === 'exec' || p.cmd === 'load') this.broken = true;
        p.ko(new Error(`ffmpeg: ${d.error ?? 'error'}`));
      }
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.fail(new Error(`ffmpeg: ${e.message || 'worker crashed'}`));
    };
    this.loaded = this.call('load', {
      coreURL: chrome.runtime.getURL('ffmpeg/ffmpeg-core.js'),
      wasmURL: chrome.runtime.getURL('ffmpeg/ffmpeg-core.wasm'),
    }).then(() => undefined);
  }

  private call<T = unknown>(cmd: string, payload: object, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((ok, ko) => {
      if (this.broken) return ko(new Error('ffmpeg: unavailable'));
      this.pending.set(id, { ok: ok as (v: unknown) => void, ko, cmd });
      this.worker.postMessage({ id, cmd, ...payload }, transfer);
    });
  }

  ready(): Promise<void> {
    return this.loaded;
  }

  async mkdir(path: string) {
    await this.loaded;
    await this.call('mkdir', { path });
  }

  async create(path: string) {
    await this.loaded;
    await this.call('create', { path });
  }

  /** Appends bytes to a FS file; the buffer is transferred (unusable afterwards). */
  async append(path: string, data: Uint8Array) {
    await this.loaded;
    const own = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : data.slice();
    await this.call('append', { path, data: own }, [own.buffer]);
  }

  async read(path: string): Promise<Uint8Array> {
    await this.loaded;
    return this.call<Uint8Array>('read', { path });
  }

  async rmdir(path: string) {
    await this.loaded;
    await this.call('rmdir', { path });
  }

  /**
   * Runs ffmpeg; returns its exit code. Calls are serialized. Canceled while waiting its
   * turn, it doesn't run; canceled while running, the worker is stopped (when no other job
   * keeps files in it), so the processor is freed at once.
   */
  exec(args: string[], onProgress?: (p: number) => void, signal?: AbortSignal): Promise<number> {
    const run = this.lock.then(async () => {
      await this.loaded;
      const aborted = () => signal?.reason ?? new DOMException('Aborted', 'AbortError');
      if (signal?.aborted) throw aborted();
      this.logs = [];
      this.progressCb = onProgress ?? null;
      const stop = () => this.users <= 1 && this.terminate();
      signal?.addEventListener('abort', stop, { once: true });
      try {
        // -copyts stays on in this build once a run used it: every other run turns it off.
        return await this.call<number>('exec', { args: args.includes('-copyts') ? args : ['-nocopyts', ...args] });
      } catch (e) {
        throw signal?.aborted ? aborted() : e;
      } finally {
        signal?.removeEventListener('abort', stop);
        this.progressCb = null;
      }
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  lastLogs(): string {
    return this.logs.join('\n');
  }

  private fail(err: Error) {
    this.broken = true;
    this.worker.terminate();
    for (const p of this.pending.values()) p.ko(err);
    this.pending.clear();
  }

  terminate() {
    this.fail(new Error('ffmpeg: terminated'));
  }
}

let instance: FFmpeg | null = null;
/** Shared instance, recreated after a crash so one bad job doesn't break the next ones. */
export function getFFmpeg(): FFmpeg {
  if (instance?.broken) {
    instance.terminate();
    instance = null;
  }
  return (instance ??= new FFmpeg());
}
