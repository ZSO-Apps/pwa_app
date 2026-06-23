import fs from 'node:fs';
import path from 'node:path';

// Per-organization configuration.
//
// The app is multi-tenant by way of a single symlink: each organization lives
// in ZSO/<Org>/ (logos + public content/Handkarten/documents). At startup we
// point the fixed path `content_zso_specific_public` at the chosen org folder,
// so all existing references (server/branding.js, /logos, the zso_public
// content root) resolve to that org without any further path plumbing.
//
// Select the org via `node server/index.js <Org>` / `npm start -- <Org>` or the
// ORG environment variable. Defaults to "Generic".

const ORG_PARENT = path.resolve('ZSO');
const PUBLIC_LINK = path.resolve('content_zso_specific_public');
const DEFAULT_ORG = 'Generic';

let activeOrg = DEFAULT_ORG;

export function getOrg() {
  return activeOrg;
}

function resolveOrgName() {
  const arg = process.argv[2];
  const fromArg = arg && !arg.startsWith('-') ? arg : null;
  return (fromArg || process.env.ORG || DEFAULT_ORG).trim();
}

function listOrgs() {
  try {
    return fs.readdirSync(ORG_PARENT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

// Create/refresh the content_zso_specific_public -> ZSO/<Org> symlink. Returns
// the resolved org name. Throws with an actionable message on bad input or when
// a real directory blocks the symlink path.
export function setupOrg() {
  const org = resolveOrgName();

  if (org.includes('/') || org.includes('\\') || org.includes('..') || !org) {
    throw new Error(`Invalid org name "${org}".`);
  }

  const orgDir = path.join(ORG_PARENT, org);
  if (!fs.existsSync(orgDir) || !fs.statSync(orgDir).isDirectory()) {
    const available = listOrgs();
    throw new Error(
      `Organization folder ZSO/${org} not found.\n` +
      (available.length
        ? `Available organizations: ${available.join(', ')}`
        : `No organizations exist yet under ZSO/.`),
    );
  }

  // Relative target so the symlink stays valid if the repo is moved.
  const target = path.relative(path.dirname(PUBLIC_LINK), orgDir);

  let stat = null;
  try { stat = fs.lstatSync(PUBLIC_LINK); } catch { /* missing */ }

  if (stat) {
    if (stat.isSymbolicLink()) {
      if (fs.readlinkSync(PUBLIC_LINK) === target) {
        activeOrg = org;
        return org; // already correct
      }
      fs.unlinkSync(PUBLIC_LINK);
    } else {
      throw new Error(
        `${PUBLIC_LINK} is a real directory, not a symlink. ` +
        `Remove it once (its tracked defaults now live under ZSO/Generic/), ` +
        `then restart so the per-org symlink can be created.`,
      );
    }
  }

  fs.symlinkSync(target, PUBLIC_LINK);
  activeOrg = org;
  return org;
}
