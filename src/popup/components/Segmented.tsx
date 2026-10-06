import { useRef } from 'preact/hooks';

/** One choice among a few, as a row of buttons with a pill that slides to the chosen one. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
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
