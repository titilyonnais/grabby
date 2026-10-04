import { describe, expect, it } from 'vitest';
import { buildPlan } from '../../src/background/plan';
import { findVisible, visibleItems } from '../../src/background/visible';
import { scaleBox, scaleChoices, scaleSource } from '../../src/shared/scale';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { MediaItem, Variant } from '../../src/shared/types';

const PLAYER = 'https://player.example/embed/42';
const file = (id: string, w: number, h: number, size: number, extra: Partial<MediaItem> = {}): MediaItem =>
  ({
    id,
    tabId: 1,
    kind: 'file',
    frameUrl: PLAYER,
    pageUrl: 'https://site.example/film',
    url: `https://cdn.example/${id}.mp4`,
    mime: 'video/mp4',
    title: 'Film',
    duration: 5400.2,
    size,
    variants: [{ id, label: `${h}p`, url: `https://cdn.example/${id}.mp4`, width: w, height: h, size }],
    audioTracks: [],
    protection: 'none',
    live: false,
    detectedAt: 0,
    ...extra,
  }) as MediaItem;
const v = (height: number, width = Math.round((height * 16) / 9)): Variant => ({
  id: `v${height}`,
  label: `${height}p`,
  url: `https://cdn.example/${height}.m3u8`,
  width,
  height,
});
const fetchText = async () => '';

describe('groupSameVideo (through visibleItems)', () => {
  it('merges the qualities a player offers into the copy that plays, best first', () => {
    const items = [file('hd', 1280, 720, 9e8), file('fhd', 1920, 1080, 1.4e9, { linked: true }), file('sd', 640, 360, 3e8, { linked: true })];
    const [one, ...rest] = visibleItems(items);
    expect(rest).toEqual([]);
    expect(one!.id).toBe('hd');
    expect(one!.linked).toBeUndefined();
    expect(one!.variants.map((x) => x.label)).toEqual(['1080p', '720p', '360p']);
    expect(one!.size).toBe(1.4e9);
  });

  it('keeps apart different videos, other players, short clips and other containers', () => {
    const items = [
      file('a', 1280, 720, 9e8),
      file('b', 1920, 1080, 2e9, { duration: 3000 }),
      file('c', 1920, 1080, 2e9, { frameUrl: 'https://other.example/' }),
      file('d', 1920, 1080, 2e6, { duration: 4 }),
      file('e', 1920, 1080, 1e9, { url: 'https://cdn.example/e.webm', mime: 'video/webm' }),
    ];
    expect(visibleItems(items).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('downloads the chosen quality of a merged video, the best one by default', async () => {
    const items = [file('hd', 1280, 720, 9e8), file('sd', 640, 360, 3e8, { linked: true })];
    const merged = findVisible(items, 'hd')!;
    const p = await buildPlan(merged, { mode: 'video', variantId: 'sd', format: 'mp4', settings: DEFAULT_SETTINGS, fetchText });
    expect(p.video!.segments[0]!.url).toBe('https://cdn.example/sd.mp4');
    expect(p).toMatchObject({ direct: true, estimatedSize: 3e8 });
    const best = await buildPlan(merged, { mode: 'video', format: 'mp4', settings: DEFAULT_SETTINGS, fetchText });
    expect(best.video!.segments[0]!.url).toBe('https://cdn.example/hd.mp4');
  });

  it('merges one master playlist per quality, keeping their audio tracks apart', () => {
    const hls = (id: string, height: number): MediaItem =>
      ({
        ...file(id, 0, 0, 0),
        kind: 'hls',
        url: `https://cdn.example/${id}/master.m3u8`,
        size: undefined,
        variants: [{ ...v(height), audioGroup: 'aud' }],
        audioTracks: [{ id: `${id}a`, label: 'fr', url: `https://cdn.example/${id}/a.m3u8`, groupId: 'aud' }],
      }) as MediaItem;
    const [one] = visibleItems([hls('m720', 720), hls('m1080', 1080)]);
    expect(one!.variants.map((x) => x.label)).toEqual(['1080p', '720p']);
    expect(one!.variants[0]!.audioGroup).toBe('m1080:aud');
    expect(one!.audioTracks.find((a) => a.groupId === 'm1080:aud')!.url).toContain('/m1080/');
  });
});

describe('shrinking to a smaller quality', () => {
  it('offers the usual qualities below the best one, except those the site has', () => {
    expect(scaleChoices([v(2160)])).toEqual([1440, 1080, 720, 480, 360, 240, 144]);
    expect(scaleChoices([v(1080), v(720)])).toEqual([480, 360, 240, 144]);
    // A letterboxed film (1920×800) is 1080p: 720p and below.
    expect(scaleChoices([v(800, 1920)])).toEqual([720, 480, 360, 240, 144]);
    expect(scaleChoices([{ id: 'x', label: '', url: '' }])).toEqual([]);
  });

  it('starts from the smallest quality still big enough', () => {
    expect(scaleSource([v(2160), v(1080), v(480)], 360)!.id).toBe('v480');
    expect(scaleSource([v(2160), v(1080), v(480)], 720)!.id).toBe('v1080');
  });

  it('fits the picture in a 16:9 box, turned for vertical videos', () => {
    expect(scaleBox(360)).toEqual({ w: 640, h: 360 });
    expect(scaleBox(144)).toEqual({ w: 256, h: 144 });
    expect(scaleBox(360, { width: 1080, height: 1920 })).toEqual({ w: 360, h: 640 });
  });

  it('plans a shrunk file: never saved as is, never WebM', async () => {
    const item = file('uhd', 3840, 2160, 9e8, { url: 'https://cdn.example/uhd.webm', mime: 'video/webm' });
    item.variants[0]!.url = item.url;
    const p = await buildPlan(item, { mode: 'video', scale: 360, format: 'webm', settings: DEFAULT_SETTINGS, fetchText });
    expect(p).toMatchObject({ output: 'mp4', scale: { w: 640, h: 360 } });
    expect(p.direct).toBeUndefined();
  });

  it('refuses to shrink a file too big to work on in memory', async () => {
    await expect(buildPlan(file('huge', 3840, 2160, 4e9), { mode: 'video', scale: 360, settings: DEFAULT_SETTINGS, fetchText })).rejects.toThrow('too_large');
  });

  it('ignores shrinking for audio', async () => {
    const p = await buildPlan(file('hd', 1280, 720, 9e8), { mode: 'audio', scale: 360, format: 'mp3', settings: DEFAULT_SETTINGS, fetchText });
    expect(p.scale).toBeUndefined();
  });
});
