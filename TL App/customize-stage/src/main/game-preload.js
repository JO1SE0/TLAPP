'use strict';

/**
 * Se ejecuta DENTRO de la página de HaxBall, antes que sus propios scripts.
 *
 * Corre con contextIsolation desactivado, así que comparte el `window` de la
 * página. `require` vive sólo en el scope de este módulo y nunca se cuelga de
 * window, de modo que la página no recibe Node.
 *
 * Trabajos:
 *   1. Escribir la configuración del usuario en el localStorage de haxball.com
 *      ANTES de que el juego arranque, así la toma como propia.
 *   2. Re-estilizar el juego (tema) y sacarle el sitio de alrededor.
 *   3. Overlay, telemetría y detección de partida en curso.
 *   4. Comandos propios del chat, avatar y moderación.
 */

const { ipcRenderer } = require('electron');
const ball3d = require('./ball-3d');
const netRipple = require('./net-ripple');
const zoomControl = require('./game-zoom');
const themes = require('./themes');
const roomUi = require('./room-ui');
const gif = require('./gif');
const haxball = require('./haxball-settings');
const countries = require('./countries');
const { canonicalTeam, isAvatarNotice } = require('./game-i18n');

/* ------------------------------------------------------------------ *
 * Desactivación de desynchronized en Canvas 2D (Fijación HaxZero L6317)
 * ------------------------------------------------------------------ *
 * HaxBall web pide getContext('2d', { desynchronized: true }). En Electron /
 * Chromium con el V-Sync apagado, desynchronized: true desborda el pipeline
 * gráfico a 2200 FPS y produce tirones visuales (stuttering).
 *
 * HaxZero lo soluciona de dos formas:
 *   1. Pone low_latency_canvas = false por defecto (game-min-original.js:L8035)
 *   2. Fuerza desynchronized: false en getContext (game-min-original.js:L6317)
 *
 * El hook en el window de este preload cubre los canvas del documento principal.
 * El del iframe se instala aparte en onNewGameDocument() porque cada iframe
 * tiene su propio prototipo de HTMLCanvasElement.
 */
function hookDesynchronized(win) {
  try {
    const proto = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
    if (!proto || proto.__tvmDesyncHooked) return;
    proto.__tvmDesyncHooked = true;
    const orig = proto.getContext;
    proto.getContext = function (type, options) {
      if (type === '2d') {
        if (!options) options = { desynchronized: false };
        else if (typeof options === 'object') options.desynchronized = false;
      }
      return orig.call(this, type, options);
    };
  } catch (e) {}
}
hookDesynchronized(window);

const state = {
  config: null,
  startedAt: Date.now(),
  fps: 0,
  ping: null,
  overlayVisible: true,
  playing: false,
  view: null,
  /** Nombre de la sala en la que estás, o null. Último recurso para identificarla. */
  roomName: null,
  /**
   * El código de la sala (el del link `?c=`), dicho por HaxBall al entrar o al
   * hostear. Es lo que junta en el sitio a los clientes de una misma sala: ver
   * `reportRoomInfo`.
   */
  roomToken: null,
  /** Hay un panel del cliente abierto encima de la cancha. */
  clientPanelOpen: false,
  /** La ventana está minimizada: nadie está mirando esto. */
  minimized: false,
  /**
   * Esta pestaña de juego está ATRÁS: hay otra al frente. Se sigue jugando
   * —la sala, la conexión y la simulación siguen— pero a un ritmo de cuadros
   * mínimo y sin sonido. Lo pone el proceso principal (`game:background`).
   */
  background: false,
  /**
   * Si el rol VIP está activo. Lo dice el proceso principal (`isVip()`), que es
   * el único que sabe del vencimiento: la config sola no alcanza.
   */
  vip: false
};

/**
 * Resolución interna que la interfaz pide para la cancha.
 *
 * Es la resolución que el jugador eligió en Ajustes: el iframe del juego se
 * dibuja a ese tamaño y se ESTIRA hasta llenar lo que haya —la ventana o la
 * pantalla entera—, deformándose si la proporción no coincide. Es lo que se
 * pide con «1080x1080»: una cancha cuadrada estirada a lo ancho, no una ventana
 * cuadrada. La ventana no cambia de tamaño por esto.
 */
let gameViewport = { enabled: false, width: 16, height: 9 };

function applyGameViewport() {
  const frame = document.querySelector('iframe.gameframe') || document.querySelector('iframe[src*="game"]');
  if (!frame) return;

  const host = frame.parentElement;
  /*
   * Atrás, o sin resolución pedida, el iframe vuelve al CSS normal de HaxBall.
   *
   * Atrás importa: el `<webview>` de una pestaña de atrás mide 1×1 px (ver
   * `.stage__frame webview.is-bg` en app.css), y estirar la resolución elegida
   * sobre eso sería pedirle a Chromium una superficie de 1360×860 para
   * componerla en un píxel. Sin esto, el iframe se queda con el tamaño del
   * documento, que es ese píxel: el canvas se dibuja de 1×1 y no cuesta nada.
   */
  if (!gameViewport.enabled || state.background) {
    ['position', 'width', 'height', 'left', 'top', 'transform', 'transform-origin', 'border'].forEach((name) => {
      frame.style.removeProperty(name);
    });
    return;
  }

  const vw = Math.max(1, (host && host.clientWidth) || window.innerWidth || 1);
  const vh = Math.max(1, (host && host.clientHeight) || window.innerHeight || 1);
  const wantedW = Math.max(1, Number(gameViewport.width) || 16);
  const wantedH = Math.max(1, Number(gameViewport.height) || 9);

  // La cancha conserva internamente la resolución elegida, pero se estira hasta
  // llenar la pantalla. Si la medida pedida supera el monitor, primero se baja
  // en bloque para no crear una superficie gigante (la causa de varios freezes).
  const safeScale = Math.min(1, vw / wantedW, vh / wantedH);
  const width = Math.max(1, Math.round(wantedW * safeScale));
  const height = Math.max(1, Math.round(wantedH * safeScale));
  const scaleX = vw / width;
  const scaleY = vh / height;

  frame.style.setProperty('position', 'absolute', 'important');
  frame.style.setProperty('width', `${width}px`, 'important');
  frame.style.setProperty('height', `${height}px`, 'important');
  frame.style.setProperty('left', '0', 'important');
  frame.style.setProperty('top', '0', 'important');
  frame.style.setProperty('transform-origin', '0 0', 'important');
  frame.style.setProperty('transform', `scale(${scaleX}, ${scaleY})`, 'important');
  frame.style.setProperty('border', '0', 'important');
}

/* ------------------------------------------------------------------ *
 * 1 · Configuración de HaxBall
 * ------------------------------------------------------------------ */

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

let _isTVMSyncingStorage = false;
function writeStorage(key, value) {
  try {
    if (localStorage.getItem(key) === value) return false;
    _isTVMSyncingStorage = true;
    localStorage.setItem(key, value);
    _isTVMSyncingStorage = false;
    return true;
  } catch {
    _isTVMSyncingStorage = false;
    return false; // modo privado o storage lleno
  }
}

// Interceptamos setItem globalmente porque el evento 'storage' no se dispara
// en la misma ventana que hace el cambio, y HaxBall comparte el `window` con nosotros.
const origSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function(key, value) {
  origSetItem.call(this, key, value);
  if (_isTVMSyncingStorage) return;
  
  if (this === localStorage) {
    const patch = haxball.fromStorage((k) => k === key ? value : null);
    if (Object.keys(patch).length > 0) {
      ipcRenderer.send('cfg:set', { game: patch });
    }

    /*
     * El apodo también, y no es un detalle: es lo ÚNICO que ata una fila de la
     * lista de jugadores con un cliente.
     *
     * `fromStorage` sólo devuelve ajustes de juego; el apodo va aparte porque
     * `toStorage` lo recibe aparte. O sea que cambiarlo con el botón «Change
     * Nick» de HaxBall no volvía nunca a la config: el cliente seguía creyendo
     * que te llamabas como la última vez que lo escribiste acá. Y con eso roto
     * se rompe todo lo que depende del nombre — tu escudo y tu diamante no
     * aparecían en la lista, y los demás con el cliente tampoco te veían,
     * porque el latido de presencia le decía al sitio el nombre viejo.
     */
    // `state.config` puede no existir todavía: esto se instala antes de `boot()`.
    if (key === haxball.NICK_KEY && state.config) {
      const nick = String(value || '').trim();
      if (nick && nick !== (state.config.general.nickname || '').trim()) {
        state.config.general.nickname = nick;
        ipcRenderer.send('cfg:set', { general: { nickname: nick } });
        safe(paintPeersNow);
        reportRoomInfo(state.view);
      }
    }
  }
};

/** Repinta las marcas de la lista, si hay lista. */
function paintPeersNow() {
  const doc = gameDocument();
  if (doc) paintPeers(doc);
}

function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nada que hacer */
  }
}

/**
 * HaxBall lee estas claves al iniciar. El preload corre antes que sus scripts
 * y comparte origen con el iframe del juego, así que alcanza con escribirlas.
 */
function writeGameSettings() {
  const values = haxball.toStorage(
    state.config.game,
    state.config.general.nickname,
    state.config.avatar && state.config.avatar.static
  );

  // HaxBall conserva su propio `fps_limit` en localStorage y, si quedó en 1
  // desde una sesión anterior, saltea dibujos hasta rondar los 35 FPS aunque el
  // cliente diga «Sin límite». El techo opcional del cliente ya se aplica por
  // separado; el limitador interno debe quedar siempre apagado.
  values.fps_limit = '0';

  let written = 0;
  for (const [key, value] of Object.entries(values)) {
    if (writeStorage(key, value)) written++;
  }

  // Tolerancia de input en 0 para mínima latencia del motor
  writeStorage('input_tolerance', '0');

  // Forzar low_latency_canvas a 0: en Electron con V-Sync apagado,
  // desynchronized: true causa 2200 FPS descontrolados con stuttering.
  // HaxZero también lo deja apagado por defecto (game-min-original.js:L8035).
  writeStorage('low_latency_canvas', '0');

  // La identidad activa, si el jugador eligió una de las guardadas.
  const auth = activeAuthKey();
  if (auth && writeStorage(haxball.AUTH_KEY, auth)) written++;

  // Controles: sólo si el jugador los tocó desde el cliente. Un mapa vacío
  // significa "dejá los que tenga HaxBall".
  const keys = state.config.keys;
  if (keys) {
    if (Object.keys(keys).length) {
      if (writeStorage(haxball.KEYS_KEY, haxball.serializeKeys(keys))) written++;
    } else {
      removeStorage(haxball.KEYS_KEY);
      written++;
    }
  }

  // Bandera elegida a mano. Sin elección se borra el override, para que vuelva
  // a mandar la detección automática de HaxBall.
  const country = countryFor(state.config.countryOverride);
  if (country) {
    if (writeStorage(haxball.GEO_OVERRIDE_KEY, haxball.serializeGeo(country))) written++;
  } else {
    removeStorage(haxball.GEO_OVERRIDE_KEY);
  }

  // Y lo mismo, pero al juego que ya está corriendo: el localStorage sólo lo
  // mira al arrancar. Sin esto nada de lo de arriba se ve hasta recargar.
  safe(applyGameSettingsLive, gameDocument(), values);

  return written;
}

/* ── Ajustes de HaxBall en vivo ──────────────────────────────────────────────
 *
 * Escribir el localStorage no alcanza: el juego lee cada opción UNA vez, al
 * arrancar, y se queda con el valor cacheado adentro (`class ra`). Por eso
 * cambiar la cámara o la escala de resolución no hacía nada hasta recargar — y
 * recargar te saca de la sala, así que en la práctica no se aplicaban nunca.
 *
 * `game-patch.js` publica el objeto de ajustes en `window.__tvmSettings`. Cada
 * opción es un objeto con la clave de storage adentro y dos métodos: leer y
 * escribir. Escribir actualiza el valor cacheado Y el localStorage de una, que
 * es lo que hace la propia HaxBall desde su menú.
 *
 * Los nombres están minificados y cambian entre versiones, así que no se
 * hardcodea ninguno: la opción se busca por su clave de storage y los métodos
 * por su aridad (leer no toma argumentos, escribir toma uno).
 */

/** Cache de la introspección: se rehace si cambia el objeto (recarga del juego). */
let liveSettingsFor = null;
let liveSettingsIndex = null;

function gameSettingsObject(doc) {
  const view = doc && doc.defaultView;
  const cfg = view && view.__tvmSettings;
  return cfg && typeof cfg === 'object' ? cfg : null;
}

/** ¿Se puede aplicar en vivo? Si no, hay que seguir recargando el juego. */
function liveSettingsAvailable(doc) {
  return !!gameSettingsObject(doc);
}

/**
 * Mapa `clave de storage` → { set(valor) } para todas las opciones del juego.
 */
function buildLiveSettingsIndex(cfg) {
  const index = new Map();

  for (const field of Object.keys(cfg)) {
    const entry = cfg[field];
    if (!entry || typeof entry !== 'object') continue;

    // La clave de storage es la única cadena que guarda cada opción.
    const key = Object.keys(entry).map((k) => entry[k]).find((v) => typeof v === 'string');
    if (!key) continue;

    const proto = Object.getPrototypeOf(entry);
    if (!proto) continue;
    const methods = Object.getOwnPropertyNames(proto)
      .filter((n) => n !== 'constructor' && typeof proto[n] === 'function');
    const getter = methods.find((n) => proto[n].length === 0);
    const setter = methods.find((n) => proto[n].length === 1);
    if (!getter || !setter) continue;

    index.set(key, {
      get: () => entry[getter](),
      set: (value) => entry[setter](value)
    });

    if (!proto.__tvmWrapped) {
      proto.__tvmWrapped = true;
      const origSetter = proto[setter];
      proto[setter] = function(value) {
        const selfKey = Object.keys(this).map((k) => this[k]).find((v) => typeof v === 'string');
        const setting = selfKey && haxball.SETTINGS.find(s => s.key === selfKey);
        if (setting && setting.type === 'range') value = Number(haxball.normalize(setting, value));
        const result = origSetter.call(this, value);
        if (_isTVMSyncingLive) return result;
        if (setting) reportGameSetting(setting.id, haxball.normalize(setting, this[getter]()));
        return result;
      };
    }
  }

  return index;
}

function liveSettings(doc) {
  const cfg = gameSettingsObject(doc);
  if (!cfg) return null;
  if (liveSettingsFor !== cfg) {
    liveSettingsFor = cfg;
    liveSettingsIndex = safe(buildLiveSettingsIndex, cfg) || new Map();
  }
  return liveSettingsIndex;
}

/**
 * Empuja los valores al juego ya andando. Devuelve cuántos cambiaron.
 *
 * El valor va CONVERTIDO al tipo que espera cada opción: adentro del juego son
 * números y booleanos, no las cadenas "0"/"1" del storage. Escribir la cadena
 * dejaría `"0"` como valor vivo, que es verdadero.
 *
 * @param {Document} doc
 * @param {Record<string,string>} values  lo mismo que va al localStorage
 */
let _isTVMSyncingLive = false;
let pendingGameSettings = {}, gameSettingsTimer = null;
function reportGameSetting(id, value) {
  if (state.config.game[id] === value) return;
  state.config.game[id] = value;
  pendingGameSettings[id] = value;
  clearTimeout(gameSettingsTimer);
  gameSettingsTimer = setTimeout(() => {
    ipcRenderer.send('game:settings-changed', pendingGameSettings);
    pendingGameSettings = {};
  }, 80);
}
function applyGameSettingsLive(doc, values) {
  const index = liveSettings(doc);
  if (!index) return 0;

  let changed = 0;
  _isTVMSyncingLive = true;
  for (const [key, raw] of Object.entries(values)) {
    const entry = index.get(key);
    if (!entry) continue;
    try {
      const current = entry.get();
      const next = coerceLike(current, raw);
      if (next === null || next === current) continue;
      entry.set(next);
      changed++;
    } catch {
      /* una opción rara no puede tumbar a las demás */
    }
  }
  _isTVMSyncingLive = false;
  return changed;
}

/** Convierte el texto del storage al tipo que ya tiene esa opción adentro. */
function coerceLike(current, raw) {
  const text = String(raw);
  if (typeof current === 'boolean') return text !== '0' && text !== 'false';
  if (typeof current === 'number') {
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof current === 'string' || current === null || current === undefined) return text;
  return null;
}



function countryFor(code) {
  if (!code) return null;
  return countries.find(code);
}

function activeAuthKey() {
  const auth = state.config.auth;
  if (!auth || !auth.activeId) return null;
  const item = (auth.items || []).find((a) => a.id === auth.activeId);
  return item && item.key ? item.key : null;
}

/**
 * Primer arranque de esta versión: el cliente pasó a manejar ajustes que antes
 * sólo vivían dentro de HaxBall (extrapolación, avatar, sonido). En vez de
 * pisarlos con los valores de fábrica, se adopta lo que el jugador ya tenía.
 */
function adoptExistingSettings() {
  if (state.config.general.adoptedGameSettings) return;

  const game = haxball.fromStorage(readStorage);
  const nickname = readStorage(haxball.NICK_KEY) || '';
  const avatarFace = readStorage(haxball.AVATAR_KEY) || '';
  const authKey = readStorage(haxball.AUTH_KEY) || '';

  ipcRenderer.send('game:adopt-settings', {
    game,
    nickname: state.config.general.nickname || nickname,
    avatar: avatarFace,
    authKey
  });

  // Se aplica también en memoria para que este arranque ya sea coherente.
  Object.assign(state.config.game, game);
  if (!state.config.general.nickname && nickname) state.config.general.nickname = nickname;
  if (!state.config.avatar.static && avatarFace) state.config.avatar.static = avatarFace;
  state.config.general.adoptedGameSettings = true;
}

/* ------------------------------------------------------------------ *
 * 2 · Apariencia
 * ------------------------------------------------------------------ */

/** Saca el header del sitio y la publicidad: queda sólo la cancha. */
function applyCleanMode(enabled) {
  // El preload corre antes que el documento exista; en ese caso no hay dónde
  // colgar el <style> todavía y se reintenta cuando el body está listo.
  const mount = document.head || document.documentElement;
  if (!mount) return;

  let style = document.getElementById('tvm-clean');
  if (!enabled) {
    if (style) style.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = 'tvm-clean';
    mount.append(style);
  }
  style.textContent = `
    .header, .rightbar { display: none !important; }
    .container { width: 100vw !important; height: 100vh !important; position: relative !important; overflow: hidden !important; background: #000 !important; }
    .gameframe { width: 100% !important; height: 100% !important; border: 0 !important; }
    body { overflow: hidden !important; background: #000 !important; margin: 0 !important; }
  `;
}

function currentPalette() {
  const look = state.config.appearance;
  return themes.palette(look.theme, look.accent, look.customThemes);
}

/**
 * La tipografía del cliente (Outfit) en un documento que no es del cliente: el
 * del juego y el de arriba, donde viven los carteles. Una vez por documento —
 * son 56 KB de fuentes y no cambian con el tema—. Ver `fontFaceCss`.
 */
function ensureFontFace(doc) {
  if (!doc || doc.getElementById('tvm-font')) return;
  const css = roomUi.fontFaceCss();
  const mount = doc.head || doc.documentElement;
  if (!css || !mount) return;
  const style = doc.createElement('style');
  style.id = 'tvm-font';
  style.textContent = css;
  mount.append(style);
}

/** Inyecta el tema dentro del documento del juego (el iframe). */
function applyGameTheme(doc) {
  if (!doc) return;
  const mount = doc.head || doc.documentElement;
  if (!mount) return;

  const css = themes.gameCss(currentPalette(), { hudScale: state.config.appearance.hudScale });
  let style = doc.getElementById('tvm-theme');
  if (!css) {
    if (style) style.remove();
    return;
  }
  if (!style) {
    style = doc.createElement('style');
    style.id = 'tvm-theme';
    mount.append(style);
  }
  style.textContent = css;
}

/**
 * Reglas que no dependen del tema y van siempre, incluso con «Clásico» puesto
 * (que a propósito no re-estiliza nada):
 *
 *   · Los links del chat, en azul y clickeables.
 *   · Ocultar el chat, si el jugador lo pidió.
 *   · Mantener ligera la lista nativa de HaxBall cuando no está visible.
 *
 * La lista nativa se reutiliza al salir de una sala. No se debe ocultar su
 * contenido con `content-visibility: hidden`: eso también la deja vacía cuando
 * vuelve a mostrarse y los filtros ya no pueden repintar las filas.
 */
function applyClientStyles(doc) {
  if (!doc) return;
  const mount = doc.head || doc.documentElement;
  if (!mount) return;

  let style = doc.getElementById('tvm-client');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'tvm-client';
    mount.append(style);
  }

  const p = currentPalette();
  const hideChat = !!state.config.appearance.hideChat;

  style.textContent = `
    .tvm-link {
      color: ${p.blue} !important;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    .tvm-link:hover { filter: brightness(1.25); }

    /*
     * Modo espejo: el marcador acompaña a la cancha.
     *
     * El marcador es HTML —el canvas no lo toca—, así que con la cancha dada
     * vuelta quedaba el rojo a la izquierda con el rojo jugando a la derecha.
     * HaxBall lo arma simétrico (icono, tanto, guión, tanto, icono), así que
     * darlo vuelta es una línea y sale igual de prolijo que el original.
     * La clase la prende onMirrorFlip().
     */
    html.tvm-mirror .game-state-view .bar > .scoreboard { flex-direction: row-reverse; }

    /* Botones de velocidad y resumen del reproductor de replays. */
    .replay-controls-view .tvm-speeds { display: flex; align-items: stretch; }
    .replay-controls-view .tvm-speeds button { min-width: 38px; }
    .replay-controls-view .tvm-speeds button.is-on {
      background: ${p.accent || p.blue} !important;
      color: #fff !important;
    }
    .replay-controls-view .tvm-stats-btn { padding: 0 10px; }

    /* El cartelito del carrete de goles. Arriba y al medio, que es donde no
       tapa ni el marcador ni el chat, y por encima de todo lo del juego. */
    .tvm-reel {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147481400;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 10px 7px 14px;
      border-radius: 999px;
      border: 1px solid ${p.accent || p.blue};
      background: rgba(0, 0, 0, 0.72);
      color: #fff;
      font: 600 13px/1 system-ui, sans-serif;
      letter-spacing: .02em;
      white-space: nowrap;
      pointer-events: auto;
    }
    .tvm-reel button {
      all: unset;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 999px;
      opacity: .65;
      font-size: 12px;
    }
    .tvm-reel button:hover { opacity: 1; background: rgba(255, 255, 255, 0.14); }

    /* ── Mapas guardados ─────────────────────────────────────────────────
       El diálogo de HaxBall es .dialog.pick-stadium-view y adentro reparte
       .splitter en .list + .buttons. La barra va ARRIBA del splitter: meterla
       adentro le rompería ese reparto horizontal.
       (Sin comillas invertidas acá: esto vive dentro de un template literal.) */
    .pick-stadium-view .tvm-maps {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0 0 8px;
    }
    .pick-stadium-view .tvm-maps__search { flex: 1 1 150px; min-width: 0; }

    /* Las migas: dónde estás parado, y cada tramo salta a ese nivel.
       En la raíz no se dibuja ninguna, y ahí la regla de vacío se lleva también
       el renglón — si no, queda un hueco de 8 px arriba del buscador. */
    .pick-stadium-view .tvm-maps__crumbs {
      flex: 1 0 100%;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 2px;
    }
    .pick-stadium-view .tvm-maps__crumbs:empty { display: none; }
    .pick-stadium-view .tvm-maps__crumb {
      background: none;
      border: 0;
      padding: 2px 4px;
      color: ${p.blue};
      cursor: pointer;
    }
    /* El último tramo es dónde estás: no es un link a ningún lado. */
    .pick-stadium-view .tvm-maps__crumb[disabled] { color: ${p.text}; cursor: default; }
    .pick-stadium-view .tvm-maps__sep { color: ${p.faint}; }

    /* El editor de nombre y carpeta ocupa su propio renglón: al lado del
       buscador, en un diálogo angosto, no entra nada. */
    .pick-stadium-view .tvm-maps__edit { flex: 1 0 100%; display: flex; gap: 6px; }
    .pick-stadium-view .tvm-maps__edit[hidden] { display: none; }
    .pick-stadium-view .tvm-maps__field { flex: 1 1 auto; min-width: 0; }

    .pick-stadium-view .tvm-maps input {
      background: ${p.field};
      color: ${p.text};
      border: 1px solid ${p.line};
      border-radius: 4px;
      padding: 4px 6px;
    }
    .pick-stadium-view .tvm-maps input:focus { border-color: ${p.accent}; }

    /* ── Filas de carpeta ────────────────────────────────────────────────
       Llevan la clase .elem de HaxBall a propósito: así heredan el alto, el
       hover y el resaltado de la lista, y no hay que copiar nada de su CSS. */
    .pick-stadium-view .tvm-row {
      display: flex;
      align-items: center;
      gap: 7px;
      font-weight: 500;
    }
    .pick-stadium-view .tvm-row svg {
      flex: none;
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.8;
    }
    /* Mientras arrastrás: el mapa se atenúa y la carpeta de destino se enciende. */
    .pick-stadium-view .tvm-maps--dragging { opacity: 0.45; }
    .pick-stadium-view .tvm-maps--drop {
      outline: 1px dashed ${p.accent};
      outline-offset: -2px;
      background: ${p.surfaceHi};
    }

    /* Se esconde con clase y no con el atributo hidden: HaxBall le pone
       display a .elem y el atributo perdería. */
    .pick-stadium-view .tvm-maps--off { display: none !important; }

    /* La carpeta va contra el borde derecho de la fila. Flota en vez de ser un
       hijo más porque .elem no es flex y no hay que convertirlo en uno. */
    .pick-stadium-view .tvm-maps__tag {
      float: right;
      margin-left: 8px;
      color: ${p.faint};
      font-size: 0.85em;
    }
    .pick-stadium-view .tvm-maps__btn[disabled] { opacity: 0.45; cursor: default; }

    /* Todo lo que el cliente agrega a la sala —moderación, kick/ban por
       jugador, insignias y la fila de un VIP— sale de room-ui.js, que se
       aplica también con el tema Clásico. Ver el encabezado de ese archivo. */
    ${roomUi.css(p, { animations: state.config.appearance.animations !== false })}

    ${hideChat ? '.game-view .chatbox-view, .room-view .chatbox-view { display: none !important; }' : ''}
  `;
}

/* ------------------------------------------------------------------ *
 * 3 · Puente al documento del juego
 * ------------------------------------------------------------------ *
 * HaxBall vive en <iframe class="gameframe">, mismo origen. El chat, la lista
 * de jugadores y la cancha están ahí adentro, no en el documento de arriba.
 */
function gameDocument() {
  try {
    const frame = document.querySelector('iframe.gameframe') || document.querySelector('iframe[src*="game"]');
    return frame && frame.contentDocument && frame.contentDocument.body ? frame.contentDocument : null;
  } catch {
    return null; // otro origen
  }
}

let lastDocument = null;
let viewObserver = null;
/**
 * La comprobación de vista del documento actual, para poder repetirla desde
 * afuera del MutationObserver. Ver el porqué en `watchGame`.
 */
let recheckView = null;

/** Corre cada vez que aparece un documento de juego nuevo (incluye recargas). */
function onNewGameDocument(doc) {
  applyCameraZoom(doc);
  // Los canvas del documento viejo ya no existen: la marca de "este disco es el
  // mío" no puede sobrevivir a una recarga, ni las texturas del avatar animado,
  // ni la tira de cuadros de la pelota.
  forgetMyTexture();
  forgetGifTextures();
  forgetBallFrames();
  /*
   * El parche del bundle llama acá cuando HaxBall rearma la textura de un
   * disco. Se cuelga de la ventana del JUEGO, que es donde corre el bundle.
   */
  if (doc.defaultView) {
    doc.defaultView.__tvmAvatar = (obj, texto, prop) => safe(onAvatarTexture, obj, texto, prop);
    /*
     * Llega un instante antes que el anterior, con la textura todavía en
     * blanco, y es el único momento en que se sabe de quién es antes de que el
     * gancho del `fillText` tenga que decidir si le mete la imagen encima.
     */
    doc.defaultView.__tvmAvatarPre = (obj) => {
      textureOwner = obj && typeof obj.__tvmMine === 'boolean' ? obj.__tvmMine : null;
    };
  }
  if (gifBytes) safe(buildGifFrames);
  /*
   * Y la pelota igual que el avatar. Esta línea faltaba, y era la mitad de por
   * qué el GIF de la pelota se animaba al elegirlo y quedaba quieto al volver a
   * abrir el cliente.
   *
   * Los cuadros viven en un canvas del documento del JUEGO, así que se los lleva
   * cualquier recarga —y el arranque tiene dos documentos, el `about:blank` del
   * iframe y el de verdad—. Los bytes, en cambio, están acá arriba y sobreviven.
   * Sin este rearmado quedaba `ballSheet` apuntando a un canvas muerto, y por
   * `wantBallGif` no se volvía a pedir nada: el archivo ya figuraba preguntado.
   */
  if (ballGifBytes) safe(buildBallFrames);
  applyGameViewport();
  ensureFontFace(doc);
  applyGameTheme(doc);
  applyClientStyles(doc);
  watchChatLog(doc);
  attachHotkeys(doc);
  attachFreeCam(doc);
  attachHudActions(doc);
  watchViews(doc);
  watchScore(doc);
  // Hook de desynchronized: false en la ventana del iframe del juego.
  // Cada iframe tiene su propio HTMLCanvasElement.prototype.
  if (doc.defaultView) hookDesynchronized(doc.defaultView);
  // El techo de cuadros va sobre la ventana del juego, que es la que dibuja.
  installFrameLimiter(doc.defaultView);
  // El motor de estadísticas se cuelga del estado que publica el parche.
  installTracking(doc.defaultView);
  /*
   * Los ganchos del canvas, antes de que se dibuje el primer cuadro.
   *
   * Va acá y NO adentro de `loadAvatarImage`, que es de donde se llamaba: esa
   * función corta antes si no hay una imagen de avatar VIP, así que los ganchos
   * se instalaban únicamente para un VIP con avatar propio. Ahí adentro vive
   * también «Gráficos planos», o sea que para todos los demás el interruptor no
   * hacía absolutamente nada — y para quien lo tenía, dependía de un ajuste que
   * no tiene nada que ver.
   */
  installCanvasHooks(doc);
  loadAvatarImage(doc.defaultView);
  // Va acá y no más arriba: el hook se publica en el `window` del juego, que en
  // cada navegación es uno nuevo.
  loadBallImage(doc.defaultView);
  reportFlags(doc);
  // Si el parche de ajustes no entró (HaxBall actualizado, cache vieja), la
  // interfaz tiene que saberlo para volver a ofrecer la recarga.
  ipcRenderer.send('game:live-settings', { available: liveSettings(doc) !== null });

  // Verificar si HaxBall rechazó la clave de Auth
  setTimeout(() => {
    try {
      const expectedAuth = activeAuthKey();
      // Use the top-level window localStorage since it shares the same origin and partition
      const actualAuth = window.localStorage.getItem('player_auth_key');
      if (expectedAuth && actualAuth && expectedAuth !== actualAuth) {
        alert(`ATENCIÓN: HaxBall rechazó tu Auth Key pegado y generó una nueva porque es inválida o incompatible.\nEsperado: ${expectedAuth.substring(0, 15)}...\nGenerado: ${actualAuth.substring(0, 15)}...`);
      } else if (!expectedAuth) {
        // No hay auth esperado en la config, no alertamos.
      } else if (expectedAuth === actualAuth) {
        // Si coinciden, mandamos un aviso IPC para loguearlo
        ipcRenderer.send('tvm:debug-log', 'HaxBall aceptó el Auth Key correctamente.');
      }
    } catch(e) {
      alert('Error en diagnóstico de Auth: ' + e.message);
    }
  }, 2000);
}

/* ------------------------------------------------------------------ *
 * Sonido de gol propio (VIP)
 * ------------------------------------------------------------------ *
 * HaxBall no avisa los goles por ninguna API, pero el marcador del HUD sí los
 * canta: `[data-hook="red-score"]` y `blue-score` cambian de texto en el
 * momento exacto. Se vigilan esos dos nodos —nada más— y cuando alguno sube, se
 * dispara el sonido.
 *
 * Se observa `characterData` además de `childList` porque HaxBall reescribe el
 * nodo de texto, no el elemento.
 */
let scoreObserver = null;

/* ── El gol de verdad ──────────────────────────────────────────────────── *
 *
 * El marcador del HUD no alcanza para decir que hubo gol. Sube y baja solo: la
 * extrapolación adelanta la simulación local, y cuando el estado del host la
 * corrige el número vuelve para atrás. Ese es el cartel que aparecía sin que
 * nadie hubiera hecho un gol. Los 400 ms de confirmación tapaban el caso corto
 * y nada más — con ping alto la corrección llega mucho después, y de paso el
 * mismo agujero se abría al ENTRAR a una sala con el partido empezado, cuando
 * el marcador sincroniza de 0-0 al resultado real y eso se lee como dos goles.
 *
 * El motor, en cambio, sí sabe: hay un punto —el que hace sonar el gol— que
 * corre una vez por gol y nunca por una predicción fallada. Ya estamos ahí
 * parados por el sonido propio (`__tvmGoal`), así que ahora el cartel pide las
 * dos cosas: que el marcador haya subido Y que el motor lo haya cantado.
 *
 * Con una salvaguarda: si el parche de sonidos no entró —HaxBall actualizado,
 * cache vieja—, `__tvmGoal` no existe y pedirlo dejaría al cliente sin carteles
 * para siempre. Por eso se mira si el motor habló ALGUNA vez en este documento,
 * cosa que la patada contesta a los pocos segundos de cualquier partido; si
 * nunca habló, se vuelve solo al criterio de antes.                          */

/**
 * El último marcador que se vio, para poder decir cómo terminó el partido.
 *
 * Contar los goles que pasaron por el cliente NO sirve: si entraste con el
 * partido 3-0 empezado, esos tres no los viste, y un partido perdido quedaría
 * anotado como empate en el historial de todos los que estaban en la cancha.
 * Esto, en cambio, es lo que dice el marcador, y el marcador lo sincroniza la
 * sala apenas entrás.
 */
const lastScore = { red: 0, blue: 0 };

/** ¿El parche de sonidos está puesto acá? Lo contestan la patada y el gol. */
let soundHookSeen = false;
/** Cuándo cantó el gol el motor. */
let engineGoalAt = 0;

/**
 * @param {number} desde  momento en que el marcador subió
 * @returns {boolean} si se le puede creer al marcador
 */
function engineSaidGoal(desde) {
  if (!soundHookSeen) return true; // sin parche, el marcador es lo único que hay
  return engineGoalAt >= desde - 1500;
}

function stopScoreWatch() {
  if (!scoreObserver) return;
  scoreObserver.disconnect();
  scoreObserver = null;
}

function watchScore(doc) {
  stopScoreWatch();
  if (!doc) return;

  const read = (hook) => {
    const node = doc.querySelector(`.game-state-view [data-hook="${hook}"]`);
    const n = node ? parseInt((node.textContent || '').trim(), 10) : NaN;
    return Number.isFinite(n) ? n : null;
  };

  // El marcador sólo existe durante la partida. Enganchar el observador al
  // `body` entero mientras tanto —con subtree y characterData— era carísimo:
  // la lista de salas se actualiza sola todo el tiempo y disparaba el callback
  // sin parar. Medido, ese observador solo tenía al proceso del juego en más de
  // un núcleo completo estando quieto en la lista.
  const bar = doc.querySelector('.game-state-view .bar');
  if (!bar) return; // ya se volverá a llamar cuando arranque el partido

  const watchTime = Date.now();
  let red = read('red-score');
  let blue = read('blue-score');
  lastScore.red = red || 0;
  lastScore.blue = blue || 0;

  const check = () => {
    const nextRed = read('red-score');
    const nextBlue = read('blue-score');
    if (nextRed === null || nextBlue === null) return;
    lastScore.red = nextRed;
    lastScore.blue = nextBlue;

    // Sólo cuando SUBE: al empezar un partido el marcador vuelve a 0 y eso no
    // es un gol. Además, se ignora el primer segundo y medio para evitar
    // que el sonido salte al sincronizar el estado inicial al entrar a la sala.
    const scoredRed = nextRed > (red ?? 0);
    const scoredBlue = nextBlue > (blue ?? 0);
    const scored = (scoredRed || scoredBlue) && (Date.now() - watchTime > 1500);

    red = nextRed;
    blue = nextBlue;

    /*
     * Con la sala real enganchada, el gol lo anota el motor en el cuadro exacto
     * (ver `realGoal`), y con los toques confirmados. Este camino queda para
     * cuando el bundle no la publicó: si mandara igual, cada gol llegaría dos
     * veces a la interfaz.
     */
    if (scored && realActive()) return;

    if (scored) {
      /*
       * El autor se resuelve ACÁ y no después de confirmar: los 400 ms de
       * confirmación son 3 segundos de partido a 8x, y para entonces el saque
       * del medio ya ensució la lista de toques. Se guarda la foto ahora y se
       * manda —o se descarta— cuando el marcador se confirma.
       */
      const goal = describeGoal(scoredRed ? 'Red' : 'Blue', doc, {
        red: nextRed,
        blue: nextBlue
      });
      /* Sin confirmar y a propósito: el destello lo dispara el juego (ver
         `__tvmGoal`) y lo único que busca acá es de qué color pintarse. Si esto
         resultara ser una ilusión de la extrapolación, el destello no salió —
         porque el juego tampoco sonó— y este dato se vence solo a los 600 ms. */
      noteGoalTeam(scoredRed ? 'Red' : 'Blue');
      const subioAt = Date.now();
      setTimeout(() => {
        const confirmRed = read('red-score');
        const confirmBlue = read('blue-score');
        // El motor tiene la última palabra: sin su aviso, esto fue el marcador
        // moviéndose solo. Ver `engineSaidGoal`.
        if (!engineSaidGoal(subioAt)) {
          log('info', 'marcador arriba sin gol del motor: no se muestra el cartel', 'juego');
          return;
        }
        // Si el marcador bajó, fue una ilusión por la extrapolación.
        if (confirmRed !== null && confirmBlue !== null) {
          if ((scoredRed && confirmRed >= nextRed) || (scoredBlue && confirmBlue >= nextBlue)) {
            // El sonido NO se dispara acá: lo llama el propio juego, en el
            // instante en que haría sonar el suyo (ver `patchSounds`). Esto es
            // sólo el aviso a la interfaz, que sí necesita la confirmación
            // porque un marcador que sube y baja es una ilusión de la
            // extrapolación.
            ipcRenderer.send('game:goal', goal);
          }
        }
      }, 400);
    }
  };

  scoreObserver = new MutationObserver(check);
  scoreObserver.observe(bar, { childList: true, subtree: true, characterData: true });
}

/* ── El interruptor de sonido del juego ─────────────────────────────────── *
 *
 * Los sonidos propios (la patada y el gol) son elementos `<audio>` nuestros, no
 * pasan por el mezclador de HaxBall. O sea que el botón del altavoz de la
 * botonera —el que todo el mundo usa para callar el juego— no los apagaba: se
 * bajaba el suyo y los nuestros seguían sonando a todo volumen.
 *
 * Del propio bundle, ese botón y su barrita no hacen otra cosa que escribir dos
 * ajustes de siempre y recalcular la ganancia del nodo maestro:
 *
 *   b.get("sound-btn").onclick = function(){ m.j.ye.ia(!m.j.ye.v()); c.A() };
 *   …  Fi(){ let a = m.j.Xi.v(); m.j.ye.v() || (a = 0); this.qg.gain.value = a }
 *
 * donde `ye` es `sound_main` y `Xi` es `sound_volume`. Así que preguntar por
 * esas dos claves es preguntar exactamente lo mismo que se pregunta el juego
 * antes de sonar, sin depender de ningún nombre minificado: los ajustes vivos
 * ya están indexados por su clave de storage (ver `applyGameSettingsLive`).
 *
 * Devuelve 0..1: el mismo número que HaxBall le pone a su ganancia maestra. Sin
 * introspección disponible devuelve 1, que es como sonaba antes de esto.
 */
function gameSoundLevel() {
  const index = liveSettings(gameDocument());
  if (!index) return 1;
  try {
    const main = index.get('sound_main');
    // Sólo un `false` explícito calla: si la opción no está, no se inventa un
    // mudo que el jugador no pidió.
    if (main && main.get() === false) return 0;
    const volume = index.get('sound_volume');
    if (!volume) return 1;
    const n = Number(volume.get());
    if (!Number.isFinite(n)) return 1;
    return Math.min(1, Math.max(0, n));
  } catch {
    return 1;
  }
}

let goalAudio = null;

/**
 * Igual que el de la patada: `true` si sonó el propio y el del juego se saltea.
 * Lo llama el bundle en el punto exacto donde iba a sonar el suyo, así que no
 * hace falta ni adivinar el momento ni callar nada por otro lado.
 */
function playGoalSound() {
  const file = state.config.vip && state.config.vip.goalSound;
  if (!file) return false;

  /*
   * Con el juego callado no suena tampoco el propio. Se contesta `true` —«de
   * este gol me ocupo yo»— y no `false`: con `false` el bundle armaría igual su
   * buffer, que en silencio no molesta pero es trabajo al pedo.
   */
  const level = gameSoundLevel();
  if (level <= 0) return true;

  try {
    // Un solo elemento reutilizado: crear uno por gol dejaba nodos colgando.
    if (!goalAudio || goalAudio.dataset.src !== file) {
      goalAudio = new Audio(assetUrl('goal', hashOf(file)));
      goalAudio.dataset.src = file;
    }
    // El volumen del jugador POR el del juego: así la barrita del altavoz sube
    // y baja el sonido propio igual que el de fábrica.
    const wanted = Math.min(1, Math.max(0, Number(state.config.vip.goalVolume) || 0.7));
    goalAudio.volume = wanted * level;
    goalAudio.currentTime = 0;
    goalAudio.play().catch(() => { /* el archivo puede haberse borrado */ });
    return true;
  } catch (err) {
    log('error', `No se pudo reproducir el sonido de gol: ${err.message}`, 'vip');
    return false;
  }
}

/* ── El sonido de la patada ─────────────────────────────────────────────── *
 *
 * Suena cuando CUALQUIERA patea la pelota, no sólo vos. Patear, no tocar:
 * llevarla pegada, un rebote o la que te pega yendo no suenan.
 *
 * Sale de un solo lugar, `installKickHook`, que es el enganche que el motor
 * llama al ejecutar la patada — el mismo con el que HaxBall hace sonar su
 * `kick.wav`. Por eso no lo ensucia la extrapolación: no se está mirando quién
 * está cerca de la pelota, se está escuchando al motor decir "pateó".
 *
 * Antes también sonaba desde el camino de los toques por cercanía, y de ahí
 * salían los dos falsos: sonaba al llevar la pelota sin apretar la patada, y
 * sonaba al falsear, porque con la extrapolación ese camino ve contactos que
 * nunca pasaron.                                                            */

/**
 * UN solo elemento, que se reinicia en cada golpe.
 *
 * Primero eran cuatro turnándose, para que un golpe no cortara al anterior. Es
 * lo contrario de lo que se quiere: el sonido acompaña al golpe, así que si
 * llega otro antes de que el primero termine, el que vale es el nuevo. Con las
 * voces turnándose se superponían y sonaba a eco.
 */
let hitAudio = null;
let hitAudioFor = '';
let hitStopTimer = null;

/**
 * Dos patadas más juntas que esto son el mismo ruido.
 *
 * Ahora que sólo suena la patada alcanza con que sea corto: el juego ya le pone
 * su propia espera a cada jugador entre patada y patada. Esto es para dos
 * jugadores que patean en el mismo instante —un forcejeo—, que si no sonaría
 * como un eco. Era mucho más largo cuando el sonido salía también del empujón
 * sostenido, que sí se repetía cuadro tras cuadro.
 */
const HIT_SOUND_GAP_MS = 50;
let lastHitSoundAt = 0;

/**
 * Hasta acá se lo deja sonar, por más largo que sea el archivo.
 *
 * Un sonido de golpe es un golpe: si alguien pone una canción de tres minutos,
 * se corta sola. Se hace al reproducir y no al elegir el archivo a propósito —
 * la duración real recién se sabe con el audio ya decodificado, y rechazar el
 * archivo obligaría a esperar esa carga adentro del diálogo.
 */
const HIT_SOUND_MAX_MS = 3000;

/**
 * Devuelve `true` si sonó el propio, y entonces el del juego se saltea.
 *
 * Devolver `false` es decirle al bundle «no tengo nada, sonás vos»: sin sonido
 * propio o sin rol, HaxBall suena como siempre. Ver `patchSounds`.
 */
function playHitSound() {
  const cfg = state.config.vip;
  const file = cfg && cfg.hitSound;
  if (!file) return false;

  // Callado el juego, callado esto. Va ANTES de la espera entre patadas: si no,
  // la patada muda dejaría marcada la hora y la primera de después de sacar el
  // mudo se comería a sí misma. Ver `gameSoundLevel`.
  const level = gameSoundLevel();
  if (level <= 0) return true;

  // El corte va por reloj de pared y no por el de la partida: es sobre lo que
  // el oído aguanta, no sobre lo que pasa en la cancha. Se contesta `true`
  // igual: si dijéramos `false`, el aviso de fábrica llenaría el hueco y el
  // corte no serviría de nada.
  const now = Date.now();
  if (now - lastHitSoundAt < HIT_SOUND_GAP_MS) return true;
  lastHitSoundAt = now;

  try {
    if (hitAudioFor !== file) {
      hitAudioFor = file;
      hitAudio = new Audio(assetUrl('hit', hashOf(file)));
    }

    // `|| 0.7` no sirve acá: dejar el volumen en cero es una opción válida y
    // con `||` se convertiría en 70%.
    const wanted = Number(cfg.hitVolume);
    const own = Math.min(1, Math.max(0, Number.isFinite(wanted) ? wanted : 0.7));
    hitAudio.volume = own * level;

    // Reiniciar es todo: si el anterior seguía sonando, este golpe lo pisa.
    hitAudio.currentTime = 0;
    hitAudio.play().catch(() => { /* el archivo puede haberse borrado */ });

    clearTimeout(hitStopTimer);
    hitStopTimer = setTimeout(() => {
      try {
        hitAudio.pause();
        hitAudio.currentTime = 0;
      } catch { /* se cambió el archivo en el medio */ }
    }, HIT_SOUND_MAX_MS);
    return true;
  } catch (err) {
    log('error', `No se pudo reproducir el sonido de la patada: ${err.message}`, 'vip');
    return false;
  }
}

/** Los beneficios VIP locales están habilitados para esta instalación del club. */
function isVipNow() {
  return true;
}

/**
 * Los recursos del jugador NO se pueden cargar por `file://`: esta página es
 * https y Chromium bloquea la mezcla, en silencio. Van por el esquema propio
 * que sirve el proceso principal (ver registerAssetProtocol en main.js).
 *
 * La marca de tiempo fuerza a saltear la caché cuando el jugador cambia el
 * archivo pero la URL sigue siendo la misma.
 */
function assetUrl(kind, version) {
  return `tvm-asset://${kind}/?v=${version || 0}`;
}

/** Qué pantalla de HaxBall está montada, para que la interfaz sepa qué mostrar. */
const VIEW_KINDS = [
  /*
   * El replay NO tiene vista propia: HaxBall monta la MISMA `.game-view` y le
   * agrega la clase `replayer` (`this.l.f.classList.add("replayer")` en el
   * bundle). Por eso hay que mirarlo antes que `.game-view`, y por eso el
   * `.replay-view` que se buscaba acá antes no existía en ninguna versión: la
   * vista nunca daba 'replay', así que los controles del cliente —los botones de
   * velocidad, el resumen— no se enganchaban nunca.
   */
  ['.game-view.replayer', 'replay'],
  /*
   * `.game-view` está montada desde que entrás a la sala, con partido o sin él:
   * la vista de sala no es su hermana, es su HIJA (ver `xe()` en el bundle y el
   * comentario de `watchRoomPanel`). Así que esto no significa "está jugando"
   * sino "está adentro de una sala", y `.room-view` de abajo nunca gana.
   */
  ['.game-view', 'game'],
  ['.room-view', 'room'],
  ['.roomlist-view', 'roomlist'],
  // La sala pide contraseña. Es una vista propia y hay que mostrarla: mientras
  // no estaba en esta lista, el cliente la tomaba por "todavía cargando",
  // dejaba el juego escondido y no había dónde escribir nada.
  ['.room-password-view', 'password'],
  ['.choose-nickname-view', 'nickname'],
  ['.connecting-view', 'connecting'],
  ['.disconnected-view', 'disconnected'],
  // Verificación anti-bot y errores: hay que mostrárselo al usuario sí o sí.
  ['.simple-dialog-view', 'dialog']
];

/** Cualquier pantalla de HaxBall se llama `algo-view` y cuelga del envoltorio. */
const VIEW_CLASS = /(?:^|\s)[a-z0-9-]+-view(?:\s|$)/i;

function isViewVisible(doc, selector) {
  const view = doc.querySelector(selector);
  if (!view) return false;

  for (let node = view; node && node !== doc; node = node.parentElement) {
    if (node.hidden) return false;
    const style = doc.defaultView.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false;
    }
  }
  return true;
}

function viewAtCenter(doc) {
  if (!doc.elementFromPoint) return null;
  const win = doc.defaultView;
  const target = doc.elementFromPoint(
    Math.floor((win.innerWidth || doc.documentElement.clientWidth) / 2),
    Math.floor((win.innerHeight || doc.documentElement.clientHeight) / 2)
  );

  for (let node = target; node && node !== doc; node = node.parentElement) {
    for (const [selector, kind] of VIEW_KINDS) {
      if (!node.matches || !node.matches(selector)) continue;
      // The room panel is nested in the game view; it does not mean we left the room.
      return kind === 'room' ? 'game' : kind;
    }
  }
  return null;
}

function currentView(doc) {
  const hitTestKind = viewAtCenter(doc);
  if (hitTestKind) return hitTestKind;

  for (const [selector, kind] of VIEW_KINDS) {
    if (isViewVisible(doc, selector)) return kind;
  }

  for (const [selector, kind] of VIEW_KINDS) {
    if (doc.querySelector(selector)) return kind;
  }

  /*
   * Pantalla que no conocemos.
   *
   * Devolver "loading" acá era una trampa: la interfaz esconde el juego
   * mientras carga, así que cualquier pantalla nueva de HaxBall quedaba
   * invisible y el cliente trabado esperando algo que ya había pasado. Si hay
   * una vista montada, se muestra: es preferible que se vea HaxBall crudo a que
   * no se vea nada.
   */
  const wrapper = doc.body && doc.body.firstElementChild;
  const mounted = wrapper && [...wrapper.children].some((el) => VIEW_CLASS.test(el.className || ''));
  return mounted ? 'dialog' : 'loading';
}

/**
 * Detecta el cambio de pantalla con un MutationObserver en vez de sondear.
 * Un setInterval corriendo en el mismo proceso que el juego le roba tiempo al
 * hilo principal justo cuando más importa: durante la partida.
 *
 * HaxBall monta las vistas en `body > div`, así que alcanza con vigilar los
 * hijos de ese contenedor — nada de `subtree: true`, que dispararía con cada
 * mensaje de chat.
 */
function watchViews(doc) {
  if (viewObserver) viewObserver.disconnect();
  let wrapper = null;

  const check = () => {
    const kind = currentView(doc);
    if (kind !== state.view) {
      state.view = kind;
      refreshFrameBudget();
      ipcRenderer.send('game:view', kind);
      syncFpsMeter();
      syncTelemetry();
      // El marcador aparece recién con la partida: es acá donde hay HUD al que
      // engancharse, y fuera de la partida se suelta. El replay usa el mismo
      // marcador, así que los goles de una grabación se cuentan igual.
      if (kind === 'game' || kind === 'replay') {
        safe(watchScore, doc);
        safe(checkTrackingPatch, doc);
      } else {
        stopScoreWatch();
        resetTracker();
      }
      // La pantalla de nickname la resolvemos nosotros: el usuario ya puso su
      // nombre en el cliente, no tiene por qué verla dos veces.
      if (kind === 'nickname') skipNicknameScreen(doc);
      // La contraseña la escribe el usuario: le dejamos el cursor puesto.
      if (kind === 'password') safe(focusPasswordField, doc);
      /*
       * También con la vista en `game`, y acá está la razón de que la lista no
       * se pintara NUNCA.
       *
       * La vista de sala no es hermana de la de partida: vive ADENTRO. En el
       * bundle, la clase de la cancha construye la de la sala como un hijo
       * (`this.Xa = new ib(a)`) y la mete y la saca de `.top-section` cuando
       * tocás el botón Menu:
       *
       *   xe(a){ this.od!=a && (this.od=a,
       *          this.f.classList.toggle("showing-room-view", this.od),
       *          this.od ? this.ws.appendChild(this.Xa.f) : this.Xa.f.remove()) }
       *
       * O sea que `.game-view` está montada desde que entrás a la sala, con
       * partido o sin él. Y como se mira antes que `.room-view`, la vista da
       * `game` todo el tiempo: el arranque de acá, condicionado a `room`, no
       * corría jamás — ni el escudo, ni los degradados, ni los botones de
       * kick/ban de cada fila.
       *
       * El vigilante ya busca el contenedor en un temporizador, así que se banca
       * solo que la sala aparezca y desaparezca con el botón Menu.
       */
      kind === 'room' || kind === 'game' ? watchRoomPanel(doc) : stopRoomPanel();
      // El selector de estadios sale del panel de la sala, así que sigue la
      // misma vida que él: fuera de la sala no hay diálogo que vigilar.
      kind === 'room' || kind === 'game' ? watchStadiumPicker(doc) : stopStadiumPicker();
      // Los botones del HUD y el chat se montan recién al entrar a la partida.
      if (kind === 'game' || kind === 'room' || kind === 'replay') {
        attachChatCommands(doc);
        attachHudActions(doc);
        watchChatLogSoon(doc);
      }
      if (kind === 'replay') safe(watchReplayView, doc);
      reportRoomName(doc, kind);
      safe(reportRoomInfo, kind);
      positionOverlay();
    }

    /*
     * Va afuera del cambio de vista, no adentro.
     *
     * HaxBall rehace el chat también sin cambiar de pantalla —entrar y salir del
     * menú de la sala, por ejemplo—, y ahí los botones se irían con el DOM viejo
     * para no volver nunca. Acá se revisa en cada vuelta: si ya están puestos,
     * `mountChatTools` sale en un `querySelector` y no cuesta nada.
     */
    safe(mountChatTools, doc);

    const playing = kind === 'game';
    if (playing === state.playing) return;
    state.playing = playing;
    ipcRenderer.send('game:playing', playing);
  };

  const attach = () => {
    const next = doc.body.firstElementChild;
    if (next && next !== wrapper) {
      wrapper = next;
      viewObserver.observe(wrapper, { childList: true });
    }
    if (!wrapper) return;
    for (const view of wrapper.children) {
      if (VIEW_CLASS.test(view.className || '')) {
        viewObserver.observe(view, {
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
        });
      }
    }
  };

  viewObserver = new MutationObserver(() => {
    attach();
    check();
  });
  viewObserver.observe(doc.body, { childList: true });
  attach();
  check();
  recheckView = check;
}

/**
 * El iframe del juego se recrea al recargar y para eso no hay evento, así que
 * hay que sondear. Al principio rápido —si el tema tarda, se ve un parpadeo de
 * HaxBall sin estilar— y una vez enganchado, lento, para no robarle tiempo al
 * hilo del juego durante la partida.
 */
function watchGame() {
  let delay = 60;
  // Después de cargar un documento nuevo (entrar a una sala, salir) la pantalla
  // cambia varias veces seguidas y un aviso perdido se nota: se mira cada 300 ms
  // durante 20 s y recién después se afloja a 1,2 s para no robarle tiempo al juego.
  let fastUntil = 0;
  const tick = () => {
    const doc = gameDocument();
    if (doc && doc !== lastDocument) {
      lastDocument = doc;
      safe(onNewGameDocument, doc);
      fastUntil = Date.now() + 20000;
      ipcRenderer.send('game:themed');
    }
    if (doc) delay = Date.now() < fastUntil ? 300 : 1200;
    /*
     * La vista se vuelve a mirar en cada vuelta, aunque el documento sea el
     * mismo.
     *
     * El MutationObserver de `watchViews` sigue siendo el que reacciona
     * rápido; esto es la red. Si una sola notificación se pierde —el
     * contenedor que se recrea, un error en el medio del `check`— la vista
     * queda congelada en la anterior, y de ahí salían dos cosas que parecían
     * no tener nada que ver: el techo de cuadros de reposo (60) puesto durante
     * toda la partida, porque para `frameBudgetMs` seguíamos fuera de la
     * cancha, y la sala sin nombre en la presencia de Discord, porque el
     * nombre se lee justo cuando la vista cambia.
     *
     * Cuesta un puñado de `querySelector` cada 1,2 s y sólo hace algo cuando
     * la vista de verdad cambió.
     */
    if (doc && recheckView) safe(recheckView);
    // El nombre de la sala también se remira: puede llegar tarde (el título lo
    // rellena el juego cuando el servidor contesta) o cambiar en el medio si el
    // host renombra la sala.
    if (doc) safe(refreshRoomName, doc);
    setTimeout(tick, delay);
  };
  tick();
}

/* ------------------------------------------------------------------ *
 * Botonera flotante de la partida
 * ------------------------------------------------------------------ *
 * HaxBall arma este HUD así (sacado de su propio bundle):
 *
 *   <div class='buttons'>
 *     <div class='sound-button-container' data-hook="sound"> … </div>
 *     <button data-hook='menu'><i class='icon-menu'></i>Menu<span class='tooltip'>…</span></button>
 *     <button data-hook='settings'><i class='icon-cog'></i></button>
 *   </div>
 *
 * El engranaje abre el diálogo de ajustes de HaxBall, que ahora es redundante:
 * todos esos ajustes están en la pestaña Ajustes del cliente, mejor explicados
 * y persistidos. Se intercepta el click y se abre la del cliente.
 */
function attachHudActions(doc) {
  const buttons = doc.querySelector('.game-view > .buttons');
  if (!buttons || buttons.dataset.tvmHud) return;
  buttons.dataset.tvmHud = '1';

  buttons.addEventListener('click', (event) => {
    const gear = event.target.closest && event.target.closest('button[data-hook="settings"]');
    if (!gear) return;
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.send('game:open-settings');
  }, true);
}

/* ------------------------------------------------------------------ *
 * Reproducción de replays
 * ------------------------------------------------------------------ *
 * HaxBall trae su propio reproductor: el botón "Replays" de la lista de salas
 * es un <label class="file-btn"> con un <input type="file" accept=".hbr2">.
 * Le pasamos el archivo por código y el juego hace el resto.
 */
async function playReplay({ name, base64 }) {
  const doc = gameDocument();
  if (!doc) {
    notify('El juego todavía no cargó', 'err');
    return;
  }
  // Los goles del carrete son de la grabación que se está por cerrar.
  safe(stopReel);

  const input = await waitForReplayInput(doc);
  if (!input) {
    notify('Salí de la sala para ver un replay', 'err');
    return;
  }

  try {
    const view = doc.defaultView;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const transfer = new view.DataTransfer();
    transfer.items.add(new view.File([bytes], name, { type: 'application/octet-stream' }));
    input.files = transfer.files;
    input.dispatchEvent(new view.Event('change', { bubbles: true }));

    // El aviso de "reproduciendo" lo muestra la interfaz del cliente: si lo
    // mandáramos también desde acá, el usuario vería dos carteles.
    log('info', `Replay abierto: ${name}`, 'replay');
  } catch (err) {
    notify('No se pudo abrir el replay', 'err');
    log('error', `No se pudo abrir el replay: ${err.message}`, 'replay');
  }
}

/**
 * El reproductor sólo existe en la lista de salas. Si el juego quedó en la
 * pantalla de nickname le damos Ok y esperamos, en vez de mandar al usuario
 * a hacerlo a mano.
 */
function waitForReplayInput(doc) {
  return waitFor(doc, 'input[data-hook="replayfile"]');
}

/* ------------------------------------------------------------------ *
 * Velocidades del reproductor
 * ------------------------------------------------------------------ *
 * HaxBall ya trae `-` y `+` al lado del `1x`, sólo que su lista llegaba hasta
 * 3x. El parche del bundle la agranda hasta 16x y publica un control en
 * `window.__tvmReplay` para poder saltar a una velocidad exacta; acá se agregan
 * los botones directos que usan ese control.
 *
 * Esto acelera la SIMULACIÓN entera —físicas, chat, marcador—, no el dibujo: por
 * eso el resumen del partido se sigue armando bien a 8x. Para el resumen de la
 * grabación entera no se usa la velocidad: se la simula aparte y sin dibujarla,
 * ver `analyzeReplay`.
 */
const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];

async function watchReplayView(doc) {
  const controls = await waitFor(doc, '.replay-controls-view');
  if (!controls || controls.dataset.tvmSpeed) return;

  const view = doc.defaultView;
  if (!view.__tvmReplay) {
    // Sin parche no hay a qué pedirle la velocidad, y unos botones que no hacen
    // nada son peor que no tenerlos.
    log('warn', 'el parche del reproductor no entró: quedan las velocidades de HaxBall', 'replay');
    return;
  }
  controls.dataset.tvmSpeed = '1';

  const bar = doc.createElement('div');
  bar.className = 'tvm-speeds';

  for (const speed of REPLAY_SPEEDS) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = `${speed}x`;
    button.dataset.tvmSpeed = String(speed);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      try {
        view.__tvmReplay.set(speed);
      } catch (err) {
        log('error', `no se pudo cambiar la velocidad: ${err.message}`, 'replay');
      }
    });
    bar.append(button);
  }

  const stats = doc.createElement('button');
  stats.type = 'button';
  stats.className = 'tvm-stats-btn';
  stats.textContent = 'Resumen';
  stats.title = 'Resumen de toda la grabación';
  // Acá el resumen es de la grabación ENTERA, no de lo que se vio hasta ahora:
  // el análisis simula lo que falta sin reproducirlo. Ver `analyzeReplay`.
  stats.addEventListener('click', (event) => {
    event.preventDefault();
    ipcRenderer.send('game:toggle-stats', { analyze: true });
  });

  // Antes del cronómetro: los botones de velocidad quedan todos juntos y la
  // barra de tiempo no se corre de lugar.
  const time = controls.querySelector('[data-hook="time"]');
  controls.insertBefore(bar, time);
  controls.insertBefore(stats, time);

  const paint = () => {
    const current = view.__tvmReplay && view.__tvmReplay.speed;
    for (const button of bar.children) {
      button.classList.toggle('is-on', Number(button.dataset.tvmSpeed) === Number(current));
    }
  };

  // El `+`/`-` de HaxBall también cambia la velocidad, así que se repinta con
  // cualquier click de la barra —el nuestro incluido— en vez de sondear.
  controls.addEventListener('click', () => setTimeout(paint, 0), true);

  /*
   * Tocar los controles corta el carrete de goles.
   *
   * Es la señal más clara de "me lo llevo yo": si el usuario pausa, cambia la
   * velocidad o arrastra la barra y el carrete siguiera saltando al gol
   * siguiente, la grabación se le movería sola de las manos. La cruz del
   * cartelito no cuenta, que vive fuera de esta barra y ya corta por su lado.
   */
  controls.addEventListener('pointerdown', () => safe(stopReel), true);

  paint();
}

/** Espera a que aparezca un selector, pasando la pantalla de nickname si estorba. */
function waitFor(doc, selector, timeout = 8000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const tick = () => {
      const found = doc.querySelector(selector);
      if (found) return resolve(found);
      doc.querySelector('.choose-nickname-view [data-hook="ok"]')?.click();
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 250);
    };
    tick();
  });
}

/* ------------------------------------------------------------------ *
 * Crear sala
 * ------------------------------------------------------------------ *
 * Llenamos el formulario propio de HaxBall desde la interfaz del cliente.
 * Si HaxBall pide su verificación anti-bot ("Only humans"), no se toca: se
 * muestra tal cual y la resuelve el usuario.
 */
async function createRoom({ name, password, maxPlayers, listed }) {
  const doc = gameDocument();
  if (!doc) {
    notify('El juego todavía no cargó', 'err');
    return;
  }

  const button = await waitFor(doc, '.roomlist-view [data-hook="create"]');
  if (!button) {
    notify('Salí de la sala para crear otra', 'err');
    return;
  }
  button.click();

  const dialog = await waitFor(doc, '.dialog [data-hook="max-pl"]', 5000);
  if (!dialog) {
    notify('No apareció el formulario de sala', 'err');
    return;
  }

  const view = doc.defaultView;
  const box = doc.querySelector('.dialog');

  setInputValue(view, box.querySelector('[data-hook="name"]'), name);
  setInputValue(view, box.querySelector('[data-hook="pass"]'), password || '');

  const max = box.querySelector('[data-hook="max-pl"]');
  if (max) {
    max.value = String(maxPlayers);
    max.dispatchEvent(new view.Event('change', { bubbles: true }));
  }

  const visibility = box.querySelector('[data-hook="unlisted"]');
  if (visibility) setListed(visibility, !!listed);

  await new Promise((r) => setTimeout(r, 250));
  box.querySelector('[data-hook="create"]')?.click();
  log('info', `Creando sala: ${name}`, 'sala');
}

/**
 * Si la sala va a aparecer en la lista pública, según el botón de HaxBall.
 *
 * El estado no está en ninguna clase ni atributo: el único lugar donde vive es
 * el texto del botón, que en el bundle se arma así —
 *
 *     Yj(a){ this.fn=a; this.en.textContent="Show in room list: "+(a?"No":"Yes") }
 *
 * y que el parche traduce a «Aparecer en la lista: » + «Sí»/«No». Por eso hay
 * que entender los dos idiomas: el juego puede venir sin traducir si el parche
 * del bundle no entró.
 *
 * Se mira SÓLO lo que va después de los dos puntos, y por la primera letra.
 * Antes esto era un `/:\s*(yes|s[íi])\b/i` y con el juego en español no
 * matcheaba nunca: `\b` se calcula con `[A-Za-z0-9_]`, así que después de la
 * «í» de «Sí» no hay borde de palabra. El cliente creía siempre que la sala
 * estaba oculta y la opción salía justo al revés de lo que se había pedido.
 *
 * @returns {boolean|null} `null` si el texto no se reconoce
 */
function readListed(button) {
  const text = button.textContent || '';
  const at = text.lastIndexOf(':');
  const value = (at < 0 ? '' : text.slice(at + 1)).trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith('s') || value.startsWith('y')) return true; // Sí · Si · Yes
  if (value.startsWith('n')) return false;                         // No
  return null;
}

/**
 * Deja el botón en el estado pedido.
 *
 * Después del clic se vuelve a leer y, si no quedó como se pidió, se deshace.
 * Acá el peor final no es "no se aplicó la opción" sino "se aplicó al revés":
 * una sala que tenía que ser privada publicada en la lista de todo el mundo. Si
 * algún día HaxBall cambia el texto, esto se planta en el valor por omisión en
 * vez de invertirlo, y queda dicho en el log.
 */
function setListed(button, listed) {
  const before = readListed(button);
  if (before === null) {
    log('warn', 'no se pudo leer «Aparecer en la lista»: queda como la deja HaxBall', 'sala');
    return;
  }
  if (before === listed) return;

  button.click();
  if (readListed(button) === listed) return;

  button.click();
  log('warn', 'el botón de «Aparecer en la lista» no respondió: queda como la deja HaxBall', 'sala');
}

/** React ignora `input.value` directo: hay que usar el setter nativo. */
function setInputValue(view, el, value) {
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new view.Event('input', { bubbles: true }));
}

/* ------------------------------------------------------------------ *
 * 4 · Funciones integradas
 * ------------------------------------------------------------------ */

/**
 * Completa el nick y confirma, para que el usuario nunca vea el diálogo de
 * HaxBall: ya cargó su nombre en el cliente.
 */
function skipNicknameScreen(doc) {
  const nick = state.config.general.nickname;
  if (!nick) return; // sin nombre configurado lo pide la interfaz del cliente

  const input = doc.querySelector('.choose-nickname-view input');
  if (!input) return;

  if (!input.value) setInputValue(doc.defaultView, input, nick);
  doc.querySelector('.choose-nickname-view [data-hook="ok"]')?.click();
}

/**
 * La sala pide contraseña. Acá no hay nada que resolver por el usuario: sólo se
 * le deja el cursor en el campo para que la escriba y listo.
 */
function focusPasswordField(doc) {
  const input = doc.querySelector('.room-password-view input');
  if (input) input.focus();
}

/**
 * El nombre de la sala, para la presencia de Discord.
 *
 * Antes salía de la fila que el jugador había marcado en NUESTRA lista, así que
 * al entrar por un link —o a una sala que no está publicada— no había fila y
 * Discord mostraba «HaxBall» a secas. El nombre real lo tiene HaxBall en el
 * título de la sala; se lee de ahí y se recuerda, porque durante la partida esa
 * pantalla se desmonta.
 *
 * Se reintenta hasta encontrarlo en vez de leer dos veces y darse por vencido.
 * Al CREAR una sala la vista se monta apenas se resuelve el CAPTCHA y el título
 * llega bastante después: con las dos lecturas fijas de antes (0 y 600 ms) la
 * sala recién creada se quedaba sin nombre para siempre, y la presencia de
 * Discord terminaba mostrando el de otra sala.
 */

/**
 * Esperas entre lecturas, en ms. Arrancan cortas porque al ENTRAR a una sala el
 * título ya está, y se estiran porque al CREARLA hay que aguantar el CAPTCHA y
 * el alta en el servidor. Suman ~11 s: más que eso, la sala no se creó.
 */
const ROOM_NAME_RETRIES = [150, 300, 600, 1000, 1500, 2500, 2500, 2500];
let roomNameTimer = null;

/** Dentro de una sala. Es donde hay nombre que leer y donde tiene sentido. */
/**
 * El último nombre que dijo el motor, para no repetir trabajo en cada cuadro.
 * Se olvida al salir de la sala: si volvés a la misma, hay que volver a
 * anunciarla. Ver `onGameTick`.
 */
let engineRoomName = null;

function inRoom(kind) {
  return kind === 'room' || kind === 'game';
}

/**
 * De dónde sale el nombre.
 *
 * El h1 lo arma el propio bundle y lo marca con su hook:
 *
 *   ib.O = "<div class='room-view'><div class='container'><h1 data-hook='room-name'></h1>…"
 *
 * y lo rellena en `A()` cuando el servidor contesta. Se busca por el hook, que
 * es lo que el juego usa para encontrarlo él mismo, y se deja la posición como
 * respaldo por si algún día le cambian el atributo.
 *
 * Acá había además una primera lectura de `doc.title`, esperando un
 * "HaxBall - NombreSala". No servía nunca: `game.html` no trae ningún <title> y
 * en todo game-min.js no hay una sola escritura de `document.title`. Se fue,
 * porque hacía parecer que había dos fuentes cuando siempre hubo una.
 */
function readRoomName(doc) {
  const title = doc.querySelector('.room-view [data-hook="room-name"]')
    || doc.querySelector('.room-view > .container > h1');
  return title ? (title.textContent || '').trim() : '';
}

/** Sólo se avisa cuando cambia: esto se remira una vez por segundo y pico. */
function sendRoomName(name) {
  const next = name ? name.slice(0, 100) : null;
  if (next === state.roomName) return;
  state.roomName = next;
  ipcRenderer.send('game:room-name', state.roomName);
  // Hosteando, el nombre es lo único con lo que se identifica la sala: hasta
  // que se lee, la presencia no tenía qué mandar.
  safe(reportRoomInfo, state.view);
}

/**
 * Relectura desde el vigilante del documento, sin reintentos propios.
 *
 * Fuera de la sala no borra nada: de eso se encarga el cambio de vista. Acá
 * sólo se atiende el caso de que el nombre aparezca (o cambie) más tarde.
 */
function refreshRoomName(doc) {
  if (!inRoom(state.view)) return;
  const name = readRoomName(doc);
  if (name) sendRoomName(name);
}

function reportRoomName(doc, kind) {
  // Cortar la búsqueda de la sala anterior: si no, una lectura tardía podría
  // pisar el nombre de la sala en la que ya está el jugador.
  clearTimeout(roomNameTimer);
  roomNameTimer = null;

  /*
   * Cualquier pantalla que no sea la sala deja la presencia sin nombre, no sólo
   * la lista y el "desconectado". Con las otras —el diálogo que aparece cuando
   * te echan, la pantalla de contraseña— Discord se quedaba anunciando la sala
   * anterior.
   */
  if (!inRoom(kind)) {
    engineRoomName = null;
    sendRoomName(null);
    return;
  }

  let attempt = 0;
  const read = () => {
    roomNameTimer = null;
    // Si mientras tanto se salió de la sala, ya no hay nada que leer.
    if (!inRoom(state.view)) return;

    const name = readRoomName(doc);
    if (name) {
      sendRoomName(name);
      return;
    }
    if (attempt < ROOM_NAME_RETRIES.length) roomNameTimer = setTimeout(read, ROOM_NAME_RETRIES[attempt++]);
  };
  read();
}

/**
 * Saca del game.css vivo el sprite de banderas y la posición de cada país,
 * para poder dibujarlas en la interfaz del cliente. La URL lleva un hash de
 * build, así que se lee de la hoja de estilos en vez de hardcodearla.
 */
function reportFlags(doc) {
  try {
    const sheet = [...doc.styleSheets].find((s) => s.href && s.href.includes('game.css'));
    if (!sheet) return;

    const positions = {};
    for (const rule of sheet.cssRules) {
      const match = rule.selectorText && rule.selectorText.match(/^\.f-([a-z]{2,3})$/i);
      if (!match) continue;
      const pos = rule.style.backgroundPosition;
      const coords = pos && pos.match(/(-?\d+)px\s+(-?\d+)px/);
      if (coords) positions[match[1].toUpperCase()] = [Number(coords[1]), Number(coords[2])];
    }
    if (!Object.keys(positions).length) return;

    const spriteUrl = new URL('images/flags.png', sheet.href).href;
    ipcRenderer.send('game:flags', { spriteUrl, positions });
  } catch {
    /* la hoja puede no estar accesible todavía */
  }
}

/** HaxBall guarda la ubicación detectada; la usamos para la distancia a las salas. */
function reportGeo() {
  try {
    const raw = localStorage.getItem('geo') || localStorage.getItem('geo_override');
    if (!raw) return;
    const { lat, lon, code } = JSON.parse(raw);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      ipcRenderer.send('game:geo', { lat, lon, code });
    }
  } catch { /* todavía no la detectó */ }
}

/** La identidad que HaxBall tiene puesta ahora mismo. */
function reportAuth() {
  ipcRenderer.send('game:auth', { key: readStorage(haxball.AUTH_KEY) || null });
}

/**
 * El avatar que HaxBall tiene guardado ahora mismo. La interfaz lo usa como
 * punto de partida: si el jugador nunca configuró uno en el cliente, muestra el
 * que ya venía usando en vez de un hueco.
 */
function reportAvatar() {
  ipcRenderer.send('game:avatar-current', { face: readStorage(haxball.AVATAR_KEY) || '' });
}

/**
 * Los controles que HaxBall tiene puestos. Si el cliente todavía no maneja
 * ninguno, la interfaz muestra éstos en vez de los de fábrica: puede que el
 * jugador ya los haya cambiado dentro del juego.
 */
function reportKeys() {
  ipcRenderer.send('game:keys-current', {
    keys: haxball.parseKeys(readStorage(haxball.KEYS_KEY)) || haxball.DEFAULT_KEYS
  });
}

let chatObserver = null;
let chatDoc = null;

/*
 * Los avisos que HaxBall se escribe al cambiar el avatar —`case "avatar"` y
 * `case "clear_avatar"` en game-min.js— los reconoce `isAvatarNotice`, que vive
 * en game-i18n.js.
 *
 * Va allá y no acá porque este cliente TRADUCE el juego: con el idioma en
 * español el chat dice «Avatar puesto», y la expresión regular que había acá
 * buscaba «Avatar set». No encajaba nunca, así que la animación del avatar
 * llenaba el chat de avisos — que es justo lo que el filtro existía para evitar.
 * La lista ahora se genera de la misma tabla que hace la traducción.
 */

/**
 * Links del chat.
 *
 * Se marcan en azul y se abren en el navegador del sistema de un solo click, en
 * vez de tener que seleccionar el texto y copiarlo a mano. La detección es
 * deliberadamente conservadora: http(s) o algo que arranque con "www.".
 */
const LINK_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]{2,}/gi;
/** Puntuación pegada al final de la frase que no forma parte del link. */
const LINK_TAIL = /[.,;:!?)\]}'"»]+$/;
/**
 * Al menos un dominio de verdad. Sin esto, escribir "www..." dejaba un link
 * azul que no lleva a ningún lado.
 */
const LINK_OK = /\.[a-z]{2,}/i;

function linkify(doc, p) {
  if (p.dataset.tvmLinked) return;
  p.dataset.tvmLinked = '1';

  const view = doc.defaultView;
  const walker = doc.createTreeWalker(p, view.NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);

  for (const node of texts) {
    const text = node.nodeValue || '';
    LINK_RE.lastIndex = 0;
    if (!LINK_RE.test(text)) continue;

    LINK_RE.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    let match;
    while ((match = LINK_RE.exec(text)) !== null) {
      const raw = match[0].replace(LINK_TAIL, '');
      if (!raw || !LINK_OK.test(raw)) {
        // Sin esto el índice no avanzaría y el bucle no terminaría nunca.
        LINK_RE.lastIndex = match.index + match[0].length;
        continue;
      }
      if (match.index > last) frag.append(doc.createTextNode(text.slice(last, match.index)));

      const link = doc.createElement('span');
      link.className = 'tvm-link';
      link.textContent = raw;
      // El destino va aparte del texto: así "www.algo.com" abre con https y lo
      // que se abre es siempre lo que el jugador está viendo.
      link.dataset.tvmUrl = /^https?:/i.test(raw) ? raw : `https://${raw}`;
      link.title = link.dataset.tvmUrl;
      frag.append(link);

      last = match.index + raw.length;
      LINK_RE.lastIndex = last;
    }
    if (last < text.length) frag.append(doc.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

/** Un solo manejador por documento para todos los links del chat. */
const linkDocs = new WeakSet();

function attachChatLinks(doc) {
  if (!doc || linkDocs.has(doc)) return;
  linkDocs.add(doc);
  doc.addEventListener('click', (event) => {
    const link = event.target && event.target.closest && event.target.closest('.tvm-link');
    if (!link || !link.dataset.tvmUrl) return;
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.send('game:open-url', link.dataset.tvmUrl);
  });
}

/**
 * Un solo observador para todo lo que hacemos sobre el chat: los links, la hora
 * delante de cada mensaje y el filtrado de los avisos del avatar.
 *
 * Se engancha al propio `.log-contents` y sin `subtree`. Antes miraba `body`
 * entero con subtree, así que durante la partida —donde el DOM se mueve en cada
 * cuadro— el callback se disparaba sin parar para revisar nodos que nunca eran
 * mensajes.
 */
/* ------------------------------------------------------------------ *
 * Silenciar a alguien
 * ------------------------------------------------------------------ *
 * HaxBall escribe cada mensaje como una línea de texto pelada:
 *
 *   a.Rl = function(d,e){ c.l.Ka.da("" + d.D + ": " + e, …) }
 *
 * o sea `<p>Apodo: lo que dijo</p>`, sin un elemento aparte para el autor. Así
 * que el autor se reconoce por el prefijo, que es exactamente lo que se ve en
 * pantalla.
 *
 * Dos cosas que esto NO puede hacer, y que la interfaz dice:
 *
 *   · Un mensaje que empiece con «Otro: » se va a leer como si fuera de Otro.
 *     Es la misma confusión que ya tiene cualquiera mirando el chat, porque el
 *     chat de HaxBall no distingue una cosa de la otra.
 *   · El que se cambia el apodo vuelve a aparecer.
 *
 * Los avisos de la sala —entró, salió, lo echaron— no llevan prefijo de autor y
 * se siguen viendo. Está bien que así sea: enterarse de que alguien entró no es
 * leerlo.
 */
function mutedNicks() {
  const list = (state.config.chat && state.config.chat.muted) || [];
  return Array.isArray(list) ? list : [];
}

function isMuted(nick) {
  const clean = String(nick || '').trim();
  if (!clean) return false;
  return mutedNicks().some((m) => String(m).trim() === clean);
}

/** Saca del chat lo que ya estaba escrito por alguien recién silenciado. */
function sweepMutedChat(doc) {
  if (!doc || !mutedNicks().length) return;
  const log = doc.querySelector('.log-contents');
  if (!log) return;
  for (const node of [...log.children]) {
    if (isMutedLine(node)) node.remove();
  }
}

function isMutedLine(node) {
  const list = mutedNicks();
  if (!list.length) return false;
  // Los avisos de la sala no son de nadie: `notice`, `announcement` y demás
  // salen de otra rama del bundle y nunca llevan el «Apodo: » adelante.
  if (node.className && node.className !== 'highlight') return false;
  const text = node.textContent || '';
  return list.some((nick) => {
    const clean = String(nick || '').trim();
    return clean && text.startsWith(`${clean}: `);
  });
}

/**
 * El que habla, en el color de su equipo.
 *
 * HaxBall escribe cada mensaje como UN texto, «Nick: mensaje», así que no hay
 * nada que pintar por CSS. Se separa el nick en su propio `<span>` y la hoja
 * (room-ui.js) lo colorea: en un chat de sala llena, saber de un vistazo si el
 * que habla es de tu equipo es la mitad de leerlo.
 *
 * El nick sale de la sala —la real si la hay, si no la copia dibujada—, no de
 * adivinar hasta los dos puntos: un nick puede tener «: » adentro. Gana el más
 * largo que encaje, así «Pepe» no le roba la línea a «Pepe: el crack».
 *
 * Sólo líneas de jugador: los avisos y anuncios no son de nadie (la misma
 * regla que `isMutedLine`). El texto de la línea queda idéntico, que es lo que
 * miran el filtro de silenciados y `linkify`.
 */
function tagSpeaker(doc, node) {
  if (node.className && node.className !== 'highlight') return;
  if (node.querySelector('.tvm-chat-nick')) return;
  const first = node.firstChild;
  if (!first || first.nodeType !== 3) return;

  const room = real.room || tracker.room;
  const f = tracker.fields || (doc.defaultView && doc.defaultView.__tvmF);
  const players = room && f && f.players && f.name ? room[f.players] : null;
  if (!players) return;

  const text = first.nodeValue || '';
  let who = null;
  for (let i = 0; i < players.length; i++) {
    const name = String(players[i][f.name] || '');
    if (name && text.startsWith(`${name}: `) && (!who || name.length > who.name.length)) {
      who = { name, player: players[i] };
    }
  }
  if (!who) return;

  const team = teamNameOf(f, who.player);
  const span = doc.createElement('span');
  span.className = `tvm-chat-nick tvm-chat-nick--${team === 'Red' ? 'red' : team === 'Blue' ? 'blue' : 'spec'}`;
  span.textContent = who.name;
  first.nodeValue = text.slice(who.name.length);
  node.insertBefore(span, first);
}

function watchChatLog(doc) {
  if (chatObserver) {
    chatObserver.disconnect();
    chatObserver = null;
  }
  chatDoc = doc || null;
  if (!doc) return false;

  const log = doc.querySelector('.log-contents');
  if (!log) return false; // fuera de la sala no hay chat todavía

  attachChatLinks(doc);

  const stamps = !!state.config.game.chatTimestamps;
  const stamp = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const handle = (node) => {
    if (node.nodeType !== 1 || node.tagName !== 'P') return;

    // Silenciado: la línea no se esconde, se saca. Escondida seguiría corriendo
    // el chat hacia arriba y el hueco delataría que dijo algo.
    if (isMutedLine(node)) {
      node.remove();
      return;
    }

    // Se filtra mientras la animación del avatar corre y durante el refresco de
    // la textura, que manda dos comandos seguidos.
    if ((avatarTimer || Date.now() < avatarNoiseUntil) &&
        isAvatarNotice(node.textContent)) {
      node.remove();
      return;
    }

    safe(tagSpeaker, doc, node);

    if (stamps && !node.dataset.tvmStamped) {
      node.dataset.tvmStamped = '1';
      const tag = doc.createElement('span');
      tag.textContent = `[${stamp()}] `;
      tag.style.cssText = 'opacity:.6;font-variant-numeric:tabular-nums';
      node.prepend(tag);
    }
    safe(linkify, doc, node);
  };

  chatObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) handle(node);
    }
  });
  chatObserver.observe(log, { childList: true });

  // Lo que ya estaba escrito antes de engancharnos también se marca.
  for (const node of log.children) safe(linkify, doc, node);
  return true;
}

/**
 * El chat se monta junto con la sala, pero no siempre en el mismo latido que la
 * vista. Si al entrar todavía no estaba, se prueba de nuevo una vez: es eso o
 * quedarse sin links y sin horas hasta la próxima recarga.
 */
function watchChatLogSoon(doc) {
  if (watchChatLog(doc)) return;
  setTimeout(() => safe(watchChatLog, doc), 400);
}

/** El filtro depende de si la animación está corriendo: hay que reevaluarlo. */
function refreshChatWatcher() {
  watchChatLog(chatDoc || gameDocument());
}

/*
 * En CAPTURA, y esto es lo que hace que Tab sea del resumen y de nadie más.
 *
 * HaxBall también escucha Tab: se engancha con
 * `window.document.addEventListener("keydown", …)` y su mapa de teclas trae
 * `Tab → ToggleChat`, que enfoca el chat. Con el listener en burbuja los dos
 * corrían y Tab hacía las dos cosas a la vez — `preventDefault()` no alcanza,
 * porque sólo cancela la acción del navegador y no impide que el otro
 * manejador se entere.
 *
 * Escuchando en captura y cortando ahí, el evento no llega nunca al de
 * HaxBall. Sirve además sin importar qué mapa de teclas tenga guardado el
 * jugador, que es lo que no arreglaba tocar sólo los controles por defecto.
 */
const HOTKEY_OPTS = { capture: true };

/**
 * La tecla que abre el resumen del partido, según la config.
 *
 * `''` significa «ninguna»: ahí el resumen se abre sólo desde la interfaz y
 * ninguna tecla se intercepta.
 */
function summaryKey() {
  const key = state.config && state.config.general && state.config.general.summaryKey;
  return typeof key === 'string' ? key : 'Tab';
}

/**
 * Qué pidió la combinación de zoom: `'in'`, `'out'`, `'reset'` o nada.
 *
 * Se miran `key` Y `code` porque con una sola de las dos se pierde medio teclado:
 *
 *   · `key` es la letra que sale, y depende de la distribución y de Shift. En el
 *     teclado latinoamericano el `+` de la fila de números necesita Shift, así
 *     que sin Shift lo que llega es `'='`; en el español el `+` está en otra
 *     tecla. Por eso valen los dos, igual que en cualquier navegador.
 *   · `code` es la posición FÍSICA, sin importar la distribución: es lo que
 *     rescata al `+` y al `-` del teclado numérico —que no mandan `'+'` ni `'-'`
 *     como `key` en todos lados— y a las distribuciones donde esa tecla saca
 *     cualquier otro símbolo.
 *
 * La misma tabla está en app.js, para cuando el foco está en la interfaz. Son
 * dos mundos separados (preload del juego y documento de la app) y no comparten
 * módulos: si se toca una, se toca la otra.
 */
function zoomAction(event) {
  return zoomControl.action(event);
}

function applyCameraZoom(doc = gameDocument()) {
  if (doc && doc.defaultView) doc.defaultView.__tvmCameraZoom = zoomControl.normalize(state.config.appearance.gameZoom);
}

function onKeyDown(event) {
  /*
   * El resumen del partido, con la tecla que diga la config (Tab de fábrica).
   *
   * Tiene que escucharse ACÁ. El panel lo dibuja la interfaz del cliente, pero
   * mientras jugás el foco está adentro del <webview>, y las teclas de un
   * webview no llegan nunca al documento de la app: el listener que había en
   * `app.js` sólo funcionaba estando en la lista de salas, o sea justo donde no
   * hay ningún partido que resumir.
   *
   * Que la tecla salga de la config es lo que le devuelve Tab a HaxBall: si el
   * resumen está en otra —o en ninguna—, este bloque no se ejecuta para Tab, no
   * se corta el evento, y el chat vuelve a abrirse como en el juego original.
   */
  const wanted = summaryKey();
  if (wanted && event.key === wanted && !event.ctrlKey && !event.altKey && !event.metaKey) {
    const active = event.target && event.target.ownerDocument
      ? event.target.ownerDocument.activeElement
      : null;
    const tag = active && active.tagName;
    // Escribiendo en el chat, Tab es Tab.
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (active && active.isContentEditable)) return;
    event.preventDefault();
    // Que no le llegue a HaxBall, que si no abre el chat además del resumen.
    event.stopPropagation();
    ipcRenderer.send('game:toggle-stats');
    return;
  }

  if (event.key === 'F8') {
    state.overlayVisible = !state.overlayVisible;
    paintOverlayVisibility();
    notify(state.overlayVisible ? 'Overlay visible' : 'Overlay oculto');
    return;
  }

  /*
   * F7 muestra y esconde el cartel de música. No hay atajo para pasar de tema:
   * eso son los botones del cartel, y una tecla suelta para «siguiente» en un
   * juego que se juega con el teclado es un accidente esperando.
   */
  if (event.key === 'F7') {
    event.preventDefault();
    const cfg = state.config.music || {};
    if (!cfg.enabled) {
      notify('Prendé YouTube Music en la pestaña Música', 'err');
      return;
    }
    ipcRenderer.send('music:toggle-hud');
    return;
  }

  /*
   * F11 es de la VENTANA, no del juego, y por eso estaba roto justamente cuando
   * más se usa.
   *
   * Se atendía en dos lugares —el `keydown` de app.js y un `before-input-event`
   * sobre el webContents de la ventana—, y los dos son el mismo lugar: el
   * documento de la app. Jugando, el foco está adentro de este webview, que
   * tiene su propio webContents y no le pasa las teclas a nadie. Resultado: F11
   * andaba sólo después de hacer clic en la barra de arriba, y en la cancha no
   * hacía nada.
   *
   * Es el mismo camino que F8, F9 y Tab: la tecla se agarra acá, donde de
   * verdad llega, y se le pide a quien puede hacerlo.
   */
  if (event.key === 'F11') {
    event.preventDefault();
    ipcRenderer.send('win:action', 'fullscreen');
    return;
  }

  /*
   * Ctrl +, Ctrl - y Ctrl 0: la lupa del navegador sobre la página del juego.
   *
   * Mismo camino que F11: la tecla se agarra acá porque acá es donde llega, y el
   * zoom lo aplica el proceso principal, que es el que tiene el webContents. Ver
   * el bloque «Zoom del juego» en main.js para por qué esto no lo hace Electron
   * solo y en qué se diferencia del zoom de cámara de HaxBall.
   *
   * No se pregunta si estás escribiendo en el chat: en un navegador Ctrl + y
   * Ctrl - también funcionan con el cursor metido en un campo de texto, y
   * ninguna de las tres combinaciones escribe nada.
   */
  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    const zoom = zoomAction(event);
    if (zoom) {
      event.preventDefault();
      // Que no le llegue a HaxBall: Ctrl no es de nadie, pero el `0` y el `-`
      // sueltos sí pueden estar asignados a algo.
      event.stopPropagation();
      ipcRenderer.send('game:zoom', zoom);
      return;
    }
  }

  /*
   * Las pestañas de juego: Alt+T abre una, Alt+W cierra ésta, Alt+1…4 pasa a
   * esa. Mismo camino que F11: llegan acá porque acá está el foco, y las
   * pestañas las lleva la interfaz.
   *
   * Con Alt y no con Ctrl como en un navegador, y no es capricho: Ctrl y Shift
   * son PATEAR de fábrica en HaxBall, y W es arriba. Ctrl+W jugando es patear
   * yendo para arriba, que pasa cien veces por partido — cerrar la pestaña con
   * eso sería cerrar la sala en medio de una jugada. Alt no está atado a nada,
   * y si el jugador se lo ató, el atajo se apaga solo (ver `tabAction`).
   */
  const tab = tabAction(event);
  if (tab) {
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.send('tabs:key', tab);
    return;
  }

  /*
   * Acá estaban Shift+K (echar a todos) y Shift+B (banear a todos). Se sacaron.
   *
   * Eran teclas imprimibles sin ninguna guarda de "estoy escribiendo", así que
   * cualquier B o K mayúscula en el chat —«Buenas», «Bien», «Kick»— disparaba
   * la moderación de la sala ENTERA. Sin ser admin sólo molestaba con el cartel
   * de «Necesitás ser admin»; siendo admin, escribir en el chat echaba o
   * baneaba a todos.
   *
   * La moderación en lote sigue estando donde se la puede ver antes de usarla:
   * los botones de la lista de jugadores (`injectPlayerActions`) y el canal
   * `game:moderate` de la interfaz.
   */
}

/**
 * Qué pide una tecla de pestañas, o `null` si no es de eso.
 *
 * Sólo con Alt, y sólo si ni Alt ni la tecla están atados a una acción del
 * juego: si el jugador puso Alt para patear, o el 2 para algo, esa combinación
 * es suya y acá no se toca.
 */
function tabAction(event) {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const code = String(event.code || '');
  let action = null;
  if (code === 'KeyT') action = 'new';
  else if (code === 'KeyW') action = 'close';
  else if (/^(Digit|Numpad)[1-4]$/.test(code)) action = `go:${code.slice(-1)}`;
  if (!action) return null;

  const bound = haxball.parseKeys(readStorage(haxball.KEYS_KEY)) || haxball.DEFAULT_KEYS;
  if (bound.AltLeft || bound.AltRight || bound[code]) return null;
  return action;
}

/* ------------------------------------------------------------------ *
 * Moderación de la sala
 * ------------------------------------------------------------------ *
 * Expulsar a alguien en HaxBall son DOS cuadros, no uno. Del bundle:
 *
 *   Eb.O = "<div class='dialog' style='min-width:200px'>
 *             <h1 data-hook='name'></h1>
 *             <button data-hook='admin'></button>
 *             <button data-hook='kick'>Kick</button>
 *             <button data-hook='close'>Close</button></div>"
 *
 *   ub.O = "<div class='dialog kick-player-view'>
 *             <h1 data-hook='title'></h1>
 *             <input data-hook='reason'/>
 *             <button data-hook='ban-btn'>Ban from rejoining:
 *                <span data-hook='ban-text'></span></button>
 *             <button data-hook='close'>Cancel</button>
 *             <button data-hook='kick'>Kick</button></div>"
 *
 * El `kick` del PRIMERO no echa a nadie: sólo abre el segundo
 * (`this.df.onclick = function(){ D.h(d.ti, d.Rb) }`). El que ejecuta es el
 * `kick` del SEGUNDO:
 *
 *   this.df.onclick = function(){ rc.h(c.ti, c.Rb, c.Di.value, c.bk) }
 *
 * y `bk` —banear o no— es un INTERRUPTOR que se maneja con `ban-btn`:
 *
 *   this.eo.onclick = function(){ c.Tj(!c.bk) }
 *   Tj(a){ this.bk = a; this.ho.textContent = a ? "Yes" : "No" }
 *
 * ── Qué estaba roto ────────────────────────────────────────────────────────
 *
 * Esto buscaba los dos botones en el PRIMER cuadro, que es donde no están:
 *
 *   · «K» encontraba el `kick` del primero y lo clickeaba, o sea que abría el
 *     cuadro de HaxBall y ahí se quedaba. Un atajo que no ahorra ningún paso.
 *
 *   · «B» buscaba `ban-btn`, que en ese cuadro no existe, y caía al respaldo
 *     por TEXTO: cualquier botón del documento que dijera «ban». El que decía
 *     «ban» era el «Ban all» de nuestra propia barra, así que lo apretaba —y
 *     de ahí salía el «Baneados: 10» sin que se baneara nadie.
 *
 * La búsqueda por texto se fue entera. Los `data-hook` son con lo que el propio
 * HaxBall encuentra sus botones y no los toca la traducción (`game-i18n.js`
 * cambia «>Kick</button>» por «>Echar</button>» y deja el atributo igual), así
 * que no hay nada de qué hacer respaldo — y el respaldo era justamente lo que
 * podía terminar apretando un botón nuestro.
 */

/**
 * Los cajones del panel de equipos.
 *
 * NO se buscan por `data-hook`, y ahí estaba el error. La sala se arma con tres
 * divs de marca —`red-list`, `spec-list`, `blue-list`— pero al montar cada lista
 * HaxBall los REEMPLAZA por el elemento de la lista:
 *
 *   di(a,b,c){ x.replaceWith(a, b.f); … }              // `a` es el div de marca
 *   static replaceWith(a,b){ a.parentElement.replaceChild(b,a) }
 *
 * O sea que esos `data-hook` no existen en el documento vivo: duran lo que tarda
 * el constructor en leerlos. `doc.querySelector('[data-hook="red-list"]')`
 * devolvía null siempre, y con el cajón en null esto devolvía la lista vacía:
 * las SEIS teclas por equipo —K y B de rojo, azul y espectadores— no hacían
 * nada más que contestar «no hay jugadores para moderar». La fila «Todos» era la
 * única que andaba, justamente porque es la única que no busca cajón.
 *
 * Lo que sí queda puesto es la clase del equipo, que la lista se agrega sola al
 * construirse (`this.f.className += " " + a.Qo`) y sale de la tabla de equipos
 * del bundle — las mismas tres con las que el propio game.css pinta los botones
 * de «Join»:
 *
 *   u.Pa = new u(0, …, "Spectators", "t-spec", …)
 *   u.ja = new u(1, …, "Red",        "t-red",  …)
 *   u.Da = new u(2, …, "Blue",       "t-blue", …)
 */
const TEAM_LISTS = {
  red: '.player-list-view.t-red',
  blue: '.player-list-view.t-blue',
  spec: '.player-list-view.t-spec'
};

/** Las filas de un equipo, o las de toda la sala si no se pide ninguno. */
function playerRows(doc, team) {
  const selector = team && TEAM_LISTS[team];
  const scope = selector ? doc.querySelector(selector) : doc;
  return scope ? [...scope.querySelectorAll('.player-list-item')] : [];
}

function rowNick(row) {
  const name = row.querySelector('[data-hook="name"]');
  return name ? (name.textContent || '').trim() : '';
}

/**
 * ¿Esta fila sos vos?
 *
 * Va por el nombre porque no hay otra cosa. Acá se miraba
 * `row.classList.contains('self')`, y esa clase NO EXISTE: HaxBall arma cada
 * fila con `this.f.className = "player-list-item" + (admin ? " admin" : "")` y
 * nada más. O sea que la comprobación daba siempre que no, y «expulsar a todos»
 * se incluía a vos mismo en la lista.
 *
 * Dos jugadores con el mismo nombre se saltean los dos. Es lo que conviene: de
 * los dos errores posibles, no expulsar de más es el barato.
 */
function isSelfRow(row) {
  const nick = myNick();
  return !!nick && rowNick(row) === nick;
}

/** El cuadro de clic derecho: nombre, admin, kick y cerrar. */
function playerMenuDialog(doc) {
  return [...doc.querySelectorAll('.dialog')].find(
    (el) => el.querySelector('[data-hook="admin"]') && el.querySelector('[data-hook="kick"]')
  ) || null;
}

/** El segundo cuadro: motivo, interruptor de ban y el kick que sí ejecuta. */
function kickDialog(doc) {
  return doc.querySelector('.kick-player-view');
}

/**
 * Espera a que `find` devuelva algo.
 *
 * Los dos cuadros los monta HaxBall adentro del mismo gesto, así que casi
 * siempre están en el primer intento. Se espera igual porque eso depende de que
 * sus señales sean síncronas, que es una promesa que el bundle no hizo — y si
 * un día no llega, esto se rinde en un cuarto de segundo en vez de colgarse.
 */
function waitForDialog(doc, find, tries = 15) {
  return new Promise((resolve) => {
    let left = tries;
    const look = () => {
      const found = safe(find, doc);
      if (found) return resolve(found);
      if (left-- <= 0) return resolve(null);
      setTimeout(look, 16);
    };
    look();
  });
}

/** Deja el paso a medio hacer cerrado, sin tocar ningún otro cuadro abierto. */
function closeModDialogs(doc) {
  for (const dialog of [kickDialog(doc), playerMenuDialog(doc)]) {
    const close = dialog && dialog.querySelector('button[data-hook="close"]');
    if (close) close.click();
  }
}

/**
 * Pone «que no pueda volver» en sí.
 *
 * El cuadro se construye con `this.Tj(!1)`, así que arranca siempre en «No» y
 * alcanza con un clic. Se comprueba igual que el texto haya cambiado, y no se
 * compara contra «Yes»: eso lo traduce `game-i18n.js`. Si no cambió, el que
 * llama cancela — banear de menos se arregla a mano, echar a alguien creyendo
 * que quedó baneado no se nota hasta que vuelve.
 */
function turnBanOn(dialog) {
  const toggle = dialog.querySelector('button[data-hook="ban-btn"]');
  const text = dialog.querySelector('[data-hook="ban-text"]');
  if (!toggle || !text) return false;
  const before = (text.textContent || '').trim();
  toggle.click();
  return (text.textContent || '').trim() !== before;
}

/**
 * Echa (o banea) al jugador de una fila, recorriendo los dos cuadros.
 *
 * @returns {Promise<boolean>} si se llegó a apretar el botón que ejecuta
 */
async function moderateOne(doc, row, action) {
  row.dispatchEvent(new doc.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

  const menu = await waitForDialog(doc, playerMenuDialog);
  const open = menu && menu.querySelector('button[data-hook="kick"]');
  /*
   * Deshabilitado quiere decir que no sos admin o que el elegido es el host:
   * `this.df.disabled = !b || 0 == this.Rb`. Apretarlo no haría nada, así que
   * se cierra y se cuenta como que no se pudo.
   */
  if (!open || open.disabled) {
    closeModDialogs(doc);
    return false;
  }
  open.click();

  const dialog = await waitForDialog(doc, kickDialog);
  if (!dialog) {
    closeModDialogs(doc);
    return false;
  }

  if (action === 'ban' && !turnBanOn(dialog)) {
    closeModDialogs(doc);
    return false;
  }

  const confirm = dialog.querySelector('button[data-hook="kick"]');
  if (!confirm) {
    closeModDialogs(doc);
    return false;
  }
  confirm.click();
  return true;
}

/**
 * ¿Somos admin? HaxBall sólo monta los controles de partida para quien puede
 * usarlos, así que su presencia es la señal más confiable.
 */
function isAdmin(doc) {
  return !!doc.querySelector('[data-hook="start-btn"], [data-hook="stop-btn"]');
}

/**
 * Un botón de moderación: el ícono y nada más, con la acción dicha en el título.
 *
 * Eran una «K» y una «B» a 10 px, que había que saber leer y que a esa medida
 * se confundían entre sí. Ahora son la puerta de salida y el círculo de
 * prohibido, los mismos dos gestos que usa HaxBall en sus propios botones.
 */
function modButton(doc, action, label) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `tvm-act${action === 'ban' ? ' tvm-act--danger' : ''}`;
  button.title = label;
  button.setAttribute('aria-label', label);
  const svg = roomUi.icon(doc, action);
  if (svg) button.append(svg);
  return button;
}

/* ── El seguro de dos clics ─────────────────────────────────────────────── *
 *
 * «B» al lado de «Todos» baneaba la sala entera con UN clic, en un botón de 24
 * píxeles pegado a otro. Ahora el primer clic arma el botón —se pone rojo y la
 * fila pregunta «¿Banear 7?»— y recién el segundo ejecuta. Si pasan unos
 * segundos o el mouse se va, se desarma solo.
 *
 * Echar a UN jugador sigue siendo un clic: puede volver a entrar. Banearlo, no.
 */
const ARM_MS = 3500;
let armedAct = null;

function disarmAct() {
  if (!armedAct) return;
  const { button, marks, label, text, timer, leaveFrom, onLeave } = armedAct;
  armedAct = null;
  clearTimeout(timer);
  button.classList.remove('is-armed');
  for (const el of marks) el.classList.remove('is-armed');
  if (label) label.textContent = text;
  if (leaveFrom) leaveFrom.removeEventListener('mouseleave', onLeave);
}

/**
 * @param {Element} button
 * @param {{marks?: Element[], label?: Element, prompt?: string, leaveFrom?: Element}} how
 * @param {() => void} run lo que hace el segundo clic
 */
function armOrRun(button, how, run) {
  if (armedAct && armedAct.button === button) {
    disarmAct();
    run();
    return;
  }
  disarmAct();
  const marks = how.marks || [];
  const label = how.label || null;
  button.classList.add('is-armed');
  for (const el of marks) el.classList.add('is-armed');
  const text = label ? label.textContent : '';
  if (label && how.prompt) label.textContent = how.prompt;
  const onLeave = () => disarmAct();
  if (how.leaveFrom) how.leaveFrom.addEventListener('mouseleave', onLeave);
  armedAct = { button, marks, label, text, leaveFrom: how.leaveFrom || null, onLeave, timer: setTimeout(disarmAct, ARM_MS) };
}

/**
 * Botones de kick/ban en cada jugador de la lista. Se ponen sólo si sos admin,
 * y se rehacen cuando cambia la lista.
 */
function injectPlayerActions(doc) {
  if (!isAdmin(doc)) {
    doc.querySelectorAll('.tvm-pa').forEach((el) => el.remove());
    doc.querySelectorAll('.tvm-has-pa').forEach((el) => el.classList.remove('tvm-has-pa'));
    return;
  }

  for (const row of doc.querySelectorAll('.player-list-item')) {
    if (row.querySelector('.tvm-pa') || isSelfRow(row)) continue;

    const nick = rowNick(row);
    const box = doc.createElement('span');
    box.className = 'tvm-pa';

    const run = async (action) => {
      // Un lote en curso está usando los mismos cuadros: no se mete en el medio.
      if (moderating) return;
      moderating = true;
      try {
        const ok = await moderateOne(doc, row, action);
        if (!ok) notify('No se pudo: ¿sos admin? Al host no se lo puede echar.', 'err');
        else if (action === 'ban') notify(`Baneado: ${nick || 'jugador'}`, 'ok');
      } catch (err) {
        log('error', err && err.message ? err.message : String(err), 'sala');
      } finally {
        moderating = false;
      }
    };

    const kick = modButton(doc, 'kick', nick ? `Expulsar a ${nick}` : 'Expulsar');
    kick.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      disarmAct();
      run('kick');
    });
    const ban = modButton(doc, 'ban', nick ? `Banear a ${nick} (dos clics)` : 'Banear (dos clics)');
    ban.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      armOrRun(ban, { marks: [box], leaveFrom: row }, () => run('ban'));
    });

    box.append(kick, ban);
    row.append(box);
    // Con los botones puestos, el ping se aparta al pasar el mouse (ver room-ui.js).
    row.classList.add('tvm-has-pa');
  }
}

/* ------------------------------------------------------------------ *
 * El menú de clic derecho de un jugador
 * ------------------------------------------------------------------ *
 * HaxBall abre ahí un cuadro con el nombre arriba y los botones de admin, kick
 * y cerrar. En el bundle es la clase `Eb`:
 *
 *   Eb.O = "<div class='dialog' style='min-width:200px'>
 *             <h1 data-hook='name'></h1>
 *             <button data-hook='admin'></button>
 *             <button data-hook='kick'>Kick</button>
 *             <button data-hook='close'>Close</button></div>"
 *
 * Es el lugar donde uno ya está mirando a esa persona, así que es donde tienen
 * que estar «ver su perfil» y «agregarlo». Los botones se meten como hermanos de
 * los de HaxBall —sin envoltorio— para que hereden su estilo tal cual: el cuadro
 * se sigue viendo como el del juego y no como un injerto.
 *
 * No hace falta observar nada: el cuadro lo monta HaxBall adentro del MISMO
 * gesto de clic derecho, así que alcanza con mirar el DOM justo después. Un
 * observador sobre la vista del juego se dispararía miles de veces por partido
 * para atender un menú que se abre una vez cada tanto.
 */

const menuWatched = new WeakSet();

function watchPlayerMenu(doc) {
  if (menuWatched.has(doc)) return;
  menuWatched.add(doc);
  // En burbuja y un turno después: el manejador de HaxBall corre primero y deja
  // el cuadro puesto.
  doc.addEventListener('contextmenu', () => {
    setTimeout(() => safe(injectPeerMenu, doc), 0);
  });
}

function injectPeerMenu(doc) {
  const dialog = [...doc.querySelectorAll('.dialog')].find(
    (el) => el.querySelector('[data-hook="admin"]') && el.querySelector('[data-hook="kick"]')
  );
  const close = dialog && dialog.querySelector('[data-hook="close"]');
  if (!close || dialog.querySelector('.tvm-menu-btn')) return;

  const title = dialog.querySelector('[data-hook="name"]');
  const nick = title ? (title.textContent || '').trim() : '';
  if (!nick) return;

  const button = (text, iconName, onClick) => {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'tvm-menu-btn';
    const svg = roomUi.icon(doc, iconName);
    if (svg) el.append(svg);
    el.append(doc.createTextNode(text));
    el.addEventListener('click', () => {
      onClick();
      close.click(); // el cuadro se cierra como con cualquiera de sus botones
    });
    return el;
  };

  const added = [];

  /*
   * Silenciar, en cambio, es para cualquiera: no depende de que el otro tenga
   * nada instalado, porque el que deja de leerlo sos vos y en tu pantalla.
   * A vos mismo no, que no tiene sentido.
   */
  if (nick !== myNick()) {
    const muted = isMuted(nick);
    added.push(button(muted ? 'Dejar de silenciar' : 'Silenciar en el chat', muted ? 'unmute' : 'mute', () => {
      ipcRenderer.send('game:mute', { nick, muted: !muted });
      notify(muted ? `Vuelve a verse lo que escribe ${nick}` : `Silenciado: ${nick}`, 'ok');
    }));
  }

  if (!added.length) return;
  // Una raya separa lo de HaxBall (admin, echar) de lo del cliente.
  const sep = doc.createElement('div');
  sep.className = 'tvm-menu-sep';
  close.before(sep, ...added);
}

/* ------------------------------------------------------------------ *
 * El cuadro de echar
 * ------------------------------------------------------------------ *
 * El de HaxBall dice «Ban from rejoining: No» en un botón que hay que leer para
 * saber qué hace, y confirma con «Kick» aunque se esté baneando. Sin tocar nada
 * de cómo funciona (los clics siguen yendo a SUS botones, que es de lo que
 * depende `moderateOne`), se le pone un interruptor que se ve prendido o
 * apagado, y el botón de confirmar dice lo que va a pasar.
 *
 * El estado se deduce del texto de `ban-text`: el cuadro nace siempre en «No»
 * (`this.Tj(!1)`), así que lo que haya al abrirlo es el apagado. No se compara
 * contra «Yes»: la traducción lo cambia.
 */
const kickWatched = new WeakSet();

function watchKickDialog(doc) {
  if (kickWatched.has(doc)) return;
  kickWatched.add(doc);
  // El cuadro lo abre el «Echar» del menú del jugador, adentro de un clic: se
  // mira un turno después, igual que el menú. Nada de observar la vista entera.
  doc.addEventListener('click', () => {
    setTimeout(() => safe(enhanceKickDialog, doc), 0);
  });
}

function enhanceKickDialog(doc) {
  const dialog = doc.querySelector('.kick-player-view');
  if (!dialog || dialog.dataset.tvm) return;
  const toggle = dialog.querySelector('button[data-hook="ban-btn"]');
  const text = dialog.querySelector('[data-hook="ban-text"]');
  const confirm = dialog.querySelector('.row > button[data-hook="kick"]') ||
    dialog.querySelector('button[data-hook="kick"]');
  if (!toggle || !text || !confirm) return;
  dialog.dataset.tvm = '1';

  const off = (text.textContent || '').trim();
  const kickLabel = confirm.textContent;

  const knob = doc.createElement('span');
  knob.className = 'tvm-switch';
  knob.setAttribute('aria-hidden', 'true');
  toggle.classList.add('tvm-has-switch');
  toggle.append(knob);

  const paint = () => {
    const on = (text.textContent || '').trim() !== off;
    dialog.classList.toggle('tvm-ban-on', on);
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    // El texto del botón, no su manejador: el clic lo sigue atendiendo HaxBall.
    confirm.textContent = on ? 'Banear' : kickLabel;
  };
  // Después del de HaxBall, que es el que cambia el texto.
  toggle.addEventListener('click', () => setTimeout(paint, 0));
  paint();
}

/**
 * Mete los botones de moderación en el panel de equipos de la sala, junto a
 * Auto/Rand/Reset que ya trae HaxBall. Es donde el host los busca.
 */
/**
 * Los grupos de la moderación en lote. `who` es cómo se dice en el título del
 * botón: «Banear al equipo rojo» se entiende sin mirar la fila.
 */
const MOD_GROUPS = [
  { team: null, label: 'Todos', who: 'a toda la sala' },
  { team: 'red', label: 'Rojo', who: 'al equipo rojo' },
  { team: 'blue', label: 'Azul', who: 'al equipo azul' },
  { team: 'spec', label: 'Espec.', who: 'a los espectadores' }
];

function injectRoomTools(doc) {
  const tools = doc.querySelector('.room-view > .container > .teams > .tools');
  if (!tools) return;

  // Sin permisos no tiene sentido mostrarlos
  if (!isAdmin(doc)) {
    tools.querySelector('.tvm-tools')?.remove();
    return;
  }

  let box = tools.querySelector('.tvm-tools');
  if (!box) {
    box = buildRoomTools(doc);
    tools.append(box);
  }
  countRoomTools(doc, box);
}

/*
 * Una fila por grupo: a quién, cuántos son, y los dos botones.
 *
 * Antes eran dos botones sueltos que siempre alcanzaban a la sala entera.
 * Vaciar un equipo es lo que de verdad hace falta cuando se te mete media sala
 * en rojo, y hacerlo a mano son dos cuadros por jugador.
 */
function buildRoomTools(doc) {
  const box = doc.createElement('div');
  box.className = 'tvm-tools';

  const head = doc.createElement('div');
  head.className = 'tvm-tools__head';
  const shield = roomUi.icon(doc, 'shield');
  if (shield) head.append(shield);
  head.append(doc.createTextNode('Moderación'));
  box.append(head);

  for (const group of MOD_GROUPS) {
    const line = doc.createElement('div');
    line.className = 'tvm-tools__row';
    line.dataset.team = group.team || 'all';

    const who = doc.createElement('span');
    who.className = `tvm-tools__who tvm-tools__who--${group.team || 'all'}`;
    if (group.team) {
      const dot = doc.createElement('i');
      dot.className = 'tvm-tools__dot';
      who.append(dot);
    }
    const label = doc.createElement('span');
    label.className = 'tvm-tools__label';
    label.textContent = group.label;
    const count = doc.createElement('span');
    count.className = 'tvm-tools__count';
    who.append(label, count);
    line.append(who);

    for (const action of ['kick', 'ban']) {
      const verb = action === 'ban' ? 'Banear' : 'Expulsar';
      const button = modButton(doc, action, `${verb} ${group.who}`);
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const n = moderationTargets(doc, group.team).length;
        armOrRun(button, {
          marks: [line],
          label,
          prompt: `¿${action === 'ban' ? 'Banear' : 'Echar'} ${n}?`,
          leaveFrom: line
        }, () => moderateAll(action, group.team));
      });
      line.append(button);
    }
    box.append(line);
  }
  return box;
}

/** A quiénes alcanzaría un lote: todos los del grupo menos vos. */
function moderationTargets(doc, team) {
  return playerRows(doc, team).filter((row) => !isSelfRow(row));
}

/**
 * Cuántos hay en cada grupo, y los botones apagados donde no hay nadie. Corre
 * con cada repaso de la sala (ver `watchRoomPanel`), que ya va agrupado: toca
 * el DOM sólo si el número cambió.
 */
function countRoomTools(doc, box) {
  for (const line of box.querySelectorAll('.tvm-tools__row')) {
    if (armedAct && armedAct.marks.includes(line)) continue; // está preguntando
    const team = line.dataset.team === 'all' ? null : line.dataset.team;
    const n = moderationTargets(doc, team).length;
    const count = line.querySelector('.tvm-tools__count');
    const text = String(n);
    if (count && count.textContent !== text) count.textContent = text;
    for (const button of line.querySelectorAll('button.tvm-act')) {
      if (button.disabled !== (n === 0)) button.disabled = n === 0;
    }
  }
}

let roomObserver = null;
let roomRefreshTimer = null;
let roomPollTimer = null;

/**
 * La lista de jugadores cambia sola (entra gente, cambian de equipo), así que
 * los botones hay que reponerlos. Se observa el contenedor de la sala.
 *
 * El repaso va agrupado: dentro de la sala, el ping de cada jugador se reescribe
 * una vez por segundo, así que el observador se dispara decenas de veces por
 * segundo y sin esto cada una recorría la lista entera reponiendo botones que ya
 * estaban puestos.
 */
function watchRoomPanel(doc) {
  stopRoomPanel();
  watchPlayerMenu(doc);
  watchKickDialog(doc);
  let watched = null;

  const refresh = () => {
    roomRefreshTimer = null;
    safe(injectRoomTools, doc);
    safe(injectPlayerActions, doc);
    // La lista se rehace sola cuando entra o sale gente: las marcas se vuelven
    // a poner acá, y no cuando llega el latido, que es cada treinta segundos.
    safe(paintPeers, doc);
  };

  /*
   * Dos velocidades, y esto es el punto.
   *
   * Al cambiar de equipo, HaxBall NO mueve tu fila: cada lista lleva su propio
   * mapa de filas por jugador, así que te borra de una y te construye una fila
   * nueva en la otra. La nueva viene pelada, sin el escudo ni el diamante, y
   * con un solo camino agrupado a 250 ms se veía el bache — la fila aparecía
   * primero desnuda y las marcas caían un cuarto de segundo después.
   *
   * Los 250 ms tienen que quedar igual para lo demás: dentro de la sala el ping
   * de cada jugador se reescribe una vez por segundo, así que el observador se
   * dispara decenas de veces por segundo y sin el freno cada una recorrería la
   * lista entera.
   *
   * La salida es no frenar lo que sí es un cambio de lista. Se distingue solo:
   * reescribir un ping cambia un NODO DE TEXTO, agregar o sacar un jugador
   * cambia un ELEMENTO `.player-list-item`. Filtrando por eso, el repintado sale
   * en el mismo cuadro y el resto sigue agrupado.
   */
  roomObserver = new MutationObserver((records) => {
    if (records.some(changesPlayerList)) {
      safe(paintPeers, doc);
      safe(injectPlayerActions, doc);
      // Puede haber entrado alguien con el cliente: `peers` es de la respuesta
      // del latido anterior y no lo incluye todavía.
      safe(askForPeers);
    }
    if (roomRefreshTimer) return;
    roomRefreshTimer = setTimeout(refresh, 250);
  });

  /*
   * El contenedor se busca en un temporizador y no una sola vez.
   *
   * Antes se resolvía al entrar a la sala y listo, y de ahí salían las marcas
   * que a veces no aparecían: si la vista pasaba a `room` un instante antes de
   * que HaxBall montara el contenedor, no había a qué engancharse y ya no se
   * pintaba más nada; y cuando HaxBall lo REEMPLAZA —al empezar y al terminar
   * la partida— el observador se quedaba mirando un nodo que ya no estaba en la
   * pantalla, así que todo lo que pasara después no se veía.
   *
   * El repintado de cada vuelta es la red de seguridad para lo que se escape:
   * si ya está puesto no toca nada, y treinta filas una vez por segundo no le
   * cuestan nada a nadie — encima esto sólo corre en la sala, nunca jugando.
   */
  const tick = () => {
    const container = doc.querySelector('.room-view > .container');
    if (container && container !== watched) {
      watched = container;
      roomObserver.disconnect();
      roomObserver.observe(container, { childList: true, subtree: true });
      refresh();
      // Queda dicho en el log: es la línea que separa "no se enganchó" de "se
      // enganchó y algo más falla", que sin esto había que adivinar.
      log('info', 'lista de la sala enganchada', 'sala');
    } else if (container) {
      // Sólo con la sala a la vista: jugando no hay lista que repintar, y esto
      // corre en el proceso del juego mientras se está jugando.
      safe(paintPeers, doc);
    }
    roomPollTimer = setTimeout(tick, 1000);
  };
  tick();
}

/**
 * ¿Esta mutación agregó o sacó una fila de jugador?
 *
 * Lo que se pinta después son las filas, así que no alcanza con mirar los nodos
 * agregados: al cambiar de equipo hay un `remove()` de un lado y un `append()`
 * del otro, y pueden llegar en tandas distintas.
 *
 * No dispara con lo que agregamos NOSOTROS —las marcas y los botones son
 * `<span>`, no filas—, así que repintar acá adentro no se llama a sí mismo.
 */
function changesPlayerList(record) {
  for (const nodes of [record.addedNodes, record.removedNodes]) {
    for (const node of nodes) {
      // El ping reescribe su `textContent`: eso es un nodo de texto, no un
      // elemento. Es la mutación que hay que dejar pasar de largo.
      if (node.nodeType !== 1) continue;
      if (node.classList && node.classList.contains('player-list-item')) return true;
      // La lista entera puede aparecer de una, con las filas adentro.
      if (node.querySelector && node.querySelector('.player-list-item')) return true;
    }
  }
  return false;
}

/* ── Pedir peers frescos cuando cambia la lista ──────────────────────── *
 *
 * Las marcas se pintan con lo que hay en `peers`, y `peers` sólo se renueva
 * cuando contesta el latido de presencia, que es cada treinta segundos. Entrar
 * vos a una sala ya disparaba un latido en el acto (ver `game:room-info` en
 * `main.js`); que entre OTRO no disparaba ninguno, así que su escudo tardaba
 * hasta medio minuto en aparecer.
 *
 * Va agrupado porque esto se dispara bastante más seguido que «entró alguien»:
 * al cambiar de equipo HaxBall no mueve la fila, la destruye y la rehace (ver
 * el comentario de las dos velocidades en `watchRoomPanel`). El freno de verdad
 * —el que protege al sitio— está del otro lado, en `main.js`: acá sólo se junta
 * la ráfaga.
 */
const PEERS_ASK_MS = 4000;
let peersAskTimer = null;
let peersAskedAt = 0;

function askForPeers() {
  if (peersAskTimer) return;
  const wait = Math.max(0, PEERS_ASK_MS - (Date.now() - peersAskedAt));
  peersAskTimer = setTimeout(() => {
    peersAskTimer = null;
    peersAskedAt = Date.now();
    ipcRenderer.send('game:peers-stale');
  }, wait);
}

function stopRoomPanel() {
  clearTimeout(roomRefreshTimer);
  clearTimeout(roomPollTimer);
  // Sin esto queda un pedido en vuelo para una sala de la que ya te fuiste.
  clearTimeout(peersAskTimer);
  roomRefreshTimer = null;
  roomPollTimer = null;
  peersAskTimer = null;
  if (!roomObserver) return;
  roomObserver.disconnect();
  roomObserver = null;
}

/* ------------------------------------------------------------------ *
 * Mapas guardados: buscador, carpetas y renombrar
 * ------------------------------------------------------------------ *
 * HaxBall guarda los estadios que te bajás en IndexedDB, base `stadiums`:
 *
 *   files ─ el `.hbs` entero, con clave autoincremental
 *   meta  ─ { id, name }, donde `id` es la clave del archivo
 *
 * Y el selector arma cada fila así (sacado de su propio bundle):
 *
 *   ml(nombre, cargar, borrar) {
 *     d.textContent = nombre; d.className = "elem";
 *     if (borrar != null) d.classList.add("custom");   // los tuyos
 *   }
 *   zi(lista) { primero los de fábrica, después los de `meta.getAll()` }
 *
 * De ahí salen las dos cosas que hacían falta: los mapas guardados son
 * `.elem.custom`, y van en el MISMO orden que `meta.getAll()` —que IndexedDB
 * devuelve por clave ascendente—. Así cada fila se empareja con su registro sin
 * adivinar.
 *
 * El emparejamiento igual se VERIFICA por nombre antes de habilitar nada: si
 * algún día HaxBall cambia el orden o mete filas nuevas, esto se apaga solo y
 * deja andando el buscador, que sólo mira texto. Renombrar el mapa equivocado
 * sería mucho peor que quedarse corto.
 *
 * La carpeta se guarda en el propio registro de `meta`, en un campo nuestro.
 * HaxBall sólo hace `add` y `delete` sobre ese almacén —nunca lo reescribe—,
 * así que el campo sobrevive solo y no hace falta un archivo aparte que se
 * pueda desincronizar de la base.
 */

const STADIUM_DB = 'stadiums';
const STADIUM_DB_VERSION = 1;

/** El campo nuestro adentro del registro de HaxBall. */
const FOLDER_FIELD = 'tvmFolder';

/** Un pedido a IndexedDB como promesa. */
function ask(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('el pedido a la base falló'));
  });
}

/**
 * Abre la base de estadios del juego.
 *
 * El esquema que se crea es EXACTAMENTE el de HaxBall: si el jugador todavía no
 * guardó ningún mapa la base no existe, y crearla distinta se la rompería a él.
 */
function openStadiums(win) {
  return new Promise((resolve, reject) => {
    if (!win || !win.indexedDB) return reject(new Error('esta ventana no tiene IndexedDB'));
    const request = win.indexedDB.open(STADIUM_DB, STADIUM_DB_VERSION);
    request.onerror = () => reject(request.error || new Error('no se pudo abrir la base de estadios'));
    request.onblocked = () => reject(new Error('la base de estadios está ocupada'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

/*
 * Cerrar la base SIEMPRE, y por eso todo lo de acá abajo va con `finally`.
 * HaxBall la abre y la cierra en cada operación, y su borrado se cancela solo
 * (`onblocked`) si alguien la dejó abierta: una conexión nuestra colgada le
 * rompería el botón Delete.
 */

async function readStadiums(win) {
  const db = await openStadiums(win);
  try {
    return (await ask(db.transaction(['meta']).objectStore('meta').getAll())) || [];
  } finally {
    db.close();
  }
}

async function saveStadiumFolder(win, record, folder) {
  const db = await openStadiums(win);
  try {
    const next = { ...record };
    if (folder) next[FOLDER_FIELD] = folder;
    else delete next[FOLDER_FIELD];
    await ask(db.transaction(['meta'], 'readwrite').objectStore('meta').put(next));
    return next;
  } finally {
    db.close();
  }
}

/**
 * Renombra un mapa en los DOS lugares donde vive su nombre.
 *
 * `meta` es lo que se ve en esta lista. Adentro del archivo hay otro nombre, y
 * ese es el que HaxBall anuncia al cargar el estadio en una sala y el que viaja
 * si lo exportás. Cambiar sólo el primero deja el mapa llamándose distinto
 * según dónde lo mires.
 *
 * @returns {Promise<{record: object, deep: boolean}>} `deep` dice si se pudo
 *          tocar también el archivo.
 */
async function renameStadium(win, record, name) {
  const db = await openStadiums(win);
  try {
    const tx = db.transaction(['meta', 'files'], 'readwrite');
    const next = { ...record, name };
    await ask(tx.objectStore('meta').put(next));

    const file = await ask(tx.objectStore('files').get(record.id));
    const rewritten = renameInsideFile(file, name);
    if (rewritten !== null) await ask(tx.objectStore('files').put(rewritten, record.id));
    return { record: next, deep: rewritten !== null };
  } finally {
    db.close();
  }
}

/**
 * El `.hbs` es JSON de texto: HaxBall lo lee con `readAsText` y avisa del error
 * con el número de línea.
 *
 * Devuelve null —y entonces no se toca el archivo— cuando no se lo puede leer
 * con seguridad. El selector acepta también `.json5`, que admite comentarios y
 * comas colgadas y no pasa por `JSON.parse`: en ese caso vale mucho más dejar
 * el archivo intacto y renombrar sólo la lista que escribirlo mal y que el mapa
 * deje de cargar.
 */
function renameInsideFile(text, name) {
  if (typeof text !== 'string') return null;
  try {
    const map = JSON.parse(text);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
    map.name = name;
    return JSON.stringify(map);
  } catch {
    return null;
  }
}

/** Minúsculas y sin tildes: buscar "muro" tiene que encontrar "Murõ". */
function foldText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/* ── Carpetas de verdad, no un filtro ────────────────────────────────────
 *
 * Se navegan como en el explorador: doble click entra, `..` sube, las migas de
 * arriba saltan a cualquier nivel, y los mapas se arrastran adentro.
 *
 * Dónde vive cada cosa:
 *
 *   · La carpeta de CADA MAPA va en su registro de `meta`, en un campo nuestro.
 *     HaxBall sólo hace `add` y `delete` sobre ese almacén —nunca lo reescribe—,
 *     así que el campo sobrevive solo.
 *   · La LISTA de carpetas va aparte, en el `localStorage` del juego. Hace falta
 *     porque una carpeta vacía no está en ningún mapa, y no puede ir como un
 *     registro más de `meta`: el selector de HaxBall recorre `meta.getAll()` y
 *     le armaría una fila de mapa fantasma.
 *
 * Las rutas son texto con `/`, así que las carpetas anidan sin código extra.
 *
 * Los mapas que trae HaxBall van todos juntos en una carpeta que no se guarda en
 * ningún lado: no están en la base —no tienen registro donde anotar nada— pero
 * sí se distinguen solos, porque el selector les pone `.elem` sin `custom`.
 */

/** Carpeta donde van los mapas que trae HaxBall. No se guarda: se deduce. */
const BUILTIN_FOLDER = 'Mapas de HaxBall';

/** La lista de carpetas, incluidas las vacías. */
const FOLDERS_KEY = 'tvm_map_folders';

/** Sin barras de sobra ni espacios en los bordes. */
function cleanPath(value) {
  return String(value || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

function parentPath(path) {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

function leafName(path) {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? path : path.slice(cut + 1);
}

function readFolders(win) {
  try {
    const raw = win.localStorage.getItem(FOLDERS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(cleanPath).filter(Boolean))];
  } catch {
    return [];
  }
}

function writeFolders(win, list) {
  try {
    win.localStorage.setItem(FOLDERS_KEY, JSON.stringify([...new Set(list.filter(Boolean))]));
  } catch (err) {
    log('warn', `no se pudo guardar la lista de carpetas: ${err.message}`, 'mapas');
  }
}

/** Las carpetas que cuelgan DIRECTO de `path`, no las nietas. */
function childFolders(all, path) {
  const prefix = path ? `${path}/` : '';
  const out = new Set();
  for (const folder of all) {
    if (!folder.startsWith(prefix)) continue;
    const rest = folder.slice(prefix.length);
    if (!rest) continue;
    out.add(prefix + rest.split('/')[0]);
  }
  return [...out].sort((a, b) => leafName(a).localeCompare(leafName(b), 'es'));
}

let pickerObserver = null;
let pickerPollTimer = null;

/**
 * Vigila el contenedor de diálogos, que es donde HaxBall monta el selector.
 *
 * Observar ese contenedor y no el documento entero es lo que hace que esto sea
 * barato: sólo cambia cuando se abre o se cierra un diálogo, nunca mientras se
 * juega. `subtree` hace falta igual porque la lista se llena DESPUÉS de montado
 * el diálogo — `zi()` la completa cuando vuelve `meta.getAll()`.
 */
function watchStadiumPicker(doc) {
  stopStadiumPicker();
  let watched = null;

  const sweep = () => {
    const view = doc.querySelector('.pick-stadium-view');
    if (view) safe(enhanceStadiumPicker, view, doc);
  };

  pickerObserver = new MutationObserver(sweep);

  // El contenedor se busca en un temporizador por lo mismo que la lista de la
  // sala: puede no estar montado todavía cuando la vista cambia.
  const tick = () => {
    const popups = doc.querySelector('[data-hook="popups"]');
    if (popups && popups !== watched) {
      watched = popups;
      pickerObserver.disconnect();
      pickerObserver.observe(popups, { childList: true, subtree: true });
    }
    sweep();
    pickerPollTimer = setTimeout(tick, 1000);
  };
  tick();
}

function stopStadiumPicker() {
  clearTimeout(pickerPollTimer);
  pickerPollTimer = null;
  if (!pickerObserver) return;
  pickerObserver.disconnect();
  pickerObserver = null;
}

function enhanceStadiumPicker(view, doc) {
  const list = view.querySelector('.list');
  if (!list) return;

  if (!view.dataset.tvmMaps) {
    view.dataset.tvmMaps = '1';
    buildPickerTools(view, doc, list);
  }

  // La lista se llena sola un rato después de montarse el diálogo, así que hay
  // que volver a emparejar cuando cambia la cantidad de filas de HaxBall (las
  // nuestras no cuentan: las ponemos y sacamos nosotros en cada repintado).
  const count = list.querySelectorAll('.elem:not(.tvm-row)').length;
  if (view.dataset.tvmCount === String(count)) return;
  view.dataset.tvmCount = String(count);
  if (count) syncStadiumRecords(view, doc);
}

/** El nombre de una fila, sin la etiqueta de carpeta que le colgamos nosotros. */
function mapNameOf(item) {
  if (item.dataset.tvmName) return item.dataset.tvmName;
  const first = item.firstChild;
  const raw = first && first.nodeType === 3 ? first.nodeValue : item.textContent;
  return String(raw || '').trim();
}

/**
 * Repinta una fila de mapa. `folder` sólo se pasa cuando hay que decir DÓNDE
 * está: navegando ya se sabe, pero un resultado de búsqueda puede venir de
 * cualquier carpeta.
 */
function paintMapItem(item, doc, folder) {
  item.textContent = item.dataset.tvmName || mapNameOf(item);
  if (!folder) return;
  const tag = doc.createElement('span');
  tag.className = 'tvm-maps__tag';
  tag.textContent = folder;
  item.append(tag);
}

const FOLDER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const UP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';

/** Una fila nuestra: `..` para subir, o una carpeta. */
function makeFolderRow(doc, kind, path, label) {
  const row = doc.createElement('div');
  // `elem` a propósito: hereda el alto, el hover y el resaltado de HaxBall.
  row.className = 'elem tvm-row';
  row.dataset.tvmKind = kind;
  row.dataset.tvmPath = path;
  row.innerHTML = kind === 'up' ? UP_SVG : FOLDER_SVG;
  row.append(doc.createTextNode(label));
  return row;
}

function buildPickerTools(view, doc, list) {
  const tools = {
    list,
    path: '',
    records: null,
    items: new Map(),
    folders: [],
    builtins: [],
    paired: false
  };
  view.__tvmMaps = tools;

  const bar = doc.createElement('div');
  bar.className = 'tvm-maps';

  const crumbs = doc.createElement('div');
  crumbs.className = 'tvm-maps__crumbs';

  const search = doc.createElement('input');
  search.type = 'search';
  search.className = 'tvm-maps__search';
  search.placeholder = 'Buscar mapa…';

  const editor = doc.createElement('form');
  editor.className = 'tvm-maps__edit';
  editor.hidden = true;
  const field = doc.createElement('input');
  field.type = 'text';
  field.className = 'tvm-maps__field';
  const accept = doc.createElement('button');
  accept.type = 'submit';
  accept.textContent = 'Guardar';
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancelar';
  editor.append(field, accept, cancel);

  bar.append(crumbs, search, editor);
  // Arriba del `.splitter` y no adentro: el splitter reparte a lo ancho la
  // lista y la botonera, y meterle un tercer hijo le rompería ese reparto.
  view.insertBefore(bar, view.querySelector('.splitter'));

  tools.crumbs = crumbs;
  tools.search = search;

  const buttons = view.querySelector('.buttons');
  const folderBtn = doc.createElement('button');
  folderBtn.type = 'button';
  folderBtn.className = 'tvm-maps__btn';
  folderBtn.textContent = 'Nueva carpeta';
  const rename = doc.createElement('button');
  rename.type = 'button';
  rename.className = 'tvm-maps__btn';
  rename.textContent = 'Renombrar';
  const remove = buttons && buttons.querySelector('[data-hook="delete"]');
  if (remove) {
    remove.after(folderBtn);
    folderBtn.after(rename);
  } else if (buttons) {
    buttons.prepend(folderBtn, rename);
  }

  /*
   * Los botones de HaxBall siguen apuntando a lo último que él seleccionó.
   *
   * Al elegir una fila NUESTRA se le saca el resaltado a la suya, pero su
   * selección interna no se puede tocar desde afuera: sin esto, `Pick` cargaría
   * el mapa de antes. Se apagan, y él mismo los vuelve a encender en cuanto se
   * clickea una fila suya, que es cuando corre su `Xg()`.
   */
  const setGameButtons = (on) => {
    for (const hook of ['pick', 'delete', 'export']) {
      const el = buttons && buttons.querySelector(`[data-hook="${hook}"]`);
      if (el) el.disabled = !on;
    }
  };

  const pickedFolder = () => list.querySelector('.tvm-row.selected[data-tvm-kind="folder"]:not([data-tvm-builtin])');
  const pickedMap = () => list.querySelector('.elem.custom.selected');

  const refreshButtons = () => {
    rename.disabled = !tools.paired || (!pickedMap() && !pickedFolder());
    // Adentro de la carpeta de HaxBall no se crean subcarpetas: sus mapas no
    // tienen dónde anotar que están en una.
    folderBtn.disabled = !tools.paired || tools.path === BUILTIN_FOLDER;
  };
  tools.refreshButtons = refreshButtons;

  let mode = null;
  const closeEditor = () => {
    mode = null;
    editor.hidden = true;
    field.value = '';
  };
  const openEditor = (next) => {
    mode = next;
    editor.hidden = false;
    if (next === 'folder') {
      field.value = '';
      field.placeholder = 'Nombre de la carpeta nueva';
    } else {
      const folder = pickedFolder();
      field.value = folder ? leafName(folder.dataset.tvmPath) : (pickedMap() || {}).dataset.tvmName || '';
      field.placeholder = folder ? 'Nombre de la carpeta (vacío la saca)' : 'Nombre del mapa';
    }
    field.focus();
    field.select();
  };

  folderBtn.addEventListener('click', () => openEditor('folder'));
  rename.addEventListener('click', () => openEditor('rename'));
  cancel.addEventListener('click', closeEditor);

  editor.addEventListener('submit', (event) => {
    event.preventDefault();
    const what = mode;
    const value = field.value.trim();
    const folder = pickedFolder();
    const map = pickedMap();
    closeEditor();
    if (what === 'folder') createFolder(view, doc, value);
    else if (folder) renameFolder(view, doc, folder.dataset.tvmPath, value);
    else if (map) renameMap(view, doc, map, value);
  });

  /*
   * Las teclas no pueden salir de estos campos.
   *
   * HaxBall escucha el teclado en el documento para moverse y para el chat, así
   * que sin esto escribir el nombre de un mapa le manda cada letra al juego —y
   * el `Escape` del editor le cerraría el diálogo entero.
   */
  const swallow = (event) => {
    event.stopPropagation();
    if (event.key === 'Escape' && event.type === 'keydown') {
      event.preventDefault();
      closeEditor();
    }
  };
  for (const el of [search, field]) {
    for (const type of ['keydown', 'keyup', 'keypress']) el.addEventListener(type, swallow, true);
  }

  search.addEventListener('input', () => renderPicker(view, doc));

  list.addEventListener('click', (event) => {
    const row = event.target.closest && event.target.closest('.elem');
    if (!row) return;
    if (row.classList.contains('tvm-row')) {
      for (const el of list.querySelectorAll('.elem.selected')) el.classList.remove('selected');
      row.classList.add('selected');
      setGameButtons(false);
    } else {
      // Fila de HaxBall: la marca vuelve a ser suya y sus botones también.
      for (const el of list.querySelectorAll('.tvm-row.selected')) el.classList.remove('selected');
    }
    setTimeout(refreshButtons, 0);
  });

  list.addEventListener('dblclick', (event) => {
    const row = event.target.closest && event.target.closest('.tvm-row');
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    goToFolder(view, doc, row.dataset.tvmKind === 'up' ? parentPath(tools.path) : row.dataset.tvmPath);
  });

  refreshButtons();
}

function goToFolder(view, doc, path) {
  const tools = view.__tvmMaps;
  if (!tools) return;
  tools.path = path || '';
  tools.search.value = '';
  renderPicker(view, doc);
  tools.refreshButtons();
}

async function syncStadiumRecords(view, doc) {
  const tools = view.__tvmMaps;
  if (!tools) return;

  let records;
  try {
    records = await readStadiums(doc.defaultView);
  } catch (err) {
    log('warn', `no se pudo leer los mapas guardados: ${err.message}`, 'mapas');
    return;
  }

  const items = [...tools.list.querySelectorAll('.elem.custom')];
  const paired = records.length === items.length &&
    items.every((item, i) => records[i] && mapNameOf(item) === records[i].name);

  tools.paired = paired;
  tools.records = paired ? records : null;
  tools.items = new Map();
  tools.builtins = [...tools.list.querySelectorAll('.elem:not(.custom):not(.tvm-row)')];

  if (!paired) {
    log(
      'warn',
      `la lista de mapas no coincide con la base (${items.length} a la vista, ${records.length} guardados): ` +
      'queda el buscador, pero las carpetas y el renombrar se apagan',
      'mapas'
    );
    tools.folders = [];
    tools.path = '';
  } else {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const record = records[i];
      item.dataset.tvmId = String(record.id);
      item.dataset.tvmName = record.name;
      item.dataset.tvmFolder = cleanPath(record[FOLDER_FIELD] || '');
      item.draggable = true;
      tools.items.set(String(record.id), item);
      wireDragSource(item);
    }
    // Las carpetas guardadas MÁS las que algún mapa esté usando: si la lista se
    // borrara, las carpetas con mapas adentro siguen existiendo igual.
    tools.folders = [...new Set([
      ...readFolders(doc.defaultView),
      ...records.map((record) => cleanPath(record[FOLDER_FIELD] || '')).filter(Boolean)
    ])];
  }

  tools.refreshButtons();
  renderPicker(view, doc);
}

function wireDragSource(item) {
  if (item.dataset.tvmDrag) return;
  item.dataset.tvmDrag = '1';
  item.addEventListener('dragstart', (event) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.dataset.tvmId || '');
    item.classList.add('tvm-maps--dragging');
  });
  item.addEventListener('dragend', () => item.classList.remove('tvm-maps--dragging'));
}

function wireDropTarget(view, doc, row, path) {
  const over = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    row.classList.add('tvm-maps--drop');
  };
  row.addEventListener('dragenter', over);
  row.addEventListener('dragover', over);
  row.addEventListener('dragleave', () => row.classList.remove('tvm-maps--drop'));
  row.addEventListener('drop', (event) => {
    event.preventDefault();
    row.classList.remove('tvm-maps--drop');
    const id = event.dataTransfer.getData('text/plain');
    if (id) moveMapTo(view, doc, id, path);
  });
}

function renderPicker(view, doc) {
  const tools = view.__tvmMaps;
  if (!tools) return;
  const { list } = tools;
  const term = foldText(tools.search.value);
  // Buscando se muestra todo lo que coincida, venga de donde venga —como el
  // explorador—, así que no hay carpetas en pantalla ni nivel actual.
  const flat = !!term || !tools.paired;

  for (const row of [...list.querySelectorAll('.tvm-row')]) row.remove();

  if (!flat) {
    const rows = [];
    if (tools.path) rows.push(makeFolderRow(doc, 'up', parentPath(tools.path), '..'));
    for (const folder of childFolders(tools.folders, tools.path)) {
      rows.push(makeFolderRow(doc, 'folder', folder, leafName(folder)));
    }
    if (!tools.path && tools.builtins.length) {
      const row = makeFolderRow(doc, 'folder', BUILTIN_FOLDER, BUILTIN_FOLDER);
      // No acepta mapas tuyos: sus filas no tienen registro donde anotar nada.
      row.dataset.tvmBuiltin = '1';
      rows.push(row);
    }
    // Arriba de todo y en orden, como en el explorador.
    for (let i = rows.length - 1; i >= 0; i--) list.prepend(rows[i]);
    for (const row of rows) {
      if (row.dataset.tvmBuiltin) continue;
      wireDropTarget(view, doc, row, row.dataset.tvmKind === 'up' ? parentPath(tools.path) : row.dataset.tvmPath);
    }
  }

  for (const item of list.querySelectorAll('.elem:not(.tvm-row)')) {
    const custom = item.classList.contains('custom');
    const folder = custom ? (item.dataset.tvmFolder || '') : BUILTIN_FOLDER;
    const show = flat ? (!term || foldText(mapNameOf(item)).includes(term)) : folder === tools.path;
    item.classList.toggle('tvm-maps--off', !show);
    // La carpeta se dice sólo cuando no se deduce de dónde estás parado.
    paintMapItem(item, doc, flat && custom ? folder : '');
  }

  paintCrumbs(view, doc);

  /*
   * La lista vive dentro de un PerfectScrollbar que HaxBall se guarda para sí
   * (`this.bm`), así que no se le puede pedir un `update()`. Cambiar las filas
   * cambia el alto y su barra queda desfasada hasta que algo la recalcule; un
   * evento de scroll alcanza. Si ni eso lo tomara, el desplazamiento nativo
   * sigue andando igual: lo único que se vería raro es el tamaño del pulgar.
   */
  list.dispatchEvent(new Event('scroll'));
}

function paintCrumbs(view, doc) {
  const tools = view.__tvmMaps;
  const crumbs = tools.crumbs;
  crumbs.replaceChildren();
  if (!tools.paired) return;

  const add = (label, path, last) => {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'tvm-maps__crumb';
    el.textContent = label;
    el.disabled = last;
    el.addEventListener('click', () => goToFolder(view, doc, path));
    crumbs.append(el);
  };

  const parts = tools.path ? tools.path.split('/') : [];

  /*
   * En la raíz no se dibuja nada. Una miga sola que dice «Mapas» y no lleva a
   * ningún lado es una etiqueta suelta arriba del buscador: ocupa una línea
   * para repetir dónde estás, que es el único lugar donde ya se sabe. Adentro
   * de una carpeta sí aparece, porque ahí «Mapas› Torneo» dice algo y el
   * primer tramo es el camino de vuelta.
   */
  if (!parts.length) return;

  add('Mapas', '', false);
  let walked = '';
  parts.forEach((part, i) => {
    walked = walked ? `${walked}/${part}` : part;
    const sep = doc.createElement('span');
    sep.className = 'tvm-maps__sep';
    sep.textContent = '›';
    crumbs.append(sep);
    add(part, walked, i === parts.length - 1);
  });
}

function createFolder(view, doc, name) {
  const tools = view.__tvmMaps;
  if (!tools || !tools.paired) return;
  const leaf = leafName(cleanPath(name));
  if (!leaf) return;

  const path = tools.path ? `${tools.path}/${leaf}` : leaf;
  if (path === BUILTIN_FOLDER) {
    log('warn', `«${BUILTIN_FOLDER}» es la carpeta de los mapas que trae HaxBall: elegí otro nombre`, 'mapas');
    return;
  }
  if (tools.folders.includes(path)) return;

  tools.folders = [...tools.folders, path];
  writeFolders(doc.defaultView, tools.folders);
  renderPicker(view, doc);
}

async function moveMapTo(view, doc, id, path) {
  const tools = view.__tvmMaps;
  if (!tools || !tools.paired) return;
  const record = (tools.records || []).find((one) => String(one.id) === String(id));
  const item = tools.items.get(String(id));
  if (!record || !item) return;
  if ((item.dataset.tvmFolder || '') === path) return;

  try {
    const saved = await saveStadiumFolder(doc.defaultView, record, path);
    Object.assign(record, saved);
    // `Object.assign` no borra: si quedó suelto hay que quitarlo a mano.
    if (!path) delete record[FOLDER_FIELD];
  } catch (err) {
    log('error', `no se pudo mover el mapa: ${err.message}`, 'mapas');
    return;
  }

  item.dataset.tvmFolder = path;
  renderPicker(view, doc);
}

async function renameMap(view, doc, item, value) {
  const tools = view.__tvmMaps;
  if (!tools || !tools.paired || !value) return;
  const record = (tools.records || []).find((one) => String(one.id) === String(item.dataset.tvmId));
  if (!record) return;

  try {
    const out = await renameStadium(doc.defaultView, record, value);
    Object.assign(record, out.record);
    item.dataset.tvmName = value;
    if (!out.deep) {
      log('warn', `«${value}»: el archivo no es JSON legible, así que el nombre cambió sólo en la lista`, 'mapas');
    }
  } catch (err) {
    log('error', `no se pudo renombrar el mapa: ${err.message}`, 'mapas');
    return;
  }

  renderPicker(view, doc);
}

/**
 * Renombra una carpeta y arrastra con ella todo lo que tenga adentro, incluidas
 * las subcarpetas.
 *
 * Con el nombre vacío la carpeta desaparece y sus mapas quedan sueltos en el
 * nivel de arriba. Es a propósito: borrar una carpeta no puede llevarse puestos
 * mapas que costó bajar.
 */
async function renameFolder(view, doc, from, value) {
  const tools = view.__tvmMaps;
  if (!tools || !tools.paired) return;

  const leaf = leafName(cleanPath(value));
  const up = parentPath(from);
  const to = leaf ? (up ? `${up}/${leaf}` : leaf) : '';
  if (to === from) return;
  if (to && to === BUILTIN_FOLDER) {
    log('warn', `«${BUILTIN_FOLDER}» es la carpeta de los mapas que trae HaxBall: elegí otro nombre`, 'mapas');
    return;
  }

  const under = (path) => path === from || path.startsWith(`${from}/`);
  const rebase = (path) => (to ? to + path.slice(from.length) : '');

  try {
    for (const record of tools.records || []) {
      const folder = cleanPath(record[FOLDER_FIELD] || '');
      if (!under(folder)) continue;
      const next = rebase(folder);
      const saved = await saveStadiumFolder(doc.defaultView, record, next);
      Object.assign(record, saved);
      if (!next) delete record[FOLDER_FIELD];
      const item = tools.items.get(String(record.id));
      if (item) item.dataset.tvmFolder = next;
    }
  } catch (err) {
    log('error', `no se pudo renombrar la carpeta: ${err.message}`, 'mapas');
    return;
  }

  const folders = tools.folders.map((path) => (under(path) ? rebase(path) : path)).filter(Boolean);
  if (to) folders.push(to);
  tools.folders = [...new Set(folders)];
  writeFolders(doc.defaultView, tools.folders);

  // Si estabas parado adentro de la que se renombró, te vas con ella.
  if (under(tools.path)) tools.path = rebase(tools.path);

  renderPicker(view, doc);
  tools.refreshButtons();
}

/* ------------------------------------------------------------------ *
 * Quién más tiene el cliente
 * ------------------------------------------------------------------ *
 * HaxBall no transmite nada con lo que reconocer a otro cliente: la sala manda
 * nombre, avatar y posición. Los dos se enteran porque los dos le cuentan al
 * sitio dónde están y reciben la lista del otro (ver `panel.js` y el latido en
 * `main.js`). Acá sólo llega esa lista ya resuelta y se pinta.
 *
 * El único hilo entre una fila de la lista y un cliente es EL NOMBRE: es lo
 * único que HaxBall muestra. Por eso la marca va como hermana del nombre y
 * nunca adentro — meterle un hijo cambiaría el `textContent` con el que se
 * emparejan las filas en la pasada siguiente.
 */

/** nick → { vip, cosmetics }. Lo que mandó el último latido. */
let peers = new Map();

/** Las fuentes que el sitio deja elegir, y con qué se dibuja cada una. */
const PEER_FONTS = {
  outfit: 'Outfit, system-ui, sans-serif',
  mono: 'ui-monospace, Consolas, monospace',
  serif: 'Georgia, "Times New Roman", serif',
  round: '"Comic Sans MS", "Segoe UI", sans-serif',
  impact: 'Impact, "Arial Black", sans-serif'
};

/**
 * Los colores que puede elegir un VIP para su fila.
 *
 * Es una lista cerrada y no un color libre a propósito: esto lo dibuja la
 * pantalla de OTRA persona, así que un valor raro sería un problema de ella. El
 * que viaja por la red es el `id` nada más; el CSS lo pone cada cliente.
 *
 * Los ids tienen que ser los mismos en los tres lados: acá, en la interfaz
 * (`app.js`) y en el sitio, que es el que los valida (`client.routes.js`).
 *
 * Son dos tonos por color —uno claro y uno pleno— y no una cadena de CSS: con
 * los tonos sueltos se puede armar el aura, que necesita los mismos colores con
 * distintas transparencias. Van CLAROS porque ahora alumbran sobre el fondo de
 * la lista en vez de taparlo; los de antes iban de medio a oscuro porque
 * rellenaban la fila entera.
 */
const PEER_GRADIENTS = {
  violeta:    { a: '#a78bfa', b: '#7c3aed', text: '#ddd0ff' },
  oceano:     { a: '#7dd3fc', b: '#0ea5e9', text: '#cdeeff' },
  esmeralda:  { a: '#6ee7b7', b: '#10b981', text: '#ccf5e4' },
  fuego:      { a: '#fdba74', b: '#f97316', text: '#ffe0c4' },
  rubi:       { a: '#fda4af', b: '#f43f5e', text: '#ffd7dc' },
  rosa:       { a: '#f9a8d4', b: '#ec4899', text: '#ffd9ed' },
  oro:        { a: '#fde68a', b: '#f59e0b', text: '#ffeeb8' },
  medianoche: { a: '#94a3b8', b: '#475569', text: '#dbe3ec' }
};

/**
 * La fila de un VIP: la receta está en `roomUi.peerLook` y la forma en la hoja
 * de room-ui.js. Acá sólo se decide si el tema es claro, que cambia el tono del
 * nombre.
 *
 * Ojo con `transparent` a secas en un degradado: interpola hacia negro
 * transparente y deja una banda sucia en el medio. Por eso la receta termina
 * siempre en el MISMO color con alfa 0.
 */
function auraStyle(look) {
  return roomUi.peerLook(look, { light: currentPalette().dark === false });
}

/** Las variables que puede dejar puestas `applyPeerLook`, para poder sacarlas. */
const PEER_LOOK_VARS = ['--tvm-vip-bg', '--tvm-vip-bg-hi', '--tvm-vip-edge', '--tvm-vip-name'];

function setPeers(list) {
  peers = new Map();
  for (const peer of list || []) {
    const nick = String((peer && peer.nick) || '').trim();
    if (nick) peers.set(nick, peer);
  }
  const doc = gameDocument();
  if (doc) safe(paintPeers, doc);
}

/**
 * Vos mismo, como si fueras un peer más.
 *
 * El sitio nunca te devuelve en tu propia lista —ya sabés que estás—, así que tu
 * fila hay que marcarla acá. Y conviene que sea acá: es lo único de todo esto
 * que no depende de internet ni de que el sitio esté al día, así que tu escudo y
 * tus colores se ven aunque la presencia no llegue a ninguna parte.
 */
function selfPeer() {
  const nick = myNick();
  if (!nick) return null;
  const looks = (state.config.vip && state.config.vip.cosmetics) || null;
  return { nick, vip: isVipNow(), cosmetics: isVipNow() ? looks : null };
}

/**
 * Cómo te llamás EN EL JUEGO, que no siempre es cómo te llamás en la config.
 *
 * Manda lo que HaxBall tiene guardado, no lo que el cliente escribió alguna vez:
 * el jugador puede cambiarse el nombre con el botón «Change Nick» de HaxBall, y
 * a partir de ahí el de la config es historia. La fila de la lista dice el
 * nombre nuevo, así que buscarte por el viejo no encuentra nada.
 *
 * (La config se pone al día sola cuando eso pasa —ver el interceptor de
 * `setItem`—, así que las dos fuentes suelen coincidir. El respaldo es para el
 * primer arranque, antes de que HaxBall escriba nada.)
 */
function myNick() {
  const live = String(readStorage(haxball.NICK_KEY) || '').trim();
  return live || (state.config.general.nickname || '').trim();
}

/**
 * Nada de esto se acuerda de lo que hizo la pasada anterior: mira el DOM y lo
 * deja como tiene que estar.
 *
 * Es a propósito. Antes había una marca (`dataset.tvmPeer`) para no repetir
 * trabajo, y cambiando de equipo la insignia desaparecía para siempre: HaxBall
 * mueve la fila de una lista a la otra reusando el elemento, así que la marca
 * seguía puesta pero los hijos ya no estaban. Preguntándole al DOM en vez de a
 * una bandera propia, la fila se arregla sola en la pasada siguiente.
 */
function paintPeers(doc) {
  const me = selfPeer();

  for (const row of playerRows(doc)) {
    const name = row.querySelector('[data-hook="name"]');
    if (!name) continue;

    const nick = (name.textContent || '').trim();
    const peer = nick ? (me && nick === me.nick ? me : peers.get(nick)) : null;

    const marks = ensureMarks(doc, row, !!peer);
    if (!peer) {
      applyPeerLook(row, name, null);
      continue;
    }

    marks.vip.hidden = !peer.vip;
    /*
     * Quién de los que están en la cancha es amigo tuyo.
     *
     * Lo decide el sitio y llega en el latido (ver `peers` en el panel): acá no
     * se puede resolver, porque en la sala hay nicks de HaxBall y la lista de
     * amigos son cuentas de Discord — emparejarlos por texto marcaría como amigo
     * al primero que se copie el nombre.
     *
     * Tu propia fila no lleva la marca: `selfPeer` no trae `friend` y no tendría
     * sentido que lo trajera.
     */
    marks.friend.hidden = !peer.friend;
    applyPeerLook(row, name, peer.cosmetics);
  }
}

/**
 * Deja la fila con (o sin) las insignias y devuelve las que hay.
 *
 * Cada pieza se busca por su clase y se repone si falta, en vez de darlas por
 * puestas cuando existe el cajón. Ahí estaba el «a veces sale a medias»: se
 * devolvía `firstElementChild` y `lastElementChild`, así que si el cajón llegaba
 * a quedar con UNA sola insignia —porque el escudo no cargó, porque HaxBall
 * rehízo la fila entre dos pasadas— las dos referencias apuntaban al mismo
 * elemento, y la línea de abajo (`marks.vip.hidden = !peer.vip`) escondía el
 * ESCUDO en todo el que no fuera VIP. Que es exactamente lo que se veía.
 *
 * @returns {{logo: Element, vip: Element, friend: Element}|null}
 */
function ensureMarks(doc, row, wanted) {
  let box = row.querySelector('.tvm-marks');
  if (!wanted) {
    box?.remove();
    return null;
  }

  if (!box) {
    box = doc.createElement('span');
    box.className = 'tvm-marks';
    row.querySelector('[data-hook="name"]').after(box);
  }

  let logo = box.querySelector('.tvm-mark--logo');
  let friend = box.querySelector('.tvm-mark--friend');
  let vip = box.querySelector('.tvm-mark--vip');
  if (!logo) box.prepend(logo = logoMark(doc));
  /*
   * El orden es escudo · amigo · VIP. El de amigo va en el medio a propósito:
   * los de los extremos son fijos por persona —tiene el cliente, tiene el rol— y
   * éste depende de quién esté mirando, así que agregarlo o sacarlo no corre las
   * otras dos de lugar.
   *
   * Se inserta ANTES del diamante y no después del escudo: el escudo se saca
   * solo si el PNG no cargó (ver `logoMark`), y colgarse de un elemento que
   * puede no estar en el árbol dejaría la marca de amigo sin dibujar.
   */
  if (!vip) box.append(vip = vipMark(doc));
  if (!friend) box.insertBefore(friend = friendMark(doc), vip);
  return { logo, vip, friend };
}

/** El escudo del club, servido por el proceso principal (la página es https). */
function logoMark(doc) {
  const img = doc.createElement('img');
  img.className = 'tvm-mark tvm-mark--logo';
  img.src = assetUrl('logo');
  img.alt = '';
  img.title = 'Está jugando con TL App';
  /*
   * Si no cargó, se saca. No es rendirse: `ensureMarks` repone lo que falta en
   * la pasada siguiente —y hay una por segundo—, así que un tropiezo del
   * esquema `tvm-asset://` al arrancar se arregla solo en vez de dejar un hueco
   * para toda la sesión.
   */
  img.addEventListener('error', () => img.remove());
  return img;
}

/**
 * El diamante del VIP: relleno, con las caras en tres tonos y un filo oscuro.
 *
 * Era de contorno, y a 14 px el trazo quedaba en un píxel escaso al lado de un
 * escudo que es un sólido: los dos símbolos no parecían de la misma familia.
 * Relleno, las caras se leen como caras sin ningún brillo encima. El dibujo y
 * el porqué de cada tono están en `VIP_GEM_SVG` (room-ui.js).
 */
function vipMark(doc) {
  const mark = doc.createElement('span');
  mark.className = 'tvm-mark tvm-mark--vip';
  mark.title = 'TL App';
  mark.hidden = true;
  mark.innerHTML = VIP_GEM_SVG;
  return mark;
}

/**
 * La marca de amigo: dos personas, de contorno, como el resto.
 *
 * No dice quién es, y eso es deliberado: en la sala están todos mirando la misma
 * lista, y poner ahí el nombre de Discord de alguien sería publicárselo a
 * treinta desconocidos. La marca contesta «a éste lo conocés» y el nombre lo
 * dice el perfil, que se abre con el clic derecho a propósito.
 *
 * Verde y no violeta: el violeta ya es el acento de la app y el celeste ya es el
 * VIP, que está a dos píxeles. A 14 px lo único que separa dos insignias es el
 * color, así que la tercera tenía que ser un tono que no estuviera en juego.
 */
function friendMark(doc) {
  const mark = doc.createElement('span');
  mark.className = 'tvm-mark tvm-mark--friend';
  mark.title = 'Es tu amigo';
  mark.hidden = true;
  mark.innerHTML = FRIEND_SVG;
  return mark;
}

/*
 * Los dos dibujos están en room-ui.js, al lado de la hoja que los pinta. El del
 * diamante está también en `index.html` (`.looksdemo__gem`), que es la muestra
 * de «cómo te ven en la lista» del panel VIP: si se cambia uno hay que cambiar
 * el otro, o la muestra deja de mostrar la verdad.
 */
const { FRIEND_SVG, VIP_GEM_SVG } = roomUi;

/**
 * El degradado va en la FILA y no en el nombre: es la línea entera del jugador
 * la que se pinta, como una tarjeta.
 *
 * El color del texto también se pone en la fila, y eso no es un detalle: el
 * nombre lo hereda, pero HaxBall pinta de dorado el de los admins con una regla
 * más específica (`.admin [data-hook=name]`). Poniéndolo acá, un VIP que además
 * es admin conserva su dorado en vez de perderlo debajo del cosmético.
 */
function applyPeerLook(row, name, looks) {
  const look = looks && PEER_GRADIENTS[looks.gradient];
  const font = looks && PEER_FONTS[looks.font];
  const aura = look ? auraStyle(look) : null;

  row.classList.toggle('tvm-peer-row', !!look);
  // Los colores van acá y no en la hoja de estilos porque son los elegidos: en
  // el CSS habría que declarar las ocho variantes. Van como variables, y la
  // hoja decide dónde se usan (también en el hover, que antes los borraba).
  for (const key of PEER_LOOK_VARS) {
    if (aura) row.style.setProperty(key, aura[key]);
    else row.style.removeProperty(key);
  }
  // Lo que ponía la receta anterior en línea. Se limpia por si la fila viene
  // de una pasada de antes de la actualización.
  row.style.backgroundImage = '';
  row.style.boxShadow = '';
  row.style.color = look ? look.text : '';
  name.style.fontFamily = font || '';
}

/* ------------------------------------------------------------------ *
 * Dónde estoy, para que me reconozcan
 * ------------------------------------------------------------------ *
 * La sala se identifica por su código, el de `/play?c=…`. De acá sale en claro y
 * no pasa de la app: el que lo hashea antes de que salga de la PC es `panel.js`,
 * en el proceso principal.
 *
 * El código sale de HaxBall mismo (`__tvmRoomLink`, ver ROOM_LINK_SITE en
 * game-patch.js) y no de la dirección. La dirección sólo lo tiene si se entró
 * por un link: el que entraba desde la lista de salas, o hosteaba, caía al
 * nombre de la sala, y para el sitio ésa era OTRA sala que la de los que
 * entraron por link. Por eso a varios con el cliente no se les veía el escudo.
 *
 * El nombre queda como último recurso (bundle sin parchear). Dos salas con el
 * mismo nombre caerían en el mismo grupo: lo peor que puede pasar es una marca
 * de más, y no se filtra nada, porque lo que viaja es un hash.
 */
function reportRoomInfo(kind) {
  // Fuera de una sala no hay a quién reconocer, y el sitio no tiene por qué
  // saber que la app está abierta en la lista.
  if (kind !== 'room' && kind !== 'game') {
    // Salir de la sala es soltar su código: el de la próxima llega al entrar.
    if (kind === 'roomlist') state.roomToken = null;
    ipcRenderer.send('game:room-info', { room: null, token: null, name: null, nick: null });
    return;
  }

  const token = state.roomToken || new URLSearchParams(window.location.search).get('c');
  // El nombre con el que estás EN LA SALA: es por el que te van a buscar los
  // otros clientes. Ver `myNick`.
  const nick = myNick();
  ipcRenderer.send('game:room-info', {
    room: token || (state.roomName ? `name:${state.roomName}` : null),
    /*
     * El token pelado va aparte de la huella: es lo que se le manda a un amigo
     * para que pueda entrar, y por eso NO sale de la app salvo que toques
     * "Invitar". Con el código que publica HaxBall existe también hosteando.
     */
    token: token || null,
    name: state.roomName || null,
    nick: nick || null
  });
}

/* ------------------------------------------------------------------ *
 * Avatar con imagen sobre el disco (VIP)
 * ------------------------------------------------------------------ *
 * HaxBall arma la textura de cada disco en un canvas de 64×64: pinta las
 * franjas del equipo y encima el avatar, y de ese canvas saca el patrón con el
 * que dibuja el disco en la cancha. En game-min.js:
 *
 *   sr(a){ ...franjas...
 *          this.Kb.font = "900 34px 'Arial Black',...";
 *          this.Kb.fillText(a, 32, 44);
 *          this.ak = this.Kb.createPattern(this.Kb.canvas, "no-repeat") }
 *
 * Enganchándose a ese `fillText` se cambia el texto por una imagen, y queda
 * dibujada sobre el disco, en la cancha.
 *
 * Cómo se reconoce cuál disco es el tuyo: por el texto del avatar. Es lo único
 * que llega hasta acá, porque el canvas de la textura no sabe de jugadores. Por
 * eso hace falta tener puesto un avatar de dos caracteres — es la marca. Si
 * otro jugador usa exactamente el mismo, en TU pantalla también le va a salir
 * tu imagen; no se puede distinguir y es sólo cosmético.
 *
 * Todo esto es local: a la sala sigue viajando el avatar de dos caracteres, que
 * es lo único que HaxBall transmite.
 */
let avatarImage = null;
let avatarImageSrc = '';
const hookedWindows = new WeakSet();

/* ------------------------------------------------------------------ *
 * Imagen de la pelota
 * ------------------------------------------------------------------ *
 * El parche del bundle llama a `window.__tvmBall(ctx, x, y, r)` justo donde el
 * juego iba a rellenar la pelota, con el trazo del círculo ya armado. Ver
 * `BALL_SITE` en `game-patch.js`.
 *
 * Devolver `true` significa «ya la dibujé yo»; cualquier otra cosa deja pasar
 * el relleno de siempre. Por eso todo acá adentro es a prueba de balas: si algo
 * falla, la pelota se ve normal en vez de desaparecer.
 *
 * Es local, como el avatar sobre el disco: HaxBall no transmite nada del
 * aspecto de la pelota, así que esto lo ve únicamente quien lo puso.
 */
let ballImage = null;
let ballImageSrc = '';

/**
 * Lado de cada cuadro del GIF, en píxeles.
 *
 * 128 y no 64 como el avatar: el disco del jugador se dibuja siempre sobre una
 * textura de 64, pero la pelota se escala con la cámara y de cerca queda bastante
 * más grande que eso. Los cuadros van todos en UNA tira, así que la memoria es
 * fija y no depende de cuánto pese el archivo.
 */
const BALL_PX = 128;

let ballSheet = null;
let ballDelays = null;
let ballTotalMs = 0;
let ballGifBytes = null;
let ballGifAsked = '';

function ballGifOn() {
  return !!(ballSheet && ballDelays && ballDelays.length > 1);
}

/**
 * Qué cuadro del GIF toca ahora.
 *
 * El índice sale del reloj y no de un temporizador: esto corre una vez por
 * cuadro dibujado, así que mirar la hora sale más barato que mantener vivo un
 * `setTimeout` — y de paso la animación no se desincroniza si el juego pierde
 * cuadros ni sigue corriendo cuando no hay nada que dibujar.
 */
function ballFrameIndex() {
  if (!ballTotalMs) return 0;
  let t = performance.now() % ballTotalMs;
  for (let i = 0; i < ballDelays.length; i++) {
    t -= ballDelays[i];
    if (t < 0) return i;
  }
  return ballDelays.length - 1;
}

/** El estadio de la sala actual, capturado cuando el juego dibuja la cancha. */
let currentStadium = null;

function drawBall(ctx, x, y, r, indice) {
  // La red ondulante se dibuja una vez por cuadro, con la pelota (disco 0).
  if (indice === 0 && state.config.pitch && state.config.pitch.netRipple && !(state.config.perf && state.config.perf.flatGraphics)) {
    try {
      const b = pitchBounds(currentStadium);
      if (b && netRipple.active(x, b.halfW)) netRipple.draw(ctx, b.halfW, b.halfH);
    } catch { /* un adorno no puede romper el dibujo */ }
  }
  /*
   * Sólo el disco 0. Los PALOS DEL ARCO también son discos sin jugador y
   * entraban por acá, así que salían con la imagen puesta igual que la pelota.
   * El índice lo trae el parche desde el bucle de dibujo; que la pelota sea el
   * disco 0 lo decide HaxBall, no nosotros (ver BALL_SITE en `game-patch.js`).
   */
  if (indice !== 0) return false;
  if (!(r > 0)) return false;
  const animada = ballGifOn();
  const depth = !!(state.config.pitch && state.config.pitch.ball3d);
  if (!animada && !ballImage && !depth) return false;

  try {
    ctx.save();
    // El trazo del círculo ya está armado por el `arc()` del juego: recortando
    // contra él la imagen queda redonda sola, sea cuadrada o no.
    ctx.clip();
    /*
     * Con el espejo puesto (ver `wantMirror`), la imagen saldría dada vuelta
     * como todo lo que se dibuja en coordenadas de cancha —y una pelota con un
     * escudo se nota—. Se la vuelve a dar vuelta alrededor de su propio
     * centro. El recorte no se mueve: ya quedó fijado contra el círculo, y un
     * círculo espejado es el mismo círculo.
     */
    if (mirrorOn) {
      ctx.translate(2 * x, 0);
      ctx.scale(-1, 1);
    }
    const roll = depth ? ball3d.motion(ctx, x, y, r, performance.now()) : null;
    if (depth) {
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(roll.a + roll.b);
      ctx.translate(-x, -y);
    }
    try { if (animada) {
      const i = ballFrameIndex();
      ctx.drawImage(ballSheet, i * BALL_PX, 0, BALL_PX, BALL_PX, x - r, y - r, 2 * r, 2 * r);
    } else if (ballImage) {
      ctx.drawImage(ballImage, x - r, y - r, 2 * r, 2 * r);
    } } finally { if (depth) ctx.restore(); }
    if (depth) {
      if (!animada && !ballImage) ball3d.surface(ctx, x, y, r, roll);
      ball3d.shade(ctx, x, y, r);
    }
    ctx.restore();
    return true;
  } catch {
    // El `restore()` va igual: si el clip se queda puesto, se lleva puesto el
    // resto del dibujo de la cancha y no sólo a la pelota.
    try { ctx.restore(); } catch {}
    return false;
  }
}

function currentAvatarText() {
  return haxball.clampAvatar(state.config.avatar && state.config.avatar.static);
}

/**
 * ¿Este texto de avatar es MÍO?
 *
 * Antes se comparaba sólo contra el avatar fijo de la config, así que la imagen
 * se caía apenas el avatar cambiaba: con la animación andando (cada cuadro es
 * un texto distinto), al escribir /avatar a mano en el chat, o con la config
 * recién editada. Ahora entran los tres orígenes:
 *
 *   · el avatar fijo de la config
 *   · cada cuadro de la animación
 *   · lo que HaxBall tenga guardado ahora mismo, que es lo que gana si el
 *     jugador lo cambió por fuera del cliente
 */
let cachedAvatarTexts = null;

function invalidateAvatarTextsCache() {
  cachedAvatarTexts = null;
}

function myAvatarTexts() {
  if (cachedAvatarTexts) return cachedAvatarTexts;
  const avatar = state.config.avatar || {};
  const texts = new Set();

  const add = (value) => {
    const clean = haxball.clampAvatar(value);
    if (clean) texts.add(clean);
  };

  add(avatar.static);
  add(readStorage(haxball.AVATAR_KEY));
  if (avatar.animated) for (const frame of avatarFrames(avatar.frames)) add(frame);

  cachedAvatarTexts = texts;
  return texts;
}

/**
 * Precarga la imagen en el contexto del juego: al dibujar tiene que estar lista.
 *
 * La imagen NO pide rol: es un dibujo que hace tu propia máquina sobre tu
 * propio disco y no sale de tu pantalla. Lo que sí pide rol es que se MUEVA,
 * o sea el GIF; sin rol, un GIF se ve como se vería en cualquier lado sin
 * animación: su primer cuadro, quieto.
 */
function loadAvatarImage(view) {
  const file = (state.config.vip && state.config.vip.avatarImage) || '';
  if (!file) {
    avatarImage = null;
    avatarImageSrc = '';
    stopGifAvatar();
    return;
  }

  installCanvasHooks(view && view.document);
  // Los cuadros se piden aparte y por IPC: del <img> no se pueden sacar.
  wantGifAvatar(file);

  if (avatarImageSrc === file && avatarImage) return;

  avatarImageSrc = file;
  avatarImage = null;
  const img = new view.Image();
  img.onload = () => {
    if (avatarImageSrc !== file) return;
    avatarImage = img;
    refreshAvatarTexture();
  };
  img.onerror = () => {
    if (avatarImageSrc !== file) return;
    avatarImage = null;
    log('error', 'No se pudo cargar la imagen del avatar', 'vip');
  };
  img.src = assetUrl('avatar', hashOf(file));
}

/**
 * Deja la pelota lista: publica el hook y carga lo que haya configurado.
 *
 * El hook se publica SIEMPRE, aunque no haya imagen puesta. El parche del
 * bundle pregunta por él en cada cuadro y si no existe rellena como siempre,
 * así que publicarlo de entrada evita depender de en qué orden pasan la carga
 * del juego y el primer cambio de configuración.
 */
function loadBallImage(view) {
  if (!view) return;
  try {
    view.__tvmBall = drawBall;
  } catch (err) {
    log('error', `no se pudo enganchar la pelota: ${err.message}`, 'vip');
    return;
  }

  const file = (state.config.vip && state.config.vip.ballImage) || '';
  if (!file) {
    ballImage = null;
    ballImageSrc = '';
    stopBallGif();
    return;
  }

  // Los cuadros se piden aparte y por IPC, igual que los del avatar: de un
  // `<img>` no se pueden sacar.
  wantBallGif(file);

  if (ballImageSrc === file && ballImage) return;

  ballImageSrc = file;
  ballImage = null;
  const img = new view.Image();
  img.onload = () => { if (ballImageSrc === file) ballImage = img; };
  img.onerror = () => {
    if (ballImageSrc !== file) return;
    ballImage = null;
    log('error', 'No se pudo cargar la imagen de la pelota', 'vip');
  };
  img.src = assetUrl('ball', hashOf(file));
}

/** Sin rol no hay animación; la imagen fija la puede poner cualquiera. */
function wantBallGif(file) {
  if (!file) {
    if (ballGifAsked) stopBallGif();
    return;
  }
  // Ya se preguntó por este archivo: la respuesta, sea la que sea, ya llegó.
  if (ballGifAsked === file) return;
  ballGifAsked = file;
  ipcRenderer.send('game:want-ball-gif');
}

function stopBallGif() {
  ballGifBytes = null;
  ballGifAsked = '';
  forgetBallFrames();
}

/** Lo que vive en el documento del juego y no sobrevive a una recarga. */
function forgetBallFrames() {
  ballSheet = null;
  ballDelays = null;
  ballTotalMs = 0;
}

/**
 * Decodifica el GIF de la pelota a una tira de cuadros de 128×128.
 *
 * Mucho más simple que el del avatar: aquel tiene que REEMPLAZAR el
 * `CanvasPattern` con el que HaxBall dibuja el disco, porque un patrón se queda
 * con una foto del canvas. Acá no hay patrón — el hook dibuja directo sobre el
 * contexto en cada cuadro —, así que alcanza con tener los cuadros a mano.
 */
function buildBallFrames() {
  const doc = gameDocument();
  const view = doc && doc.defaultView;
  if (!doc || !view || !ballGifBytes) return;

  forgetBallFrames();

  const delays = [];
  let sheet = null;
  let sheetCtx = null;
  let tmp = null;
  let tmpCtx = null;
  let datos = null;

  const onCuadro = (rgba, retardo, indice, ancho, alto) => {
    if (!sheet) {
      sheet = doc.createElement('canvas');
      sheet.width = BALL_PX * gif.MAX_CUADROS;
      sheet.height = BALL_PX;
      sheetCtx = sheet.getContext('2d');
      tmp = doc.createElement('canvas');
      tmp.width = ancho;
      tmp.height = alto;
      tmpCtx = tmp.getContext('2d');
      // El ImageData se crea en el realm del juego: el buffer que entrega el
      // decodificador es de este módulo y se reusa entre cuadros.
      datos = new view.ImageData(ancho, alto);
    }
    datos.data.set(rgba);
    tmpCtx.putImageData(datos, 0, 0);
    sheetCtx.clearRect(indice * BALL_PX, 0, BALL_PX, BALL_PX);
    sheetCtx.drawImage(tmp, 0, 0, ancho, alto, indice * BALL_PX, 0, BALL_PX, BALL_PX);
    delays.push(retardo);
  };

  /*
   * Si el GIF no se puede leer hay que DECIRLO: quedarse con la imagen fija en
   * silencio es indistinguible de que todo haya andado bien. Es la misma
   * lección que dejó el GIF de 640×640 del avatar.
   */
  try {
    gif.decode(ballGifBytes, onCuadro);
  } catch (err) {
    log('error', `El GIF de la pelota no se pudo leer: ${err.message}`, 'vip');
    notify(`Ese GIF no se puede animar: ${err.message}`, 'err');
    return;
  }

  if (!sheet || delays.length < 2) {
    log('info', 'El GIF de la pelota tiene un solo cuadro: se usa como imagen fija', 'vip');
    return;
  }

  ballSheet = sheet;
  ballDelays = delays;
  ballTotalMs = delays.reduce((sum, ms) => sum + ms, 0) || 0;
  log('info', `pelota animada: ${delays.length} cuadros`, 'vip');
}

/* ------------------------------------------------------------------ *
 * Avatar animado (GIF)
 * ------------------------------------------------------------------ *
 * El disco se dibuja con un CanvasPattern que HaxBall arma una sola vez, al
 * cambiar el avatar. Para animarlo hay que REEMPLAZAR ese patrón: repintar la
 * textura no sirve, porque un patrón se queda con una foto del canvas y no lo
 * vuelve a mirar (medido en Chromium 91).
 *
 * Reemplazarlo, en cambio, no cuesta nada: el que dibuja el disco hace
 * `fillStyle = b.ak` en cada cuadro y por cada disco, así que alcanza con
 * escribirle esa propiedad cada tanto. Medido: dibujar el disco cuesta 4,86 µs
 * con el patrón de siempre y 5,18 µs rotando veinte patrones EN CADA CUADRO
 * —el peor caso imaginable, que no es el real—, y una asignación son 0,012 µs.
 *
 * El trabajo de verdad se paga una sola vez y fuera de la partida:
 * decodificar el GIF (≈5 ms) y armar una textura por cuadro (≈3,4 ms cada una,
 * repartidas para no comerse un cuadro entero).
 *
 * Quién nos da el objeto del disco es el parche del bundle: ver `patchAvatar`
 * en game-patch.js. Sin parche no hay animación y queda la imagen fija, que es
 * exactamente el comportamiento anterior.
 */

/** Bytes del archivo, para poder rearmar todo si el juego se recarga. */
let gifBytes = null;
let gifSrc = '';
/** Por qué archivo se preguntó ya, sea GIF o no. Ver `wantGifAvatar`. */
let gifAsked = '';
/**
 * Los cuadros, todos en un mismo canvas de 64·N × 64 y sin las franjas debajo.
 *
 * Una tira y no un canvas por cuadro porque reservar un canvas cuesta ~3 ms:
 * con veinte cuadros eran 68 ms de tirón. Así se reserva uno solo y cada cuadro
 * se saca con el rectángulo de origen de `drawImage`.
 */
let gifSheet = null;
/** Cuánto dura cada cuadro, en ms. Su largo es la cantidad de cuadros. */
let gifDelays = null;
/** El patrón terminado de cada cuadro (franjas + dibujo), armado a demanda. */
let gifPatterns = null;
let gifIndex = 0;
let gifTimer = null;
/** Vigila que el aviso del parche llegue. Ver el final de `buildGifFrames`. */
let gifCheckTimer = null;
/** Canvas donde se componen las texturas. Se reusa: el patrón se queda con una
 *  foto, así que el mismo canvas sirve para todos los cuadros. */
let gifCompose = null;
/** Las franjas del equipo, tal como estaban antes de pintarles el avatar. */
let avatarBase = null;
/** Tu disco y el nombre de la propiedad del patrón. Lo da el parche. */
let avatarTarget = null;
/** Si el último `fillText` sobre una textura de 64×64 era el de tu disco. */
let lastTextureMine = false;

/**
 * De quién es la textura que se está rearmando AHORA, dicho por el juego.
 *
 * `true`/`false` es un veredicto de identidad: el parche comparó el jugador de
 * esta textura contra el jugador local, por su id de sala. `null` es «no se
 * sabe» y tiene dos causas, las dos legítimas:
 *
 *   · El parche del bundle no aplicó (HaxBall se actualizó y los anclajes ya no
 *     encajan).
 *   · No hay jugador local: un replay, o la vista previa de una sala.
 *
 * En esos dos casos se vuelve al criterio viejo —el texto del avatar—, que se
 * equivoca con los que copian tu avatar pero al menos te pinta a vos.
 */
let textureOwner = null;

function gifOn() {
  return !!(gifSheet && gifDelays && gifDelays.length > 1);
}

/**
 * Le pide los bytes al proceso principal. Sin rol no hay animación.
 *
 * Acá NO se mira si el archivo termina en `.gif`, y eso es a propósito: la
 * extensión miente. Un GIF bajado de la web se guarda como `.png` todo el
 * tiempo, y con el filtro puesto acá ese avatar no animaba nunca sin que nada lo
 * dijera. Quién es un GIF de verdad lo decide el proceso principal, que es el
 * único que puede abrir el archivo y mirarle la firma; si no lo es, contesta
 * `null` y se apaga solo.
 */
function wantGifAvatar(file) {
  if (!file) {
    if (gifSrc || gifAsked) stopGifAvatar();
    return;
  }
  // Ya se preguntó por este archivo: la respuesta, sea la que sea, ya llegó.
  // Sin esto, una imagen que no es GIF se volvía a pedir en cada carga.
  if (gifAsked === file) return;
  gifAsked = file;
  ipcRenderer.send('game:want-avatar-gif');
}

function stopGifAvatar() {
  gifBytes = null;
  gifSrc = '';
  gifAsked = '';
  forgetGifTextures();
}

/** Lo que vive en el documento del juego y no sobrevive a una recarga. */
function forgetGifTextures() {
  clearTimeout(gifTimer);
  clearTimeout(gifCheckTimer);
  gifTimer = null;
  gifCheckTimer = null;
  gifSheet = null;
  gifDelays = null;
  gifPatterns = null;
  gifCompose = null;
  avatarBase = null;
  avatarTarget = null;
  gifIndex = 0;
}

/**
 * Decodifica el GIF y deja los cuadros listos para pintar.
 *
 * Se escala todo a 64×64 acá, que es el tamaño de la textura del disco: así la
 * memoria no depende del tamaño del archivo —16 KB por cuadro, mida el GIF 64
 * píxeles de lado o 512— y componer después es un `drawImage` sin escalado.
 */
function buildGifFrames() {
  const doc = gameDocument();
  const view = doc && doc.defaultView;
  if (!doc || !view || !gifBytes) return;

  clearTimeout(gifTimer);
  gifTimer = null;
  gifPatterns = null;
  gifIndex = 0;

  const delays = [];
  let sheet = null;
  let sheetCtx = null;
  let tmp = null;
  let tmpCtx = null;
  let datos = null;

  const onCuadro = (rgba, retardo, indice, ancho, alto) => {
    if (!sheet) {
      // Cuántos cuadros tiene el GIF se sabe recién al terminar de leerlo, así
      // que la tira se reserva para el tope: 1 MB de canvas que se libera con
      // el documento. Agrandarla después costaría copiar todo lo dibujado.
      sheet = doc.createElement('canvas');
      sheet.width = 64 * gif.MAX_CUADROS;
      sheet.height = 64;
      sheetCtx = sheet.getContext('2d');
      tmp = doc.createElement('canvas');
      tmp.width = ancho;
      tmp.height = alto;
      tmpCtx = tmp.getContext('2d');
      // El ImageData se crea en el realm del juego y se copia adentro: el
      // buffer que entrega el decodificador es de este módulo y se reusa.
      datos = new view.ImageData(ancho, alto);
    }
    datos.data.set(rgba);
    tmpCtx.putImageData(datos, 0, 0);
    sheetCtx.clearRect(indice * 64, 0, 64, 64);
    sheetCtx.drawImage(tmp, 0, 0, ancho, alto, indice * 64, 0, 64, 64);
    delays.push(retardo);
  };

  /*
   * Si el GIF no se puede leer hay que DECIRLO.
   *
   * Esto corría dentro de un `safe()`, que manda el error al registro y sigue:
   * el avatar quedaba fijo y desde afuera era idéntico a que todo hubiera
   * andado. Es exactamente lo que pasó con un GIF de 640×640, que el tope viejo
   * de 512 rechazaba (ver MAX_LADO en gif.js).
   */
  const t0 = Date.now();
  let info;
  try {
    info = gif.decode(gifBytes, onCuadro);
  } catch (err) {
    log('error', `El GIF del avatar no se pudo leer: ${err.message}`, 'vip');
    notify(`Ese GIF no se puede animar: ${err.message}`, 'err');
    return;
  }

  if (!sheet || delays.length < 2) {
    log('info', 'El GIF del avatar tiene un solo cuadro: se usa como imagen fija', 'vip');
    return;
  }

  gifSheet = sheet;
  gifDelays = delays;
  gifCompose = doc.createElement('canvas');
  gifCompose.width = gifCompose.height = 64;

  log('info',
    `Avatar animado listo: ${delays.length} cuadros de ${info.ancho}×${info.alto}` +
    `${info.recortado ? ` (recortado a ${gif.MAX_CUADROS})` : ''} en ${Date.now() - t0} ms`,
    'vip');

  // Si el disco ya estaba identificado, arranca sin esperar al próximo cambio
  // de avatar; si no, arranca cuando el parche lo avise.
  if (avatarTarget) startGifAvatar();

  /*
   * Y si ese aviso no llega nunca, se dice.
   *
   * Sin el parche del bundle no hay a quién cambiarle el patrón: el GIF queda
   * quieto en su primer cuadro, que es exactamente lo que se ve cuando todo
   * anduvo salvo el parche. Sin este renglón, esos dos casos son idénticos
   * desde afuera — y ya pasó una vez, con la copia parcheada vieja guardada en
   * disco (ver PATCH_VERSION en game-patch.js).
   */
  clearTimeout(gifCheckTimer);
  gifCheckTimer = setTimeout(() => {
    gifCheckTimer = null;
    if (avatarTarget || state.view !== 'game') return;
    log('error',
      'El GIF se decodificó pero el disco no se pudo enganchar: el parche del bundle no aplicó y el avatar queda quieto',
      'vip');
  }, 8000);
}

/**
 * Guarda las franjas del equipo, que es lo que va DEBAJO del dibujo.
 *
 * Se copian en el momento justo: adentro del hook de `fillText`, cuando la
 * textura ya tiene las franjas pintadas y todavía no tiene el avatar encima.
 */
function keepAvatarBase(ctx) {
  const doc = gameDocument();
  if (!doc) return;
  if (!avatarBase || avatarBase.width !== 64) {
    avatarBase = doc.createElement('canvas');
    avatarBase.width = avatarBase.height = 64;
  }
  const base = avatarBase.getContext('2d');
  base.clearRect(0, 0, 64, 64);
  try {
    base.drawImage(ctx.canvas, 0, 0);
  } catch {
    avatarBase = null;
  }
}

/** La textura terminada de un cuadro: franjas abajo, dibujo encima. */
function gifPattern(indice) {
  if (!gifOn() || !avatarBase || !gifCompose) return null;
  if (!gifPatterns) gifPatterns = new Array(gifDelays.length).fill(null);
  if (gifPatterns[indice]) return gifPatterns[indice];

  const ctx = gifCompose.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(avatarBase, 0, 0);
  ctx.drawImage(gifSheet, indice * 64, 0, 64, 64, 0, 0, 64, 64);
  // `createPattern` se queda con una FOTO del canvas, así que el mismo canvas
  // sirve para el cuadro siguiente sin pisar el patrón que ya se armó.
  gifPatterns[indice] = ctx.createPattern(gifCompose, 'no-repeat');
  return gifPatterns[indice];
}

/**
 * El parche avisa que HaxBall rearmó la textura de un disco.
 *
 * Llega para TODOS los discos; el nuestro se reconoce por el `fillText` que
 * acaba de pasar (mismo `sr()`, dos líneas antes). Y llega también cuando
 * cambian las franjas —te cambiaste de equipo, la sala cambió los colores—,
 * que es justo cuando las texturas armadas dejan de servir.
 */
function onAvatarTexture(obj, texto, prop) {
  /*
   * El veredicto del propio objeto gana sobre el que dejó el `fillText`: es el
   * mismo dato pero de primera mano, y no depende de que el gancho del canvas
   * haya llegado a correr para esta textura.
   */
  const mia = obj && typeof obj.__tvmMine === 'boolean' ? obj.__tvmMine : lastTextureMine;
  if (!mia || !obj || typeof prop !== 'string') {
    // Dejó de ser tuyo (el host te puso otro avatar): se suelta y HaxBall
    // sigue dibujando lo suyo.
    if (avatarTarget && avatarTarget.obj === obj) {
      avatarTarget = null;
      clearTimeout(gifTimer);
      gifTimer = null;
    }
    return;
  }

  avatarTarget = { obj, prop };
  // Las franjas de abajo son otras: lo armado ya no vale.
  gifPatterns = null;
  gifIndex = 0;
  if (gifOn()) startGifAvatar();
}

function startGifAvatar() {
  clearTimeout(gifTimer);
  gifTimer = null;
  if (!gifOn() || !avatarTarget) return;
  gifTimer = setTimeout(() => safe(tickGif), gifDelays[gifIndex] || 100);
}

/**
 * ¿Hay alguien mirando el disco?
 *
 * Mismo criterio que el techo de cuadros: fuera de la cancha, minimizado o con
 * un panel del cliente encima no hay nada que animar. No es por lo que cuesta
 * —una asignación son 12 ns— sino porque un temporizador que corre para nadie
 * despierta al proceso y se lleva su rebanada del hilo del juego.
 */
function gifWanted() {
  return state.view === 'game' && !state.minimized && !state.clientPanelOpen;
}

function tickGif() {
  gifTimer = null;
  if (!gifOn() || !avatarTarget) return;

  if (!gifWanted()) {
    // Pausado: se vuelve a mirar cada tanto en vez de dejar de existir.
    gifTimer = setTimeout(() => safe(tickGif), 250);
    return;
  }

  gifIndex = (gifIndex + 1) % gifDelays.length;
  const patron = gifPattern(gifIndex);
  // Esto es TODO el costo por cuadro de animación: una asignación.
  if (patron) avatarTarget.obj[avatarTarget.prop] = patron;
  gifTimer = setTimeout(() => safe(tickGif), gifDelays[gifIndex] || 100);
}


/** Number corto y estable a partir de la ruta: sirve de versión para la caché. */
function hashOf(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/* ── Cuando el host te cambia el avatar ──────────────────────────────────────
 *
 * Muchas salas tienen scripts que le ponen un avatar temporal a los jugadores
 * (el número de pick, un ⚽ al que hizo el gol, una marca del equipo). Con eso
 * puesto, el texto que llega al canvas ya no es el tuyo y la imagen se caía
 * hasta que el host lo soltaba.
 *
 * Se puede arreglar porque en `game-min.js` el avatar del jugador son DOS
 * campos, y el del host gana:
 *
 *     A(a,b){ ... let d = null != a.Sd ? a.Sd : a.Zb ...   // Sd = el del host
 *             ... this.sr(this.Zf) }                        // Zb = el tuyo
 *
 * Al hook sólo le llega el texto ya elegido, así que por texto no hay forma de
 * distinguirlos. Pero la textura sí se puede: cada jugador tiene SU PROPIO
 * canvas de 64×64, creado una sola vez en el constructor de su renderer —
 *
 *     let a=window.document.createElement("canvas");
 *     a.width=64; a.height=64; this.Kb=a.getContext("2d",null);
 *
 * — y ese objeto no cambia en toda la partida. Así que la primera vez que se
 * reconoce tu avatar por texto se recuerda EL CANVAS, y de ahí en más ése es
 * tu disco, diga lo que diga el texto.
 *
 * Si otro jugador usa exactamente tu mismo avatar de texto, la marca se pasa a
 * su canvas: es la misma limitación que ya tenía el mecanismo por texto, y es
 * sólo cosmético y local.
 */
let myTextureCanvas = null;

/** El canvas de tu disco deja de valer cuando se recarga el juego. */
function forgetMyTexture() {
  myTextureCanvas = null;
}

/* ------------------------------------------------------------------ *
 * 5 · Quién hizo el gol
 * ------------------------------------------------------------------ *
 * HaxBall no dice el autor por ningún lado: el chat canta "Red Scores!" y el
 * marcador sube, nada más. El autor hay que deducirlo, y para eso hace falta
 * saber dónde está la pelota y dónde está cada jugador en cada cuadro.
 *
 * Ese estado lo publica el parche del bundle: llama a `window.__tvmTick(sala)`
 * una vez por cuadro dentro del dibujo del minimapa, y deja en `window.__tvmF`
 * los nombres minificados de los campos que hacen falta. Ver `game-patch.js`.
 *
 * Con eso el cálculo es el clásico: el último que tocó la pelota hizo el gol, y
 * el anterior —si es del mismo equipo, es otro jugador y tocó hace poco— dio la
 * asistencia. Si el último toque es de un jugador del equipo contrario al que
 * sumó, es gol en contra y no lleva asistencia.
 *
 * ── El reloj es el de la PARTIDA, no el de la pared ─────────────────────────
 *
 * En un replay a 8x, siete segundos de partido pasan en menos de uno real. Si
 * la ventana de asistencia se midiera con `Date.now()`, a velocidad alta
 * entrarían pases de hace media cancha y a 0.25x no entraría ninguno. Por eso
 * el tiempo se acumula multiplicado por la velocidad del reproductor, que el
 * mismo parche publica en `window.__tvmReplay`.
 */

/** Cuánto tiempo de partido puede haber pasado entre la asistencia y el gol. */
const ASSIST_WINDOW_MS = 8000;

/** Tras un gol no se cuentan toques: el saque del medio no es un pase. */
const GOAL_GRACE_MS = 3000;

/** El mismo jugador pegado a la pelota es UN toque, no sesenta por segundo. */
const TOUCH_REPEAT_MS = 400;

/**
 * Margen sobre la suma de radios para dar un toque por bueno.
 *
 * Era 3 px, y de ahí salía la mitad de las atribuciones equivocadas: con ese
 * margen "estar cerca" contaba como tocar, así que el arquero parado al lado se
 * llevaba el gol de un tiro que nunca tocó. Ahora los radios se tienen que estar
 * pisando de verdad, y las patadas —que son casi todos los goles— ya no dependen
 * de esto: las canta el motor (ver `installKickHook`).
 */
const TOUCH_SLACK = 1.5;

/* ── Que el contacto haya sido un golpe de verdad ───────────────────────── *
 *
 * Estar pegado a la pelota no es tocarla, y con la extrapolación puesta esa
 * diferencia importa: el cliente simula hacia adelante para tapar el ping, así
 * que lo que se ve va adelantado y un jugador puede aparecer pisando la pelota
 * sin haberla tocado nunca. De ahí salían los toques inventados —amagar pegado
 * a la pelota contaba como toque— y con ellos goles y asistencias mal dadas.
 *
 * La cercanía sola no alcanza, entonces: además tiene que haberle pasado algo a
 * la pelota. La fricción la frena y NUNCA la desvía, así que si acelera o
 * cambia de rumbo, alguien la golpeó. Un amague no la mueve, y deja de contar.
 *
 * Los rebotes contra las paredes y los postes también la desvían, pero eso no
 * ensucia nada: el toque se le adjudica igual a un jugador en contacto, y con
 * la pared no hay nadie en contacto.
 */

/** Por debajo de esto está quieta y no hay rumbo que comparar (px por ms). */
const BALL_STILL = 0.02;
/** Cuánto tiene que acelerar para ser un golpe y no ruido de la medición. */
const BALL_SPEED_JUMP = 1.15;
/** Coseno del giro que tiene que dar el rumbo para contar como golpe (~20°). */
const BALL_TURN_COS = 0.94;

/** La memoria de la pelota, para poder comparar contra el cuadro anterior. */
function newBallMemory() {
  return { x: 0, y: 0, vx: 0, vy: 0, seen: false };
}

/**
 * ¿La pelota acaba de recibir un golpe?
 *
 * La velocidad se saca de las posiciones de dos cuadros seguidos, así que no
 * hace falta que el parche capture ningún campo nuevo. `advanced` son los
 * milisegundos de PARTIDO entre los dos, que es el reloj con el que se mueve la
 * pelota (en un replay a 8x, un cuadro son ocho milisegundos de partido).
 *
 * Hay que llamarla en TODOS los cuadros, incluso cuando el resultado se va a
 * descartar: si se saltea alguno, la velocidad anterior queda vieja y la
 * comparación siguiente compara contra cualquier cosa.
 */
/** La posición de la pelota, o null. La pelota es siempre el disco 0. */
function ballPos(f, match) {
  const world = match && match[f.world];
  const discs = world && world[f.discs];
  const ball = discs && discs[0];
  return (ball && ball[f.pos]) || null;
}

function ballWasHit(into, f, match, advanced) {
  const at = ballPos(f, match);
  if (!at) return false;

  const memory = into.ball;

  // Primer cuadro, o un salto en la barra de tiempo del replay: se toma la
  // posición como punto de partida y recién el próximo cuadro puede opinar.
  if (!memory.seen || !(advanced > 0)) {
    memory.x = at.x;
    memory.y = at.y;
    memory.vx = 0;
    memory.vy = 0;
    memory.seen = true;
    return false;
  }

  const vx = (at.x - memory.x) / advanced;
  const vy = (at.y - memory.y) / advanced;
  const wasVx = memory.vx;
  const wasVy = memory.vy;

  memory.x = at.x;
  memory.y = at.y;
  memory.vx = vx;
  memory.vy = vy;

  const before = Math.sqrt(wasVx * wasVx + wasVy * wasVy);
  const now = Math.sqrt(vx * vx + vy * vy);

  // Quieta y sigue quieta: no hay nada que mirar.
  if (before < BALL_STILL && now < BALL_STILL) return false;

  // Aceleró. Sola no puede: la fricción sólo la frena.
  if (now > before * BALL_SPEED_JUMP + BALL_STILL) return true;

  // Cambió de rumbo. La fricción tampoco la dobla.
  if (before >= BALL_STILL && now >= BALL_STILL) {
    const aligned = (wasVx * vx + wasVy * vy) / (before * now);
    if (aligned < BALL_TURN_COS) return true;
  }

  return false;
}

/** Radios de fábrica, por si el parche no pudo capturar el campo del radio. */
const DEFAULT_PLAYER_RADIUS = 15;
const DEFAULT_BALL_RADIUS = 10;

const tracker = {
  /** Los nombres de campo que dejó el parche, o null si no entró. */
  fields: null,
  /** Milisegundos de PARTIDO acumulados. Base de todas las ventanas. */
  clock: 0,
  lastAt: 0,
  /** Últimos toques, del más viejo al más nuevo: `{ name, team, at }`. */
  touches: [],
  /** Dónde y cómo venía la pelota, para saber si un contacto la movió. */
  ball: newBallMemory(),
  /** Hasta cuándo (en reloj de partido) se ignoran los toques. */
  quietUntil: 0,
  /**
   * El objeto de la partida que estamos siguiendo.
   *
   * Se guarda el objeto y no un `boolean`: HaxBall arma uno nuevo por partido, y
   * mirar sólo si hay o no hay partido no alcanza. Entre un partido y el
   * siguiente el anterior queda en null un ratito, y a 8x ese hueco puede caer
   * entero entre dos cuadros dibujados — el resumen seguía sumando goles del
   * partido nuevo abajo de los del viejo. Comparando la identidad, un partido
   * nuevo se nota aunque no hayamos visto el hueco.
   */
  match: null,
  /** La sala a la que ya se le enganchó la patada. */
  room: null,
  /** La ficha del partido: posesión, pases, distancia y remates. */
  card: newCard()
};

/* ------------------------------------------------------------------ *
 * La ficha del partido
 * ------------------------------------------------------------------ *
 * Todo esto sale del tick que ya corría: no hace falta capturar ni un campo
 * nuevo del bundle. Son cuatro cuentas por cuadro y ninguna asigna memoria en
 * el camino caliente — los Map se llenan una vez por jugador, no por cuadro.
 *
 * Qué es cada cosa, porque los números tienen que poder explicarse:
 *
 *   posesión ...... milisegundos en los que la pelota "era" de ese jugador, o
 *                   sea desde que la tocó hasta que la tocó otro. Es la misma
 *                   definición que usa el fútbol de verdad.
 *   pases ......... dos toques seguidos del MISMO equipo. Si el segundo es del
 *                   rival, es pérdida. No distingue un pase buscado de un
 *                   rebote afortunado: nadie puede, ni mirándolo.
 *   distancia ..... la suma de lo que se movió el disco, cuadro a cuadro.
 *   remate ........ la velocidad de la pelota más alta que se le vio a cada uno
 *                   justo después de tocarla.
 * ------------------------------------------------------------------ */

function newCard() {
  return {
    /** nombre → { team, possession, passes, turnovers, distance, topShot, touches } */
    players: new Map(),
    /** Quién tiene la pelota ahora mismo, para cobrarle la posesión. */
    owner: null,
    /** Posición anterior de cada disco, para la distancia. */
    lastAt: new Map(),
    /** Cuántos ms de partido se contaron, para sacar porcentajes. */
    total: 0
  };
}

function cardEntry(card, name, team) {
  let e = card.players.get(name);
  if (!e) {
    e = { team, possession: 0, passes: 0, turnovers: 0, distance: 0, topShot: 0, touches: 0 };
    card.players.set(name, e);
  }
  // El equipo puede cambiar en medio del partido: vale el último.
  if (team) e.team = team;
  return e;
}

/**
 * Un toque, desde el punto de vista de la ficha.
 *
 * Lo llama `recordTouch` sólo cuando el toque es NUEVO —no en cada cuadro que
 * el jugador sigue pegado a la pelota— así que un pase es un pase y no
 * doscientos.
 */
function cardTouch(card, name, team) {
  const e = cardEntry(card, name, team);
  e.touches++;

  const antes = card.owner;
  if (antes && antes.name !== name) {
    const suyo = cardEntry(card, antes.name, antes.team);
    if (antes.team && team && antes.team === team) suyo.passes++;
    else suyo.turnovers++;
  }
  card.owner = { name, team };
}

/** La distancia recorrida y la posesión, que se cobran por cuadro. */
function cardTick(card, f, room, advanced) {
  if (!(advanced > 0)) return;
  card.total += advanced;

  if (card.owner) cardEntry(card, card.owner.name, card.owner.team).possession += advanced;

  const players = room[f.players];
  if (!players || !f.name) return;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const disc = p[f.disc];
    const at = disc && disc[f.pos];
    if (!at) continue;
    const name = String(p[f.name] || '').trim();
    if (!name) continue;

    const prev = card.lastAt.get(name);
    if (prev) {
      const dx = at.x - prev.x;
      const dy = at.y - prev.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      // Un salto grande es un saque del medio o un cambio de partido, no una
      // corrida: se descarta en vez de inflar el número.
      if (d < 60) cardEntry(card, name, teamNameOf(f, p)).distance += d;
      prev.x = at.x;
      prev.y = at.y;
    } else {
      card.lastAt.set(name, { x: at.x, y: at.y });
    }
  }
}

/** El identificador de equipo, ya canónico (ver `whoIs`). */
function teamNameOf(f, player) {
  if (!f.name || !player[f.team]) return null;
  return canonicalTeam(String(player[f.team][f.name] || ''));
}

/**
 * La ficha lista para mandar. Se ordena acá y no del otro lado: el que sabe qué
 * significa cada número es este archivo.
 */
function cardPayload(card) {
  if (!card || !card.players.size) return null;
  const total = card.total || 1;
  const filas = [];
  for (const [name, e] of card.players) {
    filas.push({
      name,
      team: e.team || null,
      possession: Math.round((e.possession / total) * 100),
      passes: e.passes,
      turnovers: e.turnovers,
      /* De unidades de cancha a metros de mentira: la cancha clásica mide 840
         de ancho y se la trata como 100 m, que es lo que hace que el número se
         pueda leer («corrió 2,1 km») en vez de ser un entero sin unidad. */
      distance: Math.round((e.distance / 8.4) / 10) * 10,
      topShot: Math.round(e.topShot),
      touches: e.touches
    });
  }
  filas.sort((a, b) => b.possession - a.possession || b.touches - a.touches);

  const equipos = { Red: 0, Blue: 0 };
  for (const fila of filas) if (fila.team && equipos[fila.team] !== undefined) equipos[fila.team] += fila.possession;

  return { players: filas.slice(0, 12), teams: equipos, seconds: Math.round(total / 1000) };
}

function resetTracker() {
  tracker.clock = 0;
  tracker.lastAt = 0;
  tracker.touches.length = 0;
  tracker.ball = newBallMemory();
  tracker.quietUntil = 0;
  tracker.match = null;
  /* La estela es de ESTE partido. Sin esto, el primer cuadro del siguiente
     arrancaba con una raya cruzando la cancha desde donde había quedado la
     pelota en el anterior. */
  resetTrail();
  resetHeat();
  resetFreeCam();
  tracker.card = newCard();
}

/** ¿Está el reproductor de replays andando y a qué velocidad? */
function replaySpeed(view) {
  if (state.view !== 'replay') return 1;
  const control = view && view.__tvmReplay;
  if (!control) return 1;
  return control.playing ? Number(control.speed) || 0 : 0;
}

/**
 * Engancha el motor a la ventana del juego. Es idempotente: `__tvmTick` se
 * pisa con la misma función en cada documento nuevo.
 *
 * Los nombres de campo NO se leen acá: este documento aparece antes de que se
 * cargue el bundle, así que `__tvmF` todavía no existe. Se resuelven en el
 * primer cuadro, que por definición ya es después.
 */
function installTracking(view) {
  if (!view) return;

  /*
   * Los dos sonidos propios, colgados donde el juego reproduce los suyos.
   *
   * El bundle parcheado los consulta justo antes de sonar: si contestan que ya
   * sonó lo del jugador, se saltea el de fábrica; si contestan que no, suena
   * HaxBall como siempre (ver `patchSounds` en `game-patch.js`). Por eso no hay
   * que callar nada por afuera ni adivinar cuándo fue la patada: es el propio
   * juego el que avisa, en el mismo instante y las mismas veces.
   */
  view.__tvmKick = (player, room) => {
    // El motor habló: el parche de sonidos está puesto en este documento. Ver
    // `engineSaidGoal`.
    soundHookSeen = true;
    // La patada confirmada, una sola vez: de acá sale el autor del gol. Ver
    // «Los toques, sobre la simulación de verdad». Si la sala se instaló antes
    // de que este documento se viera (entrar por un enlace es rápido), el primer
    // aviso la adopta: `this` en el bundle es justamente la sala real.
    if (room && !real.room) view.__tvmRoom(room);
    if (player && room && room === real.room && realActive()) {
      try { realKick(view, player); } catch { /* un toque perdido no apaga el sonido */ }
    }
    return playHitSound();
  };

  /*
   * La sala de verdad. La publica el bundle cuando le instala sus avisos, que
   * es exactamente la sala confirmada: la que se dibuja es una copia (ver
   * SOUND_SITE en game-patch.js).
   */
  view.__tvmRoom = (room) => {
    try {
      adoptRealRoom(view, room);
    } catch (err) {
      dropRealRoom();
      log('error', `no se pudo seguir la sala real: ${err && err.message ? err.message : err}`, 'juego');
    }
  };

  /*
   * El código de la sala, dicho por HaxBall al entrar (invitado) o cuando el
   * servidor se lo asigna (host). Ver ROOM_LINK_SITE en game-patch.js y
   * `reportRoomInfo`: es lo que hace que te reconozcan los que entraron a la
   * misma sala por otro camino.
   */
  state.roomToken = null;
  view.__tvmRoomLink = (id) => {
    const code = typeof id === 'string' ? id.trim() : '';
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(code) || code === state.roomToken) return;
    state.roomToken = code;
    // El host lo recibe con la sala ya a la vista: se vuelve a contar.
    if (state.view === 'room' || state.view === 'game') safe(reportRoomInfo, state.view);
  };
  /*
   * El gol dispara además el destello y el sacudón. Va acá y no en el
   * observador del marcador porque este punto es el gol de VERDAD —es donde el
   * juego hace sonar el suyo— mientras que el marcador del DOM sube y baja
   * cuando la extrapolación se equivoca, y un sacudón fantasma es peor que no
   * tener sacudón. El valor que se devuelve no cambia: sigue siendo «¿sonó lo
   * del jugador?», que es lo que el bundle consulta para saltear el suyo.
   */
  view.__tvmGoal = (team, room) => {
    soundHookSeen = true;
    engineGoalAt = Date.now();
    /*
     * El gol confirmado, con el equipo que lo dice el motor. Se resuelve el
     * autor ACÁ, en el mismo paso de física en que la pelota cruzó la línea, así
     * que la lista de toques está exactamente como tiene que estar: ni un toque
     * de más de la predicción ni uno de menos por no haberse dibujado.
     */
    let scored = null;
    if (room && !real.room) view.__tvmRoom(room);
    if (room && room === real.room && realActive()) {
      try { scored = realGoal(view, team, room); } catch (err) {
        log('error', `no se pudo anotar el gol: ${err && err.message ? err.message : err}`, 'juego');
      }
    }
    // El destello ya sabe de qué color va, sin esperar al marcador del DOM.
    if (scored) noteGoalTeam(scored);
    try { goalImpact(); } catch (e) {}
    try { if (state.config.pitch && state.config.pitch.netRipple) netRipple.trigger(); } catch (e) {}
    return playGoalSound();
  };

  resetTracker();
  tracker.fields = null;
  // Documento nuevo, sala nueva: hay que volver a engancharle la patada.
  tracker.room = null;
  dropRealRoom();
  warnedNoPatch = false;
  // Documento nuevo: el parche de sonidos hay que volver a verlo entrar, y el
  // último gol del motor es de una partida que ya no está.
  soundHookSeen = false;
  engineGoalAt = 0;

  /*
   * Guarda propia y no `safe()`: esto corre doscientas veces por segundo dentro
   * del dibujo del juego, y `safe` manda un log por IPC en cada error. Un fallo
   * repetido ahí no sería un aviso, sería una inundación que se lleva puesto el
   * hilo que justamente estamos cuidando. Al primer error se avisa y el motor se
   * apaga hasta la próxima carga.
   */
  let broken = false;
  view.__tvmTick = (room) => {
    if (broken) return;
    try {
      onGameTick(view, room);
    } catch (err) {
      broken = true;
      log('error', `el motor de estadísticas se apagó: ${err && err.message ? err.message : err}`, 'juego');
    }
  };

  resetTrail();
  resetHeat();
  resetFreeCam();
  resetMirror();

  /* Lo consulta el PRELUDE una vez por cuadro para correr la vista. */
  view.__tvmCam = (cam, zoom, canvas) => camOffset(cam, zoom, canvas);

  /*
   * El espejo, que el PRELUDE pregunta antes de dibujar nada. No lleva guarda
   * propia: del otro lado ya viene envuelto en un `try` que, ante cualquier
   * error, dibuja el cuadro derecho y sigue.
   */
  view.__tvmWantMirror = (renderer) => wantMirror(renderer);

  /*
   * El pincel. Mismo trato que el tick y por la misma razón: corre adentro del
   * dibujo, así que se apaga solo al primer error en vez de tirar un log por
   * cuadro. Apagar el pincel deja el juego intacto — lo único que se pierde son
   * los adornos.
   */
  let brushBroken = false;
  view.__tvmPaint = (ctx, renderer, zoom) => {
    if (brushBroken) return;
    try {
      paintPitch(ctx, renderer, zoom);
    } catch (err) {
      brushBroken = true;
      log('error', `las ayudas de cancha se apagaron: ${err && err.message ? err.message : err}`, 'juego');
    }
  };

  /*
   * El color de la cancha. Se apaga solo al primer error, igual que el pincel:
   * un adorno no puede dejar la cancha sin dibujar.
   */
  let skinBroken = false;
  view.__tvmSkin = (ctx, w, h, stadium) => {
    currentStadium = stadium;
    if (skinBroken) return;
    try {
      skinPitch(ctx, w, h, stadium);
    } catch (err) {
      skinBroken = true;
      log('error', `el color de cancha se apagó: ${err && err.message ? err.message : err}`, 'juego');
    }
  };
}

/* ------------------------------------------------------------------ *
 * El color de la cancha
 * ------------------------------------------------------------------ *
 * Repintar la cancha no es pintarle un color encima. Un color encima tapa: se
 * van las líneas, el círculo del medio y el sombreado, y queda una alfombra
 * lisa que no se parece a una cancha.
 *
 * Lo que se usa acá es el modo de fusión `color`, que se queda con el TONO de
 * lo que uno pinta y con la LUMINOSIDAD de lo que ya estaba. Traducido: el
 * césped cambia de color y las líneas siguen siendo más claras que el césped,
 * las sombras siguen siendo sombras y el afuera sigue siendo más oscuro que el
 * adentro. Es el mismo recurso con el que se colorea una foto en blanco y
 * negro, y es la razón de que esto se lea como otra cancha y no como un filtro.
 *
 * Dónde corre importa tanto como qué hace: lo llama el PRELUDE justo después de
 * dibujar el estadio y ADENTRO del camino del cache (ver `skin()` en
 * game-patch.js). En ese instante lo único pintado es la cancha —ni discos, ni
 * pelota, ni nombres—, así que se la puede tratar como una imagen entera; y
 * como el cache guarda el resultado, el costo se paga una vez por invalidación
 * y no una vez por cuadro.
 *
 * Es local y sólo lo ve quien lo puso, igual que la imagen de la pelota: nada
 * de esto viaja a la sala. Y no cambia lo que se puede ver —las líneas siguen
 * donde estaban y con el mismo contraste relativo—, así que no toca la regla de
 * la casa que está escrita más abajo.
 * ------------------------------------------------------------------ */

/**
 * El color elegido, ya resuelto. `null` = no hay nada que hacer.
 *
 * `theme` no usa el acento pelado: el acento es un violeta saturado pensado
 * para botones, y una cancha entera de ese color es ilegible. Se lo lleva hacia
 * el fondo del tema, que es lo que le da el aire de la app sin gritar.
 */
function pitchSkinColor() {
  const skin = (state.config.pitch && state.config.pitch.skin) || {};
  if (skin.mode === 'custom') return skin.color || null;
  if (skin.mode !== 'theme') return null;
  const palette = currentPalette();
  if (!palette || !palette.accent) return null;
  return themes.mix(palette.accent, palette.bg, 0.55);
}

/**
 * El color de afuera de la cancha.
 *
 * Vacío quiere decir «el mismo que el campo», que es lo que viene puesto: con
 * un solo tono para todo, el afuera igual queda más oscuro que el césped porque
 * la fusión respeta su luminosidad, y eso ya se ve bien. Elegirlo aparte es
 * para el que quiere el contraste fuerte —campo verde, borde negro— y ahí sí
 * hace falta decirlo.
 *
 * Con el tema puesto se usa el fondo del tema, que es exactamente lo que rodea
 * al resto de la app: la cancha queda embebida en el cliente.
 */
function pitchOutsideColor(field) {
  const skin = (state.config.pitch && state.config.pitch.skin) || {};
  if (skin.mode === 'theme') {
    const palette = currentPalette();
    return (palette && palette.bg) || field;
  }
  if (skin.mode !== 'custom') return null;
  return skin.outside || field;
}

/**
 * Repinta la cancha recién dibujada. Ver el bloque de arriba.
 *
 * @param {CanvasRenderingContext2D} ctx  el contexto donde acaba de quedar la cancha
 * @param {number} w  ancho en píxeles de esa superficie
 * @param {number} h  alto en píxeles
 */
function skinPitch(ctx, w, h, stadium) {
  if (!(w > 0) || !(h > 0)) return;

  const skin = (state.config.pitch && state.config.pitch.skin) || {};

  /*
   * El modo manda sobre TODO, y esto es un arreglo.
   *
   * La luz y las franjas se leían sueltas de la config, sin mirar el modo. Como
   * las canchas listas dejan puestos los dos —«Carbón» baja la luz y pone
   * catorce franjas—, elegir «como viene HaxBall» después de haber probado una
   * dejaba la cancha oscura y rayada: apagaba el color y nada más. Los valores
   * se guardan igual, para que volver a prenderlo te devuelva lo que tenías.
   */
  if (skin.mode !== 'theme' && skin.mode !== 'custom') return;

  const field = pitchSkinColor();
  const outside = pitchOutsideColor(field);
  const brightness = clampNum(skin.brightness, -0.6, 0.6, 0);
  const stripes = Math.round(clampNum(skin.stripes, 0, 24, 0));
  if (!field && !outside && !brightness && !stripes) return;

  const strength = clampNum(skin.strength, 0, 1, 0.8);
  /*
   * El contexto llega con la transformación de mundo puesta: es la que usó el
   * juego para dibujar, y la única forma de saber dónde cae la cancha adentro de
   * esta superficie. Se guarda antes de tocar nada. El `save`/`restore` de
   * afuera los pone el PRELUDE.
   */
  const world = ctx.getTransform();
  const bounds = pitchBounds(stadium);

  /* ── El campo y el afuera ───────────────────────────────────────────
     Con medidas y dos colores distintos, cada zona va por su lado. Sin
     medidas —un estadio con un fondo que no reconocemos— se pinta todo de
     una: es exactamente lo que hacía antes de saber dónde termina la cancha,
     así que se pierde la separación y no la función. */
  if (bounds && outside !== field) {
    if (field) tintRegion(ctx, w, h, world, bounds, 'in', field, strength);
    if (outside) tintRegion(ctx, w, h, world, bounds, 'out', outside, strength);
  } else if (field) {
    tintRegion(ctx, w, h, world, null, 'all', field, strength);
  }

  if (stripes && bounds) paintStripes(ctx, w, h, world, bounds, stripes);

  /*
   * Oscurecer o aclarar va último y sobre todo, con `multiply` y `screen`, que
   * son las dos que respetan lo que hay debajo: multiplicar por un gris apaga
   * sin ensuciar y `screen` levanta sin lavar. Un negro o un blanco con alfa por
   * encima haría lo mismo de lejos y aplastaría el contraste de las líneas, que
   * es justo lo que no se quiere perder.
   */
  if (brightness) {
    const level = Math.round(255 * (1 - Math.abs(brightness)));
    const gray = brightness < 0 ? level : 255 - level;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = brightness < 0 ? 'multiply' : 'screen';
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/**
 * Las medidas de la cancha, en coordenadas de cancha. `null` si el parche no
 * las pudo capturar o si el estadio no tiene fondo dibujado (`bgType` 0), que
 * es donde no hay ningún borde que respetar.
 */
function pitchBounds(stadium) {
  const f = tracker.fields && tracker.fields.pitch;
  if (!f || !stadium) return null;
  const halfW = Number(stadium[f.halfW]);
  const halfH = Number(stadium[f.halfH]);
  if (!(halfW > 0) || !(halfH > 0)) return null;
  if (!Number(stadium[f.bgType])) return null;
  return { halfW, halfH, corner: Math.max(0, Number(stadium[f.corner]) || 0) };
}

/**
 * Tiñe una zona: adentro de la cancha, afuera, o todo.
 *
 * El recorte se arma en coordenadas de CANCHA —que es donde se conocen las
 * medidas— y el relleno se hace en píxeles: un recorte sigue puesto aunque
 * después se cambie la transformación, así que se puede pintar la superficie
 * entera y dejar que el recorte decida qué queda.
 *
 * El afuera se recorta con la regla par-impar: se dibuja todo lo visible y
 * encima el rectángulo de la cancha, y con esa regla el segundo agujerea al
 * primero. Sale más barato y más exacto que pintar cuatro franjas alrededor.
 */
function tintRegion(ctx, w, h, world, bounds, region, color, alpha) {
  ctx.save();
  try {
    if (bounds) {
      ctx.setTransform(world);
      const view = worldView(world, w, h);
      ctx.beginPath();
      if (region === 'out') ctx.rect(view.x, view.y, view.w, view.h);
      roundedRect(ctx, -bounds.halfW, -bounds.halfH, 2 * bounds.halfW, 2 * bounds.halfH, bounds.corner);
      ctx.clip('evenodd');
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'color';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  } finally {
    ctx.restore();
  }
}

/**
 * Las franjas del césped recién cortado.
 *
 * Van en coordenadas de cancha y no de pantalla, que es lo que hace que se
 * queden quietas cuando la cámara se mueve: si se dibujaran por píxel, nadarían
 * sobre el campo en cada movimiento.
 *
 * El tono se elige mirando la cancha en vez de suponerlo. Sobre un césped claro
 * una franja más oscura se lee y una más clara desaparece; sobre una cancha
 * nocturna es al revés. Se lee UN píxel del centro del campo —una sola vez por
 * invalidación del cache— y se decide con eso.
 */
function paintStripes(ctx, w, h, world, bounds, count) {
  ctx.save();
  try {
    ctx.setTransform(world);
    ctx.beginPath();
    roundedRect(ctx, -bounds.halfW, -bounds.halfH, 2 * bounds.halfW, 2 * bounds.halfH, bounds.corner);
    ctx.clip();

    const dark = isLightAt(ctx, world, w, h);
    ctx.globalCompositeOperation = dark ? 'multiply' : 'screen';
    ctx.globalAlpha = 1;
    ctx.fillStyle = dark ? 'rgb(240,240,240)' : 'rgb(26,26,26)';

    const band = (2 * bounds.halfW) / count;
    // De dos en dos: se pintan las pares y las impares quedan como estaban, que
    // es lo que hace la diferencia entre una franja y la de al lado.
    for (let i = 0; i < count; i += 2) {
      ctx.fillRect(-bounds.halfW + i * band, -bounds.halfH, band, 2 * bounds.halfH);
    }
  } finally {
    ctx.restore();
  }
}

/** ¿El centro de la cancha es claro? Un píxel alcanza y se lee una sola vez. */
function isLightAt(ctx, world, w, h) {
  try {
    // El centro de la cancha es el origen del mundo, y en la matriz eso son
    // directamente los dos desplazamientos.
    const x = Math.round(world.e);
    const y = Math.round(world.f);
    if (x < 0 || y < 0 || x >= w || y >= h) return true;
    const px = ctx.getImageData(x, y, 1, 1).data;
    // Luminosidad percibida, no el promedio: el verde pesa mucho más que el
    // azul para el ojo, y una cancha es justamente verde.
    return (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) > 110;
  } catch {
    return true; // un canvas que no se puede leer no puede apagar las franjas
  }
}

/** Lo que se ve, en coordenadas de cancha. Se invierte la transformación. */
function worldView(m, w, h) {
  const det = m.a * m.d - m.b * m.c;
  if (!det) return { x: -1e5, y: -1e5, w: 2e5, h: 2e5 };
  const at = (x, y) => ({
    x: (m.d * (x - m.e) - m.c * (y - m.f)) / det,
    y: (m.a * (y - m.f) - m.b * (x - m.e)) / det
  });
  const a = at(0, 0);
  const b = at(w, h);
  // Un margen: el cache se dibuja más grande que la ventana a propósito.
  const pad = Math.abs(b.x - a.x) * 0.25 + 200;
  return {
    x: Math.min(a.x, b.x) - pad,
    y: Math.min(a.y, b.y) - pad,
    w: Math.abs(b.x - a.x) + 2 * pad,
    h: Math.abs(b.y - a.y) + 2 * pad
  };
}

/**
 * Rectángulo con esquinas redondeadas. A mano y no con `ctx.roundRect`, que es
 * de Chrome 99 y este cliente corre sobre Chromium 91 (ver `applyBootFlags`).
 */
function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (!radius) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/**
 * Huella de todo lo que decide cómo queda pintada la cancha: los ajustes y el
 * color que sale del tema. Si esto cambia, el cache del estadio ya no sirve.
 */
function pitchSkinPrint() {
  const skin = (state.config.pitch && state.config.pitch.skin) || {};
  const field = pitchSkinColor();
  return `${skin.mode}|${field}|${pitchOutsideColor(field)}|${skin.strength}|${skin.brightness}|${skin.stripes}`;
}

/** Le tira el cache al estadio para que se vuelva a dibujar con el color nuevo. */
function flushStadiumCache(view) {
  if (view && typeof view.__tvmStadiumFlush === 'function') view.__tvmStadiumFlush();
}

/** Un número de la config, acotado y con respaldo. Entra de afuera. */
function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ------------------------------------------------------------------ *
 * Lo que el cliente dibuja sobre la cancha
 * ------------------------------------------------------------------ *
 * Todo esto se pinta desde `__tvmPaint`, al que llama el PRELUDE del parche
 * justo después de poner la cancha y justo antes de los discos. O sea que va
 * en coordenadas de cancha —los mismos números que usa el motor, sin convertir
 * nada— y por debajo de los jugadores, que es lo que hace que se lea como
 * parte del piso y no como una calcomanía encima.
 *
 * ── Regla de la casa ───────────────────────────────────────────────────
 *
 * Nada de acá adivina el futuro. La estela dice por dónde ESTUVO la pelota,
 * el aro dice cuál disco sos vos, los aros de equipo repiten con una forma lo
 * que el color ya dice. Un rival con HaxBall pelado tiene toda esa información
 * en pantalla en el mismo instante: lo único que cambia es cuánto cuesta
 * leerla. Lo que sí sería ventaja —dónde va a picar la pelota— no está y no va
 * a estar.
 *
 * ── Coste por cuadro ───────────────────────────────────────────────────
 *
 * Esto corre doscientas veces por segundo. Las reglas que se siguen acá:
 *
 *   · Salida temprana antes de tocar el contexto si no hay nada encendido.
 *   · Cero asignaciones: la estela es un buffer circular que se llena una vez
 *     y se pisa; no hay `push`, ni `slice`, ni objetos por muestra.
 *   · Un solo `beginPath` por cosa dibujada.
 *   · Sin sombras ni `filter`: son lo único de un canvas 2D que se paga por
 *     píxel (la misma razón por la que existe el modo Gráficos Planos).
 * ------------------------------------------------------------------ */

/** Muestras de la estela. A 60 Hz de física son ~8 segundos de pelota. */
const TRAIL_MAX = 512;

/*
 * Buffer circular plano: `x`, `y` y el reloj de partido de cada muestra en tres
 * arrays paralelos de números. Tres arrays y no uno de objetos porque un objeto
 * por muestra serían decenas de asignaciones por segundo dentro del dibujo, que
 * es exactamente lo que este archivo evita en todos lados.
 */
const trail = {
  x: new Float32Array(TRAIL_MAX),
  y: new Float32Array(TRAIL_MAX),
  at: new Float64Array(TRAIL_MAX),
  /** Dónde se escribe la próxima. */
  head: 0,
  /** Cuántas hay de verdad (hasta TRAIL_MAX). */
  count: 0
};

function resetTrail() {
  trail.head = 0;
  trail.count = 0;
}

/**
 * Una muestra de la pelota. La llama el tick, que ya tiene la posición en la
 * mano y ya corre una vez por cuadro: muestrear acá sale gratis.
 */
function recordTrail(x, y, clock) {
  trail.x[trail.head] = x;
  trail.y[trail.head] = y;
  trail.at[trail.head] = clock;
  trail.head = (trail.head + 1) % TRAIL_MAX;
  if (trail.count < TRAIL_MAX) trail.count++;
}

/** ¿Estamos mirando una grabación? Ahí las ayudas van sin límite. */
function onReplay() {
  return state.view === 'replay';
}

/**
 * Cuánta cola se dibuja, en milisegundos de partido.
 *
 * Con la estela completa encendida es todo lo que haya en el buffer — no hay a
 * quién ventajear con el camino que la pelota YA hizo, y de eso se trata mirar
 * una grabación. Si no, lo que eligió el jugador.
 */
function trailWindow(cfg) {
  if (cfg.replayFullTrail) return Infinity;
  return Math.max(60, Number(cfg.trailMs) || 320);
}

/** El acento del tema, que es con lo que se pinta tu aro. */
function pitchAccent() {
  const p = currentPalette();
  return (p && p.accent) || '#7b3fe4';
}

function paintPitch(ctx, renderer, zoom) {
  /*
   * El canvas del juego, de paso. Es lo que sacude el gol, y desde acá se sabe
   * cuál es sin salir a buscarlo por el DOM: el contexto que nos pasan es
   * literalmente el suyo. Se guarda antes de cualquier salida temprana, porque
   * el sacudón tiene que andar aunque todas las ayudas estén apagadas.
   */
  if (ctx.canvas) pitchCanvas = ctx.canvas;
  // El arrastre de la cámara libre necesita el zoom para pasar píxeles de
  // pantalla a unidades de cancha, y éste es el único lugar donde lo tenemos.
  freeCam.zoom = zoom || 1;

  const cfg = state.config.pitch;
  if (!cfg) return;

  const replay = onReplay();
  // La estela es sólo de grabaciones: ver el comentario de `replayTrail` en
  // `store.js`. La completa la implica, para que prenderla alcance.
  const wantTrail = replay && (cfg.replayTrail || cfg.replayFullTrail);
  const wantTeams = cfg.teamRings;
  const wantSelf = cfg.selfRing;
  const wantTouch = replay && cfg.replayLastTouch;
  const wantHeat = replay && cfg.replayHeatmap;
  if (!wantTrail && !wantTeams && !wantSelf && !wantTouch && !wantHeat) return;

  const f = tracker.fields;
  if (!f) return;

  /*
   * El grosor se divide por el zoom para que una línea de 2 px se vea de 2 px
   * en pantalla con la cámara cerca y con la cámara lejos. Sin esto, alejarse
   * adelgazaba todo hasta que desaparecía.
   */
  const px = 1 / (zoom || 1);

  // El mapa va primero: es el piso de todo lo demás.
  if (wantHeat) {
    const doc = ctx.canvas && ctx.canvas.ownerDocument;
    if (doc) paintHeat(ctx, doc);
  }
  if (wantTrail) paintTrail(ctx, cfg, px);
  if (wantTeams || wantSelf || wantTouch) {
    paintRings(ctx, renderer, f, px, { self: wantSelf, teams: wantTeams, touch: wantTouch });
  }
}

/**
 * La estela.
 *
 * Se recorre de la muestra más nueva hacia atrás y se corta al salir de la
 * ventana, así que una estela corta no paga por las muestras viejas que igual
 * están en el buffer. Se dibuja como UN solo trazo con `globalAlpha` bajando
 * por tramos en vez de un trazo por segmento: un trazo por segmento serían
 * quinientos `stroke()` por cuadro.
 */
function paintTrail(ctx, cfg, px) {
  if (trail.count < 2) return;

  const ventana = trailWindow(cfg);
  const ahora = trail.at[(trail.head - 1 + TRAIL_MAX) % TRAIL_MAX];

  /*
   * Primero cuántas muestras entran en la ventana, y recién después se dibuja.
   *
   * Son dos vueltas en vez de una, pero la primera es leer números de un
   * Float64Array y cortar —microsegundos— y a cambio el dibujo queda con los
   * límites resueltos de antemano. Mezclar las dos cosas en un solo bucle era
   * lo que hacía falta razonar para saber si un tramo se cortaba a la mitad.
   */
  let n = 0;
  while (n < trail.count) {
    const idx = (trail.head - 1 - n + TRAIL_MAX * 2) % TRAIL_MAX;
    if (ahora - trail.at[idx] > ventana) break;
    n++;
  }
  if (n < 2) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = pitchAccent();

  /*
   * Cuatro tramos de opacidad en vez de uno por muestra. A ojo la diferencia es
   * nula —es un degradé igual— y son cuatro `stroke()` por cuadro en vez de
   * quinientos. Cada tramo llega hasta el primer punto del siguiente para que no
   * queden huecos entre uno y otro.
   */
  const TRAMOS = 4;
  for (let tramo = 0; tramo < TRAMOS; tramo++) {
    const desde = Math.floor((n * tramo) / TRAMOS);
    const hasta = Math.min(Math.floor((n * (tramo + 1)) / TRAMOS), n - 1);
    if (hasta - desde < 1) continue;

    // El tramo 0 es la punta, o sea lo más nuevo: opaco y grueso.
    const t = tramo / TRAMOS;
    ctx.globalAlpha = 0.55 * (1 - t);
    ctx.lineWidth = (3.2 - 2.2 * t) * px;

    ctx.beginPath();
    for (let i = desde; i <= hasta; i++) {
      const idx = (trail.head - 1 - i + TRAIL_MAX * 2) % TRAIL_MAX;
      if (i === desde) ctx.moveTo(trail.x[idx], trail.y[idx]);
      else ctx.lineTo(trail.x[idx], trail.y[idx]);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/**
 * Los aros: el tuyo, los de equipo y el del último que tocó.
 *
 * `renderer.__tvmMe` lo deja el parche del jugador local (ver `patchSelf`), y
 * es el objeto del jugador, no un nombre ni un avatar: es la única forma que no
 * se confunde cuando dos jugadores se llaman igual.
 */
function paintRings(ctx, renderer, f, px, want) {
  const room = tracker.room;
  const players = room && room[f.players];
  if (!players) return;

  const yo = renderer && renderer.__tvmMe;
  const ultimo = want.touch && tracker.touches.length
    ? tracker.touches[tracker.touches.length - 1].name
    : null;

  // El trazo entra limpio pase lo que pase: el punteado del modo daltónico se
  // devuelve solo, pero esto cubre que el juego haya dejado uno puesto.
  ctx.setLineDash(EMPTY_DASH);

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const disc = p && p[f.disc];
    const at = disc && disc[f.pos];
    if (!at) continue;

    const r = (f.radius && disc[f.radius]) || DEFAULT_PLAYER_RADIUS;
    const esMio = yo != null && p === yo;

    if (want.teams && !esMio) {
      /*
       * Modo daltónico. La diferencia la hace la FORMA del trazo —lleno contra
       * punteado— y no el color, que es justamente lo que no se puede
       * distinguir. El color de la sala se respeta igual, así que para el que
       * sí lo ve no cambia nada.
       *
       * El equipo se lee del objeto y no del nombre: traducir «Red» a «Rojo»
       * ya nos rompió el conteo de goles una vez.
       */
      const equipo = p[f.team];
      const rojo = equipo && equipo[f.color] != null && esRojo(equipo[f.color]);
      ctx.beginPath();
      ctx.lineWidth = 1.8 * px;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      // Sólo el punteado toca el dash, y lo devuelve al terminar. El lleno no
      // pide nada porque el trazo entra siempre limpio: o no lo tocó nadie, o
      // lo dejó así la vuelta anterior.
      if (!rojo) {
        DASH[0] = 4 * px;
        DASH[1] = 4 * px;
        ctx.setLineDash(DASH);
      }
      ctx.arc(at.x, at.y, r + 3.2 * px, 0, TAU);
      ctx.stroke();
      if (!rojo) ctx.setLineDash(EMPTY_DASH);
    }

    /*
     * El nombre se lee suelto y no con `whoIs`, que arma un objeto: acá estamos
     * adentro del dibujo y por jugador. Y sólo se lee si de verdad hay a quién
     * marcar, o sea únicamente en un replay.
     */
    if (want.touch && ultimo && f.name && String(p[f.name] || '').trim() === ultimo) {
      ctx.beginPath();
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = 'rgba(255,214,0,0.9)';
      ctx.arc(at.x, at.y, r + 6 * px, 0, TAU);
      ctx.stroke();
    }

    if (want.self && esMio) {
      /*
       * Dos trazos y no uno: el de afuera es oscuro y el de adentro es el
       * acento. Con un solo aro del color del tema, sobre una cancha clara o
       * sobre un disco del mismo color, no se veía — y «no sé si funciona» es
       * el peor resultado posible para lo único que existe para encontrarte.
       */
      ctx.beginPath();
      ctx.lineWidth = 4.5 * px;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.arc(at.x, at.y, r + 4.5 * px, 0, TAU);
      ctx.stroke();

      ctx.beginPath();
      ctx.lineWidth = 2.6 * px;
      ctx.strokeStyle = pitchAccent();
      ctx.arc(at.x, at.y, r + 4.5 * px, 0, TAU);
      ctx.stroke();
    }
  }
}

const TAU = Math.PI * 2;
/* Reutilizados en cada cuadro: `setLineDash` recibe un array y crear uno nuevo
   por disco y por cuadro es basura para el recolector, adentro del dibujo. */
const DASH = [4, 4];
const EMPTY_DASH = [];

/**
 * ¿Este color de equipo es el rojo?
 *
 * La sala puede pintar los equipos de cualquier color, así que «rojo» acá
 * quiere decir «el que tira más al rojo que al azul». Con eso alcanza: lo único
 * que se necesita es partir a los dos equipos en dos grupos estables, no
 * nombrar el color.
 */
function esRojo(color) {
  /* El color de equipo es un entero de 32 bits: el propio bundle lo desarma con
     `(a&16711680)>>>16` para armar su `rgba(...)`. Acá alcanza con comparar el
     canal rojo contra el azul. */
  const n = Number(color) || 0;
  return ((n & 0xff0000) >>> 16) >= (n & 0xff);
}

/* ------------------------------------------------------------------ *
 * Modo espejo
 * ------------------------------------------------------------------ *
 * Elegís un lado —rojo o azul— y te ves siempre de ese lado. Cuando te toca el
 * equipo de enfrente la cancha se da vuelta entera, y con ella las teclas.
 *
 * Todo el dibujo lo hace el parche del bundle (ver «Parche 8» en
 * `game-patch.js`). Acá se decide UNA sola cosa, una vez por cuadro: si este
 * cuadro va espejado o no. El parche llama a `__tvmWantMirror` antes de dibujar
 * nada y usa la respuesta para el cuadro entero.
 *
 * ── Por qué esto NO es una ventaja ─────────────────────────────────────────
 *
 * Es una transformación de la vista y un cambio de nombre entre dos teclas. No
 * muestra un centímetro más de cancha que el estadio permita —la cámara y el
 * zoom no se tocan—, no revela nada que no estuviera en pantalla, y el input
 * que sale para el servidor es exactamente el que saldría si el jugador
 * hubiese apretado la otra tecla. Va sin restricción de rol, como el resto de
 * las ayudas de cancha.
 *
 * ── De qué lado está el rojo ───────────────────────────────────────────────
 *
 * De la izquierda. Es la convención de HaxBall y la respetan todos los estadios
 * de fábrica; los puntos de aparición son del estadio, así que un mapa hecho a
 * mano podría dar vuelta los lados y ahí el espejo elegiría al revés. No se
 * intenta adivinarlo mirando dónde están parados los jugadores: al saque del
 * medio están todos amontonados y la respuesta saldría distinta cada vez, que
 * es peor que equivocarse siempre igual.
 */

/** El lado elegido, o `null` con el modo apagado. */
function mirrorSide() {
  const raw = (state.config.pitch || {}).mirror;
  return raw === 'red' || raw === 'blue' ? raw : null;
}

/**
 * Si el cuadro que se está por dibujar va espejado.
 *
 * Se guarda para dos cosas que no pueden mirar el `window` del juego: la imagen
 * de la pelota, que se dibuja desde acá y hay que enderezar, y saber CUÁNDO
 * cambió, que es el único momento en que hay trabajo que hacer.
 */
let mirrorOn = false;

/*
 * El último objeto de equipo visto y qué equipo resultó ser.
 *
 * Sin esto, decidir el espejo costaba un `canonicalTeam()` POR CUADRO, y ése
 * normaliza con `String()`, `trim()` y `toLowerCase()` — o sea que asigna un
 * puñado de strings cortos cada vez. Doscientas veces por segundo eso es basura
 * para el recolector adentro del camino crítico del dibujo, que es exactamente
 * lo que el resto de este archivo se cuida de no hacer (ver `onGameTick`).
 *
 * HaxBall tiene un único objeto por equipo y se lo cuelga a todos sus
 * jugadores, así que comparar por identidad alcanza: mientras no te muevan de
 * equipo es un `!==` entre dos punteros y nada más. Y cuando te mueven, el
 * objeto cambia y se vuelve a resolver una sola vez.
 */
let mirrorTeamObj = null;
let mirrorTeamId = '';

/** Documento nuevo: la clase del marcador y el equipo cacheado se fueron con él. */
function resetMirror() {
  mirrorOn = false;
  mirrorTeamObj = null;
  mirrorTeamId = '';
}

/**
 * Lo consulta el parche una vez por cuadro, antes de dibujar. Ver
 * `__tvmWantMirror` en el PRELUDE de `game-patch.js`.
 *
 * `f.mirror` es el permiso del parche y no un detalle: lo publica el paso que
 * da vuelta las teclas y los nombres, así que si una actualización de HaxBall
 * rompe ese anclaje, acá se contesta que no y el modo queda apagado solo. La
 * alternativa —espejar igual— sería dejar al jugador con la vista dada vuelta y
 * los controles al derecho, que es bastante peor que no tener la función.
 */
function wantMirror(renderer) {
  let quiero = false;
  const lado = mirrorSide();
  const f = tracker.fields;

  if (lado && f && f.mirror && f.mirror.input && f.team && f.name) {
    /*
     * `__tvmMe` es el objeto del jugador local, puesto por `patchSelf`. En una
     * grabación o en la vista previa de una sala no hay «vos» y vale `null`:
     * ahí no hay lado propio que respetar y el espejo no se prende. Es también
     * lo que lo mantiene lejos de la cámara libre, que existe sólo en replays.
     */
    const yo = renderer && renderer.__tvmMe;
    const suEquipo = yo ? yo[f.team] : null;
    if (suEquipo !== mirrorTeamObj) {
      mirrorTeamObj = suEquipo;
      mirrorTeamId = suEquipo ? canonicalTeam(String(suEquipo[f.name] || '')) : '';
    }
    // De espectador tampoco: no estás de ningún lado.
    if (mirrorTeamId === 'Red') quiero = lado !== 'red';
    else if (mirrorTeamId === 'Blue') quiero = lado !== 'blue';
  }

  if (quiero !== mirrorOn) {
    mirrorOn = quiero;
    // Con `safe` y no a pelo: esto corre adentro del dibujo, pero sólo cuando
    // el espejo cambia —o sea al cambiar de equipo—, así que un log acá no
    // puede inundar nada.
    safe(onMirrorFlip, renderer, quiero);
  }
  return quiero;
}

/**
 * Lo que hay que acomodar cuando el espejo se da vuelta. Son dos cosas, y
 * ninguna la puede hacer el parche.
 */
function onMirrorFlip(renderer, on) {
  const ctx = renderer && renderer.c;
  const doc = ctx && ctx.canvas && ctx.canvas.ownerDocument;
  if (!doc) return;

  /*
   * 1. El marcador. Es HTML y no canvas, así que el espejo no lo toca: quedaba
   *    el rojo a la izquierda con el rojo jugando a la derecha, que es
   *    exactamente el dato que uno mira de reojo para ubicarse. La regla la
   *    pone `applyClientStyles`; acá sólo se prende.
   */
  if (doc.documentElement) doc.documentElement.classList.toggle('tvm-mirror', on);

  /*
   * 2. El input, si hay una tecla apretada en este momento.
   *
   *    El juego sólo manda el input cuando CAMBIA, así que si el espejo se da
   *    vuelta mientras vas corriendo, el número que el servidor tiene guardado
   *    sigue siendo el de antes y seguís yendo para el otro lado hasta que
   *    sueltes y vuelvas a apretar. Volver a llamar al método que lo arma
   *    recalcula con el espejo nuevo y, si cambió, lo manda.
   */
  const view = doc.defaultView;
  const metodo = tracker.fields && tracker.fields.mirror && tracker.fields.mirror.input;
  const sync = view && view.__tvmInputSync;
  if (sync && metodo && typeof sync[metodo] === 'function') sync[metodo]();
}

/* ------------------------------------------------------------------ *
 * Cámara libre — sólo en grabaciones
 * ------------------------------------------------------------------ *
 * En vivo esto sería la ventaja más grande que puede dar un cliente: ver la
 * cancha donde vos quieras es exactamente lo que el estadio limita con su
 * ancho máximo de vista. En una grabación no hay a quién ventajear — la jugada
 * ya pasó— así que acá sí se puede soltar la cámara.
 *
 * El desvío no pisa la cámara del juego: se lo suma el PRELUDE del parche, que
 * además lo trata como parte de la cámara para invalidar su cache. Ver
 * `__tvmCam` en `game-patch.js`.
 * ------------------------------------------------------------------ */

const freeCam = {
  x: 0,
  y: 0,
  arrastrando: false,
  desdeX: 0,
  desdeY: 0,
  baseX: 0,
  baseY: 0,
  /** El zoom del último cuadro, para pasar píxeles de pantalla a cancha. */
  zoom: 1,
  /** La cámara del juego en el último cuadro, para centrar y para el clic. */
  camX: 0,
  camY: 0,
  /** El canvas del juego, para pasar un clic a coordenadas de cancha. */
  canvas: null,
  /** El nombre del jugador que se está siguiendo, o null. */
  siguiendo: null
};

/** ¿La cámara libre está disponible ahora mismo? */
function freeCamOn() {
  return onReplay() && !!(state.config.pitch || {}).replayFreeCam;
}

function resetFreeCam() {
  freeCam.x = 0;
  freeCam.y = 0;
  freeCam.arrastrando = false;
  freeCam.siguiendo = null;
}

/**
 * El disco del jugador que estamos siguiendo, o null.
 *
 * Se guarda el NOMBRE y no el objeto: entre un partido y el siguiente de la
 * misma grabación, HaxBall arma jugadores nuevos, y guardando el objeto se
 * seguía a un fantasma que ya no se mueve.
 */
function followedDisc() {
  if (!freeCam.siguiendo) return null;
  const f = tracker.fields;
  const room = tracker.room;
  const players = f && room && room[f.players];
  if (!players || !f.name) return null;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (String(p[f.name] || '').trim() !== freeCam.siguiendo) continue;
    const disc = p[f.disc];
    return (disc && disc[f.pos]) || null;
  }
  return null;
}

/**
 * A quién le hiciste clic.
 *
 * El punto de pantalla se pasa a cancha con la misma cuenta que hace el juego
 * para dibujar, al revés: correr el origen al centro del canvas, dividir por el
 * zoom y sumar la cámara (que ya incluye el desvío nuestro).
 */
function playerAt(clientX, clientY) {
  const f = tracker.fields;
  const room = tracker.room;
  const players = f && room && room[f.players];
  const cv = freeCam.canvas;
  if (!players || !cv || !f.name) return null;

  const caja = cv.getBoundingClientRect();
  const z = freeCam.zoom || 1;
  // El centro del canvas en pantalla, en las mismas unidades que el clic.
  const mundoX = (clientX - caja.left - caja.width / 2) / z + freeCam.camX + freeCam.x;
  const mundoY = (clientY - caja.top - caja.height / 2) / z + freeCam.camY + freeCam.y;

  let mejor = null;
  let mejorDist = Infinity;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const disc = p[f.disc];
    const at = disc && disc[f.pos];
    if (!at) continue;
    const r = (f.radius && disc[f.radius]) || DEFAULT_PLAYER_RADIUS;
    const dx = at.x - mundoX;
    const dy = at.y - mundoY;
    const d = Math.sqrt(dx * dx + dy * dy);
    /*
     * El margen se divide por el zoom para que sea constante EN PANTALLA.
     * Fijo en unidades de cancha, con la cámara lejos quedaban cuatro píxeles
     * de blanco alrededor de un disco que ya era diminuto: había que acertarle
     * al centro exacto de algo que se mueve. Así son siempre ~20 px, esté la
     * cámara donde esté.
     */
    if (d > r + 20 / (freeCam.zoom || 1) || d >= mejorDist) continue;
    mejorDist = d;
    mejor = String(p[f.name] || '').trim();
  }
  return mejor;
}

/**
 * Lo que consulta el parche una vez por cuadro. Devolver `null` es "no toques
 * nada", y es lo que contesta siempre que no estemos en una grabación con la
 * cámara suelta: así el camino normal del juego queda idéntico al de antes.
 */
function camOffset(cam, zoom, canvas) {
  // Se guardan aunque la cámara libre esté apagada: el clic para elegir a quién
  // seguir los necesita, y llegan por acá una vez por cuadro.
  if (cam) { freeCam.camX = cam.x; freeCam.camY = cam.y; }
  if (zoom) freeCam.zoom = zoom;
  if (canvas && canvas.getBoundingClientRect) freeCam.canvas = canvas;

  if (!freeCamOn()) return null;

  /*
   * Siguiendo a alguien, el desvío no lo elige el mouse: es exactamente lo que
   * hay que sumarle a la cámara del juego para que ese disco quede en el
   * centro. Se recalcula por cuadro, que es lo que hace que la vista lo
   * acompañe en vez de quedarse donde estaba cuando lo elegiste.
   */
  const disco = followedDisc();
  if (disco && cam) {
    freeCam.x = disco.x - cam.x;
    freeCam.y = disco.y - cam.y;
    return freeCam;
  }

  if (!freeCam.x && !freeCam.y) return null;
  return freeCam;
}

function attachFreeCam(doc) {
  if (!doc || doc.__tvmFreeCam) return;
  doc.__tvmFreeCam = true;

  /*
   * En captura y sobre el documento: el canvas se rearma solo cuando cambia la
   * resolución, así que colgarse de él obligaría a volver a enganchar. Y todos
   * los manejadores cortan solos si no estamos en una grabación con la cámara
   * suelta, o sea que en una partida en vivo esto es una comparación y nada más.
   */
  doc.addEventListener('mousedown', (e) => {
    if (!freeCamOn() || e.button !== 0) return;
    // Sobre los controles del reproductor no: ahí el clic es del reproductor.
    if (e.target && e.target.closest && e.target.closest('.replay-controls, .game-state-view, input, button')) return;

    /*
     * Clic sobre un disco = seguirlo. Clic en el pasto = soltarlo y volver a
     * arrastrar a mano. Se resuelve acá y no en el `click` para que el arrastre
     * no arranque cuando lo que se quiso fue elegir a alguien.
     */
    const quien = playerAt(e.clientX, e.clientY);
    if (quien) {
      freeCam.siguiendo = freeCam.siguiendo === quien ? null : quien;
      notify(freeCam.siguiendo ? `Siguiendo a ${quien}` : 'Cámara suelta');
      if (!freeCam.siguiendo) { freeCam.x = 0; freeCam.y = 0; }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (freeCam.siguiendo) {
      freeCam.siguiendo = null;
      notify('Cámara suelta');
    }

    freeCam.arrastrando = true;
    freeCam.desdeX = e.clientX;
    freeCam.desdeY = e.clientY;
    freeCam.baseX = freeCam.x;
    freeCam.baseY = freeCam.y;
  }, true);

  doc.addEventListener('mousemove', (e) => {
    if (!freeCam.arrastrando) return;
    // Arrastrar gana: si venías siguiendo a alguien, lo soltás moviendo la vista.
    freeCam.siguiendo = null;
    /*
     * De píxeles de pantalla a unidades de cancha: dividir por el zoom. Sin
     * eso, con la cámara lejos la vista volaba y con la cámara cerca no se
     * movía. El signo es negativo porque arrastrar hacia la derecha tiene que
     * traer la cancha hacia la derecha, o sea correr la cámara a la izquierda.
     */
    const z = freeCam.zoom || 1;
    freeCam.x = freeCam.baseX - (e.clientX - freeCam.desdeX) / z;
    freeCam.y = freeCam.baseY - (e.clientY - freeCam.desdeY) / z;
  }, true);

  const soltar = () => { freeCam.arrastrando = false; };
  doc.addEventListener('mouseup', soltar, true);
  doc.addEventListener('mouseleave', soltar, true);

  // Doble clic vuelve a la cámara del juego. Es la salida que se prueba sola.
  doc.addEventListener('dblclick', (e) => {
    if (!freeCamOn()) return;
    resetFreeCam();
    notify('Cámara del juego');
    e.preventDefault();
  }, true);
}

/* ------------------------------------------------------------------ *
 * Mapa de calor de la pelota — sólo en grabaciones
 * ------------------------------------------------------------------ *
 * Dónde se jugó el partido. Se acumula en una grilla mientras la grabación
 * corre y se dibuja debajo de todo.
 *
 * El coste está en el lugar correcto: acumular es UNA cuenta por cuadro, y el
 * dibujo no recorre la grilla en cada cuadro sino que la vuelca a un canvas
 * aparte cada tanto y después lo estampa de una. Es el mismo truco que el cache
 * del estadio y por el mismo motivo.
 * ------------------------------------------------------------------ */

/** Lado de cada celda, en unidades de cancha. */
const HEAT_CELL = 18;
/** Cada cuánto se rehace el canvas del mapa, en milisegundos de reloj de pared. */
const HEAT_REDRAW_MS = 400;

const heat = {
  /** clave `x|y` de celda → cuántas veces pasó la pelota por ahí. */
  celdas: new Map(),
  max: 0,
  canvas: null,
  ctx: null,
  /** Esquina de la grilla dibujada, en unidades de cancha. */
  x0: 0,
  y0: 0,
  ancho: 0,
  alto: 0,
  pintadoEn: 0,
  sucio: false
};

function resetHeat() {
  heat.celdas.clear();
  heat.max = 0;
  heat.sucio = true;
  heat.pintadoEn = 0;
}

/** Una muestra de la pelota. La llama el tick, que ya tiene la posición. */
function recordHeat(x, y) {
  const cx = Math.round(x / HEAT_CELL);
  const cy = Math.round(y / HEAT_CELL);
  const clave = `${cx}|${cy}`;
  const n = (heat.celdas.get(clave) || 0) + 1;
  heat.celdas.set(clave, n);
  if (n > heat.max) heat.max = n;
  heat.sucio = true;
}

/**
 * Vuelca la grilla a su propio canvas. Corre como mucho dos veces y media por
 * segundo, nunca por cuadro.
 */
function renderHeat(doc) {
  if (!heat.celdas.size) return false;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const clave of heat.celdas.keys()) {
    const corte = clave.indexOf('|');
    const cx = +clave.slice(0, corte);
    const cy = +clave.slice(corte + 1);
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }

  const cols = maxX - minX + 1;
  const filas = maxY - minY + 1;
  if (!(cols > 0) || !(filas > 0)) return false;

  if (!heat.canvas) {
    heat.canvas = doc.createElement('canvas');
    heat.ctx = heat.canvas.getContext('2d');
  }
  if (!heat.ctx) return false;

  /*
   * Un píxel del canvas por celda: el estampado lo escala solo. Pintar el mapa
   * a resolución de cancha serían cientos de miles de píxeles para una mancha
   * que de todas formas se ve borrosa.
   */
  if (heat.canvas.width !== cols || heat.canvas.height !== filas) {
    heat.canvas.width = cols;
    heat.canvas.height = filas;
  }
  heat.ctx.clearRect(0, 0, cols, filas);

  for (const [clave, n] of heat.celdas) {
    const corte = clave.indexOf('|');
    const cx = +clave.slice(0, corte) - minX;
    const cy = +clave.slice(corte + 1) - minY;
    /* Raíz y no lineal: con lineal, las dos o tres celdas donde la pelota se
       queda quieta se llevan todo el color y el resto del mapa queda en negro. */
    const t = Math.sqrt(n / heat.max);
    heat.ctx.fillStyle = heatColor(t);
    heat.ctx.fillRect(cx, cy, 1, 1);
  }

  heat.x0 = (minX - 0.5) * HEAT_CELL;
  heat.y0 = (minY - 0.5) * HEAT_CELL;
  heat.ancho = cols * HEAT_CELL;
  heat.alto = filas * HEAT_CELL;
  heat.sucio = false;
  return true;
}

/** De frío a caliente, con la opacidad subiendo junto con el calor. */
function heatColor(t) {
  const r = Math.round(60 + 195 * t);
  const g = Math.round(90 + 90 * Math.max(0, 1 - Math.abs(t - 0.5) * 2));
  const b = Math.round(220 * (1 - t));
  return `rgba(${r},${g},${b},${0.1 + 0.42 * t})`;
}

/**
 * El mapa terminado, como imagen, para el resumen del partido.
 *
 * Va en PNG y no como lista de celdas: son ~40x25 píxeles —uno por celda— así
 * que pesa menos que el JSON de las mismas celdas, y del otro lado se muestra
 * con un `<img>` sin que nadie tenga que volver a dibujar nada.
 */
function heatImage(doc) {
  if (!heat.celdas.size) return null;
  if (!renderHeat(doc)) return null;
  try {
    return {
      url: heat.canvas.toDataURL('image/png'),
      /* La proporción de la CANCHA cubierta, para que el resumen no lo estire:
         el canvas tiene un píxel por celda y las celdas son cuadradas. */
      w: heat.ancho,
      h: heat.alto,
      muestras: heat.celdas.size
    };
  } catch (e) {
    return null;
  }
}

/**
 * Manda el mapa al resumen. Se llama al terminar el partido y ANTES de
 * `resetTracker()`, que es el que vacía la grilla.
 */
function sendHeatmap() {
  try {
    const doc = gameDocument();
    if (!doc) return;
    const img = heatImage(doc);
    const card = cardPayload(tracker.card);
    if (img || card) ipcRenderer.send('game:heatmap', { heat: img, card });
  } catch (e) {
    /* Un mapa que no se pudo armar no puede costarle el resumen a nadie. */
  }
}

function paintHeat(ctx, doc) {
  const ahora = Date.now();
  if ((heat.sucio && ahora - heat.pintadoEn > HEAT_REDRAW_MS) || !heat.canvas) {
    heat.pintadoEn = ahora;
    if (!renderHeat(doc)) return;
  }
  if (!heat.canvas || !heat.ancho) return;

  /* Suavizado puesto a propósito: el canvas tiene un píxel por celda y es el
     escalado el que convierte los cuadraditos en una mancha. */
  const antes = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(heat.canvas, heat.x0, heat.y0, heat.ancho, heat.alto);
  ctx.imageSmoothingEnabled = antes;
}

/* ------------------------------------------------------------------ *
 * El gol se siente: destello y sacudón
 * ------------------------------------------------------------------ *
 * Nada de esto pasa por el canvas. El sacudón es un `transform` sobre el
 * elemento del juego y el destello es un div encima: los dos los resuelve el
 * compositor sin pedirle un solo píxel más al hilo que está dibujando la
 * cancha, que es justo el que no hay que molestar en el momento de un gol.
 *
 * Es también la razón de que el sacudón NO mueva la cámara del juego: mover la
 * cámara invalidaría el cache del estadio (ver el PRELUDE en `game-patch.js`) y
 * lo obligaría a redibujar la cancha entera en cada cuadro del sacudón —
 * exactamente el gasto que ese cache existe para evitar.
 * ------------------------------------------------------------------ */

/** El canvas del juego. Lo deja `paintPitch`, que lo tiene en la mano. */
let pitchCanvas = null;
let flashEl = null;
let fxStyled = false;

/**
 * De qué equipo fue el último gol, y cuándo se supo.
 *
 * Lo anota el observador del marcador, que es el único que sabe el equipo. El
 * destello lo consulta y lo usa sólo si es reciente: si el marcador todavía no
 * se movió, el destello sale del color del cliente en vez de inventar un equipo.
 */
const lastGoal = { team: null, at: 0 };

function noteGoalTeam(team) {
  lastGoal.team = team;
  lastGoal.at = Date.now();
}

function ensurePitchFxStyle(doc) {
  if (fxStyled || !doc || !doc.head) return;
  fxStyled = true;
  const style = doc.createElement('style');
  style.id = 'tvm-pitch-fx';
  /*
   * Sólo `transform` y `opacity`, que son las dos que el compositor resuelve
   * solo. El sacudón son cuatro golpes que se apagan, no un temblor parejo:
   * un temblor parejo se lee como un error de render y no como un impacto.
   */
  style.textContent = `
    @keyframes tvmGoalShake {
      0%   { transform: translate3d(0,0,0); }
      12%  { transform: translate3d(-7px, 4px, 0); }
      26%  { transform: translate3d(6px, -4px, 0); }
      42%  { transform: translate3d(-4px, -2px, 0); }
      60%  { transform: translate3d(3px, 2px, 0); }
      78%  { transform: translate3d(-1px, 1px, 0); }
      100% { transform: translate3d(0,0,0); }
    }
    .tvm-shake { animation: tvmGoalShake 0.42s cubic-bezier(0.36, 0.07, 0.19, 0.97); }
    @keyframes tvmGoalFlash {
      0%   { opacity: 0; }
      14%  { opacity: 1; }
      100% { opacity: 0; }
    }
    #tvm-goal-flash {
      position: fixed; inset: 0; z-index: 2147481500;
      pointer-events: none; opacity: 0;
      display: grid; place-items: center;
      contain: layout style paint;
    }
    #tvm-goal-flash.is-on { animation: tvmGoalFlash 0.6s ease-out; }
    @keyframes tvmGoalLogo {
      0%   { opacity: 0; transform: scale(.55) rotate(-12deg); }
      22%  { opacity: 1; transform: scale(1.08) rotate(3deg); }
      42%  { opacity: .92; transform: scale(1) rotate(0); }
      100% { opacity: 0; transform: scale(1.2) rotate(4deg); }
    }
    #tvm-goal-flash img {
      width: clamp(112px, 22vmin, 256px); height: auto;
      filter: drop-shadow(0 0 16px rgb(255 255 255 / 75%)) drop-shadow(0 0 44px ${rgbaOf(goalFlashColor(), 0.9)});
      opacity: 0;
    }
    #tvm-goal-flash.is-on img { animation: tvmGoalLogo 0.72s cubic-bezier(.2,.75,.25,1) both; }
  `;
  doc.head.append(style);
}

/**
 * El color del destello.
 *
 * El del equipo que convirtió si el marcador ya lo dijo hace poco; si no, el
 * acento del cliente. Nunca se adivina el equipo: un destello rojo por un gol
 * azul es peor que un destello neutro.
 */
function goalFlashColor() {
  if (lastGoal.team && Date.now() - lastGoal.at < 600) {
    if (lastGoal.team === 'Red') return '#ff6b76';
    if (lastGoal.team === 'Blue') return '#6ba8ff';
  }
  return pitchAccent();
}

function goalImpact() {
  const cfg = state.config.pitch;
  if (!cfg) return;
  // El interruptor global de animaciones manda: si el jugador las apagó, es
  // porque quiere que nada se mueva, y esto es lo primero que sobra.
  if (!state.config.appearance.animations) return;
  if (!cfg.goalFlash && !cfg.goalShake) return;

  const doc = gameDocument();
  if (!doc || !doc.body) return;
  ensurePitchFxStyle(doc);

  if (cfg.goalShake && pitchCanvas && pitchCanvas.isConnected) {
    // Se saca y se vuelve a poner para que reinicie: dos goles seguidos con la
    // clase ya puesta no vuelven a animar nada.
    pitchCanvas.classList.remove('tvm-shake');
    void pitchCanvas.offsetWidth;
    pitchCanvas.classList.add('tvm-shake');
    setTimeout(() => {
      if (pitchCanvas) pitchCanvas.classList.remove('tvm-shake');
    }, 460);
  }

  if (cfg.goalFlash) {
    if (!flashEl || !flashEl.isConnected) {
      flashEl = doc.createElement('div');
      flashEl.id = 'tvm-goal-flash';
      flashEl.setAttribute('aria-hidden', 'true');
      const crest = doc.createElement('img');
      crest.alt = '';
      crest.src = assetUrl('crest');
      flashEl.append(crest);
      doc.body.append(flashEl);
    }
    /* Un anillo desde los bordes y no un velo parejo: un velo tapa la cancha
       justo cuando querés ver el gol. */
    flashEl.style.background =
      `radial-gradient(circle at 50% 50%, transparent 42%, ${rgbaOf(goalFlashColor(), 0.42)} 100%)`;
    flashEl.classList.remove('is-on');
    void flashEl.offsetWidth;
    flashEl.classList.add('is-on');
    setTimeout(() => {
      if (flashEl) flashEl.classList.remove('is-on');
    }, 640);
  }
}

/** Se avisa una sola vez por documento, y sólo si de verdad hacía falta. */
let warnedNoPatch = false;

/**
 * Si el parche no entró, el resumen no puede existir: hay que decirlo en vez de
 * dejar un panel vacío para siempre. Se mira al entrar a la cancha, que es
 * cuando el bundle seguro ya cargó.
 */
function checkTrackingPatch(doc) {
  const view = doc && doc.defaultView;
  if (!view || warnedNoPatch) return;
  const fields = view.__tvmF;
  if (fields && fields.game && fields.players) return;
  warnedNoPatch = true;
  log('warn', 'el parche del juego no entró: los goles quedan sin autor', 'juego');
}

/**
 * Una vez por cuadro dibujado, con la sala en la mano.
 *
 * Corre en el hilo del juego y en el camino crítico del dibujo, así que no hace
 * nada que asigne memoria: recorre los jugadores, mide distancias y sale.
 */
function onGameTick(view, room) {
  if (!room) return;

  let f = tracker.fields;
  if (!f) {
    f = view.__tvmF;
    if (!f || !f.game || !f.players) return;
    tracker.fields = f;
  }

  if (room !== tracker.room) {
    tracker.room = room;
    /*
     * Esto ya NO hace sonar nada: es sólo para las estadísticas, o sea para
     * saber quién tocó la pelota y poder darle el gol o la asistencia. El
     * sonido va por otro lado (ver `installTracking`), enganchado adentro del
     * juego, porque desde acá afuera no hay forma de distinguir una patada de
     * verdad de una que la extrapolación simuló y después deshizo.
     */
    // Con la sala real enganchada, esta copia no anota nada: sus patadas son
    // predicciones (ver «Los toques, sobre la simulación de verdad»).
    installKickHook(room, f, (player) => {
      if (!realActive()) recordTouch(tracker, f, player);
    });
  }

  /*
   * El nombre de la sala, del motor y no del DOM.
   *
   * Va ACÁ ARRIBA a propósito: unas líneas más abajo esto se vuelve si no hay
   * partido en curso, y el nombre hace falta igual —en la sala esperando es
   * justamente cuando la presencia y los escudos de la lista tienen que estar
   * puestos—. Ver ROOM_NAME_SITE en game-patch.js para por qué el DOM no sirve.
   *
   * Se compara contra la última que se vio y no se llama a `sendRoomName` de
   * una: esto corre en cada cuadro dibujado y esa función recorta la cadena
   * antes de comparar, o sea que estaría reservando memoria doscientas veces
   * por segundo para llegar siempre a la misma conclusión.
   */
  if (f.roomName) {
    const name = room[f.roomName];
    if (typeof name === 'string' && name !== engineRoomName) {
      engineRoomName = name;
      if (name) safe(sendRoomName, name);
    }
  }

  const match = room[f.game];
  if (!match) {
    // Se terminó. El resumen NO se vacía acá: al terminar un partido se quiere
    // poder mirarlo. Se vacía cuando arranca el siguiente.
    if (tracker.match) {
      tracker.match = null;
      sendHeatmap();
      ipcRenderer.send('game:match-end', { red: lastScore.red, blue: lastScore.blue });
    }
    return;
  }

  if (match !== tracker.match) {
    // Un partido nuevo cierra el anterior. Hace falta además del caso de arriba:
    // entre dos partidos seguidos el hueco puede durar un solo cuadro y caer
    // entero entre dos dibujados, y entonces el final no se ve pasar.
    if (tracker.match) { sendHeatmap(); ipcRenderer.send('game:match-end', { red: lastScore.red, blue: lastScore.blue }); }
    resetTracker();
    tracker.match = match;
    ipcRenderer.send('game:match-start');
  }

  // El reloj de partido. El tope de 100 ms tapa los saltos de un alt-tab o de
  // un salto en la barra de tiempo del replay.
  const now = Date.now();
  let advanced = 0;
  if (tracker.lastAt) {
    const elapsed = Math.min(now - tracker.lastAt, 100);
    advanced = elapsed * replaySpeed(view);
    tracker.clock += advanced;
  }
  tracker.lastAt = now;

  /*
   * Va SIEMPRE, aunque el resultado no se use: es lo que mantiene al día por
   * dónde venía la pelota. Salteándolo en los cuadros callados, la comparación
   * del cuadro siguiente arrancaría de una velocidad vieja.
   */
  // El resultado ya no decide el autor (ver abajo): se la llama por su efecto,
  // que es mantener al día por dónde y a qué velocidad venía la pelota.
  ballWasHit(tracker, f, match, advanced);

  // La ficha del partido: posesión y distancia se cobran por cuadro.
  cardTick(tracker.card, f, room, advanced);

  /*
   * La posición se lee acá y NO de `tracker.ball`, que es la memoria interna
   * del detector de golpes.
   *
   * Estaban acoplados y no tenían por qué: `ballWasHit` tiene salidas tempranas
   * —sin pelota en el mundo, o un cuadro sin tiempo transcurrido— y en algunas
   * no llega a marcar su bandera `seen`. Cuando eso pasaba, la estela y el mapa
   * dejaban de recibir muestras en silencio, para siempre, aunque la pelota
   * estuviera ahí a la vista. Ahora lo único que necesitan es que haya pelota.
   */
  const pelota = ballPos(f, match);
  if (pelota) {
    /* La estela se muestrea sólo donde se puede dibujar, que es en una
       grabación: en un partido en vivo el buffer no lo mira nadie. */
    if (onReplay()) recordTrail(pelota.x, pelota.y, tracker.clock);
    /* El mapa, en cambio, se acumula SIEMPRE —en vivo y en grabaciones— porque
       de acá sale el del resumen del partido. Lo que decide la vista es si
       además se lo dibuja sobre la cancha, que es cosa aparte. */
    recordHeat(pelota.x, pelota.y);
  }

  if (tracker.clock < tracker.quietUntil) return;

  // Los toques los cuenta la sala real, cuadro de física por cuadro de física.
  // Lo de abajo queda para cuando el bundle no la publicó.
  if (realActive()) return;

  /*
   * ═══ Rozarla es tocarla ═══
   *
   * Acá había una guarda de más: sólo se buscaba autor si la pelota había
   * CAMBIADO de rumbo o acelerado. Y eso deja afuera media docena de toques
   * reales — la roza que la desvía un pelo, la que te pega yendo, la que
   * frenás con el cuerpo. Todos son toques, y en un gol el que la rozó último
   * es el autor tanto como el que la reventó.
   *
   * La guarda no hace falta porque `nearestToucher` no mide cercanía sino
   * CONTACTO: exige que la distancia entre centros sea menor que la suma de
   * los radios más una holgura chica. Pasar cerca no entra; tocarla, sí.
   *
   * Y llevar la pelota pegada tampoco inunda la lista: `recordTouch` junta los
   * cuadros seguidos del mismo jugador en un solo toque (ver TOUCH_REPEAT_MS).
   *
   * `ballWasHit` se sigue llamando en todos los cuadros: es lo que mantiene
   * al día la velocidad de la pelota, de la que va a salir la velocidad del
   * remate. Lo que ya no hace es decidir quién la tocó.
   */
  const closest = nearestToucher(f, room, match);
  if (!closest) return;
  /*
   * Se anota el toque, pero acá NO suena nada.
   *
   * Este camino es el de la pelota tocada sin patear: un rebote, un empujón,
   * la que te pega yendo. Para el gol y la asistencia eso cuenta —el último que
   * la tocó es el autor, la haya pateado o no— pero para el oído no: el sonido
   * es el de la patada. Sonar acá lo disparaba al llevar la pelota pegada, y
   * también al falsear, porque con la extrapolación este camino ve contactos
   * que nunca pasaron. El sonido sale de `installKickHook` y de ningún otro
   * lado.
   */
  recordTouch(tracker, f, closest);
}

/**
 * Engancha el aviso de patada de la sala.
 *
 * El motor llama a este enganche cada vez que alguien le llega a la pelota con
 * la tecla apretada — lo usa para hacer sonar la patada (ver KICK_SITE en
 * `game-patch.js`). Es la única fuente exacta de "este jugador tocó la pelota":
 * pasa adentro de la física, o sea sesenta veces por segundo, y no depende de
 * qué se llegó a dibujar.
 *
 * Se ENVUELVE y no se pisa: si lo reemplazáramos, el juego se quedaría sin el
 * sonido de la patada. Y se marca la función propia para no envolverla dos veces
 * si la sala vuelve a pasar por acá.
 */
function installKickHook(room, f, onKick) {
  if (!f.kick) return false;
  const current = room[f.kick];
  if (current && current.__tvm) return true;

  const wrapped = function (player) {
    try {
      if (player) onKick(player);
    } catch { /* un toque perdido no puede tirar abajo la física */ }
    // Siempre se llama al original: es el que decide si suena el aviso de
    // fábrica o el del jugador, y esa decisión ahora vive adentro del juego.
    if (current) return current.apply(this, arguments);
  };
  wrapped.__tvm = true;
  room[f.kick] = wrapped;
  return true;
}

/**
 * El jugador que está tocando la pelota en este cuadro, o null.
 *
 * El más cerca gana: en un amontonamiento tocan varios y el que empuja es el que
 * está pegado. Sirve igual para la partida en vivo que para una grabación que se
 * simula sin dibujar, así que no toca ningún estado: recibe todo por parámetro.
 */
function nearestToucher(f, room, match) {
  const world = match[f.world];
  const discs = world && world[f.discs];
  const ball = discs && discs[0];
  const ballAt = ball && ball[f.pos];
  if (!ballAt) return null;
  const ballRadius = (f.radius && ball[f.radius]) || DEFAULT_BALL_RADIUS;

  const players = room[f.players];
  if (!players || !players.length) return null;

  let closest = null;
  let closestGap = Infinity;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const disc = player && player[f.disc];
    const at = disc && disc[f.pos];
    if (!at) continue; // espectador: no tiene disco en la cancha

    const dx = at.x - ballAt.x;
    const dy = at.y - ballAt.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const reach = ((f.radius && disc[f.radius]) || DEFAULT_PLAYER_RADIUS) + ballRadius + TOUCH_SLACK;
    if (distance > reach) continue;

    const gap = distance - reach;
    if (gap < closestGap) {
      closestGap = gap;
      closest = player;
    }
  }

  return closest;
}

/**
 * El nombre del jugador y el IDENTIFICADOR de su equipo.
 *
 * El equipo no se devuelve tal como lo guarda el juego: se pasa por
 * `canonicalTeam()`. Lo que el juego guarda es el nombre para mostrar (`fa.D`),
 * y desde que el cliente traduce HaxBall ese nombre es «Rojo» y no «Red».
 * Todo lo de acá abajo compara equipos —el gol en contra, la asistencia— y
 * comparaba contra 'Red' y 'Blue' escritos a mano: con el juego en español la
 * comparación fallaba SIEMPRE y cada gol salía marcado como en contra.
 *
 * El identificador es interno y no se muestra nunca: la interfaz lo traduce por
 * su cuenta (`stats.red` / `stats.blue`).
 */
function whoIs(f, player) {
  const name = f.name ? String(player[f.name] || '').trim() : '';
  const raw = f.name && player[f.team] ? String(player[f.team][f.name] || '') : '';
  return { name, team: canonicalTeam(raw) };
}

/**
 * Anota un toque en una lista de toques. `into` es el tracker de la partida en
 * vivo o el del análisis de una grabación: los dos llevan `clock` y `touches`.
 */
function recordTouch(into, f, player) {
  const { name, team } = whoIs(f, player);
  if (!name) return null;

  const list = into.touches;
  const last = list[list.length - 1];
  // Pegado a la pelota se dispara en cada cuadro: mientras siga siendo el
  // mismo, es el mismo toque y sólo se le corre la hora.
  if (last && last.name === name && into.clock - last.at < TOUCH_REPEAT_MS) {
    last.at = into.clock;
    return null;
  }

  list.push({ name, team, at: into.clock });
  if (list.length > 8) list.shift();

  /* La ficha sólo se entera de los toques NUEVOS —acá abajo del filtro de
     repetición— que es lo que hace que un pase sea un pase y no doscientos
     por llevar la pelota pegada. `into.card` no existe en el tracker del
     análisis de grabaciones, y por eso se pregunta. */
  if (into.card) {
    cardTouch(into.card, name, team);
    /* El remate: la velocidad que lleva la pelota justo después de que la
       tocó. En unidades de cancha por milisegundo, se pasa a km/h al
       armar la ficha. El rastreador de la sala real no trae `ball`: ése mide
       el remate cuadro a cuadro DESPUÉS del toque (ver `onRealStep`), que es
       cuando la pelota ya salió con la velocidad nueva. */
    if (into.ball) noteShotSpeed(into.card, name, team, into.ball.vx, into.ball.vy);
  }

  return { name, team };
}

/** El remate más fuerte de cada uno, en km/h. `vx`/`vy` en unidades por ms. */
function noteShotSpeed(card, name, team, vx, vy) {
  const v = Math.sqrt(vx * vx + vy * vy);
  const e = cardEntry(card, name, team);
  const kmh = v * 1000 / 8.4 * 3.6;
  if (kmh > e.topShot && kmh < 400) e.topShot = kmh;
}

/* ── Los toques, sobre la simulación de verdad ─────────────────────────── *
 *
 * Lo que llega a `__tvmTick` NO es la sala: es la copia que se dibuja. El
 * juego la arma en cada cuadro clonando el estado confirmado y simulándolo
 * hacia adelante hasta «ahora», para tapar el ping (ver SOUND_SITE en
 * game-patch.js). Contar toques sobre esa copia se equivocaba de tres formas,
 * y las tres terminaban en goles y asistencias mal dadas:
 *
 *   · La misma patada se volvía a simular en cada cuadro mientras seguía dentro
 *     de la predicción, y se anotaba intercalada con los contactos de otros:
 *     [arquero, delantero, arquero…]. Si la lista cerraba con el arquero, tu
 *     gol salía «en contra» de él.
 *   · La predicción supone que el rival sigue apretando lo que apretaba, así
 *     que le inventa patadas que nunca pasaron.
 *   · Una patada que el estado confirmado resolvía entre dos cuadros dibujados,
 *     sin que ninguna predicción la hubiera visto, no se anotaba nunca. Con el
 *     techo de cuadros puesto, o con la pestaña atrás a diez cuadros, casi
 *     ninguna — y el gol quedaba para el que había tocado antes.
 *
 * Ahora los toques salen de la sala real, que el bundle publica al instalarle
 * sus avisos: la patada del motor (una vez por patada confirmada), el paso de
 * física `Ct` (una vez por cuadro SIMULADO, para los toques que no son patada)
 * y el gol del motor, que cierra la jugada en el mismo cuadro en que la pelota
 * cruza la línea. El reloj cuenta cuadros de física, así que tampoco depende de
 * la velocidad de un replay ni de los FPS.
 *
 * Si el bundle no publicó la sala (HaxBall actualizado, copia vieja), nada de
 * esto se activa y se sigue contando como antes, sobre la copia.
 */

/** Un cuadro de física de HaxBall, en ms de partido: el motor corre a 60. */
const STEP_MS = 1000 / 60;

/**
 * El festejo del motor dura 150 cuadros (`this.zc = 150` al anotar) y recién
 * ahí se acomoda el saque del medio. Contando cuadros de verdad, el silencio
 * mide exactamente eso: ni el remate a la red durante el festejo cuenta como
 * pase, ni se pierde el primer toque del saque.
 */
const REAL_GOAL_GRACE_MS = 150 * STEP_MS;

/** Cuánto después de un toque se sigue midiendo la pelota para el remate. */
const SHOT_WINDOW_MS = 250;

/** Más que esto en un cuadro no es un remate: es un saque del medio o un salto del replay. */
const BALL_TELEPORT = 40;

const real = {
  /** La sala confirmada, o null: sin ella se cuenta sobre la copia dibujada. */
  room: null,
  /** Si ya tiene colgado el paso de física. Sin eso no hay reloj. */
  stepping: false,
  /** La partida que se está siguiendo; una distinta es un partido nuevo. */
  match: null,
  clock: 0,
  touches: [],
  quietUntil: 0,
  /** Dónde estaba la pelota al empezar el cuadro anterior. */
  ballX: 0,
  ballY: 0,
  ballSeen: false,
  /** A quién se le está midiendo el remate, y hasta cuándo. */
  shot: null,
  /** La ficha es una sola, la del partido: la que maneja `tracker`. */
  get card() { return tracker.card; }
};

function realActive() {
  return !!(real.room && real.stepping);
}

function resetRealTouches() {
  real.match = null;
  real.clock = 0;
  real.touches = [];
  real.quietUntil = 0;
  real.ballSeen = false;
  real.shot = null;
}

/** Se suelta la sala: lo que queda es el conteo de antes, sobre la copia. */
function dropRealRoom() {
  real.room = null;
  real.stepping = false;
  resetRealTouches();
}

/**
 * Engancha el paso de física a la sala real. Idempotente: el reproductor de
 * replays vuelve a instalar los avisos cada vez que se salta en la barra de
 * tiempo, y la sala es la misma.
 */
function adoptRealRoom(view, room) {
  if (!room || typeof room !== 'object') return;
  if (room !== real.room) {
    real.room = room;
    real.stepping = false;
  }
  /*
   * Sala nueva, o la misma otra vez. Lo segundo sólo pasa en un replay, al
   * terminar un salto en la barra de tiempo (`Fq` → `Gi`): lo de antes del
   * salto no tiene nada que ver con lo de después, y un toque de otro minuto no
   * puede terminar siendo la asistencia del gol que sigue.
   */
  resetRealTouches();

  const f = view.__tvmF;
  // Sin el nombre del paso no hay reloj de cuadros: se sigue como antes.
  if (!f || !f.step || !f.game || !f.players) return;

  const current = room[f.step];
  if (current && current.__tvm) {
    real.stepping = true;
    return;
  }

  /*
   * Guarda propia, igual que el tick: esto corre adentro de la física, sesenta
   * veces por segundo. Al primer error se suelta la sala y se vuelve al conteo
   * de antes, en vez de mandar un log por cuadro.
   */
  const step = function () {
    if (real.room === room && real.stepping) {
      try {
        onRealStep(view, room);
      } catch (err) {
        dropRealRoom();
        log('error', `el conteo de toques se apagó: ${err && err.message ? err.message : err}`, 'juego');
      }
    }
    // Si alguien más lo usaba (el juego web no), se le sigue llamando.
    if (typeof current === 'function') return current.apply(this, arguments);
  };
  step.__tvm = true;
  room[f.step] = step;
  real.stepping = true;
}

/**
 * Un cuadro de física de la sala real, ANTES de patadas y movimiento: las
 * posiciones son las del final del cuadro anterior, con los choques ya
 * resueltos. Dos discos que chocaron quedan exactamente tocándose, que es lo
 * que mide `nearestToucher`.
 */
function onRealStep(view, room) {
  const f = tracker.fields || view.__tvmF;
  if (!f || !f.game || !f.players) return;

  const match = room[f.game];
  if (!match) {
    real.match = null;
    return;
  }
  if (match !== real.match) {
    resetRealTouches();
    real.match = match;
  }
  real.clock += STEP_MS;

  const at = ballPos(f, match);
  if (at) {
    if (real.ballSeen && real.shot && real.clock <= real.shot.until) {
      const dx = at.x - real.ballX;
      const dy = at.y - real.ballY;
      if (Math.abs(dx) < BALL_TELEPORT && Math.abs(dy) < BALL_TELEPORT) {
        noteShotSpeed(tracker.card, real.shot.name, real.shot.team, dx / STEP_MS, dy / STEP_MS);
      }
    }
    real.ballX = at.x;
    real.ballY = at.y;
    real.ballSeen = true;
  }

  if (real.clock < real.quietUntil) return;
  const who = nearestToucher(f, room, match);
  if (who) realTouch(f, who);
}

/** Anota un toque confirmado y abre la ventana del remate. */
function realTouch(f, player) {
  recordTouch(real, f, player);
  // La ventana se renueva aunque el toque se haya juntado con el anterior:
  // conducir y rematar es el mismo toque, y lo que importa es el remate.
  const { name, team } = whoIs(f, player);
  if (name) real.shot = { name, team, until: real.clock + SHOT_WINDOW_MS };
}

/** La patada que cantó el motor, sobre la sala real. */
function realKick(view, player) {
  const f = tracker.fields || view.__tvmF;
  if (!f || !f.name) return;
  // El festejo: patear la pelota a la red después del gol no es un pase.
  if (real.clock < real.quietUntil) return;
  realTouch(f, player);
}

/**
 * El gol que cantó el motor. Devuelve el equipo que sumó ('Red'/'Blue') o null.
 *
 * El marcador sale de la partida real y no del HUD: el HUD muestra la copia, que
 * en un cliente va adelantada y en un replay atrasada un cuadro.
 */
function realGoal(view, teamObj, room) {
  const f = tracker.fields || view.__tvmF;
  if (!f || !f.name || !teamObj) return null;
  const team = canonicalTeam(String(teamObj[f.name] || ''));
  if (team !== 'Red' && team !== 'Blue') return null;

  const match = room[f.game];
  /*
   * El roce en la línea: si la pelota le pegó a alguien en el mismo cuadro en
   * que entró, el choque se resolvió en este paso y el `Ct` del siguiente ya
   * llegaría tarde. Se mira una vez más acá, con las posiciones finales.
   */
  if (match && real.clock >= real.quietUntil) {
    const last = nearestToucher(f, room, match);
    if (last) recordTouch(real, f, last);
  }

  const S = f.score;
  const score = S && match
    ? { red: Number(match[S.red]) || 0, blue: Number(match[S.blue]) || 0 }
    : null;
  const doc = gameDocument();
  const seconds = S && match ? Number(match[S.time]) : NaN;

  ipcRenderer.send('game:goal', {
    ...creditGoal(real, team, REAL_GOAL_GRACE_MS),
    clock: Number.isFinite(seconds) ? formatMatchSeconds(seconds) : matchClock(doc),
    score,
    replay: state.view === 'replay',
    speed: replaySpeed(view) || 1
  });
  return team;
}

/** «MM:SS» a partir de los segundos de partido, como lo escribe el HUD. */
function formatMatchSeconds(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Arma el gol que se le manda a la interfaz. Se llama en el momento exacto en
 * que el marcador sube, con la lista de toques todavía fresca.
 *
 * @param {'Red'|'Blue'} team el equipo que sumó
 */
function describeGoal(team, doc, score) {
  return {
    ...creditGoal(tracker, team),
    clock: matchClock(doc),
    score: score || null,
    replay: state.view === 'replay',
    // Para que el cartel de TV no se quede puesto: a 8x, cinco segundos de
    // pantalla son cuarenta de partido y taparían la jugada siguiente.
    speed: replaySpeed(gameWindow(doc)) || 1
  };
}

/**
 * La regla del autor y la asistencia, sobre una lista de toques cualquiera:
 * la de la partida en vivo o la del análisis de una grabación. Consume los
 * toques, porque un gol cierra la jugada.
 *
 * @param {{clock: number, touches: Array, quietUntil: number}} from
 * @param {'Red'|'Blue'} team el equipo que sumó
 * @param {number} [grace] cuánto reloj de partido se ignoran los toques después
 */
function creditGoal(from, team, grace = GOAL_GRACE_MS) {
  const list = from.touches;
  const scorer = list.length ? list[list.length - 1] : null;
  // El saque del medio y los rebotes de la celebración no son toques.
  from.quietUntil = from.clock + grace;
  from.touches = [];

  // El equipo viene del marcador, que es la verdad. Si el que la tocó último es
  // del otro equipo, fue en contra — y ahí no hay asistencia que valga.
  const own = !!(scorer && scorer.team && scorer.team !== team);

  let assist = null;
  if (scorer && !own) {
    for (let i = list.length - 2; i >= 0; i--) {
      const touch = list[i];
      if (touch.name === scorer.name) continue;    // el mismo jugador, no asiste
      if (touch.team !== scorer.team) break;       // se la sacó el rival: no fue pase
      if (from.clock - touch.at > ASSIST_WINDOW_MS) break;
      assist = touch;
      break;
    }
  }

  return {
    team,
    scorer: scorer ? scorer.name : null,
    scorerTeam: scorer ? scorer.team : null,
    assist: assist ? assist.name : null,
    own
  };
}

/** La ventana del juego, que es donde el parche publica todo. */
function gameWindow(doc) {
  return doc && doc.defaultView;
}

/**
 * El reloj del partido, "MM:SS", leído del HUD.
 *
 * Se lee del DOM y no del estado porque el cronómetro son cuatro `<span
 * class="digit">` que HaxBall ya mantiene al día, y una lectura por gol no le
 * cuesta nada a nadie. Vale igual en vivo que en un replay, que es lo que hace
 * falta: la hora de la pared no significa nada en una grabación.
 */
function matchClock(doc) {
  try {
    const digits = doc.querySelectorAll('.game-state-view .game-timer-view .digit');
    if (digits.length < 4) return null;
    return `${digits[0].textContent}${digits[1].textContent}:${digits[2].textContent}${digits[3].textContent}`;
  } catch {
    return null;
  }
}

/* ── Analizar la grabación entera ────────────────────────────────────────────
 *
 * Mirar un replay entero para saber cómo terminó es al revés: los datos ya están
 * TODOS en el archivo desde el primer segundo. Lo único que hacía falta era poder
 * simularlo sin mirarlo, y eso es lo que abre el parche del reproductor: los
 * nombres de sus campos internos (`window.__tvmF.replay`) y el reproductor mismo
 * (`window.__tvmReplay.player`). Ver `game-patch.js`.
 *
 * Con eso, analizar es correr a mano el mismo `for` que corre el juego —evento,
 * cuadro de física, evento, cuadro de física— de punta a punta, mirando la sala
 * después de cada cuadro. No se dibuja nada, no se espera nada: un partido de
 * diez minutos son 36.000 cuadros y se van en un par de segundos.
 *
 * Los goles NO se leen del HUD acá: nadie está dibujando el HUD. Se leen del
 * marcador de la partida, que es de donde el HUD los saca (`__tvmF.score`), y
 * eso además los hace exactos: en vivo el marcador se mira por el DOM y a 16x se
 * puede perder alguno entre dos cuadros dibujados.
 *
 * Mientras dura, el juego se queda quieto: es una sola vuelta sincrónica. Es a
 * propósito — si se dejara respirar entre tanda y tanda, el reproductor dibujaría
 * cuadros de una partida que está a mitad de rebobinado.
 */

/** Tope de trabajo. Una grabación rota no puede dejar el juego colgado. */
const SCAN_BUDGET_MS = 20000;

/** Cada cuánto se anota quién está en cancha, en cuadros (1 s de partido). */
const ROSTER_EVERY = 60;

/**
 * Recorre la grabación abierta de punta a punta y devuelve todo lo que pasó.
 * Deja el reproductor exactamente donde estaba.
 */
function analyzeReplay() {
  const doc = gameDocument();
  const view = doc && doc.defaultView;
  const f = view && view.__tvmF;
  const R = f && f.replay;
  const S = f && f.score;
  const player = view && view.__tvmReplay && view.__tvmReplay.player;

  if (state.view !== 'replay') {
    return { ok: false, reason: 'Abrí un replay para poder analizarlo.' };
  }
  if (!f || !f.players || !f.name || !R || !S || !player) {
    return { ok: false, reason: 'El parche del juego no entró: la grabación no se puede analizar.' };
  }

  const total = Number(player[R.total]) || 0;
  if (total < 2) return { ok: false, reason: 'La grabación no tiene nada adentro.' };

  const msPerFrame = Number(player[R.msPerFrame]) || 1000 / 60;
  const gameField = f.game || S.game;

  // Dónde estaba el reproductor: al terminar hay que dejarlo igual que estaba.
  const wasFrame = Number(player[R.frame]) || 0;
  const wasClock = Number(player[R.clock]) || 0;

  /* La ficha y el mapa se arman también acá: el resumen de una grabación
     tiene que traer los mismos números que el de un partido jugado, o son
     dos cosas distintas con el mismo nombre. */
  const scan = { clock: 0, touches: [], quietUntil: 0, ball: newBallMemory(), card: newCard() };
  resetHeat();
  const roster = new Map();
  const goals = [];
  const matches = [];
  let match = null;
  let red = 0;
  let blue = 0;
  let partial = false;

  const startedAt = Date.now();
  const unmute = muteRoom(player[R.room]);

  // La sala quedó muda, y con ella el aviso de patada: se pone el nuestro, que
  // es de donde sale el autor de cada gol. `unmute()` lo saca al terminar.
  installKickHook(player[R.room], f, (who) => {
    const touch = recordTouch(scan, f, who);
    if (touch) rosterOf(roster, touch.name, touch.team).touches++;
  });

  try {
    player[R.rewind]();

    while (player[R.frame] < total) {
      stepReplay(player, R);

      const frame = player[R.frame];
      scan.clock = frame * msPerFrame;

      if ((frame & 4095) === 0 && Date.now() - startedAt > SCAN_BUDGET_MS) {
        partial = true;
        break;
      }

      const room = player[R.room];
      const now = room[gameField];

      if (now !== match) {
        // Partido nuevo: el marcador vuelve a cero y los toques del anterior ya
        // no valen. Se compara la identidad y no "hay partido o no": entre dos
        // partidos seguidos el hueco puede durar un solo cuadro.
        match = now;
        red = 0;
        blue = 0;
        scan.touches = [];
        scan.quietUntil = 0;
        scan.ball = newBallMemory();
        /* La ficha NO se reinicia: una grabación puede traer diez partidos
           seguidos y lo que se quiere es la ficha de todo lo que se grabó, que
           es lo que dice el título del resumen. El mapa, por lo mismo, tampoco. */
        if (match) matches.push({ red: 0, blue: 0, seconds: 0, goals: 0 });
      }
      if (!match) continue; // entre partidos no hay nada que medir

      const current = matches[matches.length - 1];
      current.seconds = Number(match[S.time]) || current.seconds;

      // Acá cada vuelta es un cuadro de la simulación, así que lo que avanza la
      // pelota entre dos vueltas es siempre `msPerFrame`. La regla del golpe es
      // la misma que en vivo a propósito: si el resumen de la grabación contara
      // los toques con otra vara, no daría los mismos números que el partido.
      // Se la llama por su efecto: mantiene al día la velocidad de la pelota,
      // que es de donde sale el remate más fuerte de cada uno.
      ballWasHit(scan, f, match, msPerFrame);

      cardTick(scan.card, f, room, msPerFrame);
      const pelotaScan = ballPos(f, match);
      if (pelotaScan) recordHeat(pelotaScan.x, pelotaScan.y);

      /*
       * Primero el toque y después el marcador: si el gol entra en este mismo
       * cuadro, el empujón que lo metió tiene que estar ya anotado.
       *
       * La vara es la misma que en vivo —contacto, no cambio de rumbo— y eso
       * NO es un detalle: si la grabación contara los toques distinto, el
       * resumen del replay no daría los mismos números que el del partido.
       */
      if (scan.clock >= scan.quietUntil) {
        const toucher = nearestToucher(f, room, match);
        if (toucher) {
          const who = recordTouch(scan, f, toucher);
          if (who) rosterOf(roster, who.name, who.team).touches++;
        }
      }

      const nextRed = match[S.red] | 0;
      const nextBlue = match[S.blue] | 0;
      if (nextRed > red || nextBlue > blue) {
        const goal = creditGoal(scan, nextRed > red ? 'Red' : 'Blue');
        goal.match = matches.length - 1;
        goal.clock = clockText(match[S.time]);
        goal.score = { red: nextRed, blue: nextBlue };
        /* En qué milisegundo de la GRABACIÓN entró, que es cosa distinta del
           reloj del partido: una grabación puede traer varios partidos y en
           todos hay un minuto 3. Esto es lo que hace posible saltar al gol y
           encadenarlos en el carrete. */
        goal.at = Math.round(scan.clock);
        goals.push(goal);
        current.goals++;
      }
      red = nextRed;
      blue = nextBlue;
      current.red = nextRed;
      current.blue = nextBlue;

      // Los goles y las asistencias los tiene la lista de arriba; esto es para
      // que en la tabla figure también el que jugó todo el partido sin tocarla.
      if (frame % ROSTER_EVERY === 0) takeRoster(roster, f, room);
    }
  } finally {
    // Pase lo que pase, el reproductor vuelve a donde estaba: el usuario dejó
    // la grabación en un punto y el análisis no es motivo para moverla.
    try {
      player[R.rewind]();
      while (player[R.frame] < wasFrame) stepReplay(player, R);
      player[R.clock] = wasClock;
      player[R.seek] = -1;
      // Sin esto, el próximo cuadro cree que pasaron los segundos que tardó el
      // análisis y salta hacia adelante.
      player[R.last] = view.performance.now();
    } catch (err) {
      log('error', `el reproductor quedó descolocado: ${err && err.message}`, 'replay');
    }
    unmute();
  }

  const seconds = Math.round((total * msPerFrame) / 1000);
  log('info', `grabación analizada: ${goals.length} goles en ${matches.length} partidos ` +
    `(${Date.now() - startedAt} ms)`, 'replay');

  return {
    ok: true,
    partial,
    seconds,
    matches,
    goals,
    players: [...roster.values()],
    card: cardPayload(scan.card),
    heat: heatImage(doc)
  };
}

/* ── Saltar a un momento, y el carrete de goles ──────────────────────────────
 *
 * El análisis deja anotado en qué milisegundo de la grabación entró cada gol
 * (`goal.at`). Con eso, «ver los goles» deja de ser buscarlos con la barrita:
 * son saltos exactos.
 *
 * El salto NO lo hacemos a mano moviendo el cuadro: el reproductor ya sabe
 * adelantar solo. En su bucle hay una rama de búsqueda —`0 < this.seek`— que,
 * mientras el reloj no llegue al destino, avanza 10 segundos de partido por
 * cuadro de pantalla en vez de avanzar tiempo real, simulando todo lo que hay
 * en el medio. Es lo que usa la barra de tiempo de HaxBall, y por eso adelantar
 * así respeta la física entera: no se saltea nada, se lo corre rápido.
 *
 * La única limitación es que esa rama sólo va HACIA ADELANTE. Para ir para
 * atrás hay que volver al principio primero, que es exactamente lo que hace la
 * barra de HaxBall cuando la arrastrás hacia la izquierda.
 */

/** Cuánto se ve antes del gol. Una jugada de gol se arma en estos segundos. */
const REEL_BEFORE_MS = 6000;

/** Y cuánto después: lo que dura el festejo antes de que sirvan del medio. */
const REEL_AFTER_MS = 2500;

/** Cada cuánto se mira si el gol de turno ya terminó. */
const REEL_WATCH_MS = 250;

const reel = {
  /** Los goles del carrete, en milisegundos de grabación. */
  goals: [],
  /** Los nombres, para el cartelito. Mismo largo que `goals`. */
  names: [],
  /** En cuál va, o -1 si no hay carrete andando. */
  i: -1,
  timer: 0,
  badge: null
};

/** El reproductor y sus nombres de campo, o null si no hay grabación abierta. */
function replayPlayer() {
  const doc = gameDocument();
  const view = doc && doc.defaultView;
  const f = view && view.__tvmF;
  const R = f && f.replay;
  const player = view && view.__tvmReplay && view.__tvmReplay.player;
  return R && player ? { doc, view, R, player } : null;
}

/**
 * Deja el reloj de la grabación en `ms`.
 *
 * Devuelve si se pudo. Hacia atrás vuelve al principio y adelanta desde ahí:
 * la rama de búsqueda del reproductor no sabe retroceder.
 */
function seekReplay(ms) {
  const it = replayPlayer();
  if (!it) return false;
  const { R, player } = it;

  // El destino tiene que ser > 0: la propia condición del reproductor es
  // `0 < this.seek`, así que un 0 se leería como "no estoy buscando nada".
  const target = Math.max(1, Math.round(Number(ms) || 0));
  if (target < Number(player[R.clock])) player[R.rewind]();
  player[R.seek] = target;
  return true;
}

/**
 * Arranca el carrete: salta al primer gol y va encadenando los demás.
 *
 * @param {Array<{at:number,name:string}>} goals en milisegundos de grabación
 */
function startReel(goals) {
  stopReel();
  const list = (goals || []).filter((g) => g && Number.isFinite(Number(g.at)));
  if (!list.length) {
    notify('No hay goles en esta grabación', 'err');
    return;
  }
  if (!replayPlayer()) {
    notify('Abrí un replay para ver el carrete', 'err');
    return;
  }

  reel.goals = list.map((g) => Number(g.at));
  reel.names = list.map((g) => g.name || '');
  reel.i = -1;

  // A 8x un gol dura menos que el parpadeo del cartel: el carrete se mira a
  // velocidad normal o no se mira.
  playAtNormalSpeed();
  reel.timer = setInterval(() => safe(watchReel), REEL_WATCH_MS);
  nextInReel();
}

function stopReel() {
  if (reel.timer) clearInterval(reel.timer);
  reel.timer = 0;
  reel.i = -1;
  reel.goals = [];
  reel.names = [];
  if (reel.badge) {
    reel.badge.remove();
    reel.badge = null;
  }
}

/** Al gol siguiente, o se termina el carrete. */
function nextInReel() {
  reel.i++;
  if (reel.i >= reel.goals.length) {
    stopReel();
    notify('Fin del carrete', 'ok');
    return;
  }
  seekReplay(reel.goals[reel.i] - REEL_BEFORE_MS);
  paintReelBadge();
}

/**
 * ¿Terminó el gol de turno?
 *
 * Mientras el reproductor está buscando (`seek > 0`) no se mira el reloj: en
 * esa rama avanza a los saltos y ya pasó de largo el final del gol anterior.
 */
function watchReel() {
  const it = replayPlayer();
  if (!it || reel.i < 0) return stopReel();
  const { R, player } = it;

  if (Number(player[R.seek]) > 0) return;
  if (Number(player[R.clock]) >= reel.goals[reel.i] + REEL_AFTER_MS) nextInReel();
}

/**
 * Velocidad normal, sin pelearse con el control de HaxBall.
 *
 * `set(1)` mueve la lista y el cartel de velocidad, pero con el reproductor en
 * pausa deja el campo en 0 —así se pausa— y el carrete se quedaría quieto. Por
 * eso, si después de pedir 1x sigue en cero, se lo despausa a mano.
 */
function playAtNormalSpeed() {
  const it = replayPlayer();
  if (!it) return;
  const { view, R, player } = it;
  try {
    view.__tvmReplay.set(1);
  } catch { /* la lista de velocidades no es indispensable para el carrete */ }
  if (!Number(player[R.speed])) player[R.speed] = 1;
}

/** «Gol 2 de 7 · Ana», arriba de la cancha, con una cruz para cortar. */
function paintReelBadge() {
  const doc = gameDocument();
  if (!doc || !doc.body) return;

  if (!reel.badge) {
    const badge = doc.createElement('div');
    badge.className = 'tvm-reel';
    const text = doc.createElement('span');
    const close = doc.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.title = 'Cortar el carrete';
    close.addEventListener('click', () => safe(stopReel));
    badge.append(text, close);
    doc.body.append(badge);
    reel.badge = badge;
  }

  const nombre = reel.names[reel.i];
  reel.badge.firstChild.textContent =
    `Gol ${reel.i + 1} de ${reel.goals.length}${nombre ? ` · ${nombre}` : ''}`;
}

/** Un cuadro de simulación: los eventos que tocaban y la física. */
function stepReplay(player, R) {
  const room = player[R.room];
  while (player[R.next] != null && player[R.nextFrame] === player[R.frame]) {
    player[R.next].apply(room);
    player[R.read]();
  }
  player[R.frame]++;
  room[R.step](1);
}

/**
 * Descuelga los enganches de interfaz de la sala mientras dura el análisis.
 *
 * El juego le cuelga a la sala sus avisos —el sonido del gol, el chat, el cartel
 * de «Red Scores!»— y todos salen de adentro de la física. Simular la grabación
 * entera de una sentada los dispararía todos juntos: la grabación sonaría y se
 * escribiría de golpe en dos segundos.
 *
 * Se descuelgan TODAS las funciones propias de la sala en vez de una lista con
 * nombres: están minificados y cambian entre versiones. Los métodos del motor
 * viven en el prototipo, así que acá caen sólo los enganches — y el juego los
 * llama siempre con un `null !=` adelante, justamente porque pueden no estar.
 */
function muteRoom(room) {
  const saved = [];
  if (!room) return () => {};
  for (const key of Object.keys(room)) {
    if (typeof room[key] === 'function') {
      saved.push([key, room[key]]);
      room[key] = null;
    }
  }
  return () => {
    for (const [key, value] of saved) room[key] = value;
  };
}

/** Quiénes están en cancha ahora mismo, para que figuren aunque no la toquen. */
function takeRoster(roster, f, room) {
  const players = room[f.players];
  if (!players) return;
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player || !player[f.disc]) continue; // espectador
    const { name, team } = whoIs(f, player);
    if (name) rosterOf(roster, name, team);
  }
}

function rosterOf(roster, name, team) {
  let entry = roster.get(name);
  if (!entry) {
    entry = { name, team: team || '', touches: 0 };
    roster.set(name, entry);
  } else if (team) {
    entry.team = team;
  }
  return entry;
}

/** Segundos de partido → "MM:SS", igual que el cronómetro del HUD. */
function clockText(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * ¿Está puesto «Gráficos planos»?
 *
 * Esta consulta ocurre muchas veces por cuadro desde setters del Canvas. No se
 * recorre `state.config` en la ruta caliente: se actualiza la bandera sólo al
 * arrancar o cuando llega una configuración nueva.
 */
let flatGraphicsEnabled = false;

function syncCanvasHotFlags() {
  flatGraphicsEnabled = !!(state.config && state.config.perf && state.config.perf.flatGraphics);
}

function flatOn() {
  return flatGraphicsEnabled;
}

/**
 * Patrón original → el mismo patrón aplanado a un color.
 *
 * Débil a propósito: las claves son los `CanvasPattern` del renderer de HaxBall,
 * y cuando se descarta la sala se los lleva el recolector con todo lo demás.
 */
const flatPatterns = new WeakMap();

function installCanvasHooks(doc) {
  const view = doc && doc.defaultView;
  if (!view || hookedWindows.has(view)) return;
  const proto = view.CanvasRenderingContext2D && view.CanvasRenderingContext2D.prototype;
  if (!proto || !proto.fillText) return;
  hookedWindows.add(view);

  // --- Modo Gráficos Planos (Rendimiento) ---
  const origShadowBlur = Object.getOwnPropertyDescriptor(proto, 'shadowBlur');
  if (origShadowBlur && origShadowBlur.set) {
    Object.defineProperty(proto, 'shadowBlur', {
      get: origShadowBlur.get,
      set: function (value) {
        if (flatOn()) {
          origShadowBlur.set.call(this, 0);
        } else {
          origShadowBlur.set.call(this, value);
        }
      }
    });
  }

  const origShadowColor = Object.getOwnPropertyDescriptor(proto, 'shadowColor');
  if (origShadowColor && origShadowColor.set) {
    Object.defineProperty(proto, 'shadowColor', {
      get: origShadowColor.get,
      set: function (value) {
        if (flatOn()) {
          origShadowColor.set.call(this, 'transparent');
        } else {
          origShadowColor.set.call(this, value);
        }
      }
    });
  }

  /*
   * ── La textura de la cancha ─────────────────────────────────────────────
   *
   * HaxBall arma los tres patrones (pasto, cemento, cemento2) UNA sola vez, en
   * el constructor del renderer:
   *
   *   this.tp = this.c.createPattern(m.sp, null)   ← images/grass.png
   *   this.Fo = this.c.createPattern(m.Eo, null)
   *   this.Do = this.c.createPattern(m.Co, null)
   *
   * y después dibuja la cancha con `fillStyle = this.tp; fill()`.
   *
   * O sea que aplanar en `createPattern` sólo servía si el interruptor ya estaba
   * puesto cuando se montó la sala: prenderlo jugando no cambiaba nada, y
   * apagarlo tampoco. Por eso acá se guarda la versión plana de cada patrón y el
   * cambio se hace en el `fill`, que es donde se usa. Prender y apagar funciona
   * en el acto, en los dos sentidos.
   *
   * Lo que NO se toca es el disco de cada jugador: HaxBall lo arma en un CANVAS
   * de 64×64 con las franjas del equipo y el avatar encima, y aplanarlo dejaría
   * a todos los jugadores de un color liso. Antes se lo salvaba por el tamaño
   * —«si no mide 64×64, aplanalo»—, y ahí estaba el bug del pasto: grass.png
   * también mide 64×64, así que la cancha entraba en la misma excepción y no se
   * aplanaba nunca. Ahora se distingue por lo que son: la cancha es un <img> y
   * el disco un <canvas>, y sólo un canvas tiene `getContext`.
   */
  const origCreatePattern = proto.createPattern;
  proto.createPattern = function (image, repetition) {
    const pattern = origCreatePattern.call(this, image, repetition);
    if (!pattern || !image || typeof image.getContext === 'function') return pattern;

    try {
      const targetDoc = (this.canvas && this.canvas.ownerDocument) || doc;
      const temp = targetDoc.createElement('canvas');
      temp.width = 1;
      temp.height = 1;
      /*
       * La imagen ENTERA achicada a un píxel, que es su color promedio. Antes se
       * copiaba el píxel de arriba a la izquierda y la cancha quedaba del color
       * de una brizna suelta en vez del verde del pasto.
       */
      temp.getContext('2d').drawImage(image, 0, 0, 1, 1);
      flatPatterns.set(pattern, origCreatePattern.call(this, temp, 'repeat'));
    } catch {
      /* la imagen puede no estar decodificada todavía: se dibuja con textura */
    }
    return pattern;
  };

  const origFill = proto.fill;
  proto.fill = function (...args) {
    // `WeakMap.get` con una cadena —un color— devuelve undefined y no tira, así
    // que no hace falta preguntar antes de qué tipo es el relleno.
    const flat = flatOn() && flatPatterns.get(this.fillStyle);
    if (!flat) return origFill.apply(this, args);

    const before = this.fillStyle;
    this.fillStyle = flat;
    try {
      return origFill.apply(this, args);
    } finally {
      this.fillStyle = before;
    }
  };

  const origCreateRadialGradient = proto.createRadialGradient;
  proto.createRadialGradient = function (x0, y0, r0, x1, y1, r1) {
    const grad = origCreateRadialGradient.call(this, x0, y0, r0, x1, y1, r1);
    if (flatOn()) {
      const origAddColorStop = grad.addColorStop;
      grad.addColorStop = function (offset, color) {
        origAddColorStop.call(this, offset, 'transparent');
      };
    }
    return grad;
  };

  const origCreateLinearGradient = proto.createLinearGradient;
  proto.createLinearGradient = function (x0, y0, x1, y1) {
    const grad = origCreateLinearGradient.call(this, x0, y0, x1, y1);
    if (flatOn()) {
      const origAddColorStop = grad.addColorStop;
      let firstColor = null;
      grad.addColorStop = function (offset, color) {
        if (!firstColor) firstColor = color;
        origAddColorStop.call(this, offset, firstColor);
      };
    }
    return grad;
  };

  /*
   * ── Líneas simples ──────────────────────────────────────────────────────
   *
   * TODO trazo pasa a 1 px, la pelota y los discos incluidos. Antes el ancho se
   * tocaba sólo si el trazo NO era negro, y el contorno de los discos y el de
   * la bocha son justamente negros: quedaban en su grosor original mientras las
   * líneas de la cancha se afinaban, o sea la mitad del efecto y encima
   * despareja.
   *
   * Es lo mismo que hace el cliente Zero, que lo resuelve en su copia del
   * bundle poniendo el ancho una vez por grupo de dibujo:
   *
   *     this.c.lineWidth = simple_lines ? 1 : 3    // cancha y el resto
   *     this.c.lineWidth = simple_lines ? 1 : 2    // antes del bucle de discos
   *
   * Nosotros no servimos el bundle, así que se hace en el `stroke`: sale el
   * mismo dibujo, y prende y apaga en caliente.
   *
   * El ancho va en unidades de mundo —el contexto ya viene escalado por el
   * zoom cuando se llama—, así que 1 acá es 1 allá.
   *
   * El blanqueo sigue siendo sólo para los trazos de color: un contorno blanco
   * alrededor de una pelota blanca no se ve, y el negro es lo que separa a los
   * discos del pasto.
   */
  const BLACK_STROKES = new Set(['#000000', '#000', 'black', 'rgba(0, 0, 0, 1)']);

  const origStroke = proto.stroke;
  proto.stroke = function (...args) {
    if (!flatOn()) return origStroke.apply(this, args);

    const style = this.strokeStyle;
    const width = this.lineWidth;
    const recolor = typeof style === 'string' && !BLACK_STROKES.has(style);

    this.lineWidth = 1;
    if (recolor) this.strokeStyle = '#FFFFFF';
    try {
      return origStroke.apply(this, args);
    } finally {
      this.lineWidth = width;
      if (recolor) this.strokeStyle = style;
    }
  };

  /* --- Hook de Avatar ---
   *
   * Además de dibujar la imagen, acá se resuelven dos cosas que necesita el
   * avatar animado y que sólo se saben en este punto:
   *
   *   · Si la textura que se está armando es la TUYA. El parche del bundle
   *     avisa dos líneas después, cuando ya no hay ningún texto que mirar, así
   *     que el veredicto se deja anotado en `lastTextureMine`.
   *   · Cómo son las franjas del equipo. En este instante la textura las tiene
   *     pintadas y todavía no tiene el avatar encima: es el único momento en el
   *     que se pueden copiar limpias.
   */
  const originalFillText = proto.fillText;
  proto.fillText = function (text, x, y, ...rest) {
    const esTextura = this.canvas && this.canvas.width === 64 && this.canvas.height === 64;
    if (esTextura && (avatarImage || gifOn())) {
      try {
        /*
         * Quién es el dueño manda; el texto es el plan B.
         *
         * El texto solo era el bug: dos jugadores con el mismo avatar tenían la
         * misma textura a los ojos del cliente, así que la imagen se le ponía a
         * los dos. Con `textureOwner` la pregunta pasa a ser por id de jugador,
         * que es único en la sala y no lo puede copiar nadie. Ver `patchSelf` en
         * game-patch.js y `textureOwner` acá arriba para cuándo vale `null`.
         */
        const porTexto = myAvatarTexts().has(String(text));
        /*
         * El dueño se CONSUME: vale para esta textura y para ninguna otra.
         *
         * Sin esto, un `fillText` sobre cualquier otro canvas de 64×64 que no
         * venga de `sr()` —hoy no hay ninguno, mañana quién sabe— se llevaría el
         * veredicto de la textura anterior, que es el peor error posible acá:
         * silencioso y a favor de pintar de más.
         */
        const deQuienEs = textureOwner;
        textureOwner = null;
        const mia = deQuienEs !== null
          ? deQuienEs
          : (porTexto || this.canvas === myTextureCanvas);
        lastTextureMine = mia;
        if (mia) {
          if (porTexto) myTextureCanvas = this.canvas;
          keepAvatarBase(this);
          // Con GIF se dibuja el primer cuadro: es lo que se ve hasta que la
          // animación arranca, y lo que queda si el parche no aplicó.
          if (gifOn()) this.drawImage(gifSheet, 0, 0, 64, 64, 0, 0, 64, 64);
          else this.drawImage(avatarImage, 0, 0, 64, 64);
          return undefined;
        }
      } catch {}
    } else if (esTextura) {
      lastTextureMine = false;
    }
    return originalFillText.call(this, text, x, y, ...rest);
  };

  /*
   * Acá vivían los hooks del "motor de tracking": `drawImage` para los discos,
   * `arc` para la pelota y un envoltorio de `requestAnimationFrame` para cerrar
   * el cuadro. Se fueron enteros y a propósito:
   *
   *   · Nunca corrían. `installCanvasHooks` se llama sólo desde
   *     `loadAvatarImage`, que corta antes si no hay imagen de avatar VIP — o
   *     sea que el motor existía únicamente para los VIP con avatar propio.
   *   · Aunque corrieran, del canvas salen posiciones y nunca nombres, así que
   *     el gol no podía tener autor.
   *   · Envolver `requestAnimationFrame` acá peleaba con el limitador de cuadros
   *     (`installFrameLimiter`), que envuelve la misma función.
   *
   * Ahora el estado sale del propio juego, ya con nombres: ver `installTracking`
   * y el parche del minimapa en `game-patch.js`.
   */
}

/**
 * HaxBall rehace la textura del disco sólo cuando CAMBIA el avatar, así que una
 * imagen nueva no se vería hasta el próximo cambio. Se fuerza con
 * /clear_avatar + /avatar: los dos avisos que eso escribe en el chat los tapa
 * `watchChatLog` durante la ventana de silencio.
 */
let avatarNoiseUntil = 0;

function refreshAvatarTexture() {
  const doc = gameDocument();
  const face = currentAvatarText();
  if (!doc || !chatInput(doc) || !face) return;

  avatarNoiseUntil = Date.now() + 2000;
  refreshChatWatcher();
  sendChat(doc, '/clear_avatar');
  setTimeout(() => sendChat(doc, `/avatar ${face}`), 80);
  setTimeout(refreshChatWatcher, 2100);
}

/**
 * Un lote de moderación no se pisa con otro: son varios cuadros abriéndose y
 * cerrándose sobre el mismo documento, y dos series a la vez se roban los
 * botones entre sí.
 */
let moderating = false;

/**
 * Echa o banea a todos, o a un equipo.
 *
 * @param {'kick'|'ban'} action
 * @param {'red'|'blue'|'spec'} [team] sin esto, la sala entera
 */
async function moderateAll(action, team) {
  const doc = gameDocument();
  if (!doc || moderating) return;

  if (!isAdmin(doc)) {
    notify('Necesitás ser admin de la sala', 'err');
    return;
  }

  /*
   * Se anotan los NOMBRES, no las filas.
   *
   * Cada expulsión rehace la lista de jugadores, así que las filas que uno
   * guardó al principio quedan fuera del documento a la segunda vuelta: el clic
   * derecho sobre una fila huérfana no llega a ninguna parte. La fila se vuelve
   * a buscar por nombre antes de cada paso, y el que ya se fue se saltea.
   */
  /*
   * Que el cajón no aparezca no es lo mismo que que esté vacío, y confundirlos
   * fue justamente lo que hizo que este error tardara en verse: durante meses
   * las teclas por equipo contestaron «no hay jugadores» estando la sala llena.
   * Si HaxBall vuelve a cambiar cómo arma el panel, esto lo va a decir.
   */
  if (team && !doc.querySelector(TEAM_LISTS[team])) {
    notify('No encontré la lista de ese equipo', 'err');
    log('error', `no está el cajón del equipo (${TEAM_LISTS[team]})`, 'sala');
    return;
  }

  const targets = playerRows(doc, team)
    .filter((row) => !isSelfRow(row))
    .map(rowNick)
    .filter(Boolean);

  if (!targets.length) {
    notify('No hay jugadores para moderar');
    return;
  }

  moderating = true;
  let done = 0;
  try {
    for (const nick of targets) {
      const row = playerRows(doc, team).find((r) => rowNick(r) === nick);
      if (!row) continue; // se fue solo mientras tanto
      if (await moderateOne(doc, row, action)) done++;
    }
  } catch (err) {
    // Nadie espera esta promesa —sale de un clic o de un atajo—, así que un
    // throw suelto acá terminaría en un unhandledRejection y en nada más.
    log('error', err && err.message ? err.message : String(err), 'sala');
  } finally {
    moderating = false;
    safe(closeModDialogs, doc);
  }

  if (done) {
    notify(`${action === 'ban' ? 'Baneados' : 'Expulsados'}: ${done}`, 'ok');
    log('info', `${action} en lote (${team || 'todos'}): ${done} jugadores`, 'sala');
  } else {
    notify('No se pudo moderar a nadie', 'err');
  }
}

/* ------------------------------------------------------------------ *
 * Avatar
 * ------------------------------------------------------------------ *
 * HaxBall guarda el avatar fijo en localStorage (clave `avatar`, 2 caracteres)
 * y lo cambia en caliente con el comando /avatar. No hay otra forma de cambiarlo
 * en caliente: rotando los cuadros con ese comando se ve animado.
 *
 * Eso trae dos molestias, las dos sólo del lado del jugador (el comando no
 * viaja a la sala):
 *
 *   · HaxBall se escribe "Avatar set" en el chat por cada cambio. Lo filtra
 *     `watchChatLog`.
 *   · El comando se manda por el mismo <input> del chat, así que pisaba lo que
 *     estabas escribiendo. Ahora la animación espera a que sueltes el chat, y
 *     por las dudas `sendChat` guarda y repone el borrador.
 */
const MIN_AVATAR_MS = 500;
let avatarTimer = null;
let avatarIndex = 0;

function chatInput(doc) {
  return doc.querySelector('.chatbox-view-contents > .input input[type="text"]');
}

/* ── Los botones del chat ───────────────────────────────────────────────── *
 *
 * Dos cosas que se querían a mano y no enterradas en Ajustes: callar el sonido
 * del chat y poner emojis. Van pegados al `<input>` de HaxBall, que es donde se
 * los busca.
 *
 * El mute NO recarga el juego: escribe el ajuste `sound_chat` del propio
 * HaxBall por `applyGameSettingsLive`, que lo cambia en caliente y además lo
 * guarda en la config del cliente (ver el envoltorio del setter en
 * `buildLiveSettingsIndex`). Es el mismo interruptor que el de Ajustes, así que
 * los dos siempre dicen lo mismo.                                           */

const CHAT_TOOLS_STYLE = 'tvm-chat-tools-style';

const EMOJIS = [
  '😀', '😂', '😅', '😊', '😉', '😍', '😎', '🤔', '😐', '😴',
  '😢', '😭', '😡', '🤡', '💀', '👀', '🙈', '🤝', '👏', '🙏',
  '👍', '👎', '💪', '🔥', '⭐', '✨', '💯', '❤️', '💔', '🎉',
  '⚽', '🥅', '🧤', '🏆', '🥇', '🎯', '🚀', '🐐', '🤖', '👑'
];

function chatInputBox(doc) {
  return doc.querySelector('.chatbox-view-contents > .input');
}

/** ¿Está sonando el chat? Sale del ajuste del juego, no de una copia nuestra. */
function chatSoundOn(doc) {
  const index = liveSettings(doc);
  const entry = index && index.get('sound_chat');
  if (!entry) return true;
  try {
    return entry.get() !== false;
  } catch {
    return true;
  }
}

function ensureChatToolsStyle(doc) {
  if (doc.getElementById(CHAT_TOOLS_STYLE)) return;
  const style = doc.createElement('style');
  style.id = CHAT_TOOLS_STYLE;
  style.textContent = `
    .chatbox-view-contents > .input { display: flex; align-items: center; }
    .chatbox-view-contents > .input input[type="text"] { flex: 1 1 auto; min-width: 0; }
    .tvm-chattools { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; position: relative; }
    .tvm-chatbtn {
      background: none; border: 0; cursor: pointer; padding: 2px 4px;
      font-size: 15px; line-height: 1; opacity: .65; color: inherit;
    }
    .tvm-chatbtn:hover { opacity: 1; }
    .tvm-chatbtn.is-off { opacity: .35; }
    .tvm-emojis {
      position: absolute; bottom: 100%; right: 0; margin-bottom: 6px; z-index: 30;
      display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px;
      padding: 6px; border-radius: 8px; width: max-content; max-width: 320px;
      background: #1b1b22; border: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 8px 24px rgba(0,0,0,.45);
    }
    .tvm-emojis[hidden] { display: none; }
    .tvm-emoji { background: none; border: 0; cursor: pointer; font-size: 17px; line-height: 1; padding: 3px; border-radius: 5px; }
    .tvm-emoji:hover { background: rgba(255,255,255,.12); }
  `;
  (doc.head || doc.documentElement).appendChild(style);
}

/**
 * Mete el emoji donde está el cursor y devuelve el foco al chat.
 *
 * Se respeta la posición del cursor a propósito: pegarlo siempre al final
 * obliga a reescribir el mensaje si el emoji iba en el medio.
 */
function insertInChat(doc, text) {
  const input = chatInput(doc);
  if (!input) return;
  const view = doc.defaultView;
  const value = String(input.value || '');
  const start = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
  const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : value.length;

  setInputValue(view, input, value.slice(0, start) + text + value.slice(end));
  input.focus();
  try {
    const caret = start + text.length;
    input.setSelectionRange(caret, caret);
  } catch { /* el input puede haberse recreado */ }
}

/**
 * Cuelga los botones del chat. Es idempotente: HaxBall rehace este DOM cada vez
 * que se entra o se sale de una sala, y esto se llama en cada cambio de vista.
 */
function mountChatTools(doc) {
  const box = chatInputBox(doc);
  if (!box || box.querySelector('.tvm-chattools')) return;

  ensureChatToolsStyle(doc);

  const tools = doc.createElement('div');
  tools.className = 'tvm-chattools';

  /* ── Emojis ── */
  const panel = doc.createElement('div');
  panel.className = 'tvm-emojis';
  panel.hidden = true;

  for (const emoji of EMOJIS) {
    const item = doc.createElement('button');
    item.type = 'button';
    item.className = 'tvm-emoji';
    item.textContent = emoji;
    item.addEventListener('click', (e) => {
      e.preventDefault();
      insertInChat(doc, emoji);
      panel.hidden = true;
    });
    panel.appendChild(item);
  }

  const emojiBtn = doc.createElement('button');
  emojiBtn.type = 'button';
  emojiBtn.className = 'tvm-chatbtn';
  emojiBtn.textContent = '😀';
  emojiBtn.title = 'Emojis';
  emojiBtn.addEventListener('click', (e) => {
    e.preventDefault();
    panel.hidden = !panel.hidden;
    if (panel.hidden) {
      const input = chatInput(doc);
      if (input) input.focus();
    }
  });

  /* ── Sonido del chat ── */
  const muteBtn = doc.createElement('button');
  muteBtn.type = 'button';
  muteBtn.className = 'tvm-chatbtn';

  const paintMute = () => {
    const on = chatSoundOn(doc);
    muteBtn.textContent = on ? '🔔' : '🔕';
    muteBtn.title = on ? 'Silenciar el sonido del chat' : 'Volver a escuchar el chat';
    muteBtn.classList.toggle('is-off', !on);
  };

  muteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const next = chatSoundOn(doc) ? '0' : '1';
    applyGameSettingsLive(doc, { sound_chat: next });
    paintMute();
    const input = chatInput(doc);
    if (input) input.focus();
  });
  paintMute();

  tools.append(panel, emojiBtn, muteBtn);
  box.appendChild(tools);
  watchChatToolsDismiss(doc);
}

/**
 * Un clic afuera cierra la grilla, como cualquier menú.
 *
 * Se registra UNA vez por documento y busca el panel abierto en el momento, en
 * vez de quedarse con el de esta pasada: el chat se rehace varias veces por
 * sesión, y un oyente por montaje sería una pila de oyentes apuntando a nodos
 * que ya no existen.
 */
function watchChatToolsDismiss(doc) {
  if (doc.__tvmChatDismiss) return;
  doc.__tvmChatDismiss = true;
  doc.addEventListener('mousedown', (e) => {
    const open = doc.querySelector('.tvm-emojis:not([hidden])');
    if (!open) return;
    const tools = open.parentElement;
    if (tools && !tools.contains(e.target)) open.hidden = true;
  });
}

/** ¿Está escribiendo? Con foco en el chat o algo tipeado, no lo interrumpimos. */
function isTyping(doc) {
  const input = chatInput(doc);
  if (!input) return false;
  return doc.activeElement === input || String(input.value || '').trim() !== '';
}

/**
 * Manda un texto por el chat de HaxBall.
 *
 * Guarda y repone el borrador: los comandos automáticos usan el mismo input y
 * sin esto le borraban al jugador el mensaje a medio escribir. El envío es
 * síncrono —HaxBall lee el valor durante el propio keydown—, así que reponerlo
 * inmediatamente después es seguro.
 */
function sendChat(doc, text, { keepDraft = true } = {}) {
  const input = chatInput(doc);
  if (!input) return false;
  const view = doc.defaultView;
  const draft = keepDraft ? String(input.value || '') : '';
  const caret = keepDraft ? input.selectionStart : 0;

  setInputValue(view, input, text);
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));

  if (draft) {
    setInputValue(view, input, draft);
    try {
      input.setSelectionRange(caret, caret);
    } catch { /* el input puede haberse recreado */ }
  }
  return true;
}

function stopAvatar() {
  clearInterval(avatarTimer);
  avatarTimer = null;
  avatarIndex = 0;
  /*
   * Media segundo de gracia al apagar.
   *
   * El aviso del último `/avatar` puede estar todavía en camino —y `disconnect()`
   * TIRA los cambios que el observador no alcanzó a procesar—, así que con el
   * temporizador ya en null no lo tapaba nadie y quedaba uno suelto en el chat
   * cada vez que apagabas la animación.
   */
  avatarNoiseUntil = Math.max(avatarNoiseUntil, Date.now() + 500);
  refreshChatWatcher();
}

/** @param {string} frames Cada "cuadro" es un carácter o emoji. */
function startAvatar(frames, intervalMs) {
  stopAvatar();
  const list = avatarFrames(frames);
  if (list.length < 2) return;

  const every = Math.max(MIN_AVATAR_MS, Number(intervalMs) || 700);
  avatarTimer = setInterval(() => {
    const doc = gameDocument();
    if (!doc || !chatInput(doc)) return; // fuera de sala no hay nada que animar
    if (isTyping(doc)) return; // el chat es tuyo mientras escribís
    // Cada cuadro pasa por el mismo recorte que usa HaxBall: un emoji con
    // modificador ocupa más de dos unidades y llegaría partido.
    sendChat(doc, `/avatar ${haxball.clampAvatar(list[avatarIndex % list.length])}`);
    avatarIndex++;
  }, every);

  // Con la animación andando hay que filtrar los "Avatar set" del chat.
  refreshChatWatcher();
  log('info', `Avatar animado: ${list.length} cuadros cada ${every} ms`, 'avatar');
}

/**
 * Parte el texto en cuadros. Se usa `Intl.Segmenter` porque un emoji compuesto
 * (una bandera, o uno con modificador de tono) son varios code points y con
 * `[...texto]` se partía al medio, mandando basura al chat.
 */
function avatarFrames(frames) {
  return haxball.graphemes(frames);
}

/** Aplica el avatar fijo ahora mismo, si estamos dentro de una sala. */
function applyStaticAvatar() {
  const face = haxball.clampAvatar(state.config.avatar?.static);
  const doc = gameDocument();
  if (!doc || !chatInput(doc)) return;
  sendChat(doc, `/avatar ${face}`);
}

/** Arranca o detiene la animación según lo que diga la config. */
function syncAvatar() {
  invalidateAvatarTextsCache();
  const avatar = state.config.avatar || {};
  if (avatar.animated && avatarFrames(avatar.frames).length >= 2) {
    startAvatar(avatar.frames, avatar.intervalMs);
  } else {
    stopAvatar();
  }
}

function attachHotkeys(doc) {
  // El foco casi siempre está dentro del iframe, así que escuchamos en los dos.
  // Las opciones tienen que ser las MISMAS al sacar y al poner: un `remove` sin
  // el `capture` no saca nada y se irían apilando manejadores.
  doc.removeEventListener('keydown', onKeyDown, HOTKEY_OPTS);
  doc.addEventListener('keydown', onKeyDown, HOTKEY_OPTS);
  attachChatCommands(doc);
  // El cartel de teclas mira lo mismo, pero sin tocar el evento.
  watchKeystrokes(doc);
}

/* ------------------------------------------------------------------ *
 * Comandos propios del cliente
 * ------------------------------------------------------------------ *
 *   /anim ⚽🔥⭐   → avatar animado con esos cuadros
 *   /anim off      → lo detiene
 *   /tvm           → recuerda los comandos
 *
 * Antes esto se enganchaba al <input> del chat en cuanto aparecía un documento
 * de juego nuevo. Pero el chat no existe hasta que entrás a una sala, así que
 * el listener nunca llegaba a colgarse y `/anim` viajaba tal cual a la sala:
 * el bot del host respondía "comando desconocido".
 *
 * Ahora escucha en el documento, en fase de captura, así que funciona sin
 * importar cuándo se monte el chat y corre antes que el manejador de HaxBall.
 */
const COMMANDS = /^\/(anim|tvm)\b\s*(.*)$/i;
const commandDocs = new WeakSet();

function attachChatCommands(doc) {
  if (!doc || commandDocs.has(doc)) return;
  commandDocs.add(doc);

  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;

    const input = event.target;
    if (!input || input !== chatInput(doc)) return;

    const match = String(input.value || '').trim().match(COMMANDS);
    if (!match) return;

    event.preventDefault();
    event.stopPropagation();
    // El comando no tiene que llegar a la sala.
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    setInputValue(doc.defaultView, input, '');
    safe(runCommand, match[1].toLowerCase(), match[2].trim());
  }, true);
}

function runCommand(name, args) {
  if (name === 'tvm') {
    notify('Comandos: /anim ⚽🔥 para animar el avatar · /anim off para parar');
    return;
  }

  // /anim
  if (!args || /^(off|stop|no)$/i.test(args)) {
    stopAvatar();
    ipcRenderer.send('game:avatar-saved', { animated: false });
    notify('Avatar animado detenido', 'ok');
    return;
  }

  const frames = avatarFrames(args);
  if (frames.length < 2) {
    notify('Poné al menos dos cuadros: /anim ⚽🔥', 'err');
    return;
  }

  startAvatar(args, state.config.avatar?.intervalMs);
  ipcRenderer.send('game:avatar-saved', { animated: true, frames: args });
  notify(`Avatar animado: ${frames.join(' ')}`, 'ok');
}

/* ------------------------------------------------------------------ *
 * 5 · Overlay
 * ------------------------------------------------------------------ */

/**
 * Arriba a la derecha vive la botonera de HaxBall (`.game-view > .buttons`,
 * 35 px pegados al borde) y, en la sala, los botones Rec/Link/Leave. El overlay
 * arrancaba en top:14px y quedaba justo encima. Se corre debajo cuando hay algo
 * que esquivar.
 */
const POSITIONS = {
  'top-left': (offset) => `top:${offset}px;left:14px;`,
  'top-right': (offset) => `top:${offset}px;right:14px;`,
  'bottom-left': () => 'bottom:14px;left:14px;',
  'bottom-right': () => 'bottom:14px;right:14px;'
};

/**
 * Alto que ocupa la botonera de la partida, más aire. Se calcula con la misma
 * escala que usa el tema para dibujarla: con el HUD agrandado, un número fijo
 * se quedaba corto y el overlay volvía a taparla.
 */
function hudClearance() {
  const hud = Math.min(1.4, Math.max(0.8, Number(state.config.appearance.hudScale) || 1));
  // 8 arriba + padding + alto del botón + bordes + 8 de aire
  return Math.round(18 + 40 * hud);
}

let overlayEl = null;
/** Nodos de texto de cada fila: se actualizan sin tocar la estructura. */
const overlayValues = new Map();

/**
 * El overlay se construye una sola vez y después sólo se le cambian los nodos
 * de texto. Nada de innerHTML por segundo ni de backdrop-filter: un desenfoque
 * encima del canvas obliga a recomponer el cuadro entero del juego.
 */
function buildOverlay() {
  if (!document.body) return;
  if (overlayEl) overlayEl.remove();
  overlayValues.clear();
  overlayEl = null;

  const cfg = state.config.overlay;
  if (!cfg.enabled) return;

  const p = currentPalette();

  overlayEl = document.createElement('div');
  overlayEl.id = 'tvm-overlay';
  overlayEl.style.cssText = `
    position:fixed;z-index:2147482000;pointer-events:none;
    contain:layout style paint;
    font-family:Bahnschrift,'Segoe UI',system-ui,sans-serif;
    font-size:12px;line-height:1.35;color:${p.text};
    transition:opacity .25s ease, top .2s ease;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    min-width:126px;padding:9px 11px;border-radius:12px;
    background:linear-gradient(160deg,${rgbaOf(p.panelTop, 0.95)},${rgbaOf(p.bg, 0.96)});
    border:1px solid ${rgbaOf(p.accent, 0.42)};
    box-shadow:0 10px 28px rgba(0,0,0,.55);
  `;

  const title = document.createElement('div');
  title.textContent = 'TL App';
  title.style.cssText = `font-weight:700;letter-spacing:.16em;font-size:10px;color:${p.accent};margin-bottom:6px;`;
  card.append(title);

  const rows = [
    ['fps', 'FPS', cfg.showFps],
    ['ping', 'Ping', cfg.showPing],
    ['session', 'Sesión', cfg.showSession],
    ['clock', 'Hora', cfg.showClock]
  ];

  for (const [key, label, enabled] of rows) {
    if (!enabled) continue;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;justify-content:space-between;font-variant-numeric:tabular-nums';

    const name = document.createElement('span');
    name.textContent = label;
    name.style.color = p.dim;

    const value = document.createElement('span');
    value.style.fontWeight = '600';
    const node = document.createTextNode('—');
    value.append(node);
    overlayValues.set(key, node);

    row.append(name, value);
    card.append(row);
  }

  overlayEl.append(card);
  document.body.append(overlayEl);
  positionOverlay();
  paintOverlayVisibility();
  paintOverlay();
}

function positionOverlay() {
  if (!overlayEl) return;
  const place = POSITIONS[state.config.overlay.position] || POSITIONS['top-right'];
  // Sólo hay botones que esquivar mientras jugás o estás en la sala.
  const crowded = state.view === 'game' || state.view === 'room';
  const rules = place(crowded ? hudClearance() : 14);
  overlayEl.style.top = '';
  overlayEl.style.bottom = '';
  overlayEl.style.left = '';
  overlayEl.style.right = '';
  for (const rule of rules.split(';')) {
    const [prop, value] = rule.split(':');
    if (prop && value) overlayEl.style[prop.trim()] = value.trim();
  }
}

function paintOverlayVisibility() {
  if (!overlayEl) return;
  const visible = state.overlayVisible && state.config.overlay.enabled;
  overlayEl.style.opacity = visible ? String(state.config.overlay.opacity) : '0';
  overlayEl.style.transform = visible ? 'scale(1)' : 'scale(.94)';
}

/** Escribe sólo si el texto cambió: un write igual también invalida pintura. */
function setValue(key, text) {
  const node = overlayValues.get(key);
  if (node && node.nodeValue !== text) node.nodeValue = text;
}

function paintOverlay() {
  if (!overlayEl) return;
  setValue('fps', state.fps ? String(state.fps) : '—');
  setValue('ping', state.ping == null ? '—' : `${state.ping} ms`);
  setValue('session', clock((Date.now() - state.startedAt) / 1000));
  setValue('clock', new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }));
}

function clock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

function rgbaOf(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Los avisos los muestra la interfaz del cliente, no el juego. Antes había dos
 * sistemas de carteles —uno dibujado acá en el medio de la pantalla y otro en
 * la esquina de la app— y una misma acción sacaba los dos.
 */
function notify(message, kind = '') {
  ipcRenderer.send('game:toast', { message, kind });
}

/* ------------------------------------------------------------------ *
 * Cartel de teclas (keystrokes) · VIP
 * ------------------------------------------------------------------ *
 * Cuatro flechas y un botón de patear, encima de la cancha, que se encienden
 * mientras la tecla está apretada.
 *
 * ── Muestra ACCIONES, no teclas ────────────────────────────────────────────
 *
 * Ésta es la decisión que define todo lo demás. Un cartel que dibuja «W A S D»
 * miente en cuanto alguien juega con las flechas, y HaxBall deja atar VARIAS
 * teclas a la misma acción (`player_keys` es `{ código: acción }`, y de fábrica
 * ya trae `ArrowUp` y `KeyW` las dos en `Up`). Así que la celda no es una tecla:
 * es una dirección, y se prende con cualquiera de las que estén atadas a ella.
 *
 * De ahí sale el resto:
 *
 *   · El mapa se lee del `player_keys` vivo, que es el que está usando el
 *     juego, y no de `config.keys` —que puede estar vacío, que quiere decir
 *     «los que tenga HaxBall».
 *   · Cada acción cuenta las teclas que la tienen apretada, no un booleano. Con
 *     `ArrowUp` y `KeyW` apretadas a la vez, soltar una sola no apaga la flecha.
 *
 * ── Por qué está en el documento de ARRIBA ─────────────────────────────────
 *
 * Como el overlay: la cancha es un canvas que se redibuja entero por cuadro y
 * cualquier cosa metida adentro del iframe entra en ese trabajo. Acá arriba es
 * una capa aparte que el compositor mueve sola.
 */

/** Lo que se dibuja, en orden de grilla. `null` es un hueco. */
const KEYSTROKE_CELLS = [
  [null, 'Up', null],
  ['Left', 'Down', 'Right']
];

/**
 * El dibujo de cada celda, en una caja de 24×24.
 *
 * Cada flecha son dos trazos: el palo, y la punta como una sola línea quebrada
 * que PASA por el extremo. Dibujar la punta como dos segmentos sueltos desde el
 * extremo deja el vértice sin unir —`stroke-linejoin` no une trazos distintos—
 * y a 20 px se le ve el escalón.
 */
const KEYSTROKE_ICONS = {
  Up: 'M12 18.5V5.5M6.4 11.1 12 5.5l5.6 5.6',
  Down: 'M12 5.5V18.5M6.4 12.9 12 18.5l5.6-5.6',
  Left: 'M18.5 12H5.5M11.1 6.4 5.5 12l5.6 5.6',
  Right: 'M5.5 12H18.5M12.9 6.4 18.5 12l-5.6 5.6'
};

let keysEl = null;
/** Acción → el nodo de su celda, para prenderla sin volver a buscarla. */
const keysCells = new Map();
/** Acción → los códigos de tecla que la tienen apretada AHORA. */
const keysHeld = new Map();
/** Código de tecla → acción, tal como lo tiene puesto el juego. */
let keysMap = {};

/** ¿Se dibuja? Necesita el rol activo, no sólo la casilla marcada. */
function keystrokesOn() {
  const cfg = (state.config.vip || {}).keystrokes;
  return !!(cfg && cfg.enabled);
}

/** El color del encendido: el elegido, o el acento del tema. */
function keystrokeColor() {
  const chosen = ((state.config.vip || {}).keystrokes || {}).color;
  return /^#[0-9a-f]{6}$/i.test(String(chosen || '')) ? chosen : currentPalette().accent;
}

/**
 * Relee qué tecla hace qué.
 *
 * Sale del localStorage del juego y no de `config.keys`: ahí un mapa vacío
 * significa «los que tenga HaxBall», y el cartel tiene que mostrar los que el
 * jugador está usando de verdad.
 */
function readKeyMap() {
  keysMap = haxball.parseKeys(readStorage(haxball.KEYS_KEY)) || haxball.DEFAULT_KEYS;
}

function buildKeystrokes() {
  if (keysEl) keysEl.remove();
  keysCells.clear();
  keysHeld.clear();
  keysEl = null;
  if (!document.body || !keystrokesOn()) return;

  readKeyMap();
  const cfg = state.config.vip.keystrokes;
  const scale = Math.min(1.6, Math.max(0.7, Number(cfg.scale) || 1));
  const side = Math.round(38 * scale);
  const gap = Math.round(5 * scale);
  const p = currentPalette();

  keysEl = document.createElement('div');
  keysEl.id = 'tvm-keystrokes';
  keysEl.style.cssText = `
    position:fixed;z-index:2147481900;pointer-events:none;
    /*
     * El valor "paint" NO va en contain: recorta a los hijos contra la caja del
     * cartel, y la luz de las teclas del borde es una sombra que se sale 14 px
     * para afuera — con recorte quedaba cortada en seco contra el canto.
     *
     * will-change lo saca a su propia capa del compositor. Sin eso, encender una
     * tecla ensucia la capa del documento de arriba, que ocupa la ventana entera
     * y está justo encima de la cancha.
     */
    contain:layout style;
    will-change:transform;
    display:flex;flex-direction:column;align-items:center;gap:${gap}px;
  `;

  const makeRow = () => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;gap:${gap}px;`;
    return row;
  };

  const radius = Math.round(9 * scale);
  const color = keystrokeColor();
  // Con las animaciones apagadas el encendido es instantáneo. No se pierde nada:
  // la luz sigue estando, sólo que sin los 90 ms de subida.
  const fade = state.config.appearance.animations ? 'transition:opacity .09s linear;' : '';

  /*
   * Cada tecla son DOS cajas: la apagada, que se dibuja una vez y no se toca
   * nunca más, y la encendida encima con `opacity:0`. Prender es subirle la
   * opacidad — y nada más.
   *
   * Ésta es la parte que importa de todo el cartel. La primera versión cambiaba
   * `background`, `border-color`, `color` y `box-shadow` con una transición, y
   * las cuatro son propiedades de PINTURA: cada cuadro de esa animación obliga a
   * volver a rasterizar la celda, sombra difuminada de 14 px incluida. Y en este
   * juego las direcciones se tocan y se sueltan varias veces por segundo, así
   * que la animación no terminaba nunca: era un rerasterizado permanente encima
   * de la cancha, y ahí se iban los cuadros.
   *
   * Con la capa aparte, la versión encendida se rasteriza UNA vez al construir
   * el cartel y después el compositor sólo la mezcla con más o menos opacidad,
   * sin repintar nada. Es la misma regla que el resto del cliente sigue desde
   * hace rato y que yo me salteé (ver el encabezado de `app.css`).
   */
  const makeCell = (action, width) => {
    const cell = document.createElement('div');
    cell.style.cssText = `
      position:relative;
      width:${width}px;height:${side}px;border-radius:${radius}px;
      display:flex;align-items:center;justify-content:center;
      background:${rgbaOf(p.bg, 0.5)};
      border:1px solid ${rgbaOf(p.text, 0.22)};
      color:${rgbaOf(p.text, 0.82)};
    `;

    const glow = document.createElement('div');
    glow.style.cssText = `
      position:absolute;
      /* -1 px para tapar exactamente el borde de la caja apagada, que si no se
         asoma por debajo del encendido. */
      inset:-1px;border-radius:${radius + 1}px;
      background:${rgbaOf(color, 0.34)};
      border:1px solid ${color};
      box-shadow:0 0 14px ${rgbaOf(color, 0.75)}, inset 0 0 12px ${rgbaOf(color, 0.35)};
      opacity:0;
      /* Que se rasterice una vez y quede en su propia capa del compositor. */
      will-change:opacity;
      ${fade}
    `;
    cell.append(glow);
    // Lo que se guarda es la capa encendida: es lo único que se toca al pintar.
    if (action) keysCells.set(action, glow);
    return cell;
  };

  for (const line of KEYSTROKE_CELLS) {
    const row = makeRow();
    for (const action of line) {
      if (!action) {
        // Un hueco del mismo tamaño: la flecha de arriba tiene que quedar
        // centrada sobre la de abajo, y sin esto se apoya contra la izquierda.
        const hole = document.createElement('div');
        hole.style.cssText = `width:${side}px;height:${side}px;`;
        row.append(hole);
        continue;
      }
      const cell = makeCell(action, side);
      cell.append(keystrokeIcon(KEYSTROKE_ICONS[action], scale));
      row.append(cell);
    }
    keysEl.append(row);
  }

  if (cfg.showKick) {
    const wide = side * 3 + gap * 2;
    const kick = makeCell('Kick', wide);
    kick.append(kickIcon(scale));
    keysEl.append(kick);
  }

  keysEl.addEventListener('pointerdown', (e) => safe(startKeystrokeDrag, e));
  document.body.append(keysEl);
  placeKeystrokes();
  // Reconstruirlo mientras se está acomodando no puede apagarle el modo mover:
  // cambiar el color o el tamaño desde el panel rehace el cartel entero.
  setKeystrokesMoveMode(keysMoving);
  paintKeystrokes();
}

/** Una flecha. Trazo grueso y puntas redondeadas, como el resto de los iconos. */
function keystrokeIcon(path, scale) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(Math.round(20 * scale)));
  svg.setAttribute('height', String(Math.round(20 * scale)));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.1');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Posicionado para que quede POR ENCIMA de la capa encendida: entre un
  // elemento posicionado y uno que no lo está, gana el posicionado sin importar
  // el orden del DOM, y la luz le pasaba por arriba al dibujo.
  svg.style.cssText = 'position:relative;';
  svg.innerHTML = `<path d="${path}"/>`;
  return svg;
}

/**
 * El símbolo de patear: la pelota saliendo, con las marcas del golpe atrás.
 *
 * Un dibujo y no la letra de la tecla, por lo mismo que las flechas: patear se
 * puede tener en X, en espacio, en Ctrl o en Shift —de fábrica están las cuatro
 * a la vez— así que no hay ninguna letra que sea «la» tecla de patear.
 *
 * Las marcas van en abanico y de largos distintos. Antes eran tres rayas rectas,
 * paralelas y del mismo largo, y a este tamaño eso no se lee como un golpe: se
 * lee como el icono de un menú al lado de un círculo.
 */
function kickIcon(scale) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 34 24');
  svg.setAttribute('width', String(Math.round(30 * scale)));
  svg.setAttribute('height', String(Math.round(21 * scale)));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Igual que las flechas: posicionado para quedar arriba de la luz.
  svg.style.cssText = 'position:relative;';
  svg.innerHTML =
    '<circle cx="23.5" cy="12" r="6.6"/>' +
    '<path d="M11.5 7.4h3.4M5.5 12h9M11.5 16.6h3.4"/>';
  return svg;
}

/** La posición es porcentaje del viewport: ver el comentario en `store.js`. */
function placeKeystrokes() {
  if (!keysEl) return;
  const cfg = state.config.vip.keystrokes;
  keysEl.style.left = `${Math.min(97, Math.max(0, Number(cfg.x) || 0))}%`;
  keysEl.style.top = `${Math.min(97, Math.max(0, Number(cfg.y) || 0))}%`;
}

/** Repinta todas las celdas según lo que esté apretado. */
function paintKeystrokes() {
  for (const action of keysCells.keys()) paintKeystroke(action);
}

/**
 * Prender o apagar una tecla.
 *
 * Una sola propiedad, y a propósito: `opacity` la resuelve el compositor sin
 * repintar nada. Todo el aspecto del encendido ya está dibujado en la capa de
 * arriba desde que se construyó el cartel (ver `makeCell`).
 */
function paintKeystroke(action) {
  const glow = keysCells.get(action);
  if (!glow) return;
  const on = (keysHeld.get(action) || new Set()).size > 0;
  const value = on ? '1' : '0';
  // Escribir el mismo valor también invalida estilo: se mira antes.
  if (glow.style.opacity !== value) glow.style.opacity = value;
}

/**
 * Una tecla se apretó o se soltó.
 *
 * @param {string} code   `event.code`, que es la tecla FÍSICA — que es con lo
 *                        que HaxBall arma `player_keys`.
 * @param {boolean} down
 */
function trackKey(code, down) {
  if (!keysEl) return;
  const action = keysMap[code];
  if (!action || !keysCells.has(action)) return;

  let held = keysHeld.get(action);
  if (!held) keysHeld.set(action, (held = new Set()));

  const before = held.size;
  if (down) held.add(code);
  else held.delete(code);
  // Sólo se repinta cuando la celda cambia de estado: con la tecla apretada,
  // `keydown` se repite decenas de veces por segundo.
  if ((before > 0) !== (held.size > 0)) paintKeystroke(action);
}

/** Al perder el foco no llega ningún `keyup`: se apaga todo o quedan prendidas. */
function releaseAllKeys() {
  if (!keysEl) return;
  for (const held of keysHeld.values()) held.clear();
  paintKeystrokes();
}

/**
 * Escucha en un documento.
 *
 * En captura y sin tocar el evento: esto MIRA lo que pasa, no lo decide. Un
 * `preventDefault()` acá dejaría al jugador sin poder moverse.
 */
const keyWatched = new WeakSet();

function watchKeystrokes(doc) {
  if (!doc || keyWatched.has(doc)) return;
  keyWatched.add(doc);
  doc.addEventListener('keydown', (e) => safe(trackKey, e.code, true), true);
  doc.addEventListener('keyup', (e) => safe(trackKey, e.code, false), true);
}

/* ── Moverlo por la pantalla ───────────────────────────────────────────────
 *
 * Mientras dura el modo mover, el cartel recibe el puntero y se arrastra. El
 * cómo está en `makeDragger`, acá abajo, que lo comparte con el de música. */

let keysMoving = false;

/* ── Acomodar un cartel ─────────────────────────────────────────────────── *
 *
 * Son dos los carteles que se acomodan arrastrándolos —el de teclas y el de
 * música— y el gesto es exactamente el mismo, así que las dos piezas que lo
 * hacen están escritas una sola vez y se arman con el cartel que corresponda.
 */

/**
 * Terminar de acomodar con un clic en cualquier otro lado.
 *
 * Antes la única salida era volver al panel y tocar el mismo botón, que para
 * entonces podía estar diciendo cualquier cosa (ver el comentario de
 * `paintKeysMoveButton` en app.js). Un clic afuera es lo que hace cualquier cosa
 * que se acomoda, y de paso el modo no puede quedarse encendido sin que se note.
 *
 * La trampa que obliga a escribir esto: hay que escuchar en DOS documentos. El
 * cartel vive en el de arriba, pero todo lo que pasa sobre la cancha se lo queda
 * el iframe del juego y arriba no llega nada. Y el del juego se recrea en cada
 * recarga, así que se anotan para poder soltarlos y volver a engancharlos.
 *
 * @param {() => Element|null} getEl  el cartel, preguntado en el momento
 * @param {() => void} onOutside      qué hacer cuando el clic cayó afuera
 * @returns {(on: boolean) => void}   enciende y apaga la escucha
 */
function makeOutsideWatch(getEl, onOutside) {
  const docs = new Set();
  const handler = (event) => {
    const el = getEl();
    // El clic que agarra el cartel para arrastrarlo no es "afuera".
    if (el && event.target && el.contains(event.target)) return;
    onOutside();
  };

  return (on) => {
    for (const doc of docs) doc.removeEventListener('pointerdown', handler, true);
    docs.clear();
    if (!on) return;
    for (const doc of [document, gameDocument()]) {
      if (!doc || docs.has(doc)) continue;
      // En captura: el juego se queda con sus propios clics, y esto sólo mira.
      doc.addEventListener('pointerdown', handler, true);
      docs.add(doc);
    }
  };
}

const watchKeystrokesOutside = makeOutsideWatch(() => keysEl, () => {
  setKeystrokesMoveMode(false);
  ipcRenderer.send('keystrokes:move-off');
});

function setKeystrokesMoveMode(on) {
  keysMoving = !!on;
  watchKeystrokesOutside(keysMoving && !!keysEl);
  if (!keysEl) return;
  keysEl.style.pointerEvents = keysMoving ? 'auto' : 'none';
  keysEl.style.cursor = keysMoving ? 'move' : '';
  keysEl.style.outline = keysMoving ? `2px dashed ${keystrokeColor()}` : '';
  keysEl.style.outlineOffset = keysMoving ? '6px' : '';
}

/**
 * El arrastre.
 *
 * Va con PointerEvents y captura, y ése es el punto importante: el juego vive en
 * un iframe, así que apenas el mouse pasa por encima de la cancha los
 * `mousemove` se los queda el iframe y el documento de arriba deja de enterarse
 * — el cartel se quedaba pegado a mitad de camino. `setPointerCapture` redirige
 * todos los eventos del gesto al mismo elemento, pase por encima de lo que pase.
 *
 * @param {() => Element|null} getEl
 * @param {() => boolean} enabled  si el modo acomodar está puesto
 * @param {(at: {x:number, y:number}) => void} save
 */
function makeDragger(getEl, enabled, save) {
  return (event) => {
    const el = getEl();
    if (!enabled() || !el) return;
    event.preventDefault();

    const box = el.getBoundingClientRect();
    const grabX = event.clientX - box.left;
    const grabY = event.clientY - box.top;
    el.setPointerCapture(event.pointerId);

    const move = (e) => {
      const x = ((e.clientX - grabX) / window.innerWidth) * 100;
      const y = ((e.clientY - grabY) / window.innerHeight) * 100;
      el.style.left = `${Math.min(97, Math.max(0, x))}%`;
      el.style.top = `${Math.min(97, Math.max(0, y))}%`;
    };

    const drop = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', drop);
      el.removeEventListener('pointercancel', drop);
      // Se guarda lo que quedó dibujado, no lo que se calculó: es lo que se ve.
      save({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) });
    };

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
  };
}

const startKeystrokeDrag = makeDragger(
  () => keysEl,
  () => keysMoving,
  (at) => ipcRenderer.send('keystrokes:moved', at)
);

/* ------------------------------------------------------------------ *
 * El cartel de música
 * ------------------------------------------------------------------ *
 * Qué está sonando y los tres botones, flotando sobre la cancha y arrastrable a
 * donde el jugador quiera. Sólo lo ve quien lo tiene puesto.
 *
 * Vive acá —en el documento de arriba del webview del juego— y no en la interfaz
 * del cliente por la misma razón que el cartel de teclas: la interfaz está
 * DETRÁS del juego mientras jugás, y en pantalla completa ni siquiera hay barra.
 * Acá está encima de la cancha, siempre.
 *
 * Los datos no salen de ningún lado de este proceso: los manda el proceso
 * principal (`game:music`), que es el que habla con el reproductor. Ver
 * ytmusic.js.
 *
 * ── Lo único delicado: el foco ─────────────────────────────────────────────
 *
 * El cartel está en el documento de ARRIBA y la cancha adentro del iframe. Un
 * clic en un botón se lleva el foco fuera del iframe, y desde ahí HaxBall no
 * recibe una tecla más: al que está jugando eso se le ve como que el cliente le
 * colgó el juego por haber tocado «siguiente». Se resuelve con dos capas, y las
 * dos hacen falta — `preventDefault()` en el `pointerdown` evita que el foco se
 * MUEVA (es lo que hace el navegador al apretar sobre algo enfocable), y el
 * `focusPitch()` de después lo devuelve si algo igual se lo llevó.
 */

let musicEl = null;
/** Los nodos que se repintan. Se guardan para no volver a buscarlos. */
let musicParts = null;
let musicMoving = false;
/** El reloj del tiempo transcurrido. Sólo gira con algo sonando. */
let musicTicker = null;
/** Animación continua de la barra, ejecutada por el compositor. */
let musicProgressAnimation = null;
/** A qué volumen vuelve el altavoz si se lo había dejado en cero. */
let musicLastVolume = 0.5;
/**
 * Hasta cuándo el cartel no le hace caso al volumen que llega de afuera.
 *
 * El sondeo es de uno por segundo y el dato tarda en ir y volver: mientras se
 * arrastraba la barra llegaba el volumen de hace un instante y la barrita
 * saltaba para atrás abajo del mouse. Mientras el jugador toca —y un rato
 * después, lo que tarda la página en aplicar y el sondeo en leerlo— manda lo
 * que se ve acá.
 */
let musicVolumeHold = 0;
/** El último envío de volumen y el que quedó esperando: uno por píxel es de más. */
let musicVolumeSentAt = 0;
let musicVolumeTimer = null;
/** Hasta cuándo se ve el porcentaje arriba de la barra. */
let musicAdjustTimer = null;
/** El color de la tapa que suena, sacado de la tapa misma. */
const musicAmbient = { for: '', rgb: null };

/** Lo último que mandó el proceso principal. */
let musicNow = {
  ready: false, signedIn: null, playing: false,
  title: '', artist: '', videoId: '', art: '', artUrl: '', position: 0, duration: 0, at: 0,
  volume: 1, muted: false
};

function musicHudOn() {
  const cfg = state.config.music;
  return !!(cfg && cfg.enabled && cfg.hud && cfg.hud.enabled);
}

/**
 * Devolverle el teclado al juego. Ver el encabezado de esta sección.
 */
function focusPitch() {
  try {
    const frame = document.querySelector('iframe.gameframe') || document.querySelector('iframe[src*="game"]');
    if (frame && frame.contentWindow) frame.contentWindow.focus();
  } catch { /* otro origen */ }
}

/*
 * Cada icono es lo que se RELLENA y, si hace falta, lo que se traza. Los dos,
 * porque el altavoz es las dos cosas: el cono es una forma cerrada y las ondas
 * son arcos abiertos, que rellenados se ven como manchas.
 */
const MUSIC_ICONS = {
  prev: { fill: 'M6.5 6h2.2v12H6.5zM19 6.4v11.2a.6.6 0 0 1-.93.5L10 12.5a.6.6 0 0 1 0-1L18.07 5.9a.6.6 0 0 1 .93.5z' },
  play: { fill: 'M8.6 5.6v12.8a.7.7 0 0 0 1.06.6l10.2-6.4a.7.7 0 0 0 0-1.2L9.66 5a.7.7 0 0 0-1.06.6z' },
  pause: { fill: 'M7.4 5.8h3.2v12.4H7.4zM13.4 5.8h3.2v12.4h-3.2z' },
  next: { fill: 'M15.3 6h2.2v12h-2.2zM5 6.4v11.2a.6.6 0 0 0 .93.5L14 12.5a.6.6 0 0 0 0-1L5.93 5.9a.6.6 0 0 0-.93.5z' },
  volume: {
    fill: 'M4.4 9.4h3.3L12 5.9v12.2L7.7 14.6H4.4z',
    stroke: 'M14.8 9.7a3.2 3.2 0 0 1 0 4.6M17.3 7.4a6.6 6.6 0 0 1 0 9.2'
  },
  volumeLow: {
    fill: 'M4.4 9.4h3.3L12 5.9v12.2L7.7 14.6H4.4z',
    stroke: 'M14.8 9.7a3.2 3.2 0 0 1 0 4.6'
  },
  muted: {
    fill: 'M4.4 9.4h3.3L12 5.9v12.2L7.7 14.6H4.4z',
    stroke: 'M15.2 10.2l4.4 3.6M19.6 10.2l-4.4 3.6'
  },
  note: {
    fill: 'M9 17.2a2.6 2.6 0 1 1-1.4-2.3V6.6l9.8-2v10.6a2.6 2.6 0 1 1-1.4-2.3V7.9L9 9.2z'
  }
};

function musicIcon(icon, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const partes = [];
  if (icon && icon.fill) partes.push(`<path d="${icon.fill}" fill="currentColor"/>`);
  if (icon && icon.stroke) {
    partes.push(
      `<path d="${icon.stroke}" fill="none" stroke="currentColor" stroke-width="1.9" ` +
      'stroke-linecap="round" stroke-linejoin="round"/>'
    );
  }
  svg.innerHTML = partes.join('');
  return svg;
}

/** `#rrggbb` → `r, g, b`, que es lo que piden las variables de la hoja. */
function musicChannels(hex, fallback = '124, 58, 237') {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  return m ? m.slice(1).map((h) => parseInt(h, 16)).join(', ') : fallback;
}

/** Mezcla de dos `#rrggbb`, en proporción `t` del segundo. */
function musicMix(a, b, t) {
  const pa = musicChannels(a, '').split(', ').map(Number);
  const pb = musicChannels(b, '').split(', ').map(Number);
  if (pa.length !== 3 || pb.length !== 3 || pa.some(Number.isNaN) || pb.some(Number.isNaN)) return musicChannels(a);
  return pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(', ');
}

const MUSIC_STYLE_ID = 'tvm-music-style';

/**
 * La hoja del cartel.
 *
 * Va en una hoja y no en estilos sueltos, como iba antes, por lo que los estilos
 * sueltos no tienen: `:hover` con transición, estados por clase y `@keyframes`
 * para el ecualizador. Los colores y la escala llegan por variables desde
 * `buildMusicHud`, así que cambiar de tema o de tamaño no toca la hoja.
 *
 * Todo lo que se mueve se mueve con `transform` u `opacity`, que las resuelve
 * el compositor: el cartel está encima de la cancha y un repintado acá es un
 * repintado sobre la capa del juego. Nada de `backdrop-filter`, por lo mismo.
 *
 * (Sin comillas invertidas en esta hoja: vive adentro de un template literal.)
 */
function ensureMusicStyle() {
  if (document.getElementById(MUSIC_STYLE_ID)) return;
  const u = (n) => `calc(${n}px * var(--s))`;
  const style = document.createElement('style');
  style.id = MUSIC_STYLE_ID;
  style.textContent = `
    #tvm-music {
      --s: 1; --v: 1;
      position: fixed; z-index: 2147481890; pointer-events: none;
      contain: layout style; will-change: transform;
      display: flex; align-items: center; gap: ${u(12)};
      padding: ${u(8)} ${u(12)} ${u(8)} ${u(8)};
      border-radius: ${u(8)};
      background:
        linear-gradient(90deg, rgba(var(--amb), .26), rgba(var(--amb), 0) 55%),
        rgba(var(--bg), .88);
      border: 1px solid rgba(var(--fg), .1);
      box-shadow:
        0 1px 0 rgba(255, 255, 255, .05) inset,
        0 ${u(16)} ${u(34)} ${u(-16)} rgba(0, 0, 0, .8);
      color: rgba(var(--fg), .95);
      font-family: ${roomUi.FONT_STACK};
      -webkit-font-smoothing: antialiased;
      user-select: none;
      transition: background .6s ease;
    }
    #tvm-music.is-compact { padding: ${u(6)} ${u(10)}; gap: ${u(6)}; }
    #tvm-music.is-compact .tvm-m-art,
    #tvm-music.is-compact .tvm-m-info { display: none; }

    /* La tapa, con el ecualizador en la esquina mientras suena. */
    #tvm-music .tvm-m-art {
      position: relative; flex: none;
      width: ${u(46)}; height: ${u(46)};
      border-radius: ${u(4)};
      background: rgba(var(--fg), .08) center / cover no-repeat;
      box-shadow:
        0 0 0 1px rgba(var(--fg), .08) inset,
        0 ${u(6)} ${u(14)} ${u(-6)} rgba(0, 0, 0, .75);
      display: flex; align-items: center; justify-content: center;
      color: rgba(var(--fg), .45);
      transition: filter .3s ease;
    }
    #tvm-music:not(.is-playing) .tvm-m-art { filter: saturate(.5) brightness(.78); }
    #tvm-music .tvm-m-art > svg { display: none; }
    #tvm-music .tvm-m-art.is-empty > svg { display: block; }
    #tvm-music .tvm-m-eq {
      position: absolute; right: ${u(4)}; bottom: ${u(4)};
      display: flex; align-items: flex-end; gap: ${u(1.5)};
      height: ${u(9)}; padding: ${u(2)} ${u(3)};
      border-radius: ${u(2)};
      background: rgba(0, 0, 0, .6);
      opacity: 0; transition: opacity .2s ease;
    }
    #tvm-music.is-playing .tvm-m-eq { opacity: 1; }
    #tvm-music .tvm-m-eq > i {
      width: ${u(2)}; height: 100%; border-radius: 1px;
      background: rgb(var(--acc2));
      transform-origin: bottom center; transform: scaleY(.35);
    }
    #tvm-music.is-playing:not(.no-anim) .tvm-m-eq > i { animation: tvmMusicEq .9s ease-in-out infinite alternate; }
    #tvm-music.is-playing:not(.no-anim) .tvm-m-eq > i:nth-child(2) { animation-duration: .64s; animation-delay: -.3s; }
    #tvm-music.is-playing:not(.no-anim) .tvm-m-eq > i:nth-child(3) { animation-duration: 1.1s; animation-delay: -.7s; }
    @keyframes tvmMusicEq { from { transform: scaleY(.25); } to { transform: scaleY(1); } }

    /* Título, artista y el progreso con los dos tiempos. */
    #tvm-music .tvm-m-info {
      min-width: 0; width: ${u(172)}; flex: none;
      display: flex; flex-direction: column;
    }
    #tvm-music .tvm-m-title {
      font-size: ${u(13)}; font-weight: 650; line-height: 1.25; letter-spacing: -.005em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #tvm-music .tvm-m-artist {
      margin-top: ${u(1)};
      font-size: ${u(11)}; line-height: 1.25;
      color: rgba(var(--fg), .62);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #tvm-music .tvm-m-progress {
      margin-top: ${u(6)};
      display: flex; align-items: center; gap: ${u(6)};
      font-size: ${u(9.5)}; line-height: 1;
      color: rgba(var(--fg), .5);
      font-variant-numeric: tabular-nums;
    }
    #tvm-music.is-idle .tvm-m-progress { visibility: hidden; }
    #tvm-music.is-ad .tvm-m-artist { color: rgb(var(--acc2)); }
    #tvm-music.is-ad .tvm-m-progress { opacity: .45; }
    #tvm-music .tvm-m-rail {
      flex: 1; height: ${u(3)}; border-radius: 1px;
      background: rgba(var(--fg), .14); overflow: hidden;
    }
    #tvm-music .tvm-m-fill {
      height: 100%; width: 100%;
      background: linear-gradient(90deg, rgb(var(--acc)), rgb(var(--acc2)));
      transform: scaleX(0); transform-origin: left center; will-change: transform;
    }

    /* Los mandos. El play es el único relleno: es el que se busca con el ojo. */
    #tvm-music .tvm-m-controls { flex: none; display: flex; align-items: center; gap: ${u(4)}; }
    #tvm-music button {
      pointer-events: auto; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      padding: 0; border: 0; border-radius: ${u(5)};
      background: transparent; color: rgba(var(--fg), .8);
      outline: none; -webkit-app-region: no-drag;
      transition: background-color .15s ease, color .15s ease, transform .12s ease;
    }
    #tvm-music button:hover { background: rgba(var(--fg), .12); color: rgb(var(--fg)); }
    #tvm-music button:active { transform: scale(.9); }
    #tvm-music .tvm-m-skip { width: ${u(28)}; height: ${u(28)}; }
    #tvm-music .tvm-m-play {
      width: ${u(34)}; height: ${u(34)};
      background: rgb(var(--fg)); color: rgb(var(--bg));
    }
    #tvm-music .tvm-m-play:hover { background: rgb(var(--fg)); color: rgb(var(--bg)); transform: scale(1.06); }
    #tvm-music .tvm-m-play:active { transform: scale(.94); }

    /* El volumen: altavoz, barra con perilla y el porcentaje mientras se toca. */
    #tvm-music .tvm-m-vol { display: flex; align-items: center; gap: ${u(2)}; margin-left: ${u(2)}; }
    #tvm-music .tvm-m-speaker { width: ${u(26)}; height: ${u(26)}; }
    #tvm-music .tvm-m-vrail {
      position: relative; pointer-events: auto; cursor: pointer;
      width: ${u(58)}; height: ${u(18)};
      display: flex; align-items: center;
    }
    #tvm-music.is-compact .tvm-m-vrail { width: ${u(46)}; }
    #tvm-music .tvm-m-vtrack {
      width: 100%; height: ${u(3)}; border-radius: 1px;
      background: rgba(var(--fg), .2); overflow: hidden;
    }
    #tvm-music .tvm-m-vfill {
      height: 100%; width: 100%;
      background: rgba(var(--fg), .85);
      transform: scaleX(var(--v)); transform-origin: left center;
      transition: background-color .15s ease, opacity .15s ease;
    }
    #tvm-music .tvm-m-vrail:hover .tvm-m-vfill,
    #tvm-music.is-adjusting .tvm-m-vfill { background: rgb(var(--acc2)); }
    #tvm-music.is-muted .tvm-m-vfill { opacity: .3; }
    #tvm-music .tvm-m-knob {
      position: absolute; top: 50%; left: calc(var(--v) * 100%);
      width: ${u(10)}; height: ${u(10)};
      margin: ${u(-5)} 0 0 ${u(-5)};
      border-radius: ${u(2)};
      background: rgb(var(--fg));
      box-shadow: 0 1px 4px rgba(0, 0, 0, .55);
      transform: scale(0); transition: transform .12s ease;
      pointer-events: none;
    }
    #tvm-music .tvm-m-vrail:hover .tvm-m-knob,
    #tvm-music.is-adjusting .tvm-m-knob { transform: scale(1); }
    #tvm-music.is-muted .tvm-m-knob { transform: scale(0); }
    #tvm-music .tvm-m-bubble {
      position: absolute; bottom: calc(100% + ${u(5)}); left: calc(var(--v) * 100%);
      padding: ${u(2)} ${u(6)};
      border-radius: ${u(3)};
      background: rgba(var(--bg), .96);
      border: 1px solid rgba(var(--fg), .14);
      font-size: ${u(10)}; font-weight: 650; line-height: 1.35;
      font-variant-numeric: tabular-nums; white-space: nowrap;
      color: rgb(var(--fg));
      transform: translate(-50%, ${u(3)}); opacity: 0;
      transition: opacity .15s ease, transform .15s ease;
      pointer-events: none;
    }
    #tvm-music.is-adjusting .tvm-m-bubble { opacity: 1; transform: translate(-50%, 0); }
  `;
  (document.head || document.documentElement).append(style);
}

/**
 * El color de la tapa, para teñir el cartel.
 *
 * Sólo con la tapa que bajó el proceso principal (`data:`): una imagen de otro
 * origen deja el canvas «manchado» y `getImageData` tira. Se achica a 12×12 y se
 * promedia dándole más peso a los píxeles con color, porque el promedio parejo
 * de casi cualquier tapa es un gris marrón. Después se lo lleva a un brillo
 * medio: sobre fondo oscuro, un color muy oscuro no se ve y uno muy claro lava
 * el texto.
 */
function sampleArtColor(src, done) {
  if (typeof src !== 'string' || !src.startsWith('data:image/')) return done(null);
  const img = new Image();
  img.onload = () => {
    try {
      const n = 12;
      const canvas = document.createElement('canvas');
      canvas.width = n;
      canvas.height = n;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, n, n);
      const d = ctx.getImageData(0, 0, n, n).data;
      let r = 0; let g = 0; let b = 0; let w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const max = Math.max(d[i], d[i + 1], d[i + 2]);
        const min = Math.min(d[i], d[i + 1], d[i + 2]);
        const sat = max ? (max - min) / max : 0;
        const light = (max + min) / 510;
        const weight = 0.08 + sat * Math.max(0, 1 - Math.abs(light - 0.5) * 1.6);
        r += d[i] * weight; g += d[i + 1] * weight; b += d[i + 2] * weight; w += weight;
      }
      if (!w) return done(null);
      let rgb = [r / w, g / w, b / w];
      const max = Math.max(...rgb);
      const target = 190;
      if (max > 0) rgb = rgb.map((v) => Math.min(255, v * (target / max)));
      done(rgb.map((v) => Math.round(v)).join(', '));
    } catch {
      done(null);
    }
  };
  img.onerror = () => done(null);
  img.src = src;
}

function refreshMusicAmbient() {
  const src = musicNow.art || '';
  if (src === musicAmbient.for) return;
  musicAmbient.for = src;
  musicAmbient.rgb = null;
  if (musicEl) musicEl.style.setProperty('--amb', musicEl.style.getPropertyValue('--acc'));
  sampleArtColor(src, (rgb) => {
    // Puede haber cambiado de tema mientras tanto: vale la última tapa.
    if (musicAmbient.for !== src) return;
    musicAmbient.rgb = rgb;
    if (musicEl && rgb) musicEl.style.setProperty('--amb', rgb);
  });
}

function buildMusicHud() {
  if (musicEl) musicEl.remove();
  musicEl = null;
  musicParts = null;
  clearInterval(musicTicker);
  musicTicker = null;
  if (musicProgressAnimation) musicProgressAnimation.cancel();
  musicProgressAnimation = null;
  if (!document.body || !musicHudOn()) return;

  ensureMusicStyle();
  ensureFontFace(document);
  const cfg = state.config.music.hud;
  const scale = musicScale();
  const p = currentPalette();
  const px = (n) => Math.round(n * scale);

  musicEl = document.createElement('div');
  musicEl.id = 'tvm-music';
  musicEl.classList.toggle('is-compact', !!cfg.compact);
  // El interruptor global de animaciones manda también sobre el ecualizador.
  musicEl.classList.toggle('no-anim', !state.config.appearance.animations);
  const accent = musicChannels(p.accent);
  musicEl.style.setProperty('--s', String(scale));
  musicEl.style.setProperty('--fg', musicChannels(p.text, '240, 240, 244'));
  musicEl.style.setProperty('--bg', musicChannels(p.bg, '12, 12, 15'));
  musicEl.style.setProperty('--acc', accent);
  musicEl.style.setProperty('--acc2', p.duo ? musicChannels(p.accent2) : musicMix(p.accent, '#ffffff', 0.3));
  musicEl.style.setProperty('--amb', musicAmbient.rgb || accent);

  const art = document.createElement('div');
  art.className = 'tvm-m-art is-empty';
  art.append(musicIcon(MUSIC_ICONS.note, px(20)));
  const eq = document.createElement('div');
  eq.className = 'tvm-m-eq';
  eq.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  art.append(eq);

  const info = document.createElement('div');
  info.className = 'tvm-m-info';
  const title = document.createElement('div');
  title.className = 'tvm-m-title';
  const artist = document.createElement('div');
  artist.className = 'tvm-m-artist';

  /*
   * La barrita de progreso se mueve con `transform:scaleX`, no con `width`.
   * Cambiar el ancho es maquetar y repintar cuatro veces por segundo encima de
   * la cancha; una escala la resuelve el compositor sin tocar nada.
   */
  const progress = document.createElement('div');
  progress.className = 'tvm-m-progress';
  const elapsed = document.createElement('span');
  elapsed.textContent = '0:00';
  const rail = document.createElement('div');
  rail.className = 'tvm-m-rail';
  const fill = document.createElement('div');
  fill.className = 'tvm-m-fill';
  rail.append(fill);
  const total = document.createElement('span');
  total.textContent = '0:00';
  progress.append(elapsed, rail, total);
  info.append(title, artist, progress);

  const controls = document.createElement('div');
  controls.className = 'tvm-m-controls';

  const makeButton = (className, label, icon, size, onClick) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.append(musicIcon(icon, px(size)));
    // Ver «Lo único delicado: el foco», arriba.
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      safe(onClick);
      focusPitch();
    });
    return btn;
  };

  const prev = makeButton('tvm-m-skip', 'Anterior', MUSIC_ICONS.prev, 15,
    () => ipcRenderer.send('music:cmd', { kind: 'prev' }));
  const play = makeButton('tvm-m-play', 'Reproducir o pausar', MUSIC_ICONS.play, 17,
    () => ipcRenderer.send('music:cmd', { kind: 'playpause' }));
  const next = makeButton('tvm-m-skip', 'Siguiente', MUSIC_ICONS.next, 15,
    () => ipcRenderer.send('music:cmd', { kind: 'next' }));

  /*
   * El altavoz silencia de verdad, con el botón de YouTube Music: el volumen
   * queda guardado adentro y la pestaña muestra lo mismo (ver `muteScript` en
   * ytmusic.js). Si el volumen estaba en cero, en cambio, lo devuelve a donde
   * estaba: un altavoz que «saca del silencio» a un cero no hace nada.
   */
  const speaker = makeButton('tvm-m-speaker', 'Silenciar', MUSIC_ICONS.volume, 15, () => {
    const v = Number(musicNow.volume) || 0;
    if (!musicNow.muted && v === 0) {
      setMusicVolumeLocal(musicLastVolume || 0.5, true);
      return;
    }
    musicNow.muted = !musicNow.muted;
    holdMusicVolume(1500);
    paintMusicVolume();
    flashMusicAdjust();
    ipcRenderer.send('music:cmd', { kind: 'mute', value: musicNow.muted });
  });

  /*
   * La barra de volumen.
   *
   * Es un `<div>` y no un `<input type=range>`: el rango del navegador se roba
   * el foco al agarrarlo, y llevarse el foco de la cancha es dejar al jugador
   * sin teclas (ver el encabezado de esta sección). Con un div y `pointerdown`
   * + captura, el foco no se mueve de donde estaba.
   */
  const vol = document.createElement('div');
  vol.className = 'tvm-m-vol';
  const vrail = document.createElement('div');
  vrail.className = 'tvm-m-vrail';
  const vtrack = document.createElement('div');
  vtrack.className = 'tvm-m-vtrack';
  const vfill = document.createElement('div');
  vfill.className = 'tvm-m-vfill';
  vtrack.append(vfill);
  const knob = document.createElement('div');
  knob.className = 'tvm-m-knob';
  const bubble = document.createElement('div');
  bubble.className = 'tvm-m-bubble';
  vrail.append(vtrack, knob, bubble);
  vol.append(speaker, vrail);

  const volumeAt = (clientX) => {
    const box = vtrack.getBoundingClientRect();
    if (!box.width) return null;
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  };
  vrail.addEventListener('pointerdown', (e) => {
    // Ni el foco ni el arrastre del cartel: este gesto es sólo del volumen.
    e.preventDefault();
    e.stopPropagation();
    if (musicMoving) return;
    const set = (ev, final) => {
      const v = volumeAt(ev.clientX);
      if (v !== null) setMusicVolumeLocal(v, final);
    };
    vrail.setPointerCapture(e.pointerId);
    // Mientras el dedo esté en la barra, lo que llega de afuera no la mueve.
    musicVolumeHold = Infinity;
    musicEl.classList.add('is-adjusting');
    set(e, false);
    const move = (ev) => set(ev, false);
    const drop = (ev) => {
      vrail.removeEventListener('pointermove', move);
      vrail.removeEventListener('pointerup', drop);
      vrail.removeEventListener('pointercancel', drop);
      musicVolumeHold = 0;
      if (ev.type === 'pointerup') set(ev, true);
      holdMusicVolume(1500);
      flashMusicAdjust();
      focusPitch();
    };
    vrail.addEventListener('pointermove', move);
    vrail.addEventListener('pointerup', drop);
    vrail.addEventListener('pointercancel', drop);
  });

  controls.append(prev, play, next, vol);

  /*
   * Y la rueda del mouse sobre el cartel, que es como se le baja el volumen a
   * cualquier reproductor. Un paso de rueda es 5%: de a 1% hacían falta cien
   * vueltas para ir de mudo a fuerte. Un touchpad manda pasos chicos y se
   * acumulan en proporción. `passive:false` porque hay que frenar el scroll.
   */
  musicEl.addEventListener('wheel', (e) => {
    if (musicMoving) return;
    e.preventDefault();
    const pasos = Math.max(-4, Math.min(4, -e.deltaY / 100));
    setMusicVolumeLocal((Number(musicNow.volume) || 0) + pasos * 0.05, false);
  }, { passive: false });

  musicEl.append(art, info, controls);
  musicEl.addEventListener('pointerdown', (e) => safe(startMusicDrag, e));
  document.body.append(musicEl);

  musicParts = {
    art, title, artist, fill, elapsed, total, play, speaker, bubble,
    artSrc: null, playIcon: null, speakerIcon: null
  };
  placeMusicHud();
  // Rehacerlo mientras se está acomodando no puede apagarle el modo mover:
  // cambiar el tamaño desde el panel rehace el cartel entero.
  setMusicMoveMode(musicMoving);
  paintMusicHud();
}

function placeMusicHud() {
  if (!musicEl) return;
  const cfg = state.config.music.hud;
  musicEl.style.left = `${Math.min(97, Math.max(0, Number(cfg.x) || 0))}%`;
  musicEl.style.top = `${Math.min(97, Math.max(0, Number(cfg.y) || 0))}%`;
}

/** Cambia un texto sólo si cambió: esto corre con cada aviso del sondeo. */
function setMusicText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Todo lo que cambia de tema a tema. La barrita la lleva `syncMusicProgressAnimation`. */
function paintMusicHud() {
  if (!musicEl || !musicParts) return;
  const nothing = !musicNow.title;

  setMusicText(musicParts.title, nothing ? 'YouTube Music' : musicNow.title);
  setMusicText(musicParts.artist, nothing
    ? (musicNow.signedIn === false ? 'Sin sesión · entrá desde la pestaña Música' : 'Nada sonando')
    : musicNow.artist);
  musicEl.classList.toggle('is-idle', nothing);
  musicEl.classList.toggle('is-playing', !!musicNow.playing && !musicNow.ad && !nothing);
  musicEl.classList.toggle('is-ad', !!musicNow.ad);

  /*
   * La tapa: primero la que bajó el proceso principal (`data:`), y si esa no
   * está, la URL cruda. Ver `resolveArt` en ytmusic.js — este documento es el de
   * haxball.com, que no manda ninguna CSP, así que la puede pedir él mismo.
   */
  const tapa = musicNow.art || musicNow.artUrl || '';
  if (tapa !== musicParts.artSrc) {
    musicParts.artSrc = tapa;
    musicParts.art.style.backgroundImage = tapa ? `url("${tapa.replace(/"/g, '%22')}")` : 'none';
    musicParts.art.classList.toggle('is-empty', !tapa);
  }
  refreshMusicAmbient();

  // El botón central dice qué va a PASAR, no qué está pasando.
  const playIcon = musicNow.playing ? 'pause' : 'play';
  if (musicParts.playIcon !== playIcon) {
    musicParts.playIcon = playIcon;
    musicParts.play.replaceChildren(musicIcon(MUSIC_ICONS[playIcon], Math.round(17 * musicScale())));
    musicParts.play.title = musicNow.playing ? 'Pausar' : 'Reproducir';
  }

  paintMusicVolume();
  syncMusicTicker();
  syncMusicProgressAnimation();
  tickMusicProgress();
}

/**
 * El altavoz, la barrita y el porcentaje.
 *
 * Va aparte de `paintMusicHud` porque se repinta sola mientras se arrastra el
 * volumen, sin esperar a que el sondeo confirme: un control que tarda un segundo
 * en moverse se siente roto aunque haga lo que tiene que hacer. La barrita y la
 * perilla leen `--v`, así que es una sola variable y no dos estilos.
 */
function paintMusicVolume() {
  if (!musicEl || !musicParts) return;
  const mudo = !!musicNow.muted;
  const v = Math.min(1, Math.max(0, Number(musicNow.volume) || 0));

  musicEl.style.setProperty('--v', v.toFixed(3));
  musicEl.classList.toggle('is-muted', mudo);

  const icon = mudo || v === 0 ? 'muted' : v < 0.45 ? 'volumeLow' : 'volume';
  if (musicParts.speakerIcon !== icon) {
    musicParts.speakerIcon = icon;
    musicParts.speaker.replaceChildren(musicIcon(MUSIC_ICONS[icon], Math.round(15 * musicScale())));
    musicParts.speaker.title = mudo ? 'Quitar silencio' : 'Silenciar';
  }
  setMusicText(musicParts.bubble, mudo ? 'Silenciado' : `${Math.round(v * 100)}%`);
}

function holdMusicVolume(ms) {
  if (musicVolumeHold !== Infinity) musicVolumeHold = Math.max(musicVolumeHold, Date.now() + ms);
}

/** Muestra el porcentaje un momento; mientras se arrastra, queda. */
function flashMusicAdjust() {
  if (!musicEl) return;
  musicEl.classList.add('is-adjusting');
  clearTimeout(musicAdjustTimer);
  musicAdjustTimer = setTimeout(() => {
    if (musicEl && musicVolumeHold !== Infinity) musicEl.classList.remove('is-adjusting');
  }, 900);
}

/**
 * Manda el volumen, de a uno cada 60 ms como mucho.
 *
 * Arrastrando llegaban cien por segundo, y cada uno es un `executeJavaScript`
 * en la página de YouTube Music. El último siempre sale: es el que queda.
 */
function sendMusicVolume(v, now) {
  clearTimeout(musicVolumeTimer);
  const go = () => {
    musicVolumeTimer = null;
    musicVolumeSentAt = Date.now();
    ipcRenderer.send('music:cmd', { kind: 'volume', value: v });
  };
  const wait = 60 - (Date.now() - musicVolumeSentAt);
  if (now || wait <= 0) go();
  else musicVolumeTimer = setTimeout(go, wait);
}

/** Un volumen pedido desde el cartel: se ve en el acto y sale para la página. */
function setMusicVolumeLocal(value, final) {
  const v = Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 100) / 100;
  musicNow.volume = v;
  musicNow.muted = false;
  if (v > 0) musicLastVolume = v;
  holdMusicVolume(1500);
  paintMusicVolume();
  flashMusicAdjust();
  sendMusicVolume(v, final);
}

function musicScale() {
  return Math.min(1.6, Math.max(0.7, Number(state.config.music.hud.scale) || 1));
}

/**
 * El reloj gira SÓLO con algo sonando. La barra no depende del intervalo: su
 * animación vive en el compositor; este reloj sólo cambia el texto del tiempo.
 *
 * Con la partida en curso, un intervalo que corre para siempre encima de la
 * cancha es exactamente lo que este cliente pasó meses sacando. Pausado no hay
 * nada que interpolar.
 */
function syncMusicTicker() {
  const wanted = !!(musicEl && musicNow.playing && musicNow.duration > 0);
  if (wanted === !!musicTicker) return;
  if (!wanted) {
    clearInterval(musicTicker);
    musicTicker = null;
    return;
  }
  musicTicker = setInterval(() => safe(tickMusicProgress), 250);
}

/**
 * Segundos actuales interpolados desde la última lectura real del reproductor.
 *
 * El proceso principal sondea una vez por segundo: dibujar la posición tal cual
 * llega se ve a los saltos. Lo que se dibuja es el último dato MÁS lo que pasó
 * desde que se leyó, que es lo que hace cualquier reproductor.
 */
function musicProgressSeconds() {
  const total = Number(musicNow.duration) || 0;
  if (!total) return 0;
  // Con un anuncio sonando la posición del tema no avanza (ver READ en ytmusic.js).
  const since = musicNow.playing && !musicNow.ad && musicNow.at ? (Date.now() - musicNow.at) / 1000 : 0;
  return Math.min(total, Math.max(0, (Number(musicNow.position) || 0) + since));
}

function formatMusicTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const s = String(seconds % 60).padStart(2, '0');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${s}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}`;
}

/** Lleva la barra hasta el final con una sola animación barata y continua. */
function syncMusicProgressAnimation() {
  if (!musicParts) return;
  if (musicProgressAnimation) musicProgressAnimation.cancel();
  musicProgressAnimation = null;

  const total = Number(musicNow.duration) || 0;
  const at = musicProgressSeconds();
  const ratio = total > 0 ? Math.min(1, Math.max(0, at / total)) : 0;
  musicParts.fill.style.transform = `scaleX(${ratio.toFixed(6)})`;
  if (!musicNow.playing || musicNow.ad || total <= at) return;

  musicProgressAnimation = musicParts.fill.animate(
    [
      { transform: `scaleX(${ratio.toFixed(6)})` },
      { transform: 'scaleX(1)' }
    ],
    {
      duration: Math.max(1, (total - at) * 1000),
      easing: 'linear',
      fill: 'forwards'
    }
  );
}

function tickMusicProgress() {
  if (!musicParts) return;
  const total = Number(musicNow.duration) || 0;
  /*
   * Con un anuncio, el renglón del artista dice cuánto le falta. El título y la
   * tapa ya son los del tema que viene, así que se entiende qué está pasando.
   */
  if (musicNow.ad && musicNow.title) {
    const left = Math.max(0, (Number(musicNow.adLeft) || 0) - (musicNow.playing && musicNow.at ? (Date.now() - musicNow.at) / 1000 : 0));
    setMusicText(musicParts.artist, `Publicidad · termina en ${formatMusicTime(Math.ceil(left))}`);
  }
  // No se toca el DOM cuatro veces por segundo si el segundo visible no cambió.
  setMusicText(musicParts.elapsed, formatMusicTime(musicProgressSeconds()));
  setMusicText(musicParts.total, formatMusicTime(total));
}

function setMusicMoveMode(on) {
  musicMoving = !!on;
  watchMusicOutside(musicMoving && !!musicEl);
  if (!musicEl) return;
  musicEl.style.pointerEvents = musicMoving ? 'auto' : '';
  musicEl.style.cursor = musicMoving ? 'move' : '';
  musicEl.style.outline = musicMoving ? `2px dashed ${currentPalette().accent}` : '';
  musicEl.style.outlineOffset = musicMoving ? '6px' : '';
}

const watchMusicOutside = makeOutsideWatch(() => musicEl, () => {
  setMusicMoveMode(false);
  ipcRenderer.send('music:move-off');
});

const startMusicDrag = makeDragger(
  () => musicEl,
  () => musicMoving,
  (at) => ipcRenderer.send('music:moved', at)
);

/** Llega del proceso principal cada vez que cambia algo que se ve. */
function onMusicState(next) {
  const beforeTrack = musicNow.videoId || `${musicNow.title || ''}\u0001${musicNow.artist || ''}`;
  const afterTrack = next
    ? (next.videoId || `${next.title || ''}\u0001${next.artist || ''}`)
    : beforeTrack;
  // Defensa visual inmediata: aunque YouTube entregue durante un cuadro la
  // duración anterior, un tema distinto nunca puede heredar su barra completa.
  if (musicParts && beforeTrack && afterTrack !== beforeTrack) {
    if (musicProgressAnimation) musicProgressAnimation.cancel();
    musicProgressAnimation = null;
    musicParts.fill.style.transform = 'scaleX(0)';
    setMusicText(musicParts.elapsed, '0:00');
  }
  /*
   * Con el jugador tocando el volumen, el que llega de afuera es viejo: se
   * queda el de acá (ver `musicVolumeHold`). Todo lo demás —tema, tapa,
   * progreso— entra igual.
   */
  const holding = Date.now() < musicVolumeHold;
  const mine = { volume: musicNow.volume, muted: musicNow.muted };
  musicNow = next ? { ...next } : musicNow;
  if (holding) Object.assign(musicNow, mine);
  if (!musicEl) return buildMusicHud();
  paintMusicHud();
}

/* ------------------------------------------------------------------ *
 * 6 · Telemetría
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 * Limitador de cuadros
 * ------------------------------------------------------------------ *
 * El problema, medido sobre el propio game-min.js:
 *
 *   sf(){ this.Re = window.requestAnimationFrame(M(this,this.sf));
 *         this.za.A(); this.Rc() }
 *   Rc(){ let a = performance.now();
 *         1 == m.j.Qh.v() && 28.333 > a - this.hd || (this.hd=a, this.Bd++,
 *                                                     ..., this.l.A(this.za)) }
 *
 * O sea: HaxBall dibuja en CADA rAF. Su propio "fps_limit" sólo hace algo
 * cuando vale 1, y ahí tira a ~35 cuadros. Con "sin límite" no hay freno
 * ninguno: la tasa la decide enteramente Chromium.
 *
 * De ahí salían los dos problemas:
 *
 *   · Sacar sólo el V-Sync deja el limitador del compositor puesto, así que
 *     rAF sigue llegando al refresco del monitor: 144 y no se mueve de ahí.
 *   · Sacar también el limitador (--disable-frame-rate-limit) manda rAF a mil y
 *     pico por segundo. El redibujado completo del canvas corre en el mismo
 *     hilo que el input y el netcode, y los deja sin tiempo. Eso es el delay.
 *
 * La solución es hacer las dos cosas: se le sacan los dos frenos a Chromium y
 * el techo lo pone el cliente, envolviendo `requestAnimationFrame`. Así se
 * pasa de 144 sin llegar a fundir la CPU.
 *
 * El bucle se re-arma con `window.requestAnimationFrame` en cada cuadro, así
 * que alcanza con reemplazar esa función. `cancelAnimationFrame` se envuelve
 * también: el juego lo usa al salir de la partida (`cancelAnimationFrame(this.Re)`)
 * y sin esto el bucle seguiría corriendo para siempre.
 */

/**
 * El ritmo se saca del refresco real del monitor, que el proceso principal lee
 * con `screen.getPrimaryDisplay().displayFrequency`.
 *
 * ── Por qué 1,5× y no 2,5× con piso de 240 ──────────────────────────────────
 *
 * Ese era el techo anterior y era demasiado. Dos motivos, los dos medidos:
 *
 *   · El piso de 240 no miraba el monitor. En una pantalla de 60 Hz forzaba
 *     CUATRO veces el refresco; en una de 143 Hz el multiplicador daba 358
 *     cuadros por segundo. HaxBall redibuja el canvas entero —1360×818— en cada
 *     uno de esos cuadros, y eso es lo que aparecía como "mucho uso de CPU".
 *
 *   · Lo que se gana al pasar del refresco es que el cuadro que la pantalla
 *     muestra sea más nuevo. Esa ganancia se agota rapidísimo: de 1× a 1,5× se
 *     recorta la mayor parte de la espera; de 1,5× a 2,5× quedan décimas de
 *     milisegundo, a cambio de dibujar un 66% más. Es un mal cambio, y a partir
 *     de cierto punto se da vuelta —el redibujado le come el tiempo al input y
 *     al netcode, que corren en el mismo hilo— que es exactamente lo que ya
 *     habíamos medido cuando esto corría sin ningún techo.
 *
 * A 143 Hz esto pasa de 358 a 215 cuadros por segundo; a 60 Hz, de 240 a 90.
 */
/** Cuadros cuando NO estás jugando: lista de salas, menús, panel abierto. */
const IDLE_FPS = 60;

/**
 * Cuadros con la ventana minimizada.
 *
 * Es el mismo número, pero por otro motivo y con otra condición, así que va
 * aparte: el techo de reposo depende de `unlockFps` y de estar fuera de la
 * cancha; éste se aplica siempre, porque minimizado no hay nada que mirar y lo
 * que se está protegiendo es el REGRESO — ver el comentario de `minimize` en
 * main.js, que es donde está la explicación de la pantalla negra.
 */
const MINIMIZED_FPS = 60;

/**
 * Cuadros con la pestaña ATRÁS de otra.
 *
 * Mucho menos que minimizado, y a propósito: minimizado se está protegiendo el
 * regreso; acá se está dejando la CPU y la GPU para la pestaña que sí se ve, y
 * el jugador puede quedarse así una partida entera. A este ritmo HaxBall sigue
 * simulando —hace varios pasos por cuadro para ponerse al día, es cómo trabaja
 * su bucle— y la conexión con la sala no se entera. No se baja a cero: sin
 * ningún cuadro el bucle del juego se detiene del todo y al volver hay que
 * resincronizar con el host, que es lo que se ve como un salto.
 */
const BACKGROUND_FPS = 10;

/**
 * Milisegundos mínimos entre cuadros. `0` = sin techo, el rAF va derecho.
 *
 * El techo lo elige el jugador (Rendimiento → Techo de cuadros) con los mismos
 * valores que el cliente Zero, y como allá **sólo frena hacia abajo**: quien
 * hace que se pueda pasar del refresco del monitor es `unlockFps`, que apaga el
 * V-Sync desde main.js. Los dos son independientes a propósito —se puede poner
 * un techo de 60 con el V-Sync puesto, y sirve igual.
 */
let cachedFrameBudgetMs = 0;

function refreshFrameBudget() {
  const perf = state.config.perf || {};

  const cap = Number(perf.fpsCap) || 0;
  let budget = cap > 0 ? 1000 / cap : 0;

  /*
   * Fuera de la cancha alcanza con 60: el jugador está mirando la lista de
   * salas o un panel del cliente, y el proceso de GPU que los dibuja es el
   * mismo que atiende al juego.
   */
  if (perf.unlockFps && (state.view !== 'game' || state.clientPanelOpen)) {
    // El más restrictivo de los dos gana: presupuesto más grande = menos cuadros.
    budget = Math.max(budget, 1000 / IDLE_FPS);
  }

  // Minimizado, sin mirar `unlockFps`: acá no se está ahorrando para que la
  // partida vaya mejor, se está dejando la GPU libre para el primer cuadro de
  // cuando vuelva. Nadie está viendo la cancha mientras tanto.
  if (state.minimized) budget = Math.max(budget, 1000 / MINIMIZED_FPS);

  // Atrás de otra pestaña, lo mismo pero más: ver `BACKGROUND_FPS`.
  if (state.background) budget = Math.max(budget, 1000 / BACKGROUND_FPS);

  cachedFrameBudgetMs = budget;
}

function frameBudgetMs() {
  return cachedFrameBudgetMs;
}

const limitedWindows = new WeakSet();

/**
 * El techo se aplica salteando cuadros, y saltear un cuadro tiene una trampa.
 *
 * HaxBall re-arma el bucle desde ADENTRO de su propio callback, en la primera
 * línea:
 *
 *   sf(){ this.Re = window.requestAnimationFrame(M(this,this.sf)); ... }
 *
 * Así que el que no llama al callback no está salteando el dibujo: está
 * apagando el bucle. Nadie pide el cuadro siguiente y la cancha queda congelada
 * para siempre — con el panel del cliente abierto, al primer salto.
 *
 * Por eso, cuando salteamos, el que vuelve a pedir el cuadro somos nosotros.
 *
 * Lo mismo hace el cliente Zero, pero al revés: como ellos sirven su propia
 * copia de game-min.js, meten el `if (saltar) return` DESPUÉS del re-armado y
 * listo. Nosotros cargamos el game-min.js real de haxball.com, así que el
 * re-armado lo tenemos que sostener desde afuera.
 */
function installFrameLimiter(win) {
  if (!win || limitedWindows.has(win)) return;

  /*
   * Se instala siempre, no sólo con `unlockFps`. Dos motivos:
   *
   *   · El techo también sirve con el V-Sync puesto (elegir 60 en un monitor de
   *     144 Hz es una razón válida para entrar acá).
   *   · Cambiar el techo desde el panel tiene que aplicarse en el momento. Si el
   *     envoltorio dependiera de una bandera leída al arrancar, pasar de "sin
   *     límite" a 60 no haría nada hasta reiniciar.
   *
   * Cuando no hay techo, `frameBudgetMs()` da 0 y el callback va derecho al rAF
   * real: el costo es una llamada por cuadro.
   */
  const realRaf = win.requestAnimationFrame;
  const realCancel = win.cancelAnimationFrame;
  if (typeof realRaf !== 'function' || typeof realCancel !== 'function') return;
  limitedWindows.add(win);

  /*
   * Cada bucle lleva su propio reloj. Con uno solo compartido, dos bucles de
   * animación en el mismo documento —el del juego y el contador de cuadros— se
   * roban los cuadros entre sí y cada uno termina a la mitad del techo.
   *
   * Un rAF pedido desde adentro de un callback es ese bucle re-armándose, así
   * que hereda el reloj; uno pedido desde afuera arranca un bucle nuevo.
   */
  let running = null;

  /*
   * Handle que conoce el que pidió el cuadro → su bucle.
   *
   * Hace falta porque al saltear nos re-armamos con un handle que el juego no
   * vio nunca, y su `cancelAnimationFrame(this.Re)` de la salida quedaría
   * cancelando uno viejo: el bucle seguiría girando después del partido.
   *
   * Guarda una sola entrada por bucle vivo —la del handle que el que pidió el
   * cuadro tiene en la mano ahora mismo—, y la suelta cuando pide el siguiente
   * o cuando el bucle se termina.
   */
  const chains = new Map();

  win.requestAnimationFrame = function (callback) {
    // Sin techo no hay nada que envolver: el callback va derecho al rAF real.
    if (frameBudgetMs() <= 0) return realRaf.call(win, callback);

    const chain = running || { last: 0, pending: 0, owned: 0, cancelled: false };

    const step = (now) => {
      if (chain.cancelled) return;

      const budget = frameBudgetMs();
      if (budget > 0 && now - chain.last < budget - 0.2) {
        // Salteamos el dibujo, no el bucle. Ojo: se mueve `pending`, no
        // `owned`. El juego sigue con el handle viejo y tiene que servirle.
        chain.pending = realRaf.call(win, step);
        return;
      }

      chain.last = now;
      const armed = chain.owned;
      const previous = running;
      running = chain;
      try {
        callback(now);
      } finally {
        running = previous;
      }
      // Si el callback no volvió a pedir cuadro, el bucle terminó acá. Sin esto
      // el mapa se llenaría con cada rAF de una sola vez que haya en la página.
      if (chain.owned === armed) chains.delete(armed);
    };

    if (chain.owned) chains.delete(chain.owned);
    chain.pending = realRaf.call(win, step);
    chain.owned = chain.pending;
    chains.set(chain.owned, chain);
    return chain.owned;
  };

  win.cancelAnimationFrame = function (handle) {
    const chain = chains.get(handle);
    if (chain) {
      chain.cancelled = true;
      chains.delete(handle);
      realCancel.call(win, chain.pending);
      return;
    }
    realCancel.call(win, handle);
  };
}

/**
 * Contador de cuadros.
 *
 * Dos cosas que costaban caro y ya no:
 *
 * 1. **Corría en el documento de arriba, no en el del juego.** El contador se
 *    re-agenda solo en cada cuadro, así que obligaba a ESE documento a producir
 *    cuadros a la tasa del monitor, para siempre. Y arriba no se mueve nada:
 *    ahí sólo vive el overlay, que se repinta una vez por segundo. Eran dos
 *    bucles de animación en el mismo proceso — el del juego, que sirve, y éste,
 *    que no dibujaba nada. Ahora cuenta sobre la ventana del juego, que es la
 *    que ya está produciendo cuadros: se cuelga de los que hay en vez de pedir
 *    los suyos.
 *
 * 2. **Corría aunque nadie mirara el número.** Se encendía en la sala y en la
 *    partida, tuviera o no el overlay encendido. Ahora corre sólo si el overlay
 *    está puesto, con los FPS activados, y estando en la cancha: en la sala no
 *    se dibuja nada, así que contar cuadros ahí no significa nada.
 */
let fpsMeterOn = false;

function fpsMeterWanted() {
  const cfg = state.config.overlay || {};
  return state.view === 'game' && !!cfg.enabled && !!cfg.showFps;
}

function syncFpsMeter() {
  const wanted = fpsMeterWanted();
  if (wanted === fpsMeterOn) return;
  fpsMeterOn = wanted;
  if (wanted) runFpsMeter();
  else state.fps = 0;
}

function runFpsMeter() {
  const doc = gameDocument();
  const win = (doc && doc.defaultView) || window;
  let frames = 0;
  let last = win.performance.now();
  const tick = (now) => {
    if (!fpsMeterOn) return; // fuera de la cancha se corta el bucle
    frames++;
    if (now - last >= 1000) {
      state.fps = Math.round((frames * 1000) / (now - last));
      frames = 0;
      last = now;
    }
    win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);
}

/**
 * HaxBall no expone el ping por API, así que se lee de la pantalla. Hay dos
 * lugares distintos y antes sólo se miraba uno:
 *
 *   · En la SALA, la lista de jugadores lo trae por jugador
 *     (`.player-list-item [data-hook="ping"]`, un número pelado).
 *   · En la PARTIDA esa lista no existe. El ping vive en el recuadro de
 *     estadísticas —`.stats-view [data-hook="ping"]`— y con otro formato:
 *     "Ping: 10 - 22" (mínimo y máximo entre los pares).
 *
 * Como el overlay se mira justamente mientras se juega, leyendo sólo la lista
 * el ping quedaba en "—" todo el partido. Se prueban los dos, la partida
 * primero.
 */
function readPing() {
  const doc = gameDocument();
  if (!doc) return null;

  try {
    const stats = doc.querySelector('.stats-view [data-hook="ping"]');
    if (stats) {
      // Del "Ping: 10 - 22" se toma el máximo, que es el que se sufre.
      const numbers = (stats.textContent || '').match(/\d+/g);
      if (numbers && numbers.length) {
        const worst = Math.max(...numbers.map(Number));
        if (worst >= 0 && worst < 2000) return worst;
      }
    }

    for (const node of doc.querySelectorAll('.player-list-item [data-hook="ping"]')) {
      const value = parseInt((node.textContent || '').trim(), 10);
      if (Number.isFinite(value) && value >= 0 && value < 2000) return value;
    }
  } catch { /* el iframe puede estar recargando */ }
  return null;
}

/**
 * Telemetría (ping, FPS y tiempo de sesión).
 *
 * Corre SÓLO dentro de una sala o partida, que es donde se mira el overlay.
 * Antes era un intervalo eterno: una vez por segundo recorría el DOM del juego
 * buscando el ping, repintaba el overlay y cruzaba un mensaje al proceso
 * principal — estando quieto en la lista de salas, donde no hay ni ping ni
 * overlay que mostrar. Un latido por segundo también alcanza para que el motor
 * no baje nunca a reposo.
 */
let telemetryTimer = null;

function syncTelemetry() {
  const wanted = state.view === 'game' || state.view === 'room';
  if (wanted === !!telemetryTimer) return;

  if (!wanted) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
    state.ping = null;
    // La interfaz apaga sus indicadores en vez de dejar el último valor colgado.
    ipcRenderer.send('game:telemetry', { fps: 0, ping: null, playing: false });
    return;
  }

  const tick = () => {
    state.ping = readPing();
    paintOverlay();
    ipcRenderer.send('game:telemetry', {
      fps: state.fps,
      ping: state.ping,
      seconds: Math.round((Date.now() - state.startedAt) / 1000),
      playing: state.playing
    });
  };
  telemetryTimer = setInterval(tick, 1000);
  tick();
}

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */
function safe(fn, ...args) {
  try {
    return fn(...args);
  } catch (err) {
    log('error', err && err.message ? err.message : String(err));
  }
}

function log(level, message, source = 'cliente') {
  ipcRenderer.send('game:log', { level, message, source, at: Date.now() });
}

function whenBodyReady(cb) {
  if (document.body) return cb();
  document.addEventListener('DOMContentLoaded', cb, { once: true });
}

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */
function boot() {
  try {
    const res = ipcRenderer.sendSync('game:bootstrap');
    if (!res || !res.ok) throw new Error((res && res.error) || 'bootstrap falló');
    state.config = res.data.config;
    state.displayHz = res.data.displayHz || 60;
    state.devMode = !!res.data.devMode;
  } catch (err) {
    console.error('[TVM] no se pudo obtener la configuración:', err);
    return;
  }

  syncCanvasHotFlags();
  refreshFrameBudget();

  // Antes que nada: quedarse con lo que el jugador ya tenía y después dejar la
  // config donde HaxBall la va a leer.
  safe(adoptExistingSettings);
  const written = writeGameSettings();
  if (written) log('info', `${written} ajustes de HaxBall aplicados`, 'juego');

  // El documento de arriba comparte proceso y fuente de cuadros con el juego:
  // si acá se pidieran cuadros sin techo, el freno del iframe no serviría.
  installFrameLimiter(window);
  applyCleanMode(state.config.appearance.cleanMode);

  whenBodyReady(() => {
    applyCleanMode(state.config.appearance.cleanMode);
    buildOverlay();
    // El cartel de teclas necesita saber si el rol está activo, y eso lo tiene
    // el proceso principal: se pide ahora y se dibuja cuando conteste.
    ipcRenderer.send('game:want-vip');
    watchKeystrokes(document);
    /*
     * El cartel de música. Se dibuja con lo último que se sepa y se pide el
     * estado en el acto: este documento se rehace en cada carga del juego —o
     * sea, cada vez que entrás a una sala— y el proceso principal ya venía
     * escuchando lo que suena desde antes.
     */
    safe(buildMusicHud);
    ipcRenderer.send('music:want-state');
    // Soltar todo al perder el foco: sin ventana activa no llega ningún `keyup`
    // y las teclas que estaban apretadas quedarían encendidas para siempre.
    window.addEventListener('blur', () => safe(releaseAllKeys));
    watchGame();
    reportGeo();
    reportAuth();
    reportAvatar();
    reportKeys();
    setTimeout(reportGeo, 1500);
    setTimeout(reportGeo, 4000);
    setTimeout(reportGeo, 7000);
    setTimeout(reportAuth, 4000); // la identidad se genera en el primer arranque
    window.addEventListener('keydown', onKeyDown, HOTKEY_OPTS);
    // El avatar animado quedaba guardado pero no se volvía a arrancar al abrir
    // la app: la animación se perdía en cada reinicio.
    syncAvatar();
    log('info', 'Motor listo', 'juego');
  });

  /**
   * La interfaz abrió (o cerró) un panel encima. Mientras esté abierto, la
   * cancha baja el ritmo: el jugador está mirando el panel, y el proceso de GPU
   * que lo tiene que dibujar es el mismo que atiende al juego.
   */
  ipcRenderer.on('game:ui-panel', (_e, abierto) => {
    state.clientPanelOpen = !!abierto;
    refreshFrameBudget();
  });

  /**
   * La ventana se minimizó o volvió. Minimizada, la cancha baja a 60: ver
   * `frameBudgetMs()` y el comentario de `minimize` en main.js.
   */
  ipcRenderer.on('game:minimized', (_e, minimizada) => {
    state.minimized = !!minimizada;
    refreshFrameBudget();
  });

  /**
   * Esta pestaña pasó atrás de otra, o volvió al frente. Al volver se vuelve a
   * estirar la cancha (atrás el iframe se dejó sin tamaño, ver
   * `applyGameViewport`) y se pide el cuadro con el ritmo normal.
   */
  ipcRenderer.on('game:background', (_e, background) => {
    const next = !!background;
    if (next === state.background) return;
    state.background = next;
    refreshFrameBudget();
    safe(applyGameViewport);
    // Al irse atrás, las teclas que estuvieran apretadas quedarían prendidas:
    // el `keyup` va a llegar a la pestaña nueva, no a ésta.
    if (next) safe(releaseAllKeys);
  });

  /** Esta pestaña pasó al frente: la sala en la que está vuelve a ser «la sala». */
  ipcRenderer.on('game:report-room', () => safe(reportRoomInfo, state.view));

  ipcRenderer.on('game:viewport', (_e, layout) => {
    gameViewport = {
      enabled: !!(layout && layout.enabled),
      width: Math.max(1, Number(layout && layout.width) || 16),
      height: Math.max(1, Number(layout && layout.height) || 9)
    };
    safe(applyGameViewport);
  });

  window.addEventListener('resize', () => safe(applyGameViewport));

  /*
   * Segunda fuente para lo mismo, y no está de más.
   *
   * El techo de minimizado es lo único que puede dejar la partida clavada en 60
   * cuadros sin que nadie se dé cuenta, así que no depende de que llegue un solo
   * aviso. Si el documento se ve, la ventana no está minimizada: eso es seguro y
   * no hay carrera posible.
   *
   * Va con el evento y no mirando `document.hidden` de a ratos a propósito: si
   * en algún Electron el documento de un <webview> no cambiara de visibilidad al
   * minimizar, esto simplemente no se dispara nunca y el aviso del proceso
   * principal sigue mandando, en vez de apagar el techo de un lado y del otro.
   */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      state.minimized = false;
      refreshFrameBudget();
    }
  });

  /** El veredicto del rol. Es lo que habilita el cartel de teclas. */
  ipcRenderer.on('game:vip', (_e, activo) => {
    const antes = state.vip;
    state.vip = !!activo;
    safe(buildKeystrokes);
    if (antes === state.vip) return;
    // Tu fila: el diamante y el color dependen del rol (ver `selfPeer`).
    safe(paintPeersNow);
  });

  /**
   * Los cuadros del avatar animado.
   *
   * Vienen por IPC y no por el `<img>` que ya carga la imagen porque de un
   * `<img>` no se pueden sacar: `drawImage` devuelve siempre el mismo cuadro
   * (medido). Hay que leer el archivo y decodificarlo, y eso es lo que hace
   * `gif.js` con estos bytes.
   */
  ipcRenderer.on('game:avatar-gif', (_e, payload) => {
    if (!payload || !payload.bytes) {
      // «No es un GIF» es una respuesta, no un error: se suelta lo animado pero
      // se deja anotado que ya se preguntó (`gifAsked`), o si no se vuelve a
      // preguntar por el mismo archivo en cada carga del juego.
      const preguntado = gifAsked;
      stopGifAvatar();
      gifAsked = preguntado;
      return;
    }
    gifBytes = new Uint8Array(payload.bytes);
    gifSrc = payload.file || '';
    safe(buildGifFrames);
  });

  ipcRenderer.on('game:ball-gif', (_e, payload) => {
    if (!payload || !payload.bytes) {
      // Igual que arriba: «no es un GIF» es una respuesta. Se suelta lo animado
      // pero queda anotado que ya se preguntó por este archivo.
      const preguntado = ballGifAsked;
      stopBallGif();
      ballGifAsked = preguntado;
      return;
    }
    ballGifBytes = new Uint8Array(payload.bytes);
    safe(buildBallFrames);
  });

  ipcRenderer.on('game:keystrokes-move', (_e, on) => safe(setKeystrokesMoveMode, on));

  /** Qué está sonando. Lo manda el proceso principal (ver ytmusic.js). */
  ipcRenderer.on('game:music', (_e, next) => safe(onMusicState, next));
  ipcRenderer.on('game:music-move', (_e, on) => safe(setMusicMoveMode, on));

  ipcRenderer.on('game:play-replay', (_e, replay) => safe(playReplay, replay));
  ipcRenderer.on('game:analyze-replay', () => {
    const summary = safe(analyzeReplay);
    ipcRenderer.send('game:replay-summary', summary || {
      ok: false,
      reason: 'El análisis de la grabación falló.'
    });
  });
  /* Saltar a un gol corta el carrete: son dos formas de manejar lo mismo y la
     última que se pide es la que manda. */
  ipcRenderer.on('game:seek-replay', (_e, { ms } = {}) => {
    safe(stopReel);
    safe(seekReplay, ms);
  });
  ipcRenderer.on('game:reel', (_e, { goals } = {}) => safe(startReel, goals));

  ipcRenderer.on('game:peers', (_e, list) => safe(setPeers, list));
  ipcRenderer.on('game:create-room', (_e, options) => safe(createRoom, options));
  ipcRenderer.on('game:moderate', (_e, action) => safe(moderateAll, action));
  ipcRenderer.on('game:avatar-preview', () => safe(applyStaticAvatar));

  ipcRenderer.on('game:zoom-factor', (_e, factor) => {
    state.config.appearance.gameZoom = zoomControl.normalize(factor);
    applyCameraZoom();
    const doc = gameDocument();
    if (doc && doc.defaultView && doc.defaultView.__tvmF && !doc.defaultView.__tvmF.cameraZoom) {
      ipcRenderer.send('game:toast', { message: 'El zoom no es compatible con esta versión del juego. Recargá para actualizar el parche.', kind: 'warn' });
    }
  });

  // La interfaz avisa cuando el usuario cambia algo.
  ipcRenderer.on('game:config', (_e, config) => {
    const beforeAvatar = JSON.stringify(state.config.avatar || {});
    const beforeImage = (state.config.vip || {}).avatarImage;
    /*
     * El color de la cancha vive DENTRO del cache del estadio, así que cambiarlo
     * no se ve hasta que el cache se rehace — y el cache está justamente hecho
     * para no rehacerse. Se anota qué había para poder tirarlo si cambió.
     *
     * El tema entra en la cuenta porque el modo «seguir el tema» saca el color
     * de ahí: cambiar de tema sin esto dejaba la cancha con el color anterior.
     */
    const beforeSkin = pitchSkinPrint();
    state.config = config;
    applyCameraZoom();
    syncCanvasHotFlags();
    refreshFrameBudget();

    writeGameSettings();
    applyCleanMode(config.appearance.cleanMode);
    buildOverlay();
    // Se rehace entero: cambiar el color, el tamaño o los controles cambia lo
    // que hay dibujado, y son cinco celdas.
    safe(buildKeystrokes);
    // Y el de música por lo mismo: encenderlo, apagarlo, el tamaño y el modo
    // compacto cambian la caja entera.
    safe(buildMusicHud);
    // Encender o apagar el overlay cambia si hace falta contar cuadros.
    syncFpsMeter();

    const doc = gameDocument();
    if (doc) {
      applyGameTheme(doc);
      applyClientStyles(doc);
      watchChatLog(doc);
      // Imagen nueva (o VIP recién activado): se recarga y se repinta el disco.
      if ((config.vip || {}).avatarImage !== beforeImage) {
        safe(loadAvatarImage, doc.defaultView);
      }
      /*
       * La pelota se recarga siempre, no sólo si cambió el archivo: el rol
       * también entra acá. Un VIP recién activado tiene el mismo `ballImage` de
       * antes, y si esto mirara sólo el nombre del archivo su GIF no empezaría a
       * moverse hasta la próxima carga del juego. Cuesta una comparación de
       * cadenas adentro de `loadBallImage`, que corta solo si no cambió nada.
       */
      safe(loadBallImage, doc.defaultView);
      if (pitchSkinPrint() !== beforeSkin) safe(flushStadiumCache, doc.defaultView);
      // Silenciar a alguien tiene que llevarse también lo que ya había dicho:
      // si no, queda su última frase en pantalla justo después de silenciarlo.
      safe(sweepMutedChat, doc);
    }

    if (JSON.stringify(config.avatar || {}) !== beforeAvatar) {
      syncAvatar();
      if (!config.avatar.animated) safe(applyStaticAvatar);
    }

    // Con otro nombre sos otra fila de la lista: hay que volver a decirlo o los
    // demás te seguirían buscando por el anterior. Y tu propia marca —el escudo
    // y tus colores— se repinta acá, que es donde llegan los cosméticos nuevos.
    safe(reportRoomInfo, state.view);
    if (doc) safe(paintPeers, doc);
  });
}

/*
 * Atrapar el error no es decorativo: sin esto, todo lo que viene después de la
 * línea que falló —el overlay, los atajos, los `ipcRenderer.on`— simplemente no
 * se engancha, y el cliente arranca a medias sin decir una palabra. Fue
 * exactamente así como pasó desapercibido que faltaba `installFrameLimiter`.
 *
 * Va con try/catch y no con `.catch`: `boot` es síncrona. Mientras se la llamó
 * como `boot().catch(…)` lo único que hacía era tirar un TypeError sobre
 * `undefined` en cada arranque, que es justamente lo que este bloque existe
 * para que no pase.
 */
try {
  boot();
} catch (err) {
  const detail = err && err.message ? err.message : String(err);
  console.error('[TVM] el arranque del juego falló:', err);
  log('error', `el arranque del juego falló: ${detail}`, 'juego');
}
