import { useEffect, useState } from 'react';

export type MotionSetting = 'system' | 'reduced' | 'full';

/** Resolves the learner's motion setting against `prefers-reduced-motion` (FR-022). */
export function resolveMotion(
  setting: MotionSetting,
  systemPrefersReduced: boolean,
): 'reduced' | 'full' {
  if (setting === 'system') return systemPrefersReduced ? 'reduced' : 'full';
  return setting;
}

export function useMotionPreference(setting: MotionSetting = 'system'): 'reduced' | 'full' {
  const query = '(prefers-reduced-motion: reduce)';
  const read = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  const [system, setSystem] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setSystem(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return resolveMotion(setting, system);
}
