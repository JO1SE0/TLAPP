'use strict';

/**
 * YouTube Music adentro del cliente.
 *
 * ── Qué es esto, y qué no ──────────────────────────────────────────────────
 *
 * No hay ninguna API: YouTube Music no tiene una. Lo que hay es la web de
 * verdad, corriendo en una vista propia con su propia partición, y el cliente la
 * mira y le toca los botones desde afuera. Es lo mismo que hacen todos los
 * clientes de escritorio de YT Music y es la única forma que existe.
 *
 * Lo que se LEE sale de dos lugares, y ninguno es raspar HTML:
 *
 *   · `navigator.mediaSession.metadata` — título, artista y tapa. Es API
 *     estándar (la que hace andar las teclas de multimedia del teclado) y
 *     YouTube Music la mantiene al día sola. Medido contra la barra del
 *     reproductor: el DOM dice «Rick Astley • 1806 M de vistas • 19 M me
 *     gusta» y la MediaSession dice «Rick Astley».
 *   · El propio `<video>` — si está pausado, en qué segundo va, cuánto dura y
 *     a qué volumen.
 *
 * Lo que se MANDA son clics en los botones que ya están (`#play-pause-button`,
 * `.next-button`, `.previous-button`). Así el estado interno de la página queda
 * coherente, que es lo que no pasa llamando a `video.play()` por afuera.
 *
 * ── Por qué un `BrowserView` y no un `<webview>` ───────────────────────────
 *
 * Empezó siendo un `<webview>` adentro de la pestaña y no se veía NADA: la
 * página cargaba, ejecutaba, sonaba y contestaba el sondeo, pero el hueco estaba
 * en blanco. Medido con los dos embebidos del cliente en la misma corrida y con
 * el mismo tamaño de elemento:
 *
 *   el `<webview>` del juego  → el guest recibe 1264×693
 *   el `<webview>` de música  → el guest recibe 0×0
 *
 * O sea que dibujaba en una ventana de tamaño cero. Se probó todo lo que se
 * podía probar y ninguna explicaba la diferencia: mismo CSS que `.stage`
 * (absoluto, `contain`, capa propia), mismas `webPreferences` que el del juego
 * (con preload, sin sandbox, sin aislar), tamaño en píxeles en vez de
 * porcentaje, recrearlo con la pestaña ya visible, sacarle el `contain`,
 * colgarlo del `<body>`. Siempre 0×0.
 *
 * Un `BrowserView` no es un WebContents adentro de otro: es una vista que el
 * proceso principal pega sobre la ventana con `setBounds`, y su tamaño lo decide
 * el que la pega. No hay guest al que se le pueda perder la medida. Y no es una
 * pieza nueva: el cliente ya usa una para la verificación de Cloudflare, con las
 * mismas coordenadas sacadas del DOM (ver `openChallengeView` en main.js).
 *
 * Lo que se paga: la vista va SIEMPRE por encima del documento, así que cuando
 * no corresponde verla hay que mandarla lejos a mano (`hide()`), y la interfaz
 * tiene que avisar dónde quedó el hueco. Las dos cosas ya estaban resueltas para
 * la verificación.
 *
 * ── Por qué no hay un preload ──────────────────────────────────────────────
 *
 * Porque no hace falta. `webContents.executeJavaScript` corre en el mundo
 * principal de la página, así que ve la MediaSession y el `<video>` igual que un
 * preload — y sin un archivo más que empaquetar, sin bajarle `contextIsolation`
 * a una pestaña de Google y sin un canal de IPC nuevo. Un sondeo por segundo de
 * un script de diez líneas no se nota.
 *
 * ── El user-agent, que es lo único delicado ────────────────────────────────
 *
 * Electron pone `Electron/13.6.9` en el user-agent y Google lee eso. Medido
 * contra accounts.google.com, con la misma URL y la misma máquina:
 *
 *   con el token .... `flowName=WebLiteSignIn`  ← el flujo degradado que Google
 *                     le da a lo que toma por un navegador embebido, y donde
 *                     termina apareciendo el «este navegador puede no ser
 *                     seguro».
 *   sin el token .... `flowName=GlifWebSignIn`  ← el normal, el mismo de Chrome.
 *
 * Así que se le saca el token y NADA MÁS. No se inventa una versión de Chrome
 * que no somos: la cadena que queda es la de Chromium de verdad, la que este
 * binario podría sostener si alguien le preguntara. Mentir de más también sale
 * caro — YouTube sirve el JavaScript según la versión que uno diga, y decirle
 * que somos un Chrome de dentro de dos años es pedirle código que este motor no
 * sabe leer.
 *
 * ── Y la sesión es de acá, no del juego ────────────────────────────────────
 *
 * Partición aparte (`persist:ytmusic`). Tu cuenta de Google no tiene nada que
 * ver con HaxBall: sus cookies no se cruzan, cerrar sesión en una no toca la
 * otra, y el user-agent de arriba se le pone sólo a ésta.
 */

const { BrowserWindow, BrowserView, session, shell } = require('electron');
const { imageAsDataUrl } = require('./download');

/** La partición. Todo lo de YouTube Music vive acá y en ningún otro lado. */
const PARTITION = 'persist:ytmusic';

const HOME = 'https://music.youtube.com/';

/**
 * A dónde se manda a iniciar sesión si por algo no se le puede preguntar a la
 * página. La buena es la que trae la propia YouTube Music en su enlace de
 * «Acceder» —con sus parámetros y su `continue`— y es la que se usa siempre que
 * se la pueda leer. Ésta es el plan B.
 */
const LOGIN_FALLBACK =
  'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&uilel=3&passive=true&continue=' +
  encodeURIComponent(HOME);

/** Cada cuánto se le pregunta a la página qué está sonando. */
const POLL_MS = 1000;

/** Las tapas son chicas; más que esto no es una tapa. */
const ART_MAX_BYTES = 512 * 1024;

/**
 * De dónde se aceptan las tapas.
 *
 * Por FAMILIA y no por nombre exacto: Google sirve la misma imagen desde un
 * montón de alias (`i.ytimg.com`, `lh3.googleusercontent.com`, `yt3.ggpht.com`,
 * `lh3.ggpht.com`, …) y cuál te toca depende del tema. Una lista de nombres
 * exactos es una lista a la que siempre le falta uno, y cuando le falta el
 * síntoma es una tapa que no aparece y no dice por qué.
 */
