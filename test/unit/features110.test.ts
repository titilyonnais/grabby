import { describe, expect, it } from 'vitest';
import {
  atempo,
  budget,
  canBurn,
  chapterPieces,
  cleanCrop,
  cleanFinish,
  durationIn,
  editedExt,
  encodeAttempts,
  hasSoundIn,
  heightIn,
  needsEncode,
  pieceArgs,
  pieceName,
  speedChapters,
  speedCues,
  videoFilters,
} from '../../src/shared/finish';
import { baseLang, guessLang, isStopword, wordsOf } from '../../src/shared/langs';
import { concatList, copyable, joinBox, joinEncodeArgs, liveList, livePieces, mediaInfoIn } from '../../src/shared/join';
import { parseUrls } from '../../src/shared/batch';
import { pieceFilename } from '../../src/shared/filename';

const VIDEO_LOG = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'in.mp4':
  Duration: 00:02:05.50, start: 0.000000, bitrate: 1200 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 1000 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s (default)`;

const MP3_LOG = `Input #0, mp3, from 'in.mp3':
  Duration: 00:03:00.00, start: 0.025057, bitrate: 192 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 48000 Hz, mono, fltp, 192 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 600x600 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)`;

describe('cleanFinish', () => {
  it('keeps only what makes sense', () => {
    expect(cleanFinish(undefined, false)).toBeUndefined();
    expect(cleanFinish({}, false)).toBeUndefined();
    // What the local AI did before 2.5 is left out.
    expect(cleanFinish({ compress: 25, burn: true, split: true, summary: true, transcribe: 'auto', translate: 'fr' }, false)).toEqual({
      compress: 25,
      burn: true,
      split: true,
    });
  });
  it('refuses odd values', () => {
    expect(cleanFinish({ compress: -3, burn: 'yes', translate: 'auto', transcribe: '<script>' }, false)).toBeUndefined();
    expect(cleanFinish({ compress: Infinity }, false)).toBeUndefined();
  });
  it('drops picture changes for a sound file', () => {
    expect(cleanFinish({ burn: true, edit: { crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, rotate: 90, mute: true, speed: 1.5 } }, true)).toEqual({ edit: { speed: 1.5 } });
  });
  it('clamps the speed and ignores a speed of 1', () => {
    expect(cleanFinish({ edit: { speed: 10 } }, false)).toEqual({ edit: { speed: 4 } });
    expect(cleanFinish({ edit: { speed: 1 } }, false)).toBeUndefined();
  });
  it('says what needs encoding', () => {
    expect(needsEncode({ split: true })).toBe(false);
    expect(needsEncode({ compress: 10 })).toBe(true);
    expect(needsEncode({ edit: { mute: true } })).toBe(true);
  });
});

describe('cleanCrop', () => {
  it('keeps a crop inside the picture', () => {
    expect(cleanCrop({ x: 0.5, y: 0.5, w: 0.8, h: 0.8 })).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });
  it('drops a tiny crop or one that keeps everything', () => {
    expect(cleanCrop({ x: 0, y: 0, w: 0.05, h: 0.5 })).toBeUndefined();
    expect(cleanCrop({ x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
    expect(cleanCrop({ x: 'a', y: 0, w: 1, h: 1 })).toBeUndefined();
  });
});

describe('canBurn', () => {
  it('burns only writings the font draws', () => {
    expect(canBurn('fr')).toBe(true);
    expect(canBurn('ru')).toBe(true);
    expect(canBurn(undefined)).toBe(true);
    expect(canBurn('zh-Hans')).toBe(false);
    expect(canBurn('ja')).toBe(false);
    expect(canBurn('ar')).toBe(false);
  });
});

describe('atempo', () => {
  it('chains steps out of 0.5–2', () => {
    expect(atempo(1)).toEqual([]);
    expect(atempo(1.5)).toEqual(['atempo=1.5']);
    expect(atempo(4)).toEqual(['atempo=2', 'atempo=2']);
    expect(atempo(3)).toEqual(['atempo=2', 'atempo=1.5']);
    expect(atempo(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
  });
});

describe('videoFilters', () => {
  it('orders crop, turn, flip, scale, subtitles, speed', () => {
    const f = videoFilters({ crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, rotate: 90, flip: true, speed: 2 }, { height: 480, burn: '/w/s.srt' });
    expect(f[0]).toBe('crop=trunc(iw*0.5/2)*2:trunc(ih*0.6/2)*2:trunc(iw*0.1):trunc(ih*0.2)');
    expect(f.slice(1, 4)).toEqual(['transpose=1', 'hflip', "scale=-2:'min(480,ih)':flags=lanczos"]);
    expect(f[4]).toMatch(/^subtitles=\/w\/s\.srt:fontsdir=\/fonts:force_style='FontName=Noto Sans,/);
    expect(f[5]).toBe('setpts=PTS/2');
  });
  it('turns upside down with both flips', () => {
    expect(videoFilters({ rotate: 180 })).toEqual(['hflip', 'vflip']);
    expect(videoFilters({ rotate: 270 })).toEqual(['transpose=2']);
    expect(videoFilters(undefined)).toEqual([]);
  });
});

describe('budget', () => {
  it('fits a short clip in 25 MB in full HD', () => {
    const b = budget(25, 30, { video: true, sound: true, height: 1080 });
    expect(b.audio).toBe(128);
    expect(b.video).toBeGreaterThan(4000);
    expect(b.height).toBeUndefined();
  });
  it('lowers the picture for a long video', () => {
    const b = budget(10, 600, { video: true, sound: true, height: 1080 });
    // 10 MB over 10 minutes: about 131 kbit/s in all.
    expect(b.video + b.audio).toBeLessThanOrEqual(132);
    expect(b.height).toBe(240);
    expect((b.video + b.audio) * 600 * 1000 / 8).toBeLessThanOrEqual(10 * 1024 * 1024);
  });
  it('gives a sound file all of it, within limits', () => {
    expect(budget(10, 600, { video: false, sound: true })).toEqual({ video: 0, audio: 131 });
    expect(budget(100, 10, { video: false, sound: true }).audio).toBe(192);
  });
  it('gives no sound bitrate to a muted video', () => {
    expect(budget(25, 60, { video: true, sound: false }).audio).toBe(0);
  });
});

describe('encodeAttempts', () => {
  it('copies the sound when only the picture changes', () => {
    const [first, second, third] = encodeAttempts({ input: '/w/in.mp4', outBase: '/w/out', ext: 'mp4', audioOnly: false, edit: { rotate: 90 }, sound: true });
    expect(first!.out).toBe('/w/out.mp4');
    expect(first!.args).toContain('copy');
    expect(first!.args.join(' ')).toContain('-vf transpose=1 -c:v libx264');
    expect(first!.args.join(' ')).toContain('-c:s mov_text');
    expect(second!.args.join(' ')).toContain('-c:a aac');
    expect(third!.args).toContain('-sn');
  });
  it('makes a WebM an MP4 and keeps MKV', () => {
    expect(editedExt('webm')).toBe('mp4');
    expect(editedExt('mkv')).toBe('mkv');
    expect(encodeAttempts({ input: 'i', outBase: 'o', ext: 'webm', audioOnly: false, edit: { flip: true } })[0]!.out).toBe('o.mp4');
  });
  it('sets bitrates and a height for a size', () => {
    const tries = encodeAttempts({ input: 'i', outBase: 'o', ext: 'mp4', audioOnly: false, compress: 10, duration: 600, height: 1080, sound: true });
    // No copied sound: it has to fit too.
    expect(tries).toHaveLength(2);
    const a = tries[0]!.args.join(' ');
    expect(a).toMatch(/-b:v \d+k -maxrate \d+k -bufsize \d+k/);
    expect(a).toContain("scale=-2:'min(240,ih)'");
    expect(a).toContain('-b:a 32k');
  });
  it('changes the sound speed and drops subtitle tracks', () => {
    const a = encodeAttempts({ input: 'i', outBase: 'o', ext: 'mp4', audioOnly: false, edit: { speed: 3 }, sound: true })[0]!.args.join(' ');
    expect(a).toContain('-af atempo=2,atempo=1.5');
    expect(a).toContain('setpts=PTS/3');
    expect(a).toContain('-sn');
    expect(a).toContain('-map_chapters -1');
  });
  it('moves the chapters to the new speed when given', () => {
    const a = encodeAttempts({ input: 'i', outBase: 'o', ext: 'mp4', audioOnly: false, edit: { speed: 2 }, chapters: '/w/ch.txt' })[0]!.args;
    expect(a.slice(0, 5)).toEqual(['-y', '-i', 'i', '-i', '/w/ch.txt']);
    expect(a.join(' ')).toContain('-map_chapters 1');
  });
  it('drops the subtitle tracks it burns in', () => {
    const a = encodeAttempts({ input: 'i', outBase: 'o', ext: 'mp4', audioOnly: false, burn: '/w/s.srt', sound: true })[0]!.args;
    expect(a).toContain('-sn');
    expect(a).not.toContain('0:s?');
    expect(a.join(' ')).toContain('-c:a copy');
  });
  it('mutes', () => {
    const a = encodeAttempts({ input: 'i', outBase: 'o', ext: 'mp4', audioOnly: false, edit: { mute: true }, sound: true })[0]!.args;
    expect(a).toContain('-an');
    expect(a).not.toContain('0:a?');
  });
  it('makes a sound file smaller in its own kind, FLAC as M4A', () => {
    const mp3 = encodeAttempts({ input: 'i.mp3', outBase: 'o', ext: 'mp3', audioOnly: true, compress: 10, duration: 600 })[0]!;
    expect(mp3.out).toBe('o.mp3');
    expect(mp3.args.join(' ')).toContain('-c:a libmp3lame -b:a 131k');
    expect(mp3.args).toContain('-id3v2_version');
    const flac = encodeAttempts({ input: 'i.flac', outBase: 'o', ext: 'flac', audioOnly: true, compress: 10, duration: 600 })[0]!;
    expect(flac.out).toBe('o.m4a');
    const slow = encodeAttempts({ input: 'i.flac', outBase: 'o', ext: 'flac', audioOnly: true, edit: { speed: 0.5 } })[0]!;
    expect(slow.out).toBe('o.flac');
    expect(slow.args.join(' ')).toContain('-af atempo=0.5 -c:a flac');
  });
});

describe('speed and chapters', () => {
  it('moves cues and chapters to the new clock', () => {
    expect(speedCues([{ start: 10, end: 20, text: 'a' }], 2)).toEqual([{ start: 5, end: 10, text: 'a' }]);
    expect(speedChapters([{ start: 30, title: 'b' }], 1.5)).toEqual([{ start: 20, title: 'b' }]);
    expect(speedCues([{ start: 1, end: 2, text: 'x' }], 1)[0]!.start).toBe(1);
  });
  it('cuts one piece per chapter, joining very short ones', () => {
    const pieces = chapterPieces(
      [
        { start: 60, title: 'Deux' },
        { start: 0, title: 'Un' },
        { start: 60.5, title: ' ' },
        { start: 500, title: 'Hors' },
      ],
      120,
    );
    expect(pieces).toEqual([
      { start: 0, length: 60, title: 'Un', n: 1 },
      { start: 60.5, length: 59.5, title: '2', n: 2 },
    ]);
  });
  it('builds the cut and its name', () => {
    const a = pieceArgs('/w/in.mp3', '/w/p1.mp3', { start: 12.5, length: 30, title: 'Intro', n: 1 }, 12, { album: 'Album', artist: 'Moi' });
    expect(a.slice(0, 7)).toEqual(['-y', '-ss', '12.5', '-i', '/w/in.mp3', '-t', '30']);
    expect(a).toContain('track=1/12');
    expect(a).toContain('album=Album');
    expect(a).toContain('-id3v2_version');
    expect(pieceName(3, 12, 'Le titre')).toBe('03 - Le titre');
    expect(pieceName(7, 120, 'x')).toBe('007 - x');
  });
  it('puts the pieces in a folder named like the file', () => {
    expect(pieceFilename('Grabby/Musique/Titre.mp3', '01 - Intro', 'mp3')).toBe('Grabby/Musique/Titre/01 - Intro.mp3');
    expect(pieceFilename('Titre', '02 - A/B', 'mp4')).toBe('Titre/02 - A-B.mp4');
  });
});

describe('reading ffmpeg', () => {
  it('reads the length, the height and the sound', () => {
    expect(durationIn(VIDEO_LOG)).toBe(125.5);
    expect(heightIn(VIDEO_LOG)).toBe(1080);
    expect(hasSoundIn(VIDEO_LOG)).toBe(true);
    expect(durationIn('Duration: N/A')).toBeUndefined();
  });
  it('describes an input for joining', () => {
    expect(mediaInfoIn(VIDEO_LOG)).toEqual({ duration: 125.5, video: { codec: 'h264', width: 1920, height: 1080 }, audio: { codec: 'aac', rate: 44100, channels: 2 } });
    // A cover picture isn't a video.
    expect(mediaInfoIn(MP3_LOG)).toEqual({ duration: 180, audio: { codec: 'mp3', rate: 48000, channels: 1 } });
  });
});

describe('join', () => {
  const hd = { duration: 10, video: { codec: 'h264', width: 1920, height: 1080 }, audio: { codec: 'aac', rate: 44100, channels: 2 } };
  it('copies files that are alike', () => {
    expect(copyable([hd, { ...hd, duration: 20 }])).toBe(true);
    expect(copyable([hd, { ...hd, video: { ...hd.video, width: 1280, height: 720 } }])).toBe(false);
    expect(copyable([hd, { ...hd, audio: undefined }])).toBe(false);
  });
  it('writes the concat list with quotes escaped', () => {
    expect(concatList(['/w/a.mp4', "/w/l'été.mp4"])).toBe("ffconcat version 1.0\nfile '/w/a.mp4'\nfile '/w/l'\\''été.mp4'\n");
  });
  it('fits everything in the first picture, at most 1920 wide', () => {
    expect(joinBox([{ video: { codec: 'h264', width: 3840, height: 1634 } }])).toEqual({ w: 1920, h: 816 });
    expect(joinBox([{ audio: { codec: 'mp3' } }])).toEqual({ w: 1280, h: 720 });
  });
  it('fills a sound file with black and a silent video with silence', () => {
    const args = joinEncodeArgs(['/a.mp4', '/b.mp3', '/c.mp4'], [hd, { duration: 5, audio: { codec: 'mp3' } }, { duration: 3, video: hd.video }], '/o.mp4', {
      audioOnly: false,
      audioCodec: ['-c:a', 'aac'],
    });
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('color=c=black:s=1920x1080:r=30:d=5.000');
    expect(graph).toContain('anullsrc=r=48000:cl=stereo,atrim=0:3.000[a2]');
    expect(graph).toMatch(/\[v0\]\[a0\]\[v1\]\[a1\]\[v2\]\[a2\]concat=n=3:v=1:a=1\[v\]\[a\]$/);
    expect(args).toContain('+faststart');
  });
  it('joins sounds only', () => {
    const args = joinEncodeArgs(['/a.mp3', '/b.mp3'], [{ audio: { codec: 'mp3' } }, { audio: { codec: 'mp3' } }], '/o.mp3', { audioOnly: true, audioCodec: ['-c:a', 'libmp3lame'] });
    expect(args.join(' ')).toContain('concat=n=2:v=0:a=1[a]');
    expect(args).not.toContain('[v]');
  });
});

describe('live pieces', () => {
  // Real starts read from a YouTube live recording (sound in MP4, picture in WebM).
  const sound = [46815.01678, 46820.00907, 46825.001361, 46830.016871].map((start, i) => ({ path: `a-${i}.mp4`, start }));
  const picture = [46820, 46825, 46830].map((start, i) => ({ path: `v-${i}.webm`, start }));

  it('starts both tracks together', () => {
    expect(livePieces(picture, sound[0]!.start).map((p) => p.path)).toEqual(['v-0.webm', 'v-1.webm', 'v-2.webm']);
    expect(livePieces(sound, picture[0]!.start).map((p) => p.path)).toEqual(['a-1.mp4', 'a-2.mp4', 'a-3.mp4']);
  });

  it('keeps everything with nothing to start with, and leaves out pieces fetched again', () => {
    expect(livePieces(sound)).toHaveLength(4);
    const again = [picture[0]!, picture[1]!, { path: 'v-again.webm', start: 46825 }, picture[2]!];
    expect(livePieces(again).map((p) => p.path)).toEqual(['v-0.webm', 'v-1.webm', 'v-2.webm']);
  });

  it('lasts each piece until the next one starts', () => {
    expect(liveList(sound.slice(1))).toBe("ffconcat version 1.0\nfile 'a-1.mp4'\nduration 4.992291\nfile 'a-2.mp4'\nduration 5.015510\nfile 'a-3.mp4'\n");
    expect(liveList([{ path: "it's.webm", start: 0 }])).toBe("ffconcat version 1.0\nfile 'it'\\''s.webm'\n");
  });
});

describe('languages', () => {
  it('splits words and knows common ones', () => {
    expect(wordsOf("L'été, c'est très chaud !")).toEqual(['l', 'été', 'c', 'est', 'très', 'chaud']);
    expect(isStopword('les', 'fr')).toBe(true);
    expect(isStopword('montagne', 'fr')).toBe(false);
    expect(isStopword('the')).toBe(true);
  });
  it('guesses the language of a text', () => {
    expect(guessLang('Le chat est sur la table et il dort dans le salon avec les enfants')).toBe('fr');
    expect(guessLang('The cat is on the table and it is sleeping with the children')).toBe('en');
    expect(guessLang('42')).toBeUndefined();
    expect(baseLang('pt-BR')).toBe('pt');
    expect(baseLang(undefined)).toBeUndefined();
  });
});

describe('pasted addresses', () => {
  it('finds each address once, in order', () => {
    expect(parseUrls('https://a.test/1\nfoo https://b.test/2, (https://a.test/1) "http://c.test/x." ftp://d.test')).toEqual(['https://a.test/1', 'https://b.test/2', 'http://c.test/x']);
    expect(parseUrls('')).toEqual([]);
  });
});
