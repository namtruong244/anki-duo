import { Resend } from 'resend';
import type { Env } from './env.js';

export interface Mailer {
  sendVerification(to: string, url: string): Promise<void>;
  sendPasswordReset(to: string, url: string): Promise<void>;
}

const FROM = 'Anki Duo <no-reply@anki-duo.app>';

/** Sends through Resend when a key is configured, otherwise prints to the console (local dev). */
export function createMailer(
  env: Pick<Env, 'RESEND_API_KEY'>,
  write: (s: string) => void = console.log,
): Mailer {
  const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
  const send = async (to: string, subject: string, text: string) => {
    if (!resend) {
      write(`[mail] to=${to} subject="${subject}"\n${text}`);
      return;
    }
    const { error } = await resend.emails.send({ from: FROM, to, subject, text });
    if (error) throw new Error(`resend: ${error.message}`);
  };
  return {
    sendVerification: (to, url) =>
      send(to, 'Verify your Anki Duo email', `Confirm your email: ${url}`),
    sendPasswordReset: (to, url) =>
      send(to, 'Reset your Anki Duo password', `Choose a new password: ${url}`),
  };
}
