import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DexieStore } from '../src/client/dexie-store';
import {
  MAX_MEDIA_BYTES,
  MediaRejected,
  mediaToken,
  uploadMedia,
} from '../src/client/media-upload';

const file = (name: string, type: string, size: number) => {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const media = {
  id: 'm1',
  cardId: 'c1',
  side: 'front',
  kind: 'image',
  mime: 'image/png',
  bytes: 10,
  sort: 0,
  deletedAt: null,
};

let store: DexieStore;
let api: { POST: ReturnType<typeof vi.fn> };
let put: ReturnType<typeof vi.fn>;
beforeEach(() => {
  store = new DexieStore(`mu-${Math.random()}`);
  api = { POST: vi.fn() };
  put = vi.fn().mockResolvedValue(undefined);
});

describe('uploadMedia', () => {
  it('reserves, uploads straight to storage, confirms, stores the row and returns a token', async () => {
    api.POST.mockResolvedValueOnce({
      data: { mediaId: 'm1', uploadUrl: 'https://r2/put', expiresAt: 'x' },
    }).mockResolvedValueOnce({ data: media });
    const progress = vi.fn();
    const f = file('cat.png', 'image/png', 10);
    const out = await uploadMedia(
      { api: api as never, store, put: put as never },
      { cardId: 'c1', side: 'front', file: f },
      progress,
    );
    expect(api.POST).toHaveBeenNthCalledWith(1, '/media/upload-url', {
      body: { cardId: 'c1', side: 'front', mime: 'image/png', bytes: 10 },
    });
    expect(put).toHaveBeenCalledWith('https://r2/put', f, expect.any(Function));
    expect(api.POST).toHaveBeenNthCalledWith(2, '/media/{mediaId}/complete', {
      params: { path: { mediaId: 'm1' } },
    });
    expect(await store.listMedia('c1')).toHaveLength(1);
    expect(out.token).toBe('![cat.png](media:m1)');
  });

  it('rejects files over 5 MB before any request', async () => {
    await expect(
      uploadMedia(
        { api: api as never, store, put: put as never },
        { cardId: 'c1', side: 'front', file: file('big.png', 'image/png', MAX_MEDIA_BYTES + 1) },
      ),
    ).rejects.toMatchObject({ reason: 'too_large' });
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('rejects unsupported types before any request', async () => {
    await expect(
      uploadMedia(
        { api: api as never, store, put: put as never },
        { cardId: 'c1', side: 'back', file: file('x.pdf', 'application/pdf', 5) },
      ),
    ).rejects.toBeInstanceOf(MediaRejected);
    expect(api.POST).not.toHaveBeenCalled();
  });
});

describe('mediaToken', () => {
  it('uses the image syntax for images and the audio token for audio', () => {
    expect(mediaToken({ id: 'a', kind: 'image' }, 'pic.png')).toBe('![pic.png](media:a)');
    expect(mediaToken({ id: 'b', kind: 'audio' }, 'say.mp3')).toBe('[[audio:b]]');
  });
});
