import { useMemo } from 'preact/hooks';
import { libraryNumbers, weekOf } from '../../shared/stats';
import type { HistoryEntry } from '../../shared/types';
import { Icon } from '../../popup/components/Icon';
import { size, t, uiLang } from '../../popup/i18n';

const WEEKS = 12;
const shortDate = (ts: number) => new Intl.DateTimeFormat(uiLang(), { day: 'numeric', month: 'short' }).format(ts);

/** « Statistiques »: what was saved, when and from where, counted on this computer only. */
export function Stats({ history, go }: { history: HistoryEntry[]; go: (section: string) => void }) {
  const n = useMemo(() => libraryNumbers(history, Date.now(), WEEKS), [history]);
  if (!history.length)
    return (
      <div class="blank">
        <span class="blank__icon" aria-hidden="true">
          <Icon name="chart" size={30} />
        </span>
        <h2>{t('statsEmptyTitle')}</h2>
        <p>{t('statsEmptyBody')}</p>
        <div class="row">
          <button class="btn btn--soft" onClick={() => go('library')}>
            <Icon name="grid" size={16} />
            {t('app_library')}
          </button>
        </div>
      </div>
    );
  const most = Math.max(1, ...n.perWeek);
  const firstWeek = weekOf(Date.now()) - (WEEKS - 1) * 7 * 86_400_000;
  const topSite = Math.max(1, ...n.sites.map((s) => s.n));
  const hour = n.hour !== undefined ? new Intl.DateTimeFormat(uiLang(), { hour: 'numeric' }).format(new Date(2000, 0, 1, n.hour)) : '—';
  return (
    <div class="stack stats">
      <section class="kpis" aria-label={t('libStats')}>
        <div class="kpi" style={{ '--i': '0' }}>
          <span class="kpi__label">{t('libKpiFiles')}</span>
          <strong class="kpi__value">{n.files}</strong>
        </div>
        <div class="kpi" style={{ '--i': '1' }}>
          <span class="kpi__label">{t('libKpiSpace')}</span>
          <strong class="kpi__value">{size(n.bytes) || `0 ${t('sizeUnitByte')}`}</strong>
        </div>
        <div class="kpi" style={{ '--i': '2' }}>
          <span class="kpi__label">{t('statsWeek')}</span>
          <strong class="kpi__value">{n.week}</strong>
        </div>
        <div class="kpi" style={{ '--i': '3' }}>
          <span class="kpi__label">{t('statsStreak')}</span>
          <strong class="kpi__value">{n.streak.best}</strong>
          <span class="kpi__sub">{n.streak.now > 1 ? t('statsStreakNow', String(n.streak.now)) : t('statsDays')}</span>
        </div>
        <div class="kpi" style={{ '--i': '4' }}>
          <span class="kpi__label">{t('statsHour')}</span>
          <strong class="kpi__value">{hour}</strong>
        </div>
      </section>

      <section class="ap__card">
        <h2 class="ap__h2">{t('statsWeeks')}</h2>
        <div class="weeks" role="img" aria-label={t('statsWeeksAlt', [String(WEEKS), String(n.perWeek.reduce((a, b) => a + b, 0))])}>
          {n.perWeek.map((c, i) => (
            <span
              key={i}
              class={`weeks__bar${i === WEEKS - 1 ? ' weeks__bar--now' : ''}`}
              style={{ '--h': String(c / most), '--i': String(i) }}
              title={`${shortDate(firstWeek + i * 7 * 86_400_000)} · ${c}`}
            >
              {c > 0 && <span class="weeks__n">{c}</span>}
            </span>
          ))}
        </div>
        <div class="weeks__axis" aria-hidden="true">
          <span>{shortDate(firstWeek)}</span>
          <span>{t('statsThisWeek')}</span>
        </div>
      </section>

      <div class="stats__two">
        <section class="ap__card">
          <h2 class="ap__h2">{t('statsSites')}</h2>
          {n.sites.length ? (
            <ul class="hbars">
              {n.sites.slice(0, 8).map((s, i) => (
                <li key={s.site} style={{ '--w': String(s.n / topSite), '--i': String(i) }}>
                  <span class="hbars__label">{s.site}</span>
                  <span class="hbars__track">
                    <span class="hbars__fill" />
                  </span>
                  <span class="hbars__n">{s.n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="hint">{t('statsNoSites')}</p>
          )}
        </section>
        <section class="ap__card">
          <h2 class="ap__h2">{t('libKpiKinds')}</h2>
          <ul class="kinds">
            {(['video', 'audio', 'image'] as const).map((k) => (
              <li key={k} class={`kinds__item kinds__item--${k}`}>
                <Icon name={k === 'video' ? 'film' : k} size={18} />
                <strong>{n.kinds[k].n}</strong>
                <span>{t(`libKind_${k}`)}</span>
                <span class="muted">{size(n.kinds[k].bytes) || '—'}</span>
              </li>
            ))}
          </ul>
          {n.formats.length > 0 && (
            <>
              <h3 class="stats__h3">{t('statsFormats')}</h3>
              <p class="stats__formats">
                {n.formats.slice(0, 8).map((f) => (
                  <span key={f.format} class="chip">
                    {f.format.toUpperCase()}
                    <span class="chip__n">{f.n}</span>
                  </span>
                ))}
              </p>
            </>
          )}
        </section>
      </div>
      <p class="hint stats__private">
        <Icon name="shield" size={14} />
        {t('statsPrivate')}
      </p>
    </div>
  );
}
