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

/** Container and codecs of a saved file, as ffprobe sees them (null without ffprobe). */
function probeFormat(file: string): { format: string; codecs: string[] } | null {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name:format=format_name', '-of', 'json', file], {
      encoding: 'utf8',
    });
    const j = JSON.parse(out) as { streams: { codec_name: string }[]; format: { format_name: string } };
    return { format: j.format.format_name, codecs: j.streams.map((s) => s.codec_name).sort() };
  } catch {
    return null;
  }
}

const completed = (sw: Worker) => sw.evaluate(async () => (await chrome.downloads.search({ state: 'complete' })).length);

/** Waits for one more completed download than `before` and returns the newest. */
async function nextDownload(sw: Worker, before: number): Promise<{ filename: string; bytes: Buffer }> {
  await expect.poll(() => completed(sw), { timeout: 60_000 }).toBeGreaterThan(before);
  return lastDownload(sw);
}

/** Records what Grabby asks chrome.downloads for (requested name, Save As). */
async function recordDownloads(sw: Worker) {
  await sw.evaluate(() => {
    const g = globalThis as unknown as { __asked: chrome.downloads.DownloadOptions[] };
    g.__asked = [];
    const real = chrome.downloads.download.bind(chrome.downloads);
    (chrome.downloads as { download: typeof real }).download = ((o: chrome.downloads.DownloadOptions) => {
      g.__asked.push(o);
      return real(o);
    }) as typeof real;
  });
  return () => sw.evaluate(() => (globalThis as unknown as { __asked: chrome.downloads.DownloadOptions[] }).__asked);
}

async function setSettings(sw: Worker, patch: Record<string, unknown>) {
  await sw.evaluate(async (p) => {
    const cur = ((await chrome.storage.local.get('settings')) as { settings?: object }).settings ?? {};
    await chrome.storage.local.set({ settings: { ...cur, ...p } });
  }, patch);
}

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

test('a player that only probes DRM support still offers its clear video', async ({ context, sw, extId }) => {
  const { page, tabId } = await openFixture(context, sw, 'drm-probe.html');
  await page.waitForSelector('body[data-ready="1"]');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
  await expect(popup.getByText(/encrypted by its publisher/)).toHaveCount(0);
});

test('a player that attaches DRM keys is shown as protected', async ({ context, sw, extId }) => {
  const { page, tabId } = await openFixture(context, sw, 'drm-keys.html');
  await page.waitForSelector('body[data-ready]');
  expect(await page.evaluate(() => document.body.dataset.ready)).toBe('keys');
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByText(/encrypted by its publisher/)).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
});

/** Picture size of a saved video, read by ffprobe (null when it isn't installed). */
function pictureSize(file: string): string | null {
  try {
    return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

test('a player offering several qualities gets one card with the choice', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'qualities.html');
  // Same video in two files: one card, one count.
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByRole('heading', { name: 'Sample: two qualities' })).toHaveCount(1);
  await expect(popup.getByRole('button', { name: /^Quality\s*360p/ })).toBeVisible();
  await pick(popup, 'Quality', '240p');
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible();
  const { bytes } = await lastDownload(sw);
  expect(bytes.length).toBe(readFileSync('test/fixtures/media/qualities/clip-240.mp4').length);
});

test('a smaller quality the site lacks is made by shrinking the picture', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'direct.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await pick(popup, 'Quality', '144p');
  await expect(popup.getByText(/shrinks the picture itself/)).toBeVisible();
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 90_000 });
  const { bytes, filename } = await lastDownload(sw);
  expect(isMp4(bytes)).toBe(true);
  const dims = pictureSize(filename);
  if (dims !== null) expect(dims).toBe('256x144');
  const info = probe(filename);
  if (info) expect(info.streams).toEqual(['audio', 'video']);
});

test('settings open as a full page; the file name is built from checkboxes', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'direct.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  // A page, not a sheet over the list: the video card is gone while settings show.
  await popup.getByRole('button', { name: 'Settings' }).click();
  await expect(popup.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(popup.getByRole('heading', { name: 'Sample: direct clip' })).toHaveCount(0);
  // Tick "Site": the saved template gains {site}.
  await popup.getByRole('checkbox', { name: 'Site' }).click();
  await expect
    .poll(async () => {
      const got = (await sw.evaluate(() => chrome.storage.local.get('settings'))) as { settings?: { template?: string } };
      return got.settings?.template;
    })
    .toBe('{title} - {site}');
  // Back returns to the list, same popup size.
  await popup.getByRole('button', { name: 'Back' }).click();
  await expect(popup.getByRole('heading', { name: 'Sample: direct clip' })).toBeVisible();
});

