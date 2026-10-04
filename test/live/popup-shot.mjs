// Captures the popup for a real page, light and dark: node test/live/popup-shot.mjs <url> <name>
import { declineConsent, launch } from './live.mjs';
const [url, name = 'page'] = process.argv.slice(2);
const { ctx, sw, extId, close } = await launch();
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await declineConsent(page);
await page.waitForTimeout(Number(process.env.WAIT ?? 12000));
const host = new URL(url).hostname;
const tabId = await sw.evaluate(async (h) => (await chrome.tabs.query({})).find((t) => t.url?.includes(h))?.id, host);
for (const scheme of ['light', 'dark']) {
  const popup = await ctx.newPage();
  await popup.emulateMedia({ colorScheme: scheme });
  await popup.setViewportSize({ width: 380, height: 640 });
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
  await popup.waitForTimeout(800);
  const ok = popup.getByRole('button', { name: /Compris|Got it/ });
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await popup.waitForTimeout(1200);
  await popup.screenshot({ path: `.debug/popup-${name}-${scheme}.png` });
  await popup.evaluate(() => document.querySelector('.content')?.scrollTo(0, 230));
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: `.debug/popup-${name}-${scheme}-bas.png` });
  const wide = await popup.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').map((e) => e.className));
  if (wide.length) console.log('débordement horizontal', scheme, wide);
  await popup.close();
}
await close();
process.exit(0);
