import { describe, expect, it } from 'vitest';
import { clipChapters, cueChapters, descriptionChapters, ffmetadata, partChapters, spanChapters } from '../../src/shared/chapters';
import { sponsorParts, sponsorsIn, sponsorUrl, withoutSponsors } from '../../src/shared/sponsors';
import { audioChoices, hlsRendition } from '../../src/shared/audio';
import { buildPlan, imageClip, joinedParts, languageName, MAX_ANIMATION, validClip } from '../../src/background/plan';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { imageAttempts, muxAttempts } from '../../src/offscreen/args';
import { youtubeSubs } from '../../src/background/pageinfo';
import { hhmm, holdOf, inWindow, nextOpening, parseHhmm, playbackCap, RateLimiter } from '../../src/shared/schedule';
import { newerVersion, releaseOf, versionOf } from '../../src/shared/release';
import { listItem, listKind, listOf, numbered, parseDuration, watchId } from '../../src/shared/ytlist';
import { hiddenPlayerUrl } from '../../src/features/youtube';
import type { MediaItem, SubtitleTrack } from '../../src/shared/types';
import { cutBefore } from '../../src/shared/mediatime';
import { subtitleChoices, trackName, trackTitle } from '../../src/shared/sublabels';
import { matching } from '../../src/popup/components/Panels';
import { queueRank, reorderedPlaces, titleOf } from '../../src/background/jobs';
import { sheetCount, sheetLayout } from '../../src/shared/sheet';
import { thumbCandidates, thumbExt } from '../../src/background/thumbnail';

describe('chapters', () => {
  it('reads a description by YouTube’s rule', () => {
    const text = 'Some words\n0:00 Intro\n1:05 - Le cœur\n(12:30) Fin\nmerci';
    expect(descriptionChapters(text, 900)).toEqual([
      { start: 0, title: 'Intro' },
      { start: 65, title: 'Le cœur' },
      { start: 750, title: 'Fin' },
    ]);
    // Times at the end of the line, hours too.
    expect(descriptionChapters('Début 0:00\nMilieu 30:00\nSuite 1:00:00', 4000)).toEqual([
      { start: 0, title: 'Début' },
      { start: 1800, title: 'Milieu' },
      { start: 3600, title: 'Suite' },
    ]);
    // In the middle, after an emoji (a very common way to write them).
    expect(descriptionChapters('⌨️ (0:00) Introduction\n⌨️ (1:45) Installer Python\n⌨️ (10:02) Variables', 3600).map((c) => c.title)).toEqual([
      '⌨️ Introduction',
      '⌨️ Installer Python',
      '⌨️ Variables',
    ]);
    // A score or a ratio is not a time; a URL with numbers neither.
    expect(descriptionChapters('0:00 Début\nscore 2:1\n1:00 Suite\nhttps://x.com/a1:20b\n2:00 Fin').map((c) => c.start)).toEqual([0, 60, 120]);
  });

  it('none when the list breaks the rule', () => {
    expect(descriptionChapters('0:00 a\n1:00 b')).toEqual([]); // fewer than three
    expect(descriptionChapters('0:05 a\n1:00 b\n2:00 c')).toEqual([]); // not from 0:00
    expect(descriptionChapters('0:00 a\n0:05 b\n2:00 c')).toEqual([]); // under 10 s
    expect(descriptionChapters('0:00 a\n1:00 b\n9:00 c', 300)).toEqual([]); // past the end
    expect(descriptionChapters(undefined)).toEqual([]);
  });

  it('a <track kind="chapters"> in order, blank cues left out', () => {
    expect(
      cueChapters([
        { start: 30, end: 60, text: ' Deux\n ' },
        { start: 0, end: 30, text: 'Un' },
        { start: 60, end: 90, text: '  ' },
      ]),
    ).toEqual([
      { start: 0, title: 'Un' },
      { start: 30, title: 'Deux' },
    ]);
  });

  it('a part keeps the chapters it covers, on its own clock (with its lead)', () => {
    const ch = [
      { start: 0, title: 'A' },
      { start: 60, title: 'B' },
      { start: 120, title: 'C' },
      { start: 180, title: 'D' },
    ];
    expect(clipChapters(ch, { start: 90, duration: 60 })).toEqual([
      { start: 0, title: 'B' },
      { start: 30, title: 'C' },
    ]);
    // Started 4 s early on a keyframe: every chapter moves 4 s later.
    expect(clipChapters(ch, { start: 90, duration: 60 }, 4)).toEqual([
      { start: 0, title: 'B' },
      { start: 34, title: 'C' },
    ]);
  });

  it('parts joined get one chapter each', () => {
    const parts = [
      { clip: { start: 10, end: 20 }, length: 10.5 },
      { clip: { start: 60, end: 90 }, length: 30 },
    ];
    expect(partChapters(parts, (c) => `${c.start}-${c.end}`)).toEqual([
      { start: 0, title: '10-20' },
      { start: 10.5, title: '60-90' },
    ]);
  });

  it('ffmetadata, escaped, the last one ending at the total', () => {
    const out = ffmetadata(
      [
        { start: 0, title: 'Un = deux; #trois' },
        { start: 1.5, title: 'Fin' },
      ],
      3,
    );
    expect(out).toBe(
      ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=Un \\= deux\\; \\#trois\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=3000\ntitle=Fin\n',
    );
  });
});