/** What each format must really be: magic bytes, and (with ffprobe) container and codecs. */
const FORMAT_CHECKS: Record<string, { magic: (b: Buffer) => boolean; format?: RegExp; codecs?: (c: string[]) => boolean }> = {
  MP4: { magic: (b) => isMp4(b) && !/^qt/.test(b.subarray(8, 12).toString('latin1')), format: /mp4/ },
  MKV: { magic: (b) => b.readUInt32BE(0) === 0x1a45dfa3, format: /matroska/ },
  WebM: { magic: (b) => b.readUInt32BE(0) === 0x1a45dfa3, format: /webm/, codecs: (c) => c.every((x) => /vp8|vp9|av1|opus|vorbis/.test(x)) },
  MOV: { magic: (b) => /^ftypqt/.test(b.subarray(4, 12).toString('latin1')), format: /mov/ },
  AVI: { magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'AVI ', format: /avi/ },
  TS: { magic: (b) => b[0] === 0x47, format: /mpegts/ },
  M4A: { magic: isMp4, codecs: (c) => c.length === 1 && c[0] === 'aac' },
  MP3: { magic: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || b[0] === 0xff, format: /mp3/, codecs: (c) => c[0] === 'mp3' },
  Opus: { magic: (b) => b.subarray(0, 4).toString('latin1') === 'OggS', codecs: (c) => c.length === 1 && c[0] === 'opus' },
  OGG: { magic: (b) => b.subarray(0, 4).toString('latin1') === 'OggS', codecs: (c) => c.length === 1 && c[0] === 'vorbis' },
  FLAC: { magic: (b) => b.subarray(0, 4).toString('latin1') === 'fLaC', codecs: (c) => c[0] === 'flac' },
  WAV: {
    magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE',
    codecs: (c) => /^pcm/.test(c[0] ?? ''),
  },
};

/** The formats the open card offers, in order. */
async function offeredFormats(popup: Page): Promise<string[]> {
  await popup.getByRole('button', { name: /^Format/ }).first().click();
  const texts = await popup.getByRole('option').allTextContents();
  await popup.keyboard.press('Escape');
  return texts.map((t) => Object.keys(FORMAT_CHECKS).find((k) => t.startsWith(k)) ?? t);
}

/** Every format the open card offers is downloaded and checked to be really that format. */
async function everyFormat(popup: Page, sw: Worker, expected: string[]) {
  const offered = await offeredFormats(popup);
  expect(offered).toEqual(expected);
  for (const fmt of offered) {
    const before = await completed(sw);
    await pick(popup, 'Format', fmt);
    await popup.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(popup.getByText('Saved'), `${fmt}: saved`).toBeVisible({ timeout: 60_000 });
    const { bytes, filename } = await nextDownload(sw, before);
    const check = FORMAT_CHECKS[fmt]!;
    expect(check.magic(bytes), `${fmt}: magic bytes`).toBe(true);
    const info = probeFormat(filename);
    if (info) {
      if (check.format) expect(info.format, `${fmt}: container`).toMatch(check.format);
      if (check.codecs) expect(check.codecs(info.codecs), `${fmt}: codecs ${info.codecs.join(',')}`).toBe(true);
    }
    // Back to the choices for the next one.
    await popup.getByRole('button', { name: 'Download again' }).click();
  }
}

