'use strict';

/**
 * Verificación firmada heredada del estado VIP. TL App no inicia sesión ni
 * mantiene perfiles de Discord; esta comprobación queda inactiva sin perfil.
 */

const crypto = require('crypto');

/**
 * ── Configuración ───────────────────────────────────────────────────────────
 * Ver el README para qué tiene que exponer el sitio.
 */
const CONFIG = {
  /** Raíz del sitio. Sin barra al final. */
  site: 'https://thriviumhax.com',

  /**
   * Comprobación silenciosa del rol, sin ventana ni OAuth. Devuelve un token
   * firmado igual que el del login. Ver `check()` y el README.
   */
  statusPath: '/vip/status',

  /**
   * Clave pública Ed25519 del servidor, en formato SPKI PEM. Es la contracara
   * de la privada con la que el sitio firma el token. Se puede publicar sin
   * riesgo: sólo sirve para verificar.
   *
   * Se genera una vez con:
   *   openssl genpkey -algorithm ed25519 -out vip-private.pem
   *   openssl pkey -in vip-private.pem -pubout -out vip-public.pem
   *
   * Tiene que ser EXACTAMENTE la contracara de la privada que usa el panel que
   * está en el aire. Si no lo es, el login falla con "La firma del servidor no
   * coincide" — que es lo que pasaba: acá había quedado una clave de un par
   * anterior al que se terminó desplegando.
   *
   * Para comprobarlo sin entrar al servidor, el panel la publica:
   *   curl https://thriviumhax.com/vip/public-key
   * y eso tiene que dar, carácter por carácter, lo mismo que está acá abajo.
   */
publicKeyPem: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA45NGBHXnuAnknITNbG1k3a36H6EcRZV6E8ahXpK/u94=
-----END PUBLIC KEY-----`
};

/* ── base64url a mano ───────────────────────────────────────────────────────
 *
 * `Buffer`  NO conoce el encoding 'base64url' en este Node: llegó en la 14.18 y
 * Electron 13 trae la 14.16.0, así que `toString('base64url')` tira
 * «Unknown encoding». Sin esto la comprobación del rol no arranca — ni siquiera
 * llega a pedirle nada al sitio, porque revienta armando el `state`.
 *
 * La diferencia con base64 son dos caracteres y el relleno. Al decodificar no
 * hace falta reponer el `=`: el decodificador de Node lo tolera. */

function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  return Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Cuánto se acepta de desfasaje de reloj entre el servidor y la máquina. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** La comprobación silenciosa no puede quedarse colgada esperando al sitio. */
const CHECK_TIMEOUT_MS = 10000;

/** ¿Está configurado como para poder comprobar el rol? */
function isConfigured() {
  return !!(CONFIG.site && CONFIG.publicKeyPem);
}

/**
 * Verifica el token firmado y devuelve su contenido.
 *
 * Formato:  base64url(JSON) "." base64url(firma Ed25519 sobre esos bytes)
 *
 * @param {string} token
 * @param {string} expectedState
 */
function verifyToken(token, expectedState) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('El token del servidor está mal formado.');

  const payloadBytes = fromBase64Url(parts[0]);
  const signature = fromBase64Url(parts[1]);

  let key;
  try {
    key = crypto.createPublicKey(CONFIG.publicKeyPem);
  } catch {
    throw new Error('La clave pública del servidor no es válida.');
  }

  // Ed25519 no lleva algoritmo de hash aparte: por eso el primer argumento va
  // en null. Si la firma no cierra, el token no vale nada más abajo.
  if (!crypto.verify(null, payloadBytes, key, signature)) {
    throw new Error('La firma del servidor no coincide. No se aceptó el resultado.');
  }

  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw new Error('El contenido del token no es JSON.');
  }

  // El `state` ata esta respuesta a este pedido: sin esto, un token viejo (o de
  // otra persona) reenviado a la app sería aceptado igual.
  if (payload.state !== expectedState) {
    throw new Error('La respuesta del servidor no coincide con el pedido.');
  }

  const exp = Number(payload.exp) * 1000;
  if (!Number.isFinite(exp)) throw new Error('El token no dice cuándo vence.');
  if (Date.now() > exp + CLOCK_SKEW_MS) throw new Error('El token venció. Probá de nuevo.');

  return payload;
}

/* ── Por qué esto NO abre una ventana del cliente ────────────────────────── *
 *
 * Antes el login vivía en un `BrowserWindow` modal que cargaba `SITE/vip/login`
 * y esperaba a que la navegación pasara por `redirectUri`. Eso dejó de andar, y
 * no por nada nuestro: ese `/vip/login` redirige a `discord.com/oauth2/
 * authorize`, y la página de Discord ya no se puede ejecutar en el Chromium 91
 * que trae Electron 13.
 *
 * Medido, cargando esa URL en un Electron 13 pelado:
 *
 *   Uncaught SyntaxError: Unexpected token '{'   (discord.com/assets/51740.js)
 *   [libdiscore] Unsupported browser … invalid value type 'externref'
 *   → #app-mount queda con 0 caracteres adentro; document.body.innerText = ''
 *
 * O sea: el bundle de Discord usa sintaxis que este motor no parsea, revienta
 * antes de dibujar nada, y lo único que se ve es el `backgroundColor` de la
 * ventana. Eso es exactamente «la ventana de Discord se queda negra».
 *
 * No tiene arreglo del lado del cliente: haría falta subir de Electron, y esta
 * versión está elegida a propósito (es la última que entrega cuadros por encima
 * del refresco del monitor — ver `applyBootFlags` en main.js). Cualquier
 * navegador del sistema es más nuevo que esto, así que el login se hace ahí.
 *
 * ── El baile nuevo ──────────────────────────────────────────────────────────
 *
 *   1. La app levanta un servidor en `redirectUri` (127.0.0.1, sólo loopback).
 *   2. Abre `SITE/vip/login?...` en el navegador del sistema.
 *   3. Ahí la persona pasa por Discord, con la sesión que YA tiene abierta —que
 *      además le ahorra escribir la contraseña.
 *   4. El sitio redirige el navegador a `redirectUri?state=…&token=…`, que cae
 *      en el servidor de acá; se le contesta una página de «ya podés volver» y
 *      el token sigue el mismo camino de siempre.
 *
 * El sitio no cambia en nada: `redirectUri` ya era esta dirección de loopback,
 * sólo que hasta ahora nunca se cargaba de verdad.
 *
 * ── Y esto no afloja la seguridad ───────────────────────────────────────────
 *
 * Cualquier cosa en la máquina puede pegarle a ese puerto y ofrecernos un
 * token. No importa: `verifyToken` sigue exigiendo la firma Ed25519 del
 * servidor y el `state` que se generó recién acá. Sin la clave privada del
 * sitio, lo que entre por el puerto no pasa de la puerta.                    */

/** Cuánto se espera a que la persona termine en el navegador. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * El login en curso, si hay uno.
 *
 * Existe porque el botón se puede tocar dos veces: el segundo intento levantaría
 * el mismo puerto y moriría con EADDRINUSE, contando una historia que no tiene
 * nada que ver. Con esto, tocar de nuevo reabre la pestaña del mismo intento —
 * que es justo lo que quiere el que la cerró sin querer.
 */
let pendingLogin = null;

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** La página que ve la persona en el navegador cuando termina. */
function resultPage(ok, message, lang) {
  const en = lang === 'en';
  const title = ok
    ? (en ? 'All set' : 'Listo')
    : (en ? 'We could not sign you in' : 'No se pudo entrar');
  const body = ok
    ? (en ? 'You can close this tab and go back to TL App.'
          : 'Ya podés cerrar esta pestaña y volver a TL App.')
    : message;
  return `<!doctype html><html lang="${en ? 'en' : 'es'}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TL App</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#08070c; color:#e9e6f2;
         font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif }
  .card { max-width:30rem; padding:2.5rem; text-align:center }
  .dot { width:3rem; height:3rem; margin:0 auto 1.25rem; border-radius:50%;
         background:${ok ? '#7B3FE4' : '#4a2030'} }
  h1 { margin:0 0 .6rem; font-size:1.4rem; font-weight:600 }
  p { margin:0; opacity:.75 }
