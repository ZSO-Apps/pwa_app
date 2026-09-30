import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getForm, getForms, getFormVersions, loadLayout, findKachelBySlug } from './layout.js';
import { hasAccess } from './auth.js';
import { isStored } from './form-elements.js';
import { renderFormPage, renderResultsPage, renderSubmissionPage, renderError } from './templates/index.js';
import { generateSnapshot } from './map-snapshot.js';
import { nextVersionId } from './form-versions.js';
import { renderFormReviseBuilder, writeFormRevision } from './content-admin.js';
import { renderQuizReviseBuilder, writeQuizRevision } from './quiz-admin.js';

const DATA_DIR = path.resolve('data/forms');
const WK_FORM_ID = 'wk';
const WK_SCOPE = '_global';
const STANDARD_SCOPE = '_standard';
const ARCHIVE_TAG = 'archiviert';
const ARBEITSPLATZ_FORM = 'arbeitsplatz';
const ACTIVE_FILE = '_active.json';

// --- version model --------------------------------------------------------
// A "family" is the stable base id of a form/quiz. The base version's id *is*
// the family id; revised versions carry `version.family` and their own id
// (versionId). Everything except the `wk` form is versioned. Submissions live
// nested per version: data/forms/<family>/<scope>/<versionId>/*.json (the base
// version subfolder is named after the family). The `wk` form stays flat.

export function familyOf(def) { return def?.version?.family || def?.id || null; }

// Whether a form family is versioned (everything except the wk form).
function isVersioned(def) { return Boolean(def) && familyOf(def) !== WK_FORM_ID; }

// data/forms/<family>/<scope> — holds _active.json plus per-version subfolders
// (versioned families) or the flat submission files (the wk form).
function familyScopeDir(family, scope) { return path.join(DATA_DIR, family, scope); }

// data/forms/<family>/<scope>/<versionId> — a single version's submissions.
function versionSubmissionDir(family, scope, versionId) {
  return path.join(DATA_DIR, family, scope, versionId);
}

// Actual directory holding a submission for `def` in `scope`/`versionId`
// (flat scope dir for the unversioned wk form, version subfolder otherwise).
function submissionDir(def, scope, versionId) {
  const family = familyOf(def);
  return isVersioned(def) ? versionSubmissionDir(family, scope, versionId) : familyScopeDir(family, scope);
}

// The version subfolders that currently exist for a family+scope.
function versionDirsInScope(family, scope) {
  const scopeDir = familyScopeDir(family, scope);
  if (!fs.existsSync(scopeDir)) return [];
  return fs.readdirSync(scopeDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ versionId: e.name, dir: path.join(scopeDir, e.name) }));
}

// Directories that may hold submissions of `def` in `scope`: one flat dir for
// the wk form, all version subfolders otherwise.
function submissionDirsFor(def, scope) {
  const family = familyOf(def);
  if (!isVersioned(def)) return [{ versionId: family, dir: familyScopeDir(family, scope) }];
  return versionDirsInScope(family, scope);
}

// Read `_active.json` for a family+scope, or null if absent/invalid.
function readActive(family, scope) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(familyScopeDir(family, scope), ACTIVE_FILE), 'utf8'));
    return parsed && typeof parsed.versionId === 'string' ? parsed : null;
  } catch { return null; }
}

// The version a family+scope currently resolves to: the pinned `_active.json`
// version if present & known, otherwise the base version (the family id).
export function activeVersionId(family, scope) {
  if (family === WK_FORM_ID) return family;
  const active = readActive(family, scope);
  if (active?.versionId) {
    const def = getForm(active.versionId);
    if (def && familyOf(def) === family) return active.versionId;
  }
  return family;
}

// Pin a family+scope to a specific version (writes `_active.json`).
export function pinVersion(family, scope, versionId, user) {
  if (family === WK_FORM_ID) return;
  const dir = familyScopeDir(family, scope);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ACTIVE_FILE), JSON.stringify({
    versionId, pinnedBy: user || null, pinnedAt: new Date().toISOString(),
  }, null, 2));
}

// When a new WK is created, pin every family's newest version for that WK so
// later-created versions don't retroactively apply. Families whose newest is
// still the base are left unpinned (fallback resolves them to base anyway).
export function pinNewWkToNewest(wkId, user) {
  for (const def of Object.values(getForms())) {
    const family = def.id;
    if (family === WK_FORM_ID) continue;
    const versions = def._versions || [def];
    const newest = versions[versions.length - 1];
    if (newest.id === family) continue;
    pinVersion(family, wkId, newest.id, user);
  }
}

