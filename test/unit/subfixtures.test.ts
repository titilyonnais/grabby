import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cuesOf } from '../../src/shared/subtitles';

describe('the E2E subtitle fixtures', () => {
  const dir = 'test/fixtures/media';
  const read = (f: string) => new Uint8Array(readFileSync(`${dir}/${f}`));
  const expected = [
    [0.5, 1.8, 'Bonjour'],
    [2.5, 3.8, '<i>le monde</i>'],
    [3.9, 4.6, 'Au revoir'],
    [5, 5.8, 'Fin'],
  ];
  const timed = (cues: { start: number; end: number; text: string }[]) => cues.map((c) => [Math.round(c.start * 1000) / 1000, Math.round(c.end * 1000) / 1000, c.text]);

  it('read back the same lines whatever their form', () => {
    for (const packed of ['subs-wvtt', 'subs-stpp']) {
      const parts = ['init.mp4', 'seg1.m4s', 'seg2.m4s', 'seg3.m4s'].map((f) => read(`dash/${packed}/${f}`));
      expect(timed(cuesOf(parts, 'fmp4'))).toEqual(expected);
    }
    expect(timed(cuesOf([read('dash/subs-it.ttml')], 'vtt'))).toEqual(expected);
    expect(timed(cuesOf([read('subs/fr.vtt')], 'vtt'))).toEqual(expected);
  });
});