</style>
<div class="card"><div class="dot"></div><h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p></div>`;
}

/**
 * Abre el login en el navegador del sistema y devuelve el token firmado.
 *
 * @param {string} [lang] idioma de la página de «listo» que ve el navegador
 * @returns {Promise<{token:string, state:string}>}
 */
function requestToken(lang) {
  // Un intento a la vez: ver `pendingLogin`.
  if (pendingLogin) {
    pendingLogin.reopen();
    return pendingLogin.promise;
  }

  const state = toBase64Url(crypto.randomBytes(16));
  const url = loginUrl(state);

  let redirect;
  try {
    redirect = new URL(CONFIG.redirectUri);
  } catch {
    return Promise.reject(new Error('La dirección de vuelta de vip.js está mal escrita.'));
  }

  const open = () => shell.openExternal(url);

  const promise = new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    /*
     * `server.close()` sólo deja de escuchar: espera a que se cierren las
     * conexiones que ya hay, y el navegador deja la suya abierta por keep-alive.
     * Sin cortarlas a mano, el puerto seguiría tomado y el login siguiente
     * moriría con EADDRINUSE.
     */
    const sockets = new Set();

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      pendingLogin = null;
      clearTimeout(timer);
      try { server.close(); } catch { /* nunca llegó a escuchar */ }
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      err ? reject(err) : resolve(value);
    };

    /** Contesta y recién ahí termina: cortar antes trunca la página. */
    const reply = (res, status, html, done) => {
      const payload = Buffer.from(html, 'utf8');
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': payload.length,
        'cache-control': 'no-store',
        connection: 'close'
      });
      res.end(payload, done);
    };

    const server = http.createServer((req, res) => {
      let incoming;
      try {
        incoming = new URL(req.url, `http://${redirect.host}`);
      } catch {
        return reply(res, 400, resultPage(false, 'Dirección ilegible.', lang));
      }
      // El navegador pide también `/favicon.ico`: eso no es la respuesta.
      if (incoming.pathname !== redirect.pathname) {
        res.writeHead(404, { connection: 'close' });
        return res.end();
      }

      const error = incoming.searchParams.get('error');
      if (error) {
        return reply(res, 200, resultPage(false, error, lang), () => finish(new Error(error)));
      }

      const token = incoming.searchParams.get('token');
      if (!token) {
        const message = 'El servidor no devolvió ningún token.';
        return reply(res, 200, resultPage(false, message, lang), () => finish(new Error(message)));
      }

      reply(res, 200, resultPage(true, '', lang), () => finish(null, { token, state }));
    });

    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    server.on('error', (err) => {
      finish(new Error(err && err.code === 'EADDRINUSE'
        ? `El puerto ${redirect.port} está ocupado por otro programa: no hay por dónde recibir la respuesta.`
        : `No se pudo esperar la respuesta del sitio: ${err.message}`));
    });

    // Sólo loopback, nunca 0.0.0.0: esto no tiene por qué verse desde la red.
    server.listen(Number(redirect.port), redirect.hostname, () => {
      timer = setTimeout(
        () => finish(new Error('Se venció la espera. Volvé a tocar «Entrar con Discord».')),
        LOGIN_TIMEOUT_MS
      );
      open().catch((err) => finish(new Error(`No se pudo abrir el navegador: ${err.message}`)));
    });
  });

  pendingLogin = { promise, reopen: () => { open().catch(() => {}); } };
  return promise;
}

