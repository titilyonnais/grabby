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

/** Every rule change runs in turn: concurrent callers can't share ids or leak rules. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Session rules outlive service-worker restarts: continue numbering after them. */
async function allocId(): Promise<number> {
  if (nextId === 0) {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    nextId = Math.max(0, ...existing.map((r) => r.id)) + 1;
  }
  return nextId++;
}

/** Called on browser startup / install: no download can be in flight then. */
export function resetHeaderRules(): Promise<void> {
  return serial(async () => {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    if (existing.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existing.map((r) => r.id) });
    }
    rules.clear();
    nextId = 1;
  });
}

/** Removes rules nobody holds (their owner was lost when the service worker restarted). */
export function sweepHeaderRules(): Promise<void> {
  return serial(async () => {
    if (rules.size) return;
    const existing = (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => r.id !== PLAYER_RULE_ID);
    if (existing.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existing.map((r) => r.id) });
    }
  });
}

/** Reserved id (far above the per-download ones). */
const PLAYER_RULE_ID = 1_000_000;

/**
 * YouTube's embedded player requires its host to identify itself with a
 * Referer. Extension pages send none, so the hidden player (in the offscreen document)
 * presents the extension's own identity, its chromiumapp.org address.
 */
export function allowHiddenPlayer(): Promise<void> {
  return serial(async () => {
    const id = chrome.runtime.id;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [PLAYER_RULE_ID],
      addRules: [
        {
          id: PLAYER_RULE_ID,
          priority: 2,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [{ header: 'referer', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: `https://${id}.chromiumapp.org/` }],
          },
          condition: {
            requestDomains: ['www.youtube.com'],
            resourceTypes: [chrome.declarativeNetRequest.ResourceType.SUB_FRAME],
            initiatorDomains: [id],
          },
        },
      ],
    });
  });
}

/** What a browser would send: the full URL on the same host, only the origin elsewhere. */
export function refererFor(pageUrl: string, host: string): string {
  const page = new URL(pageUrl);
  return page.hostname === host ? pageUrl : `${page.origin}/`;
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
  const keys = hosts.map((host) => `${host}|${pageUrl}`);

  await serial(async () => {
    const add: chrome.declarativeNetRequest.Rule[] = [];
    for (const [i, host] of hosts.entries()) {
      const existing = rules.get(keys[i]!);
      if (existing) {
        existing.refs++;
        continue;
      }
      const id = await allocId();
      rules.set(keys[i]!, { id, refs: 1 });
      add.push({
        id,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            { header: 'referer', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: refererFor(pageUrl, host) },
            { header: 'origin', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: origin },
          ],
        },
        condition: {
          requestDomains: [host],
          tabIds: [chrome.tabs.TAB_ID_NONE],
        },
      });
    }
    if (!add.length) return;
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ addRules: add });
    } catch (e) {
      // Undo the bookkeeping so a later call can try again.
      for (const key of keys) {
        const r = rules.get(key);
        if (r && add.some((a) => a.id === r.id)) rules.delete(key);
        else if (r) r.refs--;
      }
      throw e;
    }
  });

  let released = false;
  return () => {
    if (released) return Promise.resolve();
    released = true;
    return serial(async () => {
      const remove: number[] = [];
      for (const key of keys) {
        const r = rules.get(key);
        if (r && --r.refs <= 0) {
          rules.delete(key);
          remove.push(r.id);
        }
      }
      if (remove.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: remove });
    });
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
