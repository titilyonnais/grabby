import { describe, expect, it } from 'vitest';
import { isWhisper, modelOf, pairOf } from '../../src/ai/cache';
import { WHISPER_MODEL } from '../../src/shared/translate';

/* ------------------------------------------------------ « État des modèles » */
describe('local AI models in the cache', () => {
  it('knows which model a cached file belongs to', () => {
    expect(modelOf('https://huggingface.co/onnx-community/whisper-base/resolve/main/onnx/encoder_model_quantized.onnx')).toBe('onnx-community/whisper-base');
    expect(modelOf('https://huggingface.co/Xenova/opus-mt-en-fr/resolve/main/config.json')).toBe('Xenova/opus-mt-en-fr');
    // Anything else in the cache is not a model.
    expect(modelOf('https://example.com/onnx-community/whisper-base/resolve/main/x')).toBeNull();
    expect(modelOf('https://huggingface.co/onnx-community/whisper-base')).toBeNull();
  });

  it('reads the languages of a translation model, and tells Whisper apart', () => {
    expect(pairOf('Xenova/opus-mt-en-fr')).toEqual(['en', 'fr']);
    expect(pairOf('Xenova/opus-mt-de-en')).toEqual(['de', 'en']);
    expect(pairOf('Xenova/opus-mt-en-zh')).toEqual(['en', 'zh']);
    expect(pairOf(WHISPER_MODEL)).toBeNull();
    expect(isWhisper(WHISPER_MODEL)).toBe(true);
    expect(isWhisper('Xenova/opus-mt-en-fr')).toBe(false);
  });
});
