/**
 * Recording a live stream (HLS): its playlist is read again every few seconds and each new
 * segment is fetched and stored, until the user stops it, the stream ends or the time asked
 * for is over. Then the file is made from what was stored, like any other stream.
 */
import { parseHls } from '../parsers/hls';
import type { TrackPlan } from '../shared/plan';
import { putPart, storedSizes } from '../shared/parts';
import { fetchAll, HttpError } from './fetcher';
import type { Pacer } from './pacer';

const stops = new Map<string, () => void>();

/** "Arrêter": the recording ends after the segment being fetched. */
export function stopLive(jobId: string): boolean {
  const stop = stops.get(jobId);
  stop?.();
  return !!stop;
}

const wait = (ms: number, signal: AbortSignal, stopped: Promise<void>) =>
  Promise.race([
    stopped,
    new Promise<void>((ok, ko) => {
      const t = setTimeout(ok, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        ko(signal.reason);
      }, { once: true });
    }),
  ]);

/** A live playlist's segments, from where the recording is, as long as it lasts. */
export async function recordLive(
  jobId: string,
  trackNo: number,
  track: TrackPlan,
  o: { signal: AbortSignal; pacer: Pacer; max: number; onBytes: (n: number) => void },
): Promise<void> {
  let stop!: () => void;
  let stopped = false;
  const stopping = new Promise<void>((ok) => (stop = () => ((stopped = true), ok())));
  // Several tracks of a job (picture, sound) stop together.
  const prev = stops.get(jobId);
  stops.set(jobId, () => {
    prev?.();
    stop();
  });
  const started = Date.now();
  // Carrying on after a restart: after what is stored.
  let index = (await storedSizes(jobId, trackNo)).size;
  const seen = new Set<string>();
  try {
    if (track.init && index === 0) {
      await fetchAll([track.init], [0], { signal: o.signal, pacer: o.pacer, onBytes: o.onBytes, onPart: (_, data) => putPart(jobId, trackNo, index++, data) });
    }
    let misses = 0;
    while (!stopped && Date.now() - started < o.max * 1000) {
      let text: string;
      try {
        const res = await fetch(track.live!, { credentials: 'include', cache: 'no-store', signal: o.signal });
        if (!res.ok) throw new HttpError(res.status);
        text = await res.text();
        misses = 0;
      } catch (e) {
        if (o.signal.aborted) throw e;
        // A playlist that can't be read a few times in a row: the stream is over.
        if (++misses >= 5) break;
        await wait(2000, o.signal, stopping);
        continue;
      }
      const parsed = parseHls(text, track.live!);
      if (parsed.type !== 'media') break;
      const fresh = parsed.segments.filter((s) => {
        const key = `${s.url}#${s.range?.join('-') ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (fresh.length) {
        const base = index;
        index += fresh.length;
        await fetchAll(fresh, fresh.map((_, i) => i), { signal: o.signal, pacer: o.pacer, onBytes: o.onBytes, onPart: (i, data) => putPart(jobId, trackNo, base + i, data) });
      }
      if (parsed.endList) break;
      // Half a segment's length between reads (a segment appears every one).
      const seg = parsed.segments[parsed.segments.length - 1]?.duration ?? 4;
      await wait(Math.min(10_000, Math.max(1000, seg * 500)), o.signal, stopping);
    }
  } finally {
    stops.delete(jobId);
  }
}
