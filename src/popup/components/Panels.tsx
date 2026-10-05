import { useState } from 'preact/hooks';
import type { PopupToBg } from '../../shared/messages';
import type { HistoryEntry } from '../../shared/types';
import { size, t, uiLang } from '../i18n';
import { reducedMotion } from '../motion';
import { Icon, type IconName } from './Icon';

export function StateCard({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <section class="state">
      <span class="state__icon">
        <Icon name={icon} size={26} />
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}

export function FirstRun({ onOk }: { onOk: () => void }) {
  return (
    <section class="firstrun" aria-labelledby="fr-title">
      <span class="firstrun__icon">
        <Icon name="shield" size={20} />
      </span>
      <div>
        <h2 id="fr-title">{t('firstRunTitle')}</h2>
        <p>{t('firstRunBody')}</p>
        <button class="btn btn--primary btn--small" onClick={onOk}>
          {t('firstRunOk')}
        </button>
      </div>
    </section>
  );
}

/** "Aujourd'hui", "Hier", else the date ("lundi 3 octobre"). */
function dayLabel(ts: number): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(new Date(ts))) / 86_400_000);
  if (diff === 0) return t('historyToday');
  if (diff === 1) return t('historyYesterday');
  return new Intl.DateTimeFormat(uiLang(), { weekday: 'long', day: 'numeric', month: 'long' }).format(ts);
}

const clock = (ts: number) => new Intl.DateTimeFormat(uiLang(), { hour: '2-digit', minute: '2-digit' }).format(ts);
const extOf = (name: string) => /\.([a-z0-9]{2,4})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
/** How long a removed entry takes to fold away. */
const REMOVE_MS = 240;

function HistoryThumb({ entry }: { entry: HistoryEntry }) {
  const [broken, setBroken] = useState(false);
  const ext = extOf(entry.filename);
  return (
    <span class="hcard__thumb">
      {entry.thumbnail && !broken ? (
        <img src={entry.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <span class="file__badge">{ext.toUpperCase() || '?'}</span>
      )}
    </span>
  );
}

export function HistoryList({ entries, send }: { entries: HistoryEntry[]; send: (m: PopupToBg) => void }) {
  // Entries the user just removed: they fold away before the list forgets them.
  const [leaving, setLeaving] = useState<string[]>([]);
  if (!entries.length) return <StateCard icon="folder" title={t('tabHistory')} body={t('historyEmpty')} />;
  const remove = (id: string) => {
    setLeaving((l) => [...l, id]);
    setTimeout(() => send({ type: 'history-remove', id }), reducedMotion() ? 0 : REMOVE_MS);
  };
  const days: { label: string; items: HistoryEntry[] }[] = [];
  for (const e of entries) {
    const label = dayLabel(e.date);
    const last = days[days.length - 1];
    if (last?.label === label) last.items.push(e);
    else days.push({ label, items: [e] });
  }
  let n = 0;
  return (
    <section class="history">
      <header class="history__head">
        <span>{entries.length === 1 ? t('historyOne') : t('historyCount', String(entries.length))}</span>
        <button class="btn btn--soft btn--small" onClick={() => send({ type: 'clear-history' })}>
          {t('clearHistory')}
        </button>
      </header>
      {days.map((d) => (
        <div key={d.label} class="history__day">
          <h3 class="history__date">{d.label}</h3>
          <ul>
            {d.items.map((e) => {
              const ext = extOf(e.filename);
              const canShow = e.downloadId !== undefined && !e.missing;
              return (
                <li key={e.id} class={`hcard${e.missing ? ' hcard--missing' : ''}${leaving.includes(e.id) ? ' hcard--out' : ''}`} style={{ '--i': String(Math.min(n++, 10)) }}>
                  <button
                    class="hcard__main"
                    disabled={!canShow}
                    onClick={() => canShow && send({ type: 'show', downloadId: e.downloadId! })}
                    title={canShow ? `${t('showFile')} — ${e.filename}` : e.filename}
                  >
                    <HistoryThumb entry={e} />
                    <span class="hcard__text">
                      <span class="hcard__title">{e.title || e.filename}</span>
                      <span class="hcard__meta">
                        {ext && <span class="tag">{ext.toUpperCase()}</span>}
                        {e.quality && <span>{e.quality}</span>}
                        {e.size ? <span>{size(e.size)}</span> : null}
                        <span>{clock(e.date)}</span>
                      </span>
                      {e.missing && <span class="hcard__missing">{t('historyMissing')}</span>}
                    </span>
                  </button>
                  <span class="hcard__tools">
                    {/^https?:/i.test(e.pageUrl) && (
                      <a class="hcard__btn" href={e.pageUrl} target="_blank" rel="noreferrer" title={t('historyOpenPage')} aria-label={t('historyOpenPage')}>
                        <Icon name="external" size={15} />
                      </a>
                    )}
                    <button class="hcard__btn" title={t('historyRemove')} aria-label={t('historyRemove')} onClick={() => remove(e.id)}>
                      <Icon name="close" size={15} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
