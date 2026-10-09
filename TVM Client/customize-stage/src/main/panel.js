'use strict';

/**
 * Lo que el cliente le cuenta al sitio (thriviumhax.com).
 *
 * Dos cosas, las dos opcionales: el cliente entero funciona sin internet y sin
 * cuenta, y cualquier fallo de acá no se le muestra al jugador — se anota en la
 * consola y se reintenta a la próxima.
 *
 *   · **Tus estadísticas** suben a tu perfil público. Necesitan sesión de
 *     Discord: son TUYAS y tienen que ir a alguna parte.
 *
 *   · **La presencia** es lo que permite que dos clientes se reconozcan adentro
 *     de una sala. HaxBall no transmite nada de eso —la sala sólo manda nombre,
 *     avatar y posición—, así que la única forma es que los dos le cuenten a un
 *     tercero dónde están. No necesita sesión: reconocer a otro con el cliente
 *     no es un beneficio de cuenta. Lo que sí la necesita es que te vean los
 *     cosméticos VIP, porque el rol lo decide el servidor y no la app.
 *
 * ── Qué sale de esta PC ─────────────────────────────────────────────────────
 *
 * Los contadores del perfil, el nombre con el que estás jugando y una huella de
 * la sala. La sala va HASHEADA (sha256 del token, 16 caracteres): al servidor le
 * alcanza para juntar a los que están en la misma —que es todo lo que tiene que
 * hacer— y no le sirve para entrar ni para saber cuál es. El identificador de
 * instalación es azar puro y no dice quién sos.
 */

const crypto = require('crypto');
const { CONFIG } = require('./vip');

/** Ningún pedido de estos puede quedar colgado esperando al sitio. */
const TIMEOUT_MS = 8000;

/** Si el sitio no contesta, se vuelve a probar recién dentro de un rato. */
const BACKOFF_MS = 5 * 60 * 1000;

let quietUntil = 0;

function log(message) {
  console.log('[panel]', message);
}

function endpoint(path) {
  return `${CONFIG.site.replace(/\/+$/, '')}${path}`;
}

/**
 * POST con JSON. Devuelve el cuerpo ya parseado, o null si no se pudo.
 *
 * Nunca tira: el que llama no tiene nada que hacer con el error más que
 * ignorarlo, y esto corre en temporizadores donde una excepción suelta se
 * convierte en un unhandledRejection.
 */
async function request(method, path, body, { automatic = true, quiet = false } = {}) {
  // El silencio es sólo para lo que sale solo. Una acción que pidió el usuario
  // —agregar a alguien, mandarle un mensaje— se intenta siempre: quedarse callado
  // porque hace tres minutos falló otra cosa se ve como un botón que no anda.
  if (automatic && Date.now() < quietUntil) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(path), {
      method,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    // 401 es "esta sesión ya no vale": no es un problema de red y no hay que
    // callarse por eso, el que llama decide si vuelve a intentar.
    if (res.status === 401 || res.status === 403) return { unauthorized: true };

    /*
     * Un 4xx con cuerpo es una respuesta, no una caída: "no hay nadie con ese
     * nombre" tiene que llegarle al usuario tal cual, y no puede dejar la app
     * muda cinco minutos como si se hubiera caído el sitio.
     */
    if (res.status >= 400 && res.status < 500) {
      const data = await res.json().catch(() => null);
      if (data && data.error) return data;
    }
    if (!res.ok) {
      if (!quiet) quietUntil = Date.now() + BACKOFF_MS;
      log(`${path} respondió ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    if (!quiet) quietUntil = Date.now() + BACKOFF_MS;
    log(`${path} falló: ${err && err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const post = (path, body) => request('POST', path, body);

/** Con qué se identifica la sesión guardada, si hay alguna. */
function identity(profile) {
  if (!profile) return null;
  const out = {};
  if (profile.refresh) out.refresh = profile.refresh;
  if (profile.id) out.id = profile.id;
  return out.refresh || out.id ? out : null;
}

/**
 * Sube tus contadores. Devuelve lo que quedó guardado del lado del sitio (con
 * el nivel ya calculado) o null si no se pudo.
 *
 * @param {object} profile  el perfil de Discord guardado
 * @param {object} stats    `config.stats`
 */
async function pushStats(profile, stats) {
  const who = identity(profile);
  if (!who) return null;

  const res = await post('/client/stats', {
    ...who,
    stats: {
      matches: stats.matches,
      goals: stats.goals,
      assists: stats.assists,
      ownGoals: stats.ownGoals,
      sessions: stats.sessions,
      secondsPlayed: stats.secondsPlayed,
      streak: stats.streak,
      bestStreak: stats.bestStreak
    }
  });
  if (!res || res.unauthorized) return null;
  return res;
}

/**
 * Late una vez y trae quién más está en la misma sala con el cliente.
 *
 * @param {object} info
 * @param {string} info.install     id anónimo de esta instalación
 * @param {string} info.version     versión del cliente
 * @param {string} info.os          sistema operativo, para las métricas
 * @param {object|null} info.profile  perfil de Discord, si inició sesión
 * @param {string|null} info.room   huella de la sala (ya hasheada)
 * @param {string|null} info.nick   con qué nombre está jugando
 * @param {object|null} info.cosmetics  aspecto seleccionado para compartir
 * @returns {Promise<{peers: Array, vip: boolean, everyMs: number}|null>}
 */
async function beat(info) {
  const res = await post('/client/presence', {
    ...(identity(info.profile) || {}),
    install: info.install,
    version: info.version,
    os: info.os,
    room: info.room || null,
    nick: info.nick || null,
    cosmetics: info.cosmetics || null
  });
  if (!res || res.unauthorized) return null;
  return {
    peers: Array.isArray(res.peers) ? res.peers : [],
    vip: !!res.vip,
    everyMs: Number(res.everyMs) || 30000
  };
}


/**
 * Huella de la sala: sha256 del token, cortado.
 *
 * Alcanza para que dos clientes en la misma sala caigan en el mismo grupo, y no
 * le sirve al servidor para entrar ni para saber de qué sala se trata. Se le
 * pone un prefijo propio para que la huella no coincida con la de ningún otro
 * sistema que hashee el mismo token.
 */
function roomFingerprint(token) {
  const clean = String(token || '').trim();
  if (!clean) return null;
  return crypto.createHash('sha256').update(`tvm-room:${clean}`).digest('hex').slice(0, 16);
}

module.exports = { pushStats, beat, roomFingerprint };
