import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { buildFilename, NAME_PARTS, namePartsOf, templateOf, type NamePart } from '../../shared/filename';
import { AUDIO_FORMATS, FORMAT_NAMES, VIDEO_FORMATS } from '../../shared/formats';
import type { Settings as S } from '../../shared/settings';
import { hhmm, parseHhmm, RATE_LIMITS } from '../../shared/schedule';
import { size, t } from '../i18n';
import { Icon, type IconName } from './Icon';
import { Select } from './Select';

interface Props {
  /** Enter/leave animation class, set by the parent. */
  class?: string;
  settings: S;
  /** The browser was seen asking where to save, whatever Grabby's setting says. */
  browserAsks: boolean;
  onChange: (patch: Partial<S>) => void;
  onOpenBrowserSettings: () => void;
  onClose: () => void;
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  const at = Math.max(0, options.findIndex(([v]) => v === value));
  // Which way the pill last moved: it squashes against the side it lands on.
  const prev = useRef(at);
  const dir = useRef('');
  if (prev.current !== at) {
    dir.current = at > prev.current ? 'next' : 'prev';
    prev.current = at;
  }
  return (
    <div class="seg seg--small" role="radiogroup" aria-label={label} style={{ '--n': String(options.length), '--at': String(at) }}>
      <span class="seg__thumb" aria-hidden="true">
        <span key={at} class={`seg__jelly${dir.current ? ` seg__jelly--${dir.current}` : ''}`} />
      </span>
      {options.map(([v, text]) => (
        <button
          key={v}
          role="radio"
          aria-checked={v === value}
          tabIndex={v === value ? 0 : -1}
          class={v === value ? 'on' : ''}
          onClick={() => onChange(v)}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!step) return;
            e.preventDefault();
            const i = (options.findIndex(([o]) => o === v) + step + options.length) % options.length;
            onChange(options[i]![0]);
            ((e.currentTarget as HTMLElement).parentElement?.children[i + 1] as HTMLElement | undefined)?.focus();
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label class="row-setting">
      <span class="row-setting__text">
        <span class="setting__label">{label}</span>
        <span class="setting__hint">{hint}</span>
      </span>
      <input class="switch" type="checkbox" role="switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
    </label>
  );
}

function Group({ title, icon, index, children }: { title: string; icon: IconName; index: number; children: ComponentChildren }) {
  return (
    <section class="group" style={{ '--i': String(index) }}>
      <h3 class="group__title">
        <Icon name={icon} size={14} />
        {title}
      </h3>
      <div class="group__body">{children}</div>
    </section>
  );
}

/** A time of day the user types ("22:00", "7h"); what doesn't read as one goes back as it was. */
function HourField({ label, value, onCommit }: { label: string; value: number; onCommit: (m: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const m = parseHhmm(draft);
    setDraft(null);
    if (m !== null) onCommit(m);
  };
  return (
    <label class="hours__field">
      <span class="hours__label">{label}</span>
      <input
        class="trim__time hours__time"
        inputMode="numeric"
        spellcheck={false}
        value={draft ?? hhmm(value)}
        onFocus={(e) => e.currentTarget.select()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
    </label>
  );
}

/** Only some systems (ChromeOS, Android) tell the browser what kind of connection it has. */
const knowsConnection = () => typeof (navigator as Navigator & { connection?: { type?: string } }).connection?.type === 'string';

/** Example the file name preview is built on. */
const SAMPLE = { site: 'exemple.fr', quality: '1080p' };

/** Four tiles on one line: what the file name is made of. At least one stays ticked. */
function NameTiles({ template, onChange }: { template: string; onChange: (template: string) => void }) {
  const parts = namePartsOf(template);
  // The tile the user tried to untick while it was the last one: it shakes "no".
  const [refused, setRefused] = useState<NamePart | null>(null);
  const toggle = (p: NamePart) => {
    const on = parts.includes(p);
    if (on && parts.length === 1) {
      // Off then on again on the next frame: the shake replays on every try.
      setRefused(null);
      requestAnimationFrame(() => setRefused(p));
      return;
    }
    onChange(templateOf(on ? parts.filter((x) => x !== p) : [...parts, p]));
  };
  return (
    <div class="tiles" role="group" aria-label={t('set_template')}>
      {NAME_PARTS.map((p) => {
        const on = parts.includes(p);
        return (
          <button
            key={p}
            class={`tile${on ? ' tile--on' : ''}${refused === p ? ' tile--no' : ''}`}
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(p)}
            onAnimationEnd={(e) => e.animationName === 'no' && setRefused(null)}
          >
            <span class="tile__label">{t(`set_name_${p}`)}</span>
            <span class="tile__tick" aria-hidden="true">
              <Icon name="check" size={11} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The name a file will get, shown as a small file card (extension badge, folder). */
function FilePreview({ name, ext, folder }: { name: string; ext: string; folder: string }) {
  return (
    <div class="file" title={`${folder}/${name}`}>
      <span class="file__badge">{ext.toUpperCase()}</span>
      <span class="file__text">
        {/* Keyed by the name: a new name slides in. */}
        <span key={name} class="file__name">
          {name}
        </span>
        <span class="file__folder">
          <Icon name="folder" size={12} />
          {folder}
        </span>
      </span>
    </div>
  );
}

function Help({ warn, onOpen }: { warn: boolean; onOpen: () => void }) {
  return (
    <div class={`help${warn ? ' help--warn' : ''}`} role={warn ? 'alert' : undefined}>
      <span class="help__icon">
        <Icon name={warn ? 'alert' : 'info'} size={16} />
      </span>
      <div class="help__text">
        <p class="help__title">{t(warn ? 'browserAsksTitle' : 'browserAsksNoteTitle')}</p>
        <p class="help__body">{t(warn ? 'browserAsksBody' : 'browserAsksNote')}</p>
        <button class="btn btn--soft btn--small" onClick={onOpen}>
          {t('browserAsksOpen')}
          <Icon name="external" size={14} />
        </button>
      </div>
    </div>
  );
}

export function Settings({ class: className, settings, browserAsks, onChange, onOpenBrowserSettings, onClose }: Props) {
  const pageRef = useRef<HTMLElement>(null);
  const title = t('set_name_sample') === 'set_name_sample' ? 'Ma vidéo' : t('set_name_sample');
  const path = buildFilename(settings.template, { title, ...SAMPLE, date: new Date() }, settings.videoFormat, settings.subfolder ? 'Grabby' : undefined);
  const name = path.split('/').pop() ?? path;
  const downloads = t('set_folder_downloads') === 'set_folder_downloads' ? 'Téléchargements' : t('set_folder_downloads');
  const folder = settings.subfolder ? `${downloads}/Grabby` : downloads;

  // Read through a ref: a new onClose never re-runs the effects below.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => pageRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && close.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section ref={pageRef} tabIndex={-1} class={`page${className ? ` ${className}` : ''}`} aria-labelledby="settings-title">
      <header class="top top--page">
        <button class="icon-btn" aria-label={t('back')} title={t('back')} onClick={onClose}>
          <Icon name="back" />
        </button>
        <h2 id="settings-title" class="page__title">
          {t('openSettings')}
        </h2>
        <span />
      </header>

      {/* --n: how many groups, so closing can send them away last-first. */}
      <div class="page__body" style={{ '--n': '6' }}>
        <Group title={t('set_group_look')} icon="sun" index={0}>
          <div class="row-setting">
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

        <Group title={t('set_group_formats')} icon="film" index={1}>
          <div class="row-setting">
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
          <div class="row-setting">
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

        <Group title={t('set_group_files')} icon="folder" index={2}>
          <div class="row-setting row-setting--stack">
            <span class="row-setting__text">
              <span class="setting__label">{t('set_template')}</span>
              <span class="setting__hint">{t('set_template_hint')}</span>
            </span>
            <NameTiles template={settings.template} onChange={(template) => onChange({ template })} />
            <FilePreview name={name} ext={settings.videoFormat} folder={folder} />
          </div>
          <Toggle label={t('set_subfolder')} hint={t('set_subfolder_hint')} checked={settings.subfolder} onChange={(subfolder) => onChange({ subfolder })} />
          <Toggle label={t('set_saveAs')} hint={t('set_saveAs_hint')} checked={settings.saveAs} onChange={(saveAs) => onChange({ saveAs })} />
          {!settings.saveAs && <Help warn={browserAsks} onOpen={onOpenBrowserSettings} />}
        </Group>

        <Group title={t('set_group_end')} icon="check" index={3}>
          <Toggle label={t('set_notify')} hint={t('set_notify_hint')} checked={settings.notify} onChange={(notify) => onChange({ notify })} />
        </Group>

        <Group title={t('set_group_when')} icon="clock" index={4}>
          <Toggle label={t('set_schedule')} hint={t('set_schedule_hint')} checked={settings.scheduleOn} onChange={(scheduleOn) => onChange({ scheduleOn })} />
          {settings.scheduleOn && (
            <div class="hours" role="group" aria-label={t('set_schedule')}>
              <HourField label={t('set_schedule_from')} value={settings.scheduleFrom} onCommit={(scheduleFrom) => onChange({ scheduleFrom })} />
              <HourField label={t('set_schedule_to')} value={settings.scheduleTo} onCommit={(scheduleTo) => onChange({ scheduleTo })} />
            </div>
          )}
          {knowsConnection() && <Toggle label={t('set_wifi')} hint={t('set_wifi_hint')} checked={settings.wifiOnly} onChange={(wifiOnly) => onChange({ wifiOnly })} />}
          <div class="row-setting">
            <span class="row-setting__text">
              <span class="setting__label">{t('set_rate')}</span>
              <span class="setting__hint">{t('set_rate_hint')}</span>
            </span>
            <span class="setting__control">
              <Select
                label={t('set_rate')}
                hideLabel
                value={String(settings.rateLimit)}
                options={RATE_LIMITS.map((r) => ({ value: String(r), label: r ? `${size(r)}/s` : t('set_rate_none') }))}
                onChange={(v) => onChange({ rateLimit: Number(v) })}
              />
            </span>
          </div>
        </Group>

        <Group title={t('set_group_updates')} icon="gift" index={5}>
          <Toggle label={t('set_updates')} hint={t('set_updates_hint')} checked={settings.updateCheck} onChange={(updateCheck) => onChange({ updateCheck })} />
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
