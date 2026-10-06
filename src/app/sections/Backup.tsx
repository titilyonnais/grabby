import { useState } from 'preact/hooks';
import type { AppRequest } from '../../shared/messages';
import { Icon } from '../../popup/components/Icon';
import { t } from '../../popup/i18n';
import { FilePick } from './Workshop';

/** "Sauvegarder ses réglages": everything in one file, and read back from it. */
export function Backup() {
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const exportAll = async () => {
    const req: AppRequest = { app: 'export' };
    const data = await chrome.runtime.sendMessage(req).catch(() => null);
    if (!data) return setSaid({ ok: false, text: t('backupFailed') });
    const day = new Date();
    const name = `grabby-${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setSaid({ ok: true, text: t('backupSaved', name) });
  };
  const importFile = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return setSaid({ ok: false, text: t('backupNotOurs') });
    }
    const req: AppRequest = { app: 'import', data };
    const res = (await chrome.runtime.sendMessage(req).catch(() => null)) as { settings: number; rules: number; history: number; watches: number } | null;
    if (!res) return setSaid({ ok: false, text: t('backupNotOurs') });
    setSaid({ ok: true, text: t('backupRead', [String(res.settings), String(res.rules), String(res.history), String(res.watches)]) });
  };
  return (
    <div class="stack">
      <section class="ap__card">
        <h2 class="ap__h2">{t('backupExport')}</h2>
        <p class="hint">{t('backupExportHint')}</p>
        <button class="btn btn--primary" onClick={() => void exportAll()}>
          <Icon name="download" size={16} />
          {t('backupExportGo')}
        </button>
      </section>
      <section class="ap__card">
        <h2 class="ap__h2">{t('backupImport')}</h2>
        <p class="hint">{t('backupImportHint')}</p>
        <FilePick accept=".json,application/json" onFiles={(f) => void importFile(f[0]!)} label={t('backupImportGo')} />
      </section>
      {said && (
        <p class={`hint${said.ok ? '' : ' hint--warn'}`} role="status">
          {said.text}
        </p>
      )}
    </div>
  );
}
