import { describe, expect, it } from 'vitest';
import { buildPlan } from '../../src/background/plan';
import { muxAttempts } from '../../src/offscreen/args';
import { parseDash } from '../../src/parsers/dash';
import { parseHls } from '../../src/parsers/hls';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { clipCues, iso3, joinVtt, parseVtt, toSrt } from '../../src/shared/subtitles';
import type { MediaItem } from '../../src/shared/types';

const seg = (map: number | null, ...cues: string[]) =>
  ['WEBVTT', ...(map !== null ? [`X-TIMESTAMP-MAP=MPEGTS:${map},LOCAL:00:00:00.000`] : []), '', ...cues].join('\n');

describe('WebVTT', () => {
  it('reads cues, with or without ids, hours or settings', () => {
    const { cues } = parseVtt(
      'WEBVTT\n\nNOTE a comment\n\n1\n00:01.000 --> 00:02.500 align:start\nHello\nthere\n\n01:00:00.000 --> 01:00:01.000\nLate\n',
    );
    expect(cues).toEqual([
      { start: 1, end: 2.5, text: 'Hello\nthere' },
      { start: 3600, end: 3601, text: 'Late' },
    ]);
  });

  it('keeps italics, bold and underline, drops voices, classes and karaoke times', () => {
    const { cues } = parseVtt('WEBVTT\n\n00:00.000 --> 00:01.000\n<v Anna><i>Oui</i> <c.yellow>&amp; non</c> <00:00.500><b>fin</b></v>\n');
    expect(cues[0]!.text).toBe('<i>Oui</i> & non <b>fin</b>');
  });

  it('skips broken cues', () => {
    const { cues } = parseVtt('WEBVTT\n\n00:02.000 --> 00:01.000\nbackwards\n\nnot a time --> 00:01.000\nx\n\n00:00.000 --> 00:01.000\n\n');
    expect(cues).toEqual([]);
  });

  it('puts HLS segments on the stream clock and keeps a line repeated at an edge once', () => {
    const cues = joinVtt([
      seg(900000, '00:00.500 --> 00:01.800', 'Bonjour', ''),
      seg(900000, '00:03.900 --> 00:04.600', 'Au revoir', ''),
      seg(900000, '00:03.900 --> 00:04.600', 'Au revoir', '', '00:05.000 --> 00:05.800', 'Fin', ''),
    ]);
    expect(cues.map((c) => [c.start, c.text])).toEqual([
      [0.5, 'Bonjour'],
      [3.9, 'Au revoir'],
      [5, 'Fin'],
    ]);
  });

  it('a segment mapped later than the first moves its cues by the difference', () => {
    // Second segment's local times restart at zero, ten seconds further on the video clock.
    const cues = joinVtt([seg(900000, '00:01.000 --> 00:02.000', 'a', ''), seg(1800000, '00:01.000 --> 00:02.000', 'b', '')]);
    expect(cues.map((c) => c.start)).toEqual([1, 11]);
  });

  it('a part keeps its lines, from zero', () => {
    const cues = [
      { start: 0.5, end: 1.8, text: 'a' },
      { start: 2.5, end: 3.8, text: 'b' },
      { start: 3.9, end: 4.6, text: 'c' },
      { start: 5, end: 5.8, text: 'd' },
    ];
    expect(clipCues(cues, 3, 2)).toEqual([
      { start: 0, end: 0.8, text: 'b' },
      { start: 0.9, end: 1.6, text: 'c' },
    ]);
  });

  it('writes SubRip', () => {
    expect(toSrt([{ start: 3723.04, end: 3724.5, text: '<i>Hi</i>' }, { start: 0, end: 1, text: 'x' }])).toBe(
      '1\n01:02:03,040 --> 01:02:04,500\n<i>Hi</i>\n\n2\n00:00:00,000 --> 00:00:01,000\nx\n',
    );
  });

  it('names languages the way video files want', () => {
    expect(iso3('fr')).toBe('fra');
    expect(iso3('pt-BR')).toBe('por');
    expect(iso3('deu')).toBe('deu');
    expect(iso3('xx')).toBeUndefined();
    expect(iso3()).toBeUndefined();
  });
});

