// Transport module: per-WK dispatch ("Transportzentrale").
//
// Kader (Uof+) turns Transport-Bestellungen into Fahraufträge (orders), assigns
// them to vehicles and named trailers, and oversees the whole fleet on a per-day
// timeline (15-min slots). Drivers (Fahrer+) mark abgefahren/angekommen with a
// comment; from those timestamps the overview derives a plan-vs-actual view.
//
// Data model (all file-based, per WK; data/transport/ is runtime data, gitignored):
//
//   data/transport/<wk-id>/
//     fleet.json                 { vehicles:[...], trailers:[...] }
//     orders/<order-id>.json     one editable Fahrauftrag per file
//     dispatched.json            { <bestellung-submissionId>: [orderId,...] }
//
// The fleet is generated on the fly: typing a vehicle/trailer name on an order
// auto-adds it to the fleet for the whole WK. A lightweight fleet manager lets
// Uof+ add resources and mark them unavailable on specific dates.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hasAccess } from './auth.js';
import { layout } from './templates/layout.js';
import { esc, logoAssetUrl } from './templates/shared.js';
import { readSubmissions } from './forms.js';

const ROOT = path.resolve('data/transport');
const BESTELLUNG_FORM = 'transport-bestellung';

const VIEW_ROLE = 'Fahrer';        // see overview + orders
const EDIT_ROLE = 'Unteroffizier'; // dispatch, assign, manage fleet
const DRIVER_ROLE = 'Fahrer';      // mark abgefahren / angekommen

// Fail-safe grace (minutes): a running order (abgefahren, no angekommen) never
// occupies more than its planned end + GRACE, so a forgotten "angekommen" does
// not make a vehicle look blocked for 24h.
const GRACE = 60;

const STATUS = new Set(['geplant', 'abgefahren', 'angekommen', 'abgeschlossen']);
const RICHTUNG = new Set(['einfach', 'hin', 'rueck']);

// --- path helpers (with traversal guards) ---------------------------------

function safeId(id) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(id || '')) ? String(id) : null;
}

function wkBase(wkId) {
  const id = safeId(wkId);
  return id ? path.join(ROOT, id) : null;
}

function ordersDir(wkId) {
  const base = wkBase(wkId);
  return base ? path.join(base, 'orders') : null;
}

function orderFile(wkId, orderId) {
  const dir = ordersDir(wkId);
  const oid = safeId(orderId);
  if (!dir || !oid) return null;
  const p = path.join(dir, oid + '.json');
  return p.startsWith(dir + path.sep) ? p : null;
}

function fleetFile(wkId) {
  const base = wkBase(wkId);
  return base ? path.join(base, 'fleet.json') : null;
}

function dispatchedFile(wkId) {
  const base = wkBase(wkId);
  return base ? path.join(base, 'dispatched.json') : null;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function slugify(name) {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'r';
}

// --- time helpers (Europe/Zurich) -----------------------------------------

function zurich(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  let h = Number(p.hour);
  if (h === 24) h = 0; // some environments render midnight as 24
  return { iso: `${p.year}-${p.month}-${p.day}`, minutes: h * 60 + Number(p.minute) };
}

function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  return Math.min(1439, Math.max(0, Number(m[1]) * 60 + Number(m[2])));
}

// Minute-of-day of an ISO timestamp, clamped to the given calendar day.
function tsMinOnDay(iso, day) {
  if (!iso) return null;
  const z = zurich(new Date(iso));
  if (z.iso < day) return 0;
  if (z.iso > day) return 1440;
  return z.minutes;
}

function isDateIso(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function isHhmm(s) {
  return /^\d{1,2}:\d{2}$/.test(String(s || ''));
}

// Build an ISO instant for a wall-clock time on a given day in Europe/Zurich,
// so a manually entered "abgefahren um 09:30" round-trips through zurich().
function zurichOffsetMinutes(at) {
  const d = new Date(at);
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const zur = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));
  return Math.round((zur - utc) / 60000);
}
function zurichIso(day, hhmm) {
  if (!isDateIso(day) || !isHhmm(hhmm)) return new Date().toISOString();
  const baseUtc = Date.parse(`${day}T${hhmm.padStart(5, '0')}:00Z`);
  const off = zurichOffsetMinutes(baseUtc);
  return new Date(baseUtc - off * 60000).toISOString();
}

