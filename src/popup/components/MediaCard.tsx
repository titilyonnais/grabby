import { useState } from 'preact/hooks';
import { formatDuration } from '../../shared/format';
import type { PopupToBg } from '../../shared/messages';
import type { Job, MediaItem } from '../../shared/types';
import { size, t } from '../i18n';
import { Icon } from './Icon';
import { isActive, JobBar } from './JobBar';

interface Props {
  item: MediaItem;
  job?: Job;
  hero: boolean;
  send: (m: PopupToBg) => void;
}

function Thumb({ item, hero }: { item: MediaItem; hero: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <div class={`thumb${hero ? ' thumb--hero' : ''}`}>
      {item.thumbnail && !broken ? (
        <img src={item.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <Icon name={item.audioOnly ? 'audio' : 'film'} size={hero ? 28 : 20} />
      )}
      {item.duration ? <span class="thumb__time">{formatDuration(item.duration)}</span> : null}
    </div>
  );
}

export function MediaCard({ item, job, hero, send }: Props) {
  const [variantId, setVariantId] = useState<string | undefined>(item.variants[0]?.id);
  const blocked = item.protection !== 'none' || item.live;
  const kind = item.audioOnly ? t('kind_audio') : t(`kind_${item.kind}`);
  const single = item.variants.length === 1 ? item.variants[0]!.label : '';
  const showJob = job && (isActive(job) || ['done', 'error', 'canceled'].includes(job.status));

  const start = (mode: 'video' | 'audio') =>
    send({ type: 'download', mediaId: item.id, mode, ...(mode === 'video' && variantId ? { variantId } : {}) });

  return (
    <article class={`card${hero ? ' card--hero' : ''}${blocked ? ' card--blocked' : ''}`}>
      <Thumb item={item} hero={hero} />
      <div class="card__body">
        <h2 class="card__title" title={item.title}>
          {item.title}
        </h2>
        <p class="card__meta">
          <span class="tag">{kind}</span>
          {item.experimental && <span class="tag tag--accent">{t('experimental')}</span>}
          {single && <span>{single}</span>}
          {item.size ? <span>{size(item.size)}</span> : null}
        </p>
      </div>

      {item.protection !== 'none' ? (
        <p class="notice">
          <Icon name="lock" size={16} />
          {t('protectedBody')}
        </p>
      ) : item.live ? (
        <p class="notice">
          <Icon name="live" size={16} />
          {t('liveBody')}
        </p>
      ) : (
        <div class="card__actions">
          {item.variants.length > 1 && !showJob && (
            <div class="chips" role="radiogroup" aria-label={t('qualityLabel')}>
              {item.variants.map((v) => (
                <button
                  key={v.id}
                  role="radio"
                  aria-checked={v.id === variantId}
                  class={`chip${v.id === variantId ? ' chip--on' : ''}`}
                  onClick={() => setVariantId(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}

          {showJob ? (
            <>
              <JobBar job={job} send={send} />
              {job.raw && isActive(job) && <p class="hint">{t('rawNotice')}</p>}
            </>
          ) : (
            <div class="row">
              {item.kind === 'capture' ? (
                <button class="pill pill--grow" onClick={() => start('video')}>
                  <Icon name="record" />
                  {t('capture')}
                </button>
              ) : (
                <button class="pill pill--grow" onClick={() => start(item.audioOnly ? 'audio' : 'video')}>
                  <Icon name="download" />
                  {t('download')}
                </button>
              )}
              {!item.audioOnly && (
                <button class="pill pill--ghost" onClick={() => start('audio')}>
                  <Icon name="audio" />
                  {t('audioOnly')}
                </button>
              )}
            </div>
          )}
          {item.kind === 'capture' && !showJob && hero && <p class="hint">{t('captureHint')}</p>}
        </div>
      )}
    </article>
  );
}
