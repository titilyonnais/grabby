/** Promise-based client for the ffmpeg worker, with a serial lock around exec. */
type Pending = { ok: (v: unknown) => void; ko: (e: Error) => void };

export class FFmpeg {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private lock: Promise<unknown> = Promise.resolve();
  private logs: string[] = [];
  private progressCb: ((p: number) => void) | null = null;
  private loaded: Promise<void>;

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
      else p.ko(new Error(d.error ?? 'ffmpeg error'));
    };
    this.loaded = this.call('load', {
      coreURL: chrome.runtime.getURL('ffmpeg/ffmpeg-core.js'),
      wasmURL: chrome.runtime.getURL('ffmpeg/ffmpeg-core.wasm'),
    }).then(() => undefined);
  }

  private call<T = unknown>(cmd: string, payload: object, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((ok, ko) => {
      this.pending.set(id, { ok: ok as (v: unknown) => void, ko });
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

  /** Runs ffmpeg; returns its exit code. Calls are serialized. */
  exec(args: string[], onProgress?: (p: number) => void): Promise<number> {
    const run = this.lock.then(async () => {
      await this.loaded;
      this.logs = [];
      this.progressCb = onProgress ?? null;
      try {
        return await this.call<number>('exec', { args });
      } finally {
        this.progressCb = null;
      }
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  lastLogs(): string {
    return this.logs.join('\n');
  }

  terminate() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.ko(new Error('terminated'));
    this.pending.clear();
  }
}

let instance: FFmpeg | null = null;
export const getFFmpeg = (): FFmpeg => (instance ??= new FFmpeg());
