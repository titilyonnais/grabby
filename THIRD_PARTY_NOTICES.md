# Third-party notices

Grabby's own source code is licensed under the MIT License (see `LICENSE`).

The packaged extension (the `.zip` files and the `dist/` folders) also contains the
components below. Because it bundles **ffmpeg-core**, the packaged extension as a whole
is distributed under the terms of the **GNU GPL version 2 or later**; the MIT-licensed
code is compatible with that license. The complete corresponding source code is the
public repository this package was built from, plus the sources listed below.

| Component | Version | License | Source |
|---|---|---|---|
| ffmpeg-core (FFmpeg compiled to WebAssembly by ffmpeg.wasm) | 0.12.10 | GPL-2.0-or-later | https://github.com/ffmpegwasm/ffmpeg.wasm — FFmpeg: https://ffmpeg.org |
| Preact | 11 | MIT | https://github.com/preactjs/preact |
| Instrument Sans (font) | variable | SIL Open Font License 1.1 | https://github.com/Instrument/instrument-sans |
| Noto Sans (font, used to burn subtitles into the picture) | Regular | SIL Open Font License 1.1 | https://github.com/notofonts/latin-greek-cyrillic |

License texts shipped in the package: `licenses/GPL-2.0.txt`, `licenses/MIT-Preact.txt`,
`licenses/OFL-InstrumentSans.txt`, `licenses/OFL-NotoSans.txt`.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.
