import { AUDIO_FORMATS, FORMAT_NAMES, isAudioFormat, VIDEO_FORMATS } from '../../shared/formats';
import type { PopupToBg } from '../../shared/messages';
import type { OutputFormat } from '../../shared/plan';
import type { MediaItem } from '../../shared/types';
import { t } from '../i18n';
import { Icon } from './Icon';
import { Select } from './Select';

/** What "download all" can take: free videos that don't need to be played to be recorded. */
export const bulkable = (i: MediaItem): boolean => i.protection === 'none' && !i.live && (i.kind !== 'capture' || !!i.ytId);

/** Above the list: how many videos there are, and the way into "download all". */
export function BulkStart({ count, onStart }: { count: number; onStart: () => void }) {
  return (
    <div class="bulkbar">
      <span>{t('bulkCount', String(count))}</span>
      <button class="btn btn--soft btn--small" onClick={onStart}>
        <Icon name="check" size={14} />
        {t('bulkAll')}
      </button>
    </div>
  );
}

interface BarProps {
  items: MediaItem[];
  picked: string[];
  format: OutputFormat;
  onFormat: (f: OutputFormat) => void;
  onCancel: () => void;
  onAll: () => void;
  send: (m: PopupToBg) => void;
}

/** At the bottom while choosing: one format for all, then off they go (two at a time). */
export function BulkBar({ items, picked, format, onFormat, onCancel, onAll, send }: BarProps) {
  const audio = isAudioFormat(format);
  const go = () => {
    for (const i of items.filter((x) => picked.includes(x.id))) {
      // A sound file stays a sound file (in the preferred audio format when a video one was chosen).
      const asAudio = audio || !!i.audioOnly;
      send({
        type: 'download',
        mediaId: i.id,
        mode: asAudio ? 'audio' : 'video',
        ...(i.variants[0] && !asAudio ? { variantId: i.variants[0].id } : {}),
        ...(asAudio === audio ? { format } : {}),
      });
    }
    onCancel();
  };
  return (
    <div class="bulk" role="region" aria-label={t('bulkAll')}>
      <div class="bulk__row">
        <button class="link-btn" onClick={onAll}>
          {picked.length === items.length ? t('bulkNone') : t('bulkEvery')}
        </button>
        <span class="bulk__hint">{t('bulkHint')}</span>
      </div>
      <div class="bulk__row">
        <Select
          label={t('formatLabel')}
          value={format}
          options={[
            ...VIDEO_FORMATS.map((f) => ({ value: f as OutputFormat, label: FORMAT_NAMES[f], detail: t(`fmt_${f}`), group: t('fmt_group_video') })),
            ...AUDIO_FORMATS.map((f) => ({ value: f as OutputFormat, label: FORMAT_NAMES[f], detail: t(`fmt_${f}`), group: t('fmt_group_audio') })),
          ]}
          onChange={onFormat}
        />
        <button class="btn btn--soft btn--icon" title={t('cancel')} aria-label={t('cancel')} onClick={onCancel}>
          <Icon name="close" />
        </button>
      </div>
      <button class="btn btn--primary btn--wide" disabled={!picked.length} onClick={go}>
        <Icon name="download" />
        {t('bulkGo', String(picked.length))}
      </button>
    </div>
  );
}
