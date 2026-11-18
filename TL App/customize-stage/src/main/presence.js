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
const STYLES = new Set(['glass', 'solid', 'outline', 'neon', 'bar', 'minimal', 'galaxia', 'lujo', 'pincel', 'marmol', 'acuarela', 'acuanoche', 'humo']);
const ICONS = new Set(['⚡', '🔥', '👑', '⭐', '🎯', '🧤', '🐐', '🦁', '🐺', '🚀', '💀', '🍀']);
const looksText2 = (fp, nick, t, y, i) => `looks2|${fp}|${nick}|${t}|${y}|${i}`;
/*
 * Estilo de ficha: viaja en `d` con su propia firma (`ds`), aparte de todo lo
 * anterior, así las versiones que no lo conocen siguen leyendo el casillero.
 * Sólo nombres de la lista cerrada: el que lo dibuja es el cliente del otro.
 */
const DISCS = new Set(['sphere', 'glass', 'neon', 'metal', 'bubble', 'target', 'stripes', 'gem', 'cartoon', 'dots', ...require('./disc-art').STYLES]);
/* `a` = la versión de su foto de avatar (ver «Fotos de avatar» abajo). Una sola firma para los dos. */
const discText = (fp, nick, t, d, a) => `disc|${fp}|${nick}|${t}|${d}|${a}`;
const cleanDisc = (d) => (typeof d === 'string' && DISCS.has(d) ? d : '');
const cleanHash = (h) => (typeof h === 'string' && /^[0-9a-f]{16}$/.test(h) ? h : '');
let noDisc = false;
let noDiscUntil = 0;
/** La sala que se está escuchando en vivo (ver «Escucha en vivo»). */
let live = null;
function cleanLooks2(c) {
  return { y: c && STYLES.has(c.y) ? c.y : '', i: c && ICONS.has(c.i) ? c.i : '' };
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
  // Los ajenos al club (ext sin soc) no dejan casillero: nadie los ve. Los SOCIOS sí, con su fila
  // personalizada como cualquiera del plantel, pero sin el escudo de TL (eso es del plantel).
  // Ojo: en el roster `ext` y `soc` vienen juntos para los socios (ver access.js).
  const iAmSocio = !!(meEntry && meEntry.soc);
  const iAmExternal = !!(meEntry && meEntry.ext) && !iAmSocio;
  if (!ctx.fp || !ctx.nick) { why = `sin sala o sin nick (sala=${ctx.fp ? 'sí' : 'no'}, nick=${ctx.nick ? 'sí' : 'no'})`; return null; }
  why = '';
  lastFp = ctx.fp;

  const t = Date.now();
  const nick = String(ctx.nick).slice(0, 40);
  const mine = cleanLooks({ g: ctx.cosmetics && ctx.cosmetics.gradient, f: ctx.cosmetics && ctx.cosmetics.font });
  const mine2 = cleanLooks2({ y: ctx.cosmetics && ctx.cosmetics.style, i: ctx.cosmetics && ctx.cosmetics.icon });
  const myDisc = cleanDisc(ctx.cosmetics && ctx.cosmetics.disc);
  const myAvatar = cleanHash(ctx.cosmetics && ctx.cosmetics.avatar);
  if (iAmExternal) {
    call(`${base}/rooms/${ctx.fp}/${id.pid}.json`, 'DELETE').catch(() => {});
  } else {
    const slot = { n: nick, t, s: id.sign(signedText(ctx.fp, nick, t)) };
    if (noLooks && Date.now() > noLooksUntil) noLooks = false; // se vuelve a probar cada tanto
    const withLooks = !noLooks && (mine.g || mine.f || mine2.y || mine2.i);
    if (withLooks) {
      slot.c = mine; slot.cs = id.sign(looksText(ctx.fp, nick, t, mine.g, mine.f));
      if (mine2.y || mine2.i) { slot.x = mine2; slot.xs = id.sign(looksText2(ctx.fp, nick, t, mine2.y, mine2.i)); }
    }
    if (noDisc && Date.now() > noDiscUntil) noDisc = false;
    const withDisc = !noDisc && !!(myDisc || myAvatar);
    if (withDisc) {
      if (myDisc) slot.d = myDisc;
      if (myAvatar) slot.a = myAvatar;
      slot.ds = id.sign(discText(ctx.fp, nick, t, myDisc, myAvatar));
    }
    try {
      await call(`${base}/rooms/${ctx.fp}/${id.pid}.json`, 'PUT', slot);
      if (withLooks) looksIssue = '';
    } catch (err) {
      // Si la base todavía no acepta el estilo de ficha, se prueba sin él y se
      // sigue como siempre: lo demás del casillero no se pierde.
      if (withDisc) {
        delete slot.d; delete slot.a; delete slot.ds;
        try {
          await call(`${base}/rooms/${ctx.fp}/${id.pid}.json`, 'PUT', slot);
          noDisc = true;
          noDiscUntil = Date.now() + 10 * 60000;
          looksIssue = `la base rechazó el estilo de ficha (${String(err && err.message).slice(0, 80)}): los demás no lo van a ver hasta que las reglas permitan los campos d, a y ds`;
          err = null;
        } catch (err2) { err = err2; }
      }
      if (err) {
        if (!withLooks) throw err;
        // Primero se prueba el casillero simple. Si TAMBIÉN falla, fue la red (no las reglas) y se reintenta
        // en el próximo latido con el aspecto; sólo si el simple pasa se concluye que la base rechaza los campos extra.
        await call(`${base}/rooms/${ctx.fp}/${id.pid}.json`, 'PUT', { n: nick, t, s: slot.s });
        noLooks = true;
        noLooksUntil = Date.now() + 10 * 60000;
        looksIssue = `la base rechazó el aspecto de la fila (${String(err && err.message).slice(0, 80)}): los demás no lo van a ver hasta que las reglas permitan los campos c, cs, x y xs`;
      }
    }
  }
  // Si la sala se está escuchando en vivo, ya está acá: no hace falta pedirla.
  const room = live && live.fp === ctx.fp && live.room ? live.room
    : ((await call(`${base}/rooms/${ctx.fp}.json`, 'GET')) || {});
  return { everyMs: EVERY_MS, peers: peersFromRoom(room, ctx, base, id, nick, iAmExternal, iAmSocio) };
}

