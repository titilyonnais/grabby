import { useEffect, useState } from 'preact/hooks';
import { clock, parseClock } from '../../shared/clip';
import type { Clip } from '../../shared/plan';
import { t } from '../i18n';
import { Icon } from './Icon';

/** The shortest part that can be cut, in seconds. */
const MIN_PART = 1;
/** Parts one download can hold. */
export const MAX_PARTS = 8;

/** A time the user can also type ("1:05"); what doesn't read as a time goes back as it was. */
function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (s: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const s = parseClock(draft);
    setDraft(null);
    if (s !== null) onCommit(s);
  };
  return (
    <label class="trim__field">
      <span class="trim__label">{label}</span>
      <input
        class="trim__time"
        inputMode="numeric"
        spellcheck={false}
        value={draft ?? clock(value)}
        onFocus={(e) => e.currentTarget.select()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
    </label>
  );
}

interface Props {
  duration: number;
  /** The parts chosen (null: the panel just opened, the whole video). */
  parts: Clip[] | null;
  onChange: (parts: Clip[] | null) => void;
  /** Only one part (an animated picture), at most this long. */
  single?: { max: number };
}

/**
 * "Couper un extrait": a rail with two handles (the start and the end of the part), and the
 * same two times written out, to type them exactly. More parts can be added: each one is
 * picked below the rail and edited on it. Closed, the whole video is kept.
 */
export function Trim({ duration, parts, onChange, single }: Props) {
  const total = Math.floor(duration);
  // Opening keeps the whole video selected: the user narrows it from both ends.
  const list = parts?.length ? parts : [{ start: 0, end: single ? Math.min(total, single.max) : total }];
  const [active, setActive] = useState(0);
  const at = Math.min(active, list.length - 1);
  const part = list[at]!;
  const put = (p: Clip) => {
    const next = list.map((x, i) => (i === at ? p : x));
    onChange(next);
  };
  const longest = single?.max ?? Infinity;
  const setStart = (s: number) => {
    const start = Math.max(0, Math.min(Math.round(s), part.end - MIN_PART));
    put({ start, end: Math.min(part.end, start + longest) });
  };
  const setEnd = (s: number) => {
    const end = Math.min(total, Math.max(Math.round(s), part.start + MIN_PART));
    put({ start: Math.max(part.start, end - longest), end });
  };
  // A new part: the next 30 seconds after the last one (or the end of the video).
  const add = () => {
    const last = list[list.length - 1]!;
    const start = last.end < total - MIN_PART ? last.end : Math.max(0, total - 30);
    onChange([...list, { start, end: Math.min(total, start + 30) }]);
    setActive(list.length);
  };
  const drop = (i: number) => {
    const next = list.filter((_, k) => k !== i);
    onChange(next.length ? next : null);
    setActive(Math.max(0, Math.min(at, next.length - 1)));
  };
  // Back to the whole video when the panel closes.
  useEffect(() => () => onChange(null), []);

  return (
    <div class="trim" role="group" aria-label={t('trimTitle')}>
      <div class="trim__head">
        <span class="trim__title">
          <Icon name="scissors" size={16} />
          {list.length > 1 ? t('trimPartOf', [String(at + 1), String(list.length)]) : t('trimTitle')}
        </span>
        <span key={part.end - part.start} class="trim__len swap">
          {clock(part.end - part.start)}
        </span>
      </div>
      <div class="trim__rail" style={{ '--a': String(part.start / total), '--b': String(part.end / total) }}>
        {/* The other parts, faint on the rail. */}
        {list.map((p, i) =>
          i === at ? null : <span key={i} class="trim__other" aria-hidden="true" style={{ '--a': String(p.start / total), '--b': String(p.end / total) }} />,
        )}
        <span class="trim__sel" aria-hidden="true" />
        <input
          type="range"
          class={`trim__handle${part.start > total / 2 ? ' trim__handle--top' : ''}`}
          min={0}
          max={total}
          step={1}
          value={part.start}
          aria-label={t('trimStart')}
          aria-valuetext={clock(part.start)}
          onInput={(e) => {
            const v = Math.min(Number(e.currentTarget.value), part.end - MIN_PART);
            e.currentTarget.value = String(v);
            setStart(v);
          }}
        />
        <input
          type="range"
          class="trim__handle"
          min={0}
          max={total}
          step={1}
          value={part.end}
          aria-label={t('trimEnd')}
          aria-valuetext={clock(part.end)}
          onInput={(e) => {
            const v = Math.max(Number(e.currentTarget.value), part.start + MIN_PART);
            e.currentTarget.value = String(v);
            setEnd(v);
          }}
        />
      </div>
      <div class="trim__times">
        <TimeField label={t('trimStart')} value={part.start} onCommit={setStart} />
        <TimeField label={t('trimEnd')} value={part.end} onCommit={setEnd} />
      </div>
      {!single && (
        <div class="trim__parts" role="list" aria-label={t('trimParts')}>
          {list.length > 1 &&
            list.map((p, i) => (
              <span key={i} role="listitem" class={`chip${i === at ? ' chip--on' : ''}`}>
                <button class="chip__main" aria-pressed={i === at} onClick={() => setActive(i)}>
                  <span class="chip__n">{i + 1}</span>
                  {clock(p.start)}–{clock(p.end)}
                </button>
                <button class="chip__x" aria-label={t('trimRemove', String(i + 1))} title={t('trimRemove', String(i + 1))} onClick={() => drop(i)}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          {list.length < MAX_PARTS && (
            <button class="chip chip--add" onClick={add}>
              <Icon name="plus" size={14} />
              {t('trimAdd')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "Une image": one handle on the rail, and the moment written out. */
export function Moment({ duration, at, onChange }: { duration: number; at: number; onChange: (s: number) => void }) {
  const total = Math.max(1, Math.floor(duration) - 1);
  const set = (s: number) => onChange(Math.max(0, Math.min(total, Math.round(s))));
  return (
    <div class="trim" role="group" aria-label={t('momentTitle')}>
      <div class="trim__head">
        <span class="trim__title">
          <Icon name="image" size={16} />
          {t('momentTitle')}
        </span>
      </div>
      <div class="trim__rail" style={{ '--a': '0', '--b': String(at / total) }}>
        <span class="trim__sel trim__sel--soft" aria-hidden="true" />
        <input
          type="range"
          class="trim__handle"
          min={0}
          max={total}
          step={1}
          value={at}
          aria-label={t('momentAt')}
          aria-valuetext={clock(at)}
          onInput={(e) => set(Number(e.currentTarget.value))}
        />
      </div>
      <div class="trim__times trim__times--one">
        <TimeField label={t('momentAt')} value={at} onCommit={set} />
      </div>
    </div>
  );
}
