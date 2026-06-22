import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { listKachelPublicAssets } from './content.js';
import { existingLogoUrls, logoFileForUrl } from './branding.js';
import { getLayout } from './layout.js';

const STATIC_CLIENT_ASSETS = [
  '/client/styles.css',
  '/client/app.js',
  '/client/manifest.json',
];

function assetStamp(urlPath) {
  try {
    const rel = urlPath.replace(/^\//, '');
    const stat = fs.statSync(path.resolve(rel));
    return `${Math.round(stat.mtimeMs)}-${stat.size}`;
  } catch {
    return 'missing';
  }
}

function versionedClientAsset(urlPath) {
  return `${urlPath}?v=${assetStamp(urlPath)}`;
}

const STATIC_PRECACHE = [
  '/',
  ...STATIC_CLIENT_ASSETS.map(versionedClientAsset),
  '/favicon.ico',
  '/offline',
];

function publicKachelUrls() {
  return getLayout().kacheln
    .filter((kachel) => (kachel.access || 'public') === 'public' && kachel.content)
    .flatMap((kachel) => listKachelPublicAssets(kachel));
}

function logoAssetStamp(urlPath) {
  try {
    const filePath = logoFileForUrl(urlPath);
    if (!filePath) return 'missing';
    const stat = fs.statSync(filePath);
    return `${Math.round(stat.mtimeMs)}-${stat.size}`;
  } catch {
    return 'missing';
  }
}

function tenantLogoFingerprint() {
  const h = crypto.createHash('sha1');
  for (const urlPath of existingLogoUrls()) {
    h.update(urlPath).update(logoAssetStamp(urlPath));
    try {
      const filePath = logoFileForUrl(urlPath);
      if (filePath) h.update(fs.readFileSync(filePath));
    } catch {
      // Missing assets are omitted by existingLogoUrls.
    }
  }
  return h.digest('hex');
}

function clientAssetsFingerprint() {
  const h = crypto.createHash('sha1');
  for (const urlPath of STATIC_CLIENT_ASSETS) {
    h.update(urlPath).update(assetStamp(urlPath));
    try {
      h.update(fs.readFileSync(path.resolve(urlPath.replace(/^\//, ''))));
    } catch {
      // Missing assets are represented by the stamp above.
    }
  }
  return h.digest('hex');
}

export function buildServiceWorker() {
  const urls = [...new Set([...STATIC_PRECACHE, ...existingLogoUrls(), ...publicKachelUrls()])];
  const hash = crypto.createHash('sha1')
    .update(urls.join('\n'))
    .update(clientAssetsFingerprint())
    .update(tenantLogoFingerprint())
    .digest('hex').slice(0, 10);
  const cacheName = `zso-public-${hash}`;
  return `// Auto-generated. Cache version busts when public content or client assets change.
const CACHE = ${JSON.stringify(cacheName)};
const PRECACHE = ${JSON.stringify(urls)};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
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

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cacheableNavigation =
        url.pathname === '/' ||
        url.pathname === '/offline' ||
        url.pathname.startsWith('/k/');
      try {
        const fresh = await fetch(req);
        if (fresh.ok && cacheableNavigation) {
          cache.put(req, fresh.clone()).catch(() => {});
          cache.put(url.pathname, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const exact = await cache.match(req) || await cache.match(url.pathname);
        if (exact) return exact;
        if (url.pathname === '/') {
          const home = await cache.match('/');
          if (home) return home;
        }
        return await cache.match('/offline') || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/client/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(new Request(req, { cache: 'reload' }));
        if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cached = await cache.match(req) || await cache.match(url.pathname, { ignoreSearch: true });
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/logos/') || url.pathname === '/favicon.ico') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: true }) || await cache.match(url.pathname, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const fresh = await fetch(new Request(req, { cache: 'reload' }));
        if (fresh.ok) {
          cache.put(req, fresh.clone()).catch(() => {});
          cache.put(url.pathname, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/k/') || url.pathname === '/offline') {
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
});
`;
}
