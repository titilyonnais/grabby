export function t(key: string, subs?: string | string[]): string {
  return chrome.i18n.getMessage(key, subs) || key;
}

export const uiLang = (): string => chrome.i18n.getUILanguage?.() || navigator.language || 'en';

/** Byte sizes with locale digits and unit letter ("93.5 MB" in English, "93,5 Mo" in French). */
export function size(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return '';
  const letter = t('sizeUnitByte') === 'sizeUnitByte' ? 'B' : t('sizeUnitByte');
  const prefixes = ['', 'K', 'M', 'G', 'T'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < prefixes.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  const num = new Intl.NumberFormat(uiLang(), { maximumFractionDigits: digits }).format(v);
  return `${num} ${prefixes[i]}${letter}`;
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
