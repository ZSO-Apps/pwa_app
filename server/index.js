import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { loadLayout, findKachel } from './layout.js';
import { sessionMiddleware, checkLogin, setSessionCookie, clearSessionCookie, hasAccess } from './auth.js';
import { listKachelDir, renderMarkdown, mimeOf, resolveKachelPath, kachelRoots } from './content.js';
import { renderHome, renderListing, renderMarkdownPage, renderLogin, renderOffline, renderError } from './templates/index.js';
import { renderForm, submitForm, renderResults, renderSubmission } from './forms.js';
import { buildServiceWorker } from './sw.js';
import { wkMiddleware, setActiveWk, listWks } from './wk.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

loadLayout();

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware);
app.use(wkMiddleware);

app.use('/client', express.static(path.resolve('client'), { maxAge: '1h' }));
app.get('/favicon.ico', (_req, res) => {
  const f = path.resolve('client/favicon.ico');
  if (fs.existsSync(f)) res.sendFile(f); else res.status(404).end();
});

app.get('/service-worker.js', (_req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(buildServiceWorker());
});

app.get('/api/sync-manifest', (_req, res) => {
  res.json({ urls: [], note: 'See /service-worker.js for the precache list.' });
});

app.get('/offline', (req, res) => res.send(renderOffline(req)));

app.get('/', (req, res) => res.send(renderHome(req)));

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

app.post('/wk/select', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const wantedId = String(req.body?.wkId || '');
  const wks = listWks();
  if (wks.find((w) => w.id === wantedId)) setActiveWk(res, wantedId);
  const back = req.get('referer');
  res.redirect(back && back.startsWith(`${req.protocol}://${req.get('host')}`) ? back : '/');
});

function ensureKachelAccess(req, res, kachel) {
  const role = req.user?.role || 'public';
  if (hasAccess(role, kachel.access || 'public')) return true;
  if (!req.user) {
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return false;
  }
  res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  return false;
}

app.get('/k/:id', (req, res) => {
  const k = findKachel(req.params.id);
  if (!k) return res.status(404).send(renderError(req, 404, 'Kachel nicht gefunden'));
  if (!ensureKachelAccess(req, res, k)) return;

  const role = req.user?.role || 'public';
  if (!k.content) return res.status(404).send(renderError(req, 404, 'Leere Kachel'));
  if (!kachelRoots(k).length) return res.status(404).send(renderError(req, 404, 'Inhalt nicht gefunden'));

  // index.md anywhere in the merged roots gets rendered as the Kachel landing.
  const idx = resolveKachelPath(k, 'index.md');
  if (idx) return res.send(renderMarkdownPage(req, k, renderMarkdown(idx), '/'));

  const entries = listKachelDir(k, '', `/k/${k.id}/`, role);
  return res.send(renderListing(req, k, entries, [{ label: k.title, url: `/k/${k.id}` }]));
});

app.get('/k/:id/*', (req, res) => {
  const k = findKachel(req.params.id);
  if (!k || !k.content) return res.status(404).send(renderError(req, 404, 'Nicht gefunden'));
  if (!ensureKachelAccess(req, res, k)) return;

  const role = req.user?.role || 'public';
  const rel = decodeURIComponent(req.params[0] || '');
  const abs = resolveKachelPath(k, rel);
  if (!abs) return res.status(404).send(renderError(req, 404, 'Nicht gefunden'));

  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const idx = resolveKachelPath(k, path.join(rel, 'index.md'));
    if (idx) return res.send(renderMarkdownPage(req, k, renderMarkdown(idx), `/k/${k.id}/`));
    const urlPrefix = `/k/${k.id}/${rel.replace(/\/$/, '')}/`;
    const entries = listKachelDir(k, rel, urlPrefix, role);
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

app.get('/forms/:id', (req, res) => renderForm(req, res, req.params.id));
app.post('/forms/:id', (req, res) => submitForm(req, res, req.params.id));
app.get('/forms/:id/results/:submissionId', (req, res) => renderSubmission(req, res, req.params.id, req.params.submissionId));
app.get('/forms/:id/results', (req, res) => renderResults(req, res, req.params.id));

app.use((req, res) => res.status(404).send(renderError(req, 404, `Nicht gefunden: ${req.path}`)));

app.listen(PORT, () => {
  console.log(`ZSO App läuft auf http://localhost:${PORT}`);
});
