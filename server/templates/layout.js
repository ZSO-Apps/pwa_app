import { visibleKacheln } from '../layout.js';
import { assetUrl, esc, LOGIN_ICON, LOGOUT_ICON, logoAssetUrl } from './shared.js';

const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;

function renderBrandLogo() {
  const logo = logoAssetUrl('header');
  if (!logo) return 'ZSO App';
  return `<img class="brand-logo" src="${esc(logo)}" alt="ZSO App">`;
}

function renderGlobalSearch() {
  return `<section class="global-search no-print" data-global-search>
    <button type="button" class="global-search-toggle" data-global-search-toggle aria-label="Suche öffnen" aria-expanded="false">${SEARCH_ICON}</button>
    <div class="global-search-panel" data-global-search-panel hidden>
      <form class="global-search-form" data-global-search-form>
        <label class="sr-only" for="global-search-input">Suche</label>
        <input id="global-search-input" type="search" autocomplete="off" placeholder="Dokumente suchen" data-global-search-input>
      </form>
      <div class="global-search-status muted" data-global-search-status>Mindestens 2 Zeichen eingeben.</div>
      <div class="global-search-results" data-global-search-results></div>
    </div>
  </section>`;
}

function withWkParam(url, wkId) {
  if (!wkId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'wk=' + encodeURIComponent(wkId);
}

function kachelHref(req, kachel) {
  const href = kachel.route || '/k/' + kachel.id;
  const wkAware = kachel.wkScoped || href === '/appell' || href === '/transport';
  return wkAware && req.activeWk?.id ? withWkParam(href, req.activeWk.id) : href;
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
  return `<form method="POST" action="/wk/select" class="wk-banner" data-wk-form>
    <label for="wk-select">Aktiver WK:</label>
    <select id="wk-select" name="wkId" data-wk-select>${options}</select>
    <noscript><button type="submit">Wählen</button></noscript>
  </form>`;
}

export function layout(req, { title, body, extraHead = '', extraHeadBeforeStyles = '' }) {
  const user = req.user;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title || 'ZSO App')}</title>
${extraHeadBeforeStyles}
<link rel="stylesheet" href="${assetUrl('/client/styles.css')}">
<link rel="manifest" href="/client/manifest.json">
<link rel="apple-touch-icon" href="/client/icons/apple-icon-152x152.png">
<link rel="icon" href="/favicon.ico">
<meta name="theme-color" content="#005A9C">
<script>
(() => {
  try {
    const choice = localStorage.getItem('zso-theme') || 'system';
    const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = choice === 'dark' || (choice !== 'light' && systemDark) ? 'dark' : 'light';
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeChoice = choice;
  } catch {}
})();
</script>
${extraHead}
</head>
<body>
<header class="topbar">
  <button class="hamburger" id="hamburger" aria-label="Navigation öffnen" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
  <a class="brand brand--logo" href="/" aria-label="ZSO App">${renderBrandLogo()}</a>
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
${renderGlobalSearch()}
<script src="${assetUrl('/client/app.js')}" defer></script>
</body>
</html>`;
}

function renderSideNav(req) {
  const role = req.user?.role || 'public';
  const list = visibleKacheln(role);
  const items = list.map((k) => `<li><a href="${esc(kachelHref(req, k))}">${esc(k.title || k.id)}</a></li>`).join('');
  return `<ul class="nav-root">${items}
    <li class="nav-theme">
      <label for="theme-select">Design</label>
      <select id="theme-select" data-theme-select>
        <option value="light">Hell</option>
        <option value="dark">Dunkel</option>
        <option value="system" selected>System</option>
      </select>
    </li>
  </ul>`;
}
