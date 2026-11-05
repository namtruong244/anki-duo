import { describe, expect, it, vi } from 'vitest';
import { createReporter } from '../src/client/report';

function setup(over: { limit?: number; windowMs?: number } = {}) {
  let t = 0;
  const post = vi.fn(async () => undefined);
  const reporter = createReporter({ post, now: () => t, ...over });
  return { post, reporter, advance: (ms: number) => (t += ms) };
}

describe('client reporter (research R16)', () => {
  it('posts an error with its context', async () => {
    const { post, reporter } = setup();
    await reporter.report('error', 'boom', { route: '/session' });
    expect(post).toHaveBeenCalledWith({
      kind: 'error',
      message: 'boom',
      context: { route: '/session' },
    });
  });

  it('truncates the message to 2000 characters', async () => {
    const { post, reporter } = setup();
    await reporter.report('error', 'x'.repeat(5000));
    expect((post.mock.calls[0] as unknown as [{ message: string }])[0].message).toHaveLength(2000);
  });

  it('sends the same problem only once', async () => {
    const { post, reporter } = setup();
    await reporter.report('sync_failure', 'push failed');
    await reporter.report('sync_failure', 'push failed');
    await reporter.report('error', 'push failed'); // a different kind is a different problem
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('rate-limits: at most N reports per window, then again after it', async () => {
    const { post, reporter, advance } = setup({ limit: 3, windowMs: 60_000 });
    for (let i = 0; i < 10; i++) await reporter.report('error', `distinct ${i}`);
    expect(post).toHaveBeenCalledTimes(3);
    advance(60_001);
    await reporter.report('error', 'after the window');
    expect(post).toHaveBeenCalledTimes(4);
  });

  it('never throws, even when the post fails', async () => {
    const reporter = createReporter({
      post: async () => {
        throw new Error('offline');
      },
      now: () => 0,
    });
    await expect(reporter.report('error', 'x')).resolves.toBeUndefined();
  });

  it('formats an Error with its stack head', async () => {
    const { post, reporter } = setup();
    await reporter.reportError(new TypeError('bad thing'));
    expect((post.mock.calls[0] as unknown as [{ message: string }])[0].message).toContain(
      'TypeError: bad thing',
    );
  });
});