test('every format offered for an MP4 video is really saved in that format', async ({ context, sw, extId }) => {
  test.setTimeout(300_000);
  const { tabId } = await openFixture(context, sw, 'direct.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await everyFormat(popup, sw, ['MP4', 'MKV', 'MOV', 'AVI', 'TS', 'M4A', 'MP3', 'Opus', 'OGG', 'FLAC', 'WAV']);
});

test('a WebM video can be saved as WebM, MP4 and MKV, and its sound in every audio format', async ({ context, sw, extId }) => {
  test.setTimeout(300_000);
  const { tabId } = await openFixture(context, sw, 'two.html');
  await expect.poll(() => badge(sw, tabId)).toBe('2');
  const popup = await openPopup(context, extId, tabId);
  // Open the card that offers WebM (the WebM file's).
  if (!(await offeredFormats(popup)).includes('WebM')) await popup.getByRole('button', { name: 'Show options' }).click();
  await everyFormat(popup, sw, ['MP4', 'WebM', 'MKV', 'M4A', 'MP3', 'Opus', 'OGG', 'FLAC', 'WAV']);
});

test('file options: Grabby folder, name parts, Save As and notification off', async ({ context, sw, extId }) => {
  const asked = await recordDownloads(sw);
  await setSettings(sw, { subfolder: true, template: '{site} - {title}', saveAs: false, notify: false, firstRunAck: true });
  const { page, tabId } = await openFixture(context, sw, 'direct.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible();
  let got = await asked();
  expect(got).toHaveLength(1);
  // "Sample: direct clip": the colon Windows refuses becomes a dash.
  expect(got[0]!.filename).toBe('Grabby/127.0.0.1 - Sample - direct clip.mp4');
  expect(got[0]!.saveAs).toBe(false);
  // Notifications off: no bubble in the page.
  await page.waitForTimeout(1500);
  await expect(page.locator('grabby-toast')).toHaveCount(0);

  // Other choices: no folder, title then date, Save As on (the request carries it).
  await setSettings(sw, { subfolder: false, template: '{title} - {date}', saveAs: true });
  await popup.getByRole('button', { name: 'Download again' }).click();
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(async () => (await asked()).length).toBe(2);
  got = await asked();
  expect(got[1]!.filename).toMatch(/^Sample - direct clip - \d{4}-\d{2}-\d{2}\.mp4$/);
  expect(got[1]!.saveAs).toBe(true);
});

test('cards unfold one at a time and fold back', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'two.html');
  await expect.poll(() => badge(sw, tabId)).toBe('2');
  const popup = await openPopup(context, extId, tabId);
  const cards = popup.locator('.card');
  await expect(cards).toHaveCount(2);
  // The first card is open (big), the other one is a row.
  await expect(cards.nth(0)).toHaveClass(/card--open/);
  await expect(cards.nth(1)).not.toHaveClass(/card--open/);
  await expect(popup.getByRole('button', { name: 'Download', exact: true })).toHaveCount(1);
  // Clicking the row opens it and closes the other.
  await cards.nth(1).locator('.card__head').click();
  await expect(cards.nth(1)).toHaveClass(/card--open/);
  await expect(cards.nth(0)).not.toHaveClass(/card--open/);
  await expect(popup.getByRole('button', { name: 'Download', exact: true })).toHaveCount(1);
  // Its chevron folds it back: no card open, no button.
  await cards.nth(1).getByRole('button', { name: 'Hide options' }).click();
  await expect(popup.locator('.card--open')).toHaveCount(0);
  await expect(popup.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
  // Once the animation is over, the card is a row again (nothing stuck halfway).
  await popup.waitForTimeout(1000);
  const h = await cards.nth(1).evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeLessThan(100);
});

test('the file name keeps at least one part; the title can be unticked', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'direct.html');
  const popup = await openPopup(context, extId, tabId);
  await popup.getByRole('button', { name: 'Settings' }).click();
  const template = async () =>
    ((await sw.evaluate(() => chrome.storage.local.get('settings'))) as { settings?: { template?: string } }).settings?.template;
  // Title + Quality, then untick Title: Quality alone.
  await popup.getByRole('checkbox', { name: 'Quality' }).click();
  await expect.poll(template).toBe('{title} - {quality}');
  await popup.getByRole('checkbox', { name: 'Title' }).click();
  await expect.poll(template).toBe('{quality}');
  await expect(popup.getByRole('checkbox', { name: 'Title' })).toHaveAttribute('aria-checked', 'false');
  // The last one refuses to go (it shakes) and stays ticked.
  await popup.getByRole('checkbox', { name: 'Quality' }).click();
  await expect(popup.getByRole('checkbox', { name: 'Quality' })).toHaveAttribute('aria-checked', 'true');
  expect(await template()).toBe('{quality}');
  // All four fit on one line.
  await popup.getByRole('checkbox', { name: 'Site' }).click();
  await popup.getByRole('checkbox', { name: 'Date' }).click();
  await popup.getByRole('checkbox', { name: 'Title' }).click();
  await expect.poll(template).toBe('{title} - {quality} - {site} - {date}');
  const tops = await popup.locator('.tile').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetTop));
  expect(new Set(tops).size).toBe(1);
});

test('restricted pages show an explanation instead of an empty list', async ({ context, sw, extId }) => {
  const page = await context.newPage();
  await page.goto('about:blank');
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'about:blank' }))[0]?.id ?? -1);
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByText('Nothing to see here')).toBeVisible();
});
