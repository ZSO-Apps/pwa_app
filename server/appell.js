// Appell module: per-WK attendance tracking, multiple importable lists.
//
// Data model (all file-based, one WK can hold several lists, e.g. KVK + two
// ZSOs each with their own day range):
//
//   data/appell/<wk-id>/lists/<list-id>/
//     meta.json            list name, version, importedAt, source, days[]
//     roster.json          active (newest) roster of this list
//     roster.draft.json    pending import awaiting confirmation
//     roster.<ts>.json     backup of the previous roster (kept on re-import)
//     tags.json            { pid: [tags] }   in-app, survives re-import
//     status/<pid>.json    { pid, days: { iso: { status, bemerkung, by, at } } }
//
// Person key (pid) is a stable hash of the Soz.-Vers.-Nr. so re-imports and the
// tags/status side-files line up without putting the AHV number in file paths.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseAppellXlsx } from './appell-import.js';
import { hasAccess } from './auth.js';
import { layout } from './templates/layout.js';
import { esc, logoAssetUrl } from './templates/shared.js';

const ROOT = path.resolve('data/appell');
const STATUS_VALUES = new Set(['anwesend', 'abwesend', 'krank']);

// --- path helpers (with traversal guards) ---------------------------------

// WK ids carry uppercase/underscores (e.g. 2026_06_15_WK_UNO26); list ids are
// lowercase slugs. Both must stay free of path separators / leading dots.
function safeId(id) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(id || '')) ? String(id) : null;
}

function wkBase(wkId) {
  const id = safeId(wkId);
  if (!id) return null;
  return path.join(ROOT, id);
}

function listsDir(wkId) {
  const base = wkBase(wkId);
  return base ? path.join(base, 'lists') : null;
}

function listDir(wkId, listId) {
  const dir = listsDir(wkId);
  const lid = safeId(listId);
  if (!dir || !lid) return null;
  const p = path.join(dir, lid);
  return p.startsWith(dir + path.sep) ? p : null;
}

