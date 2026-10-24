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
let noLooks = false;
let noLooksUntil = 0;
let looksIssue = '';
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
 * Aspecto de la fila (degradado y fuente) que viaja en el casillero.
 *
 * Sólo ids de listas cerradas: lo dibuja la pantalla de OTRA persona. Van con
 * una segunda firma (`cs`) y no dentro de `s`, para que las versiones viejas,
 * que sólo conocen `s`, sigan verificando el casillero igual.
 * Las listas son las mismas que `PEER_GRADIENTS` y `PEER_FONTS` del preload.
 */
const GRADIENTS = new Set(['violeta', 'oceano', 'esmeralda', 'fuego', 'rubi', 'rosa', 'oro', 'medianoche']);
const FONTS = new Set(['outfit', 'mono', 'serif', 'round', 'impact']);
const looksText = (fp, nick, t, g, f) => `${fp}|${nick}|${t}|${g}|${f}`;
/* Forma de la fila y ícono: otra firma aparte (`xs`) para no romper a las versiones que sólo conocen `cs`. */
const STYLES = new Set(['glass', 'solid', 'outline', 'neon', 'bar', 'minimal']);
const ICONS = new Set(['⚡', '🔥', '👑', '⭐', '🎯', '🧤', '🐐', '🦁', '🐺', '🚀', '💀', '🍀']);
const looksText2 = (fp, nick, t, y, i) => `looks2|${fp}|${nick}|${t}|${y}|${i}`;
function cleanLooks2(c) {
  return { y: c && STYLES.has(c.y) && c.y !== 'glass' ? c.y : '', i: c && ICONS.has(c.i) ? c.i : '' };
}
function cleanLooks(c) {
  const g = c && GRADIENTS.has(c.g) ? c.g : '';
  const f = c && FONTS.has(c.f) ? c.f : '';
  return { g, f };
}

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
    const meEntry = (ctx.roster || []).find((u) => u && u.pub && /^[0-9a-f]{64}$/i.test(u.pub) && identity.pidOf(u.pub) === id.pid);
  // Los socios no dejan casillero: nadie los ve con la insignia. Sí miran la sala, así ven las insignias
  // y el recuadro dorado de los del club, y ellos mismos se ven con su recuadro (sin el logo).
  const iAmSocio = !!(meEntry && (meEntry.soc || meEntry.ext));
  if (!ctx.fp || !ctx.nick) { why = `sin sala o sin nick (sala=${ctx.fp ? 'sí' : 'no'}, nick=${ctx.nick ? 'sí' : 'no'})`; return null; }
  why = '';
  lastFp = ctx.fp;

  const t = Date.now();
  const nick = String(ctx.nick).slice(0, 40);
  const mine = cleanLooks({ g: ctx.cosmetics && ctx.cosmetics.gradient, f: ctx.cosmetics && ctx.cosmetics.font });
  const mine2 = cleanLooks2({ y: ctx.cosmetics && ctx.cosmetics.style, i: ctx.cosmetics && ctx.cosmetics.icon });
  if (iAmSocio) {
    call(`${base}/rooms/${ctx.fp}/${id.pid}.json`, 'DELETE').catch(() => {});
  } else {
    const slot = { n: nick, t, s: id.sign(signedText(ctx.fp, nick, t)) };
    if (noLooks && Date.now() > noLooksUntil) noLooks = false; // se vuelve a probar cada tanto
    const withLooks = !noLooks && (mine.g || mine.f || mine2.y || mine2.i);
    if (withLooks) {
      slot.c = mine; slot.cs = id.sign(looksText(ctx.fp, nick, t, mine.g, mine.f));
      if (mine2.y || mine2.i) { slot.x = mine2; slot.xs = id.sign(looksText2(ctx.fp, nick, t, mine2.y, mine2.i)); }
    }
    try {
      await call(`${base}/rooms/${ctx.fp}/${id.pid}.json`, 'PUT', slot);
      if (withLooks) looksIssue = '';
    } catch (err) {
      if (!withLooks) throw err;
      // Primero se prueba el casillero simple. Si TAMBIÉN falla, fue la red (no las reglas) y se reintenta
      // en el próximo latido con el aspecto; sólo si el simple pasa se concluye que la base rechaza los campos extra.
      await call(`${base}/rooms/${ctx.fp}/${id.pid}.json`, 'PUT', { n: nick, t, s: slot.s });
      noLooks = true;
      noLooksUntil = Date.now() + 10 * 60000;
      looksIssue = `la base rechazó el aspecto de la fila (${String(err && err.message).slice(0, 80)}): los demás no lo van a ver hasta que las reglas permitan los campos c, cs, x y xs`;
    }
  }
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
    if (!member || member.trial || member.ext || member.soc) continue;
    if (typeof entry.n !== 'string' || typeof entry.t !== 'number' || typeof entry.s !== 'string') continue;
    if (!identity.verify(member.pub, signedText(ctx.fp, entry.n, entry.t), entry.s)) continue;
    const k = `${ctx.fp}|${pid}`;
    const prev = seen.get(k);
    if (!prev || prev.t !== entry.t) seen.set(k, { t: entry.t, at: now });
    if (now - seen.get(k).at > ALIVE_MS) continue;
    let look = { gradient: 'oro' };
    if (entry.c && typeof entry.c === 'object' && typeof entry.cs === 'string') {
      const c = cleanLooks(entry.c);
      if (identity.verify(member.pub, looksText(ctx.fp, entry.n, entry.t, c.g, c.f), entry.cs)) {
        look = { gradient: c.g || 'oro', font: c.f || null };
        if (entry.x && typeof entry.x === 'object' && typeof entry.xs === 'string') {
          const c2 = cleanLooks2(entry.x);
          if (identity.verify(member.pub, looksText2(ctx.fp, entry.n, entry.t, c2.y, c2.i), entry.xs)) {
            look.style = c2.y || null; look.icon = c2.i || null;
          }
        }
      }
    }
    peers.push({ nick: entry.n, name: member.name, vip: false, cosmetics: look });
  }
  // Se olvidan los que ya no aparecen.
  for (const k of seen.keys()) if (k.startsWith(`${ctx.fp}|`) && !(k.slice(ctx.fp.length + 1) in room)) seen.delete(k);

  // Uno mismo, para que la fila propia también lleve el aura del plantel.
  const selfEntry = byPid.get(id.pid);
  if (iAmSocio) peers.push({ nick, self: true, name: '', noLogo: true, vip: false, cosmetics: { gradient: 'oro' } });
  else if (!(selfEntry && selfEntry.trial)) peers.push({ nick, self: true, name: ctx.selfName || '', vip: false, cosmetics: { gradient: 'oro' } });
  return { everyMs: EVERY_MS, peers };
}

