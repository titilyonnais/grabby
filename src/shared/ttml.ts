/**
 * TTML / IMSC subtitles (DASH `stpp`, `.ttml`, `.dfxp` files) to cues. Only what a
 * subtitle file needs: the timing of each paragraph (or of its spans), line breaks, italics
 * and bold. Layout, colours and images are left out.
 */
import type { Cue } from './subtitles';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Attributes of a start tag, by local name ("tts:fontStyle" → "fontStyle"). */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]!.slice(m[1]!.indexOf(':') + 1)] = decode(m[3] ?? m[4] ?? '');
  return out;
}

interface Rates {
  frame: number;
  tick: number;
}

/** A TTML time ("00:01:02.500", "00:01:02:12" frames, "62.5s", "1500ms", "625000t") in seconds. */
export function ttmlTime(s: string | undefined, r: Rates): number | undefined {
  if (!s) return undefined;
  const v = s.trim();
  const clock = /^(\d+):(\d{2}):(\d{2})(?:(\.\d+)|:(\d+(?:\.\d+)?))?$/.exec(v);
  if (clock) {
    const [, h, m, sec, frac, frames] = clock;
    return Number(h) * 3600 + Number(m) * 60 + Number(sec) + (frac ? Number(frac) : 0) + (frames ? Number(frames) / r.frame : 0);
  }
  const offset = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/.exec(v);
  if (!offset) return undefined;
  const n = Number(offset[1]);
  switch (offset[2]) {
    case 'h':
      return n * 3600;
    case 'm':
      return n * 60;
    case 's':
      return n;
    case 'ms':
      return n / 1000;
    case 'f':
      return n / r.frame;
    default:
      return n / r.tick;
  }
}

/** The text of a paragraph or span: <br/> as line breaks, italic and bold kept. */
function textOf(inner: string, styles: Record<string, { italic?: boolean; bold?: boolean }>): string {
  let out = '';
  const open: string[] = [];
  const re = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) {
    if (m[5] !== undefined) {
      // Line breaks in the source are layout, not text.
      out += decode(m[5].replace(/\s*\n\s*/g, ' '));
      continue;
    }
    const name = m[2]!.slice(m[2]!.indexOf(':') + 1);
    if (name === 'br') {
      out += '\n';
      continue;
    }
    if (name !== 'span') continue;
    if (m[1]) {
      out += open.pop() ?? '';
      continue;
    }
    if (m[4]) continue;
    const a = attrs(m[3]!);
    const style = a.style ? styles[a.style] : undefined;
    const italic = a.fontStyle === 'italic' || style?.italic;
    const bold = a.fontWeight === 'bold' || style?.bold;
    out += (italic ? '<i>' : '') + (bold ? '<b>' : '');
    open.push((bold ? '</b>' : '') + (italic ? '</i>' : ''));
  }
  return out
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/<i><\/i>|<b><\/b>/g, '');
}

/**
 * Cues of a TTML document. `base` is added to every time (a document whose times count from
 * the start of its own sample).
 */
export function parseTtml(xml: string, base = 0): Cue[] {
  const root = /<(?:\w+:)?tt\b([^>]*)>/.exec(xml);
  if (!root) return [];
  const top = attrs(root[1]!);
  const frame = (Number(top.frameRate) || 30) * (top.frameRateMultiplier ? eval0(top.frameRateMultiplier) : 1);
  const r: Rates = { frame, tick: Number(top.tickRate) || (top.frameRate ? frame * (Number(top.subFrameRate) || 1) : 1) };

  // Named styles that make text italic or bold.
  const styles: Record<string, { italic?: boolean; bold?: boolean }> = {};
  for (const m of xml.matchAll(/<(?:\w+:)?style\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]!);
    if (a.id) styles[a.id] = { italic: a.fontStyle === 'italic', bold: a.fontWeight === 'bold' };
  }

  // A <div> or <body> may shift what it holds.
  const shiftOf = (tag: string) => ttmlTime(attrs(tag).begin, r) ?? 0;
  const body = /<(?:\w+:)?body\b([^>]*)>/.exec(xml);
  const bodyShift = body ? shiftOf(body[1]!) : 0;

  const cues: Cue[] = [];
  const divs = [...xml.matchAll(/<(?:\w+:)?div\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?div>/g)];
  const blocks = divs.length ? divs.map((d) => ({ shift: shiftOf(d[1]!), inner: d[2]! })) : [{ shift: 0, inner: xml }];
  for (const block of blocks) {
    const at = base + bodyShift + block.shift;
    for (const p of block.inner.matchAll(/<(?:\w+:)?p\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?p>/g)) {
      const a = attrs(p[1]!);
      const begin = ttmlTime(a.begin, r);
      const end = ttmlTime(a.end, r) ?? (begin !== undefined ? addDur(begin, a.dur, r) : undefined);
      if (begin !== undefined && end !== undefined) {
        const text = textOf(p[2]!, styles);
        if (text && end > begin) cues.push({ start: at + begin, end: at + end, text });
        continue;
      }
      // Timing on the spans instead: one cue each.
      for (const s of p[2]!.matchAll(/<(?:\w+:)?span\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?span>/g)) {
        const sa = attrs(s[1]!);
        const sb = ttmlTime(sa.begin, r);
        const se = ttmlTime(sa.end, r) ?? (sb !== undefined ? addDur(sb, sa.dur, r) : undefined);
        const text = textOf(s[2]!, styles);
        if (sb !== undefined && se !== undefined && se > sb && text) cues.push({ start: at + sb, end: at + se, text });
      }
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

function addDur(begin: number, dur: string | undefined, r: Rates): number | undefined {
  const d = ttmlTime(dur, r);
  return d === undefined ? undefined : begin + d;
}

/** "1000 1001" → 1000/1001. */
function eval0(s: string): number {
  const [a, b] = s.trim().split(/\s+/).map(Number);
  return a && b ? a / b : 1;
}
