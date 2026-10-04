# Changelog

## 1.0.0 — 2026-10-04

First release.

- Automatic detection of non-encrypted video on any page: direct files, HLS, DASH,
  plus a capture mode for adaptive players that expose no file.
- Quality choice, audio-only extraction (M4A or MP3), live progress, cancel, retry, history.
- Assembly with a bundled ffmpeg.wasm (no remote code).
- Protected content (DRM, encrypted HLS) is detected and never downloaded.
- Experimental YouTube capture.
- English and French interface, light/dark theme.
