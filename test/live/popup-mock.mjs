// Captures the popup in states that are hard to reach for real (a download halfway, several
// videos, the browser forcing "Save as"), with scrollbars visible:
//   node test/live/popup-mock.mjs
// Writes .debug/mock-<scheme>-<state>.png. The popup gets a made-up state instead of the
// service worker's: nothing is downloaded.
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXT = resolve(process.env.GRABBY_EXT ?? 'dist/store');
const userData = mkdtempSync(join(tmpdir(), 'grabby-mock-'));
const ctx = await chromium.launchPersistentContext(userData, {
  channel: 'chromium',
  headless: true,
  // Headless hides scrollbars by default: show them, they are part of the design.
  ignoreDefaultArgs: ['--hide-scrollbars'],
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=fr-FR'],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const extId = new URL(sw.url()).host;

const item = (id, title, kind, extra = {}) => ({
  id, tabId: 1, frameUrl: 'https://site.example/', pageUrl: 'https://site.example/v', kind, url: `https://cdn.example/${id}.mp4`,
  title, duration: 754, size: 2.6e8, variants: [], audioTracks: [], protection: 'none', live: false, detectedAt: 0, ...extra,
});
const items = [
  item('a', 'Reportage : la vie secrète des fonds marins', 'hls', {
    variants: [
      { id: 'v1', label: '1080p', url: 'u1', height: 1080, width: 1920, bandwidth: 4.5e6 },
      { id: 'v2', label: '720p', url: 'u2', height: 720, width: 1280, bandwidth: 2.4e6 },
    ],
  }),
  item('b', 'Bande-annonce officielle', 'file', { duration: 132, size: 4.1e7 }),
  item('c', 'Interview complète du réalisateur', 'dash', { duration: 1820, size: 6.3e8 }),
  item('d', 'Making-of', 'file', { duration: 410, size: 9.8e7 }),
  item('e', 'Extrait du concert', 'capture', { duration: 245 }),
];
const job = {
  id: 'j1', tabId: 1, mediaId: 'c', mode: 'video', status: 'downloading', progress: 0.42, bytes: 2.65e8, speed: 6.4e6,
  total: 6.3e8, totalApprox: true, filename: '', title: 'Interview', pageUrl: 'https://site.example/v', kind: 'dash', startedAt: Date.now(),
};
const settings = {
  theme: 'auto', videoFormat: 'mp4', audioFormat: 'm4a', notify: true, saveAs: false, subfolder: true,
  template: '{title} - {quality}', firstRunAck: true,
};
const state = { tabId: 1, pageUrl: 'https://site.example/v', items, jobs: [job], history: [], settings, browserAsks: true };

// Replace the port to the service worker with one that answers with the made-up state.
await ctx.addInitScript((s) => {
  if (!location.href.includes('popup.html')) return;
  chrome.runtime.connect = () => {
    const listeners = [];
    return {
      onMessage: { addListener: (f) => listeners.push(f) },
      onDisconnect: { addListener: () => {} },
      postMessage: (m) => m.type === 'subscribe' && setTimeout(() => listeners.forEach((f) => f({ type: 'state', state: s })), 50),
      disconnect: () => {},
    };
  };
}, state);

for (const scheme of ['light', 'dark']) {
  const popup = await ctx.newPage();
  await popup.emulateMedia({ colorScheme: scheme });
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=1`);
  await popup.waitForTimeout(700);
  const shot = (name) => popup.screenshot({ path: `.debug/mock-${scheme}-${name}.png` });
  await shot('liste');
  // Open the card whose download runs: its bar, its figures.
  await popup.getByText('Interview complète').click();
  await popup.waitForTimeout(300);
  await shot('telechargement');
  await popup.locator('.top__tools button').last().click();
  await popup.waitForTimeout(400);
  await shot('reglages');
  await popup.evaluate(() => document.querySelector('.page__body')?.scrollTo(0, 999));
  await popup.waitForTimeout(200);
  await shot('reglages-bas');
  await popup.close();
}
await ctx.close();
rmSync(userData, { recursive: true, force: true });
