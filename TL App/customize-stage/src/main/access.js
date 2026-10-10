'use strict';

/**
 * Lista de acceso del equipo.
 *
 * El dueño publica un `access.json` en la raíz del repo (rama main):
 *
 *   {
 *     "enabled": false,
 *     "users": [ { "name": "Cuti", "hash": "<sha256 de la clave>" } ]
 *   }
 *
 * `enabled: false` (el valor de fábrica) deja pasar a todos: nadie se queda afuera
 * hasta que se active. Cada persona tiene su clave (la genera `tools/make-access-key.js`);
 * en el JSON sólo viaja el hash. Sacar a alguien = borrar su línea.
 *
 * Límites honestos: esto corre en la PC del jugador, así que alguien con ganas y
 * conocimientos puede saltearlo editando la app. Frena a quien no tiene clave y
 * permite revocar, no es seguridad de servidor.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ACCESS_URL = 'https://raw.githubusercontent.com/JO1SE0/TLAPP/main/access.json';
const FILE = 'access-state.json';
const TIMEOUT_MS = 10000;
const DEFAULT_GRACE_DAYS = 3;
const RECHECK_MS = 60 * 60 * 1000;
const DAY = 24 * 3600 * 1000;

let dir = null;
let saved = { key: '', enabled: null, name: '', validatedAt: 0 };
let status = { state: 'ok', name: '', reason: '' };
let timer = null;
let onChange = () => {};

const normalize = (k) => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashKey = (k) => crypto.createHash('sha256').update(`tl-app:${normalize(k)}`).digest('hex');

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    saved = { key: String(j.key || ''), enabled: j.enabled === true ? true : j.enabled === false ? false : null,
      name: String(j.name || ''), validatedAt: Number(j.validatedAt) || 0 };
  } catch { /* primera vez */ }
}

function persist() {
  try { fs.writeFileSync(path.join(dir, FILE), JSON.stringify(saved), 'utf8'); } catch { /* sin disco: dura la sesión */ }
}

async function fetchList() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ACCESS_URL}?t=${Date.now()}`, { signal: controller.signal, headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!j || typeof j !== 'object') throw new Error('formato');
    return j;
  } finally { clearTimeout(t); }
}

function set(next) {
  const changed = next.state !== status.state || next.reason !== status.reason || next.name !== status.name;
  status = next;
  if (changed) onChange(status);
}

/** Decide con la lista (si hay) y lo guardado. `key` es opcional (clave recién tipeada). */
async function evaluate(key) {
  let list = null;
  try { list = await fetchList(); } catch { list = null; }
  const candidate = key != null ? key : saved.key;

  if (list) {
    const enabled = list.enabled === true;
    saved.enabled = enabled;
    if (!enabled) { saved.validatedAt = Date.now(); persist(); return set({ state: 'ok', name: saved.name, reason: '' }); }
    const users = Array.isArray(list.users) ? list.users : [];
    const h = candidate ? hashKey(candidate) : '';
    const me = h && users.find((u) => u && String(u.hash).toLowerCase() === h);
    if (me) {
      saved = { key: normalize(candidate), enabled: true, name: String(me.name || ''), validatedAt: Date.now() };
      persist();
      return set({ state: 'ok', name: saved.name, reason: '' });
    }
    if (saved.key && key == null) { saved.validatedAt = 0; persist(); }
    return set({ state: 'locked', name: '', reason: candidate ? (key != null ? 'bad-key' : 'revoked') : 'need-key' });
  }

  // Sin conexión con la lista.
  if (saved.enabled === false) return set({ state: 'ok', name: saved.name, reason: '' });
  if (saved.enabled === null) return set({ state: 'ok', name: '', reason: '' }); // nunca se supo que estuviera activa
  const graceMs = DEFAULT_GRACE_DAYS * DAY;
  if (saved.key && saved.validatedAt && Date.now() - saved.validatedAt < graceMs) {
    return set({ state: 'ok', name: saved.name, reason: '' });
  }
  return set({ state: 'locked', name: '', reason: key != null ? 'offline' : saved.key ? 'expired' : 'need-key' });
}

function init(userDataDir, cb) {
  dir = userDataDir;
  if (cb) onChange = cb;
  load();
  // Hasta saber algo, se parte de lo guardado: si estaba activa y sin clave, cerrado.
  if (saved.enabled === true && !(saved.key && saved.validatedAt)) status = { state: 'locked', name: '', reason: 'need-key' };
  const run = () => evaluate(null).catch(() => {});
  const first = run();
  timer = setInterval(run, RECHECK_MS);
  if (timer.unref) timer.unref();
  return first;
}

const get = () => status;
const isLocked = () => status.state === 'locked';
const submit = async (key) => { await evaluate(String(key || '')); return status; };
const recheck = async () => { await evaluate(null); return status; };

module.exports = { init, get, isLocked, submit, recheck, hashKey, normalize, ACCESS_URL };
