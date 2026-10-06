import { useEffect, useState } from 'preact/hooks';
import type { PopupToBg } from '../../shared/messages';
import type { Job } from '../../shared/types';
import { hhmm, minutesOf } from '../../shared/schedule';
import { size, t } from '../i18n';
import { Icon } from './Icon';

const ACTIVE = ['queued', 'downloading', 'capturing', 'processing', 'saving', 'paused'];

export const isActive = (j: Job | undefined): boolean => !!j && ACTIVE.includes(j.status);

/** A download pauses while it fetches or records (not while the file is being assembled). */
export const canPause = (j: Job): boolean => j.status === 'downloading' || j.status === 'queued' || j.status === 'capturing';

/** Re-renders every second while `on`: for a countdown. */
export function useTick(on: boolean): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

export function label(job: Job): string {
  const pct = `${Math.round(job.progress * 100)} %`;
  switch (job.status) {
    case 'paused': {
      if (job.pausedBy === 'user') return `${t('st_paused')} · ${pct}`;
      if (job.pausedBy === 'page') return `${t('st_pageClosed')} · ${pct}`;
      const wait = Math.ceil(((job.retryAt ?? 0) - Date.now()) / 1000);
      if (job.pausedBy === 'restart') return t('st_resuming');
      return wait > 0 ? t('st_offline', String(wait)) : t('st_retrying');
    }
    case 'queued':
      // Waiting for the time window chosen in the settings, or for Wi-Fi.
      if (job.held?.why === 'schedule') return t('st_heldUntil', hhmm(minutesOf(new Date(job.held.until))));
      if (job.held?.why === 'wifi') return t('st_heldWifi');
      return t('st_queued');
    case 'downloading':
      return job.progress > 0 ? `${t('st_downloading')} ${pct}` : t('st_downloading');
    case 'capturing':
      return `${t('st_capturing')} ${pct}`;
    case 'processing':
      // Shrinking the picture is long and measured: show how far it is.
      return job.scale ? `${t('st_converting')} ${pct}` : t('st_processing');
    default:
      return t(`st_${job.status}`);
  }
}

/** "12 s", "4 min", "1 h 05". */
function duration(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600);
  return `${h} h ${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}`;
}

/** "56 Mo / 250 Mo", the speed and the time left, while data comes in. */
export function jobStats(job: Job): string[] {
  const parts: string[] = [];
  const total = job.total && job.total >= job.bytes ? job.total : undefined;
  if (job.bytes > 0) parts.push(total ? `${size(job.bytes)} / ${job.totalApprox ? '≈ ' : ''}${size(total)}` : size(job.bytes));
  else if (total) parts.push(`${job.totalApprox ? '≈ ' : ''}${size(total)}`);
  const moving = job.status === 'downloading' || job.status === 'capturing';
  if (moving && job.speed > 0) {
    parts.push(`${size(job.speed)}/s`);
    if (total) parts.push(t('jobLeft', duration((total - job.bytes) / job.speed)));
  }
  if (job.sponsors) parts.push(sponsorsLeftOut(job.sponsors));
  return parts;
}

/** "2 sponsored parts left out" (SponsorBlock). */
export const sponsorsLeftOut = (n: number): string => (n === 1 ? t('jobSponsorsOne') : t('jobSponsors', String(n)));

/** A little burst of confetti around the check when a file is saved. */
function Burst() {
  return (
    <span class="burst" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} style={{ '--a': `${i * 45}deg` }} />
      ))}
    </span>
  );
}

/**
 * The download button turned into its own progress bar: the coral fill grows inside the
 * button the user just pressed, so the result appears where the action happened.
 */
