import { normalizeMediaUrl } from '../parsers/url';
import { sniffMedia, type Sniffed } from '../parsers/sniff';
import { withPageHeaders } from './headers';

const PROBE_BYTES = 256 * 1024;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; p: Promise<Sniffed | null | undefined> }>();

/**
 * Reads the first bytes of a detected file (with the page's headers) to learn what it
 * really is. Resolves to `null` when the server answers with something that isn't media
 * (error page, expired link), `undefined` when it can't tell (network error, refusal).
 */
export function probeFile(url: string, pageUrl: string, fetchImpl: typeof fetch = fetch): Promise<Sniffed | null | undefined> {
  const key = normalizeMediaUrl(url);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.p;
  const p = readHead(url, pageUrl, fetchImpl).catch(() => undefined);
  cache.set(key, { at: now, p });
  if (cache.size > 300) for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k);
  return p;
}

async function readHead(url: string, pageUrl: string, fetchImpl: typeof fetch): Promise<Sniffed | null | undefined> {
  const release = await withPageHeaders(pageUrl, [url]);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetchImpl(url, { credentials: 'include', headers: { Range: `bytes=0-${PROBE_BYTES - 1}` }, signal: ctl.signal });
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok || !res.body) return undefined;
    const reader = res.body.getReader();
    const head = new Uint8Array(PROBE_BYTES);
    let got = 0;
    while (got < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const n = Math.min(value.length, PROBE_BYTES - got);
      head.set(value.subarray(0, n), got);
      got += n;
    }
    void reader.cancel().catch(() => {});
    return sniffMedia(head.subarray(0, got));
  } finally {
    clearTimeout(timer);
    ctl.abort();
    await release();
  }
}
