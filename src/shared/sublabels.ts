/**
 * How subtitle tracks are named and listed: by their language, in the language of the
 * browser ("Anglais", "Anglais (Royaume-Uni)"), whatever language the site wrote its own
 * names in ("English (auto-generated)" on a YouTube set to English).
 */
import type { SubtitleTrack } from './types';

/** A language code's name in the browser's language, capitalised ("fr" → "Français"); the code when unknown. */
export function languageName(code: string, ui = (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) || 'en'): string {
  try {
    const name = new Intl.DisplayNames([ui], { type: 'language' }).of(code);
    return name ? name[0]!.toLocaleUpperCase(ui) + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** A language name the way it reads inside a sentence ("depuis l'anglais"): not capitalised. */
function lowerName(code: string, ui: string): string {
  const name = languageName(code, ui);
  return name === code ? code : name[0]!.toLocaleLowerCase(ui) + name.slice(1);
}

const base = (l: string) => l.toLowerCase().split(/[-_]/)[0]!;

/** A code that names a language (not "und", not a made-up label). */
const isLanguage = (code: string | undefined): code is string => !!code && /^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i.test(code) && base(code) !== 'und';

/** The words a list of tracks needs, in the browser's language. */
export interface SubWords {
  own: string;
  auto: string;
  translated: string;
  forced: string;
  /** "automatic", "translated": said after a track's name inside a file. */
  autoShort: string;
  translatedShort: string;
  /** "from English": `$1` is the language. */
  from: (lang: string) => string;
}

export interface SubChoice {
  value: string;
  label: string;
  detail?: string;
  group?: string;
}

/** What a track is called: its language, or the site's own name when it gives no language. */
export function trackName(s: SubtitleTrack, ui: string): string {
  const lang = s.tlang ?? s.lang;
  if (isLanguage(lang)) {
    const name = languageName(lang, ui);
    // A code the browser has no name for ("Aa"): the site's own name.
    if (name.toLowerCase() !== lang.toLowerCase() || !s.label) return name;
  }
  return s.label || s.lang || '?';
}

/** The title a track gets inside a file: its name, said when it is automatic or translated. */
export function trackTitle(s: SubtitleTrack, words: SubWords, ui: string): string {
  const name = trackName(s, ui);
  if (s.tlang) return `${name} (${words.translatedShort})`;
  if (s.auto) return `${name} (${words.autoShort})`;
  return s.forced ? `${name} (${words.forced})` : name;
}

/**
 * The tracks as choices: the video's own first, then the automatic ones, then YouTube's
 * translations; in each, the browser's language first, then by name. Groups are named only
 * when there is more than one kind.
 */
export function subtitleChoices(tracks: SubtitleTrack[], words: SubWords, ui: string): SubChoice[] {
  const kind = (s: SubtitleTrack) => (s.tlang ? 2 : s.auto ? 1 : 0);
  const kinds = new Set(tracks.map(kind));
  const groupOf = [words.own, words.auto, words.translated];
  const mine = (s: SubtitleTrack) => {
    const lang = s.tlang ?? s.lang;
    return lang && base(lang) === base(ui) ? 0 : 1;
  };
  const names = new Map(tracks.map((s) => [s.id, trackName(s, ui)]));
  const collator = new Intl.Collator(ui, { sensitivity: 'base' });
  const sorted = [...tracks].sort((a, b) => kind(a) - kind(b) || mine(a) - mine(b) || collator.compare(names.get(a.id)!, names.get(b.id)!));
  // Two tracks of the same name and kind ("Anglais" twice): the site's own name tells them apart.
  const count = new Map<string, number>();
  for (const s of sorted) count.set(`${kind(s)}|${names.get(s.id)}`, (count.get(`${kind(s)}|${names.get(s.id)}`) ?? 0) + 1);
  return sorted.map((s) => {
    const name = names.get(s.id)!;
    const label = s.forced ? `${name} (${words.forced})` : name;
    const twin = (count.get(`${kind(s)}|${name}`) ?? 0) > 1 && s.label && s.label !== name ? s.label : undefined;
    const detail = s.tlang && isLanguage(s.lang) ? words.from(lowerName(s.lang, ui)) : twin;
    return { value: s.id, label, ...(detail ? { detail } : {}), ...(kinds.size > 1 ? { group: groupOf[kind(s)] } : {}) };
  });
}

/** The words, from the extension's messages (`get` is chrome.i18n.getMessage or the popup's t). */
export function subWordsFrom(get: (key: string, subs?: string | string[]) => string): SubWords {
  return {
    own: get('subsOwn'),
    auto: get('subsAuto'),
    translated: get('subsTranslatedGroup'),
    forced: get('subsForced'),
    autoShort: get('subsAutoShort'),
    translatedShort: get('subsTranslatedShort'),
    from: (lang) => get('subsFrom', lang),
  };
}

/** The browser's language, and the words from the extension's messages (the keys themselves where there are none). */
export const browserLanguage = (): string => (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) || 'en';
const ENGLISH: Record<string, string> = {
  subsOwn: "The video's subtitles",
  subsAuto: 'Generated automatically',
  subsTranslatedGroup: 'Translated by YouTube',
  subsForced: 'forced',
  subsAutoShort: 'automatic',
  subsTranslatedShort: 'translated',
  subsFrom: 'from $1',
};
export const browserWords = (): SubWords =>
  subWordsFrom(
    (k, subs) => (typeof chrome !== 'undefined' && chrome.i18n?.getMessage?.(k, subs)) || (ENGLISH[k] ?? k).replace('$1', String([subs ?? ''].flat()[0])),
  );
