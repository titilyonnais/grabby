import { editedTranscript, type Transcript } from '../shared/transcript';
import type { HistoryEntry } from '../shared/types';

/** What is said in a saved file, kept apart (the history stays light). */
const TEXT = (id: string) => `text:${id}`;
/** Its picture, kept here: the library shows it without the network. */
const THUMB = (id: string) => `thumb:${id}`;
/** Both, for an entry that goes. */
const KEPT = (id: string) => [TEXT(id), THUMB(id)];

const KEY = 'history';
const MAX = 500;
/** Thumbnails kept in the history: page URLs or small stills, not big data: URLs. */
const MAX_THUMB = 120_000;
/** How long a "is the file still there?" answer is reused (state is rebuilt several times a second). */
const PRESENCE_MS = 5000;

export async function getHistory(): Promise<HistoryEntry[]> {
  return ((await chrome.storage.local.get(KEY))[KEY] as HistoryEntry[] | undefined) ?? [];
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  const { thumbnail, ...rest } = entry;
  const kept: HistoryEntry = thumbnail && thumbnail.length <= MAX_THUMB ? { ...rest, thumbnail } : rest;
  const all = [kept, ...(await getHistory()).filter((e) => e.id !== entry.id)];
  await chrome.storage.local.set({ [KEY]: all.slice(0, MAX) });
  // The oldest ones beyond the limit go, with what was said in them.
  const gone = all.slice(MAX).flatMap((e) => KEPT(e.id));
  if (gone.length) await chrome.storage.local.remove(gone);
  presence = null;
  if (thumbnail) void keepThumb(entry.id, thumbnail);
}

/** « Miniatures hors ligne »: the picture, made small (320 px), kept with the entry. */
export async function keepThumb(id: string, url: string): Promise<void> {
  try {
    const blob = await (await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })).blob();
    if (!blob.type.startsWith('image/') || blob.size > 8_000_000) return;
    const img = await createImageBitmap(blob);
    const k = Math.min(1, 320 / img.width);
    const c = new OffscreenCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const small = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.78 })).arrayBuffer());
    let bin = '';
    for (let i = 0; i < small.length; i += 0x8000) bin += String.fromCharCode(...small.subarray(i, i + 0x8000));
    // Still in the library (not taken out meanwhile)?
    if (!(await getHistory()).some((e) => e.id === id)) return;
    await chrome.storage.local.set({
      [THUMB(id)]: `data:image/jpeg;base64,${btoa(bin)}`,
    });
  } catch {
    // No picture to keep: the page's one is shown while online.
  }
}

/** The kept pictures of these entries. */
export async function allThumbs(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const got = await chrome.storage.local.get(ids.map(THUMB));
  return Object.fromEntries(ids.flatMap((id) => (typeof got[THUMB(id)] === 'string' ? [[id, got[THUMB(id)] as string]] : [])));
}

/** Taken out of the library (the files stay). Their texts stay a little: « Annuler » puts them back. */
export async function removeHistory(ids: string[]): Promise<HistoryEntry[]> {
  const list = await getHistory();
  const out = list.filter((e) => ids.includes(e.id));
  await chrome.storage.local.set({
    [KEY]: list.filter((e) => !ids.includes(e.id)),
  });
  return out;
}

/** « Annuler »: entries just taken out, back where they were (by date). */
export async function restoreHistory(entries: HistoryEntry[]): Promise<void> {
  const list = await getHistory();
  const back = entries.filter((e) => e && typeof e.id === 'string' && !list.some((x) => x.id === e.id)).map(({ missing: _m, ...e }) => e);
  await chrome.storage.local.set({
    [KEY]: [...list, ...back].sort((a, b) => b.date - a.date).slice(0, MAX),
  });
  presence = null;
}

/** Their texts, once taking them out can no longer be undone. */
export async function forgetTexts(ids: string[]): Promise<void> {
  const list = await getHistory();
  const gone = ids.filter((id) => !list.some((e) => e.id === id));
  if (gone.length) await chrome.storage.local.remove(gone.flatMap(KEPT));
}

/** Favorite or collections changed on some entries. */
export async function markHistory(
  ids: string[],
  patch: {
    fav?: boolean;
    tags?: string[];
    addTag?: string;
    removeTag?: string;
  },
): Promise<void> {
  const clean = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 40);
  const list = (await getHistory()).map((e) => {
    if (!ids.includes(e.id)) return e;
    let tags = patch.tags ? patch.tags.map(clean).filter(Boolean) : (e.tags ?? []);
    if (patch.addTag && clean(patch.addTag) && !tags.includes(clean(patch.addTag))) tags = [...tags, clean(patch.addTag)];
    if (patch.removeTag) tags = tags.filter((t) => t !== patch.removeTag);
    const { tags: _t, fav: _f, ...rest } = e;
    const fav = patch.fav ?? e.fav;
    return {
      ...rest,
      ...(fav ? { fav: true } : {}),
      ...(tags.length ? { tags: tags.slice(0, 20) } : {}),
    };
  });
  await chrome.storage.local.set({ [KEY]: list });
  presence = null;
}

export async function saveTranscript(id: string, t: Transcript): Promise<void> {
  await chrome.storage.local.set({ [TEXT(id)]: t });
}

/** Edited in the library: kept for an entry still there, checked again here. */
export async function saveEditedTranscript(id: string, t: Transcript): Promise<boolean> {
  if (!(await getHistory()).some((e) => e.id === id) || !t || !Array.isArray(t.cues)) return false;
  const clean = editedTranscript(t, t.cues);
  await chrome.storage.local.set({ [TEXT(id)]: clean });
  return true;
}

export async function getTranscript(id: string): Promise<Transcript | undefined> {
  return (await chrome.storage.local.get(TEXT(id)))[TEXT(id)] as Transcript | undefined;
}

/** Every kept text, for the library's search. */
export async function allTranscripts(ids: string[]): Promise<Record<string, Transcript>> {
  if (!ids.length) return {};
  const got = await chrome.storage.local.get(ids.map(TEXT));
  return Object.fromEntries(ids.flatMap((id) => (got[TEXT(id)] ? [[id, got[TEXT(id)] as Transcript]] : [])));
}

export async function clearHistory(): Promise<void> {
  const kept = (await getHistory()).flatMap((e) => KEPT(e.id));
  await chrome.storage.local.remove([KEY, ...kept]);
}

let presence: { at: number; missing: Set<number> } | null = null;

/** The history, each entry marked when its file can no longer be shown in its folder. */
export async function historyWithPresence(): Promise<HistoryEntry[]> {
  const list = await getHistory();
  if (!presence || Date.now() - presence.at > PRESENCE_MS) {
    const missing = new Set<number>();
    await Promise.all(
      list.map(async (e) => {
        if (e.downloadId === undefined) return;
        const [d] = await chrome.downloads.search({ id: e.downloadId }).catch(() => []);
        if (!d || d.exists === false || d.state !== 'complete') missing.add(e.downloadId);
      }),
    );
    presence = { at: Date.now(), missing };
  }
  const gone = presence.missing;
  return list.map((e) => (e.downloadId !== undefined && gone.has(e.downloadId) ? { ...e, missing: true } : e));
}
