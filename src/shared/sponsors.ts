/**
 * Sponsored parts of a YouTube video, from SponsorBlock (a public list kept by its viewers).
 * Asked the private way: only the first 4 characters of the video id's SHA-256 are sent, so
 * the server can't tell which video it is (it answers for every video sharing them). No
 * cookie, no account, nothing else. Only when the user turned it on.
 */
import type { Clip } from './plan';

export const SPONSORBLOCK = 'https://sponsor.ajay.app';

/** What is left out: paid promotions, and the creator promoting their own things. */
export const SPONSOR_CATEGORIES = ['sponsor', 'selfpromo'] as const;

/** Shorter than this, a sponsored part isn't worth a cut (nor is a piece left between two). */
const MIN = 1;

async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The address asked: the hash prefix and the categories, nothing about the video itself. */
export async function sponsorUrl(videoId: string): Promise<string> {
  const prefix = (await sha256Hex(videoId)).slice(0, 4);
  return `${SPONSORBLOCK}/api/skipSegments/${prefix}?categories=${encodeURIComponent(JSON.stringify(SPONSOR_CATEGORIES))}`;
}

/** The video's own parts in SponsorBlock's answer (every video sharing the prefix is in it). */
export function sponsorsIn(answer: unknown, videoId: string): Clip[] {
  if (!Array.isArray(answer)) return [];
  const mine = answer.find((v) => v && typeof v === 'object' && (v as { videoID?: unknown }).videoID === videoId) as { segments?: unknown } | undefined;
  if (!mine || !Array.isArray(mine.segments)) return [];
  const out: Clip[] = [];
  for (const s of mine.segments as { segment?: unknown; category?: unknown; actionType?: unknown }[]) {
    if (!s || !Array.isArray(s.segment) || s.segment.length !== 2) continue;
    // Only parts to skip (not "mute" or "full video" labels), of the categories asked.
    if (s.actionType !== undefined && s.actionType !== 'skip') continue;
    if (typeof s.category === 'string' && !(SPONSOR_CATEGORIES as readonly string[]).includes(s.category)) continue;
    const [start, end] = s.segment as unknown[];
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end - start >= MIN) out.push({ start: Math.max(0, start), end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Asks SponsorBlock; nothing found, offline or too slow: no part left out. */
export async function sponsorParts(videoId: string, fetcher: typeof fetch = fetch, timeoutMs = 6000): Promise<Clip[]> {
  if (!/^[\w-]{11}$/.test(videoId)) return [];
  try {
    const res = await fetcher(await sponsorUrl(videoId), {
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 404: no video with this prefix has any.
    if (!res.ok) return [];
    return sponsorsIn(await res.json(), videoId);
  } catch {
    return [];
  }
}

/**
 * What is kept: the parts asked for (the whole video when none), minus the sponsored parts.
 * Pieces shorter than a second are dropped.
 */
export function withoutSponsors(ranges: Clip[], sponsors: Clip[]): Clip[] {
  const out: Clip[] = [];
  for (const r of ranges) {
    let at = r.start;
    for (const s of sponsors) {
      if (s.end <= at || s.start >= r.end) continue;
      if (s.start - at >= MIN) out.push({ start: at, end: s.start });
      at = Math.max(at, s.end);
    }
    if (r.end - at >= MIN) out.push({ start: at, end: r.end });
  }
  return out;
}
