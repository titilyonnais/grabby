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
  logo: 'M12 3.5v10m0 0-4-4m4 4 4-4M5.5 17.5h13',
  photo: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9ZM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  later: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
};
/** An icon, built as nodes (pages with Trusted Types refuse markup strings). */
function svg(d: string, px = 16): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ width: String(px), height: String(px), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) el.setAttribute(k, v);
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

/** Grabby's color, chosen in the settings: the round button takes it too. */
const ACCENT: Record<string, string> = { coral: '#ff5b4f', blue: '#5b9dff', violet: '#a98bff', green: '#3dd68c', amber: '#ffb020', pink: '#ff6fae' };
let accent = ACCENT.coral!;
const accentStyles = new Set<HTMLStyleElement>();
const accentCss = () => `:host { --g: ${accent}; }`;

function styled(root: ShadowRoot) {
  const style = document.createElement('style');
  style.textContent = CSS;
  const color = document.createElement('style');
  color.textContent = accentCss();
  accentStyles.add(color);
  root.append(style, color);
}

function setAccent(name: string | undefined) {
  const next = ACCENT[name ?? ''] ?? ACCENT.coral!;
  if (next === accent) return;
  accent = next;
  for (const el of accentStyles) {
    if (el.isConnected) el.textContent = accentCss();
    else accentStyles.delete(el);
  }
}

const CSS = `
:host { all: initial; }
.bar { position: fixed; z-index: 2147483647; display: flex; align-items: center; padding: 4px; border-radius: 999px;
  background: rgba(14,14,16,0);
  font: 600 13px/1 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; letter-spacing: .1px;
  opacity: 0; transform: scale(.6); transform-origin: 22px 22px;
  transition: opacity .18s ease, transform .34s cubic-bezier(.34,1.56,.64,1), background-color .25s ease, box-shadow .25s ease; pointer-events: none; }
.bar.on { opacity: 1; transform: none; pointer-events: auto; }
.bar.open { background: rgba(14,14,16,.88); box-shadow: 0 8px 28px rgba(0,0,0,.42), inset 0 0 0 1px rgba(255,255,255,.08); backdrop-filter: blur(12px) saturate(1.4); }
.logo { all: unset; box-sizing: border-box; display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 999px; cursor: pointer;
  background: var(--g); color: #160806; box-shadow: 0 4px 16px color-mix(in srgb, var(--g) 45%, transparent), 0 0 0 3px rgba(255,255,255,.2);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease; }
.logo:hover { transform: scale(1.08); box-shadow: 0 6px 20px color-mix(in srgb, var(--g) 55%, transparent), 0 0 0 4px rgba(255,255,255,.26); }
.logo:active { transform: scale(.92); }
.logo:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.logo svg { transition: transform .35s cubic-bezier(.34,1.56,.64,1); }
.open .logo { box-shadow: none; }
.open .logo svg { transform: rotate(-90deg); }
.more { display: flex; align-items: center; gap: 4px; max-width: 0; overflow: hidden; opacity: 0;
  transition: max-width .42s cubic-bezier(.22,1,.36,1), opacity .2s ease, padding .3s ease; }
.open .more { max-width: 560px; opacity: 1; padding: 0 2px 0 6px; }
.more > * { transform: translateX(-10px); opacity: 0; transition: transform .38s cubic-bezier(.34,1.56,.64,1), opacity .22s ease, background-color .15s ease; }
.open .more > * { transform: none; opacity: 1; }
.open .more > :nth-child(2) { transition-delay: .04s; }
.open .more > :nth-child(3) { transition-delay: .08s; }
.open .more > :nth-child(4) { transition-delay: .12s; }
button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px 0 11px; border-radius: 999px;
  color: #fff; cursor: pointer; white-space: nowrap; transition: background-color .15s ease, transform .15s ease, color .15s ease; }
button.icon { width: 34px; padding: 0; justify-content: center; }
button:hover { background: rgba(255,255,255,.14); }
button:active { transform: scale(.94); }
button:focus-visible { outline: 2px solid color-mix(in srgb, var(--g) 80%, #fff); outline-offset: 2px; }
button.main { background: #fff; color: #111; }
button.main:hover { background: color-mix(in srgb, var(--g) 18%, #fff); }
button.done { background: #2fbf71 !important; color: #fff !important; }
button.done svg { animation: tick .36s cubic-bezier(.34,1.56,.64,1); }
.yt { display: inline-flex; margin-left: 8px; border-radius: 999px; background: rgba(127,127,127,.16); overflow: hidden; }
.yt button { height: 36px; padding: 0 14px; border-radius: 0; color: inherit; font: 500 14px/1 Roboto, Arial, sans-serif; }
.yt button:hover { background: rgba(127,127,127,.22); }
.yt button + button { box-shadow: inset 1px 0 0 rgba(127,127,127,.35); }
.yt button.done { background: #2fbf71; }
@keyframes tick { from { transform: scale(.3) rotate(-30deg); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .bar, button, .more, .more > *, .logo, .logo svg { transition: none; } button.done svg { animation: none; } }
`;

const send = (msg: ContentToBg) => chrome.runtime.sendMessage(msg).catch(() => {});

