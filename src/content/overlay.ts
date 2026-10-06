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
 * YouTube's buttons, copied: 36 px pills, Roboto 500 14 px, 24 px icons, its own colors
 * (its CSS variables reach into the shadow root, so light and dark follow YouTube's theme),
 * its divider in the two-part pill and its tooltip under the button.
 */
const YT_CSS = `
:host { all: initial; display: inline-flex; align-items: center; gap: 8px; margin-left: 8px; flex: none;
  --t: var(--yt-spec-text-primary, #f1f1f1); --bg: var(--yt-spec-badge-chip-background, rgba(255,255,255,.1));
  --hover: var(--yt-spec-button-chip-background-hover, rgba(255,255,255,.2)); --line: var(--yt-spec-10-percent-layer, rgba(255,255,255,.2)); }
.seg { position: relative; display: inline-flex; align-items: center; height: 36px; border-radius: 18px; background: var(--bg); }
.w { position: relative; display: inline-flex; }
button { all: unset; box-sizing: border-box; position: relative; display: inline-flex; align-items: center; height: 36px; padding: 0 16px; border-radius: 18px;
  color: var(--t); background: var(--bg); font: 500 14px/36px Roboto, Arial, sans-serif; white-space: nowrap; cursor: pointer; overflow: hidden;
  transition: background-color .1s ease; -webkit-tap-highlight-color: transparent; }
.seg button { background: transparent; }
.seg .w:first-child button { border-radius: 18px 0 0 18px; }
.seg .w:last-child button { border-radius: 0 18px 18px 0; }
button:hover { background: var(--hover); }
button:active { background: var(--line); }
button:focus-visible { box-shadow: inset 0 0 0 2px var(--t); }
button.round { width: 36px; padding: 0; justify-content: center; }
.sep { width: 1px; height: 24px; background: var(--line); flex: none; }
svg { width: 24px; height: 24px; flex: none; margin: 0 6px 0 -6px; }
.round svg { margin: 0; }
.label { position: relative; font-variant-numeric: tabular-nums; }
.fill { position: absolute; inset: 0 auto 0 0; width: 0; background: var(--line); pointer-events: none; transition: width .5s cubic-bezier(.2,.7,.2,1); }
button > svg, button > .label { position: relative; }
.busy svg { animation: pulse 1.4s ease-in-out infinite; }
.done svg, .failed svg { animation: pop .38s cubic-bezier(.34,1.56,.64,1); }
.compact .seg .label { display: none; }
.compact .seg svg { margin: 0; }
.compact .seg button { padding: 0 12px; }
.tip { position: absolute; left: 50%; top: calc(100% + 8px); z-index: 2; transform: translate(-50%, -4px); padding: 8px; border-radius: 4px;
  background: rgba(97,97,97,.92); color: #fff; font: 400 12px/18px Roboto, Arial, sans-serif; white-space: nowrap; pointer-events: none;
  opacity: 0; transition: opacity .1s ease, transform .1s ease; }
.w:hover .tip { opacity: 1; transform: translate(-50%, 0); transition-delay: .5s; }
.w:focus-within .tip { opacity: 1; transform: translate(-50%, 0); }
@keyframes pulse { 50% { opacity: .45; } }
@keyframes pop { from { transform: scale(.4); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .fill, .tip, button { transition: none; } .busy svg, .done svg, .failed svg { animation: none; } }
`;

const YT_ICONS = {
  down: ICONS.down,
  audio: ICONS.audio,
  photo: ICONS.photo,
  later: ICONS.later,
  check: ICONS.check,
  failed: 'M12 7.5v5.5m0 3.5v.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
};

interface YtRow {
  el: HTMLElement;
}
type PageJob = { mode: 'video' | 'audio'; status: string; progress: number };
const ACTIVE = ['queued', 'downloading', 'capturing', 'processing', 'saving', 'paused'];

/** A YouTube button: icon, label (none for a round one) and the tooltip YouTube shows. */
function ytButton(icon: string, label: string, tip: string, round = false) {
  const w = document.createElement('span');
  w.className = 'w';
  const b = document.createElement('button');
  if (round) b.className = 'round';
  b.setAttribute('aria-label', tip);
  const fill = document.createElement('span');
  fill.className = 'fill';
  const text = document.createElement('span');
  text.className = 'label';
  const t = document.createElement('span');
  t.className = 'tip';
  t.setAttribute('role', 'tooltip');
  t.textContent = tip;
  w.append(b, t);
  const set = (state: '' | 'busy' | 'done' | 'failed', ic: string, words: string, progress = 0) => {
    b.className = [round ? 'round' : '', state].filter(Boolean).join(' ');
    text.textContent = words;
    fill.style.width = state === 'busy' ? `${Math.round(progress * 100)}%` : '0';
    b.replaceChildren(fill, svg(ic, 24), ...(round ? [] : [text]));
  };
  set('', icon, label);
  for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'dblclick']) b.addEventListener(ev, (e) => e.stopPropagation());
  return { w, b, set };
}