/**
 * Del contenido de la sala a la lista de peers. Sólo cuenta lo firmado por
 * alguien del plantel con su propia clave.
 */
/*
 * Con la sala en vivo, cada aviso de cualquiera vuelve a armar la lista entera.
 * Una firma ya verificada no cambia: se recuerda el resultado y no se vuelve a
 * hacer la cuenta (0,14 ms cada una, unas 3 por persona y por aviso).
 */
const verified = new Map();
function verifyOnce(pub, text, sig) {
  const k = `${pub}|${sig}|${text}`;
  const hit = verified.get(k);
  if (hit !== undefined) return hit;
  const ok = identity.verify(pub, text, sig);
  verified.set(k, ok);
  if (verified.size > 600) verified.delete(verified.keys().next().value);
  return ok;
}

function peersFromRoom(room, ctx, base, id, nick, iAmExternal, iAmSocio) {

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
    // Las claves de prueba no son del plantel: no llevan insignia ni aura. Los ajenos tampoco.
    if (!member || member.trial || (member.ext && !member.soc)) continue;
    if (typeof entry.n !== 'string' || typeof entry.t !== 'number' || typeof entry.s !== 'string') continue;
    if (!verifyOnce(member.pub, signedText(ctx.fp, entry.n, entry.t), entry.s)) continue;
    const k = `${ctx.fp}|${pid}`;
    const prev = seen.get(k);
    if (!prev || prev.t !== entry.t) seen.set(k, { t: entry.t, at: now });
    if (now - seen.get(k).at > ALIVE_MS) continue;
    // Sin degradado elegido: dorado el plantel, plateado (medianoche) el socio.
    const baseG = member.soc ? 'medianoche' : 'oro';
    let look = { gradient: baseG };
    if (entry.c && typeof entry.c === 'object' && typeof entry.cs === 'string') {
      const c = cleanLooks(entry.c);
      if (verifyOnce(member.pub, looksText(ctx.fp, entry.n, entry.t, c.g, c.f), entry.cs)) {
        look = { gradient: c.g || baseG, font: c.f || null };
        if (entry.x && typeof entry.x === 'object' && typeof entry.xs === 'string') {
          const c2 = cleanLooks2(entry.x);
          if (verifyOnce(member.pub, looksText2(ctx.fp, entry.n, entry.t, c2.y, c2.i), entry.xs)) {
            look.style = c2.y || null; look.icon = c2.i || null;
          }
        }
      }
    }
    // Su estilo de ficha y la versión de su foto, si vienen firmados por él.
    const d = cleanDisc(entry.d), av = cleanHash(entry.a);
    if ((d || av) && typeof entry.ds === 'string' && verifyOnce(member.pub, discText(ctx.fp, entry.n, entry.t, d, av), entry.ds)) {
      if (d) look.disc = d;
      if (av) look.avatar = av;
    }
    // Socio: su fila como la eligió y su distintivo de socio, pero sin el escudo del plantel.
    if (member.soc) { peers.push({ nick: entry.n, pid, name: member.name, soc: true, noLogo: true, vip: false, cosmetics: look }); continue; }
    peers.push({ nick: entry.n, pid, name: member.name, vip: false, cosmetics: look });
  }
  // Se olvidan los que ya no aparecen.
  for (const k of seen.keys()) if (k.startsWith(`${ctx.fp}|`) && !(k.slice(ctx.fp.length + 1) in room)) seen.delete(k);

  // Uno mismo, para que la fila propia también lleve el aura del plantel.
  const selfEntry = byPid.get(id.pid);
  if (iAmExternal) peers.push({ nick, self: true, name: '', noLogo: true, vip: false, cosmetics: { gradient: 'oro' } });
  else if (iAmSocio) peers.push({ nick, self: true, name: (selfEntry && selfEntry.name) || ctx.selfName || '', soc: true, noLogo: true, vip: false, cosmetics: { gradient: 'medianoche' } });
  else if (!(selfEntry && selfEntry.trial)) peers.push({ nick, self: true, name: ctx.selfName || '', vip: false, cosmetics: { gradient: 'oro' } });
  return peers;
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
        out.push({ name: u.name, room: alive ? r : '', lastRoom: r, version: self ? clean(ctx.version, 20) : v, lastSeen: self ? Date.now() : e.t, online: alive, self, trial: !!u.trial, rep: !!u.rep, host: !!u.host, ext: !!u.ext, soc: !!u.soc, voz: !!u.voz });
        continue;
      }
    }
    out.push({ name: u.name, room: '', lastRoom: '', version: self ? clean(ctx.version, 20) : '', lastSeen: self ? Date.now() : 0, online: self, self, trial: !!u.trial, rep: !!u.rep, host: !!u.host, ext: !!u.ext, soc: !!u.soc, voz: !!u.voz });
  }
  // Los ajenos al club los ve sólo el admin; y ellos no ven a nadie más que a sí mismos.
  // Los socios los ve todo el plantel.
  const mineEntry = (ctx.roster || []).find((u) => u && /^[0-9a-f]{64}$/i.test(u.pub || '') && identity.pidOf(u.pub) === id.pid);
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    // Los socios ahora ven al plantel conectado (y el plantel a ellos, con su marca de socio).
    if (m.ext && !m.soc && !m.self && !ctx.captain) out.splice(i, 1);
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

