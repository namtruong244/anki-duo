export interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  className?: string;
}

export function ProgressBar({ value, max, label, className = '' }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`h-4 w-full overflow-hidden rounded-full bg-neutral ${className}`}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-[var(--duration-base)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
