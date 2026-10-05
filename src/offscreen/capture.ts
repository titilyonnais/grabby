import { captionIndex, isCaptionTrack, readTracks, sessionOf, type StoredChunk } from '../shared/idb';
import { storedEnd, untangle } from '../shared/mediatime';

export interface CapturedTrack {
  mime: string;
  kind: 'video' | 'audio';
  data: Uint8Array;
}

/**
 * Picks, for a recorded SourceBuffer, the longest run that starts with an init segment.
 * Players append a new init segment on quality switches; mixing runs would corrupt the file.
 */
export function bestRun(chunks: StoredChunk[]): StoredChunk[] {
  const runs: StoredChunk[][] = [];
  for (const c of chunks) {
    const run = runs[runs.length - 1];
    // Players often re-append an identical init (seek, buffer reset): same stream, keep going.
    if (run && c.init && sameBytes(run[0]!, c)) continue;
    if (c.init || !run) runs.push([c]);
    else run.push(c);
  }
  const size = (r: StoredChunk[]) => r.reduce((n, c) => n + c.data.byteLength, 0);
  return runs.filter((r) => r[0]!.init).sort((a, b) => size(b) - size(a))[0] ?? runs[0] ?? [];
}

function sameBytes(a: StoredChunk, b: StoredChunk): boolean {
  if (!a.init || a.data.byteLength !== b.data.byteLength) return false;
  const x = new Uint8Array(a.data);
  const y = new Uint8Array(b.data);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** Where a track's stored data ends, in seconds (diagnostics): read from its last 24 MB. */
function storedTo(mime: string, chunks: StoredChunk[]): number | undefined {
  const init = chunks.find((c) => c.init);
  if (!init) return undefined;
  const tail: Uint8Array[] = [];
  let held = 0;
  for (let i = chunks.length - 1; i >= 0 && held < 24 * 2 ** 20; i--) {
    if (chunks[i]!.init) break;
    tail.unshift(new Uint8Array(chunks[i]!.data));
    held += chunks[i]!.data.byteLength;
  }
  const end = storedEnd(mime, new Uint8Array(init.data), tail);
  return end === undefined ? undefined : Math.round(end * 100) / 100;
}

function concat(chunks: StoredChunk[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.data.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(new Uint8Array(c.data), off);
    off += c.data.byteLength;
  }
  return out;
}

/**
 * Rebuilds each recorded track, session by session (a recording paused or cut, then carried
 * on). `keep` limits a session to the tracks of the video itself when it names some of them.
 */
export async function assembleSessions(jobId: string, keep?: number[]): Promise<{ session: number; tracks: CapturedTrack[] }[]> {
  const all = (await readTracks(jobId)).filter((t) => !isCaptionTrack(t.track));
  const sessions = [...new Set(all.map((t) => sessionOf(t.track)))].sort((a, b) => a - b);
  const out: { session: number; tracks: CapturedTrack[] }[] = [];
  for (const n of sessions) {
    const own = keep?.filter((k) => sessionOf(k) === n) ?? [];
    const tracks = await assembleCapture(jobId, own, all.filter((t) => sessionOf(t.track) === n));
    if (tracks.length) out.push({ session: n, tracks });
  }
  return out;
}

/** The subtitles the recorded player loaded (the `k`-th language asked for): the most complete copy, if any. */
export async function capturedCaptions(jobId: string, k = 0): Promise<Uint8Array | null> {
  const copies = (await readTracks(jobId))
    .filter((t) => isCaptionTrack(t.track) && captionIndex(t.track) === k)
    .flatMap((t) => t.chunks.map((c) => new Uint8Array(c.data)));
  return copies.sort((a, b) => b.byteLength - a.byteLength)[0] ?? null;
}

/** Rebuilds each recorded track; `keep` limits it to the tracks of the video itself. */
export async function assembleCapture(jobId: string, keep?: number[], from?: Awaited<ReturnType<typeof readTracks>>): Promise<CapturedTrack[]> {
  const all = (from ?? (await readTracks(jobId))).filter((t) => !isCaptionTrack(t.track));
  const tracks = all.filter((t) => !keep?.length || keep.includes(t.track));
  // Diagnostic summary (visible in the offscreen document's console).
  console.debug(
    '[grabby] capture',
    JSON.stringify({
      jobId,
      keep,
      tracks: all.map((t) => ({
        track: t.track,
        mime: t.mime,
        chunks: t.chunks.length,
        mb: Math.round(t.chunks.reduce((n, c) => n + c.data.byteLength, 0) / 1e6),
        inits: t.chunks.filter((c) => c.init).length,
        kept: bestRun(t.chunks).length,
        to: storedTo(t.mime, t.chunks),
      })),
    }),
  );
  return tracks
    .map((t) => {
      const run = bestRun(t.chunks);
      return {
        mime: t.mime,
        kind: t.mime.toLowerCase().startsWith('audio/') ? ('audio' as const) : ('video' as const),
        // A player that went back appended part of the video twice: time must never go back.
        data: untangle(t.mime, concat(run), run[0]?.init ? run[0].data.byteLength : 0),
      };
    })
    .filter((t) => t.data.byteLength > 0);
}
