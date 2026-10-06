/**
 * Transcription helpers: the sound is cut where it is quietest (the model hears 30 seconds at
 * a time), and what it writes becomes subtitles of a readable length.
 */
import type { Cue } from './subtitles';

export const SAMPLE_RATE = 16_000;

/**
 * Where to cut a recording into pieces of at most `max` seconds (at least `min`): at the
 * quietest tenth of a second between the two, so no word is cut in two.
 */
export function quietCuts(pcm: Float32Array, rate = SAMPLE_RATE, max = 28, min = 18): number[] {
  const cuts: number[] = [];
  const frame = Math.round(rate / 10);
  let from = 0;
  while (pcm.length - from > max * rate) {
    let best = from + max * rate;
    let quietest = Infinity;
    for (let at = from + min * rate; at + frame <= from + max * rate; at += frame) {
      let e = 0;
      for (let i = at; i < at + frame; i++) e += pcm[i]! * pcm[i]!;
      if (e < quietest) {
        quietest = e;
        best = at + Math.round(frame / 2);
      }
    }
    cuts.push(best);
    from = best;
  }
  return cuts;
}

/** What the model wrote for a piece: its text, timed from the start of the piece. */
export interface Said {
  text: string;
  timestamp: [number, number | null];
}

/**
 * Subtitles from what was said: each piece put back at its place, long lines split (at most
 * about 7 seconds and 84 characters on screen), empty and repeated ones left out.
 */
export function cuesFromSaid(pieces: { offset: number; length: number; said: Said[] }[]): Cue[] {
  const out: Cue[] = [];
  for (const p of pieces) {
    for (const [i, s] of p.said.entries()) {
      const text = s.text.replace(/\s+/g, ' ').trim();
      // What the model writes when it hears nothing.
      if (!text || /^[[(].*[\])]$/.test(text) || /^(\.|…|-)+$/.test(text)) continue;
      const start = p.offset + Math.max(0, s.timestamp[0] ?? 0);
      const endRaw = s.timestamp[1] ?? p.said[i + 1]?.timestamp[0] ?? p.length;
      const end = Math.max(start + 0.5, p.offset + Math.min(p.length, endRaw));
      const prev = out[out.length - 1];
      if (prev && prev.text === text && start - prev.end < 1) {
        prev.end = end;
        continue;
      }
      out.push(...splitLong({ start, end, text }));
    }
  }
  return out;
}

/** A long line in several, its time shared by the length of each part. */
function splitLong(c: Cue): Cue[] {
  const words = c.text.split(' ');
  if (c.text.length <= 84 && c.end - c.start <= 7.5) return [c];
  const parts: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && (line.length + w.length + 1 > 84 || (/[.!?,;:]$/.test(line) && line.length > 40))) {
      parts.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) parts.push(line);
  const total = parts.reduce((n, p) => n + p.length, 0);
  let at = c.start;
  return parts.map((text) => {
    const len = ((c.end - c.start) * text.length) / total;
    const cue = { start: at, end: at + len, text };
    at += len;
    return cue;
  });
}
