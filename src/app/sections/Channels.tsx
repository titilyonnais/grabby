import { useState } from 'preact/hooks';
import type { Watch } from '../../shared/feeds';
import { AUDIO_FORMATS, FORMAT_NAMES } from '../../shared/formats';
import type { AppRequest, PopupToBg } from '../../shared/messages';
import type { OutputFormat } from '../../shared/plan';
import { LIST_QUALITIES } from '../../shared/ytlist';
import { Icon } from '../../popup/components/Icon';
import { Segmented } from '../../popup/components/Segmented';
import { Select } from '../../popup/components/Select';
import { relativeTime, t } from '../../popup/i18n';

const VIDEO = ['mp4', 'webm', 'mkv'] as const;

/** "Surveiller des chaînes": followed channels and playlists, checked every hour. */
export function Channels({ watches, send, preferred }: { watches: Watch[]; send: (m: PopupToBg) => void; preferred: { video: OutputFormat; audio: OutputFormat } }) {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<'video' | 'audio'>('video');
  const [quality, setQuality] = useState<string>(LIST_QUALITIES[0].id);
  const [format, setFormat] = useState<OutputFormat>((VIDEO as readonly string[]).includes(preferred.video) ? preferred.video : 'mp4');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const audioFormat = (AUDIO_FORMATS as readonly string[]).includes(preferred.audio) ? preferred.audio : 'm4a';
  const add = async () => {
    setBusy(true);
    setSaid(null);
    const req: AppRequest = { app: 'watch-add', url, mode, quality, format: mode === 'audio' ? audioFormat : format };
    const res = (await chrome.runtime.sendMessage(req).catch(() => 'failed')) as Watch | string | null;
    setBusy(false);
    if (res && typeof res === 'object') {
      setSaid(t('follow_ok'));
      setUrl('');
    } else setSaid(t(`follow_${res || 'failed'}`));
  };
  const check = async (id?: string) => {
    setChecking(id ?? 'all');
    const req: AppRequest = { app: 'watch-check', ...(id ? { id } : {}) };
    const n = (await chrome.runtime.sendMessage(req).catch(() => 0)) as number;
    setChecking(null);
    setSaid(n ? t('watchStarted', String(n)) : t('watchNothing'));
  };
  return (
    <div class="stack">
      <section class="ap__card">
        <label class="field">
          <span class="field__label">{t('watchUrl')}</span>
          <input class="field__input" type="url" value={url} placeholder="https://www.youtube.com/@…" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
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
          {mode === 'video' && <Select label={t('qualityLabel')} value={quality} options={LIST_QUALITIES.map((q) => ({ value: q.id, label: q.label }))} onChange={setQuality} />}
          {mode === 'video' && <Select label={t('formatLabel')} value={format} options={VIDEO.map((f) => ({ value: f as OutputFormat, label: FORMAT_NAMES[f] }))} onChange={setFormat} />}
          <button class="btn btn--primary" disabled={busy || !url.trim()} onClick={() => void add()}>
            <Icon name="bell" size={16} />
            {t('watchAdd')}
          </button>
        </div>
        {said && (
          <p class="hint" role="status">
            {said}
          </p>
        )}
        <p class="hint">{t('watchHint')}</p>
      </section>
      {watches.length > 0 && (
        <section class="ap__card">
          <header class="ap__cardhead">
            <h2 class="ap__h2">{t('watchList', String(watches.length))}</h2>
            <button class="btn btn--soft btn--small" disabled={!!checking} onClick={() => void check()}>
              <Icon name="retry" size={15} />
              {t('watchCheckAll')}
            </button>
          </header>
          <ul class="lines">
            {watches.map((w) => (
              <li key={w.id} class={`line${w.error ? ' line--failed' : ''}`}>
                <span class="line__icon" aria-hidden="true">
                  <Icon name={w.kind === 'channel' ? 'bell' : 'list'} size={16} />
                </span>
                <span class="line__text">
                  <a class="line__title" href={w.kind === 'channel' ? `https://www.youtube.com/channel/${w.key}` : `https://www.youtube.com/playlist?list=${w.key}`} target="_blank" rel="noreferrer">
                    {w.title}
                  </a>
                  <span class="line__meta">
                    {t(w.kind === 'channel' ? 'watchKindChannel' : 'watchKindPlaylist')}
                    {' · '}
                    {w.lastCheck ? t('watchChecked', relativeTime(w.lastCheck)) : t('watchNever')}
                    {' · '}
                    {t('watchGot', String(w.got))}
                    {w.error ? ` · ${t('watchError')}` : ''}
                  </span>
                </span>
                <span class="line__tools">
                  <Select
                    label={t('watchWhat')}
                    value={w.mode === 'audio' ? 'audio' : w.quality}
                    options={[...LIST_QUALITIES.map((q) => ({ value: q.id as string, label: q.label, group: t('fmt_group_video') })), { value: 'audio', label: t('batchModeAudio'), group: t('fmt_group_audio') }]}
                    onChange={(v) => send({ type: 'watch-change', id: w.id, patch: v === 'audio' ? { mode: 'audio' } : { mode: 'video', quality: v } })}
                  />
                  <button class="hcard__btn" disabled={!!checking} title={t('watchCheck')} aria-label={t('watchCheck')} onClick={() => void check(w.id)}>
                    <Icon name="retry" size={15} />
                  </button>
                  <button class="hcard__btn" title={t('watchRemove')} aria-label={t('watchRemove')} onClick={() => send({ type: 'watch-remove', id: w.id })}>
                    <Icon name="trash" size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
