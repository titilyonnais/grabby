/**
 * Grabby under YouTube's player: a pill like YouTube's own buttons, right after the thumbs,
 * with a menu like YouTube's. It lives in closed shadow roots, so the page's styles can't reach
 * it, and can be turned off in the settings. (No button floats over videos any more: the pill
 * and the popup do that job.) Also takes « Capture instantanée » (the keyboard shortcut).
 */
import type { ContentToBg, PageMedia } from '../shared/messages';
import { size } from '../popup/i18n';
import { alive, message, onDead, safely } from './alive';

const say = (key: string, subs?: string[]) => safely(() => chrome.i18n.getMessage(key, subs), '') || key;
const send = (msg: ContentToBg) => message(msg);

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

/**
 * The video a photo is taken of: the biggest one on screen, else the page's player even out of
 * view (comments scrolled to, the mini player) or not started yet (null: no video at all).
 */
function photoVideo(): HTMLVideoElement | null {
  return (
    biggestVideo() ??
    document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video') ??
    [...document.querySelectorAll('video')].sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0] ??
    null
  );
}

/**
 * « Photo »: the picture on screen, at the video's own size when the site allows it. Always
 * answered by a message, « Photo enregistrée » or why not: never a click that does nothing.
 */
async function shoot(v: HTMLVideoElement | null): Promise<unknown> {
  // No video, or no picture in it yet (not started): said so.
  if (!v || v.readyState < 2 || !v.videoWidth) return send({ type: 'snap', noFrame: true });
  const still = stillOf(v);
  if (still) return send({ type: 'snap', dataUrl: still, time: v.currentTime });
  const r = v.getBoundingClientRect();
  return send({ type: 'snap', rect: { x: r.left, y: r.top, w: r.width, h: r.height }, dpr: devicePixelRatio, time: v.currentTime });
}

/*
 * YouTube's buttons, copied from youtube.com (2026), layer by layer:
 * - the button: 40 px, padding 0 16 px, corners of 20 px, Roboto 500 14 px, its 24 px icon 6 px
 *   before the words; its fill turns from 10 % to 20 % white (dark) or 5 % to 10 % black (light)
 *   under the pointer — it replaces the fill, it isn't laid over it;
 * - over it, YouTube's « light shape »: a rim light, a gradient from white at the top (5 % dark,
 *   20 % light) to nothing at 75 % — measured pixel by pixel against « Partager », still and
 *   under the pointer, light and dark;
 * - the two halves of a two-part pill each have their own fill, the first one a divider of
 *   1 × 24 px on its right edge.
 */
