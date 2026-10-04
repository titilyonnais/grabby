import type { PopupToBg } from '../../shared/messages';
import type { Job } from '../../shared/types';
import { size, t } from '../i18n';
import { Icon } from './Icon';

const ACTIVE = ['queued', 'downloading', 'capturing', 'processing', 'saving'];

export const isActive = (j: Job | undefined): boolean => !!j && ACTIVE.includes(j.status);

function label(job: Job): string {
  const pct = `${Math.round(job.progress * 100)} %`;
  switch (job.status) {
    case 'downloading':
      return job.progress > 0 ? `${t('st_downloading')} ${pct}` : t('st_downloading');
    case 'capturing':
      return `${t('st_capturing')} ${pct}`;
    default:
      return t(`st_${job.status}`);
  }
}

function MeterLabel({ text, speed }: { text: string; speed: string }) {
  return (
    <span class="meter__label">
      <span>{text}</span>
      {speed && <span class="meter__speed">{speed}</span>}
    </span>
  );
}

/**
 * The download pill turned into its own progress bar: the coral fill grows inside
 * the button the user just pressed, so the result appears where the action happened.
 */
export function JobBar({ job, send, canFinish = true }: { job: Job; send: (m: PopupToBg) => void; canFinish?: boolean }) {
  if (job.status === 'done') {
    return (
      <div class="job job--done" role="status">
        <span class="job__msg">
          <Icon name="check" size={16} />
          {t('st_done')}
          {job.bytes ? <span class="muted">{size(job.bytes)}</span> : null}
        </span>
        <div class="job__actions">
          {job.downloadId !== undefined && (
            <button class="pill pill--ghost" onClick={() => send({ type: 'show', downloadId: job.downloadId! })}>
              <Icon name="folder" size={16} />
              {t('showFile')}
            </button>
          )}
          {/* Back to the choices (quality, format) for another download. */}
          <button class="icon-btn icon-btn--solid" title={t('redownload')} aria-label={t('redownload')} onClick={() => send({ type: 'dismiss', jobId: job.id })}>
            <Icon name="retry" size={18} />
          </button>
        </div>
      </div>
    );
  }

  if (job.status === 'error' || job.status === 'canceled') {
    return (
      <div class={`job job--${job.status}`} role="alert">
        <p class="job__error">{job.status === 'canceled' ? t('st_canceled') : t(`err_${job.error ?? 'unknown'}`)}</p>
        <div class="job__actions">
          <button class="pill pill--ghost" onClick={() => send({ type: 'dismiss', jobId: job.id })}>
            {t('dismiss')}
          </button>
          {job.error !== 'protected' && job.error !== 'live' && (
            <button class="pill" onClick={() => send({ type: 'retry', jobId: job.id })}>
              <Icon name="retry" size={16} />
              {t('retry')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const indeterminate = job.status === 'queued' || job.status === 'processing' || job.status === 'saving' || job.progress === 0;
  const speed = job.status === 'downloading' && job.speed > 0 ? `${size(job.speed)}/s` : '';
  return (
    <div class="job job--active">
      <div
        class={`meter${indeterminate ? ' meter--busy' : ''}`}
        style={{ '--p': String(indeterminate ? 1 : job.progress) }}
        role="progressbar"
        aria-label={label(job)}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(indeterminate ? {} : { 'aria-valuenow': Math.round(job.progress * 100) })}
      >
        <MeterLabel text={label(job)} speed={speed} />
        {/* Same label, dark, clipped to the coral fill: readable on both colors. */}
        <span class="meter__fill" aria-hidden="true">
          <MeterLabel text={label(job)} speed={speed} />
        </span>
      </div>
      {job.status === 'capturing' && canFinish && (
        <button class="icon-btn icon-btn--solid" title={t('finishCapture')} aria-label={t('finishCapture')} onClick={() => send({ type: 'finish-capture', jobId: job.id })}>
          <Icon name="stop" />
        </button>
      )}
      <button class="icon-btn" title={t('cancel')} aria-label={t('cancel')} onClick={() => send({ type: 'cancel', jobId: job.id })}>
        <Icon name="close" />
      </button>
    </div>
  );
}