// --- fleet ----------------------------------------------------------------

function emptyFleet() {
  return { vehicles: [], trailers: [] };
}

function readFleet(wkId) {
  const f = readJson(fleetFile(wkId)) || emptyFleet();
  f.vehicles = Array.isArray(f.vehicles) ? f.vehicles : [];
  f.trailers = Array.isArray(f.trailers) ? f.trailers : [];
  return f;
}

function fleetList(fleet, kind) {
  return kind === 'trailer' ? fleet.trailers : fleet.vehicles;
}

function findByName(list, name) {
  const n = String(name || '').trim().toLowerCase();
  return list.find((r) => String(r.name).trim().toLowerCase() === n);
}

function uniqueResId(fleet, base) {
  const all = [...fleet.vehicles, ...fleet.trailers].map((r) => r.id);
  let id = base;
  for (let n = 2; all.includes(id); n++) id = `${base}-${n}`;
  return id;
}

// Resolve a typed resource name to an existing id, creating it on the fly
// (available for the whole WK) when it does not exist yet. Mutates `fleet`.
function ensureResource(fleet, kind, name, { trailerType } = {}) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const list = fleetList(fleet, kind);
  const existing = findByName(list, clean);
  if (existing) {
    if (kind === 'trailer' && trailerType && !existing.trailerType) existing.trailerType = trailerType;
    return existing.id;
  }
  const res = { id: uniqueResId(fleet, slugify(clean)), name: clean, kind, unavailable: [] };
  if (kind === 'trailer') res.trailerType = trailerType || '';
  list.push(res);
  return res.id;
}

function resourceUnavailableOn(res, day) {
  return (res.unavailable || []).some((r) => {
    const from = r.from || r.to;
    const to = r.to || r.from;
    return from && to && day >= from && day <= to;
  });
}

// --- orders ---------------------------------------------------------------

function newOrderId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
}

function listOrders(wkId) {
  const dir = ordersDir(wkId);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.includes('.tmp'))
    .map((f) => readJson(path.join(dir, f)))
    .filter(Boolean);
}

function readOrder(wkId, orderId) {
  const file = orderFile(wkId, orderId);
  return file ? readJson(file) : null;
}

function writeOrder(wkId, order) {
  const file = orderFile(wkId, order.id);
  if (!file) throw new Error('Ungültiger Auftrag.');
  writeJson(file, order);
}

function normTrailerInput(raw, fleet, existing = []) {
  const prevById = new Map((existing || []).map((t) => [t.id, t]));
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const t of arr) {
    const id = ensureResource(fleet, 'trailer', t.name || t.id, { trailerType: t.trailerType });
    if (!id) continue;
    if (out.find((x) => x.id === id)) continue;
    const stays = !!t.bleibtAmZielort;
    const prev = prevById.get(id);
    out.push({
      id,
      bleibtAmZielort: stays,
      standort: t.standort ? String(t.standort).slice(0, 120) : null,
      // keep an existing release time as long as the trailer still stays
      releasedAt: stays ? (t.releasedAt || prev?.releasedAt || null) : null,
    });
  }
  return out;
}

function applyOrderFields(order, body, fleet) {
  if (body.datum !== undefined) order.datum = isDateIso(body.datum) ? body.datum : order.datum;
  if (body.plannedStart !== undefined) order.plannedStart = toMin(body.plannedStart) !== null ? body.plannedStart : '';
  if (body.plannedEnd !== undefined) order.plannedEnd = toMin(body.plannedEnd) !== null ? body.plannedEnd : '';
  for (const k of ['abfahrtsort', 'zielort', 'fahrtTyp', 'beschreibung', 'dispoKommentar']) {
    if (body[k] !== undefined) order[k] = String(body[k] ?? '').slice(0, 2000);
  }
  if (body.anzahlPersonen !== undefined) {
    const n = parseInt(body.anzahlPersonen, 10);
    order.anzahlPersonen = Number.isFinite(n) ? n : null;
  }
  if (body.richtung !== undefined) order.richtung = RICHTUNG.has(body.richtung) ? body.richtung : 'einfach';
  if (body.vehicle !== undefined) {
    order.vehicleId = body.vehicle ? ensureResource(fleet, 'vehicle', body.vehicle) : null;
  }
  if (body.trailers !== undefined) order.trailers = normTrailerInput(body.trailers, fleet, order.trailers);
}

