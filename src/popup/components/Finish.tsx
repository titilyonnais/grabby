import { useEffect, useRef, useState } from 'preact/hooks';
import { COMPRESS_SIZES, COMPRESSIBLE_AUDIO, ROTATIONS, SPEEDS, cleanCrop, type Crop, type Finish, type Rotation } from '../../shared/finish';
import { size, t, uiLang } from '../i18n';
import { Collapse } from './Collapse';
import { Icon } from './Icon';
import { Segmented } from './Segmented';
import { Select, type SelectOption } from './Select';

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
function CropBox({ picture, videoAspect, crop, onChange, start }: { picture?: string; videoAspect?: number; crop?: Crop; onChange: (c: Crop | undefined) => void; start?: string }) {
  const box = useRef<HTMLDivElement>(null);
  // The video's own shape when it is known (a thumbnail can be another: YouTube's are 4:3
  // with black bands), else the picture's.
  const [aspect, setAspect] = useState(videoAspect ?? 16 / 9);
  const [shape, setShape] = useState(start ?? 'free');
  // A shape asked for on opening (« Format vertical »): framed once the picture's own shape is known.
  const started = useRef(!start);
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
  const pick = (k: string, own = aspect) => {
    setShape(k);
    const r = SHAPES.find(([s]) => s === k)?.[1] ?? 0;
    if (!r) return;
    // The biggest frame of that shape, in the middle.
    const want = r / own;
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
  useEffect(() => {
    if (started.current || picture) return;
    started.current = true;
    pick(start!);
  }, []);
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
      <div class="crop__stage" onPointerDown={down('draw')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div ref={box} class="crop__pic" style={{ aspectRatio: String(aspect) }}>
          {picture ? (
            <img
              src={picture}
              alt=""
              referrerpolicy="no-referrer"
              draggable={false}
              onLoad={(e) => {
                const i = e.currentTarget;
                if (!i.naturalWidth || !i.naturalHeight) return;
                const own = videoAspect ?? i.naturalWidth / i.naturalHeight;
                setAspect(own);
                if (!started.current) {
                  started.current = true;
                  pick(start!, own);
                }
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

/** The retouches as the card's « Options avancées » lays them out: picture, sound, file. */
interface Edits {
  value: Finish;
  onChange: (f: Finish) => void;
}

/** Changes to one setting of the retouches, the empty ones dropped (nothing sent for them). */
function editor({ value: f, onChange }: Edits) {
  const edit = f.edit ?? {};
  const setEdit = (patch: Partial<NonNullable<Finish['edit']>>) => {
    const next = { ...edit, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined || next[k] === false || (k === 'speed' && next[k] === 1) || (k === 'rotate' && next[k] === 0)) delete next[k];
    const { edit: _old, ...rest } = f;
    onChange(Object.keys(next).length ? { ...rest, edit: next } : rest);
  };
  const set = <K extends keyof Finish>(k: K, v: Finish[K] | undefined) => {
    const { [k]: _old, ...rest } = f;
    onChange(v === undefined || v === false ? rest : { ...rest, [k]: v });
  };
  return { edit, setEdit, set };
}

/** « Image »: crop (free, or the vertical 9:16 of phones), turn, mirror. */
export function PictureEdits({ picture, videoAspect, ...props }: Edits & { picture?: string; videoAspect?: number }) {
  const { edit, setEdit } = editor(props);
  const [cropping, setCropping] = useState(!!edit.crop);
  // « Format vertical »: the crop opens on a 9:16 frame, to move where the action is.
  const [cropStart, setCropStart] = useState<string | undefined>();
  const turned = !!edit.rotate || !!edit.flip;
  return (
    <>
      <div class="adv__pair">
        <button class={`adv__chip${cropping || edit.crop ? ' adv__chip--on' : ''}`} aria-expanded={cropping} onClick={() => setCropping((v) => !v)}>
          <Icon name="crop" size={16} />
          {edit.crop ? t('cropOn') : t('cropOpen')}
        </button>
        <button
          class="adv__chip"
          title={t('verticalHint')}
          onClick={() => {
            setCropStart('9:16');
            setCropping(true);
            setEdit({ crop: undefined });
          }}
        >
          <Icon name="vertical" size={16} />
          {t('verticalOpen')}
        </button>
      </div>
      <Collapse open={cropping}>
        <CropBox
          key={cropStart ?? 'free'}
          {...(picture ? { picture } : {})}
          {...(videoAspect ? { videoAspect } : {})}
          {...(edit.crop ? { crop: edit.crop } : {})}
          {...(cropStart ? { start: cropStart } : {})}
          onChange={(crop) => setEdit({ crop })}
        />
      </Collapse>
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
      {/* What « Rotation » and « Miroir » do, on the video's picture, as they are chosen. */}
      <Collapse open={turned && !!picture}>
        <div class="pic-preview" aria-hidden="true">
          <img
            class="pic-preview__img"
            src={picture}
            alt=""
            referrerpolicy="no-referrer"
            // Turned first, then mirrored, as the file is made (never taller than the box, turned or not).
            style={{
              aspectRatio: String(videoAspect ?? 16 / 9),
              width: `${Math.round(Math.min(168, 150 * (videoAspect ?? 16 / 9)))}px`,
              transform: `scaleX(${edit.flip ? -1 : 1}) rotate(${edit.rotate ?? 0}deg)`,
            }}
          />
        </div>
      </Collapse>
    </>
  );
}

/** « Son »: speed, background noise taken out, no sound at all (a video). */
export function SoundEdits({ audio, ...props }: Edits & { audio: boolean }) {
  const { edit, setEdit } = editor(props);
  const speedOptions: SelectOption<string>[] = SPEEDS.map((s) => ({ value: String(s), label: `${new Intl.NumberFormat(uiLang()).format(s)}×`, ...(s === 1 ? { detail: t('speedNormal') } : {}) }));
  return (
    <>
      <Select label={t('speedLabel')} value={String(edit.speed ?? 1)} options={speedOptions} onChange={(v) => setEdit({ speed: Number(v) })} />
      <label class={`option${edit.mute ? ' option--off' : ''}`}>
        <span>
          {t('cleanLabel')}
          <span class="option__detail">{t('cleanDetail')}</span>
        </span>
        <input class="switch" type="checkbox" role="switch" disabled={!!edit.mute} checked={!!edit.clean && !edit.mute} onChange={(e) => setEdit({ clean: e.currentTarget.checked })} />
      </label>
      {!audio && (
        <label class="option">
          <span>{t('muteLabel')}</span>
          <input class="switch" type="checkbox" role="switch" checked={!!edit.mute} onChange={(e) => setEdit({ mute: e.currentTarget.checked })} />
        </label>
      )}
    </>
  );
}

/** « Fichier »: one file per chapter, a smaller file. */
export function FileEdits({ audio, format, chapters, ...props }: Edits & { audio: boolean; format: string; chapters: number }) {
  const { set } = editor(props);
  const f = props.value;
  const sizeOptions: SelectOption<string>[] = [
    { value: '', label: t('compressNone') },
    ...COMPRESS_SIZES.map((mb) => ({ value: String(mb), label: size(mb * 1024 * 1024), detail: t(`compress_${mb}`) })),
  ];
  const canCompress = !audio || COMPRESSIBLE_AUDIO.has(format);
  return (
    <>
      {chapters > 0 && (
        <label class="option">
          {/* How many chapters is said once, on « Garder les chapitres » just above. */}
          <span>{t('splitLabel')}</span>
          <input class="switch" type="checkbox" role="switch" checked={!!f.split} onChange={(e) => set('split', e.currentTarget.checked)} />
        </label>
      )}
      {canCompress && <Select label={t('compressLabel')} value={String(f.compress ?? '')} options={sizeOptions} onChange={(v) => set('compress', v ? Number(v) : undefined)} />}
    </>
  );
}

/** How many things the panel will do (shown on its button). */
export function finishCount(f: Finish): number {
  return Object.keys(f.edit ?? {}).length + (['compress', 'burn', 'split'] as const).filter((k) => f[k]).length;
}
