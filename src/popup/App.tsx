import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Settings as S } from '../shared/settings';
import type { Job } from '../shared/types';
import { Icon } from './components/Icon';
import { isActive } from './components/JobBar';
import { MediaCard } from './components/MediaCard';
import { OtherJobs } from './components/OtherJobs';
import { FirstRun, HistoryList, StateCard } from './components/Panels';
import { Settings } from './components/Settings';
import { t } from './i18n';
import { reducedMotion } from './motion';
import { rank } from '../shared/rank';
import { useGrabby } from './store';
import { rememberTheme } from './theme';

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
/** How long the settings take to go away (groups, then title, then the page) before they leave the DOM. */
const SETTINGS_OUT_MS = 490;
const TABS = ['page', 'history'] as const;
type Tab = (typeof TABS)[number];

function latestJob(jobs: Job[], mediaId: string): Job | undefined {
  return jobs.filter((j) => j.mediaId === mediaId).sort((a, b) => b.startedAt - a.startedAt)[0];
}

/** Placeholder shaped like the list (a big card, then rows) while the first state arrives. */
function Skeleton() {
  return (
    <div class="skeleton" aria-busy="true" aria-label={t('loading')}>
      <div class="skeleton__hero" />
      <div class="skeleton__row" />
      <div class="skeleton__row" />
    </div>
  );
}

