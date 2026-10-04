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

/** Loopback, private, link-local and .local hosts: the user's own network. */
export function isPrivateHost(url: string): boolean {
  const host = hostOf(url).toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host) || host.startsWith('::ffff:');
}

/**
 * URLs read from a page or a playlist may not send the extension (which bypasses CORS and
 * Private Network Access) into the local network, unless they came from there already.
 */
export const reachableFrom = (source: string, target: string): boolean => !isPrivateHost(target) || isPrivateHost(source);