/* ── Escucha en vivo ─────────────────────────────────────────────────────
 *
 * En vez de pedir la sala entera cada 25 s, se deja una conexión abierta con
 * Firebase («server-sent events» de su API REST): avisa en el acto cuando algo
 * cambia y manda SÓLO lo que cambió. Un estilo o una foto nueva llega en ~1 s
 * y se gasta menos que preguntando.
 *
 * El latido de 25 s sigue, pero sólo para escribir «sigo acá»: mientras haya
 * escucha no vuelve a pedir la sala. Si la conexión se corta, se reintenta sola
 * (3 s, 6 s… hasta 30 s) y mientras tanto el latido la pide como antes.
 */

/** Aplica un evento de Firebase (`put` o `patch` en `path`) a la copia local. */
function applyEvent(root, kind, path, data) {
  const keys = String(path || '/').split('/').filter(Boolean);
  if (!keys.length) {
    if (kind === 'put') return data && typeof data === 'object' ? data : {};
    return Object.assign(root || {}, data || {});
  }
  const top = root && typeof root === 'object' ? root : {};
  let o = top;
  for (const k of keys.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  const last = keys[keys.length - 1];
  if (kind === 'put') { if (data === null) delete o[last]; else o[last] = data; }
  else { if (!o[last] || typeof o[last] !== 'object') o[last] = {}; Object.assign(o[last], data || {}); }
  return top;
}

/** Corta el texto que llega en eventos completos (`event:` + `data:`, separados por una línea en blanco). */
function sseParser(onEvent) {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let ev = '', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (ev) onEvent(ev, data);
    }
  };
}

/** Abre la conexión con la red de Electron (el `fetch` de este proceso no deja leer de a pedazos). */
function netOpen(url, onChunk, onEnd) {
  const { net } = require('electron');
  let done = false;
  const end = (why) => { if (!done) { done = true; onEnd(why); } };
  const req = net.request({ url, method: 'GET', redirect: 'follow' });
  req.setHeader('Accept', 'text/event-stream');
  req.on('response', (res) => {
    if (res.statusCode !== 200) { end(`HTTP ${res.statusCode}`); return; }
    res.on('data', (b) => onChunk(b.toString('utf8')));
    res.on('end', () => end('se cerró'));
    res.on('error', (e) => end(e && e.message));
  });
  req.on('error', (e) => end(e && e.message));
  req.end();
  return () => { done = true; try { req.abort(); } catch { /* ya estaba */ } };
}

