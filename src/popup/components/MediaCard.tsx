import { useState } from 'preact/hooks';
import { formatDuration } from '../../shared/format';
import type { PopupToBg } from '../../shared/messages';
import type { VideoFormat } from '../../shared/plan';
import type { Job, MediaItem } from '../../shared/types';
import { size, t } from '../i18n';
import { Icon } from './Icon';
import { isActive, JobBar } from './JobBar';

interface Props {
  item: MediaItem;
  job?: Job;
  hero: boolean;
  /** The user's preferred container (settings). */
  preferred: VideoFormat;
  send: (m: PopupToBg) => void;
}

const FORMAT_NAMES: Record<VideoFormat, string> = { mp4: 'MP4', webm: 'WebM', mkv: 'MKV' };

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="chips" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} role="radio" aria-checked={id === value} class={`chip${id === value ? ' chip--on' : ''}`} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
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

export function MediaCard({ item, job, hero, preferred, send }: Props) {
  const [variantId, setVariantId] = useState<string | undefined>(item.variants[0]?.id);
  const formats = item.formats ?? [];
  const [format, setFormat] = useState<VideoFormat | undefined>(formats.includes(preferred) ? preferred : formats[0]);
  const variant = item.variants.find((v) => v.id === variantId) ?? item.variants[0];
  // Size of what will actually be saved, when the source tells (YouTube: per quality and format).
  const shownSize = (format && variant?.sizes?.[format]) || item.size;
  // YouTube: a hidden player records it, the user keeps watching — it's a plain download for them.
  const hidden = !!item.ytId;
  const blocked = item.protection !== 'none' || item.live;
  const kind = item.audioOnly ? t('kind_audio') : t(`kind_${item.kind}`);
  const single = item.variants.length === 1 ? item.variants[0]!.label : '';
  const showJob = job && (isActive(job) || ['done', 'error', 'canceled'].includes(job.status));

  const start = (mode: 'video' | 'audio') =>
    send({
      type: 'download',
      mediaId: item.id,
      mode,
      ...(mode === 'video' && variantId ? { variantId } : {}),
      ...(mode === 'video' && format ? { format } : {}),
    });

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
          {shownSize ? <span>{size(shownSize)}</span> : null}
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
            <Chips label={t('qualityLabel')} value={variantId ?? ''} options={item.variants.map((v) => [v.id, v.label])} onChange={setVariantId} />
          )}
          {formats.length > 1 && format && !showJob && (
            <Chips label={t('formatLabel')} value={format} options={formats.map((f) => [f, FORMAT_NAMES[f]])} onChange={setFormat} />
          )}

          {showJob ? (
            <>
              <JobBar job={job} send={send} canFinish={!job.hidden} />
              {job.raw && isActive(job) && <p class="hint">{t('rawNotice')}</p>}
            </>
          ) : (
            <div class="row">
              {item.kind === 'capture' && !hidden ? (
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
          {item.kind === 'capture' && !showJob && hero && <p class="hint">{t(hidden ? 'hiddenHint' : 'captureHint')}</p>}
        </div>
      )}
    </article>
  );
}
