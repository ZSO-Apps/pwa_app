/* Appell frontend: list selector, filters, attendance matrix + day view.
   Status cycle on click: neutral -> grün(anwesend) -> rot(abwesend) ->
   orange(krank) -> neutral. Dynamic writes are LAN-only (greyed out offline). */
(() => {
  'use strict';

  const STATUS_ORDER = ['', 'anwesend', 'abwesend', 'krank'];
  const STATUS_LABEL = { '': 'offen', anwesend: 'anwesend', abwesend: 'abwesend', krank: 'krank' };

  const fmtDay = (iso) => {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.`;
  };
  const weekday = (iso) => ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(iso + 'T00:00:00').getDay()];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function nextStatus(cur) {
    const i = STATUS_ORDER.indexOf(cur || '');
    return STATUS_ORDER[(i + 1) % STATUS_ORDER.length];
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // ---- main overview page ----------------------------------------------

  function initOverview(root) {
    const wkId = root.dataset.wkId || new URLSearchParams(location.search).get('wk') || '';
    const wkUrl = (url) => {
      const next = new URL(url, location.origin);
      if (wkId) next.searchParams.set('wk', wkId);
      return next.pathname + next.search;
    };
    const postJsonWk = (url, body) => postJson(wkUrl(url), body);
    const today = root.dataset.today;
    const canImport = root.dataset.canImport === 'true';
    const printLogo = root.dataset.printLogo || '';
    const wkLabel = root.dataset.wkLabel || '';
    const mount = root.querySelector('[data-appell-root]');
    const state = {
      data: null,
      listId: new URLSearchParams(location.search).get('list') || '__all',
      view: localStorage.getItem('appell-view') || 'matrix',
      day: today,
      filters: { bereich: '', funktion: '', grad: '', tag: '', liste: '', q: '' },
      canEdit: true,
    };

    const online = () => navigator.onLine !== false;

    async function load() {
      mount.innerHTML = '<p class="muted">Wird geladen …</p>';
      try {
        const url = wkUrl('/api/appell/data' + (state.listId ? '?list=' + encodeURIComponent(state.listId) : ''));
        const res = await fetch(url);
        const data = await res.json();
        if (res.status === 409) { mount.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
        if (!res.ok) throw new Error(data.error || 'Fehler');
        state.data = data;
        state.listId = data.list ? data.list.id : '__all';
        state.canEdit = data.canEditTags !== false;
        if (data.days && data.days.includes(today)) state.day = today;
        else if (data.days && data.days.length) state.day = data.days[0];
        render();
      } catch (e) {
        mount.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      }
    }

    function filteredPersons() {
      const f = state.filters;
      return (state.data.persons || []).filter((p) => {
        if (f.bereich && p.bereich !== f.bereich) return false;
        if (f.funktion && p.funktion !== f.funktion) return false;
        if (f.grad && p.grad !== f.grad) return false;
        if (f.liste && !(p.listNames || [p.listName]).includes(f.liste)) return false;
        if (f.tag && !(p.tags || []).includes(f.tag)) return false;
        if (f.q) {
          const q = f.q.toLowerCase();
          if (!(p.name || '').toLowerCase().includes(q)) return false;
        }
        return true;
      });
    }

    function render() {
      const d = state.data;
      if (!d || !d.list) {
        mount.innerHTML = `<div class="appell-controls">${listSelectorHtml()}</div>
          <p class="muted">Noch keine Appell-Liste vorhanden.${canImport ? ' <a href="/appell/import">Liste importieren</a>.' : ''}</p>`;
        wireControls();
        return;
      }
      const listen = d.filters.listen || [];
      mount.innerHTML = `
        ${!online() ? '<p class="offline-banner no-print">Offline – Anwesenheit kann nur im lokalen Netz erfasst werden.</p>' : ''}
        <div class="appell-controls no-print">
          ${listSelectorHtml()}
          <div class="view-toggle">
            <button data-view="matrix" class="${state.view === 'matrix' ? 'active' : ''}">Übersicht</button>
            <button data-view="day" class="${state.view === 'day' ? 'active' : ''}">Tagesansicht</button>
          </div>
          <button class="btn btn-small" data-print>🖨 Drucken</button>
        </div>
        <div class="appell-filters no-print">
          ${selectHtml('bereich', 'Bereich', d.filters.bereiche)}
          ${selectHtml('funktion', 'Funktion', d.filters.funktionen)}
          ${selectHtml('grad', 'Grad', d.filters.grade)}
          ${listen.length > 1 ? selectHtml('liste', 'Liste', listen) : ''}
          ${selectHtml('tag', 'Tag', d.filters.tags)}
          <input type="search" data-filter="q" placeholder="Name suchen" value="${esc(state.filters.q)}">
          ${state.view === 'day' ? dayPickerHtml() : ''}
        </div>
        <div class="appell-count muted no-print"></div>
        <div class="appell-print-head" data-print-head></div>
        <div data-grid></div>`;
      wireControls();
      renderGrid();
    }

    function listSelectorHtml() {
      const lists = state.data.lists || [];
      const opts = [`<option value="__all" ${state.listId === '__all' ? 'selected' : ''}>Alle Appelllisten</option>`]
        .concat(lists.map((l) => `<option value="${esc(l.id)}" ${l.id === state.listId ? 'selected' : ''}>${esc(l.name)}</option>`));
      return `<label class="list-select">Liste:
        <select data-list-select>${opts.join('')}</select></label>
        ${canImport ? '<a class="btn btn-small" href="/appell/import">+ Import</a>' : ''}`;
    }

    function selectHtml(key, label, values) {
      const opts = ['<option value="">' + label + ': alle</option>']
        .concat((values || []).map((v) => `<option value="${esc(v)}" ${state.filters[key] === v ? 'selected' : ''}>${esc(v)}</option>`));
      return `<select data-filter="${key}">${opts.join('')}</select>`;
    }

    function dayPickerHtml() {
      const opts = state.data.days.map((iso) =>
        `<option value="${iso}" ${iso === state.day ? 'selected' : ''}>${weekday(iso)} ${fmtDay(iso)}${iso === today ? ' (heute)' : ''}</option>`).join('');
      return `<select data-day-select class="day-select">${opts}</select>`;
    }

    function wireControls() {
      mount.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
        state.view = b.dataset.view; localStorage.setItem('appell-view', state.view); render();
      }));
      const ls = mount.querySelector('[data-list-select]');
      if (ls) ls.addEventListener('change', () => { state.listId = ls.value; load(); });
      mount.querySelectorAll('[data-filter]').forEach((el) => {
        const ev = el.tagName === 'INPUT' ? 'input' : 'change';
        el.addEventListener(ev, () => { state.filters[el.dataset.filter] = el.value; renderGrid(); });
      });
      const ds = mount.querySelector('[data-day-select]');
      if (ds) ds.addEventListener('change', () => { state.day = ds.value; renderGrid(); });
      const pb = mount.querySelector('[data-print]');
      if (pb) pb.addEventListener('click', printList);
    }

    function renderGrid() {
      const grid = mount.querySelector('[data-grid]');
      if (!grid) return;
      const persons = filteredPersons();
      const countEl = mount.querySelector('.appell-count');
      if (countEl) countEl.textContent = `${persons.length} Personen`;
      updatePrintHead(persons.length);
      grid.innerHTML = state.view === 'matrix' ? matrixHtml(persons) : dayHtml(persons);
      wireGrid(grid);
    }

    // Print-only header: which list + active filters + date, so a printed sheet
    // documents exactly what selection it represents.
    function updatePrintHead(count) {
      const head = mount.querySelector('[data-print-head]');
      if (!head) return;
      const f = state.filters;
      const parts = [];
      if (f.liste) parts.push('Liste: ' + f.liste);
      if (f.bereich) parts.push('Bereich: ' + f.bereich);
      if (f.funktion) parts.push('Funktion: ' + f.funktion);
      if (f.grad) parts.push('Grad: ' + f.grad);
      if (f.tag) parts.push('Tag: ' + f.tag);
      if (f.q) parts.push('Suche: ' + f.q);
      const listName = state.listId === '__all' ? 'Alle Appelllisten' : (state.data.list && state.data.list.name) || '';
      const dt = new Date();
      const stand = `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
      const logoHtml = printLogo ? `<div class="print-logo-wrap"><img class="print-logo" src="${esc(printLogo)}" alt="Logo"></div>` : '';
      head.innerHTML = `<div class="content-header print-title-row"><h2>Appell – ${esc(listName)}</h2>${logoHtml}</div>
        <div class="print-meta">${wkLabel ? 'WK: ' + esc(wkLabel) + ' · ' : ''}${parts.length ? esc(parts.join(' · ')) + ' · ' : ''}${count} Personen · Stand ${stand}</div>
        <div class="print-legend">✓ anwesend · ✗ abwesend · K krank · ☐ aufgeboten/offen</div>`;
    }

    function cellState(p, iso) {
      if (!p.aufgeboten.includes(iso)) return null;
      const s = (p.status && p.status[iso]) || {};
      return { status: s.status || '', bemerkung: s.bemerkung || '' };
    }

    function matrixHtml(persons) {
      const days = state.data.days;
      const combined = state.listId === '__all';
      const head = days.map((iso) =>
        `<th class="${iso === today ? 'is-today' : ''}"><span>${weekday(iso)}</span>${fmtDay(iso)}</th>`).join('');
      const rows = persons.map((p) => {
        const cells = days.map((iso) => {
          const cs = cellState(p, iso);
          if (!cs) return `<td class="cell-empty ${iso === today ? 'is-today' : ''}"></td>`;
          const note = cs.bemerkung ? ' has-note' : '';
          return `<td class="cell st-${cs.status || 'neutral'}${note} ${iso === today ? 'is-today' : ''}"
            data-cell data-pid="${p.pid}" data-list="${esc(cellList(p, iso))}" data-day="${iso}" title="${esc(STATUS_LABEL[cs.status])}${cs.bemerkung ? ' – ' + esc(cs.bemerkung) : ''}">
            ${cs.bemerkung ? '<span class="note-dot">💬</span>' : ''}</td>`;
        }).join('');
        return `<tr><th class="rowhead" data-person="${p.pid}" data-list="${esc(p.listId)}">
            <span class="p-name">${esc(p.name)}</span>
            <span class="p-meta">${esc(p.grad)} · ${esc(p.bereich)}${combined ? ' · ' + esc(p.listName) : ''}</span>
            ${tagChips(p)}
          </th>${cells}</tr>`;
      }).join('');
      return `<div class="matrix-wrap"><table class="appell-matrix"><thead><tr><th class="rowhead">Person</th>${head}</tr></thead>
        <tbody>${rows || '<tr><td>Keine Personen</td></tr>'}</tbody></table></div>`;
    }

    function dayHtml(persons) {
      const iso = state.day;
      const combined = state.listId === '__all';
      const list = persons.filter((p) => p.aufgeboten.includes(iso));
      const rows = list.map((p) => {
        const cs = cellState(p, iso) || { status: '', bemerkung: '' };
        return `<div class="day-row st-${cs.status || 'neutral'}" data-day-row data-pid="${p.pid}" data-list="${esc(cellList(p, iso))}" data-day="${iso}">
          <button class="day-status" data-cell data-pid="${p.pid}" data-list="${esc(cellList(p, iso))}" data-day="${iso}" title="Status wechseln">${statusGlyph(cs.status)}</button>
          <div class="day-person" data-person="${p.pid}" data-list="${esc(p.listId)}">
            <span class="p-name">${esc(p.name)}</span>
            <span class="p-meta">${esc(p.grad)} · ${esc(p.bereich)} · ${esc(p.funktion)}${combined ? ' · ' + esc(p.listName) : ''}</span>
            ${tagChips(p)}
          </div>
          ${p.mobile ? `<button class="mobile-btn" data-mobile="${esc(p.mobile)}" title="Mobile anzeigen">📱</button>` : ''}
          <input class="note-input" data-note data-pid="${p.pid}" data-list="${esc(p.listId)}" data-day="${iso}" placeholder="Bemerkung" value="${esc(cs.bemerkung)}">
        </div>`;
      }).join('');
      return `<div class="day-head"><strong>${weekday(iso)} ${fmtDay(iso)}${iso === today ? ' · heute' : ''}</strong> — ${list.length} aufgeboten</div>
        <div class="day-list">${rows || '<p class="muted">Niemand an diesem Tag aufgeboten.</p>'}</div>`;
    }

    function statusGlyph(s) {
      return ({ anwesend: '✓', abwesend: '✗', krank: '+' }[s]) || '·';
    }

    function tagChips(p) {
      if (!p.tags || !p.tags.length) return '';
      return '<span class="tag-chips">' + p.tags.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('') + '</span>';
    }

    function wireGrid(grid) {
      grid.querySelectorAll('[data-cell]').forEach((el) => el.addEventListener('click', () => cycleCell(el)));
      grid.querySelectorAll('[data-note]').forEach((el) => {
        let timer;
        el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => saveNote(el), 600); });
        el.addEventListener('blur', () => { clearTimeout(timer); saveNote(el); });
      });
      grid.querySelectorAll('[data-mobile]').forEach((el) => el.addEventListener('click', (e) => {
        e.stopPropagation();
        const num = el.dataset.mobile;
        el.outerHTML = `<a class="mobile-num" href="tel:${esc(num.replace(/\s/g, ''))}">${esc(num)}</a>`;
      }));
      grid.querySelectorAll('[data-person]').forEach((el) => el.addEventListener('click', (e) => {
        if (e.target.closest('[data-cell],[data-note],[data-mobile]')) return;
        openDetail(el.dataset.person, el.dataset.list);
      }));
    }

    function findPerson(pid, listId) {
      const ps = state.data.persons;
      return ps.find((p) => p.pid === pid && (!listId || p.listId === listId)) || ps.find((p) => p.pid === pid);
    }

    // In the combined view a person can belong to several lists; each day is
    // owned by the list that aufgeboten it (server-provided dayList map). Falls
    // back to the person's primary list for a single-list view.
    function cellList(p, iso) {
      return (p.dayList && p.dayList[iso]) || p.listId;
    }

    // Targeted visual update so we don't re-render the whole matrix (hundreds of
    // rows) on every tap, and so an open modal updates in place too.
    function paintStatus(el, status) {
      const cls = 'st-' + (status || 'neutral');
      if (el.matches('td[data-cell]')) {
        el.className = el.className.replace(/st-\S+/, cls);
      } else if (el.matches('button[data-cell]')) {
        el.textContent = statusGlyph(status);
        const row = el.closest('.day-row, .modal-day');
        if (row) row.className = row.className.replace(/st-\S+/, cls);
      }
    }

    async function cycleCell(el) {
      if (!online()) { toast('Offline – nicht möglich.'); return; }
      const pid = el.dataset.pid, iso = el.dataset.day, listId = el.dataset.list || state.listId;
      const p = findPerson(pid, listId);
      if (!p) return;
      const cur = (p.status[iso] && p.status[iso].status) || '';
      const note = (p.status[iso] && p.status[iso].bemerkung) || '';
      const next = nextStatus(cur);
      paintStatus(el, next); // optimistic
      try {
        await postJsonWk('/api/appell/status', { list: listId, pid, day: iso, status: next, bemerkung: note });
        p.status[iso] = { status: next, bemerkung: note };
      } catch (e) { paintStatus(el, cur); toast(e.message); }
    }

    async function saveNote(el) {
      const pid = el.dataset.pid, iso = el.dataset.day, listId = el.dataset.list || state.listId;
      const p = findPerson(pid, listId);
      if (!p) return;
      const cur = (p.status[iso] && p.status[iso].status) || '';
      const note = el.value;
      if (((p.status[iso] && p.status[iso].bemerkung) || '') === note) return;
      if (!online()) { toast('Offline – nicht möglich.'); return; }
      try {
        await postJsonWk('/api/appell/status', { list: listId, pid, day: iso, status: cur, bemerkung: note });
        p.status[iso] = { status: cur, bemerkung: note };
      } catch (e) { toast(e.message); }
    }

    // ---- person detail modal (contact + tags + per-day) ----------------
    function openDetail(pid, listId) {
      const p = findPerson(pid, listId);
      if (!p) return;
      const days = state.data.days.filter((iso) => p.aufgeboten.includes(iso));
      const dayRows = days.map((iso) => {
        const cs = cellState(p, iso) || { status: '', bemerkung: '' };
        const lid = cellList(p, iso);
        return `<div class="modal-day st-${cs.status || 'neutral'}">
          <span>${weekday(iso)} ${fmtDay(iso)}</span>
          <button class="day-status" data-cell data-pid="${pid}" data-list="${esc(lid)}" data-day="${iso}">${statusGlyph(cs.status)}</button>
          <input class="note-input" data-note data-pid="${pid}" data-list="${esc(lid)}" data-day="${iso}" placeholder="Bemerkung" value="${esc(cs.bemerkung)}">
        </div>`;
      }).join('');
      // Einrückort can differ per list; show each with its list name in
      // parentheses when the person belongs to more than one list.
      const sources = p.sources || (p.einrueckort ? [{ listName: p.listName, einrueckort: p.einrueckort }] : []);
      const multi = (p.listNames || []).length > 1;
      const einrueckHtml = sources
        .filter((s) => s.einrueckort)
        .map((s) => `<br>📍 ${esc(s.einrueckort)}${multi ? ` <span class="muted">(${esc(s.listName)})</span>` : ''}`)
        .join('');
      const ov = document.createElement('div');
      ov.className = 'appell-modal-overlay';
      ov.innerHTML = `<div class="appell-modal" role="dialog">
        <button class="modal-close" aria-label="Schliessen">×</button>
        <h2>${esc(p.name)}</h2>
        <p class="muted">${esc(p.grad)} · ${esc(p.bereich)} · ${esc(p.funktion)}${p.jg ? ' · JG ' + esc(p.jg) : ''}</p>
        <p class="modal-contact">
          ${p.mobile ? `📱 <a href="tel:${esc(p.mobile.replace(/\s/g, ''))}">${esc(p.mobile)}</a>` : ''}
          ${p.email ? `<br>✉ <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}
          ${einrueckHtml}
        </p>
        <div class="modal-tags">
          <label>Tags / Gruppe ${state.canEdit ? '' : '<span class="muted">(nur Uof+)</span>'}</label>
          <div data-tag-list></div>
          ${state.canEdit ? '<form data-tag-form><input type="text" placeholder="Tag hinzufügen" data-tag-input><button type="submit" class="btn btn-small">+</button></form>' : ''}
        </div>
        <div class="modal-days">${dayRows || '<p class="muted">Keine aufgebotenen Tage.</p>'}</div>
      </div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.modal-close').addEventListener('click', close);
      wireGrid(ov);
      renderTags(ov, p);
      const form = ov.querySelector('[data-tag-form]');
      if (form) form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = ov.querySelector('[data-tag-input]');
        const val = input.value.trim();
        if (!val) return;
        await updateTags(p, [...(p.tags || []), val], ov);
        input.value = '';
      });
    }

    function renderTags(ov, p) {
      const box = ov.querySelector('[data-tag-list]');
      box.innerHTML = (p.tags || []).map((t) =>
        `<span class="tag-chip">${esc(t)}${state.canEdit ? `<button data-remove-tag="${esc(t)}" aria-label="entfernen">×</button>` : ''}</span>`).join('') || '<span class="muted">keine</span>';
      box.querySelectorAll('[data-remove-tag]').forEach((b) => b.addEventListener('click', () =>
        updateTags(p, (p.tags || []).filter((t) => t !== b.dataset.removeTag), ov)));
    }

    async function updateTags(p, tags, ov) {
      if (!online()) { toast('Offline – nicht möglich.'); return; }
      // A merged person can belong to several lists; keep the tag consistent by
      // writing it to each of them.
      const targets = (p.listIds && p.listIds.length) ? p.listIds : [p.listId];
      try {
        let clean = tags;
        for (const lid of targets) {
          const r = await postJsonWk('/api/appell/tags', { list: lid, pid: p.pid, tags });
          clean = r.tags;
        }
        p.tags = clean;
        renderTags(ov, p);
        renderGrid();
      } catch (e) { toast(e.message); }
    }

    // Print the current selection as a sheet. Forces the matrix view, switches
    // the page to landscape, and restores everything afterwards.
    function printList() {
      const prevView = state.view;
      if (state.view !== 'matrix') { state.view = 'matrix'; renderGrid(); }
      const style = document.createElement('style');
      style.id = 'appell-print-page';
      style.textContent = '@page { size: landscape; margin: 8mm; }';
      document.head.appendChild(style);
      const cleanup = () => {
        style.remove();
        window.removeEventListener('afterprint', cleanup);
        if (prevView !== 'matrix') { state.view = prevView; renderGrid(); }
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
    }

    function toast(msg) {
      let t = document.querySelector('.appell-toast');
      if (!t) { t = document.createElement('div'); t.className = 'appell-toast'; document.body.appendChild(t); }
      t.textContent = msg; t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2500);
    }

    window.addEventListener('online', () => render());
    window.addEventListener('offline', () => render());
    load();
  }

  // ---- import page -----------------------------------------------------

  function initImport(root) {
    const form = root.querySelector('[data-import-form]');
    const statusEl = root.querySelector('[data-import-status]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = form.file.files[0];
      if (!file) return;
      const target = form.target.value;
      const params = new URLSearchParams();
      params.set('target', target);
      params.set('filename', file.name);
      if (target === '__update') params.set('list', form.list.value);
      else params.set('name', form.name.value.trim() || 'Liste');
      statusEl.textContent = 'Wird hochgeladen und geprüft …';
      try {
        const res = await fetch('/appell/import?' + params.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Fehler');
        location.href = data.reviewUrl;
      } catch (err) {
        statusEl.textContent = '';
        alert('Import fehlgeschlagen: ' + err.message);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const ov = document.querySelector('[data-appell]');
    if (ov) initOverview(ov);
    const imp = document.querySelector('[data-appell-import]');
    if (imp) initImport(imp);
  });
})();
