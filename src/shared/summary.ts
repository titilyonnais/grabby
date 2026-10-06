/**
 * "Résumé et mots-clés", worked out on the computer from the video's subtitles: the sentences
 * that say the most (TextRank), the words that come back most, and chapters where the
 * subject changes when the video has none. Nothing leaves the browser.
 */
import type { Chapter } from './plan';
import type { Cue } from './subtitles';
import { isStopword, wordsOf } from './langs';

export interface Sentence {
  text: string;
  /** Where it is said, in seconds. */
  start: number;
}

/** The subtitles as sentences (cues joined, cut at the end of each sentence). */
export function sentencesOf(cues: Cue[]): Sentence[] {
  const out: Sentence[] = [];
  let text = '';
  let start = 0;
  const flush = () => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (wordsOf(t).length >= 3) out.push({ text: t, start });
    text = '';
  };
  for (const c of [...cues].sort((a, b) => a.start - b.start)) {
    // Automatic subtitles repeat the line before: only what is new.
    const raw = c.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw || text.endsWith(raw)) continue;
    const line = text ? raw.slice(overlap(text, raw)).trim() : raw;
    if (!line) continue;
    if (!text) start = c.start;
    text = text ? `${text} ${line}` : line;
    // A sentence ends with its punctuation; a very long run without any is cut anyway.
    const parts = text.split(/(?<=[.!?…])\s+/);
    if (parts.length > 1) {
      for (const p of parts.slice(0, -1)) {
        text = p;
        flush();
      }
      text = parts[parts.length - 1]!;
      start = c.start;
    }
    if (wordsOf(text).length > 45) flush();
  }
  flush();
  return out;
}

/** How much of `line`'s start repeats the end of `text`, in whole words (rolling captions). */
function overlap(text: string, line: string): number {
  const words = line.split(' ');
  for (let n = words.length; n > 0; n--) {
    const head = words.slice(0, n).join(' ');
    if (text === head || text.endsWith(` ${head}`)) return head.length;
  }
  return 0;
}

const content = (text: string, lang?: string) => wordsOf(text).filter((w) => w.length > 2 && !isStopword(w, lang) && !/^\d+$/.test(w));

/** The words that matter most: frequent in this text, not common words. */
export function keywords(text: string, lang?: string, n = 10): string[] {
  const count = new Map<string, number>();
  for (const w of content(text, lang)) count.set(w, (count.get(w) ?? 0) + 1);
  // Longer words carry more meaning at equal count.
  return [...count.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] * Math.log(b[0].length + 1) - a[1] * Math.log(a[0].length + 1) || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([w]) => w);
}

/** The `n` sentences that share the most with the others (TextRank), in the order they are said. */
export function summarize(sentences: Sentence[], n = 5, lang?: string): Sentence[] {
  if (sentences.length <= n) return sentences;
  // Long texts: the sentences are compared within a window around each one (else too slow).
  const list = sentences.slice(0, 1500);
  const words = list.map((s) => new Set(content(s.text, lang)));
  const N = list.length;
  const span = N > 400 ? 60 : N;
  const weights: Map<number, number>[] = list.map(() => new Map());
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < Math.min(N, i + span); j++) {
      const a = words[i]!;
      const b = words[j]!;
      if (a.size < 2 || b.size < 2) continue;
      let common = 0;
      for (const w of a) if (b.has(w)) common++;
      if (!common) continue;
      const w = common / (Math.log(a.size + 1) + Math.log(b.size + 1));
      weights[i]!.set(j, w);
      weights[j]!.set(i, w);
    }
  }
  const out = weights.map((m) => [...m.values()].reduce((x, y) => x + y, 0));
  let score = new Array<number>(N).fill(1);
  for (let it = 0; it < 30; it++) {
    const next = new Array<number>(N).fill(0.15);
    for (let i = 0; i < N; i++) for (const [j, w] of weights[i]!) if (out[j]) next[i]! += (0.85 * w * score[j]!) / out[j]!;
    score = next;
  }
  const picked = score
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.i)
    .sort((a, b) => a - b);
  return picked.map((i) => list[i]!);
}

