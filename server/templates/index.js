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
  return `<a class="kachel" href="${esc(href)}" style="--c:${esc(color)}">
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
    const icon = { dir: '📁', md: '📄', pdf: '📕', img: '🖼️', url: '🔗', file: '📄' }[e.kind] || '📄';
    const attrs = e.external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<li><a href="${esc(e.url)}"${attrs}><span class="ic">${icon}</span> ${esc(e.label)}</a></li>`;
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

export function renderChildren(req, kachel) {
  const role = req.user?.role || 'public';
  const children = (kachel.children || []).filter((c) => hasAccess(role, c.access || 'public'));
  const body = `
  <article class="content">
    <h1>${esc(kachel.title)}</h1>
    <section class="kacheln">
      ${children.map((c) => renderKachel(c, req)).join('\n')}
    </section>
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
  const cols = (def.fields || []).map((f) => f.name);
  const headers = (def.fields || []).map((f) => f.label || f.name);
  const rows = submissions.map((s) => `<tr>
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

  const body = `
  <article class="content">
    <h1>Auswertung — ${esc(def.title || def.id)}</h1>
    <p>${submissions.length} Eingabe(n)</p>
    ${quizSummary}
    ${submissions.length ? `
    <div class="tablewrap"><table class="results">
      <thead><tr><th>Datum</th><th>Benutzer</th>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>` : '<p><em>Noch keine Eingaben.</em></p>'}
    <p><a href="/" class="back">← Zurück</a></p>
  </article>`;
  return layout(req, { title: 'Auswertung', body });
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