// Lazy, idempotent migration of the legacy flat layout
// (data/forms/<family>/<scope>/*.json) into the base version subfolder
// (data/forms/<family>/<scope>/<family>/). Never touches _active.json or
// existing subdirectories. The unversioned wk form stays flat.
function ensureMigrated(family, scope) {
  if (family === WK_FORM_ID) return;
  const scopeDir = familyScopeDir(family, scope);
  if (!fs.existsSync(scopeDir)) return;
  const flat = fs.readdirSync(scopeDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== ACTIVE_FILE);
  if (!flat.length) return;
  const baseDir = versionSubmissionDir(family, scope, family);
  fs.mkdirSync(baseDir, { recursive: true });
  for (const e of flat) {
    fs.renameSync(path.join(scopeDir, e.name), path.join(baseDir, e.name));
  }
}

// Highest assigned submission number across all of a family+scope's version
// subfolders (numbering runs per family+scope, not per version).
function familyScopeMaxNr(family, scope) {
  let max = 0;
  for (const { dir } of versionDirsInScope(family, scope)) {
    const v = maxNr(dir);
    if (v > max) max = v;
  }
  return max;
}

// Next submission number for `def` in `scope` (per family+scope).
function nextNr(def, scope) {
  const family = familyOf(def);
  return (isVersioned(def) ? familyScopeMaxNr(family, scope) : maxNr(familyScopeDir(family, scope))) + 1;
}

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

function isQuizDef(def) {
  return Boolean(def?.quiz || (def?.fields || []).some((field) => field?.correct !== undefined));
}

function quizNeedsVirtualNameField(def) {
  return isQuizDef(def) && !(def.fields || []).some((field) => field?.name === 'name');
}

// Highest already-assigned submission number in a scope directory (0 if none).
function maxNr(dir) {
  if (!fs.existsSync(dir)) return 0;
  let max = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const nr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))?._meta?.nr;
      if (Number.isInteger(nr) && nr > max) max = nr;
    } catch { /* ignore unreadable files */ }
  }
  return max;
}

// A form allows editable submissions when it opts in via `modifyAllow` and is
// not a quiz and not the WK form (both have special semantics).
export function isModifiable(def) {
  return Boolean(def?.modifyAllow) && !isQuizDef(def) && def?.id !== WK_FORM_ID;
}

// Whether a submission of `def` should land in the shared `_standard` scope,
// based on the value collected for its `standardField` checkbox.
function isStandardSubmission(def, submission) {
  return Boolean(def?.standardField) && submission?.[def.standardField] === true;
}

// --- location / map helpers ----------------------------------------------

function locationFields(def) {
  return (def?.fields || []).filter((f) => f?.type === 'location' && f?.name);
}

function mapField(def) {
  return (def?.fields || []).find((f) => f?.type === 'map' && f?.name) || null;
}

// Distinct, sorted Arbeitsplatz names for a WK scope (WK + shared _standard),
// used to fill `location` datalists.
function arbeitsplatzNames(wkScope) {
  if (!wkScope) return [];
  const names = new Set();
  for (const sub of readAllVersionSubmissionsMerged(ARBEITSPLATZ_FORM, wkScope)) {
    const name = String(sub?.name || '').trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'de-CH'));
}

// Write a minimal Arbeitsplatz submission (just the name) into a WK scope.
function createMinimalArbeitsplatz(wkScope, name, user) {
  const def = getForm(ARBEITSPLATZ_FORM);
  if (!def) return;
  const submission = {
    _meta: { formId: ARBEITSPLATZ_FORM, submittedAt: new Date().toISOString(), submittedBy: user || null, wkId: wkScope },
    name: String(name).trim(),
  };
  ensureMigrated(ARBEITSPLATZ_FORM, wkScope);
  const versionId = activeVersionId(ARBEITSPLATZ_FORM, wkScope);
  const dir = versionSubmissionDir(ARBEITSPLATZ_FORM, wkScope, versionId);
  fs.mkdirSync(dir, { recursive: true });
  submission._meta.nr = familyScopeMaxNr(ARBEITSPLATZ_FORM, wkScope) + 1;
  const file = submissionFilename(def, submission, dir);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(submission, null, 2));
}

// After a submit/edit: any location value not matching an existing Arbeitsplatz
// (case-insensitive) auto-creates a minimal one in the WK scope. Never recurses
// into the Arbeitsplatz form itself.
function ensureArbeitsplaetze(def, submission, wkScope, user) {
  if (def.id === ARBEITSPLATZ_FORM) return;
  const fields = locationFields(def);
  if (!fields.length || !wkScope) return;
  const known = new Set(arbeitsplatzNames(wkScope).map((n) => n.toLowerCase()));
  for (const f of fields) {
    const value = String(submission[f.name] ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (known.has(key)) continue;
    createMinimalArbeitsplatz(wkScope, value, user);
    known.add(key);
  }
}

// Parse a stored map value ({"lat","lon","zoom"} JSON) into a pin or null.
function parseMapValue(raw) {
  if (!raw) return null;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const lat = Number(o?.lat), lon = Number(o?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, zoom: o?.zoom };
  } catch {
    return null;
  }
}

