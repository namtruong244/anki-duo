/** A tiny toast bus so non-React code (the session machine, sync) can report failures. */
type Listener = (message: string | null) => void;
const listeners = new Set<Listener>();
let current: string | null = null;

export const notify = {
  show(message: string) {
    current = message;
    listeners.forEach((l) => l(message));
  },
  clear() {
    current = null;
    listeners.forEach((l) => l(null));
  },
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  current: () => current,
};
