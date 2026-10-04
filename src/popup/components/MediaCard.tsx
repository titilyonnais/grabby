import { useEffect, useState } from 'preact/hooks';
import { formatDuration } from '../../shared/format';
import type { PopupToBg } from '../../shared/messages';
import { AUDIO_FORMATS, FORMAT_NAMES, isAudioFormat, videoFormatsFor } from '../../shared/formats';
import type { AudioFormat, OutputFormat, VideoFormat } from '../../shared/plan';
import { canShrink, scaleChoices } from '../../shared/scale';
import type { Job, MediaItem, Variant } from '../../shared/types';
import { size, t } from '../i18n';
import { Icon } from './Icon';
import { isActive, JobBar } from './JobBar';
import { Select, type SelectOption } from './Select';

interface Props {
  item: MediaItem;
  job?: Job;
  hero: boolean;
  /** The user's preferred outputs (settings). */
  preferred: { video: VideoFormat; audio: AudioFormat };
  send: (m: PopupToBg) => void;
}

/** Expected size of a quality: told by the source, else estimated from its bitrate. */
function variantSize(v: Variant, format: OutputFormat, duration?: number): number | undefined {
  const told = v.sizes?.[format as VideoFormat] ?? v.size;
  if (told) return told;
  return v.bandwidth && duration ? Math.round((v.bandwidth * duration) / 8) : undefined;
}

/** Shrunk H.264 goes in any of these (not WebM), whatever the source's codec. */
const SHRUNK_FORMATS: VideoFormat[] = ['mp4', 'mkv', 'mov', 'avi', 'ts'];

/** Rough bitrate of a shrunk picture (H.264, CRF 24), to tell the expected size. */
const SHRUNK_BPS: Record<number, number> = { 144: 150e3, 240: 300e3, 360: 600e3, 480: 1e6, 720: 2.2e6, 1080: 4.5e6, 1440: 8e6 };
const SCALE_PREFIX = 'scale:';