// (Re)generate or remove the `<id>.map.png` snapshot for a submission's map
// field. Fire-and-forget: snapshot failures (e.g. no uplink) are logged but do
// not abort the save.
function handleMapSnapshot(def, dir, submissionId, submission) {
  const f = mapField(def);
  if (!f) return;
  const file = path.join(dir, submissionId + '.map.png');
  const pin = parseMapValue(submission[f.name]);
  if (!pin) {
    fs.rmSync(file, { force: true });
    return;
  }
  generateSnapshot(pin, file).catch((e) => console.error(`map snapshot ${submissionId}:`, e.message));
}

// URL of a submission's own map snapshot, if the PNG exists on disk.
function mapSnapshotUrlFor(def, submission) {
  if (!mapField(def) || !submission?._meta?.scope) return '';
  const dir = submissionDir(def, submission._meta.scope, submission._meta.versionId || familyOf(def));
  const file = path.join(dir, submission._meta.submissionId + '.map.png');
  return fs.existsSync(file) ? `/forms/${encodeURIComponent(familyOf(def))}/results/${encodeURIComponent(submission._meta.submissionId)}/map.png` : '';
}

// Locate an Arbeitsplatz (WK + _standard) whose name matches `name` and that has
// a stored map snapshot; return the snapshot URL or null. Used by the Transport
// print and by location-field forms in the submission detail view.
export function findArbeitsplatzSnapshot(wkId, name) {
  const clean = String(name || '').trim().toLowerCase();
  if (!clean || !wkId) return null;
  for (const sub of readAllVersionSubmissionsMerged(ARBEITSPLATZ_FORM, wkId)) {
    if (String(sub?.name || '').trim().toLowerCase() !== clean) continue;
    const dir = versionSubmissionDir(ARBEITSPLATZ_FORM, sub._meta.scope, sub._meta.versionId || ARBEITSPLATZ_FORM);
    const file = path.join(dir, sub._meta.submissionId + '.map.png');
    if (fs.existsSync(file)) {
      return `/forms/${ARBEITSPLATZ_FORM}/results/${encodeURIComponent(sub._meta.submissionId)}/map.png`;
    }
  }
  return null;
}

// Collect + validate the stored field values from the request into `target`.
// Returns an error message string, or null on success.
function fillSubmissionFields(def, req, target) {
  if (quizNeedsVirtualNameField(def)) {
    const name = String(req.body?.name || '').trim();
    if (!name) return "Feld 'Name' ist erforderlich.";
    target.name = name;
  }
  for (const f of def.fields || []) {
    if (!isStored(f)) continue; // skip display + printOnly elements
    if (f.type === 'checkbox') {
      target[f.name] = req.body?.[f.name] !== undefined;
      continue;
    }
    if (f.type === 'checkboxes') {
      const raw = req.body?.[f.name];
      const values = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
      if (f.required && values.length === 0) return `Feld '${f.label || f.name}' ist erforderlich.`;
      target[f.name] = values;
      continue;
    }
    const v = req.body?.[f.name];
    if (f.required && (v === undefined || v === '')) return `Feld '${f.label || f.name}' ist erforderlich.`;
    target[f.name] = v ?? null;
  }
  return null;
}

// The definition a new submission is filled out with / stored under: the active
// version pinned for the current WK scope (so the shown form matches storage).
function activeDefFor(baseDef, scope) {
  const family = familyOf(baseDef);
  ensureMigrated(family, scope);
  return getForm(activeVersionId(family, scope)) || baseDef;
}

export function renderForm(req, res, formId) {
  const baseDef = getForm(formId);
  if (!baseDef) return res.status(404).send(renderError(req, 404, 'Formular nicht gefunden'));
  if (!canSubmit(req, res, baseDef)) return;
  const scope = requireScope(req, res, baseDef);
  if (!scope) return;
  const def = activeDefFor(baseDef, scope);
  const locations = locationFields(def).length ? arbeitsplatzNames(scope) : [];
  res.send(renderFormPage(req, def, { locations }));
}

export function submitForm(req, res, formId) {
  const baseDef = getForm(formId);
  if (!baseDef) return res.status(404).send(renderError(req, 404, 'Formular nicht gefunden'));
  if (!canSubmit(req, res, baseDef)) return;
  const scope = requireScope(req, res, baseDef);
  if (!scope) return;
  const family = familyOf(baseDef);
  // Collect + store using the WK's active version so field names match the
  // subfolder the submission lands in.
  const versionId = activeVersionId(family, scope);
  const def = getForm(versionId) || baseDef;

  const submission = {
    _meta: {
      formId: family,
      submittedAt: new Date().toISOString(),
      submittedBy: req.user?.username || null,
      wkId: def.scope === 'global' ? null : scope,
    },
  };
  const error = fillSubmissionFields(def, req, submission);
  if (error) return res.status(400).send(renderError(req, 400, error));

  // Standard entries live in a shared, WK-independent scope directory, but keep
  // the WK's active version so they read back with the same schema.
  let scopeDir = scope;
  if (isStandardSubmission(def, submission)) {
    scopeDir = STANDARD_SCOPE;
    submission._meta.wkId = null;
  }

  ensureMigrated(family, scopeDir);
  const dir = submissionDir(def, scopeDir, versionId);
  fs.mkdirSync(dir, { recursive: true });
  submission._meta.nr = nextNr(def, scopeDir);
  const file = submissionFilename(def, submission, dir);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(submission, null, 2));

  const submissionId = path.basename(file, '.json');
  submission._meta.submissionId = submissionId;
  submission._meta.scope = scopeDir;
  submission._meta.versionId = versionId;
  ensureArbeitsplaetze(def, submission, scope, req.user?.username);
  handleMapSnapshot(def, dir, submissionId, submission);
  // A new WK gets its per-WK content folders + pins the newest form versions.
  if (family === WK_FORM_ID) { ensureWkContentFolders(submissionId); pinNewWkToNewest(submissionId, req.user?.username); }
  const detailUrl = `/forms/${encodeURIComponent(family)}/results/${encodeURIComponent(submissionId)}`;
  res.send(renderFormPage(req, def, { submitted: true, values: req.body || {}, detailUrl }));
}

