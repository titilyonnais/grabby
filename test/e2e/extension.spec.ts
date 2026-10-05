import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { bigFile, bigStats, cutNetwork, startServer } from './server';

const EXT = resolve(process.env.GRABBY_EXT ?? 'dist');

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
  // Sound files: the sound, and the video's picture as their cover (M4A, MP3, FLAC).
  M4A: { magic: isMp4, codecs: (c) => c.includes('aac') && c.every((x) => /^(aac|mjpeg)$/.test(x)) },
  MP3: { magic: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || b[0] === 0xff, format: /mp3/, codecs: (c) => c.includes('mp3') && c.every((x) => /^(mp3|mjpeg)$/.test(x)) },
  Opus: { magic: (b) => b.subarray(0, 4).toString('latin1') === 'OggS', codecs: (c) => c.length === 1 && c[0] === 'opus' },
  OGG: { magic: (b) => b.subarray(0, 4).toString('latin1') === 'OggS', codecs: (c) => c.length === 1 && c[0] === 'vorbis' },
  FLAC: { magic: (b) => b.subarray(0, 4).toString('latin1') === 'fLaC', codecs: (c) => c.includes('flac') && c.every((x) => /^(flac|mjpeg)$/.test(x)) },
  WAV: {
    magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE',
    codecs: (c) => /^pcm/.test(c[0] ?? ''),
  },
  JPEG: { magic: (b) => b[0] === 0xff && b[1] === 0xd8, codecs: (c) => c.length === 1 && c[0] === 'mjpeg' },
  GIF: { magic: (b) => b.subarray(0, 6).toString('latin1') === 'GIF89a', format: /gif/ },
  WebP: { magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

/** The formats the open card offers, in order. */
async function offeredFormats(popup: Page): Promise<string[]> {
  await popup.getByRole('button', { name: /^Format/ }).first().click();
  const list = popup.getByRole('listbox');
  await expect(list).toBeVisible();
  // The list takes the focus: Escape closes it (and only it).
  await expect(list).toBeFocused();
  const texts = await popup.getByRole('option').allTextContents();
  await popup.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  return texts.map((t) => Object.keys(FORMAT_CHECKS).find((k) => t.startsWith(k)) ?? t);
}

/** Every format the open card offers is downloaded and checked to be really that format. */
async function everyFormat(popup: Page, sw: Worker, expected: string[]) {
  const offered = await offeredFormats(popup);
  expect(offered).toEqual(expected);
  for (const fmt of offered) {
    const before = await completed(sw);
    await pick(popup, 'Format', fmt);
    // A picture is saved, not downloaded.
    await popup.getByRole('button', { name: /^(Download|Save the picture|Save the animation)$/ }).click();
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
  await everyFormat(popup, sw, ['MP4', 'MKV', 'MOV', 'AVI', 'TS', 'M4A', 'MP3', 'Opus', 'OGG', 'FLAC', 'WAV', 'JPEG', 'GIF', 'WebP']);
});

test('a WebM video can be saved as WebM, MP4 and MKV, and its sound in every audio format', async ({ context, sw, extId }) => {
  test.setTimeout(300_000);
  const { tabId } = await openFixture(context, sw, 'two.html');
  await expect.poll(() => badge(sw, tabId)).toBe('2');
  const popup = await openPopup(context, extId, tabId);
  // Open the card that offers WebM (the WebM file's).
  if (!(await offeredFormats(popup)).includes('WebM')) {
    await popup.getByRole('button', { name: 'Show options' }).click();
    // Let the card finish unfolding (it may scroll into view).
    await expect(popup.locator('.card--open')).toHaveCount(1);
    await popup.waitForTimeout(1000);
  }
  await everyFormat(popup, sw, ['MP4', 'WebM', 'MKV', 'M4A', 'MP3', 'Opus', 'OGG', 'FLAC', 'WAV', 'JPEG', 'GIF', 'WebP']);
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

/* ------------------------------------------------------- speed, pause, resume */

/** Opens the big-file page and its popup, with the file listed. */
async function openBig(context: BrowserContext, sw: Worker, extId: string, q: string) {
  const { tabId } = await openFixture(context, sw, `big.html?${q}`);
  await expect.poll(() => badge(sw, tabId), { timeout: 20_000 }).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByRole('heading', { name: 'Sample: big file' })).toBeVisible();
  return popup;
}

const meterValue = (popup: Page) =>
  popup.getByRole('progressbar').getAttribute('aria-valuenow').then((v) => Number(v ?? 0)).catch(() => 0);

test('a big file comes in several ranges at once: faster than one connection, byte for byte', async ({ context, sw, extId }) => {
  // 24 MB at 1.5 MB/s per connection: 16 s over one, a few seconds over several.
  const popup = await openBig(context, sw, extId, 'name=fast&mb=24&rate=1500000');
  const before = await completed(sw);
  const t0 = Date.now();
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  const { bytes } = await nextDownload(sw, before);
  const took = Date.now() - t0;
  expect(bytes.equals(await bigFile(24))).toBe(true);
  expect(took).toBeLessThan(11_000);
  expect(bigStats.requests.get('/big/fast.mp4') ?? 0).toBeGreaterThan(4);
});

test('pause keeps what came in; resume carries on from there to the same file', async ({ context, sw, extId }) => {
  const popup = await openBig(context, sw, extId, 'name=pause&mb=32&rate=400000');
  const before = await completed(sw);
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(() => meterValue(popup), { timeout: 30_000 }).toBeGreaterThan(40);
  await popup.getByRole('button', { name: 'Pause' }).click();
  await expect(popup.getByText(/^Paused · \d+ %/).first()).toBeVisible();
  // Nothing more is fetched while paused.
  await popup.waitForTimeout(800);
  const sentAtPause = bigStats.sent.get('/big/pause.mp4') ?? 0;
  await popup.waitForTimeout(1500);
  expect((bigStats.sent.get('/big/pause.mp4') ?? 0) - sentAtPause).toBeLessThan(200_000);
  await popup.getByRole('button', { name: 'Resume' }).click();
  const { bytes } = await nextDownload(sw, before);
  const file = await bigFile(32);
  expect(bytes.equals(file)).toBe(true);
  // Taken up where it stopped: after the pause, much less than the whole file went over the wire.
  expect(bigStats.sent.get('/big/pause.mp4')! - sentAtPause).toBeLessThan(file.length * 0.9);
  await expect(popup.getByText('Saved')).toBeVisible();
});

test('a lost connection is waited out, then the download carries on by itself', async ({ context, sw, extId }) => {
  const popup = await openBig(context, sw, extId, 'name=cut&mb=12&rate=150000');
  const before = await completed(sw);
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(() => meterValue(popup), { timeout: 20_000 }).toBeGreaterThan(15);
  // Longer than the quick retries of each piece: the job itself has to wait and come back.
  cutNetwork(9_000);
  await expect(popup.getByText(/Connection lost/).first()).toBeVisible({ timeout: 15_000 });
  const { bytes } = await nextDownload(sw, before);
  expect(bytes.equals(await bigFile(12))).toBe(true);
});

test('a download cut by closing the browser carries on when it opens again', async () => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(join(tmpdir(), 'grabby-restart-'));
  const launch = () =>
    chromium.launchPersistentContext(userData, {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      locale: 'en-US',
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=en-US'],
    });
  const worker = async (c: BrowserContext) => c.serviceWorkers()[0] ?? (await c.waitForEvent('serviceworker'));
  let ctx: BrowserContext | undefined;
  try {
    ctx = await launch();
    let sw = await worker(ctx);
    const popup = await openBig(ctx, sw, new URL(sw.url()).host, 'name=restart&mb=16&rate=500000');
    await popup.getByRole('button', { name: 'Download', exact: true }).click();
    await expect.poll(() => meterValue(popup), { timeout: 30_000 }).toBeGreaterThan(25);
    const sentBefore = bigStats.sent.get('/big/restart.mp4') ?? 0;
    await ctx.close();

    ctx = await launch();
    sw = await worker(ctx);
    // No page, no popup: the job resumes on its own from what it had stored.
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.downloads.search({ state: 'complete' })).length), { timeout: 60_000 })
      .toBeGreaterThan(0);
    const { bytes } = await lastDownload(sw);
    const file = await bigFile(16);
    expect(bytes.equals(file)).toBe(true);
    expect(sentBefore).toBeGreaterThan(file.length * 0.2);
    expect(bigStats.sent.get('/big/restart.mp4')!).toBeLessThan(file.length * 1.4);
  } finally {
    await ctx?.close().catch(() => {});
    try {
      rmSync(userData, { recursive: true, force: true });
    } catch {
      /* Windows may hold the profile a moment longer */
    }
  }
});

