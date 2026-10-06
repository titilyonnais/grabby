import { useState } from 'preact/hooks';
import { parseUrls, type BatchItem, type BatchMode } from '../../shared/batch';
import type { AppRequest, PopupToBg } from '../../shared/messages';
import { Icon } from '../../popup/components/Icon';
import { Segmented } from '../../popup/components/Segmented';
import { t } from '../../popup/i18n';

const STATUS_ICON = { waiting: 'clock', opening: 'retry', started: 'check', failed: 'alert' } as const;

/** "Coller une liste d'adresses": pages opened two at a time, each one's video downloaded. */
export function Addresses({ items, send }: { items: BatchItem[]; send: (m: PopupToBg) => void }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<BatchMode>('auto');
  const [added, setAdded] = useState<number | null>(null);
  const found = parseUrls(text).length;
  const add = async () => {
    const req: AppRequest = { app: 'batch-add', text, mode };
    const n = (await chrome.runtime.sendMessage(req).catch(() => 0)) as number;
    setAdded(n);
    if (n) setText('');
  };
  const done = items.filter((i) => i.status === 'started' || i.status === 'failed').length;
  return (
    <div class="stack">
      <section class="ap__card">
        <label class="field">
          <span class="field__label">{t('batchPaste')}</span>
          <textarea
            class="field__area"
            rows={7}
            value={text}
            spellcheck={false}
            placeholder={'https://…\nhttps://…'}
            onInput={(e) => {
              setText((e.target as HTMLTextAreaElement).value);
              setAdded(null);
            }}
          />
        </label>
        <div class="row">
          <Segmented
            label={t('batchMode')}
            value={mode}
            options={[
              ['auto', t('batchModeAuto')],
              ['video', t('batchModeVideo')],
              ['audio', t('batchModeAudio')],
            ]}
            onChange={setMode}
          />
          <button class="btn btn--primary" disabled={!found} onClick={() => void add()}>
            <Icon name="plus" size={16} />
            {found ? t('batchAdd', String(found)) : t('batchAddNone')}
          </button>
        </div>
        {added !== null && <p class="hint" role="status">{added ? t('batchAdded', String(added)) : t('batchNothingNew')}</p>}
        <p class="hint">{t('batchHint')}</p>
      </section>
      {items.length > 0 && (
        <section class="ap__card">
          <header class="ap__cardhead">
            <h2 class="ap__h2">{t('batchList', String(items.length))}</h2>
            <span class="row row--tight">
              {done > 0 && (
                <button class="btn btn--soft btn--small" onClick={() => send({ type: 'batch-clear', all: false })}>
                  {t('batchClearDone')}
                </button>
              )}
              <button class="btn btn--soft btn--small" onClick={() => send({ type: 'batch-clear', all: true })}>
                {t('batchClearAll')}
              </button>
            </span>
          </header>
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label={t('batchProgress', [String(done), String(items.length)])}>
            <span class="progress__bar" style={{ '--p': String(items.length ? done / items.length : 0) }} />
            <span>{t('batchProgress', [String(done), String(items.length)])}</span>
          </div>
          <ul class="lines">
            {items.map((i, n) => (
              <li key={i.id} class={`line line--${i.status}`} style={{ animationDelay: `${Math.min(n, 12) * 30}ms` }}>
                <span class="line__icon" aria-hidden="true">
                  <Icon name={STATUS_ICON[i.status]} size={16} />
                </span>
                <span class="line__text">
                  <span class="line__title">{i.title || i.url}</span>
                  <span class="line__meta">
                    {t(`batch_${i.status}`)}
                    {i.error ? ` — ${t(`batchErr_${i.error}`)}` : ''}
                    {i.title ? `, ${i.url}` : ''}
                  </span>
                </span>
                <span class="line__tools">
                  {i.status === 'failed' && (
                    <button class="hcard__btn" title={t('retry')} aria-label={t('retry')} onClick={() => send({ type: 'batch-retry', id: i.id })}>
                      <Icon name="retry" size={15} />
                    </button>
                  )}
                  <button class="hcard__btn" title={t('historyRemove')} aria-label={t('historyRemove')} onClick={() => send({ type: 'batch-remove', id: i.id })}>
                    <Icon name="close" size={15} />
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
