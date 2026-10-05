import { describe, expect, it } from 'vitest';
import { pickFor } from '../../src/background/quick';
import type { MediaItem } from '../../src/shared/types';

const item = (over: Partial<MediaItem>): MediaItem => ({
  id: 'x',
  tabId: 1,
  frameUrl: 'https://site.test/',
  pageUrl: 'https://site.test/watch',
  kind: 'file',
  url: 'https://cdn.test/a.mp4',
  title: 't',
  variants: [],
  audioTracks: [],
  protection: 'none',
  live: false,
  detectedAt: 0,
  ...over,
});

describe('pickFor (right-click, shortcut)', () => {
  const main = item({ id: 'main', kind: 'hls', url: 'https://cdn.test/master.m3u8', duration: 600, variants: [{ id: 'v', label: '1080p', url: 'https://cdn.test/1080.m3u8' }, { id: 'w', label: '720p', url: 'https://cdn.test/720.m3u8' }] });
  const clip = item({ id: 'clip', url: 'https://cdn.test/clip.mp4', duration: 40 });
  const drm = item({ id: 'drm', kind: 'dash', url: 'https://cdn.test/x.mpd', protection: 'drm', duration: 3000 });

  it('takes the video that was right-clicked when it is listed', () => {
    expect(pickFor([main, clip], 'https://cdn.test/clip.mp4')?.id).toBe('clip');
  });

  it('recognises one of its qualities, whatever the query string', () => {
    expect(pickFor([clip, main], 'https://cdn.test/720.m3u8')?.id).toBe('main');
  });

  it("otherwise (a blob: player, the shortcut) takes the page's best video", () => {
    expect(pickFor([clip, main], 'blob:https://site.test/1234')?.id).toBe('main');
    expect(pickFor([clip, main])?.id).toBe('main');
  });

  it('never picks a protected or live video', () => {
    expect(pickFor([drm])).toBeUndefined();
    expect(pickFor([drm, clip])?.id).toBe('clip');
    expect(pickFor([item({ id: 'live', live: true })])).toBeUndefined();
  });
});
