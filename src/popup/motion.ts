/**
 * Grabby's motion: springs that overshoot a little and settle, like a cartoon. One
 * source for CSS (custom properties set at startup) and for scripted animations (WAAPI).
 */

/** Position over time of a damped spring released from 0 towards 1, sampled into linear(). */
function springCurve(damping: number, stiffness: number, samples = 48): { easing: string; ms: number } {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const x = (t: number) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  // Settled when the swing stays within 0.2 % of the target.
  let end = 0.1;
  while (end < 4 && Math.exp(-zeta * w0 * end) > 0.002) end += 0.02;
  const points = Array.from({ length: samples + 1 }, (_, i) => Number(x((end * i) / samples).toFixed(4)));
  return { easing: `linear(${points.join(', ')})`, ms: Math.round(end * 1000) };
}

const supportsLinear = typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', 'linear(0, 1)');

/** Bouncy: buttons, ticks, badges, the chevron — the goofy part. */
const bouncy = springCurve(14, 220);
/** Gentle: large moves (a card unfolding, a page sliding) overshoot only slightly. */
const gentle = springCurve(22, 210);

export const SPRING = {
  bouncy: supportsLinear ? bouncy.easing : 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  bouncyMs: supportsLinear ? bouncy.ms : 420,
  gentle: supportsLinear ? gentle.easing : 'cubic-bezier(0.22, 1.2, 0.36, 1)',
  gentleMs: supportsLinear ? gentle.ms : 380,
};

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Exposes the springs to the stylesheet as --spring-bouncy / --spring-gentle (+ durations). */
export function installMotion(root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--spring-bouncy', SPRING.bouncy);
  root.style.setProperty('--spring-gentle', SPRING.gentle);
  root.style.setProperty('--t-bouncy', `${SPRING.bouncyMs}ms`);
  root.style.setProperty('--t-gentle', `${SPRING.gentleMs}ms`);
}
