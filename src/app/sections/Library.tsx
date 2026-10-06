import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppRequest, PopupToBg } from '../../shared/messages';
import type { HistoryEntry, Job } from '../../shared/types';
import { Icon } from '../../popup/components/Icon';
import { isActive } from '../../popup/components/JobBar';
import { OtherJobs } from '../../popup/components/OtherJobs';
import { matching } from '../../popup/components/Panels';
import { Segmented } from '../../popup/components/Segmented';
import { Select } from '../../popup/components/Select';
import { size, t, uiLang } from '../../popup/i18n';

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

export function Library({ history, jobs, send }: { history: HistoryEntry[]; jobs: Job[]; send: (m: PopupToBg) => void }) {
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
  const active = jobs.filter(isActive);
  const date = (ts: number) => new Intl.DateTimeFormat(uiLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts);
  const share = (n: number) => `${stats.bytes ? Math.max(n ? 2 : 0, (n / stats.bytes) * 100) : 0}%`;
  return (
    <div class="lib">
      {active.length > 0 && (
        <section class="ap__card" aria-label={t('libActive')}>
          <h2 class="ap__h2">{t('libActive')}</h2>
          <OtherJobs jobs={active} queue={active.length >= 2} send={send} />
        </section>
      )}
      <section class="stats" aria-label={t('libStats')}>
        <p class="stats__total">
          <strong>{stats.count}</strong> {t(stats.count === 1 ? 'libFile' : 'libFiles')} · <strong>{size(stats.bytes) || `0 ${t('sizeUnitByte')}`}</strong>
        </p>
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
      </section>
      {files === false && (
        <p class="notice notice--soft">
          <Icon name="info" size={16} />
          <span>{t('libFileAccess')}</span>
          <button class="btn btn--soft btn--small" onClick={() => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })}>
            {t('libFileAccessOpen')}
            <Icon name="external" size={14} />
          </button>
        </p>
      )}
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
      {!history.length ? (
        <p class="empty">{t('historyEmpty')}</p>
      ) : !shown.length ? (
        <p class="empty">{t('historyNoMatch')}</p>
      ) : (
        <ul class="grid">
          {shown.map((e) => {
            const can = e.downloadId !== undefined && !e.missing;
            const k = kindOf(e);
            return (
              <li key={e.id} class={`tile${e.missing ? ' tile--missing' : ''}`}>
                <button class="tile__thumb" disabled={!can || !files} onClick={() => setPlaying(e)} aria-label={`${t('libPlay')} — ${e.title || e.filename}`}>
                  {e.thumbnail ? <img src={e.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <Icon name={k === 'audio' ? 'audio' : k === 'image' ? 'image' : 'film'} size={28} />}
                  {can && files && (
                    <span class="tile__play" aria-hidden="true">
                      <Icon name="play" size={20} />
                    </span>
                  )}
                  <span class="tag tile__ext">{extOf(e.filename).toUpperCase() || '?'}</span>
                </button>
                <div class="tile__body">
                  <h3 class="tile__title" title={e.title || e.filename}>
                    {e.title || e.filename}
                  </h3>
                  <p class="tile__meta">
                    {e.quality && <span>{e.quality}</span>}
                    {e.size ? <span>{size(e.size)}</span> : null}
                    <span>{date(e.date)}</span>
                  </p>
                  {e.missing && <p class="tile__missing">{t('historyMissing')}</p>}
                </div>
                <div class="tile__tools">
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
                  <button class="hcard__btn" title={t('historyRemove')} aria-label={t('historyRemove')} onClick={() => send({ type: 'history-remove', id: e.id })}>
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
