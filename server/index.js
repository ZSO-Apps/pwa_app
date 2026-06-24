import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { loadLayout, findKachel } from './layout.js';
import { sessionMiddleware, checkLogin, setSessionCookie, clearSessionCookie, hasAccess } from './auth.js';
import { listKachelDir, renderMarkdown, mimeOf, resolveKachelPath, kachelRoots, effectiveKachel } from './content.js';
import { contentActionContext, createContentFolder, deleteContentEntry, importContentFile, renameContentEntry, renderEditMarkdownPage, renderNewFormPage, renderNewMarkdownPage, saveContentLink, saveFormDefinition, saveMarkdownContent, saveMarkdownEdit } from './content-admin.js';
import { renderHome, renderListing, renderMarkdownPage, renderLogin, renderOffline, renderError } from './templates/index.js';
import { searchContent } from './search.js';
import { archiveWks, renderArchivedWkSubmission, renderForm, renderResults, renderSubmission, renderWkArchive, submitForm, unarchiveWks } from './forms.js';
import { buildServiceWorker, offlineUrlsForRequest } from './sw.js';
import { wkMiddleware, setActiveWk, listWks, wkUrl } from './wk.js';
import { createUser, deleteUser, renderDeleteUser, renderEditUser, renderNewUser, renderUsers, updateUser } from './user-admin.js';
import { createKachel, renderNewKachel } from './kachel-admin.js';
import { resolveLogo } from './branding.js';
import { setupOrg, getOrg } from './org.js';
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

// Point content_zso_specific_public at the selected organization (ZSO/<Org>)
// before anything reads content/logos. Fail fast on a bad org selection.
try {
  setupOrg();
} catch (err) {
  console.error(`\nOrg setup failed: ${err.message}\n`);
  process.exit(1);
}

loadLayout();

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: false }));
app.use(sessionMiddleware);
app.use(wkMiddleware);

app.use('/client', express.static(path.resolve('client'), { maxAge: '1h' }));
app.use('/vendor/easymde', express.static(path.resolve('node_modules/easymde/dist'), { maxAge: '1h' }));
app.use('/logos', express.static(path.resolve('content_zso_specific_public/logos'), { maxAge: '1h' }));
app.get('/favicon.ico', (_req, res) => {
  const logo = resolveLogo('favicon');
  if (logo) return res.sendFile(logo.path);
  const f = path.resolve('client/favicon.ico');
  if (fs.existsSync(f)) res.sendFile(f); else res.status(404).end();
});

app.get('/service-worker.js', (req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(buildServiceWorker(req));
});

app.get('/api/sync-manifest', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ urls: offlineUrlsForRequest(req), role: req.user?.role || 'public', activeWk: req.activeWk?.id || null });
});

app.get('/api/search', (req, res) => {
  res.json(searchContent(req, req.query?.q));
});

function withWkParam(url, req, kachel) {
  if (!kachel?.wkScoped || !req.activeWk?.id) return url;
  return wkUrl(url, req.activeWk.id);
}

function withWkParamForEntries(entries, req, kachel) {
  if (!kachel?.wkScoped || !req.activeWk?.id) return entries;
  return entries.map((entry) => entry.external ? entry : { ...entry, url: withWkParam(entry.url, req, kachel) });
}

function markdownEditUrl(req, kachel, relPath) {
  const parentDir = relPath.split('/').slice(0, -1).join('/');
  if (!contentActionContext(req, kachel, parentDir)) return '';
  return '/content-admin/' + encodeURIComponent(kachel.id) + '/markdown/edit?rel=' + encodeURIComponent(relPath);
}

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

app.get('/kachel-admin/new', (req, res) => renderNewKachel(req, res));
app.post('/kachel-admin', (req, res) => createKachel(req, res));

