import { getSettings } from '../shared/settings';
import type { Job } from '../shared/types';

const PREFIX = 'grabby:';

/** System notification when a download ends, so the user can keep watching meanwhile. */
export async function notifyFinished(job: Job): Promise<void> {
  if (!chrome.notifications || !(await getSettings()).notify) return;
  const ok = job.status === 'done';
  chrome.notifications.create(`${PREFIX}${job.id}:${job.downloadId ?? ''}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: chrome.i18n.getMessage(ok ? 'notifyDone' : 'notifyFailed'),
    message: ok ? job.filename || job.title : `${job.title}\n${chrome.i18n.getMessage(`err_${job.error ?? 'unknown'}`)}`,
    silent: true,
  });
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