/**
 * Escucha `rooms/<fp>` en vivo. `onChange()` se llama (agrupado, ~150 ms) cada
 * vez que cambia algo. Con otra sala o sin sala, se corta la anterior.
 * `open` se puede cambiar (pruebas).
 */
function watchRoom(url, fp, onChange, open = netOpen) {
  const base = cleanUrl(url);
  if (live && live.fp === fp && live.base === base) return;
  stopWatch();
  if (!base || !fp) return;
  const me2 = { fp, base, room: null, stop: null, wait: 3000, timer: null, notify: null, dead: false };
  live = me2;
  const kick = () => {
    if (me2.notify) return;
    me2.notify = setTimeout(() => { me2.notify = null; if (!me2.dead) { try { onChange(); } catch { /* el que escucha se cuida solo */ } } }, 150);
  };
  const connect = () => {
    if (me2.dead) return;
    const feed = sseParser((ev, raw) => {
      if (ev === 'put' || ev === 'patch') {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        me2.room = applyEvent(me2.room || {}, ev, msg && msg.path, msg && msg.data);
        me2.wait = 3000;
        kick();
      } else if (ev === 'cancel' || ev === 'auth_revoked') {
        if (me2.stop) me2.stop();
      }
    });
    me2.stop = open(`${base}/rooms/${fp}.json`, feed, () => {
      if (me2.dead) return;
      // Sin conexión, el latido vuelve a pedir la sala: la copia vieja no sirve.
      me2.room = null;
      me2.timer = setTimeout(connect, me2.wait);
      me2.wait = Math.min(30000, me2.wait * 2);
    });
  };
  connect();
}

function stopWatch() {
  if (!live) return;
  live.dead = true;
  clearTimeout(live.timer);
  clearTimeout(live.notify);
  try { if (live.stop) live.stop(); } catch { /* nada */ }
  live = null;
}

/** Los peers con lo último que llegó en vivo (sin escribir nada). null si no hay escucha lista. */
function peersNow(ctx) {
  const base = cleanUrl(ctx && ctx.url);
  if (!base || !ctx.key || !live || live.fp !== ctx.fp || !live.room) return null;
  let id;
  try { id = idOf(ctx.key); } catch { return null; }
  const meEntry = (ctx.roster || []).find((u) => u && u.pub && /^[0-9a-f]{64}$/i.test(u.pub) && identity.pidOf(u.pub) === id.pid);
  const iAmSocio = !!(meEntry && meEntry.soc);
  const iAmExternal = !!(meEntry && meEntry.ext) && !iAmSocio;
  return peersFromRoom(live.room, ctx, base, id, String(ctx.nick || '').slice(0, 40), iAmExternal, iAmSocio);
}

/* ── Fotos de avatar ─────────────────────────────────────────────────────
 *
 *     avatars/<pid> = { i: foto (JPG 64×64 en data URL), h: su huella, t, s: firma }
 *
 * La huella (16 hex del SHA-256 de la foto) viaja además en el casillero de la
 * sala (`a`): así los demás saben si la que tienen guardada sigue siendo la
 * última y la bajan UNA vez por versión. Se acepta sólo si la firma es de su
 * dueño y la huella coincide con la foto.
 */
const crypto = require('crypto');
const AVATAR_MAX = 12000;
const AVATAR_PREFIX = 'data:image/jpeg;base64,';
const avatarHash = (i) => crypto.createHash('sha256').update(String(i)).digest('hex').slice(0, 16);
const avatarText = (h, t) => `avatar|${h}|${t}`;
const validAvatar = (i) => typeof i === 'string' && i.length <= AVATAR_MAX && i.startsWith(AVATAR_PREFIX) && /^[A-Za-z0-9+/=]+$/.test(i.slice(AVATAR_PREFIX.length));

let avatarUp = ''; // la huella que ya está arriba (en esta sesión)

