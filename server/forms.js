import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getForm } from './layout.js';
import { hasAccess } from './auth.js';
import { isStored } from './form-elements.js';
import { renderFormPage, renderResultsPage, renderSubmissionPage, renderError } from './templates/index.js';

const DATA_DIR = path.resolve('data/forms');

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
  res.send(renderResultsPage(req, def, readSubmissions(formId, scope), { wkLabel }));
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
