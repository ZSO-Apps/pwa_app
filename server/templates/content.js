import { visibleKacheln } from '../layout.js';
import { layout } from './layout.js';
import { esc, LISTING_ICON } from './shared.js';

const PLUS_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

function editorUrl(actions) {
  const qs = new URLSearchParams({ dir: actions.dir || '' });
  return '/content-admin/' + encodeURIComponent(actions.kachelId) + '/markdown/new?' + qs.toString();
}

function renderContentActions(actions) {
  if (!actions?.enabled) return '';
  const kachelId = esc(actions.kachelId);
  const dir = esc(actions.dir || '');
  return [
    '<div class="content-actions no-print" data-content-actions data-kachel-id="' + kachelId + '" data-content-dir="' + dir + '">',
    '<button type="button" class="content-add-button" data-content-menu-toggle aria-expanded="false" aria-label="Inhalt hinzufügen">' + PLUS_ICON + '</button>',
    '<div class="content-actions-menu" data-content-menu hidden>',
    '<a href="' + esc(editorUrl(actions)) + '">Markdown erstellen</a>',
    '<button type="button" data-content-import="markdown" data-import-title="Markdown importieren" data-import-accept=".md,.markdown,.txt,text/markdown,text/plain">Markdown importieren</button>',
    '<button type="button" data-content-import="pdf" data-import-title="PDF importieren" data-import-accept=".pdf,application/pdf">PDF importieren</button>',
    '<button type="button" data-content-import="picture" data-import-title="Bild importieren" data-import-accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif">Bild importieren</button>',
    '</div>',
    '<dialog class="content-import-dialog" data-content-import-dialog>',
    '<form class="content-import-card" data-content-import-form>',
    '<button type="button" class="dialog-close" data-content-import-close aria-label="Schliessen">×</button>',
    '<h2 data-content-import-title>Importieren</h2>',
    '<label>Dateiname<input name="filename" data-content-import-name required autocomplete="off"></label>',
    '<div class="content-dropzone" data-content-dropzone tabindex="0">',
    '<input type="file" data-content-import-file hidden>',
    '<strong>Datei hier ablegen oder klicken</strong>',
    '<span>Der Dateiname wird mit der passenden Endung gespeichert.</span>',
    '</div>',
    '<p class="muted" data-content-import-file-name>Keine Datei ausgewählt.</p>',
    '<p class="err" data-content-import-error hidden></p>',
    '<div class="dialog-actions">',
    '<button type="button" class="secondary-button" data-content-import-close>Abbrechen</button>',
    '<button type="submit">Importieren</button>',
    '</div>',
    '</form>',
    '</dialog>',
    '</div>',
  ].join('');
}

function folderUrl(kachelId, dir = '') {
  const parts = String(dir || '').split('/').filter(Boolean).map(encodeURIComponent);
  return '/k/' + encodeURIComponent(kachelId) + (parts.length ? '/' + parts.join('/') + '/' : '');
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

export function renderListing(req, kachel, entries, breadcrumbs, { contentActions = null } = {}) {
  const actions = renderContentActions(contentActions);
  const items = entries.map((e) => {
    const icon = LISTING_ICON[e.kind] || (e.kind === 'image' ? '🖼️' : '📄');
    const attrs = e.external ? ' target="_blank" rel="noopener noreferrer"' : '';
    const online = e.onlineOnly ? ' data-online-only="true"' : '';
    return `<li><a href="${esc(e.url)}"${attrs}${online}><span class="ic">${icon}</span> ${esc(e.label)}</a></li>`;
  }).join('');
  const body = `
  <article class="content">
    <p><a href="/" class="back">← Zurück zur Übersicht</a></p>
    <div class="content-header">
      <h1>${esc(kachel.title)}</h1>
      ${actions}
    </div>
    <ul class="listing">${items || '<li><em>Keine Einträge</em></li>'}</ul>
    <p><a href="/" class="back">← Zurück zur Übersicht</a></p>
  </article>`;
  return layout(req, { title: kachel.title, body });
}

export function renderMarkdownPage(req, kachel, contentHtml, parentUrl, { contentActions = null } = {}) {
  const actions = renderContentActions(contentActions);
  const body = `
  <article class="content prose">
    <div class="content-page-top no-print">
      <a href="${esc(parentUrl || '/')}" class="back">← Zurück</a>
      ${actions}
    </div>
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


export function renderMarkdownEditorPage(req, kachel, { dir = '', backUrl = '', values = {}, error = '' } = {}) {
  const action = '/content-admin/' + encodeURIComponent(kachel.id) + '/markdown';
  const body = [
    '<article class="content markdown-editor-page" data-markdown-editor-page>',
    '<p><a href="' + esc(backUrl || folderUrl(kachel.id, dir)) + '" class="back">← Zurück</a></p>',
    '<h1>Markdown erstellen</h1>',
    error ? '<p class="err">' + esc(error) + '</p>' : '',
    '<form method="POST" action="' + esc(action) + '" class="genform wide markdown-editor-form">',
    '<input type="hidden" name="dir" value="' + esc(dir) + '">',
    '<div class="field"><label for="md-filename">Dateiname *</label><input id="md-filename" name="filename" required autocomplete="off" value="' + esc(values.filename || '') + '"></div>',
    '<div class="markdown-toolbar no-print" aria-label="Markdown Werkzeuge">',
    '<button type="button" data-md-action="heading">Überschrift</button>',
    '<button type="button" data-md-action="bold">Fett</button>',
    '<button type="button" data-md-action="italic">Kursiv</button>',
    '<button type="button" data-md-action="list">Liste</button>',
    '<button type="button" data-md-action="link">Link</button>',
    '</div>',
    '<div class="markdown-editor-grid">',
    '<label class="field markdown-input-field" for="md-content">Markdown *</label>',
    '<textarea id="md-content" name="content" rows="18" data-markdown-editor required>' + esc(values.content || '') + '</textarea>',
    '<section class="markdown-preview prose" data-markdown-preview aria-label="Vorschau"></section>',
    '</div>',
    '<button type="submit">Markdown speichern</button>',
    '</form>',
    '</article>',
  ].join('');
  return layout(req, { title: 'Markdown erstellen', body });
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
