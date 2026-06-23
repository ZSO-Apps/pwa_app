import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hasAccess } from './auth.js';
import { effectiveKachel, listKachelAssets, listKachelPublicAssets } from './content.js';
import { existingLogoUrls, logoFileForUrl } from './branding.js';
import { getForms, getLayout } from './layout.js';
import { listWks } from './wk.js';

const STATIC_CLIENT_ASSETS = [
  '/client/styles.css',
  '/client/app.js',
  '/client/manifest.json',
];

const DATA_FORMS_DIR = path.resolve('data/forms');
const WK_FORM_ID = 'wk';
const WK_SCOPE = '_global';
const ARCHIVE_TAG = 'archiviert';

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

function walkKacheln(list, visitor) {
  for (const kachel of list || []) {
    visitor(kachel);
    if (Array.isArray(kachel.children)) walkKacheln(kachel.children, visitor);
  }
}

function roleFromReq(req) {
  return req?.user?.role || 'public';
}

function activeWks() {
  return listWks();
}

function addWkParam(url, wkId) {
  if (!wkId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'wk=' + encodeURIComponent(wkId);
}

function withWkUrls(urls, wkId) {
  return urls.map((url) => addWkParam(url, wkId));
}

function publicKachelUrls() {
  const urls = [];
  walkKacheln(getLayout().kacheln, (kachel) => {
    urls.push(...listKachelPublicAssets(kachel));
  });
  return urls;
}

function visibleKachelUrls(req) {
  const role = roleFromReq(req);
  const urls = [];
  const wks = activeWks();
  walkKacheln(getLayout().kacheln, (kachel) => {
    if (!hasAccess(role, kachel.access || 'public')) return;
    if (kachel.route) {
      urls.push(kachel.route);
      if ((kachel.route === '/appell' || kachel.route === '/transport') && wks.length) {
        for (const wk of wks) urls.push(addWkParam(kachel.route, wk.id));
      }
      return;
    }
    if (!kachel.content) return;
    if (kachel.wkScoped) {
      if (!wks.length) urls.push('/k/' + encodeURIComponent(kachel.id));
      for (const wk of wks) {
        urls.push(addWkParam('/k/' + encodeURIComponent(kachel.id), wk.id));
        urls.push(...withWkUrls(listKachelAssets(effectiveKachel(kachel, wk)), wk.id));
      }
      return;
    }
    urls.push('/k/' + encodeURIComponent(kachel.id));
    urls.push(...listKachelAssets(kachel));
  });
  return urls;
}

function formSubmitAccess(def) {
  const access = def?.submitAccess || 'Soldat';
  return access === 'public' ? 'Soldat' : access;
}

function scopesForForm(def) {
  if (def?.scope === 'global') return [{ scope: '_global', wkId: '' }];
  return activeWks().map((wk) => ({ scope: wk.id, wkId: wk.id }));
}

function safeSubmissionId(id) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(id || ''));
}

function isArchivedSubmission(submission) {
  const tags = Array.isArray(submission?._meta?.tags) ? submission._meta.tags.map(String) : [];
  return tags.includes(ARCHIVE_TAG);
}

