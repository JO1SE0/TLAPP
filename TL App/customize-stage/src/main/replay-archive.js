'use strict';

/* ══════════════════════════════════════════════════════════════════════════
   El archivo de grabaciones analizadas
   ══════════════════════════════════════════════════════════════════════════
   Analizar una grabación cuesta un par de segundos de simulación y el juego se
   queda quieto mientras dura (ver `analyzeReplay` en `game-preload.js`). Y el
   resultado no cambia nunca: un .hbr2 es un archivo cerrado, lo que pasó adentro
   ya pasó. O sea que analizarlo dos veces es puro trabajo tirado.

   Acá se guarda lo que dio cada uno. Con eso:

     · abrir una grabación ya analizada muestra el resumen al toque, sin simular
       nada de nuevo;
     · la lista de replays deja de ser nombres y fechas y pasa a decir cuántos
       goles y cuánto duró cada uno;
     · y una grabación nueva se puede analizar sola apenas se la abre, sin que el
       usuario tenga que pedir nada.

   La clave NO es el nombre. Es el tamaño y la fecha de modificación del archivo,
   así renombrar una grabación —que es lo primero que hace cualquiera— no tira el
   análisis a la basura. Dos archivos distintos con el mismo tamaño exacto Y el
   mismo milisegundo de modificación no existen en la práctica.
   ══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = 'replay-archive.json';

/**
 * Cuántas grabaciones se recuerdan. Cada entrada son unos pocos KB —la ficha,
 * los goles y el PNG del mapa, que es de un píxel por celda— así que el tope
 * está para que el archivo no crezca para siempre, no porque apriete.
 */
const MAX_ENTRIES = 60;

let cache = null;

function filePath() {
  return path.join(app.getPath('userData'), FILE);
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    const parsed = JSON.parse(raw);
    cache = parsed && typeof parsed === 'object' && parsed.entries ? parsed : { version: 1, entries: {} };
  } catch {
    // No existe, o quedó ilegible. Un archivo de caché roto no es motivo para
    // que no arranque el cliente: se empieza de cero.
    cache = { version: 1, entries: {} };
  }
  return cache;
}

function save() {
  try {
    fs.writeFileSync(filePath(), JSON.stringify(cache), 'utf8');
  } catch {
    // Perder el archivo sólo significa volver a analizar. No se avisa nada.
  }
}

/**
 * La identidad de un archivo de grabación: tamaño y fecha de modificación.
 * Devuelve null si el archivo no está.
 */
function keyOf(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    return `${stat.size}|${Math.round(stat.mtimeMs)}`;
  } catch {
    return null;
  }
}

/** El análisis guardado de este archivo, o null. */
function get(file) {
  const key = keyOf(file);
  if (!key) return null;
  return load().entries[key] || null;
}

/**
 * Guarda el análisis de un archivo.
 *
 * Un análisis PARCIAL —el que se cortó por tiempo— no se guarda: lo que tiene
 * es un pedazo de la grabación, y si quedara archivado nunca más se intentaría
 * el completo. Ver `SCAN_BUDGET_MS`.
 */
function put(file, summary) {
  if (!summary || !summary.ok || summary.partial) return null;
  const key = keyOf(file);
  if (!key) return null;

  const store = load();
  store.entries[key] = {
    key,
    name: path.basename(file),
    analyzedAt: Date.now(),
    summary
  };
  prune(store);
  save();
  return store.entries[key];
}

/** Deja las MAX_ENTRIES más recientes. */
function prune(store) {
  const keys = Object.keys(store.entries);
  if (keys.length <= MAX_ENTRIES) return;
  keys
    .sort((a, b) => (store.entries[a].analyzedAt || 0) - (store.entries[b].analyzedAt || 0))
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach((key) => delete store.entries[key]);
}

/**
 * Lo poquito que necesita la lista de replays para cada archivo: cuántos goles,
 * cuánto duró y cuántos partidos trae. La ficha, el mapa y los goles enteros no
 * se mandan acá — la lista no los muestra y son la mayor parte del peso.
 */
function digest(file) {
  const entry = get(file);
  if (!entry) return null;
  const s = entry.summary;
  return {
    analyzedAt: entry.analyzedAt,
    goals: (s.goals || []).length,
    matches: (s.matches || []).length,
    seconds: s.seconds || 0
  };
}

/** Se olvida todo. Sólo lo llama el botón de limpiar de la interfaz. */
function clear() {
  cache = { version: 1, entries: {} };
  save();
  return true;
}

module.exports = { get, put, digest, clear, keyOf };
