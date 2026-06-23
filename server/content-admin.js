import fs from 'node:fs';
import path from 'node:path';
import { findKachel, getForm, loadLayout } from './layout.js';
import { hasAccess } from './auth.js';
import { effectiveKachel, resolveKachelPath, safeResolve } from './content.js';
import { renderError, renderFormBuilderPage, renderMarkdownEditorPage } from './templates/index.js';

const CONTENT_EDITOR_ROLE = 'Unteroffizier';
const ZSO_CONTENT_ROOT = path.resolve('content_zso_specific');
const CONTENT_ROOTS = [path.resolve('content_generic'), ZSO_CONTENT_ROOT];
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

const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'date', 'time', 'select', 'radio', 'checkboxes', 'checkbox']);
const IMAGE_DATA_PATTERN = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/i;
const MAX_MARKDOWN_IMAGE_BYTES = 5 * 1024 * 1024;
const OPTION_FIELD_TYPES = new Set(['select', 'radio', 'checkboxes']);
const ROLES = new Set(['Soldat', 'Unteroffizier', 'Offizier', 'Admin']);

function canManageContent(req, kachel) {
  const role = req.user?.role || 'public';
  return Boolean(kachel?.id && kachel.content && hasAccess(role, CONTENT_EDITOR_ROLE));
}

