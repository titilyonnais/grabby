import type { Settings } from '../shared/settings';

/**
 * The theme setting, kept by the popup so its next opening starts in it: the settings only
 * arrive with the first state, and a light frame before switching to dark looked broken.
 * "auto" needs nothing (the stylesheet follows the system until then).
 */
const KEY = 'grabby-theme';

export function cachedTheme(): 'light' | 'dark' | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function rememberTheme(theme: Settings['theme']): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // storage unavailable: the popup just starts with the system theme
  }
}

const LOOK_KEY = 'grabby-look';

/** Grabby's color and the contrast, on the page (and kept for the next first frame). */
export function applyLook(look: Pick<Settings, 'accent' | 'contrast'>): void {
  const root = document.documentElement;
  root.dataset.accent = look.accent;
  if (look.contrast) root.dataset.contrast = 'more';
  else delete root.dataset.contrast;
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify({ accent: look.accent, contrast: look.contrast }));
  } catch {
    // storage unavailable: the next opening starts in coral
  }
}

/** The first frame: the theme, color and contrast the user chose last time. */
export function paintCachedLook(): void {
  const theme = cachedTheme();
  if (theme) document.documentElement.dataset.theme = theme;
  try {
    const look = JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null') as Pick<Settings, 'accent' | 'contrast'> | null;
    if (look?.accent) document.documentElement.dataset.accent = look.accent;
    if (look?.contrast) document.documentElement.dataset.contrast = 'more';
  } catch {
    // nothing remembered
  }
}
