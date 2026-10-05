import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (l: string) => JSON.parse(readFileSync(`public/_locales/${l}/messages.json`, 'utf8')) as Record<string, { message: string }>;

describe('locales', () => {
  const en = load('en');
  const fr = load('fr');
  it('have identical keys', () => expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort()));
  it('have no empty messages', () => {
    for (const m of [en, fr]) for (const [k, v] of Object.entries(m)) expect(v.message.trim(), k).not.toBe('');
  });
  it('cover every error code and job status used by the popup', () => {
    const codes = ['http_403', 'http_404', 'http_other', 'network', 'ffmpeg', 'protected', 'live', 'capture_failed', 'capture_unavailable', 'canceled', 'unknown'];
    const statuses = ['queued', 'downloading', 'capturing', 'processing', 'saving', 'done', 'canceled'];
    for (const c of codes) expect(en).toHaveProperty(`err_${c}`);
    for (const s of statuses) expect(en).toHaveProperty(`st_${s}`);
  });
  it('keeps the extension name short (45 characters at most)', () => {
    for (const m of [en, fr]) expect(m.extName!.message.length).toBeLessThanOrEqual(45);
  });
});
