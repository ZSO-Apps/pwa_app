import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getForm } from './layout.js';
import { hasAccess } from './auth.js';
import { renderFormPage, renderResultsPage } from './templates/index.js';

const DATA_DIR = path.resolve('data/forms');

export function renderForm(req, res, formId) {
  const def = getForm(formId);
  if (!def) return res.status(404).send('Formular nicht gefunden');
  const role = req.user?.role || 'public';
  if (!hasAccess(role, def.submitAccess || 'public')) {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return res.status(403).send('Zugriff verweigert');
  }
  res.send(renderFormPage(req, def));
}

export function submitForm(req, res, formId) {
  const def = getForm(formId);
  if (!def) return res.status(404).send('Formular nicht gefunden');
  const role = req.user?.role || 'public';
  if (!hasAccess(role, def.submitAccess || 'public')) return res.status(403).send('Zugriff verweigert');

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
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function renderResults(req, res, formId) {
  const def = getForm(formId);
  if (!def || !def.resultsAccess) return res.status(404).send('Auswertung nicht verfügbar');
  const role = req.user?.role || 'public';
  if (!hasAccess(role, def.resultsAccess)) {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return res.status(403).send('Zugriff verweigert');
  }
  res.send(renderResultsPage(req, def, readSubmissions(formId)));
}
