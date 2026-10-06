import type { Rule } from './rules';
import type { Settings } from './settings';

/**
 * « Réglages synchronisés »: what goes into the browser's own synced storage (its account,
 * its servers; nothing of Grabby's). Its items are small (8 kB each): the rules are cut in
 * pieces of a few each.
 */
export const SYNC_PREFIX = 'grabby.';
/** What stays on this computer only. */
const LOCAL_ONLY = ['sync', 'tourDone', 'firstRunAck', 'subfolder', 'rules'] as const;
const ITEM_MAX = 7000;

export type Synced = Record<string, unknown>;

/** The settings as the synced storage holds them: the settings, and the rules in pieces. */
export function toSynced(s: Settings): Synced {
  const plain: Record<string, unknown> = { ...s };
  for (const k of LOCAL_ONLY) delete plain[k];
  const out: Synced = { [`${SYNC_PREFIX}settings`]: plain };
  const pieces: Rule[][] = [];
  let piece: Rule[] = [];
  for (const r of s.rules) {
    if (piece.length && JSON.stringify([...piece, r]).length > ITEM_MAX) {
      pieces.push(piece);
      piece = [];
    }
    piece.push(r);
  }
  if (piece.length) pieces.push(piece);
  pieces.forEach((p, i) => (out[`${SYNC_PREFIX}rules.${i}`] = p));
  out[`${SYNC_PREFIX}rules.n`] = pieces.length;
  return out;
}

/** Back from the synced storage: what to change here (undefined: nothing synced yet). */
export function fromSynced(all: Synced): Partial<Settings> | undefined {
  const plain = all[`${SYNC_PREFIX}settings`] as Partial<Settings> | undefined;
  if (!plain || typeof plain !== 'object') return undefined;
  const n = Number(all[`${SYNC_PREFIX}rules.n`]) || 0;
  const rules: Rule[] = [];
  for (let i = 0; i < n; i++) {
    const p = all[`${SYNC_PREFIX}rules.${i}`];
    if (Array.isArray(p)) rules.push(...(p as Rule[]));
  }
  const patch: Record<string, unknown> = { ...plain };
  for (const k of LOCAL_ONLY) delete patch[k];
  return { ...(patch as Partial<Settings>), rules };
}

/** The keys of an older, longer list of rule pieces, no longer used. */
export function staleKeys(before: Synced, now: Synced): string[] {
  return Object.keys(before).filter((k) => k.startsWith(SYNC_PREFIX) && !(k in now));
}
