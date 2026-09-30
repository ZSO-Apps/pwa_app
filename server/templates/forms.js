import { marked } from 'marked';
import { findKachelBySlug } from '../layout.js';
import { isDisplay, isStored } from '../form-elements.js';
import { layout } from './layout.js';
import { esc, formatDateTime, PLUS_ICON, PRINT_ICON, renderPrintLogo } from './shared.js';

// A form def may be a revised version whose `id` is the versionId; every
// `/forms/<...>` route and the nr label key on the stable family id.
function familyId(def) {
  return def?.version?.family || def?.id;
}

function submissionWkLabel(req, def, submission) {
  if (def.scope === 'global') return '-';
  const wkId = submission._meta?.wkId || req.activeWk?.id || '';
  const wk = (req.wkList || []).find((item) => item.id === wkId)
    || (req.activeWk?.id === wkId ? req.activeWk : null);
  return wk?.label || wkId || '-';
}

// Where a form's "Zurück" link should point: the Kachel it was opened from,
// falling back to the start page if it can't be resolved.
function formBackUrl(def) {
  const k = findKachelBySlug(def?._slug);
  return k ? `/k/${k.id}` : '/';
}

function withWkParam(url, wkId) {
  if (!wkId) return url;
  const raw = String(url || '');
  const hashIndex = raw.indexOf('#');
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const hash = hashIndex >= 0 ? raw.slice(hashIndex) : '';
  const queryIndex = withoutHash.indexOf('?');
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '');
  params.set('wk', wkId);
  return pathname + '?' + params.toString() + hash;
}

function wkParamForDef(req, def) {
  if (def?.scope === 'global') return '';
  return req?.activeWk?.id || '';
}


function renderFieldImage(f, alt = '') {
  if (!f?.image) return '';
  return '<img class="form-field-image" src="' + esc(f.image) + '" alt="' + esc(alt) + '">';
}

function answerArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return [String(value)];
}

function correctArray(field) {
  return answerArray(field?.correct);
}

