import type { PopupToBg } from '../../shared/messages';
import type { Release } from '../../shared/release';
import { t } from '../i18n';
import { Icon } from './Icon';

/** "Grabby x.y is out": its page to download it; closed until the next version. */
export function UpdateNotice({ release, send }: { release: Release; send: (m: PopupToBg) => void }) {
  return (
    <div class="help update" role="status">
      <span class="help__icon">
        <Icon name="gift" size={16} />
      </span>
      <div class="help__text">
        <p class="help__title">{t('updateTitle', release.version)}</p>
        <p class="help__body">{t('updateBody')}</p>
        <span class="update__actions">
          <a class="btn btn--primary btn--small" href={release.url} target="_blank" rel="noreferrer noopener">
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
