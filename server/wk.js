import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const WK_DIR = path.resolve('data/wk');
const DAY_KEYS = ['mo', 'di', 'mi', 'do', 'fr'];
const DAY_LABELS = { mo: 'Mo', di: 'Di', mi: 'Mi', do: 'Do', fr: 'Fr' };

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
  const base = slug(`wk-${nummer}-${name}`);
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

function summary(wk) {
  return {
    id: wk.id,
    nummer: wk.nummer || '',
    name: wk.name || wk.title || wk.id,
    datum: wk.eckdaten?.datum || wk.zeitraum?.von || '',
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
  const nummer = String(input.nummer || '').trim();
  const name = String(input.name || '').trim();
  if (!nummer) throw new Error('Nummer ist erforderlich.');
  if (!name) throw new Error('Name ist erforderlich.');

  const id = uniqueId(nummer, name);
  const wk = {
    id,
    nummer,
    name,
    platzhalter: String(input.platzhalter || 'Platzhalter — bitte vor Beginn des WK durch Kdo aktualisieren.').trim(),
    eckdaten: {
      datum: String(input.datum || 'TBD').trim(),
      ort: String(input.ort || 'TBD').trim(),
      tenue: String(input.tenue || 'TBD').trim(),
    },
    tagesablauf: DAY_KEYS.map((key) => ({
      tag: DAY_LABELS[key],
      aktivitaet: String(input[`tag_${key}`] || '').trim(),
    })).filter((row) => row.aktivitaet),
    ausruestung: splitLines(input.ausruestung || [
      'Persönliche Waffe & Munition gemäss Marschbefehl',
      'Identitätskarte / Dienstbüchlein',
      'Tenue gemäss Befehl',
      'Hygieneartikel, Schreibzeug',
    ].join('\n')),
    kontakt: {
      kdoWk: String(input.kdoWk || 'TBD').trim(),
      verpflegungLogistik: String(input.verpflegungLogistik || 'TBD').trim(),
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
