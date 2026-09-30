import fs from 'node:fs';
import path from 'node:path';

// Shared storage helpers for revised form/quiz *definitions*. Submissions are
// versioned in server/forms.js; here we only deal with the version JSONs that
// live in a hidden `<family>.versions/` folder next to the base definition.

const ZSO_CONTENT_ROOT = path.resolve('content_zso_specific');

// content_zso_specific/<slug>/<family>.versions — hidden folder holding a
// family's revised version definitions (the base def stays where it is).
export function versionsDir(slug, family) {
  return path.join(ZSO_CONTENT_ROOT, slug, family + '.versions');
}

// content_zso_specific/<slug> — where a version's image assets are written
// (as `<versionId>.content/`), so `/k/<kachelId>/<versionId>.content/<file>`
// resolves like any other Kachel asset.
export function versionAssetRoot(slug) {
  return path.join(ZSO_CONTENT_ROOT, slug);
}

function pad(n) { return String(n).padStart(2, '0'); }

// New version id `<family>_YYYYMMDD_HHMM_<n>`; `<n>` disambiguates same-minute
// edits. Also the on-disk submission subfolder name for that version.
export function nextVersionId(slug, family) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const base = `${family}_${stamp}`;
  const dir = versionsDir(slug, family);
  let n = 1;
  while (fs.existsSync(path.join(dir, `${base}_${n}.json`))) n++;
  return `${base}_${n}`;
}

// Write a revised version definition, stamping the `version` block. `definition`
// should already carry the version id as `id`.
export function writeVersionDefinition(slug, family, versionId, definition, createdBy) {
  const dir = versionsDir(slug, family);
  fs.mkdirSync(dir, { recursive: true });
  const out = {
    ...definition,
    id: versionId,
    version: { family, createdAt: new Date().toISOString(), createdBy: createdBy || null },
  };
  fs.writeFileSync(path.join(dir, versionId + '.json'), JSON.stringify(out, null, 2) + '\n');
  return out;
}