const base = { id: 'i', tabId: 1, frameUrl: '', pageUrl: '', url: '', title: '', variants: [], protection: 'none', live: false, detectedAt: 0 } as const;

describe('audio choices', () => {
  it('HLS: each language once (listed once per quality), with the rendition of the quality’s group', () => {
    const item = {
      ...base,
      kind: 'hls',
      audioTracks: [
        { id: '1', label: 'English', lang: 'en', url: 'https://x/en-hi.m3u8', groupId: 'hi', isDefault: true },
        { id: '2', label: 'Français', lang: 'fr', url: 'https://x/fr-hi.m3u8', groupId: 'hi' },
        { id: '3', label: 'English', lang: 'en', url: 'https://x/en-lo.m3u8', groupId: 'lo' },
        { id: '4', label: 'Français', lang: 'fr', url: 'https://x/fr-lo.m3u8', groupId: 'lo' },
      ],
    } as unknown as MediaItem;
    const choices = audioChoices(item);
    expect(choices.map((c) => c.label)).toEqual(['English', 'Français']);
    expect(choices[0]!.isDefault).toBe(true);
    expect(hlsRendition(item, choices[1]!.id, 'lo')!.url).toBe('https://x/fr-lo.m3u8');
    expect(hlsRendition(item, choices[1]!.id, 'nope')!.url).toBe('https://x/fr-hi.m3u8');
  });

  it('DASH: the best bitrate of each language; one language is no choice', () => {
    const item = {
      ...base,
      kind: 'dash',
      audioTracks: [
        { id: 'en1', label: 'a', lang: 'en', bandwidth: 64000 },
        { id: 'en2', label: 'b', lang: 'en', bandwidth: 128000 },
        { id: 'de1', label: 'c', lang: 'de', bandwidth: 96000 },
      ],
    } as unknown as MediaItem;
    expect(audioChoices(item).map((c) => c.id)).toEqual(['en2', 'de1']);
    expect(audioChoices({ ...item, audioTracks: item.audioTracks.slice(0, 2) })).toEqual([]);
    expect(audioChoices({ ...item, kind: 'file' })).toEqual([]);
  });
});

describe('parts and pictures', () => {
  it('several parts: sorted, cut to the video, overlapping ones merged, at least two', () => {
    expect(
      joinedParts(
        [
          { start: 100, end: 130 },
          { start: 10, end: 20 },
          { start: 15, end: 40 },
          { start: 590, end: 700 },
        ],
        600,
      ),
    ).toEqual([
      { start: 10, end: 40 },
      { start: 100, end: 130 },
      { start: 590, end: 600 },
    ]);
    expect(joinedParts([{ start: 0, end: 10 }], 600)).toBeUndefined();
    expect(joinedParts([{ start: 0, end: 10 }, { start: 5, end: 30 }], 600)).toBeUndefined();
    expect(joinedParts([{ start: 0, end: 0.5 }, { start: NaN, end: 3 }, { start: 5, end: 9 }])).toBeUndefined();
  });

  it('a still is one second, inside the video; an animation is at most 30 s', () => {
    expect(imageClip(true, 42, undefined, 100)).toEqual({ start: 42, end: 43 });
    expect(imageClip(true, 500, undefined, 100)).toEqual({ start: 99, end: 100 });
    expect(imageClip(false, undefined, undefined, 100)).toEqual({ start: 0, end: 5 });
    expect(imageClip(false, undefined, { start: 10, end: 200 }, 100)).toEqual({ start: 10, end: 10 + MAX_ANIMATION });
    expect(imageClip(false, undefined, { start: 10, end: 14 }, 100)).toEqual({ start: 10, end: 14 });
  });

  it('a part that is the whole video is no part', () => {
    expect(validClip({ start: 0.2, end: 99.8 }, 100)).toBeUndefined();
    expect(validClip({ start: 10, end: 10.5 }, 100)).toBeUndefined();
    expect(validClip({ start: -5, end: 30 }, 100)).toEqual({ start: 0, end: 30 });
  });

  it('JPEG: one frame at the moment, GIF with its own palette, WebP animated', () => {
    const [jpg, plain] = imageAttempts('/j/v.mp4', 'jpg', '/j/out', 12.5, 1);
    expect(jpg!.args).toEqual(['-y', '-ss', '12.5', '-i', '/j/v.mp4', '-frames:v', '1', '-c:v', 'mjpeg', '-huffman', '0', '-pix_fmt', 'yuvj420p', '-q:v', '2', '-an', '/j/out.jpg']);
    // ffmpeg.wasm crashes on optimal Huffman tables: never asked for.
    expect(plain!.args.slice(plain!.args.indexOf('-huffman'), plain!.args.indexOf('-huffman') + 2)).toEqual(['-huffman', '0']);
    expect(plain!.args).not.toContain('-q:v');
    const [gif] = imageAttempts('/j/v.mp4', 'gif', '/j/out', 0, 4);
    expect(gif!.args.join(' ')).toContain('palettegen');
    expect(gif!.args.slice(gif!.args.indexOf('-t'), gif!.args.indexOf('-t') + 2)).toEqual(['-t', '4']);
    expect(gif!.out).toBe('/j/out.gif');
    const [webp] = imageAttempts('/j/v.mp4', 'webp', '/j/out', 3, 4);
    expect(webp!.args).toContain('libwebp_anim');
    expect(webp!.args).toContain('-loop');
    expect(() => imageAttempts('/j/v.mp4', 'mp4', '/j/out', 0, 1)).toThrow();
  });
});

