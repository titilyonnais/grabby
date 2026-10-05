/**
 * The pieces a player appends to a recorded track, with their times: fragments (fragmented
 * MP4) or clusters (WebM). Used to tell how far a recording really got (to carry it on from
 * what was stored, not from where the player was), and to put a track back in order when its
 * player went back and appended part of the video again.
 */
import { boxes, find, readInit, readSamples, type SubInit } from './mp4subs';

const CLUSTER = 0x1f43b675;
const TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const BLOCK = 0xa1;

/** A piece of a track: where it is in the bytes, and the time it covers (seconds). */
export interface Fragment {
  at: number;
  end: number;
  time: number;
  /** Where it stops: its last frame (WebM: where that frame starts), on the decoding clock. */
  until: number;
  /** MP4: its data came in full. */
  complete?: boolean;
}

/** An EBML variable-size integer at `at`: its value and length (marker bit removed, or kept for ids). */
function vint(d: Uint8Array, at: number, id = false): { value: number; len: number } | null {
  const b = d[at];
  if (b === undefined || b === 0) return null;
  let len = 1;
  while (len <= 8 && !(b & (0x80 >> (len - 1)))) len++;
  if (len > 8 || at + len > d.length) return null;
  let value = id ? b : b & (0xff >> len);
  for (let i = 1; i < len; i++) value = value * 256 + d[at + i]!;
  // All ones: unknown size.
  if (!id && value === 2 ** (7 * len) - 1) value = -1;
  return { value, len };
}

function uint(d: Uint8Array, at: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + d[at + i]!;
  return v;
}

