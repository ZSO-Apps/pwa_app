import crypto from 'node:crypto';
import { listPublicAssets } from './content.js';

// Note: '/' is intentionally NOT precached — its HTML depends on auth state.
// Navigation requests use network-first (see fetch handler) with /offline fallback.
const STATIC_PRECACHE = [
  '/client/styles.css',
  '/client/app.js',
  '/client/manifest.json',
  '/offline',
];

export function buildServiceWorker() {
  const urls = [...STATIC_PRECACHE, ...listPublicAssets()];
  const hash = crypto.createHash('sha1').update(urls.join('\n')).digest('hex').slice(0, 10);
  const cacheName = `zso-public-${hash}`;
  return `// Auto-generated. Cache version busts when public content changes.
const CACHE = ${JSON.stringify(cacheName)};
const PRECACHE = ${JSON.stringify(urls)};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Best-effort: don't fail install if a single URL 404s.
    await Promise.all(PRECACHE.map(async (u) => {
      try { await cache.add(new Request(u, { cache: 'reload' })); } catch (e) { /* skip */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('zso-public-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    const ts = Date.now();
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const c of clients) c.postMessage({ type: 'SYNC_DONE', ts, cache: CACHE });
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for navigation (HTML page loads). Falls back to /offline cache.
  // This is what makes login work correctly: the home page must reflect the
  // current session cookie, never a stale cached copy.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(CACHE);
        const offline = await cache.match('/offline');
        return offline || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Static / content assets: cache-first.
  if (url.pathname.startsWith('/content/') || url.pathname.startsWith('/client/') || url.pathname === '/offline') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return new Response('Offline', { status: 503 });
      }
    })());
  }
  // Everything else: pass through to the network (browser default).
});
`;
}
