import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import mime from 'mime-types';
import { hasAccess } from './auth.js';

marked.setOptions({ gfm: true, breaks: false });

const ROOT = path.resolve('.');

// The four content roots. Public roots are visible without login; protected
// roots only join the merged view when the Kachel requires login.
const ROOT_DIRS = {
  publicGeneric:        path.resolve('content_public'),
  publicZso:            path.resolve('content_zso_specific_public'),
  protectedGeneric:     path.resolve('content_protected'),
  protectedZso:         path.resolve('content_zso_specific_protected'),
};

// Order: later entries override earlier ones on name collision. ZSO-specific
// overrides generic; protected layers on top of public for logged-in views.
function rootsFor(kachelAccess) {
  const access = kachelAccess || 'public';
  if (access === 'public') return [ROOT_DIRS.publicGeneric, ROOT_DIRS.publicZso];
  return [
    ROOT_DIRS.publicGeneric,
    ROOT_DIRS.publicZso,
    ROOT_DIRS.protectedGeneric,
    ROOT_DIRS.protectedZso,
  ];
}

export function safeResolve(absRoot, ...parts) {
  const p = path.resolve(absRoot, ...parts);
  if (!p.startsWith(absRoot + path.sep) && p !== absRoot) throw new Error('path escape');
  return p;
}

// For a Kachel that uses `content: <slug>`, return the list of existing root
// directories where the slug appears. Order matters: later overrides earlier.
export function kachelRoots(kachel) {
  if (!kachel?.content) return [];
  return rootsFor(kachel.access)
    .map((root) => path.join(root, kachel.content))
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
}

