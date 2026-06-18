import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getForm } from './layout.js';
import { hasAccess } from './auth.js';
import { isStored } from './form-elements.js';
import { renderFormPage, renderResultsPage, renderSubmissionPage, renderError } from './templates/index.js';

const DATA_DIR = path.resolve('data/forms');
const WK_FORM_ID = 'wk';
const WK_SCOPE = '_global';
const ARCHIVE_TAG = 'archiviert';

// Per-WK content Kacheln (wkScoped in layout.yaml). When a WK is created we
// auto-create its subfolder in each of these so authors can drop files per WK.
const WK_CONTENT_SLUGS = ['wk_infos', 'wk_infos_kader'];
const ZSO_ROOT = path.resolve('content_zso_specific');

function ensureWkContentFolders(wkId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(wkId)) return;
  for (const slug of WK_CONTENT_SLUGS) {
    fs.mkdirSync(path.join(ZSO_ROOT, slug, wkId), { recursive: true });
  }
}

function submitAccessFor(def) {
  const access = def.submitAccess || 'Soldat';
  return access === 'public' ? 'Soldat' : access;
}

function safeSubmissionId(id) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id || '');
}

// Turn a free-text part into a filesystem/id-safe token (umlauts -> ascii).
function slugifyPart(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Filename (without directory) for a new submission. WK records get a readable
// id derived from start date + name (YYYY_MM_DD_Name); everything else stays on
// the collision-proof timestamp+uuid scheme.
function submissionFilename(def, submission, dir) {
  if (def.id === 'wk') {
    const datePart = String(submission.start || '').replace(/-/g, '_');
    const namePart = slugifyPart(submission.wk_name || submission.name);
    let base = [datePart, namePart].filter(Boolean).join('_') || 'wk';
    if (!/^[A-Za-z0-9]/.test(base)) base = 'wk_' + base;
    let candidate = base;
    for (let n = 2; fs.existsSync(path.join(dir, candidate + '.json')); n++) {
      candidate = `${base}_${n}`;
    }
    return candidate + '.json';
  }
  return `${submission._meta.submittedAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`;
}

function scopeDirFor(def, req) {
  if (def.scope === 'global') return '_global';
  return req.activeWk?.id || null;
}

function requireScope(req, res, def) {
  const scope = scopeDirFor(def, req);
  if (!scope) {
    res.status(409).send(renderError(req, 409, 'Bitte zuerst einen WK auswählen oder anlegen (Admin → WK erfassen).'));
    return null;
  }
  return scope;
}

function canReadResults(req, res, def) {
  if (!def || !def.resultsAccess) {
    res.status(404).send(renderError(req, 404, 'Auswertung nicht verfügbar'));
    return false;
  }
  const role = req.user?.role || 'public';
  if (hasAccess(role, def.resultsAccess)) return true;
  if (!req.user) {
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return false;
  }
  res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  return false;
}

function canSubmit(req, res, def) {
  const role = req.user?.role || 'public';
  if (hasAccess(role, submitAccessFor(def))) return true;
  if (!req.user) {
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return false;
  }
  res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  return false;
}

function canCreateEntry(req, def) {
  const role = req.user?.role || 'public';
  return hasAccess(role, submitAccessFor(def));
}

export function renderForm(req, res, formId) {
  const def = getForm(formId);
  if (!def) return res.status(404).send(renderError(req, 404, 'Formular nicht gefunden'));
  if (!canSubmit(req, res, def)) return;
  if (!requireScope(req, res, def)) return;
  res.send(renderFormPage(req, def));
}

export function submitForm(req, res, formId) {
  const def = getForm(formId);
  if (!def) return res.status(404).send(renderError(req, 404, 'Formular nicht gefunden'));
  if (!canSubmit(req, res, def)) return;
  const scope = requireScope(req, res, def);
  if (!scope) return;

  const submission = {
    _meta: {
      formId,
      submittedAt: new Date().toISOString(),
      submittedBy: req.user?.username || null,
      wkId: def.scope === 'global' ? null : scope,
    },
  };
  for (const f of def.fields || []) {
    if (!isStored(f)) continue; // skip display + printOnly elements
    if (f.type === 'checkbox') {
      submission[f.name] = req.body?.[f.name] !== undefined;
      continue;
    }
    const v = req.body?.[f.name];
    if (f.required && (v === undefined || v === '')) {
      return res.status(400).send(renderError(req, 400, `Feld '${f.label || f.name}' ist erforderlich.`));
    }
    submission[f.name] = v ?? null;
  }

  const dir = path.join(DATA_DIR, def.id, scope);
  fs.mkdirSync(dir, { recursive: true });
  const file = submissionFilename(def, submission, dir);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(submission, null, 2));

  const submissionId = path.basename(file, '.json');
  // A new WK gets its per-WK content folders so authors can fill them right away.
  if (def.id === 'wk') ensureWkContentFolders(submissionId);
  const detailUrl = `/forms/${encodeURIComponent(def.id)}/results/${encodeURIComponent(submissionId)}`;
  res.send(renderFormPage(req, def, { submitted: true, values: req.body || {}, detailUrl }));
}

