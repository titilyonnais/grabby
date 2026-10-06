import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppRequest, PopupToBg } from '../../shared/messages';
import type { HistoryEntry, Job } from '../../shared/types';
import { Icon } from '../../popup/components/Icon';
import { canPause, isActive, JobBar } from '../../popup/components/JobBar';
import { matching } from '../../popup/components/Panels';
import { Segmented } from '../../popup/components/Segmented';
import { Select } from '../../popup/components/Select';
import { relativeTime, size, t, uiLang } from '../../popup/i18n';

type Kind = 'all' | 'video' | 'audio' | 'image';

const extOf = (name: string) => /\.([a-z0-9]{2,4})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
const AUDIO = new Set(['m4a', 'mp3', 'opus', 'ogg', 'flac', 'wav']);
const IMAGE = new Set(['jpg', 'gif', 'webp', 'png']);
/** What a saved file is, from its extension. */
export const kindOf = (e: HistoryEntry): Exclude<Kind, 'all'> => {
  const x = extOf(e.filename);
  return AUDIO.has(x) || e.mode === 'audio' ? 'audio' : IMAGE.has(x) ? 'image' : 'video';
};
const siteOf = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0] ?? '';

/** Files Grabby saved, and how much room each kind takes. */
export function libraryStats(entries: HistoryEntry[]): { count: number; bytes: number; kinds: Record<'video' | 'audio' | 'image', number> } {
  const kinds = { video: 0, audio: 0, image: 0 };
  let bytes = 0;
  for (const e of entries) {
    if (e.missing) continue;
    kinds[kindOf(e)] += e.size || 0;
    bytes += e.size || 0;
  }
  return { count: entries.filter((e) => !e.missing).length, bytes, kinds };
}

/** "file:///C:/Users/…/video.mp4" for a path of the computer. */
const fileUrl = (path: string) => `file:///${path.replace(/\\/g, '/').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:')}`;

