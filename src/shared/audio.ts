import type { AudioTrack, MediaItem } from './types';

/** A sound track the user can pick: one per language (or name) the stream offers. */
export interface AudioChoice {
  id: string;
  label: string;
  lang?: string;
  isDefault?: boolean;
}

const keyOf = (a: AudioTrack) => `${a.lang ?? ''}|${a.label}`;

/**
 * The sound tracks of a stream worth choosing between: HLS renditions (once each, though
 * they are often listed once per quality), DASH languages (their best bitrate). Fewer than
 * two: nothing to choose.
 */
export function audioChoices(item: MediaItem): AudioChoice[] {
  if (item.kind === 'hls') {
    const seen = new Map<string, AudioChoice>();
    for (const a of item.audioTracks) {
      if (!a.url || seen.has(keyOf(a))) continue;
      seen.set(keyOf(a), { id: keyOf(a), label: a.label || a.lang || '?', ...(a.lang ? { lang: a.lang } : {}), ...(a.isDefault ? { isDefault: true } : {}) });
    }
    return seen.size < 2 ? [] : [...seen.values()];
  }
  if (item.kind === 'dash') {
    const best = new Map<string, AudioTrack>();
    for (const a of item.audioTracks) {
      const lang = a.lang ?? '';
      const had = best.get(lang);
      if (!had || (a.bandwidth ?? 0) > (had.bandwidth ?? 0)) best.set(lang, a);
    }
    if (best.size < 2) return [];
    return [...best.values()].map((a) => ({ id: a.id, label: a.lang ?? a.label, ...(a.lang ? { lang: a.lang } : {}) }));
  }
  return [];
}

/** HLS: the rendition of a choice that goes with a quality (its audio group), else any. */
export function hlsRendition(item: MediaItem, choiceId: string, group?: string): AudioTrack | undefined {
  const all = item.audioTracks.filter((a) => a.url && keyOf(a) === choiceId);
  return all.find((a) => !group || a.groupId === group) ?? all[0];
}
