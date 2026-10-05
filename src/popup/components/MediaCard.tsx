import { useEffect, useState } from 'preact/hooks';
import { audioChoices } from '../../shared/audio';
import { canClip } from '../../shared/clip';
import { formatDuration } from '../../shared/format';
import { SUB_CODEC } from '../../shared/subtitles';
import { AUDIO_FORMATS, CHAPTER_FORMATS, FORMAT_NAMES, IMAGE_FORMATS, isAudioFormat, isImageFormat, videoFormatsFor } from '../../shared/formats';
import type { DownloadExtra, PopupToBg } from '../../shared/messages';
import type { AudioFormat, Clip, OutputFormat, VideoFormat } from '../../shared/plan';
import { canShrink, scaleChoices, SHRUNK_FORMATS } from '../../shared/scale';
import type { Job, MediaItem, Variant } from '../../shared/types';
import { size, t, uiLang } from '../i18n';
import { useUnfold } from '../unfold';
import { Icon } from './Icon';
import { canPause, isActive, JobBar } from './JobBar';
import { Select, type SelectOption } from './Select';
import { Moment, Trim } from './Trim';

/** The longest animated picture (GIF, WebP), in seconds. */
const MAX_ANIMATION = 30;

interface Props {
  item: MediaItem;
  job?: Job;
  /**
   * The open card is the big one (full-width thumbnail and its choices); the others are
   * compact rows. One open card at a time.
   */
  open: boolean;
  onToggle: () => void;
  /** Position in the list: cards arrive one after the other. */
  index: number;
  /** The user's preferred outputs (settings). */
  preferred: { video: VideoFormat; audio: AudioFormat };
  send: (m: PopupToBg) => void;
  /** "Download all": the card is a row with a round tick instead of its choices. */
  select?: { on: boolean; toggle: () => void } | undefined;
}

/** Expected size of a quality: told by the source, else estimated from its bitrate. */
function variantSize(v: Variant, format: OutputFormat, duration?: number): number | undefined {
  const told = v.sizes?.[format as VideoFormat] ?? v.size;
  if (told) return told;
  return v.bandwidth && duration ? Math.round((v.bandwidth * duration) / 8) : undefined;
}

/** Rough bitrate of a shrunk picture (H.264, CRF 24), to tell the expected size. */
const SHRUNK_BPS: Record<number, number> = { 144: 150e3, 240: 300e3, 360: 600e3, 480: 1e6, 720: 2.2e6, 1080: 4.5e6, 1440: 8e6 };
const SCALE_PREFIX = 'scale:';

/** "fr" → "French" (in the browser's language), for tracks the site names by their code only. */
function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([uiLang()], { type: 'language' }).of(code);
    return name ? name[0]!.toLocaleUpperCase() + name.slice(1) : code;
  } catch {
    return code;
  }
}