describe('muxAttempts with more tracks, chapters and tags', () => {
  it('more sound tracks and subtitles, each with its language, chapters and the title', () => {
    const [first] = muxAttempts(
      {
        video: '/j/v.mp4',
        audio: '/j/a.mp4',
        audios: [{ path: '/j/a2.mp4', lang: 'fr', title: 'Français' }],
        subs: [
          { path: '/j/s0.srt', lang: 'en' },
          { path: '/j/s1.srt', lang: 'de' },
        ],
        chapters: '/j/ch.txt',
        meta: { title: 'Titre', artist: 'Chaîne' },
      },
      'mkv',
      false,
      '/j/out',
    );
    const a = first!.args;
    // Inputs: video, sound, other sound, two subtitles, chapters.
    expect(a.filter((x) => x === '-i')).toHaveLength(6);
    expect(a.join(' ')).toContain('-map 0:v:0 -map 1:a:0 -map 2:a:0 -map 3:0 -map 4:0');
    expect(a.join(' ')).toContain('-map_chapters 5');
    expect(a.join(' ')).toContain('-metadata:s:a:1 language=fra');
    expect(a.join(' ')).toContain('-metadata title=Titre');
    expect(a.join(' ')).toContain('-metadata artist=Chaîne');
  });

  it('a sound file with a cover first, then the same without it', () => {
    const tries = muxAttempts({ audio: '/j/a.mp4', cover: '/j/c.jpg', chapters: '/j/ch.txt', meta: { title: 'T' } }, 'mp3', true, '/j/out');
    expect(tries).toHaveLength(2);
    expect(tries[0]!.args.join(' ')).toContain('-i /j/c.jpg -map 0:a:0 -map 2:v:0 -c:v mjpeg -huffman 0 -pix_fmt yuvj420p -disposition:v:0 attached_pic');
    expect(tries[0]!.args).toContain('-id3v2_version');
    expect(tries[1]!.args).not.toContain('/j/c.jpg');
    expect(tries[1]!.args.join(' ')).toContain('-map_chapters 1');
  });

  it('formats without covers or chapters leave them out', () => {
    const [wav] = muxAttempts({ audio: '/j/a.mp4', cover: '/j/c.jpg', chapters: '/j/ch.txt' }, 'wav', true, '/j/out');
    expect(wav!.args).not.toContain('/j/c.jpg');
    expect(wav!.args).not.toContain('-map_chapters');
    const [avi] = muxAttempts({ video: '/j/v.mp4', chapters: '/j/ch.txt' }, 'avi', false, '/j/out');
    expect(avi!.args).not.toContain('-map_chapters');
  });
});

describe('translated YouTube subtitles', () => {
  const own = [
    { url: 'https://www.youtube.com/api/timedtext?lang=en', lang: 'en', name: 'English', auto: false },
    { url: 'https://www.youtube.com/api/timedtext?lang=en&kind=asr', lang: 'en', name: 'English (auto)', auto: true },
  ];

  it('a translation into every language YouTube offers, from the video’s written track', () => {
    const subs = youtubeSubs(own, ['fr', 'de', 'ja']);
    expect(subs).toHaveLength(5);
    expect(subs.slice(2).map((s) => s.tlang)).toEqual(['fr', 'de', 'ja']);
    expect(subs[2]).toMatchObject({ lang: 'en', tlang: 'fr' });
    expect(subs[2]!.auto).toBeUndefined();
    expect(new Set(subs.map((s) => s.id)).size).toBe(5);
  });

  it('not into the source’s language, nor one with its own written track, nor twice', () => {
    expect(youtubeSubs(own, ['en', 'en-GB', 'de', 'de'])).toHaveLength(3);
    const withFr = [...own, { url: 'https://www.youtube.com/api/timedtext?lang=fr', lang: 'fr', name: 'Français', auto: false }];
    expect(youtubeSubs(withFr, ['fr', 'es']).map((s) => s.tlang ?? s.lang)).toEqual(['en', 'en', 'fr', 'es']);
  });

  it('from the automatic track when the video has no written one; tracks without a language are left out', () => {
    const subs = youtubeSubs([own[1]!, { url: 'https://www.youtube.com/api/timedtext?x', lang: undefined as unknown as string, name: '?', auto: false }], ['fr']);
    expect(subs).toHaveLength(2);
    expect(subs[1]).toMatchObject({ lang: 'en', auto: true, tlang: 'fr' });
  });

  it('a translated track is named after the language it becomes', () => {
    expect(languageName('fr', 'fr')).toBe('Français');
    expect(languageName('de', 'en')).toBe('German');
    expect(languageName('not a code', 'en')).toBe('not a code');
  });

  it('from the language spoken in the video, not the first written track', () => {
    const many = [
      { url: 'https://www.youtube.com/api/timedtext?lang=de-DE', lang: 'de-DE', name: 'German (Germany)', auto: false },
      { url: 'https://www.youtube.com/api/timedtext?lang=en', lang: 'en', name: 'English', auto: false },
      { url: 'https://www.youtube.com/api/timedtext?lang=en&kind=asr', lang: 'en', name: 'English (auto-generated)', auto: true },
    ];
    expect(youtubeSubs(many, ['fr']).at(-1)).toMatchObject({ lang: 'en', tlang: 'fr', url: 'https://www.youtube.com/api/timedtext?lang=en' });
    // No automatic track: English when written, else the first.
    expect(youtubeSubs([many[0]!, many[1]!], ['fr']).at(-1)).toMatchObject({ lang: 'en' });
    expect(youtubeSubs([many[0]!], ['fr']).at(-1)).toMatchObject({ lang: 'de-DE' });
  });

  it('a language the browser can’t name keeps YouTube’s name', () => {
    const subs = youtubeSubs(own, ['fr', 'qaa'], { fr: 'French', qaa: 'Afar' });
    const t = subs.find((x) => x.tlang === 'qaa')!;
    expect(t.label).toBe('Afar');
    expect(trackName(t, 'fr')).toBe('Afar');
    expect(trackName(subs.find((x) => x.tlang === 'fr')!, 'fr')).toBe('Français');
  });

  it('only YouTube’s own addresses', () => {
    expect(youtubeSubs([{ url: 'https://evil.example/x', lang: 'en', name: 'x', auto: false }], [])).toEqual([]);
  });
});

