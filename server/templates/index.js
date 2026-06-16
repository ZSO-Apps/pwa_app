import { visibleKacheln } from '../layout.js';
import { hasAccess } from '../auth.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const LOGIN_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`;
const LOGOUT_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

function layout(req, { title, body, extraHead = '' }) {
  const user = req.user;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title || 'ZSO App')}</title>
<link rel="stylesheet" href="/client/styles.css">
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
<div class="sync-info" id="sync-info"></div>
<nav id="sidenav" class="sidenav" aria-hidden="true">
  ${renderSideNav(req)}
</nav>
<div class="overlay" id="overlay"></div>
<main class="main">
${body}
</main>
<script src="/client/app.js" defer></script>
</body>
</html>`;
}

function renderSideNav(req) {
  const role = req.user?.role || 'public';
  const list = visibleKacheln(role);
  const renderItem = (k) => {
    const href = kachelHref(k, req);
    const inner = `<a href="${esc(href)}">${esc(displayTitle(k, req))}</a>`;
    const children = k.children?.length
      ? `<ul>${k.children.map((c) => `<li>${renderItem(c)}</li>`).join('')}</ul>`
      : '';
    return inner + children;
  };
  return `<ul class="nav-root">${list.map((k) => `<li>${renderItem(k)}</li>`).join('')}</ul>`;
}

function displayTitle(k) {
  return k.title || k.id;
}

function kachelHref(k) {
  if (k.form) return `/forms/${k.form}`;
  if (k.formResults) return `/forms/${k.formResults}/results`;
  return `/k/${k.id}`;
}

function renderKachel(k, req) {
  const href = kachelHref(k, req);
  const title = displayTitle(k, req);
  const color = k.color || '#444';
  const onlineOnly = k.form ? ' data-online-only="true"' : '';
  return `<a class="kachel" href="${esc(href)}" style="--c:${esc(color)}"${onlineOnly}>
    <span class="k-title">${esc(title)}</span>
  </a>`;
}

export function renderHome(req) {
  const role = req.user?.role || 'public';
  const list = visibleKacheln(role);
  const body = `
  <section class="kacheln">
    ${list.map((k) => renderKachel(k, req)).join('\n')}
  </section>
  `;
  return layout(req, { title: 'ZSO App', body });
}

export function renderKachelView(req, kachel, contentHtml) {
  const body = `
  <article class="content">
    <h1>${esc(kachel.title)}</h1>
    ${contentHtml}
    <p><a href="/" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: kachel.title, body });
}

export function renderListing(req, kachel, entries, breadcrumbs) {
  const items = entries.map((e) => {
    const icon = { dir: '📁', md: '📄', pdf: '📕', img: '🖼️', file: '📄' }[e.kind] || '📄';
    return `<li><a href="${esc(e.url)}"><span class="ic">${icon}</span> ${esc(e.label)}</a></li>`;
  }).join('');
  const crumb = breadcrumbs.map((b, i) =>
    i === breadcrumbs.length - 1 ? `<span>${esc(b.label)}</span>` : `<a href="${esc(b.url)}">${esc(b.label)}</a>`
  ).join(' / ');
  const body = `
  <article class="content">
    <nav class="crumbs">${crumb}</nav>
    <h1>${esc(kachel.title)}</h1>
    <ul class="listing">${items || '<li><em>Keine Einträge</em></li>'}</ul>
    <p><a href="/" class="back">← Zurück zur Übersicht</a></p>
  </article>`;
  return layout(req, { title: kachel.title, body });
}

