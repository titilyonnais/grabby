import { useState } from 'preact/hooks';
import { AUDIO_FORMATS, FORMAT_NAMES, isAudioFormat } from '../../shared/formats';
import type { PopupToBg } from '../../shared/messages';
import type { OutputFormat } from '../../shared/plan';
import { LIST_DEFAULT, LIST_QUALITIES, type YtList } from '../../shared/ytlist';
import { t } from '../i18n';
import { Icon } from './Icon';
import { Select } from './Select';
import { Follow } from './Follow';

const LIST_VIDEO = ['mp4', 'webm', 'mkv'] as const;

/**
 * A YouTube playlist or channel: every video it shows, in one quality and one format, each
 * one recorded like a single video (two at a time), numbered in the list's order.
 */
export function Playlist({
  list,
  preferred,
  send,
  compact,
  pageUrl,
}: {
  list: YtList;
  /** The page it is on (followed from there). */
  pageUrl?: string;
  preferred: { video: OutputFormat; audio: OutputFormat };
  send: (m: PopupToBg) => void;
  /** Under the video being watched: one line, opened on demand. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  const [quality, setQuality] = useState<string>(LIST_DEFAULT);
  const [format, setFormat] = useState<OutputFormat>((LIST_VIDEO as readonly string[]).includes(preferred.video) ? preferred.video : 'mp4');
  const [sent, setSent] = useState(false);
  const audio = isAudioFormat(format);
  const count = list.entries.length;
  const go = () => {
    send({ type: 'download-list', quality, mode: audio ? 'audio' : 'video', format });
    setSent(true);
  };
  const head = (
    <div class="ylist__head">
      <span class="ylist__icon">
        <Icon name="list" size={18} />
      </span>
      <span class="ylist__text">
        <span id="ylist-title" class="ylist__title" title={list.title}>
          {list.title}
        </span>
        <span class="ylist__meta">{t(list.kind === 'channel' ? 'listChannel' : 'listPlaylist', String(count))}</span>
      </span>
      {compact && (
        <button class="btn btn--soft btn--small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t('listLess') : t('listMore')}
        </button>
      )}
    </div>
  );
  if (!open) {
    return (
      <section class="ylist ylist--compact" aria-labelledby="ylist-title">
        {head}
      </section>
    );
  }
  return (
    <section class={`ylist${compact ? ' ylist--compact' : ''}`} aria-labelledby="ylist-title">
      {head}
      <div class="bulk__row">
        <Select
          label={t('formatLabel')}
          value={format}
          options={[
            ...LIST_VIDEO.map((f) => ({ value: f as OutputFormat, label: FORMAT_NAMES[f], detail: t(`fmt_${f}`), group: t('fmt_group_video') })),
            ...AUDIO_FORMATS.map((f) => ({ value: f as OutputFormat, label: FORMAT_NAMES[f], detail: t(`fmt_${f}`), group: t('fmt_group_audio') })),
          ]}
          onChange={(f) => {
            setFormat(f);
            setSent(false);
          }}
        />
        {!audio && (
          <Select
            label={t('qualityLabel')}
            value={quality}
            options={LIST_QUALITIES.map((q) => ({ value: q.id, label: q.label }))}
            onChange={(q) => {
              setQuality(q);
              setSent(false);
            }}
          />
        )}
      </div>
      <button class="btn btn--primary btn--wide" disabled={sent} onClick={go}>
        <Icon name={sent ? 'check' : 'download'} />
        {sent ? t('listQueued', String(count)) : t('listGo', String(count))}
      </button>
      <p class="hint">{t('listHint')}</p>
      {pageUrl && (
        <Follow
          url={pageUrl}
          mode={audio ? 'audio' : 'video'}
          quality={quality}
          format={format}
          label={t(list.kind === 'channel' ? 'followChannel' : 'followPlaylist')}
        />
      )}
    </section>
  );
}
