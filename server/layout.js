import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { hasAccess } from './auth.js';
import { scanForms } from './content.js';

const LAYOUT_FILE = path.resolve('layout.yaml');
const TILE_COLORS = ['#f28c00', '#005a9c'];
const UTILITY_TILE_COLOR = '#d9dde3';
const UTILITY_TILE_IDS = new Set(['appell', 'transportzentrale', 'admin']);

let _layout = null;
let _forms = null;
let _formVersions = null;

export function loadLayout() {
  const raw = fs.readFileSync(LAYOUT_FILE, 'utf8');
  const parsed = YAML.parse(raw);
  _layout = { kacheln: parsed?.kacheln || [] };
  const scanned = scanForms();
  _forms = scanned.forms;
  _formVersions = scanned.versions;
  return { layout: _layout, forms: _forms };
}

export function getLayout() { if (!_layout) loadLayout(); return _layout; }
// Family base defs keyed by id (each carries `_versions[]`). This is the map
// iterated for tiles/precache/transport — it never contains revised versions.
export function getForms() { if (!_forms) loadLayout(); return _forms; }
export function getFormVersionsMap() { if (!_formVersions) loadLayout(); return _formVersions; }
// Resolve either a family id or a revised version id to its definition.
export function getForm(id) { return getForms()[id] || getFormVersionsMap()[id] || null; }
export function getFormVersion(id) { return getFormVersionsMap()[id] || null; }
// The version chain for a family (base first). Falls back to [base] / [].
export function getFormVersions(family) {
  const def = getForms()[family];
  return def?._versions || (def ? [def] : []);
}

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

function sortAndColorKacheln(list) {
  const sorted = [...list].sort((a, b) => {
    const aUtility = UTILITY_TILE_IDS.has(a.id) ? 1 : 0;
    const bUtility = UTILITY_TILE_IDS.has(b.id) ? 1 : 0;
    return aUtility - bUtility;
  });
  let contentIndex = 0;
  return sorted.map((kachel) => {
    const utility = UTILITY_TILE_IDS.has(kachel.id);
    const color = utility ? UTILITY_TILE_COLOR : TILE_COLORS[contentIndex++ % TILE_COLORS.length];
    return { ...kachel, color, utilityTile: utility };
  });
}

export function visibleKacheln(role) {
  const filter = (list) =>
    list
      .filter((k) => hasAccess(role, k.access || 'public'))
      .map((k) => ({ ...k, children: k.children ? sortAndColorKacheln(filter(k.children)) : undefined }));
  return sortAndColorKacheln(filter(getLayout().kacheln));
}
