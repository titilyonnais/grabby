/**
 * Downloaded pieces of a job (stream segments, byte ranges of a file), kept on disk in the
 * extension's IndexedDB as they arrive. A paused, interrupted or restarted download picks
 * up from what is already there instead of starting over. Separate from the capture store,
 * which is wiped at every browser start.
 */
const DB = 'grabby-parts';
const PARTS = 'parts';

export interface Part {
  jobId: string;
  /** 0: video (or the only track), 1: audio. */
  track: number;
  index: number;
  size: number;
  data: Blob;
}

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((ok, ko) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(PARTS, { keyPath: ['jobId', 'track', 'index'] });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => {
      dbp = null;
      ko(req.error);
    };
  });
  return dbp;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, ko) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => ko(tx.error);
    tx.onabort = () => ko(tx.error);
  });
}

const trackRange = (jobId: string, track: number) => IDBKeyRange.bound([jobId, track], [jobId, track, []]);
const jobRange = (jobId: string) => IDBKeyRange.bound([jobId], [jobId, []]);

export async function putPart(jobId: string, track: number, index: number, data: Uint8Array<ArrayBuffer> | Blob): Promise<void> {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const db = await open();
  const tx = db.transaction(PARTS, 'readwrite');
  tx.objectStore(PARTS).put({ jobId, track, index, size: blob.size, data: blob } satisfies Part);
  await done(tx);
}

/** Index → size of every piece of a track already stored. */
export async function storedSizes(jobId: string, track: number): Promise<Map<number, number>> {
  const db = await open();
  const tx = db.transaction(PARTS, 'readonly');
  const out = new Map<number, number>();
  const req = tx.objectStore(PARTS).openCursor(trackRange(jobId, track));
  req.onsuccess = () => {
    const c = req.result;
    if (!c) return;
    const p = c.value as Part;
    out.set(p.index, p.size);
    c.continue();
  };
  await done(tx);
  return out;
}

/** A track's pieces in order (disk-backed Blobs: nothing is loaded in memory yet). */
export async function storedBlobs(jobId: string, track: number): Promise<Blob[]> {
  const db = await open();
  const tx = db.transaction(PARTS, 'readonly');
  const req = tx.objectStore(PARTS).getAll(trackRange(jobId, track));
  await done(tx);
  return (req.result as Part[]).sort((a, b) => a.index - b.index).map((p) => p.data);
}

export async function deleteParts(jobId: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(PARTS, 'readwrite');
  tx.objectStore(PARTS).delete(jobRange(jobId));
  await done(tx);
}

/** Jobs that have pieces stored (to drop those no job owns any more). */
export async function storedJobs(): Promise<string[]> {
  const db = await open();
  const tx = db.transaction(PARTS, 'readonly');
  const ids = new Set<string>();
  const req = tx.objectStore(PARTS).openKeyCursor();
  req.onsuccess = () => {
    const c = req.result;
    if (!c) return;
    ids.add((c.key as [string, number, number])[0]);
    c.continue();
  };
  await done(tx);
  return [...ids];
}
