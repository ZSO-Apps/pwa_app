import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { loadLayout, findKachel } from './layout.js';
import { sessionMiddleware, checkLogin, setSessionCookie, clearSessionCookie, hasAccess } from './auth.js';
import { listKachelDir, renderMarkdown, mimeOf, resolveKachelPath, kachelRoots, effectiveKachel } from './content.js';
import { contentActionContext, importContentFile, renderNewMarkdownPage, saveContentLink, saveMarkdownContent } from './content-admin.js';
import { renderHome, renderListing, renderMarkdownPage, renderLogin, renderOffline, renderError } from './templates/index.js';
import { searchContent } from './search.js';
import { archiveWks, renderArchivedWkSubmission, renderForm, renderResults, renderSubmission, renderWkArchive, submitForm, unarchiveWks } from './forms.js';
import { buildServiceWorker } from './sw.js';
import { wkMiddleware, setActiveWk, listWks } from './wk.js';
import { createUser, deleteUser, renderDeleteUser, renderEditUser, renderNewUser, renderUsers, updateUser } from './user-admin.js';
import { resolveLogo } from './branding.js';
import { createQuiz, quizActionContext, renderNewQuiz } from './quiz-admin.js';
import {
  renderAppellPage, apiLists, apiData, apiSetStatus, apiSetTags,
  renderImportPage, handleImport, renderReviewPage, handleConfirm, handleDiscard, handleDeleteList,
} from './appell.js';
import {
  renderTransportPage, apiData as apiTransportData, apiSaveFleet, apiCreateOrder,
  apiUpdateOrder, apiDeleteOrder, apiOrderStatus, apiReleaseTrailer,
} from './transport.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

loadLayout();

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: false }));
app.use(sessionMiddleware);
app.use(wkMiddleware);

