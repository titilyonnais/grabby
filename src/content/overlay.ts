/**
 * "Bouton sur les vidéos": a small Grabby button over the video the pointer is on (and under
 * YouTube's player), downloading it straight away like the keyboard shortcut. It lives in a
 * closed shadow root, so the page's styles can't reach it, and can be turned off in the settings.
 */
import type { ContentToBg, PageMedia } from '../shared/messages';
import { size } from '../popup/i18n';
import { alive, onDead } from './alive';

const MIN_W = 200;
const MIN_H = 120;
const HIDE_MS = 1200;

const say = (key: string) => (alive() && chrome.i18n.getMessage(key)) || key;

const ICONS = {
  down: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14',
  audio: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  logo: 'M12 3.5v10m0 0-4-4m4 4 4-4M5.5 17.5h13',
  photo: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9ZM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  later: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
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
.open .logo svg { animation: turn .3s cubic-bezier(.34,1.56,.64,1); }
@keyframes turn { from { transform: rotate(-90deg) scale(.6); opacity: 0; } }
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
@keyframes tick { from { transform: scale(.3) rotate(-30deg); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .bar, button, .more, .more > *, .logo, .logo svg { transition: none; } button.done svg, .open .logo svg { animation: none; } }
`;

const send = (msg: ContentToBg) => (alive() ? chrome.runtime.sendMessage(msg).catch(() => {}) : Promise.resolve());
/** A question to the service worker; `fallback` once Grabby is gone (updated while the page stays open). */
const ask = async <T>(msg: ContentToBg, fallback: T): Promise<T> => (alive() ? ((await chrome.runtime.sendMessage(msg).catch(() => fallback)) ?? fallback) : fallback);

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

/** YouTube's watch page (and its lives): Grabby's buttons sit under the player there. */
const onYouTubeWatch = () => location.hostname === 'www.youtube.com' && /^\/(watch|live\/)/.test(location.pathname);

/** The biggest video on screen in this frame. */
function biggestVideo(): HTMLVideoElement | null {
  const seen = [...document.querySelectorAll('video')]
    .map((v) => ({ v, r: v.getBoundingClientRect() }))
    .filter(({ v, r }) => v.readyState >= 2 && r.width > 80 && r.height > 60 && r.bottom > 0 && r.top < innerHeight)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  return seen[0]?.v ?? null;
}

/** Set by the overlay: takes the photo of a video (the page's own picture, or the screen's). */
let ytShoot: ((v: HTMLVideoElement) => Promise<unknown>) | null = null;

/*
 * YouTube's buttons, copied from youtube.com (2026): 40 px pills, padding 0 16 px, Roboto 500
 * 14 px, 24 px icons 6 px before the words, the thumbs' divider (1 × 24 px). YouTube's colour
 * variables are hashed now, so its own like button is read for the text and pill colours.
 */
const YT_CSS = `
:host { all: initial; display: inline-flex; align-items: center; margin: 0 8px; flex: none; vertical-align: top; }
.seg { position: relative; display: inline-flex; align-items: center; height: 40px; border-radius: 20px; background: var(--bg); }
.w { position: relative; display: inline-flex; }
button { all: unset; box-sizing: border-box; position: relative; display: inline-flex; align-items: center; justify-content: center; height: 40px; padding: 0 16px;
  border-radius: 20px 0 0 20px; color: var(--t); font: 500 14px/40px Roboto, Arial, sans-serif; white-space: nowrap; cursor: pointer; overflow: hidden;
  -webkit-tap-highlight-color: transparent; }
.w:first-child button::after { content: ''; position: absolute; right: 0; top: 8px; width: 1px; height: 24px; background: var(--line); }
.w + .w button { width: 48px; padding: 0 12px; border-radius: 0 20px 20px 0; }
button:hover { background: var(--hover); }
button:active, button[aria-expanded='true'] { background: var(--line); }
button:focus-visible { box-shadow: inset 0 0 0 2px var(--t); }
svg { display: block; width: 24px; height: 24px; flex: none; }
.label { margin-left: 6px; font-variant-numeric: tabular-nums; }
button > * { position: relative; }
button > .fill { position: absolute; inset: 0 auto 0 0; width: 0; background: var(--line); pointer-events: none; transition: width .5s cubic-bezier(.2,.7,.2,1); }
.busy svg { animation: pulse 1.4s ease-in-out infinite; }
.done svg, .failed svg { animation: pop .38s cubic-bezier(.34,1.56,.64,1); }
.compact .label { display: none; }
.tip { position: absolute; left: 50%; top: calc(100% + 8px); z-index: 2; transform: translate(-50%, -4px); padding: 8px; border-radius: 4px;
  background: rgba(97,97,97,.92); color: #fff; font: 400 12px/18px Roboto, Arial, sans-serif; white-space: nowrap; pointer-events: none;
  opacity: 0; transition: opacity .1s ease, transform .1s ease; }
.w:hover .tip { opacity: 1; transform: translate(-50%, 0); transition-delay: .5s; }
button[aria-expanded='true'] + .tip { display: none; }
@keyframes pulse { 50% { opacity: .45; } }
@keyframes pop { from { transform: scale(.4); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .fill, .tip { transition: none; } .busy svg, .done svg, .failed svg { animation: none; } }
`;

/* YouTube's menu, copied: 12 px corners, 8 px above and below, 36 px rows, 24 px icons 12 px before Roboto 14 px. */
const YT_MENU_CSS = `
:host { all: initial; }
.m { position: fixed; z-index: 2202; min-width: 240px; max-width: 320px; box-sizing: border-box; padding: 8px 0; border-radius: 12px;
  background: var(--menu); color: var(--t); box-shadow: var(--shadow); font: 400 14px/20px Roboto, Arial, sans-serif;
  animation: open .14s cubic-bezier(.2,.7,.2,1); transform-origin: top left; }
.m.up { transform-origin: bottom left; }
.h { padding: 8px 16px 4px; color: var(--t2); font-size: 12px; line-height: 18px; }
.r { all: unset; box-sizing: border-box; display: flex; align-items: center; width: 100%; min-height: 36px; padding: 0 12px 0 16px; cursor: pointer; white-space: nowrap; }
.r:hover, .r:focus-visible { background: var(--menu-hover); }
.r svg { display: block; width: 24px; height: 24px; flex: none; margin-right: 12px; }
.r .n { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.r .s { margin-left: 24px; color: var(--t2); font-variant-numeric: tabular-nums; }
/* A quality: its words in the same column as the other rows' (after their icon). */
.q { padding-left: 52px; }
.sep { height: 1px; margin: 8px 0; background: var(--sep); }
@keyframes open { from { opacity: 0; transform: scale(.96); } }
@media (prefers-reduced-motion: reduce) { .m { animation: none; } }
`;

/**
 * YouTube's own icons (2026, filled outlines on a 24 grid) where it has one, and drawings
 * in the same 2 px line elsewhere.
 */
const YT_ICONS = {
  down: { f: 'M12 2a1 1 0 00-1 1v11.586l-4.293-4.293a1 1 0 10-1.414 1.414L12 18.414l6.707-6.707a1 1 0 10-1.414-1.414L13 14.586V3a1 1 0 00-1-1Zm7 18H5a1 1 0 000 2h14a1 1 0 000-2Z' },
  chevron: { s: 'M6 9.5l6 6 6-6' },
  audio: { s: 'M9 17.5V5.5l10-2v12M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z' },
  photo: { s: 'M3 8.5a2 2 0 0 1 2-2h2.3l1.5-2.5h6.4l1.5 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' },
  later: { s: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2' },
  open: { s: 'M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' },
  check: { s: 'M5 12.5l4.5 4.5L19 7.5' },
  failed: { s: 'M12 7.5V13m0 3.5v.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z' },
};
type YtIcon = { f?: string; s?: string };

function ytSvg(icon: YtIcon): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, 'svg');
  const attrs: Record<string, string> = icon.f
    ? { viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' }
    : { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', icon.f ?? icon.s!);
  el.append(path);
  return el;
}

/** YouTube's colours, read from its own like button (light or dark, whatever YouTube shows). */
function ytColors(row: Element): string {
  const like = row.querySelector('segmented-like-dislike-button-view-model button, like-button-view-model button, button');
  const s = like ? getComputedStyle(like) : null;
  const rgb = (s?.color.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  const dark = rgb.length >= 3 ? (0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!) / 255 > 0.5 : document.documentElement.hasAttribute('dark');
  const bg = s && s.backgroundColor !== 'rgba(0, 0, 0, 0)' ? s.backgroundColor : dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
  const t = s?.color ?? (dark ? '#f1f1f1' : '#0f0f0f');
  return dark
    ? `--t: ${t}; --bg: ${bg}; --hover: rgba(255,255,255,.2); --line: rgba(255,255,255,.2); --t2: #aaaaaa; --menu: #282828; --menu-hover: rgba(255,255,255,.1); --sep: rgba(255,255,255,.2); --shadow: none;`
    : `--t: ${t}; --bg: ${bg}; --hover: rgba(0,0,0,.1); --line: rgba(0,0,0,.1); --t2: #606060; --menu: #ffffff; --menu-hover: rgba(0,0,0,.1); --sep: rgba(0,0,0,.1); --shadow: 0 4px 32px rgba(0,0,0,.1);`;
}

interface YtRow {
  el: HTMLElement;
  close: () => void;
}
type PageJob = { mode: 'video' | 'audio'; status: string; progress: number };
const ACTIVE = ['queued', 'downloading', 'capturing', 'processing', 'saving', 'paused'];
const stop = (el: Element) => {
  for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'dblclick']) el.addEventListener(ev, (e) => e.stopPropagation());
};

/**
 * Under YouTube's player, right after the thumbs: « Télécharger | ⌄ », a two-part pill like the
 * thumbs. « Télécharger » saves the video at once (and shows its progress); the arrow opens a
 * menu like YouTube's: the qualities, the sound alone, a photo, later, and Grabby's window.
 */
function ytRowIn(row: Element, video: () => HTMLVideoElement | null): YtRow {
  const el = document.createElement('grabby-yt');
  const root = el.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = YT_CSS;
  const colors = document.createElement('style');
  const seg = document.createElement('span');
  seg.className = 'seg';

  const mk = (tip: string) => {
    const w = document.createElement('span');
    w.className = 'w';
    const b = document.createElement('button');
    b.setAttribute('aria-label', tip);
    const t = document.createElement('span');
    t.className = 'tip';
    t.setAttribute('role', 'tooltip');
    t.textContent = tip;
    w.append(b, t);
    stop(b);
    return { w, b };
  };
  const main = mk(say('overlayVideoTitle'));
  const fillBar = document.createElement('span');
  fillBar.className = 'fill';
  const label = document.createElement('span');
  label.className = 'label';
  const more = mk(say('ytMore'));
  more.b.setAttribute('aria-haspopup', 'menu');
  more.b.setAttribute('aria-expanded', 'false');
  more.b.append(ytSvg(YT_ICONS.chevron));
  seg.append(main.w, more.w);
  root.append(style, colors, seg);

  const paint = () => {
    colors.textContent = `:host { ${ytColors(row)} }`;
  };
  /** What « Télécharger » shows: idle, a download's progress, then « Enregistré » or « Échec ». */
  const set = (state: '' | 'busy' | 'done' | 'failed', icon: YtIcon, words: string, progress = 0) => {
    main.b.className = state;
    label.textContent = words;
    fillBar.style.width = state === 'busy' ? `${Math.round(progress * 100)}%` : '0';
    main.b.replaceChildren(fillBar, ytSvg(icon), label);
  };
  const idle = () => set('', YT_ICONS.down, say('overlayVideo'));
  idle();

  let asked = 0;
  let seen = false;
  let until = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    clearTimeout(timer);
    if (!el.isConnected) return;
    const list = await ask<PageJob[]>({ type: 'page-jobs' }, []);
    const now = Date.now();
    if (now < until) return;
    const job = list.find((j) => ACTIVE.includes(j.status)) ?? list.find((j) => j.status === 'done' || j.status === 'error');
    let again = false;
    if (job && ACTIVE.includes(job.status)) {
      seen = true;
      again = true;
      const words = job.status === 'queued' ? say('ytQueued') : job.status === 'paused' ? say('ytPaused') : `${Math.round(job.progress * 100)} %`;
      set('busy', job.mode === 'audio' ? YT_ICONS.audio : YT_ICONS.down, words, job.progress);
    } else if (job && seen) {
      seen = false;
      until = now + 3000;
      const ok = job.status === 'done';
      set(ok ? 'done' : 'failed', ok ? YT_ICONS.check : YT_ICONS.failed, say(ok ? 'ytSaved' : 'ytFailed'));
      setTimeout(() => (idle(), void poll()), 3000);
    } else if (now - asked < 6000) again = true;
    else if (!seen) idle();
    if (again) timer = setTimeout(() => void poll(), 700);
  };
  const start = (mode: 'video' | 'audio', variantId?: string) => {
    asked = Date.now();
    set('busy', mode === 'audio' ? YT_ICONS.audio : YT_ICONS.down, say('ytQueued'), 0);
    void send({ type: 'grab', mode, ...(variantId ? { variantId } : {}) });
    timer = setTimeout(() => void poll(), 500);
  };
  main.b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (main.b.classList.contains('busy') || Date.now() < until) return;
    start('video');
  });

  /* The menu: its own host on the page (fixed), so no YouTube box can cut it. */
  let menu: HTMLElement | null = null;
  const close = () => {
    menu?.remove();
    menu = null;
    more.b.setAttribute('aria-expanded', 'false');
  };
  const open = async () => {
    const host = document.createElement('grabby-yt-menu');
    const mroot = host.attachShadow({ mode: 'closed' });
    const mstyle = document.createElement('style');
    mstyle.textContent = `${YT_MENU_CSS}:host { ${ytColors(row)} }`;
    const box = document.createElement('div');
    box.className = 'm';
    box.setAttribute('role', 'menu');
    stop(box);
    const item = (icon: YtIcon | null, text: string, side: string, act: () => void) => {
      const r = document.createElement('button');
      r.className = icon ? 'r' : 'r q';
      r.setAttribute('role', 'menuitem');
      if (icon) r.append(ytSvg(icon));
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = text;
      r.append(n);
      if (side) {
        const s = document.createElement('span');
        s.className = 's';
        s.textContent = side;
        r.append(s);
      }
      r.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
        act();
      });
      return r;
    };
    const divider = () => {
      const d = document.createElement('div');
      d.className = 'sep';
      return d;
    };
    const media = await ask<PageMedia | null>({ type: 'page-media' }, null);
    if (media?.qualities.length) {
      const h = document.createElement('div');
      h.className = 'h';
      h.textContent = (alive() && chrome.i18n.getMessage('ytQualities', [media.format.toUpperCase()])) || media.format.toUpperCase();
      box.append(h);
      media.qualities.slice(0, 6).forEach((q) => box.append(item(null, q.label, q.bytes ? size(q.bytes) : '', () => start('video', q.id))));
      box.append(divider());
    }
    box.append(
      item(YT_ICONS.audio, say('overlayAudio'), media ? media.audioFormat.toUpperCase() : '', () => start('audio')),
      item(YT_ICONS.photo, say('overlayPhoto'), '', () => {
        const v = video();
        if (v && ytShoot) void ytShoot(v);
      }),
      item(YT_ICONS.later, say('overlayLater'), '', () => void send({ type: 'later' })),
      divider(),
      item(YT_ICONS.open, say('ytOpenGrabby'), '', () => void send({ type: 'open-grabby' })),
    );
    mroot.append(mstyle, box);
    (document.body ?? document.documentElement).append(host);
    menu = host;
    more.b.setAttribute('aria-expanded', 'true');
    // Under the pill, its left edge on the pill's; above it when the page has no room below.
    const r = seg.getBoundingClientRect();
    const h = box.offsetHeight;
    const up = r.bottom + 4 + h > innerHeight && r.top - 4 - h > 0;
    box.classList.toggle('up', up);
    box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8))}px`;
    box.style.top = `${up ? r.top - 4 - h : r.bottom + 4}px`;
    (box.querySelector('.r') as HTMLElement | null)?.focus({ preventScroll: true });
  };
  more.b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu) close();
    else void open();
  });
  // A click elsewhere, Échap, a scroll or a new video close it, like YouTube's menus.
  document.addEventListener('pointerdown', (e) => {
    if (menu && !e.composedPath().includes(menu) && !e.composedPath().includes(el)) close();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu) {
      close();
      more.b.focus();
    }
  }, true);
  addEventListener('scroll', () => menu && close(), { passive: true });
  addEventListener('resize', () => menu && close());

  // Where YouTube puts it: right after the thumbs.
  const thumbs = row.querySelector(':scope > segmented-like-dislike-button-view-model, :scope > ytd-segmented-like-dislike-button-renderer, :scope > like-button-view-model');
  // A Grabby from before an update may have left its own: one only.
  for (const old of row.querySelectorAll('grabby-yt')) old.remove();
  if (thumbs) thumbs.after(el);
  else row.append(el);
  paint();
  // Too narrow for the word: the icon only, like YouTube does with its own buttons.
  const fit = () => {
    seg.classList.remove('compact');
    if (row.scrollWidth > row.clientWidth + 1) seg.classList.add('compact');
  };
  new ResizeObserver(fit).observe(row);
  // YouTube's theme changed (light / dark): its colours again.
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
  // A new video (YouTube changes pages without loading): back to idle, then what runs for it.
  document.addEventListener('yt-navigate-finish', () => {
    close();
    asked = 0;
    seen = false;
    until = 0;
    idle();
    paint();
    void poll();
  });
  void poll();
  return { el, close };
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
    if (!bar || bar.classList.contains('open') === open) return;
    bar.classList.toggle('open', open);
    const logo = bar.querySelector('.logo');
    logo?.setAttribute('aria-expanded', String(open));
    // Open: a cross folds it back; folded: Grabby's arrow.
    logo?.replaceChildren(svg(open ? ICONS.close : ICONS.logo, 17));
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
  ytShoot = shoot;
  // « Capture instantanée » from the keyboard: the biggest video on screen in this frame.
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type !== 'photo') return;
    const v = biggestVideo();
    if (v) void shoot(v);
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
      // YouTube's watch page has Grabby's buttons under its player instead.
      if (!enabled || document.fullscreenElement || e.pointerType === 'touch' || onYouTubeWatch()) return;
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

  // Under YouTube's player, right after the thumbs: YouTube's own buttons, to the pixel.
  let ytRow: YtRow | null = null;
  const ytCheck = () => {
    if (!enabled || !onYouTubeWatch()) return;
    const row = document.querySelector('ytd-watch-metadata #top-level-buttons-computed');
    if (!row) return;
    if (ytRow?.el.isConnected && row.contains(ytRow.el)) return;
    ytRow?.close();
    ytRow?.el.remove();
    ytRow = ytRowIn(row, () => (target && document.contains(target) ? target : biggestVideo()));
  };
  const ytTimer = window === window.top ? setInterval(ytCheck, 1500) : undefined;
  // Grabby updated while the page stays open: this one leaves the page to the new one.
  onDead(() => {
    clearInterval(ytTimer);
    hide();
    host?.remove();
    ytRow?.close();
    ytRow?.el.remove();
    ytRow = null;
    enabled = false;
  });

  const apply = (s?: { overlayButton?: boolean; accent?: string }) => {
    enabled = s?.overlayButton !== false;
    setAccent(s?.accent);
    if (!enabled) {
      hide();
      ytRow?.close();
      ytRow?.el.remove();
      ytRow = null;
    }
  };
  if (!alive()) return;
  void chrome.storage.local.get('settings').then((r) => apply(r.settings as { overlayButton?: boolean; accent?: string } | undefined)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) apply(changes.settings.newValue as { overlayButton?: boolean; accent?: string } | undefined);
  });
}
