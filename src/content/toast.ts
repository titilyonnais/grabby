/**
 * The "download finished" bubble, shown in the page the user is looking at. It lives in a
 * closed shadow root so the page's styles can't reach it (and ours don't leak out).
 */
import type { BgToContent, ContentToBg } from '../shared/messages';
import { alive } from './alive';

type Toast = Extract<BgToContent, { type: 'toast' }>;

const CSS = `
:host { all: initial; }
.t {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  display: flex; align-items: center; gap: 12px;
  width: min(360px, calc(100vw - 40px)); box-sizing: border-box;
  padding: 12px 8px 12px 12px; border-radius: 16px;
  background: #ffffff; color: #0f0f0f;
  box-shadow: 0 12px 32px rgba(0,0,0,.2), 0 0 0 1px rgba(0,0,0,.06);
  font: 400 14px/20px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  animation: in 220ms cubic-bezier(.2,.7,.2,1);
}
.i { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--g, #ff5b4f); color: #fff; }
.i.ko { background: #d93025; }
.i svg, .x svg { display: block; }
.b { flex: 1; min-width: 0; }
.h { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.d { color: #606060; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button { all: unset; box-sizing: border-box; cursor: pointer; font: inherit; }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.a { flex: none; height: 32px; padding: 0 14px; border-radius: 16px; background: #0f0f0f; color: #fff; font-weight: 500; line-height: 32px; }
.x { flex: none; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border-radius: 50%; color: #606060; }
.x:hover { background: rgba(0,0,0,.08); color: #0f0f0f; }
.out { animation: out 180ms ease-in forwards; }
@keyframes in { from { opacity: 0; transform: translateY(12px); } }
@keyframes out { to { opacity: 0; transform: translateY(12px); } }
@media (prefers-reduced-motion: reduce) { .t, .out { animation: none; } }
/* Last, so the dark theme wins over the rules above. */
@media (prefers-color-scheme: dark) {
  .t { background: #1c1c1f; color: #f5f5f7; box-shadow: 0 16px 40px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08); }
  .d, .x { color: #aaaaaa; }
  .x:hover { background: rgba(255,255,255,.12); color: #f1f1f1; }
  .a { background: #f1f1f1; color: #0f0f0f; }
}
`;

const CHECK = 'M5 12.5l4.5 4.5L19 7.5';
const ALERT = 'M12 7v6M12 17h.01';
const CROSS = 'M6 6l12 12M18 6 6 18';

/** An icon built as nodes, centred in its box (pages with Trusted Types refuse markup strings). */
function icon(d: string, px: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ width: String(px), height: String(px), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) el.setAttribute(k, v);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  el.append(path);
  return el;
}

/** Grabby's color, chosen in the settings. */
const ACCENT: Record<string, string> = { coral: '#ff5b4f', blue: '#5b9dff', violet: '#a98bff', green: '#3dd68c', amber: '#ffb020', pink: '#ff6fae' };

let current: HTMLElement | null = null;

export function showToast(msg: Toast): void {
  if (!alive()) return;
  current?.remove();
  const host = document.createElement('grabby-toast');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const box = document.createElement('div');
  box.className = 't';
  box.setAttribute('role', 'status');

  const badge = document.createElement('span');
  badge.className = `i${msg.ok ? '' : ' ko'}`;
  badge.append(icon(msg.ok ? CHECK : ALERT, 18));
  const body = document.createElement('span');
  body.className = 'b';
  const h = document.createElement('div');
  h.className = 'h';
  h.textContent = msg.title;
  const d = document.createElement('div');
  d.className = 'd';
  d.textContent = msg.detail;
  d.title = msg.detail;
  body.append(h, d);
  box.append(badge, body);

  if (msg.action && msg.downloadId !== undefined) {
    const a = document.createElement('button');
    a.className = 'a';
    a.textContent = msg.action;
    const id = msg.downloadId;
    a.addEventListener('click', () => {
      if (alive()) void chrome.runtime.sendMessage({ type: 'show-download', downloadId: id } satisfies ContentToBg).catch(() => {});
      hide();
    });
    box.append(a);
  }
  const x = document.createElement('button');
  x.className = 'x';
  x.append(icon(CROSS, 20));
  x.setAttribute('aria-label', chrome.i18n.getMessage('dismiss') || 'Close');
  x.addEventListener('click', () => hide());
  box.append(x);

  root.append(style, box);
  void chrome.storage.local
    .get('settings')
    .then((r) => {
      const name = (r.settings as { accent?: string } | undefined)?.accent ?? '';
      if (ACCENT[name]) box.style.setProperty('--g', ACCENT[name]!);
    })
    .catch(() => {});
  document.documentElement.append(host);
  current = host;

  let timer = setTimeout(hide, 7000);
  box.addEventListener('mouseenter', () => clearTimeout(timer));
  box.addEventListener('mouseleave', () => (timer = setTimeout(hide, 3000)));

  function hide() {
    clearTimeout(timer);
    box.classList.add('out');
    setTimeout(() => host.remove(), 200);
    if (current === host) current = null;
  }
}
