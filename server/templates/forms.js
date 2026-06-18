import { marked } from 'marked';
import { findKachelBySlug } from '../layout.js';
import { isDisplay, isStored } from '../form-elements.js';
import { layout } from './layout.js';
import { esc, formatDateTime, PRINT_ICON, renderPrintLogo } from './shared.js';

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

function renderField(f, value = '') {
  const current = value ?? '';
  const currentString = String(current);
  const common = `name="${esc(f.name)}" id="f-${esc(f.name)}"${f.required ? ' required' : ''}`;
  if (f.type === 'checkbox') {
    return `<label class="checkbox"><input type="checkbox" ${common}${current ? ' checked' : ''}> ${esc(f.label || f.name)}</label>`;
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
  if (f.type === 'signature') {
    return `<div class="form-signature"><span class="sig-line"></span><span class="sig-label">${esc(f.label || 'Unterschrift')}</span></div>`;
  }
  return '';
}

function renderFormElement(f, values) {
  if (isDisplay(f)) return renderDisplayElement(f);
  if (f.type === 'checkbox') {
    return `<div class="field field-check">${renderField(f, values[f.name])}</div>`;
  }
  const compact = f.compact ? ' field--compact' : '';
  return `<div class="field${compact}">
    <label for="f-${esc(f.name)}">${esc(f.label || f.name)}${f.required ? ' *' : ''}</label>
    ${renderField(f, values[f.name])}
  </div>`;
}

function renderDraftDetailElement(f) {
  if (isDisplay(f)) return renderDisplayElement(f);
  const label = esc(f.label || f.name || '');
  if (f.type === 'checkbox') {
    if (f.printOnly) {
      return `<div class="sub-check"><span class="box">☐</span> <span>${label}</span></div>`;
    }
    return `<div class="sub-check" data-print-check="${esc(f.name)}"><span class="box">☐</span> <span>${label}</span></div>`;
  }
  if (f.printOnly) {
    const big = f.type === 'textarea';
    return `<div class="sub-field${big ? ' sub-field--block' : ''}">
      <div class="sub-label">${label}</div>
      <div class="sub-write${big ? ' sub-write--block' : ''}"></div>
    </div>`;
  }
  return `<div class="sub-field">
    <div class="sub-label">${label}</div>
    <div class="sub-value" data-print-value="${esc(f.name)}"></div>
  </div>`;
}

function renderFormPrintTemplate(def) {
  const elements = (def.fields || [])
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

export function renderFormPage(req, def, { submitted = false, values = {}, detailUrl = '' } = {}) {
  const elements = (def.fields || []).filter((f) => !f.printOnly);
  const submitLabel = submitted ? 'Neue Eingabe mit diesen Daten speichern' : 'Senden';
  const detailAttr = detailUrl ? ` data-detail-url="${esc(detailUrl)}"` : '';
  const body = `
  <article class="content narrow form-page">
    <p><a href="${esc(formBackUrl(def))}" class="back">← Zurück</a></p>
    <div class="content-header">
      <h1>${esc(def.title || def.id)}</h1>
      <button type="button" class="secondary-button" data-form-print${detailAttr} disabled>Print</button>
    </div>
    ${renderDupNameWarning(def)}
    ${submitted ? `<p class="ok">✓ Eingabe gespeichert. Die Werte bleiben als Vorlage erhalten. Erneutes Speichern erstellt eine neue Eingabe.</p>` : ''}
    <form method="POST" action="/forms/${esc(def.id)}" class="genform" data-enhanced-form>
      ${elements.map((f) => `<div class="form-el${widthClass(f)}">${renderFormElement(f, values)}</div>`).join('\n')}
      <button type="submit">${esc(submitLabel)}</button>
    </form>
    <p><a href="${esc(formBackUrl(def))}" class="back">← Zurück</a></p>
    ${renderFormPrintTemplate(def)}
    ${renderFormPrintBootstrap()}
  </article>`;
  return layout(req, { title: def.title || 'Formular', body });
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
  return '/forms/' + encodeURIComponent(def.id) + '/results/' + encodeURIComponent(id);
}

function fmtCell(field, value) {
  if (field.type === 'checkbox') return value ? '☑' : '☐';
  return value ?? '';
}

function wkNameFor(submission) {
  return submission.wk_name || submission.name || '';
}

function resultColumnsFor(def, { archiveMode = false } = {}) {
  const storedFields = (def.fields || []).filter(isStored);
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

function renderResultsTable(def, submissions, { archiveMode = false, canArchive = false, canUnarchive = false } = {}) {
  const columns = resultColumnsFor(def, { archiveMode });
  const hasArchiveAction = def.id === 'wk' && !archiveMode && canArchive;
  const hasUnarchiveAction = def.id === 'wk' && archiveMode && canUnarchive;
  const rows = submissions.map((s) => {
    const title = submissionTitle(def, s);
    const url = submissionUrl(def, s, { archiveMode });
    const id = s._meta?.submissionId || '';
    return `<tr data-print-row data-print-url="${esc(url)}">
      <td class="select-col"><input type="checkbox" data-print-select name="submissionId" value="${esc(id)}" aria-label="${esc(title)} auswählen"></td>
      ${columns.cells(def, s).join('')}
    </tr>`;
  }).join('');

  let quizSummary = '';
  if (columns.storedFields.some((f) => f.correct !== undefined)) {
    const totals = submissions.map((s) => {
      let correct = 0, total = 0;
      for (const f of columns.storedFields) {
        if (f.correct === undefined) continue;
        total++;
        if (s[f.name] === f.correct) correct++;
      }
      return { correct, total, name: s._meta?.submittedBy || '?' };
    });
    quizSummary = `<h2>Quiz-Zusammenfassung</h2>
      <ul class="quiz-summary">${totals.map((t) => `<li>${esc(t.name)}: ${t.correct}/${t.total}</li>`).join('')}</ul>`;
  }

  const printButton = `<button type="button" class="secondary-button icon-button" data-print-selected data-selected-action disabled title="Ausgewählte drucken" aria-label="Ausgewählte drucken">${PRINT_ICON}</button>`;
  const archiveButton = hasArchiveAction
    ? '<button type="submit" class="secondary-button" data-selected-action data-online-only disabled>Archivieren</button>'
    : '';
  const unarchiveButton = hasUnarchiveAction
    ? '<button type="submit" class="secondary-button" data-selected-action data-online-only disabled>Aktivieren</button>'
    : '';
  const hasFormAction = hasArchiveAction || hasUnarchiveAction;
  const formStart = hasArchiveAction
    ? `<form method="POST" action="/forms/wk/archive" onsubmit="return confirm('Ausgewählte WK archivieren?')">`
    : hasUnarchiveAction
      ? '<form method="POST" action="/forms/wk/unarchive">'
      : '';
  const formEnd = hasFormAction ? '</form>' : '';

  return `
    <p>${submissions.length} Eingabe(n)</p>
    ${quizSummary}
    ${submissions.length ? `
    ${formStart}
    <div class="result-print-actions no-print">
      ${printButton}
      ${archiveButton}
      ${unarchiveButton}
      <span class="muted" data-print-count>0 ausgewählt</span>
    </div>
    <div class="tablewrap"><table class="results">
      <thead><tr><th class="select-col"><input type="checkbox" data-print-select-all aria-label="Alle auswählen"></th>${columns.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${formEnd}` : '<p><em>Noch keine Eingaben.</em></p>'}`;
}

export function renderResultsPage(req, def, submissions, { wkLabel, canCreate = false, archiveMode = false, canArchive = false, canUnarchive = false } = {}) {
  const scopeHint = def.scope === 'global'
    ? ''
    : wkLabel
      ? `<p class="muted">WK-Kontext: ${esc(wkLabel)}</p>`
      : '<p class="muted">Kein WK aktiv.</p>';
  const createButton = !archiveMode && canCreate
    ? `<a class="secondary-button no-print" href="/forms/${encodeURIComponent(def.id)}">+ ${esc(def.submitLabel || 'Neuer Eintrag')}</a>`
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
    ${scopeHint}
    ${renderResultsTable(def, submissions, { archiveMode, canArchive, canUnarchive })}
    ${wkArchiveLink}
    <p><a href="${esc(formBackUrl(def))}" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: archiveMode ? 'Archiv' : 'Auswertung', body });
}

function renderSubmissionElement(_def, submission, f) {
  if (isDisplay(f)) return renderDisplayElement(f);
  const label = esc(f.label || f.name || '');
  if (f.type === 'checkbox') {
    const checked = !f.printOnly && submission[f.name];
    return `<div class="sub-check"><span class="box">${checked ? '☑' : '☐'}</span> <span>${label}</span></div>`;
  }
  const compact = f.compact ? ' sub-field--compact' : '';
  if (f.printOnly) {
    const big = f.type === 'textarea';
    return `<div class="sub-field${big ? ' sub-field--block' : ''}${big ? '' : compact}">
      <div class="sub-label">${label}</div>
      <div class="sub-write${big ? ' sub-write--block' : ''}"></div>
    </div>`;
  }
  return `<div class="sub-field${compact}">
    <div class="sub-label">${label}</div>
    <div class="sub-value">${esc(submission[f.name] ?? '')}</div>
  </div>`;
}

export function renderSubmissionPage(req, def, submission, { archiveMode = false } = {}) {
  const heading = submissionTitle(def, submission);
  const resultsUrl = archiveMode && def.id === 'wk' ? '/forms/wk/archive' : `/forms/${esc(def.id)}/results`;
  const resultsLabel = archiveMode && def.id === 'wk' ? 'Archiv' : 'Auswertung';
  const elements = (def.fields || [])
    .map((f) => `<div class="sub-el${widthClass(f)}">${renderSubmissionElement(def, submission, f)}</div>`)
    .join('\n');
  const body = `<article class="content sub-detail">
    <nav class="crumbs no-print"><a href="${resultsUrl}">${resultsLabel}</a> / <span>${esc(heading)}</span></nav>
    <p class="no-print"><a href="${resultsUrl}" class="back">← Zurück</a></p>
    <div class="content-header print-title-row">
      <h1>${esc(def.title || def.id)}</h1>
      ${renderPrintLogo()}
      <button type="button" class="secondary-button no-print" onclick="window.print()">Print</button>
    </div>
    <p class="muted">Gesendet am: ${esc(formatDateTime(submission._meta?.submittedAt) || '-')}<br>Gesendet von: ${esc(submission._meta?.submittedBy || '-')} · WK: ${esc(submissionWkLabel(req, def, submission))}</p>
    <div class="sub-elements">${elements || '<em>Keine Felder</em>'}</div>
    <p class="no-print"><a href="${resultsUrl}" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: def.title || heading, body });
}
