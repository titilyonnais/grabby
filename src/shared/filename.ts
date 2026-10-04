const FORBIDDEN = /[<>:"/\\|?*]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_TOTAL = 120;
const MAX_STEM = 110;

function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

export function sanitizeFilename(name: string, fallback = 'video', max = MAX_STEM): string {
  let s = name.replace(CONTROL, ' ').replace(FORBIDDEN, '_').replace(/\s+/g, ' ');
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
    date: ctx.date.toISOString().slice(0, 10),
  };
  let raw = (template || '{title}').replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
  // Remove brackets/parentheses left empty by missing tokens.
  raw = raw.replace(/\[\s*\]|\(\s*\)/g, '').replace(/\s+-\s*$/, '');
  const stem = sanitizeFilename(raw, sanitizeFilename(ctx.title), MAX_TOTAL - ext.length - 1);
  const file = `${stem}.${ext}`;
  return subfolder ? `${sanitizeFilename(subfolder, 'Grabby')}/${file}` : file;
}
