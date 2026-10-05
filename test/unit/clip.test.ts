import { describe, expect, it } from 'vitest';
import { buildPlan, clipTrack, PlanError, validClip } from '../../src/background/plan';
import { muxAttempts } from '../../src/offscreen/args';
import { parseDash } from '../../src/parsers/dash';
import { canClip, clipLabel, clock, parseClock, sameClip } from '../../src/shared/clip';
import { buildFilename } from '../../src/shared/filename';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { MediaItem } from '../../src/shared/types';

const item = (over: Partial<MediaItem>): MediaItem => ({
  id: 'x',
  tabId: 1,
  frameUrl: 'https://site.com/',
  pageUrl: 'https://site.com/watch',
  kind: 'hls',
  url: 'https://cdn.com/v.m3u8',
  title: 't',
  variants: [],
  audioTracks: [],
  protection: 'none',
  live: false,
  detectedAt: 0,
  duration: 60,
  ...over,
});

/** Ten 6-second segments: 0-6, 6-12, … 54-60. */
const playlist = `#EXTM3U\n${Array.from({ length: 10 }, (_, i) => `#EXTINF:6,\ns${i}.ts\n`).join('')}#EXT-X-ENDLIST\n`;
const fetchText = async () => playlist;

describe('times', () => {
  it('shows times like a player', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65)).toBe('1:05');
    expect(clock(3723)).toBe('1:02:03');
  });

  it('reads what the user types', () => {
    expect(parseClock('1:05')).toBe(65);
    expect(parseClock(' 65 ')).toBe(65);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('1.05')).toBe(65);
    expect(parseClock('abc')).toBeNull();
    expect(parseClock('1:2:3:4')).toBeNull();
    expect(parseClock('')).toBeNull();
  });

  it('names a part without the colons Windows refuses', () => {
    expect(clipLabel({ start: 65, end: 160 })).toBe('1m05-2m40');
    expect(clipLabel({ start: 3723, end: 3900 })).toBe('1h02m03-1h05m00');
    const name = buildFilename('{title}', { title: `Film (${clipLabel({ start: 5, end: 30 })})`, site: 's', date: new Date() }, 'mp4');
    expect(name).toBe('Film (0m05-0m30).mp4');
  });

  it('compares parts', () => {
    expect(sameClip(undefined, undefined)).toBe(true);
    expect(sameClip({ start: 1, end: 2 }, { start: 1, end: 2 })).toBe(true);
    expect(sameClip({ start: 1, end: 2 }, undefined)).toBe(false);
  });
});

describe('what can be cut', () => {
  it('any video of known length, recordings included, not a live or a locked one', () => {
    expect(canClip(item({}))).toBe(true);
    expect(canClip(item({ kind: 'file', size: 50e6 }))).toBe(true);
    expect(canClip(item({ kind: 'file', size: 3e9 }))).toBe(false);
    expect(canClip(item({ kind: 'capture' }))).toBe(true);
    expect(canClip(item({ kind: 'capture', duration: 2 }))).toBe(false);
    expect(canClip(item({ live: true }))).toBe(false);
    expect(canClip(item({ protection: 'drm' }))).toBe(false);
    expect(canClip(item({ duration: undefined }))).toBe(false);
  });

  it('keeps a part within the video, a second long at least, and drops one that is all of it', () => {
    expect(validClip({ start: -3, end: 90 }, 60)).toBeUndefined();
    expect(validClip({ start: -3, end: 40 }, 60)).toEqual({ start: 0, end: 40 });
    expect(validClip({ start: 50, end: 90 }, 60)).toEqual({ start: 50, end: 60 });
    expect(validClip({ start: 10, end: 10.5 }, 60)).toBeUndefined();
    expect(validClip({ start: 0, end: 60 }, 60)).toBeUndefined();
    expect(validClip({ start: Number.NaN, end: 4 }, 60)).toBeUndefined();
    expect(validClip({ start: 5, end: 20 }, 60)).toEqual({ start: 5, end: 20 });
  });
});

describe('clipTrack', () => {
  const track = { container: 'ts' as const, segments: Array.from({ length: 10 }, (_, i) => ({ url: `s${i}`, dur: 6 })) };

  it('keeps only the segments the part covers, and where it starts in the first', () => {
    const c = clipTrack(track, { start: 14, end: 25 });
    expect(c.track.segments.map((s) => s.url)).toEqual(['s2', 's3', 's4']);
    expect(c.offset).toBe(2);
  });

  it('a part ending on a segment boundary takes no extra segment', () => {
    expect(clipTrack(track, { start: 6, end: 12 }).track.segments.map((s) => s.url)).toEqual(['s1']);
  });

  it('without durations, keeps everything and cuts from the start', () => {
    const plain = { container: 'file' as const, segments: [{ url: 'f.mp4' }] };
    expect(clipTrack(plain, { start: 30, end: 40 })).toEqual({ track: plain, offset: 30 });
  });
});

