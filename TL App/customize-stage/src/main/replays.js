'use strict';

const fs = require('fs');
const path = require('path');
const { shell, dialog } = require('electron');
const store = require('./store');
const archive = require('./replay-archive');

const EXTENSIONS = ['.hbr2', '.hbr'];

/**
 * HaxBall replays start with the ASCII magic "HBR2" followed by a big-endian
 * uint32 version. Anything else we just report as desconocido.
 */
function readHeader(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8);
    const read = fs.readSync(fd, buf, 0, 8, 0);
    if (read < 8) return { magic: null, version: null };
    const magic = buf.toString('ascii', 0, 4);
    return {
      magic: /^[\x20-\x7e]{4}$/.test(magic) ? magic : null,
      version: magic === 'HBR2' ? buf.readUInt32BE(4) : null
    };
  } catch {
    return { magic: null, version: null };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* noop */ }
    }
  }
}

function folder() {
  return store.get().replays.folder;
}

function list() {
  const dir = folder();
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { folder: dir, error: 'No se pudo leer la carpeta.', items: [] };
  }

  const items = entries
    .filter((e) => e.isFile() && EXTENSIONS.includes(path.extname(e.name).toLowerCase()))
    .map((e) => {
      const full = path.join(dir, e.name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        return null;
      }
      const header = readHeader(full);
      return {
        name: e.name,
        path: full,
        size: stat.size,
        createdAt: stat.birthtimeMs || stat.mtimeMs,
        updatedAt: stat.mtimeMs,
        format: header.magic === 'HBR2' ? `HBR2 v${header.version}` : 'Desconocido',
        // Lo que dio el análisis, si esta grabación ya se analizó alguna vez.
        // Es un resumen del resumen: ver `digest` en `replay-archive.js`.
        digest: archive.digest(full)
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return { folder: dir, error: null, items };
}

async function chooseFolder(win) {
  const res = await dialog.showOpenDialog(win, {
    title: 'Elegí la carpeta de replays',
    defaultPath: folder(),
    properties: ['openDirectory']
  });
  if (res.canceled || !res.filePaths[0]) return list();
  store.set({ replays: { folder: res.filePaths[0] } });
  // El vigilante mira UNA carpeta: si no se lo muda acá, sigue mirando la
  // anterior y las grabaciones nuevas dejan de avisar sin ningún síntoma.
  if (watching) watch(watching);
  return list();
}

function assertInFolder(target) {
  const dir = path.resolve(folder());
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== dir) throw new Error('El archivo está fuera de la carpeta de replays.');
  return resolved;
}

async function open(target) {
  const file = assertInFolder(target);
  const err = await shell.openPath(file);
  return { ok: !err, error: err || null };
}

function reveal(target) {
  shell.showItemInFolder(assertInFolder(target));
  return { ok: true };
}

/** Sends the replay to the recycle bin — never a hard delete. */
async function trash(target) {
  const file = assertInFolder(target);
  await shell.trashItem(file);
  return list();
}

function rename(target, nextName) {
  const file = assertInFolder(target);
  const safe = String(nextName).replace(/[\\/:*?"<>|]/g, '').trim();
  if (!safe) throw new Error('Nombre vacío.');
  const ext = path.extname(file);
  const withExt = safe.toLowerCase().endsWith(ext.toLowerCase()) ? safe : safe + ext;
  const next = path.join(path.dirname(file), withExt);
  if (fs.existsSync(next)) throw new Error('Ya existe un replay con ese nombre.');
  fs.renameSync(file, next);
  return list();
}

/** Lee un replay para mandárselo al reproductor de HaxBall. */
function read(target) {
  const file = assertInFolder(target);
  const data = fs.readFileSync(file);
  if (data.length > 64 * 1024 * 1024) throw new Error('El replay es demasiado grande.');
  return { name: path.basename(file), base64: data.toString('base64'), size: data.length };
}

/* ── El vigilante de la carpeta ───────────────────────────────────────────────
 *
 * HaxBall guarda las grabaciones donde van las descargas del navegador, y lo
 * hace sin avisarle a nadie. Sin esto, una grabación recién guardada aparece en
 * el cliente recién cuando el usuario entra a la pestaña y refresca.
 *
 * Dos cuidados que no son opcionales:
 *
 * 1. `fs.watch` avisa cuando el archivo EMPIEZA a escribirse, no cuando
 *    termina. Abrirlo en ese momento da un archivo cortado. Por eso, antes de
 *    darlo por bueno, se le mira el tamaño dos veces separadas por un rato: si
 *    no cambió, el navegador terminó de bajarlo.
 * 2. Un solo guardado dispara varios eventos. Todo pasa por un temporizador que
 *    se reinicia, así que una ráfaga se cobra una sola vez.
 */

/** Cuánto se espera a que se calme la ráfaga de eventos. */
const SETTLE_MS = 900;

/** Y cuánto más para confirmar que el archivo dejó de crecer. */
const STABLE_MS = 700;

/** Cuántas veces se le da otra chance a un archivo que sigue creciendo. */
const STABLE_TRIES = 20;

let watcher = null;
let watchedDir = null;
let settleTimer = null;
/** El aviso que hay que llamar, guardado para poder mudar el vigilante de carpeta. */
let watching = null;
/** Lo que ya estaba cuando empezamos a mirar: contra esto se decide qué es nuevo. */
let known = new Set();
/** Los que están a mitad de escribirse, para no arrancarles dos esperas. */
const pending = new Set();

function namesNow() {
  try {
    return new Set(
      fs.readdirSync(watchedDir)
        .filter((name) => EXTENSIONS.includes(path.extname(name).toLowerCase()))
    );
  } catch {
    return new Set();
  }
}

/** ¿Dejó de crecer? Devuelve el tamaño final, o 0 si el archivo se fue. */
function settledSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Empieza a mirar la carpeta de replays. `onNew` recibe la entrada de lista de
 * cada grabación nueva, ya terminada de escribir.
 *
 * Llamarla de nuevo cambia de carpeta —que es lo que pasa cuando el usuario
 * elige otra— sin dejar el vigilante anterior colgado.
 */
function watch(onNew) {
  stopWatching();
  watching = onNew;
  watchedDir = folder();
  known = namesNow();

  try {
    watcher = fs.watch(watchedDir, () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => check(onNew), SETTLE_MS);
    });
  } catch {
    // La carpeta puede no existir todavía, o estar en una unidad que se
    // desconectó. No es un error que valga la pena mostrar: la lista a mano
    // sigue andando igual.
    watcher = null;
  }
  return !!watcher;
}

function check(onNew) {
  const ahora = namesNow();

  for (const name of ahora) {
    if (known.has(name) || pending.has(name)) continue;
    pending.add(name);
    whenSettled(name, onNew, STABLE_TRIES);
  }

  /* Un nombre entra a `known` recién cuando se confirmó, nunca acá: si se lo
     diera por conocido apenas aparece, un archivo a medio escribir quedaría
     marcado como visto y no se avisaría nunca. Lo que sí se hace es olvidar lo
     que ya no está, para que un archivo que vuelve —copiado, renombrado—
     cuente como nuevo otra vez. */
  known = new Set([...known].filter((name) => ahora.has(name)));
}

/** Avisa cuando el archivo dejó de crecer, o se rinde después de tantas vueltas. */
function whenSettled(name, onNew, tries) {
  const full = path.join(watchedDir, name);
  const antes = settledSize(full);

  setTimeout(() => {
    const despues = settledSize(full);
    if (!despues) {            // se fue antes de terminar
      pending.delete(name);
      return;
    }
    if (despues !== antes && tries > 0) return whenSettled(name, onNew, tries - 1);

    pending.delete(name);
    known.add(name);
    const item = (list().items || []).find((r) => r.path === full);
    if (item) onNew(item);
  }, STABLE_MS);
}

function stopWatching() {
  clearTimeout(settleTimer);
  settleTimer = null;
  pending.clear();
  if (watcher) {
    try { watcher.close(); } catch { /* ya estaba cerrado */ }
  }
  watcher = null;
}

module.exports = {
  list, chooseFolder, open, reveal, trash, rename, folder, read,
  watch, stopWatching
};