/** Sube tu foto (o la borra con `null`). Devuelve la huella, o '' si no hay foto. */
async function putAvatar(ctx, data) {
  const base = cleanUrl(ctx && ctx.url);
  if (!base || !ctx.key) return '';
  const id = idOf(ctx.key);
  if (!data) {
    if (avatarUp) { avatarUp = ''; await call(`${base}/avatars/${id.pid}.json`, 'DELETE').catch(() => {}); }
    return '';
  }
  if (!validAvatar(data)) return '';
  const h = avatarHash(data);
  if (h === avatarUp) return h;
  // Si ya estaba arriba (otra sesión), no se vuelve a subir.
  const prev = await call(`${base}/avatars/${id.pid}/h.json`, 'GET').catch(() => null);
  if (prev !== h) {
    const t = Date.now();
    await call(`${base}/avatars/${id.pid}.json`, 'PUT', { i: data, h, t, s: id.sign(avatarText(h, t)) });
  }
  avatarUp = h;
  return h;
}

const avatarCache = new Map(); // pid → { h, data }
const avatarLoading = new Map(); // pid → huella que se está bajando

/**
 * La foto de un peer: de la memoria si es la misma versión; si no, se baja
 * (una vez) y se avisa con `onReady()`. Devuelve la data URL o ''.
 */
function avatarOf(ctx, peer, onReady) {
  const h = peer && peer.cosmetics && peer.cosmetics.avatar;
  if (!h || !peer.pid) return '';
  const hit = avatarCache.get(peer.pid);
  if (hit && hit.h === h) return hit.data;
  if (avatarLoading.get(peer.pid) === h) return '';
  const base = cleanUrl(ctx && ctx.url);
  const member = (ctx.roster || []).find((u) => u && u.pub && /^[0-9a-f]{64}$/i.test(u.pub) && identity.pidOf(u.pub) === peer.pid);
  if (!base || !member) return '';
  avatarLoading.set(peer.pid, h);
  call(`${base}/avatars/${peer.pid}.json`, 'GET').then((e) => {
    if (!e || typeof e !== 'object' || !validAvatar(e.i) || e.h !== h || avatarHash(e.i) !== h) return;
    if (typeof e.s !== 'string' || !identity.verify(member.pub, avatarText(e.h, Number(e.t) || 0), e.s)) return;
    avatarCache.set(peer.pid, { h, data: e.i });
    if (avatarCache.size > 80) avatarCache.delete(avatarCache.keys().next().value);
    if (onReady) onReady();
  }).catch(() => {}).finally(() => { if (avatarLoading.get(peer.pid) === h) avatarLoading.delete(peer.pid); });
  return '';
}

/*
 * Perfil de alguien del club: sus números (stats/<pid>) y dónde anda
 * (online/<pid>). Dos lecturas chicas, sólo cuando se abre el perfil; las dos
 * firmadas por su dueño, si no se descartan.
 */
async function profileOf(ctx, pid) {
  const base = cleanUrl(ctx && ctx.url);
  if (pid === 'self') { try { pid = idOf(ctx.key).pid; } catch { return null; } }
  if (!base || !/^[0-9a-f]{16}$/i.test(String(pid || ''))) return null;
  const member = (ctx.roster || []).find((u) => u && u.pub && /^[0-9a-f]{64}$/i.test(u.pub) && identity.pidOf(u.pub) === pid);
  if (!member) return null;
  const [st, on] = await Promise.all([
    call(`${base}/stats/${pid}.json`, 'GET').catch(() => null),
    call(`${base}/online/${pid}.json`, 'GET').catch(() => null)
  ]);
  const out = { name: member.name, soc: !!member.soc, host: !!member.host, rep: !!member.rep, stats: null, room: '', lastSeen: 0, online: false };
  if (st && typeof st === 'object' && typeof st.sig === 'string') {
    const [g, a, o, m, s] = [num(st.g), num(st.a), num(st.o), num(st.m), num(st.s)];
    const t = Number(st.t) || 0;
    if (identity.verify(member.pub, statsText(g, a, o, m, s, t), st.sig)) out.stats = { goals: g, assists: a, ownGoals: o, matches: m, seconds: s };
  }
  if (on && typeof on === 'object' && typeof on.t === 'number' && typeof on.s === 'string') {
    const r = typeof on.r === 'string' ? on.r : '';
    const v = typeof on.v === 'string' ? on.v : '';
    const x = on.x === 1 ? 1 : 0;
    if (identity.verify(member.pub, onlineText(r, v, x, on.t), on.s)) {
      out.lastSeen = on.t;
      out.online = !x && Math.abs(Date.now() - on.t) <= ONLINE_ALIVE_MS;
      out.room = out.online ? r : '';
    }
  }
  return out;
}

module.exports = { profileOf, watchRoom, stopWatch, peersNow, putAvatar, avatarOf, avatarHash, sseParser, applyEvent, looksProblem, putStats, readStats, call, online, leaveOnline, why: () => why, leave, beat, cleanUrl, signedText, EVERY_MS, ALIVE_MS };
