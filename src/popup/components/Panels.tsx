import type { PopupToBg } from '../../shared/messages';
import type { HistoryEntry } from '../../shared/types';
import { relativeTime, size, t } from '../i18n';
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

export function HistoryList({ entries, send }: { entries: HistoryEntry[]; send: (m: PopupToBg) => void }) {
  if (!entries.length) return <StateCard icon="folder" title={t('tabHistory')} body={t('historyEmpty')} />;
  return (
    <section class="history">
      <ul>
        {entries.map((e, i) => (
          <li key={e.id} style={{ '--i': String(Math.min(i, 10)) }}>
            <button
              class="history__item"
              disabled={e.downloadId === undefined}
              onClick={() => e.downloadId !== undefined && send({ type: 'show', downloadId: e.downloadId })}
              title={t('showFile')}
            >
              <span class="history__icon">
                <Icon name={/\.(mp3|m4a|opus|ogg|flac|wav)$/i.test(e.filename) ? 'audio' : 'film'} size={18} />
              </span>
              <span class="history__text">
                <span class="history__name">{e.filename || e.title}</span>
                <span class="history__meta">
                  <span>{size(e.size)}</span>
                  <span>{relativeTime(e.date)}</span>
                </span>
              </span>
              {e.downloadId !== undefined && <Icon name="folder" size={16} />}
            </button>
          </li>
        ))}
      </ul>
      <button class="link" onClick={() => send({ type: 'clear-history' })}>
        {t('clearHistory')}
      </button>
    </section>
  );
}
