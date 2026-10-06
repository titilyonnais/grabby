import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppRequest, PopupToBg } from '../../shared/messages';
import { spokenHits, type SpokenHit, type Transcript } from '../../shared/transcript';
import type { HistoryEntry, Job } from '../../shared/types';
import { Icon } from '../../popup/components/Icon';
import { canPause, isActive, JobBar } from '../../popup/components/JobBar';
import { matching } from '../../popup/components/Panels';
import { Segmented } from '../../popup/components/Segmented';
import { Select } from '../../popup/components/Select';
import { relativeTime, size, t, uiLang } from '../../popup/i18n';
import { clockOf, Player } from './Player';

type Kind = 'all' | 'video' | 'audio' | 'image';

const extOf = (name: string) => /\.([a-z0-9]{2,4})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
const AUDIO = new Set(['m4a', 'mp3', 'opus', 'ogg', 'flac', 'wav']);
const IMAGE = new Set(['jpg', 'gif', 'webp', 'png']);
/** What a saved file is, from its extension. */
export const kindOf = (e: HistoryEntry): Exclude<Kind, 'all'> => {
  const x = extOf(e.filename);
  return AUDIO.has(x) || e.mode === 'audio' ? 'audio' : IMAGE.has(x) ? 'image' : 'video';
};
export const siteOf = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0] ?? '';

/** Files Grabby saved, and how much room each kind takes. */
export function libraryStats(entries: HistoryEntry[]): {
  count: number;
  bytes: number;
  kinds: Record<'video' | 'audio' | 'image', number>;
} {
  const kinds = { video: 0, audio: 0, image: 0 };
  let bytes = 0;
  for (const e of entries) {
    if (e.missing) continue;
    kinds[kindOf(e)] += e.size || 0;
    bytes += e.size || 0;
  }
  return { count: entries.filter((e) => !e.missing).length, bytes, kinds };
}

