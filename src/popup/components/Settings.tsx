import { useEffect, useRef, useState } from 'preact/hooks';
import type { Settings as S } from '../../shared/settings';
import { t } from '../i18n';
import { Icon } from './Icon';

interface Props {
  settings: S;
  onChange: (patch: Partial<S>) => void;
  onClose: () => void;
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="seg seg--small" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={v === value} class={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label class="setting setting--toggle">
      <span>
        <span class="setting__label">{label}</span>
        <span class="setting__hint">{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
    </label>
  );
}

export function Settings({ settings, onChange, onClose }: Props) {
  const [template, setTemplate] = useState(settings.template);
  const sheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Focus the dialog itself: keyboard users land inside it without a stray focus ring.
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={sheetRef} tabIndex={-1} class="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="sheet__head">
          <h2 id="settings-title">{t('openSettings')}</h2>
          <button class="icon-btn" aria-label={t('closeSettings')} title={t('closeSettings')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div class="setting">
          <span class="setting__label">{t('set_theme')}</span>
          <Segmented
            label={t('set_theme')}
            value={settings.theme}
            options={[
              ['auto', t('set_theme_auto')],
              ['light', t('set_theme_light')],
              ['dark', t('set_theme_dark')],
            ]}
            onChange={(theme) => onChange({ theme })}
          />
        </div>

        <div class="setting">
          <span class="setting__label">{t('set_audio')}</span>
          <Segmented
            label={t('set_audio')}
            value={settings.audioFormat}
            options={[
              ['m4a', 'M4A'],
              ['mp3', 'MP3'],
            ]}
            onChange={(audioFormat) => onChange({ audioFormat })}
          />
        </div>

        <Toggle label={t('set_saveAs')} hint={t('set_saveAs_hint')} checked={settings.saveAs} onChange={(saveAs) => onChange({ saveAs })} />
        <Toggle label={t('set_subfolder')} hint={t('set_subfolder_hint')} checked={settings.subfolder} onChange={(subfolder) => onChange({ subfolder })} />

        <label class="setting setting--stack">
          <span class="setting__label">{t('set_template')}</span>
          <input
            class="field"
            type="text"
            value={template}
            spellcheck={false}
            onInput={(e) => setTemplate((e.target as HTMLInputElement).value)}
            onBlur={() => onChange({ template: template.trim() || '{title}' })}
          />
          <span class="setting__hint">{t('set_template_hint')}</span>
        </label>

        <p class="sheet__foot">
          <Icon name="shield" size={14} />
          <span>{t('set_privacy')}</span>
          <span class="sheet__version">v{__VERSION__}</span>
        </p>
      </section>
    </div>
  );
}
