/**
 * The "download finished" bubble, shown in the page the user is looking at. It lives in a
 * closed shadow root so the page's styles can't reach it (and ours don't leak out).
 */
import type { BgToContent, ContentToBg } from '../shared/messages';

type Toast = Extract<BgToContent, { type: 'toast' }>;

const CSS = `
:host { all: initial; }
.t {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  display: flex; align-items: center; gap: 12px;
  width: min(360px, calc(100vw - 40px)); box-sizing: border-box;
  padding: 12px 12px 12px 14px; border-radius: 16px;
  background: #ffffff; color: #000000;
  box-shadow: 0 16px 40px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.06);
  font: 400 13.5px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif;
  animation: in 220ms cubic-bezier(.2,.7,.2,1);
}
.i { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: #ff5b4f; color: #fff; }
.i.ko { background: #d93025; }
.b { flex: 1; min-width: 0; }
.h { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.d { opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button { font: inherit; cursor: pointer; border: 0; }
.a { flex: none; height: 32px; padding: 0 14px; border-radius: 999px; background: #000; color: #fff; font-weight: 600; }
.x { flex: none; width: 28px; height: 28px; border-radius: 999px; background: none; color: #6e6e73; font-size: 18px; line-height: 1; }
.out { animation: out 180ms ease-in forwards; }
@keyframes in { from { opacity: 0; transform: translateY(12px); } }
@keyframes out { to { opacity: 0; transform: translateY(12px); } }
@media (prefers-reduced-motion: reduce) { .t, .out { animation: none; } }
/* Last, so the dark theme wins over the rules above. */
@media (prefers-color-scheme: dark) {
  .t { background: #1c1c1f; color: #f5f5f7; box-shadow: 0 16px 40px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08); }
  .x { color: #98989f; }
  .a { background: #fff; color: #000; }
}
`;

const CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ALERT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>';

let current: HTMLElement | null = null;

export function showToast(msg: Toast): void {
  current?.remove();
  const host = document.createElement('grabby-toast');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const box = document.createElement('div');
  box.className = 't';
  box.setAttribute('role', 'status');

  const icon = document.createElement('span');
  icon.className = `i${msg.ok ? '' : ' ko'}`;
  icon.innerHTML = msg.ok ? CHECK : ALERT;
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
  box.append(icon, body);

  if (msg.action && msg.downloadId !== undefined) {
    const a = document.createElement('button');
    a.className = 'a';
    a.textContent = msg.action;
    const id = msg.downloadId;
    a.addEventListener('click', () => {
      void chrome.runtime.sendMessage({ type: 'show-download', downloadId: id } satisfies ContentToBg).catch(() => {});
      hide();
    });
    box.append(a);
  }
  const x = document.createElement('button');
  x.className = 'x';
  x.textContent = '×';
  x.setAttribute('aria-label', chrome.i18n.getMessage('dismiss') || 'Close');
  x.addEventListener('click', () => hide());
  box.append(x);

  root.append(style, box);
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
