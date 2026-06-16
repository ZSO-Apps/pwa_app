import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import mime from 'mime-types';

marked.setOptions({ gfm: true, breaks: false });

const ROOT = path.resolve('.');

// Resolve a content path safely, keeping it inside the project dir.
export function safeResolve(...parts) {
  const p = path.resolve(ROOT, ...parts);
  if (!p.startsWith(ROOT + path.sep) && p !== ROOT) throw new Error('path escape');
  return p;
}

export function listDir(absDir, urlPrefix) {
  // Listings only show navigable documents (folders, markdown, PDFs).
  // Images live alongside but are embedded inside markdown, not listed.
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .filter((e) => {
      if (e.isDirectory()) return true;
      const ext = path.extname(e.name).toLowerCase();
      return ext === '.md' || ext === '.pdf' || ext === '.url';
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return entries.map((e) => {
    const ext = path.extname(e.name).toLowerCase();
    const label = e.name.replace(/\.(md|url)$/i, '').replace(/_/g, ' ');
    let kind = 'file';
    let url = urlPrefix.replace(/\/$/, '') + '/' + encodeURIComponent(e.name) + (e.isDirectory() ? '/' : '');
    let external = false;
    if (e.isDirectory()) kind = 'dir';
    else if (ext === '.md') kind = 'md';
    else if (ext === '.pdf') kind = 'pdf';
    else if (ext === '.url') {
      kind = 'url';
      external = true;
      const raw = fs.readFileSync(path.join(absDir, e.name), 'utf8').trim();
      // Support both plain "https://..." files and Windows .url INI format
      const iniMatch = raw.match(/^URL=(.+)$/im);
      url = iniMatch ? iniMatch[1].trim() : raw.split(/\r?\n/)[0].trim();
    }
    return { name: e.name, label, url, kind, external };
  });
}

export function renderMarkdown(absFile) {
  const md = fs.readFileSync(absFile, 'utf8');
  return marked.parse(md);
}

export function mimeOf(file) {
  return mime.lookup(file) || 'application/octet-stream';
}

function listTreeAssets(contentDir, urlBase, { includeRootPage = false } = {}) {
  const urls = [];
  const rootUrl = urlBase.replace(/\/$/, '');
  if (includeRootPage) urls.push(rootUrl);

  const walk = (abs, urlBase) => {
    if (!fs.existsSync(abs)) return;
    urls.push(urlBase.replace(/\/$/, '') + '/'); // directory index
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const childAbs = path.join(abs, e.name);
      const childUrl = urlBase.replace(/\/$/, '') + '/' + encodeURIComponent(e.name);
      if (e.isDirectory()) walk(childAbs, childUrl + '/');
      else if (path.extname(e.name).toLowerCase() === '.url') continue; // external link, not a file to cache
      else urls.push(childUrl);
    }
  };
  walk(contentDir, urlBase);
  return urls;
}

// Recursively walk content dir to build precache list. Only public stuff lives here.
export function listPublicAssets(contentDir = path.resolve('content')) {
  return listTreeAssets(contentDir, '/content/')
    .filter((url) => url !== '/content/');
}

export function listKachelAssets(kachel) {
  if (!kachel?.id || !kachel?.content) return [];
  return listTreeAssets(path.resolve(kachel.content), `/k/${kachel.id}/`, {
    includeRootPage: true,
  });
}
