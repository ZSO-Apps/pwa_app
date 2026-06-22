import fs from 'node:fs';
import path from 'node:path';
import { visibleKacheln } from './layout.js';
import { effectiveKachel, kachelRoots, safeResolve } from './content.js';

const SEARCHABLE_EXTENSIONS = new Set(['.md', '.pdf', '.url']);
const MAX_RESULTS = 40;

function flattenKacheln(list) {
  const out = [];
  for (const kachel of list || []) {
    out.push(kachel);
    if (kachel.children?.length) out.push(...flattenKacheln(kachel.children));
  }
  return out;
}

function normalize(value) {
  return String(value || '').toLocaleLowerCase('de-CH');
}

function titleFromRel(rel) {
  return path.basename(rel, path.extname(rel)).replace(/[_-]+/g, ' ').trim();
}

function cleanSnippet(value) {
  return String(value || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/[#*_`>![\](){}|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippetFrom(value, query) {
  const cleaned = cleanSnippet(value);
  if (!cleaned) return '';
  const lower = normalize(cleaned);
  const idx = lower.indexOf(normalize(query));
  if (idx < 0) return cleaned.slice(0, 180);
  const start = Math.max(0, idx - 70);
  const end = Math.min(cleaned.length, idx + query.length + 110);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < cleaned.length ? '…' : '';
  return prefix + cleaned.slice(start, end) + suffix;
}

function encodedRelPath(rel) {
  return rel.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function readUrlFile(abs) {
  try {
    const raw = fs.readFileSync(abs, 'utf8').trim();
    const iniMatch = raw.match(/^URL=(.+)$/im);
    return (iniMatch ? iniMatch[1] : raw.split(/\r?\n/)[0] || '').trim();
  } catch {
    return '';
  }
}

function isHiddenContentDirName(name) {
  return String(name || '').toLowerCase().endsWith('.content');
}

function collectDocs(kachel) {
  const docs = new Map();
  for (const root of kachelRoots(kachel)) {
    const stack = [{ abs: root, rel: '' }];
    while (stack.length) {
      const { abs, rel } = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || isHiddenContentDirName(entry.name)) continue;
        const childRel = rel ? rel + '/' + entry.name : entry.name;
        let childAbs;
        try {
          childAbs = safeResolve(root, childRel);
        } catch {
          continue;
        }
        if (entry.isDirectory()) {
          stack.push({ abs: childAbs, rel: childRel });
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (!SEARCHABLE_EXTENSIONS.has(ext)) continue;
        // Later roots override earlier roots with the same relative path.
        docs.set(childRel, { abs: childAbs, ext });
      }
    }
  }
  return [...docs.entries()].map(([rel, doc]) => ({ rel, ...doc }));
}

function buildResult(kachel, doc, query) {
  const title = titleFromRel(doc.rel);
  const kachelTitle = kachel.title || kachel.id;
  const relLabel = doc.rel.split('/').map((part) => titleFromRel(part) || part).join(' / ');
  let url = '/k/' + encodeURIComponent(kachel.id) + '/' + encodedRelPath(doc.rel);
  let kind = 'Dokument';
  let text = '';

  if (doc.ext === '.md') {
    kind = 'Markdown';
    try {
      text = fs.readFileSync(doc.abs, 'utf8');
    } catch {
      text = '';
    }
  } else if (doc.ext === '.pdf') {
    kind = 'PDF';
    text = 'PDF-Dokument';
  } else if (doc.ext === '.url') {
    kind = 'Link';
    url = readUrlFile(doc.abs);
    text = url;
  }

  const haystack = normalize([title, relLabel, kachelTitle, text].join(' '));
  if (!haystack.includes(normalize(query))) return null;

  return {
    title,
    kachelTitle,
    kind,
    url,
    external: doc.ext === '.url',
    snippet: snippetFrom(text || relLabel, query),
  };
}

export function searchContent(req, rawQuery) {
  const query = String(rawQuery || '').trim();
  if (query.length < 2) return { query, results: [] };

  const role = req.user?.role || 'public';
  const results = [];
  const kacheln = flattenKacheln(visibleKacheln(role)).filter((kachel) => kachel?.content);

  for (const visibleKachel of kacheln) {
    const effective = effectiveKachel(visibleKachel, req.activeWk);
    if (!effective?.content) continue;

    for (const doc of collectDocs(effective)) {
      const result = buildResult(visibleKachel, doc, query);
      if (!result) continue;
      results.push(result);
      if (results.length >= MAX_RESULTS) return { query, results };
    }
  }

  return { query, results };
}
