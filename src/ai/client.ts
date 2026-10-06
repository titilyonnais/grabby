/**
 * Talks to the AI worker (offscreen document, full page): subtitles from the sound, translated
 * subtitles, and the browser's own translator and summarizer when they are ready to use.
 */
import { baseLang } from '../shared/langs';
import { cuesFromSaid, quietCuts, SAMPLE_RATE, type Said } from '../shared/speech';
import type { Cue } from '../shared/subtitles';
import { translationRoute } from '../shared/translate';

export interface AiProgress {
  stage: 'download' | 'work';
  /** 0 to 1. */
  progress: number;
}

type Pending = { ok: (v: unknown) => void; ko: (e: Error) => void; onProgress?: (p: AiProgress) => void };

export class LocalAi {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private start(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent) => {
      const d = e.data as { id: number; type: string; result?: unknown; error?: string; stage?: AiProgress['stage']; progress?: number };
      const p = this.pending.get(d.id);
      if (!p) return;
      if (d.type === 'progress') return p.onProgress?.({ stage: d.stage ?? 'work', progress: d.progress ?? 0 });
      this.pending.delete(d.id);
      if (d.type === 'done') p.ok(d.result);
      else p.ko(new Error(`ai: ${d.error ?? 'failed'}`));
    };
    w.onerror = (e) => {
      e.preventDefault();
      this.stop(new Error(`ai: ${e.message || 'worker crashed'}`));
    };
    this.worker = w;
    return w;
  }

  /** Stops whatever runs (the models are loaded again next time, from the cache). */
  stop(reason: Error = new DOMException('Aborted', 'AbortError') as unknown as Error) {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.ko(reason);
    this.pending.clear();
  }

  private call<T>(msg: object, transfer: Transferable[], onProgress?: (p: AiProgress) => void, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const w = this.start();
    const id = ++this.seq;
    return new Promise<T>((ok, ko) => {
      const abort = () => this.stop(signal!.reason as Error);
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        ok: (v) => {
          signal?.removeEventListener('abort', abort);
          ok(v as T);
        },
        ko: (e) => {
          signal?.removeEventListener('abort', abort);
          ko(e);
        },
        ...(onProgress ? { onProgress } : {}),
      });
      w.postMessage({ id, ...msg }, transfer);
    });
  }

  /**
   * Subtitles from what is said in the sound (16 kHz, mono). Heard in pieces of at most 28
   * seconds, cut where it is quietest.
   */
  async transcribe(pcm: Float32Array, lang: string, onProgress?: (p: AiProgress) => void, signal?: AbortSignal): Promise<Cue[]> {
    if (lang === 'auto') lang = (await this.detect(pcm, onProgress, signal)) ?? 'en';
    const cuts = [0, ...quietCuts(pcm), pcm.length];
    const pieces: { offset: number; length: number; said: Said[] }[] = [];
    const n = cuts.length - 1;
    for (let i = 0; i < n; i++) {
      const part = pcm.slice(cuts[i]!, cuts[i + 1]!);
      // Read before the samples are handed to the worker (the array is empty after).
      const offset = cuts[i]! / SAMPLE_RATE;
      const length = part.length / SAMPLE_RATE;
      const said = await this.call<Said[]>({ type: 'transcribe', pcm: part, lang }, [part.buffer], (p) => {
        // Downloading the model comes first; then each piece moves the bar.
        onProgress?.(p.stage === 'download' ? p : { stage: 'work', progress: (i + p.progress) / n });
      }, signal);
      pieces.push({ offset, length, said });
      onProgress?.({ stage: 'work', progress: (i + 1) / n });
    }
    return cuesFromSaid(pieces);
  }

  /**
   * The language spoken: Whisper listens to up to three stretches of 30 s (the start, the
   * middle and near the end of a long sound, where an opening jingle no longer counts).
   */
  async detect(pcm: Float32Array, onProgress?: (p: AiProgress) => void, signal?: AbortSignal): Promise<string | null> {
    const span = 30 * SAMPLE_RATE;
    const starts = pcm.length > 3 * span ? [0.1, 0.5, 0.8].map((f) => Math.floor(pcm.length * f)) : [0];
    const samples = starts.map((s) => pcm.slice(s, s + span));
    return this.call<string | null>({ type: 'detect', pcm: samples }, samples.map((s) => s.buffer), (p) => {
      if (p.stage === 'download') onProgress?.(p);
    }, signal);
  }

  /**
   * The cues' text in another language (their times stay). Null when no model can. `chrome`:
   * Chrome's own translator may be asked first (only when the user turned it on).
   */
  async translate(cues: Cue[], from: string, to: string, onProgress?: (p: AiProgress) => void, signal?: AbortSignal, chrome = false): Promise<Cue[] | null> {
    const texts = cues.map((c) => c.text.replace(/\s*\n\s*/g, ' '));
    const builtin = chrome ? await builtinTranslator(from, to) : null;
    if (builtin) {
      const out: string[] = [];
      for (const [i, t] of texts.entries()) {
        if (signal?.aborted) throw signal.reason;
        out.push(await builtin(t).catch(() => t));
        if (i % 10 === 0) onProgress?.({ stage: 'work', progress: i / texts.length });
      }
      return cues.map((c, i) => ({ ...c, text: out[i]! }));
    }
    const route = translationRoute(from, to);
    if (!route) return null;
    let current = texts;
    for (const [k, [a, b]] of route.entries()) {
      current = await this.call<string[]>({ type: 'translate', texts: current, from: a, to: b }, [], (p) => {
        onProgress?.(p.stage === 'download' ? p : { stage: 'work', progress: (k + p.progress) / route.length });
      }, signal);
    }
    return cues.map((c, i) => ({ ...c, text: current[i] ?? c.text }));
  }
}

interface BuiltinTranslator {
  translate(text: string): Promise<string>;
}
interface TranslatorApi {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<BuiltinTranslator>;
}
interface SummarizerApi {
  availability(o?: object): Promise<string>;
  create(o: object): Promise<{ summarize(text: string): Promise<string>; inputQuota?: number }>;
}

/** The browser's own translator (Chrome), only when its model is already there: nothing to ask. */
export async function builtinTranslator(from: string, to: string): Promise<((text: string) => Promise<string>) | null> {
  const api = (globalThis as { Translator?: TranslatorApi }).Translator;
  const a = baseLang(from);
  const b = baseLang(to);
  if (!api || !a || !b) return null;
  try {
    if ((await api.availability({ sourceLanguage: a, targetLanguage: b })) !== 'available') return null;
    const t = await api.create({ sourceLanguage: a, targetLanguage: b });
    return (text) => t.translate(text);
  } catch {
    return null;
  }
}

/** The browser's own summarizer (Chrome), when it is ready and speaks the language; else null. */
export async function builtinSummary(text: string, lang?: string): Promise<string | null> {
  const api = (globalThis as { Summarizer?: SummarizerApi }).Summarizer;
  if (!api) return null;
  const l = baseLang(lang);
  const o = { type: 'key-points', format: 'plain-text', length: 'medium', ...(l ? { expectedInputLanguages: [l], outputLanguage: l } : {}) };
  try {
    if ((await api.availability(o)) !== 'available') return null;
    const s = await api.create(o);
    const quota = s.inputQuota ?? 4000;
    return (await s.summarize(text.slice(0, Math.max(1000, quota * 3)))).trim() || null;
  } catch {
    return null;
  }
}
