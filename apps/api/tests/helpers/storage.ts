import type { Storage } from '../../src/storage.js';

/** In-memory object store standing in for R2/MinIO. `upload` plays the browser's direct PUT. */
export function fakeStorage() {
  const objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  const storage: Storage = {
    async presignPut(key, _o, expiresSec) {
      return `https://storage.test/put/${key}?exp=${expiresSec}`;
    },
    async presignGet(key, expiresSec) {
      return `https://storage.test/get/${key}?exp=${expiresSec}`;
    },
    async head(key) {
      const o = objects.get(key);
      return o ? { bytes: o.bytes.length, mime: o.mime } : null;
    },
    async get(key) {
      return objects.get(key)?.bytes ?? null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return {
    storage,
    objects,
    upload(key: string, bytes: Uint8Array, mime: string) {
      objects.set(key, { bytes, mime });
    },
  };
}
