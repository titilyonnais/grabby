import { getSettings, setSettings, type Settings } from '../shared/settings';
import { fromSynced, staleKeys, SYNC_PREFIX, toSynced } from '../shared/sync';

/** What this computer last wrote or read: changes coming back from it are not applied twice. */
let last = '';

const same = (patch: Partial<Settings>, s: Settings) => Object.entries(patch).every(([k, v]) => JSON.stringify(v) === JSON.stringify(s[k as keyof Settings]));

async function push(s: Settings): Promise<void> {
  const data = toSynced(s);
  const text = JSON.stringify(data);
  if (text === last) return;
  last = text;
  try {
    const before = await chrome.storage.sync.get(null);
    const stale = staleKeys(before, data);
    if (stale.length) await chrome.storage.sync.remove(stale);
    await chrome.storage.sync.set(data);
  } catch (e) {
    // Over the browser's quota, or sync turned off in the browser: this computer keeps its own.
    console.warn('[grabby] sync', e);
  }
}

async function pull(): Promise<boolean> {
  const all = await chrome.storage.sync.get(null).catch(() => ({}));
  const patch = fromSynced(all);
  if (!patch) return false;
  const s = await getSettings();
  if (!same(patch, s)) {
    last = JSON.stringify(toSynced({ ...s, ...patch }));
    await setSettings(patch);
  }
  return true;
}

/**
 * « Réglages synchronisés »: on, the settings and rules go to the browser's synced storage and
 * come back from the user's other computers. Turned on here while another computer already
 * synced: that one's settings are taken.
 */
export function startSync(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      const now = changes.settings.newValue as Settings | undefined;
      const was = changes.settings.oldValue as Settings | undefined;
      if (!now?.sync) return;
      void (async () => {
        if (!was?.sync && (await pull())) return;
        await push(await getSettings());
      })();
    }
    if (area === 'sync' && Object.keys(changes).some((k) => k.startsWith(SYNC_PREFIX))) {
      void getSettings().then((s) => (s.sync ? pull() : false));
    }
  });
  // Changes made elsewhere while this browser was closed.
  void getSettings().then((s) => (s.sync ? pull() : false));
}
