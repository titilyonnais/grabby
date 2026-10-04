import { describe, expect, it } from 'vitest';
import { buildPlan, PlanError } from '../../src/background/plan';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { MediaItem } from '../../src/shared/types';

const base = (over: Partial<MediaItem>): MediaItem => ({
  id: 'x',
  tabId: 1,
  frameUrl: 'https://site.com/',
  pageUrl: 'https://site.com/watch',
  kind: 'hls',
  url: 'https://cdn.com/master.m3u8',
  title: 't',
  variants: [],
  audioTracks: [],
  protection: 'none',
  live: false,
  detectedAt: 0,
  ...over,
});

const media = (seg: string, extra = '') =>
  `#EXTM3U\n${extra}#EXTINF:4,\n${seg}0\n#EXTINF:4,\n${seg}1\n#EXT-X-ENDLIST\n`;

function fetcher(map: Record<string, string>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const v = map[url];
    if (v === undefined) throw new Error(`unexpected fetch ${url}`);
    return v;
  };
  return Object.assign(fn, { calls });
}

const hlsItem = base({
  variants: [
    { id: 'hi', label: '1080p', height: 1080, bandwidth: 5_000_000, url: 'https://cdn.com/hi.m3u8', audioGroup: 'aud' },
    { id: 'lo', label: '360p', height: 360, bandwidth: 500_000, url: 'https://cdn.com/lo.m3u8', audioGroup: 'aud' },
  ],
  audioTracks: [
    { id: 'en', label: 'English', url: 'https://cdn.com/en.m3u8', groupId: 'aud', isDefault: true },
    { id: 'fr', label: 'Français', url: 'https://cdn.com/fr.m3u8', groupId: 'aud' },
  ],
  duration: 8,
});

