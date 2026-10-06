/**
 * Automatic rules: "on this site, always the sound as MP3", "YouTube: 1080p with French
 * subtitles". The most precise site wins (music.youtube.com before youtube.com); a rule for
 * every site ('') comes last. They are the choices already made when a card opens, and what
 * downloads started without the popup take (shortcut, button on the video, list, channels).
 */
import { isAudioFormat, isImageFormat } from './formats';
import { uid } from './ids';
import type { OutputFormat } from './plan';
import type { MediaItem, SubtitleTrack, Variant } from './types';

/** Qualities a rule can ask for: the best one, the smallest, or at most this many lines. */
export const RULE_QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360', 'smallest'] as const;
export type RuleQuality = (typeof RULE_QUALITIES)[number];

export interface Rule {
  id: string;
  /** A site ("youtube.com", its sub-sites too); empty: every site. */
  site: string;
  mode: 'video' | 'audio';
  /** The file's format; none: the settings' one. */
  format?: OutputFormat;
  quality: RuleQuality;
  /** Subtitle languages to keep ("fr", "en"), in the video or next to it. */
  subs: string[];
  /** A folder inside the downloads folder ("Musique", "Cours/Maths"); empty: the settings'. */
  folder: string;
}

export const newRule = (site = ''): Rule => ({ id: uid(), site, mode: 'video', quality: 'best', subs: [], folder: '' });

/** "https://www.YouTube.com/watch" → "youtube.com"; what the user typed, cleaned. */
export function siteOf(input: string): string {
  const s = input.trim().toLowerCase();
  if (!s) return '';
  try {
    const host = new URL(/^[a-z][\w+.-]*:\/\//.test(s) ? s : `https://${s}`).hostname;
    return host.replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return '';
  }
}

/** The rule for a page: the most precise site, then the first in the list. */
export function ruleFor(rules: readonly Rule[] | undefined, pageUrl: string): Rule | undefined {
  let host = '';
  try {
    host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return rules?.find((r) => !r.site);
  }
  let best: Rule | undefined;
  for (const r of rules ?? []) {
    const site = r.site.toLowerCase();
    const hit = !site || host === site || host.endsWith(`.${site}`);
    if (hit && (!best || site.length > best.site.length)) best = r;
  }
  return best;
}

/** The quality a rule asks for, among those the video has (best first, as listed). */
export function variantFor(variants: readonly Variant[], quality: RuleQuality): Variant | undefined {
  if (!variants.length) return undefined;
  const tall = (v: Variant) => v.height ?? 0;
  if (quality === 'best') return variants[0];
  if (quality === 'smallest') return [...variants].sort((a, b) => tall(a) - tall(b) || (a.bandwidth ?? 0) - (b.bandwidth ?? 0))[0];
  const max = Number(quality);
  // The tallest one that isn't taller; none that small: the smallest there is.
  const fit = variants.filter((v) => tall(v) > 0 && tall(v) <= max).sort((a, b) => tall(b) - tall(a));
  return fit[0] ?? [...variants].sort((a, b) => tall(a) - tall(b))[0];
}

const base = (l: string) => l.toLowerCase().split(/[-_]/)[0]!;

/**
 * The tracks for these languages: the video's own written one first, else the automatic
 * one, else YouTube's translation into it.
 */
export function subtitlesFor(tracks: readonly SubtitleTrack[] | undefined, langs: readonly string[]): string[] {
  const out: string[] = [];
  for (const lang of langs) {
    const want = base(lang);
    const of = (t: SubtitleTrack) => base(t.tlang ?? t.lang ?? '') === want;
    const pick =
      tracks?.find((t) => of(t) && !t.tlang && !t.auto && !t.forced) ??
      tracks?.find((t) => of(t) && !t.tlang && !t.auto) ??
      tracks?.find((t) => of(t) && !t.tlang) ??
      tracks?.find((t) => of(t));
    if (pick && !out.includes(pick.id)) out.push(pick.id);
  }
  return out;
}

export interface RuleChoice {
  mode: 'video' | 'audio';
  variantId?: string;
  format?: OutputFormat;
  subtitles: string[];
  folder?: string;
}

/** What a rule chooses for this video (only what the video allows). */
export function applyRule(item: MediaItem, rule: Rule | undefined, fallback: { video: OutputFormat; audio: OutputFormat }): RuleChoice {
  const audio = !!item.audioOnly || rule?.mode === 'audio';
  const wanted = rule?.format;
  const format = audio
    ? isAudioFormat(wanted) ? wanted : fallback.audio
    : wanted && !isAudioFormat(wanted) && !isImageFormat(wanted) && (!item.formats || item.formats.includes(wanted as never)) ? wanted : fallback.video;
  const variant = audio ? undefined : variantFor(item.variants, rule?.quality ?? 'best');
  return {
    mode: audio ? 'audio' : 'video',
    ...(variant ? { variantId: variant.id } : {}),
    format,
    subtitles: audio || !rule ? [] : subtitlesFor(item.subtitles, rule.subs),
    ...(rule?.folder.trim() ? { folder: rule.folder.trim() } : {}),
  };
}

/** Rules read back from storage or a file: only what makes sense is kept. */
export function cleanRules(input: unknown): Rule[] {
  if (!Array.isArray(input)) return [];
  const out: Rule[] = [];
  for (const r of input.slice(0, 100) as Partial<Rule>[]) {
    if (!r || typeof r !== 'object') continue;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : uid(),
      site: typeof r.site === 'string' ? siteOf(r.site) : '',
      mode: r.mode === 'audio' ? 'audio' : 'video',
      ...(typeof r.format === 'string' && /^[a-z0-9]{2,5}$/.test(r.format) ? { format: r.format as OutputFormat } : {}),
      quality: RULE_QUALITIES.includes(r.quality as RuleQuality) ? (r.quality as RuleQuality) : 'best',
      subs: Array.isArray(r.subs) ? r.subs.filter((s): s is string => typeof s === 'string' && /^[a-z]{2,3}([-_][\w]{2,8})?$/i.test(s)).slice(0, 8) : [],
      folder: typeof r.folder === 'string' ? r.folder.slice(0, 120) : '',
    });
  }
  return out;
}
