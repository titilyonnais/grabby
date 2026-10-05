import { useEffect, useState } from 'preact/hooks';
import { clock, parseClock } from '../../shared/clip';
import type { Clip } from '../../shared/plan';
import { t } from '../i18n';
import { Icon } from './Icon';

/** The shortest part that can be cut, in seconds. */
const MIN_PART = 1;

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
  clip: Clip | null;
  onChange: (c: Clip | null) => void;
}

/**
 * "Couper un extrait": a rail with two handles (the start and the end of the part), and the
 * same two times written out, to type them exactly. Closed, the whole video is kept.
 */
export function Trim({ duration, clip, onChange }: Props) {
  const total = Math.floor(duration);
  // Opening keeps the whole video selected: the user narrows it from both ends.
  const part = clip ?? { start: 0, end: total };
  const setStart = (s: number) => onChange({ start: Math.max(0, Math.min(Math.round(s), part.end - MIN_PART)), end: part.end });
  const setEnd = (s: number) => onChange({ start: part.start, end: Math.min(total, Math.max(Math.round(s), part.start + MIN_PART)) });
  // Back to the whole video when the panel closes.
  useEffect(() => () => onChange(null), []);

  return (
    <div class="trim" role="group" aria-label={t('trimTitle')}>
      <div class="trim__head">
        <span class="trim__title">
          <Icon name="scissors" size={16} />
          {t('trimTitle')}
        </span>
        <span key={part.end - part.start} class="trim__len swap">
          {clock(part.end - part.start)}
        </span>
      </div>
      <div class="trim__rail" style={{ '--a': String(part.start / total), '--b': String(part.end / total) }}>
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
    </div>
  );
}
