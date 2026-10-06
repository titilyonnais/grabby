/**
 * A contact sheet: pictures of the video taken every few seconds, side by side in one JPEG,
 * to see what it holds at a glance.
 */

/** Intervals offered, in seconds (0: chosen from the video's length, about 24 pictures). */
export const SHEET_EVERY = [0, 10, 30, 60, 300] as const;

/** At most this many pictures (10 × 10): beyond, they are taken further apart. */
export const SHEET_MAX = 100;

/** Each picture's width on the sheet, in pixels. */
export const SHEET_TILE = 320;

export interface SheetLayout {
  /** A picture every `every` seconds. */
  every: number;
  cols: number;
  rows: number;
}

/** How a sheet of this video is laid out: the interval, then a grid that holds every picture. */
export function sheetLayout(duration: number, every = 0): SheetLayout {
  const d = Math.max(1, duration);
  let step = every > 0 ? every : Math.max(1, Math.ceil(d / 24));
  if (Math.ceil(d / step) > SHEET_MAX) step = Math.ceil(d / SHEET_MAX);
  const count = Math.max(1, Math.ceil(d / step));
  const cols = count <= 3 ? count : count <= 16 ? 4 : count <= 36 ? 6 : count <= 64 ? 8 : 10;
  return { every: step, cols, rows: Math.ceil(count / cols) };
}

/** How many pictures the sheet holds. */
export const sheetCount = (duration: number, every = 0): number => {
  const l = sheetLayout(duration, every);
  return Math.min(l.cols * l.rows, Math.max(1, Math.ceil(Math.max(1, duration) / l.every)));
};
