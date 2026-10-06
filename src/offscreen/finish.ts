/**
 * What is done to a file once it is made, in order: subtitles written from the sound, then
 * translated, a summary, the picture and sound made again (editor, size, burned subtitles),
 * then one file per chapter. Each step that fails leaves the file as it was before it.
 */
import { LocalAi, builtinSummary } from '../ai/client';
import { ffmetadata } from '../shared/chapters';
import {
  canBurn,
  type FinishWord,
  chapterPieces,
  durationIn,
  encodeAttempts,
  FONT_DIR,
  FONT_FILE,
  hasSoundIn,
  heightIn,
  needsEncode,
  pieceArgs,
  pieceName,
  speedChapters,
  speedCues,
} from '../shared/finish';
import { CHAPTER_FORMATS } from '../shared/formats';
import { baseLang, guessLang } from '../shared/langs';
import type { Chapter, Plan } from '../shared/plan';
import { languageName } from '../shared/sublabels';
import { keywords, proposeChapters, sentencesOf, summarize, summaryText } from '../shared/summary';
import { toSrt, type Cue } from '../shared/subtitles';
import type { FFmpeg } from './muxer';

/** A subtitle track of the file, on its clock. */
export interface TextTrack {
  cues: Cue[];
  lang?: string;
  label: string;
  /** Saved next to the file rather than in it. */
  separate: boolean;
  /** Written by the local AI. */
  made?: 'transcribed' | 'translated';
}

export type FinishStep = 'model' | 'transcribe' | 'translate' | 'summary' | 'encode' | 'split';

export interface Finished {
  out: string;
  ext: string;
  /** Subtitles saved next to it (all of them again when the speed changed). */
  apart: { srt: string; lang?: string }[];
  notes: { text: string; tag: string }[];
  /** One file per chapter: the first is `out` (named `name`), these the others. */
  pieces?: { path: string; name: string }[];
  name?: string;
}

const own = (key: string, sub?: string) => (typeof chrome !== 'undefined' && chrome.i18n?.getMessage?.(key, sub)) || key;

/** What ffmpeg says about a file: its length, picture height, whether it has sound. */
export async function probe(f: FFmpeg, path: string, signal: AbortSignal): Promise<{ duration?: number; height?: number; sound: boolean }> {
  await f.exec(['-hide_banner', '-i', path], undefined, signal);
  const log = f.firstLogs();
  const duration = durationIn(log);
  const height = heightIn(log);
  return { ...(duration ? { duration } : {}), ...(height ? { height } : {}), sound: hasSoundIn(log) };
}

let fontIn: FFmpeg | null = null;
/** The subtitles' font, put once in each ffmpeg. */
async function loadFont(f: FFmpeg) {
  if (fontIn === f) return;
  const data = new Uint8Array(await (await fetch(chrome.runtime.getURL(`fonts/${FONT_FILE}`))).arrayBuffer());
  await f.mkdir(FONT_DIR).catch(() => {});
  await f.create(`${FONT_DIR}/${FONT_FILE}`);
  await f.append(`${FONT_DIR}/${FONT_FILE}`, data);
  fontIn = f;
}

async function write(f: FFmpeg, path: string, text: string) {
  await f.create(path);
  await f.append(path, new TextEncoder().encode(text));
}

