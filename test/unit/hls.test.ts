import { describe, expect, it } from 'vitest';
import { parseHls } from '../../src/parsers/hls';

const BASE = 'https://cdn.example.com/path/master.m3u8?token=abc';

const MASTER = [
  '﻿#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio/en.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Français",LANGUAGE="fr",URI="https://other.example.com/fr.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud"',
  'low/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=5000000,AVERAGE-BANDWIDTH=4500000,RESOLUTION=1920x1080,FRAME-RATE=30.000,CODECS="avc1.640028,mp4a.40.2",AUDIO="aud"',
  '/abs/high.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
  '//cdn2.example.com/mid.m3u8?x=1',
  '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="iframe.m3u8"',
].join('\r\n');

describe('parseHls master', () => {
  const r = parseHls(MASTER, BASE);
  it('detects master', () => expect(r.type).toBe('master'));
  if (r.type !== 'master') return;

  it('parses variants with resolved urls', () => {
    expect(r.variants).toHaveLength(3);
    expect(r.variants.map((v) => v.url)).toEqual([
      'https://cdn.example.com/path/low/index.m3u8',
      'https://cdn.example.com/abs/high.m3u8',
      'https://cdn2.example.com/mid.m3u8?x=1',
    ]);
  });
  it('parses attributes', () => {
    const hi = r.variants[1]!;
    expect(hi).toMatchObject({ bandwidth: 5000000, width: 1920, height: 1080, audio: 'aud' });
    expect(hi.codecs).toBe('avc1.640028,mp4a.40.2');
  });
  it('ignores I-frame playlists', () => {
    expect(r.variants.some((v) => v.url.includes('iframe'))).toBe(false);
  });
  it('parses audio renditions', () => {
    expect(r.audio).toEqual([
      { groupId: 'aud', name: 'English', lang: 'en', url: 'https://cdn.example.com/path/audio/en.m3u8', isDefault: true },
      { groupId: 'aud', name: 'Français', lang: 'fr', url: 'https://other.example.com/fr.m3u8', isDefault: false },
    ]);
  });
  it('is not encrypted', () => expect(r.encrypted).toBe(false));
});

describe('parseHls media', () => {
  it('parses TS segments and duration', () => {
    const r = parseHls(
      '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nseg0.ts\n#EXTINF:3.5,title\nseg1.ts?q=1\n#EXT-X-ENDLIST\n',
      'https://a.com/v/index.m3u8',
    );
    expect(r.type).toBe('media');
    if (r.type !== 'media') return;
    expect(r.segments).toEqual([
      { url: 'https://a.com/v/seg0.ts', duration: 4 },
      { url: 'https://a.com/v/seg1.ts?q=1', duration: 3.5 },
    ]);
    expect(r.duration).toBeCloseTo(7.5);
    expect(r.endList).toBe(true);
    expect(r.encrypted).toBe(false);
    expect(r.map).toBeUndefined();
  });

  it('detects live playlists (no ENDLIST)', () => {
    const r = parseHls('#EXTM3U\n#EXTINF:2,\na.ts\n', 'https://a.com/x.m3u8');
    expect(r.type === 'media' && r.endList).toBe(false);
  });

  it('parses fMP4 map and byte ranges', () => {
    const r = parseHls(
      [
        '#EXTM3U',
        '#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"',
        '#EXTINF:2,',
        '#EXT-X-BYTERANGE:1000@720',
        'media.mp4',
        '#EXTINF:2,',
        '#EXT-X-BYTERANGE:500',
        'media.mp4',
        '#EXT-X-ENDLIST',
      ].join('\n'),
      'https://a.com/v/index.m3u8',
    );
    if (r.type !== 'media') throw new Error('expected media');
    expect(r.map).toEqual({ url: 'https://a.com/v/init.mp4', range: [0, 719] });
    expect(r.segments[0]).toEqual({ url: 'https://a.com/v/media.mp4', duration: 2, range: [720, 1719] });
    expect(r.segments[1]).toEqual({ url: 'https://a.com/v/media.mp4', duration: 2, range: [1720, 2219] });
  });

  it.each([
    ['#EXT-X-KEY:METHOD=AES-128,URI="key.bin"', true],
    ['#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"', true],
    ['#EXT-X-KEY:METHOD=NONE', false],
  ])('encryption flag for %s', (line, expected) => {
    const r = parseHls(`#EXTM3U\n${line}\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST`, 'https://a.com/x.m3u8');
    expect(r.encrypted).toBe(expected);
  });

  it('flags session keys on masters', () => {
    const r = parseHls(
      '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://k"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8',
      'https://a.com/m.m3u8',
    );
    expect(r.encrypted).toBe(true);
  });

  it('throws on non-playlists', () => {
    expect(() => parseHls('<html></html>', 'https://a.com/x')).toThrow();
  });
});
