import fs from 'node:fs';
import path from 'node:path';

const WK_DIR = path.resolve('data/forms/wk/_global');

function parseDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function summarize(submission, id) {
  const start = submission.start || '';
  const ende = submission.ende || '';
  const label = [submission.nummer, submission.name].filter(Boolean).join(' ').trim() || id;
  const range = start && ende ? `${start} – ${ende}` : start || ende || '';
  return {
    id,
    name: submission.name || '',
    nummer: submission.nummer || '',
    start,
    ende,
    kommentar: submission.kommentar || '',
    label,
    range,
    submittedAt: submission._meta?.submittedAt || null,
  };
}

export function listWks() {
  if (!fs.existsSync(WK_DIR)) return [];
  return fs.readdirSync(WK_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(WK_DIR, f), 'utf8'));
        return summarize(parsed, path.basename(f, '.json'));
      } catch (e) {
        console.error(`wk: failed to parse ${f}:`, e.message);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.id.localeCompare(b.id));
}

// Pick the WK whose date range is "closest" to today: 0 if today lies in the
// range, otherwise the smaller of |today-start| / |today-ende|.
export function pickNearestWk(wks, today = Date.now()) {
  if (!wks.length) return null;
  let best = wks[0];
  let bestDist = Infinity;
  for (const wk of wks) {
    const s = parseDate(wk.start);
    const e = parseDate(wk.ende) ?? s;
    let dist;
    if (s !== null && e !== null && today >= s && today <= e) dist = 0;
    else {
      const ds = s !== null ? Math.abs(today - s) : Infinity;
      const de = e !== null ? Math.abs(today - e) : Infinity;
      dist = Math.min(ds, de);
    }
    if (dist < bestDist) { bestDist = dist; best = wk; }
  }
  return best;
}

export function getWk(id) {
  if (!id) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return null;
  const file = path.join(WK_DIR, id + '.json');
  if (!file.startsWith(WK_DIR + path.sep)) return null;
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return summarize(parsed, id);
  } catch {
    return null;
  }
}

const COOKIE = 'wkId';

export function wkMiddleware(req, res, next) {
  if (!req.user) { req.activeWk = null; return next(); }
  const wks = listWks();
  if (!wks.length) { req.activeWk = null; req.wkList = []; return next(); }
  const wanted = req.cookies?.[COOKIE];
  let active = wanted ? wks.find((w) => w.id === wanted) : null;
  if (!active) {
    active = pickNearestWk(wks);
    if (active) {
      res.cookie(COOKIE, active.id, {
        httpOnly: false, sameSite: 'lax', path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 365,
      });
    }
  }
  req.activeWk = active || null;
  req.wkList = wks;
  next();
}

export function setActiveWk(res, id) {
  res.cookie(COOKIE, id, {
    httpOnly: false, sameSite: 'lax', path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });
}
