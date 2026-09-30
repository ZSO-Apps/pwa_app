// Server-side static map snapshot generator (pure JS, no native deps).
//
// Given a pin { lat, lon, zoom } it fetches the covering Swisstopo WMTS tiles
// (ch.swisstopo.pixelkarte-farbe, Web-Mercator/3857), stitches them into an
// ~768×512 RGBA raster centred on the pin, draws a visible marker on top and
// writes the result as a PNG. Used to embed a map image in submission detail /
// print views without requiring a live map at view time.

import fs from 'node:fs';
import https from 'node:https';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const TILE = 256;
const OUT_W = 768;   // 3 tiles
const OUT_H = 512;   // 2 tiles
const TILE_BASE = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857';
const FETCH_TIMEOUT = 10000;

function clampZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return 16;
  return Math.max(7, Math.min(18, Math.round(n)));
}

// Global pixel coordinates (at the given zoom) of a WGS84 lat/lon.
function project(lat, lon, zoom) {
  const n = Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * n * TILE;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE;
  return { x, y, n };
}

// Fetch a single JPEG tile as a Buffer (portable across Node 16/18+: uses
// node:https rather than the not-always-present global fetch).
function fetchBuffer(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'ZSO-App map-snapshot' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    });
    req.setTimeout(FETCH_TIMEOUT, () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

async function fetchTile(z, x, y) {
  try {
    const buf = await fetchBuffer(`${TILE_BASE}/${z}/${x}/${y}.jpeg`);
    if (!buf) return null;
    return jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 64 });
  } catch {
    return null;
  }
}

// Blit a decoded tile (RGBA) into the output buffer at destination (dx, dy).
function blit(out, tile, dx, dy) {
  if (!tile || !tile.data) return;
  for (let ty = 0; ty < tile.height; ty++) {
    const oy = dy + ty;
    if (oy < 0 || oy >= OUT_H) continue;
    for (let tx = 0; tx < tile.width; tx++) {
      const ox = dx + tx;
      if (ox < 0 || ox >= OUT_W) continue;
      const si = (ty * tile.width + tx) * 4;
      const di = (oy * OUT_W + ox) * 4;
      out[di] = tile.data[si];
      out[di + 1] = tile.data[si + 1];
      out[di + 2] = tile.data[si + 2];
      out[di + 3] = 255;
    }
  }
}

function setPx(out, x, y, r, g, b) {
  if (x < 0 || x >= OUT_W || y < 0 || y >= OUT_H) return;
  const i = (y * OUT_W + x) * 4;
  out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
}

// Draw a simple, clearly visible pin at the raster centre: a white-bordered red
// disc with a dark centre dot. Purely pixel-based.
function drawPin(out, cx, cy) {
  const rOuter = 11, rRed = 9, rDot = 3;
  for (let dy = -rOuter; dy <= rOuter; dy++) {
    for (let dx = -rOuter; dx <= rOuter; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > rOuter * rOuter) continue;
      const x = cx + dx, y = cy + dy;
      if (d2 <= rDot * rDot) setPx(out, x, y, 40, 40, 40);
      else if (d2 <= rRed * rRed) setPx(out, x, y, 214, 40, 40);
      else setPx(out, x, y, 255, 255, 255);
    }
  }
}

function writeAtomic(outFile, buffer) {
  const tmp = outFile + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, outFile);
}

// Generate a PNG snapshot for the given pin and write it to outFile.
export async function generateSnapshot({ lat, lon, zoom }, outFile) {
  const latN = Number(lat), lonN = Number(lon);
  if (!Number.isFinite(latN) || !Number.isFinite(lonN)) throw new Error('Ungültige Koordinaten.');
  const z = clampZoom(zoom);
  const { x: cpx, y: cpy } = project(latN, lonN, z);

  const left = Math.round(cpx - OUT_W / 2);
  const top = Math.round(cpy - OUT_H / 2);
  const startTx = Math.floor(left / TILE);
  const endTx = Math.floor((left + OUT_W - 1) / TILE);
  const startTy = Math.floor(top / TILE);
  const endTy = Math.floor((top + OUT_H - 1) / TILE);

  const out = new Uint8Array(OUT_W * OUT_H * 4);

  const jobs = [];
  for (let tx = startTx; tx <= endTx; tx++) {
    for (let ty = startTy; ty <= endTy; ty++) {
      jobs.push((async () => {
        const tile = await fetchTile(z, tx, ty);
        blit(out, tile, tx * TILE - left, ty * TILE - top);
        return Boolean(tile);
      })());
    }
  }
  const results = await Promise.all(jobs);
  if (!results.some(Boolean)) throw new Error('Keine Kartenkacheln geladen.');

  drawPin(out, Math.round(OUT_W / 2), Math.round(OUT_H / 2));

  const png = new PNG({ width: OUT_W, height: OUT_H });
  png.data = Buffer.from(out.buffer);
  const buffer = PNG.sync.write(png);
  writeAtomic(outFile, buffer);
  return outFile;
}
