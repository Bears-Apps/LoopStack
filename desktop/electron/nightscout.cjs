// Nightscout, read from the main process. The renderer never sees the token
// and has no network access of its own (its CSP is connect-src 'self'); it asks
// over IPC and gets back trimmed records, which src/data/nightscout.ts turns
// into the dashboard.
//
// Read-only: only GET requests to /api/v1, with a Nightscout access token
// (Admin tools → Subjects, the "readable" role). LoopStack never writes to
// Nightscout, Loop or the pump.
//
// The URL, name and token are saved in the app's user-data folder; the token is
// encrypted with the OS keychain (Electron safeStorage). Health data is kept in
// memory only, never written to disk.
const { app, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DAY = 24 * 3600 * 1000;
const ENTRY_DAYS = 84; // 12 weeks: the weekday heads-ups need them
const DETAIL_DAYS = 35; // treatments and Loop status: 14 days, the 14 before, and a week spare
const TIMEOUT = 45_000;

const file = () => path.join(app.getPath('userData'), 'nightscout.json');

function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(file(), 'utf8'));
    let token = '';
    if (c.token && safeStorage.isEncryptionAvailable()) token = safeStorage.decryptString(Buffer.from(c.token, 'base64'));
    return { url: c.url || '', name: c.name || '', token };
  } catch {
    return { url: '', name: '', token: '' };
  }
}

function writeConfig({ url, name, token }) {
  if (token && !safeStorage.isEncryptionAvailable()) throw new Error('This Mac’s keychain isn’t available, so the token can’t be stored safely.');
  const enc = token ? safeStorage.encryptString(token).toString('base64') : '';
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ url, name, token: enc }), { mode: 0o600 });
}

