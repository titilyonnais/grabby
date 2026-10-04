import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../fixtures');

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
 */
export function startServer(port = 0): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
      if (!path.startsWith(ROOT)) {
        res.writeHead(400).end();
        return;
      }
      const origin = `http://${req.headers.host}`;
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
      const type = TYPES[extname(path)] ?? 'application/octet-stream';
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
