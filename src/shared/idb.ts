/** Capture storage in the extension origin's IndexedDB (shared by sink, SW and offscreen). */
const DB = 'grabby-capture';
const CHUNKS = 'chunks';
const TRACKS = 'tracks';

/**
 * A recording can be made of several sessions (paused, cut by a lost connection or a restart,
 * then carried on): each session's tracks are numbered from its own block.
 */
export const SESSION_SPAN = 100_000;
export const sessionOf = (track: number): number => Math.floor(track / SESSION_SPAN);
/**
 * The subtitles a player loaded while it was recorded (YouTube), stored like tracks: the
 * `k`-th language asked for in its own track, counted down from the end of the block.
 */
export const MAX_CAPTIONS = 16;
export const captionTrack = (k: number): number => SESSION_SPAN - 1 - k;
export const CAPTION_TRACK = captionTrack(0);
export const isCaptionTrack = (track: number): boolean => track % SESSION_SPAN >= SESSION_SPAN - MAX_CAPTIONS;
/** Which of the languages asked for a caption track holds. */
export const captionIndex = (track: number): number => SESSION_SPAN - 1 - (track % SESSION_SPAN);

/**
 * The tracks of the video itself, after a new report from a recording session: that report
 * replaces what its session said before. A hidden player that rebuilds itself starts its
 * recording over in new tracks; the abandoned ones must not end up in the file.
 */
export function mergeKeep(old: number[] | undefined, fresh: number[] | undefined): number[] {
  if (!fresh?.length) return old ?? [];
  const sessions = new Set(fresh.map(sessionOf));
  return [...(old ?? []).filter((t) => !sessions.has(sessionOf(t))), ...new Set(fresh)];
}


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

/** Several chunks in one transaction: much faster than one each while a player streams fast. */
export async function putChunks(list: { chunk: StoredChunk; mime: string }[]): Promise<void> {
  if (!list.length) return;
  const db = await open();
  const tx = db.transaction([CHUNKS, TRACKS], 'readwrite');
  const tracks = new Map<number, string>();
  for (const { chunk, mime } of list) {
    tx.objectStore(CHUNKS).put(chunk);
    tracks.set(chunk.track, mime);
  }
  for (const [track, mime] of tracks) tx.objectStore(TRACKS).put({ jobId: list[0]!.chunk.jobId, track, mime } satisfies StoredTrack);
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

/**
 * A track's init segment and its last chunks, `bytes` of them at most (to tell how far it got
 * without reading it all: enough for a few whole fragments, which can be big in high quality).
 */
export async function trackTail(jobId: string, track: number, bytes = 24 * 2 ** 20): Promise<{ init?: ArrayBuffer; last: StoredChunk[] }> {
  const db = await open();
  const tx = db.transaction(CHUNKS, 'readonly');
  const store = tx.objectStore(CHUNKS);
  const range = IDBKeyRange.bound([jobId, track], [jobId, track, []]);
  const first = store.get(IDBKeyRange.bound([jobId, track, 0], [jobId, track, 0]));
  const last: StoredChunk[] = [];
  let held = 0;
  const cursor = store.openCursor(range, 'prev');
  cursor.onsuccess = () => {
    const c = cursor.result;
    if (!c || held >= bytes) return;
    const chunk = c.value as StoredChunk;
    last.unshift(chunk);
    held += chunk.data.byteLength;
    if (chunk.init) return;
    c.continue();
  };
  await done(tx);
  const head = first.result as StoredChunk | undefined;
  const init = head?.init ? head.data : last.find((c) => c.init)?.data;
  return { ...(init ? { init } : {}), last: last.filter((c) => !c.init) };
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

/** Jobs that have recorded something (to drop what no job owns any more). */
export async function capturedJobs(): Promise<string[]> {
  const db = await open();
  const tx = db.transaction(TRACKS, 'readonly');
  const req = tx.objectStore(TRACKS).getAll();
  await done(tx);
  return [...new Set((req.result as StoredTrack[]).map((t) => t.jobId))];
}
