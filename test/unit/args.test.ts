import { describe, expect, it } from 'vitest';
import { inputExt, muxAttempts } from '../../src/offscreen/args';

describe('muxAttempts', () => {
  it('remuxes a single muxed input to mp4 by stream copy, with fallbacks', () => {
    const a = muxAttempts({ video: '/j/v.ts' }, 'mp4', false, '/j/out');
    expect(a[0]).toEqual({
      ext: 'mp4',
      out: '/j/out.mp4',
      args: ['-y', '-i', '/j/v.ts', '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', '/j/out.mp4'],
    });
    expect(a[1]!.args).toContain('aac');
    expect(a.at(-1)!.ext).toBe('mkv');
  });

  it('merges separate video and audio', () => {
    const [first] = muxAttempts({ video: '/j/v.mp4', audio: '/j/a.mp4' }, 'mp4', false, '/j/out');
    expect(first!.args).toEqual(['-y', '-i', '/j/v.mp4', '-i', '/j/a.mp4', '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', '/j/out.mp4']);
  });

  it('keeps webm sources in webm', () => {
    const [first] = muxAttempts({ video: '/j/v.webm', audio: '/j/a.webm' }, 'webm', false, '/j/out');
    expect(first!.out).toBe('/j/out.webm');
  });

  it('puts VP9/Opus recordings in MP4 when asked (no forced WebM), MKV as-is', () => {
    const [mp4] = muxAttempts({ video: '/j/v.webm', audio: '/j/a.webm' }, 'mp4', false, '/j/out');
    expect(mp4!.out).toBe('/j/out.mp4');
    const mkv = muxAttempts({ video: '/j/v.mp4' }, 'mkv', false, '/j/out');
    expect(mkv.map((a) => a.out)).toEqual(['/j/out.mkv']);
  });

  it('extracts m4a by copy first, then by re-encoding', () => {
    const a = muxAttempts({ audio: '/j/a.mp4' }, 'm4a', true, '/j/out');
    expect(a.map((x) => x.args)).toEqual([
      ['-y', '-i', '/j/a.mp4', '-vn', '-c:a', 'copy', '/j/out.m4a'],
      ['-y', '-i', '/j/a.mp4', '-vn', '-c:a', 'aac', '-b:a', '192k', '/j/out.m4a'],
    ]);
  });

  it('extracts mp3 from the video when there is no separate audio', () => {
    const [only] = muxAttempts({ video: '/j/v.ts' }, 'mp3', true, '/j/out');
    expect(only!.args).toEqual(['-y', '-i', '/j/v.ts', '-vn', '-c:a', 'libmp3lame', '-q:a', '2', '/j/out.mp3']);
  });

  it('throws when nothing can be muxed', () => {
    expect(() => muxAttempts({}, 'mp4', false, '/x')).toThrow();
  });
});

describe('inputExt', () => {
  it.each([
    ['ts', undefined, 'ts'],
    ['fmp4', undefined, 'mp4'],
    ['webm', undefined, 'webm'],
    ['file', 'https://a.com/v.webm?x=1', 'webm'],
    ['file', 'https://a.com/stream', 'bin'],
  ] as const)('%s %s → %s', (container, url, ext) => expect(inputExt(container, url)).toBe(ext));
});
