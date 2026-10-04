# Changelog

## 1.1.0 — 2026-10-04

- **Format choice:** MP4 (default), WebM or MKV, per download and as a setting. WebM/VP9
  sources are copied into MP4 without re-encoding; MP4 files start playing before they are
  fully loaded (`+faststart`).
- **Done notification** (can be turned off) and a **Download again** button.
- **Better detection:** each file is checked from its first bytes (real video, duration,
  encryption); error pages, ad creatives, hover previews and clips under 2 s are no longer
  listed; a player already offered as a stream is no longer listed a second time.
- **Encrypted files (DRM)** such as those of streaming platforms are now shown as protected
  instead of producing unreadable files. Grabby still never bypasses DRM.
- **Real titles and thumbnails:** brand suffixes removed ("— Vidéo Dailymotion"), schema.org
  metadata, file names made of ids ignored; when a page has no preview image, a still of
  the video is used.
- Quality labels of vertical videos (1080p instead of 608p).
- Popup: long quality lists wrap instead of overflowing.
- **YouTube (experimental):** the qualities YouTube really offers (up to
  4K/8K) with their sizes, MP4 (H.264/AAC, VP9 above 1080p) or WebM (VP9/Opus), recorded in a
  hidden player: the video you are watching is not affected and you can leave the page.

## 1.0.0 — 2026-10-04

First release.

- Automatic detection of non-encrypted video on any page: direct files, HLS, DASH,
  plus a capture mode for adaptive players that expose no file.
- Quality choice, audio-only extraction (M4A or MP3), live progress, cancel, retry, history.
- Assembly with a bundled ffmpeg.wasm (no remote code).
- Protected content (DRM, encrypted HLS) is detected and never downloaded.
- Experimental YouTube capture.
- English and French interface, light/dark theme.
