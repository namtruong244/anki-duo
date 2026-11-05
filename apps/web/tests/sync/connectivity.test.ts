import { describe, expect, it, vi } from 'vitest';
import { createConnectivity } from '../../src/client/connectivity';

describe('connectivity', () => {
  it('follows online/offline events and notifies', () => {
    const target = new EventTarget();
    const c = createConnectivity({ target, initial: true });
    const seen = vi.fn();
    c.subscribe(seen);
    target.dispatchEvent(new Event('offline'));
    expect(c.isOnline()).toBe(false);
    target.dispatchEvent(new Event('online'));
    expect(c.isOnline()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('treats a network failure as offline until a success', () => {
    const c = createConnectivity({ target: new EventTarget(), initial: true });
    c.reportFailure();
    expect(c.isOnline()).toBe(false);
    c.reportSuccess();
    expect(c.isOnline()).toBe(true);
  });
});
