import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { hasAccess } from './auth.js';

const LAYOUT_FILE = path.resolve('layout.yaml');
const FORMS_DIR = path.resolve('forms');

let _layout = null;
let _forms = null;

export function loadForms() {
  const map = {};
  if (!fs.existsSync(FORMS_DIR)) return map;
  for (const f of fs.readdirSync(FORMS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const def = JSON.parse(fs.readFileSync(path.join(FORMS_DIR, f), 'utf8'));
      if (!def.id) def.id = f.replace(/\.json$/, '');
      map[def.id] = def;
    } catch (e) {
      console.error(`forms: failed to parse ${f}:`, e.message);
    }
  }
  return map;
}

export function loadLayout() {
  const raw = fs.readFileSync(LAYOUT_FILE, 'utf8');
  const parsed = YAML.parse(raw);
  const kacheln = parsed?.kacheln || [];
  const forms = loadForms();

  // attach form children to host kacheln
  const byId = Object.fromEntries(kacheln.map((k) => [k.id, k]));
  for (const def of Object.values(forms)) {
    if (def.submitKachel && byId[def.submitKachel]) {
      const host = byId[def.submitKachel];
      host.children = host.children || [];
      host.children.push({
        id: `form-${def.id}`,
        title: def.submitLabel || `Formular ${def.title || def.id}`,
        access: def.submitAccess || 'public',
        form: def.id,
        color: host.color,
      });
    }
    if (def.resultsKachel && def.resultsAccess && byId[def.resultsKachel]) {
      const host = byId[def.resultsKachel];
      host.children = host.children || [];
      host.children.push({
        id: `results-${def.id}`,
        title: def.resultsLabel || `Auswertung ${def.title || def.id}`,
        access: def.resultsAccess,
        formResults: def.id,
        color: host.color,
      });
    }
  }

  _layout = { kacheln };
  _forms = forms;
  return { layout: _layout, forms: _forms };
}

export function getLayout() { if (!_layout) loadLayout(); return _layout; }
export function getForms() { if (!_forms) loadLayout(); return _forms; }
export function getForm(id) { return getForms()[id] || null; }

export function findKachel(id) {
  const layout = getLayout();
  const walk = (list) => {
    for (const k of list) {
      if (k.id === id) return k;
      if (k.children) { const r = walk(k.children); if (r) return r; }
    }
    return null;
  };
  return walk(layout.kacheln);
}

export function visibleKacheln(role) {
  const filter = (list) =>
    list
      .filter((k) => hasAccess(role, k.access || 'public'))
      .map((k) => ({ ...k, children: k.children ? filter(k.children) : undefined }));
  return filter(getLayout().kacheln);
}
