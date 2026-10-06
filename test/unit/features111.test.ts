import { afterEach, describe, expect, it } from 'vitest';
import { channelProfile } from '../../src/shared/feeds';
import { forgetForcedQuality } from '../../src/features/youtube';
import { PLAYER_MEMORY, shieldPlayerMemory } from '../../src/features/youtube-hook';
import { jobThumb, ytTitle } from '../../src/shared/title';
import { LIST_DEFAULT, LIST_QUALITIES, listItem, listQuality } from '../../src/shared/ytlist';

/** A Storage like the browser's: its methods live on the prototype, shared by every instance. */
class MemoryStorage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
  clear() {
    this.items.clear();
  }
}
const saved = { ...Object.getOwnPropertyDescriptors(MemoryStorage.prototype) };
afterEach(() => {
  for (const k of ['getItem', 'setItem', 'removeItem'] as const) Object.defineProperty(MemoryStorage.prototype, k, saved[k]!);
});
const storage = () => new MemoryStorage() as unknown as Storage;
const quality = (q: number) => JSON.stringify({ data: JSON.stringify({ quality: q, previousQuality: 1080 }), creation: 1, expiration: 2 });

describe('hidden player keeps its quality to itself', () => {
  it('matches the player memory keys only', () => {
    expect(PLAYER_MEMORY.test('yt-player-quality')).toBe(true);
    expect(PLAYER_MEMORY.test('yt-player-bandwidth')).toBe(true);
    expect(PLAYER_MEMORY.test('yt-remote-device-id')).toBe(false);
  });

  it("never writes the player's choices to the shared storage", () => {
    const shared = storage();
    shared.setItem('yt-player-quality', quality(1080));
    const own = shieldPlayerMemory(shared);
    shared.setItem('yt-player-quality', quality(144));
    shared.setItem('yt-player-bandwidth', '{"data":"1"}');
    // The player reads back what it wrote...
    expect(shared.getItem('yt-player-quality')).toBe(quality(144));
    expect(own.get('yt-player-quality')).toBe(quality(144));
    // ...but the user's own choice stays where the user's tabs read it.
    expect((saved.getItem!.value as Storage['getItem']).call(shared, 'yt-player-quality')).toBe(quality(1080));
    expect((saved.getItem!.value as Storage['getItem']).call(shared, 'yt-player-bandwidth')).toBeNull();
  });

  it('reads the real value until the player sets its own, and removes only its own', () => {
    const shared = storage();
    shared.setItem('yt-player-volume', '{"data":"50"}');
    shieldPlayerMemory(shared);
    expect(shared.getItem('yt-player-volume')).toBe('{"data":"50"}');
    shared.removeItem('yt-player-volume');
    expect(shared.getItem('yt-player-volume')).toBeNull();
    // Other keys and other storages are untouched.
    shared.setItem('other', 'x');
    expect(shared.getItem('other')).toBe('x');
    const another = storage();
    another.setItem('yt-player-quality', quality(720));
    expect(another.getItem('yt-player-quality')).toBe(quality(720));
  });
});

describe('repairing a quality forced by an older version', () => {
  it('forgets 144p only', () => {
    const s = storage();
    s.setItem('yt-player-quality', quality(144));
    expect(forgetForcedQuality(s)).toBe(true);
    expect(s.getItem('yt-player-quality')).toBeNull();
    s.setItem('yt-player-quality', quality(720));
    expect(forgetForcedQuality(s)).toBe(false);
    expect(s.getItem('yt-player-quality')).toBe(quality(720));
  });

  it('accepts an object as data and ignores anything unreadable', () => {
    const s = storage();
    s.setItem('yt-player-quality', JSON.stringify({ data: { quality: 144 } }));
    expect(forgetForcedQuality(s)).toBe(true);
    s.setItem('yt-player-quality', 'not json');
    expect(forgetForcedQuality(s)).toBe(false);
    expect(forgetForcedQuality(storage())).toBe(false);
  });
});

