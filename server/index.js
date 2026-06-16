import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { loadLayout, findKachel, getForm } from './layout.js';
import { sessionMiddleware, checkLogin, setSessionCookie, clearSessionCookie, hasAccess } from './auth.js';
import { listDir, renderMarkdown, safeResolve, mimeOf } from './content.js';
import { renderHome, renderListing, renderMarkdownPage, renderLogin, renderChildren, renderOffline, renderError } from './templates/index.js';
import { readSubmissions, renderForm, submitForm, renderResults } from './forms.js';
import { buildServiceWorker } from './sw.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const ROOT = path.resolve('.');

loadLayout();

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware);

// Static client + favicon
app.use('/client', express.static(path.resolve('client'), { maxAge: '1h' }));
app.get('/favicon.ico', (_req, res) => {
  const f = path.resolve('client/favicon.ico');
  if (fs.existsSync(f)) res.sendFile(f); else res.status(404).end();
});

// Service worker (served from origin root so its scope = '/').
app.get('/service-worker.js', (_req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(buildServiceWorker());
});

// Sync manifest (JSON of precached URLs) for diagnostics.
app.get('/api/sync-manifest', (_req, res) => {
  res.json({ urls: [], note: 'See /service-worker.js for the precache list.' });
});

// Offline fallback page (precached).
app.get('/offline', (req, res) => res.send(renderOffline(req)));

// Home
app.get('/', (req, res) => res.send(renderHome(req)));

// Login
app.get('/login', (req, res) => res.send(renderLogin(req)));
app.post('/login', async (req, res) => {
  const { username, password, next } = req.body || {};
  const user = await checkLogin(username, password);
  if (!user) return res.status(401).send(renderLogin(req, 'Login fehlgeschlagen.'));
  setSessionCookie(res, user);
  const safe = typeof next === 'string' && next.startsWith('/') ? next : '/';
  res.redirect(safe);
});
app.all('/logout', (_req, res) => { clearSessionCookie(res); res.redirect('/'); });

function kachelDashboard(req, kachel) {
  const role = req.user?.role || 'public';
  const visibleChildren = (kachel.children || [])
    .filter((child) => hasAccess(role, child.access || 'public'));

  const actions = visibleChildren
    .filter((child) => child.form)
    .map((child) => ({
      title: child.title,
      url: `/forms/${child.form}`,
    }));

  const resultSections = visibleChildren
    .filter((child) => child.formResults)
    .map((child) => {
      const def = getForm(child.formResults);
      if (!def) return null;
      return {
        title: child.title,
        def,
        submissions: readSubmissions(child.formResults),
      };
    })
    .filter(Boolean);

  return { actions, resultSections };
}

// Kachel router: /k/:id (recursive)
app.get('/k/:id', (req, res) => {
  const k = findKachel(req.params.id);
  if (!k) return res.status(404).send(renderError(req, 404, 'Kachel nicht gefunden'));
  const role = req.user?.role || 'public';
  if (!hasAccess(role, k.access || 'public')) {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  }
  if (k.form) return renderForm(req, res, k.form);
  if (k.formResults) return renderResults(req, res, k.formResults);
  if (k.children?.length) return res.send(renderChildren(req, k, kachelDashboard(req, k)));
  if (k.content) {
    const dir = safeResolve(k.content);
    if (!fs.existsSync(dir)) return res.status(404).send(renderError(req, 404, 'Inhalt nicht gefunden'));
    const stat = fs.statSync(dir);
    if (stat.isDirectory()) {
      // If folder has an index.md, render that instead of a listing
      const idx = path.join(dir, 'index.md');
      if (fs.existsSync(idx)) {
        return res.send(renderMarkdownPage(req, k, renderMarkdown(idx), '/'));
      }
      const entries = listDir(dir, `/k/${k.id}/`);
      return res.send(renderListing(req, k, entries, [{ label: k.title, url: `/k/${k.id}` }]));
    }
  }
  res.send(renderError(req, 404, 'Leere Kachel'));
});

// Sub-path under a kachel: /k/:id/...path...
app.get('/k/:id/*', (req, res) => {
  const k = findKachel(req.params.id);
  if (!k || !k.content) return res.status(404).send(renderError(req, 404, 'Nicht gefunden'));
  const role = req.user?.role || 'public';
  if (!hasAccess(role, k.access || 'public')) {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  }
  const rel = decodeURIComponent(req.params[0] || '');
  let abs;
  try { abs = safeResolve(k.content, rel); } catch { return res.status(400).send('Bad path'); }
  if (!fs.existsSync(abs)) return res.status(404).send(renderError(req, 404, 'Nicht gefunden'));
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const idx = path.join(abs, 'index.md');
    if (fs.existsSync(idx)) return res.send(renderMarkdownPage(req, k, renderMarkdown(idx), `/k/${k.id}/`));
    const urlPrefix = `/k/${k.id}/${rel.replace(/\/$/, '')}/`;
    const entries = listDir(abs, urlPrefix);
    const parts = rel.split('/').filter(Boolean);
    const crumbs = [{ label: k.title, url: `/k/${k.id}` }];
    let acc = `/k/${k.id}`;
    for (const p of parts) { acc += '/' + encodeURIComponent(p); crumbs.push({ label: decodeURIComponent(p), url: acc }); }
    return res.send(renderListing(req, k, entries, crumbs));
  }
  if (abs.endsWith('.md')) {
    const parentUrl = `/k/${k.id}/${rel.split('/').slice(0, -1).join('/')}`.replace(/\/$/, '') + '/';
    return res.send(renderMarkdownPage(req, { ...k, title: path.basename(abs, '.md') }, renderMarkdown(abs), parentUrl));
  }
  res.type(mimeOf(abs));
  res.sendFile(abs);
});

// Public content direct (for offline cache + image refs from markdown)
app.get(/^\/content\/.+/, (req, res) => {
  let abs;
  try { abs = safeResolve(decodeURIComponent(req.path.replace(/^\//, ''))); } catch { return res.status(400).end(); }
  if (!abs.startsWith(path.resolve('content'))) return res.status(400).end();
  if (!fs.existsSync(abs)) return res.status(404).end();
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    // listing
    const entries = listDir(abs, req.path.endsWith('/') ? req.path : req.path + '/');
    return res.send(renderListing(req, { title: path.basename(abs) }, entries, [{ label: 'Inhalt', url: '/' }]));
  }
  if (abs.endsWith('.md')) {
    return res.send(renderMarkdownPage(req, { title: path.basename(abs, '.md') }, renderMarkdown(abs), '/'));
  }
  res.type(mimeOf(abs));
  res.sendFile(abs);
});

// Forms
app.get('/forms/:id', (req, res) => renderForm(req, res, req.params.id));
app.post('/forms/:id', (req, res) => submitForm(req, res, req.params.id));
app.get('/forms/:id/results', (req, res) => renderResults(req, res, req.params.id));

app.use((req, res) => res.status(404).send(renderError(req, 404, `Nicht gefunden: ${req.path}`)));

app.listen(PORT, () => {
  console.log(`ZSO App läuft auf http://localhost:${PORT}`);
});
