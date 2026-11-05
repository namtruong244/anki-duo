import type { Mailer } from '../../src/mailer.js';

export interface SentMail {
  kind: 'verify' | 'reset';
  to: string;
  url: string;
}

/** Captures outgoing mail instead of sending it. */
export function captureMailer(): Mailer & {
  sent: SentMail[];
  last(kind: SentMail['kind']): SentMail;
} {
  const sent: SentMail[] = [];
  return {
    sent,
    async sendVerification(to, url) {
      sent.push({ kind: 'verify', to, url });
    },
    async sendPasswordReset(to, url) {
      sent.push({ kind: 'reset', to, url });
    },
    last(kind) {
      const m = [...sent].reverse().find((s) => s.kind === kind);
      if (!m) throw new Error(`no ${kind} mail was sent`);
      return m;
    },
  };
}
