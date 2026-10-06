import { useRef, useState } from 'preact/hooks';
import { COMPRESS_SIZES, COMPRESSIBLE_AUDIO, ROTATIONS, SPEEDS, canBurn, cleanCrop, type Crop, type Finish, type Rotation } from '../../shared/finish';
import { languageName } from '../../shared/sublabels';
import { PAIR_MB, TRANSLATE_TARGETS, WHISPER_MB } from '../../shared/translate';
import { size, t, uiLang } from '../i18n';
import { Icon } from './Icon';
import { Segmented } from './Segmented';
import { Select, type SelectOption } from './Select';

/** Languages offered for what is said (Whisper knows many more; these are the common ones). */
const SPOKEN = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'ru', 'uk', 'pl', 'tr', 'ar', 'zh', 'ja', 'ko', 'hi', 'sv', 'da', 'fi', 'cs', 'ro', 'hu', 'vi', 'id'];

const name = (code: string) => languageName(code, uiLang());

/** Picture shapes the crop can keep (width / height); 0: free. */
const SHAPES: [string, number][] = [
  ['free', 0],
  ['16:9', 16 / 9],
  ['1:1', 1],
  ['9:16', 9 / 16],
  ['4:3', 4 / 3],
];

/**
 * Cropping on the video's picture: a frame to move and resize (or draw anew), and the usual
 * shapes. Values are shares of the picture, so they fit any quality.
 */
function CropBox({ picture, crop, onChange }: { picture?: string; crop?: Crop; onChange: (c: Crop | undefined) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [shape, setShape] = useState('free');
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const drag = useRef<{ kind: 'move' | 'draw' | 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number; start: Crop } | null>(null);
  const ratio = SHAPES.find(([k]) => k === shape)?.[1] ?? 0;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const at = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  /** The frame with its shape kept (shares of the picture, whose own shape is `aspect`). */
  const shaped = (n: Crop, anchor: 'nw' | 'ne' | 'sw' | 'se' = 'se'): Crop => {
    if (!ratio) return n;
    let { w, h } = n;
    const want = ratio / aspect;
    if (w / h > want) w = h * want;
    else h = w / want;
    const x = anchor === 'nw' || anchor === 'sw' ? n.x + n.w - w : n.x;
    const y = anchor === 'nw' || anchor === 'ne' ? n.y + n.h - h : n.y;
    return { x, y, w, h };
  };
  const set = (n: Crop) => onChange(cleanCrop(n));
  const pick = (k: string) => {
    setShape(k);
    const r = SHAPES.find(([s]) => s === k)?.[1] ?? 0;
    if (!r) return;
    // The biggest frame of that shape, in the middle.
    const want = r / aspect;
    const w = want >= 1 ? 1 : want;
    const h = want >= 1 ? 1 / want : 1;
    set({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  };
  const down = (kind: NonNullable<typeof drag.current>['kind']) => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = at(e);
    drag.current = { kind, x: p.x, y: p.y, start: c };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    const s = d.start;
    if (d.kind === 'move') {
      set({ ...s, x: clamp(Math.min(1 - s.w, s.x + p.x - d.x)), y: clamp(Math.min(1 - s.h, s.y + p.y - d.y)) });
    } else if (d.kind === 'draw') {
      const n = { x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) };
      if (n.w > 0.05 && n.h > 0.05) set(shaped(n, p.x < d.x ? (p.y < d.y ? 'nw' : 'sw') : p.y < d.y ? 'ne' : 'se'));
    } else {
      const left = d.kind === 'nw' || d.kind === 'sw' ? Math.min(p.x, s.x + s.w - 0.1) : s.x;
      const right = d.kind === 'ne' || d.kind === 'se' ? Math.max(p.x, s.x + 0.1) : s.x + s.w;
      const top = d.kind === 'nw' || d.kind === 'ne' ? Math.min(p.y, s.y + s.h - 0.1) : s.y;
      const bottom = d.kind === 'sw' || d.kind === 'se' ? Math.max(p.y, s.y + 0.1) : s.y + s.h;
      set(shaped({ x: left, y: top, w: right - left, h: bottom - top }, d.kind));
    }
  };
  const up = () => (drag.current = null);
  const nudge = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    set({ ...c, x: clamp(Math.min(1 - c.w, c.x + dx)), y: clamp(Math.min(1 - c.h, c.y + dy)) });
  };
  return (
    <div class="crop">
      <div
        ref={box}
        class="crop__stage"
        style={{ aspectRatio: String(aspect) }}
        onPointerDown={down('draw')}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {picture ? (
          <img
            src={picture}
            alt=""
            referrerpolicy="no-referrer"
            draggable={false}
            onLoad={(e) => {
              const i = e.currentTarget;
              if (i.naturalWidth && i.naturalHeight) setAspect(i.naturalWidth / i.naturalHeight);
            }}
          />
        ) : (
          <span class="crop__blank" />
        )}
        <div
          class="crop__frame"
          role="slider"
          tabIndex={0}
          aria-label={t('cropFrame')}
          aria-valuetext={`${Math.round(c.w * 100)} % × ${Math.round(c.h * 100)} %`}
          style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
          onPointerDown={down('move')}
          onKeyDown={nudge}
        >
          {(['nw', 'ne', 'sw', 'se'] as const).map((k) => (
            <span key={k} class={`crop__handle crop__handle--${k}`} onPointerDown={down(k)} />
          ))}
        </div>
      </div>
      <div class="crop__tools">
        <Segmented label={t('cropShape')} value={shape} options={SHAPES.map(([k]) => [k, k === 'free' ? t('cropFree') : k] as [string, string])} onChange={pick} />
        <button class="btn btn--soft btn--small" onClick={() => onChange(undefined)} disabled={!crop}>
          {t('cropReset')}
        </button>
      </div>
    </div>
  );
}

