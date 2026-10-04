import type { MediaItem } from '../shared/types';
import { downloadableCount } from './visible';

const ACCENT = '#FF5B4F';

export async function updateBadge(tabId: number, items: MediaItem[]): Promise<void> {
  const n = downloadableCount(items);
  try {
    await chrome.action.setBadgeText({ tabId, text: n ? String(Math.min(n, 99)) : '' });
    if (n) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: ACCENT });
      await chrome.action.setBadgeTextColor?.({ tabId, color: '#FFFFFF' });
    }
  } catch {
    // tab closed meanwhile
  }
}
