import { useEffect, useRef, useState } from 'preact/hooks';
import type { Finish } from '../../shared/finish';
import { Icon } from '../../popup/components/Icon';
import { FinishPanel, finishCount } from '../../popup/components/Finish';
import { size, t } from '../../popup/i18n';
import { isAudioFile, MAX_LOCAL, runWorkshop, save, type Output } from '../work';

/** Files dropped or picked: the first one that is a video or a sound. */
export function FilePick({ multiple, accept, onFiles, label }: { multiple?: boolean; accept: string; onFiles: (f: File[]) => void; label: string }) {
  const [over, setOver] = useState(false);
  return (
    <label
      class={`drop${over ? ' drop--over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...(e.dataTransfer?.files ?? [])];
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <span class="drop__icon" aria-hidden="true">
        <Icon name="upload" size={24} />
      </span>
      <span>{label}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = [...((e.target as HTMLInputElement).files ?? [])];
          if (files.length) onFiles(files);
          (e.target as HTMLInputElement).value = '';
        }}
      />
    </label>
  );
}

/**
 * "Atelier": a video or sound of the computer, edited with a live preview (the picture turns,
 * is cropped and plays at the new speed as it will be), made smaller, given subtitles, summed up.
 */
export function Workshop({ aiAllowed, chromeAi, onAllowAi }: { aiAllowed: boolean; chromeAi: boolean; onAllowAi: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [picture, setPicture] = useState<string | undefined>();
  const [subs, setSubs] = useState<File | null>(null);
  const [finish, setFinish] = useState<Finish>({});
  const [work, setWork] = useState<{ step: string; p: number } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; files?: Output[] } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);
  const audio = !!file && isAudioFile(file);
  const pick = (f: File) => {
    if (url) URL.revokeObjectURL(url);
    setFile(f);
    setUrl(URL.createObjectURL(f));
    setPicture(undefined);
    setResult(null);
    setFinish({});
  };
  // A still of the video to crop on, a third of the way in.
  const grabStill = () => {
    const v = video.current;
    if (!v || picture || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = Math.min(960, v.videoWidth);
    c.height = Math.round((c.width * v.videoHeight) / v.videoWidth);
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
    try {
      setPicture(c.toDataURL('image/jpeg', 0.85));
    } catch {
      /* a picture that can't be read: the crop works on a blank */
    }
  };
  const e = finish.edit ?? {};
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.playbackRate = e.speed ?? 1;
    v.muted = !!e.mute;
  }, [e.speed, e.mute, url]);
  const c = e.crop;
  const transform = `${e.rotate ? `rotate(${e.rotate}deg)` : ''}${e.flip ? ' scaleX(-1)' : ''}`.trim();
  const clip = c ? `inset(${c.y * 100}% ${(1 - c.x - c.w) * 100}% ${(1 - c.y - c.h) * 100}% ${c.x * 100}%)` : undefined;
  const tooBig = !!file && file.size > MAX_LOCAL;
  const run = async () => {
    if (!file) return;
    const ac = new AbortController();
    ctl.current = ac;
    setResult(null);
    setWork({ step: 'load', p: 0 });
    try {
      const outs = await runWorkshop(file, finish, { ...(subs ? { subs } : {}), chromeAi, signal: ac.signal, report: (step, p) => setWork({ step, p }) });
      await save(outs);
      setResult({ ok: true, files: outs });
    } catch (err) {
      if (!ac.signal.aborted) {
        console.warn('[grabby] workshop failed', err);
        setResult({ ok: false });
      }
    } finally {
      setWork(null);
      ctl.current = null;
    }
  };
  const busy = !!work;
  return (
    <div class="stack">
      {!file ? (
        <FilePick accept="video/*,audio/*,.mkv,.ts,.m4a,.opus,.flac" onFiles={(f) => pick(f[0]!)} label={t('workPick')} />
      ) : (
        <div class="work">
          <section class="ap__card work__preview">
            {audio ? (
              <audio ref={video as never} class="work__audio" src={url} controls />
            ) : (
              <div class="work__stage">
                <video
                  ref={video}
                  src={url}
                  controls
                  playsInline
                  style={{ ...(transform ? { transform } : {}), ...(clip ? { clipPath: clip } : {}) }}
                  onLoadedData={(ev) => {
                    const v = ev.currentTarget;
                    if (!picture && v.duration) v.currentTime = Math.min(v.duration / 3, 30);
                  }}
                  onSeeked={grabStill}
                />
              </div>
            )}
            <p class="work__file">
              <Icon name={audio ? 'audio' : 'film'} size={16} />
              <span>{file.name}</span>
              <span class="muted">{size(file.size)}</span>
              <button class="btn btn--soft btn--small" disabled={busy} onClick={() => setFile(null)}>
                {t('workOther')}
              </button>
            </p>
            {tooBig && <p class="hint hint--warn">{t('workTooBig')}</p>}
          </section>
          <section class="ap__card work__panel">
            {!audio && (
              <div class="work__subs">
                {subs ? (
                  <p class="work__file">
                    <Icon name="captions" size={16} />
                    <span>{subs.name}</span>
                    <button class="btn btn--soft btn--small" onClick={() => setSubs(null)}>
                      {t('workSubsRemove')}
                    </button>
                  </p>
                ) : (
                  <FilePick accept=".srt,.vtt,.ttml,.xml" onFiles={(f) => setSubs(f[0]!)} label={t('workSubs')} />
                )}
              </div>
            )}
            <FinishPanel
              value={finish}
              onChange={setFinish}
              audio={audio}
              format={(/\.([a-z0-9]{2,4})$/i.exec(file.name)?.[1] ?? 'mp4').toLowerCase()}
              {...(picture ? { picture } : {})}
              subsChosen={!!subs}
              chapters={0}
              aiAllowed={aiAllowed}
              onAllowAi={onAllowAi}
            />
            {work ? (
              <div class="job job--active">
                <div class={`meter${work.p ? '' : ' meter--busy'}`} style={{ '--p': String(work.p || 1) }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(work.p * 100)}>
                  <span class="meter__label">{`${t(`step_${work.step}`)} ${Math.round(work.p * 100)} %`}</span>
                  <span class="meter__fill" aria-hidden="true">
                    <span class="meter__label">{`${t(`step_${work.step}`)} ${Math.round(work.p * 100)} %`}</span>
                  </span>
                </div>
                <button class="btn btn--soft btn--icon" title={t('cancel')} aria-label={t('cancel')} onClick={() => ctl.current?.abort(new DOMException('Aborted', 'AbortError'))}>
                  <Icon name="close" />
                </button>
              </div>
            ) : (
              <button class="btn btn--primary btn--wide" disabled={!finishCount(finish) || tooBig || ((!!finish.transcribe || !!finish.translate) && !aiAllowed)} onClick={() => void run()}>
                <Icon name="wand" />
                {t('workRun')}
              </button>
            )}
            {result && (
              <p class={`hint${result.ok ? '' : ' hint--warn'}`} role="status">
                {result.ok ? (result.files?.length ? t('workDone', String(result.files.length)) : t('workNothing')) : t('workFailed')}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