export function JobBar({ job, send, canFinish = true }: { job: Job; send: (m: PopupToBg) => void; canFinish?: boolean }) {
  if (job.status === 'done') {
    const done = (
      <div class="job job--done" role="status">
        <span class="job__msg">
          <span class="job__check">
            <Icon name="check" size={16} />
            <Burst />
          </span>
          {t('st_done')}
          {job.bytes ? <span class="muted">{size(job.bytes)}</span> : null}
        </span>
        <div class="job__actions">
          {job.downloadId !== undefined && (
            <button class="btn btn--soft" onClick={() => send({ type: 'show', downloadId: job.downloadId! })}>
              <Icon name="folder" size={16} />
              {t('showFile')}
            </button>
          )}
          {/* Back to the choices (quality, format) for another download. */}
          <button class="btn btn--primary btn--icon" title={t('redownload')} aria-label={t('redownload')} onClick={() => send({ type: 'dismiss', jobId: job.id })}>
            <Icon name="retry" size={18} />
          </button>
        </div>
      </div>
    );
    // What was left out (SponsorBlock), under it: the line has no room to spare.
    return job.sponsors ? (
      <div class="job-wrap">
        {done}
        <p class="job__stats">
          <span>{sponsorsLeftOut(job.sponsors)}</span>
        </p>
      </div>
    ) : (
      done
    );
  }

  if (job.status === 'error' || job.status === 'canceled') {
    return (
      <div class={`job job--${job.status}`} role="alert">
        <p class="job__error">
          <Icon name={job.status === 'canceled' ? 'close' : 'alert'} size={16} />
          <span>{job.status === 'canceled' ? t('st_canceled') : t(`err_${job.error ?? 'unknown'}`)}</span>
        </p>
        <div class="job__actions">
          <button class="btn btn--soft" onClick={() => send({ type: 'dismiss', jobId: job.id })}>
            {t('dismiss')}
          </button>
          {job.error !== 'protected' && job.error !== 'live' && (
            <button class="btn btn--primary" onClick={() => send({ type: 'retry', jobId: job.id })}>
              <Icon name="retry" size={16} />
              {t('retry')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const paused = job.status === 'paused';
  // A countdown to the next try for the network.
  useTick(paused && job.pausedBy === 'network');
  const held = job.status === 'queued' && !!job.held;
  const indeterminate = !paused && !held && (job.status === 'queued' || (job.status === 'processing' && !job.scale) || job.status === 'saving' || job.progress === 0);
  const stats = jobStats(job);
  const text = label(job);
  return (
    <div class="job-wrap">
      <div class="job job--active">
        <div
          class={`meter${indeterminate ? ' meter--busy' : ''}${paused || held ? ' meter--paused' : ''}`}
          style={{ '--p': String(indeterminate ? 1 : job.progress) }}
          role="progressbar"
          aria-label={text}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(indeterminate ? {} : { 'aria-valuenow': Math.round(job.progress * 100) })}
        >
          <span class="meter__label">{text}</span>
          {/* Same label, dark, clipped to the coral fill: readable on both colors. */}
          <span class="meter__fill" aria-hidden="true">
            <span class="meter__label">{text}</span>
          </span>
        </div>
        {job.status === 'queued' && job.held ? (
          <button class="btn btn--primary btn--icon" title={t('startNow')} aria-label={t('startNow')} onClick={() => send({ type: 'start-now', jobId: job.id })}>
            <Icon name="play" />
          </button>
        ) : paused ? (
          <button class="btn btn--primary btn--icon" title={t('resume')} aria-label={t('resume')} onClick={() => send({ type: 'resume', jobId: job.id })}>
            <Icon name="play" />
          </button>
        ) : (
          canPause(job) && (
            <button class="btn btn--soft btn--icon" title={t('pause')} aria-label={t('pause')} onClick={() => send({ type: 'pause', jobId: job.id })}>
              <Icon name="pause" />
            </button>
          )
        )}
        {(job.status === 'capturing' || (paused && job.kind === 'capture' && job.bytes > 0)) && canFinish && (
          <button class="btn btn--primary btn--icon" title={t('finishCapture')} aria-label={t('finishCapture')} onClick={() => send({ type: 'finish-capture', jobId: job.id })}>
            <Icon name="stop" />
          </button>
        )}
        <button class="btn btn--soft btn--icon" title={t('cancel')} aria-label={t('cancel')} onClick={() => send({ type: 'cancel', jobId: job.id })}>
          <Icon name="close" />
        </button>
      </div>
      {stats.length > 0 && (
        <p class="job__stats">
          {stats.map((s, i) => (
            <span key={i}>{s}</span>
          ))}
        </p>
      )}
    </div>
  );
}
