/**
 * WebVTT (what streams carry, often cut into segments) to SubRip (.srt, what players and
 * video files take everywhere).
 */

export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** "01:02.500" or "1:01:02.500" → seconds; NaN when it isn't a time. */
function vttTime(s: string): number {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(s.trim());
  if (!m) return Number.NaN;
  const [, h, min, sec, ms] = m;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec) + Number(ms!.padEnd(3, '0')) / 1000;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '', rlm: '', quot: '"', apos: "'" };

/** Keeps italics, bold and underline (SRT knows them); drops voices, classes, karaoke times. */
function cleanText(text: string): string {
  return text
    .replace(/<(\/?)([ibu])(?:\.[^>\s]*)?>/g, '\u0001$1$2\u0002')
    .replace(/<[^>]*>/g, '')
    .replace(/\u0001/g, '<')
    .replace(/\u0002/g, '>')
    .replace(/&(\w+);/g, (all, name: string) => ENTITIES[name] ?? all)
    .trim();
}

/**
 * The cues of one WebVTT file, on the video's clock. HLS segments say how their times map
 * to the video (X-TIMESTAMP-MAP): `shift` is added to every cue.
 */
export function parseVtt(text: string, shift = 0): { cues: Cue[]; map?: number } {
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues: Cue[] = [];
  let map: number | undefined;
  const header = blocks[0] ?? '';
  const ts = /X-TIMESTAMP-MAP=([^\n]*)/.exec(header);
  if (ts) {
    const mpegts = /MPEGTS:(\d+)/.exec(ts[1]!);
    const local = /LOCAL:([\d:.]+)/.exec(ts[1]!);
    if (mpegts) map = Number(mpegts[1]) / 90000 - (local ? vttTime(local[1]!) || 0 : 0);
  }
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0 || at > 1) continue;
    const [from, rest] = lines[at]!.split('-->');
    const start = vttTime(from!);
    const end = vttTime(rest!.trim().split(/\s+/)[0]!);
    const body = cleanText(lines.slice(at + 1).join('\n'));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !body) continue;
    cues.push({ start: start + shift, end: end + shift, text: body });
  }
  return { cues, ...(map !== undefined ? { map } : {}) };
}

/**
 * Segments of one subtitle track put together: times counted from the start of the stream,
 * and the cues repeated at segment edges kept once.
 */
export function joinVtt(segments: string[]): Cue[] {
  // HLS: each segment maps its times to the video's; the first one is the start of the stream.
  const base = segments.map((s) => parseVtt(s).map).find((m) => m !== undefined);
  const all: Cue[] = [];
  for (const seg of segments) {
    const { map } = parseVtt(seg);
    const shift = map !== undefined && base !== undefined ? map - base : 0;
    all.push(...parseVtt(seg, shift).cues);
  }
  all.sort((a, b) => a.start - b.start || a.end - b.end);
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = `${Math.round(c.start * 100)}|${Math.round(c.end * 100)}|${c.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const ms = (s: number) => Math.round(s * 1000) / 1000;

/** Keeps the cues of a part, its start becoming zero. */
export function clipCues(cues: Cue[], start: number, duration: number): Cue[] {
  return cues
    .filter((c) => c.end > start && c.start < start + duration)
    .map((c) => ({ ...c, start: ms(Math.max(0, c.start - start)), end: ms(Math.min(duration, c.end - start)) }));
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

/** The ISO 639-2 code MP4 and MKV files want ("fr", "fr-CA" → "fra"), when it is a common one. */
const ISO3: Record<string, string> = {
  ar: 'ara', cs: 'ces', da: 'dan', de: 'deu', el: 'ell', en: 'eng', es: 'spa', fi: 'fin', fr: 'fra', he: 'heb',
  hi: 'hin', hu: 'hun', id: 'ind', it: 'ita', ja: 'jpn', ko: 'kor', nb: 'nob', nl: 'nld', no: 'nor', pl: 'pol',
  pt: 'por', ro: 'ron', ru: 'rus', sv: 'swe', th: 'tha', tr: 'tur', uk: 'ukr', vi: 'vie', zh: 'zho',
};

export function iso3(lang?: string): string | undefined {
  if (!lang) return undefined;
  const l = lang.toLowerCase().split(/[-_]/)[0]!;
  if (/^[a-z]{3}$/.test(l)) return l;
  return ISO3[l];
}

/** Containers that can hold subtitles, and in which form. */
export const SUB_CODEC: Partial<Record<string, string>> = { mp4: 'mov_text', mov: 'mov_text', mkv: 'srt', webm: 'webvtt' };
