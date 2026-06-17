import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { visibleKacheln, findKachelBySlug } from '../layout.js';
import { isDisplay, isStored } from '../form-elements.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const LOGIN_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`;
const LOGOUT_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

const LISTING_ICON = {
  dir: '📁',
  md: '📄',
  pdf: '📕',
  url: '🔗',
  'form-submit': '📝',
  'form-results': '📊',
};

function assetUrl(urlPath) {
  try {
    const rel = urlPath.replace(/^\//, '');
    const stat = fs.statSync(path.resolve(rel));
    return `${urlPath}?v=${Math.round(stat.mtimeMs)}-${stat.size}`;
  } catch {
    return urlPath;
  }
}

function renderWkBanner(req) {
  if (!req.user) return '';
  const wks = req.wkList || [];
  if (!wks.length) {
    return `<div class="wk-banner wk-banner--empty">
      <span>Kein WK angelegt.</span>
      <a href="/k/admin">Admin → WK erfassen</a>
    </div>`;
  }
  const active = req.activeWk;
  const options = wks.map((w) => {
    const label = [w.nummer, w.name].filter(Boolean).join(' ') + (w.range ? ` (${w.range})` : '');
    const sel = active && w.id === active.id ? ' selected' : '';
    return `<option value="${esc(w.id)}"${sel}>${esc(label)}</option>`;
  }).join('');
  return `<form method="POST" action="/wk/select" class="wk-banner">
    <label for="wk-select">Aktiver WK:</label>
    <select id="wk-select" name="wkId" onchange="this.form.submit()">${options}</select>
    <noscript><button type="submit">Wählen</button></noscript>
  </form>`;
}

function layout(req, { title, body, extraHead = '' }) {
  const user = req.user;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title || 'ZSO App')}</title>
<link rel="stylesheet" href="${assetUrl('/client/styles.css')}">
<link rel="manifest" href="/client/manifest.json">
<link rel="apple-touch-icon" href="/client/icons/apple-icon-152x152.png">
<link rel="icon" href="/favicon.ico">
<meta name="theme-color" content="#2C3E50">
${extraHead}
</head>
<body>
<header class="topbar">
  <button class="hamburger" id="hamburger" aria-label="Navigation öffnen" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
  <a class="brand" href="/">ZSO App</a>
  <div class="userinfo">${user ? `<span class="role">${esc(user.role)}</span> ${esc(user.username)}` : ''}</div>
  ${user
    ? `<form method="POST" action="/logout" class="auth-form"><button type="submit" class="auth-btn" title="Logout (${esc(user.username)})" aria-label="Logout">${LOGOUT_ICON}</button></form>`
    : `<a href="/login" class="auth-btn" title="Login" aria-label="Login">${LOGIN_ICON}</a>`}
</header>
${renderWkBanner(req)}
<div class="sync-info" id="sync-info"></div>
<nav id="sidenav" class="sidenav" aria-hidden="true">
  ${renderSideNav(req)}