const join = (pieces: Uint8Array[]) => {
  if (pieces.length === 1) return pieces[0]!;
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** Nanoseconds per WebM time unit, from the init segment (1 ms when it doesn't say). */
function webmScale(init: Uint8Array): number {
  for (let i = 0; i + 3 < init.length; i++) {
    if (init[i] === 0x2a && init[i + 1] === 0xd7 && init[i + 2] === 0xb1) {
      const size = vint(init, i + 3);
      if (size && size.value > 0 && size.value <= 8) return uint(init, i + 3 + size.len, size.value) || 1_000_000;
      break;
    }
  }
  return 1_000_000;
}

/** A cluster starts at `i`: its id, then its size, then its time first. */
function clusterAt(d: Uint8Array, i: number): boolean {
  if (d[i] !== 0x1f || d[i + 1] !== 0x43 || d[i + 2] !== 0xb6 || d[i + 3] !== 0x75) return false;
  const size = vint(d, i + 4);
  return !!size && d[i + 4 + size.len] === TIMECODE;
}

/** The clusters of WebM data (which may start anywhere: the first cluster found is used). */
export function webmClusters(d: Uint8Array, scale: number, from = 0): Fragment[] {
  const out: Fragment[] = [];
  let i = from;
  while (i + 4 < d.length) {
    if (!clusterAt(d, i)) {
      i++;
      continue;
    }
    const size = vint(d, i + 4)!;
    let at = i + 4 + size.len;
    // Unknown size: it goes on until the next cluster.
    let end = size.value < 0 ? -1 : at + size.value;
    if (end < 0) {
      end = at;
      while (end + 4 < d.length && !clusterAt(d, end)) end++;
      if (end + 4 >= d.length) end = d.length;
    }
    let base: number | undefined;
    let latest: number | undefined;
    const block = (body: number) => {
      const track = vint(d, body);
      if (!track || base === undefined || body + track.len + 2 > d.length) return;
      const rel = ((d[body + track.len]! << 24) >> 16) | d[body + track.len + 1]!;
      latest = Math.max(latest ?? -Infinity, base + rel);
    };
    const stop = Math.min(end, d.length);
    while (at < stop) {
      const id = vint(d, at, true);
      if (!id) break;
      const sz = vint(d, at + id.len);
      if (!sz || sz.value < 0) break;
      const body = at + id.len + sz.len;
      if (body + sz.value > d.length) break;
      if (id.value === TIMECODE) base = uint(d, body, sz.value);
      else if (id.value === SIMPLE_BLOCK) block(body);
      else if (id.value === BLOCK_GROUP) {
        for (let k = body; k < body + sz.value; ) {
          const cid = vint(d, k, true);
          const csz = cid && vint(d, k + cid.len);
          if (!cid || !csz || csz.value < 0) break;
          if (cid.value === BLOCK) block(k + cid.len + csz.len);
          k += cid.len + csz.len + csz.value;
        }
      } else if (id.value === CLUSTER) break;
      at = body + sz.value;
    }
    if (base !== undefined) {
      out.push({ at: i, end: Math.min(end, d.length), time: (base * scale) / 1e9, until: ((latest ?? base) * scale) / 1e9 + 0.001 });
    }
    i = Math.max(i + 1, Math.min(end, d.length));
  }
  return out;
}

/** The fragments (moof + mdat, with the boxes just before them) of fragmented MP4 data. */
export function mp4Fragments(d: Uint8Array, info: SubInit, from = 0): Fragment[] {
  // Data that starts in the middle of a box: from the first fragment found.
  let start = -1;
  for (let i = from; i + 8 <= d.length; i++) {
    if (d[i + 4] === 0x6d && d[i + 5] === 0x6f && d[i + 6] === 0x6f && d[i + 7] === 0x66) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: Fragment[] = [];
  let head: number | null = null;
  for (const b of boxes(view, start, d.length)) {
    if (b.type === 'moof') {
      const traf = find(view, b.body, b.end, 'traf');
      const tfdt = traf && find(view, traf.body, traf.end, 'tfdt');
      if (!tfdt) return [];
      const t = view.getUint8(tfdt.body) === 1 ? Number(view.getBigUint64(tfdt.body + 4)) : view.getUint32(tfdt.body + 4);
      out.push({ at: head ?? b.start, end: b.end, time: t / info.timescale, until: t / info.timescale });
      head = null;
    } else if (b.type === 'mdat' && out.length) {
      out[out.length - 1]!.end = b.end;
    } else head ??= b.start;
  }
  for (const f of out) {
    const samples = readSamples(d.subarray(f.at, f.end), info);
    f.complete = samples.length > 0;
    f.until = f.time + samples.reduce((n, x) => n + x.duration, 0);
  }
  return out;
}

/**
 * What a player's buffer ends up holding after these appends, in time order: a piece
 * appended over the time of pieces appended before replaces them (a player that went back
 * appends part of the video again, or fills what it skipped). A piece it only touches at an
 * edge stays: losing its other frames would leave a hole.
 */
export function settle(frags: Fragment[]): Fragment[] {
  const kept: Fragment[] = [];
  const span = (f: Fragment) => Math.max(0.001, f.until - f.time);
  for (const f of frags) {
    // Kept in time order: where the new piece goes, then the pieces around it it covers.
    let lo = 0;
    let hi = kept.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (kept[mid]!.time < f.time) lo = mid + 1;
      else hi = mid;
    }
    let from = lo;
    while (from > 0 && kept[from - 1]!.until > f.time) from--;
    let to = lo;
    while (to < kept.length && (kept[to]!.time < f.until || kept[to]!.time === f.time)) to++;
    const around = kept.slice(from, to).filter((k) => {
      const overlap = Math.min(k.until, Math.max(f.until, f.time + 0.001)) - Math.max(k.time, f.time);
      return overlap < span(k) / 2;
    });
    const at = around.findIndex((k) => k.time >= f.time);
    around.splice(at < 0 ? around.length : at, 0, f);
    kept.splice(from, to - from, ...around);
  }
  return kept;
}

/**
 * An MP4 fragment (`piece`, its boxes before the moof included) without its frames decoded
 * at `before` (seconds) or later; null when that is all of them. As it is when it can't be
 * read: one track run only, the frames after are just no longer counted.
 */
function trimMp4(piece: Uint8Array, info: SubInit, before: number): Uint8Array | null {
  const d = piece.slice();
  const view = new DataView(d.buffer);
  const moof = [...boxes(view, 0, d.length)].find((b) => b.type === 'moof');
  const trafs = moof ? [...boxes(view, moof.body, moof.end)].filter((b) => b.type === 'traf') : [];
  if (trafs.length !== 1) return piece;
  const traf = trafs[0]!;
  const tfhd = find(view, traf.body, traf.end, 'tfhd');
  const tfdt = find(view, traf.body, traf.end, 'tfdt');
  const truns = [...boxes(view, traf.body, traf.end)].filter((b) => b.type === 'trun');
  if (!tfhd || !tfdt || truns.length !== 1) return piece;
  const hf = view.getUint32(tfhd.body) & 0xffffff;
  let defDur = info.defaultDuration;
  if (hf & 0x8) defDur = view.getUint32(tfhd.body + 8 + (hf & 0x1 ? 8 : 0) + (hf & 0x2 ? 4 : 0));
  let time = view.getUint8(tfdt.body) === 1 ? Number(view.getBigUint64(tfdt.body + 4)) : view.getUint32(tfdt.body + 4);
  const trun = truns[0]!;
  const tf = view.getUint32(trun.body) & 0xffffff;
  const count = view.getUint32(trun.body + 4);
  const per = [0x100, 0x200, 0x400, 0x800].filter((x) => tf & x).length * 4;
  let q = trun.body + 8 + (tf & 0x1 ? 4 : 0) + (tf & 0x4 ? 4 : 0);
  let n = 0;
  // Half a tick of leeway: the frame starting right at `before` goes.
  while (n < count && (time + 0.5) / info.timescale < before) {
    time += tf & 0x100 ? view.getUint32(q) : defDur;
    q += per;
    n++;
  }
  if (n === count) return piece;
  if (n === 0) return null;
  view.setUint32(trun.body + 4, n);
  return d;
}

/** A WebM cluster (`piece`, starting with it) without its blocks at `before` (seconds) or later; null when that is all of them. */
function trimWebm(piece: Uint8Array, scale: number, before: number): Uint8Array | null {
  const size = vint(piece, 4);
  if (!clusterAt(piece, 0) || !size) return piece;
  const start = 4 + size.len;
  const end = size.value < 0 ? piece.length : Math.min(piece.length, start + size.value);
  const limit = (before * 1e9) / scale - 0.5;
  let base: number | undefined;
  const timeOf = (body: number) => {
    const track = vint(piece, body);
    if (!track || base === undefined) return undefined;
    return base + (((piece[body + track.len]! << 24) >> 16) | piece[body + track.len + 1]!);
  };
  const kept: Uint8Array[] = [];
  let blocks = 0;
  let dropped = 0;
  for (let at = start; at < end; ) {
    const id = vint(piece, at, true);
    const sz = id && vint(piece, at + id.len);
    if (!id || !sz || sz.value < 0) return piece;
    const body = at + id.len + sz.len;
    const next = Math.min(end, body + sz.value);
    let t: number | undefined;
    if (id.value === TIMECODE) base = uint(piece, body, sz.value);
    else if (id.value === SIMPLE_BLOCK) t = timeOf(body);
    else if (id.value === BLOCK_GROUP) {
      for (let k = body; k < next; ) {
        const cid = vint(piece, k, true);
        const csz = cid && vint(piece, k + cid.len);
        if (!cid || !csz || csz.value < 0) break;
        if (cid.value === BLOCK) t = timeOf(k + cid.len + csz.len);
        k += cid.len + csz.len + csz.value;
      }
    }
    if (t !== undefined) blocks++;
    if (t !== undefined && t >= limit) dropped++;
    else kept.push(piece.subarray(at, next));
    at = next;
  }
  if (!dropped) return piece;
  if (dropped === blocks) return null;
  const body = join(kept);
  // The cluster's new size, on 8 bytes.
  const head = new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x01, 0, 0, 0, 0, 0, 0, 0]);
  for (let i = 0, v = body.length; i < 7; i++, v = Math.floor(v / 256)) head[11 - i] = v % 256;
  return join([head, body, piece.subarray(end)]);
}

