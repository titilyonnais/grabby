import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { reducedMotion } from '../motion';
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
  /**
   * Several choices at once: the ones ticked. Picking one ticks or unticks it (`onChange`
   * gets it) and the list stays open; `summary` is what the button shows.
   */
  values?: T[];
  summary?: string;
}

interface Place {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

let seq = 0;
/** How long the list takes to fold away before it leaves the page (see .menu--out). */
const MENU_OUT_MS = 170;

/**
 * Drop-down list styled like the rest of the popup (a native <select> opens an OS menu
 * that ignores the theme). Keyboard: arrows, Home/End, Enter, Escape, type-ahead free.
 */
export function Select<T extends string>({ label, value, options, onChange, disabled, hideLabel, values, summary }: Props<T>) {
  const multi = values !== undefined;
  const isOn = (v: T) => (multi ? values.includes(v) : v === value);
  const [open, setOpen] = useState(false);
  // Closed but still folding away: drawn, out of reach (no clicks, hidden from assistive tech).
  const [leaving, setLeaving] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useRef(`sel${++seq}`).current;
  // The list scrolls to the active option only when the keyboard moved it: following the
  // mouse would scroll under it, pick the next option, scroll again… down to the end.
  const byKey = useRef(true);
  const current = multi ? { value: summary ?? '', label: summary ?? '' } : (options.find((o) => o.value === value) ?? options[0]);

  const show = () => {
    if (disabled || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    // The list is "fixed", but the popup is drawn on its own layer (.app): that is what it is
    // placed in, which is the window only when both are the same size.
    const box = btn.current.closest('.app')?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const top = Math.max(0, box.top);
    const bottom = Math.min(window.innerHeight, box.bottom);
    const below = bottom - r.bottom - 10;
    const above = r.top - top - 10;
    const groups = new Set(options.map((o) => o.group).filter(Boolean)).size;
    const wanted = Math.min(options.length * 38 + groups * 30 + 12, 340);
    const width = Math.max(r.width, 230);
    const left = Math.max(8, Math.min(r.left - box.left, Math.min(window.innerWidth, box.right) - box.left - width - 8));
    setPlace(
      below >= wanted || below >= above
        ? { left, width, top: r.bottom - box.top + 6, maxHeight: below - 6 }
        : { left, width, bottom: box.bottom - r.top + 6, maxHeight: above - 6 },
    );
    setActive(Math.max(0, options.findIndex((o) => isOn(o.value))));
    byKey.current = true;
    clearTimeout(leave.current);
    setLeaving(false);
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (!reducedMotion()) {
      setLeaving(true);
      clearTimeout(leave.current);
      leave.current = setTimeout(() => setLeaving(false), MENU_OUT_MS);
    }
    if (refocus) btn.current?.focus();
  };
  useEffect(() => () => clearTimeout(leave.current), []);

  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    // Several choices: the list stays open for the next one.
    if (!multi) close();
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
    if (open && byKey.current) list.current?.querySelector(`#${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const move = (i: number) => {
      e.preventDefault();
      byKey.current = true;
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
          {/* Keyed: a new choice slides in. */}
          <span key={current?.value} class="select__value">
            {current?.label}
          </span>
        </span>
        <Icon name="chevron" size={16} />
      </button>
      {(open || leaving) && place && (
        <ul
          ref={list}
          id={`${id}-list`}
          class={`menu${place.bottom !== undefined ? ' menu--up' : ''}${open ? '' : ' menu--out'}`}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multi || undefined}
          aria-hidden={!open}
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
                aria-selected={isOn(o.value)}
                class={`menu__item${i === active ? ' menu__item--active' : ''}`}
                onPointerMove={() => {
                  byKey.current = false;
                  if (i !== active) setActive(i);
                }}
                onClick={() => choose(i)}
              >
                <span class={`menu__check${multi ? ' menu__check--box' : ''}${multi && isOn(o.value) ? ' menu__check--on' : ''}`}>{isOn(o.value) && <Icon name="check" size={15} />}</span>
                <span class="menu__label" title={o.label}>{o.label}</span>
                {o.detail && <span class="menu__detail">{o.detail}</span>}
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </>
  );
}
