'use strict';

/**
 * «Los reyes del x7»: los partidos de los internos, compartidos con todo el club.
 *
 * Quien hostea un interno firma cada partido con su identidad (la misma de la
 * presencia) y lo sube a `interno/<id>.json`. Todos leen la carpeta entera y
 * sólo cuentan los partidos firmados por alguien con permiso de hostear, así
 * que nadie de afuera puede inventar resultados. Cada partido se escribe una
 * sola vez (el id sale de su contenido) y no se puede pisar.
 *
 * Si no hay red, el partido espera en una cola en disco y sale en el próximo
 * intento. Sin dependencias de Electron: recibe todo lo que necesita.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const identity = require('./identity');
const presence = require('./presence');

const MAX_PLAYERS = 40;
const clip = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Lo que se firma y sube: sólo números y nombres, nada más. */
function compact(match) {
  const players = (Array.isArray(match && match.players) ? match.players : []).slice(0, MAX_PLAYERS).map((p) => ({
    n: cleanName(p.n), t: p.t === 1 ? 1 : 0, g: clip(p.g, 99), a: clip(p.a, 99), o: clip(p.o, 99), w: p.w ? 1 : 0
  })).filter((p) => p.n);
  const winner = match && (match.winner === 'red' || match.winner === 'blue') ? match.winner : 'draw';
  return {
    at: clip(match && match.at, 9e15), r: clip(match && match.red, 99), b: clip(match && match.blue, 99),
    s: clip(match && match.seconds, 36000), x: String((match && match.mode) || 'x7').slice(0, 4), w: winner, p: players
  };
}

/** Lo que vuelve de la base: se revisa campo por campo, no se confía en la forma. */
function restore(raw) {
  const p = (Array.isArray(raw && raw.p) ? raw.p : []).slice(0, MAX_PLAYERS).map((q) => ({
    n: cleanName(q && q.n), t: q && q.t === 1 ? 1 : 0, g: clip(q && q.g, 99), a: clip(q && q.a, 99), o: clip(q && q.o, 99), w: q && q.w ? 1 : 0
  })).filter((q) => q.n);
  return { at: clip(raw && raw.at, 9e15), r: clip(raw && raw.r, 99), b: clip(raw && raw.b, 99), s: clip(raw && raw.s, 36000),
    x: String((raw && raw.x) || 'x7').slice(0, 4), w: raw && (raw.w === 'red' || raw.w === 'blue') ? raw.w : 'draw', p };
}

const signedText = (id, d) => `interno|${id}|${d}`;
const idOf = (pid, d) => crypto.createHash('sha256').update(`${pid}|${d}`).digest('hex').slice(0, 24);

function queueFile(dir) { return path.join(dir, 'interno-pendientes.json'); }
function loadQueue(dir) {
  try { const q = JSON.parse(fs.readFileSync(queueFile(dir), 'utf8')); return Array.isArray(q) ? q : []; } catch { return []; }
}
function saveQueue(dir, q) {
  try { fs.writeFileSync(queueFile(dir), JSON.stringify(q.slice(-200))); } catch { /* sin disco: se pierde sólo la cola */ }
}

/** Firma y encola el partido, y trata de mandar todo lo pendiente. */
async function submit(ctx, match) {
  const d = JSON.stringify(compact(match));
  const idn = identity.fromKey(ctx.key);
  const id = idOf(idn.pid, d);
  const doc = { t: Date.now(), by: idn.pid, d, sig: idn.sign(signedText(id, d)) };
  const q = loadQueue(ctx.dir);
  if (!q.some((x) => x.id === id)) q.push({ id, doc });
  saveQueue(ctx.dir, q);
  return flush(ctx);
}

async function flush(ctx) {
  const base = presence.cleanUrl(ctx && ctx.url);
  const q = loadQueue(ctx.dir);
  if (!base || !ctx.key || !q.length) return { sent: 0, pending: q.length };
  const left = [];
  let sent = 0;
  for (const item of q) {
    try {
      const had = await presence.call(`${base}/interno/${item.id}.json`, 'GET').catch(() => undefined);
      if (had === null || had === undefined) await presence.call(`${base}/interno/${item.id}.json`, 'PUT', item.doc);
      sent++;
    } catch { left.push(item); }
  }
  saveQueue(ctx.dir, left);
  return { sent, pending: left.length };
}

/** ctx = { url, hostPubs:Set }. → { kings:[…], matches, last:[…] } o null. */
async function read(ctx) {
  const base = presence.cleanUrl(ctx && ctx.url);
  if (!base) return null;
  const data = (await presence.call(`${base}/interno.json`, 'GET').catch(() => null)) || {};
  const pubs = new Map();
  for (const pub of ctx.hostPubs || []) if (/^[0-9a-f]{64}$/i.test(pub)) pubs.set(identity.pidOf(pub), pub);
  const table = new Map();
  const list = [];
  for (const [id, doc] of Object.entries(data)) {
    if (!doc || typeof doc.d !== 'string' || typeof doc.sig !== 'string') continue;
    const pub = pubs.get(doc.by);
    if (!pub || !identity.verify(pub, signedText(id, doc.d), doc.sig)) continue;
    let m;
    try { m = restore(JSON.parse(doc.d)); } catch { continue; }
    if (idOf(doc.by, doc.d) !== id) continue;
    list.push(m);
    for (const p of m.p) {
      const k = fold(p.n);
      const r = table.get(k) || { name: p.n, wins: 0, goals: 0, assists: 0, matches: 0, last: 0 };
      r.goals += p.g; r.assists += p.a; r.matches++;
      if (p.w) r.wins++;
      if (m.at >= r.last) { r.last = m.at; r.name = p.n; }
      table.set(k, r);
    }
  }
  const kings = Array.from(table.values()).sort((x, y) => y.wins - x.wins || y.goals - x.goals || y.assists - x.assists || x.name.localeCompare(y.name));
  list.sort((x, y) => y.at - x.at);
  return { kings, matches: list.length, last: list.slice(0, 8).map((m) => ({ at: m.at, red: m.r, blue: m.b, winner: m.w, mode: m.x, seconds: m.s })) };
}

module.exports = { submit, flush, read, compact };
