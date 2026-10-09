'use strict';

/**
 * Presencia de Discord ("está jugando a…").
 *
 * Discord no deja publicar presencia con una app genérica: hay que crear una
 * aplicación propia en discord.com/developers y pegar su Application ID en los
 * ajustes. Sin ese ID no se conecta nada — se avisa en la interfaz en vez de
 * fallar en silencio.
 *
 * Toda la librería se carga de forma perezosa: si falta o falla, el cliente
 * sigue andando igual.
 */

let client = null;
let connected = false;
let currentAppId = null;
let startedAt = Date.now();
let lastActivity = null;

function log(message) {
  console.log('[discord]', message);
}

async function disconnect() {
  connected = false;
  // Discord se olvida de la actividad al cortar: la próxima va aunque sea igual.
  lastSentKey = '';
  clearTimeout(pendingTimer);
  if (!client) return;
  try {
    client.removeAllListeners();
    client.destroy();
  } catch {
    /* ya estaba cerrado */
  }
  client = null;
  currentAppId = null;
}

/**
 * @param {{enabled:boolean, appId:string}} config
 * @returns {Promise<{status:string, message:string}>}
 */
async function apply(config) {
  const appId = String(config?.appId || '').trim();

  if (!config?.enabled) {
    await disconnect();
    return { status: 'off', message: 'Presencia desactivada.' };
  }
  if (!/^\d{15,25}$/.test(appId)) {
    await disconnect();
    return { status: 'noappid', message: 'Falta el Application ID de tu app de Discord.' };
  }
  if (connected && currentAppId === appId) {
    return { status: 'on', message: 'Conectado a Discord.' };
  }

  await disconnect();
  try {
    // Cliente propio, no `@xhayper/discord-rpc`: esa librería pide Node ≥ 20 y
    // no carga en el que trae Electron 13. Ver `discord-ipc.js`.
    const { DiscordIpc } = require('./discord-ipc');
    client = new DiscordIpc(appId);
    client.on('ready', () => {
      connected = true;
      log('conectado');
      if (lastActivity) setActivity(lastActivity);
    });
    // Si Discord se cierra en el medio, el estado tiene que reflejarlo o la
    // interfaz seguiría diciendo "conectado" para siempre.
    client.on('close', () => {
      connected = false;
      lastSentKey = '';
      log('desconectado');
    });
    client.on('error', (err) => log(`error de conexión: ${err.message}`));
    await client.connect();
    currentAppId = appId;
    startedAt = Date.now();
    return { status: 'on', message: 'Conectado a Discord.' };
  } catch (err) {
    await disconnect();
    // Lo más común: Discord cerrado. No es un error del cliente.
    return { status: 'error', message: `No se pudo conectar: ${err.message}` };
  }
}

/**
 * Discord acepta unas cinco actualizaciones cada veinte segundos y las demás
 * las tira. Pasar temas seguidos en YouTube Music las gastaba en un momento,
 * así que va una cada cuatro segundos como mucho, y la que queda esperando es
 * siempre la última.
 */
const MIN_GAP_MS = 4000;
let lastSentAt = 0;
let lastSentKey = '';
let pendingTimer = null;

/** Discord rechaza la actividad ENTERA si una línea tiene menos de 2 letras. */
function line(text) {
  const clean = String(text || '').trim().slice(0, 128);
  return clean.length >= 2 ? clean : undefined;
}

/**
 * @param {{details:string, state:string}} activity
 */
function setActivity(activity) {
  lastActivity = activity;
  if (!client || !connected) return;

  const payload = {
    details: line(activity.details) || 'HaxBall',
    state: line(activity.state),
    timestamps: { start: startedAt },
    instance: false
  };

  const key = JSON.stringify(payload);
  if (key === lastSentKey) return;
  clearTimeout(pendingTimer);
  const wait = MIN_GAP_MS - (Date.now() - lastSentAt);
  if (wait > 0) {
    pendingTimer = setTimeout(() => setActivity(lastActivity), wait);
    return;
  }
  try {
    client.setActivity(payload);
    lastSentAt = Date.now();
    lastSentKey = key;
  } catch (err) {
    log(`no se pudo actualizar la presencia: ${err.message}`);
  }
}

function status() {
  return { connected, appId: currentAppId };
}

module.exports = { apply, setActivity, disconnect, status };