app.use('/client', express.static(path.resolve('client'), { maxAge: '1h' }));
app.use('/logos', express.static(path.resolve('content_zso_specific_public/logos'), { maxAge: '1h' }));
app.get('/favicon.ico', (_req, res) => {
  const logo = resolveLogo('favicon');
  if (logo) return res.sendFile(logo.path);
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

app.get('/api/search', (req, res) => {
  res.json(searchContent(req, req.query?.q));
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

app.get('/content-admin/:id/markdown/new', (req, res) => renderNewMarkdownPage(req, res, req.params.id));
app.post('/content-admin/:id/markdown', (req, res) => saveMarkdownContent(req, res, req.params.id));
app.post('/content-admin/:id/import', express.raw({ type: '*/*', limit: '30mb' }), (req, res) => importContentFile(req, res, req.params.id));
app.post('/content-admin/:id/link', (req, res) => saveContentLink(req, res, req.params.id));

app.get('/quiz/new', (req, res) => renderNewQuiz(req, res));
app.post('/quiz', (req, res) => createQuiz(req, res));

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

// Appell module (per-WK attendance) — own routes, not content-folder based.
app.get('/appell', (req, res) => renderAppellPage(req, res));
app.get('/appell/import', (req, res) => renderImportPage(req, res));
app.post('/appell/import', express.raw({ type: '*/*', limit: '30mb' }), (req, res) => handleImport(req, res));
app.get('/appell/review', (req, res) => renderReviewPage(req, res));
app.post('/appell/confirm', (req, res) => handleConfirm(req, res));
app.post('/appell/discard', (req, res) => handleDiscard(req, res));
app.post('/appell/list/delete', (req, res) => handleDeleteList(req, res));
app.get('/api/appell/lists', (req, res) => apiLists(req, res));
app.get('/api/appell/data', (req, res) => apiData(req, res));
app.post('/api/appell/status', (req, res) => apiSetStatus(req, res));
app.post('/api/appell/tags', (req, res) => apiSetTags(req, res));

// Transportzentrale (per-WK dispatch) — own routes, not content-folder based.
app.get('/transport', (req, res) => renderTransportPage(req, res));
app.get('/api/transport/data', (req, res) => apiTransportData(req, res));
app.post('/api/transport/fleet', (req, res) => apiSaveFleet(req, res));
app.post('/api/transport/order', (req, res) => apiCreateOrder(req, res));
app.post('/api/transport/order/:id', (req, res) => apiUpdateOrder(req, res));
app.post('/api/transport/order/:id/delete', (req, res) => apiDeleteOrder(req, res));
app.post('/api/transport/order/:id/status', (req, res) => apiOrderStatus(req, res));
app.post('/api/transport/trailer/release', (req, res) => apiReleaseTrailer(req, res));

app.get('/k/:id', (req, res) => {
  const kachel = findKachel(req.params.id);
  if (!kachel) return res.status(404).send(renderError(req, 404, 'Kachel nicht gefunden'));
  if (!ensureKachelAccess(req, res, kachel)) return;
  if (kachel.route) return res.redirect(kachel.route);

  if (kachel.wkScoped && !req.activeWk) {
    return res.status(409).send(renderError(req, 409, 'Bitte zuerst einen WK auswählen oder anlegen (Admin → WK erfassen).'));
  }
  const k = effectiveKachel(kachel, req.activeWk);

  const role = req.user?.role || 'public';
  if (!k.content) return res.status(404).send(renderError(req, 404, 'Leere Kachel'));
  // wkScoped Kacheln may have an as-yet-empty WK folder — show an empty listing
  // rather than a 404 once a WK is active.
  if (!kachelRoots(k).length) {
    if (kachel.wkScoped) {
      return res.send(renderListing(req, kachel, [], [{ label: kachel.title, url: `/k/${kachel.id}` }], {
        contentActions: contentActionContext(req, kachel, ''),
        quizActions: quizActionContext(req, kachel),
      }));
    }
    return res.status(404).send(renderError(req, 404, 'Inhalt nicht gefunden'));
  }

  // index.md anywhere in the merged roots gets rendered as the Kachel landing.
  const idx = resolveKachelPath(k, 'index.md');
  if (idx) {
    return res.send(renderMarkdownPage(req, kachel, renderMarkdown(idx), '/', {
      contentActions: contentActionContext(req, kachel, ''),
    }));
  }

  const entries = listKachelDir(k, '', `/k/${kachel.id}/`, role);
  return res.send(renderListing(req, kachel, entries, [{ label: kachel.title, url: `/k/${kachel.id}` }], {
    contentActions: contentActionContext(req, kachel, ''),
    quizActions: quizActionContext(req, kachel),
  }));
});

app.get('/k/:id/*', (req, res) => {
  const kachel = findKachel(req.params.id);
  if (!kachel || !kachel.content) return res.status(404).send(renderError(req, 404, 'Nicht gefunden'));
  if (!ensureKachelAccess(req, res, kachel)) return;

  if (kachel.wkScoped && !req.activeWk) {
    return res.status(409).send(renderError(req, 409, 'Bitte zuerst einen WK auswählen oder anlegen (Admin → WK erfassen).'));
  }
  const k = effectiveKachel(kachel, req.activeWk);
  if (!k.content) return res.status(404).send(renderError(req, 404, 'Nicht gefunden'));

  const role = req.user?.role || 'public';
  const rel = decodeURIComponent(req.params[0] || '');
  const abs = resolveKachelPath(k, rel);
  if (!abs) return res.status(404).send(renderError(req, 404, 'Nicht gefunden'));

  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const idx = resolveKachelPath(k, path.join(rel, 'index.md'));
    if (idx) {
      return res.send(renderMarkdownPage(req, kachel, renderMarkdown(idx), `/k/${kachel.id}/`, {
        contentActions: contentActionContext(req, kachel, rel),
      }));
    }
    const urlPrefix = `/k/${kachel.id}/${rel.replace(/\/$/, '')}/`;
    const entries = listKachelDir(k, rel, urlPrefix, role);
    const parts = rel.split('/').filter(Boolean);
    const crumbs = [{ label: kachel.title, url: `/k/${kachel.id}` }];
    let acc = `/k/${kachel.id}`;
    for (const p of parts) { acc += '/' + encodeURIComponent(p); crumbs.push({ label: decodeURIComponent(p), url: acc }); }
    return res.send(renderListing(req, kachel, entries, crumbs, {
      contentActions: contentActionContext(req, kachel, rel),
    }));
  }
  if (abs.endsWith('.md')) {
    const parentDir = rel.split('/').slice(0, -1).join('/');
    const parentUrl = `/k/${kachel.id}/${parentDir}`.replace(/\/$/, '') + '/';
    return res.send(renderMarkdownPage(req, { ...kachel, title: path.basename(abs, '.md') }, renderMarkdown(abs), parentUrl));
  }
  res.type(mimeOf(abs));
  res.sendFile(abs);
});

app.get('/admin/users', (req, res) => renderUsers(req, res));
app.get('/admin/users/new', (req, res) => renderNewUser(req, res));
app.post('/admin/users', (req, res) => createUser(req, res));
app.get('/admin/users/:username/edit', (req, res) => renderEditUser(req, res));
app.post('/admin/users/:username/edit', (req, res) => updateUser(req, res));
app.get('/admin/users/:username/delete', (req, res) => renderDeleteUser(req, res));
app.post('/admin/users/:username/delete', (req, res) => deleteUser(req, res));

app.get('/forms/wk/archive', (req, res) => renderWkArchive(req, res));
app.post('/forms/wk/archive', (req, res) => archiveWks(req, res));
app.post('/forms/wk/unarchive', (req, res) => unarchiveWks(req, res));
app.get('/forms/wk/archive/:submissionId', (req, res) => renderArchivedWkSubmission(req, res, req.params.submissionId));

app.get('/forms/:id', (req, res) => renderForm(req, res, req.params.id));
app.post('/forms/:id', (req, res) => submitForm(req, res, req.params.id));
app.get('/forms/:id/results/:submissionId', (req, res) => renderSubmission(req, res, req.params.id, req.params.submissionId));
app.get('/forms/:id/results', (req, res) => renderResults(req, res, req.params.id));

app.use((req, res) => res.status(404).send(renderError(req, 404, `Nicht gefunden: ${req.path}`)));

app.listen(PORT, () => {
  console.log(`ZSO App läuft auf http://localhost:${PORT}`);
});