// Lazily assign `_meta.nr` to any submissions in `dir` that lack one, numbering
// them after the existing max, ordered by submittedAt, and persist the change.
// `startMax` seeds the counter with the highest nr already used across the
// whole family+scope (numbering is per family+scope, not per version dir).
// Idempotent: does nothing once every file has a number. `subs` carry transient
// `_meta.submissionId`/`_meta.scope`/`_meta.versionId` that must not be written back.
function backfillNrs(dir, subs, startMax = 0) {
  const missing = subs.filter((s) => !Number.isInteger(s?._meta?.nr));
  if (!missing.length) return;
  let max = startMax;
  for (const s of subs) {
    const nr = s?._meta?.nr;
    if (Number.isInteger(nr) && nr > max) max = nr;
  }
  missing.sort((a, b) => String(a._meta?.submittedAt || '').localeCompare(String(b._meta?.submittedAt || '')));
  for (const s of missing) {
    s._meta.nr = ++max;
    const persist = { ...s, _meta: { ...s._meta } };
    delete persist._meta.submissionId;
    delete persist._meta.scope;
    delete persist._meta.versionId;
    try {
      fs.writeFileSync(path.join(dir, s._meta.submissionId + '.json'), JSON.stringify(persist, null, 2));
    } catch (e) {
      console.error(`nr backfill: failed to update ${s._meta.submissionId}:`, e.message);
    }
  }
}

