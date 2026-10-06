/**
 * Hidden extension frame injected by the scanner during a capture. Receives recorded
 * buffers by postMessage (transferred, no copy) and stores them in the extension's
 * IndexedDB. Only accepts chunks for a job the service worker confirms is capturing.
 */
import { putChunk, putChunks, type StoredChunk } from '../shared/idb';

let allowedJob: string | null = null;
let queue: Promise<void> = Promise.resolve();

/**
 * Chunks waiting to be written. They are written together, one transaction for all that
 * came in meanwhile: a player recorded at high speed sends hundreds per second.
 */
let batch: { chunk: StoredChunk; mime: string; ack: () => void }[] = [];
let writing = false;
async function write() {
  if (writing) return;
  writing = true;
  try {
    while (batch.length) {
      const now = batch;
      batch = [];
      await putChunks(now.map(({ chunk, mime }) => ({ chunk, mime }))).catch(() => {});
      for (const b of now) b.ack();
    }
  } finally {
    writing = false;
  }
}

interface ChunkMsg {
  type: 'chunk';
  jobId: string;
  track: number;
  seq: number;
  mime: string;
  init: boolean;
  data: ArrayBuffer;
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window.parent) return;
  const d = e.data as { type?: string; jobId?: string } | null;
  if (!d || typeof d.jobId !== 'string') return;

  if (d.type === 'open') {
    const jobId = d.jobId;
    const target = e.origin === 'null' ? '*' : e.origin;
    queue = queue
      .then(async () => {
        // A probe the extension must be able to read back: this frame's storage may be
        // walled off from the extension's (Brave), and what it stored would be lost.
        const probe = `probe-${crypto.randomUUID()}`;
        await putChunk({ jobId: probe, track: 0, seq: 0, init: false, data: new ArrayBuffer(1) }, 'probe').catch(() => {});
        const ok = await chrome.runtime.sendMessage({ target: 'bg', type: 'sink-check', jobId, probe }).catch(() => false);
        allowedJob = ok === true ? jobId : null;
        window.parent.postMessage({ grabbySink: ok === true ? 'opened' : ok === 'partitioned' ? 'partitioned' : 'refused' }, target);
      })
      .catch(() => {});
    return;
  }

  if (d.type === 'chunk') {
    const c = d as ChunkMsg;
    if (!(c.data instanceof ArrayBuffer) || !Number.isInteger(c.track) || !Number.isInteger(c.seq)) return;
    // A sandboxed parent has an opaque origin ('null'), which isn't a valid target: acks
    // carry no data, so '*' is safe there.
    const target = e.origin === 'null' ? '*' : e.origin;
    const ack = () => window.parent.postMessage({ grabbySink: 'ack' }, target);
    // After the job check (queued behind it when the sink was just opened).
    void queue.then(() => {
      if (c.jobId !== allowedJob) return ack();
      batch.push({ chunk: { jobId: c.jobId, track: c.track, seq: c.seq, init: !!c.init, data: c.data }, mime: String(c.mime).slice(0, 200), ack });
      void write();
    });
  }
});

window.parent.postMessage({ grabbySink: 'ready' }, '*');
