'use strict';

/**
 * Presencia del plantel: quién más de TL App está en la misma sala.
 *
 * Punto de encuentro: una Realtime Database de Firebase (gratis) cuya dirección
 * viene en `access.json` (campo `presence`). Cada app, mientras está en una sala,
 * escribe un casillero firmado
 *
 *     rooms/<huella de la sala>/<pid> = { n: nick, t: hora, s: firma }
 *
 * y lee los de los demás. Un casillero cuenta SÓLO si la firma coincide con la
 * llave pública que tiene ese pid en la lista del plantel: lo que escriba cualquiera
 * sin la clave se descarta. Lo que viaja es la huella (ilegible) de la sala, el nick
 * y la firma; nunca la clave.
 */

const identity = require('./identity');

const EVERY_MS = 25000;
/** Un casillero sigue vivo mientras su hora siga cambiando: se mide con el reloj PROPIO. */
const ALIVE_MS = 90000;
const PRUNE_MS = 6 * 3600 * 1000;
const TIMEOUT_MS = 8000;
const ALLOWED_HOST = /(^|\.)(firebaseio\.com|firebasedatabase\.app)$/i;

let why = '';
const seen = new Map(); // `${fp}|${pid}` → { t, at }
let lastFp = null;
let me = null; // { key, id } para no derivar de nuevo en cada latido

/** La dirección sólo vale si es https y de Firebase: viene de un archivo público. */
function cleanUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'https:' || !ALLOWED_HOST.test(u.hostname)) return null;
    return `${u.protocol}//${u.host}`;
  } catch { return null; }
}

async function call(url, method, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return method === 'GET' ? await res.json() : null;
  } finally { clearTimeout(timer); }
}

function idOf(key) {
  if (!me || me.key !== key) me = { key, id: identity.fromKey(key) };
  return me.id;
}

const signedText = (fp, nick, t) => `${fp}|${nick}|${t}`;

/**
 * Un latido. `ctx` = { url, key, roster, fp, nick, selfName }.
 *  - url: dirección de la base (access.json)
 *  - key: la clave guardada de ESTA persona
 *  - roster: [{ name, pub }] de access.json
 * Devuelve { everyMs, peers } o null si no hay nada que hacer.
 */
async function beat(ctx) {
  const base = cleanUrl(ctx && ctx.url);
  why = !base ? 'sin dirección de presencia en access.json (todavía no la bajó o no es válida)'
    : !ctx.key ? 'sin clave guardada (no entró con clave válida)' : '';
  if (!base || !ctx.key) return null;
  let id;
  try { id = idOf(ctx.key); } catch { why = 'clave no válida'; return null; }

  // Si se salió de una sala, se retira el casillero de la anterior (si falla, vence solo).
  if (lastFp && lastFp !== ctx.fp) {
    const old = lastFp;
    lastFp = null;
    call(`${base}/rooms/${old}/${id.pid}.json`, 'DELETE').catch(() => {});
  }
  if (!ctx.fp || !ctx.nick) { why = `sin sala o sin nick (sala=${ctx.fp ? 'sí' : 'no'}, nick=${ctx.nick ? 'sí' : 'no'})`; return null; }
  why = '';
  lastFp = ctx.fp;

  const t = Date.now();
  const nick = String(ctx.nick).slice(0, 40);
  await call(`${base}/rooms/${ctx.fp}/${id.pid}.json`, 'PUT', { n: nick, t, s: id.sign(signedText(ctx.fp, nick, t)) });
  const room = (await call(`${base}/rooms/${ctx.fp}.json`, 'GET')) || {};

  const byPid = new Map();
  for (const u of ctx.roster || []) if (u && u.pub && /^[0-9a-f]{64}$/i.test(u.pub)) byPid.set(identity.pidOf(u.pub), u);

  const now = Date.now();
  const peers = [];
  for (const [pid, entry] of Object.entries(room)) {
    if (!entry || typeof entry !== 'object') continue;
    if (pid === id.pid) continue;
    // Casilleros viejísimos de otros: se barren para que la base no crezca.
    if (typeof entry.t === 'number' && now - entry.t > PRUNE_MS) {
      call(`${base}/rooms/${ctx.fp}/${pid}.json`, 'DELETE').catch(() => {});
      continue;
    }
    const member = byPid.get(pid);
    // Las claves de prueba no son del plantel: no llevan insignia ni aura.
    if (!member || member.trial) continue;
    if (typeof entry.n !== 'string' || typeof entry.t !== 'number' || typeof entry.s !== 'string') continue;
    if (!identity.verify(member.pub, signedText(ctx.fp, entry.n, entry.t), entry.s)) continue;
    const k = `${ctx.fp}|${pid}`;
    const prev = seen.get(k);
    if (!prev || prev.t !== entry.t) seen.set(k, { t: entry.t, at: now });
    if (now - seen.get(k).at > ALIVE_MS) continue;
    peers.push({ nick: entry.n, name: member.name, vip: false, cosmetics: { gradient: 'oro' } });
  }
  // Se olvidan los que ya no aparecen.
  for (const k of seen.keys()) if (k.startsWith(`${ctx.fp}|`) && !(k.slice(ctx.fp.length + 1) in room)) seen.delete(k);

  // Uno mismo, para que la fila propia también lleve el aura del plantel.
  const selfEntry = byPid.get(id.pid);
  if (!(selfEntry && selfEntry.trial)) peers.push({ nick, self: true, name: ctx.selfName || '', vip: false, cosmetics: { gradient: 'oro' } });
  return { everyMs: EVERY_MS, peers };
}

