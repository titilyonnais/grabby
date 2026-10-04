import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Secondary text on the right (size, short description). */
  detail?: string;
  /** Options sharing a group are listed under its heading. */
  group?: string;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  /** The label is already written next to the list (settings). */
  hideLabel?: boolean;
}

interface Place {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

let seq = 0;

/**
 * Drop-down list styled like the rest of the popup (a native <select> opens an OS menu
 * that ignores the theme). Keyboard: arrows, Home/End, Enter, Escape, type-ahead free.
 */
export function Select<T extends string>({ label, value, options, onChange, disabled, hideLabel }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useRef(`sel${++seq}`).current;
  const current = options.find((o) => o.value === value) ?? options[0];

  const show = () => {
    if (disabled || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const below = vh - r.bottom - 10;
    const above = r.top - 10;
    const groups = new Set(options.map((o) => o.group).filter(Boolean)).size;
    const wanted = Math.min(options.length * 38 + groups * 30 + 12, 340);
    const width = Math.max(r.width, 230);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPlace(
      below >= wanted || below >= above
        ? { left, width, top: r.bottom + 6, maxHeight: below - 6 }
        : { left, width, bottom: vh - r.top + 6, maxHeight: above - 6 },
    );
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };

  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    close();
  };

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    // The list is placed once: scrolling what's behind it closes it.
    const scroll = (e: Event) => !list.current?.contains(e.target as Node) && close(false);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('blur', away);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('blur', away);
    };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector(`#${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const move = (i: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(last, i)));
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(active + 1);
      case 'ArrowUp':
        return move(active - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(last);
      case 'Enter':
      case ' ':
        e.preventDefault();
        return choose(active);
      case 'Escape':
        // Only the list closes, not the settings page behind it.
        e.preventDefault();
        e.stopPropagation();
        return close();
      case 'Tab':
        return close(false);
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        class="select"
        aria-haspopup="listbox"
        aria-label={hideLabel ? `${label} : ${current?.label ?? ''}` : undefined}
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show();
          }
        }}
      >
        <span class="select__text">
          {!hideLabel && <span class="select__label">{label}</span>}
          <span class="select__value">{current?.label}</span>
        </span>
        <Icon name="chevron" size={16} />
      </button>
      {open && place && (
        <ul
          ref={list}
          id={`${id}-list`}
          class="menu"
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-${active}`}
          style={{
            left: `${place.left}px`,
            width: `${place.width}px`,
            maxHeight: `${place.maxHeight}px`,
            ...(place.top !== undefined ? { top: `${place.top}px` } : { bottom: `${place.bottom}px` }),
          }}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <Fragment key={o.value}>
              {o.group && o.group !== options[i - 1]?.group && (
                <li class="menu__group" role="presentation">
                  {o.group}
                </li>
              )}
              <li
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.value === value}
                class={`menu__item${i === active ? ' menu__item--active' : ''}`}
                onPointerMove={() => i !== active && setActive(i)}
                onClick={() => choose(i)}
              >
                <span class="menu__check">{o.value === value && <Icon name="check" size={15} />}</span>
                <span class="menu__label">{o.label}</span>
                {o.detail && <span class="menu__detail">{o.detail}</span>}
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </>
  );
}
