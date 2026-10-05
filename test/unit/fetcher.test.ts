import { describe, expect, it, vi } from 'vitest';
import { fetchAll, HttpError, rangeSupport, rangesOf, streamFile } from '../../src/offscreen/fetcher';
import { Pacer } from '../../src/offscreen/pacer';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(handler) as unknown as typeof fetch;
}

const all = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('fetchAll', () => {
  it('fetches every piece once, never more at a time than the pacer allows', async () => {
    let inflight = 0;
    let peak = 0;
    const f = fakeFetch(async (url) => {
      inflight++;
      peak = Math.max(peak, inflight);
      await sleep(Math.random() * 15);
      inflight--;
      return new Response(enc(url.slice(-2)));
    });
    const segs = Array.from({ length: 20 }, (_, i) => ({ url: `https://x/${String(i).padStart(2, '0')}` }));
    const got = new Map<number, string>();
    let bytes = 0;
    await fetchAll(segs, all(20), {
      pacer: new Pacer({ start: 4, max: 4 }),
      fetchImpl: f,
      onPart: (i, d) => void got.set(i, dec(d)),
      onBytes: (n) => (bytes += n),
    });
    expect([...got.keys()].sort((a, b) => a - b)).toEqual(all(20));
    expect(got.get(7)).toBe('07');
    expect(peak).toBeLessThanOrEqual(4);
    expect(bytes).toBe(40);
  });

  it('only fetches the pieces still missing (a resumed download)', async () => {
    const f = fakeFetch(async (url) => new Response(enc(url.slice(-1))));
    const segs = Array.from({ length: 6 }, (_, i) => ({ url: `https://x/${i}` }));
    const got: number[] = [];
    await fetchAll(segs, [1, 4, 5], { fetchImpl: f, onPart: (i) => void got.push(i) });
    expect(got.sort()).toEqual([1, 4, 5]);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('a slow piece holds nobody up: the others carry on', async () => {
    const f = fakeFetch(async (url) => {
      if (url.endsWith('/0')) await sleep(60);
      return new Response(enc('x'));
    });
    const segs = Array.from({ length: 60 }, (_, i) => ({ url: `https://x/${i}` }));
    const order: number[] = [];
    await fetchAll(segs, all(60), { pacer: new Pacer({ start: 6 }), fetchImpl: f, onPart: (i) => void order.push(i) });
    expect(order).toHaveLength(60);
    expect(order.indexOf(0)).toBeGreaterThan(30);
  });

  it('retries transient failures, and takes back the bytes of a failed attempt', async () => {
    let calls = 0;
    const f = fakeFetch(async () => {
      calls++;
      if (calls === 1) {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc('half'));
            c.error(new TypeError('reset'));
          },
        });
        return new Response(body);
      }
      if (calls === 2) throw new TypeError('network');
      return new Response(enc('ok'));
    });
    const got: string[] = [];
    let bytes = 0;
    await fetchAll([{ url: 'https://x/a' }], [0], { fetchImpl: f, retryDelayMs: 1, onBytes: (n) => (bytes += n), onPart: (_i, d) => void got.push(dec(d)) });
    expect(got).toEqual(['ok']);
    expect(calls).toBe(3);
    expect(bytes).toBe(2);
  });

  it('fails fast on 404 with an HttpError', async () => {
    const f = fakeFetch(async () => new Response('nope', { status: 404 }));
    await expect(fetchAll([{ url: 'https://x/a' }], [0], { fetchImpl: f, retryDelayMs: 1, onPart: () => {} })).rejects.toMatchObject({ status: 404 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(new HttpError(403)).toBeInstanceOf(Error);
  });

  it('slows down when the server says it is overloaded (429), then gets through', async () => {
    let calls = 0;
    const f = fakeFetch(async () => (++calls <= 2 ? new Response('busy', { status: 429 }) : new Response(enc('ok'))));
    const pacer = new Pacer({ start: 8 });
    await fetchAll([{ url: 'https://x/a' }], [0], { fetchImpl: f, pacer, retryDelayMs: 1, onPart: () => {} });
    expect(pacer.limit).toBe(2);
  });

  it('sends Range headers and slices when the server ignores them', async () => {
    const seen: (string | null)[] = [];
    const f = fakeFetch(async (_u, init) => {
      seen.push(new Headers(init?.headers).get('range'));
      return new Response(enc('0123456789'), { status: 200 });
    });
    const got: string[] = [];
    await fetchAll([{ url: 'https://x/f', range: [2, 4] }], [0], { fetchImpl: f, onPart: (_i, d) => void got.push(dec(d)) });
    expect(seen).toEqual(['bytes=2-4']);
    expect(got).toEqual(['234']);
  });

  it('refuses to load a whole big file for one range', async () => {
    const f = fakeFetch(async () => new Response(new ReadableStream(), { status: 200, headers: { 'content-length': String(2e9) } }));
    await expect(fetchAll([{ url: 'https://x/f', range: [0, 99] }], [0], { fetchImpl: f, retries: 0, onPart: () => {} })).rejects.toMatchObject({ status: 416 });
  });

  it('gives up on a server that never answers, as a network error', async () => {
    const f = fakeFetch((_u, init) => new Promise((_ok, ko) => init?.signal?.addEventListener('abort', () => ko(init.signal!.reason))));
    const p = fetchAll([{ url: 'https://x/a' }], [0], { fetchImpl: f, retries: 1, retryDelayMs: 1, timeoutMs: 20, onPart: () => {} });
    await expect(p).rejects.toBeInstanceOf(TypeError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('keeps a slow but steady transfer going past the deadline, counting bytes as they come', async () => {
    // 6 chunks, 15 ms apart: 90 ms in all, with a 40 ms silence deadline.
    const f = fakeFetch(async () => {
      let n = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(c) {
          await sleep(15);
          if (n++ < 6) c.enqueue(enc(String(n)));
          else c.close();
        },
      });
      return new Response(body, { headers: { 'content-length': '6' } });
    });
    const got: string[] = [];
    const counted: number[] = [];
    await fetchAll([{ url: 'https://x/big' }], [0], {
      fetchImpl: f,
      retries: 0,
      timeoutMs: 40,
      onBytes: (b) => void counted.push(b),
      onPart: (_i, d) => void got.push(dec(d)),
    });
    expect(got).toEqual(['123456']);
    expect(counted).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('gives up on a transfer that goes silent halfway', async () => {
    const f = fakeFetch(async (_u, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc('a'));
          init?.signal?.addEventListener('abort', () => c.error(init.signal!.reason));
        },
      });
      return new Response(body);
    });
    const p = fetchAll([{ url: 'https://x/a' }], [0], { fetchImpl: f, retries: 0, timeoutMs: 20, onPart: () => {} });
    await expect(p).rejects.toBeInstanceOf(TypeError);
  });

  it('stops everything on abort (a pause)', async () => {
    const ctl = new AbortController();
    let started = 0;
    const f = fakeFetch(async (_u, init) => {
      started++;
      await sleep(20);
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response(enc('x'));
    });
    const p = fetchAll(
      Array.from({ length: 40 }, (_, i) => ({ url: `https://x/${i}` })),
      all(40),
      { fetchImpl: f, signal: ctl.signal, pacer: new Pacer({ start: 4, max: 4 }), onPart: () => {} },
    );
    setTimeout(() => ctl.abort(new DOMException('Paused', 'AbortError')), 5);
    await expect(p).rejects.toThrow();
    await sleep(40);
    expect(started).toBe(4);
  });
});

