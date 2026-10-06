import { getSettings } from '../shared/settings';
import { newerVersion, releaseOf, type Release } from '../shared/release';
import type { InstallState } from '../shared/messages';

/**
 * "Prévenir des nouvelles versions" (off unless the user turns it on): once a day, one
 * request to GitHub's public page of Grabby's latest release. Nothing is sent but the
 * request itself (no cookie, no identifier); nothing is downloaded or installed.
 */
export const UPDATE_ALARM = 'grabby-update';
const LATEST = 'https://api.github.com/repos/titilyonnais/grabby/releases/latest';
const KEY = 'update';

interface Stored {
  latest?: Release;
  /** The version whose notice the user closed. */
  seen?: string;
  checkedAt?: number;
}

const read = async (): Promise<Stored> => ((await chrome.storage.local.get(KEY))[KEY] as Stored | undefined) ?? {};
const write = (s: Stored) => chrome.storage.local.set({ [KEY]: s });

/** Starts (or stops) the daily check, following the setting. */
export async function watchUpdates(on: boolean): Promise<void> {
  if (!on) {
    await chrome.alarms.clear(UPDATE_ALARM).catch(() => false);
    const s = await read();
    if (s.latest) await write({ ...(s.seen ? { seen: s.seen } : {}) });
    return;
  }
  const has = await chrome.alarms.get(UPDATE_ALARM).catch(() => undefined);
  if (!has) await chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
}

export async function checkUpdate(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!(await getSettings()).updateCheck) return;
  try {
    const res = await fetchImpl(LATEST, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return;
    const latest = releaseOf(await res.json());
    const s = await read();
    await write({ ...s, ...(latest ? { latest } : {}), checkedAt: Date.now() });
  } catch {
    /* offline: tomorrow */
  }
}

/** A newer version than this one, the user hasn't closed its notice: shown in the popup. */
export async function updateNotice(current = chrome.runtime.getManifest().version): Promise<Release | undefined> {
  if (!(await getSettings()).updateCheck) return undefined;
  const s = await read();
  if (!s.latest || s.seen === s.latest.version || !newerVersion(s.latest.version, current)) return undefined;
  return s.latest;
}

export async function seenUpdate(version: string): Promise<void> {
  await write({ ...(await read()), seen: version });
}

/**
 * "Update": the update helper (installed once by the user, see updater/install.ps1) puts the
 * latest release from GitHub in Grabby's folder, then Grabby restarts on it. Not while a
 * download runs: the restart would stop it.
 */
export const UPDATER_HOST = 'com.grabby.updater';

let install: InstallState | undefined;

export const installState = (): InstallState | undefined => install;

interface HelperAnswer {
  ok?: boolean;
  upToDate?: boolean;
  version?: string;
  error?: string;
}

export async function installUpdate(busy: boolean, changed: () => void): Promise<void> {
  if (install?.step === 'working') return;
  if (busy) {
    install = { step: 'busy' };
    return changed();
  }
  const send = chrome.runtime.sendNativeMessage as ((host: string, msg: object) => Promise<HelperAnswer>) | undefined;
  if (!send) {
    install = { step: 'failed', error: 'permission' };
    return changed();
  }
  install = { step: 'working' };
  changed();
  try {
    const r = await send(UPDATER_HOST, { action: 'update' });
    if (r?.ok && r.upToDate) install = { step: 'uptodate', ...(r.version ? { version: r.version } : {}) };
    else if (r?.ok) {
      install = { step: 'done', ...(r.version ? { version: r.version } : {}) };
      changed();
      // A moment to show it, then Grabby starts again on its new files.
      setTimeout(() => chrome.runtime.reload(), 1500);
      return;
    } else install = { step: 'failed', error: String(r?.error ?? 'failed').slice(0, 40) };
  } catch (e) {
    const text = String((e as Error)?.message ?? e);
    install = /not found|not registered|Access to the specified native messaging host is forbidden/i.test(text) ? { step: 'helper_missing' } : { step: 'failed', error: 'helper' };
  }
  changed();
}

