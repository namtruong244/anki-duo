import { describe, expect, it, vi } from 'vitest';
import { createSound, type SoundName } from '../src/client/sound';

function fakeAudio() {
  const started: string[] = [];
  let created = 0;
  const factory = () => {
    created++;
    return {
      state: 'suspended' as const,
      destination: {},
      resume: vi.fn(async () => undefined),
      decodeAudioData: vi.fn(async (b: ArrayBuffer) => ({ tag: new TextDecoder().decode(b) })),
      createBufferSource: () => {
        const src = {
          buffer: null as { tag: string } | null,
          connect: vi.fn(),
          start: vi.fn(() => started.push(src.buffer!.tag)),
        };
        return src;
      },
    };
  };
  return { factory, started, created: () => created };
}

const load = async (name: SoundName) => new TextEncoder().encode(name).buffer as ArrayBuffer;

function setup(enabled = true) {
  const audio = fakeAudio();
  const state = { enabled };
  const sound = createSound({
    createContext: audio.factory as never,
    load,
    isEnabled: () => state.enabled,
  });
  return { audio, state, sound };
}

describe('sound (FR-021, FR-024)', () => {
  it('plays nothing before the first user gesture, and never creates an AudioContext', async () => {
    const { audio, sound } = setup();
    await sound.play('graded');
    expect(audio.started).toEqual([]);
    expect(audio.created()).toBe(0);
  });

  it('plays after the gesture', async () => {
    const { audio, sound } = setup();
    await sound.unlock();
    await sound.play('complete');
    expect(audio.started).toEqual(['complete']);
  });

  it('plays nothing when sound is disabled, and starts again when re-enabled', async () => {
    const { audio, state, sound } = setup(false);
    await sound.unlock();
    await sound.play('graded');
    expect(audio.started).toEqual([]);
    state.enabled = true;
    await sound.play('graded');
    expect(audio.started).toEqual(['graded']);
  });

  it('all four grades play the same graded sound', async () => {
    const { audio, sound } = setup();
    await sound.unlock();
    for (const g of [1, 2, 3, 4] as const) await sound.playGrade(g);
    expect(audio.started).toEqual(['graded', 'graded', 'graded', 'graded']);
  });

  it('is silent, not broken, when audio is unavailable', async () => {
    const sound = createSound({
      createContext: () => {
        throw new Error('no audio');
      },
      load,
      isEnabled: () => true,
    });
    await sound.unlock();
    await expect(sound.play('streak')).resolves.toBeUndefined();
  });
});
