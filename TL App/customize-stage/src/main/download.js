'use strict';

/**
 * Bajar una imagen y devolverla como `data:`.
 *
 * ── Por qué existe este archivo ─────────────────────────────────────────────
 *
 * Dos partes del cliente necesitan lo mismo: la foto de perfil de Discord de un
 * amigo y la tapa del tema que está sonando. Las dos son URLs que eligió otro
 * —el panel en un caso, YouTube en el otro— y las dos terminan dibujándose en
 * una ventana cuya CSP dice `img-src 'self' file: data:`, y no va a dejar de
 * decirlo: es lo que garantiza que una cadena de texto que llegó de afuera no
 * se convierta en un pedido a un servidor cualquiera.
 *
 * Así que las baja el proceso principal, que sí puede decidir a quién le pide
 * las cosas, y le pasa a la ventana un `data:` — que la CSP permite y que no es
 * una conexión a ningún lado.
 *
 * ── Y por qué no con `fetch` ────────────────────────────────────────────────
 *
 * Porque acá no hay. El proceso principal de Electron 13 corre sobre Node 14:
 * `fetch` y `AbortController` son `undefined`, y ninguno de los dos avisa —el
 * `new AbortController()` tira `ReferenceError` y la promesa se rechaza sola—.
 * Va por `net.request`, que además es la pila de red de Chromium y respeta el
 * proxy del sistema. Es lo mismo que ya hacía `fetchText` en main.js, y por el
 * mismo motivo.
 */

const { net } = require('electron');

const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Baja una imagen y la devuelve como `data:` URL.
 *
 * Nunca tira: contesta `null` y el que llamó dibuja lo que tenga (la inicial
 * del nombre, un hueco). Bajar una tapa o una foto no puede ser un error que
 * interrumpa nada.
 *
 * @param {string} url
 * @param {{hosts?: string[], hostSuffixes?: string[], maxBytes?: number, timeoutMs?: number}} [rules]
 *   `hosts` es una lista blanca de nombres exactos y `hostSuffixes` de familias
 *   (`.googleusercontent.com` acepta `lh3.` y `yt3.`). Sin ninguna de las dos se
 *   acepta cualquier host por https. Lo barato es no confiar en una URL que
 *   eligió otro, así que los dos que la usan pasan la suya.
 * @returns {Promise<string|null>}
 */
function imageAsDataUrl(url, rules = {}) {
  const maxBytes = rules.maxBytes || 512 * 1024;
  const timeoutMs = rules.timeoutMs || 6000;

  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return Promise.resolve(null);
  }
  if (parsed.protocol !== 'https:') return Promise.resolve(null);

  const host = parsed.hostname.toLowerCase();
  const listado = (rules.hosts || []).includes(host);
  const enFamilia = (rules.hostSuffixes || []).some((fin) => host.endsWith(fin));
  const hayFiltro = !!(rules.hosts || rules.hostSuffixes);
  if (hayFiltro && !listado && !enFamilia) return Promise.resolve(null);

  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };

    let request;
    try {
      request = net.request(parsed.toString());
    } catch {
      return finish(null);
    }

    const timer = setTimeout(() => {
      try { request.abort(); } catch { /* ya terminó */ }
      finish(null);
    }, timeoutMs);

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        try { request.abort(); } catch { /* ya terminó */ }
        return finish(null);
      }

      const raw = response.headers['content-type'];
      const type = String(Array.isArray(raw) ? raw[0] : raw || '')
        .split(';')[0].trim().toLowerCase();
      if (!TYPES.has(type)) {
        try { request.abort(); } catch { /* ya terminó */ }
        return finish(null);
      }

      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        // Se corta en el momento en que se pasa, no al final: el tope existe
        // para no juntar en memoria algo que no es una imagen de perfil.
        if (size > maxBytes) {
          try { request.abort(); } catch { /* ya terminó */ }
          return finish(null);
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        finish(buffer.length ? `data:${type};base64,${buffer.toString('base64')}` : null);
      });
      response.on('error', () => finish(null));
    });

    request.on('error', () => finish(null));
    try {
      request.end();
    } catch {
      finish(null);
    }
  });
}

module.exports = { imageAsDataUrl };