// Read the raw submission files in a single directory, annotating each with its
// transient `_meta` (submissionId/scope/versionId). Does not backfill numbers.
function readDirSubmissions(dir, scope, versionId) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== ACTIVE_FILE)
    .sort()
    .map((f) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        parsed._meta = { ...(parsed._meta || {}), submissionId: path.basename(f, '.json'), scope, versionId };
        return parsed;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Read the submissions of one specific version.
export function readVersionSubmissions(family, scope, versionId) {
  if (!scope) return [];
  ensureMigrated(family, scope);
  const dir = versionSubmissionDir(family, scope, versionId);
  const subs = readDirSubmissions(dir, scope, versionId);
  backfillNrs(dir, subs, familyScopeMaxNr(family, scope));
  return subs;
}

// Read the submissions of the currently active version (base for the wk form),
// which is what regular results views show. Behaves identically to the legacy
// flat read when a family only has its base version.
export function readSubmissions(formId, scope) {
  if (!scope) return [];
  const def = getForm(formId);
  if (!def) return [];
  const family = familyOf(def);
  ensureMigrated(family, scope);
  if (!isVersioned(def)) {
    const dir = familyScopeDir(family, scope);
    const subs = readDirSubmissions(dir, scope, family);
    backfillNrs(dir, subs, maxNr(dir));
    return subs;
  }
  return readVersionSubmissions(family, scope, activeVersionId(family, scope));
}

// Version ids (of a family+scope) that actually hold at least one submission.
export function versionsWithResults(family, scope) {
  if (!scope) return [];
  ensureMigrated(family, scope);
  return versionDirsInScope(family, scope)
    .filter(({ dir }) => fs.readdirSync(dir).some((f) => f.endsWith('.json')))
    .map(({ versionId }) => versionId);
}

// Read a single version's submissions for the results view, merging that
// version's `_standard` entries for standardField forms.
function readVersionSubmissionsForView(def, wkScope, versionId) {
  const family = familyOf(def);
  const wk = readVersionSubmissions(family, wkScope, versionId);
  if (!def.standardField || wkScope === STANDARD_SCOPE) return wk;
  return [...wk, ...readVersionSubmissions(family, STANDARD_SCOPE, versionId)];
}

// Read submissions across *all* versions of a family+scope, each row tagged
// with its `_meta.versionId`. Used by aggregate consumers (transport dispo,
// arbeitsplatz datalist/overview, map-snapshot resolution).
export function readAllVersionSubmissions(family, scope) {
  if (!scope) return [];
  const def = getForm(family);
  if (!def) return [];
  ensureMigrated(family, scope);
  if (!isVersioned(def)) return readSubmissions(family, scope);
  const startMax = familyScopeMaxNr(family, scope);
  const out = [];
  for (const { versionId, dir } of versionDirsInScope(family, scope)) {
    const subs = readDirSubmissions(dir, scope, versionId);
    backfillNrs(dir, subs, startMax);
    out.push(...subs);
  }
  return out;
}

// Read a form's submissions for a WK scope, additionally merging the shared
// `_standard` scope for forms that use `standardField`. Each submission knows
// its origin scope via `_meta.scope`. Reads the currently active version only.
export function readSubmissionsMerged(formId, wkScope) {
  const def = getForm(formId);
  if (!def) return [];
  const wk = readSubmissions(formId, wkScope);
  if (!def.standardField || wkScope === STANDARD_SCOPE) return wk;
  return [...wk, ...readSubmissions(formId, STANDARD_SCOPE)];
}

// Like `readSubmissionsMerged` but across *all* versions of the family (each row
// tagged with `_meta.versionId`). Used by aggregate consumers that reuse entries
// across versions: the Transport dispo and the arbeitsplatz datalist/overview.
export function readAllVersionSubmissionsMerged(family, wkScope) {
  const def = getForm(family);
  if (!def) return [];
  const wk = readAllVersionSubmissions(family, wkScope);
  if (!def.standardField || wkScope === STANDARD_SCOPE) return wk;
  return [...wk, ...readAllVersionSubmissions(family, STANDARD_SCOPE)];
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

// Locate a submission by id within a scope, searching every version subfolder
// (the flat dir for the wk form). Returns it with `_meta.scope`/`versionId`.
export function readSubmission(formId, scope, submissionId) {
  const def = getForm(formId);
  if (!def || !safeSubmissionId(submissionId) || !scope) return null;
  const family = familyOf(def);
  ensureMigrated(family, scope);
  for (const { versionId, dir } of submissionDirsFor(def, scope)) {
    const filePath = path.join(dir, submissionId + '.json');
    if (!filePath.startsWith(dir + path.sep)) continue;
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      parsed._meta = { ...(parsed._meta || {}), submissionId, scope, versionId };
      return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

// Locate a submission in the active WK scope first, then the shared `_standard`
// scope (for `standardField` forms). Returns the submission (with `_meta.scope`)
// or null. Numbers are backfilled per scope on read.
function readSubmissionAnyScope(def, wkScope, submissionId) {
  const family = familyOf(def);
  readAllVersionSubmissions(family, wkScope); // ensure nr backfill across versions
  let sub = readSubmission(family, wkScope, submissionId);
  if (sub) return sub;
  if (def.standardField && wkScope !== STANDARD_SCOPE) {
    readAllVersionSubmissions(family, STANDARD_SCOPE);
    sub = readSubmission(family, STANDARD_SCOPE, submissionId);
    if (sub) return sub;
  }
  return null;
}

// --- revise (new version) --------------------------------------------------

// Revising (creating a new version) needs the form/quiz builder role.
function canRevise(req, res) {
  const role = req.user?.role || 'public';
  if (hasAccess(role, 'Unteroffizier')) return true;
  if (!req.user) { res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)); return false; }
  res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  return false;
}

// Resolve the family, the Kachel, and the *source* version to prefill a revise
// from: `?from=<versionId>` if valid, otherwise the WK's active version, else
// base. Revising a version starts from that version's fields (not always base).
function reviseContext(req, res, formId) {
  const def = getForm(formId);
  if (!def) { res.status(404).send(renderError(req, 404, 'Formular nicht gefunden')); return null; }
  const family = familyOf(def);
  const baseDef = getForm(family);
  if (!baseDef || family === WK_FORM_ID) {
    res.status(404).send(renderError(req, 404, 'Dieses Formular kann nicht versioniert werden.'));
    return null;
  }
  const kachel = findKachelBySlug(baseDef._slug);
  if (!kachel) { res.status(404).send(renderError(req, 404, 'Kachel nicht gefunden')); return null; }

  const scope = req.activeWk?.id;
  const fromId = typeof req.query?.from === 'string' ? req.query.from : '';
  const fromDef = fromId ? getForm(fromId) : null;
  const sourceDef = (fromDef && familyOf(fromDef) === family) ? fromDef
    : (scope ? getForm(activeVersionId(family, scope)) : null) || baseDef;
  return { family, kachel, sourceDef };
}

// GET: render the (form or quiz) builder prefilled with the source version.
export function renderRevise(req, res, formId) {
  if (!canRevise(req, res)) return;
  const ctx = reviseContext(req, res, formId);
  if (!ctx) return;
  if (isQuizDef(ctx.sourceDef)) return renderQuizReviseBuilder(req, res, ctx.sourceDef, ctx.kachel);
  return renderFormReviseBuilder(req, res, ctx.sourceDef, ctx.kachel);
}

// POST: write the new version, pin it for the current WK, reload the registry.
// Quiz builder posts JSON (expects `{ok,url}`); the form builder posts a form.
export function submitRevise(req, res, formId) {
  if (!canRevise(req, res)) return;
  const ctx = reviseContext(req, res, formId);
  if (!ctx) return;
  const { family, kachel, sourceDef } = ctx;
  const quiz = isQuizDef(sourceDef);
  try {
    const versionId = nextVersionId(kachel.content, family);
    if (quiz) writeQuizRevision(req, sourceDef, kachel, versionId);
    else writeFormRevision(req, sourceDef, kachel, versionId);
    loadLayout();
    const scope = req.activeWk?.id;
    if (scope) pinVersion(family, scope, versionId, req.user?.username);
    const resultsUrl = `/forms/${encodeURIComponent(family)}/results`;
    if (quiz) return res.json({ ok: true, url: resultsUrl });
    return res.redirect(resultsUrl);
  } catch (error) {
    if (quiz) return res.status(400).json({ ok: false, error: error.message || 'Quiz konnte nicht gespeichert werden.' });
    return renderFormReviseBuilder(req, res, sourceDef, kachel, {
      error: error.message,
      values: {
        title: req.body?.title || '',
        submitAccess: req.body?.submitAccess,
        resultsAccess: req.body?.resultsAccess,
        fieldsJson: req.body?.fieldsJson || '[]',
      },
    });
  }
}

// Human label for a version option (base vs. a revision with its creation time).
function versionOptionLabel(def, index) {
  if (index === 0) return 'Basis';
  const at = def?.version?.createdAt;
  const stamp = at ? new Date(at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '';
  return stamp ? `Überarbeitet ${stamp}` : `Version ${index + 1}`;
}

export function renderResults(req, res, formId) {
  const def = getForm(formId);
  if (!canReadResults(req, res, def)) return;
  const scope = requireScope(req, res, def);
  if (!scope) return;
  const family = familyOf(def);
  const wkLabel = def.scope === 'global' ? null : (req.activeWk?.label || scope);
  const canCreate = canCreateEntry(req, def);
  const role = req.user?.role || 'public';

  // WK: unversioned; archived records filtered out.
  if (family === WK_FORM_ID) {
    const submissions = readSubmissionsMerged(formId, scope).filter((s) => !isArchivedSubmission(s));
    return res.send(renderResultsPage(req, def, submissions, { wkLabel, canCreate, canArchive: canCreate }));
  }

  // Arbeitsplätze are reference data reused across versions (they feed location
  // dropdowns), so their overview aggregates every version instead of picking one.
  if (family === ARBEITSPLATZ_FORM) {
    const submissions = readAllVersionSubmissionsMerged(family, scope);
    return res.send(renderResultsPage(req, def, submissions, {
      wkLabel, canCreate,
      canToggleModify: hasAccess(role, 'Offizier'),
      // Arbeitsplätze aggregate across versions, so only the revise affordance
      // is offered (no per-version view/pin selects, no multi-active warning).
      version: { family, canRevise: hasAccess(role, 'Unteroffizier'), hasVersions: false, options: [], multiActive: false },
    }));
  }

  // Other forms/quizzes: show one version, chosen by ?v=, else the newest
  // version that has results, else the pinned/base version.
  const versions = getFormVersions(family); // base first
  const withResults = new Set(versionsWithResults(family, scope));
  const active = activeVersionId(family, scope);
  const requested = typeof req.query.v === 'string' ? req.query.v : '';
  const viewVersionId =
    versions.find((v) => v.id === requested)?.id
    || [...versions].reverse().find((v) => withResults.has(v.id))?.id
    || versions.find((v) => v.id === active)?.id
    || family;
  const viewDef = getForm(viewVersionId) || def;
  const submissions = readVersionSubmissionsForView(def, scope, viewVersionId);

  res.send(renderResultsPage(req, def, submissions, {
    wkLabel,
    canCreate,
    canToggleModify: hasAccess(role, 'Offizier') && !isQuizDef(def),
    tableDef: viewDef,
    version: {
      family,
      viewVersionId,
      activeVersionId: active,
      options: versions.map((v, i) => ({
        id: v.id,
        label: versionOptionLabel(v, i),
        hasResults: withResults.has(v.id),
        isActive: v.id === active,
      })),
      canRevise: hasAccess(role, 'Unteroffizier'),
      canPin: hasAccess(role, 'Unteroffizier'),
      multiActive: withResults.size > 1,
      hasVersions: versions.length > 1,
    },
  }));
}

// POST: pin which version is active for the current WK (Unteroffizier+, online).
export function pinVersionAction(req, res, formId) {
  const def = getForm(formId);
  if (!def) return res.status(404).send(renderError(req, 404, 'Formular nicht gefunden'));
  const baseDef = getForm(familyOf(def));
  if (!baseDef || baseDef.id === WK_FORM_ID) {
    return res.status(404).send(renderError(req, 404, 'Dieses Formular kann nicht versioniert werden.'));
  }
  const role = req.user?.role || 'public';
  if (!hasAccess(role, 'Unteroffizier')) {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  }
  const scope = requireScope(req, res, baseDef);
  if (!scope) return;
  const family = baseDef.id;
  const versionId = String(req.body?.versionId || '');
  const target = getForm(versionId);
  if (versionId === family || (target && familyOf(target) === family)) {
    pinVersion(family, scope, versionId, req.user?.username);
  }
  const wkParam = req.activeWk?.id ? `?wk=${encodeURIComponent(req.activeWk.id)}` : '';
  res.redirect(`/forms/${encodeURIComponent(family)}/results${wkParam}`);
}

// Label for a submission's version ('' for the base version — nothing to show).
function versionLabelFor(family, versionId) {
  const versions = getFormVersions(family);
  const idx = versions.findIndex((v) => v.id === versionId);
  return idx > 0 ? versionOptionLabel(versions[idx], idx) : '';
}

export function renderSubmission(req, res, formId, submissionId) {
  const def = getForm(formId);
  if (!canReadResults(req, res, def)) return;
  const scope = requireScope(req, res, def);
  if (!scope) return;
  const submission = readSubmissionAnyScope(def, scope, submissionId);
  if (!submission) return res.status(404).send(renderError(req, 404, 'Eingabe nicht gefunden'));
  // Render the submission through its *own* version's schema (columns/labels
  // may have drifted across versions); access stays governed by the base def.
  const viewDef = getForm(submission._meta.versionId) || def;
  const canEdit = isModifiable(viewDef) && canCreateEntry(req, viewDef);
  const mapSnapshotUrl = mapSnapshotUrlFor(viewDef, submission);
  // For location-field forms, show the Arbeitsplatz snapshot of the first
  // location value that resolves to an Arbeitsplatz with a stored map.
  let arbeitsplatzMapUrl = '';
  if (!mapSnapshotUrl && viewDef.scope !== 'global') {
    for (const f of locationFields(viewDef)) {
      const hit = findArbeitsplatzSnapshot(scope, submission[f.name]);
      if (hit) { arbeitsplatzMapUrl = hit; break; }
    }
  }
  const versionLabel = versionLabelFor(familyOf(def), submission._meta.versionId);
  res.send(renderSubmissionPage(req, viewDef, submission, { canEdit, mapSnapshotUrl, arbeitsplatzMapUrl, versionLabel }));
}

// GET: serve a submission's map snapshot PNG (access = resultsAccess).
export function serveSubmissionMap(req, res, formId, submissionId) {
  const def = getForm(formId);
  if (!canReadResults(req, res, def)) return;
  const scope = requireScope(req, res, def);
  if (!scope) return;
  const submission = readSubmissionAnyScope(def, scope, submissionId);
  if (!submission) return res.status(404).send(renderError(req, 404, 'Eingabe nicht gefunden'));
  const dir = submissionDir(def, submission._meta.scope, submission._meta.versionId || familyOf(def));
  const file = path.join(dir, submissionId + '.map.png');
  if (!fs.existsSync(file)) return res.status(404).send(renderError(req, 404, 'Kein Kartenausschnitt'));
  res.type('image/png');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(file);
}

// GET: render the generic form prefilled with an existing submission's values.
export function renderSubmissionEdit(req, res, formId, submissionId) {
  const def = getForm(formId);
  if (!def) return res.status(404).send(renderError(req, 404, 'Formular nicht gefunden'));
  if (!canSubmit(req, res, def)) return;
  const scope = requireScope(req, res, def);
  if (!scope) return;
  const submission = readSubmissionAnyScope(def, scope, submissionId);
  if (!submission) return res.status(404).send(renderError(req, 404, 'Eingabe nicht gefunden'));
  // Edit through the submission's own version schema.
  const viewDef = getForm(submission._meta.versionId) || def;
  if (!isModifiable(viewDef)) return res.status(404).send(renderError(req, 404, 'Bearbeiten nicht verfügbar'));
  const detailUrl = `/forms/${encodeURIComponent(familyOf(def))}/results/${encodeURIComponent(submissionId)}`;
  const editUrl = detailUrl + '/edit';
  const locations = locationFields(viewDef).length ? arbeitsplatzNames(scope) : [];
  res.send(renderFormPage(req, viewDef, { values: submission, editUrl, backUrl: detailUrl, locations }));
}

// POST: overwrite an existing submission, preserving nr/submittedAt/submittedBy/
// wkId and recording editedBy/editedAt. Moves the file between WK and _standard
// scope when the standardField checkbox value changes.
export function submitSubmissionEdit(req, res, formId, submissionId) {
  const def = getForm(formId);
  if (!def) return res.status(404).send(renderError(req, 404, 'Formular nicht gefunden'));
  if (!canSubmit(req, res, def)) return;
  const scope = requireScope(req, res, def);
  if (!scope) return;
  const existing = readSubmissionAnyScope(def, scope, submissionId);
  if (!existing) return res.status(404).send(renderError(req, 404, 'Eingabe nicht gefunden'));
  // Validate + store using the submission's own version schema.
  const viewDef = getForm(existing._meta.versionId) || def;
  if (!isModifiable(viewDef)) return res.status(404).send(renderError(req, 404, 'Bearbeiten nicht verfügbar'));

  const srcScope = existing._meta.scope;
  const versionId = existing._meta.versionId || familyOf(def);
  const submission = {
    _meta: {
      formId: familyOf(def),
      submittedAt: existing._meta.submittedAt,
      submittedBy: existing._meta.submittedBy ?? null,
      wkId: existing._meta.wkId ?? null,
      nr: existing._meta.nr,
      editedBy: req.user?.username || null,
      editedAt: new Date().toISOString(),
    },
  };
  if (Array.isArray(existing._meta.tags)) submission._meta.tags = existing._meta.tags;
  const error = fillSubmissionFields(viewDef, req, submission);
  if (error) return res.status(400).send(renderError(req, 400, error));

  // The WK side of this submission (the scope it belongs to when not standard).
  const wkSide = srcScope === STANDARD_SCOPE ? scope : srcScope;
  const targetScope = isStandardSubmission(viewDef, submission) ? STANDARD_SCOPE : wkSide;
  submission._meta.wkId = targetScope === STANDARD_SCOPE ? null : (viewDef.scope === 'global' ? null : targetScope);

  // The submission stays in its own version; only its scope may change.
  const srcDir = submissionDir(viewDef, srcScope, versionId);
  const targetDir = submissionDir(viewDef, targetScope, versionId);
  if (targetScope !== srcScope) {
    ensureMigrated(familyOf(def), targetScope);
    fs.mkdirSync(targetDir, { recursive: true });
    // Move sibling assets (e.g. <id>.map.png) with the submission.
    for (const f of fs.readdirSync(srcDir)) {
      if (f === submissionId + '.json') continue;
      if (f.startsWith(submissionId + '.')) {
        fs.renameSync(path.join(srcDir, f), path.join(targetDir, f));
      }
    }
    fs.rmSync(path.join(srcDir, submissionId + '.json'), { force: true });
    submission._meta.nr = familyScopeMaxNr(familyOf(def), targetScope) + 1; // numbers run per family+scope
  }
  fs.writeFileSync(path.join(targetDir, submissionId + '.json'), JSON.stringify(submission, null, 2));

  submission._meta.submissionId = submissionId;
  submission._meta.scope = targetScope;
  submission._meta.versionId = versionId;
  ensureArbeitsplaetze(viewDef, submission, wkSide, req.user?.username);
  handleMapSnapshot(viewDef, targetDir, submissionId, submission);

  const detailUrl = `/forms/${encodeURIComponent(familyOf(def))}/results/${encodeURIComponent(submissionId)}`;
  const wkParam = targetScope === STANDARD_SCOPE || viewDef.scope === 'global' ? '' : `?wk=${encodeURIComponent(targetScope)}`;
  res.redirect(detailUrl + wkParam);
}

// POST: Offizier+ toggle the modifyAllow flag. `?v=` selects which version's
// definition to toggle (the one currently in view); defaults to the base def.
export function toggleModifyAllow(req, res, formId) {
  const base = getForm(formId);
  if (!base) return res.status(404).send(renderError(req, 404, 'Formular nicht gefunden'));
  const role = req.user?.role || 'public';
  if (!hasAccess(role, 'Offizier')) {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  }
  const family = familyOf(base);
  const vId = typeof req.query.v === 'string' ? req.query.v : '';
  const vDef = vId ? getForm(vId) : null;
  const def = (vDef && familyOf(vDef) === family) ? vDef : getForm(family);
  if (isQuizDef(def) || family === WK_FORM_ID || !def._file) {
    return res.status(404).send(renderError(req, 404, 'Bearbeiten-Umschalter nicht verfügbar'));
  }
  try {
    const raw = JSON.parse(fs.readFileSync(def._file, 'utf8'));
    const next = !raw.modifyAllow;
    raw.modifyAllow = next;
    fs.writeFileSync(def._file, JSON.stringify(raw, null, 2));
    def.modifyAllow = next; // keep the in-memory form cache in sync
  } catch (e) {
    console.error(`modify-allow: failed to update ${formId}:`, e.message);
    return res.status(500).send(renderError(req, 500, 'Speichern fehlgeschlagen'));
  }
  const params = new URLSearchParams();
  if (def.scope !== 'global' && req.activeWk?.id) params.set('wk', req.activeWk.id);
  if (def.id !== family) params.set('v', def.id); // keep the same version in view
  const qs = params.toString() ? '?' + params.toString() : '';
  res.redirect(`/forms/${encodeURIComponent(family)}/results${qs}`);
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
