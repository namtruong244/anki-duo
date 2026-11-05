import { createRoute, z } from '@hono/zod-openapi';
import { MediaSchema, problemResponse } from './common.js';

export const MEDIA_MIMES = [
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
export const MAX_MEDIA_BYTES = 5_242_880;
export const MAX_MEDIA_BYTES_PER_LEARNER = 524_288_000;

// `mime` and `bytes` are documented but checked by the handler, so a bad value gets its own
// status (415 / 413) instead of a generic validation error.
export const UploadUrlRequestSchema = z.object({
  cardId: z.uuid(),
  side: z.enum(['front', 'back']),
  mime: z.string().openapi({ enum: [...MEDIA_MIMES] }),
  bytes: z.number().openapi({ type: 'integer', minimum: 1, maximum: MAX_MEDIA_BYTES }),
});

const MediaIdParams = z.object({
  mediaId: z.uuid().openapi({ param: { name: 'mediaId', in: 'path', required: true } }),
});

export const uploadUrlRoute = createRoute({
  method: 'post',
  path: '/media/upload-url',
  summary: 'Reserve a media asset and get a presigned upload URL',
  request: {
    body: { required: true, content: { 'application/json': { schema: UploadUrlRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Upload target',
      content: {
        'application/json': {
          schema: z.object({ mediaId: z.uuid(), uploadUrl: z.url(), expiresAt: z.iso.datetime() }),
        },
      },
    },
    413: problemResponse('Error'),
    415: problemResponse('Error'),
  },
});

export const completeMediaRoute = createRoute({
  method: 'post',
  path: '/media/{mediaId}/complete',
  summary: "Confirm an upload. The server checks the object's size and type, then marks it ready",
  request: { params: MediaIdParams },
  responses: {
    200: { description: 'Ready', content: { 'application/json': { schema: MediaSchema } } },
    422: problemResponse('Error'),
  },
});

export const getMediaRoute = createRoute({
  method: 'get',
  path: '/media/{mediaId}',
  summary: 'Redirect to a short-lived signed URL for the media bytes',
  request: { params: MediaIdParams },
  responses: {
    302: { description: 'Redirect to signed URL' },
    404: problemResponse('Error'),
  },
});

export const deleteMediaRoute = createRoute({
  method: 'delete',
  path: '/media/{mediaId}',
  summary: 'Remove a media asset from its card',
  request: { params: MediaIdParams },
  responses: { 204: { description: 'Deleted' } },
});

export const mediaRoutes = [uploadUrlRoute, completeMediaRoute, getMediaRoute, deleteMediaRoute];
