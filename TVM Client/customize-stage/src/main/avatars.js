'use strict';

/**
 * Las fotos de perfil de Discord, bajadas acá y convertidas a `data:`.
 *
 * ── Por qué no las pide la ventana ──────────────────────────────────────────
 *
 * La CSP del renderer es `img-src 'self' file: data:` y no va a dejar de serlo:
 * es lo que garantiza que una cadena de texto que llegó del sitio no pueda
 * convertirse en un pedido a un servidor cualquiera. La foto la manda el panel
 * como URL, o sea que es un dato de afuera; dejar que la ventana la cargue sola
 * sería justamente el agujero que la CSP tapa.
 *
 * Así que la baja el proceso principal, que sí puede decidir a quién le pide las
 * cosas, y le pasa a la ventana un `data:` — que la CSP permite y que no es una
 * conexión a ningún lado.
 *
 * ── Qué se acepta ──────────────────────────────────────────────────────────
 *
 * Sólo `cdn.discordapp.com` por https, sólo tipos de imagen conocidos y con un
 * tope de tamaño. No es paranoia de más: la URL la elige el servidor del panel,
 * no esta PC, y lo barato es no confiar.
 *
 * ── La descarga NO va por `fetch` ──────────────────────────────────────────
 *
 * Iba, y por eso no se veía ninguna foto: el proceso principal de Electron 13
 * corre sobre Node 14, donde `fetch` y `AbortController` no existen. El
 * `new AbortController()` de la primera línea tiraba `ReferenceError` —fuera del
 * `try`, así que ni siquiera lo agarraba el `catch` de abajo—, `resolve()` se
 * rechazaba entera y en el dock se veían siempre las iniciales. Ahora baja
 * `download.js`, con `net.request`, que es lo que este Electron sí tiene.
 *
 * ── Vive en memoria ────────────────────────────────────────────────────────
 *
 * Un avatar de Discord son unos pocos KB y se piden en cada sondeo de amigos.
 * Guardarlos en disco sería un caché más para invalidar a cambio de ahorrar,
 * una vez por arranque, una descarga de 5 KB por amigo.
 */

const { imageAsDataUrl } = require('./download');

const HOST = 'cdn.discordapp.com';

/** Más que esto no es una foto de perfil. */
const MAX_BYTES = 512 * 1024;

const TIMEOUT_MS = 6000;

/**
 * Tope del caché. Son fotos de tus amigos: con esto sobra, y el límite existe
 * para que una lista larga no crezca sin techo en una app que queda abierta
 * horas.
 */
const CACHE_CAP = 120;

/** url → data: URL, o null si ya falló y no vale la pena reintentar. */
const cache = new Map();

/** Las que se están bajando ahora, para no pedir la misma dos veces. */
const inFlight = new Map();

/** ¿Es una foto de Discord y no cualquier otra cosa? */
function acceptable(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' && parsed.hostname === HOST;
  } catch {
    return false;
  }
}

function download(url) {
  return imageAsDataUrl(url, { hosts: [HOST], maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS });
}

/**
 * Resuelve varias fotos y devuelve TODAS las que se tengan, vengan del caché o
 * recién bajadas.
 *
 * Antes devolvía sólo las que no estaban en el caché, para no mandar cien
 * kilobytes de base64 por IPC en cada sondeo. La idea era buena pero el filtro
 * estaba en el lugar equivocado: «ya la bajé» no es lo mismo que «la ventana ya
 * la tiene». Tu propia foto se pedía una vez al arrancar, y si ese envío no
 * llegaba —la ventana todavía no tenía puesto el oyente— quedaba en el caché y
 * ningún sondeo posterior la volvía a mandar nunca. Resultado: se veían las
 * fotos de todos menos la tuya.
 *
 * Quien decide qué mandar es `pushAvatars` en `main.js`, que sí sabe qué
 * recibió la ventana que está viva ahora.
 *
 * @param {Array<string|null|undefined>} urls
 * @returns {Promise<Object<string,string>>}  url → data: URL
 */
async function resolve(urls) {
  const wanted = [...new Set((urls || []).filter(acceptable))];
  if (!wanted.length) return {};

  const missing = wanted.filter((url) => !cache.has(url));
  await Promise.all(missing.map(async (url) => {
    // Dos sondeos seguidos piden lo mismo: el segundo se cuelga del primero en
    // vez de abrir otra descarga.
    let pending = inFlight.get(url);
    if (!pending) {
      pending = download(url);
      inFlight.set(url, pending);
    }
    const data = await pending;
    inFlight.delete(url);
    remember(url, data);
  }));

  const out = {};
  for (const url of wanted) {
    const data = cache.get(url);
    // Las que fallaron quedan anotadas como nulas —para no reintentar en cada
    // sondeo— pero no se mandan: la ventana ya sabe dibujar la inicial.
    if (data) out[url] = data;
  }
  return out;
}

function remember(url, data) {
  // Map recuerda el orden de inserción: el primero es el más viejo.
  if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value);
  cache.set(url, data || null);
}

module.exports = { resolve };
