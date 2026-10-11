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
const identity = require('./identity');
const presenceMod = require('./presence');

const ACCESS_URL = 'https://raw.githubusercontent.com/JO1SE0/TLAPP/main/access.json';
const FILE = 'access-state.json';
const TIMEOUT_MS = 10000;
const DEFAULT_GRACE_DAYS = 3;
const RECHECK_MS = 60 * 60 * 1000;
const DAY = 24 * 3600 * 1000;

let dir = null;
let saved = { key: '', enabled: null, name: '', validatedAt: 0, admin: null };
let status = { state: 'ok', name: '', reason: '', notice: null };
/** Último anuncio del capitán que se pudo leer (se conserva si después no hay conexión). */
let notice = null;
/** Plantel con llave pública y dirección de la base de presencia (de access.json). */
let roster = [];
let presence = '';
/** Versión de esta app (para la «versión mínima»). La pasa main al iniciar. */
let appVersion = '0.0.0';
/** Última lista de GitHub que se pudo leer, para reevaluar sin volver a bajarla. */
let lastList = null;
/** Lo que manda: la lista oficial firmada por el capitán si la hay, y si no access.json. */
let eff = { enabled: false, users: [], notices: [], minVersion: '', minMessage: '', captains: [], legacyNotice: null, seq: 0, source: 'github' };
const ADMIN_POLL_MS = 60 * 1000;
const NOTICE_TICK_MS = 30 * 1000;
const HEX64 = /^[0-9a-f]{64}$/i;
let timer = null;
let onChange = () => {};

const normalize = identity.normalizeKey;
const hashKey = identity.hashKey;

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    saved = { key: String(j.key || ''), enabled: j.enabled === true ? true : j.enabled === false ? false : null,
      name: String(j.name || ''), validatedAt: Number(j.validatedAt) || 0,
      admin: j.admin && typeof j.admin.p === 'string' && typeof j.admin.s === 'string' ? { p: j.admin.p, s: j.admin.s } : null };
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

/** Un anuncio válido: texto corto, sólo texto (la interfaz lo muestra sin HTML). */
function cleanNotice(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string' || !raw.text.trim()) return null;
  const text = raw.text.trim().slice(0, 600);
  const id = String(raw.id || crypto.createHash('sha1').update(text).digest('hex').slice(0, 10)).slice(0, 40);
  return { id, title: String(raw.title || '').trim().slice(0, 80), text };
}

/* ── Lista oficial del capitán (Firebase) ───────────────────────────────
 * El capitán firma con su clave un documento con la lista de acceso, los avisos y la
 * versión mínima, y lo deja en `admin/state`. Acá sólo se acepta si la firma
 * es de alguno de los `captains` de access.json y su `seq` no retrocede.
 * Si Firebase no responde o no hay nada, se usa lo último verificado y, en su
 * defecto, access.json: nunca queda la app sin lista.
 */
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function verifiedDoc(raw, captains) {
  if (!raw || typeof raw.p !== 'string' || typeof raw.s !== 'string') return null;
  for (const pub of captains) {
    if (!identity.verify(pub, raw.p, raw.s)) continue;
    try {
      const d = JSON.parse(raw.p);
      if (d && Number.isInteger(d.seq) && Array.isArray(d.users)) return d;
    } catch { /* firma buena pero contenido roto: se ignora */ }
  }
  return null;
}

