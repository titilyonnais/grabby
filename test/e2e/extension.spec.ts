import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { startServer } from './server';

const EXT = resolve(process.env.GRABBY_EXT ?? 'dist/store');

interface Fixtures {
  context: BrowserContext;
  sw: Worker;
  extId: string;
  origin: string;
}

let server: Server;
let origin: string;

base.beforeAll(async () => {
  if (!existsSync(join(EXT, 'manifest.json'))) throw new Error('Run `npm run build` before the E2E tests.');
  ({ server, origin } = await startServer());
});
base.afterAll(() => server?.close());

const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userData = mkdtempSync(join(tmpdir(), 'grabby-e2e-'));
    const ctx = await chromium.launchPersistentContext(userData, {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      locale: 'en-US',
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required', '--lang=en-US'],
    });
    await use(ctx);
    await ctx.close();
    rmSync(userData, { recursive: true, force: true });
  },
  sw: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(sw);
  },
  extId: async ({ sw }, use) => use(new URL(sw.url()).host),
  // eslint-disable-next-line no-empty-pattern
  origin: async ({}, use) => use(origin),
});

async function openFixture(context: BrowserContext, sw: Worker, path: string): Promise<{ page: Page; tabId: number }> {
  const page = await context.newPage();
  const url = `${origin}/pages/${path}`;
  await page.goto(url);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id ?? -1, url);
  return { page, tabId };
}

async function badge(sw: Worker, tabId: number): Promise<string> {
  return sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
}

async function openPopup(context: BrowserContext, extId: string, tabId: number): Promise<Page> {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
  // Dismiss the first-run notice when present.
  const ok = popup.getByRole('button', { name: 'Got it' });
  if (await ok.isVisible().catch(() => false)) await ok.click();
  return popup;
}

/** Opens a drop-down list of the card ("Quality", "Format") and picks an option. */
async function pick(popup: Page, list: string, option: string) {
  await popup.getByRole('button', { name: new RegExp(`^${list}`) }).first().click();
  await popup.getByRole('option', { name: new RegExp(`^${option}`) }).click();
  await expect(popup.getByRole('button', { name: new RegExp(`^${list}\\s*${option}`) }).first()).toBeVisible();
}

/** Waits for the latest completed download and returns its bytes. */
async function lastDownload(sw: Worker): Promise<{ filename: string; bytes: Buffer }> {
  let item: chrome.downloads.DownloadItem | undefined;
  await expect
    .poll(
      async () => {
        item = await sw.evaluate(async () => (await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 }))[0]);
        return item?.state;
      },
      { timeout: 30_000 },
    )
    .toBe('complete');
  return { filename: item!.filename, bytes: readFileSync(item!.filename) };
}

function probe(file: string): { streams: string[]; duration: number } | null {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file], {
      encoding: 'utf8',
    });
    const j = JSON.parse(out) as { streams: { codec_type: string }[]; format: { duration: string } };
    return { streams: j.streams.map((s) => s.codec_type).sort(), duration: Number(j.format.duration) };
  } catch {
    return null; // ffprobe not installed: structural checks only
  }
}

const isMp4 = (b: Buffer) => b.subarray(4, 8).toString('latin1') === 'ftyp';

test('direct MP4: detected, badge shown, downloaded as a valid file', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'direct.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByRole('heading', { name: 'Sample: direct clip' })).toBeVisible();
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible();
  // Playwright stores downloads under GUID names: check the content; naming is unit-tested.
  const { bytes } = await lastDownload(sw);
  expect(isMp4(bytes)).toBe(true);
  expect(bytes.length).toBe(readFileSync('test/fixtures/media/sample.mp4').length);
});

test('Referer-protected file downloads thanks to header restoration', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'referer.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible();
  expect(isMp4((await lastDownload(sw)).bytes)).toBe(true);
});

test('HLS master: quality choice, segments assembled into MP4 with ffmpeg', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'hls.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await pick(popup, 'Quality', '180p');
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { bytes, filename } = await lastDownload(sw);
  expect(isMp4(bytes)).toBe(true);
  const info = probe(filename);
  if (info) {
    expect(info.streams).toEqual(['audio', 'video']);
    expect(info.duration).toBeGreaterThan(5);
  }
});

test('HLS audio only → M4A', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'hls-fmp4.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await pick(popup, 'Format', 'M4A');
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { bytes, filename } = await lastDownload(sw);
  expect(isMp4(bytes)).toBe(true);
  const info = probe(filename);
  if (info) expect(info.streams).toEqual(['audio']);
});

