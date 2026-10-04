/**
 * Page titles carry the site's name ("Episode 3 - Vidéo Dailymotion", "Prime Video: Film",
 * "Clip | Site"). Keeps the part that names the video.
 */
export function cleanTitle(raw: string, host: string): string {
  const title = raw.replace(/\s+/g, ' ').trim();
  if (!title) return '';
  const brand = siteBrand(host);
  if (!brand) return title;
  const isBrand = (part: string) => {
    const p = squash(part);
    return !!p && (p.includes(brand) || (p.length >= 4 && brand.includes(p)));
  };

  // "Brand: Title" / "Brand - Title" prefixes.
  const prefix = /^([^:|–—-]{2,40})\s*[:|–—-]\s+(.+)$/.exec(title);
  if (prefix && isBrand(prefix[1]!)) return cleanTitle(prefix[2]!, host);

  // "Title : Brand" (French spacing) or "Title: Brand" suffixes.
  const suffix = /^(.+?)\s*[:|–—-]\s*([^:|–—-]{2,40})$/.exec(title);
  if (suffix && isBrand(suffix[2]!)) return cleanTitle(suffix[1]!, host);

  const parts = title.split(/\s+[|–—-]\s+|\s+·\s+/);
  const kept = parts.filter((p) => !isBrand(p));
  return (kept.length ? kept : parts).join(' - ').trim();
}

/** "www.primevideo.com" → "primevideo", "video.example.co.uk" → "example". */
function siteBrand(host: string): string {
  const labels = host.toLowerCase().replace(/^www\d*\./, '').split('.').filter(Boolean);
  if (labels.length < 2) return labels[0] ?? '';
  const sld = labels[labels.length - 2]!;
  const generic = ['co', 'com', 'org', 'net', 'gov', 'ac'];
  return generic.includes(sld) && labels.length >= 3 ? labels[labels.length - 3]! : sld;
}

const squash = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

/** File names made of ids and hashes ("6009f11e-0ca6-…_video_11") don't describe a video. */
export function looksLikeId(name: string): boolean {
  const s = name.trim();
  if (!s) return true;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(s)) return true;
  const letters = s.replace(/[^a-z]/gi, '').length;
  const hexRun = /[0-9a-f]{12,}/i.test(s.replace(/[-_]/g, ''));
  return hexRun || letters < 3 || /^(index|master|playlist|manifest|video|media|stream|chunk|seg(ment)?|file)[-_\d]*$/i.test(s);
}
