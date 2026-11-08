import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { getColorScheme, setColorScheme, useColorScheme } from '../src/client/theme';

describe('theme color-scheme controller', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '<meta name="color-scheme" content="light dark" />';
    setColorScheme('system');
  });

  it('defaults to system with meta content "light dark"', () => {
    expect(getColorScheme()).toBe('system');
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
      'light dark',
    );
  });

  it('persists light and dark overrides to <meta> and localStorage, and clears on system', () => {
    const { result } = renderHook(() => useColorScheme());
    expect(result.current[0]).toBe('system');

    act(() => result.current[1]('dark'));
    expect(result.current[0]).toBe('dark');
    expect(localStorage.getItem('color-scheme')).toBe('dark');
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
      'dark',
    );

    act(() => result.current[1]('light'));
    expect(result.current[0]).toBe('light');
    expect(localStorage.getItem('color-scheme')).toBe('light');
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
      'light',
    );

    act(() => result.current[1]('system'));
    expect(result.current[0]).toBe('system');
    expect(localStorage.getItem('color-scheme')).toBeNull();
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
      'light dark',
    );
  });

  it('syncs across tabs on storage event', () => {
    const { result } = renderHook(() => useColorScheme());
    localStorage.setItem('color-scheme', 'dark');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'color-scheme', newValue: 'dark' }));
    });
    expect(result.current[0]).toBe('dark');
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
      'dark',
    );
  });
});
