import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Settings } from '../shared/settings';
import { Icon, type IconName } from '../popup/components/Icon';
import { isActive } from '../popup/components/JobBar';
import { t } from '../popup/i18n';
import { useGrabby } from '../popup/store';
import { rememberTheme } from '../popup/theme';
import { Addresses } from './sections/Addresses';
import { Backup } from './sections/Backup';
import { Channels } from './sections/Channels';
import { Join } from './sections/Join';
import { Library } from './sections/Library';
import { Rules } from './sections/Rules';
import { Workshop } from './sections/Workshop';

interface Section {
  id: string;
  icon: IconName;
  /** Its own color: the icon's tile, the page's header. */
  color: string;
}

/** The sections, in groups: what was saved, what to download, what to make, how it works. */
const GROUPS: { id: string; sections: Section[] }[] = [
  { id: 'files', sections: [{ id: 'library', icon: 'grid', color: '#ff5b4f' }] },
  {
    id: 'get',
    sections: [
      { id: 'batch', icon: 'link', color: '#4f8df5' },
      { id: 'channels', icon: 'bell', color: '#ef4444' },
    ],
  },
  {
    id: 'make',
    sections: [
      { id: 'workshop', icon: 'wand', color: '#9b6cf6' },
      { id: 'join', icon: 'layers', color: '#18a8a0' },
    ],
  },
  {
    id: 'organize',
    sections: [
      { id: 'rules', icon: 'list', color: '#22b07d' },
      { id: 'backup', icon: 'archive', color: '#f5a524' },
    ],
  },
];
const SECTIONS = GROUPS.flatMap((g) => g.sections);

const fromHash = () => {
  const h = decodeURIComponent(location.hash.slice(1));
  return SECTIONS.some((s) => s.id === h) ? h : 'library';
};

/** The full page: what doesn't fit in the popup, each part in its own section. */
export function AppPage() {
  // Not a tab of the browser: every download is shown, the page has no videos of its own.
  const { state, send } = useGrabby(-1);
  const [section, setSection] = useState(fromHash());
  useEffect(() => {
    const on = () => setSection(fromHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const theme = state?.settings.theme;
  const dark = theme === 'dark' || ((theme ?? 'auto') === 'auto' && systemDark);
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    rememberTheme(theme);
  }, [dark, theme]);

  // The highlight under the current section slides to the one chosen.
  const nav = useRef<HTMLElement>(null);
  const [glide, setGlide] = useState<{ y: number; h: number; w: number; x: number } | null>(null);
  const place = () => {
    const a = nav.current?.querySelector<HTMLElement>('.ap__link.on');
    if (a) setGlide({ y: a.offsetTop, h: a.offsetHeight, w: a.offsetWidth, x: a.offsetLeft });
  };
  useLayoutEffect(place, [section]);
  useEffect(() => {
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, []);

  const go = (id: string) => {
    history.replaceState(null, '', `#${id}`);
    setSection(id);
    scrollTo({ top: 0 });
    document.getElementById('main')?.focus({ preventScroll: true });
  };
  const setSettings = (patch: Partial<Settings>) => send({ type: 'settings', patch });
  const current = SECTIONS.find((s) => s.id === section)!;
  const active = (state?.jobs ?? []).filter(isActive);
  const progress = active.length ? active.reduce((n, j) => n + j.progress, 0) / active.length : 0;
  const waiting = state?.batch?.filter((b) => b.status === 'waiting' || b.status === 'opening').length ?? 0;

  return (
    <div class="ap" style={{ '--sec': current.color }}>
      <nav ref={nav} class="ap__nav" aria-label={t('appTitle')}>
        <span class="brand ap__brand">
          <span class="brand__tile">
            <Icon name="logo" size={18} />
          </span>
          Grabby
          <span class="ap__version">v{__VERSION__}</span>
        </span>
        <div class="ap__groups">
          {glide && <span class="ap__glide" aria-hidden="true" style={{ transform: `translate(${glide.x}px, ${glide.y}px)`, height: `${glide.h}px`, width: `${glide.w}px` }} />}
          {GROUPS.map((g) => (
            <div key={g.id} class="ap__group">
              <h2 class="ap__grouptitle">{t(`app_group_${g.id}`)}</h2>
              <ul>
                {g.sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      class={`ap__link${section === s.id ? ' on' : ''}`}
                      style={{ '--c': s.color }}
                      aria-current={section === s.id ? 'page' : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        go(s.id);
                      }}
                    >
                      <span class="ap__linkicon">
                        <Icon name={s.icon} size={16} />
                      </span>
                      <span class="ap__linktext">{t(`app_${s.id}`)}</span>
                      {s.id === 'batch' && waiting ? <span class="count">{waiting}</span> : null}
                      {s.id === 'channels' && state?.watches?.length ? <span class="count count--soft">{state.watches.length}</span> : null}
                      {s.id === 'library' && active.length ? <span class="count">{active.length}</span> : null}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div class="ap__foot">
          {active.length > 0 && (
            <button class="ap__busy" onClick={() => go('library')} title={t('libActive')}>
              <span class="ring" style={{ '--p': String(progress) }} aria-hidden="true">
                <Icon name="download" size={13} />
              </span>
              <span class="ap__busytext">
                <strong>{t('app_busy', String(active.length))}</strong>
                <span>{Math.round(progress * 100)} %</span>
              </span>
            </button>
          )}
          <button class="icon-btn ap__theme" aria-label={dark ? t('switchToLight') : t('switchToDark')} title={dark ? t('switchToLight') : t('switchToDark')} onClick={() => setSettings({ theme: dark ? 'light' : 'dark' })}>
            <span key={dark ? 'sun' : 'moon'} class="spin-in">
              <Icon name={dark ? 'sun' : 'moon'} />
            </span>
          </button>
        </div>
      </nav>
      <main id="main" class="ap__main" tabIndex={-1}>
        {/* Keyed: a new section comes in from below, its header first. */}
        <div key={section} class="ap__view">
          <header class="ap__head">
            <span class="ap__headicon" aria-hidden="true">
              <Icon name={current.icon} size={26} />
            </span>
            <div>
              <h1>{t(`app_${section}`)}</h1>
              <p>{t(`app_${section}_lead`)}</p>
            </div>
          </header>
          {!state ? (
            <div class="skeleton" aria-busy="true" aria-label={t('loading')}>
              <div class="skeleton__row" />
              <div class="skeleton__row" />
            </div>
          ) : section === 'library' ? (
            <Library history={state.history} jobs={state.jobs} send={send} go={go} />
          ) : section === 'batch' ? (
            <Addresses items={state.batch ?? []} send={send} />
          ) : section === 'channels' ? (
            <Channels watches={state.watches ?? []} jobs={state.jobs} send={send} preferred={{ video: state.settings.videoFormat, audio: state.settings.audioFormat }} />
          ) : section === 'workshop' ? (
            <Workshop aiAllowed={state.settings.aiModels} onAllowAi={() => setSettings({ aiModels: true })} />
          ) : section === 'join' ? (
            <Join />
          ) : section === 'rules' ? (
            <Rules rules={state.settings.rules} onChange={(rules) => setSettings({ rules })} />
          ) : (
            <Backup />
          )}
        </div>
      </main>
    </div>
  );
}