const ART_HOST_FAMILIES = ['.ytimg.com', '.googleusercontent.com', '.ggpht.com'];

/* ------------------------------------------------------------------ *
 * Lo que se le pregunta a la página
 * ------------------------------------------------------------------ */

/**
 * Una foto del reproductor. Devuelve `null` si algo falla: esto corre en la
 * página de otro y una vez por segundo, así que acá adentro no puede tirar nada.
 *
 * ── De dónde sale cada dato, y por qué ─────────────────────────────────────
 *
 * Medido en la página, las fuentes no cambian todas juntas:
 *
 *   · Al pasar de tema, durante unos 300 ms el reproductor ya dice el video
 *     NUEVO pero la MediaSession sigue con el título y la tapa del ANTERIOR, y
 *     la duración viene en 0. Una foto tomada en ese instante dejaba la tapa
 *     vieja pegada al tema nuevo.
 *   · Durante un anuncio, la MediaSession y el <video> son los del ANUNCIO:
 *     título «Nueva Red Bull Zero», su miniatura y 7 segundos de duración. El
 *     cartel mostraba eso, y al arrancar el tema la duración «se estiraba» a la
 *     de verdad y la tapa cambiaba.
 *
 * La respuesta del reproductor (`getPlayerResponse().videoDetails`) es la del
 * tema, siempre: título, autor, tapas y duración (`lengthSeconds`), atados a su
 * `videoId`. Así que:
 *
 *   · Si esa respuesta todavía es de otro video, la foto sale como NO asentada
 *     (`settled: false`) y el sondeo no la usa: vuelve a mirar en un instante.
 *   · El título, el artista y la tapa salen de la MediaSession sólo si su título
 *     coincide con el del tema (el artista de la MediaSession viene más limpio);
 *     si no, de la respuesta del reproductor.
 *   · La duración es `lengthSeconds`; lo demás queda de respaldo.
 *   · Con un anuncio, `ad` en true, cuánto le falta, y la posición del tema
 *     quieta en su lugar.
 */
const READ = `(function () {
  try {
    var md = navigator.mediaSession && navigator.mediaSession.metadata;
    var v = document.querySelector('video');
    var p = document.querySelector('#movie_player');
    var vd = null;
    try { vd = p && typeof p.getVideoData === 'function' ? p.getVideoData() : null; } catch (_) {}
    var vid = vd && vd.video_id ? String(vd.video_id) : '';
    var det = null;
    var hasResponse = !!(p && typeof p.getPlayerResponse === 'function');
    try { var pr = hasResponse ? p.getPlayerResponse() : null; det = pr && pr.videoDetails ? pr.videoDetails : null; } catch (_) {}
    // Sin la API (YouTube la cambió) no se espera nada: se usa lo que haya.
    var settled = !vid || !hasResponse || !!(det && det.videoId === vid);
    var ad = !!(p && p.classList && p.classList.contains('ad-showing'));

    var playerPosition = NaN;
    var playerDuration = NaN;
    try { playerPosition = p && typeof p.getCurrentTime === 'function' ? Number(p.getCurrentTime()) : NaN; } catch (_) {}
    try { playerDuration = p && typeof p.getDuration === 'function' ? Number(p.getDuration()) : NaN; } catch (_) {}

    var ours = det && det.videoId === vid ? det : null;
    var mdMatches = !!(md && ours && String(md.title || '') === String(ours.title || ''));
    var useMd = !!md && !ad && (!ours || mdMatches);

    var title = useMd ? String(md.title || '') : (ours ? String(ours.title || '') : '');
    var artist = useMd ? String(md.artist || '') : (ours ? String(ours.author || '').replace(/\\s+-\\s+Topic$/, '') : '');
    var album = useMd ? String(md.album || '') : '';

    var art = '';
    if (useMd && md.artwork && md.artwork.length) art = md.artwork[md.artwork.length - 1].src || '';
    if (!art && ours && ours.thumbnail && ours.thumbnail.thumbnails && ours.thumbnail.thumbnails.length) {
      art = ours.thumbnail.thumbnails[ours.thumbnail.thumbnails.length - 1].url || '';
    }

    var length = ours ? Number(ours.lengthSeconds) : NaN;
    var duration = isFinite(length) && length > 0 ? length
      : (!ad && isFinite(playerDuration) && playerDuration > 0 ? playerDuration
      : (!ad && v && isFinite(v.duration) ? v.duration : 0));

    var bar = document.querySelector('ytmusic-player-bar');
    var slider = bar && bar.querySelector('#volume-slider');
    var muted = null;
    try { muted = p && typeof p.isMuted === 'function' ? !!p.isMuted() : null; } catch (_) {}
    var barVolume = null;
    if (slider && isFinite(Number(slider.value))) barVolume = Number(slider.value) / 100;
    else if (p && typeof p.getVolume === 'function') barVolume = p.getVolume() / 100;
    /*
     * Sin sesion, YouTube Music deja UN enlace a accounts.google.com y es el
     * suyo, el de "Acceder". Preguntar por el es mejor que leer textos: no
     * depende del idioma en el que Google decida contestarnos.
     */
    var login = document.querySelector('a[href*="accounts.google.com"]');
    return {
      settled: settled,
      title: title,
      artist: artist,
      album: album,
      videoId: vid,
      artUrl: art,
      ad: ad,
      adLeft: ad && v && isFinite(v.duration) ? Math.max(0, v.duration - v.currentTime) : 0,
      // paused sigue siendo falso mientras el video está cargando. Exigir
      // datos por delante evita que el cartel siga avanzando durante un buffer.
      playing: !!(v && !v.paused && !v.ended && v.readyState >= 3),
      // Con un anuncio, el <video> es el del anuncio: la del tema es la del
      // reproductor, que se queda donde estaba.
      position: isFinite(playerPosition) ? playerPosition : (!ad && v && isFinite(v.currentTime) ? v.currentTime : 0),
      duration: duration,
      /*
       * El volumen es el de la BARRA de YouTube Music, no el del reproductor.
       * Son dos numeros distintos: la barra aplica una curva antes de pasarselo
       * al reproductor. Medido: barra 55 -> reproductor 24, barra 70 ->
       * reproductor 40. El cartel mostraba el segundo y la pestaña el primero,
       * y por eso nunca decian lo mismo.
       *
       * Silenciado, la barra marca 0 pero el volumen sigue guardado adentro: se
       * contesta null (no se sabe, se deja el ultimo) y muted en true.
       *
       * Es null tambien cuando todavia no hay barra. NO se contesta 1: ese "1"
       * inventado se guardaria como el volumen del jugador.
       */
      volume: muted ? null : barVolume,
      muted: muted,
      signedIn: !login,
      loginUrl: login ? login.href : ''
    };
  } catch (e) {
    return null;
  }
})()`;

