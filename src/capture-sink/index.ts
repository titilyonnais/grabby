/**
 * Hidden extension frame injected by the scanner during a capture. Receives recorded
 * buffers by postMessage (transferred, no copy) and stores them in the extension's
 * IndexedDB. Only accepts chunks for a job the service worker confirms is capturing.
 */
import { putChunk } from '../shared/idb';

let allowedJob: string | null = null;
let queue: Promise<void> = Promise.resolve();

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
    queue = queue.then(async () => {
      const ok = await chrome.runtime.sendMessage({ target: 'bg', type: 'sink-check', jobId }).catch(() => false);
      allowedJob = ok === true ? jobId : null;
    });
    return;
  }

  if (d.type === 'chunk') {
    const c = d as ChunkMsg;
    if (!(c.data instanceof ArrayBuffer) || !Number.isInteger(c.track) || !Number.isInteger(c.seq)) return;
    const origin = e.origin;
    queue = queue.then(async () => {
      if (c.jobId === allowedJob) {
        await putChunk({ jobId: c.jobId, track: c.track, seq: c.seq, init: !!c.init, data: c.data }, String(c.mime).slice(0, 200)).catch(() => {});
      }
      window.parent.postMessage({ grabbySink: 'ack' }, origin);
    });
  }
});

window.parent.postMessage({ grabbySink: 'ready' }, '*');
