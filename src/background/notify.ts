import type { BgToContent } from '../shared/messages';
import { getSettings } from '../shared/settings';
import type { Job } from '../shared/types';

const PREFIX = 'grabby:';

/**
 * When a download ends: a bubble in the page the user is looking at (it doesn't depend on
 * the system's notification settings), plus a system notification.
 */
export async function notifyFinished(job: Job): Promise<void> {
  if (!(await getSettings()).notify) return;
  const ok = job.status === 'done';
  const title = chrome.i18n.getMessage(ok ? 'notifyDone' : 'notifyFailed');
  const detail = ok ? job.filename || job.title : `${job.title} — ${chrome.i18n.getMessage(`err_${job.error ?? 'unknown'}`)}`;
  await Promise.all([toast(job, ok, title, detail), system(job, ok, title, detail)]);
}

async function toast(job: Job, ok: boolean, title: string, detail: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (tab?.id === undefined || !/^https?:/.test(tab.url ?? tab.pendingUrl ?? 'https:')) return;
  const msg: BgToContent = {
    type: 'toast',
    ok,
    title,
    detail,
    ...(ok && job.downloadId !== undefined ? { downloadId: job.downloadId, action: chrome.i18n.getMessage('toastShow') } : {}),
  };
  await chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 }).catch(() => {});
}

async function system(job: Job, ok: boolean, title: string, detail: string): Promise<void> {
  if (!chrome.notifications) return;
  try {
    const picture = ok ? await pictureOf(job.thumbnail) : undefined;
    await chrome.notifications.create(`${PREFIX}${job.id}:${job.downloadId ?? ''}`, {
      // The video's picture, big, when it has one.
      ...(picture ? { type: 'image' as const, imageUrl: picture } : { type: 'basic' as const }),
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message: detail,
      ...(ok && job.bytes ? { contextMessage: [job.mode === 'audio' ? chrome.i18n.getMessage('jobKindAudio') : chrome.i18n.getMessage('jobKindVideo'), job.quality, sizeText(job.bytes)].filter(Boolean).join(' · ') } : {}),
      silent: true,
      // A file saved: open it, or show it in its folder.
      ...(ok && job.downloadId !== undefined ? { buttons: [{ title: chrome.i18n.getMessage('notifyOpen') }, { title: chrome.i18n.getMessage('notifyShow') }] } : {}),
    });
  } catch (e) {
    console.warn('[grabby] notification', e);
  }
}

/** "12,4 Mo": a size in the user's language. */
export function sizeText(bytes: number, lang = chrome.i18n.getUILanguage()): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let n = bytes;
  let u = 0;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  return new Intl.NumberFormat(lang, { style: 'unit', unit: units[u], unitDisplay: 'short', maximumFractionDigits: n < 10 && u ? 1 : 0 }).format(n);
}

/** The picture for the notification: a small data: image, or one of the web the browser can fetch. */
async function pictureOf(src?: string): Promise<string | undefined> {
  if (!src) return undefined;
  if (/^data:image\//.test(src)) return src;
  if (!/^https:\/\//i.test(src)) return undefined;
  try {
    // Fetched here (without cookies): a picture that doesn't come keeps the plain notification.
    const res = await fetch(src, { credentials: 'omit', signal: AbortSignal.timeout(4000) });
    if (!res.ok || !/^image\//.test(res.headers.get('content-type') ?? '')) return undefined;
    const blob = await res.blob();
    if (blob.size > 2_000_000) return undefined;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${blob.type};base64,${btoa(bin)}`;
  } catch {
    return undefined;
  }
}

/** The download a "finished" notification is about (undefined for a failure). */
function downloadOf(id: string): number | undefined {
  if (!id.startsWith(PREFIX)) return undefined;
  const last = id.split(':').pop();
  const n = Number(last);
  return last !== '' && Number.isInteger(n) ? n : undefined;
}

/** Clicking a "finished" notification opens the file; its buttons open it or show it in its folder. */
export function listenNotificationClicks(): void {
  chrome.notifications?.onClicked.addListener((id) => {
    if (!id.startsWith(PREFIX)) return;
    const d = downloadOf(id);
    if (d !== undefined) chrome.downloads.open(d);
    chrome.notifications.clear(id);
  });
  chrome.notifications?.onButtonClicked.addListener((id, button) => {
    const d = downloadOf(id);
    if (d === undefined) return;
    if (button === 0) chrome.downloads.open(d);
    else chrome.downloads.show(d);
    chrome.notifications.clear(id);
  });
}
