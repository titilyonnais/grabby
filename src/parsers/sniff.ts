/**
 * Identifies a media file from its first bytes: is it really audio/video (and not an
 * error page), is it encrypted (DRM), and how long is it. Only container headers are
 * read, never the media payload.
 */
export type Sniffed = {
  container: 'mp4' | 'webm' | 'mp3' | 'aac' | 'ogg' | 'ts' | 'flv';
  encrypted: boolean;
  duration?: number;
  /** Picture size of the video track, when the header tells. */
  width?: number;
  height?: number;
};

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/* -------------------------------------------------------------------- MP4 */

/** Boxes whose payload is made of other boxes. */
const MP4_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts', 'dinf', 'sinf', 'schi']);
const MP4_ENCRYPTION = new Set(['encv', 'enca', 'pssh', 'tenc', 'senc', 'sinf']);
const MP4_TOP = new Set(['ftyp', 'styp', 'moov', 'moof', 'mdat', 'free', 'skip', 'wide', 'sidx', 'emsg', 'prft', 'uuid', 'pdin', 'meta']);

interface Mp4State {
  encrypted: boolean;
  /** A movie header was seen: this is a playable file, not a piece of a stream. */
  moov?: boolean;
  /** A fragment came before any movie header: a stream segment (DASH/HLS/MSE chunk). */
  segment?: boolean;
  width?: number;
  height?: number;
  timescale?: number;
  duration?: number;
  fragmentDuration?: number;
}

function readUint(b: Uint8Array, at: number, bytes: 4 | 8): number {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return bytes === 4 ? v.getUint32(at) : Number(v.getBigUint64(at));
}

function walkMp4(b: Uint8Array, start: number, end: number, st: Mp4State, depth: number): void {
  let at = start;
  while (at + 8 <= end) {
    let size = readUint(b, at, 4);
    const type = ascii(b, at + 4, 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = readUint(b, at + 8, 8);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header) return;
    const boxEnd = Math.min(end, at + size);
    const body = at + header;

    if (MP4_ENCRYPTION.has(type)) st.encrypted = true;
    if (depth === 0 && type === 'moov') st.moov = true;
    if (depth === 0 && (type === 'moof' || type === 'styp') && !st.moov) st.segment = true;
    if (type === 'mvhd' && body + 4 <= boxEnd) {
      const v1 = b[body] === 1;
      const ts = v1 ? body + 20 : body + 12;
      if (ts + (v1 ? 12 : 8) <= boxEnd) {
        st.timescale = readUint(b, ts, 4);
        st.duration = readUint(b, ts + 4, v1 ? 8 : 4);
      }
    } else if (type === 'tkhd') {
      // Track header: width and height (16.16 fixed point) close its body; 0 for sound.
      const at = body + (b[body] === 1 ? 88 : 76);
      if (at + 8 <= boxEnd) {
        const w = readUint(b, at, 4) >>> 16;
        const h = readUint(b, at + 4, 4) >>> 16;
        if (w > (st.width ?? 0)) {
          st.width = w;
          st.height = h;
        }
      }
    } else if (type === 'mehd' && body + 8 <= boxEnd) {
      st.fragmentDuration = readUint(b, body + 4, b[body] === 1 ? 8 : 4);
    } else if (type === 'stsd' && body + 8 <= boxEnd) {
      // Sample entries: an encrypted track declares 'encv' / 'enca' instead of its codec.
      walkMp4(b, body + 8, boxEnd, st, depth + 1);
    } else if (MP4_CONTAINERS.has(type) && depth < 12) {
      walkMp4(b, body, boxEnd, st, depth + 1);
    }
    at += size;
  }
}

function sniffMp4(b: Uint8Array): Sniffed | null {
  if (b.length < 8 || !MP4_TOP.has(ascii(b, 4, 4))) return null;
  const st: Mp4State = { encrypted: false };
  walkMp4(b, 0, b.length, st, 0);
  // One segment of an adaptive stream: unplayable alone, the stream itself is what to list.
  if (st.segment) return null;
  const units = st.duration || st.fragmentDuration;
  const duration = st.timescale && units && units < 2 ** 52 ? units / st.timescale : undefined;
  return { container: 'mp4', encrypted: st.encrypted, ...(duration ? { duration } : {}), ...(st.width && st.height ? { width: st.width, height: st.height } : {}) };
}

/* ------------------------------------------------------------------- WebM */

