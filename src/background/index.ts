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

const registry = new Registry(sessionKV);
const jobs = new JobManager(registry);

startDetector(registry);

chrome.runtime.onStartup.addListener(() => void resetHeaderRules());
chrome.runtime.onInstalled.addListener(() => void resetHeaderRules());

/* ------------------------------------------------------------------ tabs */

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  void (async () => {
    const prev = await tabUrl(tabId);
    rememberTabUrl(tabId, change.url!);
    if (prev && !samePage(prev, change.url!)) await registry.clear(tabId);
    else pushTab(tabId);
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
  void registry.remove(tabId);
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

chrome.runtime.onMessage.addListener((msg: ContentToBg | OffscreenToBg, sender) => {
  if ('target' in msg) {
    if (msg.target === 'bg') void jobs.onOffscreenMessage(msg);
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
