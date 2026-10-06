import { useEffect, useMemo, useState } from 'preact/hooks';
import { imageNames, zipStore, type PageImage } from '../../shared/images';
import type { AppRequest } from '../../shared/messages';
import { Icon } from '../../popup/components/Icon';
import { Segmented } from '../../popup/components/Segmented';
import { size, t } from '../../popup/i18n';

type MinSize = '0' | '200' | '600' | '1200';
/** A .zip bigger than this would not open everywhere (no ZIP64): what is left goes one by one. */
const ZIP_MAX = 1_500_000_000;

const tabOfHash = () => Number(new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab') ?? NaN);
const safe = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Grabby';

async function save(url: string, filename: string) {
  await chrome.downloads.download({
    url,
    filename,
    conflictAction: 'uniquify',
  });
}

/** « Toutes les images »: the pictures of a page, chosen and saved in one .zip (or one by one). */
export function Images() {
  const [tabId, setTabId] = useState(tabOfHash());
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [page, setPage] = useState<{ title: string; url: string } | null>(null);
  const [list, setList] = useState<PageImage[] | null | undefined>(undefined);
  const [sizes, setSizes] = useState<Record<string, [number, number]>>({});
  const [min, setMin] = useState<MinSize>('200');
  const [off, setOff] = useState<string[]>([]);
  const [busy, setBusy] = useState<{ done: number; of: number } | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setTabId(tabOfHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  // No page chosen: the open pages, to pick one.
  useEffect(() => {
    if (Number.isInteger(tabId)) return;
    void chrome.tabs.query({}).then((all) => setTabs(all.filter((x) => /^https?:/i.test(x.url ?? '') && x.id !== undefined)));
  }, [tabId]);

  const load = async () => {
    if (!Number.isInteger(tabId)) return;
    setList(undefined);
    setOff([]);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    setPage(tab ? { title: tab.title ?? '', url: tab.url ?? '' } : null);
    const req: AppRequest = { app: 'page-images', tabId };
    const got = (await chrome.runtime.sendMessage(req).catch(() => null)) as PageImage[] | null;
    setList(Array.isArray(got) ? got : null);
  };
  useEffect(() => void load(), [tabId]);

  // The sizes the page didn't know: read from the pictures as they show.
  const sized = (img: PageImage): [number, number] => (img.w ? [img.w, img.h] : (sizes[img.url] ?? [0, 0]));
  const floor = Number(min);
  const shown = useMemo(
    () =>
      (list ?? []).filter((img) => {
        const [w, h] = sized(img);
        // Not known yet: shown until it is.
        return !w || Math.max(w, h) >= floor;
      }),
    [list, sizes, floor],
  );
  const chosen = shown.filter((img) => !off.includes(img.url));

  const pick = (url: string) => setOff((o) => (o.includes(url) ? o.filter((x) => x !== url) : [...o, url]));
  const flash = (s: string) => {
    setSaid(s);
    setTimeout(() => setSaid((x) => (x === s ? null : x)), 4000);
  };

  const zip = async () => {
    if (!chosen.length) return;
    setBusy({ done: 0, of: chosen.length });
    const files: { url: string; type: string; data: Uint8Array }[] = [];
    let total = 0;
    let failed = 0;
    for (const [i, img] of chosen.entries()) {
      try {
        const res = await fetch(img.url, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (total + blob.size > ZIP_MAX) throw new Error('too big');
        total += blob.size;
        files.push({
          url: img.url,
          type: blob.type,
          data: new Uint8Array(await blob.arrayBuffer()),
        });
      } catch {
        failed++;
      }
      setBusy({ done: i + 1, of: chosen.length });
    }
    if (files.length) {
      const names = imageNames(files);
      const body = zipStore(files.map((f, i) => ({ name: names[i]!, data: f.data })));
      const url = URL.createObjectURL(new Blob([body], { type: 'application/zip' }));
      try {
        await save(url, `${safe(page?.title ?? '')} (${t('imagesZipName')}).zip`);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
      }
    }
    setBusy(null);
    flash(failed ? t('imagesSavedSome', [String(files.length), String(failed)]) : t('imagesSaved', [String(files.length), size(total)]));
  };

  const oneByOne = async () => {
    const names = imageNames(chosen);
    const folder = safe(page?.title ?? '');
    setBusy({ done: 0, of: chosen.length });
    for (const [i, img] of chosen.entries()) {
      await save(img.url, `${folder}/${names[i]}`).catch(() => {});
      setBusy({ done: i + 1, of: chosen.length });
    }
    setBusy(null);
    flash(t('imagesSent', String(chosen.length)));
  };

  if (!Number.isInteger(tabId))
    return (
      <div class="stack">
        <section class="ap__card">
          <h2 class="ap__h2">{t('imagesPickPage')}</h2>
          <p class="hint">{t('imagesPickHint')}</p>
          {tabs.length ? (
            <ul class="tabpick">
              {tabs.map((x) => (
                <li key={x.id}>
                  <button onClick={() => (history.replaceState(null, '', `#images?tab=${x.id}`), setTabId(x.id!))}>
                    {x.favIconUrl ? <img src={x.favIconUrl} alt="" width={16} height={16} referrerpolicy="no-referrer" /> : <Icon name="link" size={16} />}
                    <span class="tabpick__title">{x.title || x.url}</span>
                    <span class="tabpick__host">{new URL(x.url!).hostname.replace(/^www\./, '')}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p class="empty">{t('imagesNoTabs')}</p>
          )}
        </section>
      </div>
    );

  return (
    <div class="stack images">
      <section class="ap__card images__head">
        <div class="images__page">
          <h2 class="ap__h2">{page?.title || t('imagesPage')}</h2>
          {page?.url && <p class="hint images__url">{page.url}</p>}
        </div>
        <div class="row">
          <button class="btn btn--soft btn--small" onClick={() => void load()} disabled={!!busy}>
            <Icon name="retry" size={14} />
            {t('imagesReload')}
          </button>
          <button class="btn btn--soft btn--small" onClick={() => (history.replaceState(null, '', '#images'), setTabId(NaN), setList(undefined))} disabled={!!busy}>
            <Icon name="image" size={14} />
            {t('imagesOther')}
          </button>
        </div>
      </section>

      {list === undefined ? (
        <div class="skeleton" aria-busy="true" aria-label={t('loading')}>
          <div class="skeleton__row" />
          <div class="skeleton__row" />
        </div>
      ) : list === null ? (
        <p class="notice">
          <Icon name="alert" size={16} />
          {t('imagesUnreachable')}
        </p>
      ) : (
        <>
          <div class="lib__filters">
            <Segmented
              label={t('imagesMin')}
              value={min}
              options={[
                ['0', t('imagesMinAll')],
                ['200', '≥ 200 px'],
                ['600', '≥ 600 px'],
                ['1200', '≥ 1200 px'],
              ]}
              onChange={setMin}
            />
            {shown.length > 0 && (
              <button class="btn btn--soft btn--small" onClick={() => setOff(off.length ? [] : shown.map((i) => i.url))}>
                {off.length ? t('libPickAll') : t('libPickNone')}
              </button>
            )}
            <span class="selbar__gap" />
            <strong class="images__count" aria-live="polite">
              {t('imagesChosen', [String(chosen.length), String(shown.length)])}
            </strong>
            <button class="btn btn--soft" disabled={!chosen.length || !!busy} onClick={() => void oneByOne()}>
              <Icon name="download" size={15} />
              {t('imagesOneByOne')}
            </button>
            <button class="btn btn--primary" disabled={!chosen.length || !!busy} onClick={() => void zip()}>
              <Icon name="zip" size={16} />
              {busy ? t('imagesBusy', [String(busy.done), String(busy.of)]) : t('imagesZip', String(chosen.length))}
            </button>
          </div>
          {said && (
            <p class="notice notice--soft" role="status">
              <Icon name="check" size={16} />
              {said}
            </p>
          )}
          {!shown.length ? (
            <p class="empty">{t('imagesNone')}</p>
          ) : (
            <ul class="igrid">
              {shown.map((img, i) => {
                const on = !off.includes(img.url);
                const [w, h] = sized(img);
                return (
                  <li key={img.url} class={`itile${on ? ' itile--on' : ''}`} style={{ '--i': String(Math.min(i, 16)) }}>
                    <button class="itile__pick" aria-pressed={on} onClick={() => pick(img.url)} title={img.alt || img.url}>
                      <img
                        src={img.url}
                        alt={img.alt ?? ''}
                        loading="lazy"
                        referrerpolicy="no-referrer"
                        onLoad={(e) => {
                          const el = e.currentTarget as HTMLImageElement;
                          if (!img.w && el.naturalWidth)
                            setSizes((s) => ({
                              ...s,
                              [img.url]: [el.naturalWidth, el.naturalHeight],
                            }));
                        }}
                      />
                      <span class="ltile__check" aria-hidden="true">
                        {on && <Icon name="check" size={16} />}
                      </span>
                      {w > 0 && (
                        <span class="itile__size">
                          {w} × {h}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
