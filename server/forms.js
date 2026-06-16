import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getForm } from './layout.js';
import { hasAccess } from './auth.js';
import { renderFormPage, renderResultsPage, renderSubmissionPage } from './templates/index.js';

const DATA_DIR = path.resolve('data/forms');

function submitAccessFor(def) {
  const access = def.submitAccess || 'Soldat';
  return access === 'public' ? 'Soldat' : access;
}

function safeSubmissionId(id) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id || '');
}

function canReadResults(req, res, def) {
  if (!def || !def.resultsAccess) {
    res.status(404).send('Auswertung nicht verfügbar');
    return false;
  }
  const role = req.user?.role || 'public';
  if (hasAccess(role, def.resultsAccess)) return true;
  if (!req.user) {
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return false;
  }
  res.status(403).send('Zugriff verweigert');
  return false;
}

export function renderForm(req, res, formId) {
  const def = getForm(formId);
  if (!def) return res.status(404).send('Formular nicht gefunden');
  const role = req.user?.role || 'public';
  if (!hasAccess(role, submitAccessFor(def))) {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return res.status(403).send('Zugriff verweigert');
  }
  res.send(renderFormPage(req, def));
}

export function submitForm(req, res, formId) {
  const def = getForm(formId);
  if (!def) return res.status(404).send('Formular nicht gefunden');
  const role = req.user?.role || 'public';
  if (!hasAccess(role, submitAccessFor(def))) return res.status(403).send('Zugriff verweigert');

  const submission = { _meta: { formId, submittedAt: new Date().toISOString(), submittedBy: req.user?.username || null } };
  for (const f of def.fields) {
    const v = req.body?.[f.name];
    if (f.required && (v === undefined || v === '')) {
      return res.status(400).send(`Feld '${f.label || f.name}' ist erforderlich.`);
    }
    submission[f.name] = v ?? null;
  }

  const dir = path.join(DATA_DIR, def.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${submission._meta.submittedAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`;
  fs.writeFileSync(path.join(dir, file), JSON.stringify(submission, null, 2));

  res.send(renderFormPage(req, def, { submitted: true }));
}

export function readSubmissions(formId) {
  const def = getForm(formId);
  if (!def) return [];
  const dir = path.join(DATA_DIR, def.id);
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

export function readSubmission(formId, submissionId) {
  const def = getForm(formId);
  if (!def || !safeSubmissionId(submissionId)) return null;
  const filePath = path.join(DATA_DIR, def.id, submissionId + '.json');
  if (!filePath.startsWith(path.join(DATA_DIR, def.id) + path.sep)) return null;
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
  res.send(renderResultsPage(req, def, readSubmissions(formId)));
}

export function renderSubmission(req, res, formId, submissionId) {
  const def = getForm(formId);
  if (!canReadResults(req, res, def)) return;
  const submission = readSubmission(formId, submissionId);
  if (!submission) return res.status(404).send('Eingabe nicht gefunden');
  res.send(renderSubmissionPage(req, def, submission));
}