/**
 * El perfil que guarda la app, armado con lo que firmó el servidor.
 *
 * @param {object} payload   contenido ya verificado del token
 * @param {object|null} previous  el perfil que había, para lo que el servidor
 *                                puede no repetir en cada respuesta
 */
function profileFromPayload(payload, previous) {
  return {
    id: String(payload.id || (previous && previous.id) || ''),
    username: String(payload.username || 'Sin nombre'),
    avatar: payload.avatar ? String(payload.avatar) : null,
    inGuild: payload.inGuild !== false,
    vip: payload.vip === true,
    /**
     * Con qué volver a preguntar sin abrir la ventana. Es un secreto opaco que
     * emite el sitio; puede rotar en cada respuesta y, si no viene, se conserva
     * el que ya estaba. Si el sitio no lo usa, la comprobación va con el `id`.
     */
    refresh: payload.refresh ? String(payload.refresh) : ((previous && previous.refresh) || null),
    checkedAt: new Date().toISOString(),
    /**
     * Cuándo hay que volver a preguntar. NO es cuándo se te termina el VIP: es
     * el vencimiento del token, o sea hasta cuándo la app se cree este veredicto
     * si el sitio no contesta. El README pide que sea corto (horas o días), así
     * que mostrarlo como "te quedan N días de VIP" diría cualquier cosa. Para
     * eso está `vipUntil`.
     */
    expiresAt: new Date(Number(payload.exp) * 1000).toISOString(),
    vipUntil: vipUntilFrom(payload, previous)
  };
}

