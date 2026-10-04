import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, qualityLabel } from '../../src/shared/format';
import { hashId } from '../../src/shared/ids';

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(NaN)).toBe('');
    expect(formatDuration(Infinity)).toBe('');
  });
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatBytes(3.2 * 1024 ** 3)).toBe('3.2 GB');
  });
  it('labels quality', () => {
    expect(qualityLabel(1080)).toBe('1080p');
    expect(qualityLabel(undefined, 2_500_000)).toBe('2.5 Mb/s');
    expect(qualityLabel(undefined, 128_000)).toBe('128 kb/s');
    expect(qualityLabel()).toBe('');
    // Vertical video: the short side names the quality.
    expect(qualityLabel(1920, 0, 1080)).toBe('1080p');
    expect(qualityLabel(720, 0, 1280)).toBe('720p');
    // Films letterboxed to cinema formats keep the name of their width.
    expect(qualityLabel(800, 0, 1920)).toBe('1080p');
    expect(qualityLabel(534, 0, 1280)).toBe('720p');
    expect(qualityLabel(1608, 0, 3840)).toBe('2160p');
    expect(qualityLabel(1036, 0, 1920)).toBe('1080p');
  });
  it('hashId is stable and short', () => {
    expect(hashId('abc')).toBe(hashId('abc'));
    expect(hashId('abc')).not.toBe(hashId('abd'));
    expect(hashId('x'.repeat(10000)).length).toBeLessThanOrEqual(8);
  });
});
