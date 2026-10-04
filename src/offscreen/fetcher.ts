import type { SegRef } from '../shared/plan';

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

export interface FetchOptions {
  concurrency?: number;
  retries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Called strictly in segment order; awaited before the next one (backpressure). */
  onData: (index: number, data: Uint8Array<ArrayBuffer>) => void | Promise<void>;
  onBytes?: (n: number) => void;
}

const FATAL = new Set([401, 403, 404, 410]);

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok, ko) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      ko(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

export async function fetchSegment(seg: SegRef, opts: Pick<FetchOptions, 'signal' | 'fetchImpl'>): Promise<Uint8Array<ArrayBuffer>> {
  const f = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {};
  if (seg.range) headers.Range = `bytes=${seg.range[0]}-${seg.range[1]}`;
  const res = await f(seg.url, { credentials: 'include', headers, ...(opts.signal ? { signal: opts.signal } : {}) });
  if (!res.ok) throw new HttpError(res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  // Server ignored the Range header and sent the whole resource.
  if (seg.range && res.status === 200 && buf.length > seg.range[1] - seg.range[0] + 1) {
    return buf.slice(seg.range[0], seg.range[1] + 1);
  }
  return buf;
}

async function withRetry(seg: SegRef, o: FetchOptions): Promise<Uint8Array<ArrayBuffer>> {
  const retries = o.retries ?? 3;
  const delay = o.retryDelayMs ?? 500;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchSegment(seg, o);
    } catch (e) {
      if (o.signal?.aborted) throw e;
      const fatal = e instanceof HttpError && FATAL.has(e.status);
      if (fatal || attempt >= retries) throw e;
      await sleep(delay * 2 ** attempt, o.signal);
    }
  }
}

/** Downloads segments with bounded parallelism and delivers them in order. */
export async function fetchInOrder(segs: SegRef[], o: FetchOptions): Promise<void> {
  const concurrency = Math.max(1, o.concurrency ?? 6);
  const ready = new Map<number, Uint8Array<ArrayBuffer>>();
  let next = 0;
  let delivered = 0;
  let failed: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const waitChange = () => new Promise<void>((r) => (wake = r));

  let flushing = false;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (ready.has(delivered)) {
        const data = ready.get(delivered)!;
        ready.delete(delivered);
        await o.onData(delivered, data);
        delivered++;
        notify();
      }
    } finally {
      flushing = false;
    }
  }

  async function worker() {
    while (!failed) {
      if (o.signal?.aborted) throw o.signal.reason ?? new DOMException('Aborted', 'AbortError');
      // Bound memory: don't run too far ahead of the in-order consumer.
      while (next - delivered >= concurrency * 2 && !failed) await waitChange();
      const i = next++;
      if (i >= segs.length) return;
      const data = await withRetry(segs[i]!, o);
      o.onBytes?.(data.length);
      ready.set(i, data);
      await flush();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, segs.length) }, () =>
    worker().catch((e) => {
      failed ??= e;
      notify();
    }),
  );
  await Promise.all(workers);
  if (failed) throw failed;
  await flush();
  if (delivered !== segs.length) throw new Error('incomplete download');
}