/**
 * Chapters where the subject changes (the words of one stretch differ most from the next),
 * for a video long enough that has none: about one every 3 minutes, between 3 and 12. Each one
 * is named after its own keywords.
 */
export function proposeChapters(sentences: Sentence[], duration: number, lang?: string): Chapter[] {
  if (duration < 6 * 60 || sentences.length < 12) return [];
  const k = Math.max(3, Math.min(12, Math.round(duration / 180)));
  const gap = duration / (k * 2);
  // Words said in each slice of 20 seconds.
  const slice = 20;
  const slices: Map<string, number>[] = Array.from({ length: Math.ceil(duration / slice) }, () => new Map());
  for (const s of sentences) {
    const m = slices[Math.min(slices.length - 1, Math.floor(s.start / slice))]!;
    for (const w of content(s.text, lang)) m.set(w, (m.get(w) ?? 0) + 1);
  }
  const block = 4;
  const merged = (from: number, to: number) => {
    const m = new Map<string, number>();
    for (let i = Math.max(0, from); i < Math.min(slices.length, to); i++) for (const [w, c] of slices[i]!) m.set(w, (m.get(w) ?? 0) + c);
    return m;
  };
  const cosine = (a: Map<string, number>, b: Map<string, number>) => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (const [w, c] of a) {
      na += c * c;
      dot += c * (b.get(w) ?? 0);
    }
    for (const c of b.values()) nb += c * c;
    return na && nb ? dot / Math.sqrt(na * nb) : 1;
  };
  // How much each boundary between slices keeps the same subject (low: it changes there).
  const cuts = [];
  for (let i = 1; i < slices.length; i++) cuts.push({ at: i * slice, same: cosine(merged(i - block, i), merged(i, i + block)) });
  cuts.sort((a, b) => a.same - b.same);
  const chosen: number[] = [];
  for (const c of cuts) {
    if (chosen.length >= k - 1) break;
    if (c.at < gap || duration - c.at < gap) continue;
    if (chosen.some((x) => Math.abs(x - c.at) < gap)) continue;
    chosen.push(c.at);
  }
  const starts = [0, ...chosen.sort((a, b) => a - b)];
  // Each chapter starts with the sentence said there.
  return starts.map((at, i) => {
    const end = starts[i + 1] ?? duration;
    const said = sentences.filter((s) => s.start >= at && s.start < end);
    const first = said[0]?.start ?? at;
    const words = keywords(said.map((s) => s.text).join(' '), lang, 3);
    const title = words.length ? words.map((w, n) => (n ? w : w[0]!.toUpperCase() + w.slice(1))).join(', ') : `${i + 1}`;
    return { start: i === 0 ? 0 : Math.floor(first), title };
  });
}

/** "1:02:05", "4:09". */
export function clockText(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export interface SummaryWords {
  summary: string;
  keywords: string;
  chapters: string;
  proposed: string;
}

/** The text file: the summary (each sentence with where it is said), the keywords, the chapters. */
export function summaryText(title: string, o: { summary: Sentence[] | string; keywords: string[]; chapters: Chapter[]; proposed: boolean; words: SummaryWords }): string {
  const lines = [title, '='.repeat(Math.min(60, [...title].length || 1)), '', o.words.summary, ''];
  if (typeof o.summary === 'string') lines.push(o.summary.trim());
  else for (const s of o.summary) lines.push(`[${clockText(s.start)}] ${s.text}`);
  if (o.keywords.length) lines.push('', o.words.keywords, '', o.keywords.join(', '));
  if (o.chapters.length) {
    lines.push('', o.proposed ? o.words.proposed : o.words.chapters, '');
    for (const c of o.chapters) lines.push(`${clockText(c.start)} ${c.title}`);
  }
  return `${lines.join('\n')}\n`;
}
