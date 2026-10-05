import type { PopupToBg } from '../../shared/messages';
import type { Job } from '../../shared/types';
import { t } from '../i18n';
import { Icon } from './Icon';
import { canPause, label, useTick } from './JobBar';

/** A download whose video isn't on this page: started in another tab, or before a restart. */
function JobRow({ job, send }: { job: Job; send: (m: PopupToBg) => void }) {
  const paused = job.status === 'paused';
  useTick(paused && job.pausedBy === 'network');
  return (
    <div class="jrow">
      <span class={`jrow__icon${paused ? ' jrow__icon--paused' : ''}`}>
        <Icon name={paused ? 'pause' : job.mode === 'audio' ? 'audio' : 'download'} size={16} />
      </span>
      <span class="jrow__text">
        <span class="jrow__title" title={job.title}>
          {job.title}
        </span>
        <span class="jrow__meta">{label(job)}</span>
        <span class="card__progress" style={{ '--p': String(job.progress) }} aria-hidden="true" />
      </span>
      <span class="card__tools">
        {(paused || canPause(job)) && (
          <button
            class="card__cancel"
            aria-label={paused ? t('resume') : t('pause')}
            title={paused ? t('resume') : t('pause')}
            onClick={() => send({ type: paused ? 'resume' : 'pause', jobId: job.id })}
          >
            <Icon name={paused ? 'play' : 'pause'} size={16} />
          </button>
        )}
        <button class="card__cancel" aria-label={t('cancel')} title={t('cancel')} onClick={() => send({ type: 'cancel', jobId: job.id })}>
          <Icon name="close" size={16} />
        </button>
      </span>
    </div>
  );
}

export function OtherJobs({ jobs, send }: { jobs: Job[]; send: (m: PopupToBg) => void }) {
  if (!jobs.length) return null;
  return (
    <section class="others" aria-label={t('othersTitle')}>
      <h3 class="others__title">{t('othersTitle')}</h3>
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} send={send} />
      ))}
    </section>
  );
}