app.get('/content-admin/:id/markdown/new', (req, res) => renderNewMarkdownPage(req, res, req.params.id));
app.post('/content-admin/:id/markdown', (req, res) => saveMarkdownContent(req, res, req.params.id));
app.get('/content-admin/:id/markdown/edit', (req, res) => renderEditMarkdownPage(req, res, req.params.id));
app.post('/content-admin/:id/markdown/edit', (req, res) => saveMarkdownEdit(req, res, req.params.id));
app.get('/content-admin/:id/form/new', (req, res) => renderNewFormPage(req, res, req.params.id));
app.post('/content-admin/:id/form', (req, res) => saveFormDefinition(req, res, req.params.id));
app.get('/content-admin/:id/quiz/new', (req, res) => renderNewQuiz(req, res, req.params.id));
app.post('/content-admin/:id/quiz', (req, res) => createQuiz(req, res, req.params.id));
app.post('/content-admin/:id/import', express.raw({ type: '*/*', limit: '30mb' }), (req, res) => importContentFile(req, res, req.params.id));
app.post('/content-admin/:id/link', (req, res) => saveContentLink(req, res, req.params.id));
app.post('/content-admin/:id/folder', (req, res) => createContentFolder(req, res, req.params.id));
app.post('/content-admin/:id/entry/rename', (req, res) => renameContentEntry(req, res, req.params.id));
app.post('/content-admin/:id/entry/delete', (req, res) => deleteContentEntry(req, res, req.params.id));

app.get('/quiz/new', (req, res) => renderNewQuiz(req, res));
app.post('/quiz', (req, res) => createQuiz(req, res));

app.post('/wk/select', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const wantedId = String(req.body?.wkId || '');
  const wks = listWks();
  const selected = wks.find((w) => w.id === wantedId);
  if (selected) setActiveWk(res, selected.id);
  const origin = `${req.protocol}://${req.get('host')}`;
  const back = req.get('referer');
  if (selected && back && back.startsWith(origin)) {
    const target = new URL(back);
    res.redirect(303, wkUrl(target.pathname + target.search + target.hash, selected.id));
    return;
  }
  res.redirect(303, selected ? wkUrl('/', selected.id) : '/');
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
    const contentActions = contentActionContext(req, kachel, '');
    if (kachel.wkScoped || contentActions) {
      return res.send(renderListing(req, kachel, [], [{ label: kachel.title, url: withWkParam(`/k/${kachel.id}`, req, kachel) }], {
        contentActions,
        quizActions: quizActionContext(req, kachel),
      }));
    }
    return res.status(404).send(renderError(req, 404, 'Inhalt nicht gefunden'));
  }

  // index.md anywhere in the merged roots gets rendered as the Kachel landing.
  const idx = resolveKachelPath(k, 'index.md');
  if (idx) {
    return res.send(renderMarkdownPage(req, kachel, renderMarkdown(idx), withWkParam('/', req, kachel), {
      contentActions: contentActionContext(req, kachel, ''),
      editUrl: markdownEditUrl(req, kachel, 'index.md'),
    }));
  }

  const entries = withWkParamForEntries(listKachelDir(k, '', `/k/${kachel.id}/`, role), req, kachel);
  return res.send(renderListing(req, kachel, entries, [{ label: kachel.title, url: withWkParam(`/k/${kachel.id}`, req, kachel) }], {
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
      return res.send(renderMarkdownPage(req, kachel, renderMarkdown(idx), withWkParam(`/k/${kachel.id}/`, req, kachel), {
        contentActions: contentActionContext(req, kachel, rel),
        editUrl: markdownEditUrl(req, kachel, path.join(rel, 'index.md')),
      }));
    }
    const urlPrefix = `/k/${kachel.id}/${rel.replace(/\/$/, '')}/`;
    const entries = withWkParamForEntries(listKachelDir(k, rel, urlPrefix, role), req, kachel);
    const parts = rel.split('/').filter(Boolean);
    const crumbs = [{ label: kachel.title, url: `/k/${kachel.id}` }];
    let acc = `/k/${kachel.id}`;
    for (const p of parts) { acc += '/' + encodeURIComponent(p); crumbs.push({ label: decodeURIComponent(p), url: withWkParam(acc, req, kachel) }); }
    return res.send(renderListing(req, kachel, entries, crumbs, {
      contentActions: contentActionContext(req, kachel, rel),
    }));
  }
  if (abs.endsWith('.md')) {
    const parentDir = rel.split('/').slice(0, -1).join('/');
    const parentUrl = withWkParam(`/k/${kachel.id}/${parentDir}`.replace(/\/$/, '') + '/', req, kachel);
    return res.send(renderMarkdownPage(req, { ...kachel, title: path.basename(abs, '.md') }, renderMarkdown(abs), parentUrl, {
      editUrl: markdownEditUrl(req, kachel, rel),
    }));
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
  console.log(`ZSO App (Org: ${getOrg()}) läuft auf http://localhost:${PORT}`);
});
