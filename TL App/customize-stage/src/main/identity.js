'use strict';

/**
 * Identidad de cada jugador del plantel, derivada de su clave personal.
 *
 * La clave (TL-XXXX-XXXX-XXXX) no sale nunca de la PC. De ella se deriva un par de
 * llaves Ed25519 siempre igual: la privada firma "estoy en esta sala" y la pública
 * (que va en access.json, junto al nombre) deja que cualquier otro compruebe esa
 * firma. Así nadie puede hacerse pasar por alguien del plantel sin tener su clave.
 *
 * Sin dependencias de Electron: lo usan la app y la herramienta de claves.
 */

const crypto = require('crypto');

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const normalizeKey = (k) => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Node 14 (Electron 13) no conoce 'base64url': se arma a mano. */
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Hash que va en `users[].hash` (el que decide si una clave entra). */
const hashKey = (k) => crypto.createHash('sha256').update(`tl-app:${normalizeKey(k)}`).digest('hex');

/** Identificador corto de una llave pública: es el nombre de su casillero en la base. */
const pidOf = (pubHex) => crypto.createHash('sha256').update(Buffer.from(String(pubHex), 'hex')).digest('hex').slice(0, 16);

/** Par de llaves a partir de la clave. Devuelve { pub (hex), pid, sign(texto) → base64url }. */
function fromKey(key) {
  const clean = normalizeKey(key);
  if (clean.length < 12) throw new Error('Clave no válida');
  const seed = crypto.createHash('sha256').update(`tl-app:id:${clean}`).digest();
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const spki = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' });
  const pub = spki.slice(spki.length - 32).toString('hex');
  return {
    pub,
    pid: pidOf(pub),
    sign: (text) => b64url(crypto.sign(null, Buffer.from(String(text)), priv))
  };
}

/** ¿La firma es de esa llave pública? Nunca tira: ante cualquier duda, false. */
function verify(pubHex, text, signature) {
  try {
    if (!/^[0-9a-f]{64}$/i.test(String(pubHex))) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubHex, 'hex')]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(String(text)), key, fromB64url(signature));
  } catch { return false; }
}

module.exports = { normalizeKey, hashKey, pidOf, fromKey, verify };
