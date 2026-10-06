import { useState } from 'preact/hooks';
import type { FeedEntry, Watch } from '../../shared/feeds';
import { AUDIO_FORMATS, FORMAT_NAMES } from '../../shared/formats';
import type { AppRequest, PopupToBg } from '../../shared/messages';
import type { OutputFormat } from '../../shared/plan';
import type { Job } from '../../shared/types';
import { LIST_DEFAULT, LIST_QUALITIES, listQuality } from '../../shared/ytlist';
import { Icon } from '../../popup/components/Icon';
import { isActive } from '../../popup/components/JobBar';
import { Segmented } from '../../popup/components/Segmented';
import { Select } from '../../popup/components/Select';
import { relativeTime, t, uiLang } from '../../popup/i18n';

const VIDEO = ['mp4', 'webm', 'mkv'] as const;

const pageOf = (w: Watch) => (w.kind === 'channel' ? `https://www.youtube.com/${w.handle ?? `channel/${w.key}`}` : `https://www.youtube.com/playlist?list=${w.key}`);
const thumbOf = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/** The channel's picture, or its first letter on a tint of its own. */
function Avatar({ w }: { w: Watch }) {
  const [broken, setBroken] = useState(false);
  const src = w.avatar ?? (w.kind === 'playlist' && w.recent?.[0] ? thumbOf(w.recent[0].id) : undefined);
  if (src && !broken) return <img class={`avatar${w.kind === 'playlist' ? ' avatar--list' : ''}`} src={src} alt="" loading="lazy" referrerpolicy="no-referrer" onError={() => setBroken(true)} />;
  const hue = [...w.key].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span class="avatar avatar--letter" style={{ '--h': String(hue) }} aria-hidden="true">
      {(w.title.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/** One of its latest videos: taken by Grabby, being recorded, or older than the follow. */
function Recent({ e, w, job, index }: { e: FeedEntry; w: Watch; job?: Job; index: number }) {
  const taken = w.taken?.includes(e.id);
  const before = e.published < w.since - 60 * 60_000;
  const status = job ? 'busy' : taken ? 'taken' : before ? 'before' : 'new';
  return (
    <li class={`recent recent--${status}`} style={{ '--i': String(index) }}>
      <a class="recent__thumb" href={`https://www.youtube.com/watch?v=${e.id}`} target="_blank" rel="noreferrer" title={e.title}>
        <img src={thumbOf(e.id)} alt="" loading="lazy" referrerpolicy="no-referrer" />
        <span class="recent__status">
          {status === 'busy' ? (
            <>
              <Icon name="download" size={12} />
              {Math.round(job!.progress * 100)} %
            </>
          ) : status === 'taken' ? (
            <>
              <Icon name="check" size={12} />
              {t('watchTaken')}
            </>
          ) : status === 'before' ? (
            t('watchBefore')
          ) : (
            t('watchNew')
          )}
        </span>
        {job && <span class="recent__bar" style={{ '--p': String(job.progress) }} aria-hidden="true" />}
      </a>
      <span class="recent__title" title={e.title}>
        {e.title}
      </span>
      {e.published > 0 && <span class="recent__date">{relativeTime(e.published)}</span>}
    </li>
  );
}

/** "Surveiller des chaînes": followed channels and playlists, checked every hour. */
export function Channels({ watches, jobs, send, preferred }: { watches: Watch[]; jobs: Job[]; send: (m: PopupToBg) => void; preferred: { video: OutputFormat; audio: OutputFormat } }) {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<'video' | 'audio'>('video');
  const [quality, setQuality] = useState<string>(LIST_DEFAULT);
  const [format, setFormat] = useState<OutputFormat>((VIDEO as readonly string[]).includes(preferred.video) ? preferred.video : 'mp4');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  // "Stop following" asks once more before it forgets a channel.
  const [leaving, setLeaving] = useState<string | null>(null);
  const audioFormat = (AUDIO_FORMATS as readonly string[]).includes(preferred.audio) ? preferred.audio : 'm4a';
  const add = async () => {
    setBusy(true);
    setSaid(null);
    const req: AppRequest = { app: 'watch-add', url, mode, quality, format: mode === 'audio' ? audioFormat : format };
    const res = (await chrome.runtime.sendMessage(req).catch(() => 'failed')) as Watch | string | null;
    setBusy(false);
    if (res && typeof res === 'object') {
      setSaid({ ok: true, text: t('follow_ok') });
      setUrl('');
    } else setSaid({ ok: false, text: t(`follow_${res || 'failed'}`) });
  };
  const check = async (id?: string) => {
    setChecking(id ?? 'all');
    const req: AppRequest = { app: 'watch-check', ...(id ? { id } : {}) };
    const n = (await chrome.runtime.sendMessage(req).catch(() => 0)) as number;
    setChecking(null);
    setSaid({ ok: true, text: n ? t('watchStarted', String(n)) : t('watchNothing') });
  };
  // Videos of a list being recorded, by video id.
  const recording = new Map(jobs.filter((j) => isActive(j) && j.entry).map((j) => [j.entry!.id, j]));
  const qualityOptions = LIST_QUALITIES.map((q) => ({ value: q.id as string, label: q.label, ...(q.height > 1080 ? { detail: t('watchVp9') } : {}) }));
  const what = (w: Watch) => (w.mode === 'audio' ? `${t('batchModeAudio')}${w.format ? ` · ${FORMAT_NAMES[w.format]}` : ''}` : `${listQuality(w.quality).label}${w.format ? ` · ${FORMAT_NAMES[w.format]}` : ''}`);
  const fmt = new Intl.NumberFormat(uiLang());

  return (
    <div class="stack">
      <section class="ap__card follow-form">
        <label class="field">
          <span class="field__label">{t('watchUrl')}</span>
          <span class="field__icon">
            <Icon name="bell" size={16} />
            <input
              class="field__input"
              type="url"
              value={url}
              placeholder="https://www.youtube.com/@…"
              onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && void add()}
            />
          </span>
        </label>
        <div class="row">
          <Segmented
            label={t('batchMode')}
            value={mode}
            options={[
              ['video', t('batchModeVideo')],
              ['audio', t('batchModeAudio')],
            ]}
            onChange={setMode}
          />
          {mode === 'video' && <Select label={t('qualityLabel')} value={quality} options={qualityOptions} onChange={setQuality} />}
          {mode === 'video' && <Select label={t('formatLabel')} value={format} options={VIDEO.map((f) => ({ value: f as OutputFormat, label: FORMAT_NAMES[f] }))} onChange={setFormat} />}
          <button class={`btn btn--primary${busy ? ' btn--busy' : ''}`} disabled={busy || !url.trim()} onClick={() => void add()}>
            <Icon name="bell" size={16} />
            {busy ? t('watchAdding') : t('watchAdd')}
          </button>
        </div>
        {said && (
          <p key={said.text} class={`said said--${said.ok ? 'ok' : 'no'}`} role="status">
            <Icon name={said.ok ? 'check' : 'alert'} size={15} />
            {said.text}
          </p>
        )}
        <p class="hint">{t('watchHint')}</p>
      </section>

      {watches.length > 0 ? (
        <section class="chans" aria-label={t('watchList', String(watches.length))}>
          <header class="ap__cardhead">
            <h2 class="ap__h2">{t('watchList', String(watches.length))}</h2>
            <button class="btn btn--soft btn--small" disabled={!!checking} onClick={() => void check()}>
              <span class={checking === 'all' ? 'spinning' : ''}>
                <Icon name="retry" size={15} />
              </span>
              {t('watchCheckAll')}
            </button>
          </header>
          <ul class="chans__list">
            {watches.map((w, i) => (
              <li key={w.id} class={`chan${w.error ? ' chan--failed' : ''}`} style={{ '--i': String(Math.min(i, 8)) }}>
                <div class="chan__head">
                  <a class="chan__avatar" href={pageOf(w)} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true">
                    <Avatar w={w} />
                  </a>
                  <div class="chan__who">
                    <a class="chan__name" href={pageOf(w)} target="_blank" rel="noreferrer">
                      {w.title}
                    </a>
                    <span class="chan__sub">
                      {[w.kind === 'channel' ? w.handle : t('watchKindPlaylist'), w.subscribers].filter(Boolean).join(' · ') || t('watchKindChannel')}
                    </span>
                    <span class="chan__facts">
                      <span class="tag">{what(w)}</span>
                      <span>{w.lastCheck ? t('watchChecked', relativeTime(w.lastCheck)) : t('watchNever')}</span>
                      <span>{t('watchGot', fmt.format(w.got))}</span>
                      {w.error && (
                        <span class="chan__error">
                          <Icon name="alert" size={13} />
                          {t('watchError')}
                        </span>
                      )}
                    </span>
                  </div>
                  <div class="chan__tools">
                    <Select
                      label={t('watchWhat')}
                      value={w.mode === 'audio' ? 'audio' : w.quality}
                      options={[...qualityOptions.map((q) => ({ ...q, group: t('fmt_group_video') })), { value: 'audio', label: t('batchModeAudio'), group: t('fmt_group_audio') }]}
                      onChange={(v) => send({ type: 'watch-change', id: w.id, patch: v === 'audio' ? { mode: 'audio' } : { mode: 'video', quality: v } })}
                    />
                    <button class="hcard__btn" disabled={!!checking} title={t('watchCheck')} aria-label={t('watchCheck')} onClick={() => void check(w.id)}>
                      <span class={checking === w.id ? 'spinning' : ''}>
                        <Icon name="retry" size={15} />
                      </span>
                    </button>
                    {leaving === w.id ? (
                      <button
                        class="btn btn--small btn--danger"
                        onClick={() => {
                          setLeaving(null);
                          send({ type: 'watch-remove', id: w.id });
                        }}
                        onBlur={() => setLeaving(null)}
                        autoFocus
                      >
                        {t('watchRemoveSure')}
                      </button>
                    ) : (
                      <button class="hcard__btn" title={t('watchRemove')} aria-label={t('watchRemove')} onClick={() => setLeaving(w.id)}>
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                </div>
                {w.recent?.length ? (
                  <ul class="recents" aria-label={t('watchRecent')}>
                    {w.recent.slice(0, 6).map((e, k) => (
                      <Recent key={e.id} e={e} w={w} index={k} {...(recording.get(e.id) ? { job: recording.get(e.id)! } : {})} />
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div class="blank">
          <span class="blank__icon" aria-hidden="true">
            <Icon name="bell" size={30} />
          </span>
          <h2>{t('watchEmptyTitle')}</h2>
          <p>{t('watchEmptyBody')}</p>
        </div>
      )}
    </div>
  );
}
