'use strict';

/**
 * Banderas de los países de las salas.
 *
 * HaxBall las dibuja con un sprite (`images/flags.png`, 16×11 px cada una) y
 * una posición por país en game.css (`.f-ar { background-position: -48px -165px }`).
 * El preload del juego lee ese mapa del CSS vivo — así no hay que hardcodear la
 * URL, que lleva un hash de build que cambia — y acá bajamos el sprite una vez
 * y lo guardamos como data URI para poder usarlo en la interfaz del cliente.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let cache = null;

function cachePath() {
  return path.join(app.getPath('userData'), 'flags.json');
}

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
  } catch {
    cache = null;
  }
  return cache;
}

function save(data) {
  cache = data;
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(data), 'utf8');
  } catch {
    /* si no se puede cachear, se vuelve a bajar la próxima vez */
  }
}

/** Devuelve lo cacheado, o null si todavía no se pudo armar. */
function get() {
  return load();
}

/**
 * Lo llama el preload cuando pudo leer el mapa del game.css del juego.
 * @param {{spriteUrl:string, positions:Record<string,[number,number]>}} info
 */
async function update(info) {
  if (!info || !info.spriteUrl || !info.positions) return get();

  const current = load();
  if (current && current.spriteUrl === info.spriteUrl) return current;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(info.spriteUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`sprite: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2 * 1024 * 1024) throw new Error('sprite demasiado grande');

    const data = {
      spriteUrl: info.spriteUrl,
      image: `data:image/png;base64,${buf.toString('base64')}`,
      positions: info.positions,
      width: 16,
      height: 11
    };
    save(data);
    return data;
  } catch (err) {
    console.error('[flags] no se pudo bajar el sprite:', err.message);
    return get();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { get, update };
