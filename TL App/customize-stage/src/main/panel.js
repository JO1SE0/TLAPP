'use strict';

/**
 * Comunicación con servidores externos: DESACTIVADA.
 *
 * TL App no le envía nada a ningún sitio: ni estadísticas, ni presencia, ni
 * nombre de jugador, ni huella de sala. Todo lo que el cliente muestra se
 * calcula en esta máquina. Se conservan las tres funciones para que el resto del
 * código siga llamándolas sin cambios; las dos que antes salían a internet
 * ahora no hacen nada y devuelven null.
 */

const crypto = require('crypto');

async function pushStats() {
  return null;
}

async function beat() {
  return null;
}

/**
 * Huella de la sala: sha256 del token, cortado. Sólo se usa localmente para
 * reconocer que dos eventos son de la misma sala.
 */
function roomFingerprint(token) {
  const clean = String(token || '').trim();
  if (!clean) return null;
  return crypto.createHash('sha256').update(`tl-room:${clean}`).digest('hex').slice(0, 16);
}

module.exports = { pushStats, beat, roomFingerprint };