describe('when to download', () => {
  it('reads and writes times of day', () => {
    expect(parseHhmm('22:00')).toBe(1320);
    expect(parseHhmm('7h')).toBe(420);
    expect(parseHhmm('7h30')).toBe(450);
    expect(parseHhmm(' 9 ')).toBe(540);
    expect(parseHhmm('24:00')).toBeNull();
    expect(parseHhmm('12:60')).toBeNull();
    expect(parseHhmm('soir')).toBeNull();
    expect(hhmm(450)).toBe('07:30');
    expect(hhmm(1440 + 5)).toBe('00:05');
  });

  it('a window may run past midnight; the same start and end is all day', () => {
    expect(inWindow(23 * 60, 22 * 60, 7 * 60)).toBe(true);
    expect(inWindow(3 * 60, 22 * 60, 7 * 60)).toBe(true);
    expect(inWindow(7 * 60, 22 * 60, 7 * 60)).toBe(false);
    expect(inWindow(12 * 60, 22 * 60, 7 * 60)).toBe(false);
    expect(inWindow(12 * 60, 9 * 60, 17 * 60)).toBe(true);
    expect(inWindow(17 * 60, 9 * 60, 17 * 60)).toBe(false);
    expect(inWindow(5, 600, 600)).toBe(true);
  });

  it('when the window opens next: today, or tomorrow', () => {
    const noon = new Date(2026, 9, 6, 12, 0, 30);
    expect(nextOpening(noon, 22 * 60, 7 * 60)).toBe(new Date(2026, 9, 6, 22, 0).getTime());
    const late = new Date(2026, 9, 6, 18, 0);
    expect(nextOpening(late, 9 * 60, 17 * 60)).toBe(new Date(2026, 9, 7, 9, 0).getTime());
    const night = new Date(2026, 9, 6, 23, 0);
    expect(nextOpening(night, 22 * 60, 7 * 60)).toBe(night.getTime());
  });

  it('holds new downloads outside the window, and off Wi-Fi only when the type is known', () => {
    const gate = { scheduleOn: true, scheduleFrom: 22 * 60, scheduleTo: 7 * 60, wifiOnly: true };
    const noon = new Date(2026, 9, 6, 12, 0);
    expect(holdOf(gate, noon, 'wifi')).toEqual({ why: 'schedule', until: new Date(2026, 9, 6, 22, 0).getTime() });
    const night = new Date(2026, 9, 6, 23, 0);
    expect(holdOf(gate, night, 'cellular')).toEqual({ why: 'wifi' });
    expect(holdOf(gate, night, 'wifi')).toBeNull();
    expect(holdOf(gate, night, 'ethernet')).toBeNull();
    expect(holdOf(gate, night, undefined)).toBeNull();
    expect(holdOf({ ...gate, scheduleOn: false, wifiOnly: false }, noon, 'cellular')).toBeNull();
  });

  it('a speed limit lets a small burst through, then spaces the rest out', () => {
    let now = 0;
    const lim = new RateLimiter(() => now);
    expect(lim.delayFor(10_000_000)).toBe(0); // no limit
    lim.set(1000);
    // Starts empty: 500 bytes wait half a second.
    expect(lim.delayFor(500)).toBeCloseTo(500);
    now += 500;
    expect(lim.delayFor(250)).toBeCloseTo(250);
    now += 10_000;
    // Ten seconds idle fill only the burst (a quarter of a second's worth).
    expect(lim.delayFor(250)).toBe(0);
    expect(lim.delayFor(1000)).toBeCloseTo(1000);
    lim.set(0);
    expect(lim.delayFor(1e9)).toBe(0);
  });

  it('the hidden player goes no faster than the limit allows (never under normal speed)', () => {
    // 1 MB/s for a 2.5 Mbit/s video: about 3.4 times the normal speed → 2.
    expect(playbackCap(1024 ** 2, 2_500_000)).toBe(2);
    expect(playbackCap(10 * 1024 ** 2, 2_500_000)).toBe(16);
    expect(playbackCap(64 * 1024, 2_500_000)).toBe(1);
    expect(playbackCap(0, 2_500_000)).toBeUndefined();
    const u = new URL(hiddenPlayerUrl({ jobId: 'job-1', videoId: 'abc', quality: 'hd720', vcodec: 'avc', acodec: 'aac', maxRate: 2 }));
    expect(u.searchParams.get('gyr')).toBe('2');
  });
});

