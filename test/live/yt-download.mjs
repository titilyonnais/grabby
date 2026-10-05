/**
 * Real YouTube check (Brave): opens a video, asks the popup for a quality and
 * format, and verifies that the file is right while the visible player keeps playing at
 * normal speed.   node test/live/yt-download.mjs [url] [quality label] [mp4|webm|mkv|mp3|…]
 */
import { execFileSync } from 'node:child_process';
import { declineConsent, launch } from './live.mjs';

const url = process.argv[2] ?? 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const wantQuality = process.argv[3] ?? '720p';
const wantFormat = process.argv[4] ?? 'mp4'; // a format of the list (mp4, webm, mp3…) or audio (M4A)

const { ctx, sw, extId, close } = await launch();
try {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await declineConsent(page);
  await page.waitForTimeout(6000);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: '*://www.youtube.com/watch*' }))[0]?.id);
  // The user is watching: start their video (muted for the test machine).
  await page.evaluate(() => {
    const v = document.querySelector('#movie_player video');
    if (v) {
      v.muted = true;
      void v.play();
    }
  });

  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 380, height: 640 });
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
  const ok = popup.getByRole('button', { name: /Compris|Got it/ });
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await popup.waitForTimeout(1500);
  await popup.screenshot({ path: '.debug/yt-popup-before.png' });
  // Quality and format lists of the card (format: MP4, WebM, MKV, or an audio one such as MP3).
  await popup.getByRole('button', { name: /^(Télécharger|Download)$/ }).waitFor({ timeout: 15000 });
  const pick = async (list, option) => {
    await popup.getByRole('button', { name: new RegExp(`^${list}`) }).first().click();
    await popup.getByRole('option', { name: new RegExp(`^${option}`, 'i') }).first().click();
  };
  const fmt = wantFormat === 'audio' ? 'M4A' : wantFormat;
  if (!/^(m4a|mp3|opus|ogg|flac|wav)$/i.test(fmt)) await pick('(Qualité|Quality)', wantQuality);
  await pick('Format', fmt);
  await popup.getByRole('button', { name: /^(Télécharger|Download)$/ }).click();

  // Meanwhile the user's video must play normally.
  await page.bringToFront();
  await page.evaluate(() => {
    const p = document.getElementById('movie_player');
    p?.mute?.();
    p?.playVideo?.();
  });
  const t0 = Date.now();
  const samples = [];
  let job;
  while (Date.now() - t0 < 600_000) {
    await page.waitForTimeout(3000);
    samples.push(await page.evaluate(() => {
      const v = document.querySelector('#movie_player video');
      return v ? { t: v.currentTime, rate: v.playbackRate, paused: v.paused } : null;
    }));
    job = await sw.evaluate(async () => (await chrome.storage.session.get('jobs')).jobs?.at(-1));
    process.stdout.write(`\r${job?.status} ${Math.round((job?.progress ?? 0) * 100)}%   `);
    if (['done', 'error', 'canceled'].includes(job?.status)) break;
  }
  console.log('\njob', JSON.stringify({ status: job?.status, error: job?.error, filename: job?.filename, bytes: job?.bytes, quality: job?.quality, format: job?.format }));
  console.log('visible player samples', JSON.stringify(samples.slice(0, 6)));
  await popup.bringToFront();
  await popup.screenshot({ path: '.debug/yt-popup-after.png' });
  if (job?.status === 'done') {
    const item = await sw.evaluate(async (id) => (await chrome.downloads.search({ id }))[0], job.downloadId);
    console.log('file', item.filename, item.fileSize);
    console.log(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration,format_name', '-of', 'compact', item.filename], { encoding: 'utf8' }));
  }
} finally {
  await close();
}
