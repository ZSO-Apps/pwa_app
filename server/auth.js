import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import YAML from 'yaml';

export const ROLE_RANK = { public: 0, Soldat: 1, Unteroffizier: 2, Offizier: 3, admin: 4 };
export const ROLES = Object.keys(ROLE_RANK);

export function hasAccess(userRole, requiredRole) {
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[requiredRole] ?? 0);
}

const SECRET_FILE = path.resolve('data/.session-secret');

function loadOrCreateSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadOrCreateSecret();

function hmac(s) {
  return crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
}

export function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${hmac(body)}`;
}

export function verify(cookie) {
  if (!cookie || typeof cookie !== 'string') return null;
  const [body, sig] = cookie.split('.');
  if (!body || !sig) return null;
  if (hmac(body) !== sig) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch { return null; }
}

let _users = null;
const USERS_FILE = path.resolve('data/users.yaml');

export function loadUsers() {
  if (_users) return _users;
  const raw = fs.readFileSync(USERS_FILE, 'utf8');
  const parsed = YAML.parse(raw);
  _users = parsed?.users || {};
  return _users;
}

export function resetUsersCache() {
  _users = null;
}

export async function checkLogin(username, password) {
  const users = loadUsers();
  const u = users[username];
  if (!u) return null;
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return null;
  return { username, role: u.role };
}

export function sessionMiddleware(req, res, next) {
  const c = req.cookies?.session;
  const session = c ? verify(c) : null;
  req.user = session ? { username: session.u, role: session.r } : null;
  res.locals = res.locals || {};
  res.locals.user = req.user;
  next();
}

export function setSessionCookie(res, user) {
  const cookie = sign({ u: user.username, r: user.role });
  res.cookie('session', cookie, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie('session', { path: '/' });
}

export function requireRole(min) {
  return (req, res, next) => {
    const role = req.user?.role || 'public';
    if (!hasAccess(role, min)) {
      if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
      return res.status(403).send('Zugriff verweigert');
    }
    next();
  };
}
