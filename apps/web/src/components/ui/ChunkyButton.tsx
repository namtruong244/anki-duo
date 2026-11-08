import { useState, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'gold' | 'neutral' | 'outline';
/** Design names map: green=primary, blue=secondary, red=danger, gold=gold, outline=outline, disabled=use the `disabled` prop. */

const styles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-on-primary shadow-[0_var(--button-depth)_0_var(--color-primary-depth)] hover:brightness-[1.03]',
  secondary:
    'bg-secondary text-on-secondary shadow-[0_var(--button-depth)_0_var(--color-secondary-depth)] hover:brightness-[1.03]',
  danger:
    'bg-danger text-on-danger shadow-[0_var(--button-depth)_0_var(--color-danger-depth)] hover:brightness-[1.03]',
  gold: 'bg-gold text-on-gold shadow-[0_var(--button-depth)_0_var(--color-gold-depth)] hover:brightness-[1.03]',
  neutral:
    'bg-neutral text-on-neutral shadow-[0_var(--button-depth)_0_var(--color-neutral-depth)] hover:brightness-[0.98]',
  outline:
    'border-2 border-border bg-[var(--color-card)] text-nav-active-text shadow-[0_4px_0_var(--color-border)] hover:bg-surface',
};

export interface ChunkyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: 'min-h-11 px-3.5 py-1.5 text-xs',
  md: 'min-h-11 px-5 py-2.5 text-sm',
  lg: 'min-h-13 px-6 py-3 text-[15px]',
};

/** A chunky 3D Duolingo-style pressable button: depth lip collapses on press. Min 44px touch target. */
export function ChunkyButton({
  variant = 'primary',
  size = 'md',
  className = '',
  disabled,
  type = 'button',
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  ...rest
}: ChunkyButtonProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type={type}
      disabled={disabled}
      data-pressed={pressed}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-button)] font-extrabold uppercase tracking-[0.06em] transition-transform duration-[var(--duration-fast)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:border-transparent disabled:bg-neutral disabled:text-text-subtle disabled:shadow-none data-[pressed=true]:translate-y-[var(--button-press-offset)] data-[pressed=true]:shadow-none ${sizes[size]} ${styles[variant]} ${className}`}
      onPointerDown={(e) => {
        if (!disabled) setPressed(true);
        onPointerDown?.(e);
      }}
      onPointerUp={(e) => {
        setPressed(false);
        onPointerUp?.(e);
      }}
      onPointerLeave={(e) => {
        setPressed(false);
        onPointerLeave?.(e);
      }}
      {...rest}
    />
  );
}
