import { youTubeIdOf } from '../shared/saved';
import type { BgToContent, BgToPopup, BlockedReason, ContentToBg, OffscreenToBg, PageMedia, PopupState, PopupToBg } from '../shared/messages';
import type { VideoFormat } from '../shared/plan';
import { getSettings, setSettings } from '../shared/settings';
import { cleanTitle } from '../shared/title';
import { hostOf } from '../parsers/url';
import { forgetBadge, paintTab, showJobs, updateBadge } from './badge';
import { createMenus } from './menus';
import { startDetector } from './detector';
import { resetHeaderRules } from './headers';
import { clearHistory, forgetTexts, getHistory, historyWithPresence, markHistory, removeHistory, restoreHistory } from './history';
import { forgetRedo, redo, redoIfWaiting } from './redo';
import { saveThumbnail } from './thumbnail';
import { findVisible } from './visible';
import { BROWSER_ASKS_KEY, JobManager, SCHEDULE_ALARM } from './jobs';
import { checkUpdate, installState, installUpdate, seenUpdate, UPDATE_ALARM, updateNotice, watchUpdates } from './updates';
import { listenNotificationClicks } from './notify';
import { handlePageInfo } from './pageinfo';
import { Registry, sessionKV } from './registry';
import { forgetTab, rememberTabUrl, samePage, tabUrl } from './tabs';
import { visibleItems } from './visible';
import { deleteJob, listTrackMimes, putChunk } from '../shared/idb';
import { pickFor, quickDownload } from './quick';
import { saveSnapshot } from './snapshot';
import { startSync } from './sync';
import { Batch, BATCH_ALARM } from './batch';
import { omniboxRequest } from '../shared/batch';

const registry = new Registry(sessionKV);
const jobs = new JobManager(registry);
// Pasted addresses: opened two at a time; every open page sees the list change.
const batch = new Batch(registry, jobs, () => pushAll());

// A new document replaced the page: recordings in that tab can't continue.
startDetector(registry, (tabId) => void jobs.onTabGone(tabId));
listenNotificationClicks();
// Settings shared with the user's other computers (when asked).
startSync();

chrome.runtime.onStartup.addListener(() => {
  void resetHeaderRules();
  void getSettings().then((s) => watchUpdates(s.updateCheck));
  // Pages being opened before the browser closed: given up, the next ones opened.
  void batch.pump();
});
chrome.runtime.onInstalled.addListener(({ reason }) => {
  // Installed or updated while pages are open: their old Grabby lost its extension (its buttons
  // under YouTube's player stopped). The page script goes back in, without reloading them.
  if (reason === 'install' || reason === 'update') void reinject();
  void resetHeaderRules();
  void getSettings().then((s) => watchUpdates(s.updateCheck));
  createMenus();
  // What Grabby no longer does (channels followed, videos kept for later): its timers and lists go.
  void chrome.alarms.clear('grabby-watch');
  void chrome.alarms.clear('grabby-later');
  void chrome.storage.local.remove(['watches', 'later', 'laterAt']);
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  const tabId = tab?.id ?? -1;
  void (async () => {
    if (id === 'link' || id === 'link_audio') {
      // The page behind the link is opened behind, its video downloaded, the tab closed.
      if (info.linkUrl) await batch.add(info.linkUrl, id === 'link' ? 'auto' : 'audio');
      return;
    }
    if (tabId < 0) return;
    await quickDownload(registry, jobs, tabId, id.startsWith('media') ? info.srcUrl : undefined, id === 'media_audio' ? 'audio' : undefined);
  })();
});

/** A short bubble in the page. */
async function toastIn(tabId: number, ok: boolean, title: string, detail: string) {
  await chrome.tabs.sendMessage(tabId, { type: 'toast', ok, title: chrome.i18n.getMessage(title), detail } satisfies BgToContent, { frameId: 0 }).catch(() => {});
}

/**
 * Grabby's page scripts, back into every open web page after an update: the player hook
 * first (marked as put back, so it takes over from the old version's), then the page script
 * that talks to it. Without the hook, a YouTube page would not say which video it shows.
 */
async function reinject() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => [] as chrome.tabs.Tab[]);
  for (const tab of tabs) {
    if (tab.id === undefined || tab.discarded) continue;
    const target = { tabId: tab.id, allFrames: true };
    void (async () => {
      await chrome.scripting
        .executeScript({ target, world: 'MAIN', func: () => void ((window as { __grabbyHookAgain?: boolean }).__grabbyHookAgain = true) })
        .then(() => chrome.scripting.executeScript({ target, world: 'MAIN', files: ['hook.js'] }))
        .catch(() => {});
      await chrome.scripting.executeScript({ target, files: ['scanner.js'] }).catch(() => {});
    })();
  }
}

