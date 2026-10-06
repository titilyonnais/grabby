/** "Coller une liste d'adresses": what each address is waiting for, and the addresses of a text. */

export type BatchMode = 'auto' | 'video' | 'audio';
export type BatchError = 'no_video' | 'protected' | 'live' | 'closed' | 'failed';

export interface BatchItem {
  id: string;
  url: string;
  mode: BatchMode;
  status: 'waiting' | 'opening' | 'started' | 'failed';
  added: number;
  title?: string;
  error?: BatchError;
  jobId?: string;
  /** While opening: its tab, until when it may look, and when a video first showed. */
  tabId?: number;
  until?: number;
  found?: number;
}

/** The addresses in a pasted text: http(s) ones, each once, in order. */
export function parseUrls(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;<>"']+/)) {
    const s = raw.trim().replace(/[).\]]+$/, '');
    if (!/^https?:\/\//i.test(s)) continue;
    try {
      const u = new URL(s);
      if (!out.includes(u.href)) out.push(u.href);
    } catch {
      /* not an address */
    }
  }
  return out;
}
