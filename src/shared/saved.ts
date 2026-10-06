import type { HistoryEntry, MediaItem } from './types';

/** The YouTube video an address is about ("watch?v=", "shorts/", "live/", "youtu.be/"). */
export function youTubeIdOf(url: string): string | undefined {
  return /(?:[?&]v=|\/(?:shorts|live|embed)\/|youtu\.be\/)([\w-]{11})(?![\w-])/.exec(url)?.[1];
}

const PICTURE = /\.(png|jpe?g|gif|webp)$/i;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * « Déjà téléchargé »: the last time this video was saved (a file still there), when it was.
 * A YouTube video is known by its id; anything else by its page, its title and which video it is.
 */
export function savedBefore(history: readonly HistoryEntry[], item: Pick<MediaItem, 'pageUrl' | 'title' | 'ytId'> & { id?: string }): HistoryEntry | undefined {
  const id = item.ytId ?? youTubeIdOf(item.pageUrl);
  return history.find((e) => {
    // A photo or an animation made from it is not the video.
    if (e.missing || e.downloadId === undefined || PICTURE.test(e.filename)) return false;
    if (id) return youTubeIdOf(e.pageUrl) === id;
    // Two videos of one page share its title: their ids tell them apart.
    if (e.media && item.id && e.media !== item.id) return false;
    return !!item.title && e.pageUrl === item.pageUrl && same(e.title, item.title);
  });
}
