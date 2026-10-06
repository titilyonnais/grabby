/**
 * Work done in the full page itself, on files from the computer: the workshop (editor, size,
 * AI) and joining files. ffmpeg runs here, in a worker of this page; the result is saved
 * like any download.
 */
import { finishFile, probe, type FinishStep, type TextTrack } from '../offscreen/finish';
import { getFFmpeg, type FFmpeg } from '../offscreen/muxer';
import { sanitizeFilename } from '../shared/filename';
import { finishWords, type Finish } from '../shared/finish';
import { concatList, copyable, joinEncodeArgs, mediaInfoIn, type MediaInfo } from '../shared/join';
import type { Plan } from '../shared/plan';
import { cuesOf } from '../shared/subtitles';

/** Files up to this size are worked on (ffmpeg holds them in memory). */
export const MAX_LOCAL = 1.5e9;

const PIECE = 16 * 2 ** 20;

/** A file of the computer into ffmpeg's memory, a piece at a time. */
async function load(f: FFmpeg, path: string, file: Blob, signal: AbortSignal) {
  await f.create(path);
  for (let at = 0; at < file.size; at += PIECE) {
    if (signal.aborted) throw signal.reason;
    await f.append(path, new Uint8Array(await file.slice(at, at + PIECE).arrayBuffer()));
  }
}

const extOf = (name: string) => /\.([a-z0-9]{2,4})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
export const stemOf = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, '');

const AUDIO_EXT = new Set(['m4a', 'mp3', 'opus', 'ogg', 'flac', 'wav', 'aac', 'weba']);
export const isAudioFile = (file: File) => file.type.startsWith('audio/') || AUDIO_EXT.has(extOf(file.name));

