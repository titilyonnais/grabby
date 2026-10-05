// Generates small media fixtures for E2E tests with the system ffmpeg.
// Usage: node scripts/make-fixtures.mjs   (requires `ffmpeg` on PATH)
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'test/fixtures/media');

const run = (cwd, args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit', cwd });
const ff = (...args) => run(root, args);
// Segmenting muxers write side files relative to the cwd: run them inside the output dir.
const ffIn = (dir, ...args) => run(join(out, dir), args);

const SRC = (size) => [
  '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=25`,
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
  '-t', '6',
];
const H264 = ['-c:v', 'libx264', '-profile:v', 'main', '-level', '3.0', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0'];
const AAC = ['-c:a', 'aac', '-b:a', '64k', '-ac', '2'];

if (process.argv.includes('--extras')) {
  await extras();
  process.exit(0);
}
if (process.argv.includes('--subs')) {
  await subtitles();
  process.exit(0);
}
if (process.argv.includes('--v18')) {
  await v18();
  process.exit(0);
}
await rm(out, { recursive: true, force: true });
for (const d of ['hls/360', 'hls/180', 'hls-fmp4', 'dash', 'hls-aes', 'mse', 'mse-webm', 'protected-referer', 'encrypted', 'preview']) {
  await mkdir(join(out, d), { recursive: true });
}

// 1. Progressive MP4 (also served behind a Referer check).
ff(...SRC('640x360'), ...H264, ...AAC, '-movflags', '+faststart', join(out, 'sample.mp4'));
ff('-i', join(out, 'sample.mp4'), '-c', 'copy', join(out, 'protected-referer/clip.mp4'));

// 2. HLS (MPEG-TS) with two renditions + hand-written master.
for (const [dir, size] of [['360', '640x360'], ['180', '320x180']]) {
  ff(...SRC(size), ...H264, ...AAC, '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
    '-hls_segment_filename', join(out, `hls/${dir}/seg%d.ts`), join(out, `hls/${dir}/index.m3u8`));
}
await writeFile(join(out, 'hls/master.m3u8'), [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"',
  '360/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=320x180,CODECS="avc1.4d401e,mp4a.40.2"',
  '180/index.m3u8',
  '',
].join('\n'));

// 3. HLS fMP4.
ffIn('hls-fmp4', ...SRC('640x360'), ...H264, ...AAC, '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
  '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
  '-hls_segment_filename', join(out, 'hls-fmp4/seg%d.m4s'), join(out, 'hls-fmp4/index.m3u8'));

// 4. DASH with separate audio/video adaptation sets.
ffIn('dash', ...SRC('640x360'), ...H264, ...AAC, '-f', 'dash', '-seg_duration', '2', '-use_template', '1', '-use_timeline', '0',
  '-adaptation_sets', 'id=0,streams=v id=1,streams=a', join(out, 'dash/manifest.mpd'));
await subtitles();

// 5. HLS AES-128 (must be refused as protected).
await writeFile(join(out, 'hls-aes/key.bin'), Buffer.alloc(16, 7));
await writeFile(join(out, 'hls-aes/keyinfo.txt'), `key.bin\n${join(out, 'hls-aes/key.bin')}\n`);
ff(...SRC('320x180'), ...H264, ...AAC, '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
  '-hls_key_info_file', join(out, 'hls-aes/keyinfo.txt'),
  '-hls_segment_filename', join(out, 'hls-aes/seg%d.ts'), join(out, 'hls-aes/index.m3u8'));
await rm(join(out, 'hls-aes/keyinfo.txt'));

// 6. Fragmented MP4 tracks for the MSE capture page (separate video/audio, like adaptive players).
ff(...SRC('640x360'), '-map', '0:v', ...H264, '-an', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', join(out, 'mse/video.mp4'));
ff(...SRC('640x360'), '-map', '1:a', ...AAC, '-vn', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '1000000', join(out, 'mse/audio.mp4'));

const size = async (f) => (await stat(join(out, f))).size;
await writeFile(join(out, 'mse/sizes.json'), JSON.stringify({ video: await size('mse/video.mp4'), audio: await size('mse/audio.mp4') }));

await extras();
await v18();

console.log('✓ fixtures written to test/fixtures/media');

/** Fixtures added in 1.1 (also runnable alone: `node scripts/make-fixtures.mjs --extras`). */
async function extras() {
  for (const d of ['mse-webm', 'encrypted', 'preview', 'qualities']) await mkdir(join(out, d), { recursive: true });
  const VP9 = ['-c:v', 'libvpx-vp9', '-b:v', '300k', '-deadline', 'realtime', '-cpu-used', '8', '-g', '50'];
  const OPUS = ['-c:a', 'libopus', '-b:a', '48k'];
  // 7. WebM (VP9 + Opus): container detection and "record to MP4" without re-encoding.
  ff(...SRC('640x360'), ...VP9, ...OPUS, join(out, 'sample.webm'));
  ff(...SRC('640x360'), '-map', '0:v', ...VP9, '-an', '-dash', '1', join(out, 'mse-webm/video.webm'));
  ff(...SRC('640x360'), '-map', '1:a', ...OPUS, '-vn', '-dash', '1', join(out, 'mse-webm/audio.webm'));
  const bytes = async (f) => (await stat(join(out, f))).size;
  await writeFile(join(out, 'mse-webm/sizes.json'), JSON.stringify({ video: await bytes('mse-webm/video.webm'), audio: await bytes('mse-webm/audio.webm') }));
  // 8. Common-encryption MP4, as served by DRM platforms: must be shown as protected.
  ff(...SRC('320x180'), ...H264, ...AAC, '-encryption_scheme', 'cenc-aes-ctr',
    '-encryption_key', '00112233445566778899aabbccddeeff', '-encryption_kid', '0123456789abcdef0123456789abcdef',
    '-movflags', '+faststart', join(out, 'encrypted/movie.mp4'));
  // 9. Short muted loop, like hover previews on video portals: not a real video.
  ff('-f', 'lavfi', '-i', 'testsrc2=size=426x240:rate=25', '-t', '4', ...H264, '-an', '-movflags', '+faststart', join(out, 'preview/teaser.mp4'));
  // 10. The same video in a smaller quality, offered by the player as a second <source>.
  ff(...SRC('426x240'), ...H264, ...AAC, '-movflags', '+faststart', join(out, 'qualities/clip-240.mp4'));
}

/**
 * 11. Subtitles, the way streams carry them. HLS: WebVTT cut in 2-second segments mapped to
 * the video's clock, a line crossing a segment edge repeated in both. DASH: one WebVTT file
 * in its own adaptation set.
 */
async function subtitles() {
  const cues = [
    ['00:00.500 --> 00:01.800', 'Bonjour'],
    ['00:02.500 --> 00:03.800', '<i>le monde</i>'],
    ['00:03.900 --> 00:04.600', 'Au revoir'],
    ['00:05.000 --> 00:05.800', 'Fin'],
  ];
  const vtt = (list, map) =>
    ['WEBVTT', ...(map ? ['X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000'] : []), '', ...list.flatMap(([t, x]) => [t, x, ''])].join('\n');
  const bySegment = [[cues[0]], [cues[1], cues[2]], [cues[2], cues[3]]];
  await mkdir(join(out, 'hls/subs'), { recursive: true });
  for (const [i, list] of bySegment.entries()) await writeFile(join(out, `hls/subs/fr${i}.vtt`), vtt(list, true));
  await writeFile(join(out, 'hls/subs/fr.m3u8'), [
    '#EXTM3U', '#EXT-X-TARGETDURATION:2', '#EXT-X-PLAYLIST-TYPE:VOD',
    ...bySegment.flatMap((_, i) => ['#EXTINF:2.0,', `fr${i}.vtt`]),
    '#EXT-X-ENDLIST', '',
  ].join('\n'));
  await writeFile(join(out, 'hls/master.m3u8'), [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Français",LANGUAGE="fr",DEFAULT=NO,AUTOSELECT=YES,URI="subs/fr.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",SUBTITLES="subs"',
    '360/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=320x180,CODECS="avc1.4d401e,mp4a.40.2",SUBTITLES="subs"',
    '180/index.m3u8',
    '',
  ].join('\n'));

  await writeFile(join(out, 'dash/subs-fr.vtt'), vtt(cues, false));
  const mpd = join(out, 'dash/manifest.mpd');
  const text = (await readFile(mpd, 'utf8')).replace(/\s*<AdaptationSet id="2"[\s\S]*?<\/AdaptationSet>/, '');
  const set = [
    '\t\t<AdaptationSet id="2" contentType="text" mimeType="text/vtt" lang="fr">',
    '\t\t\t<Representation id="sub-fr" bandwidth="256">',
    '\t\t\t\t<BaseURL>subs-fr.vtt</BaseURL>',
    '\t\t\t</Representation>',
    '\t\t</AdaptationSet>',
    '',
  ].join('\n');
  await writeFile(mpd, text.replace('\t</Period>', `${set}\t</Period>`));
  await packedSubtitles(cues);
}

/**
 * 12. Subtitles in every other form a page or a stream may use: whole WebVTT and TTML files
 * (a <track>, a DASH TTML file) and subtitles packed in MP4 segments, `wvtt` and `stpp`, in a
 * second DASH manifest. The MP4 boxes are written by hand: ffmpeg can't make `wvtt`.
 */
async function packedSubtitles(cues) {
  const sec = (t) => {
    const [m, s] = t.split(':');
    return Number(m) * 60 + Number(s);
  };
  const list = cues.map(([t, text]) => {
    const [a, b] = t.split(' --> ');
    return { start: sec(a), end: sec(b), text };
  });
  await mkdir(join(out, 'subs'), { recursive: true });
  await writeFile(join(out, 'subs/fr.vtt'), ['WEBVTT', '', ...cues.flatMap(([t, x]) => [t, x, ''])].join('\n'));
  const clockOf = (s) => {
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    return `${h}:${m}:${(s % 60).toFixed(3).padStart(6, '0')}`;
  };
  const ttml = (items) =>
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="es">',
      '<head><styling><style xml:id="i" tts:fontStyle="italic"/></styling></head>',
      '<body><div>',
      ...items.map((c) => {
        const it = /^<i>(.*)<\/i>$/.exec(c.text);
        const body = it ? `<span style="i">${it[1]}</span>` : c.text;
        return `<p begin="${clockOf(c.start)}" end="${clockOf(c.end)}">${body}</p>`;
      }),
      '</div></body></tt>',
      '',
    ].join('\n');
  await writeFile(join(out, 'dash/subs-it.ttml'), ttml(list));

  // A minimal MP4 writer.
  const enc = new TextEncoder();
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const cat = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
  const box = (type, ...body) => {
    const inner = cat(...body);
    return cat(u32(inner.length + 8), enc.encode(type), inner);
  };
  const full = (type, version, flags, ...body) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...body);
  const SCALE = 1000;
  const init = (format, entryBody) => {
    const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(SCALE), u32(6 * SCALE), [0x55, 0xc4, 0, 0]);
    const hdlr = full('hdlr', 0, 0, u32(0), enc.encode(format === 'wvtt' ? 'text' : 'subt'), u32(0), u32(0), u32(0), [0]);
    const stsd = full('stsd', 0, 0, u32(1), box(format, [0, 0, 0, 0, 0, 0, 0, 1], ...entryBody));
    const stbl = box('stbl', stsd, full('stts', 0, 0, u32(0)), full('stsc', 0, 0, u32(0)), full('stsz', 0, 0, u32(0), u32(0)), full('stco', 0, 0, u32(0)));
    const minf = box('minf', full('sthd', 0, 0), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl);
    const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(0), new Array(52).fill(0), u32(0), u32(0));
    const trak = box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(SCALE), u32(0), u32(0x10000), [1, 0], new Array(10).fill(0), new Array(36).fill(0), new Array(24).fill(0), u32(2));
    const mvex = box('mvex', full('trex', 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0)));
    return cat(box('ftyp', enc.encode('iso6'), u32(0), enc.encode('iso6'), enc.encode('dash')), box('moov', mvhd, trak, mvex));
  };
  const fragment = (seq, decodeTime, samples) => {
    const build = (offset) => {
      const trun = full('trun', 0, 0x1 | 0x100 | 0x200, u32(samples.length), u32(offset), ...samples.flatMap(([d, p]) => [u32(d), u32(p.length)]));
      const traf = box('traf', full('tfhd', 0, 0x20000, u32(1)), full('tfdt', 1, 0, u32(0), u32(decodeTime)), trun);
      return box('moof', full('mfhd', 0, 0, u32(seq)), traf);
    };
    const moof = build(build(0).length + 8);
    return cat(moof, box('mdat', ...samples.map(([, p]) => p)));
  };
  // Samples of a 2-second segment: what is shown when (wvtt: an empty `vtte` in the gaps).
  const wvttSegment = (from, to) => {
    const marks = [...new Set([from, to, ...list.flatMap((c) => [c.start, c.end]).filter((t) => t > from && t < to)])].sort((a, b) => a - b);
    const samples = [];
    for (let k = 0; k + 1 < marks.length; k++) {
      const shown = list.filter((c) => c.start <= marks[k] && c.end >= marks[k + 1]);
      const payload = shown.length ? cat(...shown.map((c) => box('vttc', box('payl', enc.encode(c.text))))) : box('vtte');
      samples.push([Math.round((marks[k + 1] - marks[k]) * SCALE), payload]);
    }
    return samples;
  };
  for (const [dir, format, entry] of [
    ['subs-wvtt', 'wvtt', [box('vttC', enc.encode('WEBVTT'))]],
    ['subs-stpp', 'stpp', [enc.encode('http://www.w3.org/ns/ttml\0\0\0')]],
  ]) {
    await mkdir(join(out, `dash/${dir}`), { recursive: true });
    await writeFile(join(out, `dash/${dir}/init.mp4`), init(format, entry));
    for (let n = 0; n < 3; n++) {
      const from = n * 2;
      const samples =
        format === 'wvtt' ? wvttSegment(from, from + 2) : [[2 * SCALE, enc.encode(ttml(list.filter((c) => c.end > from && c.start < from + 2)))]];
      await writeFile(join(out, `dash/${dir}/seg${n + 1}.m4s`), fragment(n + 1, from * SCALE, samples));
    }
  }
  const base = (await readFile(join(out, 'dash/manifest.mpd'), 'utf8')).replace(/\s*<AdaptationSet id="2"[\s\S]*?<\/AdaptationSet>/, '');
  const sets = [
    ['3', 'de', 'subs-wvtt', 'wvtt'],
    ['4', 'es', 'subs-stpp', 'stpp.ttml.im1t'],
  ].map(([id, lang, dir, codecs]) =>
    [
      `\t\t<AdaptationSet id="${id}" contentType="text" mimeType="application/mp4" lang="${lang}">`,
      `\t\t\t<Representation id="sub-${lang}" bandwidth="256" codecs="${codecs}">`,
      `\t\t\t\t<SegmentTemplate timescale="${SCALE}" duration="${2 * SCALE}" initialization="${dir}/init.mp4" media="${dir}/seg$Number$.m4s" startNumber="1"/>`,
      '\t\t\t</Representation>',
      '\t\t</AdaptationSet>',
    ].join('\n'),
  );
  sets.push(
    [
      '\t\t<AdaptationSet id="5" contentType="text" mimeType="application/ttml+xml" lang="it">',
      '\t\t\t<Representation id="sub-it" bandwidth="256">',
      '\t\t\t\t<BaseURL>subs-it.ttml</BaseURL>',
      '\t\t\t</Representation>',
      '\t\t</AdaptationSet>',
    ].join('\n'),
  );
  await writeFile(join(out, 'dash/manifest-packed.mpd'), base.replace('\t</Period>', `${sets.join('\n')}\n\t</Period>`));
}