/**
 * El clic en el primero de estos botones que exista.
 *
 * Son varios porque YouTube Music cambia su markup cada tanto y un solo
 * selector es una bomba de tiempo: el específico va primero y el genérico
 * último, así que mientras alguno siga en pie el botón anda.
 */
function clickScript(selectors) {
  return `(function () {
    var lista = ${JSON.stringify(selectors)};
    for (var i = 0; i < lista.length; i++) {
      var b = document.querySelector(lista[i]);
      if (b) { b.click(); return lista[i]; }
    }
    return null;
  })()`;
}

/**
 * Play/pausa, con red.
 *
 * El clic en el botón de la barra es lo que corresponde —deja el estado interno
 * de la página coherente— pero no siempre alcanza: con un anuncio en el medio,
 * la barra del reproductor no manda sobre el video del anuncio y el botón no
 * hace nada. Medido: sin anuncio el clic pausa y reanuda perfecto; con un
 * anuncio sonando, el clic devuelve «apretado» y el video sigue igual.
 *
 * Así que se mira si funcionó y, si no, se va derecho al `<video>`, que siempre
 * obedece. El botón nunca se queda sin hacer lo que dice que hace.
 */
const PLAYPAUSE = `(function () {
  var v = document.querySelector('video');
  if (!v) return 'sin video';
  var antes = v.paused;
  var b = document.querySelector('ytmusic-player-bar #play-pause-button')
       || document.querySelector('#play-pause-button');
  if (b) b.click();
  return new Promise(function (listo) {
    setTimeout(function () {
      if (v.paused !== antes) return listo('boton');
      try {
        if (antes) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        else v.pause();
      } catch (e) {}
      listo('video');
    }, 350);
  });
})()`;

const COMMANDS = {
  playpause: PLAYPAUSE,
  next: clickScript(['ytmusic-player-bar .next-button', '.next-button']),
  prev: clickScript(['ytmusic-player-bar .previous-button', '.previous-button'])
};

/**
 * Pone el volumen como lo pone una persona: moviendo la barra de YouTube Music.
 *
 * Antes iba por `#movie_player.setVolume()`, y eso tenía dos problemas medidos
 * en la página de hoy: la barra no se entera (se ponía 40 y la pestaña seguía
 * diciendo 100), y el número no es el mismo, porque la barra le aplica una curva
 * al reproductor (barra 70 → reproductor 40). Así el cartel y la pestaña nunca
 * coincidían, y cuando YouTube Music volvía a mirar su barra el volumen saltaba.
 *
 * El valor + el evento `change` es exactamente lo que dispara soltar la barra:
 * la página actualiza la barra, su estado y el reproductor, con su curva. Y si
 * estaba silenciada, la saca del silencio, como cualquier reproductor.
 *
 * `setVolume` queda como respaldo por si YouTube Music le cambia el markup a la
 * barra: un volumen en otra escala es mejor que un control que no hace nada.
 */
function volumeScript(percent) {
  return `(function (v) {
    var bar = document.querySelector('ytmusic-player-bar');
    var slider = bar && bar.querySelector('#volume-slider');
    if (slider) {
      slider.value = v;
      slider.dispatchEvent(new CustomEvent('change', { bubbles: true }));
      return 'barra';
    }
    var p = document.querySelector('#movie_player');
    if (p && typeof p.setVolume === 'function') { p.setVolume(v); return 'reproductor'; }
    return null;
  })(${Math.round(Math.min(100, Math.max(0, percent)))})`;
}

/**
 * Silenciar con el botón del altavoz de YouTube Music.
 *
 * `#movie_player.mute()` contesta y no hace nada (medido), pero el botón de la
 * barra sí: silencia, deja la barra en 0 y al volver restaura el volumen que
 * había. Como es un interruptor, sólo se aprieta si el estado es otro.
 */
function muteScript(on) {
  return `(function (on) {
    var p = document.querySelector('#movie_player');
    var now = null;
    try { now = p && typeof p.isMuted === 'function' ? !!p.isMuted() : null; } catch (e) {}
    if (now === null) return null;
    if (now === on) return 'ya estaba';
    var b = document.querySelector('ytmusic-player-bar yt-icon-button.volume')
         || document.querySelector('ytmusic-player-bar .volume');
    if (!b) return null;
    b.click();
    return 'boton';
  })(${on ? 'true' : 'false'})`;
}

/* ------------------------------------------------------------------ *
 * Estado
 * ------------------------------------------------------------------ */

/** El `webContents` del `<webview>` de la ventana. Lo engancha main.js. */
let contents = null;
let loginWin = null;
let timer = null;
let onChange = null;

/** La tapa que suena: `url de YouTube` → `data:`. Una sola, la de ahora. */
let artFor = '';
let artData = '';

const state = {
  /** ¿Hay reproductor montado y cargado? Sin esto la interfaz muestra el cartel. */
  ready: false,
  /** `null` mientras no se sepa (todavía no cargó). */
  signedIn: null,
  playing: false,
  title: '',
  artist: '',
  album: '',
  /** Identificador real del video: cambia antes que MediaSession al pasar sola. */
  videoId: '',
  art: '',
  /** La URL sin bajar. Sólo se usa si `art` quedó vacía. */
  artUrl: '',
  position: 0,
  duration: 0,
  /** Cambia sólo al cambiar de tema o al hacer seek; despierta la barra una vez. */
  progressRevision: 0,
  /**
   * Está sonando un anuncio. El título, la tapa y la duración siguen siendo los
   * del TEMA que viene (ver READ); la posición queda quieta hasta que termine.
   */
  ad: false,
  /** Segundos que le faltan al anuncio, leídos en `at`. */
  adLeft: 0,
  volume: 1,
  muted: false,
  /**
   * Cuándo se leyó `position`, en hora del proceso principal.
   *
   * Va con la foto para que el cartel pueda interpolar la barrita de progreso
   * entre sondeo y sondeo: con un sondeo por segundo, dibujarla tal cual llega
   * se ve a los saltos.
   */
  at: 0
};

