import type { InstallState, PopupToBg } from '../../shared/messages';
import type { Release } from '../../shared/release';
import { t } from '../i18n';
import { Icon } from './Icon';

/** The helper's codes Grabby explains; anything else is "the helper ran into an error". */
const KNOWN = new Set(['offline', 'bad_digest', 'no_digest', 'bad_package', 'not_grabby', 'bad_source', 'no_release', 'permission']);

/**
 * "Update": talking to the update helper needs the browser's permission, asked for on the
 * first click (it has to be asked during the click itself).
 */
export function startInstall(send: (m: PopupToBg) => void): void {
  void chrome.permissions
    .request({ permissions: ['nativeMessaging'] })
    .catch(() => false)
    .then((granted) => (granted ? send({ type: 'update-install' }) : undefined));
}

/** Where installing got to, in a sentence. */
export function InstallStatus({ install }: { install?: InstallState }) {
  if (!install) return null;
  const text =
    install.step === 'working'
      ? t('inst_working')
      : install.step === 'done'
        ? t('inst_done', install.version ?? '')
        : install.step === 'uptodate'
          ? t('inst_uptodate')
          : install.step === 'busy'
            ? t('inst_busy')
            : install.step === 'helper_missing'
              ? t('inst_helper_missing')
              : t('inst_failed', t(`inst_err_${install.error && KNOWN.has(install.error) ? install.error : 'failed'}`));
  const bad = install.step === 'failed' || install.step === 'helper_missing' || install.step === 'busy';
  return (
    <p class={`install${bad ? ' install--bad' : ''}`} role="status">
      <Icon name={install.step === 'working' ? 'clock' : bad ? 'alert' : 'check'} size={15} />
      <span>{text}</span>
    </p>
  );
}

/** The "Update" button, with what happened under it. */
export function InstallButton({ install, send, primary }: { install?: InstallState; send: (m: PopupToBg) => void; primary?: boolean }) {
  const working = install?.step === 'working' || install?.step === 'done';
  return (
    <>
      <button class={`btn ${primary ? 'btn--primary' : 'btn--soft'} btn--small`} disabled={working} onClick={() => startInstall(send)}>
        <Icon name="download" size={15} />
        {t('updateNow')}
      </button>
      <InstallStatus install={install} />
    </>
  );
}

/** "Grabby x.y is out": update in a click, or see its page; closed until the next version. */
export function UpdateNotice({ release, install, send }: { release: Release; install?: InstallState; send: (m: PopupToBg) => void }) {
  return (
    <div class="help update" role="status">
      <span class="help__icon">
        <Icon name="gift" size={16} />
      </span>
      <div class="help__text">
        <p class="help__title">{t('updateTitle', release.version)}</p>
        <p class="help__body">{t('updateBody')}</p>
        <span class="update__actions">
          <InstallButton install={install} send={send} primary />
          <a class="link-btn" href={release.url} target="_blank" rel="noreferrer noopener">
            {t('updateOpen')}
          </a>
          <button class="link-btn" onClick={() => send({ type: 'update-seen', version: release.version })}>
            {t('dismiss')}
          </button>
        </span>
      </div>
    </div>
  );
}
