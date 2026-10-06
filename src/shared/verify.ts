/**
 * « Fichiers vérifiés »: a file is read again once made, to catch one cut short or damaged.
 * Only its structure is read (no decoding): the boxes of an MP4 add up to its size and hold
 * a duration, a Matroska file starts as one, an Ogg file ends on a whole page…
 */
export interface Checked {
  ok: boolean;
  /** Why it isn't (for the report). */
  reason?: string;
  /** Seconds, when the file says it (MP4 family). */
  duration?: number;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);

/** The top-level boxes of an MP4: their types, or why they don't fit together. */
export function mp4Boxes(b: Uint8Array): { boxes: { type: string; at: number; size: number }[]; error?: string } {
  const boxes: { type: string; at: number; size: number }[] = [];
  let at = 0;
  while (at < b.length) {
    // A few bytes after the last box: some servers pad files.
    if (b.length - at < 8) return { boxes, ...(boxes.length ? {} : { error: 'trailing bytes' }) };
    let size = u32(b, at);
    const type = ascii(b, at + 4, 4);
    // Not a box: junk after whole boxes is let be, a file that starts so isn't an MP4.
    if (!/^[\x20-\x7e]{4}$/.test(type)) return { boxes, ...(boxes.length ? {} : { error: `bad box at ${at}` }) };
    if (size === 1) {
      if (b.length - at < 16) return { boxes, error: 'cut box' };
      size = u64(b, at + 8);
    } else if (size === 0) size = b.length - at;
    if (size < 8) return { boxes, ...(boxes.length ? {} : { error: `bad size at ${at}` }) };
    if (at + size > b.length) return { boxes, error: `${type} cut short` };
    boxes.push({ type, at, size });
    at += size;
  }
  return { boxes };
}

/** The movie's duration from its "mvhd" box (inside "moov"). */
function mvhdDuration(b: Uint8Array, moov: { at: number; size: number }): number | undefined {
  let at = moov.at + 8;
  const end = moov.at + moov.size;
  while (at + 8 <= end) {
    const size = u32(b, at);
    if (size < 8) return undefined;
    if (ascii(b, at + 4, 4) === 'mvhd') {
      const version = b[at + 8];
      const scale = version === 1 ? u32(b, at + 28) : u32(b, at + 20);
      const length = version === 1 ? u64(b, at + 32) : u32(b, at + 24);
      return scale ? length / scale : undefined;
    }
    at += size;
  }
  return undefined;
}

function find(b: Uint8Array, text: string, from: number): number {
  const first = text.charCodeAt(0);
  for (let i = Math.max(0, from); i <= b.length - text.length; i++) {
    if (b[i] === first && ascii(b, i, text.length) === text) return i;
  }
  return -1;
}

/** The last place `text` is, at or after `from`. */
function findLast(b: Uint8Array, text: string, from: number): number {
  const first = text.charCodeAt(0);
  for (let i = b.length - text.length; i >= Math.max(0, from); i--) {
    if (b[i] === first && ascii(b, i, text.length) === text) return i;
  }
  return -1;
}

const bad = (reason: string): Checked => ({ ok: false, reason });

export function checkFile(b: Uint8Array, ext: string): Checked {
  if (b.length < 16) return bad('empty');
  switch (ext) {
    case 'mp4':
    case 'm4a':
    case 'mov': {
      const { boxes, error } = mp4Boxes(b);
      if (error) return bad(error);
      // Old QuickTime files start with "wide", "free" or "mdat" instead.
      if (!boxes.some((x) => x.type === 'ftyp') && ext !== 'mov' && !['free', 'wide', 'skip', 'mdat', 'moov'].includes(boxes[0]?.type ?? '')) return bad('no ftyp');
      const moov = boxes.find((x) => x.type === 'moov');
      if (!moov) return bad('no moov');
      if (!boxes.some((x) => x.type === 'mdat' || x.type === 'moof')) return bad('no media');
      const duration = mvhdDuration(b, moov);
      const fragmented = boxes.some((x) => x.type === 'moof');
      if (!fragmented && !(duration && duration > 0)) return bad('no duration');
      return { ok: true, ...(duration ? { duration } : {}) };
    }
    case 'mkv':
    case 'webm':
      if (u32(b, 0) !== 0x1a45dfa3) return bad('no EBML header');
      // The Segment follows the header.
      for (let i = 4; i < Math.min(b.length - 4, 128); i++) if (u32(b, i) === 0x18538067) return { ok: true };
      return bad('no segment');
    case 'mp3':
      return ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) ? { ok: true } : bad('no MP3 header');
    case 'ogg':
    case 'opus': {
      if (ascii(b, 0, 4) !== 'OggS') return bad('no Ogg page');
      // The last page is whole: the end of the file is where its last page ends.
      const last = findLast(b, 'OggS', b.length - 70_000);
      if (last < 0) return bad('no last page');
      const segments = b[last + 26] ?? 0;
      const table = b.subarray(last + 27, last + 27 + segments);
      const body = table.reduce((n, x) => n + x, 0);
      return last + 27 + segments + body === b.length ? { ok: true } : bad('last page cut short');
    }
    case 'flac':
      return ascii(b, 0, 4) === 'fLaC' ? { ok: true } : bad('no FLAC header');
    case 'wav':
      return ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE' ? { ok: true } : bad('no WAVE header');
    case 'jpg':
      return b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9 ? { ok: true } : bad('JPEG cut short');
    case 'png':
      return ascii(b, 1, 3) === 'PNG' && find(b, 'IEND', b.length - 12) >= 0 ? { ok: true } : bad('PNG cut short');
    case 'gif':
      return ascii(b, 0, 3) === 'GIF' && b[b.length - 1] === 0x3b ? { ok: true } : bad('GIF cut short');
    case 'webp':
      return ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' && u32le(b, 4) + 8 === b.length ? { ok: true } : bad('WebP cut short');
    default:
      // A container this check doesn't read (AVI, TS…): its first bytes only.
      return { ok: true };
  }
}

const u32le = (b: Uint8Array, at: number) => b[at]! + (b[at + 1]! << 8) + (b[at + 2]! << 16) + b[at + 3]! * 2 ** 24;

/** A file the browser downloaded itself: whole when it is as big as announced. */
export function sizeMatches(got: number, expected?: number): boolean {
  if (!expected || expected <= 0) return true;
  return Math.abs(got - expected) <= Math.max(1024, expected * 0.002);
}
