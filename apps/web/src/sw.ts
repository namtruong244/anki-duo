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

// API GETs: network first, so data is fresh online and still readable offline.
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/v1/'),
  new NetworkFirst({ cacheName: 'api-get-v1', networkTimeoutSeconds: 5 }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
