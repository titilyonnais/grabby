import { useEffect, useState } from 'preact/hooks';
import { audioChoices } from '../../shared/audio';
import { canClip } from '../../shared/clip';
import { formatDuration } from '../../shared/format';
import { SUB_CODEC } from '../../shared/subtitles';
import { languageName as baseLanguageName, subtitleChoices, subWordsFrom } from '../../shared/sublabels';
import { AUDIO_FORMATS, CHAPTER_FORMATS, FORMAT_NAMES, IMAGE_FORMATS, isAudioFormat, isImageFormat, videoFormatsFor } from '../../shared/formats';
import type { DownloadExtra, PopupToBg } from '../../shared/messages';
import type { AudioFormat, Clip, OutputFormat, VideoFormat } from '../../shared/plan';
import { canShrink, scaleChoices, SHRUNK_FORMATS } from '../../shared/scale';
import { applyRule, ruleFor, type Rule } from '../../shared/rules';
import { SHEET_EVERY, sheetCount } from '../../shared/sheet';
import type { Job, MediaItem, Variant } from '../../shared/types';
import { size, t, uiLang } from '../i18n';
import { useUnfold } from '../unfold';
import { Icon } from './Icon';
import { canPause, isActive, JobBar } from './JobBar';
import { Segmented } from './Segmented';
import { Select, type SelectOption } from './Select';
import { Moment, Trim } from './Trim';
import { FinishPanel, finishCount } from './Finish';
import { Follow } from './Follow';
import type { Finish } from '../../shared/finish';

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
  /** The user's automatic rules: the site's one makes the first choices. */
  rules?: Rule[];
  /** The local AI: whether its models may be downloaded, and agreeing to it. */
  ai?: { allowed: boolean; allow: () => void };
}

/** How long a live stream may be recorded (minutes). */
const LIVE_LIMITS = [30, 60, 120, 240, 480, 720];

const isYouTube = (url: string) => /^https:\/\/(www\.|m\.)?youtube\.com\//.test(url);

