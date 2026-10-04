/**
 * Visual harness: renders the real popup against a mocked `chrome` API so each UI state
 * can be screenshotted without a browser extension. Not part of the extension build.
 * Usage: npx vite test/ui  →  http://localhost:5173/?state=hero&theme=dark&lang=fr
 */
import en from '../../public/_locales/en/messages.json';
import fr from '../../public/_locales/fr/messages.json';
import type { PopupState } from '../../src/shared/messages';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { Job, MediaItem } from '../../src/shared/types';

const q = new URLSearchParams(location.search);
const messages = (q.get('lang') === 'fr' ? fr : en) as Record<string, { message: string }>;

const now = Date.now();
const base = (over: Partial<MediaItem>): MediaItem => ({
  id: 'x',
  tabId: 1,
  frameUrl: 'https://example.com/',
  pageUrl: 'https://example.com/watch/42',
  kind: 'hls',
  url: 'https://cdn.example.com/master.m3u8',
  title: 'Sunset over the harbour — a 4K timelapse shot over three evenings',
  variants: [],
  audioTracks: [],
  protection: 'none',
  live: false,
  detectedAt: now,
  ...over,
});

const hero = base({
  id: 'hero',
  thumbnail: '/thumb1.jpg',
  duration: 754,
  size: 412_000_000,
  variants: [
    { id: 'a', label: '1080p', height: 1080, url: '' },
    { id: 'b', label: '720p', height: 720, url: '' },
    { id: 'c', label: '480p', height: 480, url: '' },
    { id: 'd', label: '360p', height: 360, url: '' },
  ],
});
const capture = base({ id: 'cap', kind: 'capture', title: 'Clip from the embedded player', thumbnail: '/thumb2.jpg', duration: 48 });
const file = base({ id: 'file', kind: 'file', title: 'interview-raw.mp4', thumbnail: '/thumb3.jpg', duration: 1820, size: 98_000_000, variants: [] });
const locked = base({ id: 'lock', kind: 'dash', title: 'Premium episode 3', protection: 'drm', thumbnail: '/thumb2.jpg', duration: 2700 });

const job = (over: Partial<Job>): Job => ({
  id: 'j',
  tabId: 1,
  mediaId: 'hero',
  mode: 'video',
  status: 'downloading',
  progress: 0.42,
  bytes: 173_000_000,
  speed: 8_400_000,
  filename: 'Sunset over the harbour.mp4',
  title: hero.title,
  pageUrl: hero.pageUrl,
  kind: 'hls',
  startedAt: now,
  ...over,
});

const history = [
  { id: 'h1', filename: 'Sunset over the harbour.mp4', title: '', pageUrl: '', size: 412_000_000, date: now - 60_000 * 4, downloadId: 1 },
  { id: 'h2', filename: 'interview-raw.mp4', title: '', pageUrl: '', size: 98_000_000, date: now - 3_600_000 * 5, downloadId: 2 },
  { id: 'h3', filename: 'Podcast episode 12.m4a', title: '', pageUrl: '', size: 54_000_000, date: now - 86_400_000 * 2, downloadId: 3 },
];

const theme = (q.get('theme') ?? 'light') as 'light' | 'dark';
const settings = { ...DEFAULT_SETTINGS, theme, firstRunAck: q.get('state') !== 'firstrun' };

const STATES: Record<string, Partial<PopupState>> = {
  hero: { items: [hero, capture, file, locked] },
  downloading: { items: [hero, file], jobs: [job({})] },
  processing: { items: [hero], jobs: [job({ status: 'processing', progress: 0.9 })] },
  done: { items: [hero], jobs: [job({ status: 'done', progress: 1, downloadId: 1 })] },
  error: { items: [hero], jobs: [job({ status: 'error', error: 'http_403' })] },
  capturing: { items: [capture], jobs: [job({ mediaId: 'cap', status: 'capturing', progress: 0.63, kind: 'capture' })] },
  empty: { items: [] },
  youtube: { items: [], blocked: 'youtube' },
  firstrun: { items: [hero] },
  history: { items: [hero] },
  settings: { items: [hero] },
};

const state: PopupState = {
  tabId: 1,
  pageUrl: 'https://example.com/watch/42',
  items: [],
  jobs: [],
  history,
  settings,
  ...STATES[q.get('state') ?? 'hero'],
};

const listeners: ((m: unknown) => void)[] = [];
(globalThis as unknown as { chrome: unknown }).chrome = {
  i18n: {
    getMessage: (key: string, subs?: string | string[]) => {
      let m = messages[key]?.message ?? '';
      [subs ?? []].flat().forEach((s, i) => (m = m.replace(`$${i + 1}`, s)));
      return m;
    },
    getUILanguage: () => (q.get('lang') === 'fr' ? 'fr' : 'en'),
  },
  tabs: { query: async () => [{ id: 1 }] },
  runtime: {
    connect: () => ({
      onMessage: { addListener: (f: (m: unknown) => void) => listeners.push(f) },
      onDisconnect: { addListener: () => {} },
      postMessage: (m: { type: string }) => {
        if (m.type === 'subscribe') setTimeout(() => listeners.forEach((l) => l({ type: 'state', state })), 0);
      },
      disconnect: () => {},
    }),
  },
};
(globalThis as unknown as { __VERSION__: string }).__VERSION__ = '1.0.0';

await import('../../src/popup/main');

const after = q.get('state');
if (after === 'history') setTimeout(() => (document.querySelectorAll('[role=tab]')[1] as HTMLElement).click(), 50);
if (after === 'settings') setTimeout(() => (document.querySelector('[aria-label="Settings"],[aria-label="Réglages"]') as HTMLElement).click(), 50);
