import { useRef, useState } from 'preact/hooks';
import { formatDuration } from '../../shared/format';
import { copyable, type MediaInfo } from '../../shared/join';
import { Icon } from '../../popup/components/Icon';
import { size, t } from '../../popup/i18n';
import { describeFiles, MAX_LOCAL, runJoin, save } from '../work';
import { FilePick } from './Workshop';

/** "Assembler plusieurs vidéos": files of the computer put end to end, in the order shown. */
export function Join() {
  const [files, setFiles] = useState<File[]>([]);
  const [infos, setInfos] = useState<MediaInfo[] | null>(null);
  const [reading, setReading] = useState(false);
  const [work, setWork] = useState<{ p: number; copying: boolean } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const describe = async (list: File[]) => {
    setInfos(null);
    if (list.length < 2) return;
    setReading(true);
    try {
      setInfos(await describeFiles(list, new AbortController().signal));
    } catch (e) {
      console.warn('[grabby] files not read', e);
    } finally {
      setReading(false);
    }
  };
  const change = (list: File[]) => {
    setFiles(list);
    setResult(null);
    void describe(list);
  };
  const move = (i: number, step: -1 | 1) => {
    const j = i + step;
    if (j < 0 || j >= files.length) return;
    const next = [...files];
    [next[i], next[j]] = [next[j]!, next[i]!];
    const ni = infos ? [...infos] : null;
    if (ni) [ni[i], ni[j]] = [ni[j]!, ni[i]!];
    setFiles(next);
    setInfos(ni);
  };
  const total = files.reduce((n, f) => n + f.size, 0);
  const run = async () => {
    if (!infos) return;
    const ac = new AbortController();
    ctl.current = ac;
    setResult(null);
    setWork({ p: 0, copying: copyable(infos) });
    try {
      const out = await runJoin(files, infos, { signal: ac.signal, report: (p, copying) => setWork({ p, copying }) });
      await save([out]);
      setResult(t('joinDone', out.name));
    } catch (e) {
      if (!ac.signal.aborted) {
        console.warn('[grabby] join failed', e);
        setResult(t('joinFailed'));
      }
    } finally {
      setWork(null);
    }
  };
  const label = work ? `${t(work.copying ? 'joinCopying' : 'joinEncoding')} ${Math.round(work.p * 100)} %` : '';
  return (
    <div class="stack">
      <FilePick multiple accept="video/*,audio/*,.mkv,.ts,.m4a,.opus,.flac" onFiles={(f) => change([...files, ...f])} label={t('joinPick')} />
      {files.length > 0 && (
        <section class="ap__card">
          <header class="ap__cardhead">
            <h2 class="ap__h2">{t('joinList', String(files.length))}</h2>
            <span class="muted">{size(total)}</span>
          </header>
          <ol class="lines">
            {files.map((f, i) => {
              const info = infos?.[i];
              return (
                <li key={`${f.name}-${f.size}-${i}`} class="line">
                  <span class="line__icon line__num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span class="line__text">
                    <span class="line__title">{f.name}</span>
                    <span class="line__meta">
                      {size(f.size)}
                      {info?.duration ? ` · ${formatDuration(info.duration)}` : ''}
                      {info?.video ? ` · ${info.video.width}×${info.video.height} ${info.video.codec}` : ''}
                      {info?.audio ? ` · ${info.audio.codec}` : ''}
                    </span>
                  </span>
                  <span class="line__tools">
                    <button class="hcard__btn hcard__btn--up" disabled={i === 0 || !!work} title={t('joinUp')} aria-label={t('joinUp')} onClick={() => move(i, -1)}>
                      <Icon name="chevron" size={15} />
                    </button>
                    <button class="hcard__btn hcard__btn--down" disabled={i === files.length - 1 || !!work} title={t('joinDown')} aria-label={t('joinDown')} onClick={() => move(i, 1)}>
                      <Icon name="chevron" size={15} />
                    </button>
                    <button class="hcard__btn" disabled={!!work} title={t('historyRemove')} aria-label={t('historyRemove')} onClick={() => change(files.filter((_, k) => k !== i))}>
                      <Icon name="close" size={15} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          {files.length < 2 ? (
            <p class="hint">{t('joinMore')}</p>
          ) : reading ? (
            <p class="hint">{t('joinReading')}</p>
          ) : infos ? (
            <p class="hint">{t(copyable(infos) ? 'joinCopyHint' : 'joinEncodeHint')}</p>
          ) : null}
          {total > MAX_LOCAL && <p class="hint hint--warn">{t('workTooBig')}</p>}
          {work ? (
            <div class="job job--active">
              <div class={`meter${work.p ? '' : ' meter--busy'}`} style={{ '--p': String(work.p || 1) }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(work.p * 100)}>
                <span class="meter__label">{label}</span>
                <span class="meter__fill" aria-hidden="true">
                  <span class="meter__label">{label}</span>
                </span>
              </div>
              <button class="btn btn--soft btn--icon" title={t('cancel')} aria-label={t('cancel')} onClick={() => ctl.current?.abort(new DOMException('Aborted', 'AbortError'))}>
                <Icon name="close" />
              </button>
            </div>
          ) : (
            <button class="btn btn--primary btn--wide" disabled={files.length < 2 || !infos || reading || total > MAX_LOCAL} onClick={() => void run()}>
              <Icon name="layers" />
              {t('joinRun', String(files.length))}
            </button>
          )}
          {result && (
            <p class="hint" role="status">
              {result}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
