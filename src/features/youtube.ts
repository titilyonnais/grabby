/**
 * Experimental YouTube support — GitHub build only.
 * This module is referenced exclusively behind `__TARGET__ === 'github'` so the
 * bundler removes it from the Chrome Web Store build. `test/unit/store-bundle.test.ts`
 * verifies that its thumbnail template (`hqdefault.jpg`) is absent from dist/store.
 */
export interface YouTubeInfo {
  title: string;
  thumbnail?: string;
  duration?: number;
}

function videoId(url: URL): string | null {
  if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  const m = /^\/(shorts|embed|live)\/([\w-]{6,})/.exec(url.pathname);
  return m ? m[2]! : null;
}

/** Reads title/thumbnail of the current YouTube video from the document (isolated world). */
export function readYouTubeInfo(doc: Document, location: string): YouTubeInfo | undefined {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return undefined;
  }
  const id = videoId(url);
  if (!id) return undefined;
  const og = doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content;
  const title = (og || doc.title).replace(/\s*-\s*YouTube\s*$/, '').trim() || `YouTube ${id}`;
  const video = doc.querySelector('video');
  const duration = video && Number.isFinite(video.duration) ? video.duration : undefined;
  return {
    title,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    ...(duration ? { duration } : {}),
  };
}