test('download all: every video of the page ticked, one format, all saved', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'two.html');
  await expect.poll(() => badge(sw, tabId)).toBe('2');
  const popup = await openPopup(context, extId, tabId);
  const before = await completed(sw);
  await popup.getByRole('button', { name: 'Download all' }).click();
  await expect(popup.getByRole('checkbox', { checked: true })).toHaveCount(2);
  // Untick one, tick it back: both go.
  await popup.getByRole('checkbox').first().click();
  await expect(popup.getByRole('button', { name: 'Download (1)' })).toBeVisible();
  await popup.getByRole('checkbox').first().click();
  await pick(popup, 'Format', 'MKV');
  await popup.getByRole('button', { name: 'Download (2)' }).click();
  await expect.poll(() => completed(sw), { timeout: 60_000 }).toBe(before + 2);
  const files = await sw.evaluate(async () => (await chrome.downloads.search({ state: 'complete' })).map((d) => d.filename));
  for (const f of files.slice(-2)) expect(probeFormat(f)?.format ?? 'matroska,webm').toContain('matroska');
});

/** Opens "Cut a clip" and types the two times of the part. */
async function cutClip(popup: Page, start: string, end: string) {
  await popup.getByRole('button', { name: 'Cut a clip' }).click();
  for (const [name, value] of [['End', end], ['Start', start]] as const) {
    const field = popup.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }
  await expect(popup.getByRole('slider', { name: 'Start' })).toHaveAttribute('aria-valuetext', start);
  await expect(popup.getByRole('slider', { name: 'End' })).toHaveAttribute('aria-valuetext', end);
}

