import { useEffect, useState } from 'preact/hooks';
import type { Settings } from '../shared/settings';
import { Icon, type IconName } from '../popup/components/Icon';
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

const SECTIONS: { id: string; icon: IconName }[] = [
  { id: 'library', icon: 'grid' },
  { id: 'batch', icon: 'link' },
  { id: 'channels', icon: 'bell' },
  { id: 'workshop', icon: 'wand' },
  { id: 'join', icon: 'layers' },
  { id: 'rules', icon: 'list' },
  { id: 'backup', icon: 'archive' },
];

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
  const go = (id: string) => {
    history.replaceState(null, '', `#${id}`);
    setSection(id);
    document.getElementById('main')?.focus();
  };
  const setSettings = (patch: Partial<Settings>) => send({ type: 'settings', patch });
  return (
    <div class="ap">
      <nav class="ap__nav" aria-label={t('appTitle')}>
        <span class="brand ap__brand">
          <span class="brand__tile">
            <Icon name="logo" size={18} />
          </span>
          Grabby
        </span>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                class={`ap__link${section === s.id ? ' on' : ''}`}
                aria-current={section === s.id ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go(s.id);
                }}
              >
                <Icon name={s.icon} size={18} />
                <span>{t(`app_${s.id}`)}</span>
                {s.id === 'batch' && state?.batch?.some((b) => b.status === 'waiting' || b.status === 'opening') ? <span class="count">{state.batch.filter((b) => b.status === 'waiting' || b.status === 'opening').length}</span> : null}
                {s.id === 'channels' && state?.watches?.length ? <span class="count">{state.watches.length}</span> : null}
              </a>
            </li>
          ))}
        </ul>
        <button class="icon-btn ap__theme" aria-label={dark ? t('switchToLight') : t('switchToDark')} title={dark ? t('switchToLight') : t('switchToDark')} onClick={() => setSettings({ theme: dark ? 'light' : 'dark' })}>
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
      </nav>
      <main id="main" class="ap__main" tabIndex={-1}>
        <header class="ap__head">
          <h1>{t(`app_${section}`)}</h1>
          <p>{t(`app_${section}_lead`)}</p>
        </header>
        {!state ? (
          <div class="skeleton" aria-busy="true" aria-label={t('loading')}>
            <div class="skeleton__row" />
            <div class="skeleton__row" />
          </div>
        ) : section === 'library' ? (
          <Library history={state.history} jobs={state.jobs} send={send} />
        ) : section === 'batch' ? (
          <Addresses items={state.batch ?? []} send={send} />
        ) : section === 'channels' ? (
          <Channels watches={state.watches ?? []} send={send} preferred={{ video: state.settings.videoFormat, audio: state.settings.audioFormat }} />
        ) : section === 'workshop' ? (
          <Workshop aiAllowed={state.settings.aiModels} onAllowAi={() => setSettings({ aiModels: true })} />
        ) : section === 'join' ? (
          <Join />
        ) : section === 'rules' ? (
          <Rules rules={state.settings.rules} onChange={(rules) => setSettings({ rules })} />
        ) : (
          <Backup />
        )}
      </main>
    </div>
  );
}
