/**
 * The update helper (public/updater/grabby-updater.ps1), run as the browser runs it: one
 * message in, one out. A fake Grabby folder and a fake release served from this machine
 * (never GitHub). Skipped where there is no PowerShell.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SHELL = ['powershell.exe', 'pwsh'].find((s) => spawnSync(s, ['-NoProfile', '-Command', 'exit 0']).status === 0);
const KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest';

function manifest(version: string, key = KEY) {
  return JSON.stringify({ manifest_version: 3, name: 'Grabby', short_name: 'Grabby', version, key });
}

/** A Grabby folder: its files, their list, and the helper. */
function grabbyDir(dir: string, version: string, files: Record<string, string>, key = KEY) {
  mkdirSync(join(dir, 'updater'), { recursive: true });
  cpSync(resolve('public/updater/grabby-updater.ps1'), join(dir, 'updater/grabby-updater.ps1'));
  writeFileSync(join(dir, 'manifest.json'), manifest(version, key));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const list = ['manifest.json', 'updater/grabby-updater.ps1', 'updater/files.txt', ...Object.keys(files)].sort();
  writeFileSync(join(dir, 'updater/files.txt'), `${list.join('\n')}\n`);
  return list;
}

/** The release zip of a version (same layout as Grabby's). */
function releaseZip(version: string, files: Record<string, string>, key = KEY): Uint8Array {
  const all: Record<string, string> = { 'manifest.json': manifest(version, key), 'updater/grabby-updater.ps1': readFileSync(resolve('public/updater/grabby-updater.ps1'), 'utf8'), ...files };
  all['updater/files.txt'] = `${[...Object.keys(all), 'updater/files.txt'].sort().join('\n')}\n`;
  return zipSync(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, new TextEncoder().encode(v)])));
}

/** One message to the helper, its answer back (the browser's 4-byte length framing). */
async function ask(dir: string, message: unknown, env: Record<string, string>): Promise<Record<string, unknown>> {
  const body = Buffer.from(JSON.stringify(message));
  const head = Buffer.alloc(4);
  head.writeInt32LE(body.length);
  const child = spawn(SHELL!, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(dir, 'updater/grabby-updater.ps1')], { env: { ...process.env, ...env } });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on('data', (b: Buffer) => out.push(b));
  child.stderr.on('data', (b: Buffer) => err.push(b));
  child.stdin.end(Buffer.concat([head, body]));
  await new Promise((ok) => child.on('close', ok));
  const all = Buffer.concat(out);
  expect(all.length, Buffer.concat(err).toString()).toBeGreaterThan(4);
  expect(all.length).toBe(4 + all.readInt32LE(0));
  return JSON.parse(all.subarray(4).toString('utf8'));
}

describe.skipIf(!SHELL)('the update helper', () => {
  let server: Server;
  let base = '';
  let release: { name: string; body: Uint8Array; digest: string } = { name: '', body: new Uint8Array(), digest: '' };
  const root = mkdtempSync(join(tmpdir(), 'grabby-updater-'));
  const env = () => ({ GRABBY_UPDATER_TEST_API: `${base}/latest`, GRABBY_UPDATER_TEST_PREFIX: `${base}/download/` });
  const publish = (version: string, files: Record<string, string>, opts: { key?: string; digest?: string } = {}) => {
    const body = releaseZip(version, files, opts.key);
    release = { name: `grabby-v${version}.zip`, body, digest: opts.digest ?? `sha256:${createHash('sha256').update(body).digest('hex')}` };
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/latest') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ draft: false, prerelease: false, assets: [{ name: release.name, browser_download_url: `${base}/download/v/${release.name}`, digest: release.digest }] }));
      } else if (req.url === `/download/v/${release.name}`) {
        res.end(Buffer.from(release.body));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const a = server.address();
    base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  });
  afterAll(() => {
    server?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('says it is there, with the version installed', async () => {
    const dir = join(root, 'hello');
    grabbyDir(dir, '1.8.5', {});
    expect(await ask(dir, { action: 'hello' }, env())).toMatchObject({ ok: true, helper: 1, version: '1.8.5' });
  });

  it('puts the new version in place: its files in, the old version’s files gone, nothing else touched', async () => {
    const dir = join(root, 'update');
    grabbyDir(dir, '1.8.5', { 'background.js': 'old', 'old-only.js': 'old', 'assets/a.css': 'old' });
    writeFileSync(join(dir, 'mes-notes.txt'), 'à garder');
    publish('9.9.9', { 'background.js': 'new', 'assets/b.css': 'new', 'ffmpeg/core.wasm': 'new' });
    expect(await ask(dir, { action: 'update' }, env())).toEqual({ ok: true, version: '9.9.9', from: '1.8.5' });
    expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version).toBe('9.9.9');
    expect(readFileSync(join(dir, 'background.js'), 'utf8')).toBe('new');
    expect(readFileSync(join(dir, 'ffmpeg/core.wasm'), 'utf8')).toBe('new');
    expect(existsSync(join(dir, 'old-only.js'))).toBe(false);
    expect(existsSync(join(dir, 'assets/a.css'))).toBe(false);
    expect(readFileSync(join(dir, 'mes-notes.txt'), 'utf8')).toBe('à garder');
    expect(readFileSync(join(dir, 'updater/files.txt'), 'utf8')).toContain('assets/b.css');
    // Asked again: nothing newer.
    expect(await ask(dir, { action: 'update' }, env())).toEqual({ ok: true, upToDate: true, version: '9.9.9' });
  });

  it('refuses a file that isn’t the one GitHub vouches for, or another extension', async () => {
    const dir = join(root, 'refuse');
    grabbyDir(dir, '1.8.5', { 'background.js': 'old' });
    publish('9.9.9', { 'background.js': 'evil' }, { digest: `sha256:${'0'.repeat(64)}` });
    expect(await ask(dir, { action: 'update' }, env())).toEqual({ ok: false, error: 'bad_digest' });
    publish('9.9.9', { 'background.js': 'evil' }, { digest: 'none' });
    expect(await ask(dir, { action: 'update' }, env())).toEqual({ ok: false, error: 'no_digest' });
    publish('9.9.9', { 'background.js': 'evil' }, { key: 'another-key' });
    expect(await ask(dir, { action: 'update' }, env())).toEqual({ ok: false, error: 'bad_package' });
    expect(readFileSync(join(dir, 'background.js'), 'utf8')).toBe('old');
    expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version).toBe('1.8.5');
  });

  it('takes nothing from elsewhere than the release address', async () => {
    const dir = join(root, 'source');
    grabbyDir(dir, '1.8.5', {});
    publish('9.9.9', {});
    expect(await ask(dir, { action: 'update' }, { ...env(), GRABBY_UPDATER_TEST_PREFIX: 'https://github.com/titilyonnais/grabby/releases/download/' })).toEqual({ ok: false, error: 'bad_source' });
  });

  it('a folder that isn’t Grabby’s is left alone', async () => {
    const dir = join(root, 'other');
    grabbyDir(dir, '1.8.5', {});
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ name: 'Other', short_name: 'Other', version: '1.0.0' }));
    publish('9.9.9', {});
    expect(await ask(dir, { action: 'update' }, env())).toEqual({ ok: false, error: 'not_grabby' });
  });
});