describe('new versions', () => {
  it('reads a version and compares it', () => {
    expect(versionOf('v1.8.0')).toBe('1.8.0');
    expect(versionOf('1.10')).toBe('1.10');
    expect(versionOf('v1.8.0-beta')).toBeNull();
    expect(versionOf(3)).toBeNull();
    expect(newerVersion('1.10.0', '1.9.2')).toBe(true);
    expect(newerVersion('1.8', '1.8.0')).toBe(false);
    expect(newerVersion('1.7.9', '1.8.0')).toBe(false);
  });

  it('only a published release, linking to Grabby’s own page', () => {
    expect(releaseOf({ tag_name: 'v1.9.0', html_url: 'https://github.com/titilyonnais/grabby/releases/tag/v1.9.0' })).toEqual({
      version: '1.9.0',
      url: 'https://github.com/titilyonnais/grabby/releases/tag/v1.9.0',
    });
    expect(releaseOf({ tag_name: 'v1.9.0', html_url: 'https://evil.example/' })!.url).toBe('https://github.com/titilyonnais/grabby/releases/tag/v1.9.0');
    expect(releaseOf({ tag_name: 'v2.0.0', prerelease: true })).toBeNull();
    expect(releaseOf({ tag_name: 'v2.0.0', draft: true })).toBeNull();
    expect(releaseOf(null)).toBeNull();
    expect(releaseOf({ tag_name: 'nightly' })).toBeNull();
  });
});