describe('ranges', () => {
  it('a server that answers a one-byte range with 206 gives its full size', async () => {
    const f = fakeFetch(async (_u, init) => {
      expect(new Headers(init?.headers).get('range')).toBe('bytes=0-0');
      return new Response(enc('x'), { status: 206, headers: { 'content-range': 'bytes 0-0/123456789' } });
    });
    expect(await rangeSupport('https://x/v.mp4', { fetchImpl: f })).toEqual({ size: 123456789 });
  });

  it('a server that sends the whole file instead can not do ranges', async () => {
    const f = fakeFetch(async () => new Response(enc('whole'), { status: 200 }));
    expect(await rangeSupport('https://x/v.mp4', { fetchImpl: f })).toBeNull();
  });

  it('a refusal is an error, not "no ranges"', async () => {
    const f = fakeFetch(async () => new Response('', { status: 403 }));
    await expect(rangeSupport('https://x/v.mp4', { fetchImpl: f })).rejects.toMatchObject({ status: 403 });
  });

  it('splits a file into consecutive ranges covering every byte once', () => {
    for (const size of [1, 5_000_000, 100 * 2 ** 20 + 7, 3 * 2 ** 30]) {
      const r = rangesOf('https://x/v', size);
      expect(r[0]!.range![0]).toBe(0);
      expect(r[r.length - 1]!.range![1]).toBe(size - 1);
      for (let i = 1; i < r.length; i++) expect(r[i]!.range![0]).toBe(r[i - 1]!.range![1] + 1);
    }
    // Bigger files, bigger pieces: never thousands of requests.
    expect(rangesOf('https://x/v', 3 * 2 ** 30).length).toBeLessThanOrEqual(800);
  });

  it('reads a server without ranges from start to end, as it comes', async () => {
    const f = fakeFetch(async () => new Response(enc('abcdef'), { headers: { 'content-length': '6' } }));
    const seen: [string, number, number][] = [];
    await streamFile('https://x/v', { fetchImpl: f, onData: (d, got, total) => void seen.push([dec(d), got, total]) });
    expect(seen.map((s) => s[0]).join('')).toBe('abcdef');
    expect(seen[seen.length - 1]!.slice(1)).toEqual([6, 6]);
  });
});

describe('Pacer', () => {
  it('adds connections while it gets faster, within its limits', () => {
    let t = 0;
    const p = new Pacer({ start: 4, max: 10, windowMs: 1000, now: () => t });
    for (let w = 1; w <= 6; w++) {
      t += 1000;
      // Each window brings more than the one before.
      p.record(w * 1_000_000);
    }
    expect(p.limit).toBe(10);
  });

  it('stays put when more connections bring nothing more', () => {
    let t = 0;
    const p = new Pacer({ start: 6, windowMs: 1000, now: () => t });
    t += 1000;
    p.record(5_000_000);
    const after = p.limit;
    for (let w = 0; w < 5; w++) {
      t += 1000;
      p.record(5_000_000);
    }
    expect(p.limit).toBe(after);
  });

  it('halves on overload and waits before adding again', () => {
    let t = 0;
    const p = new Pacer({ start: 12, min: 2, windowMs: 1000, now: () => t });
    expect(p.throttled()).toBe(6);
    t += 1000;
    p.record(9_000_000);
    expect(p.limit).toBe(6);
    expect(p.throttled()).toBe(3);
    expect(p.throttled()).toBe(2);
  });

  it('backs off when it gets clearly slower', () => {
    let t = 0;
    const p = new Pacer({ start: 8, windowMs: 1000, now: () => t });
    t += 1000;
    p.record(10_000_000);
    const peak = p.limit;
    t += 1000;
    p.record(2_000_000);
    expect(p.limit).toBe(peak - 1);
  });
});