function createOrder(wkId, body, user) {
  const fleet = readFleet(wkId);
  const order = {
    id: newOrderId(),
    bestellungId: safeId(body.bestellungId) || null,
    datum: isDateIso(body.datum) ? body.datum : null,
    plannedStart: toMin(body.plannedStart) !== null ? body.plannedStart : '',
    plannedEnd: toMin(body.plannedEnd) !== null ? body.plannedEnd : '',
    abfahrtsort: '', zielort: '', anzahlPersonen: null,
    fahrtTyp: '', richtung: 'einfach', beschreibung: '',
    vehicleId: null, trailers: [], dispoKommentar: '',
    fahrerName: '', fahrerMobile: '',
    status: 'geplant',
    departedAt: null, departedComment: '',
    arrivedAt: null, arrivedComment: '',
    _meta: { createdBy: user || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };
  applyOrderFields(order, body, fleet);
  writeJson(fleetFile(wkId), fleet);
  writeOrder(wkId, order);
  if (order.bestellungId) linkDispatched(wkId, order.bestellungId, order.id);
  return order;
}

function updateOrder(wkId, orderId, body, user) {
  const order = readOrder(wkId, orderId);
  if (!order) throw new Error('Auftrag nicht gefunden.');
  const fleet = readFleet(wkId);
  applyOrderFields(order, body, fleet);
  order._meta = { ...(order._meta || {}), updatedBy: user || null, updatedAt: new Date().toISOString() };
  writeJson(fleetFile(wkId), fleet);
  writeOrder(wkId, order);
  return order;
}

function deleteOrder(wkId, orderId) {
  const file = orderFile(wkId, orderId);
  if (file && fs.existsSync(file)) fs.rmSync(file, { force: true });
  unlinkDispatched(wkId, orderId);
}

// Driver action: abgefahren / angekommen. `time` (HH:MM) lets a driver enter or
// correct the time by hand (e.g. forgot to tap the button); otherwise "now".
function setOrderStatus(wkId, orderId, action, comment, user, time, fahrer) {
  const order = readOrder(wkId, orderId);
  if (!order) throw new Error('Auftrag nicht gefunden.');
  const note = String(comment || '').slice(0, 500);
  const now = new Date().toISOString();
  const stamp = isHhmm(time) ? zurichIso(order.datum, time) : now;
  // Driver identity travels with every driver action and is stored on the order
  // (so the dispatcher and the printout see who drove).
  if (fahrer && typeof fahrer === 'object') {
    if (fahrer.name !== undefined) order.fahrerName = String(fahrer.name || '').slice(0, 120);
    if (fahrer.mobile !== undefined) order.fahrerMobile = String(fahrer.mobile || '').slice(0, 60);
  }
  if (action === 'driverinfo') {
    // name/mobile only — no timestamp change
  } else if (action === 'abgefahren') {
    order.departedAt = stamp;
    if (comment !== undefined) order.departedComment = note;
    if (order.status === 'geplant') order.status = 'abgefahren';
  } else if (action === 'angekommen') {
    order.arrivedAt = stamp;
    if (comment !== undefined) order.arrivedComment = note;
    order.status = 'angekommen';
  } else if (action === 'abgeschlossen') {
    order.status = 'abgeschlossen';
  } else if (action === 'reset') {
    order.departedAt = null; order.arrivedAt = null;
    order.departedComment = ''; order.arrivedComment = '';
    order.status = 'geplant';
  } else {
    throw new Error('Unbekannte Aktion.');
  }
  order._meta = { ...(order._meta || {}), updatedBy: user || null, updatedAt: now };
  writeOrder(wkId, order);
  return order;
}

// Release a parked trailer at a given day+time: the grey "stays here" block then
// ends at that time. `clear:true` undoes a release (trailer keeps standing).
// Fail-safe correction if the leadership got it wrong.
function releaseTrailer(wkId, orderId, trailerId, { day, time, clear } = {}) {
  const order = readOrder(wkId, orderId);
  if (!order) throw new Error('Auftrag nicht gefunden.');
  const t = (order.trailers || []).find((x) => x.id === trailerId);
  if (!t) throw new Error('Anhänger nicht gefunden.');
  if (clear) {
    t.releasedAt = null;
  } else {
    const d = isDateIso(day) ? day : order.datum;
    const hhmm = isHhmm(time) ? String(time).padStart(5, '0') : zurich(new Date()).iso === d ? hhmmStr(zurich(new Date()).minutes) : '23:59';
    t.releasedAt = `${d}T${hhmm}`;
  }
  writeOrder(wkId, order);
  return order;
}

function hhmmStr(min) {
  const m = Math.max(0, Math.min(1439, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// --- dispatched mapping ---------------------------------------------------

function readDispatched(wkId) {
  return readJson(dispatchedFile(wkId)) || {};
}

function linkDispatched(wkId, bestellungId, orderId) {
  const map = readDispatched(wkId);
  const arr = new Set(map[bestellungId] || []);
  arr.add(orderId);
  map[bestellungId] = [...arr];
  writeJson(dispatchedFile(wkId), map);
}

function unlinkDispatched(wkId, orderId) {
  const map = readDispatched(wkId);
  let changed = false;
  for (const key of Object.keys(map)) {
    const next = (map[key] || []).filter((id) => id !== orderId);
    if (next.length !== (map[key] || []).length) changed = true;
    if (next.length) map[key] = next; else delete map[key];
  }
  if (changed) writeJson(dispatchedFile(wkId), map);
}

// --- fail-safe bar computation -------------------------------------------

// Effective start/end minutes for the timeline, clamping running orders.
function computeBar(order, day, todayIso, nowMin) {
  const planStart = toMin(order.plannedStart) ?? 480;       // default 08:00
  const planEnd = toMin(order.plannedEnd) ?? (planStart + 60);
  const departed = tsMinOnDay(order.departedAt, day);
  const arrived = tsMinOnDay(order.arrivedAt, day);

  let start = departed != null ? departed : planStart;
  let end;
  let overdue = false;
  let phase = 'geplant';

  if (arrived != null) {
    end = arrived;
    phase = 'abgeschlossen';
  } else if (departed != null) {
    phase = 'laufend';
    const cap = planEnd + GRACE;
    const ref = day === todayIso ? nowMin : planEnd;
    end = Math.min(Math.max(ref, start + 15), cap);
    overdue = ref > cap;
  } else {
    end = planEnd;
  }
  if (end <= start) end = start + 15;
  return {
    planStart, planEnd,
    start, end, phase, overdue,
    departedMin: departed, arrivedMin: arrived,
  };
}

// --- aggregation for the UI ----------------------------------------------

function openBestellungen(wkId) {
  const dispatched = readDispatched(wkId);
  return readSubmissions(BESTELLUNG_FORM, wkId)
    .filter((s) => !dispatched[s._meta.submissionId])
    .map((s) => ({
      id: s._meta.submissionId,
      name: s.name || '',
      datum: s.datum || '',
      zeit: s.zeit || '',
      abfahrtsort: s.abfahrtsort || '',
      zielort: s.zielort || '',
      anzahlPersonen: s.anzahlPersonen || '',
      fahrtTyp: s.fahrtTyp || '',
      beschreibung: s.beschreibung || '',
      mobile: s.mobile || '',
      submittedAt: s._meta.submittedAt || null,
    }))
    .sort((a, b) => String(a.datum).localeCompare(String(b.datum)) || String(a.zeit).localeCompare(String(b.zeit)));
}

// Parse a trailer release stamp ("YYYY-MM-DDTHH:MM") into { date, min }.
function parseRelease(rel) {
  if (!rel || typeof rel !== 'string') return null;
  const [date, time] = rel.split('T');
  if (!isDateIso(date)) return null;
  return { date, min: toMin(time) ?? 1440 };
}

// Grey "stays here" block for a trailer on a specific day: from arrival (on the
// arrival day) or 00:00 (later days) until the release time (on the release day),
// 24:00 otherwise. Returns null if the trailer isn't parked across that day.
// Carries the release state so the UI can offer "freigeben" / "Freigabe aufheben".
function parkingForDay(orders, trailerId, day) {
  let seg = null;
  for (const o of orders) {
    const t = (o.trailers || []).find((x) => x.id === trailerId && x.bleibtAmZielort);
    if (!t || !isDateIso(o.datum) || o.datum > day) continue;
    const rel = parseRelease(t.releasedAt);
    if (rel && rel.date < day) continue;                 // released on an earlier day
    const start = o.datum === day
      ? (tsMinOnDay(o.arrivedAt, day) ?? (toMin(o.plannedEnd) ?? 600))
      : 0;
    const releasedToday = !!(rel && rel.date === day);
    const end = releasedToday ? rel.min : 1440;
    if (end <= start) continue;
    if (!seg || start >= seg.start) {
      seg = {
        start, end,
        standort: t.standort || o.zielort || '',
        orderId: o.id,
        released: releasedToday,
        releaseTime: releasedToday ? hhmmStr(rel.min) : null,
      };
    }
  }
  return seg;
}

export function buildData(wkId, date, wk = null) {
  const fleet = readFleet(wkId);
  const orders = listOrders(wkId);
  const zn = zurich(new Date());
  const todayIso = zn.iso;
  const day = isDateIso(date) ? date : todayIso;

  const dayOrders = orders
    .filter((o) => o.datum === day)
    .map((o) => ({ ...o, bar: computeBar(o, day, todayIso, zn.minutes) }));

  const trailerParking = {};
  for (const r of fleet.trailers) trailerParking[r.id] = parkingForDay(orders, r.id, day);

  // Dynamic day window from the day's orders + parking (fallback 07:00–20:00).
  let minS = 7 * 60, maxE = 20 * 60;
  for (const o of dayOrders) {
    minS = Math.min(minS, o.bar.start, o.bar.planStart);
    maxE = Math.max(maxE, o.bar.end, o.bar.planEnd);
  }
  for (const p of Object.values(trailerParking)) {
    if (p) { minS = Math.min(minS, p.start); maxE = Math.max(maxE, p.end); }
  }
  const dayStartMin = Math.max(0, Math.floor((minS - 30) / 60) * 60);
  const dayEndMin = Math.min(1440, Math.ceil((maxE + 30) / 60) * 60);

  const decorate = (r) => {
    const parking = r.kind === 'trailer' ? (trailerParking[r.id] || null) : null;
    return {
      id: r.id, name: r.name, kind: r.kind, trailerType: r.trailerType || '',
      unavailable: r.unavailable || [],
      available: !resourceUnavailableOn(r, day),
      // The "auswärts" panel and the grey timeline block are the same segment,
      // so a parked trailer is always visible and releasable on the day shown.
      parkedAt: parking ? parking.standort : null,
      parkedOrderId: parking ? parking.orderId : null,
      parking,
    };
  };

  const allDays = [...new Set(orders.map((o) => o.datum).filter(isDateIso))].sort();

  return {
    date: day,
    today: todayIso,
    nowMin: zn.minutes,
    dayStartMin, dayEndMin,
    days: allDays,
    wk: wk ? { id: wk.id, label: wk.label || wk.id, range: wk.range || '' } : null,
    vehicles: fleet.vehicles.map(decorate),
    trailers: fleet.trailers.map(decorate),
    orders: dayOrders,
    openBestellungen: openBestellungen(wkId),
  };
}

// =========================================================================
// Express handlers
// =========================================================================

function requireWk(req, res) {
  if (!req.activeWk) {
    res.status(409).json({ error: 'Bitte zuerst einen WK auswählen oder anlegen (Admin → WK erfassen).' });
    return null;
  }
  return req.activeWk.id;
}

function ensureRole(req, res, role) {
  if (!hasAccess(req.user?.role, role)) {
    res.status(403).json({ error: 'Zugriff verweigert' });
    return false;
  }
  return true;
}

// GET /transport — overview page (client-rendered).
export function renderTransportPage(req, res) {
  if (!hasAccess(req.user?.role, VIEW_ROLE)) {
    if (!req.user) return res.redirect('/login?next=/transport');
    return res.status(403).send('Zugriff verweigert');
  }
  if (!req.activeWk) {
    const body = `<article class="content"><p><a href="/" class="back">← Zurück</a></p>
      <h1>Transportzentrale</h1><p>Bitte zuerst einen WK auswählen oder anlegen (<a href="/k/admin">Admin → WK erfassen</a>).</p></article>`;
    return res.status(409).send(layout(req, { title: 'Transportzentrale', body }));
  }
  const canDispatch = hasAccess(req.user?.role, EDIT_ROLE);
  const body = `<article class="content transport-page" data-transport data-can-dispatch="${canDispatch}" data-wk-id="${esc(req.activeWk?.id || '')}" data-print-logo="${esc(logoAssetUrl('print'))}">
    <p><a href="/" class="back">← Zurück zur Übersicht</a></p>
    <div class="content-header"><h1>Transportzentrale</h1></div>
    <div class="transport-root" data-transport-root><p class="muted">Wird geladen …</p></div>
  </article>`;
  res.send(layout(req, { title: 'Transportzentrale', body, extraHead: `<script src="/client/transport.js" defer></script>` }));
}

// GET /api/transport/data?date=YYYY-MM-DD
export function apiData(req, res) {
  if (!ensureRole(req, res, VIEW_ROLE)) return;
  const wkId = requireWk(req, res);
  if (!wkId) return;
  const data = buildData(wkId, req.query.date, req.activeWk);
  data.canDispatch = hasAccess(req.user?.role, EDIT_ROLE);
  res.json(data);
}

// POST /api/transport/fleet — add/update/delete a vehicle/trailer (Uof+)
export function apiSaveFleet(req, res) {
  const wkId = requireWk(req, res);
  if (!wkId) return;
  if (!ensureRole(req, res, EDIT_ROLE)) return;
  const { action, kind, id, name, trailerType, unavailable } = req.body || {};
  if (kind !== 'vehicle' && kind !== 'trailer') return res.status(400).json({ error: 'Typ fehlt.' });
  const fleet = readFleet(wkId);
  const list = fleetList(fleet, kind);
  try {
    if (action === 'delete') {
      const i = list.findIndex((r) => r.id === id);
      if (i >= 0) list.splice(i, 1);
    } else if (action === 'add') {
      if (!String(name || '').trim()) return res.status(400).json({ error: 'Name fehlt.' });
      ensureResource(fleet, kind, name, { trailerType });
    } else { // update
      const r = list.find((x) => x.id === id);
      if (!r) return res.status(404).json({ error: 'Nicht gefunden.' });
      if (name !== undefined && String(name).trim()) r.name = String(name).trim();
      if (kind === 'trailer' && trailerType !== undefined) r.trailerType = String(trailerType || '');
      if (Array.isArray(unavailable)) {
        r.unavailable = unavailable
          .filter((u) => isDateIso(u.from))
          .map((u) => ({ from: u.from, to: isDateIso(u.to) ? u.to : u.from }));
      }
    }
    writeJson(fleetFile(wkId), fleet);
    res.json({ ok: true, fleet });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// POST /api/transport/order — create (Uof+)
export function apiCreateOrder(req, res) {
  const wkId = requireWk(req, res);
  if (!wkId) return;
  if (!ensureRole(req, res, EDIT_ROLE)) return;
  try {
    const order = createOrder(wkId, req.body || {}, req.user?.username);
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// POST /api/transport/order/:id — update assignment / dispo info (Uof+)
export function apiUpdateOrder(req, res) {
  const wkId = requireWk(req, res);
  if (!wkId) return;
  if (!ensureRole(req, res, EDIT_ROLE)) return;
  try {
    const order = updateOrder(wkId, req.params.id, req.body || {}, req.user?.username);
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// POST /api/transport/order/:id/delete (Uof+)
export function apiDeleteOrder(req, res) {
  const wkId = requireWk(req, res);
  if (!wkId) return;
  if (!ensureRole(req, res, EDIT_ROLE)) return;
  deleteOrder(wkId, req.params.id);
  res.json({ ok: true });
}

// POST /api/transport/order/:id/status — driver action (Fahrer+)
export function apiOrderStatus(req, res) {
  const wkId = requireWk(req, res);
  if (!wkId) return;
  if (!ensureRole(req, res, DRIVER_ROLE)) return;
  const { action, comment, time, fahrer } = req.body || {};
  try {
    const order = setOrderStatus(wkId, req.params.id, action, comment, req.user?.username, time, fahrer);
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// POST /api/transport/trailer/release — fail-safe release (Uof+)
export function apiReleaseTrailer(req, res) {
  const wkId = requireWk(req, res);
  if (!wkId) return;
  if (!ensureRole(req, res, EDIT_ROLE)) return;
  const { orderId, trailerId, day, time, clear } = req.body || {};
  try {
    const order = releaseTrailer(wkId, safeId(orderId), trailerId, { day, time, clear });
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}
