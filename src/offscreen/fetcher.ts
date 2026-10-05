import type { SegRef } from '../shared/plan';
import { Pacer } from './pacer';
import { RateLimiter } from '../shared/schedule';

/** The speed limit chosen in the settings, shared by everything this document fetches. */
export const limiter = new RateLimiter();

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

export interface FetchOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** How long a segment may go without receiving data before it counts as a network error. */
  timeoutMs?: number;
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

/** Reads a body to the end, calling `tick` on every chunk (that's what keeps it alive). */
async function readBody(res: Response, tick: (n: number) => void, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    tick(all.length);
    return all;
  }
  const told = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  // Size known (the usual case): fill one buffer, no copy at the end.
  let out: Uint8Array<ArrayBuffer> | null = told > 0 ? new Uint8Array(told) : null;
  const parts: Uint8Array[] = [];
  let len = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tick(value.length);
    await limiter.take(value.length, signal);
    if (out && len + value.length <= out.length) out.set(value, len);
    else {
      // More than announced (or nothing announced): collect the pieces instead.
      if (out) parts.push(out.subarray(0, len));
      out = null;
      parts.push(value);
    }
    len += value.length;
  }
  if (out) return len === out.length ? out : out.slice(0, len);
  const all = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

export async function fetchSegment(
  seg: SegRef,
  opts: FetchOptions & { onChunk?: (n: number) => void },
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
    // A range answered with the whole file: fine for a small one (sliced below), not for a
    // big file, which would be loaded entirely for one piece.
    const told = Number(res.headers.get('content-length')) || 0;
    if (seg.range && res.status === 200 && told > 64 * 2 ** 20) {
      void res.body?.cancel().catch(() => {});
      throw new HttpError(416);
    }
    // The deadline is for silence, not for the whole transfer: a big file (a whole video in
    // one piece) may take many minutes and that's fine as long as data keeps coming.
    buf = await readBody(
      res,
      (n) => {
        dl.arm();
        opts.onChunk?.(n);
      },
      dl.signal,
    );
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

/**
 * Reads a whole resource from a server that can't send ranges, handing the data over as it
 * comes (awaited: the caller stores it). Large files can take hours: it only times out when
 * no data arrives for a while.
 */
export async function streamFile(
  url: string,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; onData: (data: Uint8Array<ArrayBuffer>, received: number, total: number) => void | Promise<void> },
): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  const dl = deadline(opts.signal, STREAM_IDLE_MS);
  try {
    const res = await f(url, { credentials: 'include', signal: dl.signal });
    if (!res.ok) throw new HttpError(res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body) {
      const all = new Uint8Array(await res.arrayBuffer());
      return void (await opts.onData(all, all.length, total));
    }
    const reader = res.body.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      dl.arm();
      await limiter.take(value.length, dl.signal);
      dl.arm();
      received += value.length;
      await opts.onData(value as Uint8Array<ArrayBuffer>, received, total);
    }
  } catch (e) {
    throw dl.signal.aborted && !opts.signal?.aborted ? dl.signal.reason : e;
  } finally {
    dl.done();
  }
}

/** The server asks to slow down: fewer connections, longer waits, a few more tries. */
const THROTTLE = new Set([429, 503]);

export interface PoolOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** How many pieces at once (adjusted as it goes). */
  pacer?: Pacer;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  /** One call per piece, in whatever order they finish; awaited before its slot is reused. */
  onPart: (index: number, data: Uint8Array<ArrayBuffer>) => void | Promise<void>;
  /** Bytes as they arrive; negative when a failed attempt's bytes are taken back. */
  onBytes?: (n: number) => void;
}

async function fetchPiece(seg: SegRef, o: PoolOptions, pacer: Pacer, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const retries = o.retries ?? 4;
  const delay = o.retryDelayMs ?? 500;
  for (let attempt = 0; ; attempt++) {
    let got = 0;
    try {
      return await fetchSegment(seg, {
        signal,
        ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
        ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
        onChunk: (n) => {
          got += n;
          o.onBytes?.(n);
          pacer.record(n);
        },
      });
    } catch (e) {
      // What this attempt received is thrown away: so is its count.
      if (got) o.onBytes?.(-got);
      if (signal.aborted) throw e;
      if (e instanceof HttpError && FATAL.has(e.status)) throw e;
      const busy = e instanceof HttpError && THROTTLE.has(e.status);
      if (busy) pacer.throttled();
      if (attempt >= retries + (busy ? 3 : 0)) throw e;
      await sleep(delay * 2 ** attempt * (busy ? 2 : 1), signal);
    }
  }
}

/**
 * Fetches the pieces listed in `todo` (indexes into `refs`), as many at once as the pacer
 * allows, handing each one over as soon as it is complete. The first failure stops the
 * others and is thrown.
 */
export function fetchAll(refs: SegRef[], todo: number[], o: PoolOptions): Promise<void> {
  const pacer = o.pacer ?? new Pacer();
  const queue = [...todo];
  const inner = new AbortController();
  const stop = () => inner.abort(o.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
  if (o.signal?.aborted) stop();
  else o.signal?.addEventListener('abort', stop, { once: true });
  let active = 0;
  let failed = false;
  return new Promise<void>((resolve, reject) => {
    const finish = (e?: unknown) => {
      if (failed) return;
      if (e !== undefined) {
        failed = true;
        inner.abort(e);
        o.signal?.removeEventListener('abort', stop);
        return reject(e);
      }
      if (!queue.length && !active) {
        o.signal?.removeEventListener('abort', stop);
        resolve();
      }
    };
    const launch = () => {
      if (failed) return;
      if (inner.signal.aborted) return finish(inner.signal.reason);
      while (active < pacer.limit && queue.length) {
        const i = queue.shift()!;
        active++;
        fetchPiece(refs[i]!, o, pacer, inner.signal)
          .then((data) => o.onPart(i, data))
          .then(
            () => {
              active--;
              launch();
              finish();
            },
            (e) => {
              active--;
              finish(e);
            },
          );
      }
      finish();
    };
    launch();
  });
}

/**
 * Asks for the first byte only: a server that answers 206 with the full size can be
 * fetched in several ranges at once. Null when it can't (or won't say).
 */
export async function rangeSupport(url: string, o: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<{ size: number } | null> {
  const f = o.fetchImpl ?? fetch;
  const dl = deadline(o.signal, 20_000);
  try {
    const res = await f(url, { credentials: 'include', headers: { Range: 'bytes=0-0' }, signal: dl.signal });
    void res.body?.cancel().catch(() => {});
    if (res.status !== 206) {
      if (res.ok || res.status === 416) return null;
      throw new HttpError(res.status);
    }
    const total = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
    return total ? { size: Number(total[1]) } : null;
  } catch (e) {
    throw dl.signal.aborted && !o.signal?.aborted ? dl.signal.reason : e;
  } finally {
    dl.done();
  }
}

/**
 * Splits a file of `size` bytes into ranges: big enough to be efficient, small enough that a
 * pause or a cut (which drops the pieces in flight) loses little.
 */
export function rangesOf(url: string, size: number): SegRef[] {
  const chunk = size > 1024 * 2 ** 20 ? 4 * 2 ** 20 : size > 64 * 2 ** 20 ? 2 * 2 ** 20 : 2 ** 20;
  const out: SegRef[] = [];
  for (let start = 0; start < size; start += chunk) out.push({ url, range: [start, Math.min(size, start + chunk) - 1] });
  return out;
}
