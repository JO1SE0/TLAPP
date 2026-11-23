'use strict';

/**
 * «Sacar» a alguien en el momento (desde el panel del admin).
 *
 * El admin deja en Firebase `kicks/<pid> = { m, w, t, s }`:
 *   m = 'room' (lo saca de la sala) o 'app' (le cierra la app),
 *   w = motivo (puede ir vacío), t = hora, s = firma del admin.
 * La app de esa persona escucha su propio `kicks/<pid>` en vivo (una conexión
 * que no gasta nada mientras no pasa nada). Sólo obedece si la firma es de un
 * admin de access.json y la orden es reciente; después la borra.
 * No toca la clave ni el acceso: puede volver a entrar cuando quiera.
 */

const fs = require('fs');
const path = require('path');
const identity = require('./identity');
const presence = require('./presence');
const access = require('./access');

const FRESH_MS = 10 * 60 * 1000; // una orden vieja (app apagada) no se cumple
const textOf = (pid, m, w, t) => `kick|${pid}|${m}|${w}|${t}`;
const clean = (v, n) => String(v || '').replace(/[\r\n|]/g, ' ').trim().slice(0, n);

/* ── Lado del admin ── */
async function send(name, mode, why) {
  if (!access.isCaptain()) throw new Error('Sólo el admin puede hacer esto.');
  const url = presence.cleanUrl(access.presenceUrl());
  const key = access.getKey();
  if (!url || !key) throw new Error('No hay conexión con la base de datos del club.');
  const u = (access.getEffective().users || []).find((x) => String(x.name).toLowerCase() === String(name || '').toLowerCase());
  if (!u || !u.pub) throw new Error('No encontré a esa persona.');
  const me = identity.fromKey(key);
  if (String(u.pub).toLowerCase() === me.pub) throw new Error('No te podés sacar a vos mismo.');
  const pid = identity.pidOf(u.pub);
  const m = mode === 'app' ? 'app' : 'room';
  const w = clean(why, 120);
  const t = Date.now();
  await presence.call(`${url}/kicks/${pid}.json`, 'PUT', { m, w, t, s: me.sign(textOf(pid, m, w, t)) });
  return { name: u.name, mode: m };
}

/* ── Lado de quien recibe ── */
let dir = '';
let onKick = () => {};
let live = null; // { pid, base, stop, timer, wait, dead }
let lastT = 0;

const memo = () => path.join(dir, 'ultima-salida.json');
function loadLast() { try { lastT = Number(JSON.parse(fs.readFileSync(memo(), 'utf8')).t) || 0; } catch { lastT = 0; } }
function saveLast(t) { lastT = t; try { fs.writeFileSync(memo(), JSON.stringify({ t })); } catch { /* sin disco */ } }

function check(base, pid, rec) {
  if (!rec || typeof rec !== 'object') return;
  const m = rec.m === 'app' ? 'app' : rec.m === 'room' ? 'room' : '';
  const t = Number(rec.t);
  if (!m || !Number.isFinite(t) || typeof rec.s !== 'string') return;
  if (t <= lastT || Math.abs(Date.now() - t) > FRESH_MS) return;
  const w = clean(rec.w, 120);
  const captains = (access.getEffective().captains || []);
  if (!captains.some((pub) => identity.verify(pub, textOf(pid, m, w, t), rec.s))) return;
  saveLast(t);
  presence.call(`${base}/kicks/${pid}.json`, 'DELETE').catch(() => {});
  try { onKick({ mode: m, why: w }); } catch { /* el que escucha se cuida solo */ }
}

function stop() {
  if (!live) return;
  live.dead = true;
  clearTimeout(live.timer);
  try { if (live.stop) live.stop(); } catch { /* ya estaba */ }
  live = null;
}

function listen(base, pid) {
  if (live && live.pid === pid && live.base === base) return;
  stop();
  const me = { pid, base, stop: null, timer: null, wait: 3000, dead: false, rec: null };
  live = me;
  const connect = () => {
    if (me.dead) return;
    const feed = presence.sseParser((ev, raw) => {
      if (ev !== 'put' && ev !== 'patch') return;
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      me.rec = presence.applyEvent(me.rec || {}, ev, msg && msg.path, msg && msg.data);
      me.wait = 3000;
      check(base, pid, me.rec);
    });
    me.stop = presence.netOpen(`${base}/kicks/${pid}.json`, feed, () => {
      if (me.dead) return;
      me.timer = setTimeout(connect, me.wait);
      me.wait = Math.min(60000, me.wait * 2);
    });
  };
  connect();
}

/** Se llama al arrancar y cada vez que cambia el acceso: escucha con la clave vigente. */
function sync() {
  if (!dir) return; // todavía no arrancó (init)
  const base = presence.cleanUrl(access.presenceUrl());
  const key = access.getKey();
  if (!base || !key) { stop(); return; }
  let pid;
  try { pid = identity.fromKey(key).pid; } catch { stop(); return; }
  listen(base, pid);
}

function init(userDataDir, cb) {
  dir = userDataDir;
  if (cb) onKick = cb;
  loadLast();
  sync();
}

module.exports = { init, sync, stop, send, textOf, _check: check };
