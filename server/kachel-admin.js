import fs from 'node:fs';
import path from 'node:path';
import { hasAccess, normalizeRole, ROLES } from './auth.js';
import { findKachel, getLayout, loadLayout } from './layout.js';
import { renderError } from './templates/index.js';
import { layout } from './templates/layout.js';
import { esc } from './templates/shared.js';

const LAYOUT_FILE = path.resolve('layout.yaml');
const CONTENT_ROOT = path.resolve('content_zso_specific');
const CONTENT_ROOTS = [
  path.resolve('content_generic'),
  path.resolve('content_zso_specific_public'),
  CONTENT_ROOT,
];
function requireKachelAdmin(req, res) {
  const role = req.user?.role || 'public';
  if (hasAccess(role, 'Offizier')) return true;
  if (!req.user) {
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return false;
  }
  res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  return false;
}

function transliterate(value) {
  return String(value || '')
    .replace(/[Ää]/g, 'ae')
    .replace(/[Öö]/g, 'oe')
    .replace(/[Üü]/g, 'ue')
    .replace(/ß/g, 'ss');
}

function slugify(value) {
  const slug = transliterate(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return (slug || 'kachel').slice(0, 50).replace(/-+$/g, '') || 'kachel';
}

function normalizeInput(body = {}) {
  const title = String(body.title || '').trim();
  return {
    title,
    id: uniqueSlug(title),
    access: normalizeRole(String(body.access || 'Soldat').trim()),
  };
}

function walkKacheln(list, visitor) {
  for (const kachel of list || []) {
    visitor(kachel);
    if (Array.isArray(kachel.children)) walkKacheln(kachel.children, visitor);
  }
}

function contentSlugExists(slug) {
  let found = false;
  walkKacheln(getLayout().kacheln, (kachel) => {
    if (kachel.content === slug) found = true;
  });
  return found;
}

function contentFolderExists(slug) {
  return CONTENT_ROOTS.some((root) => fs.existsSync(path.join(root, slug)));
}

function slugAvailable(slug) {
  return !findKachel(slug) && !contentSlugExists(slug) && !contentFolderExists(slug);
}

function uniqueSlug(base) {
  const cleanBase = slugify(base);
  if (slugAvailable(cleanBase)) return cleanBase;
  const prefix = cleanBase.slice(0, 47).replace(/-+$/g, '') || 'kachel';
  for (let index = 2; index < 1000; index++) {
    const candidate = prefix + '-' + index;
    if (slugAvailable(candidate)) return candidate;
  }
  throw new Error('Es konnte kein freier Ordnername erzeugt werden.');
}

function validateInput(input) {
  if (input.title.length < 2 || input.title.length > 80) {
    throw new Error('Titel muss 2-80 Zeichen lang sein.');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(input.id)) {
    throw new Error('Der automatisch erzeugte Ordnername ist ungültig. Bitte den Titel anpassen.');
  }
  if (!ROLES.includes(input.access)) {
    throw new Error('Ungültige Sichtbarkeitsrolle.');
  }
  if (findKachel(input.id)) {
    throw new Error('Eine Kachel mit diesem Ordnernamen existiert bereits.');
  }
  if (contentSlugExists(input.id) || contentFolderExists(input.id)) {
    throw new Error('Ein Content-Ordner mit diesem Ordnernamen existiert bereits.');
  }
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function appendKachelToLayout(input) {
  const block = [
    '',
    '  - id: ' + yamlScalar(input.id),
    '    title: ' + yamlScalar(input.title),
    '    access: ' + yamlScalar(input.access),
    '    content: ' + yamlScalar(input.id),
    '',
  ].join('\n');
  fs.appendFileSync(LAYOUT_FILE, block);
  loadLayout();
}

function renderRoleOptions(current) {
  return ROLES.map((role) => '<option value="' + esc(role) + '"' + (role === current ? ' selected' : '') + '>' + esc(role === 'public' ? 'Öffentlich' : role) + '</option>').join('');
}

function renderKachelFormPage(req, { values = {}, error = '' } = {}) {
  const access = normalizeRole(values.access || 'Soldat');
  const body = [
    '<article class="content narrow">',
    '<p><a href="/" class="back">← Zurück zur Übersicht</a></p>',
    '<h1>Kachel hinzufügen</h1>',
    error ? '<p class="err">' + esc(error) + '</p>' : '',
    '<form method="POST" action="/kachel-admin" class="genform" data-online-only-form>',
    '<label>Titel *<input name="title" required maxlength="80" autocomplete="off" value="' + esc(values.title || '') + '"></label>',
    '<label>Sichtbar ab Rolle<select name="access">' + renderRoleOptions(access) + '</select></label>',
    '<button type="submit" data-online-only="true">Kachel erstellen</button>',
    '</form>',
    '</article>',
  ].join('');
  return layout(req, { title: 'Kachel hinzufügen', body });
}

export function renderNewKachel(req, res) {
  if (!requireKachelAdmin(req, res)) return;
  res.send(renderKachelFormPage(req, { values: { access: 'Soldat' } }));
}

export function createKachel(req, res) {
  if (!requireKachelAdmin(req, res)) return;
  const input = normalizeInput(req.body);
  let folderCreated = false;
  try {
    validateInput(input);
    fs.mkdirSync(CONTENT_ROOT, { recursive: true });
    fs.mkdirSync(path.join(CONTENT_ROOT, input.id));
    folderCreated = true;
    appendKachelToLayout(input);
    res.redirect(303, '/k/' + encodeURIComponent(input.id));
  } catch (error) {
    if (folderCreated) fs.rmSync(path.join(CONTENT_ROOT, input.id), { recursive: true, force: true });
    res.status(400).send(renderKachelFormPage(req, { values: input, error: error.message }));
  }
}
