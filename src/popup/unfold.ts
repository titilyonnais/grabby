import { useLayoutEffect, useRef } from 'preact/hooks';
import { reducedMotion, SPRING } from './motion';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Snapshot {
  open: boolean;
  height: number;
  thumb: Box | null;
  body: Box | null;
}

/** Where `node` sits inside `card`, as drawn (transforms included). */
function boxIn(card: HTMLElement, node: Element | null): Box | null {
  if (!node) return null;
  const r = node.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
}

/**
 * A card that unfolds for real: when `open` flips, its height springs from the old size to
 * the new one, the thumbnail grows (or shrinks) from where it was, and the title slides to
 * its new place. Measured on every render, so a toggle mid-animation starts from what is on
 * screen. Returns the ref to put on the card.
 */
export function useUnfold<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);
  const last = useRef<Snapshot | null>(null);

  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const thumbEl = card.querySelector<HTMLElement>('.card__head .thumb');
    const bodyEl = card.querySelector<HTMLElement>('.card__body');
    const before = last.current;
    const toggled = !!before && before.open !== open;
    // Measure the new layout without the previous unfold still playing.
    if (toggled) for (const el of [card, thumbEl, bodyEl, thumbEl?.querySelector('.thumb__time')]) el?.getAnimations().forEach((a) => a.cancel());
    const now: Snapshot = { open, height: card.offsetHeight, thumb: boxIn(card, thumbEl), body: boxIn(card, bodyEl) };
    last.current = now;
    if (!toggled || reducedMotion()) return;

    card.style.overflow = 'hidden';
    const grow = card.animate([{ height: `${before.height}px` }, { height: `${now.height}px` }], {
      duration: SPRING.gentleMs,
      easing: SPRING.gentle,
    });
    const done = () => {
      card.style.overflow = '';
      last.current = { ...now, height: card.offsetHeight };
      // Not while a list is open: scrolling closes it (the user already picked a choice).
      if (open && !document.querySelector('.menu')) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    grow.onfinish = done;
    grow.oncancel = () => (card.style.overflow = '');

    const t0 = before.thumb;
    const t1 = now.thumb;
    if (thumbEl && t0 && t1 && t1.w && t1.h) {
      thumbEl.animate(
        [
          { transformOrigin: '0 0', transform: `translate(${t0.x - t1.x}px, ${t0.y - t1.y}px) scale(${t0.w / t1.w}, ${t0.h / t1.h})` },
          { transformOrigin: '0 0', transform: 'none' },
        ],
        // Gentle: a bouncier picture would overshoot onto the title under it.
        { duration: SPRING.gentleMs, easing: SPRING.gentle },
      );
      // The duration badge would be stretched with the picture: it shows up once it's in place.
      thumbEl.querySelector('.thumb__time')?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], {
        duration: SPRING.gentleMs,
        easing: 'linear',
      });
    }
    const b0 = before.body;
    const b1 = now.body;
    if (bodyEl && b0 && b1) {
      // The text wraps differently in its new place: it slides there while fading in.
      bodyEl.animate(
        // Hidden while the picture moves past it, so the two never overlap.
        [
          { transform: `translate(${b0.x - b1.x}px, ${b0.y - b1.y}px)`, opacity: 0 },
          { opacity: 0, offset: 0.4 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: SPRING.gentleMs, easing: SPRING.gentle },
      );
    }
  });

  return ref;
}
