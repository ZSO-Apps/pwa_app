import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import YAML from 'yaml';
import { hasAccess, resetUsersCache } from './auth.js';
import {
  renderError,
  renderUserDeletePage,
  renderUserFormPage,
  renderUsersPage,
} from './templates/index.js';

const USERS_FILE = path.resolve('data/users.yaml');
const BASE_USERS = new Set(['admin', 'Of', 'Uof', 'AdZS']);
const USER_ROLES = ['admin', 'Offizier', 'Unteroffizier', 'Soldat'];

function requireAdmin(req, res) {
  const role = req.user?.role || 'public';
  if (hasAccess(role, 'admin')) return true;
  if (!req.user) {
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return false;
  }
  res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  return false;
}

function readUsersFile() {
  if (!fs.existsSync(USERS_FILE)) return { users: {} };
  const parsed = YAML.parse(fs.readFileSync(USERS_FILE, 'utf8')) || {};
  return { users: parsed.users || {} };
}

function writeUsersFile(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  const yaml = '# Managed by Admin -> User Verwaltung. Passwords are bcrypt hashes.\n' + YAML.stringify({ users });
  fs.writeFileSync(USERS_FILE, yaml);
  resetUsersCache();
}

function validateUsername(username) {
  return /^[A-Za-z0-9._-]{2,50}$/.test(username || '');
}

function normalizeInput(body) {
  return {
    username: String(body?.username || '').trim(),
    password: String(body?.password || ''),
    role: String(body?.role || '').trim(),
  };
}

function validateCommon(input, { requirePassword }) {
  if (!validateUsername(input.username)) {
    throw new Error('Name muss 2-50 Zeichen lang sein und darf nur Buchstaben, Zahlen, Punkt, Unterstrich oder Bindestrich enthalten.');
  }
  if (!USER_ROLES.includes(input.role)) {
    throw new Error('Ungültige Rolle.');
  }
  if (requirePassword && !input.password) {
    throw new Error('Passwort ist erforderlich.');
  }
}

function toRows(users) {
  return Object.entries(users)
    .map(([username, user]) => ({
      username,
      role: user.role || '',
      protected: BASE_USERS.has(username),
    }))
    .sort((a, b) => {
      const aBase = BASE_USERS.has(a.username) ? 0 : 1;
      const bBase = BASE_USERS.has(b.username) ? 0 : 1;
      return aBase - bBase || a.username.localeCompare(b.username, 'de');
    });
}

export function renderUsers(req, res) {
  if (!requireAdmin(req, res)) return;
  const { users } = readUsersFile();
  res.send(renderUsersPage(req, toRows(users)));
}

export function renderNewUser(req, res) {
  if (!requireAdmin(req, res)) return;
  res.send(renderUserFormPage(req, {
    mode: 'create',
    roles: USER_ROLES,
    values: { role: 'Soldat' },
  }));
}

export async function createUser(req, res) {
  if (!requireAdmin(req, res)) return;
  const input = normalizeInput(req.body);
  try {
    validateCommon(input, { requirePassword: true });
    const { users } = readUsersFile();
    if (users[input.username]) throw new Error('Dieser Name existiert bereits.');
    users[input.username] = {
      role: input.role,
      passwordHash: await bcrypt.hash(input.password, 10),
    };
    writeUsersFile(users);
    res.redirect(303, '/admin/users');
  } catch (error) {
    res.status(400).send(renderUserFormPage(req, {
      mode: 'create',
      roles: USER_ROLES,
      values: input,
      error: error.message,
    }));
  }
}

export function renderEditUser(req, res) {
  if (!requireAdmin(req, res)) return;
  const username = req.params.username;
  if (BASE_USERS.has(username)) return res.status(403).send(renderError(req, 403, 'Basisaccounts können nicht bearbeitet werden.'));
  const { users } = readUsersFile();
  const user = users[username];
  if (!user) return res.status(404).send(renderError(req, 404, 'User nicht gefunden'));
  res.send(renderUserFormPage(req, {
    mode: 'edit',
    roles: USER_ROLES,
    originalUsername: username,
    values: { username, role: user.role || 'Soldat' },
  }));
}

export async function updateUser(req, res) {
  if (!requireAdmin(req, res)) return;
  const originalUsername = req.params.username;
  if (BASE_USERS.has(originalUsername)) return res.status(403).send(renderError(req, 403, 'Basisaccounts können nicht bearbeitet werden.'));
  const input = normalizeInput(req.body);
  try {
    validateCommon(input, { requirePassword: false });
    const { users } = readUsersFile();
    const existing = users[originalUsername];
    if (!existing) throw new Error('User nicht gefunden.');
    if (input.username !== originalUsername && users[input.username]) throw new Error('Dieser Name existiert bereits.');
    const next = {
      role: input.role,
      passwordHash: input.password ? await bcrypt.hash(input.password, 10) : existing.passwordHash,
    };
    if (input.username !== originalUsername) delete users[originalUsername];
    users[input.username] = next;
    writeUsersFile(users);
    res.redirect(303, '/admin/users');
  } catch (error) {
    res.status(400).send(renderUserFormPage(req, {
      mode: 'edit',
      roles: USER_ROLES,
      originalUsername,
      values: input,
      error: error.message,
    }));
  }
}

export function renderDeleteUser(req, res) {
  if (!requireAdmin(req, res)) return;
  const username = req.params.username;
  if (BASE_USERS.has(username)) return res.status(403).send(renderError(req, 403, 'Basisaccounts können nicht gelöscht werden.'));
  const { users } = readUsersFile();
  const user = users[username];
  if (!user) return res.status(404).send(renderError(req, 404, 'User nicht gefunden'));
  res.send(renderUserDeletePage(req, { username, role: user.role || '' }));
}

export function deleteUser(req, res) {
  if (!requireAdmin(req, res)) return;
  const username = req.params.username;
  if (BASE_USERS.has(username)) return res.status(403).send(renderError(req, 403, 'Basisaccounts können nicht gelöscht werden.'));
  const confirmation = String(req.body?.confirmation || '').trim();
  if (confirmation !== username) {
    return res.status(400).send(renderUserDeletePage(req, {
      username,
      role: '',
      error: 'Bitte den Namen exakt bestätigen.',
    }));
  }
  const { users } = readUsersFile();
  if (!users[username]) return res.status(404).send(renderError(req, 404, 'User nicht gefunden'));
  delete users[username];
  writeUsersFile(users);
  res.redirect(303, '/admin/users');
}
