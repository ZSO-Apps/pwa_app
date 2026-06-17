import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { hasAccess } from './auth.js';
import { scanForms } from './content.js';

const LAYOUT_FILE = path.resolve('layout.yaml');

let _layout = null;
let _forms = null;

export function loadLayout() {
  const raw = fs.readFileSync(LAYOUT_FILE, 'utf8');
  const parsed = YAML.parse(raw);
  _layout = { kacheln: parsed?.kacheln || [] };
  _forms = scanForms();
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

// Find the Kachel that owns a content slug (used to send form pages "back" to
// the Kachel they were opened from).
export function findKachelBySlug(slug) {
  if (!slug) return null;
  const walk = (list) => {
    for (const k of list) {
      if (k.content === slug) return k;
      if (k.children) { const r = walk(k.children); if (r) return r; }
    }
    return null;
  };
  return walk(getLayout().kacheln);
}

export function visibleKacheln(role) {
  const filter = (list) =>
    list
      .filter((k) => hasAccess(role, k.access || 'public'))
      .map((k) => ({ ...k, children: k.children ? filter(k.children) : undefined }));
  return filter(getLayout().kacheln);
}
