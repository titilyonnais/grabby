/**
 * Chapters: read from a YouTube description (its "0:00 Intro" lines) or a page's
 * <track kind="chapters">, cut to a part of the video, and written for ffmpeg.
 */
import type { Chapter, Clip } from './plan';
import type { Cue } from './subtitles';

const TIME = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;

function seconds(text: string): number | null {
  const m = TIME.exec(text);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * The chapters a description lists, by YouTube's own rule: one per line with a time, the
 * first at 0:00, at least three, in order, each at least 10 seconds long. Otherwise none.
 */
export function descriptionChapters(text: string | undefined, duration?: number): Chapter[] {
  if (!text) return [];
  const out: Chapter[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // The first time on the line, wherever it is: "0:00 Intro", "Intro - 0:00", "⌨️ (1:23) Suite".
    const m = /(^|[\s([])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=$|[\s)\],.:|–—-])/.exec(line);
    if (!m) continue;
    const time = m[2]!;
    const start = seconds(time);
    if (start === null) continue;
    const at = m.index + m[1]!.length;
    // The rest of the line, without the time, its brackets and the separators around it.
    const title = `${line.slice(0, at).replace(/[([]\s*$/, '')} ${line.slice(at + time.length).replace(/^\s*[)\]]/, '')}`
      .replace(/^[\s\-–—:|.]+|[\s\-–—:|.]+$/g, '')
      .replace(/\s+/g, ' ');
    out.push({ start, title: title || time });
  }
  if (out.length < 3 || out[0]!.start !== 0) return [];
  for (let i = 1; i < out.length; i++) if (out[i]!.start - out[i - 1]!.start < 10) return [];
  if (duration && out[out.length - 1]!.start >= duration) return [];
  return out;
}

/** The chapters of a <track kind="chapters"> file (its cues). */
export function cueChapters(cues: Cue[]): Chapter[] {
  return cues
    .filter((c) => c.text.trim())
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ start: c.start, title: c.text.replace(/\s+/g, ' ').trim() }));
}

/**
 * The chapters of a part, on its clock (it starts at zero, `lead` seconds before the part):
 * the one the part starts in begins at zero.
 */
export function clipChapters(chapters: Chapter[], clip: { start: number; duration: number }, lead = 0): Chapter[] {
  const from = clip.start - lead;
  const end = clip.start + clip.duration;
  const out: Chapter[] = [];
  chapters.forEach((c, i) => {
    const next = chapters[i + 1]?.start ?? Infinity;
    if (next <= from || c.start >= end) return;
    out.push({ start: Math.max(0, c.start - from), title: c.title });
  });
  return out;
}

/** The chapters of parts joined end to end: one per part, named after its times. */
export function partChapters(parts: { clip: Clip; length: number }[], name: (c: Clip) => string): Chapter[] {
  let at = 0;
  return parts.map(({ clip, length }) => {
    const c = { start: at, title: name(clip) };
    at += length;
    return c;
  });
}

const escape = (s: string) => s.replace(/[\\=;#\n]/g, (c) => (c === '\n' ? ' ' : `\\${c}`));

/** An ffmetadata file with these chapters (the last one ends at `total` seconds). */
export function ffmetadata(chapters: Chapter[], total: number): string {
  const ms = (s: number) => Math.max(0, Math.round(s * 1000));
  const lines = [';FFMETADATA1'];
  chapters.forEach((c, i) => {
    const end = chapters[i + 1]?.start ?? total;
    if (end <= c.start) return;
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${ms(c.start)}`, `END=${ms(end)}`, `title=${escape(c.title)}`);
  });
  return `${lines.join('\n')}\n`;
}
