import { describe, expect, it } from 'vitest';
import { buildFilename, namePartsOf, sanitizeFilename, templateOf } from '../../src/shared/filename';

describe('sanitizeFilename', () => {
  it('replaces Windows-forbidden characters', () => {
    expect(sanitizeFilename('a:b?c*d"e<f>g|h/i\\j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });
  it('keeps unicode and emoji', () => {
    expect(sanitizeFilename('Été à Paris 🎬')).toBe('Été à Paris 🎬');
  });
  it('strips control chars, collapses whitespace and trims dots/spaces', () => {
    expect(sanitizeFilename('  hello\u0000\n   world...  ')).toBe('hello world');
  });
  it('suffixes reserved device names', () => {
    expect(sanitizeFilename('CON')).toBe('CON_');
    expect(sanitizeFilename('com1')).toBe('com1_');
    expect(sanitizeFilename('console')).toBe('console');
  });
  it('falls back when empty', () => {
    expect(sanitizeFilename('   ')).toBe('video');
    expect(sanitizeFilename('...', 'clip')).toBe('clip');
  });
  it('limits length without splitting surrogate pairs', () => {
    const out = sanitizeFilename('🎬'.repeat(200));
    expect([...out].length).toBeLessThanOrEqual(110);
    expect(out).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});

describe('buildFilename', () => {
  const ctx = { title: 'My: Video', site: 'example.com', quality: '720p', date: new Date('2026-10-04T12:00:00Z') };
  it('applies the default template', () => {
    expect(buildFilename('{title}', ctx, 'mp4')).toBe('My_ Video.mp4');
  });
  it('supports all tokens', () => {
    expect(buildFilename('{site} - {title} [{quality}] {date}', ctx, 'mp3')).toBe(
      'example.com - My_ Video [720p] 2026-10-04.mp3',
    );
  });
  it('drops empty tokens cleanly', () => {
    expect(buildFilename('{title} [{quality}]', { ...ctx, quality: undefined }, 'mp4')).toBe('My_ Video.mp4');
  });
  it('total length stays under 120 chars', () => {
    expect(buildFilename('{title}', { ...ctx, title: 'x'.repeat(400) }, 'mp4').length).toBeLessThanOrEqual(120);
  });
  it('prefixes subfolder when given', () => {
    expect(buildFilename('{title}', ctx, 'mp4', 'Grabby')).toBe('Grabby/My_ Video.mp4');
  });
});

describe('file name parts (checkboxes in the settings)', () => {
  const ctx = { title: 'Film', site: 'site.fr', quality: '1080p', date: new Date('2026-10-04T12:00:00Z') };
  it('builds the name from the ticked parts, in a fixed order', () => {
    expect(templateOf(['date', 'quality'])).toBe('{title} - {quality} - {date}');
    expect(buildFilename(templateOf(['quality', 'site', 'date']), ctx, 'mp4')).toBe('Film - 1080p - site.fr - 2026-10-04.mp4');
    expect(templateOf([])).toBe('{title}');
  });
  it('reads the ticked parts back from a template, the title always on', () => {
    expect(namePartsOf('{title} - {site}')).toEqual(['title', 'site']);
    expect(namePartsOf('{site} {date}')).toEqual(['title', 'site', 'date']);
  });
  it('leaves no empty separator when a value is missing (no quality for a recording)', () => {
    expect(buildFilename(templateOf(['quality', 'site']), { ...ctx, quality: undefined }, 'mp4')).toBe('Film - site.fr.mp4');
    expect(buildFilename(templateOf(['quality']), { ...ctx, quality: undefined }, 'mp4')).toBe('Film.mp4');
  });
});
