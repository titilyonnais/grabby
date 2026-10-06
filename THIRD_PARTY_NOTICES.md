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
| transformers.js (`@huggingface/transformers`) | 4.3.0 | Apache-2.0 | https://github.com/huggingface/transformers.js |
| ONNX Runtime Web (`onnxruntime-web`, WebAssembly build) | 1.31.0-dev | MIT | https://github.com/microsoft/onnxruntime |

License texts shipped in the package: `licenses/GPL-2.0.txt`, `licenses/MIT-Preact.txt`,
`licenses/OFL-InstrumentSans.txt`, `licenses/OFL-NotoSans.txt`, `licenses/Apache-2.0.txt`,
`licenses/MIT-onnxruntime.txt`.

## AI models (not in the package)

The local AI features download model weights **only when the user agrees**, once, from
Hugging Face. They are data (network weights), not code, and keep their own licenses:

| Model | Used for | License | Source |
|---|---|---|---|
| Whisper base (OpenAI), ONNX conversion | Transcription | Apache-2.0 | https://huggingface.co/openai/whisper-base — https://huggingface.co/onnx-community/whisper-base |
| Opus-MT (Helsinki-NLP), one model per language pair, ONNX conversions | Translation | Apache-2.0 | https://huggingface.co/Helsinki-NLP — https://huggingface.co/Xenova |

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.
