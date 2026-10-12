'use strict';

/**
 * Acciones del capitán: cada una arma la lista oficial nueva (acceso, avisos,
 * versión mínima), la firma con la clave del capitán y la deja en Firebase.
 * Las apps de los demás sólo la aceptan si la firma es de un capitán de access.json.
 */

const identity = require('./identity');
const presence = require('./presence');
const access = require('./access');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I
const crypto = require('crypto');

function newKey() {
  const part = () => Array.from(crypto.randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `TL-${part()}-${part()}-${part()}`;
}

const TRIAL_MAX_MIN = 30 * 24 * 60;

const fmtMin = (m) => (m % 1440 === 0 ? `${m / 1440} d` : m % 60 === 0 ? `${m / 60} h` : m > 90 ? `${Math.round(m / 60)} h` : `${m} min`);

const cleanText = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);

const fmtDate = (ms) => new Date(ms).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/** Una línea legible para el historial. `who` es la persona afectada, si hay. */
function describe(action, extra) {
  const n = String(action.name || '');
  switch (action.type) {
    case 'addUser': return { text: `Agregó a ${extra ? extra.name : n}`, who: extra ? extra.name : n };
    case 'addTrial': return { text: `Creó una clave de prueba para ${extra ? extra.name : n} (${fmtMin(Math.round(Number(action.minutes)) || 0)})`, who: extra ? extra.name : n };
    case 'setTrial': return { text: Math.round(Number(action.minutes)) === 0 ? `Pasó a ${n} de prueba a acceso común` : `Cambió la prueba de ${n} a ${fmtMin(Math.round(Number(action.minutes)) || 0)}`, who: n };
    case 'removeUser': return { text: `Quitó a ${n}`, who: n };
    case 'restoreUser': return { text: `Reactivó a ${n}`, who: n };
    case 'changeKey': return { text: `Cambió la clave de ${n}`, who: n };
    case 'resetDevice': return { text: `Liberó la PC de ${n}${action.banDevice ? ' y vetó la PC que la usó sin permiso' : ''}`, who: n };
    case 'setEnabled': return { text: action.value === true ? 'Activó la lista de acceso' : 'Pausó la lista de acceso', who: '' };
    case 'setForceUpdate': return { text: action.value === true ? 'Activó la actualización obligatoria' : 'Apagó la actualización obligatoria', who: '' };
    case 'setMinVersion': return { text: action.version ? `Versión mínima: v${action.version}` : 'Quitó la versión mínima', who: '' };
    case 'addNotice': {
      const when = Number(action.at) > Date.now() ? ` (programado ${fmtDate(Number(action.at))})` : '';
      const to = cleanText(action.to, 40);
      return { text: `${to ? `Mensaje a ${to}` : action.urgent ? 'Aviso URGENTE' : 'Aviso'}: ${cleanText(action.title || action.text, 50)}${when}`, who: to };
    }
    case 'removeNotice': return { text: 'Borró un aviso', who: '' };
    default: return { text: String(action.type || 'Acción'), who: '' };
  }
}

/** Para deshacer: lo último que se hizo, mientras la app siga abierta (15 min). */
let undoSnap = null;
const UNDO_MS = 15 * 60 * 1000;
const SNAP_KEYS = ['enabled', 'users', 'removed', 'notices', 'minVersion', 'minMessage', 'forceUpdate', 'history'];
const snapshotOf = (cur) => JSON.parse(JSON.stringify(SNAP_KEYS.reduce((o, k) => { o[k] = cur[k]; return o; }, {})));
const undoInfo = () => (undoSnap && Date.now() - undoSnap.at < UNDO_MS ? { label: undoSnap.label, at: undoSnap.at } : null);