describe('titles and pictures of jobs', () => {
  it("takes the player's title when it is about this video", () => {
    expect(ytTitle({ id: 'abc', title: 'YouTube' }, { id: 'abc', title: ' Ma vidéo ' })).toBe('Ma vidéo');
    expect(ytTitle({ id: 'abc', title: 'Le titre de la page' }, { id: 'other', title: 'Une autre' })).toBe('Le titre de la page');
  });

  it('never names a video just "YouTube"', () => {
    expect(ytTitle({ id: 'abc', title: 'YouTube' })).toBe('YouTube abc');
    expect(ytTitle({ id: 'abc', title: '' })).toBe('YouTube abc');
    expect(ytTitle({ id: 'abc', title: 'youtube ' }, { id: 'abc', title: '  ' })).toBe('YouTube abc');
  });

  it('keeps pictures that are addresses or small', () => {
    expect(jobThumb('https://i.ytimg.com/vi/x/mqdefault.jpg')).toBe('https://i.ytimg.com/vi/x/mqdefault.jpg');
    expect(jobThumb('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
    expect(jobThumb('http://example.com/a.jpg')).toBeUndefined();
    expect(jobThumb('javascript:alert(1)')).toBeUndefined();
    expect(jobThumb(`data:image/png;base64,${'A'.repeat(70_000)}`)).toBeUndefined();
    expect(jobThumb(`https://x.com/${'a'.repeat(2100)}`)).toBeUndefined();
    expect(jobThumb(undefined)).toBeUndefined();
  });
});

describe('lists up to 4K', () => {
  it('offers 2160p and 1440p, 1080p by default', () => {
    expect(LIST_QUALITIES.map((q) => q.height)).toEqual([2160, 1440, 1080, 720, 480, 360]);
    expect(LIST_DEFAULT).toBe('hd1080');
    expect(listQuality('hd2160').height).toBe(2160);
    expect(listQuality('nope').id).toBe(LIST_DEFAULT);
  });

  it('asks for VP9 above 1080p, H.264 up to it', () => {
    const entry = { id: 'dQw4w9WgXcQ', title: 'Une vidéo' };
    expect(listItem(entry, 1, 'hd2160').variants[0]).toMatchObject({ height: 2160, codecs: 'vp9' });
    expect(listItem(entry, 1, 'hd1440').variants[0]).toMatchObject({ height: 1440, codecs: 'vp9' });
    expect(listItem(entry, 1, 'hd1080').variants[0]).toMatchObject({ height: 1080, codecs: 'avc1' });
    expect(listItem(entry, 1, 'hd720').variants[0]!.codecs).toBe('avc1');
  });
});

describe("a channel's profile", () => {
  const page = (subtitle: string) =>
    [
      '<html><head>',
      '<meta property="og:title" content="Lofi Girl">',
      '<meta property="og:image" content="https://yt3.googleusercontent.com/abc=s900-c-k-c0x00ffffff-no-rj">',
      '<meta property="og:description" content="Tune in &amp; relax">',
      '</head><body><script>var ytInitialData = {"metadata":{"channelMetadataRenderer":{"vanityChannelUrl":"http://www.youtube.com/@LofiGirl"}},',
      // Other channels listed on the page come first: they must not be taken.
      '"items":[{"subtitle":{"content":"@Other • 3 M d’abonnés"}}],',
      `"header":{"subtitle":{"content":"${subtitle}"}}}</script></body></html>`,
    ].join('');

  it('reads the picture, @name, subscribers and description', () => {
    expect(channelProfile(page('@LofiGirl • 15,8 M d’abonnés'))).toEqual({
      title: 'Lofi Girl',
      avatar: 'https://yt3.googleusercontent.com/abc=s176-c-k-c0x00ffffff-no-rj',
      handle: '@LofiGirl',
      subscribers: '15,8 M d’abonnés',
      description: 'Tune in & relax',
    });
  });

  it('strips the invisible direction marks', () => {
    expect(channelProfile(page('⁨@LofiGirl⁩ • ‎15,8 M d’abonnés‏')).subscribers).toBe('15,8 M d’abonnés');
  });

  it('keeps pictures from YouTube only, and nothing without digits as subscribers', () => {
    const other = page('@LofiGirl • aucun').replace('https://yt3.googleusercontent.com/', 'https://evil.example/');
    const p = channelProfile(other);
    expect(p.avatar).toBeUndefined();
    expect(p.subscribers).toBeUndefined();
    expect(p.handle).toBe('@LofiGirl');
    expect(channelProfile('<html></html>')).toEqual({});
  });
});
