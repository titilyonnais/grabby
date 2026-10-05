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
}
