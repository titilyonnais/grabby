// Generates small media fixtures for E2E tests with the system ffmpeg.
// Usage: node scripts/make-fixtures.mjs   (requires `ffmpeg` on PATH)
import { execFileSync } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
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

await rm(out, { recursive: true, force: true });
for (const d of ['hls/360', 'hls/180', 'hls-fmp4', 'dash', 'hls-aes', 'mse', 'protected-referer']) {
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

console.log('✓ fixtures written to test/fixtures/media');