async function fetchAdminRaw(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/admin/state.json?t=${Date.now()}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

/** Arma `eff` con lo de GitHub y, encima, lo último verificado del capitán. */
function rebuild(list) {
  const base = list || {};
  const captains = (Array.isArray(base.captains) ? base.captains : []).filter((p) => HEX64.test(String(p))).map((p) => String(p).toLowerCase());
  const d = captains.length ? verifiedDoc(saved.admin, captains) : null;
  if (d) {
    eff = {
      enabled: d.enabled === true,
      users: d.users.filter((u) => u && u.hash),
      notices: Array.isArray(d.notices) ? d.notices : [],
      minVersion: typeof d.minVersion === 'string' ? d.minVersion : '',
      minMessage: typeof d.minMessage === 'string' ? d.minMessage : '',
      captains, legacyNotice: null, seq: d.seq, source: 'captain'
    };
  } else {
    eff = {
      enabled: base.enabled === true,
      users: Array.isArray(base.users) ? base.users : [],
      notices: [], minVersion: '', minMessage: '', captains,
      legacyNotice: cleanNotice(base.announcement), seq: 0, source: 'github'
    };
  }
  roster = eff.users.filter((u) => u && HEX64.test(String(u.pub || ''))).map((u) => ({ name: String(u.name || '').slice(0, 40), pub: String(u.pub).toLowerCase() }));
  presence = typeof base.presence === 'string' ? base.presence : '';
}

/** Baja lo del capitán. Devuelve true si cambió algo respecto de lo guardado. */
async function refreshAdmin() {
  const url = presenceMod.cleanUrl(presence);
  if (!url || !eff.captains.length) return false;
  let raw;
  try { raw = await fetchAdminRaw(url); } catch { return false; }
  const d = verifiedDoc(raw, eff.captains);
  if (!d) return false;
  const have = saved.admin ? verifiedDoc(saved.admin, eff.captains) : null;
  if (have && d.seq < have.seq) return false; // una copia vieja no pisa a la nueva
  if (have && d.seq === have.seq && raw.p === saved.admin.p) return false;
  saved.admin = { p: raw.p, s: raw.s };
  persist();
  rebuild(lastList);
  return true;
}

/* ── Avisos con fecha ─────────────────────────────────────── */
const PERIOD = { daily: DAY, weekly: 7 * DAY };

/** Los avisos que corresponde mostrar AHORA. Los que se repiten tienen un id distinto por vez. */
function activeNotices(now) {
  const out = [];
  for (const n of eff.notices) {
    if (!n || typeof n.text !== 'string' || !n.text.trim()) continue;
    const at = toNum(n.at);
    let occ = at;
    let id = String(n.id || at);
    const step = PERIOD[n.repeat];
    if (step) {
      if (now < at) continue;
      occ = at + Math.floor((now - at) / step) * step;
      id = `${id}@${occ}`;
      if (now - occ > DAY) continue;
    } else if (now < at || now - at > 7 * DAY) continue;
    out.push({ id: id.slice(0, 60), title: String(n.title || '').slice(0, 80), text: n.text.trim().slice(0, 600), urgent: n.urgent === true, at: occ });
  }
  return out.sort((a, b) => b.at - a.at);
}

const cmpVersion = (a, b) => {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  return 0;
};

function isCaptainKey(key) {
  try { return !!key && eff.captains.includes(identity.fromKey(key).pub); } catch { return false; }
}

function set(next) {
  const now = Date.now();
  const active = activeNotices(now);
  const urgent = active.find((n) => n.urgent && now - n.at < 2 * 3600 * 1000) || null;
  const normal = active.find((n) => !n.urgent) || null;
  next.notice = normal ? { id: normal.id, title: normal.title, text: normal.text } : (notice || eff.legacyNotice);
  next.urgent = urgent ? { id: urgent.id, title: urgent.title, text: urgent.text } : null;
  next.minVersion = eff.minVersion || '';
  next.captain = next.state === 'ok' && isCaptainKey(saved.key);
  const changed = next.state !== status.state || next.reason !== status.reason || next.name !== status.name ||
    JSON.stringify([next.notice, next.urgent, next.minVersion, next.captain, next.minMessage]) !==
    JSON.stringify([status.notice, status.urgent, status.minVersion, status.captain, status.minMessage]);
  status = next;
  if (changed) onChange(status);
}

/** «ok», salvo que la app sea más vieja que la versión mínima que pidió el capitán (él no se bloquea). */
function allow(name, candidate) {
  if (eff.minVersion && cmpVersion(appVersion, eff.minVersion) < 0 && !isCaptainKey(candidate || saved.key)) {
    return set({ state: 'locked', name: '', reason: 'outdated', minMessage: eff.minMessage || '' });
  }
  return set({ state: 'ok', name, reason: '' });
}

/** Decide con la lista (si hay) y lo guardado. `key` es opcional (clave recién tipeada). */
async function evaluate(key, opts) {
  let list = null;
  if (opts && opts.skipGithub) list = lastList;
  else { try { list = await fetchList(); } catch { list = null; } }
  const candidate = key != null ? key : saved.key;

  if (list) {
    lastList = list;
    rebuild(list);
    if (!(opts && opts.skipGithub)) await refreshAdmin();
    notice = null;
    const enabled = eff.enabled;
    saved.enabled = enabled;
    if (!enabled) { saved.validatedAt = Date.now(); persist(); return allow(saved.name, candidate); }
    const users = eff.users;
    const h = candidate ? hashKey(candidate) : '';
    const me = h && users.find((u) => u && String(u.hash).toLowerCase() === h);
    if (me) {
      saved = { key: normalize(candidate), enabled: true, name: String(me.name || ''), validatedAt: Date.now(), admin: saved.admin };
      persist();
      return allow(saved.name, candidate);
    }
    if (saved.key && key == null) { saved.validatedAt = 0; persist(); }
    return set({ state: 'locked', name: '', reason: candidate ? (key != null ? 'bad-key' : 'revoked') : 'need-key' });
  }

  // Sin conexión con la lista.
  if (saved.enabled === false) return allow(saved.name, candidate);
  if (saved.enabled === null) return set({ state: 'ok', name: '', reason: '' }); // nunca se supo que estuviera activa
  const graceMs = DEFAULT_GRACE_DAYS * DAY;
  if (saved.key && saved.validatedAt && Date.now() - saved.validatedAt < graceMs) {
    return allow(saved.name, candidate);
  }
  return set({ state: 'locked', name: '', reason: key != null ? 'offline' : saved.key ? 'expired' : 'need-key' });
}

function init(userDataDir, cb, version) {
  dir = userDataDir;
  if (version) appVersion = String(version);
  if (cb) onChange = cb;
  load();
  // Hasta saber algo, se parte de lo guardado: si estaba activa y sin clave, cerrado.
  if (saved.enabled === true && !(saved.key && saved.validatedAt)) status = { state: 'locked', name: '', reason: 'need-key' };
  const run = () => evaluate(null).catch(() => {});
  const first = run();
  timer = setInterval(run, RECHECK_MS);
  if (timer.unref) timer.unref();
  // Lo del capitán se mira cada minuto (avisos urgentes, bajas, versión mínima)…
  const poll = async () => { if (lastList && await refreshAdmin()) await evaluate(null, { skipGithub: true }); };
  const t2 = setInterval(() => { poll().catch(() => {}); }, ADMIN_POLL_MS);
  // …y cada medio minuto se recalcula qué aviso toca según la hora, sin red.
  const t3 = setInterval(() => { if (lastList) set({ ...status }); }, NOTICE_TICK_MS);
  if (t2.unref) t2.unref();
  if (t3.unref) t3.unref();
  return first;
}

const get = () => status;
const isLocked = () => status.state === 'locked';
const submit = async (key) => { await evaluate(String(key || '')); return status; };
const recheck = async () => { await evaluate(null); return status; };

/** Clave guardada de esta persona (sólo si entró con una válida). */
const getKey = () => (status.state === 'ok' && saved.key && saved.enabled ? saved.key : '');
const getRoster = () => roster;
const presenceUrl = () => presence;

/** Copia de lo que rige hoy (para el panel del capitán). */
const getEffective = () => JSON.parse(JSON.stringify({
  enabled: eff.enabled, users: eff.users, notices: eff.notices, minVersion: eff.minVersion, minMessage: eff.minMessage,
  seq: eff.seq, source: eff.source, captains: eff.captains
}));
const isCaptain = () => !!status.captain;
/** El capitán acaba de publicar: se adopta al instante, sin esperar el próximo minuto. */
async function adoptAdmin(raw) {
  if (!lastList) return;
  saved.admin = { p: raw.p, s: raw.s };
  persist();
  rebuild(lastList);
  await evaluate(null, { skipGithub: true });
}

module.exports = { getEffective, isCaptain, adoptAdmin, getKey, getRoster, presenceUrl, init, get, isLocked, submit, recheck, hashKey, normalize, ACCESS_URL };
