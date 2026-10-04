import { describe, expect, it } from 'vitest';
import { isAdUrl } from '../../src/parsers/adhosts';
import { cleanTitle, looksLikeId } from '../../src/shared/title';

describe('cleanTitle', () => {
  it.each([
    ['J’AAAAIIII 😤😤 - Vidéo Dailymotion', 'www.dailymotion.com', 'J’AAAAIIII 😤😤'],
    ['Me at the zoo - YouTube', 'www.youtube.com', 'Me at the zoo'],
    ['Prime Video: The Boys - Saison 4', 'www.primevideo.com', 'The Boys - Saison 4'],
    ['Regarder Le Film | Netflix', 'www.netflix.com', 'Regarder Le Film'],
    ['Épisode 3 – Arte', 'www.arte.tv', 'Épisode 3'],
    ['Journal de 20h | France 2 | francetv', 'www.france.tv', 'Journal de 20h'],
    ['Dailymotion', 'www.dailymotion.com', 'Dailymotion'],
    ['  Plain   title ', 'example.com', 'Plain title'],
  ])('%s', (raw, host, want) => expect(cleanTitle(raw, host)).toBe(want));
});

describe('looksLikeId', () => {
  it.each(['6009f11e-0ca6-419b-b944-4857d0ad452a_video_11', 'a1b2c3d4e5f6a7b8c9d0', 'index', 'master', 'seg-12', '1080', ''])(
    'flags %s',
    (s) => expect(looksLikeId(s)).toBe(true),
  );
  it.each(['Big Buck Bunny', 'mon-film-de-vacances', 'clip_2024_final'])('keeps %s', (s) => expect(looksLikeId(s)).toBe(false));
});

describe('isAdUrl', () => {
  it.each([
    'https://s0.2mdn.net/videoplayback/abc.mp4',
    'https://pubads.g.doubleclick.net/gampad/ads?x=1',
    'https://ads.example.com/creative.mp4',
    'https://imasdk.googleapis.com/js/sdkloader/ima3.js',
    'https://crcdn09.adnxs-simple.com/creative20/p/15410/2024/1/11/53590396/44e36e45.mp4',
  ])('flags %s', (u) => expect(isAdUrl(u)).toBe(true));
  it.each(['https://vod3.cf.dmcdn.net/sec2(x)/video.mp4', 'https://cdn.adorable-cats.com/a.mp4', 'https://www.youtube.com/'])(
    'keeps %s',
    (u) => expect(isAdUrl(u)).toBe(false),
  );
});