// « gb » + a link in the address bar: its page opened behind, its video downloaded (« gb son … »: the sound).
chrome.omnibox?.setDefaultSuggestion({ description: chrome.i18n.getMessage('omniboxHint') });
chrome.omnibox?.onInputChanged.addListener((text, suggest) => {
  const { urls, mode } = omniboxRequest(text);
  if (urls.length) chrome.omnibox.setDefaultSuggestion({ description: chrome.i18n.getMessage(mode === 'audio' ? 'omniboxAudio' : 'omniboxVideo', String(urls.length)) });
  else chrome.omnibox.setDefaultSuggestion({ description: chrome.i18n.getMessage('omniboxHint') });
  suggest([]);
});
chrome.omnibox?.onInputEntered.addListener((text) => {
  const { urls, mode } = omniboxRequest(text);
  if (urls.length) void batch.add(urls.join('\n'), mode).then(() => pushAll());
});

// Keyboard shortcut: the page's best video, straight away.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'download-best' && command !== 'video-photo') return;
  void (async () => {
    const id = tab?.id ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
    if (id === undefined || id < 0) return;
    if (command === 'video-photo') return void chrome.tabs.sendMessage(id, { type: 'photo' } satisfies BgToContent).catch(() => {});
    await quickDownload(registry, jobs, id);
  })();
});
// A download waiting for the network tries again, even if the worker went to sleep meanwhile.
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'grabby-resume' || a.name === SCHEDULE_ALARM) void jobs.wake();
  if (a.name === UPDATE_ALARM) void checkUpdate();
  if (a.name === BATCH_ALARM) void batch.pump();
});
// Wi-Fi only: the connection changed (only some systems tell its type).
(navigator as Navigator & { connection?: EventTarget }).connection?.addEventListener?.('change', () => void jobs.wake());
// The connection is back: waiting downloads don't wait for their next try.
self.addEventListener('online', () => void jobs.wake(true));

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
      // Title and pictures belonged to the previous view: forget them and rescan.
      await registry.resetPageInfo(tabId);
      void chrome.tabs.sendMessage(tabId, { type: 'scan' }).catch(() => {});
    }
    pushTab(tabId);
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void batch.onTabRemoved(tabId);
  forgetTab(tabId);
  forgetRedo(tabId);
  void registry.remove(tabId);
  void jobs.onTabGone(tabId);
});

/* ------------------------------------------------------------- popups */

const ports = new Map<chrome.runtime.Port, number>();
const pushTimers = new Map<chrome.runtime.Port, ReturnType<typeof setTimeout>>();

function restrictedReason(url: string): BlockedReason | undefined {
  if (!/^https?:/i.test(url) || /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons)/.test(url)) {
    return 'restricted';
  }
  return undefined;
}

async function buildState(tabId: number): Promise<PopupState> {
  const pageUrl = await tabUrl(tabId);
  const blocked = restrictedReason(pageUrl);
  // An invalid id throws synchronously (not a rejected promise).
  const tab = await (async () => chrome.tabs.get(tabId))().catch(() => undefined);
  const tabTitle = tab?.title ? cleanTitle(tab.title, hostOf(tab.url ?? pageUrl)) : undefined;
  const [items, history, settings, asks, update, ytList] = await Promise.all([
    registry.get(tabId, tabTitle),
    historyWithPresence(),
    getSettings(),
    chrome.storage.local.get(BROWSER_ASKS_KEY),
    updateNotice().catch(() => undefined),
    blocked ? undefined : registry.ytList(tabId),
  ]);
  return {
    tabId,
    pageUrl,
    ...(blocked ? { blocked } : {}),
    items: blocked ? [] : visibleItems(items),
    // Every tab's: a download started elsewhere (or before a restart) is shown too.
    jobs: jobs.list(),
    history,
    settings,
    ...(asks[BROWSER_ASKS_KEY] ? { browserAsks: true } : {}),
    ...(update ? { update } : {}),
    ...(installState() ? { install: installState() } : {}),
    ...(ytList ? { ytList } : {}),
  };
}

const pushSeq = new WeakMap<chrome.runtime.Port, number>();