describe('subtitle tracks in manifests', () => {
  it('HLS: the SUBTITLES renditions of a master', () => {
    const m = parseHls(
      [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="subs/en.m3u8"',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="Français (forcés)",LANGUAGE="fr",FORCED=YES,URI="subs/fr.m3u8"',
        '#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID="cc",NAME="CC",INSTREAM-ID="CC1"',
        '#EXT-X-STREAM-INF:BANDWIDTH=1000,SUBTITLES="s"',
        'v.m3u8',
      ].join('\n'),
      'https://cdn.com/master.m3u8',
    );
    if (m.type !== 'master') throw new Error('master expected');
    expect(m.subtitles).toEqual([
      { name: 'English', lang: 'en', url: 'https://cdn.com/subs/en.m3u8', isDefault: true, forced: false },
      { name: 'Français (forcés)', lang: 'fr', url: 'https://cdn.com/subs/fr.m3u8', isDefault: false, forced: true },
    ]);
  });

  it('DASH: WebVTT adaptation sets and subtitles packed in MP4', () => {
    const mpd = parseDash(
      `<MPD type="static" mediaPresentationDuration="PT6S"><Period>
        <AdaptationSet mimeType="video/mp4"><Representation id="v" bandwidth="1" codecs="avc1"><BaseURL>v.mp4</BaseURL></Representation></AdaptationSet>
        <AdaptationSet contentType="text" mimeType="text/vtt" lang="fr"><Label>Français</Label><Representation id="t1" bandwidth="1"><BaseURL>fr.vtt</BaseURL></Representation></AdaptationSet>
        <AdaptationSet contentType="text" mimeType="application/mp4" lang="en"><Representation id="t2" codecs="stpp" bandwidth="1"><BaseURL>en.mp4</BaseURL></Representation></AdaptationSet>
      </Period></MPD>`,
      'https://cdn.com/m.mpd',
    );
    expect(mpd.text.map((r) => [r.id, r.lang, r.label, r.segments[0]!.url])).toEqual([
      ['t1', 'fr', 'Français', 'https://cdn.com/fr.vtt'],
      ['t2', 'en', undefined, 'https://cdn.com/en.mp4'],
    ]);
    expect(mpd.text.map((r) => r.packing)).toEqual(['text', 'fmp4']);
    expect(mpd.video).toHaveLength(1);
    expect(mpd.audio).toHaveLength(0);
  });
});

describe('a plan with subtitles', () => {
  const item: MediaItem = {
    id: 'x',
    tabId: 1,
    frameUrl: 'https://site.com/',
    pageUrl: 'https://site.com/watch',
    kind: 'hls',
    url: 'https://cdn.com/v.m3u8',
    title: 't',
    variants: [],
    audioTracks: [],
    subtitles: [{ id: 's', label: 'Français', lang: 'fr', url: 'https://cdn.com/fr.m3u8' }],
    protection: 'none',
    live: false,
    detectedAt: 0,
    duration: 4,
  };
  const playlists: Record<string, string> = {
    'https://cdn.com/v.m3u8': '#EXTM3U\n#EXTINF:2,\nv0.ts\n#EXTINF:2,\nv1.ts\n#EXT-X-ENDLIST\n',
    'https://cdn.com/fr.m3u8': '#EXTM3U\n#EXTINF:2,\nfr0.vtt\n#EXTINF:2,\nfr1.vtt\n#EXT-X-ENDLIST\n',
  };
  const fetchText = async (u: string) => playlists[u] ?? Promise.reject(new Error(u));
  const plan = (o: object) => buildPlan(item, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText, ...o });

  it('fetches the chosen track as a third one, to put in the video', async () => {
    const p = await plan({ subtitles: { ids: ['s'], separate: false } });
    expect(p.subtitles).toMatchObject([{ label: 'French', lang: 'fr', separate: false }]);
    expect(p.subtitles![0]!.track.segments.map((s) => s.url)).toEqual(['https://cdn.com/fr0.vtt', 'https://cdn.com/fr1.vtt']);
  });

  it('in a container without subtitles, or asked so, they go in their own file', async () => {
    expect((await plan({ format: 'ts', subtitles: { ids: ['s'], separate: false } })).subtitles![0]!.separate).toBe(true);
    expect((await plan({ format: 'avi', subtitles: { ids: ['s'], separate: false } })).subtitles![0]!.separate).toBe(true);
    expect((await plan({ format: 'mkv', subtitles: { ids: ['s'], separate: true } })).subtitles![0]!.separate).toBe(true);
    expect((await plan({ format: 'mkv', subtitles: { ids: ['s'], separate: false } })).subtitles![0]!.separate).toBe(false);
  });

  it('no subtitles for a sound file, an unknown track or one that can not be read', async () => {
    expect((await plan({ mode: 'audio', subtitles: { ids: ['s'], separate: false } })).subtitles).toBeUndefined();
    expect((await plan({ subtitles: { ids: ['nope'], separate: false } })).subtitles).toBeUndefined();
    const broken = await buildPlan(item, {
      mode: 'video',
      settings: DEFAULT_SETTINGS,
      fetchText: async (u) => (u.includes('fr') ? Promise.reject(new TypeError('offline')) : playlists[u]!),
      subtitles: { ids: ['s'], separate: false },
    });
    expect(broken.subtitles).toBeUndefined();
    expect(broken.video!.segments).toHaveLength(2);
  });
});

