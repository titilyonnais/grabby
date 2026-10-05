import { useState } from 'preact/hooks';
import { AUDIO_FORMATS, FORMAT_NAMES, isAudioFormat } from '../../shared/formats';
import type { PopupToBg } from '../../shared/messages';
import type { OutputFormat } from '../../shared/plan';
import type { Release } from '../../shared/release';
import { LIST_QUALITIES, type YtList } from '../../shared/ytlist';
import { t } from '../i18n';
import { Icon } from './Icon';
import { Select } from './Select';

const LIST_VIDEO = ['mp4', 'webm', 'mkv'] as const;

/**
 * A YouTube playlist or channel: every video it shows, in one quality and one format, each
 * one recorded like a single video (two at a time), numbered in the list's order.
 */
export function Playlist({ list, preferred, send }: { list: YtList; preferred: { video: OutputFormat; audio: OutputFormat }; send: (m: PopupToBg) => void }) {
  const [quality, setQuality] = useState<string>(LIST_QUALITIES[0].id);
  const [format, setFormat] = useState<OutputFormat>((LIST_VIDEO as readonly string[]).includes(preferred.video) ? preferred.video : 'mp4');
  const [sent, setSent] = useState(false);
  const audio = isAudioFormat(format);
  const count = list.entries.length;
  const go = () => {
    send({ type: 'download-list', quality, mode: audio ? 'audio' : 'video', format });
    setSent(true);
  };
  return (
    <section class="ylist" aria-labelledby="ylist-title">
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
      </div>
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
    </section>
  );
}

/** "Grabby x.y is out", with a link to its page; closed until the next version. */
export function UpdateNotice({ release, send }: { release: Release; send: (m: PopupToBg) => void }) {
  return (
    <div class="help update" role="status">
      <span class="help__icon">
        <Icon name="gift" size={16} />
      </span>
      <div class="help__text">
        <p class="help__title">{t('updateTitle', release.version)}</p>
        <p class="help__body">{t('updateBody')}</p>
        <span class="update__actions">
          <a class="btn btn--soft btn--small" href={release.url} target="_blank" rel="noreferrer noopener">
            {t('updateOpen')}
            <Icon name="external" size={14} />
          </a>
          <button class="link-btn" onClick={() => send({ type: 'update-seen', version: release.version })}>
            {t('dismiss')}
          </button>
        </span>
      </div>
    </div>
  );
}
