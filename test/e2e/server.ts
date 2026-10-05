import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../fixtures');

/**
 * A big video for speed and resume tests: the sample clip followed by `mb` megabytes of
 * bytes that differ everywhere (a piece put in the wrong place would show).
 */
const bigCache = new Map<number, Buffer>();
export async function bigFile(mb: number): Promise<Buffer> {
  const hit = bigCache.get(mb);
  if (hit) return hit;
  const head = await readFile(join(ROOT, 'media/sample.mp4'));
  const tail = Buffer.alloc(Math.round(mb * 2 ** 20));
  let x = 2463534242;
  for (let i = 0; i < tail.length; i += 4) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    tail.writeUInt32LE(x >>> 0, i);
  }
  const out = Buffer.concat([head, tail]);
  bigCache.set(mb, out);
  return out;
}

/** Bytes sent per big file (to tell a resume from a restart), and the simulated outage. */
export const bigStats = { sent: new Map<string, number>(), requests: new Map<string, number>(), open: new Map<string, number>(), peak: new Map<string, number>() };
let outageUntil = 0;
/** Every connection to a big file is cut, and new ones refused, for `ms`. */
export function cutNetwork(ms: number): void {
  outageUntil = Date.now() + ms;
}
const live = new Set<import('node:http').ServerResponse>();

/** Sends `body` (a slice of a big file) at `rate` bytes per second, in small chunks. */
function trickle(res: import('node:http').ServerResponse, body: Buffer, rate: number, key: string) {
  live.add(res);
  const open = (bigStats.open.get(key) ?? 0) + 1;
  bigStats.open.set(key, open);
  bigStats.peak.set(key, Math.max(bigStats.peak.get(key) ?? 0, open));
  res.on('close', () => bigStats.open.set(key, (bigStats.open.get(key) ?? 1) - 1));
  let at = 0;
  const step = Math.max(16 * 1024, Math.round(rate / 20));
  const tick = () => {
    if (res.destroyed) return void live.delete(res);
    if (Date.now() < outageUntil) {
      live.delete(res);
      return void res.destroy();
    }
    const chunk = body.subarray(at, at + step);
    at += chunk.length;
    bigStats.sent.set(key, (bigStats.sent.get(key) ?? 0) + chunk.length);
    if (at >= body.length) {
      live.delete(res);
      return void res.end(chunk);
    }
    res.write(chunk);
    setTimeout(tick, (chunk.length / rate) * 1000);
  };
  tick();
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4s': 'video/iso.segment',
  '.ts': 'video/mp2t',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mpd': 'application/dash+xml',
  '.bin': 'application/octet-stream',
  '.js': 'text/javascript',
};

/**
 * Static fixture server.
 * - `/media/protected-referer/*` requires a Referer from this origin (403 otherwise).
 * - `?range=a-b` returns that inclusive byte slice (simulates range-param CDNs used by MSE players).
 * - `/opaque/clip` serves sample.mp4 with no extension and a generic type, like many small sites.
 */
export function startServer(port = 0): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const opaque = url.pathname === '/opaque/clip';
      const path = opaque ? join(ROOT, 'media/sample.mp4') : normalize(join(ROOT, decodeURIComponent(url.pathname)));
      if (!path.startsWith(ROOT)) {
        res.writeHead(400).end();
        return;
      }
      const origin = `http://${req.headers.host}`;
      // /big/<name>.mp4?mb=24&rate=1500000: a big file sent slowly, per connection.
      if (url.pathname.startsWith('/big/')) {
        if (Date.now() < outageUntil) return void req.socket.destroy();
        const full = await bigFile(Number(url.searchParams.get('mb') ?? 24));
        // The page's own player is served at once: only Grabby's downloads are slowed (and
        // counted), or the player would hold the few connections a host gets.
        const player = req.headers['sec-fetch-dest'] === 'video';
        const rate = player ? 200 * 2 ** 20 : Number(url.searchParams.get('rate') ?? 1_500_000);
        const key = player ? `player:${url.pathname}` : url.pathname;
        bigStats.requests.set(key, (bigStats.requests.get(key) ?? 0) + 1);
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
        if (m) {
          const start = Number(m[1]);
          const end = Math.min(m[2] ? Number(m[2]) : full.length - 1, full.length - 1);
          res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${full.length}`, 'Accept-Ranges': 'bytes' });
          return trickle(res, full.subarray(start, end + 1), rate, key);
        }
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': full.length, 'Accept-Ranges': 'bytes' });
        return trickle(res, full, rate, key);
      }
      if (url.pathname.startsWith('/media/protected-referer/') && !(req.headers.referer ?? '').startsWith(origin)) {
        res.writeHead(403).end('referer required');
        return;
      }
      const s = await stat(path).catch(() => null);
      if (!s || !s.isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      let body = await readFile(path);
      const type = opaque ? 'application/octet-stream' : (TYPES[extname(path)] ?? 'application/octet-stream');
      const range = url.searchParams.get('range');
      if (range) {
        const [a, b] = range.split('-').map(Number);
        body = body.subarray(a, Math.min((b ?? body.length - 1) + 1, body.length));
      }
      const header = req.headers.range;
      if (header && !range) {
        const m = /bytes=(\d+)-(\d*)/.exec(header);
        if (m) {
          const start = Number(m[1]);
          const end = Math.min(m[2] ? Number(m[2]) : body.length - 1, body.length - 1);
          res.writeHead(206, {
            'Content-Type': type,
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${body.length}`,
            'Accept-Ranges': 'bytes',
          });
          res.end(body.subarray(start, end + 1));
          return;
        }
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Accept-Ranges': 'bytes' });
      res.end(body);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((ok) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      ok({ server, origin: `http://127.0.0.1:${p}` });
    });
  });
}

// Allow `node --experimental-strip-types test/e2e/server.ts` for manual testing.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer(Number(process.env.PORT ?? 8765)).then(({ origin }) => console.log(`fixtures on ${origin}`));
}