for (const [page, label] of [
  ['hls.html', 'HLS'],
  ['dash.html', 'DASH'],
  ['direct.html', 'a file'],
] as const) {
  test(`a clip of ${label}: only that part is saved, named after it`, async ({ context, sw, extId }) => {
    const { tabId } = await openFixture(context, sw, page);
    await expect.poll(() => badge(sw, tabId)).toBe('1');
    const asked = await recordDownloads(sw);
    const popup = await openPopup(context, extId, tabId);
    await cutClip(popup, '0:03', '0:05');
    await popup.getByRole('button', { name: 'Download clip' }).click();
    await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
    const { bytes, filename } = await lastDownload(sw);
    expect(isMp4(bytes)).toBe(true);
    expect((await asked()).at(-1)?.filename).toContain('(0m03-0m05).mp4');
    const info = probe(filename);
    // Two seconds asked, cut at a keyframe: a little more at most, never the whole 6 s.
    if (info) {
      expect(info.duration).toBeGreaterThan(1.5);
      expect(info.duration).toBeLessThan(4.5);
    }
  });
}

/** The saved video and the .srt next to it (if any), once both are complete. */
async function videoAndSrt(sw: Worker, withSrt: boolean): Promise<{ video: string; srt: string | null }> {
  const list = () =>
    sw.evaluate(async () =>
      (await chrome.downloads.search({ state: 'complete', orderBy: ['-startTime'] })).map((d) => ({ file: d.filename, srt: d.url.startsWith('data:application/x-subrip') })),
    );
  await expect.poll(async () => (await list()).some((d) => d.srt) || !withSrt, { timeout: 30_000 }).toBe(true);
  const all = await list();
  const srt = all.find((d) => d.srt);
  return { video: all.find((d) => !d.srt)!.file, srt: srt ? readFileSync(srt.file, 'utf8').replace(/^﻿/, '') : null };
}

/** The subtitles inside a video, as SubRip (null without ffmpeg). */
function embeddedSrt(file: string): string | null {
  try {
    return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:s:0', '-f', 'srt', '-'], { encoding: 'utf8' });
  } catch {
    return null;
  }
}

const lines = (srt: string) => srt.split(/\r?\n/).filter((l) => l && !/^\d+$/.test(l));