function grab(src: string | undefined, mode: 'video' | 'audio') {
  void send({ type: 'grab', ...(src ? { src } : {}), mode });
}

/** A moment of "started" on the button pressed, in green. */
function confirm(btn: HTMLButtonElement, icon: string, text: string, after?: () => void) {
  btn.classList.add('done');
  fill(btn, ICONS.check, btn.classList.contains('icon') ? '' : say('overlayStarted'));
  setTimeout(() => {
    btn.classList.remove('done');
    fill(btn, icon, text);
    after?.();
  }, 1500);
}

function makeButton(cls: string, icon: string, text: string, title: string, onClick: () => unknown, after?: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.title = title;
  b.setAttribute('aria-label', title);
  fill(b, icon, text);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (b.classList.contains('done')) return;
    void Promise.resolve(onClick()).then(() => confirm(b, icon, text, after));
  });
  // The page's player must not take these clicks (play/pause).
  for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'dblclick']) b.addEventListener(ev, (e) => e.stopPropagation());
  return b;
}

/** The picture the video shows right now, at its own size (null: the site doesn't allow reading it). */
export function stillOf(v: HTMLVideoElement): string | null {
  if (!v.videoWidth || !v.videoHeight) return null;
  try {
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    return c.toDataURL('image/png');
  } catch {
    // A picture from another site without its permission: the page's own screenshot instead.
    return null;
  }
}

const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

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
    // Folded: Grabby's round button only. A click unfolds what it can do with the video.
    const logo = document.createElement('button');
    logo.className = 'logo';
    logo.title = say('overlayOpen');
    logo.setAttribute('aria-label', say('overlayOpen'));
    logo.setAttribute('aria-expanded', 'false');
    logo.append(svg(ICONS.logo, 17));
    logo.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(!bar!.classList.contains('open'));
    });
    for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'dblclick']) logo.addEventListener(ev, (e) => e.stopPropagation());
    const more = document.createElement('span');
    more.className = 'more';
    const fold = () => setOpen(false);
    more.append(
      makeButton('main', ICONS.down, say('overlayVideo'), say('overlayVideoTitle'), () => grab(srcOf(target), 'video'), fold),
      makeButton('', ICONS.audio, say('overlayAudio'), say('overlayAudioTitle'), () => grab(srcOf(target), 'audio'), fold),
      makeButton('icon', ICONS.photo, '', say('overlayPhoto'), () => snap(), fold),
      makeButton('icon', ICONS.later, '', say('overlayLater'), () => send({ type: 'later', ...(srcOf(target) ? { src: srcOf(target)! } : {}) }), fold),
    );
    bar.append(logo, more);
    bar.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    bar.addEventListener('pointerleave', () => scheduleHide());
    root.append(bar);
    (document.body ?? document.documentElement).append(host);
  };

  const setOpen = (open: boolean) => {
    bar?.classList.toggle('open', open);
    bar?.querySelector('.logo')?.setAttribute('aria-expanded', String(open));
  };

  /** "Photo": the picture on screen, at the video's own size when the site allows it. */
  const shoot = async (v: HTMLVideoElement) => {
    const still = stillOf(v);
    if (still) return send({ type: 'snap', dataUrl: still, time: v.currentTime });
    // Read from the screen: the button steps aside for the shot.
    const r = v.getBoundingClientRect();
    if (bar) bar.style.visibility = 'hidden';
    await frames();
    await send({ type: 'snap', rect: { x: r.left, y: r.top, w: r.width, h: r.height }, dpr: devicePixelRatio, time: v.currentTime });
    if (bar) bar.style.visibility = '';
  };
  const snap = async () => {
    if (target && bar) await shoot(target);
  };
  // « Capture instantanée » from the keyboard: the biggest video on screen in this frame.
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type !== 'photo') return;
    const seen = [...document.querySelectorAll('video')]
      .map((v) => ({ v, r: v.getBoundingClientRect() }))
      .filter(({ v, r }) => v.readyState >= 2 && r.width > 80 && r.height > 60 && r.bottom > 0 && r.top < innerHeight)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    if (seen[0]) void shoot(seen[0].v);
  });

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
    setOpen(false);
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
    wrap.append(
      makeButton('', ICONS.down, say('overlayVideo'), say('overlayVideoTitle'), () => grab(undefined, 'video')),
      makeButton('', ICONS.audio, say('overlayAudio'), say('overlayAudioTitle'), () => grab(undefined, 'audio')),
    );
    root.append(wrap);
    row.append(el);
  };
  if (window === window.top) setInterval(ytButton, 2000);

  const apply = (s?: { overlayButton?: boolean; accent?: string }) => {
    enabled = s?.overlayButton !== false;
    setAccent(s?.accent);
    if (!enabled) {
      hide();
      for (const el of document.querySelectorAll('grabby-yt')) el.remove();
    }
  };
  void chrome.storage.local.get('settings').then((r) => apply(r.settings as { overlayButton?: boolean; accent?: string } | undefined)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) apply(changes.settings.newValue as { overlayButton?: boolean; accent?: string } | undefined);
  });
}
