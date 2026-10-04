const FORBIDDEN = /[<>:"/\\|?*]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_TOTAL = 120;
const MAX_STEM = 110;

/**
 * Characters Windows refuses, turned into what a person would type instead: "Film: la
 * suite" → "Film - la suite", "AC/DC" → "AC-DC", quotes → apostrophes; ? * < > dropped.
 */
function readable(s: string): string {
  return s
    .replace(/\s*:\s+/g, ' - ')
    .replace(/[:/\\|]/g, '-')
    .replace(/"/g, "'")
    .replace(/[<>?*]/g, '');
}

function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

export function sanitizeFilename(name: string, fallback = 'video', max = MAX_STEM): string {
  let s = readable(name.replace(CONTROL, ' ')).replace(FORBIDDEN, '_').replace(/\s+/g, ' ');
  s = truncate(s.trim(), max);
  s = s.replace(/[. ]+$/, '').replace(/^[. ]+/, '');
  if (!s) return fallback;
  if (RESERVED.test(s)) s += '_';
  return s;
}

export interface FilenameContext {
  title: string;
  site: string;
  quality?: string;
  date: Date;
}

/** What a file name can be made of, in this order: "Title - 1080p - site.com - 2026-10-04". */
export const NAME_PARTS = ['title', 'quality', 'site', 'date'] as const;
export type NamePart = (typeof NAME_PARTS)[number];

/** The parts a name template uses; a template naming none of them counts as the title alone. */
export function namePartsOf(template: string): NamePart[] {
  const parts = NAME_PARTS.filter((p) => template.includes(`{${p}}`));
  return parts.length ? parts : ['title'];
}

/** The template for a set of parts (in the fixed order), joined by " - "; never empty. */
export function templateOf(parts: readonly NamePart[]): string {
  const kept = NAME_PARTS.filter((p) => parts.includes(p));
  return (kept.length ? kept : ['title']).map((p) => `{${p}}`).join(' - ');
}

export function buildFilename(
  template: string,
  ctx: FilenameContext,
  ext: string,
  subfolder?: string,
): string {
  const values: Record<string, string> = {
    title: ctx.title,
    site: ctx.site,
    quality: ctx.quality ?? '',
    // The user's own calendar day (toISOString is UTC: in Paris just after midnight it
    // would still be yesterday).
    date: `${ctx.date.getFullYear()}-${String(ctx.date.getMonth() + 1).padStart(2, '0')}-${String(ctx.date.getDate()).padStart(2, '0')}`,
  };
  let raw = (template || '{title}').replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
  // Remove brackets/parentheses and " - " separators left empty by missing values.
  raw = raw
    .replace(/\[\s*\]|\(\s*\)/g, '')
    .replace(/\s+-(?:\s+-)+(?=\s)/g, ' -')
    .replace(/^\s*-\s+|\s+-\s*$/g, '');
  const stem = sanitizeFilename(raw, sanitizeFilename(ctx.title), MAX_TOTAL - ext.length - 1);
  const file = `${stem}.${ext}`;
  return subfolder ? `${sanitizeFilename(subfolder, 'Grabby')}/${file}` : file;
}