function Player({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      const req: AppRequest = { app: 'file-paths', ids: [entry.downloadId!] };
      const [d] = ((await chrome.runtime.sendMessage(req).catch(() => [])) ?? []) as { path: string; exists: boolean }[];
      setSrc(d?.exists ? fileUrl(d.path) : null);
    })();
  }, [entry.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const kind = kindOf(entry);
  return (
    <div class="modal" role="dialog" aria-modal="true" aria-label={entry.title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal__box">
        <header class="modal__head">
          <h2>{entry.title || entry.filename}</h2>
          <button class="icon-btn" aria-label={t('close')} title={t('close')} onClick={onClose} autoFocus>
            <Icon name="close" />
          </button>
        </header>
        {src === undefined ? (
          <div class="modal__wait" aria-busy="true" />
        ) : src === null ? (
          <p class="notice">
            <Icon name="alert" size={16} />
            {t('historyMissing')}
          </p>
        ) : kind === 'image' ? (
          <img class="modal__media" src={src} alt={entry.title} />
        ) : kind === 'audio' ? (
          <audio class="modal__audio" src={src} controls autoPlay />
        ) : (
          <video class="modal__media" src={src} controls autoPlay playsInline />
        )}
        <p class="modal__file">{entry.filename}</p>
      </div>
    </div>
  );
}

/** What a download makes: "Vidéo · MP4 · 1080p", "Son · M4A". */
function jobWhat(j: Job): string {
  const what = j.mode === 'audio' ? t('jobKindAudio') : j.format && /^(jpg|gif|webp)$/.test(j.format) ? t('jobKindImage') : t('jobKindVideo');
  return [what, j.format?.toUpperCase(), j.mode === 'video' ? j.quality : ''].filter(Boolean).join(' · ');
}

/** A download under way, with its picture, what it makes and where it came from. */
function ActiveJob({ job, index, send }: { job: Job; index: number; send: (m: PopupToBg) => void }) {
  const site = siteOf(job.pageUrl);
  const paused = job.status === 'paused';
  return (
    <li class={`ajob${paused ? ' ajob--paused' : ''}`} style={{ '--i': String(Math.min(index, 8)) }}>
      <div class="ajob__thumb">
        {job.thumbnail ? <img src={job.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <Icon name={job.mode === 'audio' ? 'audio' : 'film'} size={26} />}
        <span class="ajob__pct" aria-hidden="true">
          {Math.round(job.progress * 100)} %
        </span>
        <span class="ajob__bar" style={{ '--p': String(job.progress) }} aria-hidden="true" />
      </div>
      <div class="ajob__body">
        <h3 class="ajob__title" title={job.title}>
          {job.title}
        </h3>
        <p class="ajob__meta">
          <span class="tag">{jobWhat(job)}</span>
          {site && <span>{site}</span>}
          {job.hidden && <span class="muted">{t('libHidden')}</span>}
        </p>
        <JobBar job={job} send={send} />
      </div>
    </li>
  );
}

export function Library({ history, jobs, send, go }: { history: HistoryEntry[]; jobs: Job[]; send: (m: PopupToBg) => void; go: (section: string) => void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [site, setSite] = useState('');
  const [files, setFiles] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState<HistoryEntry | null>(null);
  useEffect(() => {
    void chrome.extension.isAllowedFileSchemeAccess().then(setFiles, () => setFiles(false));
  }, []);
  const stats = useMemo(() => libraryStats(history), [history]);
  const sites = useMemo(() => [...new Set(history.map((e) => siteOf(e.pageUrl)).filter(Boolean))].sort(), [history]);
  const shown = matching(history, query).filter((e) => (kind === 'all' || kindOf(e) === kind) && (!site || siteOf(e.pageUrl) === site));
  const active = jobs.filter(isActive).sort((a, b) => (a.order ?? a.startedAt) - (b.order ?? b.startedAt));
  const anyPausable = active.some(canPause);
  const anyPaused = active.some((j) => j.status === 'paused');
  const date = (ts: number) => (Date.now() - ts < 7 * 86400_000 ? relativeTime(ts) : new Intl.DateTimeFormat(uiLang(), { day: 'numeric', month: 'short', year: 'numeric' }).format(ts));
  const share = (n: number) => `${stats.bytes ? Math.max(n ? 2 : 0, (n / stats.bytes) * 100) : 0}%`;
  return (
    <div class="lib">
      {active.length > 0 && (
        <section class="lib__active" aria-label={t('libActive')}>
          <header class="ap__cardhead">
            <h2 class="ap__h2">
              <span class="live-dot" aria-hidden="true" />
              {t('libActiveCount', String(active.length))}
            </h2>
            {(anyPausable || anyPaused) && (
              <button class="btn btn--soft btn--small" onClick={() => send({ type: anyPausable ? 'pause-all' : 'resume-all' })}>
                <Icon name={anyPausable ? 'pause' : 'play'} size={14} />
                {anyPausable ? t('queuePauseAll') : t('queueResumeAll')}
              </button>
            )}
          </header>
          <ul class="ajobs">
            {active.map((j, i) => (
              <ActiveJob key={j.id} job={j} index={i} send={send} />
            ))}
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <section class="kpis" aria-label={t('libStats')}>
          <div class="kpi" style={{ '--i': '0' }}>
            <span class="kpi__label">{t('libKpiFiles')}</span>
            <strong class="kpi__value">{stats.count}</strong>
          </div>
          <div class="kpi" style={{ '--i': '1' }}>
            <span class="kpi__label">{t('libKpiSpace')}</span>
            <strong class="kpi__value">{size(stats.bytes) || `0 ${t('sizeUnitByte')}`}</strong>
          </div>
          <div class="kpi kpi--wide" style={{ '--i': '2' }}>
            <span class="kpi__label">{t('libKpiKinds')}</span>
            <div class="stats__bar" aria-hidden="true">
              <span class="stats__seg stats__seg--video" style={{ width: share(stats.kinds.video) }} />
              <span class="stats__seg stats__seg--audio" style={{ width: share(stats.kinds.audio) }} />
              <span class="stats__seg stats__seg--image" style={{ width: share(stats.kinds.image) }} />
            </div>
            <ul class="stats__legend">
              {(['video', 'audio', 'image'] as const).map((k) => (
                <li key={k}>
                  <span class={`stats__dot stats__seg--${k}`} />
                  {t(`libKind_${k}`)} <span class="muted">{size(stats.kinds[k]) || '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {files === false && history.length > 0 && (
        <p class="notice notice--soft">
          <Icon name="info" size={16} />
          <span>{t('libFileAccess')}</span>
          <button class="btn btn--soft btn--small" onClick={() => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })}>
            {t('libFileAccessOpen')}
            <Icon name="external" size={14} />
          </button>
        </p>
      )}

      {history.length > 0 && (
        <div class="lib__filters">
          <label class="search">
            <Icon name="search" size={16} />
            <input type="search" value={query} placeholder={t('historySearch')} aria-label={t('historySearch')} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
          </label>
          <Segmented
            label={t('libKind')}
            value={kind}
            options={[
              ['all', t('libKind_all')],
              ['video', t('libKind_video')],
              ['audio', t('libKind_audio')],
              ['image', t('libKind_image')],
            ]}
            onChange={setKind}
          />
          {sites.length > 1 && (
            <Select label={t('libSite')} value={site} options={[{ value: '', label: t('libSiteAll') }, ...sites.map((s) => ({ value: s, label: s }))]} onChange={setSite} />
          )}
        </div>
      )}

      {!history.length ? (
        <div class="blank">
          <span class="blank__icon" aria-hidden="true">
            <Icon name={active.length ? 'download' : 'grid'} size={30} />
          </span>
          <h2>{t(active.length ? 'libEmptyBusyTitle' : 'libEmptyTitle')}</h2>
          <p>{t(active.length ? 'libEmptyBusyBody' : 'libEmptyBody')}</p>
          <div class="row">
            <button class="btn btn--soft" onClick={() => go('batch')}>
              <Icon name="link" size={16} />
              {t('app_batch')}
            </button>
            <button class="btn btn--soft" onClick={() => go('channels')}>
              <Icon name="bell" size={16} />
              {t('app_channels')}
            </button>
          </div>
        </div>
      ) : !shown.length ? (
        <p class="empty">{t('historyNoMatch')}</p>
      ) : (
        <ul class="grid">
          {shown.map((e, i) => {
            const can = e.downloadId !== undefined && !e.missing;
            const k = kindOf(e);
            return (
              <li key={e.id} class={`ltile${e.missing ? ' ltile--missing' : ''}`} style={{ '--i': String(Math.min(i, 12)) }}>
                <button class="ltile__thumb" disabled={!can || !files} onClick={() => setPlaying(e)} aria-label={`${t('libPlay')} — ${e.title || e.filename}`}>
                  {e.thumbnail ? <img src={e.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <Icon name={k === 'audio' ? 'audio' : k === 'image' ? 'image' : 'film'} size={28} />}
                  {can && files && (
                    <span class="ltile__play" aria-hidden="true">
                      <Icon name="play" size={20} />
                    </span>
                  )}
                  <span class={`tag ltile__ext ltile__ext--${k}`}>{extOf(e.filename).toUpperCase() || '?'}</span>
                </button>
                <div class="ltile__body">
                  <h3 class="ltile__title" title={e.title || e.filename}>
                    {e.title || e.filename}
                  </h3>
                  <p class="ltile__meta">
                    {siteOf(e.pageUrl) && <span>{siteOf(e.pageUrl)}</span>}
                    {e.quality && <span>{e.quality}</span>}
                    {e.size ? <span>{size(e.size)}</span> : null}
                    <span>{date(e.date)}</span>
                  </p>
                  {e.missing && <p class="ltile__missing">{t('historyMissing')}</p>}
                </div>
                <div class="ltile__tools">
                  {can && (
                    <button class="hcard__btn" title={t('showFile')} aria-label={t('showFile')} onClick={() => send({ type: 'show', downloadId: e.downloadId! })}>
                      <Icon name="folder" size={15} />
                    </button>
                  )}
                  {can && (
                    <button class="hcard__btn" title={t('historyOpenFile')} aria-label={t('historyOpenFile')} onClick={() => send({ type: 'open-file', downloadId: e.downloadId! })}>
                      <Icon name="external" size={15} />
                    </button>
                  )}
                  {/^https?:/i.test(e.pageUrl) && (
                    <button class="hcard__btn" title={t('historyRedo')} aria-label={t('historyRedo')} onClick={() => send({ type: 'redo', id: e.id })}>
                      <Icon name="retry" size={15} />
                    </button>
                  )}
                  {/^https?:/i.test(e.pageUrl) && (
                    <a class="hcard__btn" href={e.pageUrl} target="_blank" rel="noreferrer" title={t('historyOpenPage')} aria-label={t('historyOpenPage')}>
                      <Icon name="link" size={15} />
                    </a>
                  )}
                  <button class="hcard__btn ltile__remove" title={t('historyRemove')} aria-label={t('historyRemove')} onClick={() => send({ type: 'history-remove', id: e.id })}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {playing && <Player entry={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}
