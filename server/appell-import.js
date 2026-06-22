// Parser for the funky "Appellliste.xlsx" export.
//
// The spreadsheet is built as a printable form: there are no presence values in
// the cells. Instead each person/day cell carries an embedded PNG — a visible
// grey box means "aufgeboten" (called up that day, the cross goes here), a fully
// transparent PNG means "not aufgeboten". We unzip the xlsx, read the worksheet
// + shared strings for the textual columns, and the drawing layer to find which
// day cells carry a *visible* image. The discriminator is the mean alpha of the
// referenced PNG (transparent placeholder -> ~0, grey box -> clearly > 0).

import zlib from 'node:zlib';
import { unzipSync, strFromU8 } from 'fflate';

const SV_RE = /^\d{3}\.\d{4}\.\d{4}\.\d{2}$/; // Soz.-Vers.-Nr., the natural person key
const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{2})$/; // day header like 17.06.26

function columnToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function dayHeaderToIso(value) {
  const m = DATE_RE.exec(String(value || '').trim());
  if (!m) return null;
  const [, dd, mm, yy] = m;
  return `20${yy}-${mm}-${dd}`;
}

// --- shared strings -------------------------------------------------------

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]));
    out.push(texts.join(''));
  }
  return out;
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

// --- worksheet ------------------------------------------------------------

// Returns Map<rowNumber(1-based), Map<colIndex(0-based), string>>.
function parseSheet(xml, strings) {
  const rows = new Map();
  const rowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = new Map();
    const cellRe = /<c r="([A-Z]+)\d+"(?:[^>]*t="(\w+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is>([\s\S]*?)<\/is>)?<\/c>/g;
    let cm;
    while ((cm = cellRe.exec(rm[2]))) {
      const col = columnToIndex(cm[1]);
      const type = cm[2];
      let value;
      if (cm[4] != null) {
        value = [...cm[4].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join('');
      } else if (cm[3] != null) {
        value = type === 's' ? strings[parseInt(cm[3], 10)] : decodeXml(cm[3]);
      } else continue;
      cells.set(col, value);
    }
    rows.set(parseInt(rm[1], 10), cells);
  }
  return rows;
}

// --- drawing / image marks ------------------------------------------------

// Minimal PNG mean-alpha reader (8-bit, colour type 6 / RGBA, no interlace —
// which is what these export placeholders use). Returns 255 (assume visible) if
// the format is anything else, so an unknown image counts as a mark rather than
// being silently dropped.
function meanAlpha(bytes) {
  if (!bytes || bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return 255;
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  const dv = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= dv.length) {
    const len = dv.readUInt32BE(off);
    const type = dv.toString('latin1', off + 4, off + 8);
    const data = dv.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (colorType !== 6 || bitDepth !== 8 || !width || !height) return 255;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return 255; }
  const bpp = 4;
  const stride = width * bpp;
  const prev = Buffer.alloc(stride);
  let pos = 0;
  let sumAlpha = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const ft = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      if (ft === 1) line[i] = (line[i] + a) & 255;
      else if (ft === 2) line[i] = (line[i] + b) & 255;
      else if (ft === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (ft === 4) line[i] = (line[i] + paeth(a, b, c)) & 255;
    }
    for (let i = 3; i < stride; i += bpp) sumAlpha += line[i];
    line.copy(prev);
  }
  return sumAlpha / (width * height);
}