const MIME: Record<string, string> = { mp4: 'video/mp4', mkv: 'video/x-matroska', mov: 'video/quicktime', ts: 'video/mp2t', webm: 'video/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', opus: 'audio/ogg', ogg: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav' };

export interface Output {
  blob: Blob;
  name: string;
}

let n = 0;

/** A folder of ffmpeg's memory for one piece of work, emptied afterwards. */
async function workspace<T>(fn: (f: FFmpeg, dir: string) => Promise<T>): Promise<T> {
  const f = getFFmpeg();
  f.users++;
  const dir = `/app${++n}`;
  try {
    await f.ready();
    await f.mkdir(dir);
    return await fn(f, dir);
  } finally {
    await f.rmdir(dir).catch(() => {});
    f.users--;
  }
}

/**
 * The workshop: a file of the computer, what the panel asks for done to it. `subs`: a subtitle
 * file to write into the picture or translate.
 */
export function runWorkshop(
  file: File,
  finish: Finish,
  o: { subs?: File; chromeAi?: boolean; report: (step: FinishStep | 'load', p: number) => void; signal: AbortSignal },
): Promise<Output[]> {
  return workspace(async (f, dir) => {
    o.report('load', 0);
    const ext = extOf(file.name) || 'mp4';
    const input = `${dir}/in.${ext}`;
    await load(f, input, file, o.signal);
    const info = await probe(f, input, o.signal);
    const audioOnly = isAudioFile(file) || (!/Video:/.test(f.firstLogs()) && info.sound);
    const texts: TextTrack[] = [];
    if (o.subs) {
      const bytes = new Uint8Array(await o.subs.arrayBuffer());
      const cues = cuesOf([bytes], 'vtt');
      const lang = /\.([a-z]{2,3})(?:-[A-Za-z]+)?\.(srt|vtt)$/i.exec(o.subs.name)?.[1];
      if (cues.length) texts.push({ cues, label: o.subs.name, separate: false, ...(lang ? { lang } : {}) });
    }
    const plan: Plan = { kind: 'file', output: (ext as Plan['output']) ?? 'mp4', raw: false, audioOnly, pageUrl: '', finish, ...(o.chromeAi ? { chromeAi: true } : {}), meta: { title: stemOf(file.name) }, words: finishWords((k, s) => chrome.i18n.getMessage(k, s), chrome.i18n.getUILanguage()) };
    const made = await finishFile(f, dir, { out: input, ext }, { plan, texts, apart: [], signal: o.signal, report: o.report });
    const stem = sanitizeFilename(`${stemOf(file.name)} (Grabby)`);
    const read = async (path: string, name: string): Promise<Output> => ({
      blob: new Blob([(await f.read(path)) as Uint8Array<ArrayBuffer>], { type: MIME[made.ext] ?? 'application/octet-stream' }),
      name,
    });
    const outs: Output[] = [];
    if (made.pieces?.length) {
      outs.push(await read(made.out, `${stem}/${sanitizeFilename(made.name ?? '01')}.${made.ext}`));
      for (const p of made.pieces) outs.push(await read(p.path, `${stem}/${sanitizeFilename(p.name)}.${made.ext}`));
    } else if (made.out !== input) {
      outs.push(await read(made.out, `${stem}.${made.ext}`));
    }
    const used = new Map<string, number>();
    for (const s of made.apart) {
      const lang = s.lang?.replace(/[^\w-]/g, '') ?? '';
      const k = (used.get(lang) ?? 0) + 1;
      used.set(lang, k);
      outs.push({ blob: new Blob([`﻿${s.srt}`], { type: 'application/x-subrip' }), name: `${stem}${lang ? `.${lang}` : ''}${k > 1 ? `.${k}` : ''}.srt` });
    }
    for (const note of made.notes) outs.push({ blob: new Blob([`﻿${note.text}`], { type: 'text/plain' }), name: `${stem}.${note.tag}.txt` });
    return outs;
  });
}

/** What each file is (for the list, and to know whether they can be copied end to end). */
export function describeFiles(files: File[], signal: AbortSignal): Promise<MediaInfo[]> {
  return workspace(async (f, dir) => {
    const out: MediaInfo[] = [];
    for (const [i, file] of files.entries()) {
      // The start of a file is enough to read what it holds (MP4s keep their index at the end: whole then).
      const path = `${dir}/p${i}.${extOf(file.name) || 'bin'}`;
      await load(f, path, file.size > 64 * 2 ** 20 && !/^(mp4|m4a|mov)$/.test(extOf(file.name)) ? file.slice(0, 64 * 2 ** 20) : file, signal);
      await f.exec(['-hide_banner', '-i', path], undefined, signal);
      out.push(mediaInfoIn(f.firstLogs()));
      await f.rmdir(dir).catch(() => {});
      await f.mkdir(dir);
    }
    return out;
  });
}

/** Files end to end in one: copied when they are alike, else made again. */
export function runJoin(files: File[], infos: MediaInfo[], o: { report: (p: number, copying: boolean) => void; signal: AbortSignal }): Promise<Output> {
  return workspace(async (f, dir) => {
    const paths: string[] = [];
    for (const [i, file] of files.entries()) {
      const path = `${dir}/j${i}.${extOf(file.name) || 'bin'}`;
      await load(f, path, file, o.signal);
      paths.push(path);
      o.report((i + 1) / files.length / 4, false);
    }
    const audioOnly = infos.every((i) => !i.video);
    const firstExt = extOf(files[0]!.name);
    const stem = sanitizeFilename(`${stemOf(files[0]!.name)} (${files.length})`);
    if (copyable(infos)) {
      const ext = firstExt || (audioOnly ? 'm4a' : 'mp4');
      const list = `${dir}/list.txt`;
      await f.create(list);
      await f.append(list, new TextEncoder().encode(concatList(paths)));
      const out = `${dir}/joined.${ext}`;
      const code = await f.exec(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0', '-c', 'copy', ...(ext === 'mp4' || ext === 'm4a' || ext === 'mov' ? ['-movflags', '+faststart'] : []), out], (p) => o.report(0.25 + p * 0.75, true), o.signal);
      if (o.signal.aborted) throw o.signal.reason;
      if (code === 0) return { blob: new Blob([(await f.read(out)) as Uint8Array<ArrayBuffer>], { type: MIME[ext] ?? 'application/octet-stream' }), name: `${stem}.${ext}` };
    }
    const ext = audioOnly ? (firstExt === 'mp3' ? 'mp3' : 'm4a') : 'mp4';
    const out = `${dir}/joined.${ext}`;
    const audioCodec = ext === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ['-c:a', 'aac', '-b:a', '160k'];
    const code = await f.exec(joinEncodeArgs(paths, infos, out, { audioOnly, audioCodec }), (p) => o.report(0.25 + p * 0.75, false), o.signal);
    if (o.signal.aborted) throw o.signal.reason;
    if (code !== 0) throw new Error(`ffmpeg: not joined\n${f.lastLogs()}`);
    return { blob: new Blob([(await f.read(out)) as Uint8Array<ArrayBuffer>], { type: MIME[ext] ?? 'application/octet-stream' }), name: `${stem}.${ext}` };
  });
}

/** Saves what was made in the downloads folder ("Grabby/…"), like any download. */
export async function save(outs: Output[]): Promise<void> {
  for (const o of outs) {
    const url = URL.createObjectURL(o.blob);
    try {
      const id = await chrome.downloads.download({ url, filename: `Grabby/${o.name}`, conflictAction: 'uniquify' });
      // Let go of the file once the browser has it.
      const done = (d: chrome.downloads.DownloadDelta) => {
        if (d.id !== id || !d.state || d.state.current === 'in_progress') return;
        chrome.downloads.onChanged.removeListener(done);
        URL.revokeObjectURL(url);
      };
      chrome.downloads.onChanged.addListener(done);
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }
}