export function renderMarkdownPage(req, kachel, contentHtml, parentUrl) {
  const body = `
  <article class="content prose">
    ${contentHtml}
    <p><a href="${esc(parentUrl || '/')}" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: kachel.title, body });
}

function submissionTitle(def, submission) {
  const fields = def.fields || [];
  const preferredNames = ['titel', 'title', 'name', 'betreff', 'thema', 'sender'];
  const preferred = preferredNames
    .map((name) => fields.find((field) => field.name === name))
    .find(Boolean);
  const fallback = preferred || fields[0];
  const value = fallback ? submission[fallback.name] : '';
  return value || submission._meta?.submittedBy || submission._meta?.submittedAt || 'Eintrag';
}

function submissionUrl(def, submission) {
  const id = submission._meta?.submissionId;
  return id ? '/forms/' + encodeURIComponent(def.id) + '/results/' + encodeURIComponent(id) : '#';
}

function renderResultsTable(def, submissions) {
  const cols = (def.fields || []).map((f) => f.name);
  const headers = (def.fields || []).map((f) => f.label || f.name);
  const rows = submissions.map((s) => `<tr>
      <td><a href="${esc(submissionUrl(def, s))}">${esc(submissionTitle(def, s))}</a></td>
      <td>${esc(s._meta?.submittedAt || '')}</td>
      <td>${esc(s._meta?.submittedBy || '')}</td>
      ${cols.map((c) => `<td>${esc(s[c] ?? '')}</td>`).join('')}
    </tr>`).join('');

  let quizSummary = '';
  if ((def.fields || []).some((f) => f.correct !== undefined)) {
    const totals = submissions.map((s) => {
      let correct = 0, total = 0;
      for (const f of def.fields) if (f.correct !== undefined) { total++; if (s[f.name] === f.correct) correct++; }
      return { correct, total, name: s._meta?.submittedBy || '?' };
    });
    quizSummary = `<h2>Quiz-Zusammenfassung</h2>
      <ul class="quiz-summary">${totals.map((t) => `<li>${esc(t.name)}: ${t.correct}/${t.total}</li>`).join('')}</ul>`;
  }

  return `
    <p>${submissions.length} Eingabe(n)</p>
    ${quizSummary}
    ${submissions.length ? `
    <div class="tablewrap"><table class="results">
      <thead><tr><th>Name / Titel</th><th>Datum</th><th>Benutzer</th>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>` : '<p><em>Noch keine Eingaben.</em></p>'}`;
}

export function renderChildren(req, kachel, { actions = [], resultSections = [] } = {}) {
  const role = req.user?.role || 'public';
  const children = (kachel.children || [])
    .filter((c) => hasAccess(role, c.access || 'public'))
    .filter((c) => !c.form && !c.formResults);
  const actionButtons = actions.map((action) => (
    `<a class="action-button" href="${esc(action.url)}" data-online-only="true">
      <span class="action-icon" aria-hidden="true">+</span>
      <span class="action-copy"><strong>Neue Eingabe</strong><small>${esc(action.detail || action.title)}</small></span>
    </a>`
  )).join('');
  const results = resultSections.map((section) => `
    <section class="dashboard-section">
      <h2>${esc(section.title)}</h2>
      ${renderResultsTable(section.def, section.submissions)}
    </section>
  `).join('');
  const childrenGrid = children.length
    ? `<section class="kacheln">${children.map((c) => renderKachel(c, req)).join('\n')}</section>`
    : '';
  const body = `
  <article class="content">
    <div class="content-header">
      <h1>${esc(kachel.title)}</h1>
      ${actionButtons ? `<div class="actions">${actionButtons}</div>` : ''}
    </div>
    ${actionButtons ? '<p class="offline-hint">Offline: Formulare können nur mit Verbindung zum Server erstellt oder gesendet werden.</p>' : ''}
    ${results}
    ${childrenGrid}
    <p><a href="/" class="back">← Zurück</a></p>
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

function renderField(f, value = '') {
  const common = `name="${esc(f.name)}" id="f-${esc(f.name)}"${f.required ? ' required' : ''}`;
  if (f.type === 'textarea') return `<textarea ${common} rows="4">${esc(value)}</textarea>`;
  if (f.type === 'radio') {
    return (f.options || []).map((o, i) =>
      `<label class="radio"><input type="radio" name="${esc(f.name)}" value="${esc(o)}"${i === 0 && f.required ? ' required' : ''}> ${esc(o)}</label>`
    ).join('');
  }
  if (f.type === 'select') {
    return `<select ${common}>${(f.options||[]).map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
  }
  const type = ['text','number','date','time','email'].includes(f.type) ? f.type : 'text';
  const minmax = (f.min !== undefined ? ` min="${esc(f.min)}"` : '') + (f.max !== undefined ? ` max="${esc(f.max)}"` : '');
  return `<input type="${type}" ${common}${minmax} value="${esc(value)}">`;
}

export function renderFormPage(req, def, { submitted = false } = {}) {
  const body = `
  <article class="content narrow">
    <h1>${esc(def.title || def.id)}</h1>
    ${submitted ? `<p class="ok">✓ Eingabe gespeichert. Vielen Dank.</p>` : ''}
    <form method="POST" action="/forms/${esc(def.id)}" class="genform">
      ${(def.fields || []).map((f) => `
        <div class="field">
          <label for="f-${esc(f.name)}">${esc(f.label || f.name)}${f.required ? ' *' : ''}</label>
          ${renderField(f)}
        </div>
      `).join('')}
      <button type="submit">Senden</button>
    </form>
    <p><a href="/" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: def.title || 'Formular', body });
}

