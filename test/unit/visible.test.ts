import { describe, expect, it } from 'vitest';
import { visibleItems } from '../../src/background/visible';
import type { MediaItem } from '../../src/shared/types';

const item = (id: string, kind: MediaItem['kind'], frameUrl: string, extra: Partial<MediaItem> = {}) =>
  ({ id, kind, frameUrl, url: `https://cdn.example/${id}`, pageUrl: 'https://site.example/v/1', variants: [], audioTracks: [], protection: 'none', ...extra }) as MediaItem;

describe('visibleItems', () => {
  it('hides the playback recording when the same player exposes a stream', () => {
    // Streams only know the origin that requested them; the recording knows the full frame URL.
    const items = [item('hls', 'hls', 'https://geo.dailymotion.com'), item('rec', 'capture', 'https://geo.dailymotion.com/player/xtv3w.html?a=1')];
    expect(visibleItems(items).map((i) => i.id)).toEqual(['hls']);
  });

  it('keeps a recording from another player', () => {
    const items = [item('hls', 'hls', 'https://player.one.example'), item('rec', 'capture', 'https://other.example/embed/2')];
    expect(visibleItems(items).map((i) => i.id)).toEqual(['hls', 'rec']);
  });

  it('keeps experimental recordings', () => {
    const items = [item('dash', 'dash', 'https://www.youtube.com/watch?v=x'), item('yt', 'capture', 'https://www.youtube.com/watch?v=x', { experimental: true })];
    expect(visibleItems(items)).toHaveLength(2);
  });
});
