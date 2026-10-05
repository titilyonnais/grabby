import { describe, expect, it } from 'vitest';
import { clipChapters, cueChapters, descriptionChapters, ffmetadata, partChapters } from '../../src/shared/chapters';
import { audioChoices, hlsRendition } from '../../src/shared/audio';
import { imageClip, joinedParts, languageName, MAX_ANIMATION, validClip } from '../../src/background/plan';
import { imageAttempts, muxAttempts } from '../../src/offscreen/args';
import { youtubeSubs } from '../../src/background/pageinfo';
import { hhmm, holdOf, inWindow, nextOpening, parseHhmm, playbackCap, RateLimiter } from '../../src/shared/schedule';
import { newerVersion, releaseOf, versionOf } from '../../src/shared/release';
import { listItem, listKind, listOf, numbered, parseDuration, watchId } from '../../src/shared/ytlist';
import { hiddenPlayerUrl } from '../../src/features/youtube';
import type { MediaItem } from '../../src/shared/types';
import { cutBefore } from '../../src/shared/mediatime';

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

  it('one more track, translated into the browser’s language, when none is written in it', () => {
    const subs = youtubeSubs(own, ['fr', 'de'], 'fr-FR');
    expect(subs).toHaveLength(3);
    expect(subs[2]).toMatchObject({ lang: 'en', tlang: 'fr', label: 'English' });
    expect(new Set(subs.map((s) => s.id)).size).toBe(3);
  });

  it('none when YouTube can’t translate into it, or a written track is in it already', () => {
    expect(youtubeSubs(own, ['de'], 'fr')).toHaveLength(2);
    expect(youtubeSubs([...own, { url: 'https://www.youtube.com/api/timedtext?lang=fr', lang: 'fr', name: 'Français', auto: false }], ['fr'], 'fr')).toHaveLength(3);
  });

  it('a translated track is named after the language it becomes', () => {
    expect(languageName('fr', 'fr')).toBe('Français');
    expect(languageName('de', 'en')).toBe('German');
    expect(languageName('not a code', 'en')).toBe('not a code');
  });

  it('only YouTube’s own addresses', () => {
    expect(youtubeSubs([{ url: 'https://evil.example/x', lang: 'en', name: 'x', auto: false }], [], 'en')).toEqual([]);
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
