/** Capture storage in the extension origin's IndexedDB (shared by sink, SW and offscreen). */
const DB = 'grabby-capture';
const CHUNKS = 'chunks';
const TRACKS = 'tracks';

export interface StoredChunk {
  jobId: string;
  track: number;
  seq: number;
  init: boolean;
  data: ArrayBuffer;
}

export interface StoredTrack {
  jobId: string;
  track: number;
  mime: string;
}

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((ok, ko) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(CHUNKS, { keyPath: ['jobId', 'track', 'seq'] });
      db.createObjectStore(TRACKS, { keyPath: ['jobId', 'track'] });
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

const jobRange = (jobId: string) => IDBKeyRange.bound([jobId], [jobId, []]);

export async function putChunk(c: StoredChunk, mime: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([CHUNKS, TRACKS], 'readwrite');
  tx.objectStore(CHUNKS).put(c);
  tx.objectStore(TRACKS).put({ jobId: c.jobId, track: c.track, mime } satisfies StoredTrack);
  await done(tx);
}

export async function readTracks(jobId: string): Promise<{ track: number; mime: string; chunks: StoredChunk[] }[]> {
  const db = await open();
  const tx = db.transaction([CHUNKS, TRACKS], 'readonly');
  const tracksReq = tx.objectStore(TRACKS).getAll(jobRange(jobId));
  const chunksReq = tx.objectStore(CHUNKS).getAll(jobRange(jobId));
  await done(tx);
  const chunks = chunksReq.result as StoredChunk[];
  return (tracksReq.result as StoredTrack[]).map((t) => ({
    track: t.track,
    mime: t.mime,
    chunks: chunks.filter((c) => c.track === t.track).sort((a, b) => a.seq - b.seq),
  }));
}

export async function listTrackMimes(jobId: string): Promise<{ track: number; mime: string }[]> {
  const db = await open();
  const tx = db.transaction(TRACKS, 'readonly');
  const req = tx.objectStore(TRACKS).getAll(jobRange(jobId));
  await done(tx);
  return (req.result as StoredTrack[]).map(({ track, mime }) => ({ track, mime }));
}

export async function deleteJob(jobId: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([CHUNKS, TRACKS], 'readwrite');
  tx.objectStore(CHUNKS).delete(jobRange(jobId));
  tx.objectStore(TRACKS).delete(jobRange(jobId));
  await done(tx);
}

/** Removes everything (startup cleanup of abandoned captures). */
export async function clearAll(): Promise<void> {
  const db = await open();
  const tx = db.transaction([CHUNKS, TRACKS], 'readwrite');
  tx.objectStore(CHUNKS).clear();
  tx.objectStore(TRACKS).clear();
  await done(tx);
}