/**
 * A recorded track (its init segment first, `initLength` bytes) put back in order, as the
 * player's buffer held it: time never goes back in the file, and nothing is there twice. A
 * piece the next one starts inside of loses what the next one has again, as the player's
 * buffer does when a piece is appended over the end of another.
 * Returned as it is when it was already in order (or can't be read).
 */
export function untangle(mime: string, data: Uint8Array, initLength: number): Uint8Array {
  try {
    const init = data.subarray(0, initLength);
    const webm = mime.toLowerCase().includes('webm');
    const scale = webm ? webmScale(init) : 0;
    const info = webm ? null : readInit(init);
    const frags = webm ? webmClusters(data, scale, initLength) : mp4Fragments(data, info!, initLength);
    // A fragment whose data didn't come in full can only stay at the very end.
    const kept = settle(frags).filter((f, i, all) => f.complete !== false || i === all.length - 1);
    const overlaps = (f: Fragment, i: number) => {
      const after = kept[i + 1];
      return !!after && after.time > f.time && after.time < f.until - 0.0005;
    };
    if (frags.length < 2 || (kept.every((f, i) => f === frags[i]) && !kept.some(overlaps))) return data;
    // Each kept piece runs until the next piece appended after it.
    const next = new Map(frags.map((f, i) => [f, frags[i + 1]?.at ?? data.length]));
    const parts = [data.subarray(0, frags[0]!.at)];
    for (const [i, f] of kept.entries()) {
      const piece = data.subarray(f.at, next.get(f)!);
      const cut = overlaps(f, i) ? (webm ? trimWebm(piece, scale, kept[i + 1]!.time) : trimMp4(piece, info!, kept[i + 1]!.time)) : piece;
      if (cut) parts.push(cut);
    }
    console.debug('[grabby] track put back in order', JSON.stringify({ pieces: frags.length, kept: kept.length }));
    return join(parts);
  } catch {
    return data;
  }
}

