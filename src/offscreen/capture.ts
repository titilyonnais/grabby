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
    if (c.init || !runs.length) runs.push([c]);
    else runs[runs.length - 1]!.push(c);
  }
  const size = (r: StoredChunk[]) => r.reduce((n, c) => n + c.data.byteLength, 0);
  return runs.filter((r) => r[0]!.init).sort((a, b) => size(b) - size(a))[0] ?? runs[0] ?? [];
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

export async function assembleCapture(jobId: string): Promise<CapturedTrack[]> {
  const tracks = await readTracks(jobId);
  return tracks
    .map((t) => ({
      mime: t.mime,
      kind: t.mime.toLowerCase().startsWith('audio/') ? ('audio' as const) : ('video' as const),
      data: concat(bestRun(t.chunks)),
    }))
    .filter((t) => t.data.byteLength > 0);
}