/** Aplica una acción sobre la lista vigente. Devuelve { doc, extra }. */
function applyAction(cur, action, myPub) {
  const doc = {
    enabled: cur.enabled === true,
    users: cur.users.map((u) => ({ name: u.name, hash: u.hash, pub: u.pub, epoch: Number(u.epoch) || 0, banned: Array.isArray(u.banned) ? u.banned.slice(-5) : [], ...(Number(u.trial) > 0 ? { trial: Number(u.trial) } : {}) })),
    removed: (cur.removed || []).slice(),
    notices: cur.notices.slice(),
    minVersion: cur.minVersion || '',
    minMessage: cur.minMessage || '',
    forceUpdate: cur.source === 'captain' ? cur.forceUpdate === true : false,
    history: (cur.history || []).slice(-199)
  };
  let extra = null;
  switch (action && action.type) {
    case 'addUser': {
      const name = cleanText(action.name, 30);
      if (!name) throw new Error('Falta el nombre.');
      const taken = (u) => String(u.name).toLowerCase() === name.toLowerCase();
      if (doc.users.some(taken) || doc.removed.some(taken)) throw new Error(`Ya existe "${name}" (si la quitaste, reactivala desde "Quitados").`);
      const key = newKey();
      doc.users.push({ name, hash: identity.hashKey(key), pub: identity.fromKey(key).pub, epoch: 0 });
      extra = { key, name };
      break;
    }
    case 'addTrial': {
      const name = cleanText(action.name, 30);
      if (!name) throw new Error('Falta el nombre.');
      const minutes = Math.round(Number(action.minutes));
      if (!Number.isFinite(minutes) || minutes < 5 || minutes > TRIAL_MAX_MIN) throw new Error('El tiempo de prueba tiene que ir de 5 minutos a 30 días.');
      const taken = (u) => String(u.name).toLowerCase() === name.toLowerCase();
      if (doc.users.some(taken) || doc.removed.some(taken)) throw new Error(`Ya existe "${name}" (si la quitaste, reactivala desde "Quitados").`);
      const key = newKey();
      doc.users.push({ name, hash: identity.hashKey(key), pub: identity.fromKey(key).pub, epoch: 0, trial: minutes });
      extra = { key, name, minutes };
      break;
    }
    case 'setTrial': {
      const target = doc.users.find((u) => String(u.name).toLowerCase() === String(action.name || '').toLowerCase());
      if (!target) throw new Error('No encontré a esa persona.');
      if (!(Number(target.trial) > 0)) throw new Error('Esa persona no tiene una clave de prueba.');
      const minutes = Math.round(Number(action.minutes));
      // 0 = la prueba pasa a ser un acceso común (sin vencimiento).
      if (minutes === 0) { delete target.trial; break; }
      if (!Number.isFinite(minutes) || minutes < 5 || minutes > TRIAL_MAX_MIN) throw new Error('El tiempo de prueba tiene que ir de 5 minutos a 30 días.');
      target.trial = minutes;
      break;
    }
    case 'removeUser': {
      const target = doc.users.find((u) => String(u.name).toLowerCase() === String(action.name || '').toLowerCase());
      if (!target) throw new Error('No encontré a esa persona.');
      if (target.pub === myPub) throw new Error('No podés sacarte a vos mismo.');
      doc.users = doc.users.filter((u) => u !== target);
      doc.removed = [...doc.removed.filter((u) => u.name !== target.name), { name: target.name, hash: target.hash, pub: target.pub, epoch: target.epoch, banned: target.banned || [], trial: target.trial || 0, at: Date.now() }].slice(-100);
      break;
    }
    case 'restoreUser': {
      const back = doc.removed.find((u) => String(u.name).toLowerCase() === String(action.name || '').toLowerCase());
      if (!back) throw new Error('No encontré a esa persona entre los quitados.');
      doc.removed = doc.removed.filter((u) => u !== back);
      doc.users.push({ name: back.name, hash: back.hash, pub: back.pub, epoch: (Number(back.epoch) || 0) + 1, banned: back.banned || [], ...(Number(back.trial) > 0 ? { trial: Number(back.trial) } : {}) });
      break;
    }
    case 'changeKey': {
      const target = doc.users.find((u) => String(u.name).toLowerCase() === String(action.name || '').toLowerCase());
      if (!target) throw new Error('No encontré a esa persona.');
      if (target.pub === myPub) throw new Error('Tu clave de capitán no se cambia desde acá.');
      const key = newKey();
      target.hash = identity.hashKey(key);
      target.pub = identity.fromKey(key).pub;
      target.epoch = (Number(target.epoch) || 0) + 1;
      extra = { key, name: target.name };
      break;
    }
    case 'resetDevice': {
      const target = doc.users.find((u) => String(u.name).toLowerCase() === String(action.name || '').toLowerCase());
      if (!target) throw new Error('No encontré a esa persona.');
      target.epoch = (Number(target.epoch) || 0) + 1;
      // Con `banDevice`: la PC que intentó usar la clave queda vetada para siempre.
      if (/^[0-9a-f]{16}$/.test(String(action.banDevice || ''))) target.banned = [...(target.banned || []), String(action.banDevice)].slice(-5);
      break;
    }
    case 'setEnabled':
      doc.enabled = action.value === true;
      break;
    case 'addNotice': {
      const text = cleanText(action.text, 600);
      if (!text) throw new Error('Escribí el texto del aviso.');
      const at = Number(action.at);
      doc.notices.push({
        id: Date.now().toString(36),
        title: cleanText(action.title, 80),
        text,
        at: Number.isFinite(at) && at > 0 ? at : Date.now(),
        repeat: action.repeat === 'daily' || action.repeat === 'weekly' ? action.repeat : null,
        urgent: action.urgent === true,
        to: cleanText(action.to, 40)
      });
      doc.notices = doc.notices.slice(-60);
      break;
    }
    case 'removeNotice':
      doc.notices = doc.notices.filter((n) => String(n.id) !== String(action.id));
      break;
    case 'setForceUpdate':
      doc.forceUpdate = action.value === true;
      break;
    case 'setMinVersion': {
      const v = cleanText(action.version, 20);
      if (v && !/^\d+\.\d+\.\d+$/.test(v)) throw new Error('La versión tiene que ser como 1.0.49.');
      doc.minVersion = v;
      doc.minMessage = cleanText(action.message, 200);
      break;
    }
    default:
      throw new Error('Acción desconocida.');
  }
  return { doc, extra };
}

