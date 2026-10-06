// Builds Grabby into dist/: `node scripts/build.mjs`.
import { build } from 'vite';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

function shared() {
  return {
    configFile: false,
    logLevel: 'warn',
    define: {
      __VERSION__: JSON.stringify(pkg.version),
    },
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
    resolve: {
      // ONNX Runtime without WebGPU, its loader shipped next to it (dist/ort): one small runtime.
      alias: [{ find: /^onnxruntime-web\/(webgpu|wasm)$/, replacement: resolve(root, 'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs') }],
    },
  };
}

async function buildAll() {
  const out = resolve(root, 'dist');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  // 1. Extension pages (popup, offscreen, capture sink) + ffmpeg worker.
  await build({
    ...shared(),
    root: resolve(root, 'src/pages'),
    base: './',
    publicDir: false,
    worker: { format: 'es' },
    build: {
      outDir: out,
      emptyOutDir: false,
      target: 'chrome111',
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          popup: resolve(root, 'src/pages/popup.html'),
          sidepanel: resolve(root, 'src/pages/sidepanel.html'),
          app: resolve(root, 'src/pages/app.html'),
          offscreen: resolve(root, 'src/pages/offscreen.html'),
          'capture-sink': resolve(root, 'src/pages/capture-sink.html'),
        },
      },
    },
  });

  // 2. Service worker (ES module) and content scripts (classic IIFE).
  const scripts = [
    { entry: 'src/background/index.ts', name: 'background', format: 'es' },
    { entry: 'src/content/hook.ts', name: 'hook', format: 'iife' },
    { entry: 'src/content/scanner.ts', name: 'scanner', format: 'iife' },
  ];
  for (const s of scripts) {
    await build({
      ...shared(),
      publicDir: false,
      build: {
        outDir: out,
        emptyOutDir: false,
        target: 'chrome111',
        reportCompressedSize: false,
        lib: {
          entry: resolve(root, s.entry),
          formats: [s.format],
          name: `grabby_${s.name}`,
          fileName: () => `${s.name}.js`,
        },
      },
    });
  }

  // 3. Static assets, ffmpeg core, licenses, manifest.
  await cp(resolve(root, 'public'), out, { recursive: true });
  const core = resolve(root, 'node_modules/@ffmpeg/core/dist/esm');
  await mkdir(resolve(out, 'ffmpeg'), { recursive: true });
  await cp(resolve(core, 'ffmpeg-core.js'), resolve(out, 'ffmpeg/ffmpeg-core.js'));
  await cp(resolve(core, 'ffmpeg-core.wasm'), resolve(out, 'ffmpeg/ffmpeg-core.wasm'));
  // ONNX Runtime for the local AI (transcription, translation): Grabby's own copy, never fetched.
  const ort = resolve(root, 'node_modules/onnxruntime-web/dist');
  await mkdir(resolve(out, 'ort'), { recursive: true });
  for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) await cp(resolve(ort, f), resolve(out, `ort/${f}`));
  for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    await cp(resolve(root, f), resolve(out, f)).catch(() => {});
  }
  await writeFile(
    resolve(out, 'manifest.json'),
    JSON.stringify(buildManifest(pkg.version), null, 2),
  );
  // Every file of this version: the update helper replaces these, and only these.
  const files = (await readdir(out, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => relative(out, resolve(e.parentPath ?? e.path, e.name)).split(sep).join('/'))
    .concat('updater/files.txt')
    .sort();
  await writeFile(resolve(out, 'updater/files.txt'), `${[...new Set(files)].join('\n')}\n`);
  console.log('✓ built → dist');
}

await buildAll();
