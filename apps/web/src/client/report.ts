import { api } from './api';

type Kind = 'error' | 'sync_failure';
interface Body {
  kind: Kind;
  message: string;
  context?: Record<string, unknown>;
}

const MAX_MESSAGE = 2000;

/**
 * Sends uncaught errors and sync failures to `/client-events`. The same problem is sent once, and
 * at most `limit` reports go out per `windowMs`, so a failing loop cannot flood the API. Reporting
 * never throws.
 */
export function createReporter(deps: {
  post: (body: Body) => Promise<unknown>;
  now: () => number;
  limit?: number;
  windowMs?: number;
}) {
  const limit = deps.limit ?? 5;
  const windowMs = deps.windowMs ?? 60_000;
  const seen = new Set<string>();
  let sent: number[] = [];

  async function report(kind: Kind, message: string, context?: Record<string, unknown>) {
    const text = message.slice(0, MAX_MESSAGE);
    const key = `${kind}:${text}`;
    if (seen.has(key)) return;
    const now = deps.now();
    sent = sent.filter((t) => now - t < windowMs);
    if (sent.length >= limit) return;
    seen.add(key);
    sent.push(now);
    try {
      await deps.post({ kind, message: text, ...(context ? { context } : {}) });
    } catch {
      // Offline or the API is down: the report is lost, which is fine.
    }
  }

  const reportError = (e: unknown, context?: Record<string, unknown>) =>
    report(
      'error',
      e instanceof Error
        ? `${e.name}: ${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}`
        : String(e),
      context,
    );

  return { report, reportError };
}

export const reporter = createReporter({
  post: (body) => api.POST('/client-events', { body }),
  now: () => Date.now(),
});

/** Uncaught errors and unhandled promise rejections. Call once at start-up. */
export function installGlobalErrorReporting(target: Window = window) {
  const route = () => ({ route: target.location.pathname });
  target.addEventListener('error', (e) => void reporter.reportError(e.error ?? e.message, route()));
  target.addEventListener(
    'unhandledrejection',
    (e) => void reporter.reportError(e.reason, route()),
  );
}
