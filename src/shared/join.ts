/**
 * "Assembler plusieurs vidéos": files put end to end. Copied as they are when they are alike
 * (same codecs, same picture size): instant and lossless. Otherwise each one is fitted to the
 * first one's picture (black bars, never stretched) and made again in H.264 and AAC.
 */

export interface MediaInfo {
  duration?: number;
  video?: { codec: string; width: number; height: number };
  audio?: { codec: string; rate?: number; channels?: number };
}

/** What ffmpeg says about one input (its first video and sound streams). */
export function mediaInfoIn(log: string): MediaInfo {
  const out: MediaInfo = {};
  const d = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(log);
  if (d) out.duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  // The cover picture of a sound file isn't a video.
  const v = /Stream #\d+:\d+[^\n]*?: Video: (\w+)[^\n]*?\b(\d{2,5})x(\d{2,5})\b(?![^\n]*attached pic)/.exec(log);
  if (v) out.video = { codec: v[1]!, width: Number(v[2]), height: Number(v[3]) };
  const a = /Stream #\d+:\d+[^\n]*?: Audio: (\w+)([^\n]*)/.exec(log);
  if (a) {
    const rate = /\b(\d{4,6}) Hz\b/.exec(a[2]!)?.[1];
    const layout = /, (mono|stereo|5\.1(?:\(side\))?|7\.1|\d+ channels)\b/.exec(a[2]!)?.[1];
    const ch = layout === 'mono' ? 1 : layout === 'stereo' ? 2 : layout?.startsWith('5.1') ? 6 : layout === '7.1' ? 8 : layout ? parseInt(layout, 10) : undefined;
    out.audio = { codec: a[1]!, ...(rate ? { rate: Number(rate) } : {}), ...(ch ? { channels: ch } : {}) };
  }
  return out;
}

/** Files that can be joined without being made again: same codecs, same picture size, all with sound or none. */
export function copyable(infos: MediaInfo[]): boolean {
  if (infos.length < 2) return true;
  const [a] = infos;
  return infos.every(
    (b) =>
      !!b.video === !!a!.video &&
      !!b.audio === !!a!.audio &&
      b.video?.codec === a!.video?.codec &&
      b.video?.width === a!.video?.width &&
      b.video?.height === a!.video?.height &&
      b.audio?.codec === a!.audio?.codec &&
      b.audio?.rate === a!.audio?.rate &&
      b.audio?.channels === a!.audio?.channels,
  );
}

/** The ffconcat list of files copied end to end. */
export function concatList(paths: string[]): string {
  return `ffconcat version 1.0\n${paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')}\n`;
}

/** A live stream's little file, and where it starts on the stream's clock. */
export interface LivePiece {
  path: string;
  start: number;
}

/**
 * The pieces of a live stream's track to keep: in order (a piece the player fetched again
 * after going back is left out), from the last one starting at `from` or before (where the
 * other track starts), so both tracks start together.
 */
export function livePieces<T extends LivePiece>(pieces: T[], from = -Infinity): T[] {
  const kept: T[] = [];
  for (const p of pieces) if (!kept.length || p.start > kept[kept.length - 1]!.start + 0.05) kept.push(p);
  let i = 0;
  while (i + 1 < kept.length && kept[i + 1]!.start <= from + 0.1) i++;
  return kept.slice(i);
}

/**
 * The pieces end to end: each one lasts until the next one starts. Their own lengths can't
 * be trusted (an MP4 piece counts its length from the start of the stream).
 */
export function liveList(pieces: LivePiece[]): string {
  const lines = ['ffconcat version 1.0'];
  pieces.forEach((p, i) => {
    lines.push(`file '${p.path.replace(/'/g, "'\\''")}'`);
    const next = pieces[i + 1];
    if (next) lines.push(`duration ${(next.start - p.start).toFixed(6)}`);
  });
  return `${lines.join('\n')}\n`;
}

/** Even, at most 1920 wide: the size every picture is fitted in. */
export function joinBox(infos: MediaInfo[]): { w: number; h: number } {
  const first = infos.find((i) => i.video)?.video;
  let w = first?.width ?? 1280;
  let h = first?.height ?? 720;
  if (w > 1920) {
    h = Math.round((h * 1920) / w);
    w = 1920;
  }
  return { w: w - (w % 2), h: h - (h % 2) };
}

/**
 * The ffmpeg run that makes everything again, end to end: every picture fitted in the box
 * (bars, same frame rate), every sound in stereo at 48 kHz (silence for a file without any).
 */
export function joinEncodeArgs(paths: string[], infos: MediaInfo[], out: string, o: { audioOnly: boolean; audioCodec: string[] }): string[] {
  const inputs = paths.flatMap((p) => ['-i', p]);
  const parts: string[] = [];
  const labels: string[] = [];
  const box = joinBox(infos);
  infos.forEach((info, i) => {
    if (!o.audioOnly) {
      if (info.video) {
        parts.push(`[${i}:v:0]scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease,pad=${box.w}:${box.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`);
      } else {
        // A sound file between videos: a black picture while it plays.
        parts.push(`color=c=black:s=${box.w}x${box.h}:r=30:d=${(info.duration ?? 1).toFixed(3)},format=yuv420p[v${i}]`);
      }
      labels.push(`[v${i}]`);
    }
    if (info.audio) parts.push(`[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    else parts.push(`anullsrc=r=48000:cl=stereo,atrim=0:${(info.duration ?? 1).toFixed(3)}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  const n = infos.length;
  const graph = `${parts.join(';')};${labels.join('')}concat=n=${n}:v=${o.audioOnly ? 0 : 1}:a=1${o.audioOnly ? '' : '[v]'}[a]`;
  return [
    '-y',
    ...inputs,
    '-filter_complex',
    graph,
    ...(o.audioOnly ? [] : ['-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']),
    '-map',
    '[a]',
    ...o.audioCodec,
    ...(out.endsWith('.mp4') || out.endsWith('.m4a') ? ['-movflags', '+faststart'] : []),
    out,
  ];
}
