// Renders the Grabby icon (coral tile + white "grab" arrow) to PNG without dependencies.
// Usage: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const CORAL = [0xff, 0x5b, 0x4f];
const WHITE = [0xff, 0xff, 0xff];

// Arrow drawn in a 24-unit box, same as the popup logo icon.
const SEGMENTS = [
  [12, 4.6, 12, 13.6],
  [12, 13.6, 7.9, 9.5],
  [12, 13.6, 16.1, 9.5],
  [6.6, 18.6, 17.4, 18.6],
];

function distToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function insideRoundedRect(x, y, size, pad, radius) {
  const min = pad;
  const max = size - pad;
  if (x < min || y < min || x > max || y > max) return false;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function render(size) {
  const pad = size >= 48 ? size / 16 : 0;
  const radius = (size - 2 * pad) * 0.28;
  // Thicker strokes at tiny sizes keep the arrow legible.
  const stroke = size <= 16 ? 3.1 : size <= 32 ? 2.7 : 2.3;
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tile = 0;
      let mark = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = x + (sx + 0.5) / ss;
          const fy = y + (sy + 0.5) / ss;
          if (!insideRoundedRect(fx, fy, size, pad, radius)) continue;
          tile++;
          const u = ((fx - pad) / (size - 2 * pad)) * 24;
          const v = ((fy - pad) / (size - 2 * pad)) * 24;
          if (SEGMENTS.some((s) => distToSegment(u, v, s) <= stroke / 2)) mark++;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      const a = tile / n;
      const m = tile ? mark / tile : 0;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(CORAL[c] * (1 - m) + WHITE[c] * m);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, px);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128, 256]) {
  writeFileSync(resolve(out, `icon-${size}.png`), render(size));
}
console.log('✓ icons written to public/icons');
