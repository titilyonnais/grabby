import { readTracks, type StoredChunk } from '../shared/idb';

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

/** Rebuilds each recorded track; `keep` limits it to the tracks of the video itself. */
export async function assembleCapture(jobId: string, keep?: number[]): Promise<CapturedTrack[]> {
  const all = await readTracks(jobId);
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
      })),
    }),
  );
  return tracks
    .map((t) => ({
      mime: t.mime,
      kind: t.mime.toLowerCase().startsWith('audio/') ? ('audio' as const) : ('video' as const),
      data: concat(bestRun(t.chunks)),
    }))
    .filter((t) => t.data.byteLength > 0);
}
