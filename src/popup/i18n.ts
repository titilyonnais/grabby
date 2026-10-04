import { formatBytes } from '../shared/format';

export function t(key: string, subs?: string | string[]): string {
  return chrome.i18n.getMessage(key, subs) || key;
}

export const uiLang = (): string => chrome.i18n.getUILanguage?.() || navigator.language || 'en';

/** Byte sizes with the localized unit letter (B in English, o in French). */
export function size(n: number | undefined): string {
  if (!n) return '';
  const unit = t('sizeUnitByte');
  return formatBytes(n).replace(/B$/, unit === 'sizeUnitByte' ? 'B' : unit);
}

export function relativeTime(ts: number): string {
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return t('justNow');
  const rtf = new Intl.RelativeTimeFormat(uiLang(), { numeric: 'auto' });
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