interface Props {
  value: Finish;
  onChange: (f: Finish) => void;
  /** A sound file (no picture to edit). */
  audio: boolean;
  format: string;
  picture?: string;
  /** Subtitles chosen in the card. */
  subsChosen: boolean;
  /** The video has chapters of its own. */
  chapters: number;
  /** The user agreed to download the AI models. */
  aiAllowed: boolean;
  onAllowAi: () => void;
}

/** "Retouches et IA": what is done to the file once it is made. */
export function FinishPanel({ value: f, onChange, audio, format, picture, subsChosen, chapters, aiAllowed, onAllowAi }: Props) {
  const [cropping, setCropping] = useState(!!f.edit?.crop);
  const edit = f.edit ?? {};
  const setEdit = (patch: Partial<NonNullable<Finish['edit']>>) => {
    const next = { ...edit, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined || next[k] === false || (k === 'speed' && next[k] === 1) || (k === 'rotate' && next[k] === 0)) delete next[k];
    const { edit: _old, ...rest } = f;
    onChange(Object.keys(next).length ? { ...rest, edit: next } : rest);
  };
  const set = <K extends keyof Finish>(k: K, v: Finish[K] | undefined) => {
    const { [k]: _old, ...rest } = f;
    onChange(v === undefined || v === false || v === '' ? rest : { ...rest, [k]: v });
  };
  const speedOptions: SelectOption<string>[] = SPEEDS.map((s) => ({ value: String(s), label: `${new Intl.NumberFormat(uiLang()).format(s)}×`, ...(s === 1 ? { detail: t('speedNormal') } : {}) }));
  const sizeOptions: SelectOption<string>[] = [
    { value: '', label: t('compressNone') },
    ...COMPRESS_SIZES.map((mb) => ({ value: String(mb), label: size(mb * 1024 * 1024), detail: t(`compress_${mb}`) })),
  ];
  const canCompress = !audio || COMPRESSIBLE_AUDIO.has(format);
  const spokenOptions: SelectOption<string>[] = [
    { value: '', label: t('aiOff') },
    { value: 'auto', label: t('aiDetect') },
    ...SPOKEN.map((l) => ({ value: l, label: name(l), group: t('aiSpokenGroup') })),
  ];
  const targetOptions: SelectOption<string>[] = [{ value: '', label: t('aiOff') }, ...TRANSLATE_TARGETS.map((l) => ({ value: l, label: name(l) }))];
  const hasText = subsChosen || !!f.transcribe;
  const needsModels = !!(f.transcribe || f.translate) && !aiAllowed;
  return (
    <div class="finish">
      {!audio && (
        <section class="finish__group" aria-label={t('finishPicture')}>
          <h3 class="finish__title">{t('finishPicture')}</h3>
          <button class="trim-toggle" aria-expanded={cropping} onClick={() => setCropping((v) => !v)}>
            <Icon name="crop" size={16} />
            {edit.crop ? t('cropOn') : t('cropOpen')}
          </button>
          {cropping && <CropBox {...(picture ? { picture } : {})} {...(edit.crop ? { crop: edit.crop } : {})} onChange={(crop) => setEdit({ crop })} />}
          <Segmented
            label={t('rotateLabel')}
            value={String(edit.rotate ?? 0)}
            options={ROTATIONS.map((r) => [String(r), r ? `${r}°` : t('rotateNone')] as [string, string])}
            onChange={(v) => setEdit({ rotate: Number(v) as Rotation })}
          />
          <label class="option">
            <span>{t('flipLabel')}</span>
            <input class="switch" type="checkbox" role="switch" checked={!!edit.flip} onChange={(e) => setEdit({ flip: e.currentTarget.checked })} />
          </label>
        </section>
      )}
      <section class="finish__group" aria-label={t('finishSound')}>
        <h3 class="finish__title">{t('finishSound')}</h3>
        <div class="pickers">
          <Select label={t('speedLabel')} value={String(edit.speed ?? 1)} options={speedOptions} onChange={(v) => setEdit({ speed: Number(v) })} />
          {canCompress && <Select label={t('compressLabel')} value={String(f.compress ?? '')} options={sizeOptions} onChange={(v) => set('compress', v ? Number(v) : undefined)} />}
        </div>
        {!audio && (
          <label class="option">
            <span>{t('muteLabel')}</span>
            <input class="switch" type="checkbox" role="switch" checked={!!edit.mute} onChange={(e) => setEdit({ mute: e.currentTarget.checked })} />
          </label>
        )}
      </section>
      <section class="finish__group" aria-label={t('finishAi')}>
        <h3 class="finish__title">
          <Icon name="sparkle" size={15} />
          {t('finishAi')}
        </h3>
        <div class="pickers">
          <Select label={t('transcribeLabel')} value={f.transcribe ?? ''} options={spokenOptions} onChange={(v) => set('transcribe', v || undefined)} />
          <Select label={t('translateLabel')} value={f.translate ?? ''} options={targetOptions} onChange={(v) => set('translate', v || undefined)} />
        </div>
        {needsModels && (
          <div class="consent" role="note">
            <p>{t('aiConsent', [String(WHISPER_MB), String(PAIR_MB)])}</p>
            <button class="btn btn--primary btn--small" onClick={onAllowAi}>
              {t('aiAllow')}
            </button>
          </div>
        )}
        {f.translate && !hasText && <p class="hint">{t('translateNeedsText')}</p>}
        <label class={`option${hasText ? '' : ' option--off'}`}>
          <span>
            {t('summaryLabel')}
            <span class="option__detail">{t('summaryDetail')}</span>
          </span>
          <input class="switch" type="checkbox" role="switch" disabled={!hasText} checked={!!f.summary && hasText} onChange={(e) => set('summary', e.currentTarget.checked)} />
        </label>
      </section>
      <section class="finish__group" aria-label={t('finishFile')}>
        <h3 class="finish__title">{t('finishFile')}</h3>
        {!audio && (
          <label class={`option${hasText || f.translate ? '' : ' option--off'}`}>
            <span>{t('burnLabel')}</span>
            <input class="switch" type="checkbox" role="switch" disabled={!hasText} checked={!!f.burn && hasText} onChange={(e) => set('burn', e.currentTarget.checked)} />
          </label>
        )}
        {!audio && f.burn && f.translate && !canBurn(f.translate) && <p class="hint hint--warn">{t('burnScript', name(f.translate))}</p>}
        <label class={`option${chapters || f.summary ? '' : ' option--off'}`}>
          <span>
            {t('splitLabel')}
            <span class="option__detail">{chapters ? t('chaptersCount', String(chapters)) : t('splitProposed')}</span>
          </span>
          <input class="switch" type="checkbox" role="switch" disabled={!chapters && !f.summary} checked={!!f.split && (!!chapters || !!f.summary)} onChange={(e) => set('split', e.currentTarget.checked)} />
        </label>
      </section>
      {(f.edit || f.compress || f.burn) && <p class="hint">{t('finishSlow')}</p>}
      {(f.transcribe || f.translate || f.summary) && <p class="hint">{t('finishLocal')}</p>}
    </div>
  );
}

/** How many things the panel will do (shown on its button). */
export function finishCount(f: Finish): number {
  return Object.keys(f.edit ?? {}).length + (['compress', 'burn', 'split', 'transcribe', 'translate', 'summary'] as const).filter((k) => f[k]).length;
}
