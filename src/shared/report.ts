import type { Job } from './types';

/** The browser, from what it says of itself: "Chrome 141", "Brave 1.83", "Edge 141". */
export function browserName(ua: string, brands: readonly { brand: string; version: string }[] = []): string {
  const named = brands.find((b) => !/not.?a.?brand|chromium/i.test(b.brand));
  if (named) return `${named.brand.replace(/^Google /, '')} ${named.version}`;
  // The most particular first: Edge and Opera say "Chrome/" too.
  for (const [name, re] of [
    ['Edge', /Edg\/(\d+)/],
    ['Opera', /OPR\/(\d+)/],
    ['Vivaldi', /Vivaldi\/(\d+)/],
    ['Brave', /Brave\/(\d+)/],
    ['Chrome', /Chrome\/(\d+)/],
  ] as const) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1]}`;
  }
  return 'Chromium';
}

export const systemName = (ua: string) =>
  /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : '';

/**
 * « Diagnostic clair »: what to paste in a bug report. Only the site's name is in it — never
 * the address of the page or of the video, nor the title.
 */
export function reportOf(
  job: Job,
  env: {
    version: string;
    browser: string;
    system: string;
    lang: string;
    now?: number;
  },
): string {
  let host = '';
  try {
    host = new URL(job.pageUrl).hostname;
  } catch {
    // A page without an address: left out.
  }
  const lines: [string, string | number | undefined][] = [
    ['Grabby', env.version],
    ['Browser', [env.browser, env.system].filter(Boolean).join(' · ')],
    ['Language', env.lang],
    ['Site', host],
    ['Error', job.status === 'canceled' ? 'canceled' : (job.error ?? 'unknown')],
    ['Source', [job.kind, job.ytId ? 'youtube' : '', job.live ? 'live' : '', job.viaFetch ? 'fetch' : '', job.raw ? 'raw' : '', job.redone ? 'redone' : ''].filter(Boolean).join(' · ')],
    [
      'Asked',
      [job.mode, job.format, job.quality, job.scale ? `${job.scale}p` : '', job.clip ? 'clip' : '', job.parts?.length ? `${job.parts.length} parts` : '', job.subtitles ? 'subtitles' : '']
        .filter(Boolean)
        .join(' · '),
    ],
    ['Progress', `${Math.round(job.progress * 100)} % · ${job.bytes} B${job.total ? ` / ${job.total} B` : ''}`],
    ['Attempts', job.attempts ?? 1],
    ['Started', new Date(job.startedAt).toISOString()],
    ['Report', new Date(env.now ?? Date.now()).toISOString()],
  ];
  return lines
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}