/** Al cerrar la app: retira el casillero de la sala actual (si falla, vence solo). */
function leave(ctx) {
  const base = cleanUrl(ctx && ctx.url);
  if (!base || !ctx.key || !lastFp) return;
  try { call(`${base}/rooms/${lastFp}/${idOf(ctx.key).pid}.json`, 'DELETE').catch(() => {}); } catch { /* nada */ }
  lastFp = null;
}

/* ── Plantel en vivo ───────────────────────────────────────────
 * Cada app, esté o no en una sala, deja `online/<pid> = { t, r, v, x, s }`
 * (r = sala o vacío, v = versión de la app, x = 1 si se está yendo) firmado como el
 * resto, y lee los de los demás. Quien tiene firma válida y hora reciente está
 * «en línea»; la hora del último latido queda como «último acceso». */
const ONLINE_ALIVE_MS = 75000;
let onlineMarked = false;

const onlineText = (r, v, x, t) => `online|${r}|${v}|${x}|${t}`;
const clean = (v, n) => String(v || '').replace(/[\r\n]/g, ' ').slice(0, n);

async function putOnline(ctx, x) {
  const base = cleanUrl(ctx && ctx.url);
  if (!base || !ctx.key) return null;
  const id = idOf(ctx.key);
  const t = Date.now();
  const r = clean(ctx.room, 40);
  const v = clean(ctx.version, 20);
  await call(`${base}/online/${id.pid}.json`, 'PUT', { t, r, v, x, s: id.sign(onlineText(r, v, x, t)) });
  return { base, id };
}

/** ctx = { url, key, roster, room, version } → [{ name, room, lastRoom, version, lastSeen, online, self }] o null. */
async function online(ctx) {
  const base = cleanUrl(ctx && ctx.url);
  if (!base || !ctx.key) return null;
  const id = idOf(ctx.key);

  // Primero se lee (así se sabe cuándo fue la última vez de uno mismo) y después se marca presente.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data = {};
  let skew = 0;
  try {
    const res = await fetch(`${base}/online.json`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) || {};
    const d = res.headers && res.headers.get ? Date.parse(res.headers.get('date') || '') : NaN;
    if (isFinite(d)) skew = d - Date.now(); // el reloj de Firebase manda sobre el de esta PC
  } finally { clearTimeout(timer); }
  const mine = data[id.pid];
  const prevSelf = mine && typeof mine.t === 'number' ? mine.t : 0;

  await putOnline(ctx, 0);
  onlineMarked = true;

  const now = Date.now() + skew;
  const out = [];
  for (const u of ctx.roster || []) {
    if (!u || !/^[0-9a-f]{64}$/i.test(u.pub || '')) continue;
    const pid = identity.pidOf(u.pub);
    const self = pid === id.pid;
    const e = data[pid];
    let ok = e && typeof e === 'object' && typeof e.t === 'number' && typeof e.s === 'string';
    if (ok) {
      const r = typeof e.r === 'string' ? e.r : '';
      const v = typeof e.v === 'string' ? e.v : '';
      const x = e.x === 1 ? 1 : 0;
      ok = identity.verify(u.pub, onlineText(r, v, x, e.t), e.s);
      if (ok) {
        const alive = self || (!x && Math.abs(now - e.t) <= ONLINE_ALIVE_MS);
        out.push({ name: u.name, room: alive ? r : '', lastRoom: r, version: self ? clean(ctx.version, 20) : v, lastSeen: self ? Date.now() : e.t, online: alive, self, trial: !!u.trial, rep: !!u.rep });
        continue;
      }
    }
    out.push({ name: u.name, room: '', lastRoom: '', version: self ? clean(ctx.version, 20) : '', lastSeen: self ? Date.now() : 0, online: self, self, trial: !!u.trial, rep: !!u.rep });
  }
  out.sort((a, b) => (b.self - a.self) || (b.online - a.online) || a.name.localeCompare(b.name, 'es'));
  out.prevSelf = prevSelf;
  return out;
}

