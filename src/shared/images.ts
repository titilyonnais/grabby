/** « Toutes les images »: the pictures of a page, listed, chosen and saved in one .zip. */

export interface PageImage {
  url: string;
  /** Its real size, when the page has loaded it (0 when unknown). */
  w: number;
  h: number;
  alt?: string;
}

/** The biggest picture a `srcset` offers ("a.jpg 480w, b.jpg 1080w" → b.jpg). */
export function largestFromSrcset(srcset: string, base: string): string | undefined {
  let best: { url: string; score: number } | undefined;
  // Candidates are split on commas followed by space (a URL may hold commas).
  for (const part of srcset.split(/,\s+/)) {
    const [raw, desc = '1x'] = part.trim().split(/\s+/);
    if (!raw) continue;
    const n = parseFloat(desc);
    const score = /w$/i.test(desc) ? n : /x$/i.test(desc) ? n * 1000 : 0;
    let url: string;
    try {
      url = new URL(raw, base).href;
    } catch {
      continue;
    }
    if (!best || score > best.score) best = { url, score };
  }
  return best?.url;
}

/** The ones worth listing: real addresses, once each, not the tiny ones (icons, spacers). */
export function keepImages(list: PageImage[], min = 32, max = 600): PageImage[] {
  const seen = new Map<string, PageImage>();
  for (const i of list) {
    if (!/^(https?:|data:image\/(png|jpe?g|gif|webp|avif))/i.test(i.url)) continue;
    if (i.url.length > 2_000_000) continue;
    if ((i.w && i.w < min) || (i.h && i.h < min)) continue;
    const had = seen.get(i.url);
    if (!had || i.w * i.h > had.w * had.h) seen.set(i.url, i);
  }
  return [...seen.values()].slice(0, max);
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
};

/** "photo-de-plage.jpg", or "image-12.png": a name for each file in the .zip, never twice the same. */
export function imageNames(items: { url: string; type?: string }[]): string[] {
  const used = new Set<string>();
  return items.map((it, i) => {
    let stem = '';
    let ext = EXT[it.type ?? ''] ?? '';
    if (!it.url.startsWith('data:')) {
      try {
        const last = decodeURIComponent(new URL(it.url).pathname.split('/').pop() ?? '');
        const m = /^(.*?)(?:\.([a-z0-9]{2,5}))?$/i.exec(last);
        stem = m?.[1] ?? '';
        if (!ext && m?.[2]) ext = m[2].toLowerCase().replace('jpeg', 'jpg');
      } catch {
        // Not a readable address: numbered below.
      }
    }
    stem =
      stem
        .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || `image-${i + 1}`;
    ext ||= 'jpg';
    let name = `${stem}.${ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem} (${n}).${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/* ---------------------------------------------------------------- .zip */

let table: Uint32Array | undefined;
export function crc32(b: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date, as a .zip keeps them. */
function dosTime(d: Date): [number, number] {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

/**
 * A .zip of files as they are ("stored": pictures are already compressed, squeezing them
 * again gains nothing). Names are written in UTF-8.
 */
export function zipStore(files: { name: string; data: Uint8Array }[], when = new Date()): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const [time, date] = dosTime(when);
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // UTF-8 names
    head.setUint16(8, 0, true); // stored
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, f.data.length, true);
    head.setUint32(22, f.data.length, true);
    head.setUint16(26, name.length, true);
    local.push(new Uint8Array(head.buffer), name, f.data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, f.data.length, true);
    dir.setUint32(24, f.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
