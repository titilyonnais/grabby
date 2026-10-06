import { useEffect, useState } from 'preact/hooks';
import { builtinAi, cachedModels, forgetModels, isWhisper, pairOf, type CachedModel } from '../../ai/cache';
import { languageName } from '../../shared/sublabels';
import { PAIR_MB, WHISPER_MB } from '../../shared/translate';
import { size, t } from '../i18n';
import { Icon } from './Icon';

type Test = { state: 'idle' } | { state: 'busy'; stage: 'download' | 'work'; progress: number } | { state: 'ok'; seconds: number } | { state: 'failed'; why: string };

/**
 * « IA locale », as it stands: which models are on this computer and the room they take,
 * what the browser's own AI can do, a test that really runs the transcription, and a way to
 * forget the models.
 */
export function AiPanel({ allowed }: { allowed: boolean }) {
  const [models, setModels] = useState<CachedModel[] | null>(null);
  const [builtin, setBuiltin] = useState<{ translator: string; summarizer: string } | null>(null);
  const [test, setTest] = useState<Test>({ state: 'idle' });
  const load = () => void cachedModels().then(setModels, () => setModels([]));
  useEffect(() => {
    load();
    void builtinAi().then(setBuiltin, () => setBuiltin({ translator: 'unavailable', summarizer: 'unavailable' }));
  }, []);

  const whisper = models?.find((m) => isWhisper(m.id));
  const pairs = (models ?? []).filter((m) => pairOf(m.id));

  const run = async () => {
    setTest({ state: 'busy', stage: whisper ? 'work' : 'download', progress: 0 });
    const started = performance.now();
    try {
      const { LocalAi } = await import('../../ai/client');
      const ai = new LocalAi();
      // Two seconds of silence: enough to load the model and make it listen once.
      await ai.transcribe(new Float32Array(16000 * 2), 'auto', (p) => setTest({ state: 'busy', stage: p.stage, progress: p.progress }));
      ai.stop();
      setTest({ state: 'ok', seconds: (performance.now() - started) / 1000 });
    } catch (e) {
      setTest({ state: 'failed', why: e instanceof Error ? e.message.replace(/^ai: /, '') : String(e) });
    }
    load();
  };

  const forget = async () => {
    await forgetModels();
    setTest({ state: 'idle' });
    load();
  };

  const builtinWord = (s: string | undefined) => t(s === 'available' || s === 'readily' ? 'aiBuiltinReady' : s === 'downloadable' || s === 'downloading' || s === 'after-download' ? 'aiBuiltinLater' : 'aiBuiltinNone');

  return (
    <div class="ai">
      <ul class="ai__list">
        <li class="ai__row">
          <span class={`ai__dot${whisper ? ' ai__dot--on' : ''}`} aria-hidden="true" />
          <span class="ai__what">
            <span class="setting__label">{t('aiRowTranscribe')}</span>
            <span class="setting__hint">{t('aiRowTranscribeBy')}</span>
          </span>
          <span class="ai__state">{models === null ? '…' : whisper ? t('aiReady', size(whisper.bytes)) : t('aiNotYet', String(WHISPER_MB))}</span>
        </li>
        <li class="ai__row">
          <span class={`ai__dot${pairs.length ? ' ai__dot--on' : ''}`} aria-hidden="true" />
          <span class="ai__what">
            <span class="setting__label">{t('aiRowTranslate')}</span>
            <span class="setting__hint">{t('aiRowTranslateBy')}</span>
          </span>
          <span class="ai__state">
            {models === null
              ? '…'
              : pairs.length
                ? pairs.map((m) => {
                    const [from, to] = pairOf(m.id)!;
                    return (
                      <span key={m.id} class="ai__pair">
                        {t('aiPair', [languageName(from), languageName(to), size(m.bytes)])}
                      </span>
                    );
                  })
                : t('aiNoPair', String(PAIR_MB))}
            {builtin && builtin.translator !== 'unavailable' && <span class="ai__pair">{t('aiBuiltinTranslator', builtinWord(builtin.translator))}</span>}
          </span>
        </li>
        <li class="ai__row">
          <span class={`ai__dot${builtin && builtin.summarizer !== 'unavailable' ? ' ai__dot--on' : ''}`} aria-hidden="true" />
          <span class="ai__what">
            <span class="setting__label">{t('aiRowSummary')}</span>
            <span class="setting__hint">{t('aiRowSummaryBy')}</span>
          </span>
          <span class="ai__state">{builtin ? builtinWord(builtin.summarizer) : '…'}</span>
        </li>
      </ul>
      <div class="ai__actions">
        <button class="btn btn--soft btn--small" disabled={!allowed || test.state === 'busy'} onClick={() => void run()} title={allowed ? '' : t('aiTestNeedsOn')}>
          <Icon name={whisper ? 'play' : 'download'} size={14} />
          {whisper ? t('aiTest') : t('aiTestDownload', String(WHISPER_MB))}
        </button>
        {!!models?.length && test.state !== 'busy' && (
          <button class="btn btn--ghost btn--small" onClick={() => void forget()}>
            <Icon name="trash" size={14} />
            {t('aiForget')}
          </button>
        )}
      </div>
      <p class="ai__result" aria-live="polite">
        {test.state === 'busy' && (
          <>
            <span class="ai__bar" style={{ '--p': String(test.progress) }} aria-hidden="true" />
            {test.stage === 'download' ? t('aiTestDownloading', String(Math.round(test.progress * 100))) : t('aiTestRunning')}
          </>
        )}
        {test.state === 'ok' && t('aiTestOk', new Intl.NumberFormat(chrome.i18n.getUILanguage(), { maximumFractionDigits: 1 }).format(test.seconds))}
        {test.state === 'failed' && <span class="hint--warn">{t('aiTestFailed', test.why)}</span>}
        {test.state === 'idle' && !allowed && t('aiTestNeedsOn')}
      </p>
    </div>
  );
}
