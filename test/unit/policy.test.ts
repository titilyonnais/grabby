import { describe, expect, it } from 'vitest';
import { isYouTubeUrl } from '../../src/shared/policy';

describe('isYouTubeUrl', () => {
  it.each([
    'https://www.youtube.com/watch?v=abc',
    'https://youtube.com/shorts/x',
    'https://m.youtube.com/',
    'https://music.youtube.com/',
    'https://youtu.be/abc',
    'https://www.youtube-nocookie.com/embed/abc',
    'https://rr3---sn-abc.googlevideo.com/videoplayback?x=1',
    'https://i.ytimg.com/vi/abc/hqdefault.jpg',
    'https://www.youtubekids.com/watch?v=abc',
  ])('matches %s', (u) => expect(isYouTubeUrl(u)).toBe(true));

  it.each([
    'https://notyoutube.com/',
    'https://youtube.com.evil.io/',
    'https://www.dailymotion.com/video/x1',
    'not a url',
    '',
  ])('does not match %s', (u) => expect(isYouTubeUrl(u)).toBe(false));
});
