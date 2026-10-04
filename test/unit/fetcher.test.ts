import { describe, expect, it, vi } from 'vitest';
import { fetchInOrder, HttpError } from '../../src/offscreen/fetcher';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(handler) as unknown as typeof fetch;
}

describe('fetchInOrder', () => {
  it('delivers segments in order despite random latency, respecting concurrency', async () => {
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
    const got: string[] = [];
    let bytes = 0;
    await fetchInOrder(segs, {
      concurrency: 4,
      fetchImpl: f,
      onData: async (_i, d) => {
        got.push(dec(d));
      },
      onBytes: (n) => (bytes += n),
    });
    expect(got).toEqual(segs.map((s) => s.url.slice(-2)));
    expect(peak).toBeLessThanOrEqual(4);
    expect(bytes).toBe(40);
  });

  it('finishes when the first segment is slow and every other worker is waiting', async () => {
    const f = fakeFetch(async (url) => {
      if (url.endsWith('/0')) await sleep(40);
      return new Response(enc('x'));
    });
    const segs = Array.from({ length: 60 }, (_, i) => ({ url: `https://x/${i}` }));
    let n = 0;
    const done = fetchInOrder(segs, { concurrency: 6, fetchImpl: f, onData: () => void n++ });
    const timeout = new Promise((_, ko) => setTimeout(() => ko(new Error('hung')), 2000));
    await Promise.race([done, timeout]);
    expect(n).toBe(60);
  });

  it('retries transient failures', async () => {
    let calls = 0;
    const f = fakeFetch(async () => {
      calls++;
      if (calls < 3) throw new TypeError('network');
      return new Response(enc('ok'));
    });
    const got: string[] = [];
    await fetchInOrder([{ url: 'https://x/a' }], { fetchImpl: f, retryDelayMs: 1, onData: (_i, d) => void got.push(dec(d)) });
    expect(got).toEqual(['ok']);
    expect(calls).toBe(3);
  });

  it('fails fast on 404 with an HttpError', async () => {
    const f = fakeFetch(async () => new Response('nope', { status: 404 }));
    await expect(fetchInOrder([{ url: 'https://x/a' }], { fetchImpl: f, retryDelayMs: 1, onData: () => {} })).rejects.toMatchObject({
      status: 404,
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(new HttpError(403)).toBeInstanceOf(Error);
  });

  it('sends Range headers and slices when the server ignores them', async () => {
    const seen: (string | null)[] = [];
    const f = fakeFetch(async (_u, init) => {
      seen.push(new Headers(init?.headers).get('range'));
      return new Response(enc('0123456789'), { status: 200 });
    });
    const got: string[] = [];
    await fetchInOrder([{ url: 'https://x/f', range: [2, 4] }], { fetchImpl: f, onData: (_i, d) => void got.push(dec(d)) });
    expect(seen).toEqual(['bytes=2-4']);
    expect(got).toEqual(['234']);
  });

  it('gives up on a server that never answers, as a network error', async () => {
    const f = fakeFetch(
      (_u, init) =>
        new Promise((_ok, ko) => init?.signal?.addEventListener('abort', () => ko(init.signal!.reason))),
    );
    const p = fetchInOrder([{ url: 'https://x/a' }], { fetchImpl: f, retries: 1, retryDelayMs: 1, timeoutMs: 20, onData: () => {} });
    await expect(p).rejects.toBeInstanceOf(TypeError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('aborts', async () => {
    const ctl = new AbortController();
    const f = fakeFetch(async (_u, init) => {
      await sleep(20);
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response(enc('x'));
    });
    const p = fetchInOrder(
      Array.from({ length: 10 }, (_, i) => ({ url: `https://x/${i}` })),
      { fetchImpl: f, signal: ctl.signal, onData: () => {} },
    );
    setTimeout(() => ctl.abort(), 5);
    await expect(p).rejects.toThrow();
  });
});