for (const [page, format, label, track] of [
  ['hls.html', 'MP4', 'HLS in MP4', 'Français'],
  ['dash.html', 'MKV', 'DASH in MKV', 'French'],
] as const) {
  test(`subtitles of ${label}: put in the video, each line once`, async ({ context, sw, extId }) => {
    const { tabId } = await openFixture(context, sw, page);
    await expect.poll(() => badge(sw, tabId)).toBe('1');
    const popup = await openPopup(context, extId, tabId);
    await pick(popup, 'Format', format);
    await pick(popup, 'Subtitles', track);
    await popup.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
    const { video, srt } = await videoAndSrt(sw, false);
    expect(srt).toBeNull();
    const info = probe(video);
    if (info) expect(info.streams).toEqual(['audio', 'subtitle', 'video']);
    const inside = embeddedSrt(video);
    if (inside !== null) {
      expect(lines(inside)).toEqual([
        '00:00:00,500 --> 00:00:01,800',
        'Bonjour',
        '00:00:02,500 --> 00:00:03,800',
        '<i>le monde</i>',
        '00:00:03,900 --> 00:00:04,600',
        'Au revoir',
        '00:00:05,000 --> 00:00:05,800',
        'Fin',
      ]);
    }
  });
}

test('subtitles a format can not hold are saved next to it, as .srt named after the video', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'hls.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const asked = await recordDownloads(sw);
  const popup = await openPopup(context, extId, tabId);
  await pick(popup, 'Format', 'TS');
  await pick(popup, 'Subtitles', 'Français');
  const apart = popup.getByRole('switch', { name: 'In a separate .srt file' });
  await expect(apart).toBeChecked();
  await expect(apart).toBeDisabled();
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { srt } = await videoAndSrt(sw, true);
  expect(lines(srt!)).toEqual([
    '00:00:00,500 --> 00:00:01,800',
    'Bonjour',
    '00:00:02,500 --> 00:00:03,800',
    '<i>le monde</i>',
    '00:00:03,900 --> 00:00:04,600',
    'Au revoir',
    '00:00:05,000 --> 00:00:05,800',
    'Fin',
  ]);
  const names = (await asked()).map((o) => o.filename ?? '');
  expect(names.some((n) => n.endsWith('.ts'))).toBe(true);
  expect(names.some((n) => n.endsWith('.fr.srt'))).toBe(true);
});

test('a clip with its subtitles: only the lines of the part, from zero', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'dash.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await pick(popup, 'Subtitles', 'French');
  await popup.getByRole('switch', { name: 'In a separate .srt file' }).check();
  await cutClip(popup, '0:03', '0:05');
  await popup.getByRole('button', { name: 'Download clip' }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { video, srt } = await videoAndSrt(sw, true);
  // The copied picture starts on the keyframe before the part (at 2 s): the lines too.
  expect(lines(srt!)).toEqual(['00:00:00,500 --> 00:00:01,800', '<i>le monde</i>', '00:00:01,900 --> 00:00:02,600', 'Au revoir']);
  const info = probe(video);
  if (info) expect(info.streams).toEqual(['audio', 'video']);
});

const ALL_LINES = [
  '00:00:00,500 --> 00:00:01,800',
  'Bonjour',
  '00:00:02,500 --> 00:00:03,800',
  '<i>le monde</i>',
  '00:00:03,900 --> 00:00:04,600',
  'Au revoir',
  '00:00:05,000 --> 00:00:05,800',
  'Fin',
];

test('a file with a <track>: its subtitles are put in the video', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'track.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await pick(popup, 'Subtitles', 'Français');
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { video, srt } = await videoAndSrt(sw, false);
  expect(srt).toBeNull();
  const info = probe(video);
  if (info) expect(info.streams).toEqual(['audio', 'subtitle', 'video']);
  const inside = embeddedSrt(video);
  if (inside !== null) expect(lines(inside)).toEqual(ALL_LINES);
});

for (const [track, form] of [
  ['German', 'WebVTT packed in MP4 (wvtt)'],
  ['Spanish', 'TTML packed in MP4 (stpp)'],
  ['Italian', 'a TTML file'],
] as const) {
  test(`DASH subtitles in ${form} are read, each line once`, async ({ context, sw, extId }) => {
    const { tabId } = await openFixture(context, sw, 'dash-packed.html');
    await expect.poll(() => badge(sw, tabId)).toBe('1');
    const popup = await openPopup(context, extId, tabId);
    await pick(popup, 'Subtitles', track);
    await popup.getByRole('switch', { name: 'In a separate .srt file' }).check();
    await popup.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
    const { srt } = await videoAndSrt(sw, true);
    expect(lines(srt!)).toEqual(ALL_LINES);
  });
}

