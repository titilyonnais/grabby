import { useState } from 'preact/hooks';
import { nextTime, type LaterItem } from '../../shared/later';
import type { PopupToBg } from '../../shared/messages';
import { Icon } from '../../popup/components/Icon';
import { relativeTime, t, uiLang } from '../../popup/i18n';
import { siteOf } from './Library';

const hourOf = (ts: number) =>
  new Intl.DateTimeFormat(uiLang(), {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts);

/** « À télécharger plus tard »: what was kept aside, downloaded now or at a time chosen. */
export function Later({ items, at, send }: { items: LaterItem[]; at?: number; send: (m: PopupToBg) => void }) {
  const [time, setTime] = useState('23:00');
  const schedule = () => {
    const [h, m] = time.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    send({ type: 'later-schedule', at: nextTime(h! * 60 + m!) });
  };
  if (!items.length)
    return (
      <div class="blank">
        <span class="blank__icon" aria-hidden="true">
          <Icon name="later" size={30} />
        </span>
        <h2>{t('laterEmptyTitle')}</h2>
        <p>{t('laterEmptyBody')}</p>
      </div>
    );
  return (
    <div class="stack">
      <section class="ap__card later__head">
        <div>
          <h2 class="ap__h2">{items.length === 1 ? t('laterOne') : t('laterCount', String(items.length))}</h2>
          <p class="hint">{at ? t('laterPlanned', hourOf(at)) : t('laterHint')}</p>
        </div>
        <div class="row">
          {at ? (
            <button class="btn btn--soft" onClick={() => send({ type: 'later-schedule' })}>
              <Icon name="close" size={15} />
              {t('laterUnplan')}
            </button>
          ) : (
            <span class="later__plan">
              <input aria-label={t('laterAt')} class="field__input later__time" type="time" value={time} onInput={(e) => setTime((e.target as HTMLInputElement).value)} />
              <button class="btn btn--soft" onClick={schedule}>
                <Icon name="later" size={15} />
                {t('laterPlan')}
              </button>
            </span>
          )}
          <button class="btn btn--primary" onClick={() => send({ type: 'later-launch' })}>
            <Icon name="download" size={16} />
            {t('laterAll')}
          </button>
        </div>
      </section>
      <ul class="later__list">
        {items.map((l, i) => (
          <li key={l.id} class="later__item" style={{ '--i': String(Math.min(i, 10)) }}>
            <span class="later__thumb">
              {l.thumbnail ? <img src={l.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <Icon name={l.mode === 'audio' ? 'audio' : 'film'} size={20} />}
            </span>
            <span class="later__text">
              <a class="later__title" href={l.url} target="_blank" rel="noreferrer" title={l.url}>
                {l.title || l.url}
              </a>
              <span class="later__meta">
                <span class="tag">{l.mode === 'audio' ? t('jobKindAudio') : t('jobKindVideo')}</span>
                <span>{siteOf(l.url)}</span>
                <span>{relativeTime(l.added)}</span>
              </span>
            </span>
            <button class="hcard__btn" title={t('laterNow')} aria-label={t('laterNow')} onClick={() => send({ type: 'later-launch', ids: [l.id] })}>
              <Icon name="download" size={15} />
            </button>
            <button class="hcard__btn ltile__remove" title={t('laterRemove')} aria-label={t('laterRemove')} onClick={() => send({ type: 'later-remove', id: l.id })}>
              <Icon name="close" size={15} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