export function readSubmissions(formId, scope) {
  if (!scope) return [];
  const def = getForm(formId);
  if (!def) return [];
  const dir = path.join(DATA_DIR, def.id, scope);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        parsed._meta = { ...(parsed._meta || {}), submissionId: path.basename(f, '.json') };
        return parsed;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function submissionTags(submission) {
  return Array.isArray(submission?._meta?.tags) ? submission._meta.tags.map(String) : [];
}

export function isArchivedSubmission(submission) {
  return submissionTags(submission).includes(ARCHIVE_TAG);
}

function selectedSubmissionIds(body) {
  const raw = body?.submissionId;
  return (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((id) => String(id || '').trim())
    .filter(safeSubmissionId);
}

function wkSubmissionFile(id) {
  const scopeDir = path.join(DATA_DIR, WK_FORM_ID, WK_SCOPE);
  const filePath = path.join(scopeDir, id + '.json');
  if (!filePath.startsWith(scopeDir + path.sep)) return null;
  return filePath;
}

function updateWkArchiveTags(req, ids, archived) {
  let updated = 0;
  for (const id of ids) {
    const filePath = wkSubmissionFile(id);
    if (!filePath || !fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const meta = { ...(parsed._meta || {}) };
      const tags = new Set(Array.isArray(meta.tags) ? meta.tags.map(String) : []);
      if (archived) {
        tags.add(ARCHIVE_TAG);
        meta.archivedAt = new Date().toISOString();
        meta.archivedBy = req.user?.username || null;
      } else {
        tags.delete(ARCHIVE_TAG);
        delete meta.archivedAt;
        delete meta.archivedBy;
      }
      meta.tags = [...tags];
      if (!meta.tags.length) delete meta.tags;
      parsed._meta = meta;
      fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2));
      updated++;
    } catch (e) {
      console.error(`wk archive: failed to update ${id}:`, e.message);
    }
  }
  return updated;
}

export function readSubmission(formId, scope, submissionId) {
  const def = getForm(formId);
  if (!def || !safeSubmissionId(submissionId) || !scope) return null;
  const scopeDir = path.join(DATA_DIR, def.id, scope);
  const filePath = path.join(scopeDir, submissionId + '.json');
  if (!filePath.startsWith(scopeDir + path.sep)) return null;
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    parsed._meta = { ...(parsed._meta || {}), submissionId };
    return parsed;
  } catch {
    return null;
  }
}

export function renderResults(req, res, formId) {
  const def = getForm(formId);
  if (!canReadResults(req, res, def)) return;
  const scope = requireScope(req, res, def);
  if (!scope) return;
  const wkLabel = def.scope === 'global' ? null : (req.activeWk?.label || scope);
  const canCreate = canCreateEntry(req, def);
  const submissions = readSubmissions(formId, scope)
    .filter((submission) => formId !== WK_FORM_ID || !isArchivedSubmission(submission));
  res.send(renderResultsPage(req, def, submissions, {
    wkLabel,
    canCreate,
    canArchive: formId === WK_FORM_ID && canCreate,
  }));
}

export function renderSubmission(req, res, formId, submissionId) {
  const def = getForm(formId);
  if (!canReadResults(req, res, def)) return;
  const scope = requireScope(req, res, def);
  if (!scope) return;
  const submission = readSubmission(formId, scope, submissionId);
  if (!submission) return res.status(404).send(renderError(req, 404, 'Eingabe nicht gefunden'));
  res.send(renderSubmissionPage(req, def, submission));
}

export function renderWkArchive(req, res) {
  const def = getForm(WK_FORM_ID);
  if (!canReadResults(req, res, def)) return;
  const canUnarchive = canCreateEntry(req, def);
  const submissions = readSubmissions(WK_FORM_ID, WK_SCOPE).filter(isArchivedSubmission);
  res.send(renderResultsPage(req, def, submissions, { archiveMode: true, canUnarchive }));
}

export function archiveWks(req, res) {
  const def = getForm(WK_FORM_ID);
  if (!canSubmit(req, res, def)) return;
  updateWkArchiveTags(req, selectedSubmissionIds(req.body), true);
  res.redirect('/forms/wk/results');
}

export function unarchiveWks(req, res) {
  const def = getForm(WK_FORM_ID);
  if (!canSubmit(req, res, def)) return;
  updateWkArchiveTags(req, selectedSubmissionIds(req.body), false);
  res.redirect('/forms/wk/archive');
}

export function renderArchivedWkSubmission(req, res, submissionId) {
  const def = getForm(WK_FORM_ID);
  if (!canReadResults(req, res, def)) return;
  const submission = readSubmission(WK_FORM_ID, WK_SCOPE, submissionId);
  if (!submission || !isArchivedSubmission(submission)) {
    return res.status(404).send(renderError(req, 404, 'Archivierte Eingabe nicht gefunden'));
  }
  res.send(renderSubmissionPage(req, def, submission, { archiveMode: true }));
}
