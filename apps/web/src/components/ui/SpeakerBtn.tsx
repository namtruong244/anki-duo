import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';

export interface SpeakerBtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name (required, e.g. t('session.play')). */
  label: string;
  size?: 'md' | 'lg';
}

/** Blue square audio button with a 4px lip (design SpeakerBtn). */
export function SpeakerBtn({
  label,
  size = 'lg',
  className = '',
  type = 'button',
  ...rest
}: SpeakerBtnProps) {
  const box = size === 'lg' ? 'h-16 w-16 rounded-2xl' : 'h-11 w-11 rounded-xl';
  return (
    <button
      type={type}
      aria-label={label}
      className={`inline-flex ${box} cursor-pointer items-center justify-center bg-secondary text-white shadow-[0_4px_0_var(--color-secondary-depth)] transition-transform active:translate-y-[3px] active:shadow-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${className}`}
      {...rest}
    >
      <Icon name="volume" size={size === 'lg' ? 30 : 22} />
    </button>
  );
}
