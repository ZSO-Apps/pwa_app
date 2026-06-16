import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const WK_DIR = path.resolve('data/wk');

function ensureDir() {
  fs.mkdirSync(WK_DIR, { recursive: true });
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'wk';
}

function assertSafeId(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id || '')) {
    throw new Error('ungueltige-wk-id');
  }
}

function wkPath(id) {
  assertSafeId(id);
  return path.join(WK_DIR, `${id}.yaml`);
}

function uniqueId(nummer, name) {
  const base = slug(['wk', nummer, name].filter(Boolean).join('-'));
  let candidate = base;
  let index = 2;
  while (fs.existsSync(wkPath(candidate))) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readYaml(filePath) {
  const parsed = YAML.parse(fs.readFileSync(filePath, 'utf8')) || {};
  if (!parsed.id) parsed.id = path.basename(filePath, '.yaml');
  return parsed;
}

function dateRange(wk) {
  const von = wk.eckdaten?.datumVon || wk.eckdaten?.von || wk.zeitraum?.von || '';
  const bis = wk.eckdaten?.datumBis || wk.eckdaten?.bis || wk.zeitraum?.bis || '';
  if (von && bis && von !== bis) return `${von} - ${bis}`;
  return von || bis || wk.eckdaten?.datum || '';
}

function summary(wk) {
  return {
    id: wk.id,
    nummer: wk.nummer || '',
    name: wk.name || wk.title || wk.id,
    datum: dateRange(wk),
    ort: wk.eckdaten?.ort || wk.ort || '',
    tenue: wk.eckdaten?.tenue || '',
    appellStatus: wk.appell?.status || 'nicht bereit',
  };
}

export function listWks() {
  ensureDir();
  return fs.readdirSync(WK_DIR)
    .filter((name) => name.endsWith('.yaml') && !name.endsWith('.example.yaml'))
    .map((name) => {
      try {
        return summary(readYaml(path.join(WK_DIR, name)));
      } catch (error) {
        console.error(`wk: failed to parse ${name}:`, error.message);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (
      String(b.datum).localeCompare(String(a.datum), 'de')
      || String(a.nummer).localeCompare(String(b.nummer), 'de')
      || String(a.name).localeCompare(String(b.name), 'de')
    ));
}

export function getWk(id) {
  ensureDir();
  const filePath = wkPath(id);
  if (!fs.existsSync(filePath)) return null;
  return readYaml(filePath);
}

export function createWk(input, user) {
  ensureDir();
  const name = String(input.name || '').trim();
  const nummer = String(input.nummer || '').trim();
  if (!name) throw new Error('Name ist erforderlich.');

  const id = uniqueId(nummer, name);
  const wk = {
    id,
    name,
    nummer,
    beschreibung: String(input.beschreibung || '').trim(),
    eckdaten: {
      datumVon: String(input.datumVon || '').trim(),
      datumBis: String(input.datumBis || '').trim(),
      ort: String(input.ort || '').trim(),
      tenue: String(input.tenue || '').trim(),
    },
    ausruestung: splitLines(input.ausruestung),
    kontakt: {
      kdoWk: String(input.kdoWk || '').trim(),
      verpflegungLogistik: String(input.verpflegungLogistik || '').trim(),
    },
    kader: [],
    mannschaft: [],
    appell: {
      status: 'nicht bereit',
      durchgefuehrtAm: null,
      durchgefuehrtVon: null,
      eintraege: [],
    },
    meta: {
      erstelltAm: new Date().toISOString(),
      erstelltVon: user?.username || null,
    },
  };

  fs.writeFileSync(wkPath(id), YAML.stringify(wk));
  return wk;
}
