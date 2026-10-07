import type { Settings } from './settings';

/**
 * « Réglages synchronisés »: what goes into the browser's own synced storage (its account,
 * its servers; nothing of Grabby's).
 */
export const SYNC_PREFIX = 'grabby.';
/** What stays on this computer only (and what Grabby no longer has: its AI, the rules per site). */
const LOCAL_ONLY = ['sync', 'tourDone', 'firstRunAck', 'subfolder', 'rules', 'aiModels', 'chromeAi'] as const;

export type Synced = Record<string, unknown>;

/** The settings as the synced storage holds them. */
export function toSynced(s: Settings): Synced {
  const plain: Record<string, unknown> = { ...s };
  for (const k of LOCAL_ONLY) delete plain[k];
  return { [`${SYNC_PREFIX}settings`]: plain };
}

/** Back from the synced storage: what to change here (undefined: nothing synced yet). */
export function fromSynced(all: Synced): Partial<Settings> | undefined {
  const plain = all[`${SYNC_PREFIX}settings`] as Partial<Settings> | undefined;
  if (!plain || typeof plain !== 'object') return undefined;
  const patch: Record<string, unknown> = { ...plain };
  for (const k of LOCAL_ONLY) delete patch[k];
  return patch as Partial<Settings>;
}

/** Keys no longer used (the rules per site, kept in pieces before 2.5). */
export function staleKeys(before: Synced, now: Synced): string[] {
  return Object.keys(before).filter((k) => k.startsWith(SYNC_PREFIX) && !(k in now));
}
