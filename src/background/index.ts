import type { BgToPopup, BlockedReason, ContentToBg, OffscreenToBg, PopupState, PopupToBg } from '../shared/messages';
import { isYouTubeUrl, youtubeBlocked } from '../shared/policy';
import { getSettings, setSettings } from '../shared/settings';
import { updateBadge } from './badge';
import { startDetector } from './detector';
import { resetHeaderRules } from './headers';
import { clearHistory, getHistory } from './history';
import { JobManager } from './jobs';
import { handlePageInfo } from './pageinfo';
import { Registry, sessionKV } from './registry';
import { forgetTab, rememberTabUrl, samePage, tabUrl } from './tabs';
import { visibleItems } from './visible';
import { clearAll, putChunk } from '../shared/idb';

const registry = new Registry(sessionKV);
const jobs = new JobManager(registry);

// A new document replaced the page: recordings in that tab can't continue.
startDetector(registry, (tabId) => void jobs.onTabGone(tabId));

chrome.runtime.onStartup.addListener(() => {
  void resetHeaderRules();
  // Captures never survive a browser restart: drop leftovers.
  void clearAll().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => void resetHeaderRules());

/* ------------------------------------------------------------------ tabs */

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  void (async () => {
    const prev = await tabUrl(tabId);
    rememberTabUrl(tabId, change.url!);
    // Full navigations are reset by the detector on the main_frame response. In-page (SPA)
    // navigations only change the URL: drop what was found before, keeping very recent
    // detections that may belong to the new view (events can arrive slightly out of order).
    if (prev && !samePage(prev, change.url!)) {
      const cutoff = Date.now() - 2000;
      await registry.removeWhere(tabId, (i) => i.detectedAt < cutoff);
    }
    pushTab(tabId);
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
  void registry.remove(tabId);
  void jobs.onTabGone(tabId);
});

/* ------------------------------------------------------------- popups */

const ports = new Map<chrome.runtime.Port, number>();
const pushTimers = new Map<chrome.runtime.Port, ReturnType<typeof setTimeout>>();

function restrictedReason(url: string): BlockedReason | undefined {
  if (youtubeBlocked() && isYouTubeUrl(url)) return 'youtube';
  if (!/^https?:/i.test(url) || /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons)/.test(url)) {
    return 'restricted';
  }
  return undefined;
}

async function buildState(tabId: number): Promise<PopupState> {
  const pageUrl = await tabUrl(tabId);
  const blocked = restrictedReason(pageUrl);
  const [items, history, settings] = await Promise.all([registry.get(tabId), getHistory(), getSettings()]);
  return {
    tabId,
    pageUrl,
    ...(blocked ? { blocked } : {}),
    items: blocked ? [] : visibleItems(items),
    jobs: jobs.list(tabId),
    history,
    settings,
  };
}

function schedulePush(port: chrome.runtime.Port) {
  if (pushTimers.has(port)) return;
  pushTimers.set(
    port,
    setTimeout(async () => {
      pushTimers.delete(port);
      const tabId = ports.get(port);
      if (tabId === undefined) return;
      const msg: BgToPopup = { type: 'state', state: await buildState(tabId) };
      try {
        port.postMessage(msg);
      } catch {
        ports.delete(port);
      }
    }, 120),
  );
}

function pushTab(tabId: number) {
  for (const [port, t] of ports) if (t === tabId) schedulePush(port);
}

registry.onChange((tabId) => {
  void registry.get(tabId).then((items) => updateBadge(tabId, items));
  pushTab(tabId);
});

jobs.onChange(() => {
  for (const port of ports.keys()) schedulePush(port);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup') return;
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    clearTimeout(pushTimers.get(port));
    pushTimers.delete(port);
  });
  port.onMessage.addListener((msg: PopupToBg) => void onPopupMessage(port, msg));
});

async function onPopupMessage(port: chrome.runtime.Port, msg: PopupToBg) {
  switch (msg.type) {
    case 'subscribe':
      ports.set(port, msg.tabId);
      schedulePush(port);
      // Ask every frame to report its <video> elements again (cheap, catches late players).
      chrome.tabs.sendMessage(msg.tabId, { type: 'scan' }).catch(() => {});
      return;
    case 'download': {
      const tabId = ports.get(port);
      if (tabId !== undefined) await jobs.start(tabId, msg.mediaId, msg.variantId, msg.mode);
      return;
    }
    case 'cancel':
      return jobs.cancel(msg.jobId);
    case 'finish-capture':
      return jobs.finishCapture(msg.jobId);
    case 'retry':
      return jobs.retry(msg.jobId);
    case 'dismiss':
      return jobs.dismiss(msg.jobId);
    case 'show':
      chrome.downloads.show(msg.downloadId);
      return;
    case 'clear-history':
      await clearHistory();
      schedulePush(port);
      return;
    case 'settings':
      await setSettings(msg.patch);
      schedulePush(port);
      return;
  }
}

/* --------------------------------------------- content scripts & offscreen */

chrome.runtime.onMessage.addListener((msg: ContentToBg | OffscreenToBg, sender, sendResponse) => {
  if ('target' in msg) {
    if (msg.target !== 'bg') return;
    if (msg.type === 'sink-check') {
      void jobs.ready.then(() => sendResponse(jobs.isCapturing(msg.jobId)));
      return true;
    }
    void jobs.onOffscreenMessage(msg);
    return;
  }
  if (!sender.tab?.id) return;
  const tabId = sender.tab.id;
  switch (msg.type) {
    case 'page-info':
      void handlePageInfo(registry, sender, msg.info);
      break;
    case 'drm':
      if (sender.url) void registry.markFrameDrm(tabId, sender.url);
      break;
    case 'capture-progress':
    case 'capture-done':
    case 'capture-error':
      void jobs.onContentMessage(msg);
      break;
  }
});

/* Capture fallback when a page blocks the hidden sink frame: chunks arrive base64-encoded. */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'capture') return;
  let queue = Promise.resolve();
  port.onMessage.addListener((m: { jobId: string; track: number; seq: number; mime: string; init: boolean; b64: string }) => {
    queue = queue.then(async () => {
      await jobs.ready;
      if (jobs.isCapturing(m.jobId) && Number.isInteger(m.track) && Number.isInteger(m.seq)) {
        const bin = atob(m.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await putChunk({ jobId: m.jobId, track: m.track, seq: m.seq, init: !!m.init, data: bytes.buffer }, String(m.mime).slice(0, 200)).catch(() => {});
      }
      try {
        port.postMessage({ ack: true });
      } catch {
        /* port closed */
      }
    });
  });
});