// Returns Set of "rowIndex,colIndex" (both 0-based, drawing coordinates) where a
// *visible* image is anchored — i.e. an "aufgeboten" mark.
function parseMarks(drawingXml, relsXml, files) {
  if (!drawingXml) return new Set();
  const rels = new Map();
  for (const m of (relsXml || '').matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) {
    rels.set(m[1], m[2].replace(/^\.\.\//, 'xl/').replace(/^xl\/xl\//, 'xl/'));
  }
  const alphaCache = new Map();
  const alphaFor = (rid) => {
    if (alphaCache.has(rid)) return alphaCache.get(rid);
    const target = rels.get(rid);
    const bytes = target ? files[target] || files['xl/' + target.replace(/^xl\//, '')] : null;
    const a = bytes ? meanAlpha(bytes) : 0;
    alphaCache.set(rid, a);
    return a;
  };
  const marks = new Set();
  const anchorRe = /<xdr:twoCellAnchor[\s\S]*?<\/xdr:twoCellAnchor>/g;
  let am;
  while ((am = anchorRe.exec(drawingXml))) {
    const a = am[0];
    const from = /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(a);
    const embed = /r:embed="(rId\d+)"/.exec(a);
    if (!from || !embed) continue;
    if (alphaFor(embed[1]) > 10) marks.add(`${parseInt(from[2], 10)},${parseInt(from[1], 10)}`);
  }
  return marks;
}

// --- header column mapping ------------------------------------------------

// The textual columns are not at fixed indices: depending on label lengths the
// export merges cells differently (e.g. Brugg merges H:I, shifting Grad/Bereich/
// JG/Funktion to the right vs. Baden). So we locate each column by its header
// label instead of hardcoding an index. The two header rows ("Name/Vorname…"
// and "PLZ/Ort…") feed the two data rows of each person block. Falls back to the
// historical fixed indices when a label is missing.
function findColumns(rows) {
  const cols = {
    name: 0, sv: 5, beruf: 7, grad: 8, bereich: 9, // person row 1
    plz: 0, ort: 1, einrueckort: 7, jg: 8, funktion: 9, // person row 2
  };
  const byLabel = {
    'Name/Vorname': 'name',
    'Soz.-Vers.-Nr.': 'sv',
    Beruf: 'beruf',
    Grad: 'grad',
    Bereich: 'bereich',
    'PLZ/Ort': 'plz',
    'Einrückort Kurs': 'einrueckort',
    JG: 'jg',
    Funktion: 'funktion',
  };
  for (const [, cells] of rows) {
    for (const [col, value] of cells) {
      const key = byLabel[String(value || '').trim()];
      if (key) cols[key] = col;
    }
  }
  return cols;
}

// --- contact parsing ------------------------------------------------------

function parseContact(raw) {
  const text = String(raw || '');
  const out = { email: '', mobile: '', raw: text };
  const grab = (label) => {
    const re = new RegExp(label + '\\s*([^,]*)');
    const m = re.exec(text);
    return m ? m[1].trim() : '';
  };
  out.email = grab('E-Mail P');
  out.mobile = grab('Mobile P') || grab('Mobile G') || grab('Tel\\. P') || grab('Tel\\. G');
  return out;
}

// --- public API -----------------------------------------------------------

export function parseAppellXlsx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const files = unzipSync(bytes);
  const str = (name) => (files[name] ? strFromU8(files[name]) : '');

  const strings = parseSharedStrings(str('xl/sharedStrings.xml'));

  const sheetName = Object.keys(files).find((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
  if (!sheetName) throw new Error('Kein Arbeitsblatt in der Datei gefunden.');
  const rows = parseSheet(str(sheetName), strings);

  // Resolve the worksheet's drawing via its rels (fallback: first drawing).
  const sheetBase = sheetName.split('/').pop();
  const sheetRels = str(`xl/worksheets/_rels/${sheetBase}.rels`);
  let drawingName = Object.keys(files).find((f) => /^xl\/drawings\/drawing\d+\.xml$/.test(f));
  const drawRelTarget = /Target="([^"]*drawings\/drawing\d+\.xml)"/.exec(sheetRels);
  if (drawRelTarget) drawingName = 'xl/' + drawRelTarget[1].replace(/^\.\.\//, '');
  const drawingBase = drawingName ? drawingName.split('/').pop() : '';
  const drawingRels = drawingBase ? str(`xl/drawings/_rels/${drawingBase}.rels`) : '';
  const marks = parseMarks(drawingName ? str(drawingName) : '', drawingRels, files);

  // Day columns: header cells that look like a date (dd.mm.yy).
  const dayCols = [];
  for (const [, cells] of rows) {
    for (const [col, value] of cells) {
      const iso = dayHeaderToIso(value);
      if (iso && !dayCols.some((d) => d.col === col)) dayCols.push({ col, iso });
    }
  }
  dayCols.sort((a, b) => a.col - b.col);
  const days = dayCols.map((d) => d.iso);

  // Column indices vary between exports (merged cells shift them); resolve them
  // from the header labels rather than hardcoding.
  const col = findColumns(rows);

  // People: a block starts on the row whose Soz.-Vers.-Nr. column holds an SV nr.
  const persons = [];
  const rowNums = [...rows.keys()].sort((a, b) => a - b);
  for (const rowNum of rowNums) {
    const cells = rows.get(rowNum);
    const sv = cells.get(col.sv);
    if (!sv || !SV_RE.test(String(sv).trim())) continue;
    const next = rows.get(rowNum + 1) || new Map();
    const third = rows.get(rowNum + 2) || new Map();
    const contact = parseContact(third.get(0));
    // Marks are anchored on the name row; drawing rows are 0-based.
    const markRow = rowNum - 1;
    const aufgeboten = dayCols
      .filter((d) => marks.has(`${markRow},${d.col}`))
      .map((d) => d.iso);
    persons.push({
      sv: String(sv).trim(),
      name: String(cells.get(col.name) || '').trim(),
      grad: String(cells.get(col.grad) || '').trim(),
      bereich: String(cells.get(col.bereich) || '').trim(),
      beruf: String(cells.get(col.beruf) || '').trim(),
      plz: String(next.get(col.plz) || '').trim(),
      ort: String(next.get(col.ort) || '').trim(),
      einrueckort: String(next.get(col.einrueckort) || '').trim(),
      jg: String(next.get(col.jg) || '').trim(),
      funktion: String(next.get(col.funktion) || '').trim(),
      email: contact.email,
      mobile: contact.mobile,
      kontakt: contact.raw,
      aufgeboten,
    });
  }

  return { days, persons };
}
