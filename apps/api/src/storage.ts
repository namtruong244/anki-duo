import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from './env.js';

/** Object storage behind media. R2 in production, MinIO locally, an in-memory fake in tests. */
export interface Storage {
  presignPut(
    key: string,
    opts: { mime: string; bytes: number },
    expiresSec: number,
  ): Promise<string>;
  presignGet(key: string, expiresSec: number): Promise<string>;
  head(key: string): Promise<{ bytes: number; mime: string } | null>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

const isMissing = (e: unknown) => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return x.name === 'NotFound' || x.name === 'NoSuchKey' || x.$metadata?.httpStatusCode === 404;
};

/** Returns undefined when no bucket is configured (media routes then answer 503). */
export function createStorage(
  env: Env & { MINIO_ENDPOINT?: string; MINIO_ACCESS_KEY?: string; MINIO_SECRET_KEY?: string },
): Storage | undefined {
  const endpoint = env.R2_ENDPOINT || env.MINIO_ENDPOINT;
  const accessKeyId = env.R2_ACCESS_KEY_ID || env.MINIO_ACCESS_KEY;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY || env.MINIO_SECRET_KEY;
  const bucket = env.R2_BUCKET || 'anki-duo-media';
  if (!endpoint || !accessKeyId || !secretAccessKey) return undefined;
  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    presignPut: (Key, { mime, bytes }, expiresIn) =>
      getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: bucket, Key, ContentType: mime, ContentLength: bytes }),
        { expiresIn },
      ),
    presignGet: (Key, expiresIn) =>
      getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key }), { expiresIn }),
    async head(Key) {
      try {
        const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key }));
        return { bytes: r.ContentLength ?? 0, mime: r.ContentType ?? '' };
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async get(Key) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key }));
        return (await r.Body?.transformToByteArray()) ?? null;
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async delete(Key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    },
  };
}