test('a clip of a recorded player, with the subtitles of its <track>', async ({ context, sw, extId }) => {
  const { page, tabId } = await openFixture(context, sw, 'mse-track.html');
  await page.waitForSelector('body[data-ready="1"]');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await pick(popup, 'Subtitles', 'Français');
  await popup.getByRole('switch', { name: 'In a separate .srt file' }).check();
  await cutClip(popup, '0:02', '0:05');
  await popup.getByRole('button', { name: 'Record the clip' }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { video, srt } = await videoAndSrt(sw, true);
  expect(lines(srt!)).toEqual(['00:00:00,500 --> 00:00:01,800', '<i>le monde</i>', '00:00:01,900 --> 00:00:02,600', 'Au revoir']);
  const info = probe(video);
  if (info) {
    expect(info.streams).toEqual(['audio', 'video']);
    expect(info.duration).toBeGreaterThan(2);
    expect(info.duration).toBeLessThan(4.5);
  }
});

test('a recording can be paused and resumed: both parts end up in one file', async ({ context, sw, extId }) => {
  // A player that fetches its segments as playback goes, slowly: the recording takes a while.
  const { page, tabId } = await openFixture(context, sw, 'mse-slow.html');
  await page.waitForSelector('body[data-ready="1"]');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  const before = await completed(sw);
  await popup.getByRole('button', { name: 'Record playback' }).click();
  await expect.poll(() => meterValue(popup), { timeout: 30_000 }).toBeGreaterThan(15);
  await popup.getByRole('button', { name: 'Pause' }).click();
  await expect(popup.getByText(/^Paused/).first()).toBeVisible();
  // It stays paused until asked to carry on.
  await popup.waitForTimeout(2000);
  await expect(popup.getByText(/^Paused/).first()).toBeVisible();
  await popup.getByRole('button', { name: 'Resume' }).click();
  const { filename } = await nextDownload(sw, before);
  const info = probe(filename);
  if (info) {
    expect(info.streams).toEqual(['audio', 'video']);
    expect(info.duration).toBeGreaterThan(5);
    expect(info.duration).toBeLessThan(7);
  }
  await expect(popup.getByText('Saved')).toBeVisible();
});

test('a recording cut by closing the browser carries on when it opens again', async () => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(join(tmpdir(), 'grabby-restart-rec-'));
  const launch = () =>
    chromium.launchPersistentContext(userData, {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      locale: 'en-US',
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required', '--lang=en-US'],
    });
  const worker = async (c: BrowserContext) => c.serviceWorkers()[0] ?? (await c.waitForEvent('serviceworker'));
  let ctx: BrowserContext | undefined;
  try {
    ctx = await launch();
    let sw = await worker(ctx);
    const { page, tabId } = await openFixture(ctx, sw, 'mse-slow.html');
    await page.waitForSelector('body[data-ready="1"]');
    await expect.poll(() => badge(sw, tabId)).toBe('1');
    const popup = await openPopup(ctx, new URL(sw.url()).host, tabId);
    await popup.getByRole('button', { name: 'Record playback' }).click();
    await expect.poll(() => meterValue(popup), { timeout: 30_000 }).toBeGreaterThan(15);
    await ctx.close();

    ctx = await launch();
    sw = await worker(ctx);
    // No tab left: Grabby opens the page again in the background and records the rest.
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.downloads.search({ state: 'complete' })).length), { timeout: 90_000 })
      .toBeGreaterThan(0);
    const { filename } = await lastDownload(sw);
    const info = probe(filename);
    if (info) {
      expect(info.streams).toEqual(['audio', 'video']);
      expect(info.duration).toBeGreaterThan(5);
    }
    // The tab it opened is closed again.
    await expect.poll(async () => sw.evaluate(async () => (await chrome.tabs.query({ url: '*://*/pages/mse-slow.html' })).length), { timeout: 10_000 }).toBe(0);
  } finally {
    await ctx?.close().catch(() => {});
    try {
      rmSync(userData, { recursive: true, force: true });
    } catch {
      /* Windows may hold the profile a moment longer */
    }
  }
});

/* ------------------------------------------------------------------ 1.8 */