/** The part chosen (or the whole video) played in the page's own player. */
function previewInPage(item: MediaItem, start: number, end?: number) {
  void chrome.tabs
    .sendMessage(item.tabId, { type: 'preview', videoIndex: item.videoIndex ?? -1, start, ...(end !== undefined ? { end } : {}) }, { frameId: item.frameId ?? 0 })
    .catch(() => {});
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

const languageName = (code: string) => baseLanguageName(code, uiLang());

function Thumb({ item }: { item: MediaItem }) {
  const [broken, setBroken] = useState(false);
  return (
    <div class="thumb">
      {item.thumbnail && !broken ? (
        <img src={item.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <Icon name={item.audioOnly ? 'audio' : 'film'} size={24} />
      )}
      {/* A live stream's length is only what the page holds for now: it says "live" instead. */}
      {item.live ? <span class="thumb__time thumb__time--live">{t('st_live')}</span> : item.duration ? <span class="thumb__time">{formatDuration(item.duration)}</span> : null}
    </div>
  );
}

export function MediaCard({ item, job, open: wantOpen, onToggle: toggleOpen, index, preferred, send, select, rules, ai }: Props) {
  // The site's rule: its quality, format and subtitles are chosen already (still changeable).
  const rule = ruleFor(rules, item.pageUrl);
  const ruled = rule ? applyRule(item, rule, preferred) : undefined;
  const open = wantOpen && !select;
  const onToggle = select ? select.toggle : toggleOpen;
  const card = useUnfold<HTMLElement>(open);
  // A quality the source offers (its id), or a smaller one Grabby makes ("scale:360").
  const [quality, setQuality] = useState<string | undefined>(ruled?.variantId ?? item.variants[0]?.id);
  const shrinkTo = canShrink(item) ? scaleChoices(item.variants) : [];
  const scale = quality?.startsWith(SCALE_PREFIX) ? Number(quality.slice(SCALE_PREFIX.length)) : undefined;
  const variantId = scale ? undefined : quality;
  const videoFormats = item.audioOnly ? [] : scale ? SHRUNK_FORMATS : (item.formats ?? videoFormatsFor(''));
  const initial: OutputFormat = ruled?.format && (ruled.mode === 'audio' || videoFormats.includes(ruled.format as VideoFormat))
    ? ruled.format
    : item.audioOnly
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
  const [subsIds, setSubsIds] = useState<string[]>(ruled?.subtitles ?? []);
  const [subsApart, setSubsApart] = useState(false);
  // Sound tracks (other languages), when the stream has several: null, its own choice.
  const choices = audioChoices(item);
  const [audioIds, setAudioIds] = useState<string[] | null>(null);
  const [chapters, setChapters] = useState(true);
  // A still picture: where in the video.
  const [at, setAt] = useState(0);
  // A JPEG: one picture of the video, a contact sheet of all of it, or its own thumbnail.
  const [still, setStill] = useState<'frame' | 'sheet' | 'thumb'>('frame');
  const [sheetEvery, setSheetEvery] = useState<number>(0);
  const [thumbSaved, setThumbSaved] = useState(false);
  // "Retouches et IA": what is done to the file afterwards.
  const [finishing, setFinishing] = useState(false);
  const [finish, setFinish] = useState<Finish>({});
  // A live stream: how long it may be recorded.
  const [liveMinutes, setLiveMinutes] = useState(120);
  // "Aperçu": a file plays here; anything else in the page's own player.
  const [previewing, setPreviewing] = useState(false);
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
  const blocked = item.protection !== 'none';
  const live = item.live && !blocked;
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
  // By language, in the browser's language: the video's own, automatic ones, YouTube's translations.
  const subsOptions: SelectOption<string>[] = subtitleChoices(item.subtitles ?? [], subWordsFrom(t), uiLang());
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
  // What a JPEG can be: a sheet needs the length, a thumbnail a picture of the video.
  const stills: ['frame' | 'sheet' | 'thumb', string][] = [
    ['frame', t('stillFrame')],
    ...(item.duration ? [['sheet', t('stillSheet')] as ['sheet', string]] : []),
    ...(item.ytId || item.thumbnail ? [['thumb', t('stillThumb')] as ['thumb', string]] : []),
  ];
  const stillKind = format === 'jpg' && stills.some(([k]) => k === still) ? still : 'frame';
  const sheetOptions: SelectOption<string>[] = SHEET_EVERY.map((s) => ({
    value: String(s),
    label: s === 0 ? t('sheetAuto') : s < 60 ? t('sheetSeconds', String(s)) : t('sheetMinutes', String(s / 60)),
    detail: t('sheetPictures', String(sheetCount(item.duration ?? 1, s))),
  }));

  // What the panel asks for (kept when it is folded: its button shows how many), without what
  // can't apply any more (no text to burn or sum up).
  const hasText = (subsOffered && subsIds.length > 0) || !!finish.transcribe;
  const finishSent: Finish | undefined = (() => {
    if (image) return undefined;
    const f: Finish = { ...finish };
    if (!hasText) {
      delete f.burn;
      delete f.summary;
    }
    if (!item.chapters?.length && !f.summary) delete f.split;
    if ((f.transcribe || f.translate) && !ai?.allowed) {
      delete f.transcribe;
      delete f.translate;
    }
    return finishCount(f) ? f : undefined;
  })();
  const previewSpan = { start: cut?.start ?? 0, ...(cut ? { end: cut.end } : {}) };
  const previewUrl = item.kind === 'file' ? (variant?.url || item.url) : '';
  const preview = () => {
    if (previewUrl) setPreviewing((v) => !v);
    else previewInPage(item, previewSpan.start, previewSpan.end);
  };

  const start = () => {
    const base = {
      type: 'download' as const,
      mediaId: item.id,
      mode: audio ? ('audio' as const) : ('video' as const),
      ...(!audio && variantId ? { variantId } : {}),
      format,
      ...(ruled?.folder ? { folder: ruled.folder } : {}),
    };
    const extra: DownloadExtra = {
      ...(finishSent ? { finish: finishSent } : {}),
      ...(!audio && !image && scale ? { scale } : {}),
      ...(subs ? { subtitles: subs } : {}),
      ...(audiosOffered && audioIds ? { audios: audio ? audioSel.slice(0, 1) : audioSel } : {}),
      ...(chaptersOffered && !chapters ? { noChapters: true } : {}),
    };
    if (live) return send({ ...base, ...(finishSent ? { finish: finishSent } : {}), live: liveMinutes });
    if (format === 'jpg' && stillKind === 'thumb') {
      setThumbSaved(true);
      return send({ type: 'save-thumb', mediaId: item.id });
    }
    if (format === 'jpg' && stillKind === 'sheet') return send({ ...base, sheet: sheetEvery });
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
      ? stillKind === 'sheet'
        ? t('saveSheet')
        : stillKind === 'thumb'
          ? t(thumbSaved ? 'thumbSaved' : 'saveThumb')
          : t('saveStill')
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
            {(blocked || live) && !open && <Icon name={live ? 'live' : 'lock'} size={14} />}
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
          ) : live && item.kind === 'dash' ? (
            <p class="notice">
              <Icon name="live" size={16} />
              {t('liveBody')}
            </p>
          ) : live ? (
            <>
              {!showJob && (
                <div class="pickers">
                  <Select label={t('formatLabel')} value={image ? preferred.video : format} options={formatOptions.filter((o) => !isImageFormat(o.value))} onChange={setFormat} />
                  <Select
                    label={t('liveLimit')}
                    value={String(liveMinutes)}
                    options={LIVE_LIMITS.map((m) => ({ value: String(m), label: m < 60 ? t('liveMinutes', String(m)) : t('liveHours', String(m / 60)) }))}
                    onChange={(v) => setLiveMinutes(Number(v))}
                  />
                </div>
              )}
              {!showJob && (
                <button class="trim-toggle" aria-expanded={finishing} onClick={() => setFinishing((v) => !v)}>
                  <Icon name={finishing ? 'close' : 'wand'} size={16} />
                  {finishing ? t('finishClose') : finishCount(finish) ? t('finishOpenCount', String(finishCount(finish))) : t('finishOpen')}
                </button>
              )}
              {!showJob && finishing && (
                <FinishPanel
                  value={finish}
                  onChange={setFinish}
                  audio={audio}
                  format={format}
                  {...(item.thumbnail ? { picture: item.thumbnail } : {})}
                  subsChosen={false}
                  chapters={0}
                  aiAllowed={!!ai?.allowed}
                  onAllowAi={() => ai?.allow()}
                />
              )}
              {showJob ? (
                <JobBar job={job} send={send} />
              ) : (
                <button class="btn btn--primary btn--wide" onClick={start}>
                  <Icon name="record" />
                  {t('liveRecord')}
                </button>
              )}
              {!showJob && <p class="hint">{t('liveHint')}</p>}
            </>
          ) : (
            <>
              {!showJob && (
                <div class="pickers">
                  {qualityOptions.length > 1 && !(format === 'jpg' && stillKind !== 'frame') && (
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
              {!showJob && format === 'jpg' && stills.length > 1 && (
                <div class="still-kind">
                  <Segmented
                    label={t('stillKind')}
                    value={stillKind}
                    options={stills}
                    onChange={(k) => {
                      setStill(k);
                      setThumbSaved(false);
                    }}
                  />
                </div>
              )}
              {!showJob && format === 'jpg' && stillKind === 'frame' && <Moment duration={item.duration ?? 1} at={at} onChange={setAt} />}
              {!showJob && format === 'jpg' && stillKind === 'sheet' && (
                <Select label={t('sheetEvery')} value={String(sheetEvery)} options={sheetOptions} onChange={(v) => setSheetEvery(Number(v))} />
              )}
              {!showJob && image && format !== 'jpg' && clippable && (
                <Trim key="animation" duration={item.duration!} parts={parts} onChange={setParts} single={{ max: MAX_ANIMATION }} />
              )}
              {!showJob && !image && (clippable || previewUrl || item.kind === 'capture' || item.videoIndex !== undefined) && (
                <div class="card__actions">
                  {clippable && (
                    <button class="trim-toggle" aria-expanded={trimming} onClick={() => setTrimming((v) => !v)}>
                      <Icon name={trimming ? 'close' : 'scissors'} size={16} />
                      {trimming ? t('trimWhole') : t('trimOpen')}
                    </button>
                  )}
                  {!item.audioOnly && (
                    <button class="trim-toggle" aria-expanded={previewUrl ? previewing : undefined} onClick={preview} title={previewUrl ? t('previewHere') : t('previewInPage')}>
                      <Icon name="eye" size={16} />
                      {t('preview')}
                    </button>
                  )}
                  <button class="trim-toggle" aria-expanded={finishing} onClick={() => setFinishing((v) => !v)}>
                    <Icon name={finishing ? 'close' : 'wand'} size={16} />
                    {finishing ? t('finishClose') : finishCount(finish) ? t('finishOpenCount', String(finishCount(finish))) : t('finishOpen')}
                  </button>
                </div>
              )}
              {!showJob && previewing && previewUrl && (
                <video
                  class="preview"
                  key={`${previewUrl}#${previewSpan.start}-${previewSpan.end ?? ''}`}
                  src={`${previewUrl}#t=${previewSpan.start}${previewSpan.end !== undefined ? `,${previewSpan.end}` : ''}`}
                  controls
                  autoplay
                  playsInline
                  onError={() => {
                    // The site won't play it here: in its own page instead.
                    setPreviewing(false);
                    previewInPage(item, previewSpan.start, previewSpan.end);
                  }}
                />
              )}
              {!showJob && clippable && trimming && !image && <Trim key="parts" duration={item.duration!} parts={parts} onChange={setParts} />}
              {!showJob && chosen.length > 1 && !image && (
                <label class="option">
                  <span>{t('partsJoined')}</span>
                  <input class="switch" type="checkbox" role="switch" checked={joined} onChange={(e) => setJoined(e.currentTarget.checked)} />
                </label>
              )}
              {!showJob && finishing && !image && (
                <FinishPanel
                  value={finish}
                  onChange={setFinish}
                  audio={audio}
                  format={format}
                  {...(item.thumbnail ? { picture: item.thumbnail } : {})}
                  subsChosen={subsOffered && subsIds.length > 0}
                  chapters={item.chapters?.length ?? 0}
                  aiAllowed={!!ai?.allowed}
                  onAllowAi={() => ai?.allow()}
                />
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
              {rule && !showJob && <p class="hint">{t('ruleApplied', rule.site || t('ruleEverySite'))}</p>}
              {!showJob && isYouTube(item.pageUrl) && /[?&]v=|\/(shorts|live)\//.test(item.pageUrl) && (
                <Follow url={item.pageUrl} mode={audio ? 'audio' : 'video'} quality="hd1080" {...(!image ? { format } : {})} label={t('followChannel')} />
              )}
              {scale && !audio && !image && !showJob && <p class="hint">{t('shrinkHint')}</p>}
              {chosen.length > 0 && !audio && !image && !showJob && <p class="hint">{t('trimHint')}</p>}
              {image && !showJob && (
                <p class="hint">{t(format !== 'jpg' ? 'animationHint' : stillKind === 'sheet' ? 'sheetHint' : stillKind === 'thumb' ? 'thumbHint' : 'stillHint')}</p>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