function schedulePush(port: chrome.runtime.Port) {
  if (pushTimers.has(port)) return;
  pushTimers.set(
    port,
    setTimeout(async () => {
      pushTimers.delete(port);
      const tabId = ports.get(port);
      if (tabId === undefined) return;
      // Two builds can overlap (a change lands while one is reading): only the one started
      // last — the freshest — is sent, or an older state would undo what the user just did.
      const seq = (pushSeq.get(port) ?? 0) + 1;
      pushSeq.set(port, seq);
      const state = await buildState(tabId);
      if (pushSeq.get(port) !== seq) return;
      const msg: BgToPopup = { type: 'state', state };
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

function pushAll() {
  for (const port of ports.keys()) schedulePush(port);
}

registry.onChange((tabId) => {
  void registry.get(tabId).then((items) => updateBadge(tabId, items));
  pushTab(tabId);
  // A page opened again from the history: its download starts once its video is found.
  void redoIfWaiting(tabId, registry, jobs);
  // One of the pasted addresses may have shown its video.
  void batch.onTab(tabId);
});

jobs.onChange(() => {
  for (const port of ports.keys()) schedulePush(port);
  showJobs(jobs.list());
});

// The browser was found asking where to save: open popups explain it right away.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && BROWSER_ASKS_KEY in changes) pushAll();
});

chrome.tabs.onActivated.addListener(({ tabId }) => void paintTab(tabId));
// A navigation resets the tab's badge: put the download progress back.
chrome.tabs.onUpdated.addListener((tabId, change) => change.status === 'loading' && void paintTab(tabId));
chrome.tabs.onRemoved.addListener((tabId) => forgetBadge(tabId));

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
      if (msg.tabId >= 0) chrome.tabs.sendMessage(msg.tabId, { type: 'scan' }).catch(() => {});
      return;
    case 'download': {
      const tabId = ports.get(port);
      if (tabId === undefined) return;
      const { type: _t, mediaId, variantId, mode, format, ...extra } = msg;
      await jobs.start(tabId, mediaId, variantId, mode, format, extra);
      return;
    }
    case 'download-list': {
      const tabId = ports.get(port);
      const list = tabId === undefined ? undefined : await registry.ytList(tabId);
      if (tabId !== undefined && list) await jobs.startList(tabId, list, msg.quality, msg.mode, msg.format);
      return;
    }
    case 'cancel':
      return jobs.cancel(msg.jobId);
    case 'pause':
      return jobs.pause(msg.jobId);
    case 'resume':
      return jobs.resume(msg.jobId);
    case 'reorder':
      return jobs.reorder(msg.jobId, msg.before);
    case 'pause-all':
      return jobs.pauseAll();
    case 'save-thumb': {
      const tabId = ports.get(port);
      const item = tabId === undefined ? undefined : findVisible(await registry.get(tabId), msg.mediaId);
      if (item) await saveThumbnail(item);
      return;
    }
    case 'resume-all':
      return jobs.resumeAll();
    case 'open-browser-downloads':
      // chrome://settings is Brave's, Edge's… settings too (each one redirects it).
      await chrome.tabs.create({ url: 'chrome://settings/downloads' });
      return;
    case 'finish-capture':
      return jobs.finishCapture(msg.jobId);
    case 'retry':
      return jobs.retry(msg.jobId);
    case 'start-now':
      return jobs.startNow(msg.jobId);
    case 'update-seen':
      await seenUpdate(msg.version);
      schedulePush(port);
      return;
    case 'update-install':
      await installUpdate(jobs.isBusy(), () => {
        for (const p of ports.keys()) schedulePush(p);
      });
      return;
    case 'dismiss':
      return jobs.dismiss(msg.jobId);
    case 'show':
      chrome.downloads.show(msg.downloadId);
      return;
    case 'open-shortcuts':
      // chrome://extensions/shortcuts is Brave's, Edge's… page too (each one redirects it).
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      return;
    case 'open-file':
      // Only a file Grabby saved, still where it was (the browser checks it).
      chrome.downloads.open(msg.downloadId);
      return;
    case 'redo': {
      const entry = (await getHistory()).find((e) => e.id === msg.id);
      if (entry) await redo(entry);
      return;
    }
    case 'clear-history':
      await clearHistory();
      schedulePush(port);
      return;
    case 'history-remove': {
      const ids = msg.ids.slice(0, 500);
      await removeHistory(ids);
      pushAll();
      // « Annuler » is offered a few seconds: after that, what was said in them goes too.
      setTimeout(() => void forgetTexts(ids), 30_000);
      return;
    }
    case 'history-restore':
      await restoreHistory(msg.entries.slice(0, 500));
      pushAll();
      return;
    case 'history-mark':
      await markHistory(msg.ids.slice(0, 500), msg.patch);
      pushAll();
      return;
    case 'settings':
      await setSettings(msg.patch);
      if (msg.patch.updateCheck !== undefined) {
        await watchUpdates(msg.patch.updateCheck);
        if (msg.patch.updateCheck) await checkUpdate();
      }
      schedulePush(port);
      return;
  }
}

