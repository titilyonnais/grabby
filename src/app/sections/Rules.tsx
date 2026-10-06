import { useEffect, useRef, useState } from 'preact/hooks';
import { AUDIO_FORMATS, FORMAT_NAMES, VIDEO_FORMATS } from '../../shared/formats';
import type { OutputFormat } from '../../shared/plan';
import { newRule, RULE_QUALITIES, siteOf, type Rule, type RuleQuality } from '../../shared/rules';
import { Icon } from '../../popup/components/Icon';
import { Segmented } from '../../popup/components/Segmented';
import { Select } from '../../popup/components/Select';
import { t } from '../../popup/i18n';

/** A text field saved when the user leaves it (or presses Enter). */
function Field({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <label class="field">
      <span class="field__label">{label}</span>
      <input
        class="field__input"
        value={text}
        placeholder={placeholder}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={() => text !== value && onCommit(text)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

/** "Règles automatiques": what each site downloads without being asked. */
export function Rules({ rules, onChange }: { rules: Rule[]; onChange: (r: Rule[]) => void }) {
  // Changes build on the last one made, not on the list last saved: a change made before the
  // previous one came back (a site typed, then "Sound" clicked) would undo it.
  const latest = useRef(rules);
  useEffect(() => {
    latest.current = rules;
  }, [rules]);
  const commit = (next: Rule[]) => {
    latest.current = next;
    onChange(next);
  };
  const set = (id: string, patch: Partial<Rule>) => commit(latest.current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const qualityLabel = (q: RuleQuality) => (q === 'best' ? t('ruleBest') : q === 'smallest' ? t('ruleSmallest') : `${q}p`);
  return (
    <div class="stack">
      {rules.map((r) => (
        <section key={r.id} class="ap__card rule">
          <header class="ap__cardhead">
            <h2 class="ap__h2">{r.site || t('ruleEverySite')}</h2>
            <button class="hcard__btn" title={t('ruleRemove')} aria-label={t('ruleRemove')} onClick={() => commit(latest.current.filter((x) => x.id !== r.id))}>
              <Icon name="trash" size={15} />
            </button>
          </header>
          <div class="rule__grid">
            <Field key={`${r.id}-site`} label={t('ruleSite')} value={r.site} placeholder={t('ruleSiteHint')} onCommit={(v) => set(r.id, { site: siteOf(v) })} />
            <div class="field">
              <span class="field__label">{t('ruleMode')}</span>
              <Segmented
                label={t('ruleMode')}
                value={r.mode}
                options={[
                  ['video', t('batchModeVideo')],
                  ['audio', t('batchModeAudio')],
                ]}
                onChange={(mode) => set(r.id, { mode, format: undefined })}
              />
            </div>
            <Select
              label={t('formatLabel')}
              value={r.format ?? ''}
              options={[
                { value: '', label: t('ruleFormatSettings') },
                ...(r.mode === 'audio' ? AUDIO_FORMATS : VIDEO_FORMATS).map((f) => ({ value: f as string, label: FORMAT_NAMES[f] })),
              ]}
              onChange={(v) => set(r.id, { format: (v || undefined) as OutputFormat | undefined })}
            />
            {r.mode === 'video' && (
              <Select label={t('qualityLabel')} value={r.quality} options={RULE_QUALITIES.map((q) => ({ value: q, label: qualityLabel(q) }))} onChange={(quality) => set(r.id, { quality })} />
            )}
            {r.mode === 'video' && (
              <Field
                key={`${r.id}-subs`}
                label={t('ruleSubs')}
                value={r.subs.join(', ')}
                placeholder="fr, en"
                onCommit={(v) => set(r.id, { subs: v.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(s)).slice(0, 8) })}
              />
            )}
            <Field key={`${r.id}-folder`} label={t('ruleFolder')} value={r.folder} placeholder={t('ruleFolderHint')} onCommit={(v) => set(r.id, { folder: v.trim().slice(0, 120) })} />
          </div>
        </section>
      ))}
      {!rules.length && <p class="empty">{t('rulesEmpty')}</p>}
      <button class="btn btn--primary" onClick={() => commit([...latest.current, newRule()])}>
        <Icon name="plus" size={16} />
        {t('ruleAdd')}
      </button>
    </div>
  );
}