function Thumb({ item }: { item: MediaItem }) {
  const [broken, setBroken] = useState(false);
  return (
    <div class="thumb">
      {item.thumbnail && !broken ? (
        <img src={item.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <Icon name={item.audioOnly ? 'audio' : 'film'} size={24} />
      )}
      {item.duration ? <span class="thumb__time">{formatDuration(item.duration)}</span> : null}
    </div>
  );
}

export function MediaCard({ item, job, open: wantOpen, onToggle: toggleOpen, index, preferred, send, select }: Props) {
  const open = wantOpen && !select;
  const onToggle = select ? select.toggle : toggleOpen;
  const card = useUnfold<HTMLElement>(open);
  // A quality the source offers (its id), or a smaller one Grabby makes ("scale:360").
  const [quality, setQuality] = useState<string | undefined>(item.variants[0]?.id);
  const shrinkTo = canShrink(item) ? scaleChoices(item.variants) : [];
  const scale = quality?.startsWith(SCALE_PREFIX) ? Number(quality.slice(SCALE_PREFIX.length)) : undefined;
  const variantId = scale ? undefined : quality;
  const videoFormats = item.audioOnly ? [] : scale ? SHRUNK_FORMATS : (item.formats ?? videoFormatsFor(''));
  const initial: OutputFormat = item.audioOnly
    ? preferred.audio
    : videoFormats.includes(preferred.video)
      ? preferred.video
      : (videoFormats[0] ?? preferred.audio);
  const [format, setFormat] = useState<OutputFormat>(initial);
  // "Couper un extrait": the panel, and the parts chosen in it (null: the whole video), joined
  // in one file or saved one by one.
  const [trimming, setTrimming] = useState(false);
  const [parts, setParts] = useState<Clip[] | null>(null);
  const [joined, setJoined] = useState(true);
  const clippable = canClip(item);
  // Subtitles: none, or some of the stream's tracks, put in the video or saved next to it.
  const [subsIds, setSubsIds] = useState<string[]>([]);
  const [subsApart, setSubsApart] = useState(false);
  // Sound tracks (other languages), when the stream has several: null, its own choice.
  const choices = audioChoices(item);
  const [audioIds, setAudioIds] = useState<string[] | null>(null);
  const [chapters, setChapters] = useState(true);
  // A still picture: where in the video.
  const [at, setAt] = useState(0);
  const image = isImageFormat(format);
  const whole = (c: Clip) => !!item.duration && c.start <= 0 && c.end >= Math.floor(item.duration);
  const chosen = trimming && parts ? parts.filter((c) => !whole(c) || parts.length > 1) : [];
  const cut = chosen.length === 1 ? chosen[0]! : null;
  // A format the chosen quality can't go in (WebM for a shrunk picture, MOV back on a VP9
  // source): back to the preferred one, so what is shown is what gets sent.
  const formatOk = isAudioFormat(format) || (isImageFormat(format) && !item.audioOnly) || videoFormats.includes(format as VideoFormat);
  useEffect(() => {
    if (!formatOk) setFormat(videoFormats.includes(preferred.video) ? preferred.video : (videoFormats[0] ?? preferred.audio));
  }, [formatOk]);
  const audio = isAudioFormat(format);
  const variant = item.variants.find((v) => v.id === variantId) ?? item.variants[0];
  const shrunkSize = (lines: number) =>
    item.duration ? Math.round((((SHRUNK_BPS[lines] ?? 1e6) + 128e3) * item.duration) / 8) : undefined;
  // Size of what will actually be saved, when the source tells (YouTube: per quality and format).
  const wholeSize =
    (!audio && scale && shrunkSize(scale)) || (!audio && variant && variantSize(variant, format, item.duration)) || item.size;
  // Parts weigh their share of the whole.
  const kept = chosen.reduce((n, c) => n + (c.end - c.start), 0);
  const shownSize = image ? undefined : chosen.length && wholeSize ? Math.round((wholeSize * kept) / item.duration!) : wholeSize;
  // YouTube: a hidden player records it, the user keeps watching — it's a plain download for them.
  const hidden = !!item.ytId;
  const blocked = item.protection !== 'none' || item.live;
  const kind = item.audioOnly ? t('kind_audio') : t(`kind_${item.kind}`);
  const single = item.variants.length === 1 ? item.variants[0]!.label : '';
  const showJob = job && (isActive(job) || ['done', 'error', 'canceled'].includes(job.status));
  const running = isActive(job);

  const qualityOptions: SelectOption<string>[] = [
    ...item.variants.map((v) => {
      const bytes = variantSize(v, format, item.duration);
      return { value: v.id, label: v.label, ...(bytes ? { detail: size(bytes) } : {}), ...(shrinkTo.length ? { group: t('quality_group_source') } : {}) };
    }),
    ...(image ? [] : shrinkTo).map((lines) => {
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
    // Pictures made from the video.
    ...(item.audioOnly ? [] : IMAGE_FORMATS.map((f) => ({ value: f, label: FORMAT_NAMES[f], detail: t(`fmt_${f}`), group: t('fmt_group_image') }))),
  ];

  const subsOffered = !!item.subtitles?.length && !audio && !image;
  // MPEG-TS and AVI hold no subtitles: they can only go next to the video.
  const subsMustApart = !SUB_CODEC[scale && format === 'webm' ? 'mp4' : format];
  const subs = subsOffered && subsIds.length ? { ids: subsIds, separate: subsApart || subsMustApart } : null;
  const subsOptions: SelectOption<string>[] = (item.subtitles ?? []).map((s) => {
    const name = s.label === s.lang ? languageName(s.lang) : s.label;
    // Translated by YouTube: the language it becomes, from the one it comes from.
    const label = s.tlang ? t('subsTranslated', [languageName(s.tlang), name]) : s.forced ? `${name} (${t('subsForced')})` : name;
    return { value: s.id, label, ...(s.tlang ? { detail: s.tlang } : s.lang && s.lang !== name ? { detail: s.lang } : {}) };
  });
  const subsSummary = !subsIds.length
    ? t('subsNone')
    : subsIds.length === 1
      ? (subsOptions.find((o) => o.value === subsIds[0])?.label ?? '')
      : t('subsCount', String(subsIds.length));
  const toggleSub = (id: string) => setSubsIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  // Sound tracks: the stream's default first when nothing was chosen.
  const audiosOffered = choices.length > 1 && !image;
  const audioSel = audioIds ?? [(choices.find((c) => c.isDefault) ?? choices[0])?.id ?? ''];
  const audioOptions: SelectOption<string>[] = choices.map((c) => ({
    value: c.id,
    label: c.lang && (c.label === c.lang || !c.label) ? languageName(c.lang) : c.label,
    ...(c.lang ? { detail: c.lang } : {}),
  }));
  const audioSummary =
    audioSel.length === 1 ? (audioOptions.find((o) => o.value === audioSel[0])?.label ?? '') : t('audioCount', String(audioSel.length));
  // One stays: the sound of the video can't be taken away here.
  const toggleAudio = (id: string) => setAudioIds(audioSel.includes(id) ? (audioSel.length > 1 ? audioSel.filter((x) => x !== id) : audioSel) : [...audioSel, id]);
  const chaptersOffered = !!item.chapters?.length && !image && CHAPTER_FORMATS.has(format);

  const start = () => {
    const base = {
      type: 'download' as const,
      mediaId: item.id,
      mode: audio ? ('audio' as const) : ('video' as const),
      ...(!audio && variantId ? { variantId } : {}),
      format,
    };
    const extra: DownloadExtra = {
      ...(!audio && !image && scale ? { scale } : {}),
      ...(subs ? { subtitles: subs } : {}),
      ...(audiosOffered && audioIds ? { audios: audio ? audioSel.slice(0, 1) : audioSel } : {}),
      ...(chaptersOffered && !chapters ? { noChapters: true } : {}),
    };
    if (format === 'jpg') return send({ ...base, at });
    if (image) return send({ ...base, clip: parts?.[0] ?? { start: 0, end: Math.min(item.duration ?? 5, 5) } });
    // Several parts: one file with all of them, or one file each.
    if (chosen.length > 1 && !joined) {
      for (const clip of chosen) send({ ...base, ...extra, clip });
      return;
    }
    send({ ...base, ...extra, ...(chosen.length > 1 ? { parts: chosen } : cut ? { clip: cut } : {}) });
  };
  const buttonLabel =
    format === 'jpg'
      ? t('saveStill')
      : image
        ? t('saveAnimation')
        : chosen.length > 1
          ? t(joined ? 'downloadParts' : 'downloadPartsApart', String(chosen.length))
          : item.kind === 'capture' && !hidden
            ? cut
              ? t('captureClip')
              : t('capture')
            : cut
              ? t('downloadClip')
              : t('download');

  return (
    <article
      ref={card}
      class={`card${open ? ' card--open' : ''}${blocked ? ' card--blocked' : ''}${select?.on ? ' card--picked' : ''}`}
      style={{ '--i': String(Math.min(index, 8)) }}
    >
      {/* The whole head opens or closes the card; the chevron is its keyboard handle. */}
      <div class="card__head" onClick={onToggle}>
        <Thumb item={item} />
        <div class="card__body">
          <h2 class="card__title" title={item.title}>
            {item.title}
          </h2>
          <p class="card__meta">
            <span class="tag">{kind}</span>
            {single && <span>{single}</span>}
            {running && !open ? (
              <span class="card__pct">
                {job!.status === 'paused' ? `${t('st_paused')} · ` : ''}
                {Math.round(job!.progress * 100)} %
              </span>
            ) : shownSize ? (
              // Keyed: another quality's size rises into place.
              <span key={shownSize} class="swap">
                {size(shownSize)}
              </span>
            ) : null}
            {blocked && !open && <Icon name={item.live ? 'live' : 'lock'} size={14} />}
          </p>
          {/* A download running in a row: its bar under the text, not over the layout. */}
          {running && !open && <span class="card__progress" style={{ '--p': String(job!.progress) }} aria-hidden="true" />}
        </div>
        <span class="card__tools">
          {select && (
            <button
              class="pick"
              role="checkbox"
              aria-checked={select.on}
              aria-label={item.title}
              onClick={(e) => {
                e.stopPropagation();
                select.toggle();
              }}
            >
              <Icon name="check" size={14} />
            </button>
          )}
          {!select && running && !open && (job!.status === 'paused' || canPause(job!)) && (
            <button
              class="card__cancel"
              aria-label={job!.status === 'paused' ? t('resume') : t('pause')}
              title={job!.status === 'paused' ? t('resume') : t('pause')}
              onClick={(e) => {
                e.stopPropagation();
                send({ type: job!.status === 'paused' ? 'resume' : 'pause', jobId: job!.id });
              }}
            >
              <Icon name={job!.status === 'paused' ? 'play' : 'pause'} size={16} />
            </button>
          )}
          {!select && running && !open && (
            <button
              class="card__cancel"
              aria-label={t('cancel')}
              title={t('cancel')}
              onClick={(e) => {
                e.stopPropagation();
                send({ type: 'cancel', jobId: job!.id });
              }}
            >
              <Icon name="close" size={16} />
            </button>
          )}
          {!select && (
            <button
              class="card__toggle"
              aria-expanded={open}
              aria-label={open ? t('hideOptions') : t('showOptions')}
              title={open ? t('hideOptions') : t('showOptions')}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              <Icon name="chevron" size={18} />
            </button>
          )}
        </span>
      </div>

      {open && (
        <div class="card__drawer">
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
            <>
              {!showJob && (
                <div class="pickers">
                  {qualityOptions.length > 1 && (
                    <Select label={t('qualityLabel')} value={quality ?? ''} options={qualityOptions} onChange={setQuality} disabled={audio} />
                  )}
                  <Select label={t('formatLabel')} value={format} options={formatOptions} onChange={setFormat} />
                </div>
              )}
              {!showJob && audiosOffered && (
                <Select label={t('audioLabel')} value="" values={audioSel} summary={audioSummary} options={audioOptions} onChange={toggleAudio} />
              )}
              {!showJob && subsOffered && (
                <div class="subs">
                  <Select label={t('subsLabel')} value="" values={subsIds} summary={subsSummary} options={subsOptions} onChange={toggleSub} />
                  {subsIds.length > 0 && (
                    <label class="subs__apart">
                      <span>{t('subsApart')}</span>
                      <input
                        class="switch"
                        type="checkbox"
                        role="switch"
                        checked={subsApart || subsMustApart}
                        disabled={subsMustApart}
                        onChange={(e) => setSubsApart(e.currentTarget.checked)}
                      />
                    </label>
                  )}
                  {subsIds.length > 0 && subsMustApart && <p class="hint">{t('subsApartHint')}</p>}
                </div>
              )}
              {!showJob && chaptersOffered && (
                <label class="option">
                  <span>
                    {t('chaptersLabel')}
                    <span class="option__detail">{t('chaptersCount', String(item.chapters!.length))}</span>
                  </span>
                  <input class="switch" type="checkbox" role="switch" checked={chapters} onChange={(e) => setChapters(e.currentTarget.checked)} />
                </label>
              )}
              {!showJob && format === 'jpg' && <Moment duration={item.duration ?? 1} at={at} onChange={setAt} />}
              {!showJob && image && format !== 'jpg' && clippable && (
                <Trim key="animation" duration={item.duration!} parts={parts} onChange={setParts} single={{ max: MAX_ANIMATION }} />
              )}
              {!showJob && clippable && !image && (
                <button class="trim-toggle" aria-expanded={trimming} onClick={() => setTrimming((v) => !v)}>
                  <Icon name={trimming ? 'close' : 'scissors'} size={16} />
                  {trimming ? t('trimWhole') : t('trimOpen')}
                </button>
              )}
              {!showJob && clippable && trimming && !image && <Trim key="parts" duration={item.duration!} parts={parts} onChange={setParts} />}
              {!showJob && chosen.length > 1 && !image && (
                <label class="option">
                  <span>{t('partsJoined')}</span>
                  <input class="switch" type="checkbox" role="switch" checked={joined} onChange={(e) => setJoined(e.currentTarget.checked)} />
                </label>
              )}
              {showJob ? (
                <>
                  <JobBar job={job} send={send} />
                  {job.raw && isActive(job) && <p class="hint">{t('rawNotice')}</p>}
                </>
              ) : (
                <button class="btn btn--primary btn--wide" onClick={start}>
                  <Icon name={image ? 'image' : item.kind === 'capture' && !hidden ? 'record' : audio ? 'audio' : 'download'} />
                  {buttonLabel}
                </button>
              )}
              {item.kind === 'capture' && !showJob && <p class="hint">{t(hidden ? 'hiddenHint' : 'captureHint')}</p>}
              {scale && !audio && !image && !showJob && <p class="hint">{t('shrinkHint')}</p>}
              {chosen.length > 0 && !audio && !image && !showJob && <p class="hint">{t('trimHint')}</p>}
              {image && !showJob && <p class="hint">{t(format === 'jpg' ? 'stillHint' : 'animationHint')}</p>}
            </>
          )}
        </div>
      )}
    </article>
  );
}