function ytRowIn(row: Element, video: () => HTMLVideoElement | null): YtRow {
  const el = document.createElement('grabby-yt');
  const root = el.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = YT_CSS;
  const wrap = document.createElement('span');
  wrap.style.display = 'contents';
  const seg = document.createElement('span');
  seg.className = 'seg';
  const sep = document.createElement('span');
  sep.className = 'sep';
  const parts = {
    video: ytButton(YT_ICONS.down, say('overlayVideo'), say('overlayVideoTitle')),
    audio: ytButton(YT_ICONS.audio, say('overlayAudio'), say('overlayAudioTitle')),
  };
  seg.append(parts.video.w, sep, parts.audio.w);
  const photo = ytButton(YT_ICONS.photo, '', say('overlayPhoto'), true);
  const later = ytButton(YT_ICONS.later, '', say('overlayLater'), true);
  wrap.append(seg, photo.w, later.w);
  root.append(style, wrap);

  /** What each half shows: idle, the download's progress, then a moment of "saved" or "failed". */
  const shown: Record<'video' | 'audio', { asked: number; seen: boolean; until: number }> = {
    video: { asked: 0, seen: false, until: 0 },
    audio: { asked: 0, seen: false, until: 0 },
  };
  const idle = (m: 'video' | 'audio') => parts[m].set('', m === 'video' ? YT_ICONS.down : YT_ICONS.audio, say(m === 'video' ? 'overlayVideo' : 'overlayAudio'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    clearTimeout(timer);
    const list = ((await chrome.runtime.sendMessage({ type: 'page-jobs' } satisfies ContentToBg).catch(() => [])) ?? []) as PageJob[];
    const now = Date.now();
    let again = false;
    for (const m of ['video', 'audio'] as const) {
      const s = shown[m];
      const job = list.find((j) => j.mode === m);
      if (now < s.until) continue;
      if (job && ACTIVE.includes(job.status)) {
        s.seen = true;
        again = true;
        const words = job.status === 'queued' ? say('ytQueued') : job.status === 'paused' ? say('ytPaused') : `${Math.round(job.progress * 100)} %`;
        parts[m].set('busy', m === 'video' ? YT_ICONS.down : YT_ICONS.audio, words, job.progress);
      } else if (job && s.seen && (job.status === 'done' || job.status === 'error')) {
        s.seen = false;
        s.until = now + 3000;
        parts[m].set(job.status === 'done' ? 'done' : 'failed', job.status === 'done' ? YT_ICONS.check : YT_ICONS.failed, say(job.status === 'done' ? 'ytSaved' : 'ytFailed'));
        setTimeout(() => (idle(m), void poll()), 3000);
      } else if (now - s.asked < 6000) {
        // Just asked: the job is on its way.
        again = true;
      } else if (!s.seen) idle(m);
    }
    if (again) timer = setTimeout(() => void poll(), 700);
  };
  for (const m of ['video', 'audio'] as const) {
    parts[m].b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (parts[m].b.classList.contains('busy') || Date.now() < shown[m].until) return;
      shown[m].asked = Date.now();
      parts[m].set('busy', m === 'video' ? YT_ICONS.down : YT_ICONS.audio, say('ytQueued'), 0);
      grab(undefined, m);
      timer = setTimeout(() => void poll(), 500);
    });
  }
  const flash = (b: ReturnType<typeof ytButton>, icon: string) => {
    b.set('done', YT_ICONS.check, '');
    setTimeout(() => b.set('', icon, ''), 1500);
  };
  photo.b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const v = video();
    if (v && ytShoot) void ytShoot(v).then(() => flash(photo, YT_ICONS.photo));
  });
  later.b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void send({ type: 'later' }).then(() => flash(later, YT_ICONS.later));
  });

  // Where YouTube puts it: right after the thumbs.
  const thumbs = row.querySelector(':scope > segmented-like-dislike-button-view-model, :scope > ytd-segmented-like-dislike-button-renderer, :scope > like-button-view-model');
  if (thumbs) thumbs.after(el);
  else row.append(el);
  // Too narrow for the words: the two-part pill keeps its icons, like YouTube does.
  const fit = () => {
    wrap.classList.remove('compact');
    if (row.scrollWidth > row.clientWidth + 1) wrap.classList.add('compact');
  };
  new ResizeObserver(fit).observe(row);
  // A new video (YouTube changes pages without loading): back to idle, then what runs for it.
  document.addEventListener('yt-navigate-finish', () => {
    for (const m of ['video', 'audio'] as const) {
      shown[m] = { asked: 0, seen: false, until: 0 };
      idle(m);
    }
    void poll();
  });
  void poll();
  return { el };
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
    ytRow?.el.remove();
    ytRow = ytRowIn(row, () => (target && document.contains(target) ? target : biggestVideo()));
  };
  if (window === window.top) setInterval(ytCheck, 1500);

  const apply = (s?: { overlayButton?: boolean; accent?: string }) => {
    enabled = s?.overlayButton !== false;
    setAccent(s?.accent);
    if (!enabled) {
      hide();
      ytRow?.el.remove();
      ytRow = null;
    }
  };
  void chrome.storage.local.get('settings').then((r) => apply(r.settings as { overlayButton?: boolean; accent?: string } | undefined)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) apply(changes.settings.newValue as { overlayButton?: boolean; accent?: string } | undefined);
  });
}