export function renderResultsPage(req, def, submissions) {
  const body = `
  <article class="content">
    <h1>Auswertung — ${esc(def.title || def.id)}</h1>
    ${renderResultsTable(def, submissions)}
    <p><a href="/" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: 'Auswertung', body });
}

export function renderSubmissionPage(req, def, submission) {
  const title = submissionTitle(def, submission);
  const rows = (def.fields || []).map((field) => '<tr><th>' + esc(field.label || field.name) + '</th><td>' + esc(submission[field.name] ?? '') + '</td></tr>').join('');
  const body = '<article class="content">' +
    '<nav class="crumbs"><a href="/forms/' + esc(def.id) + '/results">Auswertung</a> / <span>' + esc(title) + '</span></nav>' +
    '<h1>' + esc(title) + '</h1>' +
    '<p class="muted">Gesendet am: ' + esc(submission._meta?.submittedAt || '') + '<br>Gesendet von: ' + esc(submission._meta?.submittedBy || '') + '</p>' +
    '<div class="tablewrap"><table class="results"><tbody>' + (rows || '<tr><td><em>Keine Felder</em></td></tr>') + '</tbody></table></div>' +
    '<p><a href="/forms/' + esc(def.id) + '/results" class="back">← Zurück zur Auswertung</a></p>' +
    '</article>';
  return layout(req, { title, body });
}

function fieldValue(values, name, fallback = '') {
  return values?.[name] ?? fallback;
}

export function renderWkListPage(req, { kachel, wks, canCreate }) {
  const rows = wks.map((wk) => `<tr>
    <td><a href="/wk/${esc(wk.id)}">${esc(wk.name)}</a></td>
    <td>${esc(wk.nummer)}</td>
    <td>${esc(wk.datum)}</td>
    <td>${esc(wk.ort)}</td>
    <td>${esc(wk.tenue)}</td>
    <td>${esc(wk.appellStatus)}</td>
  </tr>`).join('');
  const body = `
  <article class="content">
    <div class="content-header">
      <h1>${esc(kachel.title)}</h1>
      ${canCreate ? `<div class="actions"><a class="action-button" href="/wk/new" data-online-only="true">
        <span class="action-icon" aria-hidden="true">+</span>
        <span class="action-copy"><strong>Neuer WK</strong><small>WK erfassen</small></span>
      </a></div>` : ''}
    </div>
    ${canCreate ? '<p class="offline-hint">Offline: WKs können nur mit Verbindung zum Server erstellt werden.</p>' : ''}
    <div class="tablewrap"><table class="results">
      <thead><tr><th>Name / Titel</th><th>Nummer</th><th>Datum</th><th>Ort</th><th>Tenue</th><th>Appell</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6"><em>Noch keine WKs erstellt.</em></td></tr>'}</tbody>
    </table></div>
    <p><a href="/" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: kachel.title, body });
}

