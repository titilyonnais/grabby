import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { reducedMotion, SPRING } from '../motion';

/**
 * What opens under a line (« Extrait », « Options avancées », the crop): it unfolds as it
 * comes (its height grows, it slides down a little and appears) and folds the same way back
 * when it closes, kept on screen until it has. `gap`: the space its parent puts before it,
 * taken back as it folds, so nothing under it jumps at the end.
 */
export function Collapse({ open, gap = 8, class: className = '', children }: { open: boolean; gap?: number; class?: string; children: ComponentChildren }) {
  const [held, setHeld] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (open) setHeld(true);
    const el = ref.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    if (reducedMotion()) {
      if (!open) setHeld(false);
      return;
    }
    const folded = { height: '0px', marginTop: `${-gap}px`, opacity: 0, transform: 'translateY(-6px)' };
    const unfolded = { height: `${el.scrollHeight}px`, marginTop: '0px', opacity: 1, transform: 'none' };
    el.style.overflow = 'hidden';
    const a = el.animate(open ? [folded, unfolded] : [unfolded, folded], {
      duration: open ? SPRING.gentleMs : 260,
      easing: open ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.7, 0, 0.84, 0)',
      fill: open ? 'none' : 'forwards',
    });
    a.onfinish = () => {
      el.style.overflow = '';
      if (!open) setHeld(false);
    };
  }, [open]);

  if (!open && !held) return null;
  return (
    // Folding: out of reach (inert, never aria-hidden: what had the focus in it would be refused).
    <div ref={ref} class={`collapse ${className}`.trim()} {...(!open ? { inert: true } : {})}>
      {children}
    </div>
  );
}