describe('buildPlan — HLS', () => {
  it('defaults to the first (best) variant and its default audio rendition', async () => {
    const f = fetcher({
      'https://cdn.com/hi.m3u8': media('v.ts?'),
      'https://cdn.com/en.m3u8': media('a.aac?'),
    });
    const p = await buildPlan(hlsItem, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText: f });
    expect(p.kind).toBe('stream');
    expect(p.output).toBe('mp4');
    expect(p.video!.container).toBe('ts');
    expect(p.video!.segments.map((s) => s.url)).toEqual(['https://cdn.com/v.ts?0', 'https://cdn.com/v.ts?1']);
    expect(p.audio!.segments.map((s) => s.url)).toEqual(['https://cdn.com/a.aac?0', 'https://cdn.com/a.aac?1']);
    expect(p.estimatedSize).toBe(5_000_000);
    expect(p.raw).toBe(false);
    expect(p.audioOnly).toBe(false);
  });

  it('honours the selected variant', async () => {
    const f = fetcher({ 'https://cdn.com/lo.m3u8': media('lo'), 'https://cdn.com/en.m3u8': media('a') });
    const p = await buildPlan(hlsItem, { mode: 'video', variantId: 'lo', settings: DEFAULT_SETTINGS, fetchText: f });
    expect(p.video!.segments[0]!.url).toBe('https://cdn.com/lo0');
  });

  it('audio mode downloads only the audio rendition, as mp3 when configured', async () => {
    const f = fetcher({ 'https://cdn.com/en.m3u8': media('a') });
    const p = await buildPlan(hlsItem, { mode: 'audio', settings: { ...DEFAULT_SETTINGS, audioFormat: 'mp3' }, fetchText: f });
    expect(p.audioOnly).toBe(true);
    expect(p.output).toBe('mp3');
    expect(p.video).toBeUndefined();
    expect(p.audio!.segments).toHaveLength(2);
    expect(f.calls).toEqual(['https://cdn.com/en.m3u8']);
  });

  it('audio mode without separate audio uses the lightest variant', async () => {
    const item = base({ ...hlsItem, audioTracks: [] });
    const f = fetcher({ 'https://cdn.com/lo.m3u8': media('lo') });
    const p = await buildPlan(item, { mode: 'audio', settings: DEFAULT_SETTINGS, fetchText: f });
    expect(p.output).toBe('m4a');
    expect(p.video!.segments[0]!.url).toBe('https://cdn.com/lo0');
  });

  it('uses the item url when there is no master', async () => {
    const item = base({ url: 'https://cdn.com/only.m3u8' });
    const f = fetcher({ 'https://cdn.com/only.m3u8': media('s', '#EXT-X-MAP:URI="init.mp4"\n') });
    const p = await buildPlan(item, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText: f });
    expect(p.video!.container).toBe('fmp4');
    expect(p.video!.init).toEqual({ url: 'https://cdn.com/init.mp4' });
  });

  it('refuses encrypted and live playlists', async () => {
    const item = base({ url: 'https://cdn.com/e.m3u8' });
    const enc = fetcher({ 'https://cdn.com/e.m3u8': media('s', '#EXT-X-KEY:METHOD=AES-128,URI="k"\n') });
    await expect(buildPlan(item, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText: enc })).rejects.toMatchObject({ code: 'protected' });
    const live = fetcher({ 'https://cdn.com/e.m3u8': '#EXTM3U\n#EXTINF:4,\na.ts\n' });
    await expect(buildPlan(item, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText: live })).rejects.toBeInstanceOf(PlanError);
  });

  it('refuses items already flagged as protected without fetching', async () => {
    const f = fetcher({});
    await expect(
      buildPlan(base({ protection: 'drm' }), { mode: 'video', settings: DEFAULT_SETTINGS, fetchText: f }),
    ).rejects.toMatchObject({ code: 'protected' });
    expect(f.calls).toEqual([]);
  });

  it('switches to raw mode above 1.5 GB when there is no separate audio', async () => {
    const item = base({
      variants: [{ id: 'hi', label: '4K', bandwidth: 20_000_000, url: 'https://cdn.com/hi.m3u8' }],
    });
    const f = fetcher({ 'https://cdn.com/hi.m3u8': media('v').replaceAll('#EXTINF:4,', '#EXTINF:1800,') });
    const p = await buildPlan(item, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText: f });
    expect(p.raw).toBe(true);
    expect(p.output).toBe('ts');
  });

  it('refuses public playlists whose segments point into the local network', async () => {
    const f = fetcher({ 'https://cdn.com/hi.m3u8': media('http://192.168.1.1/v'), 'https://cdn.com/en.m3u8': media('a') });
    await expect(buildPlan(hlsItem, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText: f })).rejects.toMatchObject({ code: 'unknown' });
  });

  it('refuses to assemble huge streams with separate audio instead of crashing ffmpeg', async () => {
    const long = (s: string) => media(s).replaceAll('#EXTINF:4,', '#EXTINF:1800,');
    const f = fetcher({ 'https://cdn.com/hi.m3u8': long('v'), 'https://cdn.com/en.m3u8': long('a') });
    const item = { ...hlsItem, variants: [{ ...hlsItem.variants[0]!, bandwidth: 20_000_000 }] };
    await expect(buildPlan(item, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText: f })).rejects.toMatchObject({ code: 'too_large' });
  });
});

const MPD = `<MPD mediaPresentationDuration="PT4S"><Period>
  <AdaptationSet contentType="video" mimeType="video/mp4">
    <SegmentTemplate initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Number$.m4s" duration="2" startNumber="1"/>
    <Representation id="v1" bandwidth="3000000" height="720" codecs="avc1.64001f"/>
    <Representation id="v2" bandwidth="800000" height="360" codecs="avc1.4d401e"/>
  </AdaptationSet>
  <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="en">
    <SegmentTemplate initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Number$.m4s" duration="2" startNumber="1"/>
    <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2"/>
  </AdaptationSet>
</Period></MPD>`;

