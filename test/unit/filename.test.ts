import { describe, expect, it } from 'vitest';
import { buildFilename, folderFor, namePartsOf, sanitizeFilename, templateOf } from '../../src/shared/filename';

describe('sanitizeFilename', () => {
  it('replaces Windows-forbidden characters with what a person would type', () => {
    expect(sanitizeFilename('a:b?c*d"e<f>g|h/i\\j')).toBe("a-bcd'efg-h-i-j");
    expect(sanitizeFilename('Film : la suite')).toBe('Film - la suite');
    expect(sanitizeFilename('AC/DC: Live')).toBe('AC-DC - Live');
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
    expect(buildFilename('{title}', ctx, 'mp4')).toBe('My - Video.mp4');
  });
  it('supports all tokens', () => {
    expect(buildFilename('{site} - {title} [{quality}] {date}', ctx, 'mp3')).toBe(
      'example.com - My - Video [720p] 2026-10-04.mp3',
    );
  });
  it('drops empty tokens cleanly', () => {
    expect(buildFilename('{title} [{quality}]', { ...ctx, quality: undefined }, 'mp4')).toBe('My - Video.mp4');
  });
  it('total length stays under 120 chars', () => {
    expect(buildFilename('{title}', { ...ctx, title: 'x'.repeat(400) }, 'mp4').length).toBeLessThanOrEqual(120);
  });
  it('prefixes subfolder when given', () => {
    expect(buildFilename('{title}', ctx, 'mp4', 'Grabby')).toBe('Grabby/My - Video.mp4');
  });
});

describe('file name parts (checkboxes in the settings)', () => {
  const ctx = { title: 'Film', site: 'site.fr', quality: '1080p', date: new Date('2026-10-04T12:00:00Z') };
  it('builds the name from the ticked parts, in a fixed order', () => {
    expect(templateOf(['date', 'title', 'quality'])).toBe('{title} - {quality} - {date}');
    expect(buildFilename(templateOf(['title', 'quality', 'site', 'date']), ctx, 'mp4')).toBe('Film - 1080p - site.fr - 2026-10-04.mp4');
  });
  it('reads the ticked parts back from a template; the title can be left out', () => {
    expect(namePartsOf('{title} - {site}')).toEqual(['title', 'site']);
    expect(namePartsOf('{site} {date}')).toEqual(['site', 'date']);
    expect(namePartsOf('no token')).toEqual(['title']);
  });
  it('never builds an empty template, and names files without their title when asked', () => {
    expect(templateOf([])).toBe('{title}');
    expect(templateOf(['quality', 'date'])).toBe('{quality} - {date}');
    expect(buildFilename(templateOf(['site', 'date']), ctx, 'mp4')).toBe('site.fr - 2026-10-04.mp4');
    // The local day, even when it is already another day in UTC.
    expect(buildFilename('{date}', { ...ctx, date: new Date(2026, 9, 5, 0, 30) }, 'mp4')).toBe('2026-10-05.mp4');
  });
  it('leaves no empty separator when a value is missing (no quality for a recording)', () => {
    expect(buildFilename(templateOf(['title', 'quality', 'site']), { ...ctx, quality: undefined }, 'mp4')).toBe('Film - site.fr.mp4');
    expect(buildFilename(templateOf(['title', 'quality']), { ...ctx, quality: undefined }, 'mp4')).toBe('Film.mp4');
    // Only the quality, and there is none (a recording): the title stands in.
    expect(buildFilename(templateOf(['quality']), { ...ctx, quality: undefined }, 'mp4')).toBe('Film.mp4');
  });
});

describe('channel, format and folders (1.9)', () => {
  const ctx = { title: 'Spring', site: 'youtube.com', quality: '1080p', channel: 'Blender', format: 'MP4', date: new Date(2026, 9, 6) };
  const names = { video: 'Vidéos', audio: 'Musique', image: 'Images' };

  it('the channel and the format can be in the name', () => {
    expect(buildFilename('{title} - {channel} - {format}', ctx, 'mp4')).toBe('Spring - Blender - MP4.mp4');
    expect(templateOf(['date', 'channel', 'title', 'format'])).toBe('{title} - {channel} - {format} - {date}');
    expect(namePartsOf('{channel} - {title}')).toEqual(['title', 'channel']);
    // No channel known: its place disappears with its dash.
    expect(buildFilename('{title} - {channel} - {quality}', { ...ctx, channel: undefined }, 'mp4')).toBe('Spring - 1080p.mp4');
  });

  it('files sorted in Grabby, by site or by kind', () => {
    expect(folderFor('none', { site: 'youtube.com', kind: 'video' }, names)).toBeUndefined();
    expect(folderFor('grabby', { site: 'youtube.com', kind: 'video' }, names)).toBe('Grabby');
    expect(folderFor('site', { site: 'youtube.com', kind: 'video' }, names)).toBe('Grabby/youtube.com');
    expect(folderFor('type', { site: 'youtube.com', kind: 'audio' }, names)).toBe('Grabby/Musique');
    expect(buildFilename('{title}', ctx, 'mp3', folderFor('type', { site: 'x', kind: 'audio' }, names))).toBe('Grabby/Musique/Spring.mp3');
  });

  it('each folder of the path is made safe on its own', () => {
    expect(buildFilename('{title}', ctx, 'mp4', 'Grabby/a:b?c')).toBe('Grabby/a-bc/Spring.mp4');
    expect(buildFilename('{title}', ctx, 'mp4', 'Grabby//../x')).toBe('Grabby/x/Spring.mp4');
  });
});
