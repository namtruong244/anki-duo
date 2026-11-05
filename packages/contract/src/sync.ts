import { createRoute, z } from '@hono/zod-openapi';
import {
  CardSchema,
  DailyActivitySchema,
  DeckSchema,
  MediaSchema,
  SettingsSchema,
  StatsSchema,
  problemResponse,
} from './common.js';

export const PullQuerySchema = z.object({
  cursor: z.string().regex(/^[0-9]+$/),
  limit: z.coerce.number().int().min(1).max(2000).default(1000).optional(),
  deviceId: z.uuid(),
});

export const PullResponseSchema = z.object({
  cursor: z.string(),
  hasMore: z.boolean(),
  settings: z.union([SettingsSchema, z.null()]),
  stats: z.union([StatsSchema, z.null()]),
  decks: z.array(DeckSchema),
  cards: z.array(CardSchema),
  media: z.array(MediaSchema),
  dailyActivity: z.array(DailyActivitySchema),
});

export const pullRoute = createRoute({
  method: 'get',
  path: '/sync/pull',
  summary: 'Fetch every change since a cursor',
  request: { query: PullQuerySchema },
  responses: {
    200: {
      description: 'Changes',
      content: { 'application/json': { schema: PullResponseSchema } },
    },
    400: problemResponse('Error'),
  },
});
