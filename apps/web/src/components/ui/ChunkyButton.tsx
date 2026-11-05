import { useState, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'neutral';

const styles: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary shadow-[0_var(--button-depth)_0_var(--color-primary-depth)]',
  secondary:
    'bg-secondary text-on-secondary shadow-[0_var(--button-depth)_0_var(--color-secondary-depth)]',
  danger: 'bg-danger text-on-danger shadow-[0_var(--button-depth)_0_var(--color-danger-depth)]',
  neutral: 'bg-neutral text-on-neutral shadow-[0_var(--button-depth)_0_var(--color-neutral-depth)]',
};

export interface ChunkyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** A chunky, pressable button: depth shadow that collapses on press. Min 44px touch target. */
export function ChunkyButton({
  variant = 'primary',
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
      className={`min-h-11 rounded-[var(--radius-button)] px-5 py-2 font-bold uppercase tracking-wide transition-transform duration-[var(--duration-fast)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 data-[pressed=true]:translate-y-[var(--button-press-offset)] data-[pressed=true]:shadow-none ${styles[variant]} ${className}`}
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