describe('buildPlan with a part', () => {
  it('HLS: fetches only the segments of the part, and tells ffmpeg where to cut', async () => {
    const p = await buildPlan(item({}), { mode: 'video', settings: DEFAULT_SETTINGS, fetchText, clip: { start: 20, end: 31 } });
    expect(p.video!.segments.map((s) => s.url)).toEqual(['https://cdn.com/s3.ts', 'https://cdn.com/s4.ts', 'https://cdn.com/s5.ts']);
    expect(p.clip).toEqual({ start: 20, duration: 11, video: 2 });
    expect(p.raw).toBe(false);
  });

  it('the whole video is no part at all', async () => {
    const p = await buildPlan(item({}), { mode: 'video', settings: DEFAULT_SETTINGS, fetchText, clip: { start: 0, end: 60 } });
    expect(p.clip).toBeUndefined();
    expect(p.video!.segments).toHaveLength(10);
  });

  it('a file is fetched whole by Grabby then cut, never saved as is', async () => {
    const file = item({ kind: 'file', url: 'https://cdn.com/v.mp4', size: 40e6, mime: 'video/mp4' });
    const whole = await buildPlan(file, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText });
    expect(whole.direct).toBe(true);
    const p = await buildPlan(file, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText, clip: { start: 15, end: 30 } });
    expect(p.direct).toBeUndefined();
    expect(p.fast).toBeUndefined();
    expect(p.raw).toBe(false);
    expect(p.clip).toEqual({ start: 15, duration: 15, video: 15 });
    expect(p.estimatedSize).toBe(10e6);
  });

  it('a huge file can not be cut', async () => {
    const file = item({ kind: 'file', url: 'https://cdn.com/v.mp4', size: 3e9 });
    await expect(buildPlan(file, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText, clip: { start: 1, end: 9 } })).rejects.toEqual(new PlanError('too_large'));
  });

  it('a part of a huge stream fits in memory: assembled and cut normally', async () => {
    const huge = item({ duration: 60, variants: [{ id: 'v', label: '4K', url: 'https://cdn.com/v.m3u8', bandwidth: 400e6 }] });
    const whole = await buildPlan(huge, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText });
    expect(whole.raw).toBe(true);
    const p = await buildPlan(huge, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText, clip: { start: 0, end: 12 } });
    expect(p.raw).toBe(false);
    expect(p.output).toBe('mp4');
  });

  it('DASH templates tell their durations, so a part fetches only its segments', () => {
    const mpd = `<MPD type="static" mediaPresentationDuration="PT20S"><Period><AdaptationSet mimeType="video/mp4">
      <SegmentTemplate media="v$Number$.m4s" initialization="init.mp4" duration="4" timescale="1" startNumber="1"/>
      <Representation id="v" bandwidth="1000" width="640" height="360" codecs="avc1"/></AdaptationSet></Period></MPD>`;
    const rep = parseDash(mpd, 'https://cdn.com/m.mpd').video[0]!;
    expect(rep.segments.map((s) => s.dur)).toEqual([4, 4, 4, 4, 4]);
    const c = clipTrack({ container: 'fmp4', segments: rep.segments }, { start: 9, end: 13 });
    expect(c.track.segments.map((s) => s.url.split('/').pop())).toEqual(['v3.m4s', 'v4.m4s']);
    expect(c.offset).toBe(1);
  });
});

describe('muxAttempts with a part', () => {
  it('seeks each input before reading it, and stops after the length', () => {
    const [a] = muxAttempts({ video: '/j/v.ts', audio: '/j/a.aac' }, 'mp4', false, '/j/out', undefined, { duration: 11, video: 2, audio: 2.5 });
    const args = a!.args;
    expect(args.slice(0, 8)).toEqual(['-y', '-ss', '2', '-i', '/j/v.ts', '-ss', '2.5', '-i']);
    const t = args.indexOf('-t');
    expect(args[t + 1]).toBe('11');
    expect(t).toBeLessThan(args.indexOf('/j/out.mp4'));
  });

  it('a sound file from a part', () => {
    const attempts = muxAttempts({ audio: '/j/a.m4a' }, 'mp3', true, '/j/out', undefined, { duration: 5, audio: 1.25 });
    for (const a of attempts) {
      expect(a.args.slice(1, 5)).toEqual(['-ss', '1.25', '-i', '/j/a.m4a']);
      expect(a.args).toContain('-t');
    }
  });

  it('no part, no seeking', () => {
    const [a] = muxAttempts({ video: '/j/v.ts' }, 'mp4', false, '/j/out');
    expect(a!.args).not.toContain('-ss');
    expect(a!.args).not.toContain('-t');
  });
});