/** Por qué el aspecto no viaja (vacío = todo bien). */
const looksProblem = () => looksIssue;

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
        out.push({ name: u.name, room: alive ? r : '', lastRoom: r, version: self ? clean(ctx.version, 20) : v, lastSeen: self ? Date.now() : e.t, online: alive, self, trial: !!u.trial, rep: !!u.rep, host: !!u.host, ext: !!u.ext, soc: !!u.soc });
        continue;
      }
    }
    out.push({ name: u.name, room: '', lastRoom: '', version: self ? clean(ctx.version, 20) : '', lastSeen: self ? Date.now() : 0, online: self, self, trial: !!u.trial, rep: !!u.rep, host: !!u.host, ext: !!u.ext, soc: !!u.soc });
  }
  // Los ajenos al club los ve sólo el admin; y ellos no ven a nadie más que a sí mismos.
  const mineEntry = (ctx.roster || []).find((u) => u && /^[0-9a-f]{64}$/i.test(u.pub || '') && identity.pidOf(u.pub) === id.pid);
  const iAmExternal = !!(mineEntry && mineEntry.ext);
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (iAmExternal ? !m.self : ((m.ext || m.soc) && !m.self && !ctx.captain)) out.splice(i, 1);
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
    if (u.ext && !ctx.captain) continue; // los ajenos al club sólo los ve el admin
    if (u.soc) continue; // los socios no suman en el ranking de nadie
    const pid = identity.pidOf(u.pub);
    const e = data[pid];
    if (!e || typeof e !== 'object' || typeof e.sig !== 'string') continue;
    const [g, a, o, m, s] = [num(e.g), num(e.a), num(e.o), num(e.m), num(e.s)];
    const t = Number(e.t) || 0;
    if (!identity.verify(u.pub, statsText(g, a, o, m, s, t), e.sig)) continue;
    out.push({ name: u.name, goals: g, assists: a, ownGoals: o, matches: m, seconds: s, updated: t, self: pid === id.pid, ext: !!u.ext });
  }
  return out;
}

module.exports = { looksProblem, putStats, readStats, call, online, leaveOnline, why: () => why, leave, beat, cleanUrl, signedText, EVERY_MS, ALIVE_MS };
