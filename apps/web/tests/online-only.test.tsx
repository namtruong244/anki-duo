import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createConnectivity } from '../src/client/connectivity';
import { useOnlineOnly } from '../src/client/online-only';

describe('useOnlineOnly (FR-017)', () => {
  it('enables actions online and disables them, with a message, offline', () => {
    const target = new EventTarget();
    const connectivity = createConnectivity({ target, initial: true });
    const { result } = renderHook(() => useOnlineOnly(connectivity));
    expect(result.current.online).toBe(true);
    expect(result.current.buttonProps.disabled).toBe(false);
    expect(result.current.message).toBeNull();

    act(() => void target.dispatchEvent(new Event('offline')));
    expect(result.current.online).toBe(false);
    expect(result.current.buttonProps.disabled).toBe(true);
    expect(result.current.message).toBe('offline.needsConnection');

    act(() => void target.dispatchEvent(new Event('online')));
    expect(result.current.buttonProps.disabled).toBe(false);
  });

  it('guard runs the action online and skips it offline', () => {
    const target = new EventTarget();
    const connectivity = createConnectivity({ target, initial: true });
    const { result } = renderHook(() => useOnlineOnly(connectivity));
    let calls = 0;
    result.current.guard(() => calls++)();
    act(() => void target.dispatchEvent(new Event('offline')));
    result.current.guard(() => calls++)();
    expect(calls).toBe(1);
  });
});