/** Al cerrar la app: se marca como desconectado (si no llega, vence solo en un minuto). */
function leaveOnline(ctx) {
  if (!onlineMarked) return;
  onlineMarked = false;
  putOnline(ctx, 1).catch(() => {});
}

/* ── Estadísticas del club ───────────────────────────────────────────────────
 * Cada app sube SUS números (los que mide ella: partidos, goles, asistencias,
 * goles en contra y tiempo jugado) a `stats/<pid> = { g, a, o, m, s, t, sig }`,
 * firmados con la misma identidad que la presencia. Todos leen la carpeta
 * entera y sólo cuentan las filas con firma válida de alguien del plantel.
 * Se sube de vez en cuando (al terminar un partido, o al abrir) y nunca baja:
 * si el servidor tiene más que la copia local (reinstalaste), se queda lo más alto. */
const statsText = (g, a, o, m, s, t) => `stats|${g}|${a}|${o}|${m}|${s}|${t}`;
const num = (v) => Math.max(0, Math.min(1e7, Math.round(Number(v) || 0)));

/** ctx = { url, key }, stats = { goals, assists, ownGoals, matches, secondsPlayed } */
async function putStats(ctx, stats) {
  const base = cleanUrl(ctx && ctx.url);
  if (!base || !ctx.key) return false;
  const id = idOf(ctx.key);
  const prev = await call(`${base}/stats/${id.pid}.json`, 'GET').catch(() => null);
  const keep = (mine, theirs) => Math.max(num(mine), num(theirs));
  const g = keep(stats.goals, prev && prev.g);
  const a = keep(stats.assists, prev && prev.a);
  const o = keep(stats.ownGoals, prev && prev.o);
  const m = keep(stats.matches, prev && prev.m);
  const s = keep(stats.secondsPlayed, prev && prev.s);
  const t = Date.now();
  await call(`${base}/stats/${id.pid}.json`, 'PUT', { g, a, o, m, s, t, sig: id.sign(statsText(g, a, o, m, s, t)) });
  return true;
}

/** ctx = { url, key, roster } → [{ name, goals, assists, ownGoals, matches, seconds, self }] o null. */
async function readStats(ctx) {
  const base = cleanUrl(ctx && ctx.url);
  if (!base || !ctx.key) return null;
  const id = idOf(ctx.key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data = {};
  try {
    const res = await fetch(`${base}/stats.json`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) || {};
  } finally { clearTimeout(timer); }
  const out = [];
  for (const u of ctx.roster || []) {
    if (!u || u.trial || !/^[0-9a-f]{64}$/i.test(u.pub || '')) continue;
    const pid = identity.pidOf(u.pub);
    const e = data[pid];
    if (!e || typeof e !== 'object' || typeof e.sig !== 'string') continue;
    const [g, a, o, m, s] = [num(e.g), num(e.a), num(e.o), num(e.m), num(e.s)];
    const t = Number(e.t) || 0;
    if (!identity.verify(u.pub, statsText(g, a, o, m, s, t), e.sig)) continue;
    out.push({ name: u.name, goals: g, assists: a, ownGoals: o, matches: m, seconds: s, updated: t, self: pid === id.pid });
  }
  return out;
}

module.exports = { putStats, readStats, call, online, leaveOnline, why: () => why, leave, beat, cleanUrl, signedText, EVERY_MS, ALIVE_MS };