/** The latest block time of WebM pieces (end to end), in seconds; undefined without a cluster start. */
export function webmEnd(init: Uint8Array, pieces: Uint8Array[]): number | undefined {
  let best: number | undefined;
  for (const c of settle(webmClusters(join(pieces), webmScale(init)))) best = Math.max(best ?? -Infinity, c.until - 0.001);
  return best;
}

/**
 * The end of the last complete fragment of fragmented MP4 pieces (end to end, starting
 * anywhere: the first fragment start found is used), in seconds.
 */
export function mp4End(init: Uint8Array, pieces: Uint8Array[]): number | undefined {
  const info = readInit(init);
  const d = join(pieces);
  let best: number | undefined;
  for (const f of settle(mp4Fragments(d, info))) {
    if (!f.complete) continue;
    for (const s of readSamples(d.subarray(f.at, f.end), info)) best = Math.max(best ?? -Infinity, s.time + s.duration);
  }
  return best;
}

/**
 * Where a file must stop for a picture that starts again at `at` (seconds) in the next one,
 * read from ffmpeg's framecrc listing of its picture: the decoding time of its first frame
 * shown at `at` or later. ffmpeg stops a file on decoding times, and a frame is decoded a
 * little before it is shown: stopping at `at` itself would keep that frame, and the next
 * file shows it again. Undefined when the listing has no such frame.
 */
export function cutBefore(framecrc: string, at: number): number | undefined {
  const tb = /#tb 0: (\d+)\/(\d+)/.exec(framecrc);
  if (!tb) return undefined;
  const unit = Number(tb[1]) / Number(tb[2]);
  let best: number | undefined;
  for (const m of framecrc.matchAll(/^0,\s*(-?\d+),\s*(-?\d+),/gm)) {
    const dts = Number(m[1]) * unit;
    const pts = Number(m[2]) * unit;
    // Times may be rounded to the millisecond (Matroska): well under a frame either way.
    if (pts >= at - 0.002) best = Math.min(best ?? Infinity, dts);
  }
  return best;
}

export function storedEnd(mime: string, init: Uint8Array, pieces: Uint8Array[]): number | undefined {
  try {
    return mime.toLowerCase().includes('webm') ? webmEnd(init, pieces) : mp4End(init, pieces);
  } catch {
    return undefined;
  }
}