/** La URL de «Acceder» que trae la propia página. Ver `LOGIN_FALLBACK`. */
let loginUrl = '';

function snapshot() {
  return { ...state };
}

/**
 * La huella de lo último que se avisó BIEN.
 *
 * No es lo mismo que «lo último que se leyó», y la diferencia importa: si el
 * aviso falla, esto no se mueve y el próximo sondeo lo vuelve a intentar.
 */
let lastPrint = '';

/**
 * Avisar del estado nuevo.
 *
 * El `try` no es de más. Del otro lado el aviso termina en un
 * `webContents.send`, y ése tira cuando la ventana se está yendo («Render frame
 * was disposed», que ya aparece en el log del cliente por otros caminos). Sin
 * atajarlo, esa excepción sube hasta el `catch` mudo del sondeo — y como el
 * estado YA quedó escrito, la comparación del sondeo siguiente no ve ningún
 * cambio y no vuelve a avisar NUNCA. Un tropiezo de un instante dejaba el cartel
 * clavado en lo último que había alcanzado a recibir.
 */
function emit() {
  const print = printOf(state);
  try {
    if (typeof onChange === 'function') onChange(snapshot());
    lastPrint = print;
  } catch (err) {
    console.error('[ytmusic] no se pudo avisar el estado:', err && err.message);
  }
}

/* ------------------------------------------------------------------ *
 * La sesión
 * ------------------------------------------------------------------ */

/**
 * El user-agent de Chromium sin el token de Electron. Ver el encabezado.
 *
 * Se le saca sólo eso: si mañana el cliente sube de Electron, esta cadena sube
 * de Chrome sola y sigue diciendo la verdad.
 */
function browserUserAgent(raw) {
  return String(raw || '').replace(/\s*Electron\/[^\s]+/i, '').replace(/\s{2,}/g, ' ').trim();
}

let prepared = false;

/**
 * Deja la partición lista. Idempotente y barata: la llaman el arranque y el
 * montaje del reproductor, porque cuál de los dos pasa primero depende de si el
 * jugador tenía la música encendida.
 */
function prepare() {
  const ses = session.fromPartition(PARTITION);
  if (prepared) return ses;
  prepared = true;
  try {
    if (typeof ses.setUserAgent === 'function') {
      ses.setUserAgent(browserUserAgent(ses.getUserAgent()));
    }
  } catch (err) {
    console.error('[ytmusic] no se pudo poner el user-agent:', err.message);
  }
  return ses;
}

