import fs from 'node:fs';
import path from 'node:path';

const LOGOS_DIR = path.resolve('content_zso_specific_public/logos');
const FALLBACK_LOGO = 'zivilschutz_logo.jpg';

const LOGO_ORDER = {
  header: [
    'org_logo_wide_transparent.png',
    'org_logo_wide.png',
    'org_logo_square_transparent.png',
    'org_logo_square.png',
  ],
  print: [
    'org_logo_wide.png',
    'org_logo_square.png',
  ],
  favicon: [
    'org_logo_square_transparent.png',
    'org_logo_square.png',
  ],
};

const ALL_LOGOS = [
  'org_logo_wide.png',
  'org_logo_wide_transparent.png',
  'org_logo_square.png',
  'org_logo_square_transparent.png',
  FALLBACK_LOGO,
];

function logoPath(filename) {
  return path.join(LOGOS_DIR, filename);
}

function logoUrl(filename) {
  return '/logos/' + encodeURIComponent(filename);
}

function exists(filename) {
  return fs.existsSync(logoPath(filename));
}

export function resolveLogo(kind) {
  const order = LOGO_ORDER[kind] || [];
  const filename = [...order, FALLBACK_LOGO].find(exists);
  if (!filename) return null;
  return {
    filename,
    path: logoPath(filename),
    url: logoUrl(filename),
  };
}

export function logoFileForUrl(urlPath) {
  const filename = decodeURIComponent(path.basename(urlPath || ''));
  if (!ALL_LOGOS.includes(filename)) return null;
  return logoPath(filename);
}

export function existingLogoUrls() {
  return ALL_LOGOS
    .filter(exists)
    .map(logoUrl);
}
