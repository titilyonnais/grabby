/**
 * The right-click menu. Its words come from the extension's messages; when Chrome answers with
 * nothing (it can, while Grabby starts again after an update), the same words written here:
 * a menu item without a title is refused and lands in the extension's error list.
 */
type Contexts = NonNullable<chrome.contextMenus.CreateProperties['contexts']>;

/** [French, English], the same as `menu_*` in _locales (checked by a test). */
export const MENU_WORDS: Record<string, [string, string]> = {
  media: ['Télécharger cette vidéo', 'Download this video'],
  media_audio: ['Télécharger seulement le son', 'Download the sound only'],
  link: ['Télécharger la vidéo de ce lien', 'Download the video of this link'],
  link_audio: ['Télécharger le son de ce lien', 'Download the sound of this link'],
  page: ['Télécharger la vidéo de la page', "Download the page's video"],
};

const MENUS: [string, Contexts][] = [
  ['media', ['video', 'audio']],
  ['media_audio', ['video', 'audio']],
  ['link', ['link']],
  ['link_audio', ['link']],
  ['page', ['page', 'frame', 'image']],
];

export function menuTitle(id: string): string {
  let said = '';
  try {
    said = chrome.i18n.getMessage(`menu_${id}`);
  } catch {
    // Grabby being reloaded at that very moment.
  }
  if (said) return said;
  let fr = false;
  try {
    fr = /^fr\b/i.test(chrome.i18n.getUILanguage());
  } catch {
    // Same.
  }
  const words = MENU_WORDS[id];
  return words ? words[fr ? 0 : 1] : id;
}

/** Right-click on a video, on a link, or anywhere on a page (whose player may hide its own menu). */
export function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    for (const [id, contexts] of MENUS) {
      // Every answer read: nothing Chrome refuses is left for the error list.
      chrome.contextMenus.create({ id, title: menuTitle(id), contexts }, () => void chrome.runtime.lastError);
    }
  });
}