function userAgent() {
  try {
    return prepare().getUserAgent();
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ *
 * El reproductor
 * ------------------------------------------------------------------ */

function alive() {
  return !!contents && !contents.isDestroyed();
}

/**
 * Pone a YouTube Music en su variante de canción y saca el video del compositor.
 *
 * `ATV_PREFERRED` es el modo de pista/álbum que usa el propio player. El
 * MutationObserver sólo mira ese atributo porque la página suele volver a
 * `OMV_PREFERRED` al cargar cada tema. Ocultar `#song-video` evita componer una
 * textura de video incluso cuando la cuenta no permite cambiar de variante.
 */
function applyAudioOnlyMode() {
  if (!alive()) return Promise.resolve(false);
  const enabled = audioOnly ? 'true' : 'false';
  return contents.executeJavaScript(`(function(enabled){
    try {
      var styleId = 'tvm-audio-only-style';
      var style = document.getElementById(styleId);
      var player = document.querySelector('ytmusic-player');

      if (!enabled) {
        if (window.__tvmAudioOnlyObserver) window.__tvmAudioOnlyObserver.disconnect();
        window.__tvmAudioOnlyObserver = null;
        if (window.__tvmAudioOnlyRetry) clearInterval(window.__tvmAudioOnlyRetry);
        window.__tvmAudioOnlyRetry = null;
        if (style) style.remove();
        if (player && player.getAttribute('playback-mode') === 'ATV_PREFERRED') {
          player.setAttribute('playback-mode', 'OMV_PREFERRED');
        }
        return true;
      }

      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        style.textContent = [
          '#song-video.ytmusic-player{display:none!important}',
          'ytmusic-player video{visibility:hidden!important;opacity:0!important;pointer-events:none!important}',
          '#song-image.ytmusic-player{display:block!important}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
      }

      window.__tvmAudioOnlyEnforce = function(){
        var p = document.querySelector('ytmusic-player');
        if (!p) return false;
        if (p.getAttribute('playback-mode') !== 'ATV_PREFERRED') {
          p.setAttribute('playback-mode', 'ATV_PREFERRED');
        }
        if (!window.__tvmAudioOnlyObserver) {
          window.__tvmAudioOnlyObserver = new MutationObserver(function(){
            if (p.getAttribute('playback-mode') !== 'ATV_PREFERRED') {
              p.setAttribute('playback-mode', 'ATV_PREFERRED');
            }
          });
          window.__tvmAudioOnlyObserver.observe(p, { attributes:true, attributeFilter:['playback-mode'] });
        }
        return true;
      };

      if (!window.__tvmAudioOnlyEnforce() && !window.__tvmAudioOnlyRetry) {
        var attempts = 0;
        window.__tvmAudioOnlyRetry = setInterval(function(){
          attempts += 1;
          if (window.__tvmAudioOnlyEnforce() || attempts >= 30) {
            clearInterval(window.__tvmAudioOnlyRetry);
            window.__tvmAudioOnlyRetry = null;
          }
        }, 500);
      }
      return true;
    } catch (e) { return false; }
  })(${enabled})`, false).then((ok) => {
    lightModeReady = !!ok;
    return !!ok;
  }).catch(() => false);
}

function setAudioOnly(on) {
  audioOnly = on !== false;
  lightModeReady = false;
  if (alive()) applyAudioOnlyMode();
}

/**
 * Cuando no corresponde ver el reproductor, se lo manda LEJOS en vez de sacarlo.
 *
 * Un `BrowserView` va siempre por encima del documento de la ventana, así que
 * dejarlo donde está taparía el cliente entero; y quitarlo de la ventana o
 * destruirlo cortaría la música, que es justo lo que no tiene que pasar. Fuera
 * de pantalla sigue sonando y vuelve en el acto.
 *
 * De 1 px y no de 0: un `BrowserView` de tamaño cero no muestra nada — y lo que
 * es peor, tampoco vuelve bien.
 */
const LEJOS = { x: -20000, y: -20000, width: 10, height: 10 };

/** La vista. `null` mientras la música está apagada. */
let view = null;
/** Último rectángulo que pidió la interfaz, para poder volver a él. */
let lastBounds = null;
let shown = false;
/** El volumen con el que quedó la última vez. `null` = no se sabe, no se toca. */
let savedVolume = null;
/**
 * ¿Ya se le puede creer al volumen que dice la página?
 *
 * No apenas carga. La barra existe desde el primer instante y dice 100 —el de
 * fábrica—, y el volumen guardado se le pone recién un rato después. En el medio
 * el sondeo leía ese 100, lo avisaba, y `rememberVolume` lo guardaba ENCIMA del
 * que había dejado el jugador: por eso el volumen «no se guardaba». Hasta que el
 * guardado esté puesto (o se desista de ponerlo), el volumen de la página no
 * se escucha.
 */
let volumeReady = true;
/** Si se evita la variante de video para dejarle GPU al juego. */
let audioOnly = true;
/** Se reinicia en cada navegación; evita inyectar el mismo modo en cada sondeo. */
let lightModeReady = false;

/** Redondeado y nunca vacío, igual que el de la verificación. */
function sanitize(bounds) {
  const b = bounds || {};
  return {
    x: Math.round(Number(b.x) || 0),
    y: Math.round(Number(b.y) || 0),
    width: Math.max(1, Math.round(Number(b.width) || 480)),
    height: Math.max(1, Math.round(Number(b.height) || 320))
  };
}

/**
 * Crea el reproductor si no está, y lo deja donde diga la interfaz.
 *
 * Es idempotente: llamarla de nuevo sólo lo reubica. El que decide dónde —y si
 * se ve o no— es siempre el renderer, que es el único que sabe qué pestaña está
 * abierta y qué hay encima.
 *
 * @param {BrowserWindow} win
 * @param {{x:number,y:number,width:number,height:number}|null} bounds
 *        `null` es «no se tiene que ver ahora»: se va fuera de pantalla.
 */
function open(win, bounds) {
  if (!win || win.isDestroyed()) return { ok: false, reason: 'sin ventana' };
  prepare();

  if (!view) {
    view = new BrowserView({
      webPreferences: {
        partition: PARTITION,
        // Es una página de Google donde alguien puede escribir su contraseña:
        // va con todas las defensas puestas. No lleva preload — lo que el
        // cliente le pregunta y le manda va por `executeJavaScript`.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Oculta, la página puede frenar animaciones y timers; el audio sigue
        // activo y nuestro sondeo vive en el proceso principal.
        backgroundThrottling: true
      }
    });

    contents = view.webContents;
    win.addBrowserView(view);
    // Antes de cargar: si no, el primer cuadro sale con el tamaño de fábrica.
    view.setBounds(sanitize(bounds || LEJOS));

    contents.on('did-finish-load', () => {
      state.ready = true;
      emit();
      applySavedVolume();
      applyAudioOnlyMode();
    });
    contents.on('did-start-navigation', (_e, _url, inPlace, mainFrame) => {
      lightModeReady = false;
      // Documento nuevo (recarga, «Inicio», volver de iniciar sesión): la barra
      // arranca otra vez en 100 hasta que se le ponga el guardado. Las
      // navegaciones internas de YouTube Music no cambian de documento.
      if (mainFrame && !inPlace) volumeReady = savedVolume === null;
    });
    /*
     * YouTube abre cosas en pestaña nueva (un enlace, «ver en YouTube»). Van al
     * navegador del sistema: acá no hay barra de direcciones ni pestañas, y una
     * ventana suelta adentro del cliente no es un navegador.
     */
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    contents.loadURL(HOME).catch(() => { /* se reintenta con «Recargar» */ });
    startPolling();
  }

  setBounds(win, bounds);
  return { ok: true };
}

/**
 * El volumen con el que tiene que arrancar el reproductor.
 *
 * Lo guarda el cliente y no YouTube Music, porque YouTube Music no lo guarda
 * entre sesiones: cada arranque volvía al 100%.
 */
function setSavedVolume(volume) {
  const antes = savedVolume;
  savedVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : null;
  /*
   * Y se lo da por puesto desde ya. Dos motivos: el cartel muestra el volumen
   * bueno antes de que exista el reproductor, y —más importante— el sondeo no
   * ve una diferencia contra el guardado, así que nadie sale a «corregir» el
   * config con un volumen que el jugador no tocó.
   *
   * Sólo mientras no haya página que diga otra cosa: con la página andando, el
   * volumen es el que ella dice, y pisarlo acá haría saltar el cartel.
   */
  if (savedVolume !== null && (!alive() || !volumeReady)) state.volume = savedVolume;
  // Todavía sin página: cuando cargue, se espera a ponerle éste.
  if (!alive() && savedVolume !== antes) volumeReady = savedVolume === null;
}

/**
 * Se lo pone apenas puede.
 *
 * La barra existe apenas carga la página, pero se espera un poco igual: YouTube
 * Music arma su reproductor después del `did-finish-load` y, si se le escribe
 * antes, lo pisa al terminar de armarse. Se reintenta un rato y se deja —
 * insistir para siempre sería pelearse con alguien que capaz movió la barra a
 * propósito—, y al dejar se le vuelve a creer a la página.
 */
function applySavedVolume() {
  if (savedVolume === null) {
    volumeReady = true;
    return;
  }
  volumeReady = false;
  const quiere = savedVolume;
  let intentos = 0;

  const listo = () => {
    volumeReady = true;
    poll();
  };

  const probar = () => {
    if (!alive()) return;
    // Mientras tanto el jugador lo movió desde el cartel: eso manda.
    if (savedVolume !== quiere || volumeReady) return;
    contents.executeJavaScript(volumeScript(quiere * 100), false).then((como) => {
      if (como) return setTimeout(listo, 300);
      if (++intentos < 12) setTimeout(probar, 1000);
      else listo();
    }).catch(() => { /* se está recargando: la carga nueva vuelve a llamar */ });
  };

  setTimeout(probar, 900);
}

/** Reubica la vista. `null` la manda fuera de pantalla. */
function setBounds(win, bounds) {
  if (!view) return;
  shown = !!bounds;
  lastBounds = bounds ? sanitize(bounds) : null;
  try {
    view.setBounds(lastBounds || LEJOS);
    /*
     * Al volver, la vista tiene que quedar ARRIBA de cualquier otra que se haya
     * agregado mientras tanto (la verificación de Cloudflare usa el mismo
     * mecanismo). Al irse no hace falta: fuera de pantalla no molesta a nadie.
     */
    if (lastBounds && win && !win.isDestroyed()) win.setTopBrowserView(view);
  } catch { /* se está cerrando */ }
}

/** Apaga el reproductor del todo: se destruye la vista y muere la música. */
function close(win) {
  stopPolling();
  const iba = view;
  view = null;
  contents = null;
  shown = false;
  lastBounds = null;
  lightModeReady = false;
  artFor = '';
  artData = '';
  lastPrint = '';
  Object.assign(state, {
    ready: false, signedIn: null, playing: false, ad: false, adLeft: 0,
    title: '', artist: '', album: '', videoId: '', art: '', artUrl: '', position: 0, duration: 0, at: 0
  });
  emit();

  if (!iba) return;
  try {
    if (win && !win.isDestroyed()) win.removeBrowserView(iba);
    if (iba.webContents && !iba.webContents.isDestroyed()) iba.webContents.destroy();
  } catch { /* ya no estaba */ }
}

/** ¿Está a la vista ahora mismo? Lo usa la interfaz para no pelearse consigo misma. */
function visible() {
  return !!view && shown;
}

function startPolling() {
  if (timer) return;
  timer = setInterval(() => { poll(); }, POLL_MS);
  // Sin esto el primer dato tarda un segundo en aparecer, que es justo el
  // momento en el que el jugador está mirando si funcionó.
  poll();
}

function stopPolling() {
  clearInterval(timer);
  timer = null;
  clearTimeout(settleTimer);
  settleTimer = null;
}

let polling = false;
/** Un segundo intento corto cuando la página está a mitad de un cambio de tema. */
let settleTimer = null;

async function poll() {
  if (!alive() || polling) return;
  polling = true;
  try {
    const data = await contents.executeJavaScript(READ, false);
    if (!data) return;

    /*
     * A mitad de un cambio de tema: el reproductor ya dice el video nuevo y el
     * resto todavía es del anterior (ver READ). Esa foto no se usa — dejaba la
     * tapa vieja pegada al tema nuevo y la duración en cero — y se vuelve a
     * mirar enseguida, que en la página se asienta en unos 300 ms.
     */
    if (data.settled === false) {
      if (!settleTimer) settleTimer = setTimeout(() => { settleTimer = null; poll(); }, 300);
      return;
    }

    const readAt = Date.now();
    const beforeMetaKey = [state.title, state.artist, state.album].join('\u0001');
    const nextTitle = String(data.title || '');
    const nextArtist = String(data.artist || '');
    const nextAlbum = String(data.album || '');
    const nextVideoId = String(data.videoId || '');
    const nextMetaKey = [nextTitle, nextArtist, nextAlbum].join('\u0001');
    const nextPosition = Number(data.position) || 0;
    // Con un anuncio la posición del tema no avanza aunque haya algo sonando.
    const expectedPosition = (Number(state.position) || 0) +
      (state.playing && !state.ad && state.at ? Math.max(0, readAt - state.at) / 1000 : 0);
    const videoIdentityReady = !!state.videoId && !!nextVideoId;
    const videoChanged = videoIdentityReady && state.videoId !== nextVideoId;
    const metadataChanged = !!state.title && !!nextTitle && beforeMetaKey !== nextMetaKey;
    // Si hay IDs reales, son la autoridad. MediaSession suele actualizar el
    // título un sondeo después y usar ambos a la vez reiniciaría la barra dos
    // veces. Los textos quedan sólo como respaldo cuando el reproductor todavía
    // no expuso su video_id.
    const trackChanged = videoIdentityReady ? videoChanged : metadataChanged;
    // Corrige seeks chicos y pausas de red antes de que sean visibles. El
    // reproductor y Date.now normalmente difieren apenas unas centésimas.
    const progressJumped = !!state.at && Math.abs(nextPosition - expectedPosition) > 0.45;

    state.ready = true;
    state.signedIn = !!data.signedIn;
    state.playing = !!data.playing;
    state.ad = !!data.ad;
    state.adLeft = state.ad ? Math.max(0, Number(data.adLeft) || 0) : 0;
    state.title = nextTitle;
    state.artist = nextArtist;
    state.album = nextAlbum;
    state.videoId = nextVideoId;
    // MediaSession puede publicar el título nuevo un instante antes de que el
    // <video> ponga currentTime en cero. Mostrar ese valor viejo deja la barra al
    // final durante todo el tema, porque la posición normal no se emite cada
    // segundo. En un cambio confirmado, cero es la única foto segura.
    state.position = trackChanged ? 0 : nextPosition;
    state.duration = Number(data.duration) || 0;
    if (trackChanged || progressJumped) state.progressRevision += 1;
    // Sin reproductor todavía no hay volumen que leer: se deja el que había, que
    // es el guardado (ver `setSavedVolume`). Tampoco se le cree a la página hasta
    // que tenga puesto el guardado (ver `volumeReady`). Ver también READ.
    if (volumeReady && Number.isFinite(data.volume)) state.volume = data.volume;
    if (data.muted !== null && data.muted !== undefined) state.muted = !!data.muted;
    state.at = readAt;
    if (data.loginUrl) loginUrl = String(data.loginUrl);

    /*
     * Tapa nueva, tapa bajada vieja afuera, SIEMPRE y no sólo con un cambio de
     * tema confirmado. Si no, mientras bajaba la nueva el cartel seguía
     * mostrando la anterior (`art` gana sobre `artUrl`), y si la descarga
     * fallaba se quedaba con ella. Sin la bajada, el cartel pide la URL cruda.
     */
    const nextArtUrl = String(data.artUrl || '');
    if (nextArtUrl !== state.artUrl) state.art = '';
    state.artUrl = nextArtUrl;

    // El progreso es más urgente que la portada. Descargar la tapa puede tardar
    // varios segundos; si se espera, el HUD sigue interpolando la canción vieja
    // y aparece por la mitad aunque la nueva recién haya empezado.
    if (trackChanged || progressJumped) emit();

    // La tapa sigue en paralelo. Nunca puede frenar el próximo sondeo del reloj.
    resolveArt(nextArtUrl).then(() => {
      if (state.artUrl !== nextArtUrl) return;
      state.art = artData;
      if (printOf(state) !== lastPrint) emit();
    }).catch(() => {});

    /*
     * `at` y `position` cambian en cada sondeo y no son noticia: avisar por eso
     * repintaría la interfaz una vez por segundo para siempre. Se avisa cuando
     * cambia algo que se ve. El cartel interpola el progreso solo, justamente
     * para no depender de esto.
     *
     * Se compara contra lo último que se AVISÓ, no contra lo último que se leyó:
     * ver `emit`.
     */
    if (printOf(state) !== lastPrint) emit();
  } catch {
    /* La página se está recargando o navegando. Al próximo sondeo. */
  } finally {
    polling = false;
  }
}

/** Lo que, si cambia, la interfaz tiene que repintar. */
function printOf(s) {
  /*
   * El volumen entra en pasos de 1%, que es el paso de la barra de YouTube
   * Music. Iba en pasos de 5 «para no avisar por cada píxel», y eso rompía las
   * dos puntas: mover la barra de la pestaña de 30 a 32 no llegaba nunca al
   * cartel, y como este aviso es también lo que dispara `rememberVolume`, ese
   * volumen tampoco se guardaba. El sondeo es de uno por segundo: más de un
   * aviso por segundo no puede salir de acá igual.
   */
  return [s.ready, s.signedIn, s.playing, s.ad, s.title, s.artist,
    s.art ? '1' : '0', s.artUrl,
    Math.round(s.duration), s.progressRevision,
    Math.round(s.volume * 100), s.muted].join('|');
}

/**
 * La tapa, de URL de YouTube a `data:`.
 *
 * Se baja acá y no en la ventana por lo mismo que las fotos de Discord: la CSP
 * del renderer no deja pedir imágenes de afuera. Y el cartel de la cancha vive
 * dentro del documento de haxball.com, donde tampoco corresponde meter un
 * pedido a Google en cada tema.
 */
async function resolveArt(url) {
  if (!url) { artFor = ''; artData = ''; return; }
  if (url === artFor) return;
  artFor = url;
  artData = '';
  const data = await imageAsDataUrl(url, {
    hostSuffixes: ART_HOST_FAMILIES,
    maxBytes: ART_MAX_BYTES
  });
  // Puede haber cambiado de tema mientras bajaba: la que vale es la última.
  if (artFor !== url) return;
  artData = data || '';

  /*
   * Que no baje NO es fatal —el cartel se queda con la URL cruda, ver abajo—
   * pero tiene que quedar dicho: una tapa que no aparece y no deja rastro es
   * exactamente lo que costó encontrar la primera vez.
   */
  if (!data) {
    let host = '';
    try { host = new URL(url).hostname; } catch { host = '(url rara)'; }
    console.warn(`[ytmusic] no se pudo bajar la tapa desde ${host}`);
  }
}

/* ------------------------------------------------------------------ *
 * Los mandos
 * ------------------------------------------------------------------ */

/**
 * ── El volumen va por la barra de YouTube Music ────────────────────────────
 *
 * Escribir `video.volume` funciona… hasta el tema siguiente: al cargar uno nuevo
 * la página le vuelve a poner el suyo. Y `#movie_player.setVolume()` tampoco
 * alcanza: queda, pero la barra de la página no se entera y habla en otra escala
 * (ver `volumeScript`). La barra es la única que deja a los dos de acuerdo.
 *
 * @param {'playpause'|'next'|'prev'|'volume'|'mute'} kind
 * @param {number|boolean} [value] para `volume`, de 0 a 1; para `mute`, sí/no
 */
async function command(kind, value) {
  if (!alive()) return { ok: false, reason: 'sin reproductor' };

  try {
    if (kind === 'volume' || kind === 'mute') {
      /*
       * Lo que pide el jugador manda sobre el guardado que se estaba por poner
       * al cargar: si no, el arranque podría pisarle el gesto un segundo después.
       */
      volumeReady = true;
      let script;
      if (kind === 'volume') {
        const v = Math.min(1, Math.max(0, Number(value) || 0));
        // Se da por hecho ya, para que el sondeo de dentro de un instante no
        // mande de vuelta el valor anterior al cartel mientras la página aplica.
        state.volume = v;
        state.muted = false;
        script = volumeScript(v * 100);
      } else {
        state.muted = !!value;
        script = muteScript(!!value);
      }
      const hit = await contents.executeJavaScript(script, false);
      setTimeout(() => { poll(); }, 250);
      return { ok: !!hit, reason: hit ? '' : 'el reproductor no contestó' };
    }

    const script = COMMANDS[kind];
    if (!script) return { ok: false, reason: 'mando desconocido' };
    const hit = await contents.executeJavaScript(script, false);
    /*
     * El sondeo normal tardaría hasta un segundo en mostrar el cambio y el botón
     * tiene que contestar en el acto. Van dos: el primero para el play/pausa,
     * que es inmediato, y el segundo para el «siguiente», que tarda en resolver
     * de qué tema se trata.
     */
    setTimeout(() => { poll(); }, 500);
    setTimeout(() => { poll(); }, 1200);
    const ok = !!hit && hit !== 'sin video';
    return { ok, reason: ok ? '' : 'el reproductor no contestó' };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** Volver a la portada. Es lo que hace el botón «Inicio» de la pestaña. */
function goHome() {
  if (!alive()) return;
  contents.loadURL(HOME).catch(() => { /* ya se está yendo a otro lado */ });
}

function reload() {
  if (!alive()) return;
  contents.reload();
}

/* ------------------------------------------------------------------ *
 * Iniciar sesión
 * ------------------------------------------------------------------ *
 * ── Por qué NO se puede usar el navegador del usuario ──────────────────────
 *
 * Es lo primero que uno pide, y no se puede. YouTube Music no es una API con
 * tokens: es una web, y una web se abre con COOKIES. Las cookies de Chrome
 * viven en el perfil de Chrome, cifradas con la cuenta de Windows, y no hay
 * forma legítima de moverlas a otro navegador — leerlas del disco ajeno es
 * literalmente lo que hace el malware que roba sesiones, y este cliente no va a
 * hacer eso ni aunque funcione.
 *
 * OAuth en el navegador del sistema tampoco alcanza: devuelve un token de API,
 * y con un token no se abre el reproductor web. Así que la sesión tiene que
 * nacer adentro del navegador del cliente. No hay tercera opción.
 *
 * ── Entonces se hace lo que sí se puede: que se vea y se pueda verificar ────
 *
 * En una ventana de verdad y no adentro del `<webview>`:
 *
 *   · Es lo honesto. Escribir la contraseña de Google adentro del panel de otro
 *     programa, sin barra de direcciones, es exactamente lo que uno le dice a la
 *     gente que NO haga.
 *   · Google trata distinto lo que le parece embebido. Con una ventana normal y
 *     el user-agent de arriba, el flujo que sale es el mismo que en Chrome.
 *
 * Y el TÍTULO de la ventana dice en qué host estás parado, actualizado en cada
 * navegación. Lo escribimos nosotros y la página no lo puede pisar
 * (`page-title-updated` se cancela), así que es un dato que no se puede
 * falsificar desde adentro: si alguna vez no dice `accounts.google.com`, no hay
 * que escribir nada ahí.
 *
 * Y se hace UNA vez: la partición es `persist:`, así que la sesión sobrevive a
 * cerrar el cliente. La única forma de perderla es «Cerrar sesión».
 */
async function login(parent) {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return { ok: true, already: true };
  }
  prepare();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      // La sesión nueva se ve recién al recargar: la página vieja se cargó sin
      // cookies y no se entera sola.
      reload();
      setTimeout(() => { poll(); }, 1500);
      setTimeout(() => { poll(); }, 5000);
      resolve({ ok });
    };

    loginWin = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      autoHideMenuBar: true,
      backgroundColor: '#101014',
      title: 'Iniciar sesión en YouTube Music',
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false
      }
    });

    /*
     * Google abre cosas en ventana nueva (elegir cuenta, verificación en dos
     * pasos, una passkey). Se las carga acá mismo: dejarlas abrir sueltas sería
     * abrirle ventanas al usuario desde una página, y una ventana suelta sin
     * nada alrededor es peor que reusar ésta.
     */
    loginWin.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:/i.test(url) && loginWin && !loginWin.isDestroyed()) {
        loginWin.loadURL(url).catch(() => { /* la cerró en el medio */ });
      }
      return { action: 'deny' };
    });

    /*
     * El título lo escribimos nosotros y dice DÓNDE estás. Ver el encabezado de
     * esta sección: es la barra de direcciones que esta ventana no tiene, y como
     * la página no la puede tocar, sirve para lo que tiene que servir.
     */
    loginWin.webContents.on('page-title-updated', (e) => e.preventDefault());
    const showHost = (url) => {
      if (!loginWin || loginWin.isDestroyed()) return;
      let host = '';
      try { host = new URL(String(url || '')).host; } catch { host = ''; }
      loginWin.setTitle(host
        ? `Iniciar sesión en YouTube Music — ${host}`
        : 'Iniciar sesión en YouTube Music');
    };
    loginWin.webContents.on('did-start-navigation', (_e, url, _inPage, isMain) => {
      if (isMain) showHost(url);
    });

    /*
     * Terminó cuando Google devuelve a YouTube. Se acepta cualquier host de
     * youtube.com y no sólo `music.`: el `continue` del enlace de YT Music pasa
     * por `www.youtube.com`, y para cuando se llega ahí las cookies ya están
     * puestas en la partición, que es lo único que hacía falta.
     */
    const landed = (url) => {
      showHost(url);
      if (!/^https:\/\/([a-z0-9-]+\.)*youtube\.com(\/|$)/i.test(String(url || ''))) return;
      finish(true);
      if (loginWin && !loginWin.isDestroyed()) loginWin.close();
    };
    loginWin.webContents.on('did-navigate', (_e, url) => landed(url));
    loginWin.webContents.on('did-navigate-in-page', (_e, url) => landed(url));

    /*
     * Y si la cierra a mano, también se recarga y se vuelve a mirar. Puede haber
     * entrado igual —Google tiene mil caminos— y quedarse diciendo «sin sesión»
     * con la sesión puesta sería la peor forma de fallar.
     */
    loginWin.on('closed', () => {
      loginWin = null;
      finish(false);
    });

    loginWin.loadURL(loginUrl || LOGIN_FALLBACK).catch(() => finish(false));
  });
}

/**
 * Cerrar sesión: se borra TODO lo de esta partición.
 *
 * Cookies y storage juntos, no sólo las cookies: YouTube Music guarda de quién
 * es la sesión también en localStorage y en IndexedDB, y con eso adentro la
 * página vuelve a medio reconocerte. Se lleva puesta de paso la preferencia de
 * volumen de YouTube Music, que es de ella y es el precio de salir limpio.
 *
 * Nada de esto toca la sesión del juego: son particiones distintas.
 */
async function logout() {
  const ses = prepare();
  try {
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage']
    });
  } catch (err) {
    console.error('[ytmusic] no se pudo cerrar la sesión:', err.message);
    return { ok: false, error: err.message };
  }
  loginUrl = '';
  reload();
  setTimeout(() => { poll(); }, 1500);
  return { ok: true };
}

module.exports = {
  PARTITION,
  HOME,
  prepare,
  userAgent,
  open,
  setSavedVolume,
  setAudioOnly,
  setBounds,
  close,
  visible,
  command,
  goHome,
  reload,
  login,
  logout,
  state: snapshot,
  onChange: (cb) => { onChange = cb; }
};
