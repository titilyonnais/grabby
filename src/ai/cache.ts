/**
 * The local AI's models as they sit in the browser: transformers.js keeps every file it
 * downloads from Hugging Face in the Cache Storage "transformers-cache" of Grabby's origin
 * (popup, full page, offscreen document and worker share it).
 */
import { WHISPER_MODEL } from '../shared/translate';

const CACHE = 'transformers-cache';

export interface CachedModel {
  /** "onnx-community/whisper-base", "Xenova/opus-mt-en-fr"… */
  id: string;
  bytes: number;
  files: number;
}

/** The model a cached file belongs to: https://huggingface.co/<org>/<name>/resolve/<rev>/<file>. */
export function modelOf(url: string): string | null {
  const m = /^https:\/\/huggingface\.co\/([\w.-]+\/[\w.-]+)\/resolve\//.exec(url);
  return m ? m[1]! : null;
}

/** "Xenova/opus-mt-en-fr" → ["en", "fr"]; anything else → null. */
export function pairOf(id: string): [string, string] | null {
  const m = /opus-mt-([a-z]{2,3}(?:_[a-z]+)?)-([a-z]{2,3}(?:_[a-z]+)?)$/i.exec(id);
  return m ? [m[1]!, m[2]!] : null;
}

export const isWhisper = (id: string) => id === WHISPER_MODEL;

/** Every model downloaded, with the room it takes. */
export async function cachedModels(): Promise<CachedModel[]> {
  if (typeof caches === 'undefined' || !(await caches.has(CACHE))) return [];
  const cache = await caches.open(CACHE);
  const out = new Map<string, CachedModel>();
  for (const req of await cache.keys()) {
    const id = modelOf(req.url);
    if (!id) continue;
    const res = await cache.match(req);
    const length = Number(res?.headers.get('content-length'));
    const bytes = Number.isFinite(length) && length > 0 ? length : ((await res?.blob())?.size ?? 0);
    const m = out.get(id) ?? { id, bytes: 0, files: 0 };
    m.bytes += bytes;
    m.files += 1;
    out.set(id, m);
  }
  return [...out.values()].sort((a, b) => Number(isWhisper(b.id)) - Number(isWhisper(a.id)) || a.id.localeCompare(b.id));
}

/** Forgets every model: they are downloaded again the next time they are needed. */
export async function forgetModels(): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(CACHE);
}

/** What the browser's own AI (Chrome's Translator and Summarizer) can do right now. */
export async function builtinAi(): Promise<{ translator: string; summarizer: string }> {
  const g = globalThis as {
    Translator?: { availability(o: object): Promise<string> };
    Summarizer?: { availability(o: object): Promise<string> };
  };
  // Chrome can refuse outright (« The feature flag gating model execution was disabled »),
  // sometimes by throwing at once rather than rejecting: either way, not there.
  const ask = async (call: () => Promise<string>) => {
    try {
      return await call();
    } catch {
      return 'unavailable';
    }
  };
  const translator = g.Translator ? await ask(() => g.Translator!.availability({ sourceLanguage: 'en', targetLanguage: 'fr' })) : 'unavailable';
  // Asked for a language it writes (else Chrome warns that none was given).
  const ui = (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.().slice(0, 2)) || 'en';
  const outputLanguage = ['de', 'en', 'es', 'fr', 'ja'].includes(ui) ? ui : 'en';
  const summarizer = g.Summarizer ? await ask(() => g.Summarizer!.availability({ type: 'key-points', format: 'plain-text', length: 'medium', outputLanguage })) : 'unavailable';
  return { translator, summarizer };
}
