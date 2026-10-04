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
    });
  } catch (e) {
    console.warn('[grabby] notification', e);
  }
}

/** Clicking a "finished" notification shows the file in its folder. */
export function listenNotificationClicks(): void {
  chrome.notifications?.onClicked.addListener((id) => {
    if (!id.startsWith(PREFIX)) return;
    const downloadId = Number(id.split(':').pop());
    if (Number.isInteger(downloadId) && id.split(':').pop() !== '') chrome.downloads.show(downloadId);
    chrome.notifications.clear(id);
  });
}
