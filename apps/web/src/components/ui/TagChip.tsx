import type { ButtonHTMLAttributes } from 'react';

export interface TagChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Tag text; a leading "#" is added when missing. */
  label: string;
  active?: boolean;
  /** Prefix the label with "#" (default true); off for labels like "All". */
  hash?: boolean;
}

/** Small outlined tag chip ("#ielts"); the active variant fills with the nav tint. */
export function TagChip({
  label,
  active = false,
  hash = true,
  className = '',
  type = 'button',
  ...rest
}: TagChipProps) {
  const text = !hash || label.startsWith('#') ? label : `#${label}`;
  return (
    <button
      type={type}
      aria-pressed={rest.onClick ? active : undefined}
      className={`inline-flex min-h-7 cursor-pointer items-center rounded-lg border-2 px-2.5 py-0.5 text-xs font-extrabold text-nav-active-text transition-colors focus-visible:outline-3 focus-visible:outline-focus ${
        active
          ? 'border-nav-active-border bg-nav-active-bg'
          : 'border-border bg-[var(--color-card)] hover:bg-surface'
      } ${className}`}
      {...rest}
    >
      {text}
    </button>
  );
}
