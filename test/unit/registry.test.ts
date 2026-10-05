import { beforeEach, describe, expect, it } from 'vitest';
import { Registry, type KV } from '../../src/background/registry';
import type { MediaItem } from '../../src/shared/types';

class MemKV implements KV {
  data = new Map<string, unknown>();
  async get(key: string) {
    return structuredClone(this.data.get(key));
  }
  async set(key: string, value: unknown) {
    this.data.set(key, structuredClone(value));
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}

const item = (over: Partial<MediaItem>): MediaItem => ({
  id: 'x',
  tabId: 1,
  frameUrl: 'https://site.com/',
  pageUrl: 'https://site.com/',
  kind: 'file',
  url: 'https://cdn.com/a.mp4',
  title: '',
  variants: [],
  audioTracks: [],
  protection: 'none',
  live: false,
  detectedAt: 1,
  ...over,
});

describe('Registry', () => {
  let kv: MemKV;
  let reg: Registry;
  beforeEach(() => {
    kv = new MemKV();
    reg = new Registry(kv);
  });

  it('dedupes by id and reports changes', async () => {
    expect(await reg.upsert(1, item({ id: 'a' }))).toBe(true);
    expect(await reg.upsert(1, item({ id: 'a' }))).toBe(false);
    expect(await reg.upsert(1, item({ id: 'a', size: 10 }))).toBe(true);
    const items = await reg.get(1);
    expect(items).toHaveLength(1);
    expect(items[0]!.size).toBe(10);
  });

  it('survives a service worker restart', async () => {
    await reg.upsert(1, item({ id: 'a' }));
    const fresh = new Registry(kv);
    expect((await fresh.get(1)).map((i) => i.id)).toEqual(['a']);
  });

  it('lets a master playlist absorb its media playlists (both orders)', async () => {
    const media = item({ id: 'm', kind: 'hls', url: 'https://cdn.com/720/index.m3u8' });
    const master = item({
      id: 'M',
      kind: 'hls',
      url: 'https://cdn.com/master.m3u8',
      variants: [{ id: 'v', label: '720p', url: 'https://cdn.com/720/index.m3u8' }],
      audioTracks: [{ id: 'a', label: 'en', url: 'https://cdn.com/audio.m3u8' }],
    });
    await reg.upsert(1, media);
    await reg.upsert(1, master);
    expect((await reg.get(1)).map((i) => i.id)).toEqual(['M']);
    // media arriving after the master is ignored, audio renditions too
    expect(await reg.upsert(1, media)).toBe(false);
    expect(await reg.upsert(1, item({ id: 'au', kind: 'hls', url: 'https://cdn.com/audio.m3u8' }))).toBe(false);
    expect((await reg.get(1)).map((i) => i.id)).toEqual(['M']);
  });

  it('marks capture items of DRM frames as protected, including later ones and other frames untouched', async () => {
    await reg.upsert(1, item({ id: 'c1', kind: 'capture', frameUrl: 'https://player.com/' }));
    await reg.markFrameDrm(1, 'https://player.com/');
    await reg.upsert(1, item({ id: 'c2', kind: 'capture', frameUrl: 'https://player.com/' }));
    await reg.upsert(1, item({ id: 'f', kind: 'file', frameUrl: 'https://other.com/' }));
    const byId = Object.fromEntries((await reg.get(1)).map((i) => [i.id, i.protection]));
    expect(byId).toEqual({ c1: 'drm', c2: 'drm', f: 'none' });
  });

  it('absorbs renditions hidden from the quality list (same label) too', async () => {
    const master = item({
      id: 'm',
      kind: 'hls',
      url: 'https://cdn.com/master.m3u8',
      variants: [{ id: 'a', label: '720p', url: 'https://cdn.com/720a.m3u8' }],
      related: ['https://cdn.com/720a.m3u8', 'https://cdn.com/720b.m3u8'],
    });
    await reg.upsert(1, item({ id: 'b-first', kind: 'hls', url: 'https://cdn.com/720b.m3u8' }));
    await reg.upsert(1, master);
    await reg.upsert(1, item({ id: 'b-later', kind: 'hls', url: 'https://cdn.com/720b.m3u8#t' }));
    expect((await reg.get(1)).map((i) => i.id)).toEqual(['m']);
  });

  it('never offers playback capture in frames that streamed from a blocked host', async () => {
    await reg.upsert(1, item({ id: 'c1', kind: 'capture', frameUrl: 'https://mirror.com/' }));
    await reg.blockFrame(1, 'https://mirror.com/');
    await reg.upsert(1, item({ id: 'c2', kind: 'capture', frameUrl: 'https://mirror.com/' }));
    await reg.upsert(1, item({ id: 'other', kind: 'capture', frameUrl: 'https://site.com/' }));
    expect((await reg.get(1)).map((i) => i.id)).toEqual(['other']);
    await reg.clear(1);
    await reg.upsert(1, item({ id: 'c3', kind: 'capture', frameUrl: 'https://mirror.com/' }));
    expect((await reg.get(1)).map((i) => i.id)).toEqual(['c3']);
  });

  it('hides hover previews, including their redirected CDN copy (same frame, same length)', async () => {
    await reg.upsert(1, item({ id: 'real', url: 'https://cdn.com/movie.mp4', duration: 600, size: 9e8 }));
    await reg.upsert(1, item({ id: 'dom', url: 'https://director.com/teaser.mp4?sec=1' }));
    await reg.addPreviews(1, [{ url: 'https://director.com/teaser.mp4?sec=1', frameUrl: 'https://site.com/', duration: 12 }]);
    await reg.upsert(1, item({ id: 'net', url: 'https://vod.cdn.com/sec(x)/teaser.mp4', duration: 12.04, size: 1e6 }));
    await reg.upsert(1, item({ id: 'other', url: 'https://vod.cdn.com/other.mp4', duration: 40, size: 5e6 }));
    expect((await reg.get(1)).map((i) => i.id)).toEqual(['real', 'other']);
  });

  it('marks everything a DRM frame loads as protected (Prime Video style files)', async () => {
    await reg.upsert(1, item({ id: 'v', kind: 'file', frameUrl: 'https://player.com/' }));
    await reg.markFrameDrm(1, 'https://player.com/');
    await reg.upsert(1, item({ id: 'a', kind: 'file', url: 'https://cdn.com/a.mp4', frameUrl: 'https://player.com/' }));
    expect((await reg.get(1)).map((i) => i.protection)).toEqual(['drm', 'drm']);
  });

  it('never titles a video with an id-like file name', async () => {
    await reg.upsert(1, item({ id: 'u', url: 'https://cdn.com/6009f11e-0ca6-419b-b944-4857d0ad452a_video_11.mp4' }));
    expect((await reg.get(1, 'The Boys – S4E2'))[0]!.title).toBe('The Boys – S4E2');
    expect((await reg.get(1))[0]!.title).toBe('site.com');
  });

  it('falls back to a still grabbed from the frame player', async () => {
    await reg.upsert(1, item({ id: 'h', kind: 'hls', frameUrl: 'https://player.com/' }));
    await reg.setFrameThumb(1, 'https://player.com/', 'data:image/jpeg;base64,AAA');
    expect((await reg.get(1))[0]!.thumbnail).toBe('data:image/jpeg;base64,AAA');
    await reg.setPageInfo(1, { thumbnail: 'https://site.com/og.jpg' });
    expect((await reg.get(1))[0]!.thumbnail).toBe('https://site.com/og.jpg');
  });

  it('fills missing titles from page info and url', async () => {
    await reg.upsert(1, item({ id: 'a', url: 'https://cdn.com/path/My%20Clip.mp4?x=1' }));
    expect((await reg.get(1))[0]!.title).toBe('My Clip');
    await reg.setPageInfo(1, { title: 'Page title', thumbnail: 'https://site.com/t.jpg' });
    const got = (await reg.get(1))[0]!;
    expect(got.title).toBe('Page title');
    expect(got.thumbnail).toBe('https://site.com/t.jpg');
  });

  it('keeps explicit titles', async () => {
    await reg.upsert(1, item({ id: 'a', title: 'Explicit' }));
    await reg.setPageInfo(1, { title: 'Page title' });
    expect((await reg.get(1))[0]!.title).toBe('Explicit');
  });

  it('offers a file its own <track>s, and a frame’s only player the subtitle files it loaded', async () => {
    await reg.upsert(1, item({ id: 'f', url: 'https://cdn.com/a.mp4' }));
    await reg.setVideoSubs(1, 'https://cdn.com/a.mp4', [{ id: 's', url: 'https://cdn.com/a.fr.vtt', label: 'Français', lang: 'fr' }]);
    expect((await reg.get(1))[0]!.subtitles?.map((s) => s.label)).toEqual(['Français']);

    await reg.upsert(1, item({ id: 'c', kind: 'capture', url: undefined, frameUrl: 'https://player.com/' }));
    await reg.addFrameSub(1, 'https://player.com/', 'https://cdn.com/subs/movie_en.vtt');
    // A stream's subtitle segments: many files alike, not offered one by one.
    for (let i = 0; i < 4; i++) await reg.addFrameSub(1, 'https://player.com/', `https://cdn.com/seg/sub_${i}.vtt`);
    const capture = (await reg.get(1)).find((i) => i.id === 'c')!;
    expect(capture.subtitles?.map((s) => [s.label, s.lang])).toEqual([['movie_en', 'en']]);

    // Two players in the frame: no telling whose subtitles they are.
    await reg.upsert(1, item({ id: 'c2', kind: 'capture', url: undefined, frameUrl: 'https://player.com/', detectedAt: 2 }));
    expect((await reg.get(1)).find((i) => i.id === 'c')!.subtitles).toBeUndefined();
  });

  it('caps items per tab, dropping the oldest', async () => {
    for (let i = 0; i < 60; i++) await reg.upsert(1, item({ id: `i${i}`, detectedAt: i }));
    const items = await reg.get(1);
    expect(items).toHaveLength(40);
    expect(items[0]!.id).toBe('i20');
  });

  it('clears and removes tabs, notifying listeners', async () => {
    const seen: number[] = [];
    reg.onChange((tabId) => seen.push(tabId));
    await reg.upsert(2, item({ id: 'a', tabId: 2 }));
    await reg.clear(2);
    expect(await reg.get(2)).toEqual([]);
    await reg.remove(2);
    expect(kv.data.has('tab:2')).toBe(false);
    expect(seen).toEqual([2, 2, 2]);
  });
});
