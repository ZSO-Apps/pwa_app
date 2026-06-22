import { visibleKacheln } from '../layout.js';
import { layout } from './layout.js';
import { esc, LISTING_ICON } from './shared.js';

const PLUS_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

function editorUrl(actions) {
  const qs = new URLSearchParams({ dir: actions.dir || '' });
  return '/content-admin/' + encodeURIComponent(actions.kachelId) + '/markdown/new?' + qs.toString();
}

function formBuilderUrl(actions) {
  const qs = new URLSearchParams({ dir: actions.dir || '' });
  return '/content-admin/' + encodeURIComponent(actions.kachelId) + '/form/new?' + qs.toString();
}

function renderQuizActions(actions) {
  if (!actions?.enabled) return '';
  return '<a class="secondary-button no-print" data-online-only="true" href="/quiz/new">+ Quiz hinzufügen</a>';
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
    '<a href="' + esc(formBuilderUrl(actions)) + '">Formular erstellen</a>',
    '<button type="button" data-content-import="markdown" data-import-title="Markdown importieren" data-import-accept=".md,.markdown,.txt,text/markdown,text/plain">Markdown importieren</button>',
    '<button type="button" data-content-import="pdf" data-import-title="PDF importieren" data-import-accept=".pdf,application/pdf">PDF importieren</button>',
    '<button type="button" data-content-import="picture" data-import-title="Bild importieren" data-import-accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif">Bild importieren</button>',
    '<button type="button" data-content-link data-link-title="Webseite verlinken">Webseite verlinken</button>',
    '<button type="button" data-content-folder data-folder-title="Ordner erstellen">Ordner erstellen</button>',
    '</div>',
    '<dialog class="content-import-dialog" data-content-import-dialog>',
    '<form class="content-import-card" data-content-import-form>',
    '<button type="button" class="dialog-close" data-content-import-close aria-label="Schliessen">×</button>',
    '<h2 data-content-import-title>Importieren</h2>',
    '<label><span data-content-name-label>Dateiname</span><input name="filename" data-content-import-name required autocomplete="off"></label>',
    '<label data-content-link-url-field hidden>Link<input name="url" type="url" data-content-link-url autocomplete="url" placeholder="https://example.ch"></label>',
    '<div class="content-dropzone" data-content-dropzone data-content-import-file-area tabindex="0">',
    '<input type="file" data-content-import-file hidden>',
    '<strong>Datei hier ablegen oder klicken</strong>',
    '<span>Der Dateiname wird mit der passenden Endung gespeichert.</span>',
    '</div>',
    '<p class="muted" data-content-import-file-name>Keine Datei ausgewählt.</p>',
    '<p class="err" data-content-import-error hidden></p>',
    '<div class="dialog-actions">',
    '<button type="button" class="secondary-button" data-content-import-close>Abbrechen</button>',
    '<button type="submit" data-content-submit>Importieren</button>',
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
  const href = k.route || `/k/${esc(k.id)}`;
  return `<a class="kachel" href="${esc(href)}" style="--c:${esc(color)}">
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

export function renderListing(req, kachel, entries, breadcrumbs, { contentActions = null, quizActions = null } = {}) {
  const actions = renderQuizActions(quizActions) + renderContentActions(contentActions);
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
    '<form method="POST" action="' + esc(action) + '" class="genform wide markdown-editor-form" data-markdown-editor-form>',
    '<input type="hidden" name="dir" value="' + esc(dir) + '">',
    '<input type="hidden" name="imagesJson" data-markdown-images-json value="' + esc(values.imagesJson || '') + '">',
    '<div class="field"><label for="md-filename">Dateiname *</label><input id="md-filename" name="filename" required autocomplete="off" value="' + esc(values.filename || '') + '"></div>',
    '<div class="markdown-toolbar no-print" aria-label="Markdown Werkzeuge">',
    '<button type="button" data-md-action="heading">Überschrift</button>',
    '<button type="button" data-md-action="bold">Fett</button>',
    '<button type="button" data-md-action="italic">Kursiv</button>',
    '<button type="button" data-md-action="list">Liste</button>',
    '<button type="button" data-md-action="link">Link</button>',
    '<button type="button" data-md-image-trigger>Bild einfügen</button>',
    '</div>',
    '<section class="markdown-image-import no-print" data-markdown-image-import>',
    '<h2>Bilder</h2>',
    '<p class="muted">Bilder werden beim Speichern im Ordner <code>Dateiname.content</code> neben der Markdown-Datei abgelegt.</p>',
    '<div class="content-dropzone markdown-image-dropzone" data-markdown-image-dropzone tabindex="0">',
    '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-markdown-image-file hidden>',
    '<strong>Bild hier ablegen oder klicken</strong>',
    '<span>PNG, JPG, WebP oder GIF · maximal 5 MB</span>',
    '</div>',
    '<p class="muted" data-markdown-image-status>Kein Bild ausgewählt.</p>',
    '<div class="markdown-image-list" data-markdown-image-list></div>',
    '</section>',
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


export function renderFormBuilderPage(req, kachel, { dir = '', backUrl = '', values = {}, error = '' } = {}) {
  const action = '/content-admin/' + encodeURIComponent(kachel.id) + '/form';
  const submitAccess = values.submitAccess || 'Soldat';
  const resultsAccess = values.resultsAccess || 'Unteroffizier';
  const roleOption = (role, current) => '<option value="' + esc(role) + '"' + (current === role ? ' selected' : '') + '>' + esc(role) + '</option>';
  const roles = ['Soldat', 'Unteroffizier', 'Offizier', 'Admin'];
  const body = [
    '<article class="content form-builder-page" data-form-builder-page>',
    '<p><a href="' + esc(backUrl || folderUrl(kachel.id, dir)) + '" class="back">← Zurück</a></p>',
    '<h1>Formular erstellen</h1>',
    error ? '<p class="err">' + esc(error) + '</p>' : '',
    '<form method="POST" action="' + esc(action) + '" class="genform wide form-builder-form" data-form-builder>',
    '<input type="hidden" name="dir" value="' + esc(dir) + '">',
    '<input type="hidden" name="fieldsJson" data-form-builder-fields-json value="' + esc(values.fieldsJson || '') + '">',
    '<div class="form-el w-half"><label class="field">Formular-Titel *<input name="title" required autocomplete="off" value="' + esc(values.title || '') + '"></label></div>',
    '<div class="form-el w-half"><label class="field">Technischer Name optional<input name="id" autocomplete="off" value="' + esc(values.id || '') + '" placeholder="wird sonst aus dem Titel erzeugt"></label></div>',
    '<div class="form-el w-half"><label class="field">Ausfüllen ab Rolle<select name="submitAccess">' + roles.map((role) => roleOption(role, submitAccess)).join('') + '</select></label></div>',
    '<div class="form-el w-half"><label class="field">Auswertung ab Rolle<select name="resultsAccess">' + roles.map((role) => roleOption(role, resultsAccess)).join('') + '</select></label></div>',
    '<section class="form-el form-builder-fields">',
    '<div class="content-header"><h2>Felder</h2><button type="button" class="secondary-button" data-form-builder-add>+ Feld hinzufügen</button></div>',
    '<div data-form-builder-fields></div>',
    '</section>',
    '<button type="submit">Formular speichern</button>',
    '</form>',
    '<p><a href="' + esc(backUrl || folderUrl(kachel.id, dir)) + '" class="back">← Zurück</a></p>',
    '</article>',
  ].join('');
  return layout(req, { title: 'Formular erstellen', body });
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