// Resolve a path beneath a Kachel's merged view. Returns the absolute path of
// the highest-priority root that actually contains the requested entry, or
// null if none does.
export function resolveKachelPath(kachel, relPath = '') {
  const roots = kachelRoots(kachel);
  for (let i = roots.length - 1; i >= 0; i--) {
    let abs;
    try { abs = safeResolve(roots[i], relPath); } catch { continue; }
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

// Merge a directory across all Kachel roots, with priority overrides. Returns
// raw dirent-like records (no URL building yet).
function readMergedDir(kachel, relPath = '') {
  const byName = new Map();
  for (const root of kachelRoots(kachel)) {
    const dir = path.join(root, relPath);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      byName.set(e.name, {
        name: e.name,
        isDir: e.isDirectory(),
        abs: path.join(dir, e.name),
      });
    }
  }
  return [...byName.values()];
}

// Public listing: directories, .md, .pdf, .url, plus form definitions (.json).
// Images live alongside content (referenced from markdown) and aren't listed.
export function listKachelDir(kachel, relPath, urlPrefix, role) {
  const entries = readMergedDir(kachel, relPath)
    .filter((e) => {
      if (e.isDir) return true;
      const ext = path.extname(e.name).toLowerCase();
      return ext === '.md' || ext === '.pdf' || ext === '.url' || ext === '.json';
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const items = [];
  for (const e of entries) {
    const ext = path.extname(e.name).toLowerCase();
    if (e.isDir) {
      items.push({
        kind: 'dir',
        label: e.name.replace(/_/g, ' '),
        url: urlPrefix.replace(/\/$/, '') + '/' + encodeURIComponent(e.name) + '/',
      });
    } else if (ext === '.url') {
      const raw = fs.readFileSync(e.abs, 'utf8').trim();
      const iniMatch = raw.match(/^URL=(.+)$/im);
      items.push({
        kind: 'url',
        label: e.name.replace(/\.url$/i, '').replace(/_/g, ' '),
        url: iniMatch ? iniMatch[1].trim() : raw.split(/\r?\n/)[0].trim(),
        external: true,
      });
    } else if (ext === '.json') {
      const def = readFormDef(e.abs);
      if (!def) continue;
      if (def.type === 'admin-page') {
        const submitAccess = def.submitAccess || def.access || 'Admin';
        const resultsAccess = def.resultsAccess || def.access || 'Admin';
        const onlineOnly = def.onlineOnly ?? true;

        if (def.submitUrl && hasAccess(role, submitAccess)) {
          items.push({
            kind: 'form-submit',
            label: def.submitLabel || def.label || def.title || def.id,
            url: def.submitUrl,
            onlineOnly,
          });
        }
        if (def.resultsUrl && hasAccess(role, resultsAccess)) {
          items.push({
            kind: 'form-results',
            label: def.resultsLabel || def.label || `Übersicht ${def.title || def.id}`,
            url: def.resultsUrl,
            onlineOnly,
          });
        }
        if (!def.submitUrl && !def.resultsUrl && def.url && hasAccess(role, def.access || 'Admin')) {
          items.push({
            kind: def.kind || 'url',
            label: def.label || def.title || def.id,
            url: def.url,
            onlineOnly,
          });
        }
        continue;
      }
      // Submit entry
      if (hasAccess(role, submitAccessFor(def))) {
        items.push({
          kind: 'form-submit',
          label: def.submitLabel || def.title || def.id,
          url: '/forms/' + encodeURIComponent(def.id),
          onlineOnly: true,
        });
      }
      // Results entry
      if (def.resultsAccess && hasAccess(role, def.resultsAccess)) {
        items.push({
          kind: 'form-results',
          label: def.resultsLabel || `Auswertung ${def.title || def.id}`,
          url: '/forms/' + encodeURIComponent(def.id) + '/results',
        });
      }
    } else {
      const kind = ext === '.pdf' ? 'pdf' : 'md';
      items.push({
        kind,
        label: e.name.replace(/\.(md)$/i, '').replace(/_/g, ' '),
        url: urlPrefix.replace(/\/$/, '') + '/' + encodeURIComponent(e.name),
      });
    }
  }
  return items;
}

function readFormDef(absFile) {
  try {
    const def = JSON.parse(fs.readFileSync(absFile, 'utf8'));
    if (!def.id) def.id = path.basename(absFile, '.json');
    return def;
  } catch (e) {
    console.error(`form: failed to parse ${absFile}:`, e.message);
    return null;
  }
}

function submitAccessFor(def) {
  const access = def?.submitAccess || 'Soldat';
  return access === 'public' ? 'Soldat' : access;
}

export function renderMarkdown(absFile) {
  const md = fs.readFileSync(absFile, 'utf8');
  return marked.parse(md);
}

export function mimeOf(file) {
  return mime.lookup(file) || 'application/octet-stream';
}

// Walk a Kachel's public-tier roots only and emit /k/<id>/... URLs suitable
// for service-worker precaching. Form JSONs and external .url files are
// excluded.
export function listKachelPublicAssets(kachel) {
  if (!kachel?.id || !kachel?.content) return [];
  if ((kachel.access || 'public') !== 'public') return [];
  const urls = new Set();
  const base = `/k/${kachel.id}`;
  urls.add(base);
  const walk = (rootDir) => {
    if (!fs.existsSync(rootDir)) return;
    const stack = [{ abs: rootDir, rel: '' }];
    while (stack.length) {
      const { abs, rel } = stack.pop();
      urls.add(base + (rel ? '/' + rel : '') + '/');
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const ext = path.extname(e.name).toLowerCase();
        const childRel = rel ? rel + '/' + encodeURIComponent(e.name) : encodeURIComponent(e.name);
        if (e.isDirectory()) {
          stack.push({ abs: path.join(abs, e.name), rel: childRel });
        } else if (ext === '.url' || ext === '.json') {
          // external link or form definition — not a cacheable asset
        } else {
          urls.add(base + '/' + childRel);
        }
      }
    }
  };
  for (const root of [ROOT_DIRS.publicGeneric, ROOT_DIRS.publicZso]) {
    walk(path.join(root, kachel.content));
  }
  return [...urls];
}

// Used by layout.js to discover form definitions across all content roots.
// Names that appear more than once among a form's named elements. Duplicate
// `name`s collide on submit/store, so we flag them for a warning in the UI.
function duplicateFieldNames(def) {
  const seen = new Set();
  const dups = new Set();
  for (const f of def?.fields || []) {
    if (!f?.name) continue;
    if (seen.has(f.name)) dups.add(f.name);
    else seen.add(f.name);
  }
  return [...dups];
}

export function scanForms() {
  const forms = {};
  // `slug` is the top-level content folder a form lives in (e.g. "wk_organisation"),
  // which maps back to its Kachel via layout `content:`.
  const walk = (abs, slug) => {
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const child = path.join(abs, e.name);
      if (e.isDirectory()) walk(child, slug || e.name);
      else if (e.name.toLowerCase().endsWith('.json')) {
        const def = readFormDef(child);
        if (def?.type === 'admin-page') continue;
        if (def?.id) {
          def._slug = slug || null;
          def._dupNames = duplicateFieldNames(def);
          if (def._dupNames.length) {
            console.warn(`form '${def.id}': doppelte Feldnamen: ${def._dupNames.join(', ')}`);
          }
          forms[def.id] = def;
        }
      }
    }
  };
  for (const root of Object.values(ROOT_DIRS)) walk(root, '');
  return forms;
}
