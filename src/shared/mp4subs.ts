/**
 * Subtitles packed in fragmented MP4 (DASH and HLS "fMP4" text tracks), as cues:
 * - `wvtt`: WebVTT, each sample holding the lines shown during it (`vttc` / `payl` boxes);
 * - `stpp`: TTML, each sample a whole TTML document.
 * Only the boxes needed for timing are read: timescale (mdhd), sample entry (stsd), and per
 * fragment the decode time (tfdt), durations and sizes (tfhd, trun, trex).
 */
import { cleanCueText, type Cue } from './subtitles';
import { parseTtml } from './ttml';

interface Box {
  type: string;
  /** Offset of the box in the buffer, and of its content (after the header). */
  start: number;
  body: number;
  end: number;
}

export function* boxes(d: DataView, from: number, to: number): Generator<Box> {
  let at = from;
  while (at + 8 <= to) {
    let size = d.getUint32(at);
    const type = String.fromCharCode(d.getUint8(at + 4), d.getUint8(at + 5), d.getUint8(at + 6), d.getUint8(at + 7));
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > to) return;
      size = Number(d.getBigUint64(at + 8));
      body = at + 16;
    } else if (size === 0) size = to - at;
    if (size < body - at || at + size > to) return;
    yield { type, start: at, body, end: at + size };
    at += size;
  }
}

export const find = (d: DataView, from: number, to: number, type: string) => {
  for (const b of boxes(d, from, to)) if (b.type === type) return b;
  return undefined;
};

/** Walks a path of nested boxes ("moov/trak/mdia/mdhd"). */
function path(d: DataView, from: number, to: number, types: string[]): Box | undefined {
  let box: Box | undefined;
  let a = from;
  let b = to;
  for (const t of types) {
    box = find(d, a, b, t);
    if (!box) return undefined;
    a = box.body;
    b = box.end;
  }
  return box;
}

export interface SubInit {
  format: 'wvtt' | 'stpp' | 'other';
  timescale: number;
  defaultDuration: number;
}

/** What the init segment says: the kind of subtitles and the clock their times use. */
export function readInit(buf: Uint8Array): SubInit {
  const d = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const mdhd = path(d, 0, buf.byteLength, ['moov', 'trak', 'mdia', 'mdhd']);
  let timescale = 1000;
  if (mdhd) timescale = d.getUint8(mdhd.body) === 1 ? d.getUint32(mdhd.body + 20) : d.getUint32(mdhd.body + 12);
  const stsd = path(d, 0, buf.byteLength, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
  let format: SubInit['format'] = 'other';
  if (stsd) {
    // Full box (4 bytes), entry count (4), then the first sample entry.
    const entry = boxes(d, stsd.body + 8, stsd.end).next().value;
    if (entry?.type === 'wvtt' || entry?.type === 'stpp') format = entry.type;
  }
  const trex = path(d, 0, buf.byteLength, ['moov', 'mvex', 'trex']);
  // trex: full box (4), track id (4), description index (4), default duration (4).
  const defaultDuration = trex ? d.getUint32(trex.body + 12) : 0;
  return { format, timescale: timescale || 1000, defaultDuration };
}

export interface Sample {
  /** Seconds on the track's clock. */
  time: number;
  duration: number;
  data: Uint8Array;
}

/** The samples of one media segment (one or more moof + mdat pairs). */
export function readSamples(buf: Uint8Array, init: SubInit): Sample[] {
  const d = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Sample[] = [];
  const top = [...boxes(d, 0, buf.byteLength)];
  for (const [k, moof] of top.entries()) {
    if (moof.type !== 'moof') continue;
    const mdat = top.slice(k + 1).find((b) => b.type === 'mdat');
    // A fragment whose data hasn't come in full is left out.
    if (!mdat) continue;
    for (const traf of boxes(d, moof.body, moof.end)) {
      if (traf.type !== 'traf') continue;
      const tfhd = find(d, traf.body, traf.end, 'tfhd');
      const tfdt = find(d, traf.body, traf.end, 'tfdt');
      if (!tfhd) continue;
      const hf = d.getUint32(tfhd.body) & 0xffffff;
      let p = tfhd.body + 8;
      let base = moof.start;
      if (hf & 0x1) {
        base = Number(d.getBigUint64(p));
        p += 8;
      }
      if (hf & 0x2) p += 4;
      let defDur = init.defaultDuration;
      let defSize = 0;
      if (hf & 0x8) {
        defDur = d.getUint32(p);
        p += 4;
      }
      if (hf & 0x10) defSize = d.getUint32(p);
      let time = 0;
      if (tfdt) time = d.getUint8(tfdt.body) === 1 ? Number(d.getBigUint64(tfdt.body + 4)) : d.getUint32(tfdt.body + 4);
      let pos = mdat ? mdat.body : moof.end;
      for (const trun of boxes(d, traf.body, traf.end)) {
        if (trun.type !== 'trun') continue;
        const tf = d.getUint32(trun.body) & 0xffffff;
        const count = d.getUint32(trun.body + 4);
        let q = trun.body + 8;
        if (tf & 0x1) {
          pos = base + d.getInt32(q);
          q += 4;
        }
        if (tf & 0x4) q += 4;
        for (let i = 0; i < count; i++) {
          let dur = defDur;
          let size = defSize;
          let cto = 0;
          if (tf & 0x100) {
            dur = d.getUint32(q);
            q += 4;
          }
          if (tf & 0x200) {
            size = d.getUint32(q);
            q += 4;
          }
          if (tf & 0x400) q += 4;
          if (tf & 0x800) {
            cto = d.getInt32(q);
            q += 4;
          }
          if (pos + size > buf.byteLength) break;
          out.push({ time: (time + cto) / init.timescale, duration: dur / init.timescale, data: buf.subarray(pos, pos + size) });
          pos += size;
          time += dur;
        }
      }
    }
  }
  return out;
}

const utf8 = new TextDecoder();

/** The lines of a `wvtt` sample (none for an empty `vtte` one). */
function wvttLines(data: Uint8Array): string[] {
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lines: string[] = [];
  for (const b of boxes(d, 0, data.byteLength)) {
    if (b.type !== 'vttc') continue;
    const payl = find(d, b.body, b.end, 'payl');
    if (payl) lines.push(cleanCueText(utf8.decode(data.subarray(payl.body, payl.end))));
  }
  return lines.filter(Boolean);
}

/**
 * Cues of an MP4 subtitle track (init segment, then media segments), on the track's clock.
 * A line shown over several samples (WebVTT cues are split where others overlap them) is one cue.
 */
export function mp4Cues(init: Uint8Array, segments: Uint8Array[]): Cue[] {
  const info = readInit(init);
  if (info.format === 'other') return [];
  const cues: Cue[] = [];
  for (const seg of segments) {
    for (const s of readSamples(seg, info)) {
      if (info.format === 'wvtt') {
        for (const text of wvttLines(s.data)) {
          const open = cues.find((c) => c.text === text && Math.abs(c.end - s.time) < 0.002);
          if (open) open.end = s.time + s.duration;
          else cues.push({ start: s.time, end: s.time + s.duration, text });
        }
      } else {
        const xml = utf8.decode(s.data);
        let doc = parseTtml(xml);
        // Most documents count from the start of the track; some from their own sample.
        if (doc.length && doc.every((c) => c.end <= s.duration + 0.01) && s.time > 0 && doc.every((c) => c.start < s.time - 0.01)) {
          doc = parseTtml(xml, s.time);
        }
        cues.push(...doc);
      }
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}
