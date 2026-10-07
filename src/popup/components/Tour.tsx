import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import { Icon, type IconName } from './Icon';

interface Step {
  /** What it points at (none: in the middle). */
  target?: string;
  icon: IconName;
  key: string;
}

const STEPS: Step[] = [
  { target: '[data-tour="tabs"]', icon: 'film', key: 'tourPage' },
  { target: '[data-tour="settings"]', icon: 'settings', key: 'tourSettings' },
  { icon: 'sparkle', key: 'tourMore' },
];

/** « Visite guidée »: four bubbles, each pointing at what it tells about. Skipped at any time. */
export function Tour({ onDone }: { onDone: () => void }) {
  const [at, setAt] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const step = STEPS[at]!;
  useLayoutEffect(() => {
    const place = () => setBox(step.target ? (document.querySelector(step.target)?.getBoundingClientRect() ?? null) : null);
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [at]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft' && at > 0) setAt(at - 1);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });
  const last = at === STEPS.length - 1;
  const next = () => (last ? onDone() : setAt(at + 1));
  // Under what it points at, kept inside the window.
  const top = box ? Math.min(box.bottom + 12, innerHeight - 190) : undefined;
  const arrow = box ? Math.max(18, Math.min(innerWidth - 50, box.left + box.width / 2 - 16)) : undefined;
  return (
    <div class="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {box ? (
        <span
          class="tour__ring"
          style={{
            left: `${box.left - 4}px`,
            top: `${box.top - 4}px`,
            width: `${box.width + 8}px`,
            height: `${box.height + 8}px`,
          }}
          aria-hidden="true"
        />
      ) : (
        <span class="tour__dim" aria-hidden="true" />
      )}
      <div key={at} class={`tour__bubble${box ? '' : ' tour__bubble--center'}`} style={top !== undefined ? { top: `${top}px` } : {}}>
        {arrow !== undefined && <span class="tour__arrow" style={{ left: `${arrow}px` }} aria-hidden="true" />}
        <span class="tour__icon" aria-hidden="true">
          <Icon name={step.icon} size={18} />
        </span>
        <div class="tour__text">
          <h2 id="tour-title">{t(`${step.key}Title`)}</h2>
          <p>{t(`${step.key}Body`)}</p>
        </div>
        <div class="tour__foot">
          <span class="tour__dots" aria-label={t('tourStep', [String(at + 1), String(STEPS.length)])}>
            {STEPS.map((_, i) => (
              <span key={i} class={i === at ? 'on' : ''} />
            ))}
          </span>
          {!last && (
            <button class="btn btn--soft btn--small" onClick={onDone}>
              {t('tourSkip')}
            </button>
          )}
          <button class="btn btn--primary btn--small" onClick={next} autoFocus>
            {last ? t('tourDone') : t('tourNext')}
          </button>
        </div>
      </div>
    </div>
  );
}