/** https only, except a Nightscout on this computer. Trailing slashes and paths dropped. */
function normalizeUrl(input) {
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new Error('That doesn’t look like a web address.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) throw new Error('Use the https:// address of your Nightscout.');
  if (u.username || u.password) throw new Error('Put the access token in the token field, not in the address.');
  return `${u.protocol}//${u.host}`;
}

async function get(cfg, p, params = {}) {
  const u = new URL(`${cfg.url}${p}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  if (cfg.token) u.searchParams.set('token', cfg.token);
  const res = await fetch(u, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT), redirect: 'error' });
  if (res.status === 401 || res.status === 403) throw new Error('Nightscout said no: check the access token (it needs the readable role).');
  if (!res.ok) throw new Error(`Nightscout answered ${res.status} for ${p}.`);
  return res.json();
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function trimEntry(e) {
  const date = num(e.date) ?? Date.parse(e.dateString);
  return { date, sgv: num(e.sgv), direction: e.direction, device: e.device };
}

function trimTreatment(t) {
  return {
    created_at: t.created_at || t.timestamp,
    eventType: t.eventType,
    insulin: num(t.insulin),
    carbs: num(t.carbs),
    duration: num(t.duration) ?? (num(t.durationInMilliseconds) != null ? t.durationInMilliseconds / 60000 : null),
    rate: num(t.rate),
    absolute: num(t.absolute),
    automatic: t.automatic === true,
    isSMB: t.isSMB === true,
    reason: typeof t.reason === 'string' ? t.reason : null,
    notes: typeof t.notes === 'string' ? t.notes.slice(0, 80) : null,
    absorptionTime: num(t.absorptionTime),
    foodType: typeof t.foodType === 'string' ? t.foodType.slice(0, 60) : null,
    insulinNeedsScaleFactor: num(t.insulinNeedsScaleFactor),
    correctionRange: Array.isArray(t.correctionRange) ? t.correctionRange.slice(0, 2).map(Number).filter(Number.isFinite) : null,
  };
}

/** A devicestatus is kilobytes of prediction state; the dashboard needs a few facts. */
function trimStatus(d, keepPrediction) {
  const loop = d.loop || null;
  const aps = d.openaps || null;
  // Loop sends manufacturer "Insulet" and model "Omnipod DASH", or variants; drop a repeated word.
  const pump = d.pump && (d.pump.manufacturer || d.pump.model) ? [d.pump.manufacturer, d.pump.model].filter(Boolean).join(' ').split(/\s+/).filter((w, i, a) => i === 0 || w.toLowerCase() !== a[i - 1].toLowerCase()).join(' ') : null;
  const out = {
    created_at: d.created_at,
    loopAt: loop?.timestamp ?? aps?.suggested?.timestamp ?? null,
    iob: num(loop?.iob?.iob) ?? num(aps?.iob?.iob) ?? (Array.isArray(aps?.iob) ? num(aps.iob[0]?.iob) : null),
    cob: num(loop?.cob?.cob) ?? num(aps?.suggested?.COB),
    failed: Boolean(loop?.failureReason),
    version: loop?.version ? `Loop ${loop.version}` : aps?.version ? `${/trio/i.test(d.device || '') ? 'Trio' : 'oref'} ${aps.version}` : null,
    pump: pump ? pump.replace(/^Insulet\s+(?!Omnipod)/i, 'Omnipod ').replace(/^Insulet\s+/i, '').replace(/Omnipod\s+Omnipod/i, 'Omnipod').replace(/Omnipod\s+Dash/i, 'Omnipod DASH') : null,
    system: loop ? 'Loop' : aps ? 'oref' : null,
    predicted: null,
  };
  if (keepPrediction) {
    const p = loop?.predicted;
    if (p && Array.isArray(p.values)) out.predicted = { startDate: p.startDate, values: p.values.slice(0, 24) };
    else if (aps?.suggested?.predBGs?.IOB) out.predicted = { startDate: aps.suggested.timestamp, values: aps.suggested.predBGs.IOB.slice(0, 24) };
  }
  return out;
}

/** Each profile document, with its default profile's schedules. */
function trimProfiles(docs) {
  const out = [];
  for (const d of docs || []) {
    const store = d.store && (d.store[d.defaultProfile] || Object.values(d.store)[0]);
    if (!store) continue;
    const sched = (s) => (Array.isArray(s) ? s.map((x) => ({ time: x.time, timeAsSeconds: num(Number(x.timeAsSeconds)), value: Number(x.value) })).filter((x) => Number.isFinite(x.value)) : []);
    out.push({
      startDate: d.startDate || d.created_at,
      basal: sched(store.basal),
      carbratio: sched(store.carbratio),
      sens: sched(store.sens),
      targetLow: sched(store.target_low),
      targetHigh: sched(store.target_high),
      units: store.units || d.units || 'mg/dl',
    });
  }
  return out;
}

async function readAll(cfg) {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const entriesFrom = now - ENTRY_DAYS * DAY;
  const detailFrom = now - DETAIL_DAYS * DAY;
  // Loop uploads every 5 minutes: a week of devicestatus is ~2,000 documents, so read it a week at a time.
  const weeks = [];
  for (let t = detailFrom; t < now; t += 7 * DAY) weeks.push([t, Math.min(t + 7 * DAY, now + 60_000)]);
  const [entries, treatments, profiles, ...statusWeeks] = await Promise.all([
    get(cfg, '/api/v1/entries/sgv.json', { 'find[date][$gte]': entriesFrom, count: 30000 }),
    get(cfg, '/api/v1/treatments.json', { 'find[created_at][$gte]': iso(detailFrom), count: 20000 }),
    get(cfg, '/api/v1/profile.json', { count: 500 }),
    ...weeks.map(([a, b]) => get(cfg, '/api/v1/devicestatus.json', { 'find[created_at][$gte]': iso(a), 'find[created_at][$lt]': iso(b), count: 4000 })),
  ]);
  const statuses = statusWeeks.flat().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return {
    site: new URL(cfg.url).host,
    name: cfg.name,
    fetchedAt: new Date(now).toISOString(),
    entries: entries.map(trimEntry).filter((e) => e.sgv != null && Number.isFinite(e.date)),
    treatments: treatments.map(trimTreatment).filter((t) => t.created_at),
    devicestatus: statuses.map((d, i) => trimStatus(d, i === 0)),
    profiles: trimProfiles(profiles),
  };
}

function register() {
  ipcMain.handle('ns:config', () => {
    const c = readConfig();
    return { url: c.url, name: c.name, hasToken: Boolean(c.token), connected: Boolean(c.url) };
  });
  ipcMain.handle('ns:connect', async (_e, input) => {
    try {
      const prev = readConfig();
      const url = normalizeUrl(String(input?.url ?? ''));
      // An empty token field keeps the saved token for the same site.
      const token = typeof input?.token === 'string' && input.token.trim() ? input.token.trim() : prev.url === url ? prev.token : '';
      const cfg = { url, token, name: String(input?.name ?? '').trim().slice(0, 40) };
      const status = await get(cfg, '/api/v1/status.json');
      if (!status || typeof status !== 'object' || !('status' in status || 'version' in status)) throw new Error('That address answered, but not like a Nightscout site.');
      // A readable token must be able to see entries, not just the status page.
      await get(cfg, '/api/v1/entries/sgv.json', { count: 1 });
      writeConfig(cfg);
      return { ok: true, version: status.version || null };
    } catch (err) {
      return { ok: false, error: err?.name === 'TimeoutError' ? 'Nightscout didn’t answer in time.' : String(err?.message || err) };
    }
  });
  ipcMain.handle('ns:fetch', async () => {
    const cfg = readConfig();
    if (!cfg.url) return { ok: false, error: 'Not connected.' };
    try {
      return { ok: true, raw: await readAll(cfg) };
    } catch (err) {
      return { ok: false, error: err?.name === 'TimeoutError' ? 'Nightscout didn’t answer in time.' : String(err?.message || err) };
    }
  });
  ipcMain.handle('ns:disconnect', () => {
    try { fs.rmSync(file(), { force: true }); } catch { /* already gone */ }
    return { ok: true };
  });
}

module.exports = { register, normalizeUrl, readAll };
