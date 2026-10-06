import { toSrt, type Cue } from './subtitles';

/** What is said in a saved file, line by line on its clock: what the library searches. */
export interface Transcript {
  lang?: string;
  /** Written by the local AI rather than given by the site. */
  ai?: boolean;
  cues: Cue[];
}

/** At most this many lines are kept (a few hours of speech). */
const MAX_CUES = 6000;

/** The text to keep among a file's subtitles: the words as said (transcribed or the site's), not a translation. */
export function transcriptOf(texts: { cues: Cue[]; lang?: string; made?: 'transcribed' | 'translated' }[]): Transcript | undefined {
  const t = texts.find((x) => x.made === 'transcribed' && x.cues.length) ?? texts.find((x) => !x.made && x.cues.length) ?? texts.find((x) => x.cues.length);
  if (!t) return undefined;
  const cues = t.cues
    .slice(0, MAX_CUES)
    .map((c) => ({ start: Math.round(c.start * 100) / 100, end: Math.round(c.end * 100) / 100, text: c.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }))
    .filter((c) => c.text);
  if (!cues.length) return undefined;
  return { ...(t.lang ? { lang: t.lang } : {}), ...(t.made === 'transcribed' ? { ai: true } : {}), cues };
}

/** « Éditeur de sous-titres »: the lines as edited, moved by `shift` seconds, checked (empty ones go). */
export function editedTranscript(t: Transcript, cues: { start: number; end: number; text: string }[], shift = 0): Transcript {
  const out = cues
    .slice(0, MAX_CUES)
    .map((c) => ({ start: Math.max(0, Math.round((c.start + shift) * 100) / 100), end: Math.max(0, Math.round((c.end + shift) * 100) / 100), text: String(c.text).replace(/\s+/g, ' ').trim().slice(0, 2000) }))
    .filter((c) => c.text && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start);
  return { ...(t.lang ? { lang: t.lang } : {}), ...(t.ai ? { ai: true } : {}), cues: out };
}

/** Letters without accents or case: « Énorme » is found by typing "enorme". */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export interface SpokenHit {
  /** Where it is said (seconds). */
  at: number;
  text: string;
}

/** The moments a phrase is said: every word of the query in one line (or a line and the next). */
export function spokenHits(t: Transcript, query: string, max = 5): SpokenHit[] {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const out: SpokenHit[] = [];
  for (let i = 0; i < t.cues.length && out.length < max; i++) {
    const c = t.cues[i]!;
    const here = fold(c.text);
    const both = `${here} ${fold(t.cues[i + 1]?.text ?? '')}`;
    if (words.every((w) => here.includes(w)) || (words.length > 1 && words.every((w) => both.includes(w)) && words.some((w) => here.includes(w)))) {
      out.push({ at: c.start, text: c.text });
    }
  }
  return out;
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
const short = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`);

/** « Exporter le texte »: plain text with times, subtitles, or Markdown. */
export function exportTranscript(t: Transcript, format: 'txt' | 'srt' | 'md', title = ''): string {
  if (format === 'srt') return toSrt(t.cues);
  if (format === 'md') return `# ${title}\n\n${t.cues.map((c) => `**[${short(c.start)}]** ${c.text}`).join('\n\n')}\n`;
  return `${title ? `${title}\n\n` : ''}${t.cues.map((c) => `[${short(c.start)}] ${c.text}`).join('\n')}\n`;
}
