import type { BgToOffscreen } from '../shared/messages';

const URL_PATH = 'offscreen.html';
const IDLE_CLOSE_MS = 60_000;

let creating: Promise<void> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

declare const self: ServiceWorkerGlobalScope;

async function hasOffscreen(): Promise<boolean> {
  const url = chrome.runtime.getURL(URL_PATH);
  // chrome.runtime.getContexts exists from Chrome 116; fall back to clients for 111–115.
  const rt = chrome.runtime as typeof chrome.runtime & {
    getContexts?: (f: { contextTypes: string[]; documentUrls: string[] }) => Promise<unknown[]>;
  };
  if (rt.getContexts) {
    return (await rt.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length > 0;
  }
  return (await self.clients.matchAll()).some((c) => c.url === url);
}

export async function ensureOffscreen(): Promise<void> {
  clearTimeout(idleTimer);
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: URL_PATH,
      reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.WORKERS],
      justification: 'Download stream segments and assemble them into a file with ffmpeg.wasm.',
    })
    .catch((e: unknown) => {
      // A concurrent caller may have created it first.
      if (!String(e).includes('single offscreen')) throw e;
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

export async function sendOffscreen(msg: BgToOffscreen): Promise<void> {
  await ensureOffscreen();
  await chrome.runtime.sendMessage(msg);
}

/** Closes the offscreen document after a quiet period (frees ffmpeg memory). */
export function scheduleOffscreenClose(isBusy: () => boolean): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (isBusy()) return;
    if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
  }, IDLE_CLOSE_MS);
}
