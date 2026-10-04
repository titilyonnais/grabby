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
  /** Per-segment deadline: a server that stops answering counts as a network error. */
  timeoutMs?: number;
  /** Called strictly in segment order; awaited before the next one (backpressure). */
  onData: (index: number, data: Uint8Array<ArrayBuffer>) => void | Promise<void>;
  onBytes?: (n: number) => void;
}

const FATAL = new Set([401, 403, 404, 410]);
const SEGMENT_TIMEOUT_MS = 60_000;
const STREAM_IDLE_MS = 60_000;

/**
 * A signal that aborts with `outer`, or with a TypeError (like a network failure) when
 * `arm()` isn't called again within `ms`. (AbortSignal.any needs Chrome 116.)
 */
function deadline(outer: AbortSignal | undefined, ms: number) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(outer!.reason);
  if (outer?.aborted) onAbort();
  else outer?.addEventListener('abort', onAbort, { once: true });
  let t: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(t);
    t = setTimeout(() => ctl.abort(new TypeError('network timeout')), ms);
  };
  arm();
  return {
    signal: ctl.signal,
    arm,
    done() {
      clearTimeout(t);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok, ko) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      ko(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

export async function fetchSegment(
  seg: SegRef,
  opts: Pick<FetchOptions, 'signal' | 'fetchImpl' | 'timeoutMs'>,
): Promise<Uint8Array<ArrayBuffer>> {
  const f = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {};
  if (seg.range) headers.Range = `bytes=${seg.range[0]}-${seg.range[1]}`;
  const dl = deadline(opts.signal, opts.timeoutMs ?? SEGMENT_TIMEOUT_MS);
  let buf: Uint8Array<ArrayBuffer>;
  let res: Response;
  try {
    res = await f(seg.url, { credentials: 'include', headers, signal: dl.signal });
    if (!res.ok) throw new HttpError(res.status);
    buf = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    // Report our own timeout as a network error, not as the user's cancel.
    throw dl.signal.aborted && !opts.signal?.aborted ? dl.signal.reason : e;
  } finally {
    dl.done();
  }
  // Server ignored the Range header and sent the whole resource.
  if (seg.range && res.status === 200 && buf.length > seg.range[1] - seg.range[0] + 1) {
    return buf.slice(seg.range[0], seg.range[1] + 1);
  }
  return buf;
}

/** Streams a whole resource into Blob parts, reporting (received, total) as it goes. */
export async function fetchStream(
  url: string,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; onProgress?: (received: number, total: number) => void },
): Promise<Uint8Array<ArrayBuffer>[]> {
  const f = opts.fetchImpl ?? fetch;
  // Large files can take hours: only time out when no data arrives for a while.
  const dl = deadline(opts.signal, STREAM_IDLE_MS);
  try {
    const res = await f(url, { credentials: 'include', signal: dl.signal });
    if (!res.ok) throw new HttpError(res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body) return [new Uint8Array(await res.arrayBuffer())];
    const reader = res.body.getReader();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      dl.arm();
      parts.push(value as Uint8Array<ArrayBuffer>);
      received += value.length;
      opts.onProgress?.(received, total);
    }
    return parts;
  } catch (e) {
    throw dl.signal.aborted && !opts.signal?.aborted ? dl.signal.reason : e;
  } finally {
    dl.done();
  }
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

/** How many segments download at once by default: enough to fill a fast link, few enough
 * not to trip a CDN's per-client rate limit. */
export const DEFAULT_CONCURRENCY = 8;

/** Downloads segments with bounded parallelism and delivers them in order. */
export async function fetchInOrder(segs: SegRef[], o: FetchOptions): Promise<void> {
  const concurrency = Math.max(1, o.concurrency ?? DEFAULT_CONCURRENCY);
  const ready = new Map<number, Uint8Array<ArrayBuffer>>();
  let next = 0;
  let delivered = 0;
  let failed: unknown = null;
  // Several workers can wait at once: every change wakes all of them.
  let waiters: (() => void)[] = [];
  const notify = () => {
    const w = waiters;
    waiters = [];
    for (const r of w) r();
  };
  const waitChange = () => new Promise<void>((r) => waiters.push(r));

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
