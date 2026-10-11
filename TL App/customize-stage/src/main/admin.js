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

const cleanText = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);

/** Aplica una acción sobre la lista vigente. Devuelve { doc, extra }. */
function applyAction(cur, action, myPub) {
  const doc = {
    enabled: cur.enabled === true,
    users: cur.users.map((u) => ({ name: u.name, hash: u.hash, pub: u.pub, epoch: Number(u.epoch) || 0, banned: Array.isArray(u.banned) ? u.banned.slice(-5) : [] })),
    removed: (cur.removed || []).slice(),
    notices: cur.notices.slice(),
    minVersion: cur.minVersion || '',
    minMessage: cur.minMessage || '',
    forceUpdate: cur.source === 'captain' ? cur.forceUpdate === true : false
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
    case 'removeUser': {
      const target = doc.users.find((u) => String(u.name).toLowerCase() === String(action.name || '').toLowerCase());
      if (!target) throw new Error('No encontré a esa persona.');
      if (target.pub === myPub) throw new Error('No podés sacarte a vos mismo.');
      doc.users = doc.users.filter((u) => u !== target);
      doc.removed = [...doc.removed.filter((u) => u.name !== target.name), { name: target.name, hash: target.hash, pub: target.pub, epoch: target.epoch, banned: target.banned || [], at: Date.now() }].slice(-100);
      break;
    }
    case 'restoreUser': {
      const back = doc.removed.find((u) => String(u.name).toLowerCase() === String(action.name || '').toLowerCase());
      if (!back) throw new Error('No encontré a esa persona entre los quitados.');
      doc.removed = doc.removed.filter((u) => u !== back);
      doc.users.push({ name: back.name, hash: back.hash, pub: back.pub, epoch: (Number(back.epoch) || 0) + 1, banned: back.banned || [] });
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
        urgent: action.urgent === true
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
  const { doc, extra } = applyAction(cur, action, id.pub);
  doc.seq = (cur.seq || 0) + 1;
  doc.ts = Date.now();
  const p = JSON.stringify(doc);
  const raw = { p, s: id.sign(p) };
  await presence.call(`${url}/admin/state.json`, 'PUT', raw);
  await access.adoptAdmin(raw);
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

module.exports = { run, applyAction, readAlerts };
