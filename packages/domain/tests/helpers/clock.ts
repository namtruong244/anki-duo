/** A controllable clock for tests. The domain never reads the real time. */
export function fakeClock(startIso = '2026-01-01T00:00:00.000Z') {
  let t = new Date(startIso).getTime();
  return {
    now: () => new Date(t),
    set(iso: string) {
      t = new Date(iso).getTime();
    },
    advance(ms: number) {
      t += ms;
    },
    advanceDays(days: number) {
      t += days * 86_400_000;
    },
  };
}