</nav>
<div class="overlay" id="overlay"></div>
<main class="main">
${body}
</main>
<script src="${assetUrl('/client/app.js')}" defer></script>
</body>
</html>`;
}

function renderSideNav(req) {
  const role = req.user?.role || 'public';
  const list = visibleKacheln(role);
  return `<ul class="nav-root">${list.map((k) => `<li><a href="/k/${esc(k.id)}">${esc(k.title || k.id)}</a></li>`).join('')}</ul>`;
}

function renderKachel(k) {
  const color = k.color || '#444';
  return `<a class="kachel" href="/k/${esc(k.id)}" style="--c:${esc(color)}">
    <span class="k-title">${esc(k.title || k.id)}</span>
  </a>`;
}

export function renderHome(req) {
  const role = req.user?.role || 'public';
  const list = visibleKacheln(role);
  const body = `
  <section class="kacheln">
    ${list.map((k) => renderKachel(k)).join('\n')}
  </section>`;
  return layout(req, { title: 'ZSO App', body });
}

export function renderListing(req, kachel, entries, breadcrumbs) {
  const items = entries.map((e) => {
    const icon = LISTING_ICON[e.kind] || '📄';
    const attrs = e.external ? ' target="_blank" rel="noopener noreferrer"' : '';
    const online = e.onlineOnly ? ' data-online-only="true"' : '';
    return `<li><a href="${esc(e.url)}"${attrs}${online}><span class="ic">${icon}</span> ${esc(e.label)}</a></li>`;
  }).join('');
  const body = `
  <article class="content">
    <p><a href="/" class="back">← Zurück zur Übersicht</a></p>
    <h1>${esc(kachel.title)}</h1>
    <ul class="listing">${items || '<li><em>Keine Einträge</em></li>'}</ul>
    <p><a href="/" class="back">← Zurück zur Übersicht</a></p>
  </article>`;
  return layout(req, { title: kachel.title, body });
}

export function renderMarkdownPage(req, kachel, contentHtml, parentUrl) {
  const body = `
  <article class="content prose">
    <p><a href="${esc(parentUrl || '/')}" class="back">← Zurück</a></p>
    ${contentHtml}
    <p><a href="${esc(parentUrl || '/')}" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: kachel.title, body });
}

