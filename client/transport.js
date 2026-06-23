/* Transportzentrale frontend.
   - Zeitstrahl (15-min slots, dynamic day window) of vehicles + trailers with
     plan vs. actual bars (driven by the server's fail-safe computeBar).
   - Dispo (Uof+): open Bestellungen -> Fahraufträge, assign vehicle/trailers,
     release trailers; Auftrag erstellen/bearbeiten; Fuhrpark verwalten.
   - Fahrer+: see overview/orders, mark abgefahren/angekommen with comment.
   - The vehicle filter is remembered in localStorage (shared Fahrer login),
     just like a name would be.
   Dynamic writes are LAN-only and greyed out offline. */
(() => {
  'use strict';

  const SLOT = 15;            // minutes per slot
  const PX = 0.9;             // pixels per minute on the timeline track
  const VEHICLE_KEY = 'transport-vehicle';
  const VIEW_KEY = 'transport-view';
  const DRIVER_NAME_KEY = 'transport-driver-name';
  const DRIVER_MOBILE_KEY = 'transport-driver-mobile';

  const TRAILER_TYPES = ['Ersteinsatzanhänger', 'Kofferanhänger', 'Materialanhänger grün', 'Dreiseitenkipper', 'Zeltanhänger', 'Andere'];
  const PHASE_LABEL = { geplant: 'geplant', laufend: 'läuft', abgeschlossen: 'erledigt' };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hhmm = (min) => {
    if (min == null) return '–';
    const m = Math.max(0, Math.min(1439, Math.round(min)));
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const fmtDate = (iso) => { const [y, m, d] = String(iso).split('-'); return `${d}.${m}.${y}`; };
  const weekday = (iso) => ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(iso + 'T00:00:00').getDay()];
  const addDays = (iso, n) => {
    const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const clockOf = (isoTs) => new Date(isoTs).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
  const online = () => navigator.onLine !== false;

  let activeWkId = '';
  function apiUrl(url) {
    const next = new URL(url, location.origin);
    if (activeWkId) next.searchParams.set('wk', activeWkId);
    return next.pathname + next.search;
  }

  async function postJson(url, body) {
    const res = await fetch(apiUrl(url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  function toast(msg) {
    let t = document.querySelector('.appell-toast');
    if (!t) { t = document.createElement('div'); t.className = 'appell-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  }

  function init(root) {
    activeWkId = root.dataset.wkId || new URLSearchParams(location.search).get('wk') || '';
    const canDispatch = root.dataset.canDispatch === 'true';
    const printLogo = root.dataset.printLogo || '';
    const mount = root.querySelector('[data-transport-root]');
    const printLogoHtml = () => printLogo ? `<img class="tz-print-logo" src="${esc(printLogo)}" alt="Logo">` : '';
    const state = {
      data: null,
      date: null,
      view: localStorage.getItem(VIEW_KEY) || 'timeline',
      vehicle: localStorage.getItem(VEHICLE_KEY) || '',
      canDispatch,
    };

    async function load() {
      try {
        const q = state.date ? '?date=' + encodeURIComponent(state.date) : '';
        const res = await fetch(apiUrl('/api/transport/data' + q));
        const data = await res.json();
        if (res.status === 409) { mount.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
        if (!res.ok) throw new Error(data.error || 'Fehler');
        state.data = data;
        state.date = data.date;
        state.canDispatch = data.canDispatch;
        render();
      } catch (e) {
        mount.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      }
    }

    // --- resources / orders helpers -------------------------------------
    function allResources() { return [...state.data.vehicles, ...state.data.trailers]; }
    function resById(id) { return allResources().find((r) => r.id === id) || null; }
    function ordersForRes(id) {
      return state.data.orders.filter((o) => o.vehicleId === id || (o.trailers || []).some((t) => t.id === id));
    }
    function visibleResources() {
      let rows = allResources();
      if (state.vehicle) {
        // show the chosen vehicle plus any trailers that share its orders
        const orders = ordersForRes(state.vehicle);
        const trailerIds = new Set();
        orders.forEach((o) => (o.trailers || []).forEach((t) => trailerIds.add(t.id)));
        rows = rows.filter((r) => r.id === state.vehicle || trailerIds.has(r.id));
      }
      return rows;
    }

    // --- render ----------------------------------------------------------
    function render() {
      const d = state.data;
      const vehOpts = ['<option value="">Alle Fahrzeuge</option>']
        .concat(d.vehicles.map((v) => `<option value="${esc(v.id)}" ${v.id === state.vehicle ? 'selected' : ''}>${esc(v.name)}</option>`));
      mount.innerHTML = `
        ${!online() ? '<p class="offline-banner no-print">Offline – Disposition/Status nur im lokalen Netz möglich. Inhalte werden vom letzten Stand angezeigt.</p>' : ''}
        <div class="tz-controls no-print">
          <div class="tz-date">
            <button data-day-prev aria-label="Vorheriger Tag">◀</button>
            <input type="date" data-date value="${esc(state.date)}">
            <button data-day-next aria-label="Nächster Tag">▶</button>
            <span class="tz-weekday">${weekday(state.date)}${state.date === d.today ? ' · heute' : ''}</span>
          </div>
          <label class="tz-veh">Fahrzeug: <select data-vehicle>${vehOpts.join('')}</select></label>
          <div class="view-toggle">
            <button data-view="timeline" class="${state.view === 'timeline' ? 'active' : ''}">Zeitstrahl</button>
            <button data-view="list" class="${state.view === 'list' ? 'active' : ''}">Aufträge</button>
          </div>
          <button class="btn btn-small" data-print-overview>🖨 Drucken</button>
          ${state.canDispatch ? '<button class="btn btn-small" data-new-order>+ Auftrag</button><button class="btn btn-small" data-fleet>Fuhrpark</button>' : ''}
        </div>
        <div class="tz-print-head" data-print-head></div>
        ${trailerAwayHtml()}
        ${state.canDispatch ? bestellungenHtml() : ''}
        <div data-grid></div>
        ${crossWkHtml()}`;
      wireControls();
      renderGrid();
    }

    function trailerAwayHtml() {
      const parked = state.data.trailers.filter((t) => t.parking);
      if (!parked.length) return '';
      const chips = parked.map((t) => {
        const p = t.parking;
        const ctrl = !state.canDispatch ? ''
          : p.released
            ? `<span class="tz-rel-info">freigegeben ${esc(p.releaseTime)}</span><button data-unrelease data-order="${esc(p.orderId)}" data-trailer="${esc(t.id)}" title="Freigabe aufheben – Anhänger bleibt stehen">aufheben</button>`
            : `<button data-release data-order="${esc(p.orderId)}" data-trailer="${esc(t.id)}" title="Anhänger freigeben">freigeben</button>`;
        return `<span class="tz-away-chip ${p.released ? 'is-released' : ''}">🚛 ${esc(t.name)} → ${esc(p.standort || '?')} ${ctrl}</span>`;
      }).join('');
      return `<div class="tz-away no-print"><strong>Anhänger auswärts am ${esc(fmtDate(state.date))}:</strong> ${chips}</div>`;
    }

    function bestellungenHtml() {
      const list = state.data.openBestellungen || [];
      if (!list.length) return '<div class="tz-bestellungen no-print"><p class="muted">Keine offenen Bestellungen.</p></div>';
      const cards = list.map((b) => `<div class="tz-best-card">
        <div class="tz-best-main">
          <strong>${esc(b.abfahrtsort || '?')} → ${esc(b.zielort || '?')}</strong>
          <span class="muted">${esc(b.datum || '')} ${esc(b.zeit || '')} · ${esc(b.fahrtTyp || '')}${b.anzahlPersonen ? ' · ' + esc(b.anzahlPersonen) + ' Pers.' : ''}</span>
          <span class="muted">Besteller: ${esc(b.name || '–')}${b.mobile ? ' · ' + esc(b.mobile) : ''}</span>
          ${b.beschreibung ? `<span class="tz-best-desc">${esc(b.beschreibung)}</span>` : ''}
        </div>
        <button class="btn btn-small" data-dispatch="${esc(b.id)}">Disponieren</button>
      </div>`).join('');
      return `<details class="tz-bestellungen no-print" open><summary>Offene Bestellungen (${list.length})</summary>${cards}</details>`;
    }

    function renderGrid() {
      const grid = mount.querySelector('[data-grid]');
      if (!grid) return;
      grid.innerHTML = state.view === 'timeline' ? timelineHtml() : listHtml();
      wireGrid(grid);
    }

    // --- timeline --------------------------------------------------------
    // Render one timeline (ruler + resource rows) on the shared day window.
    // `ordersOf(id)` returns the orders for a resource within this section;
    // `readonly` drops the click target / now-line for the cross-WK sections.
    function timelineTrack(rows, ordersOf, { readonly = false, showNow = true } = {}) {
      const d = state.data;
      const startMin = d.dayStartMin, endMin = d.dayEndMin;
      const width = (endMin - startMin) * PX;

      // hour ruler
      const ticks = [];
      for (let m = Math.ceil(startMin / 60) * 60; m <= endMin; m += 60) {
        ticks.push(`<div class="tz-tick" style="left:${(m - startMin) * PX}px">${hhmm(m)}</div>`);
      }
      const nowLine = (showNow && d.date === d.today && d.nowMin >= startMin && d.nowMin <= endMin)
        ? `<div class="tz-now" style="left:${(d.nowMin - startMin) * PX}px"></div>` : '';

      const LANE_H = 36; // px per stacked lane (plan bar + ist line + gap)
      const rowHtml = rows.map((r) => {
        const orders = ordersOf(r.id);
        const lanes = assignLanes(orders);
        const bars = lanes.items.map((it) => barHtml(it.o, startMin, it.lane, LANE_H, readonly)).join('');
        const grey = r.parking
          ? `<div class="tz-grey" title="steht: ${esc(r.parking.standort || '')}" style="left:${(r.parking.start - startMin) * PX}px;width:${Math.max(SLOT * PX, (r.parking.end - r.parking.start) * PX)}px"><span>${esc(r.parking.standort || 'steht hier')}</span></div>`
          : '';
        const unavail = !r.available ? '<span class="tz-tag tz-tag--off">nicht verfügbar</span>' : '';
        const trackH = lanes.count * LANE_H + 8;
        return `<div class="tz-row ${r.available ? '' : 'is-unavail'}">
          <div class="tz-row-label">
            <span class="tz-res-name">${r.kind === 'trailer' ? '🚛' : '🚐'} ${esc(r.name)}</span>
            ${r.trailerType ? `<span class="tz-res-sub">${esc(r.trailerType)}</span>` : ''}
            ${unavail}
          </div>
          <div class="tz-track" style="width:${width}px;min-height:${trackH}px">${grey}${nowLine}${bars}</div>
        </div>`;
      }).join('');

      return `<div class="tz-timeline">
        <div class="tz-ruler-row"><div class="tz-row-label"></div><div class="tz-ruler" style="width:${width}px">${ticks.join('')}${nowLine}</div></div>
        ${rowHtml}
      </div>`;
    }

    function timelineHtml() {
      const rows = visibleResources();
      if (!rows.length) return '<p class="muted">Noch keine Fahrzeuge/Anhänger. Erstelle einen Auftrag und tippe z.B. „PTF1".</p>';
      return timelineTrack(rows, ordersForRes, { readonly: false, showNow: true })
        + `<div class="tz-legend no-print"><span class="tz-chip ph-geplant">Plan (geplant)</span><span class="tz-ist-chip ph-laufend"></span> läuft<span class="tz-ist-chip ph-abgeschlossen"></span> erledigt<span class="tz-ist-chip ph-overdue"></span> überfällig<span class="tz-grey-chip"></span> Anhänger steht</div>`;
    }

    // Read-only timelines for other non-archived WKs that also have transports
    // on this day (cross-WK coordination). Shown below the active WK on the same
    // time axis; not wired for clicks. Empty when no other WK runs that day.
    function crossWkHtml() {
      const others = state.data.otherWks || [];
      if (!others.length) return '';
      const sections = others.map((w) => {
        const ordersOf = (id) => w.orders.filter((o) => o.vehicleId === id || (o.trailers || []).some((t) => t.id === id));
        const rows = [...w.vehicles, ...w.trailers];
        return `<section class="tz-cross-sec">
          <div class="tz-cross-head">🔗 ${esc(w.label)}${w.range ? ' · ' + esc(w.range) : ''}</div>
          ${timelineTrack(rows, ordersOf, { readonly: true, showNow: false })}
        </section>`;
      }).join('');
      return `<div class="tz-cross">
        <div class="tz-cross-divider"><span>Andere WKs an diesem Tag</span></div>
        ${sections}
      </div>`;
    }

    // Greedily stack overlapping orders into lanes (waterfall) so bars never
    // cover each other. Span = union of plan and actual times.
    function assignLanes(orders) {
      const items = orders.map((o) => ({
        o,
        s: Math.min(o.bar.start, o.bar.planStart),
        e: Math.max(o.bar.end, o.bar.planEnd),
      })).sort((a, b) => a.s - b.s);
      const laneEnds = [];
      for (const it of items) {
        let lane = laneEnds.findIndex((end) => end <= it.s);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.e); }
        else laneEnds[lane] = it.e;
        it.lane = lane;
      }
      return { items, count: Math.max(1, laneEnds.length) };
    }

    // Plan bar (blue) is always shown; the actual ("ist") situation is a thin
    // line underneath, so a running/overdue trip never erases the plan.
    function barHtml(o, startMin, lane, laneH, readonly = false) {
      const b = o.bar;
      const top = 4 + lane * laneH;
      const planLeft = (b.planStart - startMin) * PX;
      const planW = Math.max(SLOT * PX, (b.planEnd - b.planStart) * PX);
      const label = esc(o.zielort || o.abfahrtsort || 'Auftrag');
      const oid = readonly ? '' : ` data-order="${esc(o.id)}"`;
      const ro = readonly ? ' tz-bar--ro' : '';
      let ist = '';
      if (b.departedMin != null) {
        const il = (b.departedMin - startMin) * PX;
        const iw = Math.max(4, (b.end - b.departedMin) * PX);
        const cls = b.overdue ? 'ph-overdue' : (b.arrivedMin != null ? 'ph-abgeschlossen' : 'ph-laufend');
        ist = `<div class="tz-ist ${cls}"${oid} style="left:${il}px;width:${iw}px;top:${top + 23}px" title="Ist ${hhmm(b.departedMin)}–${hhmm(b.end)}"></div>`;
      }
      return `<div class="tz-bar ph-geplant${ro} ${b.overdue ? 'is-overdue' : ''}"${oid} style="left:${planLeft}px;width:${planW}px;top:${top}px" title="Plan ${hhmm(b.planStart)}–${hhmm(b.planEnd)}: ${label}">
          <span class="tz-bar-label">${label}</span>
        </div>${ist}`;
    }

    // --- list view (driver-friendly) ------------------------------------
    function listHtml() {
      let orders = state.data.orders.slice();
      if (state.vehicle) orders = orders.filter((o) => o.vehicleId === state.vehicle || (o.trailers || []).some((t) => t.id === state.vehicle));
      orders.sort((a, b) => (a.bar.start - b.bar.start));
      if (!orders.length) return '<p class="muted">Keine Fahraufträge an diesem Tag.</p>';
      const cards = orders.map((o) => {
        const veh = o.vehicleId ? resById(o.vehicleId) : null;
        const trailers = (o.trailers || []).map((t) => { const r = resById(t.id); return r ? r.name : t.id; });
        const cls = o.bar.overdue ? 'ph-overdue' : 'ph-' + o.bar.phase;
        return `<div class="tz-order-card ${cls}" data-order="${esc(o.id)}">
          <div class="tz-oc-time">${hhmm(o.bar.start)}<span>–${hhmm(o.bar.end)}</span></div>
          <div class="tz-oc-main">
            <strong>${esc(o.abfahrtsort || '?')} → ${esc(o.zielort || '?')}</strong>
            <span class="muted">${veh ? '🚐 ' + esc(veh.name) : '⚠ kein Fahrzeug'}${trailers.length ? ' · 🚛 ' + esc(trailers.join(', ')) : ''}</span>
            <span class="tz-oc-status">${o.bar.overdue ? '⚠ überfällig' : PHASE_LABEL[o.bar.phase] || 'geplant'}</span>
          </div>
        </div>`;
      }).join('');
      return `<div class="tz-order-list">${cards}</div>`;
    }

    // --- wiring ----------------------------------------------------------
    function wireControls() {
      const di = mount.querySelector('[data-date]');
      if (di) di.addEventListener('change', () => { state.date = di.value; load(); });
      const prev = mount.querySelector('[data-day-prev]');
      const next = mount.querySelector('[data-day-next]');
      if (prev) prev.addEventListener('click', () => { state.date = addDays(state.date, -1); load(); });
      if (next) next.addEventListener('click', () => { state.date = addDays(state.date, 1); load(); });
      const vs = mount.querySelector('[data-vehicle]');
      if (vs) vs.addEventListener('change', () => { state.vehicle = vs.value; localStorage.setItem(VEHICLE_KEY, state.vehicle); renderGrid(); });
      mount.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
        state.view = b.dataset.view; localStorage.setItem(VIEW_KEY, state.view); render();
      }));
      const no = mount.querySelector('[data-new-order]');
      if (no) no.addEventListener('click', () => openOrderModal(null, null));
      const fl = mount.querySelector('[data-fleet]');
      if (fl) fl.addEventListener('click', openFleetModal);
      const po = mount.querySelector('[data-print-overview]');
      if (po) po.addEventListener('click', printOverview);
      mount.querySelectorAll('[data-dispatch]').forEach((b) => b.addEventListener('click', () => {
        const best = state.data.openBestellungen.find((x) => x.id === b.dataset.dispatch);
        openOrderModal(null, best);
      }));
      mount.querySelectorAll('[data-release]').forEach((b) => b.addEventListener('click', () => releaseTrailer(b.dataset.order, b.dataset.trailer)));
      mount.querySelectorAll('[data-unrelease]').forEach((b) => b.addEventListener('click', () => unreleaseTrailer(b.dataset.order, b.dataset.trailer)));
    }

    function wireGrid(grid) {
      grid.querySelectorAll('[data-order]').forEach((el) => el.addEventListener('click', () => {
        const o = state.data.orders.find((x) => x.id === el.dataset.order);
        if (o) openOrderModal(o, null);
      }));
    }

    async function releaseTrailer(orderId, trailerId) {
      if (!online()) { toast('Offline – nicht möglich.'); return; }
      const def = state.date === state.data.today ? hhmm(state.data.nowMin) : '';
      const time = prompt(`Anhänger am ${fmtDate(state.date)} freigeben um (HH:MM):`, def);
      if (time === null) return;
      if (!/^\d{1,2}:\d{2}$/.test(time.trim())) { toast('Bitte Zeit als HH:MM eingeben.'); return; }
      try { await postJson('/api/transport/trailer/release', { orderId, trailerId, day: state.date, time: time.trim() }); await load(); }
      catch (e) { toast(e.message); }
    }

    async function unreleaseTrailer(orderId, trailerId) {
      if (!online()) { toast('Offline – nicht möglich.'); return; }
      try { await postJson('/api/transport/trailer/release', { orderId, trailerId, clear: true }); await load(); }
      catch (e) { toast(e.message); }
    }

    // --- printing --------------------------------------------------------
    function printDoc(bodyClass, size, prep) {
      const style = document.createElement('style');
      style.textContent = `@page { size: ${size}; margin: ${size === 'landscape' ? '8mm' : '12mm'}; }`;
      document.head.appendChild(style);
      if (prep) prep();
      document.body.classList.add(bodyClass);
      const cleanup = () => {
        document.body.classList.remove(bodyClass);
        style.remove();
        window.removeEventListener('afterprint', cleanup);
        if (prep && prep.after) prep.after();
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
    }

    function orderPrintHtml(o) {
      const wk = state.data.wk;
      const veh = o.vehicleId ? (resById(o.vehicleId)?.name || o.vehicleId) : '–';
      const trailers = (o.trailers || []).map((t) => {
        const r = resById(t.id); const n = r ? r.name : t.id;
        return n + (t.bleibtAmZielort ? ` (bleibt${t.standort ? ' an ' + t.standort : ''})` : '');
      }).join(', ') || '–';
      const row = (l, v) => `<tr><th>${esc(l)}</th><td>${esc(v || '–')}</td></tr>`;
      return `<div class="tz-print-head">
        <div class="tz-print-title">
          <div><h2>Fahrauftrag</h2><div class="tz-print-wk">${wk ? esc(wk.label) : ''}${wk && wk.range ? ' · ' + esc(wk.range) : ''}</div></div>
          ${printLogoHtml()}
        </div>
        <table class="tz-print-table">
          ${row('Datum', o.datum)}
          ${row('Geplant', (o.plannedStart || '?') + ' – ' + (o.plannedEnd || '?'))}
          ${row('Von → Nach', (o.abfahrtsort || '?') + ' → ' + (o.zielort || '?'))}
          ${row('Art der Fahrt', o.fahrtTyp)}
          ${row('Anzahl Personen', o.anzahlPersonen)}
          ${row('Fahrzeug', veh)}
          ${row('Anhänger', trailers)}
          ${row('Fahrer', (o.fahrerName || '') + (o.fahrerMobile ? ' · ' + o.fahrerMobile : ''))}
          ${row('Abgefahren', o.departedAt ? clockOf(o.departedAt) : '')}
          ${row('Angekommen', o.arrivedAt ? clockOf(o.arrivedAt) : '')}
          ${row('Dispo-Kommentar', o.dispoKommentar)}
          ${row('Beschreibung', o.beschreibung)}
          ${row('Fahrt-Kommentar', o.departedComment || o.arrivedComment)}
        </table>
      </div>`;
    }

    // Print the Dispo overview: force the timeline, add a WK header, and scale
    // the (scrollable) timeline down so the whole width fits on one landscape page.
    function printOverview() {
      const prevView = state.view;
      const restore = () => { if (prevView !== 'timeline') { state.view = prevView; renderGrid(); } };
      if (state.view !== 'timeline') { state.view = 'timeline'; renderGrid(); }
      const head = mount.querySelector('[data-print-head]');
      if (head) {
        const wk = state.data.wk;
        const veh = state.vehicle ? (resById(state.vehicle)?.name || '') : '';
        head.innerHTML = `<div class="tz-print-title">
          <div><h2>Transport – ${esc(weekday(state.date))} ${esc(fmtDate(state.date))}</h2>
          <div class="tz-print-wk">${wk ? esc(wk.label) : ''}${wk && wk.range ? ' · ' + esc(wk.range) : ''}${veh ? ' · Fahrzeug: ' + esc(veh) : ''}</div></div>
          ${printLogoHtml()}</div>`;
      }
      const tl = mount.querySelector('.tz-timeline');
      const contentW = tl ? tl.scrollWidth : 0;
      const target = 1040; // ~A4 landscape printable width in px
      const scale = contentW > target ? target / contentW : 1;
      document.documentElement.style.setProperty('--tz-print-scale', String(scale));
      const prep = () => {};
      prep.after = restore;
      printDoc('tz-print-overview', 'landscape', prep);
    }

    // --- modals ----------------------------------------------------------
    function modal(html) {
      const ov = document.createElement('div');
      ov.className = 'appell-modal-overlay';
      ov.innerHTML = `<div class="appell-modal tz-modal" role="dialog"><button class="modal-close" aria-label="Schliessen">×</button>${html}</div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.modal-close').addEventListener('click', close);
      return { ov, close };
    }

    // Create / dispatch / edit an order. `order` = existing; `best` = Bestellung to dispatch.
    function openOrderModal(order, best) {
      const disp = state.canDispatch;
      const o = order || {};
      const trailerType = best && best.fahrtTyp;
      const init = best ? {
        datum: best.datum, plannedStart: best.zeit || '', abfahrtsort: best.abfahrtsort,
        zielort: best.zielort, anzahlPersonen: best.anzahlPersonen, fahrtTyp: best.fahrtTyp,
        beschreibung: best.beschreibung, vehicle: '',
      } : o;

      const vehName = o.vehicleId ? (resById(o.vehicleId)?.name || '') : '';
      const isRound = (init.fahrtTyp || '').startsWith('Hin');

      const trailerRows = (o.trailers || []).map((t, i) => trailerRowHtml(t, i, o.id)).join('');
      const editable = disp;

      const fld = (label, name, type, val, extra = '') =>
        `<label class="tz-f"><span>${label}</span><input type="${type}" name="${name}" value="${esc(val ?? '')}" ${editable ? '' : 'disabled'} ${extra}></label>`;

      const driverBox = order ? driverSectionHtml(o) : '';

      const { ov, close } = modal(`
        <h2>${order ? 'Fahrauftrag' : best ? 'Bestellung disponieren' : 'Neuer Fahrauftrag'}</h2>
        ${best ? `<p class="muted">aus Bestellung von ${esc(best.name || '–')}</p>` : ''}
        ${order ? `<div class="tz-modal-tools no-print"><button type="button" class="btn btn-small" data-print-order>🖨 Auftrag drucken</button></div>${orderPrintHtml(o)}` : ''}
        ${driverBox}
        <form data-order-form class="tz-form">
          <div class="tz-grid2">
            ${fld('Datum', 'datum', 'date', init.datum)}
            ${fld('Anzahl Personen', 'anzahlPersonen', 'number', init.anzahlPersonen, 'min="0"')}
            ${fld('Abfahrtsort', 'abfahrtsort', 'text', init.abfahrtsort)}
            ${fld('Zielort', 'zielort', 'text', init.zielort)}
            ${fld('Geplant ab', 'plannedStart', 'time', o.plannedStart || init.plannedStart)}
            ${fld('Geplant bis', 'plannedEnd', 'time', o.plannedEnd)}
          </div>
          <label class="tz-f"><span>Fahrzeug (z.B. PTF1 – wird bei Bedarf angelegt)</span>
            <input type="text" name="vehicle" list="tz-veh-list" value="${esc(vehName)}" ${editable ? '' : 'disabled'}></label>
          <datalist id="tz-veh-list">${state.data.vehicles.map((v) => `<option value="${esc(v.name)}">`).join('')}</datalist>

          <div class="tz-trailers" data-trailers>
            <div class="tz-f"><span>Anhänger</span></div>
            ${trailerRows}
          </div>
          ${editable ? '<button type="button" class="btn btn-small" data-add-trailer>+ Anhänger</button>' : ''}

          <label class="tz-f"><span>Dispo-Kommentar</span><textarea name="dispoKommentar" rows="2" ${editable ? '' : 'disabled'}>${esc(o.dispoKommentar || '')}</textarea></label>
          ${init.beschreibung ? `<p class="muted tz-best-desc">Bestellung: ${esc(init.beschreibung)}</p>` : ''}

          ${editable && !order ? `<label class="tz-check"><input type="checkbox" name="zwei" ${isRound ? 'checked' : ''}> Hin- und Rückfahrt als <strong>zwei</strong> Aufträge anlegen</label>` : ''}

          ${editable ? `<div class="tz-actions">
            <button type="submit" class="btn btn-primary">${order ? 'Speichern' : 'Auftrag anlegen'}</button>
            ${order ? '<button type="button" class="btn btn-danger" data-delete>Löschen</button>' : ''}
          </div>` : '<p class="muted">Disposition nur für Uof+.</p>'}
        </form>`);

      const form = ov.querySelector('[data-order-form]');
      const trailersBox = ov.querySelector('[data-trailers]');
      const addBtn = ov.querySelector('[data-add-trailer]');
      if (addBtn) addBtn.addEventListener('click', () => {
        const idx = trailersBox.querySelectorAll('[data-trailer-row]').length;
        trailersBox.insertAdjacentHTML('beforeend', trailerRowHtml({}, idx));
        wireTrailerRows(trailersBox);
      });
      wireTrailerRows(trailersBox);
      ov.querySelector('[data-print-order]')?.addEventListener('click', () => printDoc('tz-print-order', 'portrait'));

      const del = ov.querySelector('[data-delete]');
      if (del) del.addEventListener('click', async () => {
        if (!confirm('Auftrag wirklich löschen?')) return;
        if (!online()) { toast('Offline – nicht möglich.'); return; }
        try { await postJson(`/api/transport/order/${encodeURIComponent(o.id)}/delete`, {}); close(); await load(); }
        catch (e) { toast(e.message); }
      });

      if (form) form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!disp) return;
        if (!online()) { toast('Offline – nicht möglich.'); return; }
        const payload = collectOrder(form, trailersBox);
        try {
          if (order) {
            await postJson('/api/transport/order/' + encodeURIComponent(o.id), payload);
          } else {
            payload.bestellungId = best ? best.id : null;
            payload.richtung = form.zwei && form.zwei.checked ? 'hin' : 'einfach';
            await postJson('/api/transport/order', payload);
            if (form.zwei && form.zwei.checked) {
              // Return trip defaults to start after the outbound leg; trailers
              // come back, so they do not stay at the destination on the return.
              const retStart = payload.plannedEnd || payload.plannedStart || '';
              const ret = { ...payload, richtung: 'rueck', plannedStart: retStart, plannedEnd: '',
                abfahrtsort: payload.zielort, zielort: payload.abfahrtsort,
                trailers: (payload.trailers || []).map((t) => ({ ...t, bleibtAmZielort: false, standort: '' })) };
              await postJson('/api/transport/order', ret);
            }
          }
          close(); await load();
        } catch (err) { toast(err.message); }
      });
    }

    function trailerRowHtml(t, idx, orderId) {
      const name = t.id ? (resById(t.id)?.name || t.id) : (t.name || '');
      const editable = state.canDispatch;
      const rel = t.releasedAt
        ? `<span class="tz-rel-info">freigegeben: ${esc(String(t.releasedAt).replace('T', ' '))}${(editable && orderId) ? ` <button type="button" data-trel-clear data-order="${esc(orderId)}" data-trailer="${esc(t.id)}">aufheben</button>` : ''}</span>`
        : '';
      return `<div class="tz-trailer-row" data-trailer-row data-id="${esc(t.id || '')}">
        <input type="text" data-tname placeholder="Anhänger (z.B. Koffer 1)" value="${esc(name)}" list="tz-trailer-list" ${editable ? '' : 'disabled'}>
        <select data-ttype ${editable ? '' : 'disabled'}>
          <option value="">Typ…</option>
          ${TRAILER_TYPES.map((x) => `<option value="${esc(x)}" ${(t.trailerType === x || (t.id && resById(t.id)?.trailerType === x)) ? 'selected' : ''}>${esc(x)}</option>`).join('')}
        </select>
        <label class="tz-stay"><input type="checkbox" data-tstay ${t.bleibtAmZielort ? 'checked' : ''} ${editable ? '' : 'disabled'}> bleibt am Zielort</label>
        <input type="text" data-tstandort placeholder="Standort" value="${esc(t.standort || '')}" ${editable ? '' : 'disabled'}>
        ${rel}
        ${editable ? '<button type="button" data-trm aria-label="entfernen">×</button>' : ''}
      </div>`;
    }

    function wireTrailerRows(box) {
      box.querySelectorAll('[data-trm]').forEach((b) => { b.onclick = () => b.closest('[data-trailer-row]').remove(); });
      box.querySelectorAll('[data-trel-clear]').forEach((b) => { b.onclick = () => unreleaseTrailer(b.dataset.order, b.dataset.trailer); });
      let dl = document.getElementById('tz-trailer-list');
      if (!dl) { dl = document.createElement('datalist'); dl.id = 'tz-trailer-list'; document.body.appendChild(dl); }
      dl.innerHTML = state.data.trailers.map((t) => `<option value="${esc(t.name)}">`).join('');
    }

    function collectOrder(form, trailersBox) {
      const trailers = [...trailersBox.querySelectorAll('[data-trailer-row]')].map((row) => ({
        name: row.querySelector('[data-tname]').value.trim(),
        trailerType: row.querySelector('[data-ttype]').value,
        bleibtAmZielort: row.querySelector('[data-tstay]').checked,
        standort: row.querySelector('[data-tstandort]').value.trim(),
      })).filter((t) => t.name);
      return {
        datum: form.datum.value, plannedStart: form.plannedStart.value, plannedEnd: form.plannedEnd.value,
        abfahrtsort: form.abfahrtsort.value, zielort: form.zielort.value,
        anzahlPersonen: form.anzahlPersonen.value, vehicle: form.vehicle.value.trim(),
        dispoKommentar: form.dispoKommentar.value, trailers,
      };
    }

    // Driver section: name + mobile (cached in localStorage like other forms),
    // plus abgefahren / angekommen. The button stamps the current time; the time
    // field allows entering/correcting it by hand (e.g. forgot to tap on departure).
    function driverSectionHtml(o) {
      const depT = o.departedAt ? clockOf(o.departedAt) : '';
      const arrT = o.arrivedAt ? clockOf(o.arrivedAt) : '';
      const name = o.fahrerName || localStorage.getItem(DRIVER_NAME_KEY) || '';
      const mobile = o.fahrerMobile || localStorage.getItem(DRIVER_MOBILE_KEY) || '';
      return `<div class="tz-driver" data-driver data-order="${esc(o.id)}">
        <div class="tz-driver-id">
          <input type="text" data-fname placeholder="Dein Name" value="${esc(name)}">
          <input type="text" data-fmobile placeholder="Mobile" value="${esc(mobile)}">
        </div>
        <div class="tz-driver-row">
          <button class="btn btn-small ${o.departedAt ? 'is-done' : ''}" data-act="abgefahren" title="jetzt">${o.departedAt ? '✓ Abgefahren' : 'Abgefahren'}</button>
          <input type="time" data-time="abgefahren" value="${esc(depT)}" title="Abfahrtszeit (manuell)">
        </div>
        <div class="tz-driver-row">
          <button class="btn btn-small ${o.arrivedAt ? 'is-done' : ''}" data-act="angekommen" title="jetzt">${o.arrivedAt ? '✓ Angekommen' : 'Angekommen'}</button>
          <input type="time" data-time="angekommen" value="${esc(arrT)}" title="Ankunftszeit (manuell)">
          ${(o.departedAt || o.arrivedAt) ? '<button class="btn btn-small" data-act="reset">zurücksetzen</button>' : ''}
        </div>
        <input type="text" data-dcomment placeholder="Kommentar zur Fahrt (optional)" value="${esc(o.departedComment || o.arrivedComment || '')}">
      </div>`;
    }

    function driverIdentity(box) {
      const name = box.querySelector('[data-fname]')?.value.trim() || '';
      const mobile = box.querySelector('[data-fmobile]')?.value.trim() || '';
      localStorage.setItem(DRIVER_NAME_KEY, name);
      localStorage.setItem(DRIVER_MOBILE_KEY, mobile);
      return { name, mobile };
    }

    async function driverAction(box, action, time, reload = true) {
      if (!online()) { toast('Offline – nicht möglich.'); return; }
      const orderId = box.dataset.order;
      const comment = box.querySelector('[data-dcomment]')?.value || '';
      const fahrer = driverIdentity(box);
      try {
        await postJson(`/api/transport/order/${encodeURIComponent(orderId)}/status`, { action, comment, time, fahrer });
        if (reload) { document.querySelector('.appell-modal-overlay')?.remove(); await load(); }
      } catch (err) { toast(err.message); }
    }

    // Wire driver buttons / time fields (delegated, modal is inserted into body).
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-driver] [data-act]');
      if (!btn) return;
      btn.disabled = true;
      driverAction(btn.closest('[data-driver]'), btn.dataset.act);
    });
    document.addEventListener('change', (e) => {
      const box = e.target.closest('[data-driver]');
      if (!box) return;
      const inp = e.target.closest('[data-time]');
      if (inp && inp.value) { driverAction(box, inp.dataset.time, inp.value); return; }
      // Name/mobile edits are cached + stored on the order without reloading.
      if (e.target.matches('[data-fname],[data-fmobile]')) driverAction(box, 'driverinfo', undefined, false);
    });

    // --- fleet manager ---------------------------------------------------
    function openFleetModal() {
      const d = state.data;
      const resRow = (r) => `<div class="tz-fleet-row" data-fid="${esc(r.id)}" data-kind="${esc(r.kind)}">
        <span class="tz-fleet-name">${r.kind === 'trailer' ? '🚛' : '🚐'} ${esc(r.name)}${r.trailerType ? ' <em>' + esc(r.trailerType) + '</em>' : ''}</span>
        <span class="tz-fleet-un">${(r.unavailable || []).length ? '⚠ ' + r.unavailable.map((u) => u.from === u.to ? fmtDate(u.from) : fmtDate(u.from) + '–' + fmtDate(u.to)).join(', ') : ''}</span>
        <input type="date" data-un-from title="nicht verfügbar von">
        <input type="date" data-un-to title="bis">
        <button class="btn btn-small" data-un-add>sperren</button>
        ${r.unavailable && r.unavailable.length ? '<button class="btn btn-small" data-un-clear>frei</button>' : ''}
        <button data-del-res aria-label="löschen">×</button>
      </div>`;
      const { ov, close } = modal(`
        <h2>Fuhrpark – ${esc(d.date)}</h2>
        <p class="muted">Fahrzeuge und Anhänger werden auch automatisch angelegt, wenn du sie beim Auftrag eintippst. „sperren" = an Daten nicht verfügbar.</p>
        <h3>Fahrzeuge</h3>
        <div data-list="vehicle">${d.vehicles.map(resRow).join('') || '<p class="muted">keine</p>'}</div>
        <form data-add-form data-kind="vehicle" class="tz-add-form"><input type="text" name="name" placeholder="Fahrzeug (z.B. PTF1)" required><button class="btn btn-small">+ Fahrzeug</button></form>
        <h3>Anhänger</h3>
        <div data-list="trailer">${d.trailers.map(resRow).join('') || '<p class="muted">keine</p>'}</div>
        <form data-add-form data-kind="trailer" class="tz-add-form">
          <input type="text" name="name" placeholder="Anhänger (z.B. Koffer 1)" required>
          <select name="trailerType"><option value="">Typ…</option>${TRAILER_TYPES.map((x) => `<option>${esc(x)}</option>`).join('')}</select>
          <button class="btn btn-small">+ Anhänger</button>
        </form>`);

      async function fleet(body) {
        if (!online()) { toast('Offline – nicht möglich.'); return; }
        try { await postJson('/api/transport/fleet', body); await load(); close(); openFleetModal(); }
        catch (e) { toast(e.message); }
      }
      ov.querySelectorAll('[data-add-form]').forEach((f) => f.addEventListener('submit', (e) => {
        e.preventDefault();
        fleet({ action: 'add', kind: f.dataset.kind, name: f.name.value.trim(), trailerType: f.trailerType ? f.trailerType.value : '' });
      }));
      ov.querySelectorAll('[data-del-res]').forEach((b) => b.addEventListener('click', () => {
        const row = b.closest('[data-fleet-row]') || b.closest('.tz-fleet-row');
        fleet({ action: 'delete', kind: row.dataset.kind, id: row.dataset.fid });
      }));
      ov.querySelectorAll('[data-un-add]').forEach((b) => b.addEventListener('click', () => {
        const row = b.closest('.tz-fleet-row');
        const from = row.querySelector('[data-un-from]').value;
        const to = row.querySelector('[data-un-to]').value || from;
        if (!from) { toast('Datum wählen.'); return; }
        const r = resById(row.dataset.fid);
        const unavailable = [...(r.unavailable || []), { from, to }];
        fleet({ action: 'update', kind: row.dataset.kind, id: row.dataset.fid, unavailable });
      }));
      ov.querySelectorAll('[data-un-clear]').forEach((b) => b.addEventListener('click', () => {
        const row = b.closest('.tz-fleet-row');
        fleet({ action: 'update', kind: row.dataset.kind, id: row.dataset.fid, unavailable: [] });
      }));
    }

    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    load();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const el = document.querySelector('[data-transport]');
    if (el) init(el);
  });
})();