describe('buildPlan — DASH', () => {
  const item = base({
    kind: 'dash',
    url: 'https://cdn.com/d/manifest.mpd',
    variants: [
      { id: 'v1', label: '720p', url: 'https://cdn.com/d/manifest.mpd' },
      { id: 'v2', label: '360p', url: 'https://cdn.com/d/manifest.mpd' },
    ],
    audioTracks: [{ id: 'a1', label: 'en', url: 'https://cdn.com/d/manifest.mpd' }],
  });

  it('builds video + audio fMP4 tracks', async () => {
    const f = fetcher({ 'https://cdn.com/d/manifest.mpd': MPD });
    const p = await buildPlan(item, { mode: 'video', variantId: 'v2', settings: DEFAULT_SETTINGS, fetchText: f });
    expect(p.video!.container).toBe('fmp4');
    expect(p.video!.init!.url).toBe('https://cdn.com/d/v2/init.mp4');
    expect(p.video!.segments.map((s) => s.url)).toEqual(['https://cdn.com/d/v2/1.m4s', 'https://cdn.com/d/v2/2.m4s']);
    expect(p.audio!.init!.url).toBe('https://cdn.com/d/a1/init.mp4');
    expect(p.audio!.codecs).toBe('mp4a.40.2');
    expect(p.output).toBe('mp4');
  });

  it('audio mode picks only the audio representation', async () => {
    const f = fetcher({ 'https://cdn.com/d/manifest.mpd': MPD });
    const p = await buildPlan(item, { mode: 'audio', settings: DEFAULT_SETTINGS, fetchText: f });
    expect(p.video).toBeUndefined();
    expect(p.audio!.segments).toHaveLength(2);
    expect(p.output).toBe('m4a');
  });

  it('applies the size limit to DASH: raw for a single track, refused when audio must be merged', async () => {
    const long = MPD.replace('PT4S', 'PT2H');
    const f = fetcher({ 'https://cdn.com/d/manifest.mpd': long });
    await expect(buildPlan(item, { mode: 'video', variantId: 'v1', settings: DEFAULT_SETTINGS, fetchText: f })).rejects.toMatchObject({
      code: 'too_large',
    });
    const videoOnly = long.replace(/<AdaptationSet contentType="audio"[\s\S]*?<\/AdaptationSet>/, '');
    const g = fetcher({ 'https://cdn.com/d/manifest.mpd': videoOnly });
    const p = await buildPlan(item, { mode: 'video', variantId: 'v1', settings: DEFAULT_SETTINGS, fetchText: g });
    expect(p.raw).toBe(true);
    expect(p.output).toBe('mp4');
  });

  it('refuses protected manifests', async () => {
    const f = fetcher({ 'https://cdn.com/d/manifest.mpd': MPD.replace('<AdaptationSet contentType="video"', '<AdaptationSet contentType="video"><ContentProtection schemeIdUri="x"/></AdaptationSet><AdaptationSet contentType="video"') });
    await expect(buildPlan(item, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText: f })).rejects.toMatchObject({ code: 'protected' });
  });
});

describe('buildPlan — files and capture', () => {
  it('audio extraction from a direct video file', async () => {
    const item = base({ kind: 'file', url: 'https://cdn.com/v.webm', mime: 'video/webm' });
    const p = await buildPlan(item, { mode: 'audio', settings: DEFAULT_SETTINGS, fetchText: fetcher({}) });
    expect(p).toMatchObject({ kind: 'file', audioOnly: true, output: 'm4a' });
    expect(p.video!.segments).toEqual([{ url: 'https://cdn.com/v.webm' }]);
  });

  it('capture plans defer container choice to the assembler', async () => {
    const item = base({ kind: 'capture', url: 'https://site.com/' });
    const p = await buildPlan(item, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText: fetcher({}) });
    expect(p).toMatchObject({ kind: 'capture', output: 'mp4', audioOnly: false });
  });
});
