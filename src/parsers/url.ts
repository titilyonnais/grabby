const RANGE_PARAMS = ['range', 'bytestart', 'byteend', '_'];

/** Resolves `ref` against `base`; returns `ref` unchanged when either is unusable. */
export function resolveUrl(ref: string, base: string): string {
  try {
    return new URL(ref, base).href;
  } catch {
    return ref;
  }
}

/** Drops byte-range query params and the fragment so repeated range requests dedupe. */
export function normalizeMediaUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const p of RANGE_PARAMS) u.searchParams.delete(p);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

export function hasRangeParams(url: string): boolean {
  try {
    const p = new URL(url).searchParams;
    return p.has('range') || p.has('bytestart') || p.has('byteend');
  } catch {
    return false;
  }
}

/** Lower-cased file extension of the URL path, without the dot ('' if none). */
export function extOf(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0] ?? '';
  }
  const m = /\.([a-z0-9]{1,5})$/i.exec(path);
  return m ? m[1]!.toLowerCase() : '';
}

/** Parses "start-end" into an inclusive tuple. */
export function parseRange(s: string | undefined): [number, number] | undefined {
  if (!s) return undefined;
  const m = /^(\d+)-(\d+)$/.exec(s.trim());
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
