'use strict';

// Shared with the server. Credentials, room history and machine paths never travel.
// `perf` stays on each machine: FPS unlock, frame cap and GPU switches depend on
// that PC's monitor and graphics card. Syncing them replaced the whole group with
// another computer's (a 60 Hz laptop's cap, V-Sync on) and locked the FPS.
const GROUPS = ['general', 'appearance', 'game', 'overlay', 'notify', 'favorites',
  'discord', 'avatar', 'keys', 'countryOverride', 'vip', 'updates', 'privacy', 'chat', 'music', 'pitch'];
const ASSETS = ['avatarImage', 'ballImage', 'goalSound', 'hitSound'];
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor', '__replace']);
function safe(value, depth = 0) {
  if (depth > 12) throw new Error('Configuración demasiado profunda');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= 12000000) return value;
  if (Array.isArray(value) && value.length <= 2000) return value.map(v => safe(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      if (FORBIDDEN.has(key)) throw new Error('Clave de configuración no permitida');
      out[key] = safe(value[key], depth + 1);
    }
    return out;
  }
  throw new Error('Configuración inválida');
}
function portable(config) {
  const out = {};
  for (const key of GROUPS) if (config[key] !== undefined) out[key] = safe(config[key]);
  if (out.general) { delete out.general.gameUrl; delete out.general.launchOnStartup; delete out.general.adoptedGameSettings; }
  if (out.discord) delete out.discord.appId;
  if (out.vip) { delete out.vip.discord; for (const key of ASSETS) delete out.vip[key]; }
  return out;
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
// Three-way merge: local edits win only where they differ from the last synced copy.
// Arrays are atomic; missing object keys represent deletions.
function reconcile(base, local, remote) {
  if (equal(local, base)) return remote;
  if (object(local) && object(remote) && (object(base) || base === undefined)) {
    const out = {};
    for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)])) {
      if (FORBIDDEN.has(key)) continue;
      const value = reconcile(base && base[key], local[key], remote[key]);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  return local;
}
module.exports = { GROUPS, ASSETS, safe, portable, reconcile, equal };