/**
 * 12. Fixtures added in 1.8 (`node scripts/make-fixtures.mjs --v18`): an HLS stream whose
 * sound comes in two languages (separate renditions, a different tone each), and chapters
 * for a <video src> (<track kind="chapters">).
 */
async function v18() {
  for (const d of ['hls-multi/v', 'hls-multi/en', 'hls-multi/fr']) await mkdir(join(out, d), { recursive: true });
  const hls = (dir) => ['-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(out, `hls-multi/${dir}/seg%d.ts`), join(out, `hls-multi/${dir}/index.m3u8`)];
  ff('-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-t', '6', ...H264, '-an', ...hls('v'));
  for (const [dir, hz] of [['en', 440], ['fr', 880]]) {
    ff('-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=44100`, '-t', '6', ...AAC, '-vn', ...hls(dir));
  }
  await writeFile(join(out, 'hls-multi/master.m3u8'), [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="en/index.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Français",LANGUAGE="fr",DEFAULT=NO,AUTOSELECT=YES,URI="fr/index.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud"',
    'v/index.m3u8',
    '',
  ].join('\n'));
  await mkdir(join(out, 'subs'), { recursive: true });
  await writeFile(join(out, 'subs/chapters.vtt'), ['WEBVTT', '', '00:00.000 --> 00:02.000', 'Début', '', '00:02.000 --> 00:04.000', 'Milieu', '', '00:04.000 --> 00:06.000', 'Fin', ''].join('\n'));
}
