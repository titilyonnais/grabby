import { beforeEach, describe, expect, it, vi } from 'vitest';

type Rule = chrome.declarativeNetRequest.Rule;

function fakeDnr() {
  const live = new Map<number, Rule>();
  const tick = () => new Promise((r) => setTimeout(r, Math.random() * 4));
  return {
    live,
    api: {
      RuleActionType: { MODIFY_HEADERS: 'modifyHeaders' },
      HeaderOperation: { SET: 'set' },
      async getSessionRules() {
        await tick();
        return [...live.values()];
      },
      async updateSessionRules(o: { addRules?: Rule[]; removeRuleIds?: number[] }) {
        await tick();
        for (const r of o.addRules ?? []) {
          if (live.has(r.id)) throw new Error(`duplicate rule id ${r.id}`);
          live.set(r.id, r);
        }
        for (const id of o.removeRuleIds ?? []) live.delete(id);
      },
    },
  };
}

describe('withPageHeaders', () => {
  let dnr: ReturnType<typeof fakeDnr>;
  let mod: typeof import('../../src/background/headers');

  beforeEach(async () => {
    vi.resetModules();
    dnr = fakeDnr();
    vi.stubGlobal('chrome', { declarativeNetRequest: dnr.api, tabs: { TAB_ID_NONE: -1 } });
    mod = await import('../../src/background/headers');
  });

  it('survives concurrent callers without duplicate ids or leaked rules', async () => {
    const page = 'https://site.com/watch/1';
    const urls = [['https://cdn-a.com/x'], ['https://cdn-a.com/y'], ['https://cdn-b.com/z'], ['https://cdn-a.com/x', 'https://cdn-c.com/q']];
    const releases = await Promise.all(urls.concat(urls).map((u) => mod.withPageHeaders(page, u)));
    expect(dnr.live.size).toBe(3);
    await Promise.all(releases.map((r) => r()));
    expect(dnr.live.size).toBe(0);
  });

  it('sends only the origin as Referer to other hosts', async () => {
    expect(mod.refererFor('https://site.com/a?b=1', 'cdn.com')).toBe('https://site.com/');
    expect(mod.refererFor('https://site.com/a?b=1', 'site.com')).toBe('https://site.com/a?b=1');
  });
});