const YT_CSS = `
:host { all: initial; display: inline-flex; align-items: center; flex: none; vertical-align: top; }
.seg { position: relative; display: inline-flex; align-items: center; height: 40px; }
.w { position: relative; display: inline-flex; }
button { all: unset; box-sizing: border-box; position: relative; display: inline-flex; align-items: center; justify-content: center; height: 40px; padding: 0 16px;
  border-radius: 20px 0 0 20px; color: var(--t); background: var(--bg); font: 500 14px/40px Roboto, Arial, sans-serif; white-space: nowrap; cursor: pointer;
  -webkit-tap-highlight-color: transparent; }
.w + .w button { width: 48px; padding: 0 12px; border-radius: 0 20px 20px 0; }
button:hover, button[aria-expanded='true'] { background: var(--hover); }
button:focus-visible { outline: 2px solid var(--t); outline-offset: -2px; }
.light, .light::before { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.light { overflow: hidden; }
.light::before { content: ''; background: linear-gradient(var(--rim), rgba(0,0,0,0) 75%); }
.w:first-child button::after { content: ''; position: absolute; right: 0; top: 8px; width: 1px; height: 24px; background: var(--line); }
svg { position: relative; display: block; width: 24px; height: 24px; flex: none; }
.label { position: relative; margin-left: 6px; font-variant-numeric: tabular-nums; }
.fill { position: absolute; inset: 0 auto 0 0; width: 0; border-radius: inherit; background: var(--line); pointer-events: none; transition: width .5s cubic-bezier(.2,.7,.2,1); }
.busy svg { animation: pulse 1.4s ease-in-out infinite; }
.done svg, .failed svg { animation: pop .38s cubic-bezier(.34,1.56,.64,1); }
/* Too narrow: the icon only — but never while it counts (the percentage always shows). */
.compact button:not(.busy):not(.done):not(.failed) .label { display: none; }
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

/** YouTube's colours (2026), dark and light, as read on its own « Partager » button and menus. */
const DARK = '--t: #f1f1f1; --bg: rgba(255,255,255,.1); --hover: rgba(255,255,255,.2); --rim: rgba(255,255,255,.05); --line: rgba(255,255,255,.2); --t2: #aaaaaa; --menu: #282828; --menu-hover: rgba(255,255,255,.1); --sep: rgba(255,255,255,.2); --shadow: none;';
const LIGHT = '--t: #0f0f0f; --bg: rgba(0,0,0,.05); --hover: rgba(0,0,0,.1); --rim: rgba(255,255,255,.2); --line: rgba(0,0,0,.1); --t2: #606060; --menu: #ffffff; --menu-hover: rgba(0,0,0,.1); --sep: rgba(0,0,0,.1); --shadow: 0 4px 32px rgba(0,0,0,.1);';

/** Light or dark, as YouTube shows it: the colour of its own like button's words. */
function ytColors(row: Element): string {
  const like = row.querySelector('segmented-like-dislike-button-view-model button, like-button-view-model button, button');
  const rgb = ((like ? getComputedStyle(like).color : '').match(/\d+(\.\d+)?/g) ?? []).map(Number);
  const dark = rgb.length >= 3 ? (0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!) / 255 > 0.5 : document.documentElement.hasAttribute('dark');
  return dark ? DARK : LIGHT;
}

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

interface YtRow {
  el: HTMLElement;
  close: () => void;
  stop: () => void;
}
type PageJob = { mode: 'video' | 'audio'; status: string; progress: number };
const ACTIVE = ['queued', 'downloading', 'capturing', 'processing', 'saving', 'paused'];
const quiet = (el: Element) => {
  // The page's player must not take these clicks (play/pause).
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
    quiet(b);
    return { w, b };
  };
  const light = () => {
    const l = document.createElement('span');
    l.className = 'light';
    return l;
  };
  const main = mk(say('overlayVideoTitle'));
  const fillBar = document.createElement('span');
  fillBar.className = 'fill';
  const label = document.createElement('span');
  label.className = 'label';
  const more = mk(say('ytMore'));
  more.b.setAttribute('aria-haspopup', 'menu');
  more.b.setAttribute('aria-expanded', 'false');
  more.b.append(light(), ytSvg(YT_ICONS.chevron));
  seg.append(main.w, more.w);
  root.append(style, colors, seg);

  const paint = () => {
    colors.textContent = `:host { ${ytColors(row)} }`;
  };
  /** What « Télécharger » shows: idle, a download's progress, then « Enregistré » or « Échec ». */
  // What it says changes its width: whether the word fits is decided again (set further down).
  let refit = () => {};
  const set = (state: '' | 'busy' | 'done' | 'failed', icon: YtIcon, words: string, progress = 0) => {
    const same = main.b.className === state && label.textContent === words;
    main.b.className = state;
    label.textContent = words;
    fillBar.style.width = state === 'busy' ? `${Math.round(progress * 100)}%` : '0';
    if (same) return;
    main.b.replaceChildren(light(), fillBar, ytSvg(icon), label);
    refit();
  };
  const idle = () => set('', YT_ICONS.down, say('overlayVideo'));
  idle();

  let asked = 0;
  let seen = false;
  let until = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    clearTimeout(timer);
    if (!el.isConnected || !alive()) return;
    const list = (await message<PageJob[]>({ type: 'page-jobs' } satisfies ContentToBg, [])) ?? [];
    const now = Date.now();
    if (now < until) return;
    const job = list.find((j) => ACTIVE.includes(j.status)) ?? list.find((j) => j.status === 'done' || j.status === 'error' || j.status === 'canceled');
    let again = false;
    if (job && ACTIVE.includes(job.status)) {
      seen = true;
      again = true;
      const words = job.status === 'queued' ? say('ytQueued') : job.status === 'paused' ? say('ytPaused') : `${Math.round(job.progress * 100)} %`;
      set('busy', job.mode === 'audio' ? YT_ICONS.audio : YT_ICONS.down, words, job.progress);
    } else if (job?.status === 'canceled' && seen) {
      // Cancelled (here, in the popup or in the full page): back to « Télécharger » at once.
      seen = false;
      idle();
    } else if (job && seen) {
      seen = false;
      until = now + 3000;
      const ok = job.status === 'done';
      set(ok ? 'done' : 'failed', ok ? YT_ICONS.check : YT_ICONS.failed, say(ok ? 'ytSaved' : 'ytFailed'));
      timer = setTimeout(() => (idle(), void poll()), 3000);
      return;
    } else if (now - asked < 6000) again = true;
    else {
      // Nothing running any more, whatever became of it (cancelled, then cleared away): idle,
      // never a pill stuck on its last figure.
      seen = false;
      idle();
    }
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
    quiet(box);
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
    const media = (await message<PageMedia | null>({ type: 'page-media' } satisfies ContentToBg, null)) ?? null;
    if (!alive()) return;
    if (media?.qualities.length) {
      const h = document.createElement('div');
      h.className = 'h';
      h.textContent = say('ytQualities', [media.format.toUpperCase()]);
      box.append(h);
      for (const q of media.qualities.slice(0, 6)) box.append(item(null, q.label, q.bytes ? safely(() => size(q.bytes), '') : '', () => start('video', q.id)));
      box.append(divider());
    }
    box.append(
      item(YT_ICONS.audio, say('overlayAudio'), media ? media.audioFormat.toUpperCase() : '', () => start('audio')),
      item(YT_ICONS.photo, say('overlayPhoto'), '', () => void shoot(video())),
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
  const onDown = (e: PointerEvent) => {
    if (menu && !e.composedPath().includes(menu) && !e.composedPath().includes(el)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && menu) {
      close();
      more.b.focus();
    }
  };
  const onMove = () => menu && close();
  const onNavigate = () => {
    close();
    asked = 0;
    seen = false;
    until = 0;
    idle();
    paint();
    refit();
    void poll();
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  addEventListener('scroll', onMove, { passive: true });
  addEventListener('resize', onMove);
  // A new video (YouTube changes pages without loading): back to idle, then what runs for it.
  document.addEventListener('yt-navigate-finish', onNavigate);

  // Where YouTube puts it: right after the thumbs. A Grabby from before an update may have
  // left its own: one only.
  for (const old of row.querySelectorAll('grabby-yt')) old.remove();
  const thumbs = row.querySelector(':scope > segmented-like-dislike-button-view-model, :scope > ytd-segmented-like-dislike-button-renderer, :scope > like-button-view-model');
  if (thumbs) thumbs.after(el);
  else row.append(el);
  paint();

  /*
   * Spaced like YouTube's own buttons, whatever this version of YouTube does it with (a margin
   * on the next button, a gap on the row): the same space on both sides as between the thumbs
   * and the button that follows them.
   */
  const WANT = 8;
  const margin = (side: 'marginLeft' | 'marginRight', px: number) => {
    const v = `${Math.min(WANT, Math.max(-WANT, Math.round(px)))}px`;
    if (el.style[side] !== v) el.style[side] = v;
  };
  const own = (side: 'marginLeft' | 'marginRight') => parseFloat(el.style[side]) || 0;
  // What is drawn of a neighbour: its button on Grabby's side when it has some (a wrapper may
  // be wider than what it shows; the thumbs are two buttons).
  const drawn = (n: Element, side: 'first' | 'last') => {
    const all = n.matches('button') ? [n] : Array.from(n.querySelectorAll('button')).filter((b) => b.getBoundingClientRect().width > 0);
    const b = side === 'first' ? all[0] : all[all.length - 1];
    return (b ?? n).getBoundingClientRect();
  };
  /*
   * The space YouTube itself leaves on each side of Grabby (whatever gives it: a margin on
   * the next button or inside it, a gap on the row), measured between what is drawn, Grabby's
   * own margin taken out — so what Grabby writes never changes what it reads. Each side is
   * then made 8 px, like between YouTube's buttons, with a margin between −8 and 8 px.
   */
  const space = () => {
    let next = el.nextElementSibling;
    while (next && getComputedStyle(next).display === 'none') next = next.nextElementSibling;
    const me = el.getBoundingClientRect();
    if (thumbs) {
      const left = drawn(thumbs, 'last');
      margin('marginLeft', WANT - (me.left - own('marginLeft') - left.right));
    } else margin('marginLeft', WANT);
    const right = next ? drawn(next, 'first') : undefined;
    // Put on the next line by YouTube (or nothing after): no space to make on this side.
    if (!right || Math.abs(right.top + right.height / 2 - (me.top + me.height / 2)) > me.height / 2) margin('marginRight', 0);
    else margin('marginRight', WANT - (right.left - me.right - own('marginRight')));
  };
  // Too narrow for the word: the icon only, like YouTube does with its own buttons. Too narrow
  // means the row spills out of itself, or pushes YouTube's « ⋯ » out of its menu, or out of the
  // window. Decided afresh each time from the word shown (in the same task, so never painted):
  // nothing carried over, so it comes back as soon as there is room again.
  const menuBox = row.parentElement ?? row;
  const column = row.closest('ytd-watch-metadata');
  const spill = () => {
    const box = menuBox.getBoundingClientRect();
    const end = menuBox.scrollWidth;
    return Math.max(
      row.scrollWidth - row.clientWidth,
      end - menuBox.clientWidth,
      // Where the menu's content ends, left to right or right to left.
      box.left + end - document.documentElement.clientWidth,
      end - box.right,
    );
  };
  const fit = () => {
    space();
    const compact = seg.classList.contains('compact');
    if (compact) seg.classList.remove('compact');
    if (spill() > 1) seg.classList.add('compact');
  };
  refit = fit;
  const sizes = new ResizeObserver(fit);
  sizes.observe(row);
  if (menuBox !== row) sizes.observe(menuBox);
  if (column) sizes.observe(column);
  // YouTube's theme changed (light / dark): its colours again.
  const theme = new MutationObserver(paint);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
  void poll();

  const stop = () => {
    close();
    clearTimeout(timer);
    sizes.disconnect();
    theme.disconnect();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('scroll', onMove);
    removeEventListener('resize', onMove);
    document.removeEventListener('yt-navigate-finish', onNavigate);
    el.remove();
  };
  return { el, close, stop };
}

export function startOverlay() {
  if (!/^https?:$/.test(location.protocol)) return;
  let enabled = true;

  // « Capture instantanée » from the keyboard: the biggest video on screen in this frame.
  safely(
    () =>
      chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
        if (msg?.type !== 'photo' || !alive()) return;
        void shoot(photoVideo());
      }),
    undefined,
  );

  // Under YouTube's player, right after the thumbs: YouTube's own buttons, to the pixel.
  let ytRow: YtRow | null = null;
  const drop = () => {
    ytRow?.stop();
    ytRow = null;
  };
  const ytCheck = () => {
    if (!enabled || !alive() || !onYouTubeWatch()) return;
    const row = document.querySelector('ytd-watch-metadata #top-level-buttons-computed');
    if (!row) return;
    if (ytRow?.el.isConnected && row.contains(ytRow.el)) return;
    drop();
    ytRow = ytRowIn(row, photoVideo);
  };
  const ytTimer = window === window.top ? setInterval(ytCheck, 1500) : undefined;
  // Grabby updated while the page stays open: this one leaves the page to the new one.
  onDead(() => {
    clearInterval(ytTimer);
    drop();
    enabled = false;
  });

  const apply = (s?: { overlayButton?: boolean }) => {
    enabled = s?.overlayButton !== false;
    if (!enabled) drop();
  };
  safely(() => {
    void chrome.storage.local
      .get('settings')
      .then((r) => {
        apply(r.settings as { overlayButton?: boolean } | undefined);
        // At once, not at the next check: after an update the old pill no longer answers.
        ytCheck();
      })
      .catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings && alive()) apply(changes.settings.newValue as { overlayButton?: boolean } | undefined);
    });
  }, undefined);
}
