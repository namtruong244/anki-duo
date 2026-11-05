/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA navigations fall back to the precached shell, but never for /api.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }),
);

// Media (T114): cache-first, so images and audio of today's cards work offline. This route is
// registered before the generic API one so it wins for /api/v1/media/*. Bytes are stored by the
// PREFETCH_MEDIA message and the first online view; the index below records size and age.
const MEDIA_CACHE = 'media-v1';
const INDEX_URL = '/__media-index';
const mediaUrl = (id: string) => `/api/v1/media/${id}`;
type MediaIndex = Record<string, { bytes: number; cachedAt: number }>;

async function readIndex(cache: Cache): Promise<MediaIndex> {
  const res = await cache.match(INDEX_URL);
  return res ? ((await res.json()) as MediaIndex) : {};
}
async function writeIndex(cache: Cache, index: MediaIndex) {
  await cache.put(
    INDEX_URL,
    new Response(JSON.stringify(index), { headers: { 'content-type': 'application/json' } }),
  );
}
async function storeMedia(cache: Cache, id: string, response: Response) {
  if (!response.ok) return;
  const bytes = (await response.clone().blob()).size;
  await cache.put(mediaUrl(id), response);
  const index = await readIndex(cache);
  index[id] = { bytes, cachedAt: Date.now() };
  await writeIndex(cache, index);
}

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' && /^\/api\/v1\/media\/[0-9a-f-]{36}$/i.test(url.pathname),
  async ({ request, url }) => {
    const cache = await caches.open(MEDIA_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    void storeMedia(cache, url.pathname.split('/').pop()!, response.clone());
    return response;
  },
);

// API GETs: network first, so data is fresh online and still readable offline.
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/v1/'),
  new NetworkFirst({ cacheName: 'api-get-v1', networkTimeoutSeconds: 5 }),
);

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string; ids?: string[] } | undefined;
  if (data?.type === 'SKIP_WAITING') void self.skipWaiting();
  if (data?.type === 'MEDIA_INDEX') {
    event.waitUntil(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const index = await readIndex(cache);
        event.ports[0]?.postMessage(Object.entries(index).map(([id, v]) => ({ id, ...v })));
      }),
    );
  }
  if (data?.type === 'PREFETCH_MEDIA' && data.ids) {
    event.waitUntil(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        for (const id of data.ids!) {
          try {
            await storeMedia(cache, id, await fetch(mediaUrl(id)));
          } catch {
            // Offline or a transient error: it is retried after the next pull.
          }
        }
      }),
    );
  }
  if (data?.type === 'EVICT_MEDIA' && data.ids) {
    event.waitUntil(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const index = await readIndex(cache);
        for (const id of data.ids!) {
          await cache.delete(mediaUrl(id));
          delete index[id];
        }
        await writeIndex(cache, index);
      }),
    );
  }
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