function readSubmissionSummaries(formId, scope) {
  if (!formId || !scope) return [];
  const dir = path.join(DATA_FORMS_DIR, formId, scope);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const id = path.basename(file, '.json');
      if (!safeSubmissionId(id)) return null;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        return { id, archived: isArchivedSubmission(parsed) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function visibleFormUrls(req) {
  const role = roleFromReq(req);
  const urls = [];
  const forms = getForms();
  for (const def of Object.values(forms)) {
    if (!def?.id) continue;
    for (const { scope, wkId } of scopesForForm(def)) {
      const formBase = '/forms/' + encodeURIComponent(def.id);
      const submitUrl = addWkParam(formBase, wkId);
      const resultsUrl = addWkParam(formBase + '/results', wkId);
      if (hasAccess(role, formSubmitAccess(def)) && scope) urls.push(submitUrl);
      if (def.resultsAccess && hasAccess(role, def.resultsAccess) && scope) {
        urls.push(resultsUrl);
        for (const submission of readSubmissionSummaries(def.id, scope)) {
          if (def.id === WK_FORM_ID && submission.archived) continue;
          urls.push(addWkParam(formBase + '/results/' + encodeURIComponent(submission.id), wkId));
        }
        if (def.id === WK_FORM_ID) {
          urls.push('/forms/wk/archive');
          for (const submission of readSubmissionSummaries(WK_FORM_ID, WK_SCOPE).filter((item) => item.archived)) {
            urls.push('/forms/wk/archive/' + encodeURIComponent(submission.id));
          }
        }
      }
    }
  }
  return urls;
}

function runtimeApiUrls(req) {
  const role = roleFromReq(req);
  const urls = [];
  for (const wk of activeWks()) {
    if (hasAccess(role, 'Unteroffizier')) urls.push(addWkParam('/api/appell/data', wk.id));
    if (hasAccess(role, 'Fahrer')) urls.push(addWkParam('/api/transport/data', wk.id));
  }
  return urls;
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

export function offlineUrlsForRequest(req = null) {
  const wkHomeUrls = req ? activeWks().map((wk) => addWkParam('/', wk.id)) : [];
  return [...new Set([
    ...STATIC_PRECACHE,
    ...wkHomeUrls,
    ...existingLogoUrls(),
    ...(req ? visibleKachelUrls(req) : publicKachelUrls()),
    ...(req ? visibleFormUrls(req) : []),
    ...(req ? runtimeApiUrls(req) : []),
  ])];
}

export function buildServiceWorker(req = null) {
  const urls = offlineUrlsForRequest(req);
  const role = roleFromReq(req);
  const hash = crypto.createHash('sha1')
    .update(role)
    .update(urls.join('\n'))
    .update(clientAssetsFingerprint())
    .update(tenantLogoFingerprint())
    .digest('hex').slice(0, 10);
  const cacheName = `zso-offline-${hash}`;
  return `// Auto-generated. Cache version busts when offline content or client assets change.
const CACHE = ${JSON.stringify(cacheName)};
const PRECACHE = ${JSON.stringify(urls)};

async function cacheUrls(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all((urls || []).map(async (u) => {
    try { await cache.add(new Request(u, { cache: 'reload', credentials: 'same-origin' })); } catch (e) { /* skip */ }
  }));
  return Date.now();
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await cacheUrls(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => (k.startsWith('zso-public-') || k.startsWith('zso-offline-')) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    const ts = Date.now();
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const c of clients) c.postMessage({ type: 'SYNC_DONE', ts, cache: CACHE });
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'PRECACHE_URLS') return;
  event.waitUntil((async () => {
    const ts = await cacheUrls(data.urls || []);
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
        url.pathname.startsWith('/k/') ||
        url.pathname.startsWith('/forms/') ||
        url.pathname.startsWith('/appell') ||
        url.pathname.startsWith('/transport') ||
        url.pathname.startsWith('/admin/users');
      try {
        const fresh = await fetch(req);
        if (fresh.ok && cacheableNavigation) {
          cache.put(req, fresh.clone()).catch(() => {});
          cache.put(url.pathname + url.search, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const exact = await cache.match(req) || await cache.match(url.pathname + url.search) || (!url.search ? await cache.match(url.pathname) : null);
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
      const cached = await cache.match(req, { ignoreSearch: true }) || await cache.match(url.pathname + url.search, { ignoreSearch: true }) || await cache.match(url.pathname, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const fresh = await fetch(new Request(req, { cache: 'reload' }));
        if (fresh.ok) {
          cache.put(req, fresh.clone()).catch(() => {});
          cache.put(url.pathname + url.search, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Client-rendered overview data: network-first, cache the last online state
  // so logged-in users can still read it offline. POST writes are not handled.
  if (url.pathname.startsWith('/api/transport/') || url.pathname.startsWith('/api/appell/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cached = await cache.match(req, { ignoreSearch: false }) || await cache.match(url.pathname + url.search, { ignoreSearch: false }) || (!url.search ? await cache.match(url.pathname, { ignoreSearch: true }) : null);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'Offline – kein zwischengespeicherter Stand.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/k/') || url.pathname.startsWith('/forms/') || url.pathname === '/offline') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: false }) || await cache.match(url.pathname + url.search, { ignoreSearch: false }) || (!url.search ? await cache.match(url.pathname, { ignoreSearch: true }) : null);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok) {
          cache.put(req, fresh.clone()).catch(() => {});
          cache.put(url.pathname + url.search, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        return new Response('Offline', { status: 503 });
      }
    })());
  }
});
`;
}
