import { hostOf } from '../parsers/url';

/**
 * Many CDNs refuse requests without the page's Referer/Origin. Extension-initiated
 * requests (offscreen fetches, chrome.downloads) carry tabId -1, so session rules
 * scoped to `tabIds: [-1]` restore those headers without touching normal browsing.
 */
interface RuleRef {
  id: number;
  refs: number;
}

const rules = new Map<string, RuleRef>();
let nextId = 0;

/** Session rules outlive service-worker restarts: continue numbering after them. */
async function allocId(): Promise<number> {
  if (nextId === 0) {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    nextId = Math.max(0, ...existing.map((r) => r.id)) + 1;
  }
  return nextId++;
}

/** Called on browser startup / install: no download can be in flight then. */
export async function resetHeaderRules(): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  if (existing.length) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existing.map((r) => r.id) });
  }
  rules.clear();
  nextId = 1;
}

/** Adds Referer/Origin rules for the hosts of `urls`; returns a release function. */
export async function withPageHeaders(pageUrl: string, urls: string[]): Promise<() => Promise<void>> {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return async () => {};
  }
  if (!/^https?:/.test(origin)) return async () => {};

  const hosts = [...new Set(urls.map(hostOf).filter(Boolean))];
  const keys: string[] = [];
  const add: chrome.declarativeNetRequest.Rule[] = [];

  for (const host of hosts) {
    const key = `${host}|${pageUrl}`;
    keys.push(key);
    const existing = rules.get(key);
    if (existing) {
      existing.refs++;
      continue;
    }
    const id = await allocId();
    rules.set(key, { id, refs: 1 });
    add.push({
      id,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          { header: 'referer', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: pageUrl },
          { header: 'origin', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: origin },
        ],
      },
      condition: {
        requestDomains: [host],
        tabIds: [chrome.tabs.TAB_ID_NONE],
      },
    });
  }
  if (add.length) await chrome.declarativeNetRequest.updateSessionRules({ addRules: add });

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const remove: number[] = [];
    for (const key of keys) {
      const r = rules.get(key);
      if (r && --r.refs <= 0) {
        rules.delete(key);
        remove.push(r.id);
      }
    }
    if (remove.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: remove });
  };
}

/** Fetches text with the page's headers restored (manifests, playlists). */
export async function fetchTextAs(url: string, pageUrl: string): Promise<string> {
  const release = await withPageHeaders(pageUrl, [url]);
  try {
    const res = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    await release();
  }
}
