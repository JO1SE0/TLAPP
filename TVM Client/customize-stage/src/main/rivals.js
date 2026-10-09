'use strict';

/* ==========================================================================
 *  Con quién jugaste — lo cuenta el sitio, no esta máquina
 * ==========================================================================
 *  Contra quién jugaste, cuántas veces y cómo salió. Se ve con clic derecho
 *  sobre alguien en la sala y en la pantalla de estadísticas.
 *
 *  ── Por qué no se lleva la cuenta acá ─────────────────────────────────────
 *
 *  La primera versión de esto guardaba un `rivals.json` en la carpeta del
 *  cliente y lo iba llenando al terminar cada partido. Andaba, pero cualquiera
 *  que supiera abrir esa carpeta se ponía las victorias que quisiera, y no hay
 *  forma de arreglarlo de este lado: firmar o encriptar el archivo no sirve
 *  cuando la llave también está en la máquina de esa persona. Un número que no
 *  se puede defender no sirve para mostrárselo a nadie.
 *
 *  Ahora lo calcula el panel con los partidos que reportan los hosts —los
 *  mismos que alimentan el ELO—, autenticados con su API key. Es dato que el
 *  jugador no toca. Ver `/client/rivals` en `client.routes.js`.
 *
 *  Lo que se pierde, y la interfaz lo dice: sólo cuenta lo jugado en las salas
 *  de Thrivium, y sólo para quien tenga la cuenta de Haxball vinculada.
 *
 *  ── Por qué esto no toca el disco ─────────────────────────────────────────
 *
 *  Vive en memoria y nada más. Un cache en disco haría que el clic derecho
 *  conteste al instante apenas abrís el cliente, pero volvería a dejar sobre la
 *  mesa un archivo editable con los números que se muestran — que es
 *  exactamente lo que esta versión vino a sacar. El costo es que durante los
 *  primeros segundos de la sesión no hay historial; el beneficio es que lo que
 *  se ve siempre viene del sitio.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/** Cada cuánto se lo vuelve a pedir en uso normal. */
const FRESH_MS = 5 * 60 * 1000;

/**
 * Cuánto se espera después de un partido antes de volver a preguntar.
 *
 * El host reporta el partido cuando termina, y entre eso y que el panel lo
 * tenga guardado pasa un momento. Preguntar en el mismo instante trae la foto
 * de antes y deja el historial una partida atrás hasta el próximo refresco.
 */
const AFTER_MATCH_MS = 20 * 1000;

/** Lo último que contestó el sitio. */
let cache = { linked: false, at: 0, people: new Map() };
let inFlight = null;
let afterMatchTimer = null;

/**
 * El archivo de la versión anterior, que llevaba la cuenta acá.
 *
 * Se borra al arrancar: quedó sin usar y era justamente el que se podía editar.
 * Dejarlo daría la impresión de que todavía significa algo.
 */
function dropLegacyFile() {
  try {
    fs.unlinkSync(path.join(app.getPath('userData'), 'rivals.json'));
  } catch {
    /* no estaba, que es el caso normal */
  }
}

/**
 * Le pide el historial al sitio.
 *
 * @param {object} profile  el perfil de Discord guardado (`config.vip.discord`)
 * @param {{force?: boolean}} [options]
 */
async function refresh() {
  // Sin servidor no hay historial de rivales: se devuelve el estado vacío.
  return cache;
}

/**
 * Vuelve a pedirlo después de un partido, dándole tiempo al host a reportarlo.
 * Varios finales seguidos se juntan en un solo pedido.
 */
function refreshAfterMatch(profile) {
  if (!profile || afterMatchTimer) return;
  afterMatchTimer = setTimeout(() => {
    afterMatchTimer = null;
    refresh(profile, { force: true }).catch(() => {});
  }, AFTER_MATCH_MS);
  if (afterMatchTimer.unref) afterMatchTimer.unref();
}

/** La ficha de alguien por su apodo de Haxball, o `null`. */
function get(nick) {
  const clean = String(nick || '').trim();
  return (clean && cache.people.get(clean)) || null;
}

/** Lo que hay para la pantalla de estadísticas. */
function state(limit = 20) {
  return {
    linked: cache.linked,
    at: cache.at,
    people: [...cache.people.values()].slice(0, Math.max(1, Math.min(200, limit)))
  };
}

function reset() {
  cache = { linked: false, at: 0, people: new Map() };
}

module.exports = { refresh, refreshAfterMatch, get, state, reset, dropLegacyFile };
