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
    users: cur.users.map((u) => ({ name: u.name, hash: u.hash, pub: u.pub })),
    notices: cur.notices.slice(),
    minVersion: cur.minVersion || '',
    minMessage: cur.minMessage || ''
  };
  let extra = null;
  switch (action && action.type) {
    case 'addUser': {
      const name = cleanText(action.name, 30);
      if (!name) throw new Error('Falta el nombre.');
      if (doc.users.some((u) => String(u.name).toLowerCase() === name.toLowerCase())) throw new Error(`Ya existe "${name}".`);
      const key = newKey();
      doc.users.push({ name, hash: identity.hashKey(key), pub: identity.fromKey(key).pub });
      extra = { key, name };
      break;
    }
    case 'removeUser': {
      const target = doc.users.find((u) => String(u.name).toLowerCase() === String(action.name || '').toLowerCase());
      if (!target) throw new Error('No encontré a esa persona.');
      if (target.pub === myPub) throw new Error('No podés sacarte a vos mismo.');
      doc.users = doc.users.filter((u) => u !== target);
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
  const { doc, extra } = applyAction(cur, action, id.pub);
  doc.seq = (cur.seq || 0) + 1;
  doc.ts = Date.now();
  const p = JSON.stringify(doc);
  const raw = { p, s: id.sign(p) };
  await presence.call(`${url}/admin/state.json`, 'PUT', raw);
  await access.adoptAdmin(raw);
  return { doc: access.getEffective(), extra };
}

module.exports = { run, applyAction };
