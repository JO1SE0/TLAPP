'use strict';

/**
 * Actualizaciones servidas desde un bucket de Cloudflare R2.
 *
 * R2 no ejecuta nada: es almacenamiento de objetos que entrega archivos por
 * HTTPS. Para esto alcanza y sobra — el cliente pide un JSON, compara
 * versiones y, si hay una nueva, se baja el instalador y lo abre.
 *
 * Qué va en el bucket (público, o detrás de un dominio propio apuntado a él):
 *
 *   updates.json                    el feed
 *   TVM-Client-Setup-0.2.0.exe      el instalador de cada versión
 *
 * y el feed se ve así:
 *
 *   {
 *     "channels": {
 *       "stable": {
 *         "version": "0.2.0",
 *         "url": "https://pub-xxxx.r2.dev/TVM-Client-Setup-0.2.0.exe",
 *         "sha256": "9f86d081884c7d65…",
 *         "size": 78123456,
 *         "notes": "Qué cambió en esta versión"
 *       },
 *       "beta": { ... }
 *     }
 *   }
 *
 * Un feed sin `channels` también sirve: se lo toma como el canal único.
 *
 * `sha256` es opcional pero conviene ponerlo: es lo único que distingue al
 * instalador de verdad de cualquier otra cosa que llegue por esa URL. Si el
 * feed lo trae y no coincide, el archivo se borra y no se ejecuta nada.
 *
 * La URL está fija acá a propósito: es de dónde sale el código que después se
 * ejecuta en la máquina del jugador, así que no se lee de la configuración ni
 * viaja por IPC. Un config.json importado no puede apuntarla a otro lado.
 */

// Sin feed: TL App no consulta ni descarga actualizaciones de ningún servidor.
// Para activarlo, poné acá una URL https propia que devuelva el JSON descrito arriba.
const FEED_URL = '';
const CHANNEL = 'stable';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHECK_TIMEOUT_MS = 10000;
/** Un instalador de Electron pesa ~80 MB; 400 corta cualquier disparate. */
const MAX_INSTALLER_BYTES = 400 * 1024 * 1024;

/** Compara "0.10.2" contra "0.9.7" por número, no por texto. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

/**
 * Sólo HTTPS. Un feed que apunte a http:// dejaría que cualquiera en el camino
 * cambie el instalador que se va a ejecutar.
 */
function assertHttps(url, what) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error(`${what}: la URL no es válida.`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`${what}: tiene que ser una URL https.`);
  return parsed;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'cache-control': 'no-cache' }
    });
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} currentVersion */
async function check(currentVersion) {
  if (!FEED_URL) {
    return { status: 'uptodate', current: currentVersion, latest: currentVersion, notes: '', size: null, canDownload: false,
      message: 'Las actualizaciones automáticas están desactivadas en TL App.' };
  }
  assertHttps(FEED_URL, 'El feed');
  const feed = await fetchJson(FEED_URL);
  const entry = (feed.channels && feed.channels[CHANNEL]) || feed;
  if (!entry || !entry.version) throw new Error('El feed no incluye un campo "version".');

  const behind = compareVersions(entry.version, currentVersion) > 0;
  // Sin `url` se puede avisar de la versión nueva, pero no bajarla.
  const canDownload = behind && !!entry.url;
  if (entry.url) assertHttps(entry.url, 'El instalador');

  return {
    status: behind ? 'available' : 'uptodate',
    current: currentVersion,
    latest: entry.version,
    notes: entry.notes ? String(entry.notes).slice(0, 2000) : '',
    size: Number(entry.size) || null,
    canDownload,
    message: behind
      ? `Hay una versión nueva: ${entry.version}`
      : 'Estás en la última versión.'
  };
}

/**
 * Baja el instalador de la versión que anuncia el feed.
 *
 * Se vuelve a pedir el feed en vez de confiar en lo que mande la interfaz: así
 * la URL que se descarga siempre sale del servidor, nunca del renderer.
 *
 * @param {string} currentVersion
 * @param {string} targetDir      dónde dejar el archivo
 * @param {(p:{received:number,total:number|null,percent:number|null}) => void} onProgress
 */
async function download(currentVersion, targetDir, onProgress) {
  if (!FEED_URL) throw new Error('Las actualizaciones automáticas están desactivadas.');
  const feed = await fetchJson(FEED_URL);
  const entry = (feed.channels && feed.channels[CHANNEL]) || feed;
  if (!entry || !entry.version) throw new Error('El feed no incluye un campo "version".');
  if (compareVersions(entry.version, currentVersion) <= 0) throw new Error('Ya estás en la última versión.');
  if (!entry.url) throw new Error('El feed no incluye la URL del instalador.');

  const url = assertHttps(entry.url, 'El instalador');
  // El nombre sale de la URL, nunca del feed: un "name" con ../ escribiría
  // fuera de la carpeta temporal.
  const name = sanitizeName(path.basename(url.pathname), entry.version);

  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
  if (!res.body) throw new Error('La descarga vino vacía.');

  const declared = Number(res.headers.get('content-length')) || Number(entry.size) || null;
  if (declared && declared > MAX_INSTALLER_BYTES) throw new Error('El instalador es demasiado grande.');

  fs.mkdirSync(targetDir, { recursive: true });
  const file = path.join(targetDir, name);
  const handle = fs.createWriteStream(file);
  const hash = crypto.createHash('sha256');
  let received = 0;

  try {
    for await (const chunk of res.body) {
      received += chunk.length;
      if (received > MAX_INSTALLER_BYTES) throw new Error('El instalador es demasiado grande.');
      hash.update(chunk);
      // El write puede devolver false (buffer lleno): esperamos el drain para
      // no comerse la memoria con un archivo de 80 MB.
      if (!handle.write(chunk)) {
        await new Promise((resolve, reject) => {
          handle.once('drain', resolve);
          handle.once('error', reject);
        });
      }
      if (onProgress) {
        onProgress({
          received,
          total: declared,
          percent: declared ? Math.min(100, Math.round((received / declared) * 100)) : null
        });
      }
    }
    await new Promise((resolve, reject) => {
      handle.end((err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    handle.destroy();
    safeUnlink(file);
    throw err;
  }

  // Si el feed publica el hash, el archivo tiene que coincidir o no se ejecuta.
  if (entry.sha256) {
    const got = hash.digest('hex');
    const want = String(entry.sha256).trim().toLowerCase();
    if (got !== want) {
      safeUnlink(file);
      throw new Error('El instalador descargado no coincide con el sha256 del feed. No se ejecutó.');
    }
  }

  return { path: file, version: entry.version, size: received, verified: !!entry.sha256 };
}

/** Deja sólo un nombre de archivo plano y con extensión conocida. */
function sanitizeName(raw, version) {
  const base = String(raw || '').replace(/[^A-Za-z0-9._-]/g, '');
  return /\.(exe|msi)$/i.test(base) ? base : `TL-App-${version}.exe`;
}

function safeUnlink(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* puede no haberse llegado a crear */
  }
}

module.exports = { check, download, compareVersions, FEED_URL };