export function renderWkCreatePage(req, { error, values = {} } = {}) {
  const body = `
  <article class="content">
    <div class="content-header">
      <h1>WK erstellen</h1>
    </div>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <form method="POST" action="/wk" class="genform wide">
      <h2>Grunddaten</h2>
      <div class="field-row">
        <div class="field"><label for="nummer">Nummer *</label><input id="nummer" name="nummer" required value="${esc(fieldValue(values, 'nummer'))}"></div>
        <div class="field"><label for="name">Name *</label><input id="name" name="name" required value="${esc(fieldValue(values, 'name'))}"></div>
      </div>
      <label class="field" for="platzhalter">Hinweis / Platzhalter<textarea id="platzhalter" name="platzhalter" rows="3">${esc(fieldValue(values, 'platzhalter', 'Platzhalter — bitte vor Beginn des WK durch Kdo aktualisieren.'))}</textarea></label>

      <h2>Eckdaten</h2>
      <div class="field-row">
        <div class="field"><label for="datum">Datum</label><input id="datum" name="datum" value="${esc(fieldValue(values, 'datum', 'TBD'))}"></div>
        <div class="field"><label for="ort">Ort</label><input id="ort" name="ort" value="${esc(fieldValue(values, 'ort', 'TBD'))}"></div>
        <div class="field"><label for="tenue">Tenue</label><input id="tenue" name="tenue" value="${esc(fieldValue(values, 'tenue', 'TBD'))}"></div>
      </div>

      <h2>Tagesablauf</h2>
      <div class="field-row day-row">
        <div class="field"><label for="tag_mo">Mo</label><input id="tag_mo" name="tag_mo" value="${esc(fieldValue(values, 'tag_mo', 'Einrücken, Material'))}"></div>
        <div class="field"><label for="tag_di">Di</label><input id="tag_di" name="tag_di" value="${esc(fieldValue(values, 'tag_di', 'Ausbildung'))}"></div>
        <div class="field"><label for="tag_mi">Mi</label><input id="tag_mi" name="tag_mi" value="${esc(fieldValue(values, 'tag_mi', 'Ausbildung'))}"></div>
        <div class="field"><label for="tag_do">Do</label><input id="tag_do" name="tag_do" value="${esc(fieldValue(values, 'tag_do', 'Übung'))}"></div>
        <div class="field"><label for="tag_fr">Fr</label><input id="tag_fr" name="tag_fr" value="${esc(fieldValue(values, 'tag_fr', 'Abrüsten'))}"></div>
      </div>

      <h2>Persönliche Ausrüstung</h2>
      <label class="field" for="ausruestung">Ein Eintrag pro Zeile<textarea id="ausruestung" name="ausruestung" rows="5">${esc(fieldValue(values, 'ausruestung', 'Persönliche Waffe & Munition gemäss Marschbefehl\nIdentitätskarte / Dienstbüchlein\nTenue gemäss Befehl\nHygieneartikel, Schreibzeug'))}</textarea></label>

      <h2>Kontakt</h2>
      <div class="field-row">
        <div class="field"><label for="kdoWk">Kdo WK</label><input id="kdoWk" name="kdoWk" value="${esc(fieldValue(values, 'kdoWk', 'TBD'))}"></div>
        <div class="field"><label for="verpflegungLogistik">Verpflegung / Logistik</label><input id="verpflegungLogistik" name="verpflegungLogistik" value="${esc(fieldValue(values, 'verpflegungLogistik', 'TBD'))}"></div>
      </div>

      <p class="muted">Kader, Mannschaft und Appell werden auf Basis dieser WK-Datei später ergänzt. Ein Appell ist erst sinnvoll, wenn Kader und Mannschaft eingetragen sind.</p>
      <button type="submit">WK speichern</button>
    </form>
    <p><a href="/k/wk-information" class="back">← Zurück zur WK-Übersicht</a></p>
  </article>`;
  return layout(req, { title: 'WK erstellen', body });
}

export function renderWkDetailPage(req, wk) {
  const tagesablauf = (wk.tagesablauf || []).map((row) => `<tr><td>${esc(row.tag)}</td><td>${esc(row.aktivitaet)}</td></tr>`).join('');
  const ausruestung = (wk.ausruestung || []).map((item) => `<li>${esc(item)}</li>`).join('');
  const body = `
  <article class="content prose">
    <nav class="crumbs"><a href="/k/wk-information">WK Information</a> / <span>${esc(wk.name || wk.id)}</span></nav>
    <h1>${esc(wk.name || wk.id)}</h1>
    <p class="muted">Nummer: ${esc(wk.nummer || '')}</p>
    <blockquote>${esc(wk.platzhalter || 'Platzhalter — bitte vor Beginn des WK durch Kdo aktualisieren.')}</blockquote>

    <h2>Eckdaten</h2>
    <ul>
      <li><strong>Datum:</strong> ${esc(wk.eckdaten?.datum || 'TBD')}</li>
      <li><strong>Ort:</strong> ${esc(wk.eckdaten?.ort || 'TBD')}</li>
      <li><strong>Tenue:</strong> ${esc(wk.eckdaten?.tenue || 'TBD')}</li>
    </ul>

    <h2>Tagesablauf (Übersicht)</h2>
    <table><thead><tr><th>Tag</th><th>Aktivität</th></tr></thead><tbody>${tagesablauf || '<tr><td colspan="2"><em>Keine Einträge</em></td></tr>'}</tbody></table>

    <h2>Persönliche Ausrüstung</h2>
    <ul>${ausruestung || '<li><em>Keine Einträge</em></li>'}</ul>

    <h2>Kontakt</h2>
    <ul>
      <li><strong>Kdo WK:</strong> ${esc(wk.kontakt?.kdoWk || 'TBD')}</li>
      <li><strong>Verpflegung / Logistik:</strong> ${esc(wk.kontakt?.verpflegungLogistik || 'TBD')}</li>
    </ul>

    <h2>Appell</h2>
    <p>Status: ${esc(wk.appell?.status || 'nicht bereit')}</p>
    <p><a href="/k/wk-information" class="back">← Zurück zur WK-Übersicht</a></p>
  </article>`;
  return layout(req, { title: wk.name || 'WK', body });
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