/** Streams of a saved file with their language, and its chapters and tags (null without ffprobe). */
function probeFull(file: string): { streams: { type: string; lang?: string }[]; chapters: string[]; title?: string; artist?: string } | null {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:stream_tags=language:format_tags=title,artist', '-show_chapters', '-of', 'json', file], {
      encoding: 'utf8',
    });
    const j = JSON.parse(out) as {
      streams: { codec_type: string; tags?: { language?: string } }[];
      chapters?: { tags?: { title?: string } }[];
      format: { tags?: Record<string, string> };
    };
    const tag = (k: string) => Object.entries(j.format.tags ?? {}).find(([n]) => n.toLowerCase() === k)?.[1];
    return {
      streams: j.streams.map((s) => ({ type: s.codec_type, ...(s.tags?.language ? { lang: s.tags.language } : {}) })),
      chapters: (j.chapters ?? []).map((c) => c.tags?.title ?? ''),
      ...(tag('title') ? { title: tag('title') } : {}),
      ...(tag('artist') ? { artist: tag('artist') } : {}),
    };
  } catch {
    return null;
  }
}

/** Ticks options of a list that takes several (it stays open), then closes it. */
async function tick(popup: Page, list: string, options: string[]) {
  await popup.getByRole('button', { name: new RegExp(`^${list}`) }).first().click();
  for (const o of options) await popup.getByRole('option', { name: new RegExp(`^${o}`) }).click();
  await popup.keyboard.press('Escape');
}

/** Types the two times of the part being edited. */
async function setPart(popup: Page, start: string, end: string) {
  for (const [name, value] of [
    ['Start', start],
    ['End', end],
  ] as const) {
    const field = popup.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }
}

test('several sound languages: each one a track of the video, with its language', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'hls-multi.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByRole('button', { name: /^Audio language\s*English/ })).toBeVisible();
  await tick(popup, 'Audio language', ['Français']);
  await expect(popup.getByRole('button', { name: /^Audio language\s*2 audio tracks/ })).toBeVisible();
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { filename } = await lastDownload(sw);
  const info = probeFull(filename);
  if (info) {
    expect(info.streams.map((s) => s.type).sort()).toEqual(['audio', 'audio', 'video']);
    expect(info.streams.filter((s) => s.type === 'audio').map((s) => s.lang)).toEqual(['eng', 'fra']);
  }
});

test('one other sound language only: it replaces the first one', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'hls-multi.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  // Tick French, untick English.
  await tick(popup, 'Audio language', ['Français', 'English']);
  await expect(popup.getByRole('button', { name: /^Audio language\s*Français/ })).toBeVisible();
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const info = probeFull((await lastDownload(sw)).filename);
  if (info) expect(info.streams.filter((s) => s.type === 'audio').map((s) => s.lang)).toEqual(['fra']);
});

test('several subtitle languages: all of them in the video', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'dash-packed.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await pick(popup, 'Format', 'MKV');
  await tick(popup, 'Subtitles', ['German', 'Spanish']);
  await expect(popup.getByRole('button', { name: /^Subtitles\s*2 languages/ })).toBeVisible();
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const { video } = await videoAndSrt(sw, false);
  const info = probeFull(video);
  if (info) {
    expect(info.streams.map((s) => s.type).sort()).toEqual(['audio', 'subtitle', 'subtitle', 'video']);
    expect(info.streams.filter((s) => s.type === 'subtitle').map((s) => s.lang)).toEqual(['deu', 'spa']);
  }
});

test('several subtitle languages apart: one .srt each, named by language', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'dash-packed.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const asked = await recordDownloads(sw);
  const popup = await openPopup(context, extId, tabId);
  await tick(popup, 'Subtitles', ['German', 'Italian']);
  await popup.getByRole('switch', { name: 'In a separate .srt file' }).check();
  const before = await completed(sw);
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(() => completed(sw), { timeout: 60_000 }).toBe(before + 3);
  const names = (await asked()).map((o) => o.filename ?? '');
  expect(names.some((n) => n.endsWith('.de.srt'))).toBe(true);
  expect(names.some((n) => n.endsWith('.it.srt'))).toBe(true);
});

test('a <video> with chapters: they are written in the file', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'chapters.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await expect(popup.getByRole('switch', { name: /Keep the chapters/ })).toBeChecked();
  await expect(popup.getByText('3 chapters')).toBeVisible();
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const info = probeFull((await lastDownload(sw)).filename);
  if (info) expect(info.chapters).toEqual(['Début', 'Milieu', 'Fin']);
});

