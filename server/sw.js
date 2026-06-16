import crypto from 'node:crypto';
import { listKachelAssets, listPublicAssets } from './content.js';
import { getLayout } from './layout.js';

const STATIC_PRECACHE = [
  '/',
  '/client/styles.css',
  '/client/app.js',
  '/client/manifest.json',
  '/offline',
];

function publicKachelUrls() {
  return getLayout().kacheln
    .filter((kachel) => (kachel.access || 'public') === 'public' && kachel.content)
    .flatMap((kachel) => listKachelAssets(kachel));
}

export function buildServiceWorker() {
  const urls = [...new Set([
    ...STATIC_PRECACHE,
    ...publicKachelUrls(),
    ...listPublicAssets(),
  ])];
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

  // Network-first for navigation. Successful page loads are cached as the
  // device's last online state, including role-visible Kacheln after login.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cacheableNavigation =
        url.pathname === '/' ||
        url.pathname === '/offline' ||
        url.pathname.startsWith('/k/') ||
        url.pathname.startsWith('/content/');

      try {
        const fresh = await fetch(req);
        if (fresh.ok && cacheableNavigation) {
          cache.put(req, fresh.clone()).catch(() => {});
          cache.put(url.pathname, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        return await cache.match(req)
          || await cache.match(url.pathname)
          || await cache.match('/')
          || await cache.match('/offline')
          || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Static / content / Kachel assets: cache-first.
  if (
    url.pathname.startsWith('/content/') ||
    url.pathname.startsWith('/client/') ||
    url.pathname.startsWith('/k/') ||
    url.pathname === '/offline'
  ) {
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
