'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const store = require('./store');
const { ASSETS, portable, safe, reconcile, equal } = require('./preferences');
const EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.wav', '.ogg', '.m4a']);
let active = null, record = null, busy = false, timer = null, started = false, applying = false;
let publish = () => {}, status = { state: 'offline', at: 0 };
let deferBackground = () => false;
const assetCache = new Map();
const dir = () => path.join(app.getPath('userData'), 'accounts');
const file = id => path.join(dir(), `${id || 'guest'}.json`);
function write(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target + '.tmp', JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(target + '.tmp', target);
}
function read(id) {
  try {
    const result = JSON.parse(fs.readFileSync(file(id), 'utf8'));
    try { result.base = JSON.parse(fs.readFileSync(file(id) + '.base', 'utf8')); }
    catch (err) { if (err.code !== 'ENOENT') throw err; result.base = null; }
    try { result.seed = JSON.parse(fs.readFileSync(file(id) + '.seed', 'utf8')); }
    catch (err) { if (err.code !== 'ENOENT') throw err; result.seed = null; }
    return result;
  }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
function persistRecord() {
  // Large asset copies belong in the baseline, not in every window/stats save.
  const { base, seed, ...small } = record;
  write(file(active), small);
}
function localConfig() {
  const cfg = JSON.parse(JSON.stringify(store.get()));
  cfg.vip.discord = null;
  return cfg;
}
function remember() {
  if (!record || applying) return;
  const next = localConfig();
  const relevant = cfg => ({ settings: portable(cfg), assets: ASSETS.map(k => cfg.vip[k]) });
  const changed = !equal(relevant(record.config), relevant(next));
  record.config = next;
  persistRecord();
  if (changed && active) {
    status = { ...status, state: 'pending', error: null };
    schedule();
  }
}
function start(onApplied, shouldDefer = () => false) {
  if (started) return;
  started = true; publish = onApplied; deferBackground = shouldDefer;
  const profile = store.get().vip.discord;
  active = profile && /^\d{15,25}$/.test(String(profile.id)) ? String(profile.id) : null;
  record = read(active) || { base: null, config: localConfig() };
  remember();
  store.subscribe(remember);
  setInterval(() => sync(), 60000).unref();
  return sync();
}
function switchAccount(profile) {
  const id = profile ? String(profile.id) : null;
  if (id && !/^\d{15,25}$/.test(id)) throw new Error('Cuenta de Discord inválida');
  if (id === active) return store.set({ vip: { discord: profile } });
  remember();
  let next = read(id);
  if (!next) {
    // Only the first account adopts the pre-existing guest preferences.
    const first = id && fs.readdirSync(dir()).filter(n => /^\d+\.json$/.test(n)).length === 0;
    next = { base: null, config: first ? localConfig() : JSON.parse(JSON.stringify(store.DEFAULTS)) };
  }
  active = id; record = next;
  const machine = store.get();
  applying = true;
  try {
    store.replace({ ...next.config, window: machine.window, replays: machine.replays,
      general: { ...next.config.general, launchOnStartup: machine.general.launchOnStartup },
      vip: { ...next.config.vip, discord: profile } });
  } finally { applying = false; }
  status = { state: id ? 'pending' : 'offline', at: 0 };
  remember(); schedule(0);
  return store.get();
}
function snapshot() {
  const config = store.get();
  const assets = {};
  for (const key of ASSETS) {
    const source = config.vip[key];
    if (!source) { assets[key] = null; continue; }
    const ext = path.extname(source).toLowerCase();
    if (!EXT.has(ext)) throw new Error('Formato de archivo no sincronizable');
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Archivo demasiado grande');
    const signature = `${source}:${stat.size}:${stat.mtimeMs}`;
    const cached = assetCache.get(key);
    const asset = cached && cached.signature === signature ? cached.asset : { ext, data: fs.readFileSync(source).toString('base64') };
    assetCache.set(key, { signature, asset });
    assets[key] = asset;
  }
  return { settings: portable(config), assets };
}
function applySnapshot(data) {
  const incoming = portable(safe(data.settings));
  const cfg = store.get();
  // Validate known fields against the installed schema before using remote values.
  function typed(value, example) {
    if (Array.isArray(example)) return Array.isArray(value) ? value : example;
    if (example && typeof example === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return example;
      if (!Object.keys(example).length) return value;
      const out = {};
      for (const key of Object.keys(example)) out[key] = key in value ? typed(value[key], example[key]) : example[key];
      return out;
    }
    return typeof value === typeof example ? value : example;
  }
  const patch = {};
  for (const key of Object.keys(incoming)) patch[key] = typed(incoming[key], store.DEFAULTS[key]);
  patch.general = { ...patch.general, gameUrl: cfg.general.gameUrl, launchOnStartup: cfg.general.launchOnStartup, adoptedGameSettings: true };
  patch.discord = { ...patch.discord, appId: cfg.discord.appId };
  patch.vip = { ...patch.vip, discord: cfg.vip.discord };
  for (const key of ASSETS) {
    const asset = data.assets && data.assets[key];
    if (!asset) { patch.vip[key] = ''; continue; }
    if (!EXT.has(asset.ext) || typeof asset.data !== 'string' || asset.data.length > 11200000) throw new Error('Archivo remoto inválido');
    const bytes = Buffer.from(asset.data, 'base64');
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Archivo remoto demasiado grande');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const target = path.join(dir(), 'assets', hash + asset.ext);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, bytes);
    patch.vip[key] = target;
  }
  applying = true;
  try { store.replace({ ...cfg, ...patch }); } finally { applying = false; }
  publish(store.get());
}
function schedule(delay = 2000) {
  clearTimeout(timer);
  timer = setTimeout(() => sync(), delay);
  timer.unref();
}
async function request() {
  // TL App no sincroniza con ningún servidor: la configuración vive sólo en esta PC.
  throw new Error('La sincronización en la nube no está disponible en TL App');
}
async function sync(manual = false) {
  const profile = store.get().vip.discord;
  if (busy || !active || !profile || !profile.refresh) return status;
  if (!manual && deferBackground()) return status;
  busy = true;
  const id = active, targetRecord = record;
  status = { ...status, state: 'syncing', error: null };
  try {
    const local = snapshot();
    // Remember the first local state before going online. Changes made while
    // that first request fails must survive a later restoration from the cloud.
    if (!record.base && !record.seed) {
      write(file(active) + '.seed', local);
      record.seed = local;
    }
    const remote = await request(profile, { action: 'read', revision: record.base ? record.revision : undefined });
    if (remote.notModified) remote.data = record.base;
    if (active !== id || record !== targetRecord) return status;
    // First sign-in on a new installation restores the cloud copy.
    const merged = remote.data ? reconcile(record.base || record.seed, local, remote.data) : local;
    let saved = remote;
    if (!equal(merged, remote.data)) {
      saved = await request(profile, { action: 'write', revision: remote.revision, data: merged });
      if (saved.conflict) { schedule(); return status; }
    }
    if (active !== id || record !== targetRecord) return status;
    // Preserve edits made while the HTTP request was in flight.
    const current = snapshot();
    const final = reconcile(local, current, merged);
    if (!equal(final, current)) applySnapshot(final);
    if (!equal(record.base, merged)) write(file(active) + '.base', merged);
    record.base = merged;
    record.revision = saved.revision;
    record.config = localConfig();
    persistRecord();
    if (record.seed) {
      try { fs.unlinkSync(file(active) + '.seed'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      record.seed = null;
    }
    status = { state: equal(final, merged) ? 'synced' : 'pending', at: Date.now(), error: null };
    if (!equal(final, merged)) schedule();
  } catch (err) {
    if (active === id && record === targetRecord) status = { ...status, state: 'error', error: err.message };
  } finally { busy = false; }
  return status;
}
module.exports = { start, switchAccount, sync, getStatus: () => status };