function sameAnswerSet(a, b) {
  const left = answerArray(a).map((value) => value.toLocaleLowerCase('de-CH')).sort();
  const right = answerArray(b).map((value) => value.toLocaleLowerCase('de-CH')).sort();
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function fieldIsCorrect(field, submission) {
  if (field?.correct === undefined) return null;
  return sameAnswerSet(submission[field.name], field.correct);
}

function scoreableFields(def) {
  return (def.fields || []).filter((field) => isStored(field) && field.correct !== undefined);
}

function isQuizDef(def) {
  return Boolean(def?.quiz || scoreableFields(def).length);
}

const QUIZ_NAME_FIELD = { name: 'name', type: 'text', label: 'Name', required: true, width: 'half' };

function quizNeedsVirtualNameField(def) {
  return isQuizDef(def) && !(def.fields || []).some((field) => field?.name === 'name');
}

function fieldsForForm(def) {
  const fields = def.fields || [];
  return quizNeedsVirtualNameField(def) ? [QUIZ_NAME_FIELD, ...fields] : fields;
}

function quizSubmissionTitle(submission) {
  return submission?.name || ('Quiz vom ' + (formatDateTime(submission?._meta?.submittedAt) || 'Eintrag'));
}

function quizScore(def, submission) {
  const fields = scoreableFields(def);
  let correct = 0;
  for (const field of fields) {
    if (fieldIsCorrect(field, submission)) correct++;
  }
  return { correct, wrong: fields.length - correct, total: fields.length };
}

function formatAnswerValue(value) {
  const values = answerArray(value);
  return values.length ? values.join(', ') : '-';
}

function renderDupNameWarning(def) {
  const dups = def?._dupNames || [];
  if (!dups.length) return '';
  return `<p class="err">⚠ Achtung: Die Elemente ${esc(dups.join(', '))} sind nicht korrekt hinterlegt (doppelte Feldnamen). Eingaben dieser Felder können verloren gehen.</p>`;
}

function renderFormPrintBootstrap() {
  return `<script>
(() => {
  const script = document.currentScript;
  const root = script && script.closest('.form-page');
  const form = root && root.querySelector('form[data-enhanced-form]');
  const printButton = root && root.querySelector('[data-form-print]');
  if (!form || !printButton) return;
  const update = () => { printButton.disabled = !form.checkValidity(); };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  printButton.addEventListener('click', () => {
    if (!form.reportValidity()) { update(); return; }
    if (window.ZSOPrint && window.ZSOPrint.form) {
      window.ZSOPrint.form(root, form);
      return;
    }
    window.print();
  });
  printButton.dataset.printBound = 'inline';
  update();
})();
</script>`;
}

// Text input backed by a <datalist> of Arbeitsplatz names for the active WK.
// Free text stays allowed; unknown values auto-create an Arbeitsplatz on submit.
function renderLocationField(f, currentString, common, ctx) {
  const listId = 'dl-' + esc(f.name);
  const options = (ctx?.locations || [])
    .map((name) => `<option value="${esc(name)}"></option>`)
    .join('');
  return `<input type="text" ${common} value="${esc(currentString)}" list="${listId}" autocomplete="off">`
    + `<datalist id="${listId}">${options}</datalist>`;
}

// Online-only Leaflet map widget + hidden input holding {"lat","lon","zoom"}.
function renderMapField(f, currentString) {
  const address = esc(f.addressField || 'adresse');
  const coord = esc(f.coordField || 'koordinaten');
  return `<div class="map-field" data-map-field data-address-field="${address}" data-coord-field="${coord}" data-online-only>
    <input type="hidden" name="${esc(f.name)}" id="f-${esc(f.name)}" data-map-input value="${esc(currentString)}">
    <div class="map-canvas" data-map-canvas></div>
    <div class="map-offline muted" data-map-offline hidden>Karte nur online verfügbar.</div>
    <div class="map-controls no-print">
      <button type="button" class="secondary-button compact" data-map-address>Adresse suchen</button>
      <button type="button" class="secondary-button compact" data-map-coords>Koordinaten übernehmen</button>
      <button type="button" class="secondary-button compact" data-map-clear>Pin entfernen</button>
    </div>
  </div>`;
}

function renderField(f, value = '', ctx = null) {
  const current = value ?? '';
  const currentString = String(current);
  const common = `name="${esc(f.name)}" id="f-${esc(f.name)}"${f.required ? ' required' : ''}`;
  if (f.type === 'location') return renderLocationField(f, currentString, common, ctx);
  if (f.type === 'map') return renderMapField(f, currentString);
  if (f.type === 'checkbox') {
    return `<label class="checkbox"><input type="checkbox" ${common}${current ? ' checked' : ''}> ${esc(f.label || f.name)}</label>`;
  }
  if (f.type === 'checkboxes') {
    const selected = answerArray(current);
    const required = f.required ? ' data-required="true"' : '';
    return '<div class="checkbox-group" data-checkbox-group="' + esc(f.name) + '"' + required + '>' + (f.options || []).map((o) => {
      const option = String(o);
      const checked = selected.includes(option) ? ' checked' : '';
      return '<label class="checkbox"><input type="checkbox" name="' + esc(f.name) + '" value="' + esc(option) + '"' + checked + '> ' + esc(option) + '</label>';
    }).join('') + '</div>';
  }
  if (f.type === 'textarea') return `<textarea ${common} rows="4">${esc(currentString)}</textarea>`;
  if (f.type === 'radio') {
    return (f.options || []).map((o, i) => {
      const option = String(o);
      const checked = currentString !== '' && currentString === option ? ' checked' : '';
      const required = i === 0 && f.required ? ' required' : '';
      return `<label class="radio"><input type="radio" name="${esc(f.name)}" value="${esc(option)}"${required}${checked}> ${esc(option)}</label>`;
    }).join('');
  }
  if (f.type === 'select') {
    const options = (f.options || []).map((o) => {
      const option = String(o);
      const selected = currentString === option ? ' selected' : '';
      return `<option value="${esc(option)}"${selected}>${esc(option)}</option>`;
    }).join('');
    const emptySelected = currentString === '' ? ' selected' : '';
    return `<select ${common}><option value=""${emptySelected}>Bitte auswählen</option>${options}</select>`;
  }
  const type = ['text', 'number', 'date', 'time', 'email'].includes(f.type) ? f.type : 'text';
  const minmax = (f.min !== undefined ? ` min="${esc(f.min)}"` : '') + (f.max !== undefined ? ` max="${esc(f.max)}"` : '');
  return `<input type="${type}" ${common}${minmax} value="${esc(currentString)}">`;
}

function widthClass(el) {
  const w = el?.width;
  if (w === 'half') return ' w-half';
  if (w === 'third') return ' w-third';
  if (w === 'quarter') return ' w-quarter';
  return '';
}

function renderDisplayElement(f) {
  if (f.type === 'heading') {
    const style = f.color ? ` style="--banner-c:${esc(f.color)}"` : '';
    return `<div class="form-heading"${style}>${esc(f.label || '')}</div>`;
  }
  if (f.type === 'paragraph') {
    // Inline Markdown (z.B. **fett**, *kursiv*) — gleicher Autorenkreis/Trust
    // wie die .md-Inhalte, die ebenfalls mit marked gerendert werden.
    return `<p class="form-paragraph">${marked.parseInline(String(f.text || f.label || ''))}</p>`;
  }
  if (f.type === 'image') {
    const image = renderFieldImage(f, f.label || 'Bild');
    if (!image) return '';
    const caption = f.label ? '<figcaption>' + esc(f.label) + '</figcaption>' : '';
    return '<figure class="form-image-block">' + image + caption + '</figure>';
  }
  if (f.type === 'signature') {
    return `<div class="form-signature"><span class="sig-line"></span><span class="sig-label">${esc(f.label || 'Unterschrift')}</span></div>`;
  }
  return '';
}

function renderFormElement(f, values, ctx = null) {
  if (isDisplay(f)) return renderDisplayElement(f);
  if (f.type === 'checkbox') {
    return `<div class="field field-check">${renderField(f, values[f.name], ctx)}</div>`;
  }
  const compact = f.compact ? ' field--compact' : '';
  return `<div class="field${compact}">
    <label for="f-${esc(f.name)}">${esc(f.label || f.name)}${f.required ? ' *' : ''}</label>
    ${renderFieldImage(f)}
    ${renderField(f, values[f.name], ctx)}
  </div>`;
}

function renderDraftDetailElement(f) {
  if (isDisplay(f)) return renderDisplayElement(f);
  const label = esc(f.label || f.name || '');
  const image = renderFieldImage(f);
  if (f.type === 'checkbox') {
    if (f.printOnly) {
      return `<div class="sub-check">${image}<span class="box">☐</span> <span>${label}</span></div>`;
    }
    return `<div class="sub-check" data-print-check="${esc(f.name)}">${image}<span class="box">☐</span> <span>${label}</span></div>`;
  }
  const compact = f.compact && f.type !== 'textarea' ? ' sub-field--compact' : '';
  if (f.printOnly) {
    const big = f.type === 'textarea';
    return `<div class="sub-field${big ? ' sub-field--block' : compact}">
      ${image}
      <div class="sub-label">${label}</div>
      <div class="sub-write${big ? ' sub-write--block' : ''}"></div>
    </div>`;
  }
  return `<div class="sub-field${compact}">
    ${image}
    <div class="sub-label">${label}</div>
    <div class="sub-value" data-print-value="${esc(f.name)}"></div>
  </div>`;
}

function renderFormPrintTemplate(def) {
  const elements = fieldsForForm(def)
    .map((f) => `<div class="sub-el${widthClass(f)}">${renderDraftDetailElement(f)}</div>`)
    .join('\n');
  return `<template data-form-print-template>
    <article class="content sub-detail print-page">
      <div class="content-header print-title-row">
        <h1>${esc(def.title || def.id)}</h1>
        ${renderPrintLogo()}
      </div>
      <p class="muted" data-print-generated>Druckvorschau, noch nicht gespeichert</p>
      <div class="sub-elements">${elements || '<em>Keine Felder</em>'}</div>
    </article>
  </template>`;
}

export function renderFormPage(req, def, { submitted = false, values = {}, detailUrl = '', editUrl = '', backUrl = '', locations = [] } = {}) {
  const elements = fieldsForForm(def).filter((f) => !f.printOnly);
  const ctx = { locations };
  const hasMap = elements.some((f) => f.type === 'map');
  const isEdit = Boolean(editUrl);
  const submitLabel = isEdit ? 'Änderungen speichern' : submitted ? 'Neue Eingabe mit diesen Daten speichern' : 'Senden';
  const detailAttr = detailUrl ? ` data-detail-url="${esc(detailUrl)}"` : '';
  const back = backUrl || formBackUrl(def);
  const wkParam = wkParamForDef(req, def);
  const action = isEdit
    ? editUrl
    : `/forms/${esc(familyId(def))}${wkParam ? '?wk=' + encodeURIComponent(wkParam) : ''}`;
  const body = `
  <article class="content narrow form-page">
    <p><a href="${esc(back)}" class="back">← Zurück</a></p>
    <div class="content-header">
      <h1>${esc(def.title || def.id)}${isEdit ? ' — bearbeiten' : ''}</h1>
      <button type="button" class="secondary-button icon-button no-print" data-form-print${detailAttr} disabled title="Drucken" aria-label="Drucken">${PRINT_ICON}</button>
    </div>
    ${renderDupNameWarning(def)}
    ${submitted ? `<p class="ok">✓ Eingabe gespeichert. Die Werte bleiben als Vorlage erhalten. Erneutes Speichern erstellt eine neue Eingabe.</p>` : ''}
    <form method="POST" action="${esc(action)}" class="genform" data-enhanced-form data-online-only-form>
      ${elements.map((f) => `<div class="form-el${widthClass(f)}">${renderFormElement(f, values, ctx)}</div>`).join('\n')}
      <button type="submit" data-online-only="true">${esc(submitLabel)}</button>
    </form>
    <p><a href="${esc(back)}" class="back">← Zurück</a></p>
    ${renderFormPrintTemplate(def)}
    ${renderFormPrintBootstrap()}
  </article>`;
  const extraHead = hasMap
    ? '<link rel="stylesheet" href="/vendor/leaflet/leaflet.css"><script src="/vendor/leaflet/leaflet.js" defer></script><script src="/client/map-field.js" defer></script>'
    : '';
  return layout(req, { title: def.title || 'Formular', body, extraHead });
}

function submissionTitleField(def) {
  const fields = def.fields || [];
  const preferredNames = ['titel', 'title', 'name', 'betreff', 'thema', 'sender'];
  return preferredNames
    .map((name) => fields.find((field) => field.name === name && isStored(field)))
    .find(Boolean) || null;
}

function submissionTitle(def, submission) {
  const fields = def.fields || [];
  const preferred = submissionTitleField(def);
  const fallback = preferred || fields.find(isStored);
  const value = fallback ? submission[fallback.name] : '';
  return value || submission._meta?.submittedBy || formatDateTime(submission._meta?.submittedAt) || 'Eintrag';
}

function submissionUrl(def, submission, { archiveMode = false } = {}) {
  const id = submission._meta?.submissionId;
  if (!id) return '#';
  if (archiveMode && def.id === 'wk') return '/forms/wk/archive/' + encodeURIComponent(id);
  const url = '/forms/' + encodeURIComponent(familyId(def)) + '/results/' + encodeURIComponent(id);
  return def.scope === 'global' ? url : withWkParam(url, submission._meta?.wkId || '');
}

// Display label for a submission's sequential number, e.g. "essensbestellung_3".
function submissionNrLabel(def, submission) {
  const nr = submission?._meta?.nr;
  return Number.isInteger(nr) ? `${familyId(def)}_${nr}` : '';
}

function isStandardSubmission(submission) {
  return submission?._meta?.scope === '_standard';
}

function fmtCell(field, value) {
  if (field.type === 'checkbox') return value ? '☑' : '☐';
  if (Array.isArray(value)) return value.join(', ');
  return value ?? '';
}

function wkNameFor(submission) {
  return submission.wk_name || submission.name || '';
}

function resultColumnsFor(def, { archiveMode = false } = {}) {
  // map fields carry a JSON blob, not a tabular value — never a results column.
  const storedFields = (def.fields || []).filter((f) => isStored(f) && f.type !== 'map');
  if (isQuizDef(def)) {
    return {
      storedFields,
      headers: ['Name', 'Richtig', 'Falsch', 'Punkte', 'Erstellungsdatum', 'Benutzer'],
      cells(definition, submission) {
        const score = quizScore(definition, submission);
        const url = submissionUrl(definition, submission, { archiveMode });
        const title = quizSubmissionTitle(submission);
        return [
          `<td><a href="${esc(url)}">${esc(title)}</a></td>`,
          `<td>${esc(score.correct)}</td>`,
          `<td>${esc(score.wrong)}</td>`,
          `<td>${esc(score.correct + '/' + score.total)}</td>`,
          `<td>${esc(formatDateTime(submission._meta?.submittedAt))}</td>`,
          `<td>${esc(submission._meta?.submittedBy || '')}</td>`,
        ];
      },
    };
  }
  if (def.id !== 'wk') {
    const titleField = submissionTitleField(def);
    const visibleFields = titleField
      ? storedFields.filter((f) => f.name !== titleField.name)
      : storedFields;
    return {
      storedFields: visibleFields,
      headers: ['Name / Titel', ...visibleFields.map((f) => f.label || f.name), 'Erstellungsdatum', 'Benutzer'],
      cells(definition, submission) {
        const title = submissionTitle(definition, submission);
        const url = submissionUrl(definition, submission, { archiveMode });
        return [
          `<td><a href="${esc(url)}">${esc(title)}</a></td>`,
          ...visibleFields.map((f) => `<td>${esc(fmtCell(f, submission[f.name]))}</td>`),
          `<td>${esc(formatDateTime(submission._meta?.submittedAt))}</td>`,
          `<td>${esc(submission._meta?.submittedBy || '')}</td>`,
        ];
      },
    };
  }

  const wkFields = storedFields.filter((f) => f.name !== 'wk_name' && f.name !== 'name' && f.name !== 'nummer');
  return {
    storedFields: wkFields,
    headers: ['WK Name', 'WK Nummer', ...wkFields.map((f) => f.label || f.name), 'Erstellungsdatum', 'Benutzer'],
    cells(_definition, submission) {
      const url = submissionUrl(def, submission, { archiveMode });
      const wkName = wkNameFor(submission);
      return [
        `<td><a href="${esc(url)}">${esc(wkName || 'WK')}</a></td>`,
        `<td>${esc(submission.nummer || '')}</td>`,
        ...wkFields.map((f) => `<td>${esc(fmtCell(f, submission[f.name]))}</td>`),
        `<td>${esc(formatDateTime(submission._meta?.submittedAt))}</td>`,
        `<td>${esc(submission._meta?.submittedBy || '')}</td>`,
      ];
    },
  };
}

function renderResultsTable(def, submissions, { archiveMode = false, canArchive = false, canUnarchive = false, metaText = '' } = {}) {
  const columns = resultColumnsFor(def, { archiveMode });
  const hasArchiveAction = def.id === 'wk' && !archiveMode && canArchive;
  const hasUnarchiveAction = def.id === 'wk' && archiveMode && canUnarchive;
  const rows = submissions.map((s) => {
    const title = submissionTitle(def, s);
    const url = submissionUrl(def, s, { archiveMode });
    const id = s._meta?.submissionId || '';
    const nrLabel = submissionNrLabel(def, s);
    const badge = isStandardSubmission(s) ? ' <span class="badge">Standard</span>' : '';
    return `<tr data-print-row data-print-url="${esc(url)}">
      <td class="select-col"><input type="checkbox" data-print-select name="submissionId" value="${esc(id)}" aria-label="${esc(title)} auswählen"></td>
      <td class="nr-col">${esc(nrLabel)}${badge}</td>
      ${columns.cells(def, s).join('')}
    </tr>`;
  }).join('');

  const printButton = `<button type="button" class="secondary-button icon-button" data-print-selected data-selected-action disabled title="Ausgewählte drucken" aria-label="Ausgewählte drucken">${PRINT_ICON}</button>`;
  const archiveButton = hasArchiveAction
    ? '<button type="submit" class="secondary-button" data-selected-action data-online-only disabled>Archivieren</button>'
    : '';
  const unarchiveButton = hasUnarchiveAction
    ? '<button type="submit" class="secondary-button" data-selected-action data-online-only disabled>Aktivieren</button>'
    : '';
  const hasFormAction = hasArchiveAction || hasUnarchiveAction;
  const formStart = hasArchiveAction
    ? `<form method="POST" action="/forms/wk/archive" data-online-only-form onsubmit="return confirm('Ausgewählte WK archivieren?')">`
    : hasUnarchiveAction
      ? '<form method="POST" action="/forms/wk/unarchive" data-online-only-form>'
      : '';
  const formEnd = hasFormAction ? '</form>' : '';
  const allHeaders = ['Nr.', ...columns.headers];
  const sortableHeaders = allHeaders.map((h, index) => '<th aria-sort="none"><button type="button" class="table-sort-button" data-sort-col="' + index + '">' + esc(h) + '<span class="sort-indicator" aria-hidden="true"></span></button></th>').join('');
  const metaParts = [metaText, submissions.length + ' Eingabe(n)'].filter(Boolean);
  const metaHtml = metaParts.map((part) => '<span>' + esc(part) + '</span>').join('<span aria-hidden="true">·</span>');

  if (!submissions.length) {
    return `
    <div class="results-toolbar">
      <div class="results-meta">${metaHtml}</div>
    </div>
    <p><em>Noch keine Eingaben.</em></p>`;
  }

  return `
    ${formStart}
    <div class="results-toolbar">
      <div class="results-meta">${metaHtml}</div>
      <div class="results-controls no-print">
        <label class="results-filter"><span>Filter</span><input type="search" data-results-filter placeholder="Tabelle filtern"></label>
        <div class="result-print-actions">
          ${printButton}
          ${archiveButton}
          ${unarchiveButton}
          <span class="muted" data-print-count>0 ausgewählt</span>
        </div>
      </div>
    </div>
    <div class="tablewrap"><table class="results" data-results-table>
      <thead><tr><th class="select-col"><input type="checkbox" data-print-select-all aria-label="Alle auswählen"></th>${sortableHeaders}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${formEnd}`;
}
function renderModifyToggle(def, wkParam, versionId = '') {
  const on = Boolean(def.modifyAllow);
  const family = familyId(def);
  const params = new URLSearchParams();
  if (wkParam) params.set('wk', wkParam);
  // Toggle the version currently in view (its own def carries modifyAllow).
  if (versionId && versionId !== family) params.set('v', versionId);
  const qs = params.toString() ? '?' + params.toString() : '';
  return `<form class="modify-toggle no-print" method="POST" action="/forms/${esc(family)}/modify-allow${qs}" data-online-only-form>
    <label class="switch">
      <span class="switch-caption">Bearbeiten erlaubt</span>
      <input type="checkbox" role="switch"${on ? ' checked' : ''} data-online-only="true" onchange="this.form.submit()">
      <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
      <span class="switch-state">${on ? 'an' : 'aus'}</span>
    </label>
    <noscript><button type="submit" class="secondary-button">${on ? 'ausschalten' : 'einschalten'}</button></noscript>
  </form>`;
}

// Version controls above the results table: revise button, view/pin selects and
// the multi-active warning. Only shown for a family that actually has versions.
function renderVersionToolbar(version) {
  if (!version) return '';
  const { family, viewVersionId, activeVersionId, options, canRevise, canPin, multiActive, hasVersions } = version;
  const parts = [];
  if (canRevise) {
    // Revise starting from the version currently in view (falls back to active).
    const from = viewVersionId ? '?from=' + encodeURIComponent(viewVersionId) : '';
    parts.push(`<a class="secondary-button" data-online-only="true" href="/forms/${esc(family)}/revise${from}">Überarbeiten</a>`);
  }
  if (hasVersions) {
    const viewOpts = options.map((o) => `<option value="${esc(o.id)}"${o.id === viewVersionId ? ' selected' : ''}>${esc(o.label)}${o.hasResults ? '' : ' (leer)'}${o.isActive ? ' • aktiv' : ''}</option>`).join('');
    parts.push(`<form method="GET" class="version-select"><label>Version anzeigen <select name="v" onchange="this.form.submit()">${viewOpts}</select></label></form>`);
    if (canPin) {
      const pinOpts = options.map((o) => `<option value="${esc(o.id)}"${o.id === activeVersionId ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
      parts.push(`<form method="POST" action="/forms/${esc(family)}/pin" class="version-select" data-online-only-form><label>Aktive Version <select name="versionId">${pinOpts}</select></label><button type="submit" class="secondary-button" data-online-only="true">Setzen</button></form>`);
    }
  }
  const warning = multiActive ? '<p class="version-warning">⚠️ Achtung: Mehr als eine Version in diesem WK aktiv!</p>' : '';
  if (!parts.length && !warning) return '';
  return `<div class="version-toolbar no-print">${parts.join('')}</div>${warning}`;
}

export function renderResultsPage(req, def, submissions, { wkLabel, canCreate = false, archiveMode = false, canArchive = false, canUnarchive = false, canToggleModify = false, tableDef = null, version = null } = {}) {
  const metaText = def.scope === 'global'
    ? ''
    : wkLabel
      ? `WK-Kontext: ${wkLabel}`
      : 'Kein WK aktiv.';
  const wkParam = wkParamForDef(req, def);
  const createLabel = def.submitLabel || 'Neuer Eintrag';
  const createButton = !archiveMode && canCreate
    ? `<a class="content-add-button no-print" data-online-only="true" href="${withWkParam('/forms/' + encodeURIComponent(familyId(def)), wkParam)}" title="${esc(createLabel)}" aria-label="${esc(createLabel)}">${PLUS_ICON}</a>`
    : '';
  const pageTitle = archiveMode ? `Archiv — ${def.title || def.id}` : `Auswertung — ${def.title || def.id}`;
  const wkArchiveLink = def.id === 'wk'
    ? archiveMode
      ? '<p class="no-print results-archive-link"><a href="/forms/wk/results">Aktive WK anzeigen</a></p>'
      : '<p class="no-print results-archive-link"><a href="/forms/wk/archive">Archivierte WK anzeigen</a></p>'
    : '';
  const body = `
  <article class="content" data-results-print>
    <p class="no-print"><a href="${esc(formBackUrl(def))}" class="back">← Zurück</a></p>
    <div class="content-header">
      <h1>${esc(pageTitle)}</h1>
      ${createButton}
    </div>
    ${canToggleModify && !archiveMode ? renderModifyToggle(tableDef || def, wkParam, version?.viewVersionId) : ''}
    ${!archiveMode ? renderVersionToolbar(version) : ''}
    ${renderResultsTable(tableDef || def, submissions, { archiveMode, canArchive, canUnarchive, metaText })}
    ${wkArchiveLink}
    <p><a href="${esc(formBackUrl(def))}" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: archiveMode ? 'Archiv' : 'Auswertung', body });
}

// A stored map snapshot, embedded in the detail view and reused for print.
function renderMapSnapshotBlock(label, url) {
  if (!url) return '';
  const cap = label ? `<div class="sub-label">${label}</div>` : '';
  return `<div class="sub-field sub-field--block sub-map">${cap}<img class="sub-map-img" src="${esc(url)}" alt="${esc(label || 'Kartenausschnitt')}"></div>`;
}

function renderSubmissionElement(def, submission, f, opts = {}) {
  if (isDisplay(f)) return renderDisplayElement(f);
  const label = esc(f.label || f.name || '');
  const image = renderFieldImage(f);
  if (f.type === 'map') {
    // Never show the raw {lat,lon,zoom} JSON — only the server snapshot, if any.
    return renderMapSnapshotBlock(label, opts.mapSnapshotUrl);
  }
  if (f.type === 'checkbox') {
    const checked = !f.printOnly && submission[f.name];
    return '<div class="sub-check">' + image + '<span class="box">' + (checked ? '☑' : '☐') + '</span> <span>' + label + '</span></div>';
  }
  const compact = f.compact ? ' sub-field--compact' : '';
  if (f.printOnly) {
    const big = f.type === 'textarea';
    return '<div class="sub-field' + (big ? ' sub-field--block' : '') + (big ? '' : compact) + '">' +
      image +
      '<div class="sub-label">' + label + '</div>' +
      '<div class="sub-write' + (big ? ' sub-write--block' : '') + '"></div>' +
    '</div>';
  }
  if (isQuizDef(def) && f.correct !== undefined) {
    const correct = fieldIsCorrect(f, submission);
    return '<div class="sub-field quiz-result ' + (correct ? 'is-correct' : 'is-wrong') + '">' +
      image +
      '<div class="sub-label">' + label + '</div>' +
      '<div class="sub-value">Antwort: ' + esc(formatAnswerValue(submission[f.name])) + '</div>' +
      '<div class="quiz-correct-answer">Korrekt: ' + esc(formatAnswerValue(f.correct)) + '</div>' +
    '</div>';
  }
  return '<div class="sub-field' + compact + '">' +
    image +
    '<div class="sub-label">' + label + '</div>' +
    '<div class="sub-value">' + esc(formatAnswerValue(submission[f.name])) + '</div>' +
  '</div>';
}

export function renderSubmissionPage(req, def, submission, { archiveMode = false, canEdit = false, mapSnapshotUrl = '', arbeitsplatzMapUrl = '', versionLabel = '' } = {}) {
  const heading = isQuizDef(def) ? quizSubmissionTitle(submission) : submissionTitle(def, submission);
  const resultsUrl = archiveMode && def.id === 'wk'
    ? '/forms/wk/archive'
    : withWkParam(`/forms/${esc(familyId(def))}/results`, def.scope === 'global' ? '' : submission._meta?.wkId || '');
  const resultsLabel = archiveMode && def.id === 'wk' ? 'Archiv' : 'Auswertung';
  const elements = fieldsForForm(def)
    .map((f) => `<div class="sub-el${widthClass(f)}">${renderSubmissionElement(def, submission, f, { mapSnapshotUrl })}</div>`)
    .join('\n');
  // For forms whose location value names an Arbeitsplatz, show that Arbeitsplatz's
  // map snapshot (e.g. a Transport-Bestellung's Zielort). Own map fields already
  // render their own snapshot above.
  const arbeitsplatzBlock = !mapSnapshotUrl && arbeitsplatzMapUrl
    ? `<div class="sub-el">${renderMapSnapshotBlock('Arbeitsplatz', arbeitsplatzMapUrl)}</div>`
    : '';
  const score = isQuizDef(def) ? quizScore(def, submission) : null;
  const scoreHtml = score && score.total ? `<p class="quiz-score">Punkte: ${esc(score.correct + '/' + score.total)} · Richtig: ${esc(score.correct)} · Falsch: ${esc(score.wrong)}</p>` : '';
  const nrLabel = submissionNrLabel(def, submission);
  const nrHtml = nrLabel ? `<span class="sub-nr">${esc(nrLabel)}</span>` : '';
  const standardHtml = isStandardSubmission(submission) ? ' <span class="badge">Standard</span>' : '';
  const editUrl = withWkParam(`/forms/${esc(familyId(def))}/results/${esc(submission._meta?.submissionId || '')}/edit`, def.scope === 'global' ? '' : submission._meta?.wkId || '');
  const editButton = canEdit
    ? `<a class="secondary-button no-print" data-online-only="true" href="${esc(editUrl)}">Bearbeiten</a>`
    : '';
  const editedHtml = submission._meta?.editedAt
    ? `<br>Bearbeitet am: ${esc(formatDateTime(submission._meta.editedAt) || '-')} von ${esc(submission._meta?.editedBy || '-')}`
    : '';
  const body = `<article class="content sub-detail">
    <nav class="crumbs no-print"><a href="${resultsUrl}">${resultsLabel}</a> / <span>${esc(heading)}</span></nav>
    <p class="no-print"><a href="${resultsUrl}" class="back">← Zurück</a></p>
    <div class="content-header print-title-row">
      <h1>${esc(def.title || def.id)} ${nrHtml}${standardHtml}</h1>
      ${renderPrintLogo()}
      ${editButton}
      <button type="button" class="secondary-button icon-button no-print" onclick="window.print()" title="Drucken" aria-label="Drucken">${PRINT_ICON}</button>
    </div>
    <p class="muted">Nr.: ${esc(nrLabel || '-')}<br>Gesendet am: ${esc(formatDateTime(submission._meta?.submittedAt) || '-')}<br>Gesendet von: ${esc(submission._meta?.submittedBy || '-')} · WK: ${esc(submissionWkLabel(req, def, submission))}${versionLabel ? '<br>Version: ' + esc(versionLabel) : ''}${editedHtml}</p>
    ${scoreHtml}
    <div class="sub-elements">${elements || '<em>Keine Felder</em>'}${arbeitsplatzBlock}</div>
    <p class="no-print"><a href="${resultsUrl}" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: def.title || heading, body });
}
