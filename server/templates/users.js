import { layout } from './layout.js';
import { esc } from './shared.js';

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
