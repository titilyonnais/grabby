/**
 * Manual "real sites" check: loads a build into a real browser (Brave by default, since it
 * ships the H.264 codecs that Playwright's Chromium lacks), opens URLs and prints what Grabby
 * detected. Not part of CI — real sites change and need network access.
 *
 *   node test/live/live.mjs <url> [more urls…]
 *   BROWSER="C:/path/to/browser.exe" node test/live/live.mjs <url>
 *   HEADED=1 … shows the browser window (hidden by default).
 */
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXT = resolve(process.env.GRABBY_EXT ?? 'dist');
const BROWSER = process.env.BROWSER ?? 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const WAIT = Number(process.env.WAIT ?? 12000);

/** The headless browser announces itself as "HeadlessChrome": some players then stay black. */
let userAgent;
async function normalUserAgent() {
  if (userAgent !== undefined || process.env.HEADED) return userAgent;
  const b = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ua = await b.newPage().then((p) => p.evaluate(() => navigator.userAgent));
  await b.close();
  return (userAgent = ua.replace('HeadlessChrome', 'Chrome'));
}

export async function launch() {
  const userData = mkdtempSync(join(tmpdir(), 'grabby-live-'));
  const ua = await normalUserAgent();
  const ctx = await chromium.launchPersistentContext(userData, {
    executablePath: BROWSER,
    // Invisible by default (no window over what the user is doing); HEADED=1 to watch.
    headless: !process.env.HEADED,
    ...(ua ? { userAgent: ua } : {}),
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--autoplay-policy=no-user-gesture-required',
      '--lang=fr-FR',
      ...(process.env.DEBUG_PORT ? [`--remote-debugging-port=${process.env.DEBUG_PORT}`] : []),
    ],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
  return { ctx, sw, extId: new URL(sw.url()).host, close: async () => (await ctx.close(), rmSync(userData, { recursive: true, force: true })) };
}

/** Declines optional cookies on consent walls (the most privacy-preserving choice). */
export async function declineConsent(page) {
  const labels = /^\s*(Tout refuser|Tout rejeter|Reject all|Refuser tout|Continuer sans accepter|Refuser)\s*$/i;
  for (const frame of page.frames()) {
    // Only real controls: the same words also appear in the dialog's explanations.
    const controls = frame.locator('button, a, [role="button"]').filter({ hasText: labels });
    const n = await controls.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const b = controls.nth(i);
      await b.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      if (await b.click({ timeout: 3000 }).then(() => true, () => false)) {
        await page.waitForTimeout(1500);
        return true;
      }
    }
  }
  return false;
}

export async function detected(sw, url) {
  return sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u.split('#')[0] + '*' });
    const tabs = tab ? [tab] : await chrome.tabs.query({ active: true });
    const id = tabs[0]?.id;
    const all = await chrome.storage.session.get(null);
    return { tabId: id, state: all[`tab:${id}`] ?? null, jobs: all.jobs ?? [] };
  }, url);
}

/**
 * Prints console messages containing "grabby" from extension contexts Playwright doesn't
 * expose (offscreen document, its iframes). Needs DEBUG_PORT.
 */
export function tapConsoles(filter = /offscreen|\/embed\//) {
  const port = process.env.DEBUG_PORT;
  if (!port) return () => {};
  const seen = new Set();
  const timer = setInterval(async () => {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
    for (const t of list) {
      if (seen.has(t.id) || !filter.test(t.url) || !t.webSocketDebuggerUrl) continue;
      seen.add(t.id);
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.method === 'Runtime.consoleAPICalled') {
          const text = d.params.args.map((a) => a.value ?? (a.preview ? JSON.stringify(Object.fromEntries(a.preview.properties.map((p) => [p.name, p.value]))) : a.description)).join(' ');
          if (/grabby/i.test(text)) console.log(`
[${t.type}] ${text.slice(0, 2000)}`);
        } else if (d.method === 'Runtime.exceptionThrown') {
          console.log(`
[${t.type}] EXCEPTION ${d.params.exceptionDetails.exception?.description?.slice(0, 500)}`);
        }
      };
    }
  }, 1000);
  return () => clearInterval(timer);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const urls = process.argv.slice(2);
  const { ctx, sw, extId, close } = await launch();
  for (const url of urls) {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => console.log('goto', e.message));
    await page.waitForTimeout(2500);
    await declineConsent(page);
    await page.waitForTimeout(WAIT);
    const { state } = await detected(sw, page.url());
    console.log(`\n=== ${page.url()}\n title: ${state?.pageTitle}\n thumb: ${state?.thumbnail?.slice(0, 80)}`);
    for (const i of state?.items ?? []) {
      console.log(` - [${i.kind}] ${i.protection} ${i.title || ''} size=${i.size ?? '?'} dur=${i.duration ?? '?'} frame=${i.frameUrl.slice(0, 60)}\n   ${i.url.slice(0, 160)}`);
      for (const v of i.variants ?? []) console.log(`     variant ${v.label}`);
    }
    // What the user actually sees: the popup's cards (duplicates and stream pieces hidden).
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, page.url());
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await popup.waitForTimeout(1500);
    const cards = await popup.locator('article').evaluateAll((els) => els.map((e) => e.querySelector('.card__meta')?.textContent + ' · ' + e.querySelector('h2')?.textContent));
    console.log(` POPUP (${cards.length}) :`);
    for (const c of cards) console.log(`   ${c}`);
    await popup.close();
  }
  if (!process.env.KEEP) await close();
}