async function run(action) {
  if (!access.isCaptain()) throw new Error('Sólo el capitán puede hacer esto.');
  const url = presence.cleanUrl(access.presenceUrl());
  const key = access.getKey();
  if (!url || !key) throw new Error('No hay conexión con la base de datos del club.');
  const id = identity.fromKey(key);
  const cur = access.getEffective();
  const alertPid = (name) => {
    const u = cur.users.find((x) => String(x.name).toLowerCase() === String((action && action.name) || '').toLowerCase());
    return u && u.pub ? identity.pidOf(u.pub) : null;
  };
  if (action && action.type === 'dismissAlert') {
    const pid = alertPid();
    if (pid) await presence.call(`${url}/alerts/${pid}.json`, 'DELETE');
    return { doc: cur, extra: null };
  }
  let doc;
  let extra = null;
  let entry;
  if (action && action.type === 'undo') {
    if (!undoInfo()) throw new Error('Ya no hay nada para deshacer.');
    doc = { ...JSON.parse(JSON.stringify(undoSnap.snap)) };
    entry = { text: `Deshizo: ${undoSnap.label}`, who: undoSnap.who || '' };
  } else {
    ({ doc, extra } = applyAction(cur, action, id.pub));
    entry = describe(action, extra);
  }
  const before = snapshotOf(cur);
  doc.history = [...(doc.history || []), { t: Date.now(), text: entry.text, who: entry.who }].slice(-200);
  doc.seq = (cur.seq || 0) + 1;
  doc.ts = Date.now();
  const p = JSON.stringify(doc);
  const raw = { p, s: id.sign(p) };
  await presence.call(`${url}/admin/state.json`, 'PUT', raw);
  await access.adoptAdmin(raw);
  undoSnap = action.type === 'undo' ? null : { snap: before, label: entry.text, who: entry.who, at: Date.now() };
  // Liberada la PC o cambiada la clave, la alerta ya no corresponde.
  if (action.type === 'resetDevice' || action.type === 'changeKey') {
    const pid = alertPid();
    if (pid) presence.call(`${url}/alerts/${pid}.json`, 'DELETE').catch(() => {});
  }
  return { doc: access.getEffective(), extra };
}

