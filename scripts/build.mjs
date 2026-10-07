// Builds Grabby into dist/: `node scripts/build.mjs`.
import { build } from 'vite';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
  for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    await cp(resolve(root, f), resolve(out, f)).catch(() => {});
  }
  await writeFile(
    resolve(out, 'manifest.json'),
    JSON.stringify(buildManifest(pkg.version), null, 2),
  );
  console.log('✓ built → dist');
}

await buildAll();
