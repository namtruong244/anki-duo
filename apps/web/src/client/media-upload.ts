import type { Api } from './api';
import type { LocalStore, MediaAsset } from './local-store';

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
export const ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
] as const;
type Mime = (typeof ALLOWED_MIME)[number];

export class MediaRejected extends Error {
  constructor(readonly reason: 'too_large' | 'unsupported') {
    super(reason);
    this.name = 'MediaRejected';
  }
}

export const mediaToken = (m: Pick<MediaAsset, 'id' | 'kind'>, name: string) =>
  m.kind === 'image' ? `![${name.replace(/[[\]]/g, '')}](media:${m.id})` : `[[audio:${m.id}]]`;

/** PUTs the bytes to the presigned URL and reports progress (XHR: fetch has no upload progress). */
export function putWithProgress(url: string, file: File, onProgress: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`));
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(file);
  });
}

/**
 * upload-url → direct PUT to storage → complete (research R5). Limits are checked first so a
 * bad file never costs a request.
 */
export async function uploadMedia(
  deps: {
    api: Api;
    store: LocalStore;
    put?: (url: string, file: File, onProgress: (fraction: number) => void) => Promise<void>;
  },
  input: { cardId: string; side: 'front' | 'back'; file: File },
  onProgress: (fraction: number) => void = () => undefined,
): Promise<{ media: MediaAsset; token: string }> {
  const { file } = input;
  if (!(ALLOWED_MIME as readonly string[]).includes(file.type))
    throw new MediaRejected('unsupported');
  if (file.size > MAX_MEDIA_BYTES || file.size < 1) throw new MediaRejected('too_large');

  const { data: slot } = await deps.api.POST('/media/upload-url', {
    body: { cardId: input.cardId, side: input.side, mime: file.type as Mime, bytes: file.size },
  });
  await (deps.put ?? putWithProgress)(slot!.uploadUrl, file, onProgress);
  const { data: media } = await deps.api.POST('/media/{mediaId}/complete', {
    params: { path: { mediaId: slot!.mediaId } },
  });
  await deps.store.putMedia([media!]);
  return { media: media!, token: mediaToken(media!, file.name) };
}
