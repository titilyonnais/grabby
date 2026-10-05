/** A version of Grabby published on GitHub. */
export interface Release {
  version: string;
  /** Its page on GitHub (always Grabby's own repository). */
  url: string;
}

const REPO = 'https://github.com/titilyonnais/grabby/';

/** "1.8.0" from "v1.8.0"; null for what isn't a plain version number. */
export function versionOf(tag: unknown): string | null {
  const m = typeof tag === 'string' ? /^v?(\d+(?:\.\d+){0,3})$/.exec(tag.trim()) : null;
  return m ? m[1]! : null;
}

/** True when `a` is a later version than `b` ("1.10.0" after "1.9.2"). */
export function newerVersion(a: string, b: string): boolean {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/** What GitHub's "latest release" answer says, checked (drafts and pre-releases are ignored). */
export function releaseOf(json: unknown): Release | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
  if (r.draft || r.prerelease) return null;
  const version = versionOf(r.tag_name);
  if (!version) return null;
  // Only ever a link to Grabby's own releases.
  const url = typeof r.html_url === 'string' && r.html_url.startsWith(REPO) ? r.html_url : `${REPO}releases/tag/v${version}`;
  return { version, url };
}
