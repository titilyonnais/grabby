/**
 * Experimental YouTube support.
 */
import { PART_LEAD } from '../shared/clip';
import type { CapturedCaption } from '../shared/plan';

/** Subtitles to keep, written in the hidden player's address: "en", "en.asr", "en>fr" (translated). */
export const captionKey = (c: CapturedCaption): string => `${c.lang}${c.auto ? '.asr' : ''}${c.tlang ? `>${c.tlang}` : ''}`;

/** The subtitles a hidden player is asked to keep, read back from its address. */
export function captionsFromUrl(value: string | null): CapturedCaption[] {
  if (!value) return [];
  return value
    .split(',')
    .slice(0, 16)
    .flatMap((k) => {
      const m = /^([\w-]{2,20})(\.asr)?(?:>([\w-]{2,20}))?$/.exec(k);
      return m ? [{ lang: m[1]!, ...(m[2] ? { auto: true } : {}), ...(m[3] ? { tlang: m[3] } : {}) }] : [];
    });
}

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

/** The recording a hidden player belongs to: its job, and which of its sessions (0 first). */
export function hiddenSessionFromUrl(href: string): number {
  try {
    const n = Number(new URL(href).searchParams.get('gys'));
    return Number.isInteger(n) && n >= 0 && n < 1000 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * The hidden player's address for a job (codecs and quality travel in the URL). A part of the
 * video (`part`), and where a recording carrying on starts again (`from`), are passed too.
 */
export function hiddenPlayerUrl(o: {
  jobId: string;
  videoId: string;
  quality: string;
  vcodec: string;
  acodec: string;
  session?: number;
  from?: number;
  part?: { start: number; end: number };
  /** Subtitles to show while it plays (one after the other), so that Grabby keeps them. */
  captions?: CapturedCaption[];
  /** No faster than this many times the normal speed (a speed limit is set). */
  maxRate?: number;
}): string {
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
  if (o.session) q.set('gys', String(o.session));
  const from = Math.floor(o.from ?? (o.part ? Math.max(0, o.part.start - PART_LEAD) : 0));
  // The player's own "start" parameter: it begins there, nothing before is loaded.
  if (from > 0) q.set('start', String(from));
  if (o.part) {
    q.set('gyb', String(o.part.start));
    q.set('gye', String(o.part.end));
  }
  if (o.captions?.length) q.set('gysc', o.captions.map(captionKey).join(','));
  if (o.maxRate) q.set('gyr', String(o.maxRate));
  return `https://www.youtube.com/embed/${encodeURIComponent(o.videoId)}?${q}`;
}