export async function finishFile(
  f: FFmpeg,
  dir: string,
  made: { out: string; ext: string },
  o: {
    plan: Plan;
    texts: TextTrack[];
    apart: { srt: string; lang?: string }[];
    report: (step: FinishStep, progress: number) => void;
    signal: AbortSignal;
  },
): Promise<Finished> {
  const fin = o.plan.finish ?? {};
  const { signal } = o;
  const texts = [...o.texts];
  let apart = [...o.apart];
  const notes: Finished['notes'] = [];
  const title = o.plan.meta?.title ?? '';
  // The plan brings the words (an offscreen document can't read the extension's messages).
  const words = o.plan.words;
  const say = (key: FinishWord, sub?: string) => (words?.[key] ? words[key].replace('$1', sub ?? '') : own(key, sub));
  const langName = (code: string) => languageName(code, words?.lang);
  let info = await probe(f, made.out, signal);
  const ai = fin.transcribe || fin.translate ? new LocalAi() : null;
  const aiReport = (step: FinishStep) => (p: { stage: string; progress: number }) => o.report(p.stage === 'download' ? 'model' : step, p.progress);
  try {
    // 1. Subtitles from what is said.
    if (fin.transcribe && ai && info.sound) {
      o.report('transcribe', 0);
      const pcmPath = `${dir}/speech.f32`;
      const code = await f.exec(['-y', '-i', made.out, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', pcmPath], undefined, signal);
      if (signal.aborted) throw signal.reason;
      if (code === 0) {
        const bytes = (await f.read(pcmPath)).slice();
        const pcm = new Float32Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 4));
        try {
          const cues = await ai.transcribe(pcm, fin.transcribe, aiReport('transcribe'), signal);
          if (cues.length) {
            const lang = fin.transcribe !== 'auto' ? fin.transcribe : guessLang(cues.map((c) => c.text).join(' '));
            texts.push({ cues, ...(lang ? { lang } : {}), label: say('aiTranscript'), separate: true, made: 'transcribed' });
          }
        } catch (e) {
          if (signal.aborted) throw e;
          console.warn('[grabby] transcription failed', e);
        }
      }
    }

    // 2. Translated.
    if (fin.translate && ai) {
      const to = fin.translate;
      const src = [...texts].reverse().find((t) => t.cues.length && baseLang(t.lang ?? guessLang(t.cues.map((c) => c.text).join(' '))) !== baseLang(to));
      const from = src ? (src.lang ?? guessLang(src.cues.map((c) => c.text).join(' '))) : undefined;
      if (src && from) {
        o.report('translate', 0);
        try {
          const cues = await ai.translate(src.cues, from, to, aiReport('translate'), signal);
          if (cues?.length) texts.push({ cues, lang: to, label: say('aiTranslated', langName(to)), separate: true, made: 'translated' });
        } catch (e) {
          if (signal.aborted) throw e;
          console.warn('[grabby] translation failed', e);
        }
      }
    }
  } finally {
    ai?.stop();
  }

  // 3. A summary, keywords and (when it has none) chapters.
  let proposed: Chapter[] = [];
  if (fin.summary) {
    o.report('summary', 0);
    const src = texts.find((t) => t.made === 'translated') ?? texts.find((t) => t.made === 'transcribed') ?? texts.find((t) => t.cues.length);
    if (src?.cues.length) {
      const sentences = sentencesOf(src.cues);
      const all = sentences.map((s) => s.text).join(' ');
      const lang = baseLang(src.lang) ?? guessLang(all);
      const duration = info.duration ?? src.cues[src.cues.length - 1]!.end;
      const own = await builtinSummary(all, lang);
      proposed = o.plan.chapters?.length ? [] : proposeChapters(sentences, duration, lang);
      notes.push({
        tag: say('summaryTag'),
        text: summaryText(title || say('summaryTitle'), {
          summary: own ?? summarize(sentences, Math.max(4, Math.min(12, Math.round(duration / 120))), lang),
          keywords: keywords(all, lang, 12),
          chapters: o.plan.chapters?.length ? o.plan.chapters : proposed,
          proposed: !o.plan.chapters?.length,
          words: { summary: say('summaryHead'), keywords: say('summaryKeywords'), chapters: say('summaryChapters'), proposed: say('summaryProposed') },
        }),
      });
    }
    o.report('summary', 1);
  }
  const speed = fin.edit?.speed && fin.edit.speed !== 1 ? fin.edit.speed : 1;
  const chapters = o.plan.chapters?.length ? o.plan.chapters : proposed;

  // 4. Made again: the editor, a size, burned subtitles.
  if (needsEncode(fin)) {
    o.report('encode', 0);
    let burn: string | undefined;
    if (fin.burn) {
      const track = texts.find((t) => t.made === 'translated') ?? texts.find((t) => t.made === 'transcribed') ?? texts.find((t) => !t.made && t.cues.length);
      // A writing the font can't draw stays a subtitle track (boxes otherwise).
      if (track?.cues.length && canBurn(track.lang)) {
        await loadFont(f);
        burn = `${dir}/burn.srt`;
        await write(f, burn, toSrt(track.cues));
      }
    }
    let chapterFile: string | undefined;
    if (chapters.length && (speed !== 1 || proposed.length) && info.duration) {
      chapterFile = `${dir}/fin-chapters.txt`;
      await write(f, chapterFile, ffmetadata(speedChapters(chapters, speed), info.duration / speed));
    }
    const attempts = encodeAttempts({
      input: made.out,
      outBase: `${dir}/fin`,
      ext: made.ext,
      audioOnly: o.plan.audioOnly,
      sound: info.sound,
      ...(fin.edit ? { edit: fin.edit } : {}),
      ...(fin.compress && info.duration ? { compress: fin.compress, duration: info.duration } : {}),
      ...(info.height ? { height: info.height } : {}),
      ...(burn ? { burn } : {}),
      ...(chapterFile ? { chapters: chapterFile } : {}),
    });
    let done: { out: string; ext: string } | null = null;
    for (const a of attempts) {
      console.debug('[grabby] ffmpeg', a.args.join(' '));
      const code = await f.exec(a.args, (p) => o.report('encode', p), signal);
      if (signal.aborted) throw signal.reason;
      if (code === 0) {
        done = a;
        break;
      }
      console.warn('[grabby] finish attempt failed', a.args.join(' '), '\n', f.lastLogs());
    }
    if (!done) throw new Error('ffmpeg: not made again');
    made = done;
    info = await probe(f, made.out, signal);
  } else if (proposed.length && CHAPTER_FORMATS.has(made.ext) && info.duration) {
    // Proposed chapters put in the file (copied, nothing made again).
    const chapterFile = `${dir}/fin-chapters.txt`;
    await write(f, chapterFile, ffmetadata(proposed, info.duration));
    const out = `${dir}/chap.${made.ext}`;
    const code = await f.exec(['-y', '-i', made.out, '-i', chapterFile, '-map', '0', '-map_chapters', '1', '-c', 'copy', out], undefined, signal);
    if (code === 0) made = { out, ext: made.ext };
  }

  // Subtitles next to it: those of the AI; all of them when the speed changed (the file lost them).
  if (speed !== 1) apart = [];
  for (const t of texts) {
    if (!t.cues.length || (speed === 1 && !t.made)) continue;
    apart.push({ srt: toSrt(speedCues(t.cues, speed)), ...(t.lang ? { lang: t.lang } : {}) });
  }

  // 5. One file per chapter.
  if (fin.split && info.duration) {
    const pieces = chapterPieces(speedChapters(chapters, speed), info.duration);
    if (pieces.length >= 2) {
      const made2: { path: string; name: string }[] = [];
      for (const p of pieces) {
        o.report('split', (p.n - 1) / pieces.length);
        const path = `${dir}/piece${p.n}.${made.ext}`;
        const code = await f.exec(pieceArgs(made.out, path, p, pieces.length, { ...(title ? { album: title } : {}), ...(o.plan.meta?.artist ? { artist: o.plan.meta.artist } : {}) }), undefined, signal);
        if (signal.aborted) throw signal.reason;
        if (code !== 0) {
          console.warn('[grabby] chapter not cut', p.n, f.lastLogs());
          continue;
        }
        made2.push({ path, name: pieceName(p.n, pieces.length, p.title) });
      }
      if (made2.length >= 2) {
        return { out: made2[0]!.path, ext: made.ext, name: made2[0]!.name, pieces: made2.slice(1), apart, notes };
      }
    }
  }
  return { ...made, apart, notes };
}