describe('YouTube playlists and channels', () => {
  it('reads lengths and links', () => {
    expect(parseDuration('4:05')).toBe(245);
    expect(parseDuration(' 1:02:03 ')).toBe(3723);
    expect(parseDuration('LIVE')).toBeNull();
    expect(watchId('/watch?v=dQw4w9WgXcQ&list=PL1&index=2')).toBe('dQw4w9WgXcQ');
    expect(watchId('/shorts/dQw4w9WgXcQ')).toBeNull();
    expect(watchId('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(watchId('/watch?v=short')).toBeNull();
  });

  it('knows which pages list videos', () => {
    expect(listKind('https://www.youtube.com/playlist?list=PL123')).toBe('playlist');
    expect(listKind('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')).toBe('playlist');
    expect(listKind('https://www.youtube.com/@chaine/videos')).toBe('channel');
    expect(listKind('https://www.youtube.com/channel/UC123/streams')).toBe('channel');
    expect(listKind('https://www.youtube.com/@chaine')).toBeNull();
    expect(listKind('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(listKind('https://example.com/playlist?list=PL1')).toBeNull();
  });

  it('each video once, in order; live ones left out; at least two', () => {
    const list = listOf('playlist', 'Ma liste - YouTube', [
      { href: '/watch?v=aaaaaaaaaaa&index=1', title: '  Un  ', duration: '3:00' },
      { href: '/watch?v=bbbbbbbbbbb&index=2', title: 'Deux', duration: 'LIVE' },
      { href: '/watch?v=aaaaaaaaaaa&index=3', title: 'Un encore' },
      { href: '/watch?v=ccccccccccc', title: '' },
    ]);
    expect(list).toEqual({
      kind: 'playlist',
      title: 'Ma liste',
      entries: [
        { id: 'aaaaaaaaaaa', title: 'Un', duration: 180 },
        { id: 'ccccccccccc', title: 'YouTube ccccccccccc' },
      ],
    });
    expect(listOf('channel', 'x', [{ href: '/watch?v=aaaaaaaaaaa' }])).toBeNull();
  });

  it('numbered so files sort in order; each one recorded like a single video', () => {
    expect(numbered('Titre', 0, 9)).toBe('01 - Titre');
    expect(numbered('Titre', 41, 120)).toBe('042 - Titre');
    const item = listItem({ id: 'aaaaaaaaaaa', title: 'Un', duration: 180 }, 7, 'hd720', '01 - Un');
    expect(item).toMatchObject({ kind: 'capture', ytId: 'aaaaaaaaaaa', title: '01 - Un', duration: 180, tabId: 7, pageUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
    expect(item.variants).toEqual([{ id: 'hd720', label: '720p', height: 720, url: '', codecs: 'avc1' }]);
    expect(item.fromList).toEqual({ id: 'aaaaaaaaaaa', title: 'Un', duration: 180 });
    // An unknown quality: the best one offered.
    expect(listItem({ id: 'aaaaaaaaaaa', title: 'Un' }, 7, 'nope').variants[0]!.id).toBe('hd1080');
  });
});

describe('joining recording sessions', () => {
  // The frames of the session before around the joint (25.283 s), as ffmpeg lists them.
  const crc = [
    '#tb 0: 1/1000',
    '0,      25233,      25249,       17,    51234, 0x1',
    '0,      25249,      25233,       16,     8123, 0x2',
    '0,      25266,      25283,       17,    90321, 0x3',
    '0,      25283,      25266,       17,     7123, 0x4',
    '0,      25299,      25316,       17,     6123, 0x5',
  ].join('\n');

  it('stops before the frame decoded ahead of the joint', () => {
    expect(cutBefore(crc, 25.283)).toBeCloseTo(25.266, 6);
  });

  it('keeps every frame shown before the joint', () => {
    // Frames shown before 25.283 are all decoded before 25.266.
    const cut = cutBefore(crc, 25.283)!;
    for (const [dts, pts] of [[25.233, 25.249], [25.249, 25.233]]) {
      expect(pts).toBeLessThan(25.283);
      expect(dts).toBeLessThan(cut);
    }
  });

  it('gives nothing without a frame at or after the joint, or without a time base', () => {
    expect(cutBefore(crc, 30)).toBeUndefined();
    expect(cutBefore('0, 1, 1, 1, 1, 0x1', 0)).toBeUndefined();
  });
});

describe('subtitle names and order', () => {
  const words = { own: 'Own', auto: 'Auto', translated: 'Translated', forced: 'forced', autoShort: 'automatic', translatedShort: 'translated', from: (l: string) => `from ${l}` };
  const tr = (id: string, over: Partial<SubtitleTrack>): SubtitleTrack => ({ id, url: 'u', label: id, ...over });

  it('named by language in the browser’s language, whatever the site called them', () => {
    const list = subtitleChoices([tr('a', { lang: 'en', label: 'English (auto-generated)', auto: true })], words, 'fr');
    expect(list).toEqual([{ value: 'a', label: 'Anglais' }]);
    expect(trackName(tr('b', { lang: 'en-GB' }), 'fr')).toBe('Anglais britannique');
    // No language: the site's name.
    expect(trackName(tr('c', { label: 'Director commentary' }), 'fr')).toBe('Director commentary');
  });

  it('own, then automatic, then translated; the browser’s language first, then by name', () => {
    const list = subtitleChoices(
      [
        tr('t-de', { lang: 'en', tlang: 'de' }),
        tr('t-fr', { lang: 'en', tlang: 'fr' }),
        tr('a-en', { lang: 'en', auto: true }),
        tr('o-es', { lang: 'es' }),
        tr('o-fr', { lang: 'fr' }),
        tr('t-ar', { lang: 'en', tlang: 'ar' }),
      ],
      words,
      'fr',
    );
    expect(list.map((c) => c.value)).toEqual(['o-fr', 'o-es', 'a-en', 't-fr', 't-de', 't-ar']);
    expect(list.map((c) => c.group)).toEqual(['Own', 'Own', 'Auto', 'Translated', 'Translated', 'Translated']);
    expect(list[3]).toMatchObject({ label: 'Français', detail: 'from anglais' });
  });

  it('one kind only: no group titles; same name twice: the site’s name tells them apart', () => {
    const list = subtitleChoices([tr('x', { lang: 'en', label: 'English - CC' }), tr('y', { lang: 'en', label: 'English' })], words, 'en');
    expect(list.every((c) => c.group === undefined)).toBe(true);
    expect(list.map((c) => c.detail)).toEqual(['English - CC', undefined]);
  });

  it('the title inside a file says automatic or translated', () => {
    expect(trackTitle(tr('a', { lang: 'en', auto: true }), words, 'fr')).toBe('Anglais (automatic)');
    expect(trackTitle(tr('b', { lang: 'en', tlang: 'de' }), words, 'fr')).toBe('Allemand (translated)');
    expect(trackTitle(tr('c', { lang: 'fr', forced: true }), words, 'fr')).toBe('Français (forced)');
  });
});

describe('searching the history', () => {
  const entry = (id: string, title: string, pageUrl: string, filename = `${title}.mp4`) => ({ id, title, pageUrl, filename, size: 1, date: 0 });
  const list = [entry('a', 'Été à Paris', 'https://www.youtube.com/watch?v=1'), entry('b', 'Spring', 'https://vimeo.com/2'), entry('c', 'Paris la nuit', 'https://example.fr/x', 'nuit.mkv')];

  it('every word, accents and case aside, in the title, the file or the site', () => {
    expect(matching(list, '').map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(matching(list, 'paris').map((e) => e.id)).toEqual(['a', 'c']);
    expect(matching(list, 'ETE paris').map((e) => e.id)).toEqual(['a']);
    expect(matching(list, 'vimeo').map((e) => e.id)).toEqual(['b']);
    expect(matching(list, 'mkv').map((e) => e.id)).toEqual(['c']);
    expect(matching(list, 'nothing')).toEqual([]);
  });
});

describe('volume evened out', () => {
  const song = (over: Partial<MediaItem> = {}): MediaItem => ({
    id: 's',
    tabId: 1,
    frameUrl: 'https://site.com/',
    pageUrl: 'https://site.com/song',
    kind: 'file',
    url: 'https://cdn.com/song.mp3',
    title: 'Chanson',
    variants: [],
    audioTracks: [],
    protection: 'none',
    live: false,
    detectedAt: 0,
    audioOnly: true,
    size: 5_000_000,
    ...over,
  });
  const none = async () => '';

  it('encodes the sound with loudnorm, never a plain copy', () => {
    const plain = muxAttempts({ audio: '/j/a.mp4' }, 'm4a', true, '/j/out');
    expect(plain[0]!.args).toContain('copy');
    const even = muxAttempts({ audio: '/j/a.mp4', normalize: true }, 'm4a', true, '/j/out');
    expect(even).toHaveLength(1);
    expect(even[0]!.args).not.toContain('copy');
    expect(even[0]!.args.join(' ')).toContain('-af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac');
    // With a cover: still a try without it, both evened out.
    const covered = muxAttempts({ audio: '/j/a.mp4', cover: '/j/c.jpg', normalize: true }, 'mp3', true, '/j/out');
    expect(covered).toHaveLength(2);
    for (const a of covered) expect(a.args).toContain('-af');
  });

  it('leaves a video alone', () => {
    const v = muxAttempts({ video: '/j/v.mp4', normalize: true }, 'mp4', false, '/j/out');
    for (const a of v) expect(a.args).not.toContain('-af');
  });

  it('a sound file saved as is goes through ffmpeg when evened out', async () => {
    const off = await buildPlan(song(), { mode: 'audio', format: 'mp3', settings: DEFAULT_SETTINGS, fetchText: none });
    expect(off.normalize).toBeUndefined();
    const on = await buildPlan(song(), { mode: 'audio', format: 'mp3', settings: { ...DEFAULT_SETTINGS, normalize: true }, fetchText: none });
    expect(on.normalize).toBe(true);
    expect(on.raw).toBe(false);
    expect(on.direct).toBeUndefined();
    // A video is never evened out.
    const video = await buildPlan(song({ audioOnly: false, url: 'https://cdn.com/v.mp4' }), { mode: 'video', settings: { ...DEFAULT_SETTINGS, normalize: true }, fetchText: none });
    expect(video.normalize).toBeUndefined();
  });
});

describe('sponsored parts (SponsorBlock)', () => {
  const id = 'dQw4w9WgXcQ';

  it('asks with a 4-character hash prefix, never the video id', async () => {
    const url = await sponsorUrl(id);
    expect(url).toMatch(/^https:\/\/sponsor\.ajay\.app\/api\/skipSegments\/[0-9a-f]{4}\?categories=/);
    expect(url).not.toContain(id);
    expect(decodeURIComponent(url.split('categories=')[1]!)).toBe('["sponsor","selfpromo"]');
  });

  it('keeps only this video’s parts to skip, in order', () => {
    const answer = [
      { videoID: 'other000000', segments: [{ segment: [1, 50], category: 'sponsor', actionType: 'skip' }] },
      {
        videoID: id,
        segments: [
          { segment: [300, 330.5], category: 'selfpromo', actionType: 'skip' },
          { segment: [20, 80], category: 'sponsor', actionType: 'skip' },
          { segment: [100, 120], category: 'sponsor', actionType: 'mute' },
          { segment: [140, 140.4], category: 'sponsor', actionType: 'skip' },
          { segment: ['a', 2], category: 'sponsor' },
          { segment: [0, 0], category: 'full', actionType: 'full' },
        ],
      },
    ];
    expect(sponsorsIn(answer, id)).toEqual([
      { start: 20, end: 80 },
      { start: 300, end: 330.5 },
    ]);
    expect(sponsorsIn({ nope: 1 }, id)).toEqual([]);
    expect(sponsorsIn([], id)).toEqual([]);
  });

  it('nothing found, offline or a bad id: nothing left out', async () => {
    const notFound = (async () => new Response('Not Found', { status: 404 })) as typeof fetch;
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    let asked = 0;
    const never = (async () => {
      asked++;
      return new Response('[]');
    }) as typeof fetch;
    expect(await sponsorParts(id, notFound)).toEqual([]);
    expect(await sponsorParts(id, offline)).toEqual([]);
    expect(await sponsorParts('../../etc', never)).toEqual([]);
    expect(asked).toBe(0);
    const found = (async (url: string, init?: RequestInit) => {
      expect(init?.credentials).toBe('omit');
      expect(url).not.toContain(id);
      return new Response(JSON.stringify([{ videoID: id, segments: [{ segment: [10, 40], category: 'sponsor', actionType: 'skip' }] }]));
    }) as unknown as typeof fetch;
    expect(await sponsorParts(id, found)).toEqual([{ start: 10, end: 40 }]);
  });

  it('cuts the sponsored parts out of what was asked', () => {
    const s = [
      { start: 20, end: 80 },
      { start: 300, end: 330 },
    ];
    expect(withoutSponsors([{ start: 0, end: 600 }], s)).toEqual([
      { start: 0, end: 20 },
      { start: 80, end: 300 },
      { start: 330, end: 600 },
    ]);
    // A part chosen by the user: only what overlaps it.
    expect(withoutSponsors([{ start: 60, end: 200 }], s)).toEqual([{ start: 80, end: 200 }]);
    // At the very start, and less than a second left between two.
    expect(withoutSponsors([{ start: 0, end: 100 }], [{ start: 0, end: 30 }, { start: 30.5, end: 50 }])).toEqual([{ start: 50, end: 100 }]);
    // Overlapping sponsored parts.
    expect(withoutSponsors([{ start: 0, end: 100 }], [{ start: 10, end: 40 }, { start: 30, end: 60 }])).toEqual([
      { start: 0, end: 10 },
      { start: 60, end: 100 },
    ]);
    expect(withoutSponsors([{ start: 0, end: 100 }], [])).toEqual([{ start: 0, end: 100 }]);
  });

  it('puts the video’s chapters where they fall in the file', () => {
    const chapters = [
      { start: 0, title: 'Intro' },
      { start: 20, title: 'Sponsor' },
      { start: 80, title: 'Sujet' },
      { start: 300, title: 'Promo' },
      { start: 330, title: 'Fin' },
    ];
    const spans = [
      { from: 0, length: 20 },
      { from: 80, length: 220 },
      { from: 330, length: 270 },
    ];
    expect(spanChapters(chapters, spans)).toEqual([
      { start: 0, title: 'Intro' },
      { start: 20, title: 'Sujet' },
      { start: 240, title: 'Fin' },
    ]);
    // A piece starting a little earlier (its keyframe): the chapter waits for its time.
    expect(spanChapters([{ start: 0, title: 'A' }, { start: 50, title: 'B' }], [{ from: 0, length: 10 }, { from: 48, length: 20 }])).toEqual([
      { start: 0, title: 'A' },
      { start: 12, title: 'B' },
    ]);
  });
});

describe('queue order', () => {
  const w = [
    { id: 'a', rank: 10 },
    { id: 'b', rank: 20 },
    { id: 'c', rank: 30 },
    { id: 'd', rank: 40 },
  ];
  const order = (m: Map<string, number>) => [...m].sort((x, y) => x[1] - y[1]).map(([id]) => id).join('');

  it('moves one before another, or last, with the same places', () => {
    expect(order(reorderedPlaces(w, 'd', 'a'))).toBe('dabc');
    expect(order(reorderedPlaces(w, 'a'))).toBe('bcda');
    expect(order(reorderedPlaces(w, 'b', 'd'))).toBe('acbd');
    expect([...reorderedPlaces(w, 'd', 'a').values()].sort((x, y) => x - y)).toEqual([10, 20, 30, 40]);
    // Unknown target: last.
    expect(order(reorderedPlaces(w, 'a', 'zz'))).toBe('bcda');
  });

  it('asked at the same moment: places made distinct', () => {
    const same = [
      { id: 'a', rank: 5 },
      { id: 'b', rank: 5 },
      { id: 'c', rank: 5 },
    ];
    const m = reorderedPlaces(same, 'c', 'a');
    expect(order(m)).toBe('cab');
    expect(new Set(m.values()).size).toBe(3);
  });

  it('a moved download keeps its place', () => {
    expect(queueRank({ startedAt: 30 })).toBe(30);
    expect(queueRank({ startedAt: 30, order: 5 })).toBe(5);
  });
});

describe('contact sheet and thumbnail', () => {
  it('lays the pictures out in a grid that holds them all', () => {
    expect(sheetLayout(95)).toEqual({ every: 4, cols: 6, rows: 4 });
    expect(sheetLayout(95, 10)).toEqual({ every: 10, cols: 4, rows: 3 });
    // Two hours every 10 s would be 720 pictures: at most 100, further apart.
    const long = sheetLayout(7200, 10);
    expect(long.every).toBe(72);
    expect(long.cols * long.rows).toBeGreaterThanOrEqual(100);
    expect(long.cols).toBe(10);
    // Very short: one line.
    expect(sheetLayout(2, 10)).toEqual({ every: 10, cols: 1, rows: 1 });
    expect(sheetCount(95, 10)).toBe(10);
    expect(sheetCount(95)).toBe(24);
  });

  it('makes the sheet with ffmpeg: a picture every few seconds, tiled', () => {
    const [first, plain] = imageAttempts('/j/v.mp4', 'jpg', '/j/out', 0, 1, { every: 10, cols: 4, rows: 3 });
    const vf = first!.args[first!.args.indexOf('-vf') + 1];
    expect(vf).toBe('fps=1/10,scale=320:-2,tile=4x3:padding=6:margin=6:color=white');
    expect(first!.args).toEqual(expect.arrayContaining(['-frames:v', '1', '-huffman', '0']));
    expect(first!.args).not.toContain('-ss');
    expect(plain!.args[plain!.args.indexOf('-vf') + 1]).toBe('fps=1/10,scale=320:-2,tile=4x3');
  });

  it('plans a sheet of the whole video, without its sound', async () => {
    const item: MediaItem = {
      id: 'v',
      tabId: 1,
      frameUrl: 'https://site.com/',
      pageUrl: 'https://site.com/watch',
      kind: 'hls',
      url: 'https://cdn.com/master.m3u8',
      title: 'Vidéo',
      variants: [{ id: 'lo', label: '360p', height: 360, bandwidth: 500_000, url: 'https://cdn.com/lo.m3u8' }],
      audioTracks: [],
      protection: 'none',
      live: false,
      detectedAt: 0,
      duration: 95,
    };
    const media = '#EXTM3U\n#EXTINF:50,\nv0.ts\n#EXTINF:45,\nv1.ts\n#EXT-X-ENDLIST\n';
    const p = await buildPlan(item, { mode: 'video', format: 'jpg', sheet: 10, variantId: 'lo', settings: DEFAULT_SETTINGS, fetchText: async () => media });
    expect(p.output).toBe('jpg');
    expect(p.image).toEqual({ sheet: { every: 10, cols: 4, rows: 3 } });
    expect(p.clip).toBeUndefined();
    expect(p.video!.segments).toHaveLength(2);
  });

  it('names the sheet after the video', () => {
    expect(titleOf({ title: 'Vidéo', sheet: 0 })).toBe('Vidéo (contact sheet)');
  });

  it('looks for the biggest thumbnail first', () => {
    expect(thumbCandidates({ ytId: 'dQw4w9WgXcQ', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' })).toEqual([
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    ]);
    expect(thumbCandidates({ thumbnail: 'https://cdn.site.com/poster.webp?x=1' })).toEqual(['https://cdn.site.com/poster.webp?x=1']);
    expect(thumbCandidates({ ytId: '../evil', thumbnail: 'javascript:alert(1)' })).toEqual([]);
    expect(thumbExt('https://cdn.site.com/poster.webp?x=1')).toBe('webp');
    expect(thumbExt('data:image/png;base64,AAAA')).toBe('png');
    expect(thumbExt('https://cdn.site.com/poster')).toBe('jpg');
  });
});
