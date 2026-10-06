import { useState } from 'preact/hooks';
import type { AppRequest } from '../../shared/messages';
import type { OutputFormat } from '../../shared/plan';
import { t } from '../i18n';
import { Icon } from './Icon';

type Result = 'idle' | 'busy' | 'ok' | 'already' | 'bad_url' | 'not_found' | 'offline' | 'too_many' | 'failed';

/**
 * "Suivre la chaîne": the channel (or playlist) of this page is checked every hour, and its
 * new videos are recorded on their own, in the quality and format chosen here.
 */
export function Follow({ url, mode, quality, format, label }: { url: string; mode: 'video' | 'audio'; quality: string; format?: OutputFormat; label: string }) {
  const [state, setState] = useState<Result>('idle');
  const go = async () => {
    setState('busy');
    const req: AppRequest = { app: 'watch-add', url, mode, quality, ...(format ? { format } : {}) };
    const res = (await chrome.runtime.sendMessage(req).catch(() => null)) as { id?: string } | string | null;
    setState(typeof res === 'string' ? (res as Result) : res?.id ? 'ok' : 'failed');
  };
  const done = state === 'ok' || state === 'already';
  return (
    <div class="follow">
      <button class={`btn btn--soft btn--small${done ? ' btn--done' : ''}`} disabled={state === 'busy' || done} onClick={() => void go()}>
        <Icon name={done ? 'check' : 'bell'} size={15} />
        {done ? t(state === 'ok' ? 'followDone' : 'followAlready') : label}
      </button>
      {state !== 'idle' && state !== 'busy' && (
        <p class={`hint${done ? '' : ' hint--warn'}`} role="status">
          {t(`follow_${state}`)}
        </p>
      )}
    </div>
  );
}
