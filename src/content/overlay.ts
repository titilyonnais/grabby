/**
 * "Bouton sur les vidéos": a small Grabby button over the video the pointer is on (and under
 * YouTube's player), downloading it straight away like the keyboard shortcut. It lives in a
 * closed shadow root, so the page's styles can't reach it, and can be turned off in the settings.
 */
import type { ContentToBg } from '../shared/messages';

const MIN_W = 200;
const MIN_H = 120;
const HIDE_MS = 1200;

const say = (key: string) => chrome.i18n.getMessage(key) || key;

const ICONS = {
  down: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14',
  audio: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
};
/** An icon, built as nodes (pages with Trusted Types refuse markup strings). */
function svg(d: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) el.setAttribute(k, v);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  el.append(path);
  return el;
}

function fill(btn: HTMLButtonElement, icon: string, text: string) {
  const label = document.createElement('span');
  label.textContent = text;
  btn.replaceChildren(svg(icon), ...(text ? [label] : []));
}

function styled(root: ShadowRoot) {
  const style = document.createElement('style');
  style.textContent = CSS;
  root.append(style);
}

const CSS = `
:host { all: initial; }
.bar { position: fixed; z-index: 2147483647; display: flex; gap: 4px; padding: 4px; border-radius: 999px;
  background: rgba(0,0,0,.78); box-shadow: 0 4px 16px rgba(0,0,0,.35); backdrop-filter: blur(8px);
  font: 600 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; opacity: 0; transform: translateY(-4px) scale(.96);
  transition: opacity .16s ease, transform .22s cubic-bezier(.2,.7,.2,1); pointer-events: none; }
.bar.on { opacity: 1; transform: none; pointer-events: auto; }
button { all: unset; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 999px;
  color: #fff; cursor: pointer; white-space: nowrap; transition: background-color .12s ease, transform .12s ease; }
button:hover { background: rgba(255,255,255,.16); }
button:active { transform: scale(.94); }
button:focus-visible { outline: 2px solid #ff7a70; outline-offset: 1px; }
button.main { background: #ff5b4f; color: #000; }
button.main:hover { background: #ff7468; }
button.icon { width: 28px; padding: 0; justify-content: center; }
.yt { display: inline-flex; margin-left: 8px; }
.yt button { height: 36px; padding: 0 16px; background: rgba(255,255,255,.1); color: inherit; font: 500 14px/1 Roboto, Arial, sans-serif; }
.yt button:hover { background: rgba(255,255,255,.2); }
@media (prefers-reduced-motion: reduce) { .bar { transition: none; } }
`;

function grab(src: string | undefined, mode: 'video' | 'audio') {
  void chrome.runtime.sendMessage({ type: 'grab', ...(src ? { src } : {}), mode } satisfies ContentToBg).catch(() => {});
}

/** A moment of "done" on the button pressed. */
function confirm(btn: HTMLButtonElement, icon: string, text: string) {
  fill(btn, ICONS.check, text ? say('overlayStarted') : '');
  setTimeout(() => fill(btn, icon, text), 1800);
}

function makeButton(cls: string, icon: string, text: string, title: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.title = title;
  b.setAttribute('aria-label', title);
  fill(b, icon, text);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(b);
    confirm(b, icon, text);
  });
  // The page's player must not take these clicks (play/pause).
  for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'dblclick']) b.addEventListener(ev, (e) => e.stopPropagation());
  return b;
}

export function startOverlay() {
  if (!/^https?:$/.test(location.protocol)) return;
  let enabled = true;
  let host: HTMLElement | null = null;
  let bar: HTMLElement | null = null;
  let target: HTMLVideoElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let last = 0;

  const ensure = () => {
    if (host?.isConnected) return;
    host = document.createElement('grabby-overlay');
    const root = host.attachShadow({ mode: 'closed' });
    styled(root);
    bar = document.createElement('div');
    bar.className = 'bar';
    bar.append(
      makeButton('main', ICONS.down, say('overlayVideo'), say('overlayVideoTitle'), () => grab(srcOf(target), 'video')),
      makeButton('icon', ICONS.audio, '', say('overlayAudioTitle'), () => grab(srcOf(target), 'audio')),
    );
    bar.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    bar.addEventListener('pointerleave', () => scheduleHide());
    root.append(bar);
    (document.body ?? document.documentElement).append(host);
  };

  const srcOf = (v: HTMLVideoElement | null) => {
    const s = v?.currentSrc || v?.src || '';
    return /^https?:/i.test(s) ? s : undefined;
  };

  const place = () => {
    if (!target || !bar) return;
    const r = target.getBoundingClientRect();
    bar.style.left = `${Math.max(4, r.left + 10)}px`;
    bar.style.top = `${Math.max(4, r.top + 10)}px`;
  };

  const show = (v: HTMLVideoElement) => {
    ensure();
    clearTimeout(hideTimer);
    target = v;
    place();
    bar!.classList.add('on');
  };
  const hide = () => {
    bar?.classList.remove('on');
    target = null;
  };
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_MS);
  };

  /** The big enough video under the pointer (players cover their video with their own layers). */
  const videoAt = (x: number, y: number): HTMLVideoElement | null => {
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const style = getComputedStyle(v);
        if (style.visibility !== 'hidden' && style.display !== 'none') return v;
      }
    }
    return null;
  };

  document.addEventListener(
    'pointermove',
    (e) => {
      if (!enabled || document.fullscreenElement || e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - last < 80) return;
      last = now;
      const v = videoAt(e.clientX, e.clientY);
      if (v) show(v);
      else if (target && !bar?.matches(':hover')) scheduleHide();
    },
    { passive: true, capture: true },
  );
  addEventListener('scroll', () => target && place(), { passive: true, capture: true });
  document.addEventListener('fullscreenchange', hide);

  // Under YouTube's player, next to "Partager".
  const ytButton = () => {
    if (!enabled || location.hostname !== 'www.youtube.com' || !/^\/(watch|live\/)/.test(location.pathname)) return;
    const row = document.querySelector('ytd-watch-metadata #top-level-buttons-computed');
    if (!row || row.querySelector('grabby-yt')) return;
    const el = document.createElement('grabby-yt');
    const root = el.attachShadow({ mode: 'closed' });
    styled(root);
    const wrap = document.createElement('span');
    wrap.className = 'yt';
    wrap.append(makeButton('', ICONS.down, say('overlayVideo'), say('overlayVideoTitle'), () => grab(undefined, 'video')));
    root.append(wrap);
    row.append(el);
  };
  if (window === window.top) setInterval(ytButton, 2000);

  const apply = (s?: { overlayButton?: boolean }) => {
    enabled = s?.overlayButton !== false;
    if (!enabled) {
      hide();
      for (const el of document.querySelectorAll('grabby-yt')) el.remove();
    }
  };
  void chrome.storage.local.get('settings').then((r) => apply(r.settings as { overlayButton?: boolean } | undefined)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) apply(changes.settings.newValue as { overlayButton?: boolean } | undefined);
  });
}
