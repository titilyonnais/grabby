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
