// Packs dist/ into release/grabby-v<version>.zip (manifest at the zip root).
import { zipSync } from 'fflate';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
mkdirSync(join(root, 'release'), { recursive: true });

function collect(dir, base, out = {}) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, base, out);
    else out[relative(base, p).split(sep).join('/')] = readFileSync(p);
  }
  return out;
}

const dir = join(root, 'dist');
const zip = zipSync(collect(dir, dir), { level: 9 });
const name = `grabby-v${version}.zip`;
writeFileSync(join(root, 'release', name), zip);
console.log(`✓ release/${name} (${(zip.length / 1024 / 1024).toFixed(1)} MB)`);