/** Every collection used, the biggest first. */
export function collectionsOf(entries: HistoryEntry[]): { name: string; n: number }[] {
  const n = new Map<string, number>();
  for (const e of entries) for (const tag of e.tags ?? []) n.set(tag, (n.get(tag) ?? 0) + 1);
  return [...n].map(([name, count]) => ({ name, n: count })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

/** The library's search: titles, sites and file names, and what is said in the files. */
export function searchLibrary(entries: HistoryEntry[], query: string, texts: Record<string, Transcript>): { shown: HistoryEntry[]; hits: Map<string, SpokenHit[]> } {
  const hits = new Map<string, SpokenHit[]>();
  if (!query.trim()) return { shown: entries, hits };
  const named = new Set(matching(entries, query).map((e) => e.id));
  for (const e of entries) {
    const text = texts[e.id];
    if (!text) continue;
    const found = spokenHits(text, query, 3);
    if (found.length) hits.set(e.id, found);
  }
  return {
    shown: entries.filter((e) => named.has(e.id) || hits.has(e.id)),
    hits,
  };
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

/** Puts entries in collections, or takes them out; a name typed makes a new one. */
function Collections({ ids, entries, all, send, onClose }: { ids: string[]; entries: HistoryEntry[]; all: string[]; send: (m: PopupToBg) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const chosen = entries.filter((e) => ids.includes(e.id));
  const inAll = (tag: string) => chosen.length > 0 && chosen.every((e) => e.tags?.includes(tag));
  const add = (tag: string) => send({ type: 'history-mark', ids, patch: { addTag: tag } });
  const flip = (tag: string) =>
    send({
      type: 'history-mark',
      ids,
      patch: inAll(tag) ? { removeTag: tag } : { addTag: tag },
    });
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, []);
  return (
    <div class="modal" role="dialog" aria-modal="true" aria-label={t('libTags')} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal__box tagbox">
        <header class="modal__head">
          <h2>{ids.length === 1 ? t('libTagsOf', chosen[0]?.title || chosen[0]?.filename || '') : t('libTagsMany', String(ids.length))}</h2>
          <button class="icon-btn" aria-label={t('close')} title={t('close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {all.length ? (
          <div class="tagbox__list" role="group" aria-label={t('libTags')}>
            {all.map((tag) => (
              <button key={tag} class={`chip${inAll(tag) ? ' chip--on' : ''}`} aria-pressed={inAll(tag)} onClick={() => flip(tag)}>
                {inAll(tag) && <Icon name="check" size={13} />}
                {tag}
              </button>
            ))}
          </div>
        ) : (
          <p class="hint">{t('libTagNone')}</p>
        )}
        <form
          class="tagbox__new"
          onSubmit={(e) => {
            e.preventDefault();
            const tag = name.replace(/\s+/g, ' ').trim().slice(0, 40);
            if (!tag) return;
            add(tag);
            setName('');
          }}
        >
          <input class="field__input" value={name} maxLength={40} placeholder={t('libTagNew')} aria-label={t('libTagNew')} onInput={(e) => setName((e.target as HTMLInputElement).value)} autoFocus />
          <button class="btn btn--primary btn--small" disabled={!name.trim()}>
            <Icon name="tag" size={14} />
            {t('libTagAdd')}
          </button>
        </form>
      </div>
    </div>
  );
}

const UNDO_MS = 8000;

export function Library({ history, jobs, send, go }: { history: HistoryEntry[]; jobs: Job[]; send: (m: PopupToBg) => void; go: (section: string) => void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [site, setSite] = useState('');
  const [favs, setFavs] = useState(false);
  const [tag, setTag] = useState('');
  const [files, setFiles] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState<{
    entry: HistoryEntry;
    at?: number;
  } | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [tagging, setTagging] = useState<string[] | null>(null);
  const [undo, setUndo] = useState<HistoryEntry[] | null>(null);
  const [texts, setTexts] = useState<Record<string, Transcript>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    void chrome.extension.isAllowedFileSchemeAccess().then(setFiles, () => setFiles(false));
  }, []);

  // The pictures kept for when there is no network.
  const ids = history.map((e) => e.id).join(',');
  useEffect(() => {
    const req: AppRequest = { app: 'thumbs', ids: history.map((e) => e.id) };
    void chrome.runtime
      .sendMessage(req)
      .then((got: Record<string, string> | null) => got && setThumbs(got))
      .catch(() => {});
  }, [ids]);

  // What is said in the files, read once a search starts.
  const spoken = history.filter((e) => e.text).map((e) => e.id);
  const spokenKey = spoken.join(',');
  const searching = query.trim().length > 1;
  useEffect(() => {
    if (!searching || !spoken.length) return;
    const req: AppRequest = { app: 'texts', ids: spoken };
    void chrome.runtime
      .sendMessage(req)
      .then((got: Record<string, Transcript> | null) => got && setTexts(got))
      .catch(() => {});
  }, [searching, spokenKey]);

  const stats = useMemo(() => libraryStats(history), [history]);
  const sites = useMemo(() => [...new Set(history.map((e) => siteOf(e.pageUrl)).filter(Boolean))].sort(), [history]);
  const tags = useMemo(() => collectionsOf(history), [history]);
  const anyFav = history.some((e) => e.fav);
  const filtered = history.filter((e) => (kind === 'all' || kindOf(e) === kind) && (!site || siteOf(e.pageUrl) === site) && (!favs || e.fav) && (!tag || e.tags?.includes(tag)));
  const { shown, hits } = useMemo(() => searchLibrary(filtered, query, texts), [filtered.map((e) => e.id).join(','), query, texts]);
  const active = jobs.filter(isActive).sort((a, b) => (a.order ?? a.startedAt) - (b.order ?? b.startedAt));
  const anyPausable = active.some(canPause);
  const anyPaused = active.some((j) => j.status === 'paused');
  const date = (ts: number) => (Date.now() - ts < 7 * 86400_000 ? relativeTime(ts) : new Intl.DateTimeFormat(uiLang(), { day: 'numeric', month: 'short', year: 'numeric' }).format(ts));
  const share = (n: number) => `${stats.bytes ? Math.max(n ? 2 : 0, (n / stats.bytes) * 100) : 0}%`;

  // A filter on a collection that no longer exists goes.
  useEffect(() => {
    if (tag && !tags.some((x) => x.name === tag)) setTag('');
    if (favs && !anyFav) setFavs(false);
  }, [tags, anyFav]);
  // Picked entries that are gone are forgotten.
  useEffect(() => setPicked((p) => p.filter((id) => history.some((e) => e.id === id))), [ids]);

  const remove = (out: string[]) => {
    const gone = history.filter((e) => out.includes(e.id));
    if (!gone.length) return;
    send({ type: 'history-remove', ids: out });
    setPicked((p) => p.filter((id) => !out.includes(id)));
    setUndo(gone);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };
  const putBack = () => {
    if (!undo) return;
    send({ type: 'history-restore', entries: undo });
    setUndo(null);
    clearTimeout(undoTimer.current);
  };
  const flipFav = (e: HistoryEntry) => send({ type: 'history-mark', ids: [e.id], patch: { fav: !e.fav } });
  const flipPick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const stopPicking = () => {
    setPicking(false);
    setPicked([]);
  };
  const play = (e: HistoryEntry, at?: number) => {
    if (e.downloadId === undefined || e.missing || !files) return;
    setPlaying({ entry: e, ...(at !== undefined ? { at } : {}) });
  };

  // The keyboard: « / » to search, arrows between files, Entrée to play, F for a favorite, Suppr to take out.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (playing || tagging) return;
      const target = e.target as HTMLElement;
      const typing = !!target.closest('input, textarea, select');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        search.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (picking) return stopPicking();
        if (typing && query) return setQuery('');
        return;
      }
      if (typing) return;
      const tile = target.closest<HTMLElement>('li[data-id]');
      const list = [...(grid.current?.querySelectorAll<HTMLElement>('li[data-id]') ?? [])];
      if (!list.length) return;
      const at = tile ? list.indexOf(tile) : -1;
      const entry = tile ? shown.find((x) => x.id === tile.dataset.id) : undefined;
      const focus = (i: number) => {
        const next = list[Math.max(0, Math.min(list.length - 1, i))];
        next?.querySelector<HTMLElement>('.ltile__thumb')?.focus();
        next?.scrollIntoView({ block: 'nearest' });
      };
      const columns = Math.max(1, list.filter((li) => li.offsetTop === list[0]!.offsetTop).length);
      if (e.key.startsWith('Arrow') && at < 0 && grid.current?.contains(target)) return;
      if (e.key === 'ArrowRight' && at >= 0) (e.preventDefault(), focus(at + 1));
      else if (e.key === 'ArrowLeft' && at >= 0) (e.preventDefault(), focus(at - 1));
      else if (e.key === 'ArrowDown' && at >= 0) (e.preventDefault(), focus(at + columns));
      else if (e.key === 'ArrowUp' && at >= 0) (e.preventDefault(), focus(at - columns));
      else if (e.key === 'Home' && at >= 0) (e.preventDefault(), focus(0));
      else if (e.key === 'End' && at >= 0) (e.preventDefault(), focus(list.length - 1));
      else if ((e.key === 'f' || e.key === 'F') && entry) (e.preventDefault(), flipFav(entry));
      else if ((e.key === 'Delete' || e.key === 'Backspace') && entry) {
        e.preventDefault();
        remove(picking && picked.includes(entry.id) ? picked : [entry.id]);
        focus(at);
      } else if (e.key === 'x' && entry) (e.preventDefault(), picking ? flipPick(entry.id) : (setPicking(true), setPicked([entry.id])));
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  const redoable = (e: HistoryEntry) => /^https?:/i.test(e.pageUrl);
  const chosen = history.filter((e) => picked.includes(e.id));
  return (
    <div class={`lib${picking ? ' lib--picking' : ''}`}>
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
            <input
              ref={search}
              type="search"
              value={query}
              placeholder={t(spoken.length ? 'libSearchSpoken' : 'historySearch')}
              aria-label={t(spoken.length ? 'libSearchSpoken' : 'historySearch')}
              aria-keyshortcuts="/"
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
            <kbd class="search__key" aria-hidden="true">
              /
            </kbd>
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
          {sites.length > 1 && <Select label={t('libSite')} value={site} options={[{ value: '', label: t('libSiteAll') }, ...sites.map((s) => ({ value: s, label: s }))]} onChange={setSite} />}
          <button class={`btn btn--soft btn--small${picking ? ' btn--on' : ''}`} aria-pressed={picking} onClick={() => (picking ? stopPicking() : setPicking(true))}>
            <Icon name="select" size={15} />
            {t('libSelect')}
          </button>
          {(anyFav || tags.length > 0) && (
            <div class="lib__chips" role="group" aria-label={t('libTags')}>
              {anyFav && (
                <button class={`chip${favs ? ' chip--on' : ''}`} aria-pressed={favs} onClick={() => setFavs(!favs)}>
                  <Icon name="star" size={13} />
                  {t('libFav')}
                </button>
              )}
              {tags.map((x) => (
                <button key={x.name} class={`chip${tag === x.name ? ' chip--on' : ''}`} aria-pressed={tag === x.name} onClick={() => setTag(tag === x.name ? '' : x.name)}>
                  <Icon name="tag" size={13} />
                  {x.name}
                  <span class="chip__n">{x.n}</span>
                </button>
              ))}
            </div>
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
        <ul ref={grid} class="grid" aria-label={t('app_library')}>
          {shown.map((e, i) => {
            const can = e.downloadId !== undefined && !e.missing;
            const k = kindOf(e);
            const on = picked.includes(e.id);
            const picture = thumbs[e.id] ?? e.thumbnail;
            const said = hits.get(e.id);
            return (
              <li key={e.id} data-id={e.id} class={`ltile${e.missing ? ' ltile--missing' : ''}${on ? ' ltile--on' : ''}`} style={{ '--i': String(Math.min(i, 12)) }}>
                <button
                  class="ltile__thumb"
                  aria-disabled={!picking && (!can || !files)}
                  aria-pressed={picking ? on : undefined}
                  onClick={() => (picking ? flipPick(e.id) : play(e))}
                  aria-label={`${picking ? t('libPick') : t('libPlay')} — ${e.title || e.filename}`}
                >
                  {picture ? <img src={picture} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <Icon name={k === 'audio' ? 'audio' : k === 'image' ? 'image' : 'film'} size={28} />}
                  {picking ? (
                    <span class="ltile__check" aria-hidden="true">
                      {on && <Icon name="check" size={16} />}
                    </span>
                  ) : (
                    can &&
                    files && (
                      <span class="ltile__play" aria-hidden="true">
                        <Icon name="play" size={20} />
                      </span>
                    )
                  )}
                  <span class={`tag ltile__ext ltile__ext--${k}`}>{extOf(e.filename).toUpperCase() || '?'}</span>
                </button>
                {!picking && (
                  <button
                    class={`ltile__fav${e.fav ? ' on' : ''}`}
                    aria-pressed={!!e.fav}
                    title={t(e.fav ? 'libFavRemove' : 'libFavAdd')}
                    aria-label={t(e.fav ? 'libFavRemove' : 'libFavAdd')}
                    onClick={() => flipFav(e)}
                  >
                    <Icon name="star" size={15} />
                  </button>
                )}
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
                  {e.tags?.length ? (
                    <p class="ltile__tags">
                      {e.tags.map((x) => (
                        <button key={x} class="ltile__tag" onClick={() => setTag(x)} title={t('libTagShow', x)}>
                          {x}
                        </button>
                      ))}
                    </p>
                  ) : null}
                  {said && (
                    <ul class="ltile__said" aria-label={t('libSaid')}>
                      {said.map((h) => (
                        <li key={h.at}>
                          <button disabled={!can || !files} onClick={() => play(e, h.at)} title={t('libSaidAt', clockOf(h.at))}>
                            <span class="player__at">{clockOf(h.at)}</span>
                            <span class="ltile__saidtext">« {h.text} »</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
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
                  {redoable(e) && (
                    <button class="hcard__btn" title={t('historyRedo')} aria-label={t('historyRedo')} onClick={() => send({ type: 'redo', id: e.id })}>
                      <Icon name="retry" size={15} />
                    </button>
                  )}
                  {redoable(e) && (
                    <a class="hcard__btn" href={e.pageUrl} target="_blank" rel="noreferrer" title={t('historyOpenPage')} aria-label={t('historyOpenPage')}>
                      <Icon name="link" size={15} />
                    </a>
                  )}
                  <button class="hcard__btn" title={t('libTagEdit')} aria-label={t('libTagEdit')} onClick={() => setTagging([e.id])}>
                    <Icon name="tag" size={15} />
                  </button>
                  <button class="hcard__btn ltile__remove" title={t('historyRemove')} aria-label={t('historyRemove')} onClick={() => remove([e.id])}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {history.length > 0 && !picking && <p class="lib__keys hint">{t('libKeys')}</p>}

      {picking && (
        <div class="selbar" role="toolbar" aria-label={t('libSelect')}>
          <strong class="selbar__n" aria-live="polite">
            {picked.length === 1 ? t('libPickedOne') : t('libPicked', String(picked.length))}
          </strong>
          <button class="btn btn--soft btn--small" onClick={() => setPicked(picked.length === shown.length ? [] : shown.map((e) => e.id))}>
            {picked.length === shown.length ? t('libPickNone') : t('libPickAll')}
          </button>
          <span class="selbar__gap" />
          <button
            class="btn btn--soft btn--small"
            disabled={!picked.length}
            onClick={() =>
              send({
                type: 'history-mark',
                ids: picked,
                patch: { fav: !chosen.every((e) => e.fav) },
              })
            }
          >
            <Icon name="star" size={14} />
            {chosen.length && chosen.every((e) => e.fav) ? t('libFavRemove') : t('libFavAdd')}
          </button>
          <button class="btn btn--soft btn--small" disabled={!picked.length} onClick={() => setTagging(picked)}>
            <Icon name="tag" size={14} />
            {t('libTagEdit')}
          </button>
          <button
            class="btn btn--soft btn--small"
            disabled={!chosen.some(redoable)}
            onClick={() => {
              for (const e of chosen.filter(redoable)) send({ type: 'redo', id: e.id });
              stopPicking();
            }}
          >
            <Icon name="retry" size={14} />
            {t('historyRedo')}
          </button>
          <button class="btn btn--soft btn--small btn--danger" disabled={!picked.length} onClick={() => remove(picked)}>
            <Icon name="trash" size={14} />
            {t('historyRemove')}
          </button>
          <button class="icon-btn" aria-label={t('libPickDone')} title={t('libPickDone')} onClick={stopPicking}>
            <Icon name="close" />
          </button>
        </div>
      )}

      {undo && (
        <div class="undo" role="status">
          <Icon name="trash" size={15} />
          <span>{undo.length === 1 ? t('libRemovedOne') : t('libRemoved', String(undo.length))}</span>
          <button class="btn btn--soft btn--small" onClick={putBack}>
            <Icon name="undo" size={14} />
            {t('libUndo')}
          </button>
        </div>
      )}

      {tagging && <Collections ids={tagging} entries={history} all={tags.map((x) => x.name)} send={send} onClose={() => setTagging(null)} />}
      {playing && <Player entry={playing.entry} start={playing.at} onClose={() => setPlaying(null)} />}
    </div>
  );
}
