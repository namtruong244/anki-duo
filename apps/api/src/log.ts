import { createHash } from 'node:crypto';

export interface LogFields {
  requestId: string;
  userIdHash?: string | undefined;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  outcome: 'ok' | 'client_error' | 'server_error';
  error?: string | undefined;
}

/** User ids are hashed so logs never carry a raw identifier. */
export const hashUserId = (id: string) =>
  createHash('sha256').update(id).digest('hex').slice(0, 12);

export const outcomeOf = (status: number): LogFields['outcome'] =>
  status >= 500 ? 'server_error' : status >= 400 ? 'client_error' : 'ok';

/** One JSON line per request, ready for CloudWatch. */
export function logRequest(fields: LogFields, write: (line: string) => void = console.log) {
  write(
    JSON.stringify({
      level: fields.outcome === 'server_error' ? 'error' : 'info',
      msg: 'request',
      ...fields,
    }),
  );
}
