import { useEffect, useRef } from 'preact/hooks';
import { AUDIO_FORMATS, FORMAT_NAMES, VIDEO_FORMATS } from '../../shared/formats';
import { buildFilename, NAME_PARTS, namePartsOf, templateOf, type NamePart } from '../../shared/filename';
import type { Settings as S } from '../../shared/settings';
import { t } from '../i18n';
import { Icon } from './Icon';
import { Select } from './Select';

interface Props {
  settings: S;
  /** The browser was seen asking where to save, whatever Grabby's setting says. */
  browserAsks: boolean;
  onChange: (patch: Partial<S>) => void;
  onOpenBrowserSettings: () => void;
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

function Group({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="group">
      <h3 class="group__title">{title}</h3>
      <div class="group__body">{children}</div>
    </section>
  );
}

/** Example the file name preview is built on. */
const SAMPLE = { title: 'Ma vidéo', site: 'exemple.fr', quality: '1080p' };

export function Settings({ settings, browserAsks, onChange, onOpenBrowserSettings, onClose }: Props) {
  const pageRef = useRef<HTMLElement>(null);
  const parts = namePartsOf(settings.template);
  const setPart = (part: NamePart, on: boolean) => onChange({ template: templateOf(NAME_PARTS.filter((p) => (p === part ? on : parts.includes(p)))) });
  const preview = buildFilename(
    settings.template,
    { title: t('set_name_sample') === 'set_name_sample' ? SAMPLE.title : t('set_name_sample'), site: SAMPLE.site, quality: SAMPLE.quality, date: new Date() },
    settings.videoFormat,
    settings.subfolder ? 'Grabby' : undefined,
  );

  useEffect(() => {
    pageRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section ref={pageRef} tabIndex={-1} class="page" aria-labelledby="settings-title">
      <header class="top top--page">
        <button class="icon-btn" aria-label={t('back')} title={t('back')} onClick={onClose}>
          <Icon name="back" />
        </button>
        <h2 id="settings-title" class="page__title">
          {t('openSettings')}
        </h2>
        <span class="top__spacer" />
      </header>

      <div class="page__body">
        <Group title={t('set_group_look')}>
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
        </Group>

        <Group title={t('set_group_formats')}>
          <div class="setting">
            <span class="setting__label">{t('set_video')}</span>
            <span class="setting__control">
              <Select
                label={t('set_video')}
                hideLabel
                value={settings.videoFormat}
                options={VIDEO_FORMATS.map((f) => ({ value: f, label: FORMAT_NAMES[f], detail: t(`fmt_${f}`) }))}
                onChange={(videoFormat) => onChange({ videoFormat })}
              />
            </span>
          </div>
          <div class="setting">
            <span class="setting__label">{t('set_audio')}</span>
            <span class="setting__control">
              <Select
                label={t('set_audio')}
                hideLabel
                value={settings.audioFormat}
                options={AUDIO_FORMATS.map((f) => ({ value: f, label: FORMAT_NAMES[f], detail: t(`fmt_${f}`) }))}
                onChange={(audioFormat) => onChange({ audioFormat })}
              />
            </span>
          </div>
        </Group>

        <Group title={t('set_group_files')}>
          <div class="setting setting--stack">
            <span class="setting__label">{t('set_template')}</span>
            <div class="chips" role="group" aria-label={t('set_template')}>
              {NAME_PARTS.map((p) => {
                const on = p === 'title' || parts.includes(p);
                return (
                  <button
                    key={p}
                    class={`chip${on ? ' chip--on' : ''}`}
                    role="checkbox"
                    aria-checked={on}
                    disabled={p === 'title'}
                    onClick={() => setPart(p, !on)}
                  >
                    {on && <Icon name="check" size={14} />}
                    {t(`set_name_${p}`)}
                  </button>
                );
              })}
            </div>
            <span class="preview" title={preview}>
              {preview}
            </span>
          </div>
          <Toggle label={t('set_subfolder')} hint={t('set_subfolder_hint')} checked={settings.subfolder} onChange={(subfolder) => onChange({ subfolder })} />
          <Toggle label={t('set_saveAs')} hint={t('set_saveAs_hint')} checked={settings.saveAs} onChange={(saveAs) => onChange({ saveAs })} />
          {!settings.saveAs && (
            <div class={`callout${browserAsks ? ' callout--warn' : ''}`} role={browserAsks ? 'alert' : undefined}>
              <Icon name={browserAsks ? 'alert' : 'info'} size={16} />
              <div>
                <p>{t(browserAsks ? 'browserAsksBody' : 'browserAsksNote')}</p>
                <button class="link" onClick={onOpenBrowserSettings}>
                  {t('browserAsksOpen')}
                </button>
              </div>
            </div>
          )}
        </Group>

        <Group title={t('set_group_end')}>
          <Toggle label={t('set_notify')} hint={t('set_notify_hint')} checked={settings.notify} onChange={(notify) => onChange({ notify })} />
        </Group>

        <p class="page__foot">
          <Icon name="shield" size={14} />
          <span>{t('set_privacy')}</span>
          <span class="page__version">v{__VERSION__}</span>
        </p>
      </div>
    </section>
  );
}
