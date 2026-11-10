import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { useMotionPreference } from '../../lib/motion';
import { Icon } from './Icon';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  id?: string;
  'aria-label'?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  size?: 'sm' | 'md';
  variant?: 'default' | 'tint';
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Custom Duolingo-style select dropdown with 3D lip, animated menu, keyboard navigation,
 * and a synced sr-only native `<select>` for form/test semantics.
 */
export function Select({
  id,
  'aria-label': ariaLabel,
  value,
  onChange,
  options,
  disabled = false,
  size = 'md',
  variant = 'default',
  align = 'left',
  className = '',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const reduced = useMotionPreference() === 'reduced';

  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    const idx = options.findIndex((o) => o.value === value);
    if (idx >= 0) setActiveIndex(idx);
  }, [value, options]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (val: string) => {
    onChange(val);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        setActiveIndex((i) => (i + 1) % options.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) {
        const opt = options[activeIndex];
        if (opt) choose(opt.value);
      } else {
        setOpen(true);
      }
    } else if (e.key === 'Tab' && open) {
      setOpen(false);
    }
  };

  const sizeClass =
    size === 'sm'
      ? 'min-h-10 rounded-xl px-3 py-1.5 text-xs gap-2'
      : 'min-h-12 w-full rounded-2xl px-4 py-2.5 text-sm gap-3';

  const variantClass =
    variant === 'tint'
      ? 'border-nav-active-border bg-nav-active-bg text-nav-active-text shadow-[0_3px_0_var(--color-nav-active-border)] hover:brightness-[0.99]'
      : open
        ? 'border-secondary bg-[var(--color-card)] text-text shadow-[0_3px_0_var(--color-secondary-depth)]'
        : 'border-border bg-surface text-text shadow-[0_3px_0_var(--color-border)] hover:border-border-strong hover:bg-[var(--color-card)]';

  return (
    <div
      ref={rootRef}
      className={`relative inline-flex ${size === 'md' ? 'w-full' : ''} ${className}`}
    >
      <select
        id={id}
        aria-label={ariaLabel}
        aria-hidden={open ? 'true' : undefined}
        value={value}
        disabled={disabled}
        tabIndex={-1}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => triggerRef.current?.focus()}
        className="sr-only pointer-events-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`inline-flex w-full cursor-pointer items-center justify-between border-2 font-extrabold transition-[transform,box-shadow,background-color,border-color] duration-[var(--duration-fast)] enabled:active:translate-y-[2px] enabled:active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none ${sizeClass} ${variantClass}`}
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <Icon
          name="chevron-down"
          size={size === 'sm' ? 16 : 18}
          className={`shrink-0 transition-transform duration-200 ${
            variant === 'tint' ? 'text-nav-active-text' : 'text-text-muted'
          } ${open ? 'rotate-180 text-secondary' : ''}`}
        />
      </button>

      {open && !disabled && (
        <motion.div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel ?? selected?.label ?? 'Options'}
          initial={reduced ? false : { scale: 0.96, y: -4 }}
          animate={{ scale: 1, y: 0 }}
          transition={reduced ? { duration: 0.01 } : { duration: 0.14, ease: 'easeOut' }}
          className={`absolute top-[calc(100%+6px)] z-40 max-h-64 min-w-full overflow-y-auto rounded-2xl border-2 border-border bg-[var(--color-card)] p-1.5 shadow-[0_6px_0_var(--color-border),0_12px_24px_rgba(0,0,0,0.14)] ${
            align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'
          }`}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isHighlighted = idx === activeIndex;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => choose(opt.value)}
                className={`flex min-h-10 w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-left font-extrabold transition-[transform,background-color,color] duration-[var(--duration-fast)] active:scale-[0.98] ${
                  size === 'sm' ? 'text-xs' : 'text-sm'
                } ${
                  isSelected
                    ? 'bg-nav-active-bg text-nav-active-text'
                    : isHighlighted
                      ? 'bg-surface text-text'
                      : 'text-text hover:bg-surface'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && (
                  <Icon name="check" size={16} className="shrink-0 text-nav-active-text" />
                )}
              </button>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}