/**
 * Hasta cuándo tenés el rol, si el sitio lo sabe.
 *
 * El panel ya manda el campo —hoy con `null`, que es «no vence»—, y hasta ahora
 * la app lo tiraba. Se acepta como texto ISO o como segundos epoch, que son las
 * dos formas en las que un panel suele tener una fecha a mano.
 *
 * La diferencia entre AUSENTE y `null` importa y por eso no alcanza con un `||`:
 * ausente es un sitio viejo que todavía no conoce el campo, y ahí se conserva lo
 * que ya se sabía; `null` es el sitio diciendo que no hay vencimiento, y eso sí
 * tiene que borrar una fecha anterior. Con `||` un VIP que pasa a permanente se
 * quedaba con la cuenta regresiva vieja para siempre.
 */
function vipUntilFrom(payload, previous) {
  if (!('vipUntil' in payload)) return (previous && previous.vipUntil) || null;
  const raw = payload.vipUntil;
  if (raw === null || raw === undefined || raw === '') return null;
  const ms = typeof raw === 'number' ? raw * 1000 : Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Inicia sesión y devuelve el perfil con el estado VIP.
 *
 * El login pasa por el navegador del sistema, no por una ventana de la app:
 * el porqué está arriba de `requestToken`.
 *
 * @param {string} [lang] idioma de la página de vuelta que ve el navegador
 * @returns {Promise<{id:string,username:string,avatar:string|null,vip:boolean,inGuild:boolean,refresh:string|null,checkedAt:string,expiresAt:string}>}
 */
async function login(lang) {
  if (!isConfigured()) {
    throw new Error('Falta configurar el sitio y la clave pública en src/main/vip.js.');
  }

  const { token, state } = await requestToken(lang);
  // Sin perfil anterior a propósito: puede estar entrando con otra cuenta, y
  // heredarle el `refresh` de la anterior la dejaría preguntando por el usuario
  // equivocado para siempre.
  return profileFromPayload(verifyToken(token, state), null);
}

/**
 * Le pregunta al sitio si el rol sigue puesto. No abre ninguna ventana ni
 * vuelve a pasar por Discord: es la misma verificación firmada, por HTTPS.
 *
 * Se identifica con el `refresh` que emitió el sitio y, si ese perfil es de
 * antes de que existiera, con el `id` de Discord. El veredicto se acepta con
 * las mismas tres condiciones que el del login —firma, `state` y vencimiento—
 * más una cuarta: que sea del mismo usuario que inició sesión.
 *
 * @param {{id:string, refresh?:string|null}} profile  el perfil guardado
 */
async function check(profile) {
  if (!isConfigured()) {
    throw new Error('Falta configurar el sitio y la clave pública en src/main/vip.js.');
  }

  const id = String((profile && profile.id) || '');
  const refresh = String((profile && profile.refresh) || '');
  if (!id && !refresh) throw new Error('El perfil guardado no tiene con qué identificarse.');

  const state = toBase64Url(crypto.randomBytes(16));
  const params = new URLSearchParams({ state });
  if (id) params.set('id', id);

  const url = `${CONFIG.site.replace(/\/+$/, '')}${CONFIG.statusPath}?${params}`;

  // `fetch` acá es el de `net-compat.js`: la pila de red de Chromium, que
  // respeta el proxy y los certificados del sistema. Ver ese archivo.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  let body;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'cache-control': 'no-cache', ...(refresh ? { authorization: `Bearer ${refresh}` } : {}) }
    });
    // El sitio puede dar de baja una sesión (por ejemplo si rotó sus secretos).
    // Eso no es un error de red: hay que volver a entrar con Discord.
    if (res.status === 401 || res.status === 403) {
      throw new Error('La sesión ya no vale. Entrá de nuevo con Discord.');
    }
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
    body = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const token = body && body.token;
  if (!token) throw new Error('El servidor no devolvió ningún token.');

  const payload = verifyToken(token, state);
  // Un token válido pero de otra cuenta no sirve: sería regalarle el VIP de
  // cualquiera al que sepa su id.
  if (id && payload.id && String(payload.id) !== id) {
    throw new Error('El servidor contestó por otra cuenta.');
  }

  return profileFromPayload(payload, profile);
}

module.exports = { check, isConfigured, verifyToken, CONFIG };