function requireManageContent(req, res, kachel) {
  if (!kachel?.content) {
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

function normalizeRelPath(value) {
  const rel = normalizeRelDir(value);
  if (!rel) throw new Error('Bitte einen Eintrag angeben.');
  if (rel.split('/').some((part) => part.toLowerCase().endsWith('.content'))) {
    throw new Error('Technische Asset-Ordner können nicht direkt geändert werden.');
  }
  return rel;
}

function encodedRelPath(relDir) {
  return normalizeRelDir(relDir).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function encodedAssetPath(...parts) {
  return parts.map((part) => encodeURIComponent(String(part || ''))).join('/');
}

function joinRelDir(...parts) {
  return parts.map((part) => normalizeRelDir(part)).filter(Boolean).join('/');
}

function contentFileUrl(kachelId, relPath) {
  const rel = normalizeRelPath(relPath).split('/').map(encodeURIComponent).join('/');
  return '/k/' + encodeURIComponent(kachelId) + '/' + rel;
}

function splitRelPath(relPath) {
  const normalized = normalizeRelPath(relPath);
  const parts = normalized.split('/');
  const name = parts.pop();
  return { dir: parts.join('/'), name, rel: normalized };
}

function folderUrl(kachelId, relDir) {
  const rel = encodedRelPath(relDir);
  return '/k/' + encodeURIComponent(kachelId) + (rel ? '/' + rel + '/' : '');
}

function effectiveContentKachel(kachel, activeWk) {
  const effective = effectiveKachel(kachel, activeWk);
  if (!effective?.content) throw new Error('Bitte zuerst einen WK auswählen oder anlegen.');
  return effective;
}

function zsoRootFor(kachel) {
  return path.join(ZSO_CONTENT_ROOT, kachel.content);
}

function targetDirFor(kachel, relDir, activeWk) {
  const effective = effectiveContentKachel(kachel, activeWk);
  const rel = normalizeRelDir(relDir);
  if (rel) {
    const existing = resolveKachelPath(effective, rel);
    if (!existing || !fs.existsSync(existing) || !fs.statSync(existing).isDirectory()) {
      throw new Error('Ordner nicht gefunden.');
    }
  }
  return safeResolve(zsoRootFor(effective), rel);
}

function safeFileBase(value) {
  let base = String(value || '').trim();
  base = base.replace(/\.(json|md|markdown|txt|pdf|png|jpe?g|gif|webp|url)$/i, '');
  base = base
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#%{}^~[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  if (!base) throw new Error('Bitte einen Namen angeben.');
  return base;
}

function slugify(value, fallback = 'formular') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function contentFolderName(fileBase) {
  return safeFileBase(fileBase) + '.content';
}

function decodeInlineImage(value) {
  const raw = String(value || '');
  if (!raw) return null;
  const match = raw.match(IMAGE_DATA_PATTERN);
  if (!match) throw new Error('Bildformat nicht unterstützt.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('Bild ist leer.');
  if (buffer.length > MAX_MARKDOWN_IMAGE_BYTES) throw new Error('Bilder dürfen maximal 5 MB gross sein.');
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  return { buffer, ext: ext === 'jpg' ? 'jpg' : ext };
}

function normalizeMarkdownImages(body, targetDir) {
  let content = String(body?.content || '');
  let images = [];
  try {
    const parsed = JSON.parse(String(body?.imagesJson || '[]'));
    if (Array.isArray(parsed)) images = parsed;
  } catch {
    throw new Error('Bilddaten konnten nicht verarbeitet werden.');
  }
  if (!images.length) return content;

  const assetDirName = contentFolderName(body?.filename);
  const assetDir = safeResolve(targetDir, assetDirName);
  fs.mkdirSync(assetDir, { recursive: true });
  const used = new Set();

  images.forEach((image, index) => {
    const token = String(image?.token || '').trim();
    const decoded = decodeInlineImage(image?.data);
    if (!token || !decoded) return;
    let base = safeFileBase(image?.name || ('bild-' + (index + 1)));
    let fileName = base + '.' + decoded.ext;
    for (let n = 2; used.has(fileName.toLowerCase()) || fs.existsSync(safeResolve(assetDir, fileName)); n++) {
      fileName = base + '-' + n + '.' + decoded.ext;
    }
    used.add(fileName.toLowerCase());
    fs.writeFileSync(safeResolve(assetDir, fileName), decoded.buffer);
    const relPath = encodedAssetPath(assetDirName, fileName);
    content = content.split(token).join(relPath);
  });

  return content;
}

function zsoPathFor(kachel, relPath, activeWk) {
  const effective = effectiveContentKachel(kachel, activeWk);
  return safeResolve(zsoRootFor(effective), normalizeRelPath(relPath));
}

function markdownAssetDirName(fileName) {
  return path.basename(fileName, path.extname(fileName)) + '.content';
}

function maybeRenameMarkdownAssets(oldFilePath, newFilePath) {
  if (path.extname(oldFilePath).toLowerCase() !== '.md') return;
  const oldDirName = markdownAssetDirName(path.basename(oldFilePath));
  const newDirName = markdownAssetDirName(path.basename(newFilePath));
  if (oldDirName === newDirName) return;
  const oldAssetDir = path.join(path.dirname(oldFilePath), oldDirName);
  const newAssetDir = path.join(path.dirname(newFilePath), newDirName);
  if (fs.existsSync(oldAssetDir)) fs.renameSync(oldAssetDir, newAssetDir);
  if (fs.existsSync(newFilePath)) {
    let content = fs.readFileSync(newFilePath, 'utf8');
    content = content
      .split(encodeURIComponent(oldDirName) + '/').join(encodeURIComponent(newDirName) + '/')
      .split(oldDirName + '/').join(newDirName + '/');
    fs.writeFileSync(newFilePath, content);
  }
}

function maybeDeleteMarkdownAssets(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.md') return;
  fs.rmSync(path.join(path.dirname(filePath), markdownAssetDirName(path.basename(filePath))), { recursive: true, force: true });
}

function containsJson(absPath) {
  if (!fs.existsSync(absPath)) return false;
  const stat = fs.statSync(absPath);
  if (stat.isFile()) return path.extname(absPath).toLowerCase() === '.json';
  const stack = [absPath];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.toLowerCase().endsWith('.content')) continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(child);
      else if (path.extname(entry.name).toLowerCase() === '.json') return true;
    }
  }
  return false;
}

function uniqueTargetFile(targetDir, fileBase, ext) {
  const fileName = safeFileBase(fileBase) + ext;
  const filePath = safeResolve(targetDir, fileName);
  if (fs.existsSync(filePath)) throw new Error('Eine Datei mit diesem Namen existiert bereits.');
  return filePath;
}

function uniqueTargetFolder(targetDir, folderName) {
  const safeName = safeFileBase(folderName);
  const folderPath = safeResolve(targetDir, safeName);
  if (fs.existsSync(folderPath)) throw new Error('Ein Ordner mit diesem Namen existiert bereits.');
  return { folderPath, safeName };
}

function formIdExists(formId, targetDir) {
  if (getForm(formId)) return true;
  for (const root of CONTENT_ROOTS) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name.toLowerCase().endsWith('.content')) continue;
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(child);
        else if (entry.name === formId + '.json') return true;
      }
    }
  }
  return fs.existsSync(path.join(targetDir, formId + '.json'));
}