function Thumb({ item, hero }: { item: MediaItem; hero: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <div class={`thumb${hero ? ' thumb--hero' : ''}`}>
      {item.thumbnail && !broken ? (
        <img src={item.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <Icon name={item.audioOnly ? 'audio' : 'film'} size={hero ? 28 : 20} />
      )}
      {item.duration ? <span class="thumb__time">{formatDuration(item.duration)}</span> : null}
    </div>
  );
}

export function MediaCard({ item, job, hero, preferred, send }: Props) {
  // A quality the source offers (its id), or a smaller one Grabby makes ("scale:360").
  const [quality, setQuality] = useState<string | undefined>(item.variants[0]?.id);
  const shrinkTo = canShrink(item) ? scaleChoices(item.variants) : [];
  const scale = quality?.startsWith(SCALE_PREFIX) ? Number(quality.slice(SCALE_PREFIX.length)) : undefined;
  const variantId = scale ? undefined : quality;
  const videoFormats = item.audioOnly ? [] : scale ? SHRUNK_FORMATS : (item.formats ?? videoFormatsFor(''));
  const initial: OutputFormat = item.audioOnly ? preferred.audio : videoFormats.includes(preferred.video) ? preferred.video : (videoFormats[0] ?? preferred.audio);
  const [format, setFormat] = useState<OutputFormat>(initial);
  // WebM can't hold a shrunk picture: MP4 instead.
  useEffect(() => {
    if (scale && !isAudioFormat(format) && !SHRUNK_FORMATS.includes(format as VideoFormat)) setFormat('mp4');
  }, [scale, format]);
  const audio = isAudioFormat(format);
  const variant = item.variants.find((v) => v.id === variantId) ?? item.variants[0];
  // Size of what will actually be saved, when the source tells (YouTube: per quality and format).
  const shrunkSize = (lines: number) =>
    item.duration ? Math.round(((SHRUNK_BPS[lines] ?? 1e6) + 128e3) * item.duration / 8) : undefined;
  const shownSize = (!audio && scale && shrunkSize(scale)) || (!audio && variant && variantSize(variant, format, item.duration)) || item.size;
  // YouTube: a hidden player records it, the user keeps watching — it's a plain download for them.
  const hidden = !!item.ytId;
  const blocked = item.protection !== 'none' || item.live;
  const kind = item.audioOnly ? t('kind_audio') : t(`kind_${item.kind}`);
  const single = item.variants.length === 1 ? item.variants[0]!.label : '';
  const showJob = job && (isActive(job) || ['done', 'error', 'canceled'].includes(job.status));

  const qualityOptions: SelectOption<string>[] = [
    ...item.variants.map((v) => {
      const bytes = variantSize(v, format, item.duration);
      return { value: v.id, label: v.label, ...(bytes ? { detail: size(bytes) } : {}), ...(shrinkTo.length ? { group: t('quality_group_source') } : {}) };
    }),
    ...shrinkTo.map((lines) => {
      const bytes = shrunkSize(lines);
      return { value: `${SCALE_PREFIX}${lines}`, label: `${lines}p`, detail: bytes ? `≈ ${size(bytes)}` : t('quality_shrunk'), group: t('quality_group_shrink') };
    }),
  ];
  const formatOptions: SelectOption<OutputFormat>[] = [
    ...videoFormats.map((f) => {
      const bytes = variant?.sizes?.[f];
      return { value: f, label: FORMAT_NAMES[f], detail: bytes ? size(bytes) : t(`fmt_${f}`), group: t('fmt_group_video') };
    }),
    ...AUDIO_FORMATS.map((f) => ({ value: f, label: FORMAT_NAMES[f], detail: t(`fmt_${f}`), group: t('fmt_group_audio') })),
  ];

  const start = () =>
    send({
      type: 'download',
      mediaId: item.id,
      mode: audio ? 'audio' : 'video',
      ...(!audio && variantId ? { variantId } : {}),
      ...(!audio && scale ? { scale } : {}),
      format,
    });

  return (
    <article class={`card${hero ? ' card--hero' : ''}${blocked ? ' card--blocked' : ''}`}>
      <Thumb item={item} hero={hero} />
      <div class="card__body">
        <h2 class="card__title" title={item.title}>
          {item.title}
        </h2>
        <p class="card__meta">
          <span class="tag">{kind}</span>
          {item.experimental && <span class="tag tag--accent">{t('experimental')}</span>}
          {single && <span>{single}</span>}
          {shownSize ? <span>{size(shownSize)}</span> : null}
        </p>
      </div>

      {item.protection !== 'none' ? (
        <p class="notice">
          <Icon name="lock" size={16} />
          {t('protectedBody')}
        </p>
      ) : item.live ? (
        <p class="notice">
          <Icon name="live" size={16} />
          {t('liveBody')}
        </p>
      ) : (
        <div class="card__actions">
          {!showJob && (
            <div class="pickers">
              {qualityOptions.length > 1 && (
                <Select label={t('qualityLabel')} value={quality ?? ''} options={qualityOptions} onChange={setQuality} disabled={audio} />
              )}
              <Select label={t('formatLabel')} value={format} options={formatOptions} onChange={setFormat} />
            </div>
          )}

          {showJob ? (
            <>
              <JobBar job={job} send={send} canFinish={!job.hidden} />
              {job.raw && isActive(job) && <p class="hint">{t('rawNotice')}</p>}
            </>
          ) : (
            <div class="row">
              <button class="pill pill--grow" onClick={start}>
                <Icon name={item.kind === 'capture' && !hidden ? 'record' : audio ? 'audio' : 'download'} />
                {item.kind === 'capture' && !hidden ? t('capture') : t('download')}
              </button>
            </div>
          )}
          {item.kind === 'capture' && !showJob && hero && <p class="hint">{t(hidden ? 'hiddenHint' : 'captureHint')}</p>}
          {scale && !audio && !showJob && <p class="hint">{t('shrinkHint')}</p>}
        </div>
      )}
    </article>
  );
}