/* --------------------------------------------- content scripts & offscreen */

chrome.runtime.onMessage.addListener((msg: ContentToBg | OffscreenToBg, sender, sendResponse) => {
  if ('target' in msg) {
    if (msg.target !== 'bg') return;
    if (msg.type === 'sink-check') {
      void (async () => {
        await jobs.ready;
        if (!jobs.isCapturing(msg.jobId)) return sendResponse(false);
        // The frame wrote a probe: when Grabby can't see it, the frame's storage is walled
        // off from the extension's (Brave keeps third-party frames apart): the recording
        // then goes through the port instead.
        if (typeof msg.probe !== 'string' || !/^probe-[\w-]{8,64}$/.test(msg.probe)) return sendResponse(true);
        const seen = (await listTrackMimes(msg.probe).catch(() => [])).length > 0;
        await deleteJob(msg.probe).catch(() => {});
        sendResponse(seen ? true : 'partitioned');
      })();
      return true;
    }
    void jobs.onOffscreenMessage(msg);
    return;
  }
  if (!sender.tab?.id) {
    // The hidden YouTube player lives in our offscreen document.
    const fromOffscreen = sender.id === chrome.runtime.id && !!sender.url?.startsWith('https://www.youtube.com/embed/');
    if (fromOffscreen && 'jobId' in msg) void jobs.onContentMessage(msg);
    return;
  }
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
    case 'grab':
      // The button over a video: that video, straight away.
      void quickDownload(registry, jobs, tabId, msg.src, msg.mode, msg.variantId);
      break;
    case 'snap':
      void (async () => {
        const item = pickFor(visibleItems(await registry.get(tabId)));
        const ok = !msg.noFrame && (await saveSnapshot(sender.tab!, msg, item));
        await toastIn(tabId, ok, ok ? 'photoSaved' : msg.noFrame ? 'photoNoFrame' : 'photoFailed', ok ? (item?.title ?? sender.tab?.title ?? '') : '');
        sendResponse(ok);
      })();
      return true;
    case 'page-jobs': {
      // The newest download of each kind for the video on screen (a YouTube tab changes video).
      const here = sender.tab.url ?? '';
      const id = youTubeIdOf(here);
      const mine = jobs
        .list()
        .filter((j) => j.tabId === tabId && (id ? youTubeIdOf(j.pageUrl) === id : j.pageUrl === here))
        .sort((a, b) => b.startedAt - a.startedAt);
      sendResponse(
        (['video', 'audio'] as const).flatMap((mode) => {
          const j = mine.find((x) => x.mode === mode);
          return j ? [{ mode, status: j.status, progress: j.progress, startedAt: j.startedAt }] : [];
        }),
      );
      break;
    }
    case 'page-media':
      void (async () => {
        const item = pickFor(visibleItems(await registry.get(tabId)));
        if (!item || item.audioOnly) return sendResponse(null);
        const settings = await getSettings();
        const format = item.formats?.includes(settings.videoFormat as never) || !item.formats ? settings.videoFormat : item.formats[0]!;
        const qualities = [...item.variants]
          .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0))
          .map((v) => {
            const told = v.sizes?.[format as VideoFormat] ?? v.size;
            const bytes = told || (v.bandwidth && item.duration ? Math.round((v.bandwidth * item.duration) / 8) : undefined);
            return { id: v.id, label: v.label, ...(bytes ? { bytes } : {}) };
          });
        sendResponse({ title: item.title, qualities, format, audioFormat: settings.audioFormat } satisfies PageMedia);
      })();
      return true;
    case 'open-grabby':
      // The popup, over this page; where Chrome refuses it, the side panel.
      void chrome.action.openPopup({ windowId: sender.tab.windowId }).catch(() => chrome.sidePanel.open({ tabId }).catch(() => {}));
      break;
    case 'show-download':
      // Only downloads Grabby made can be shown from a page.
      if (jobs.list().some((j) => j.downloadId === msg.downloadId)) chrome.downloads.show(msg.downloadId);
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
