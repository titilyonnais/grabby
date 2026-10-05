/**
 * YouTube's own subtitle formats, as its player loads them: `json3` (what it asks for by
 * default), `srv3` and the older `srv1` XML. Only times and text are kept.
 */
import type { Cue } from './subtitles';

interface Json3 {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Lines trimmed, empty ones dropped. */
const tidy = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

export const isYouTubeCaptions = (text: string): boolean => /^\s*\{\s*"[^"]+"/.test(text) || /^\s*(<\?xml[^>]*>\s*)?<(timedtext|transcript)\b/.test(text);

export function parseYouTubeCaptions(text: string): Cue[] {
  const cues: Cue[] = [];
  const push = (start: number, end: number, raw: string) => {
    const t = tidy(raw);
    if (t && Number.isFinite(start) && end > start) cues.push({ start, end, text: t });
  };
  if (/^\s*\{/.test(text)) {
    let doc: Json3;
    try {
      doc = JSON.parse(text) as Json3;
    } catch {
      return [];
    }
    for (const e of doc.events ?? []) {
      if (!e.segs || typeof e.tStartMs !== 'number') continue;
      const start = e.tStartMs / 1000;
      push(start, start + (Number(e.dDurationMs) || 0) / 1000, e.segs.map((s) => s.utf8 ?? '').join(''));
    }
  } else if (/<timedtext\b/.test(text)) {
    // srv3: <p t="ms" d="ms">text <s>word</s><br/>…</p>
    for (const m of text.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const t = Number(/\bt="(\d+)"/.exec(m[1]!)?.[1]);
      const d = Number(/\bd="(\d+)"/.exec(m[1]!)?.[1]);
      push(t / 1000, (t + d) / 1000, decode(m[2]!.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')));
    }
  } else {
    // srv1: <text start="s" dur="s">text</text>
    for (const m of text.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const start = Number(/\bstart="([\d.]+)"/.exec(m[1]!)?.[1]);
      const dur = Number(/\bdur="([\d.]+)"/.exec(m[1]!)?.[1]);
      // Escaped twice in this format.
      push(start, start + dur, decode(decode(m[2]!)).replace(/<[^>]+>/g, ''));
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}
