/**
 * What is done to a file once it is made, in order: the picture and sound made again (editor,
 * size, burned subtitles), then one file per chapter. Each step that fails leaves the file as
 * it was before it.
 */
import { ffmetadata } from '../shared/chapters';
import {
  canBurn,
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
import type { Plan } from '../shared/plan';
import { toSrt, type Cue } from '../shared/subtitles';
import type { FFmpeg } from './muxer';

/** A subtitle track of the file, on its clock. */
export interface TextTrack {
  cues: Cue[];
  lang?: string;
  label: string;
  /** Saved next to the file rather than in it. */
  separate: boolean;
}

export type FinishStep = 'encode' | 'split';

export interface Finished {
  out: string;
  ext: string;
  /** Subtitles saved next to it (all of them again when the speed changed). */
  apart: { srt: string; lang?: string }[];
  /** One file per chapter: the first is `out` (named `name`), these the others. */
  pieces?: { path: string; name: string }[];
  name?: string;
  /** The texts on the clock of the file made (its speed may have changed). */
  texts: TextTrack[];
}

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

/** The texts on the new clock of a file played faster or slower. */
const timed = (texts: TextTrack[], speed: number): TextTrack[] => (speed === 1 ? texts : texts.map((t) => ({ ...t, cues: speedCues(t.cues, speed) })));

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
  const title = o.plan.meta?.title ?? '';
  let info = await probe(f, made.out, signal);
  const speed = fin.edit?.speed && fin.edit.speed !== 1 ? fin.edit.speed : 1;
  const chapters = o.plan.chapters ?? [];

  // 1. Made again: the editor, a size, burned subtitles.
  if (needsEncode(fin)) {
    o.report('encode', 0);
    let burn: string | undefined;
    if (fin.burn) {
      const track = texts.find((t) => t.cues.length);
      // A writing the font can't draw stays a subtitle track (boxes otherwise).
      if (track?.cues.length && canBurn(track.lang)) {
        await loadFont(f);
        burn = `${dir}/burn.srt`;
        await write(f, burn, toSrt(track.cues));
      }
    }
    let chapterFile: string | undefined;
    if (chapters.length && speed !== 1 && info.duration) {
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
  }

  // Subtitles next to it: all of them again when the speed changed (the file lost them).
  if (speed !== 1) {
    apart = [];
    for (const t of texts) if (t.cues.length) apart.push({ srt: toSrt(speedCues(t.cues, speed)), ...(t.lang ? { lang: t.lang } : {}) });
  }

  // 2. One file per chapter.
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
        return { out: made2[0]!.path, ext: made.ext, name: made2[0]!.name, pieces: made2.slice(1), apart, texts: timed(texts, speed) };
      }
    }
  }
  return { ...made, apart, texts: timed(texts, speed) };
}
