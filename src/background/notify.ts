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
    await chrome.notifications.create(`${PREFIX}${job.id}:${job.downloadId ?? ''}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message: detail,
      silent: true,
      // A file saved: open it, or show it in its folder.
      ...(ok && job.downloadId !== undefined ? { buttons: [{ title: chrome.i18n.getMessage('notifyOpen') }, { title: chrome.i18n.getMessage('notifyShow') }] } : {}),
    });
  } catch (e) {
    console.warn('[grabby] notification', e);
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