test('several parts joined: one file, a chapter per part; or one file each', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'direct.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const asked = await recordDownloads(sw);
  const popup = await openPopup(context, extId, tabId);
  await cutClip(popup, '0:00', '0:02');
  await popup.getByRole('button', { name: 'Add a part' }).click();
  await setPart(popup, '0:04', '0:06');
  await expect(popup.getByRole('listitem')).toHaveCount(2);
  await expect(popup.getByRole('switch', { name: 'Join the parts into one file' })).toBeChecked();
  let before = await completed(sw);
  await popup.getByRole('button', { name: 'Download the 2 parts joined' }).click();
  const joined = await nextDownload(sw, before);
  expect((await asked()).at(-1)?.filename).toContain('(0m00-0m02 + 0m04-0m06).mp4');
  const info = probeFull(joined.filename);
  if (info) {
    expect(info.chapters).toEqual(['0m00-0m02', '0m04-0m06']);
    const d = probe(joined.filename)!.duration;
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(5.5);
  }

  // Again, one file each.
  await popup.getByRole('button', { name: 'Download again' }).click();
  // The panel stayed open, back to the whole video.
  await expect(popup.getByRole('button', { name: 'Keep the whole video' })).toBeVisible();
  await setPart(popup, '0:00', '0:02');
  await popup.getByRole('button', { name: 'Add a part' }).click();
  await setPart(popup, '0:04', '0:06');
  await popup.getByRole('switch', { name: 'Join the parts into one file' }).uncheck();
  before = await completed(sw);
  await popup.getByRole('button', { name: 'Download 2 parts' }).click();
  await expect.poll(() => completed(sw), { timeout: 60_000 }).toBe(before + 2);
  const names = (await asked()).slice(-2).map((o) => o.filename ?? '');
  expect(names.some((n) => n.includes('(0m00-0m02)'))).toBe(true);
  expect(names.some((n) => n.includes('(0m04-0m06)'))).toBe(true);
});

