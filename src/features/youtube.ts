/**
 * Experimental YouTube support.
 */
export interface YouTubeInfo {
  id: string;
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
    id,
    title,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    ...(duration ? { duration } : {}),
  };
}

/** Inside the hidden player: the job it records, from its URL. */
export function hiddenJobFromUrl(href: string): string | null {
  try {
    const u = new URL(href);
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname) || !u.pathname.startsWith('/embed/')) return null;
    const job = u.searchParams.get('gy');
    return job && /^[\w-]{4,64}$/.test(job) ? job : null;
  } catch {
    return null;
  }
}

/** The hidden player's address for a job (codecs and quality travel in the URL). */
export function hiddenPlayerUrl(o: { jobId: string; videoId: string; quality: string; vcodec: string; acodec: string }): string {
  const q = new URLSearchParams({
    autoplay: '0',
    mute: '1',
    controls: '0',
    playsinline: '1',
    rel: '0',
    disablekb: '1',
    fs: '0',
    iv_load_policy: '3',
    gy: o.jobId,
    gyq: o.quality,
    gyv: o.vcodec,
    gya: o.acodec,
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(o.videoId)}?${q}`;
}
