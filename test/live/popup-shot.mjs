// Captures the popup for a real page, light and dark, in several states (invisible browser):
//   node test/live/popup-shot.mjs <url> <name>
// Writes .debug/popup-<name>-<scheme>-<state>.png and reports layout problems.
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

/** Card margins, overflow and popup size: what the user sees as "off-center" or "jumping". */
const layout = (popup) =>
  popup.evaluate(() => {
    const body = document.body.getBoundingClientRect();
    const card = document.querySelector('.card')?.getBoundingClientRect();
    const wide = [...document.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible' && getComputedStyle(e).overflowX !== 'hidden').map((e) => e.className);
    return { popup: `${body.width}x${document.documentElement.scrollHeight}`, card: card ? { left: Math.round(card.left), right: Math.round(body.width - card.right) } : null, horizontalOverflow: wide };
  });

for (const scheme of ['light', 'dark']) {
  const popup = await ctx.newPage();
  await popup.emulateMedia({ colorScheme: scheme });
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
  await popup.waitForTimeout(800);
  const ok = popup.getByRole('button', { name: /Compris|Got it/ });
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await popup.waitForTimeout(1200);
  const shot = (state) => popup.screenshot({ path: `.debug/popup-${name}-${scheme}-${state}.png` });
  await shot('page');
  console.log(scheme, 'page', JSON.stringify(await layout(popup)));
  const selects = popup.locator('button.select');
  if (await selects.count()) {
    await selects.last().click();
    await popup.waitForTimeout(300);
    await shot('formats');
    await popup.keyboard.press('Escape');
    if ((await selects.count()) > 1) {
      await selects.first().click();
      await popup.waitForTimeout(300);
      await shot('qualites');
      await popup.keyboard.press('Escape');
    }
  }
  await popup.evaluate(() => document.querySelector('.content')?.scrollTo(0, 400));
  await popup.waitForTimeout(300);
  await shot('bas');
  console.log(scheme, 'scrolled', JSON.stringify(await layout(popup)));
  await popup.getByRole('tab').nth(1).click();
  await popup.waitForTimeout(400);
  await shot('historique');
  console.log(scheme, 'history', JSON.stringify(await layout(popup)));
  await popup.locator('.top__tools button').last().click();
  await popup.waitForTimeout(500);
  await shot('reglages');
  console.log(scheme, 'settings', JSON.stringify(await layout(popup)));
  await popup.close();
}
await close();
process.exit(0);