function pidOf(sv, fallback) {
  const key = String(sv || fallback || '').trim();
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function slugify(name) {
  const base = String(name || '')
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'liste';
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// --- list / roster storage ------------------------------------------------

export function listLists(wkId) {
  const dir = listsDir(wkId);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((id) => {
      const meta = readJson(path.join(dir, id, 'meta.json'));
      const roster = readJson(path.join(dir, id, 'roster.json'));
      if (!meta) return null;
      return {
        id,
        name: meta.name || id,
        importedAt: meta.importedAt || null,
        version: meta.version || 1,
        days: roster?.days || meta.days || [],
        personCount: roster?.persons?.length || 0,
        hasDraft: fs.existsSync(path.join(dir, id, 'roster.draft.json')),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function uniqueListId(wkId, name) {
  const dir = listsDir(wkId);
  let base = slugify(name);
  let id = base;
  let n = 2;
  while (dir && fs.existsSync(path.join(dir, id))) id = `${base}-${n++}`;
  return id;
}

function buildRoster(parsed) {
  return {
    days: parsed.days,
    persons: parsed.persons.map((p) => ({ pid: pidOf(p.sv, p.name), ...p })),
  };
}

// Diff a freshly parsed roster against the currently active one (for re-imports).
function diffRoster(current, next) {
  if (!current) return null;
  const byPid = (r) => new Map(r.persons.map((p) => [p.pid, p]));
  const cur = byPid(current);
  const nxt = byPid(next);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [pid, p] of nxt) {
    if (!cur.has(pid)) { added.push(p.name); continue; }
    const before = cur.get(pid).aufgeboten || [];
    const after = p.aufgeboten || [];
    if (before.join(',') !== after.join(',')) {
      const gained = after.filter((d) => !before.includes(d));
      const lost = before.filter((d) => !after.includes(d));
      changed.push({ name: p.name, gained, lost });
    }
  }
  for (const [pid, p] of cur) if (!nxt.has(pid)) removed.push(p.name);
  return { added, removed, changed };
}

// Parse an uploaded xlsx into a draft for `listId` (existing) or a new list.
export function importDraft(wkId, { listId, name, buffer, sourceName }) {
  const parsed = parseAppellXlsx(buffer);
  const isNew = !listId;
  const lid = isNew ? uniqueListId(wkId, name) : safeId(listId);
  const dir = listDir(wkId, lid);
  if (!dir) throw new Error('Ungültige Liste.');
  const roster = buildRoster(parsed);
  const current = readJson(path.join(dir, 'roster.json'));
  const meta = readJson(path.join(dir, 'meta.json')) || {};
  const draftMeta = {
    name: name || meta.name || lid,
    source: sourceName || '',
    parsedAt: new Date().toISOString(),
    days: roster.days,
    personCount: roster.persons.length,
  };
  writeJson(path.join(dir, 'roster.draft.json'), { meta: draftMeta, roster });
  return {
    listId: lid,
    isNew,
    meta: draftMeta,
    diff: diffRoster(current, roster),
  };
}

export function readDraft(wkId, listId) {
  const dir = listDir(wkId, listId);
  if (!dir) return null;
  const draft = readJson(path.join(dir, 'roster.draft.json'));
  if (!draft) return null;
  const current = readJson(path.join(dir, 'roster.json'));
  return { ...draft, diff: diffRoster(current, draft.roster) };
}

// Promote the draft to the active roster, keeping a backup of the old one.
export function confirmDraft(wkId, listId) {
  const dir = listDir(wkId, listId);
  if (!dir) throw new Error('Ungültige Liste.');
  const draftFile = path.join(dir, 'roster.draft.json');
  const draft = readJson(draftFile);
  if (!draft) throw new Error('Kein Entwurf vorhanden.');
  const rosterFile = path.join(dir, 'roster.json');
  const metaFile = path.join(dir, 'meta.json');
  const prevMeta = readJson(metaFile) || {};
  if (fs.existsSync(rosterFile)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(rosterFile, path.join(dir, `roster.${ts}.json`));
  }
  writeJson(rosterFile, draft.roster);
  writeJson(metaFile, {
    name: draft.meta.name,
    source: draft.meta.source,
    importedAt: new Date().toISOString(),
    version: (prevMeta.version || 0) + 1,
    days: draft.roster.days,
  });
  fs.rmSync(draftFile, { force: true });
  return { listId };
}

export function deleteList(wkId, listId) {
  const dir = listDir(wkId, listId);
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// --- tags -----------------------------------------------------------------

function tagsFile(wkId, listId) {
  const dir = listDir(wkId, listId);
  return dir ? path.join(dir, 'tags.json') : null;
}

function readTags(wkId, listId) {
  const file = tagsFile(wkId, listId);
  return (file && readJson(file)) || {};
}

export function setPersonTags(wkId, listId, pid, tags) {
  const file = tagsFile(wkId, listId);
  if (!file) throw new Error('Ungültige Liste.');
  const all = readTags(wkId, listId);
  const clean = [...new Set((Array.isArray(tags) ? tags : [])
    .map((t) => String(t).trim()).filter(Boolean))].slice(0, 30);
  if (clean.length) all[pid] = clean; else delete all[pid];
  writeJson(file, all);
  return clean;
}

// --- status ---------------------------------------------------------------

function statusFile(wkId, listId, pid) {
  const dir = listDir(wkId, listId);
  if (!dir || !/^[a-f0-9]{12}$/.test(String(pid))) return null;
  return path.join(dir, 'status', pid + '.json');
}

function readStatus(wkId, listId, pid) {
  const file = statusFile(wkId, listId, pid);
  return (file && readJson(file)) || { pid, days: {} };
}

export function setStatus(wkId, listId, pid, day, status, bemerkung, by) {
  const file = statusFile(wkId, listId, pid);
  if (!file) throw new Error('Ungültige Person.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) throw new Error('Ungültiges Datum.');
  const norm = STATUS_VALUES.has(status) ? status : '';
  const rec = readStatus(wkId, listId, pid);
  const note = String(bemerkung || '').slice(0, 500);
  if (!norm && !note) delete rec.days[day];
  else rec.days[day] = { status: norm, bemerkung: note, by: by || '', at: new Date().toISOString() };
  writeJson(file, rec);
  return rec.days[day] || { status: '', bemerkung: '' };
}

// --- aggregation for the UI ----------------------------------------------

export function buildListData(wkId, listId) {
  const dir = listDir(wkId, listId);
  if (!dir) return null;
  const roster = readJson(path.join(dir, 'roster.json'));
  const meta = readJson(path.join(dir, 'meta.json'));
  if (!roster || !meta) return null;
  const tags = readTags(wkId, listId);
  const bereiche = new Set();
  const funktionen = new Set();
  const grade = new Set();
  const tagSet = new Set();
  const persons = roster.persons.map((p) => {
    if (p.bereich) bereiche.add(p.bereich);
    if (p.funktion) funktionen.add(p.funktion);
    if (p.grad) grade.add(p.grad);
    const ptags = tags[p.pid] || [];
    ptags.forEach((t) => tagSet.add(t));
    const status = readStatus(wkId, listId, p.pid).days;
    return {
      listId,
      listName: meta.name,
      pid: p.pid,
      name: p.name,
      grad: p.grad,
      bereich: p.bereich,
      funktion: p.funktion,
      jg: p.jg,
      beruf: p.beruf,
      ort: p.ort,
      einrueckort: p.einrueckort,
      mobile: p.mobile,
      email: p.email,
      aufgeboten: p.aufgeboten,
      tags: ptags,
      status,
    };
  });
  return {
    list: { id: listId, name: meta.name, days: roster.days, importedAt: meta.importedAt },
    days: roster.days,
    persons,
    filters: {
      bereiche: [...bereiche].sort(),
      funktionen: [...funktionen].sort(),
      grade: [...grade].sort(),
      tags: [...tagSet].sort(),
      listen: [meta.name],
    },
  };
}

// Combined view across all lists of a WK ("Alle Appelllisten"). Days are the
// sorted union. People that appear in several lists (same Soz.-Vers.-Nr. ⇒ same
// pid) are merged into a single row: their list names are joined ("KVK Brugg +
// WK Brugg"), aufgebotene Tage/Status/Tags are unioned, and a `dayList` map
// remembers which list owns each day so status/tag writes route to the right
// list. Per-list details (e.g. differing Einrückorte) are kept in `sources` for
// the detail view.
export function buildCombinedData(wkId) {
  const lists = listLists(wkId);
  if (!lists.length) return null;
  const dayset = new Set();
  const byPid = new Map();
  const order = [];
  const f = { bereiche: new Set(), funktionen: new Set(), grade: new Set(), tags: new Set(), listen: new Set() };
  for (const l of lists) {
    const data = buildListData(wkId, l.id);
    if (!data) continue;
    data.days.forEach((d) => dayset.add(d));
    data.filters.bereiche.forEach((x) => f.bereiche.add(x));
    data.filters.funktionen.forEach((x) => f.funktionen.add(x));
    data.filters.grade.forEach((x) => f.grade.add(x));
    data.filters.tags.forEach((x) => f.tags.add(x));
    f.listen.add(l.name);
    for (const p of data.persons) {
      let m = byPid.get(p.pid);
      if (!m) {
        m = {
          pid: p.pid,
          name: p.name, grad: p.grad, bereich: p.bereich, funktion: p.funktion,
          jg: p.jg, beruf: p.beruf, ort: p.ort, mobile: p.mobile, email: p.email,
          listId: p.listId,        // primary list (first occurrence)
          listIds: [], listNames: [],
          sources: [],             // [{ listId, listName, einrueckort }]
          aufgeboten: [],
          dayList: {},             // iso -> owning listId
          status: {},
          tags: [],
        };
        byPid.set(p.pid, m);
        order.push(m);
      }
      m.listIds.push(p.listId);
      m.listNames.push(p.listName);
      m.sources.push({ listId: p.listId, listName: p.listName, einrueckort: p.einrueckort });
      for (const iso of p.aufgeboten || []) {
        if (m.dayList[iso] == null) {        // first list to claim the day owns it
          m.dayList[iso] = p.listId;
          m.aufgeboten.push(iso);
          if (p.status[iso]) m.status[iso] = p.status[iso];
        }
      }
      for (const t of p.tags || []) if (!m.tags.includes(t)) m.tags.push(t);
      // Fill identity fields a later list might have but the first one lacked.
      for (const k of ['grad', 'bereich', 'funktion', 'jg', 'beruf', 'ort', 'mobile', 'email']) {
        if (!m[k] && p[k]) m[k] = p[k];
      }
    }
  }
  const persons = order.map((m) => ({
    ...m,
    aufgeboten: m.aufgeboten.sort(),
    listName: m.listNames.join(' + '),
  }));
  const days = [...dayset].sort();
  return {
    list: { id: '__all', name: 'Alle Appelllisten', days },
    days,
    persons,
    filters: {
      bereiche: [...f.bereiche].sort(),
      funktionen: [...f.funktionen].sort(),
      grade: [...f.grade].sort(),
      tags: [...f.tags].sort(),
      listen: [...f.listen].sort(),
    },
  };
}

// =========================================================================
// Express handlers
// =========================================================================

const IMPORT_ROLE = 'Offizier';
const EDIT_ROLE = 'Unteroffizier';

function requireWk(req, res) {
  if (!req.activeWk) {
    res.status(409).json({ error: 'Bitte zuerst einen WK auswählen oder anlegen (Admin → WK erfassen).' });
    return null;
  }
  return req.activeWk.id;
}

function ensureRole(req, res, role, json = true) {
  if (!hasAccess(req.user?.role, role)) {
    if (json) res.status(403).json({ error: 'Zugriff verweigert' });
    else res.status(403).send('Zugriff verweigert');
    return false;
  }
  return true;
}

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
}

// GET /appell — main overview page (client-rendered).
export function renderAppellPage(req, res) {
  if (!hasAccess(req.user?.role, EDIT_ROLE)) {
    if (!req.user) return res.redirect('/login?next=/appell');
    return res.status(403).send('Zugriff verweigert');
  }
  if (!req.activeWk) {
    const body = `<article class="content"><p><a href="/" class="back">← Zurück</a></p>
      <h1>Appell</h1><p>Bitte zuerst einen WK auswählen oder anlegen (<a href="/k/admin">Admin → WK erfassen</a>).</p></article>`;
    return res.status(409).send(layout(req, { title: 'Appell', body }));
  }
  const canImport = hasAccess(req.user?.role, IMPORT_ROLE);
  const body = `<article class="content appell-page" data-appell data-today="${esc(todayIso())}" data-can-import="${canImport}" data-print-logo="${esc(logoAssetUrl('print'))}" data-wk-id="${esc(req.activeWk?.id || '')}" data-wk-label="${esc(req.activeWk?.label || '')}">
    <p><a href="/" class="back">← Zurück zur Übersicht</a></p>
    <div class="content-header"><h1>Appell</h1></div>
    <div class="appell-root" data-appell-root><p class="muted">Wird geladen …</p></div>
  </article>`;
  res.send(layout(req, { title: 'Appell', body, extraHead: `<script src="/client/appell.js" defer></script>` }));
}

// GET /api/appell/lists
export function apiLists(req, res) {
  if (!ensureRole(req, res, EDIT_ROLE)) return;
  const wkId = requireWk(req, res);
  if (!wkId) return;
  res.json({ lists: listLists(wkId), today: todayIso() });
}

// GET /api/appell/data?list=<id>
export function apiData(req, res) {
  if (!ensureRole(req, res, EDIT_ROLE)) return;
  const wkId = requireWk(req, res);
  if (!wkId) return;
  const lists = listLists(wkId);
  const base = { lists, today: todayIso(), canEditTags: hasAccess(req.user?.role, EDIT_ROLE) };
  if (!lists.length) return res.json({ ...base, list: null, persons: [], days: [] });
  // Default and "__all" => combined view across every list.
  const wanted = req.query.list;
  if (!wanted || wanted === '__all') {
    return res.json({ ...buildCombinedData(wkId), ...base });
  }
  const listId = safeId(wanted);
  const data = listId && buildListData(wkId, listId);
  if (!data) return res.status(404).json({ error: 'Liste nicht gefunden.' });
  res.json({ ...data, ...base });
}

// POST /api/appell/status
export function apiSetStatus(req, res) {
  const wkId = requireWk(req, res);
  if (!wkId) return;
  if (!ensureRole(req, res, EDIT_ROLE)) return;
  const { list, pid, day, status, bemerkung } = req.body || {};
  if (!safeId(list)) return res.status(400).json({ error: 'Liste fehlt.' });
  try {
    const result = setStatus(wkId, list, pid, day, status, bemerkung, req.user?.username);
    res.json({ ok: true, day: result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// POST /api/appell/tags
export function apiSetTags(req, res) {
  const wkId = requireWk(req, res);
  if (!wkId) return;
  if (!ensureRole(req, res, EDIT_ROLE)) return;
  const { list, pid, tags } = req.body || {};
  if (!safeId(list)) return res.status(400).json({ error: 'Liste fehlt.' });
  try {
    const clean = setPersonTags(wkId, list, pid, tags);
    res.json({ ok: true, tags: clean });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// GET /appell/import — upload form (Offizier+)
export function renderImportPage(req, res, { error = '' } = {}) {
  if (!ensureRole(req, res, IMPORT_ROLE, false)) return;
  if (!req.activeWk) {
    const body = `<article class="content"><p><a href="/appell" class="back">← Zurück</a></p>
      <h1>Liste importieren</h1><p>Bitte zuerst einen WK auswählen.</p></article>`;
    return res.status(409).send(layout(req, { title: 'Liste importieren', body }));
  }
  const lists = listLists(req.activeWk.id);
  const options = lists.map((l) => `<option value="${esc(l.id)}">${esc(l.name)} (v${l.version}, ${l.personCount} Pers.)</option>`).join('');
  const body = `<article class="content appell-import" data-appell-import>
    <p><a href="/appell" class="back">← Zurück zum Appell</a></p>
    <h1>Appell-Liste importieren</h1>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <p class="muted">Excel-Appellliste (.xlsx) hochladen. Eine neue Liste anlegen (z.B. „KVK", „ZSO Baden") oder eine bestehende Liste mit den aktuellsten Dienstverschiebungen aktualisieren. Vor dem Übernehmen wird ein Entwurf mit Änderungsübersicht angezeigt.</p>
    <form data-import-form data-online-only-form>
      <fieldset>
        <legend>Ziel</legend>
        <label><input type="radio" name="target" value="__new" checked> Neue Liste</label>
        <label>Name: <input type="text" name="name" placeholder="z.B. ZSO Baden"></label>
        ${lists.length ? `<label><input type="radio" name="target" value="__update"> Bestehende Liste aktualisieren</label>
        <label>Liste: <select name="list">${options}</select></label>` : ''}
      </fieldset>
      <label class="file-pick">Excel-Datei: <input type="file" name="file" accept=".xlsx" required></label>
      <button type="submit" class="btn" data-online-only="true">Hochladen &amp; prüfen</button>
      <span class="import-status muted" data-import-status></span>
    </form>
  </article>`;
  res.send(layout(req, { title: 'Liste importieren', body, extraHead: `<script src="/client/appell.js" defer></script>` }));
}

// POST /appell/import — raw xlsx body; ?target=__new&name=.. or ?list=<id>
export function handleImport(req, res) {
  if (!ensureRole(req, res, IMPORT_ROLE)) return;
  const wkId = requireWk(req, res);
  if (!wkId) return;
  const buffer = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buffer || !buffer.length) return res.status(400).json({ error: 'Keine Datei empfangen.' });
  const target = req.query.target;
  const listId = target === '__update' ? safeId(req.query.list) : null;
  const name = String(req.query.name || '').trim() || (listId ? null : 'Liste');
  if (target === '__update' && !listId) return res.status(400).json({ error: 'Liste fehlt.' });
  try {
    const result = importDraft(wkId, { listId, name, buffer, sourceName: req.query.filename });
    res.json({ ok: true, ...result, reviewUrl: `/appell/review?list=${encodeURIComponent(result.listId)}` });
  } catch (e) {
    res.status(400).json({ error: 'Import fehlgeschlagen: ' + e.message });
  }
}

// GET /appell/review?list=<id> — show draft + diff, confirm/discard
export function renderReviewPage(req, res) {
  if (!ensureRole(req, res, IMPORT_ROLE, false)) return;
  const wkId = requireWk(req, res);
  if (!wkId) return;
  const listId = safeId(req.query.list);
  const draft = listId && readDraft(wkId, listId);
  if (!draft) {
    const body = `<article class="content"><p><a href="/appell/import" class="back">← Zurück</a></p>
      <h1>Entwurf</h1><p>Kein Entwurf vorhanden.</p></article>`;
    return res.status(404).send(layout(req, { title: 'Entwurf', body }));
  }
  const d = draft.diff;
  const diffHtml = !d ? '<p class="muted">Neue Liste — keine Vorgängerversion.</p>' : `
    <ul class="diff-summary">
      <li><strong>${d.added.length}</strong> neu${d.added.length ? ': ' + esc(d.added.join(', ')) : ''}</li>
      <li><strong>${d.removed.length}</strong> entfallen${d.removed.length ? ': ' + esc(d.removed.join(', ')) : ''}</li>
      <li><strong>${d.changed.length}</strong> mit geänderten Tagen</li>
    </ul>
    ${d.changed.length ? '<ul class="diff-changed">' + d.changed.map((c) =>
      `<li>${esc(c.name)}: ${c.gained.length ? '+' + esc(c.gained.join(', ')) : ''} ${c.lost.length ? '−' + esc(c.lost.join(', ')) : ''}</li>`).join('') + '</ul>' : ''}`;
  const rows = draft.roster.persons.map((p) =>
    `<tr><td>${esc(p.name)}</td><td>${esc(p.grad)}</td><td>${esc(p.bereich)}</td><td>${esc(p.funktion)}</td><td>${p.aufgeboten.length}</td></tr>`).join('');
  const body = `<article class="content appell-review">
    <p><a href="/appell/import" class="back">← Zurück</a></p>
    <h1>Entwurf prüfen: ${esc(draft.meta.name)}</h1>
    <p class="muted">${draft.roster.persons.length} Personen, ${draft.roster.days.length} Tage (${esc(draft.roster.days[0] || '')} – ${esc(draft.roster.days[draft.roster.days.length - 1] || '')}). Quelle: ${esc(draft.meta.source || '—')}.</p>
    <h2>Änderungen</h2>
    ${diffHtml}
    <h2>Personen</h2>
    <table class="appell-table"><thead><tr><th>Name</th><th>Grad</th><th>Bereich</th><th>Funktion</th><th>Tage</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="review-actions">
      <form method="POST" action="/appell/confirm?list=${encodeURIComponent(listId)}" data-online-only-form><button type="submit" class="btn btn-primary" data-online-only="true">Übernehmen</button></form>
      <form method="POST" action="/appell/discard?list=${encodeURIComponent(listId)}" data-online-only-form><button type="submit" class="btn" data-online-only="true">Entwurf verwerfen</button></form>
    </div>
  </article>`;
  res.send(layout(req, { title: 'Entwurf prüfen', body }));
}

// POST /appell/confirm?list=<id>
export function handleConfirm(req, res) {
  if (!ensureRole(req, res, IMPORT_ROLE, false)) return;
  const wkId = requireWk(req, res);
  if (!wkId) return;
  const listId = safeId(req.query.list);
  try {
    confirmDraft(wkId, listId);
    res.redirect('/appell?list=' + encodeURIComponent(listId));
  } catch (e) {
    renderImportPage(req, res, { error: e.message });
  }
}

// POST /appell/discard?list=<id>
export function handleDiscard(req, res) {
  if (!ensureRole(req, res, IMPORT_ROLE, false)) return;
  const wkId = requireWk(req, res);
  if (!wkId) return;
  const listId = safeId(req.query.list);
  const dir = listId && listDir(wkId, listId);
  if (dir) {
    fs.rmSync(path.join(dir, 'roster.draft.json'), { force: true });
    // A brand-new list whose draft is discarded before any confirm has no
    // roster.json yet — drop the empty list folder entirely.
    if (!fs.existsSync(path.join(dir, 'roster.json'))) fs.rmSync(dir, { recursive: true, force: true });
  }
  res.redirect('/appell/import');
}

// POST /appell/list/delete?list=<id>
export function handleDeleteList(req, res) {
  if (!ensureRole(req, res, IMPORT_ROLE, false)) return;
  const wkId = requireWk(req, res);
  if (!wkId) return;
  deleteList(wkId, safeId(req.query.list));
  res.redirect('/appell');
}