export function renderLogin(req, error) {
  const next = req.query?.next || '/';
  const body = `
  <article class="content narrow">
    <h1>Login</h1>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <form method="POST" action="/login" class="loginform">
      <input type="hidden" name="next" value="${esc(next)}">
      <label>Benutzer<input name="username" autocomplete="username" required autofocus></label>
      <label>Passwort<input type="password" name="password" autocomplete="current-password" required></label>
      <button type="submit">Anmelden</button>
    </form>
    <p><a href="/" class="back">← Abbrechen</a></p>
  </article>`;
  return layout(req, { title: 'Login', body });
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
      <h1>${esc(def.title || def.id)}</h1>
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

function submissionTitle(def, submission) {
  const fields = def.fields || [];
  const preferredNames = ['titel', 'title', 'name', 'betreff', 'thema', 'sender'];
  const preferred = preferredNames
    .map((name) => fields.find((field) => field.name === name && isStored(field)))
    .find(Boolean);
  const fallback = preferred || fields.find(isStored);
  const value = fallback ? submission[fallback.name] : '';
  return value || submission._meta?.submittedBy || submission._meta?.submittedAt || 'Eintrag';
}

function submissionUrl(def, submission) {
  const id = submission._meta?.submissionId;
  return id ? '/forms/' + encodeURIComponent(def.id) + '/results/' + encodeURIComponent(id) : '#';
}

function fmtCell(field, value) {
  if (field.type === 'checkbox') return value ? '☑' : '☐';
  return value ?? '';
}

function renderResultsTable(def, submissions) {
  const storedFields = (def.fields || []).filter(isStored);
  const headers = storedFields.map((f) => f.label || f.name);
  const rows = submissions.map((s) => {
    const title = submissionTitle(def, s);
    const url = submissionUrl(def, s);
    return `<tr data-print-row data-print-url="${esc(url)}">
      <td class="select-col"><input type="checkbox" data-print-select aria-label="${esc(title)} auswählen"></td>
      <td><a href="${esc(url)}">${esc(title)}</a></td>
      <td>${esc(s._meta?.submittedAt || '')}</td>
      <td>${esc(s._meta?.submittedBy || '')}</td>
      ${storedFields.map((f) => `<td>${esc(fmtCell(f, s[f.name]))}</td>`).join('')}
    </tr>`;
  }).join('');

  let quizSummary = '';
  if (storedFields.some((f) => f.correct !== undefined)) {
    const totals = submissions.map((s) => {
      let correct = 0, total = 0;
      for (const f of storedFields) {
        if (f.correct === undefined) continue;
        total++;
        if (s[f.name] === f.correct) correct++;
      }
      return { correct, total, name: s._meta?.submittedBy || '?' };
    });
    quizSummary = `<h2>Quiz-Zusammenfassung</h2>
      <ul class="quiz-summary">${totals.map((t) => `<li>${esc(t.name)}: ${t.correct}/${t.total}</li>`).join('')}</ul>`;
  }

  return `
    <p>${submissions.length} Eingabe(n)</p>
    ${quizSummary}
    ${submissions.length ? `
    <div class="result-print-actions no-print">
      <button type="button" class="secondary-button" data-print-selected disabled>Ausgewählte drucken</button>
      <span class="muted" data-print-count>0 ausgewählt</span>
    </div>
    <div class="tablewrap"><table class="results">
      <thead><tr><th class="select-col"><input type="checkbox" data-print-select-all aria-label="Alle auswählen"></th><th>Name / Titel</th><th>Datum</th><th>Benutzer</th>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>` : '<p><em>Noch keine Eingaben.</em></p>'}`;
}

export function renderResultsPage(req, def, submissions, { wkLabel } = {}) {
  const scopeHint = def.scope === 'global'
    ? ''
    : wkLabel
      ? `<p class="muted">WK-Kontext: ${esc(wkLabel)}</p>`
      : '<p class="muted">Kein WK aktiv.</p>';
  const body = `
  <article class="content" data-results-print>
    <p class="no-print"><a href="${esc(formBackUrl(def))}" class="back">← Zurück</a></p>
    <h1>Auswertung — ${esc(def.title || def.id)}</h1>
    ${scopeHint}
    ${renderResultsTable(def, submissions)}
    <p><a href="${esc(formBackUrl(def))}" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: 'Auswertung', body });
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

export function renderSubmissionPage(req, def, submission) {
  const heading = submissionTitle(def, submission);
  const elements = (def.fields || [])
    .map((f) => `<div class="sub-el${widthClass(f)}">${renderSubmissionElement(def, submission, f)}</div>`)
    .join('\n');
  const body = `<article class="content sub-detail">
    <nav class="crumbs no-print"><a href="/forms/${esc(def.id)}/results">Auswertung</a> / <span>${esc(heading)}</span></nav>
    <p class="no-print"><a href="/forms/${esc(def.id)}/results" class="back">← Zurück zur Auswertung</a></p>
    <div class="content-header">
      <h1>${esc(def.title || def.id)}</h1>
      <button type="button" class="secondary-button no-print" onclick="window.print()">Print</button>
    </div>
    <p class="muted">Gesendet am: ${esc(submission._meta?.submittedAt || '')}<br>Gesendet von: ${esc(submission._meta?.submittedBy || '')}</p>
    <div class="sub-elements">${elements || '<em>Keine Felder</em>'}</div>
    <p class="no-print"><a href="/forms/${esc(def.id)}/results" class="back">← Zurück zur Auswertung</a></p>
  </article>`;
  return layout(req, { title: def.title || heading, body });
}


export function renderUsersPage(req, users) {
  const rows = users.map((user) => {
    const name = esc(user.username);
    const role = esc(user.role);
    const actions = user.protected
      ? `<div class="row-actions">
          <a class="secondary-button compact" href="/admin/users/${encodeURIComponent(user.username)}/edit">Passwort ändern</a>
        </div>`
      : `<div class="row-actions">
          <a class="secondary-button compact" href="/admin/users/${encodeURIComponent(user.username)}/edit">Bearbeiten</a>
          <a class="danger-button compact" href="/admin/users/${encodeURIComponent(user.username)}/delete">Löschen</a>
        </div>`;
    return `<tr>
      <td>${name}</td>
      <td>${role}</td>
      <td>${user.protected ? 'Basisaccount' : 'Erstellt'}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
  const body = `
  <article class="content">
    <div class="content-header">
      <h1>User Übersicht</h1>
      <a class="secondary-button" href="/admin/users/new">User erfassen</a>
    </div>
    <div class="tablewrap"><table class="results">
      <thead><tr><th>Name</th><th>Rolle</th><th>Typ</th><th>Aktionen</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4"><em>Keine User vorhanden.</em></td></tr>'}</tbody>
    </table></div>
    <p><a href="/k/admin" class="back">← Zurück zu Admin</a></p>
  </article>`;
  return layout(req, { title: 'User Übersicht', body });
}

export function renderUserFormPage(req, { mode, roles, values = {}, originalUsername = '', error = '', baseUser = false }) {
  const isEdit = mode === 'edit';
  const title = isEdit ? (baseUser ? 'Passwort ändern' : 'User bearbeiten') : 'User erfassen';
  const action = isEdit ? `/admin/users/${encodeURIComponent(originalUsername)}/edit` : '/admin/users';
  const roleOptions = roles.map((role) => {
    const selected = (values.role || 'Soldat') === role ? ' selected' : '';
    return `<option value="${esc(role)}"${selected}>${esc(role)}</option>`;
  }).join('');
  const passwordRequired = !isEdit || baseUser;
  const usernameAttrs = baseUser ? ' readonly' : '';
  const roleField = baseUser
    ? `<input id="role" value="${esc(values.role || '')}" disabled><input type="hidden" name="role" value="${esc(values.role || '')}">`
    : `<select id="role" name="role" required>${roleOptions}</select>`;
  const body = `
  <article class="content narrow">
    <h1>${title}</h1>
    ${baseUser ? '<p class="muted">Basisaccount: Name und Rolle sind fix. Es kann nur das Passwort geändert werden.</p>' : ''}
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <form method="POST" action="${esc(action)}" class="genform">
      <div class="field">
        <label for="username">Name *</label>
        <input id="username" name="username" autocomplete="username" required value="${esc(values.username || '')}"${usernameAttrs}>
      </div>
      <div class="field">
        <label for="password">${baseUser ? 'Neues Passwort *' : `Passwort${isEdit ? ' (leer lassen = unverändert)' : ' *'}`}</label>
        <input id="password" name="password" type="password" autocomplete="new-password"${passwordRequired ? ' required' : ''}>
      </div>
      <div class="field">
        <label for="role">Rolle *</label>
        ${roleField}
      </div>
      <button type="submit">${baseUser ? 'Passwort speichern' : (isEdit ? 'User speichern' : 'User erstellen')}</button>
    </form>
    <p><a href="/admin/users" class="back">← Zurück zur User Übersicht</a></p>
  </article>`;
  return layout(req, { title, body });
}

export function renderUserDeletePage(req, { username, role, error = '' }) {
  const body = `
  <article class="content narrow">
    <h1>User löschen</h1>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <p>Der User <strong>${esc(username)}</strong>${role ? ` mit Rolle <strong>${esc(role)}</strong>` : ''} wird gelöscht.</p>
    <p>Zur Bestätigung den Namen exakt eingeben.</p>
    <form method="POST" action="/admin/users/${encodeURIComponent(username)}/delete" class="genform">
      <div class="field">
        <label for="confirmation">Bestätigung *</label>
        <input id="confirmation" name="confirmation" required autocomplete="off">
      </div>
      <button type="submit" class="danger-submit">Endgültig löschen</button>
    </form>
    <p><a href="/admin/users" class="back">← Abbrechen</a></p>
  </article>`;
  return layout(req, { title: 'User löschen', body });
}

export function renderOffline(req) {
  const body = `
  <article class="content narrow">
    <h1>Offline</h1>
    <p>Dieser Bereich erfordert eine Verbindung zum Server der Organisation (lokales WLAN).</p>
    <p>Bitte verbinde Dich mit dem WLAN der Organisation und versuche es erneut.</p>
    <p><a href="/" class="back">← Zur Startseite</a></p>
  </article>`;
  return layout(req, { title: 'Offline', body });
}

export function renderError(req, code, message) {
  const body = `<article class="content"><h1>${code}</h1><p>${esc(message)}</p><p><a href="/" class="back">← Zurück</a></p></article>`;
  return layout(req, { title: `Fehler ${code}`, body });
}