function vint(b: Uint8Array, at: number, keepMarker: boolean): { value: number; len: number } | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || at + len > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let unknown = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[at + i]!;
    if (b[at + i] !== 0xff) unknown = false;
  }
  return { value: !keepMarker && unknown ? -1 : value, len };
}

const EBML_SEGMENT = 0x18538067;
const EBML_INFO = 0x1549a966;
const EBML_TRACKS = 0x1654ae6b;
const EBML_TRACK_ENTRY = 0xae;
const EBML_CONTENT_ENCODINGS = 0x6d80;
const EBML_CONTENT_ENCODING = 0x6240;
const EBML_CONTENT_ENCRYPTION = 0x5035;
const EBML_TIMECODE_SCALE = 0x2ad7b1;
const EBML_DURATION = 0x4489;
const EBML_VIDEO = 0xe0;
const EBML_PIXEL_WIDTH = 0xb0;
const EBML_PIXEL_HEIGHT = 0xba;
const EBML_MASTERS = new Set([EBML_SEGMENT, EBML_INFO, EBML_TRACKS, EBML_TRACK_ENTRY, EBML_CONTENT_ENCODINGS, EBML_CONTENT_ENCODING, EBML_VIDEO]);

function sniffWebm(b: Uint8Array): Sniffed | null {
  if (b.length < 4 || b[0] !== 0x1a || b[1] !== 0x45 || b[2] !== 0xdf || b[3] !== 0xa3) return null;
  let encrypted = false;
  let scale = 1_000_000;
  let rawDuration: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  const uint = (from: number, to: number) => {
    let v = 0;
    for (let i = from; i < to; i++) v = v * 256 + b[i]!;
    return v;
  };
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);

  const walk = (start: number, end: number, depth: number) => {
    let at = start;
    while (at < end) {
      const id = vint(b, at, true);
      if (!id) return;
      const size = vint(b, at + id.len, false);
      if (!size) return;
      const body = at + id.len + size.len;
      const bodyEnd = size.value < 0 ? end : Math.min(end, body + size.value);
      if (id.value === EBML_CONTENT_ENCRYPTION) encrypted = true;
      else if (id.value === EBML_TIMECODE_SCALE && bodyEnd - body <= 8) {
        scale = 0;
        for (let i = body; i < bodyEnd; i++) scale = scale * 256 + b[i]!;
      } else if (id.value === EBML_PIXEL_WIDTH && bodyEnd - body <= 4) {
        width ??= uint(body, bodyEnd);
      } else if (id.value === EBML_PIXEL_HEIGHT && bodyEnd - body <= 4) {
        height ??= uint(body, bodyEnd);
      } else if (id.value === EBML_DURATION) {
        if (bodyEnd - body === 8) rawDuration = view.getFloat64(body);
        else if (bodyEnd - body === 4) rawDuration = view.getFloat32(body);
      } else if (EBML_MASTERS.has(id.value) && depth < 8) {
        walk(body, bodyEnd, depth + 1);
      }
      if (size.value < 0) return; // unknown size: its children were walked to the end
      at = body + size.value;
    }
  };
  // The EBML header element comes first; the Segment follows it.
  const head = vint(b, 0, true)!;
  const headSize = vint(b, head.len, false);
  if (!headSize || headSize.value < 0) return { container: 'webm', encrypted };
  walk(head.len + headSize.len + headSize.value, b.length, 0);
  const duration = rawDuration && scale ? (rawDuration * scale) / 1e9 : undefined;
  return {
    container: 'webm',
    encrypted,
    ...(duration && Number.isFinite(duration) ? { duration } : {}),
    ...(width && height ? { width, height } : {}),
  };
}

/* ------------------------------------------------------------------ other */

export function sniffMedia(b: Uint8Array): Sniffed | null {
  const mp4 = sniffMp4(b);
  if (mp4) return mp4;
  const webm = sniffWebm(b);
  if (webm) return webm;
  if (ascii(b, 0, 3) === 'ID3') return { container: 'mp3', encrypted: false };
  if (ascii(b, 0, 4) === 'OggS') return { container: 'ogg', encrypted: false };
  if (ascii(b, 0, 3) === 'FLV') return { container: 'flv', encrypted: false };
  if (b[0] === 0x47 && (b.length < 189 || b[188] === 0x47)) return { container: 'ts', encrypted: false };
  if (b[0] === 0xff && b.length > 1) {
    if ((b[1]! & 0xf6) === 0xf0) return { container: 'aac', encrypted: false };
    if ((b[1]! & 0xe0) === 0xe0) return { container: 'mp3', encrypted: false };
  }
  return null;
}