for (const [format, ext, codec, magic] of [
  ['JPEG', 'jpg', 'mjpeg', (b: Buffer) => b[0] === 0xff && b[1] === 0xd8],
  ['GIF', 'gif', 'gif', (b: Buffer) => b.subarray(0, 6).toString('latin1') === 'GIF89a'],
  ['WebP', 'webp', 'webp', (b: Buffer) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
] as const) {
  test(`a picture from the video: ${format}`, async ({ context, sw, extId }) => {
    const { tabId } = await openFixture(context, sw, 'direct.html');
    await expect.poll(() => badge(sw, tabId)).toBe('1');
    const asked = await recordDownloads(sw);
    const popup = await openPopup(context, extId, tabId);
    await pick(popup, 'Format', format);
    if (ext === 'jpg') {
      const field = popup.getByRole('textbox', { name: 'Time' });
      await field.fill('0:03');
      await field.press('Enter');
      await popup.getByRole('button', { name: 'Save the picture' }).click();
    } else {
      await popup.getByRole('button', { name: 'Save the animation' }).click();
    }
    await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
    const { bytes, filename } = await lastDownload(sw);
    expect(magic(bytes)).toBe(true);
    const name = (await asked()).at(-1)?.filename ?? '';
    expect(name.endsWith(`.${ext}`)).toBe(true);
    if (ext === 'jpg') expect(name).toContain('(0m03)');
    const f = probeFormat(filename);
    if (f) expect(f.codecs[0]).toMatch(new RegExp(`^${codec}`));
  });
}

test('a sound file says its title', async ({ context, sw, extId }) => {
  const { tabId } = await openFixture(context, sw, 'direct.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  await pick(popup, 'Format', 'MP3');
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  const info = probeFull((await lastDownload(sw)).filename);
  if (info) expect(info.title).toBe('Sample: direct clip');
});

test('outside the chosen hours a download waits; "Start now" starts it', async ({ context, sw, extId }) => {
  // A one-hour window that opens in two hours: closed now.
  const from = ((new Date().getHours() + 2) % 24) * 60;
  await setSettings(sw, { scheduleOn: true, scheduleFrom: from, scheduleTo: (from + 60) % 1440 });
  const { tabId } = await openFixture(context, sw, 'direct.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  const before = await completed(sw);
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.getByText(`Starts at ${String(from / 60).padStart(2, '0')}:00`).first()).toBeVisible();
  // It really waits, and the worker is woken when the window opens.
  await popup.waitForTimeout(1500);
  expect(await completed(sw)).toBe(before);
  expect(await sw.evaluate(async () => !!(await chrome.alarms.get('grabby-schedule')))).toBe(true);
  await popup.getByRole('button', { name: 'Start now' }).click();
  await expect(popup.getByText('Saved')).toBeVisible({ timeout: 60_000 });
  expect(await completed(sw)).toBe(before + 1);
});

test('a speed limit slows the download down, and the file is whole', async ({ context, sw, extId }) => {
  // 256 KB/s for a 572 KB file: about two seconds at least.
  await setSettings(sw, { rateLimit: 256 * 1024 });
  const { tabId } = await openFixture(context, sw, 'direct.html');
  await expect.poll(() => badge(sw, tabId)).toBe('1');
  const popup = await openPopup(context, extId, tabId);
  const t0 = Date.now();
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup.locator('.job--done')).toBeVisible({ timeout: 60_000 });
  expect(Date.now() - t0).toBeGreaterThan(1500);
  // Fetched by Grabby (the browser's own download can't be slowed down), saved as it is.
  expect(await sw.evaluate(async () => (await chrome.downloads.search({ limit: 1, orderBy: ['-startTime'] }))[0]?.url.startsWith('blob:'))).toBe(true);
  await expect(popup.getByText(/as-is/)).toHaveCount(0);
  const { bytes } = await lastDownload(sw);
  expect(bytes.equals(readFileSync(resolve('test/fixtures/media/sample.mp4')))).toBe(true);
});

test('settings: the hours and the speed limit; the update check tells about a new version', async ({ context, sw, extId }) => {
  // GitHub, as it would answer.
  await sw.evaluate(() => {
    const real = globalThis.fetch;
    globalThis.fetch = ((u: RequestInfo | URL, o?: RequestInit) =>
      String(u).startsWith('https://api.github.com/repos/titilyonnais/grabby/releases/latest')
        ? Promise.resolve(new Response(JSON.stringify({ tag_name: 'v99.0.0', html_url: 'https://github.com/titilyonnais/grabby/releases/tag/v99.0.0' })))
        : real(u, o)) as typeof fetch;
  });
  const { tabId } = await openFixture(context, sw, 'direct.html');
  const popup = await openPopup(context, extId, tabId);
  await popup.getByRole('button', { name: 'Settings' }).click();
  await popup.getByRole('switch', { name: /Only at certain times/ }).check();
  const from = popup.getByRole('textbox', { name: 'From' });
  await from.fill('23h30');
  await from.press('Enter');
  await expect(from).toHaveValue('23:30');
  await popup.getByRole('button', { name: /^Top speed/ }).click();
  await popup.getByRole('option', { name: '1 MB/s' }).click();
  await expect(popup.getByRole('button', { name: 'Top speed : 1 MB/s' })).toBeVisible();
  await expect
    .poll(() => sw.evaluate(async () => ((await chrome.storage.local.get('settings')) as { settings: Record<string, unknown> }).settings))
    .toMatchObject({ scheduleOn: true, scheduleFrom: 23 * 60 + 30, scheduleTo: 7 * 60, rateLimit: 1024 ** 2 });
  // No Wi-Fi switch where the browser doesn't tell the connection type.
  await expect(popup.getByRole('switch', { name: /Only on Wi-Fi/ })).toHaveCount(0);
  // Off by default; on: GitHub is asked at once, and the daily check is set.
  const updates = popup.getByRole('switch', { name: /Tell me about new versions/ });
  await expect(updates).not.toBeChecked();
  await updates.check();
  await expect.poll(() => sw.evaluate(async () => !!(await chrome.alarms.get('grabby-update')))).toBe(true);
  await popup.getByRole('button', { name: 'Back' }).click();
  await expect(popup.getByText('Grabby 99.0.0 is out')).toBeVisible();
  await expect(popup.getByRole('link', { name: /See the new version/ })).toHaveAttribute('href', 'https://github.com/titilyonnais/grabby/releases/tag/v99.0.0');
  // Closed: it stays closed for this version.
  await popup.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(popup.getByText('Grabby 99.0.0 is out')).toHaveCount(0);
  // Off again: no more checks.
  await popup.getByRole('button', { name: 'Settings' }).click();
  await popup.getByRole('switch', { name: /Tell me about new versions/ }).uncheck();
  await expect.poll(() => sw.evaluate(async () => !!(await chrome.alarms.get('grabby-update')))).toBe(false);
});
