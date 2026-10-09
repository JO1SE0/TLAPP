'use strict';

/* ------------------------------------------------------------------ *
 * `fetch` y `AbortController` para el Node viejo
 * ------------------------------------------------------------------ *
 * El cliente corre sobre Electron 13, que trae Node 14.16, y ahí no existen ni
 * `fetch` ni `AbortController` como globales (llegaron en Node 18 y 15). La
 * versión vieja de Electron no es un descuido: es lo único que entrega cuadros
 * por encima del refresco del monitor. Ver el comentario de `applyBootFlags`
 * en `main.js`.
 *
 * En vez de reescribir la lista de salas, el updater y sus tres formas
 * distintas de consumir la respuesta —una de ellas la descarga del instalador,
 * que va por streaming y calcula un sha256 mientras baja—, se rellenan los dos
 * globales con lo justo que esos sitios usan.
 *
 * Va sobre `net` de Electron y no sobre `https` de Node a propósito: usa la
 * pila de red de Chromium, así que respeta el proxy del sistema y los
 * certificados que tenga configurados la máquina.
 *
 * NO pretende ser un `fetch` completo. Lo implementado es:
 *   ok · status · headers.get() · text() · json() · arrayBuffer() · body
 *   options: method · headers · signal · body (texto)
 * ------------------------------------------------------------------ */

const { net } = require('electron');

function installAbortController() {
  if (typeof globalThis.AbortController === 'function') return;

  class AbortSignalLite {
    constructor() {
      this.aborted = false;
      this.reason = undefined;
      this._listeners = [];
    }
    addEventListener(type, fn) {
      if (type === 'abort') this._listeners.push(fn);
    }
    removeEventListener(type, fn) {
      if (type !== 'abort') return;
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    }
  }

  globalThis.AbortController = class AbortControllerLite {
    constructor() {
      this.signal = new AbortSignalLite();
    }
    abort(reason) {
      const s = this.signal;
      if (s.aborted) return;
      s.aborted = true;
      s.reason = reason;
      for (const fn of s._listeners.slice()) {
        try { fn(); } catch { /* un listener roto no cancela la cancelación */ }
      }
    }
  };
}

/** Error con `name = 'AbortError'`, que es como lo reconocen los llamadores. */
function abortError() {
  const err = new Error('La petición se canceló.');
  err.name = 'AbortError';
  return err;
}

function installFetch() {
  if (typeof globalThis.fetch === 'function') return;

  globalThis.fetch = function fetchLite(input, options = {}) {
    const url = String(input);
    const { method = 'GET', headers = {}, signal, body: payload } = options;

    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());

      const req = net.request({ method, url });
      for (const [name, value] of Object.entries(headers)) {
        try { req.setHeader(name, String(value)); } catch { /* cabecera prohibida */ }
      }

      let settled = false;

      /*
       * Sacar el oyente de cancelación es obligatorio en TODOS los finales, no
       * sólo cuando llega la respuesta.
       *
       * Si la petición terminaba en error, el oyente quedaba enganchado al
       * `signal`. El que llama suele tener un `setTimeout` que corta a los N
       * segundos; cuando ese temporizador saltaba —ya con la petición muerta—
       * se llamaba `req.abort()` sobre ella. Del lado de Chromium eso es tocar
       * un objeto liberado: se cae el proceso principal entero, en C++, sin que
       * el `try/catch` de acá vea nada.
       */
      const unwatch = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      const fail = (err) => {
        if (settled) return;
        settled = true;
        unwatch();
        reject(err);
      };

      const onAbort = () => {
        // Sólo tiene sentido cortar una petición que sigue viva.
        if (settled) return;
        try { req.abort(); } catch { /* ya terminó */ }
        fail(abortError());
      };
      if (signal) signal.addEventListener('abort', onAbort);

      req.on('error', fail);

      req.on('response', (res) => {
        if (settled) return;
        settled = true;
        unwatch();

        /* Hay llamadores que descartan la respuesta sin leerla —la lista de
           salas tira el cuerpo apenas ve un código que no es 2xx—. Sin ningún
           oyente de 'error', un corte del stream en ese momento sale como
           excepción no atajada. Este oyente vacío no molesta al de `readAll`:
           un stream admite varios. */
        res.on('error', () => {});

        /* Se lee una sola vez: el que use `body` como stream no puede usar
           después `text()`, igual que con el fetch de verdad. */
        let consumed = null;
        const readAll = () => {
          if (consumed) return consumed;
          consumed = new Promise((res2, rej2) => {
            const parts = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => res2(Buffer.concat(parts)));
            res.on('error', rej2);
          });
          return consumed;
        };

        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage || '',
          url,
          headers: {
            get(name) {
              const v = res.headers[String(name).toLowerCase()];
              return v == null ? null : Array.isArray(v) ? v.join(', ') : String(v);
            }
          },
          // `net` de Electron devuelve un Readable, así que `for await` anda.
          body: res,
          async text() { return (await readAll()).toString('utf8'); },
          async json() { return JSON.parse((await readAll()).toString('utf8')); },
          async arrayBuffer() {
            const b = await readAll();
            return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
          }
        });
      });

      try {
        // Sólo texto (JSON, en la práctica): es todo lo que manda el cliente.
        // Un Buffer o un stream necesitarían más y no hace falta todavía.
        req.end(payload == null ? undefined : String(payload));
      } catch (err) {
        fail(err);
      }
    });
  };
}

/** Se llama una vez, lo antes posible en el arranque del proceso principal. */
function install() {
  installAbortController();
  installFetch();
}

module.exports = { install };