export function App() {
  const { state, send: rawSend } = useGrabby();
  // Settings changed here show at once, before the service worker sends them back: a second
  // quick click then starts from what the user sees, not from the state before the first.
  const [pending, setPending] = useState<Partial<S>>({});
  const send: typeof rawSend = (m) => {
    if (m.type === 'settings') setPending((p) => ({ ...p, ...m.patch }));
    rawSend(m);
  };
  useEffect(() => {
    if (!state) return;
    // What the service worker now confirms is no longer pending.
    setPending((p) => {
      const left = Object.fromEntries(Object.entries(p).filter(([k, v]) => state.settings[k as keyof S] !== v));
      return Object.keys(left).length === Object.keys(p).length ? p : left;
    });
  }, [state?.settings]);
  useEffect(() => {
    // Never stuck on a value the service worker didn't keep.
    if (!Object.keys(pending).length) return;
    const t = setTimeout(() => setPending({}), 3000);
    return () => clearTimeout(t);
  }, [pending]);
  const settings = state ? { ...state.settings, ...pending } : undefined;
  const [tab, setTab] = useState<Tab>('page');
  // Which way the new panel slides in: towards the tab the user went to.
  const prevTab = useRef<Tab>('page');
  const step = TABS.indexOf(tab) - TABS.indexOf(prevTab.current);
  const dir = step > 0 ? 'next' : step < 0 ? 'prev' : 'same';
  // Settings slide over the list; `closing` keeps them mounted while they slide back out.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gear = useRef<HTMLButtonElement>(null);
  // The big card: the first one until the user opens another ('' = none).
  const [openId, setOpenId] = useState<string | undefined>();
  const [systemDark, setSystemDark] = useState(prefersDark());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const theme = settings?.theme;
  const dark = theme === 'dark' || ((theme ?? 'auto') === 'auto' && systemDark);
  useEffect(() => {
    // Until the settings arrive, keep what main.tsx painted (the remembered theme).
    if (!theme) return;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    rememberTheme(theme);
  }, [dark, theme]);

  const items = useMemo(() => rank(state?.items ?? []), [state?.items]);
  // Jobs of this tab go on their cards; the others (another tab, before a restart) get a list.
  const here = (state?.jobs ?? []).filter((j) => j.tabId === state?.tabId);
  const elsewhere = (state?.jobs ?? []).filter((j) => isActive(j) && !(j.tabId === state?.tabId && items.some((i) => i.id === j.mediaId)));
  const prefs = { video: settings?.videoFormat ?? 'mp4', audio: settings?.audioFormat ?? 'm4a' } as const;
  const openCard = openId ?? items[0]?.id;

  const go = (next: Tab) => {
    prevTab.current = tab;
    setTab(next);
  };
  const openSettings = () => {
    // Reopened while still sliding away: it stays.
    clearTimeout(closing.current);
    setSettingsClosing(false);
    setSettingsOpen(true);
  };
  // Stable, so the settings page doesn't re-run its effects (and steal focus) on every state push.
  const closeSettings = useCallback(() => {
    const gone = () => {
      setSettingsOpen(false);
      setSettingsClosing(false);
      // Focus goes back where it came from.
      requestAnimationFrame(() => gear.current?.focus());
    };
    if (reducedMotion()) return gone();
    setSettingsClosing(true);
    closing.current = setTimeout(gone, SETTINGS_OUT_MS);
  }, []);
  useEffect(() => () => clearTimeout(closing.current), []);
  const settingsShown = settingsOpen && !settingsClosing;

  return (
    <div class="app">
      {/* The main screen steps back (and stays put) while settings slide over it. */}
      <div class={`shell${settingsShown ? ' shell--behind' : ''}`} aria-hidden={settingsOpen} {...(settingsOpen ? { inert: true } : {})}>
        <header class="top">
          <span class="brand">
            <span class="brand__tile">
              <Icon name="logo" size={18} />
            </span>
            Grabby
          </span>
          <span class="top__tools">
            <button
              class="icon-btn"
              aria-label={dark ? t('switchToLight') : t('switchToDark')}
              title={dark ? t('switchToLight') : t('switchToDark')}
              onClick={() => send({ type: 'settings', patch: { theme: dark ? 'light' : 'dark' } })}
            >
              {/* Keyed: the new icon spins in. */}
              <span key={dark ? 'sun' : 'moon'} class="spin-in">
                <Icon name={dark ? 'sun' : 'moon'} />
              </span>
            </button>
            <button ref={gear} class="icon-btn" aria-label={t('openSettings')} title={t('openSettings')} onClick={openSettings}>
              <Icon name="settings" />
            </button>
          </span>
        </header>

        <nav class="seg" role="tablist" style={{ '--n': '2', '--at': String(TABS.indexOf(tab)) }}>
          <span class="seg__thumb" aria-hidden="true">
            {/* Keyed by tab: the pill squashes against the side it lands on, never past it. */}
            <span key={tab} class={`seg__jelly${dir === 'same' ? '' : ` seg__jelly--${dir}`}`} />
          </span>
          {TABS.map((k) => (
            <button
              key={k}
              id={`tab-${k}`}
              role="tab"
              aria-selected={tab === k}
              aria-controls="panel"
              tabIndex={tab === k ? 0 : -1}
              class={tab === k ? 'on' : ''}
              onClick={() => go(k)}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const next = TABS[(TABS.indexOf(k) + step + TABS.length) % TABS.length]!;
                go(next);
                document.getElementById(`tab-${next}`)?.focus();
              }}
            >
              {k === 'page' ? t('tabPage') : t('tabHistory')}
              {k === 'page' && items.length > 0 && (
                <span key={items.length} class="count">
                  {items.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <main class="content">
          {!state ? (
            <Skeleton />
          ) : (
            // Keyed by tab: the new panel slides in from the side of the tab chosen.
            <div key={tab} id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} class={`panel panel--${dir}`}>
              {tab === 'history' ? (
                <HistoryList entries={state.history} send={send} />
              ) : (
                <>
                  {!settings!.firstRunAck && <FirstRun onOk={() => send({ type: 'settings', patch: { firstRunAck: true } })} />}
                  <OtherJobs jobs={elsewhere} send={send} />
                  {state.blocked === 'restricted' ? (
                    <StateCard icon="lock" title={t('restrictedTitle')} body={t('restrictedBody')} />
                  ) : !items.length ? (
                    <StateCard icon="film" title={t('emptyTitle')} body={t('emptyBody')} />
                  ) : (
                    <section class="list" aria-label={t('tabPage')}>
                      {items.map((i, n) => (
                        <MediaCard
                          key={i.id}
                          item={i}
                          index={n}
                          job={latestJob(here, i.id)}
                          open={i.id === openCard}
                          onToggle={() => setOpenId(i.id === openCard ? '' : i.id)}
                          preferred={prefs}
                          send={send}
                        />
                      ))}
                    </section>
                  )}
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {settingsOpen && state && settings && (
        <Settings
          class={settingsClosing ? 'page--out' : 'page--in'}
          settings={settings}
          browserAsks={!!state.browserAsks}
          onChange={(patch) => send({ type: 'settings', patch })}
          onOpenBrowserSettings={() => send({ type: 'open-browser-downloads' })}
          onClose={closeSettings}
        />
      )}
    </div>
  );
}