function uniqueFormId(title, explicit, targetDir) {
  const base = slugify(explicit || title, 'formular');
  let candidate = base;
  for (let n = 2; formIdExists(candidate, targetDir); n++) candidate = base + '-' + n;
  return candidate;
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

function parseFieldOptions(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueFieldName(label, index, used) {
  const base = slugify(label, 'feld-' + index).replace(/-/g, '_');
  let candidate = base;
  for (let n = 2; used.has(candidate); n++) candidate = base + '_' + n;
  used.add(candidate);
  return candidate;
}

function normalizeFormFields(rawFields) {
  const source = Array.isArray(rawFields) ? rawFields : [];
  if (!source.length) throw new Error('Bitte mindestens ein Feld erfassen.');
  const used = new Set();
  return source.map((raw, index) => {
    const label = String(raw?.label || '').trim();
    if (!label) throw new Error('Feld ' + (index + 1) + ': Bitte eine Bezeichnung angeben.');
    const type = FIELD_TYPES.has(raw?.type) ? raw.type : 'text';
    const field = {
      name: uniqueFieldName(label, index + 1, used),
      type,
      label,
      required: Boolean(raw?.required),
    };
    if (OPTION_FIELD_TYPES.has(type)) {
      const options = parseFieldOptions(raw?.options);
      if (options.length < 2) throw new Error('Feld ' + (index + 1) + ': Bitte mindestens zwei Optionen angeben.');
      field.options = options;
    }
    return field;
  });
}

function normalizeFormDefinition(body, targetDir) {
  const title = String(body?.title || '').trim();
  if (!title) throw new Error('Bitte einen Formular-Titel angeben.');
  const submitAccess = ROLES.has(body?.submitAccess) ? body.submitAccess : 'Soldat';
  const resultsAccess = ROLES.has(body?.resultsAccess) ? body.resultsAccess : 'Unteroffizier';
  const rawFields = JSON.parse(String(body?.fieldsJson || '[]'));
  const fields = normalizeFormFields(rawFields);
  const id = uniqueFormId(title, body?.id, targetDir);
  return {
    id,
    title,
    submitLabel: title,
    resultsLabel: 'Auswertung ' + title,
    submitAccess,
    resultsAccess,
    fields,
  };
}

function renderEditorWithError(req, res, kachel, relDir, error, values = {}) {
  res.status(400).send(renderMarkdownEditorPage(req, kachel, {
    dir: relDir,
    backUrl: folderUrl(kachel.id, relDir),
    error,
    values,
  }));
}

function renderFormBuilderWithError(req, res, kachel, relDir, error, values = {}) {
  res.status(400).send(renderFormBuilderPage(req, kachel, {
    dir: relDir,
    backUrl: folderUrl(kachel.id, relDir),
    error,
    values,
  }));
}

export function contentActionContext(req, kachel, relDir = '') {
  if (!canManageContent(req, kachel)) return null;
  try {
    if (kachel.wkScoped && !req.activeWk?.id) return null;
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
    targetDirFor(kachel, relDir, req.activeWk);
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
    const targetDir = targetDirFor(kachel, relDir, req.activeWk);
    const filePath = uniqueTargetFile(targetDir, req.body?.filename, '.md');
    fs.mkdirSync(targetDir, { recursive: true });
    const content = normalizeMarkdownImages(req.body || {}, targetDir);
    fs.writeFileSync(filePath, content);
    res.redirect(folderUrl(kachel.id, relDir));
  } catch (error) {
    renderEditorWithError(req, res, kachel, relDir, error.message, req.body || {});
  }
}

export function renderEditMarkdownPage(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  try {
    const rel = normalizeRelPath(req.query?.rel);
    if (path.extname(rel).toLowerCase() !== '.md') throw new Error('Nur Markdown-Dateien können bearbeitet werden.');
    const effective = effectiveContentKachel(kachel, req.activeWk);
    const source = resolveKachelPath(effective, rel);
    if (!source || !fs.statSync(source).isFile()) throw new Error('Markdown-Datei nicht gefunden.');
    const { dir, name } = splitRelPath(rel);
    res.send(renderMarkdownEditorPage(req, kachel, {
      mode: 'edit',
      rel,
      dir,
      backUrl: contentFileUrl(kachel.id, rel),
      values: {
        filename: path.basename(name, '.md'),
        content: fs.readFileSync(source, 'utf8'),
      },
    }));
  } catch (error) {
    res.status(400).send(renderError(req, 400, error.message));
  }
}

export function saveMarkdownEdit(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  let rel = '';
  try {
    rel = normalizeRelPath(req.body?.rel);
    if (path.extname(rel).toLowerCase() !== '.md') throw new Error('Nur Markdown-Dateien können bearbeitet werden.');
    const effective = effectiveContentKachel(kachel, req.activeWk);
    const source = resolveKachelPath(effective, rel);
    if (!source || !fs.statSync(source).isFile()) throw new Error('Markdown-Datei nicht gefunden.');
    const { dir, name } = splitRelPath(rel);
    const targetDir = targetDirFor(kachel, dir, req.activeWk);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = safeResolve(targetDir, name);
    const content = normalizeMarkdownImages({ ...(req.body || {}), filename: path.basename(name, '.md') }, targetDir);
    fs.writeFileSync(targetFile, content);
    res.redirect(contentFileUrl(kachel.id, rel));
  } catch (error) {
    const dir = rel ? splitRelPath(rel).dir : normalizeRelDir(req.body?.dir);
    renderEditorWithError(req, res, kachel, dir, error.message, req.body || {});
  }
}

export function renderNewFormPage(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  let relDir = '';
  try {
    relDir = normalizeRelDir(req.query?.dir);
    targetDirFor(kachel, relDir, req.activeWk);
  } catch (error) {
    return res.status(400).send(renderError(req, 400, error.message));
  }
  res.send(renderFormBuilderPage(req, kachel, {
    dir: relDir,
    backUrl: folderUrl(kachel.id, relDir),
  }));
}

export function saveFormDefinition(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  let relDir = '';
  try {
    relDir = normalizeRelDir(req.body?.dir);
    const targetDir = targetDirFor(kachel, relDir, req.activeWk);
    const definition = normalizeFormDefinition(req.body || {}, targetDir);
    const filePath = uniqueTargetFile(targetDir, definition.id, '.json');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(definition, null, 2) + '\n');
    loadLayout();
    res.redirect(folderUrl(kachel.id, relDir));
  } catch (error) {
    renderFormBuilderWithError(req, res, kachel, relDir, error.message, req.body || {});
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
    const targetDir = targetDirFor(kachel, relDir, req.activeWk);
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

export function createContentFolder(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  try {
    const relDir = normalizeRelDir(req.body?.dir);
    const targetDir = targetDirFor(kachel, relDir, req.activeWk);
    const { folderPath, safeName } = uniqueTargetFolder(targetDir, req.body?.name);
    fs.mkdirSync(folderPath, { recursive: true });
    res.json({ ok: true, url: folderUrl(kachel.id, joinRelDir(relDir, safeName)) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
}

export function saveContentLink(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  try {
    const relDir = normalizeRelDir(req.body?.dir);
    const targetDir = targetDirFor(kachel, relDir, req.activeWk);
    const filePath = uniqueTargetFile(targetDir, req.body?.filename, '.url');
    const url = normalizeWebsiteUrl(req.body?.url);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, '[InternetShortcut]\nURL=' + url + '\n');
    res.json({ ok: true, url: folderUrl(kachel.id, relDir) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
}

export function renameContentEntry(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  try {
    const { dir, name, rel } = splitRelPath(req.body?.rel);
    const current = zsoPathFor(kachel, rel, req.activeWk);
    if (!fs.existsSync(current)) throw new Error('Nur ZSO-spezifische Einträge können umbenannt werden.');
    const stat = fs.statSync(current);
    const base = safeFileBase(req.body?.name);
    const newName = stat.isDirectory() ? base : base + path.extname(name);
    const target = safeResolve(path.dirname(current), newName);
    if (fs.existsSync(target)) throw new Error('Ein Eintrag mit diesem Namen existiert bereits.');
    const hadJson = containsJson(current);
    fs.renameSync(current, target);
    if (stat.isFile()) maybeRenameMarkdownAssets(current, target);
    if (hadJson || containsJson(target)) loadLayout();
    res.json({ ok: true, url: stat.isDirectory() ? folderUrl(kachel.id, joinRelDir(dir, newName)) : folderUrl(kachel.id, dir) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
}

export function deleteContentEntry(req, res, kachelId) {
  const kachel = findKachel(kachelId);
  if (!requireManageContent(req, res, kachel)) return;
  try {
    const { dir, rel } = splitRelPath(req.body?.rel);
    const current = zsoPathFor(kachel, rel, req.activeWk);
    if (!fs.existsSync(current)) throw new Error('Nur ZSO-spezifische Einträge können gelöscht werden.');
    const hadJson = containsJson(current);
    const stat = fs.statSync(current);
    if (stat.isDirectory()) fs.rmSync(current, { recursive: true, force: true });
    else {
      maybeDeleteMarkdownAssets(current);
      fs.unlinkSync(current);
    }
    if (hadJson) loadLayout();
    res.json({ ok: true, url: folderUrl(kachel.id, dir) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
}
