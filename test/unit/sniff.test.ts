import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sniffMedia } from '../../src/parsers/sniff';

const head = (file: string, n = 256 * 1024) => new Uint8Array(readFileSync(`test/fixtures/media/${file}`).subarray(0, n));

describe('sniffMedia', () => {
  it('reads a progressive MP4: container and duration, not encrypted', () => {
    const s = sniffMedia(head('sample.mp4'));
    expect(s).toMatchObject({ container: 'mp4', encrypted: false });
    expect(s!.duration).toBeCloseTo(6, 0);
  });

  it('flags common-encryption MP4 (what DRM platforms serve) as encrypted', () => {
    expect(sniffMedia(head('encrypted/movie.mp4'))).toMatchObject({ container: 'mp4', encrypted: true });
  });

  it('reads WebM duration and fragmented MP4 init segments', () => {
    const w = sniffMedia(head('sample.webm'));
    expect(w).toMatchObject({ container: 'webm', encrypted: false });
    expect(w!.duration).toBeCloseTo(6, 0);
    expect(sniffMedia(head('mse/video.mp4', 4096))).toMatchObject({ container: 'mp4', encrypted: false });
  });

  it('works on a truncated first chunk', () => {
    expect(sniffMedia(head('sample.mp4', 64))).toMatchObject({ container: 'mp4' });
  });

  it('recognizes MPEG-TS and rejects error pages', () => {
    expect(sniffMedia(head('hls/360/seg0.ts'))).toMatchObject({ container: 'ts' });
    expect(sniffMedia(new TextEncoder().encode('<!doctype html><title>403 Forbidden</title>'))).toBeNull();
    expect(sniffMedia(new TextEncoder().encode('{"error":"expired"}'))).toBeNull();
    expect(sniffMedia(new Uint8Array())).toBeNull();
  });
});
