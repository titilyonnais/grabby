import { describe, expect, it } from 'vitest';
import { classify } from '../../src/parsers/classify';
import { normalizeMediaUrl, resolveUrl } from '../../src/parsers/url';

describe('classify', () => {
  it.each([
    [{ url: 'https://a.com/x/master.m3u8?t=1' }, 'hls'],
    [{ url: 'https://a.com/playlist', contentType: 'application/vnd.apple.mpegurl' }, 'hls'],
    [{ url: 'https://a.com/p', contentType: 'application/x-mpegURL; charset=utf-8' }, 'hls'],
    [{ url: 'https://a.com/manifest.mpd' }, 'dash'],
    [{ url: 'https://a.com/m', contentType: 'application/dash+xml' }, 'dash'],
    [{ url: 'https://a.com/movie.mp4', contentType: 'video/mp4', size: 5_000_000 }, 'file'],
    [{ url: 'https://a.com/stream', contentType: 'video/webm', size: 5_000_000 }, 'file'],
    [{ url: 'https://a.com/song.mp3', contentType: 'audio/mpeg', size: 3_000_000 }, 'file'],
    [{ url: 'https://a.com/clip.mp4', size: 0 }, 'file'],
  ] as const)('%o → %s', (input, expected) => expect(classify(input)).toBe(expected));

  it.each([
    [{ url: 'https://a.com/seg-1.ts', contentType: 'video/mp2t', size: 900_000 }],
    [{ url: 'https://a.com/chunk.m4s', contentType: 'video/iso.segment', size: 900_000 }],
    [{ url: 'https://a.com/v.mp4', contentType: 'video/mp4', size: 20_000 }],
    [{ url: 'https://a.com/frag.mp4?bytestart=0&byteend=1000', contentType: 'video/mp4', size: 900_000 }],
    [{ url: 'https://a.com/videoplayback?range=0-1000', contentType: 'video/mp4', size: 900_000 }],
    [{ url: 'https://a.com/page.html', contentType: 'text/html' }],
    [{ url: 'https://a.com/img.jpg', contentType: 'image/jpeg' }],
    [{ url: 'blob:https://a.com/uuid', contentType: 'video/mp4' }],
    [{ url: 'data:video/mp4;base64,AAAA' }],
  ])('ignores %o', (input) => expect(classify(input)).toBeNull());

  it('accepts a small range response whose total size is large', () => {
    expect(classify({ url: 'https://a.com/v.mp4', contentType: 'video/mp4', size: 20_000, totalSize: 50_000_000 })).toBe('file');
  });
});

describe('url helpers', () => {
  it('resolves relative urls', () => {
    expect(resolveUrl('../b/c.ts', 'https://a.com/x/y/z.m3u8')).toBe('https://a.com/x/b/c.ts');
    expect(resolveUrl('bad url ::', 'not-a-base')).toBe('bad url ::');
  });
  it('normalizes range params and hash for dedupe', () => {
    expect(normalizeMediaUrl('https://a.com/v.mp4?bytestart=0&byteend=9&id=3#t=1')).toBe('https://a.com/v.mp4?id=3');
    expect(normalizeMediaUrl('https://a.com/v.mp4?range=0-100')).toBe('https://a.com/v.mp4');
  });
});
