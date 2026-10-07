import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MENU_WORDS, createMenus, menuTitle } from '../../src/background/menus';

const messages = (lang: string) => JSON.parse(readFileSync(`public/_locales/${lang}/messages.json`, 'utf8')) as Record<string, { message: string }>;

/** 2.3.2: « All menu items except for separators must have a title » right after installing. */
describe('right-click menu', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says the same words as the extension messages, in French and in English', () => {
    const fr = messages('fr');
    const en = messages('en');
    const keys = Object.keys(fr).filter((k) => k.startsWith('menu_')).map((k) => k.slice(5));
    expect(Object.keys(MENU_WORDS).sort()).toEqual(keys.sort());
    for (const [id, [f, e]] of Object.entries(MENU_WORDS)) {
      expect(f).toBe(fr[`menu_${id}`]?.message);
      expect(e).toBe(en[`menu_${id}`]?.message);
    }
  });

  it('never creates an item without a title, even when Chrome answers with nothing', () => {
    const made: { id: string; title?: string }[] = [];
    for (const [lang, word] of [['fr-FR', 'Télécharger cette vidéo'], ['en-US', 'Download this video']]) {
      made.length = 0;
      vi.stubGlobal('chrome', {
        i18n: { getMessage: () => '', getUILanguage: () => lang },
        runtime: { lastError: undefined },
        contextMenus: { removeAll: (done: () => void) => done(), create: (p: { id: string; title?: string }, done?: () => void) => { made.push(p); done?.(); } },
      });
      createMenus();
      expect(made).toHaveLength(Object.keys(MENU_WORDS).length);
      expect(made.every((m) => !!m.title)).toBe(true);
      expect(made[0]?.title).toBe(word);
    }
  });

  it('takes the extension messages when Chrome has them, and survives Chrome throwing', () => {
    vi.stubGlobal('chrome', { i18n: { getMessage: (k: string) => `«${k}»`, getUILanguage: () => 'fr' } });
    expect(menuTitle('link')).toBe('«menu_link»');
    vi.stubGlobal('chrome', { i18n: { getMessage: () => { throw new Error('Extension context invalidated.'); }, getUILanguage: () => { throw new Error('x'); } } });
    expect(menuTitle('link')).toBe('Download the video of this link');
  });
});
