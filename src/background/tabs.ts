/** Tracks each tab's top-level URL (webRequest events don't carry it for sub-resources). */
const urls = new Map<number, string>();

export function rememberTabUrl(tabId: number, url: string): void {
  urls.set(tabId, url);
}

export function forgetTab(tabId: number): void {
  urls.delete(tabId);
}

export async function tabUrl(tabId: number): Promise<string> {
  const known = urls.get(tabId);
  if (known) return known;
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.pendingUrl || tab.url || '';
    if (url) urls.set(tabId, url);
    return url;
  } catch {
    return '';
  }
}

/** Compares two URLs ignoring the fragment (hash navigations keep detections). */
export function samePage(a: string, b: string): boolean {
  return a.split('#')[0] === b.split('#')[0];
}
