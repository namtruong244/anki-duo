import type { ReactNode } from 'react';

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 bg-bg p-4 text-text">
      <h1 className="text-3xl font-bold">{title}</h1>
      {children}
    </main>
  );
}

export function Field({
  label,
  ...input
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 font-semibold">
      {label}
      <input
        {...input}
        className="min-h-11 rounded-[var(--radius-button)] border-2 border-border bg-bg px-3 font-normal"
      />
    </label>
  );
}
