/**
 * The local AI, in a worker of its own: speech to text (Whisper) and translation (Opus-MT),
 * through transformers.js and ONNX Runtime, both shipped with Grabby. Only the models' weights
 * are downloaded (once, when the user agreed), from Hugging Face; they stay in the browser's cache.
 */
import * as ort from 'onnxruntime-web/wasm';
import { pairModel, WHISPER_MODEL } from '../shared/translate';

// The runtime is Grabby's own copy (dist/ort). transformers.js imports the same module (the
// build points onnxruntime-web there); its files' paths are set before transformers.js loads,
// so it keeps them and never looks for the runtime on the network.
const base = `${self.location.origin}/ort/`;
ort.env.wasm.wasmPaths = { mjs: `${base}ort-wasm-simd-threaded.mjs`, wasm: `${base}ort-wasm-simd-threaded.wasm` };
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
// Loaded without holding up the worker: a request sent right after it starts must find
// someone listening (one sent while a top-level await runs is lost).
const lib = import('@huggingface/transformers').then((t) => {
  t.env.allowLocalModels = false;
  // The runtime is loaded from the extension (a copy turned into a blob would be refused here).
  t.env.useWasmCache = false;
  return t;
});

type Req =
  | { id: number; type: 'transcribe'; pcm: Float32Array; lang?: string }
  | { id: number; type: 'translate'; texts: string[]; from: string; to: string };

const post = (m: object) => (self as unknown as Worker).postMessage(m);

/** Download progress over every file of a model. */
function downloads(id: number) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    if (total) post({ id, type: 'progress', stage: 'download', progress: loaded / total, bytes: total });
  };
}

type Asr = (audio: Float32Array, o: object) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;
type Tr = (texts: string[], o?: object) => Promise<{ translation_text: string }[]>;

let asr: Promise<Asr> | null = null;
const translators = new Map<string, Promise<Tr>>();

function loadAsr(id: number): Promise<Asr> {
  asr ??= lib.then(({ pipeline }) => pipeline('automatic-speech-recognition', WHISPER_MODEL, { dtype: 'q8', device: 'wasm', progress_callback: downloads(id) } as never)) as unknown as Promise<Asr>;
  asr.catch(() => (asr = null));
  return asr;
}

function loadTranslator(id: number, model: string): Promise<Tr> {
  let p = translators.get(model);
  if (!p) {
    p = lib.then(({ pipeline }) => pipeline('translation', model, { dtype: 'q8', device: 'wasm', progress_callback: downloads(id) } as never)) as unknown as Promise<Tr>;
    p.catch(() => translators.delete(model));
    translators.set(model, p);
  }
  return p;
}

async function handle(r: Req) {
  if (r.type === 'transcribe') {
    const run = await loadAsr(r.id);
    post({ id: r.id, type: 'progress', stage: 'work', progress: 0 });
    const out = await run(r.pcm, {
      return_timestamps: true,
      task: 'transcribe',
      ...(r.lang && r.lang !== 'auto' ? { language: r.lang } : {}),
    });
    return out.chunks ?? [{ text: out.text, timestamp: [0, null] }];
  }
  const run = await loadTranslator(r.id, pairModel(r.from, r.to));
  const done: string[] = [];
  // A few lines at a time: the bar moves, and memory stays low.
  for (let i = 0; i < r.texts.length; i += 8) {
    const batch = r.texts.slice(i, i + 8);
    const res = await run(batch, { max_new_tokens: 256 });
    done.push(...res.map((x, k) => x.translation_text || batch[k]!));
    post({ id: r.id, type: 'progress', stage: 'work', progress: done.length / r.texts.length });
  }
  return done;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const r = e.data;
  handle(r).then(
    (result) => post({ id: r.id, type: 'done', result }),
    (err: unknown) => post({ id: r.id, type: 'error', error: err instanceof Error ? err.message : String(err) }),
  );
};
