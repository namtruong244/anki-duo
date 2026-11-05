import type { Api } from '../api';
import type { LocalStore, OutboxEvent } from '../local-store';

export const PUSH_BATCH = 500;

/**
 * Sends the outbox in batches of at most 500, oldest first. Events the server applied or already
 * had are removed; rejected events are removed too (retrying can never succeed) and reported.
 * A failed request throws and leaves the outbox untouched.
 */
export async function pushOutbox(store: LocalStore, api: Pick<Api, 'POST'>): Promise<void> {
  const deviceId = (await store.getMeta('deviceId')) ?? '';
  for (;;) {
    const events = await store.listOutbox(PUSH_BATCH);
    if (events.length === 0) return;

    const { data } = await api.POST('/sync/push', { body: { deviceId, events: events as never } });
    const results = data?.results ?? [];
    const done = new Set<string>();
    for (const r of results) {
      if (r.status === 'rejected') {
        const event = events.find((e: OutboxEvent) => e.id === r.id);
        await reportRejected(api, r.id, r.code, event?.type);
      }
      done.add(r.id);
    }
    if (done.size === 0) throw new Error('push acknowledged no events');
    await store.removeOutbox([...done]);
  }
}

async function reportRejected(
  api: Pick<Api, 'POST'>,
  eventId: string,
  code: string | undefined,
  type: string | undefined,
) {
  try {
    await api.POST('/client-events', {
      body: {
        kind: 'sync_failure',
        message: `event rejected: ${code ?? 'unknown'}`,
        context: { eventId, code, type },
      },
    });
  } catch {
    // Reporting is best effort; the event is dropped either way.
  }
}