describe('YouTube subtitles', () => {
  const yt: MediaItem = {
    id: 'yt',
    tabId: 1,
    frameUrl: 'https://www.youtube.com/watch?v=abc',
    pageUrl: 'https://www.youtube.com/watch?v=abc',
    kind: 'capture',
    ytId: 'abc',
    title: 'Clip',
    duration: 60,
    url: '',
    variants: [{ id: 'hd720', url: '', label: '720p', height: 720, codecs: 'avc1' }],
    audioTracks: [],
    protection: 'none',
    live: false,
    detectedAt: 1,
    subtitles: [{ id: 's', url: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr&fmt=vtt', label: 'English (auto-generated)', lang: 'en', auto: true }],
  } as MediaItem;

  it('are kept from what the hidden player loads, nothing is fetched', async () => {
    const p = await buildPlan(yt, { mode: 'video', settings: DEFAULT_SETTINGS, fetchText: () => Promise.reject(new Error('no fetch')), subtitles: { ids: ['s'], separate: false } });
    expect(p.subtitles).toMatchObject([{ captured: { lang: 'en', auto: true }, label: 'English (automatic)', separate: false }]);
    expect(p.subtitles![0]!.track.segments).toEqual([]);
  });
});

describe('muxAttempts with subtitles', () => {
  const subs = { path: '/j/s.srt', lang: 'fr', title: 'Français' };

  it('MP4: a third input, written as mov_text, with its language', () => {
    const [a] = muxAttempts({ video: '/j/v.ts', audio: '/j/a.aac', subs: [subs] }, 'mp4', false, '/j/out');
    const args = a!.args.join(' ');
    expect(args).toContain('-i /j/v.ts -i /j/a.aac -i /j/s.srt');
    expect(args).toContain('-map 0:v:0 -map 1:a:0 -map 2:0');
    expect(args).toContain('-c:s mov_text -metadata:s:s:0 language=fra -metadata:s:s:0 title=Français');
  });

  it('MKV keeps SubRip, WebM takes WebVTT; one input only maps them second', () => {
    expect(muxAttempts({ video: '/j/v.mp4', subs: [subs] }, 'mkv', false, '/j/out')[0]!.args.join(' ')).toContain('-map 1:0 -c copy -c:s srt');
    expect(muxAttempts({ video: '/j/v.webm', subs: [subs] }, 'webm', false, '/j/out')[0]!.args.join(' ')).toContain('-c:s webvtt');
  });

  it('the MKV fallback keeps them too', () => {
    const attempts = muxAttempts({ video: '/j/v.ts', subs: [subs] }, 'mp4', false, '/j/out');
    expect(attempts.at(-1)!.args.join(' ')).toContain('-c:s srt');
  });
});
