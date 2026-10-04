/// <reference lib="webworker" />
/**
 * Module worker hosting ffmpeg-core (bundled locally in /ffmpeg, never fetched remotely).
 * A tiny replacement for @ffmpeg/ffmpeg's worker that adds streaming appends to the
 * in-memory FS so downloaded segments never need to be concatenated in JS first.
 */
interface EmFS {
  mkdir(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  rmdir(path: string): void;
  readdir(path: string): string[];
  open(path: string, flags: string): unknown;
  write(stream: unknown, data: Uint8Array, offset: number, length: number): number;
  close(stream: unknown): void;
}

interface Core {
  FS: EmFS;
  ret: number;
  exec(...args: string[]): number;
  reset(): void;
  setTimeout(ms: number): void;
  setLogger(cb: (l: { type: string; message: string }) => void): void;
  setProgress(cb: (p: { progress: number; time: number }) => void): void;
}

type Req =
  | { id: number; cmd: 'load'; coreURL: string; wasmURL: string }
  | { id: number; cmd: 'mkdir' | 'rmdir' | 'unlink' | 'read' | 'create'; path: string }
  | { id: number; cmd: 'append'; path: string; data: Uint8Array }
  | { id: number; cmd: 'exec'; args: string[] };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let core: Core | null = null;

function need(): Core {
  if (!core) throw new Error('ffmpeg not loaded');
  return core;
}

scope.onmessage = async (e: MessageEvent<Req>) => {
  const req = e.data;
  try {
    let res: unknown = true;
    const transfer: Transferable[] = [];
    switch (req.cmd) {
      case 'load': {
        if (!core) {
          const mod = (await import(/* @vite-ignore */ req.coreURL)) as { default: (o: object) => Promise<Core> };
          // ffmpeg-core reads wasm/worker URLs from the fragment of mainScriptUrlOrBlob.
          core = await mod.default({
            mainScriptUrlOrBlob: `${req.coreURL}#${btoa(JSON.stringify({ wasmURL: req.wasmURL, workerURL: '' }))}`,
          });
          core.setLogger((l) => scope.postMessage({ type: 'log', message: l.message }));
          core.setProgress((p) => scope.postMessage({ type: 'progress', progress: p.progress, time: p.time }));
        }
        break;
      }
      case 'mkdir':
        try {
          need().FS.mkdir(req.path);
        } catch {
          /* exists */
        }
        break;
      case 'create':
        need().FS.writeFile(req.path, new Uint8Array(0));
        break;
      case 'append': {
        const fs = need().FS;
        const stream = fs.open(req.path, 'a');
        fs.write(stream, req.data, 0, req.data.length);
        fs.close(stream);
        break;
      }
      case 'exec': {
        const c = need();
        c.setTimeout(-1);
        c.exec('-nostdin', ...req.args);
        res = c.ret;
        c.reset();
        break;
      }
      case 'read': {
        const data = need().FS.readFile(req.path);
        res = data;
        transfer.push(data.buffer);
        break;
      }
      case 'unlink':
        try {
          need().FS.unlink(req.path);
        } catch {
          /* missing */
        }
        break;
      case 'rmdir': {
        const fs = need().FS;
        try {
          for (const f of fs.readdir(req.path)) if (f !== '.' && f !== '..') fs.unlink(`${req.path}/${f}`);
          fs.rmdir(req.path);
        } catch {
          /* missing */
        }
        break;
      }
    }
    scope.postMessage({ id: req.id, ok: true, res }, transfer);
  } catch (err) {
    scope.postMessage({ id: req.id, ok: false, error: String(err) });
  }
};
