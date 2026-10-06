import { useState } from 'preact/hooks';
import type { PopupToBg } from '../../shared/messages';
import type { Job } from '../../shared/types';
import { t } from '../i18n';
import { Icon } from './Icon';
import { canPause, label, useTick } from './JobBar';

/** Moving a waiting download: which one, and where it would land. */
interface Drag {
  id: string;
  /** Before this one; `null`: last. */
  before: string | null | undefined;
}

interface RowProps {
  job: Job;
  send: (m: PopupToBg) => void;
  /** A waiting download in the queue: it can be moved (dragged, or with the arrow keys). */
  move?: {
    onKey: (step: -1 | 1) => void;
    onStart: () => void;
    onOver: (after: boolean) => void;
    onEnd: () => void;
    dragging: boolean;
    landing: 'before' | 'after' | null;
  };
}

/** A download in the list: started in another tab, before a restart, or waiting its turn. */
function JobRow({ job, send, move }: RowProps) {
  const paused = job.status === 'paused';
  useTick(paused && job.pausedBy === 'network');
  const cls = ['jrow', move?.dragging ? 'jrow--dragging' : '', move?.landing ? `jrow--land-${move.landing}` : ''].filter(Boolean).join(' ');
  return (
    <div
      class={cls}
      data-job={job.id}
      draggable={!!move}
      onDragStart={(e) => {
        if (!move) return;
        e.dataTransfer?.setData('text/plain', job.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        move.onStart();
      }}
      onDragOver={(e) => {
        if (!move) return;
        e.preventDefault();
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
        move.onOver(e.clientY > box.top + box.height / 2);
      }}
      onDragEnd={() => move?.onEnd()}
    >
      {move ? (
        <button
          class="jrow__icon jrow__grip"
          title={t('queueMove')}
          aria-label={t('queueMoveLabel', job.title)}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
            if (!step) return;
            e.preventDefault();
            move.onKey(step);
          }}
        >
          <Icon name="grip" size={16} />
        </button>
      ) : job.thumbnail ? (
        // The video's picture, with what is being done on it.
        <span class="jrow__thumb">
          <img src={job.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" />
          <span class={`jrow__badge${paused ? ' jrow__badge--paused' : ''}`}>
            <Icon name={paused ? 'pause' : job.mode === 'audio' ? 'audio' : 'download'} size={11} />
          </span>
        </span>
      ) : (
        <span class={`jrow__icon${paused ? ' jrow__icon--paused' : ''}`}>
          <Icon name={paused ? 'pause' : job.mode === 'audio' ? 'audio' : 'download'} size={16} />
        </span>
      )}
      <span class="jrow__text">
        <span class="jrow__title" title={job.title}>
          {job.title}
        </span>
        <span class="jrow__meta">{label(job)}</span>
        <span class="card__progress" style={{ '--p': String(job.progress) }} aria-hidden="true" />
      </span>
      <span class="card__tools">
        {job.status === 'queued' && job.held && (
          <button class="card__cancel" aria-label={t('startNow')} title={t('startNow')} onClick={() => send({ type: 'start-now', jobId: job.id })}>
            <Icon name="play" size={16} />
          </button>
        )}
        {(paused || (canPause(job) && !job.held)) && (
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

/**
 * The downloads not on this page's cards. With two or more under way (`total`, cards
 * included), the queue's head: all paused or all resumed at once; its waiting rows can be put
 * in another order.
 */
export function OtherJobs({ jobs, queue = false, all = jobs, send }: { jobs: Job[]; queue?: boolean; all?: Job[]; send: (m: PopupToBg) => void }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  if (!jobs.length && !queue) return null;
  const waiting = jobs.filter((j) => j.status === 'queued');
  const movable = queue && waiting.length > 1;
  // "Pause all" acts on every download, those on the cards too.
  const anyPausable = all.some(canPause);
  const anyPaused = all.some((j) => j.status === 'paused');

  /** Where the dragged one lands, said as "before which" (the next waiting one, or last). */
  const landingBefore = (over: Job, after: boolean): string | null => {
    if (!after) return over.id;
    const i = waiting.findIndex((w) => w.id === over.id);
    return waiting[i + 1]?.id ?? null;
  };
  const drop = () => {
    if (drag && drag.before !== undefined && drag.before !== drag.id) send({ type: 'reorder', jobId: drag.id, ...(drag.before ? { before: drag.before } : {}) });
    setDrag(null);
  };
  const step = (job: Job, by: -1 | 1) => {
    const i = waiting.findIndex((w) => w.id === job.id);
    if (by < 0 && i > 0) send({ type: 'reorder', jobId: job.id, before: waiting[i - 1]!.id });
    if (by > 0 && i < waiting.length - 1) {
      const after = waiting[i + 2];
      send({ type: 'reorder', jobId: job.id, ...(after ? { before: after.id } : {}) });
    }
    // Focus follows the row (it is drawn again in its new place).
    requestAnimationFrame(() => (document.querySelector(`[data-job="${job.id}"] .jrow__grip`) as HTMLElement | null)?.focus());
  };

  return (
    <section
      class="others"
      aria-label={queue ? t('queueTitle') : t('othersTitle')}
      onDrop={(e) => {
        e.preventDefault();
        drop();
      }}
      onDragOver={(e) => drag && e.preventDefault()}
    >
      <header class="others__head">
        <h3 class="others__title">{queue ? t('queueCount', String(all.length)) : t('othersTitle')}</h3>
        {queue && (anyPausable || anyPaused) && (
          <button class="btn btn--soft btn--small" onClick={() => send({ type: anyPausable ? 'pause-all' : 'resume-all' })}>
            <Icon name={anyPausable ? 'pause' : 'play'} size={14} />
            {anyPausable ? t('queuePauseAll') : t('queueResumeAll')}
          </button>
        )}
      </header>
      {jobs.map((j) => {
        const canMove = movable && j.status === 'queued';
        const landing = drag && drag.id !== j.id && drag.before !== undefined ? (drag.before === j.id ? 'before' : drag.before === null && waiting.at(-1)?.id === j.id ? 'after' : null) : null;
        return (
          <JobRow
            key={j.id}
            job={j}
            send={send}
            {...(canMove
              ? {
                  move: {
                    onKey: (by) => step(j, by),
                    onStart: () => setDrag({ id: j.id, before: undefined }),
                    onOver: (after) => drag && setDrag({ ...drag, before: landingBefore(j, after) }),
                    onEnd: () => setDrag(null),
                    dragging: drag?.id === j.id,
                    landing,
                  },
                }
              : {})}
          />
        );
      })}
    </section>
  );
}
