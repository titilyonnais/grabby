import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../../src/background/plan';
import { classify } from '../../src/parsers/classify';
import { sniffMedia } from '../../src/parsers/sniff';
import { rank } from '../../src/shared/rank';
import { AUDIO_FORMATS, isAudioFormat, sourceFormat, videoFormatsFor } from '../../src/shared/formats';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { MediaItem } from '../../src/shared/types';

const head = (f: string) => new Uint8Array(readFileSync(`test/fixtures/media/${f}`)).subarray(0, 262144);

describe('videoFormatsFor', () => {
  it('offers every container for H.264 and unknown sources, but not WebM', () => {
    expect(videoFormatsFor('avc1.64001f,mp4a.40.2')).toEqual(['mp4', 'mkv', 'mov', 'avi', 'ts']);
    expect(videoFormatsFor('')).toEqual(['mp4', 'mkv', 'mov', 'avi', 'ts']);
  });
  it('offers MP4, WebM and MKV for VP9/AV1 (no re-encoding)', () => {
    expect(videoFormatsFor('vp09.00.10.08,opus')).toEqual(['mp4', 'webm', 'mkv']);
    expect(videoFormatsFor('av01.0.05M.08')).toEqual(['mp4', 'webm', 'mkv']);
  });
  it('lists six audio formats', () => {
    expect(AUDIO_FORMATS).toHaveLength(6);
    expect(isAudioFormat('flac')).toBe(true);
    expect(isAudioFormat('mp4')).toBe(false);
  });
});

describe('sourceFormat', () => {
  it.each([
    ['mp4', undefined, 'mp4'],
    ['m4v', undefined, 'mp4'],
    ['webm', undefined, 'webm'],
    ['', 'video/quicktime', 'mov'],
    ['', 'audio/mpeg', 'mp3'],
    ['php', 'application/octet-stream', undefined],
  ] as const)('%s %s → %s', (ext, mime, out) => expect(sourceFormat(ext, mime)).toBe(out));
});

describe('stream segments are not files', () => {
  it('rejects fMP4 segments, keeps whole and fragmented files', () => {
    expect(sniffMedia(head('dash/chunk-stream0-00002.m4s'))).toBeNull();
    expect(sniffMedia(head('hls-fmp4/seg1.m4s'))).toBeNull();
    expect(sniffMedia(head('sample.mp4'))).toMatchObject({ container: 'mp4', duration: 6, width: 640, height: 360 });
    expect(sniffMedia(head('sample.webm'))).toMatchObject({ container: 'webm', width: 640, height: 360 });
    expect(sniffMedia(head('mse/video.mp4'))).toMatchObject({ container: 'mp4' });
  });
});

describe('classify — what players load', () => {
  it('takes anything a <video> loads, or a page names, whatever its type says', () => {
    expect(classify({ url: 'https://a.com/get?id=3', contentType: 'application/octet-stream', requestType: 'media' })).toBe('file');
    expect(classify({ url: 'https://a.com/v/123', requestType: 'declared' })).toBe('file');
  });
  it('still ignores pages, scripts and unnamed downloads', () => {
    expect(classify({ url: 'https://a.com/v/123', contentType: 'text/html', requestType: 'declared' })).toBeNull();
    expect(classify({ url: 'https://a.com/get?id=3', contentType: 'application/octet-stream', requestType: 'xmlhttprequest' })).toBeNull();
    expect(classify({ url: 'https://a.com/seg-1.m4s', requestType: 'media' })).toBeNull();
  });
});

const item = (over: Partial<MediaItem>): MediaItem => ({
  id: 'x',
  tabId: 1,
  frameUrl: 'https://site.com/',
  pageUrl: 'https://site.com/watch',
  kind: 'file',
  url: 'https://cdn.com/clip.webm',
  title: 't',
  variants: [],
  audioTracks: [],
  protection: 'none',
  live: false,
  detectedAt: 0,
  ...over,
});
const fetchText = async () => '';

describe('buildPlan — direct files', () => {
  it('downloads the file as is when it already has the chosen format', async () => {
    const p = await buildPlan(item({}), { mode: 'video', format: 'webm', settings: DEFAULT_SETTINGS, fetchText });
    expect(p).toMatchObject({ kind: 'file', output: 'webm', direct: true });
  });
  it('converts it otherwise (WebM → MP4, or audio as FLAC)', async () => {
    const mp4 = await buildPlan(item({}), { mode: 'video', format: 'mp4', settings: DEFAULT_SETTINGS, fetchText });
    expect(mp4.output).toBe('mp4');
    expect(mp4.direct).toBeUndefined();
    const flac = await buildPlan(item({}), { mode: 'audio', format: 'flac', settings: DEFAULT_SETTINGS, fetchText });
    expect(flac).toMatchObject({ output: 'flac', audioOnly: true });
    expect(flac.direct).toBeUndefined();
  });
  it('saves very large files as they are (conversion works in memory)', async () => {
    const p = await buildPlan(item({ size: 3e9 }), { mode: 'video', format: 'mkv', settings: DEFAULT_SETTINGS, fetchText });
    expect(p).toMatchObject({ output: 'webm', direct: true });
  });
  it('uses the settings when no format is given', async () => {
    const p = await buildPlan(item({ url: 'https://cdn.com/a.mp4' }), { mode: 'video', settings: DEFAULT_SETTINGS, fetchText });
    expect(p).toMatchObject({ output: 'mp4', direct: true });
  });
});

describe('rank', () => {
  it('puts the full-length playing video first, linked files and short clips after', () => {
    const items = [
      item({ id: 'teaser', url: 'https://a/t.mp4', duration: 6, size: 9e6 }),
      item({ id: 'link', url: 'https://a/l.mp4', duration: 900, size: 9e8, linked: true }),
      item({ id: 'main', url: 'https://a/m.mp4', duration: 600, size: 1e8 }),
      item({ id: 'drm', url: 'https://a/d.mp4', duration: 3000, protection: 'drm' }),
    ];
    expect(rank(items).map((i) => i.id)).toEqual(['main', 'link', 'teaser', 'drm']);
  });
});
