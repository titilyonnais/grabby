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
      ['-y', '-i', '/j/a.mp4', '-vn', '-map', '0:a:0', '-c:a', 'copy', '/j/out.m4a'],
      ['-y', '-i', '/j/a.mp4', '-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k', '/j/out.m4a'],
    ]);
  });

  it('encodes m4a from a WebM source (Opus/Vorbis) instead of copying it', () => {
    const a = muxAttempts({ audio: '/j/a.webm' }, 'm4a', true, '/j/out');
    expect(a.map((x) => x.args[x.args.indexOf('-c:a') + 1])).toEqual(['aac']);
  });

  it('extracts mp3 from the video when there is no separate audio', () => {
    const [only] = muxAttempts({ video: '/j/v.ts' }, 'mp3', true, '/j/out');
    expect(only!.args).toEqual(['-y', '-i', '/j/v.ts', '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-q:a', '2', '/j/out.mp3']);
  });

  it.each([
    // ffmpeg's own Opus encoder: libopus crashes in ffmpeg.wasm on 44.1 kHz sources.
    ['opus', ['copy', 'opus']],
    ['ogg', ['libvorbis']],
    ['flac', ['flac']],
    ['wav', ['pcm_s16le']],
  ] as const)('audio %s: %j', (fmt, codecs) => {
    const a = muxAttempts({ audio: '/j/a.webm' }, fmt, true, '/j/out');
    expect(a.map((x) => x.args[x.args.indexOf('-c:a') + 1])).toEqual(codecs);
    expect(a.every((x) => x.out === `/j/out.${fmt}`)).toBe(true);
  });

  it.each([
    ['mov', 'aac', true],
    ['avi', 'libmp3lame', false],
    ['ts', 'aac', false],
  ] as const)('video %s: copy, then %s audio, then MKV', (fmt, codec, faststart) => {
    const a = muxAttempts({ video: '/j/v.ts' }, fmt, false, '/j/out');
    expect(a.map((x) => x.out)).toEqual([`/j/out.${fmt}`, `/j/out.${fmt}`, '/j/out.mkv']);
    expect(a[1]!.args).toContain(codec);
    expect(a[0]!.args.includes('+faststart')).toBe(faststart);
  });

  it('shrinks the picture in H.264 when a smaller quality is asked, never into WebM', () => {
    const a = muxAttempts({ video: '/j/v.mp4' }, 'webm', false, '/j/out', { w: 640, h: 360 });
    expect(a[0]!.out).toBe('/j/out.mp4');
    expect(a[0]!.args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-c:a', 'copy']));
    expect(a[0]!.args.join(' ')).toContain('scale=w=640:h=360:force_original_aspect_ratio=decrease');
    // Every fallback shrinks too: never a full-size copy by mistake.
    expect(a.every((x) => x.args.includes('libx264'))).toBe(true);
    expect(a[1]!.args).toContain('aac');
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
