import fs from 'node:fs';
import path from 'node:path';
import { findKachel } from './layout.js';
import { hasAccess } from './auth.js';
import { resolveKachelPath, safeResolve } from './content.js';
import { renderError, renderMarkdownEditorPage } from './templates/index.js';

const EDITABLE_KACHEL_IDS = new Set(['lage', 'telematik', 'ntp', 'unterstuetzung']);
const CONTENT_EDITOR_ROLE = 'Admin';
const ZSO_CONTENT_ROOT = path.resolve('content_zso_specific');
const IMPORT_TYPES = {
  markdown: {
    targetExt: '.md',
    allowedExts: new Set(['.md', '.markdown', '.txt']),
    error: 'Bitte eine Markdown-Datei auswählen.',
  },
  pdf: {
    targetExt: '.pdf',
    allowedExts: new Set(['.pdf']),
    error: 'Bitte eine PDF-Datei auswählen.',
  },
  picture: {
    allowedExts: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']),
    error: 'Bitte ein Bild im Format PNG, JPG, GIF oder WebP auswählen.',
  },
};

function canManageContent(req, kachel) {
  const role = req.user?.role || 'public';
  return Boolean(kachel?.id && EDITABLE_KACHEL_IDS.has(kachel.id) && hasAccess(role, CONTENT_EDITOR_ROLE));
}

function requireManageContent(req, res, kachel) {
  if (!kachel || !EDITABLE_KACHEL_IDS.has(kachel.id)) {
    res.status(404).send(renderError(req, 404, 'Content-Verwaltung nicht verfügbar'));
    return false;
  }
  if (canManageContent(req, kachel)) return true;
  if (!req.user) {
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return false;
  }
  res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  return false;
}

function normalizeRelDir(value) {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('Ungültiger Ordner.');
  return parts.join('/');
}

function encodedRelPath(relDir) {
  return normalizeRelDir(relDir).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function folderUrl(kachelId, relDir) {
  const rel = encodedRelPath(relDir);
  return '/k/' + encodeURIComponent(kachelId) + (rel ? '/' + rel + '/' : '');
}

function zsoRootFor(kachel) {
  return path.join(ZSO_CONTENT_ROOT, kachel.content);
}

function targetDirFor(kachel, relDir) {
  const rel = normalizeRelDir(relDir);
  if (rel) {
    const existing = resolveKachelPath(kachel, rel);
    if (!existing || !fs.existsSync(existing) || !fs.statSync(existing).isDirectory()) {
      throw new Error('Ordner nicht gefunden.');
    }
  }
  return safeResolve(zsoRootFor(kachel), rel);
}

function safeFileBase(value) {
  let base = String(value || '').trim();
  base = base.replace(/\.(md|markdown|txt|pdf|png|jpe?g|gif|webp|url)$/i, '');
  base = base
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#%{}^~[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  if (!base) throw new Error('Bitte einen Dateinamen angeben.');
  return base;
}

function uniqueTargetFile(targetDir, fileBase, ext) {
  const fileName = safeFileBase(fileBase) + ext;
  const filePath = safeResolve(targetDir, fileName);
  if (fs.existsSync(filePath)) throw new Error('Eine Datei mit diesem Namen existiert bereits.');
  return filePath;
}


function normalizeWebsiteUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Bitte einen Link angeben.');
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Bitte einen gültigen Link angeben.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Nur http- und https-Links sind erlaubt.');
  }
  return parsed.toString();
}

function decodeOriginalFilename(req) {
  const raw = req.get('x-original-filename') || '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function renderEditorWithError(req, res, kachel, relDir, error, values = {}) {
  res.status(400).send(renderMarkdownEditorPage(req, kachel, {
    dir: relDir,
    backUrl: folderUrl(kachel.id, relDir),
    error,
    values,
  }));
}

export function contentActionContext(req, kachel, relDir = '') {
  if (!canManageContent(req, kachel)) return null;
  try {
    return { enabled: true, kachelId: kachel.id, dir: normalizeRelDir(relDir) };
  } catch {
    return null;
  }
}

export function renderNewMarkdownPage(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  let relDir;
  try {
    relDir = normalizeRelDir(req.query?.dir);
    targetDirFor(kachel, relDir);
  } catch (error) {
    return res.status(400).send(renderError(req, 400, error.message));
  }
  res.send(renderMarkdownEditorPage(req, kachel, {
    dir: relDir,
    backUrl: folderUrl(kachel.id, relDir),
  }));
}

export function saveMarkdownContent(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  let relDir = '';
  try {
    relDir = normalizeRelDir(req.body?.dir);
    const targetDir = targetDirFor(kachel, relDir);
    const filePath = uniqueTargetFile(targetDir, req.body?.filename, '.md');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, String(req.body?.content || ''));
    res.redirect(folderUrl(kachel.id, relDir));
  } catch (error) {
    renderEditorWithError(req, res, kachel, relDir, error.message, req.body || {});
  }
}

export function importContentFile(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  try {
    const type = String(req.query?.type || '');
    const config = IMPORT_TYPES[type];
    if (!config) throw new Error('Import-Typ nicht unterstützt.');

    const relDir = normalizeRelDir(req.query?.dir);
    const targetDir = targetDirFor(kachel, relDir);
    const originalExt = path.extname(decodeOriginalFilename(req)).toLowerCase();
    if (!config.allowedExts.has(originalExt)) throw new Error(config.error);

    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) throw new Error('Die Datei ist leer.');

    const filePath = uniqueTargetFile(targetDir, req.query?.name, config.targetExt || originalExt);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, body);
    res.json({ ok: true, url: folderUrl(kachel.id, relDir) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
}


export function saveContentLink(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  try {
    const relDir = normalizeRelDir(req.body?.dir);
    const targetDir = targetDirFor(kachel, relDir);
    const filePath = uniqueTargetFile(targetDir, req.body?.filename, '.url');
    const url = normalizeWebsiteUrl(req.body?.url);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, '[InternetShortcut]\nURL=' + url + '\n');
    res.json({ ok: true, url: folderUrl(kachel.id, relDir) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
}
