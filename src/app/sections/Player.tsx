import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppRequest } from '../../shared/messages';
import { editedTranscript, exportTranscript, type Transcript } from '../../shared/transcript';
import type { HistoryEntry } from '../../shared/types';
import { Icon } from '../../popup/components/Icon';
import { t } from '../../popup/i18n';

/** "file:///C:/Users/…/video.mp4" for a path of the computer. */
export const fileUrl = (path: string) =>
  `file:///${path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')
    .replace(/^([A-Za-z])%3A/, '$1:')}`;

const IMAGE = /\.(jpe?g|png|gif|webp)$/i;
const AUDIO = /\.(m4a|mp3|opus|ogg|flac|wav)$/i;

/** "1:05", "1:02:05". */
export function clockOf(s: number): string {
  const t2 = Math.max(0, Math.floor(s));
  const h = Math.floor(t2 / 3600);
  const m = Math.floor((t2 % 3600) / 60);
  const sec = String(t2 % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/* -------------------------------------------- « Reprendre la lecture » */
const POS_KEY = 'positions';
const MAX_POS = 400;

async function positions(): Promise<Record<string, number>> {
  return ((await chrome.storage.local.get(POS_KEY))[POS_KEY] as Record<string, number> | undefined) ?? {};
}

/** Where to start again: far enough in to matter, not at the very end. */
export function resumeAt(saved: number | undefined, duration: number): number | undefined {
  if (!saved || !Number.isFinite(duration) || duration <= 0) return undefined;
  return saved > 5 && saved < duration - 10 ? saved : undefined;
}

async function savePosition(id: string, at: number, duration: number) {
  const all = await positions();
  delete all[id];
  // Watched to the end: nothing to take up again.
  if (at > 5 && at < duration - 10) all[id] = Math.round(at);
  const kept = Object.entries(all).slice(-MAX_POS);
  await chrome.storage.local.set({ [POS_KEY]: Object.fromEntries(kept) });
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** Where the picture is drawn inside its element (letterboxed: "contain"). */
function pictureBox(v: HTMLVideoElement) {
  const r = v.getBoundingClientRect();
  const k = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
  const w = v.videoWidth * k;
  const h = v.videoHeight * k;
  return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
}

/** Saves a file made in this page (a photo, a text) next to the others. */
async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

const stem = (e: HistoryEntry) => (e.filename.replace(/\.[^.]+$/, '') || e.title || 'Grabby').replace(/[\\/:*?"<>|]+/g, '-');

/**
 * The library's player: speed, a part played again and again (A-B), one picture at a time,
 * a photo of the picture, taking up where it was left, and what is said, line by line.
 */
export function Player({ entry, start, onClose }: { entry: HistoryEntry; start?: number; onClose: () => void }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState<{ a?: number; b?: number }>({});
  const [now, setNow] = useState(0);
  const [resumed, setResumed] = useState<number | null>(null);
  const [text, setText] = useState<Transcript | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // « Éditeur de sous-titres »: the lines being changed, and how far they are moved.
  const [draft, setDraft] = useState<Transcript['cues'] | null>(null);
  const [shift, setShift] = useState(0);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const lines = useRef<HTMLOListElement>(null);
  const image = IMAGE.test(entry.filename);
  const audio = !image && (AUDIO.test(entry.filename) || entry.mode === 'audio');

  useEffect(() => {
    void (async () => {
      const req: AppRequest = { app: 'file-paths', ids: [entry.downloadId!] };
      const [d] = ((await chrome.runtime.sendMessage(req).catch(() => [])) ?? []) as { path: string; exists: boolean }[];
      setSrc(d?.exists ? fileUrl(d.path) : null);
    })();
    if (entry.text) {
      const req: AppRequest = { app: 'texts', ids: [entry.id] };
      void chrome.runtime
        .sendMessage(req)
        .then((all: Record<string, Transcript> | null) => setText(all?.[entry.id] ?? null))
        .catch(() => {});
    }
  }, [entry.id]);

  const flash = (s: string) => {
    setSaid(s);
    setTimeout(() => setSaid((x) => (x === s ? null : x)), 2200);
  };

  // Speed, and the A-B part played again and again.
  useEffect(() => {
    if (media.current) media.current.playbackRate = speed;
  }, [speed, src]);
  const onTime = () => {
    const v = media.current;
    if (!v) return;
    setNow(v.currentTime);
    if (loop.a !== undefined && loop.b !== undefined && v.currentTime >= loop.b) v.currentTime = loop.a;
  };

  // Where it was left: taken up again (or where the search found the words).
  const onMeta = async () => {
    const v = media.current;
    if (!v) return;
    v.playbackRate = speed;
    if (start !== undefined) {
      v.currentTime = Math.max(0, start - 1);
      return;
    }
    const at = resumeAt((await positions())[entry.id], v.duration);
    if (at !== undefined) {
      v.currentTime = at;
      setResumed(at);
    }
  };
  const last = useRef(0);
  const keep = (force = false) => {
    const v = media.current;
    if (!v || !Number.isFinite(v.duration)) return;
    if (!force && Date.now() - last.current < 4000) return;
    last.current = Date.now();
    void savePosition(entry.id, v.currentTime, v.duration);
  };
  useEffect(() => () => keep(true), [entry.id]);

  const step = (by: number) => {
    const v = media.current;
    if (!v) return;
    v.pause();
    // One picture: about 1/30 s.
    v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + by / 30));
  };

  const photo = async () => {
    const v = media.current;
    if (!v || !v.videoWidth) return;
    v.pause();
    let blob: Blob | null = null;
    try {
      // Drawn straight from the video when the browser allows it…
      const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
      c.getContext('2d')!.drawImage(v, 0, 0);
      blob = await c.convertToBlob({ type: 'image/png' });
    } catch {
      // …else a photo of this page, the picture cut out of it.
      const had = v.controls;
      v.controls = false;
      await frames();
      try {
        const shot = await chrome.tabs.captureVisibleTab({ format: 'png' });
        const whole = await createImageBitmap(await (await fetch(shot)).blob());
        const b = pictureBox(v);
        const k = whole.width / innerWidth;
        const cut = await createImageBitmap(whole, Math.round(b.x * k), Math.round(b.y * k), Math.round(b.w * k), Math.round(b.h * k));
        const c = new OffscreenCanvas(cut.width, cut.height);
        c.getContext('2d')!.drawImage(cut, 0, 0);
        blob = await c.convertToBlob({ type: 'image/png' });
      } catch (e) {
        console.warn('[grabby] photo', e);
      } finally {
        v.controls = had;
      }
    }
    if (!blob) return flash(t('photoFailed'));
    await saveBlob(blob, `${stem(entry)} (${t('photoName')} ${clockOf(v.currentTime).replace(/:/g, '.')}).png`);
    flash(t('photoSaved'));
  };

  const saveDraft = async () => {
    if (!text || !draft) return;
    const next = editedTranscript(text, draft, shift);
    const req: AppRequest = { app: 'text-save', id: entry.id, text: next };
    const ok = await chrome.runtime.sendMessage(req).catch(() => false);
    if (!ok) return flash(t('textNotSaved'));
    setText(next);
    setDraft(null);
    setShift(0);
    flash(t('textEdited'));
  };
  const line = (i: number, text: string) => setDraft((d) => d && d.map((c, k) => (k === i ? { ...c, text } : c)));

  const exportAs = async (format: 'txt' | 'srt' | 'md') => {
    if (!text) return;
    const body = exportTranscript(draft ? editedTranscript(text, draft, shift) : text, format, entry.title);
    await saveBlob(
      new Blob([body], {
        type: format === 'md' ? 'text/markdown' : 'text/plain',
      }),
      `${stem(entry)}.${format === 'srt' ? 'srt' : format === 'md' ? 'md' : 'txt'}`,
    );
    flash(t('textSaved'));
  };

  // The line being said, and the list following it.
  const current = useMemo(() => {
    if (!text) return -1;
    let i = -1;
    for (const [k, c] of (draft ?? text.cues).entries()) {
      if (c.start + (draft ? shift : 0) <= now + 0.2) i = k;
      else break;
    }
    return i;
  }, [text, draft, shift, Math.floor(now * 2)]);
  useEffect(() => {
    // Not while a line is being typed in.
    if (draft && lines.current?.contains(document.activeElement)) return;
    lines.current?.querySelector<HTMLElement>(`[data-i="${current}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current]);

  const seek = (s: number) => {
    const v = media.current;
    if (!v) return;
    v.currentTime = s;
    void v.play().catch(() => {});
  };

  // The keyboard: Escape, space, arrows, picture by picture, speed, A-B, photo.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      const v = media.current;
      if (!v || (e.target as HTMLElement).closest('input, textarea, select')) return;
      const on = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (e.key === ' ' || e.key === 'k') on(() => (v.paused ? void v.play() : v.pause()));
      else if (e.key === 'ArrowLeft') on(() => (v.currentTime = Math.max(0, v.currentTime - 5)));
      else if (e.key === 'ArrowRight') on(() => (v.currentTime += 5));
      else if (e.key === ',') on(() => step(-1));
      else if (e.key === '.') on(() => step(1));
      else if (e.key === '[') on(() => setSpeed((s) => SPEEDS[Math.max(0, SPEEDS.indexOf(s) - 1)]!));
      else if (e.key === ']') on(() => setSpeed((s) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s) + 1)]!));
      else if (e.key === 'a') on(() => setLoop((l) => ({ ...l, a: v.currentTime })));
      else if (e.key === 'b') on(() => setLoop((l) => ({ ...l, b: v.currentTime })));
      else if (e.key === 's' && !audio) on(() => void photo());
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  const loopOn = loop.a !== undefined && loop.b !== undefined && loop.b > loop.a;
  return (
    <div class="modal" role="dialog" aria-modal="true" aria-label={entry.title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`modal__box${text ? ' modal__box--text' : ''}`}>
        <header class="modal__head">
          <h2>{entry.title || entry.filename}</h2>
          <button class="icon-btn" aria-label={t('close')} title={t('close')} onClick={onClose} autoFocus>
            <Icon name="close" />
          </button>
        </header>
        <div class="player">
          <div class="player__main">
            {src === undefined ? (
              <div class="modal__wait" aria-busy="true" />
            ) : src === null ? (
              <p class="notice">
                <Icon name="alert" size={16} />
                {t('historyMissing')}
              </p>
            ) : image ? (
              <img class="modal__media" src={src} alt={entry.title} />
            ) : (
              <>
                {audio ? (
                  <audio ref={media} class="modal__audio" src={src} controls autoPlay onLoadedMetadata={() => void onMeta()} onTimeUpdate={() => (onTime(), keep())} onPause={() => keep(true)} />
                ) : (
                  <video
                    ref={media}
                    class="modal__media"
                    src={src}
                    controls
                    autoPlay
                    playsInline
                    onLoadedMetadata={() => void onMeta()}
                    onTimeUpdate={() => (onTime(), keep())}
                    onPause={() => keep(true)}
                  />
                )}
                {resumed !== null && (
                  <p class="player__resumed" role="status">
                    <Icon name="play" size={13} />
                    {t('playerResumed', clockOf(resumed))}
                    <button
                      class="linkish"
                      onClick={() => {
                        seek(0);
                        setResumed(null);
                      }}
                    >
                      {t('playerFromStart')}
                    </button>
                  </p>
                )}
                <div class="player__tools" role="toolbar" aria-label={t('playerTools')}>
                  <span class="player__group" role="group" aria-label={t('playerSpeed')}>
                    {SPEEDS.map((s) => (
                      <button key={s} class={`chip${s === speed ? ' chip--on' : ''}`} aria-pressed={s === speed} onClick={() => setSpeed(s)}>
                        {String(s).replace('.', ',')}×
                      </button>
                    ))}
                  </span>
                  <span class="player__group" role="group" aria-label={t('playerLoop')}>
                    <button
                      class={`chip${loop.a !== undefined ? ' chip--on' : ''}`}
                      title={t('playerLoopA')}
                      onClick={() =>
                        setLoop((l) => ({
                          ...l,
                          a: media.current?.currentTime ?? 0,
                        }))
                      }
                    >
                      A{loop.a !== undefined ? ` ${clockOf(loop.a)}` : ''}
                    </button>
                    <button
                      class={`chip${loop.b !== undefined ? ' chip--on' : ''}`}
                      title={t('playerLoopB')}
                      onClick={() =>
                        setLoop((l) => ({
                          ...l,
                          b: media.current?.currentTime ?? 0,
                        }))
                      }
                    >
                      B{loop.b !== undefined ? ` ${clockOf(loop.b)}` : ''}
                    </button>
                    {(loop.a !== undefined || loop.b !== undefined) && (
                      <button class="chip" title={t('playerLoopClear')} aria-label={t('playerLoopClear')} onClick={() => setLoop({})}>
                        <Icon name={loopOn ? 'repeat' : 'close'} size={13} />
                      </button>
                    )}
                  </span>
                  {!audio && (
                    <span class="player__group">
                      <button class="chip" title={t('playerFrameBack')} aria-label={t('playerFrameBack')} onClick={() => step(-1)}>
                        <Icon name="stepBack" size={14} />
                      </button>
                      <button class="chip" title={t('playerFrameNext')} aria-label={t('playerFrameNext')} onClick={() => step(1)}>
                        <Icon name="skip" size={14} />
                      </button>
                      <button class="chip" title={t('playerPhoto')} aria-label={t('playerPhoto')} onClick={() => void photo()}>
                        <Icon name="camera" size={14} />
                      </button>
                    </span>
                  )}
                </div>
              </>
            )}
            <p class="modal__file">
              {entry.filename}
              {said && (
                <span key={said} class="player__said" role="status">
                  <Icon name="check" size={13} />
                  {said}
                </span>
              )}
            </p>
          </div>
          {text && (
            <aside class="player__text" aria-label={t('playerText')}>
              <header class="player__texthead">
                <h3>{t(text.ai ? 'playerTextAi' : 'playerText')}</h3>
                <span class="player__group">
                  {!draft && (
                    <button class="chip" title={t('textEditHint')} onClick={() => setDraft(text.cues.map((c) => ({ ...c })))}>
                      <Icon name="edit" size={13} />
                      {t('textEdit')}
                    </button>
                  )}
                  {(['txt', 'srt', 'md'] as const).map((f) => (
                    <button key={f} class="chip" title={t('playerExport', f.toUpperCase())} onClick={() => void exportAs(f)}>
                      {f.toUpperCase()}
                    </button>
                  ))}
                </span>
              </header>
              {draft && (
                <div class="subedit">
                  <span class="subedit__shift" role="group" aria-label={t('textShift')}>
                    <span>{t('textShift')}</span>
                    {[-1, -0.1].map((d) => (
                      <button key={d} class="chip" onClick={() => setShift((s) => Math.round((s + d) * 10) / 10)}>
                        {String(d).replace('.', ',')} s
                      </button>
                    ))}
                    <strong class="subedit__by">{`${shift > 0 ? '+' : ''}${String(shift).replace('.', ',')} s`}</strong>
                    {[0.1, 1].map((d) => (
                      <button key={d} class="chip" onClick={() => setShift((s) => Math.round((s + d) * 10) / 10)}>
                        +{String(d).replace('.', ',')} s
                      </button>
                    ))}
                  </span>
                  <span class="row">
                    <button class="btn btn--soft btn--small" onClick={() => (setDraft(null), setShift(0))}>
                      {t('cancel')}
                    </button>
                    <button class="btn btn--primary btn--small" onClick={() => void saveDraft()}>
                      <Icon name="check" size={14} />
                      {t('textSave')}
                    </button>
                  </span>
                </div>
              )}
              <ol ref={lines} class={`player__lines${draft ? ' player__lines--edit' : ''}`}>
                {draft
                  ? draft.map((c, i) => (
                      <li key={i} data-i={i} class={i === current ? 'on' : ''}>
                        <button class="player__at" onClick={() => seek(Math.max(0, c.start + shift))} title={t('playerGoTo')}>
                          {clockOf(c.start + shift)}
                        </button>
                        <textarea
                          class="subedit__text"
                          rows={2}
                          value={c.text}
                          aria-label={t('textLine', clockOf(c.start + shift))}
                          onInput={(e) => line(i, (e.target as HTMLTextAreaElement).value)}
                        />
                        <button class="hcard__btn" title={t('textLineRemove')} aria-label={t('textLineRemove')} onClick={() => setDraft((d) => d && d.filter((_, k) => k !== i))}>
                          <Icon name="close" size={13} />
                        </button>
                      </li>
                    ))
                  : text.cues.map((c, i) => (
                      <li key={i} data-i={i} class={i === current ? 'on' : ''}>
                        <button onClick={() => seek(c.start)}>
                          <span class="player__at">{clockOf(c.start)}</span>
                          {c.text}
                        </button>
                      </li>
                    ))}
              </ol>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
