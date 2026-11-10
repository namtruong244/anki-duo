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
  pressed?: boolean;
}

const sizes = {
  sm: 'min-h-9 px-3 py-1 text-xs',
  md: 'min-h-10 px-4 py-2 text-[13px]',
  lg: 'min-h-11 px-5 py-2.5 text-sm',
};

/** A chunky 3D Duolingo-style pressable button: depth lip collapses on press. Compact sizes: 36 / 40 / 44px tall. */
export function ChunkyButton({
  variant = 'primary',
  size = 'md',
  pressed: pressedProp,
  className = '',
  disabled,
  type = 'button',
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  onBlur,
  onKeyDown,
  onKeyUp,
  ...rest
}: ChunkyButtonProps) {
  const [internalPressed, setInternalPressed] = useState(false);
  const isPressed =
    !disabled && (pressedProp !== undefined ? pressedProp || internalPressed : internalPressed);

  return (
    <button
      type={type}
      disabled={disabled}
      data-pressed={isPressed}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-button)] font-extrabold uppercase tracking-[0.04em] transition-[transform,box-shadow,filter] duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-neutral disabled:text-text-subtle disabled:shadow-none enabled:active:translate-y-[var(--button-press-offset)] enabled:active:shadow-none data-[pressed=true]:translate-y-[var(--button-press-offset)] data-[pressed=true]:shadow-none ${sizes[size]} ${styles[variant]} ${className}`}
      onPointerDown={(e) => {
        if (!disabled) setInternalPressed(true);
        onPointerDown?.(e);
      }}
      onPointerUp={(e) => {
        setInternalPressed(false);
        onPointerUp?.(e);
      }}
      onPointerLeave={(e) => {
        setInternalPressed(false);
        onPointerLeave?.(e);
      }}
      onPointerCancel={(e) => {
        setInternalPressed(false);
        onPointerCancel?.(e);
      }}
      onBlur={(e) => {
        setInternalPressed(false);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === ' ' || e.key === 'Enter')) {
          setInternalPressed(true);
        }
        onKeyDown?.(e);
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          setInternalPressed(false);
        }
        onKeyUp?.(e);
      }}
      {...rest}
    />
  );
}