/** Alertas de «esta clave se usó desde otra PC», ya verificadas contra la llave de cada persona. */
async function readAlerts() {
  const url = presence.cleanUrl(access.presenceUrl());
  if (!url) return [];
  const data = (await presence.call(`${url}/alerts.json`, 'GET')) || {};
  const out = [];
  for (const u of access.getRoster()) {
    const e = data[identity.pidOf(u.pub)];
    if (e && typeof e.d === 'string' && Number.isInteger(e.e) && typeof e.t === 'number' && typeof e.s === 'string' && identity.verify(u.pub, `alert|${e.d}|${e.e}|${e.t}`, e.s)) {
      out.push({ name: u.name, at: e.t, device: e.d });
    }
  }
  return out.sort((x, y) => y.at - x.at);
}

/** PCs que probaron claves incorrectas: { device, n, at }. Sin firma (quien falla no tiene clave), así que es sólo orientativo. */
async function readAttempts() {
  const url = presence.cleanUrl(access.presenceUrl());
  if (!url) return [];
  const data = (await presence.call(`${url}/attempts.json`, 'GET')) || {};
  return Object.entries(data)
    .filter(([d, e]) => /^[0-9a-f]{16}$/.test(d) && e && typeof e.n === 'number' && typeof e.t === 'number')
    .map(([d, e]) => ({ device: d, n: Math.min(e.n, 9999), at: e.t }))
    .sort((x, y) => y.at - x.at)
    .slice(0, 30);
}

async function clearAttempts() {
  if (!access.isCaptain()) throw new Error('Sólo el capitán puede hacer esto.');
  const url = presence.cleanUrl(access.presenceUrl());
  if (!url) return;
  const list = await readAttempts();
  await Promise.all(list.map((e) => presence.call(`${url}/attempts/${e.device}.json`, 'DELETE').catch(() => {})));
}

/** Datos de la ficha de una persona: desde cuándo tiene su PC registrada y cuántas veces se la liberaron. */
async function readPerson(name) {
  const url = presence.cleanUrl(access.presenceUrl());
  const cur = access.getEffective();
  const u = cur.users.find((x) => String(x.name).toLowerCase() === String(name || '').toLowerCase());
  if (!u) throw new Error('No encontré a esa persona.');
  let since = 0;
  try {
    const rec = url ? await presence.call(`${url}/devices/${identity.pidOf(u.pub)}.json`, 'GET') : null;
    if (rec && typeof rec.t === 'number' && rec.e === (Number(u.epoch) || 0) && identity.verify(u.pub, `dev|${rec.d}|${rec.e}|${rec.t}`, rec.s)) since = rec.t;
  } catch { /* sin dato */ }
  return { name: u.name, deviceSince: since, releases: Number(u.epoch) || 0, banned: Array.isArray(u.banned) ? u.banned.length : 0 };
}

/** Pruebas en curso: { name, minutes, start, end } (start = 0 si todavía no usó la clave). */
async function readTrials() {
  const url = presence.cleanUrl(access.presenceUrl());
  const cur = access.getEffective();
  const out = [];
  for (const u of cur.users) {
    const minutes = Number(u.trial) || 0;
    if (minutes <= 0) continue;
    let start = 0;
    try {
      const rec = url ? await presence.call(`${url}/devices/${identity.pidOf(u.pub)}.json`, 'GET') : null;
      if (rec && typeof rec.t === 'number' && rec.e === (Number(u.epoch) || 0) && identity.verify(u.pub, `dev|${rec.d}|${rec.e}|${rec.t}`, rec.s)) start = rec.t;
    } catch { /* sin dato */ }
    out.push({ name: u.name, minutes, start, end: start ? start + minutes * 60000 : 0 });
  }
  return out;
}

module.exports = { readTrials, run, applyAction, readAlerts, readAttempts, clearAttempts, readPerson, undoInfo };
