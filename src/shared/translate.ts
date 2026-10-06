/**
 * Translating subtitles on the computer: the browser's own translator when it has one ready,
 * else small Opus-MT models (one per pair of languages, downloaded once, opt-in). A pair
 * without its own model goes through English.
 */
import { baseLang } from './langs';

/** Pairs with a model (Helsinki-NLP's Opus-MT, converted for the browser). */
const PAIRS = new Set(
  (
    'af-en ar-en cs-en da-de da-en de-en de-es de-fr en-af en-ar en-cs en-da en-de en-es en-fi en-fr en-hi en-hu en-id en-it en-jap en-nl en-ro en-ru en-sv en-uk en-vi en-xh en-zh ' +
    'es-de es-en es-fr es-it es-ru et-en fi-de fi-en fr-de fr-en fr-es fr-ro fr-ru hi-en hu-en id-en it-en it-es it-fr ja-en ko-en nl-en nl-fr no-de pl-en ro-fr ru-en ru-es ru-fr ru-uk sv-en th-en tr-en uk-en uk-ru vi-en xh-en zh-en'
  ).split(' '),
);

/** The model's name for a language (Japanese is "jap" when it is the target). */
const code = (lang: string, target: boolean) => (lang === 'ja' && target ? 'jap' : lang);

export const pairModel = (from: string, to: string): string => `Xenova/opus-mt-${code(from, false)}-${code(to, true)}`;

/** The models to go through, in order (one, or two through English); null when there's no way. */
export function translationRoute(fromLang: string | undefined, toLang: string): [string, string][] | null {
  const from = baseLang(fromLang);
  const to = baseLang(toLang);
  if (!from || !to || from === to) return null;
  const has = (a: string, b: string) => PAIRS.has(`${code(a, false)}-${code(b, true)}`);
  if (has(from, to)) return [[from, to]];
  if (from !== 'en' && to !== 'en' && has(from, 'en') && has('en', to)) return [[from, 'en'], ['en', to]];
  return null;
}

/** Languages the local models can translate into (from at least some others). */
export const TRANSLATE_TARGETS = ['fr', 'en', 'es', 'de', 'it', 'nl', 'ru', 'uk', 'pt', 'zh', 'ja', 'ar', 'sv', 'da', 'fi', 'cs', 'hu', 'ro', 'vi', 'id', 'hi'].filter(
  (t) => t === 'en' || PAIRS.has(`en-${code(t, true)}`),
);

/** Megabytes downloaded once: the transcription model, a pair of languages. */
export const WHISPER_MB = 77;
export const PAIR_MB = 107;
export const WHISPER_MODEL = 'onnx-community/whisper-base';
