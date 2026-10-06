import { hostOf } from '../parsers/url';
import { buildFilename, folderFor } from '../shared/filename';
import { getSettings } from '../shared/settings';
import type { MediaItem } from '../shared/types';
import { folderNames } from './jobs';

/**
 * The video's own picture, at its best: YouTube keeps it in several sizes (the biggest isn't
 * there for every video), other sites give one in the page.
 */
export function thumbCandidates(item: Pick<MediaItem, 'ytId' | 'thumbnail'>): string[] {
  const out: string[] = [];
  if (item.ytId && /^[\w-]{11}$/.test(item.ytId)) {
    for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) out.push(`https://i.ytimg.com/vi/${item.ytId}/${name}.jpg`);
  }
  if (item.thumbnail && /^(https?:|data:image\/)/i.test(item.thumbnail)) out.push(item.thumbnail);
  return [...new Set(out)];
}

/** Its file extension, from the address (a picture of unknown kind is called a JPEG). */
export function thumbExt(url: string): 'jpg' | 'png' | 'webp' {
  const data = /^data:image\/(png|webp|jpe?g)/i.exec(url)?.[1]?.toLowerCase();
  const path = data ?? /\.(png|webp|jpe?g)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
  return path === 'png' ? 'png' : path === 'webp' ? 'webp' : 'jpg';
}

/** The first picture that is really there (the last one is taken as it is). */
async function firstThere(urls: string[]): Promise<string | undefined> {
  for (const [i, url] of urls.entries()) {
    if (i === urls.length - 1 || url.startsWith('data:')) return url;
    try {
      const res = await fetch(url, { method: 'HEAD', credentials: 'omit', cache: 'no-store' });
      if (res.ok) return url;
    } catch {
      // Not there (or the network): the next size.
    }
  }
  return undefined;
}

/** "Miniature": the video's picture saved next to the other files, named like them. */
export async function saveThumbnail(item: MediaItem): Promise<boolean> {
  const url = await firstThere(thumbCandidates(item));
  if (!url) return false;
  const s = await getSettings();
  const site = hostOf(item.pageUrl).replace(/^www\./, '');
  const ext = thumbExt(url);
  const word = chrome.i18n.getMessage('thumbName') || 'thumbnail';
  const filename = buildFilename(
    s.template,
    {
      title: `${item.fromList?.title ?? item.title} (${word})`,
      site,
      date: new Date(),
      format: ext.toUpperCase(),
      ...(item.author ? { channel: item.author } : {}),
    },
    ext,
    folderFor(s.folder, { site, kind: 'image' }, folderNames()),
  );
  try {
    await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: s.saveAs });
    return true;
  } catch {
    return false;
  }
}
