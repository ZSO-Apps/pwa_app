import { visibleKacheln } from '../layout.js';

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
${renderWkBanner(req)}
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
    return `<select ${common}>${(f.options || []).map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
  }
  const type = ['text', 'number', 'date', 'time', 'email'].includes(f.type) ? f.type : 'text';
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

export function renderResultsPage(req, def, submissions, { wkLabel } = {}) {
  const scopeHint = def.scope === 'global'
    ? ''
    : wkLabel
      ? `<p class="muted">WK-Kontext: ${esc(wkLabel)}</p>`
      : '<p class="muted">Kein WK aktiv.</p>';
  const body = `
  <article class="content">
    <h1>Auswertung — ${esc(def.title || def.id)}</h1>
    ${scopeHint}
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
