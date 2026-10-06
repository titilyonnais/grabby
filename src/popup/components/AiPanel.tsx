import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { builtinAi, cachedModels, forgetModels, isWhisper, pairOf, type CachedModel } from '../../ai/cache';
import { languageName } from '../../shared/sublabels';
import { PAIR_MB, WHISPER_MB } from '../../shared/translate';
import { size, t } from '../i18n';
import { Icon } from './Icon';

type Test = { state: 'idle' } | { state: 'busy'; stage: 'download' | 'work'; progress: number } | { state: 'ok'; seconds: number } | { state: 'failed'; why: string };

/**
 * « IA locale », as it stands: which models are on this computer and the room they take,
 * what the browser's own AI can do (only asked when the user turned it on: asking Chrome is
 * enough for it to write a warning when its AI is off), a test that really runs the
 * transcription, and a way to forget the models.
 */
export function AiPanel({ allowed, chromeAi, onChromeOff }: { allowed: boolean; chromeAi: boolean; onChromeOff: () => void }) {
  const [models, setModels] = useState<CachedModel[] | null>(null);
  const [builtin, setBuiltin] = useState<{ translator: string; summarizer: string } | null>(null);
  const [test, setTest] = useState<Test>({ state: 'idle' });
  const chromeReady = (s: string | undefined) => s === 'available' || s === 'readily';
  const chromeLater = (s: string | undefined) => s === 'downloadable' || s === 'downloading' || s === 'after-download';
  const load = () => void cachedModels().then(setModels, () => setModels([]));
  useEffect(load, []);
  // Chrome has its AI turned off: said here, and the switch goes back off, so Chrome is not
  // asked again (each time, it writes its warning).
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    if (!chromeAi) return setBuiltin(null);
    setRefused(false);
    const seen = (b: { translator: string; summarizer: string }) => {
      setBuiltin(b);
      const none = (s: string) => !chromeReady(s) && !chromeLater(s);
      if (none(b.translator) && none(b.summarizer)) {
        setRefused(true);
        onChromeOff();
      }
    };
    void builtinAi().then(seen, () => seen({ translator: 'unavailable', summarizer: 'unavailable' }));
  }, [chromeAi]);

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


  /** One thing the AI does: its name and its state on one line, who does it under them. */
  const Row = ({ label, by, children }: { label: string; by: string; children: ComponentChildren }) => (
    <li class="ai__row">
      <span class="ai__head">
        <span class="setting__label">{label}</span>
        <span class="ai__chips">{children}</span>
      </span>
      <span class="setting__hint">{by}</span>
    </li>
  );
  const Chip = ({ on, children }: { on?: boolean; children: ComponentChildren }) => <span class={`ai__chip${on ? ' ai__chip--on' : ''}`}>{children}</span>;

  return (
    <div class="ai">
      <ul class="ai__list">
        <Row label={t('aiRowTranscribe')} by={t('aiRowTranscribeBy')}>
          {models === null ? <Chip>…</Chip> : whisper ? <Chip on>{t('aiReady', size(whisper.bytes))}</Chip> : <Chip>{t('aiNotYet', String(WHISPER_MB))}</Chip>}
        </Row>
        <Row label={t('aiRowTranslate')} by={t('aiRowTranslateBy')}>
          {builtin && chromeReady(builtin.translator) ? (
            <Chip on>{t('aiBuiltinTranslator', t('aiBuiltinReady'))}</Chip>
          ) : models === null ? (
            <Chip>…</Chip>
          ) : pairs.length ? (
            pairs.map((m) => {
              const [from, to] = pairOf(m.id)!;
              return (
                <Chip key={m.id} on>
                  {t('aiPair', [languageName(from), languageName(to), size(m.bytes)])}
                </Chip>
              );
            })
          ) : (
            <Chip>{t('aiNoPair', String(PAIR_MB))}</Chip>
          )}
        </Row>
        <Row label={t('aiRowSummary')} by={t('aiRowSummaryBy')}>
          {chromeAi && builtin === null ? <Chip>…</Chip> : builtin && chromeReady(builtin.summarizer) ? <Chip on>{t('aiBuiltinTranslator', t('aiBuiltinReady'))}</Chip> : <Chip on>{t(chromeLater(builtin?.summarizer) ? 'aiSummarySimpleFor' : 'aiSummarySimple')}</Chip>}
        </Row>
      </ul>
      {refused && <p class="setting__hint ai__note">{t('aiChromeOff')}</p>}
      {allowed && (
        <div class="ai__actions">
          <button class="btn btn--soft btn--small" disabled={test.state === 'busy'} onClick={() => void run()}>
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
      )}
      {test.state !== 'idle' && (
        <p class="ai__result" aria-live="polite">
          {test.state === 'busy' && (
            <>
              <span class="ai__bar" style={{ '--p': String(test.progress) }} aria-hidden="true" />
              {test.stage === 'download' ? t('aiTestDownloading', String(Math.round(test.progress * 100))) : t('aiTestRunning')}
            </>
          )}
          {test.state === 'ok' && t('aiTestOk', new Intl.NumberFormat(chrome.i18n.getUILanguage(), { maximumFractionDigits: 1 }).format(test.seconds))}
          {test.state === 'failed' && <span class="hint--warn">{t('aiTestFailed', test.why)}</span>}
        </p>
      )}
    </div>
  );
}
