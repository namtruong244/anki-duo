export type SoundName = 'graded' | 'complete' | 'streak';

interface AudioLike {
  destination: unknown;
  resume?: () => Promise<unknown>;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  createBufferSource(): { buffer: unknown; connect(d: unknown): void; start(): void };
}

export interface SoundDeps {
  createContext: () => AudioLike;
  load: (name: SoundName) => Promise<ArrayBuffer>;
  isEnabled: () => boolean;
}

/**
 * Web Audio sprites. Nothing is created or played before the first user gesture (browsers block
 * it anyway) and nothing plays while the learner has sound off (FR-021). Failures are silent.
 */
export function createSound(deps: SoundDeps) {
  let ctx: AudioLike | null = null;
  let unlocked = false;
  const buffers = new Map<SoundName, Promise<unknown>>();

  const decode = (name: SoundName) => {
    let p = buffers.get(name);
    if (!p) {
      p = deps.load(name).then((data) => ctx!.decodeAudioData(data));
      buffers.set(name, p);
    }
    return p;
  };

  async function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      ctx = deps.createContext();
      await ctx.resume?.();
      void Promise.all((['graded', 'complete', 'streak'] as const).map(decode)).catch(
        () => undefined,
      );
    } catch {
      ctx = null;
    }
  }

  async function play(name: SoundName) {
    if (!unlocked || !ctx || !deps.isEnabled()) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = await decode(name);
      src.connect(ctx.destination);
      src.start();
    } catch {
      buffers.delete(name);
    }
  }

  return {
    unlock,
    play,
    /** Every grade, Again included, plays the same sound: nothing rewards or punishes (FR-024). */
    playGrade: (grade: 1 | 2 | 3 | 4) => {
      void grade;
      return play('graded');
    },
  };
}

let enabled = true;
export const setSoundEnabled = (on: boolean) => {
  enabled = on;
};

/** The app-wide instance. The first pointer or key press unlocks it. */
export const sound = createSound({
  createContext: () =>
    new (
      window.AudioContext ??
      (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )() as never,
  load: async (name) => (await fetch(`/sounds/${name}.wav`)).arrayBuffer(),
  isEnabled: () => enabled,
});

if (typeof window !== 'undefined') {
  const once = () => {
    void sound.unlock();
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}
