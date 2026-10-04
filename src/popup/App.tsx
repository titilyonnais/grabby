import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Job, MediaItem } from '../shared/types';
import { Icon } from './components/Icon';
import { MediaCard } from './components/MediaCard';
import { FirstRun, HistoryList, StateCard } from './components/Panels';
import { Settings } from './components/Settings';
import { t } from './i18n';
import { useGrabby } from './store';

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Best candidate first: downloadable, adaptive streams with qualities, then biggest. */
function rank(items: MediaItem[]): MediaItem[] {
  const score = (i: MediaItem) =>
    (i.protection === 'none' && !i.live ? 1000 : 0) + (i.variants.length > 1 ? 100 : 0) + (i.kind !== 'capture' ? 10 : 0) + (i.audioOnly ? -50 : 0);
  return [...items].sort((a, b) => score(b) - score(a) || (b.size ?? 0) - (a.size ?? 0) || b.detectedAt - a.detectedAt);
}

function latestJob(jobs: Job[], mediaId: string): Job | undefined {
  return jobs.filter((j) => j.mediaId === mediaId).sort((a, b) => b.startedAt - a.startedAt)[0];
}

export function App() {
  const { state, send } = useGrabby();
  const [tab, setTab] = useState<'page' | 'history'>('page');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemDark, setSystemDark] = useState(prefersDark());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const theme = state?.settings.theme ?? 'auto';
  const dark = theme === 'dark' || (theme === 'auto' && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  const items = useMemo(() => rank(state?.items ?? []), [state?.items]);
  const [hero, ...rest] = items;

  return (
    <div class="app">
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
            <Icon name={dark ? 'sun' : 'moon'} />
          </button>
          <button class="icon-btn" aria-label={t('openSettings')} title={t('openSettings')} onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" />
          </button>
        </span>
      </header>

      <nav class="seg" role="tablist">
        {(['page', 'history'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {k === 'page' ? t('tabPage') : t('tabHistory')}
            {k === 'page' && items.length > 0 && <span class="count">{items.length}</span>}
          </button>
        ))}
      </nav>

      <main class="content">
        {!state ? (
          <div class="skeleton" aria-busy="true" />
        ) : tab === 'history' ? (
          <HistoryList entries={state.history} send={send} />
        ) : (
          <>
            {!state.settings.firstRunAck && <FirstRun onOk={() => send({ type: 'settings', patch: { firstRunAck: true } })} />}
            {state.blocked === 'youtube' ? (
              <StateCard icon="shield" title={t('ytTitle')} body={t('ytBody')} />
            ) : state.blocked === 'restricted' ? (
              <StateCard icon="lock" title={t('restrictedTitle')} body={t('restrictedBody')} />
            ) : !hero ? (
              <StateCard icon="film" title={t('emptyTitle')} body={t('emptyBody')} />
            ) : (
              <>
                <MediaCard key={hero.id} item={hero} job={latestJob(state.jobs, hero.id)} hero send={send} />
                {rest.length > 0 && (
                  <section class="more" aria-label={t('moreVideos')}>
                    <h3 class="more__title">{t('moreVideos')}</h3>
                    {rest.map((i) => (
                      <MediaCard key={i.id} item={i} job={latestJob(state.jobs, i.id)} hero={false} send={send} />
                    ))}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </main>

      {settingsOpen && state && (
        <Settings settings={state.settings} onChange={(patch) => send({ type: 'settings', patch })} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