test('DASH: separate audio and video merged into MP4', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'dash.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { bytes, filename } = await lastDownload(sw);
  expect(isMp4(bytes)).toBe(true);
  const info = probe(filename);
  if (info) expect(info.streams).toEqual(['audio', 'video']);
});

test('encrypted HLS is shown as protected and never offered', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'aes.html');
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByText(/encrypted by its publisher/)).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
  expect(await badge(sw, tabId)).toBe('');
});

test('MSE player without manifest: playback is recorded and assembled', async ({ context, sw, extId }) => {
  const { page, tabId } = await openFixture(context, sw, 'mse.html');
  await page.waitForSelector('body[data-ready="1"]');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await popup.getByRole('button', { name: 'Record playback' }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { bytes, filename } = await lastDownload(sw);
  expect(isMp4(bytes)).toBe(true);
  const info = probe(filename);
  if (info) {
    expect(info.streams).toEqual(['audio', 'video']);
    expect(info.duration).toBeGreaterThan(4);
  }
});

test('encrypted MP4 file (DRM) is shown as protected and never offered', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'encrypted.html');
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByText(/encrypted by its publisher/)).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
  expect(await badge(sw, tabId)).toBe('');
});

test('hover previews (short muted loops) are not listed', async ({ context, sw, extId }) => {
  const { page, tabId } = await openFixture(context, sw, 'preview.html');
  await page.waitForFunction(() => (document.getElementById('teaser') as HTMLVideoElement).currentTime > 0.5);
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  // Let the scanner report the preview, then check it never shows up.
  await page.waitForTimeout(2500);
  expect(await badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByRole('button', { name: 'Download', exact: true })).toHaveCount(1);
  await expect(popup.getByText('Other videos on this page')).toHaveCount(0);
  const items = await sw.evaluate(async (id) => ((await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`] as { items: { url: string }[] }).items.map((i) => i.url), tabId);
  expect(items.some((u) => u.includes('teaser'))).toBe(false);
});

test('WebM (VP9/Opus) playback recorded and saved as MP4', async ({ context, sw, extId }) => {
  const { page, tabId } = await openFixture(context, sw, 'mse-webm.html');
  await page.waitForSelector('body[data-ready="1"]');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByRole('button', { name: /Format\s*MP4/ })).toBeVisible();
  await popup.getByRole('button', { name: 'Record playback' }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { bytes, filename } = await lastDownload(sw);
  expect(isMp4(bytes)).toBe(true);
  const info = probe(filename);
  if (info) {
    expect(info.streams).toEqual(['audio', 'video']);
    expect(info.duration).toBeGreaterThan(4);
  }
});

test('HLS saved as MOV; the page gets a "done" bubble and the icon a ✓', async ({ context, sw, extId }) => {
  const { page, tabId } = await openFixture(context, sw, 'hls.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await pick(popup, 'Format', 'MOV');
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  // The user goes back to their page while it downloads.
  await page.bringToFront();
  await expect(page.locator('grabby-toast')).toBeAttached({ timeout: 60_000 });
  expect(await badge(sw, tabId)).toBe('✓');
  const { bytes, filename } = await lastDownload(sw);
  expect(bytes.subarray(4, 12).toString('latin1')).toMatch(/^ftypqt/);
  const info = probe(filename);
  if (info) expect(info.streams).toEqual(['audio', 'video']);
});

test('DASH audio saved as FLAC', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'dash.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await pick(popup, 'Format', 'FLAC');
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { bytes } = await lastDownload(sw);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('fLaC');
});

test('linked files are found without a player; broken links and pages are not', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'links.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  await new Promise((r) => setTimeout(r, 1500));
  expect(await badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  // A WebM file saved as MP4 (the default format): converted without re-encoding the picture.
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { bytes, filename } = await lastDownload(sw);
  expect(isMp4(bytes)).toBe(true);
  const info = probe(filename);
  if (info) expect(info.streams).toEqual(['audio', 'video']);
});

test('a file without extension or media type is found; stream segments are not', async ({ context, sw }) => {
  const { page, tabId } = await openFixture(context, sw, 'opaque.html');
  await page.waitForSelector('body[data-ready="1"]');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  await page.waitForTimeout(1500);
  const urls = await sw.evaluate(async (id) => ((await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`] as { items: { url: string }[] }).items.map((i) => i.url), tabId);
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain('/opaque/clip');
});

test('restricted pages show an explanation instead of an empty list', async ({ context, sw, extId }) => {
  const page = await context.newPage();
  await page.goto('about:blank');
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'about:blank' }))[0]?.id ?? -1);
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByText('Nothing to see here')).toBeVisible();
});
