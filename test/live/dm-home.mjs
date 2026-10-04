// Dailymotion homepage: hover/scroll like a user, then list what Grabby detected.
import { declineConsent, detected, launch } from './live.mjs';

const { ctx, sw, close } = await launch();
const page = await ctx.newPage();
page.on('response', (r) => {
  const t = r.headers()['content-type'] ?? '';
  if (/video|audio|mpegurl|dash/.test(t) || /\.(mp4|m3u8|mpd|webm|ts|m4s)(\?|$)/.test(r.url())) {
    console.log('net', r.status(), t, (r.headers()['content-length'] ?? '?'), r.url().slice(0, 140));
  }
});
await page.goto('https://www.dailymotion.com/fr', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await declineConsent(page);
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(1500);
  const cards = await page.locator('a[href*="/video/"] img').all();
  for (const c of cards.slice(i * 3, i * 3 + 3)) await c.hover({ timeout: 2000 }).then(() => page.waitForTimeout(2500)).catch(() => {});
}
await page.waitForTimeout(3000);
const { state } = await detected(sw, page.url());
console.log('\nDETECTED', JSON.stringify(state?.items?.map((i) => ({ kind: i.kind, url: i.url.slice(0, 150), size: i.size, title: i.title, frame: i.frameUrl.slice(0, 80) })), null, 1));
const videos = await page.evaluate(() =>
  [...document.querySelectorAll('video')].map((v) => ({ src: (v.currentSrc || v.src).slice(0, 120), muted: v.muted, loop: v.loop, autoplay: v.autoplay, controls: v.controls, w: v.clientWidth, d: v.duration })),
);
console.log('VIDEOS', JSON.stringify(videos, null, 1));
await page.screenshot({ path: '.debug/dm-home.png' });
await close();
process.exit(0);
