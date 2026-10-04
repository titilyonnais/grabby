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

  it('marks capture items of DRM frames as protected, including later ones', async () => {
    await reg.upsert(1, item({ id: 'c1', kind: 'capture', frameUrl: 'https://player.com/' }));
    await reg.markFrameDrm(1, 'https://player.com/');
    await reg.upsert(1, item({ id: 'c2', kind: 'capture', frameUrl: 'https://player.com/' }));
    await reg.upsert(1, item({ id: 'f', kind: 'file', frameUrl: 'https://player.com/' }));
    const byId = Object.fromEntries((await reg.get(1)).map((i) => [i.id, i.protection]));
    expect(byId).toEqual({ c1: 'drm', c2: 'drm', f: 'none' });
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
