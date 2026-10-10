const { app, BrowserWindow, BrowserView, ipcMain, shell, dialog, Menu, screen, protocol, session, powerSaveBlocker, nativeImage, crashReporter, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Antes que cualquier módulo que use `fetch`: rellena `fetch` y
// `AbortController`, que no existen en el Node de Electron 13.
require('./net-compat').install();

const store = require('./store');
const preferences = require('./preferences');
const replays = require('./replays');
const replayArchive = require('./replay-archive');
const haxball = require('./haxball-settings');
const themes = require('./themes');
const roomlist = require('./roomlist');
const flags = require('./flags');
const discord = require('./discord');
const updater = require('./updater');
const access = require('./access');
const panel = require('./panel');
const avatars = require('./avatars');
const countries = require('./countries');
const gamePatch = require('./game-patch');
const gif = require('./gif');
const ytmusic = require('./ytmusic');

const isDev = process.argv.includes('--dev');
const ROOT = path.join(__dirname, '..', '..');
const GAME_PRELOAD = path.join(__dirname, 'game-preload.js');

if (process.platform === 'win32') app.setAppUserModelId('TodaLaLecce.TLApp');

/*
 * La carpeta de datos se llamaba «TVM Client» y ahora el nombre del producto es
 * «TL App». Para que nadie pierda ajustes, identidades ni sesión, la primera vez
 * se copia lo viejo a la carpeta nueva (sin los caches de Chromium, que se
 * regeneran solos). La vieja no se toca: se puede borrar a mano cuando se quiera.
 */
(function migrarDatos() {
  try {
    const nueva = app.getPath('userData');
    const vieja = path.join(path.dirname(nueva), 'TVM Client');
    if (vieja === nueva || !fs.existsSync(vieja)) return;
    if (fs.existsSync(path.join(nueva, 'config.json'))) return;
    const saltear = new Set(['Cache', 'Code Cache', 'GPUCache', 'Crashpad', 'DawnCache', 'ShaderCache', 'GrShaderCache', 'game-patch']);
    const copiar = (de, a) => {
      fs.mkdirSync(a, { recursive: true });
      for (const e of fs.readdirSync(de, { withFileTypes: true })) {
        if (saltear.has(e.name) || e.name === 'lockfile' || e.name.startsWith('Singleton')) continue;
        const o = path.join(de, e.name);
        const d = path.join(a, e.name);
        try {
          if (e.isDirectory()) copiar(o, d);
          else if (e.isFile()) fs.copyFileSync(o, d);
        } catch (_) { /* un archivo en uso no frena el resto */ }
      }
    };
    copiar(vieja, nueva);
  } catch (_) { /* si falla, arranca limpio: no vale tirar la app por esto */ }
})();

/* ------------------------------------------------------------------ *
 * Red de seguridad del proceso principal
 * ------------------------------------------------------------------ *
 * Va lo más arriba posible, antes de que se enganche nada: si algo revienta
 * durante el arranque, esto tiene que estar puesto.
 *
 * En Electron, una excepción suelta en el proceso principal **cierra la
 * aplicación entera**, sin ventana de error, sin log, sin nada. Y "suelta" acá
 * es fácil: cualquier callback asíncrono que tire —un socket que se corta, una
 * respuesta que no llega, un `emit('error')` sin oyentes— pasa por afuera de
 * todos los try/catch. Eso es exactamente lo que se siente como "la app se
 * cierra sola después de un rato": no hay crash de Chromium, hay un throw que
 * nadie atajó.
 *
 * Acá no se atajan errores para taparlos: se **anotan en disco** y se sigue. Un
 * cliente de juego que pierde la presencia de Discord tiene que seguir andando;
 * uno que desaparece de la pantalla en medio de un partido, no.
 */
const CRASH_LOG_MAX = 256 * 1024;

function crashLogPath() {
  try {
    return path.join(app.getPath('userData'), 'errores.log');
  } catch {
    return null; // todavía no hay userData: se pierde, pero no se cae
  }
}

function recordFatal(kind, err) {
  const detail = err && err.stack ? err.stack : String(err);
  const line = `[${new Date().toISOString()}] ${kind}\n${detail}\n\n`;
  console.error(`[TL App:fatal] ${kind}`, err);
  try {
    const file = crashLogPath();
    if (!file) return;
    // Se trunca solo: un error que se repite cada segundo no puede llenar el disco.
    try {
      if (fs.statSync(file).size > CRASH_LOG_MAX) fs.unlinkSync(file);
    } catch { /* no existía */ }
    fs.appendFileSync(file, line, 'utf8');
  } catch { /* si ni siquiera se puede escribir, no hay nada más que hacer */ }
  try {
    send('game:log', { level: 'error', message: `${kind}: ${err && err.message ? err.message : err}`, source: 'cliente', at: Date.now() });
  } catch { /* la ventana puede no existir */ }
}

process.on('uncaughtException', (err) => recordFatal('excepción sin atajar', err));
process.on('unhandledRejection', (err) => recordFatal('promesa rechazada sin atajar', err));

/* ── Cuando el que se muere no es JavaScript ──────────────────────────────
 *
 * Lo de arriba sólo ve los errores del proceso principal. Una app de Electron
 * son varios procesos más, y los que se caen en silencio son justamente los que
 * dejan la pantalla negra: el de GPU, el de red, el de audio.
 *
 * `child-process-gone` no repone nada —Chromium ya lo intenta solo— pero deja
 * dicho QUÉ se murió y por qué. Sin esto, en el log no queda absolutamente nada
 * y desde afuera se ve igual que un cuelgue.
 *
 * `crashReporter` no manda nada a ningún lado: sólo hace que Chromium escriba el
 * volcado en `userData/Crashpad`, que es lo único con lo que se puede mirar un
 * crash nativo después de que pasó.
 */
try {
  crashReporter.start({ uploadToServer: false, compress: true });
} catch { /* sin volcados, pero la app arranca igual */ }

app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit') return;
  recordFatal(
    `se murió el proceso de ${details.type}${details.serviceName ? ` (${details.serviceName})` : ''}`,
    new Error(`${details.reason} (código ${details.exitCode})`)
  );

  // Chromium normalmente vuelve a levantar el proceso de GPU por su cuenta,
  // pero la superficie de la ventana puede quedar negra o con fragmentos de
  // cuadros anteriores hasta que Windows fuerza un repintado (por ejemplo al
  // hacer Alt+Tab). Pedirlo también desde acá evita depender de ese gesto.
  if (String(details.type || '').toLowerCase() === 'gpu') {
    setTimeout(repaintWindowSoon, 350);
  }
});

/* ------------------------------------------------------------------ *
 * Flags de rendimiento: hay que aplicarlos ANTES de app.whenReady()
 * ------------------------------------------------------------------ */

/**
 * Última versión de Electron donde sacar el techo de cuadros entrega cuadros.
 *
 * Va acá arriba y no al lado de `applyBootFlags` a propósito: `applyBootFlags`
 * se llama en el cuerpo del módulo, y un `const` declarado después queda en
 * zona muerta temporal — la app no arranca y `node --check` no lo ve.
 */
const UNLOCK_FPS_MAX_ELECTRON = 28;

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || '').trim());
}

/**
 * Si el unlock de cuadros sirve de algo en este Electron. Ver el comentario
 * largo de `applyBootFlags`: de la 28 en adelante el compositor deja de
 * presentar y lo único que queda es el costo.
 */
function unlockFpsSupported() {
  if (envFlag('TVM_LOCK_FPS')) return false;
  if (envFlag('TVM_UNLOCK_FPS')) return true;
  const major = parseInt(String(process.versions.electron || '0').split('.')[0], 10) || 0;
  return major > 0 && major < UNLOCK_FPS_MAX_ELECTRON;
}

applyBootFlags(store.load().perf);

/**
 * Flags de Chromium. Van todos antes de app.whenReady() porque el motor los
 * lee una sola vez, al arrancar.
 */
function applyBootFlags(perf) {
  if (perf.disableHardwareAcceleration) app.disableHardwareAcceleration();

  if (unlockFpsSupported() && perf.unlockFps) {
    app.commandLine.appendSwitch('disable-frame-rate-limit');
    app.commandLine.appendSwitch('disable-gpu-vsync');
    app.commandLine.appendSwitch('force_high_performance_gpu');
  }

  // Sin esto, el sonido de gol no suena: Chromium exige un gesto del usuario
  // antes de dejar reproducir audio, y acá el gesto lo hace el partido.
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

  // Un solo --disable-features: Chromium se queda con la última aparición del
  // switch, así que si se pasan por separado uno pisa al otro.
  const disabledFeatures = [
    // Subsistemas que este cliente no usa nunca y que igual levantan su propio
    // servicio: se apagan para bajar memoria y cantidad de procesos.
    'MediaSessionService',
    'HardwareMediaKeyHandling',
    'Translate',
    'OptimizationHints',
    'AutofillServerCommunication'
  ];
  // Va con el unlock: si el unlock no se aplica, esto tampoco tiene sentido.
  if (unlockFpsSupported() && perf.unlockFps) disabledFeatures.push('FrameRateThrottling');
  // Windows pausa el render cuando cree que otra ventana tapa la nuestra.
  if (perf.noOcclusionPause) disabledFeatures.push('CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));

  if (perf.disableBackgroundThrottling) {
    app.commandLine.appendSwitch('disable-background-timer-throttling');
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  }

  // El rasterizado por GPU se queda aunque el unlock no se aplique: ayuda igual
  // y no depende de la tasa de cuadros.
  if (perf.gpuRasterization || perf.unlockFps) {
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
    app.commandLine.appendSwitch('num-raster-threads', '6');
    if (process.platform === 'win32') {
      app.commandLine.appendSwitch('use-angle', 'd3d11');
    }
  }
  if (perf.zeroCopy) app.commandLine.appendSwitch('enable-zero-copy');
  if (perf.forceGpu) {
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
    app.commandLine.appendSwitch('enable-unsafe-webgpu');
  }
  // En notebooks con dos placas, pide la dedicada en vez de la integrada.
  if (perf.highPerformanceGpu) app.commandLine.appendSwitch('force_high_performance_gpu');
  if (perf.lowLatencyAudio) app.commandLine.appendSwitch('force-wave-audio');

  /*
   * Techo del montón de JavaScript.
   *
   * Por defecto V8 se deja crecer hasta unos 4 GB antes de ponerse serio con la
   * recolección, y como nunca llega, junta basura mucho más de lo necesario:
   * memoria que el cliente no usa pero tampoco devuelve. Con un techo de 768 MB
   * el recolector trabaja seguido y en tandas chicas, en vez de dejar crecer y
   * después frenar todo para una limpieza grande.
   *
   * 768 MB es de sobra: medido, el cliente entero (sus dos renderers, el juego
   * incluido) se mueve bastante por debajo de eso.
   */
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=768');

  // Nada de esto lo usa un cliente de juego, y todo levanta trabajo de fondo.
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-domain-reliability');

  /*
   * Acá estaba `disable-smooth-scrolling`, puesto con la idea de que un cliente
   * de juego no scrollea nada y todo cuadro de más cuesta. Pero el cliente sí
   * scrollea: la lista de salas y las cuatro páginas del panel.
   *
   * Medido: con el flag puesto, una muesca de rueda mueve la página 120 px de
   * golpe, en un solo paso, sin nada en el medio. Eso es lo que se siente como
   * tirón al bajar por Rendimiento o Aspecto — no es que falten cuadros, es que
   * el contenido se teletransporta. Y no ahorraba nada donde importa: la cancha
   * no se scrollea, así que durante la partida el flag no hacía absolutamente
   * nada. Sólo empeoraba la interfaz.
   */
  app.commandLine.appendSwitch('disable-background-media-suspend');
}

function applyRuntimeFlags(perf) {
  if (process.platform !== 'win32') return;
  const level = perf.highProcessPriority
    ? os.constants.priority.PRIORITY_HIGH
    : os.constants.priority.PRIORITY_NORMAL;
  const wanted = new Map([[process.pid, level]]);

  // El canvas no se dibuja en el proceso principal: vive en el renderer del
  // webview. Antes «Prioridad alta» sólo aceleraba al coordinador y dejaba al
  // proceso que produce cada cuadro en prioridad normal.
  //
  // Con varias pestañas, la prioridad alta es de la que se está MIRANDO. Las de
  // atrás vuelven a normal: si se la quedaran, cambiar de pestaña dejaría dos
  // procesos peleando por la CPU con la misma prioridad, y la partida que se ve
  // no ganaría nada por sobre la que no.
  for (const contents of gameTabs) {
    try {
      if (contents.isDestroyed() || typeof contents.getOSProcessId !== 'function') continue;
      const gamePid = contents.getOSProcessId();
      if (gamePid > 0) {
        wanted.set(gamePid, contents === gameContents ? level : os.constants.priority.PRIORITY_NORMAL);
      }
    } catch { /* el webview puede estar navegando */ }
  }

  for (const [pid, priority] of wanted) {
    try {
      os.setPriority(pid, priority);
    } catch {
      /* falta de permisos: no es crítico */
    }
  }
}

function applyStartupFlag(general) {
  if (!app.isPackaged) return; // en desarrollo registraría la ruta de electron.exe
  app.setLoginItemSettings({ openAtLogin: !!general.launchOnStartup, args: [] });
}

/* ------------------------------------------------------------------ *
 * Recursos del jugador (avatar y sonido de gol)
 * ------------------------------------------------------------------ *
 * El avatar con imagen y el sonido de gol se cargan DENTRO de la página de
 * HaxBall, que es https. Chromium no deja que una página https cargue un
 * `file://`, así que apuntarlos al archivo en el disco no funcionaba nunca —
 * ni con el audio ni con la imagen, y sin ningún error visible.
 *
 * La salida es un esquema propio que sirve esos dos archivos desde userData:
 *
 *     tvm-asset://avatar     tvm-asset://goal
 *
 * Se registra como seguro para que la página https lo acepte como si fuera
 * suyo, y sólo puede devolver esos dos archivos: el nombre no viene de la URL.
 */
const ASSET_SCHEME = 'tvm-asset';

protocol.registerSchemesAsPrivileged([{
  scheme: ASSET_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
}]);

const ASSET_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4'
};

/** El archivo que el jugador eligió para cada recurso, o null. */
function assetPath(kind) {
  const cfg = store.get().vip;
  const file = kind === 'avatar' ? cfg.avatarImage
    : kind === 'ball' ? cfg.ballImage
    : kind === 'goal' ? cfg.goalSound
    : kind === 'hit' ? cfg.hitSound
    : '';
  return file && fs.existsSync(file) ? file : null;
}

/**
 * Nuestro escudo, el que se dibuja al lado de los que también usan el cliente.
 *
 * Va por este esquema y no por `file://` porque la página del juego es https y
 * Chromium bloquea la mezcla, en silencio.
 *
 * Se rasteriza el escudo vectorial al tamaño del icono de juego para no
 * decodificar una imagen grande por una marca pequeña.
 */
let clubIcon = null;
let logoIcon = null;
let flashLogoIcon = null;

function clubImage() {
  if (clubIcon) return clubIcon;
  const file = path.join(__dirname, '..', '..', 'assets', 'toda-la-lecce.png');
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) throw new Error('No se pudo cargar el escudo de Toda la Lecce');
  clubIcon = image;
  return clubIcon;
}

function logoBuffer() {
  if (logoIcon) return logoIcon;
  logoIcon = clubImage().resize({ width: 32, height: 32, quality: 'best' }).toPNG();
  return logoIcon;
}

function flashLogoBuffer() {
  if (flashLogoIcon) return flashLogoIcon;
  flashLogoIcon = clubImage().resize({ width: 256, height: 256, quality: 'best' }).toPNG();
  return flashLogoIcon;
}

/* ------------------------------------------------------------------ *
 * Publicidad y telemetría de la página
 * ------------------------------------------------------------------ *
 * haxball.com/play carga la red de anuncios cpmstar: varios scripts, un iframe
 * y reproductores de video que siguen corriendo aunque no se vean. El modo
 * "sólo la cancha" los tapaba con CSS, pero seguían descargándose y ejecutando
 * timers — que es de donde salía la mayor parte del CPU y la memoria del
 * cliente estando quieto en la lista de salas.
 *
 * Taparlos y no cargarlos son la misma decisión tomada hasta el final.
 *
 * Va siempre y no se puede apagar: medido, 676 MB contra 1033 MB y tres
 * procesos menos. Era el interruptor con el que nadie ganaba nada apagándolo.
 */
const BLOCKED_HOSTS = [
  'cpmstar.com',
  'doubleclick.net',
  'googlesyndication.com',
  'googletagservices.com',
  'googletagmanager.com',
  'google-analytics.com',
  'adnxs.com',
  'adsrvr.org',
  'amazon-adsystem.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'criteo.com',
  'scorecardresearch.com',
  'moatads.com',
  'cloudflareinsights.com'
];

/* ------------------------------------------------------------------ *
 * HaxBall caído
 * ------------------------------------------------------------------ *
 * Cuando haxball.com no sirve el juego —Cloudflare de por medio con su muro de
 * "Just a moment…", o el sitio directamente caído— el cliente se cerraba solo a
 * los pocos segundos de abrir, sin dejar nada en `errores.log`.
 *
 * No es un error de JavaScript: el proceso principal se cae en C++ al confirmar
 * esa navegación dentro del `<webview>`, reenganchándolo al WebContents de
 * afuera (`ReattachToOuterWebContentsFrame`). Está reproducido: con el sitio
 * devolviendo el muro, un Electron pelado con un `<webview>` apuntado ahí se
 * cae en el 100% de los intentos, siempre justo después de confirmar la
 * navegación; con el sitio sano no se cae nunca.
 *
 * Es un bug de Chromium 91 y no hay dónde atajarlo desde JavaScript: para
 * cuando se podría ver la respuesta, la navegación ya está confirmada y el
 * proceso ya murió. Lo único que lo evita es no navegar ahí.
 *
 * Así que se pregunta primero, por afuera del `<webview>`, y si el juego no
 * está disponible la navegación se cancela en el acto.
 *
 * PERO el muro de Cloudflare NO es HaxBall caído: es una verificación que, una
 * vez pasada, deja jugar como siempre —es lo que pasa en cualquier navegador—.
 * Dejarlo ahí sería cambiar un cliente que se cierra por uno que no entra
 * nunca. Por eso el muro se abre en una ventana aparte (`openChallengeWindow`),
 * que es una ventana normal y no un `<webview>`: no tiene contenedor al que
 * reengancharse, así que no le pasa lo del guest.
 *
 * La verificación la resuelve el jugador, igual que en el navegador; acá no se
 * automatiza nada. Lo único que hace el cliente es mostrarla y darse cuenta de
 * cuándo pasó. Como la ventana comparte la partición con el juego, la cookie
 * que deja Cloudflare queda en la misma sesión y el `<webview>` ya entra
 * derecho.
 *
 * OJO: acá se comprobó también la hipótesis de que la culpa fuera del
 * aislamiento que pide el muro (`Cross-Origin-Opener-Policy`,
 * `Origin-Agent-Cluster`). No lo es: pegándole esas mismas cabeceras al sitio
 * sano, el guest cambia de proceso igual y no se cae nadie. Sacarlas con un
 * `onHeadersReceived` no arregla nada.
 */

/** La partición donde vive HaxBall: el juego, la sonda y la verificación. */
const GAME_PARTITION = 'persist:haxball';

/** Caído: se lo mira seguido, para volver a entrar apenas vuelva. */
const HEALTH_RECHECK_MS = 15000;
/**
 * Sano: se lo sigue mirando igual, más espaciado.
 *
 * Es por el caso de que HaxBall se caiga con el cliente ya abierto: si nadie
 * preguntara hasta la próxima recarga, una navegación que arranque la propia
 * página del juego llegaría al sitio caído sin que el main lo supiera. Esto no
 * lo cierra del todo —entre dos consultas hay un hueco— pero lo deja en
 * segundos en vez de en toda la sesión.
 */
const HEALTH_IDLE_MS = 60000;
/** Si no contesta en este tiempo, se lo da por caído. */
const HEALTH_TIMEOUT_MS = 8000;

let haxballDown = false;
let haxballReason = '';
let healthTimer = null;
let healthEvery = 0;
let probeInFlight = null;
/** La primera consulta, que es la que espera la interfaz antes de montar. */
let firstProbe = null;

function isHaxballHost(hostname) {
  return /(^|\.)haxball\.com$/.test(hostname);
}

/**
 * Pide el documento del juego SIN navegar a él.
 *
 * Va por la partición del juego y con sus cookies (`useSessionCookies`), que es
 * lo único que hace que esto sirva: la cookie que deja Cloudflare al pasar la
 * verificación vive en esa partición. Preguntando por la sesión de al lado, el
 * muro seguiría contestando 403 para siempre y el cliente no dejaría entrar
 * nunca, aunque el jugador ya lo hubiera resuelto.
 *
 * Por lo mismo va el User-Agent de esa sesión: el que decide si hay muro o no
 * mira quién pregunta, y la idea es preguntar como el que después va a entrar.
 */
function requestGamePage() {
  return new Promise((resolve, reject) => {
    const ses = session.fromPartition(GAME_PARTITION);
    const req = net.request({
      url: roomlistUrl(),
      partition: GAME_PARTITION,
      useSessionCookies: true
    });

    try { req.setHeader('User-Agent', ses.getUserAgent()); } catch { /* da igual */ }

    let settled = false;
    // Se corta a mano y no con un `setTimeout` suelto: abortar una petición ya
    // terminada es tocar un objeto liberado y tira abajo el proceso principal
    // (el mismo problema que cuenta `net-compat.js`).
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { req.abort(); } catch { /* ya terminó */ }
      reject(Object.assign(new Error('HaxBall no contestó a tiempo.'), { timeout: true }));
    }, HEALTH_TIMEOUT_MS);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    req.on('error', (err) => finish(reject, err));

    req.on('response', (res) => {
      const parts = [];
      res.on('error', () => {});
      // El cuerpo se lee igual aunque alcance el código: si no, la conexión
      // queda abierta esperando a que alguien lo lea.
      res.on('data', (chunk) => parts.push(chunk));
      res.on('end', () => finish(resolve, {
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(parts).toString('utf8')
      }));
    });

    try {
      req.end();
    } catch (err) {
      finish(reject, err);
    }
  });
}

/** ¿Está HaxBall sirviendo el juego, o hay muro? */
async function probeHaxball() {
  if (probeInFlight) return probeInFlight;

  probeInFlight = (async () => {
    try {
      const res = await requestGamePage();
      if (res.status >= 200 && res.status < 300) return setHaxballDown(false, '');

      // El muro se anuncia con esta cabecera, y cuando no la manda igual se lo
      // reconoce por la página que devuelve.
      const mitigated = res.headers['cf-mitigated'];
      if (mitigated || /Just a moment|challenge-platform/i.test(res.body)) {
        return setHaxballDown(true, 'challenge');
      }
      return setHaxballDown(true, `http-${res.status}`);
    } catch (err) {
      return setHaxballDown(true, err && err.timeout ? 'timeout' : 'red');
    } finally {
      probeInFlight = null;
    }
  })();

  return probeInFlight;
}

function setHaxballDown(down, reason) {
  const changed = haxballDown !== down || haxballReason !== reason;
  haxballDown = down;
  haxballReason = reason;

  if (changed) {
    logToApp(down ? 'warn' : 'info',
      down ? `HaxBall no está disponible (${reason}): no se navega al sitio`
           : 'HaxBall volvió a estar disponible');
    send('game:health', { down, reason });
    // Si volvió a estar en pie, la verificación ya no tiene para qué seguir
    // puesta: da igual si la pasó el jugador o si el muro se cayó solo entre
    // dos consultas. Va acá, en el único lugar por donde pasan los dos casos.
    if (!down) closeChallengeView();
  }

  // Se lo sigue mirando siempre; lo que cambia es cada cuánto.
  startHealthWatch();

  return { down, reason };
}

function startHealthWatch() {
  const every = haxballDown ? HEALTH_RECHECK_MS : HEALTH_IDLE_MS;
  if (healthTimer && healthEvery === every) return;
  stopHealthWatch();
  healthEvery = every;
  healthTimer = setInterval(() => { probeHaxball().catch(() => {}); }, every);
}

function stopHealthWatch() {
  if (!healthTimer) return;
  clearInterval(healthTimer);
  healthTimer = null;
}

/* ── La verificación, adentro de la app ─────────────────────────────────── *
 *
 * Un `BrowserView` pegado sobre el hueco del juego, para que el jugador pase la
 * verificación de Cloudflare sin salir del cliente. Un `BrowserView` NO es un
 * `<webview>`: no es un WebContents adentro de otro, así que no pasa por el
 * reenganche que es el que se lleva puesto el proceso. Por eso puede ir acá lo
 * que en el `<webview>` es mortal.
 *
 * La verificación la resuelve el jugador con sus propias manos, igual que en
 * cualquier navegador: no lleva preload, nadie le inyecta scripts y el cliente
 * no contesta nada por él. Lo único que hace es mostrarla y darse cuenta de
 * cuándo pasó.
 *
 * Comparte la partición con el juego, así que la cookie que deja Cloudflare al
 * resolverla queda donde el `<webview>` la va a buscar.                      */

let challengeView = null;
/** Para dejar pasar SUS peticiones mientras las del juego están frenadas. */
let challengeContentsId = null;

/** Redondeado y nunca vacío: un `BrowserView` de 0 px no muestra nada. */
function sanitizeBounds(bounds) {
  const b = bounds || {};
  return {
    x: Math.round(Number(b.x) || 0),
    y: Math.round(Number(b.y) || 0),
    width: Math.max(1, Math.round(Number(b.width) || 480)),
    height: Math.max(1, Math.round(Number(b.height) || 320))
  };
}

function openChallengeView(bounds) {
  if (!mainWindow || mainWindow.isDestroyed()) return { open: false };

  if (challengeView) {
    // Ya está puesta: sólo se la reubica, que es lo que pide un reintento.
    challengeView.setBounds(sanitizeBounds(bounds));
    return { open: true };
  }

  const view = new BrowserView({
    webPreferences: {
      partition: GAME_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  challengeView = view;
  challengeContentsId = view.webContents.id;

  mainWindow.addBrowserView(view);
  view.setBounds(sanitizeBounds(bounds));

  /*
   * Que el sitio conteste 200 acá ES la señal de que la verificación pasó:
   * mientras el muro esté puesto contesta 403. Se mira así y no con la sonda
   * porque llega en el momento exacto, sin esperar a la próxima vuelta del
   * reloj.
   */
  view.webContents.on('did-navigate', (_ev, url, code) => {
    let host = '';
    try { host = new URL(url).hostname; } catch { return; }
    if (!isHaxballHost(host) || code !== 200) return;
    onChallengeSolved();
  });

  view.webContents.loadURL(roomlistUrl());
  logToApp('info', 'HaxBall pide verificación: se muestra para resolverla');
  return { open: true };
}

/** La interfaz avisa dónde quedó el hueco cuando la ventana cambia de tamaño. */
listen('game:verify-bounds', (_e, bounds) => {
  if (!challengeView) return;
  try {
    challengeView.setBounds(sanitizeBounds(bounds));
  } catch { /* se está cerrando */ }
});

/**
 * La ventana de verificación llegó a una respuesta buena. ¿Pasó de verdad?
 *
 * Que haya recibido un 200 es una pista, no una prueba: el muro a veces
 * contesta 200 con la página de verificación adentro. Si se destrabara con eso,
 * el `<webview>` volvería a navegar al muro y el cliente se cerraría otra vez,
 * que es justo lo que hay que evitar.
 *
 * Así que se confirma preguntando —ya con la cookie que Cloudflare acaba de
 * dejar en la partición—. Si la sonda dice que está en pie, `setHaxballDown` se
 * encarga del resto: avisa a la interfaz y cierra esta ventana.
 */
function onChallengeSolved() {
  // Puede llegar más de un `did-navigate` bueno seguido; la sonda de adentro no
  // se duplica, pero al menos nos ahorramos pedirla de gusto.
  if (!haxballDown) return;
  probeHaxball().catch(() => {});
}

/** Se la saca con un respiro, para que se vea que la verificación pasó. */
function closeChallengeView() {
  const view = challengeView;
  challengeView = null;
  challengeContentsId = null;
  if (!view) return;

  /*
   * Nunca dentro del evento que trajo hasta acá: destruir el objeto que está
   * emitiendo el evento es la forma exacta en que este proyecto ya se llevó
   * puesto el proceso principal dos veces (ver el comentario de
   * `serveGameBundle`).
   */
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.removeBrowserView(view);
      const contents = view.webContents;
      if (contents && !contents.isDestroyed()) contents.destroy();
    } catch { /* ya no estaba */ }
  }, 600);
}

/*
 * Un solo `onBeforeRequest` por sesión: Electron reemplaza el anterior si se
 * registra otro. Por eso el bloqueo de anuncios y el desvío del bundle del
 * juego comparten este handler en vez de tener uno cada uno.
 */
function filterRequests(partition) {
  session.fromPartition(partition).webRequest.onBeforeRequest((details, callback) => {
    let url;
    try {
      url = new URL(details.url);
    } catch {
      return callback({ cancel: false });
    }

    /*
     * Con HaxBall caído, la navegación del documento no se deja pasar: es la
     * que confirma y mata el proceso. Se cancela en el acto, como todo lo demás
     * de acá.
     *
     * Sólo el documento de arriba (`mainFrame`). El iframe interno del juego se
     * deja en paz a propósito: una partida ya empezada es entre los jugadores y
     * sigue andando aunque el sitio se caiga, así que cancelarle navegaciones
     * sería romper lo que todavía funciona. Y el iframe no puede existir sin que
     * antes haya cargado el documento de arriba, que es el que sí se frena.
     *
     * La ventana de verificación queda afuera del freno: es la única que TIENE
     * que poder llegar al muro, porque es donde se lo resuelve. Y es una ventana
     * normal, así que no le pasa lo del `<webview>`.
     */
    if (
      haxballDown &&
      details.resourceType === 'mainFrame' &&
      isHaxballHost(url.hostname) &&
      details.webContentsId !== challengeContentsId
    ) {
      return callback({ cancel: true });
    }

    // Subdominios incluidos, pero comparando por etiqueta: "nocpmstar.com" no
    // tiene por qué caer sólo porque termine igual.
    const host = url.hostname;
    if (BLOCKED_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`))) {
      return callback({ cancel: true });
    }

    if (isGameBundle(url) && !envFlag('TVM_NO_GAME_PATCH')) {
      // Contesta en el acto, siempre. Ver el comentario de `serveGameBundle`:
      // demorar este `callback` es lo que tiraba abajo el proceso principal.
      return serveGameBundle(details.url, callback);
    }

    callback({ cancel: false });
  });
}

/* ------------------------------------------------------------------ *
 * Desvío del bundle del juego
 * ------------------------------------------------------------------ *
 * Ver `game-patch.js` para el qué y el porqué. Acá está el cómo.
 *
 * La primera vez que se ve pasar el `game-min.js` NO se lo toca: se lo deja
 * cargar tal cual y en paralelo se lo baja, se lo parchea y se lo guarda. De
 * ahí en más la petición se desvía a la copia parcheada.
 *
 * Es a propósito. La alternativa —desviar de una y bajar el original en el
 * momento— deja al cliente sin juego si esa bajada falla. Así, lo peor que
 * puede pasar es que la primera partida después de instalar vaya sin la
 * mejora, y todo lo demás siga andando igual que hoy.
 *
 * La ruta lleva el hash de despliegue de HaxBall (`/Euw8T3YR/…`), que cambia
 * en cada actualización del juego: la clave del cache es la URL entera, así
 * que una versión nueva se vuelve a parchear sola.
 */
/**
 * El main no tenía dónde loguear: se usa el mismo canal `game:log` que la
 * interfaz ya escucha, para que esto aparezca en la consola del cliente y no
 * sólo en una terminal que nadie mira.
 */
function logToApp(level, message) {
  try {
    send('game:log', { level, message, source: 'juego', at: Date.now() });
  } catch {
    /* la ventana todavía no existe */
  }
  // También a stdout: si la ventana todavía no existe, el `send` se pierde, y
  // esto es justo lo que hay que poder leer cuando algo del parche no anda.
  console.log(`[TL App:${level}] ${message}`);
}

const GAME_BUNDLE_HOST = 'game-bundle';

/*
 * Acá estuvo un rato el truco de cambiar `sounds/goal.wav` por un wav mudo,
 * para que no sonara el gol de fábrica encima del propio. Se fue, y con razón:
 * ahora el bundle parcheado le pregunta al cliente justo antes de reproducir
 * (ver `patchSounds` en `game-patch.js`), así que el aviso de fábrica se saltea
 * solo, en el instante exacto y sin depender de qué se descargó al arrancar.
 * Aquello además obligaba a recargar el juego cada vez que se cambiaba el
 * sonido, porque HaxBall baja sus sonidos una sola vez.
 */
/** URL original → texto ya parcheado, listo para servir. */
let patchedBundles = new Map();
/** URLs que ya se están bajando, para no pedirlas dos veces. */
const bundlesInFlight = new Set();

function gamePatchDir() {
  return path.join(app.getPath('userData'), 'game-patch');
}

/**
 * A qué idioma se traduce el juego. Es el mismo que el de la interfaz: tener
 * el cliente en español y HaxBall en inglés no lo pidió nadie.
 */
function gameLang() {
  try {
    return store.get().appearance.language || '';
  } catch {
    return '';
  }
}

/** Se llama al arrancar, antes de que el juego pida nada. */
function loadGamePatchCache() {
  const lang = gameLang();
  const dir = gamePatchDir();

  // Si cambió el idioma desde la última vez, se rearma acá — del original que
  // quedó guardado, sin red — para que el cambio se vea en este arranque y no
  // en el siguiente.
  try {
    const made = gamePatch.relangCache(dir, lang);
    if (made) logToApp('info', `parche del juego rearmado en "${lang}" (${made})`);
  } catch (err) {
    logToApp('warn', `no se pudo rearmar el parche para "${lang}": ${err.message}`);
  }

  patchedBundles = gamePatch.loadCache(dir, lang);
  if (patchedBundles.size) {
    logToApp('info', `parche del juego en cache (${patchedBundles.size})`);
  }
}

function isGameBundle(url) {
  return (
    /(^|\.)haxball\.com$/.test(url.hostname) &&
    /(^|\/)game-min\.js$/.test(url.pathname)
  );
}

function bundleUrl(rawUrl) {
  return `${ASSET_SCHEME}://${GAME_BUNDLE_HOST}/?u=${encodeURIComponent(rawUrl)}`;
}

/**
 * Contesta SIEMPRE en el acto. Nunca en un turno posterior.
 *
 * Antes, cuando el bundle no estaba en cache, esta función se guardaba el
 * `callback` y recién lo llamaba hasta 10 segundos después, cuando terminaba de
 * bajar y parchear. Eso es lo que hay que no hacer: el `callback` de
 * `onBeforeRequest` apunta a la petición viva del proceso principal, y si para
 * cuando se lo llama esa petición ya no existe —el juego navegó, recargó, o el
 * jugador se fue de la sala— se termina escribiendo sobre un objeto liberado y
 * el proceso principal se cae de golpe, en C++, sin pasar por JavaScript. No lo
 * ve `uncaughtException`, no queda nada en `errores.log`: sólo un volcado en
 * `Crashpad` con `this` en nulo.
 *
 * Así que la primera vez que se ve una versión nueva del bundle se la deja
 * pasar sin tocar y el parche se prepara en segundo plano para la próxima
 * carga. Es lo que decía el comentario de arriba desde el principio; el código
 * se había ido a la versión bloqueante.
 *
 * El costo es que la primera carga después de que HaxBall actualiza el juego va
 * sin las mejoras. La siguiente ya las tiene.
 */
function serveGameBundle(rawUrl, callback) {
  if (patchedBundles.has(rawUrl)) {
    logToApp('info', 'juego servido parcheado');
    return callback({ redirectURL: bundleUrl(rawUrl) });
  }

  logToApp('info', 'versión nueva del juego: esta carga va sin parche, se prepara para la próxima');
  callback({ cancel: false });

  prepareGameBundle(rawUrl)
    .then(() => {
      if (!patchedBundles.has(rawUrl)) return;
      if (!reloadGameForPatch()) {
        logToApp('info', 'parche listo: entra en la próxima carga del juego');
      }
    })
    .catch(() => { /* `prepareGameBundle` ya loguea lo suyo */ });
}

/**
 * Recarga el juego para que la sesión que está corriendo estrene el parche.
 *
 * Sin esto, la carga en la que se prepara el parche se queda sin él hasta que
 * el jugador reinicie: sin autor de gol, sin resumen, sin velocidades de
 * replay. Como el parche se prepara a los pocos segundos de abrir, casi siempre
 * pasa con el juego todavía en la pantalla de inicio y no se nota.
 *
 * No recarga si eso le costaría algo al jugador: ni jugando, ni con una sala en
 * la URL (ahí `reload` lo sacaría de la sala). En esos casos se espera a la
 * próxima carga, que es lo mismo que hacía antes.
 *
 * @returns {boolean} si se recargó
 */
function reloadGameForPatch() {
  // Cada pestaña por separado: la que está en una sala se queda como está y la
  // que mira la lista estrena el parche ahora.
  let reloaded = false;
  for (const contents of gameTabs) {
    if (reloadTabForPatch(contents)) reloaded = true;
  }
  return reloaded;
}

function reloadTabForPatch(contents) {
  const info = tabInfo.get(contents);
  if (info && info.playing) return false;
  if (!contents || contents.isDestroyed()) return false;

  let url = '';
  try { url = contents.getURL(); } catch { return false; }
  // `?c=` es el token de sala: está en una, entrando o reconectando.
  if (!url || !/^https?:/.test(url) || /[?&]c=/.test(url)) return false;

  logToApp('info', 'parche listo: se recarga el juego para estrenarlo');
  try {
    /*
     * Ignorando el cache, y esto es lo único que hace que la recarga sirva.
     *
     * Con `reload()` a secas el `game-min.js` sale del cache de Chromium —lo
     * acaba de bajar esta misma carga, la que fue sin parche— y el pedido no
     * vuelve a pasar por `onBeforeRequest`, que es donde se redirige al
     * parcheado. O sea que se recargaba, se perdía la pantalla de inicio, y el
     * juego quedaba EXACTAMENTE igual de sin parchear que antes: sin autor de
     * gol, sin resumen, sin velocidades de replay y sin modo espejo, hasta
     * reiniciar el cliente. Se notaba sólo el día que HaxBall actualiza, que es
     * el único en que se pasa por acá — y ahí se notaba en todo junto.
     *
     * Que no haya salido «juego servido parcheado» en el log después de la
     * recarga es la forma de verlo.
     */
    contents.reloadIgnoringCache();
  } catch (err) {
    logToApp('warn', `no se pudo recargar para aplicar el parche: ${err.message}`);
    return false;
  }
  return true;
}

/**
 * Baja una URL como texto. `net.request` y no `net.fetch` porque `fetch` es de
 * Electron 22 y este cliente corre sobre la 13. Va por `net` y no por `https`
 * para usar la pila de red de Chromium: respeta el proxy del sistema.
 */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = net.request(url);
    } catch (err) {
      return reject(err);
    }
    const timer = setTimeout(() => {
      try { req.abort(); } catch { /* ya terminó */ }
      reject(new Error('se agotó el tiempo de espera'));
    }, 20000);

    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        clearTimeout(timer);
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(parts).toString('utf8'));
      });
      res.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.end();
  });
}

async function prepareGameBundle(rawUrl) {
  if (patchedBundles.has(rawUrl) || bundlesInFlight.has(rawUrl)) return;
  bundlesInFlight.add(rawUrl);
  try {
    const original = await fetchText(rawUrl);
    const lang = gameLang();
    const out = gamePatch.patch(original, { lang });
    if (!out.applied) {
      logToApp('warn', `el parche del juego no se aplicó: ${out.reason}`);
      return; // sin entrada en el mapa = nunca se desvía = se sirve el original
    }
    patchedBundles.set(rawUrl, out.source);
    // El original se guarda al lado: es lo que deja cambiar de idioma sin
    // volver a bajar el bundle.
    const saved = gamePatch.saveCache(gamePatchDir(), rawUrl, out.source, lang, original);
    logToApp('info', `parche del juego listo — ${out.reason}${saved ? '' : ' (no se pudo guardar)'}`);
  } catch (err) {
    logToApp('warn', `no se pudo preparar el parche del juego: ${err.message}`);
  } finally {
    bundlesInFlight.delete(rawUrl);
  }
}

function registerAssetProtocol(partition) {
  /*
   * `registerBufferProtocol` y no `protocol.handle`: `handle` (y el `Response`
   * global que necesita) aparecieron en Electron 25 / Node 18, y este cliente
   * corre sobre Electron 13 para poder entregar cuadros por encima del refresco
   * del monitor. Ver el comentario de `applyBootFlags`.
   *
   * La API vieja contesta por callback y no tiene códigos de estado: para
   * "no existe" se llama al callback con un error, que es lo que hace que el
   * pedido falle de verdad en vez de entregar un cuerpo vacío.
   */
  session.fromPartition(partition).protocol.registerBufferProtocol(ASSET_SCHEME, (request, callback) => {
    const notFound = () => callback({ error: -6 }); // net::ERR_FILE_NOT_FOUND

    let parsed;
    try {
      parsed = new URL(request.url);
    } catch {
      return notFound();
    }

    // El tipo sale del host, no de una ruta: no hay forma de pedir otro archivo.
    const kind = parsed.hostname;

    if (kind === GAME_BUNDLE_HOST) {
      const original = parsed.searchParams.get('u') || '';
      const body = patchedBundles.get(original);
      // Si no está, algo se desincronizó: que falle y el juego lo pida de nuevo
      // a haxball.com, en vez de servir un cuerpo vacío que lo rompería.
      if (!body) return notFound();
      return callback({ mimeType: 'text/javascript', charset: 'utf-8', data: Buffer.from(body, 'utf8') });
    }

    if (kind === 'logo') {
      try {
        return callback({ mimeType: 'image/png', data: logoBuffer() });
      } catch {
        return notFound();
      }
    }

    if (kind === 'crest') {
      try {
        return callback({ mimeType: 'image/png', data: flashLogoBuffer() });
      } catch {
        return notFound();
      }
    }

    const file = assetPath(kind);
    if (!file) return notFound();

    const type = ASSET_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    try {
      return callback({ mimeType: type, data: fs.readFileSync(file) });
    } catch {
      return notFound();
    }
  });
}

/* ------------------------------------------------------------------ *
 * Ventana
 * ------------------------------------------------------------------ */
let mainWindow = null;
/**
 * ¿La ventana está en pantalla completa? Lo contestan sus eventos y nadie más.
 *
 * `mainWindow.isFullScreen()` miente durante la transición en Windows; el
 * porqué está en `emitState`. Esta variable es la respuesta a `win:state` y la
 * que decide si `win:action fullscreen` entra o sale.
 */
let windowFullscreen = false;
/** Se reemplaza al crear la ventana; permite avisar también desde los IPC. */
let emitWindowState = () => {};

/**
 * El juego ACTIVO: el `<webview>` que se ve y que recibe las teclas.
 *
 * Ya no es «el juego»: la interfaz puede tener varias pestañas de juego, cada
 * una con su propio `<webview>` en la misma partición (misma identidad, mismos
 * ajustes, otra sala). Todas viven en `gameTabs`; ésta es la que el jugador
 * está mirando, y es la que manda y recibe todo lo que tenga que ver con «lo
 * que está pasando en pantalla»: navegar, crear sala, telemetría, resumen del
 * partido, moderación. Ver `tabs:activate`.
 */
let gameContents = null;
/** Todos los `<webview>` del juego que hay montados, activo incluido. */
const gameTabs = new Set();
/**
 * Lo último que cada pestaña dijo de sí misma, para poder contarlo de nuevo al
 * activarla sin pedírselo al preload: qué pantalla de HaxBall tiene puesta, en
 * qué sala está, si está jugando. Es un `Map` por webContents; se borra con él.
 */
const tabInfo = new Map();
/** Última proporción pedida para la cancha; sobrevive a sus navegaciones. */
let gameViewportLayout = { enabled: false, width: 16, height: 9 };
/**
 * Si la interfaz tiene un panel abierto encima de la cancha.
 *
 * Se recuerda acá porque el dato lo tiene el renderer y lo necesita el juego, y
 * la página del juego se recarga sola (entrar a una sala es una navegación): sin
 * esto, el preload nuevo arranca creyendo que no hay ningún panel.
 */
let uiPanelOpen = false;
let playing = false;
let allowClose = false;
/** Ubicación que HaxBall detectó, para calcular distancias a las salas. */
let geo = null;
/** Identidad que el juego tiene puesta ahora mismo (`player_auth_key`). */
let liveAuthKey = null;

/** La pantalla donde está la mayor parte de la ventana, en píxeles CSS. */
function currentDisplayState() {
  try {
    const bounds = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow.getBounds()
      : screen.getPrimaryDisplay().bounds;
    const display = screen.getDisplayMatching(bounds);
    return {
      id: display.id,
      bounds: { ...display.bounds },
      workArea: { ...display.workArea },
      size: { ...display.size },
      scaleFactor: Number(display.scaleFactor) || 1,
      frequency: Number(display.displayFrequency) || 60
    };
  } catch {
    return null;
  }
}

/**
 * Fuerza cuadros nuevos en los dos renderers.
 *
 * La corrupción que desaparece con Alt+Tab no es un layout roto: es una
 * superficie vieja del compositor. Un solo invalidate durante la transición
 * puede caer antes de que Windows termine de cambiar el tamaño; por eso van
 * tres pedidos chicos, ya con la geometría estable.
 */
function repaintWindowSoon() {
  const repaint = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.invalidate();
    if (gameContents && !gameContents.isDestroyed()) gameContents.invalidate();
  };
  repaint();
  setTimeout(repaint, 60);
  setTimeout(repaint, 240);
}

/**
 * Pantalla completa real, administrada por Electron/Windows.
 *
 * La implementación anterior imitaba el modo sin bordes con `setBounds()`. Eso
 * deja a Windows creyendo que sigue siendo una ventana normal: la barra de
 * tareas, el área de trabajo, el DPI y el monitor activo podían discrepar del
 * tamaño que veía Chromium. También obligaba al renderer a atravesar varios
 * tamaños intermedios y era fácil que el webview quedara con la superficie
 * anterior. `setFullScreen()` conserva el modo de video del escritorio, pero
 * deja que el sistema haga la transición y restaure la ventana correctamente.
 */
function setWindowFullscreen(fullscreen) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wanted = !!fullscreen;
  if (wanted === windowFullscreen && mainWindow.isFullScreen() === wanted) return;

  // Se publica el destino antes de iniciar la transición. Así, los `resize`
  // intermedios no guardan el tamaño fullscreen como tamaño de ventana ni dejan
  // la barra superior en el estado anterior.
  windowFullscreen = wanted;
  emitWindowState();
  mainWindow.setFullScreen(wanted);

  // El evento nativo confirma el estado y vuelve a repintar. Este pedido tardío
  // cubre drivers donde el primer invalidate ocurre antes de crear la superficie.
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    repaintWindowSoon();
    mainWindow.focus();
  }, 120);
}

function toggleWindowFullscreen() {
  setWindowFullscreen(!windowFullscreen);
}

/**
 * Alto de la barra superior del cliente (`--topbar-h` en `theme.css`).
 *
 * La resolución que elige el jugador es la de la CANCHA, no la de la ventana:
 * lo que quiere es que el juego se dibuje a 1280×720, no que la ventana mida
 * 1280×720 y el juego 1280×678. Así que la ventana se crea con la barra sumada.
 *
 * Está duplicado a propósito y no es grave: si algún día no coincide, el
 * renderer lo corrige solo apenas arranca (`applyResolution` en `app.js` pide
 * el tamaño exacto midiendo el escenario de verdad). Esto es sólo para que no
 * se vea el reacomodo.
 */
const TOPBAR_H = 42;

/** Mínimo real de la ventana: el más chico que se puede pedir a mano (640×480). */
const MIN_STAGE_W = 640;
const MIN_STAGE_H = 480;

/* ── Recordar cómo quedó la ventana ─────────────────────────────────────── */

/** Si este arranque repuso una ventana guardada. Ver `app:info`. */
let windowRestored = false;
let windowSaveTimer = null;

/**
 * Escribe cómo está la ventana ahora mismo.
 *
 * Maximizada se guarda SÓLO la bandera: el tamaño que hay que conservar es el
 * de antes de maximizar —al que vuelve el botón de restaurar—, y pisarlo con el
 * de la pantalla entera dejaría la ventana sin un tamaño chico al que volver.
 *
 * En pantalla completa no se guarda nada: ese tamaño lo puso el sistema y no es
 * una decisión del jugador sobre cómo quiere su ventana.
 */
function writeWindowState() {
  clearTimeout(windowSaveTimer);
  windowSaveTimer = null;
  if (!mainWindow || mainWindow.isDestroyed() || windowFullscreen) return;

  if (mainWindow.isMaximized()) {
    store.set({ window: { maximized: true } });
    return;
  }
  const [width, height] = mainWindow.getContentSize();
  const { x, y } = mainWindow.getBounds();
  store.set({ window: { width, height, x, y, maximized: false } });
}

/**
 * Lo mismo, agrupado.
 *
 * Arrastrar o estirar la ventana dispara decenas de eventos por segundo y cada
 * `store.set` reescribe el `config.json` entero: sin el freno, mover la ventana
 * una vez son cientos de escrituras a disco.
 */
function saveWindowState() {
  if (windowSaveTimer) return;
  windowSaveTimer = setTimeout(writeWindowState, 500);
}

/**
 * El estado guardado de la ventana, si todavía tiene sentido aplicarlo.
 *
 * La posición se valida contra las pantallas que hay AHORA: si la dejaste en un
 * segundo monitor que ya no está conectado, o bajaste la resolución, reponerla
 * tal cual la dejaría fuera de la vista — y sin marco no hay barra de Windows
 * que agarrar para traerla de vuelta. En ese caso se conserva el tamaño y se
 * tira la posición, que es lo que hace que Electron la centre.
 *
 * @returns {{width:number, height:number, x:number|null, y:number|null, maximized:boolean}|null}
 */
function savedWindowState() {
  const saved = store.get().window || {};
  const width = Math.round(Number(saved.width) || 0);
  const height = Math.round(Number(saved.height) || 0);
  // Nunca se guardó, o quedó guardado algo imposible: manda la resolución.
  if (width < MIN_STAGE_W || height < MIN_STAGE_H + TOPBAR_H) return null;

  const out = { width, height, x: null, y: null, maximized: !!saved.maximized };
  const x = Number(saved.x);
  const y = Number(saved.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return out;

  /*
   * Alcanza con que quede a la vista un pedazo de la barra superior: es de
   * donde se arrastra la ventana. Pedir que entre entera sería tirar la
   * posición de cualquiera que la deje asomando fuera de la pantalla a
   * propósito, que es algo que la gente hace.
   */
  const fits = screen.getAllDisplays().some(({ workArea: a }) => (
    x + width > a.x + 80 && x < a.x + a.width - 80 &&
    y + TOPBAR_H > a.y && y < a.y + a.height - TOPBAR_H
  ));
  if (fits) {
    out.x = Math.round(x);
    out.y = Math.round(y);
  }
  return out;
}

/**
 * El fondo del tema elegido, para el cuadro que la ventana pinta antes de tener
 * página. Si el tema está roto o es uno que ya no existe, el de la casa.
 */
function bootBackground() {
  try {
    return themeVars()['--bg-0'] || '#08070C';
  } catch {
    return '#08070C';
  }
}

function createWindow() {
  // El primer tamaño de la ventana, sólo si nunca se guardó uno. Con `'auto'`
  // (o cualquier cosa que no sea AnchoxAlto) queda el de la casa.
  const resString = String(store.get().general.resolution || '');
  const [rw, rh] = resString.split('x').map(Number);
  const saved = savedWindowState();

  mainWindow = new BrowserWindow({
    /*
     * `useContentSize`: estos números son del CONTENIDO, igual que los de
     * `win:set-size`. Sin esto los dos caminos hablaban unidades distintas —el
     * arranque medía la ventana entera y el ajuste posterior sólo el contenido—
     * así que la ventana abría con el borde de más, y cuando la interfaz
     * terminaba de medirse pegaba un salto para corregirlo.
     */
    useContentSize: true,
    width: saved ? saved.width : rw || 1360,
    height: saved ? saved.height : (rh || 860) + TOPBAR_H,
    // Sin posición guardada no se pasa ninguna: así la centra Electron.
    ...(saved && saved.x != null ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_STAGE_W,
    minHeight: MIN_STAGE_H + TOPBAR_H,
    frame: false,
    show: false,
    /*
     * El fondo del tema, no el de la casa. Es el color que Chromium pinta antes
     * de que exista un solo píxel de la página: con el valor fijo, quien tuviera
     * un tema claro veía un cuadro casi negro antes de la pantalla de carga.
     */
    backgroundColor: bootBackground(),
    title: 'TL App',
    icon: clubImage(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));

  windowRestored = !!saved;

  mainWindow.once('ready-to-show', () => {
    // Maximizar ANTES de mostrar: al revés se ve un cuadro en tamaño ventana y
    // enseguida el salto, que es justo lo que se está tratando de sacar.
    if (saved && saved.maximized) mainWindow.maximize();
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  /*
   * La ventana recién cargada no tiene ninguna foto: su `state.avatars` arranca
   * vacío. Acá se olvida lo que se le mandó a la anterior y se le manda la tuya
   * de nuevo, que es la que no depende de que haya llegado un sondeo.
   *
   * Va en `did-finish-load` y no en el arranque a secas porque es también el
   * momento correcto después de una recarga (F5, o la reposición automática
   * cuando el renderer se cae).
   */
  mainWindow.webContents.on('did-finish-load', () => {
    sentAvatars = new Set();
    pushMyAvatar();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      toggleWindowFullscreen();
      event.preventDefault();
    }
  });

  /**
   * `fullscreen` sale del destino pedido y de los eventos, no de preguntarle a
   * la ventana durante la transición.
   *
   * En Windows, con la ventana sin marco, `isFullScreen()` todavía devolvía
   * `true` durante el propio evento `leave-full-screen`: la interfaz recibía
   * "seguís en pantalla completa", dejaba la barra superior escondida y no
   * volvía nunca. Los eventos ya dicen a qué estado se pasó, así que se usa eso.
   *
   * Y se ANOTA, en vez de pasarse sólo en esos dos avisos: la mentira dura toda
   * la transición, y salir de pantalla completa también emite `unmaximize` y
   * `resize`. Cualquiera de esos avisos —o un `win:state` que llegue justo—
   * volvía a contestar el valor viejo y le pisaba el bueno a la interfaz. Ahora
   * Los eventos confirman el resultado; `setWindowFullscreen` publica el destino
   * enseguida para que dos F11 seguidos sigan funcionando de forma predecible.
   */
  emitWindowState = () => send('win:state', {
    maximized: mainWindow.isMaximized(),
    fullscreen: windowFullscreen,
    display: currentDisplayState()
  });
  mainWindow.on('maximize', () => { emitWindowState(); saveWindowState(); });
  mainWindow.on('unmaximize', () => { emitWindowState(); saveWindowState(); });
  // Red de seguridad si el SO o DevTools activa el fullscreen nativo: el estado
  // no puede quedar distinto del que ve el usuario.
  mainWindow.on('enter-full-screen', () => {
    windowFullscreen = true;
    emitWindowState();
    repaintWindowSoon();
  });
  mainWindow.on('leave-full-screen', () => {
    windowFullscreen = false;
    emitWindowState();
    repaintWindowSoon();
  });
  mainWindow.on('resize', saveWindowState);
  let displayMoveTimer = null;
  mainWindow.on('move', () => {
    saveWindowState();
    clearTimeout(displayMoveTimer);
    displayMoveTimer = setTimeout(() => emitWindowState(), 120);
  });
  // El agrupado de 500 ms no llega a saltar si cerrás justo después de mover:
  // acá se escribe sin esperar.
  mainWindow.on('close', () => writeWindowState());
  // La bandera vuelve a cero con la ventana: la próxima nace en ventana, y sin
  // esto una ventana nueva heredaría el «estás en pantalla completa» de la que
  // se cerró (en macOS se recrea al volver al dock).
  mainWindow.on('closed', () => {
    // El reproductor colgaba de esta ventana: sin esto queda su sondeo girando
    // en el vacío una vez por segundo, contra una vista que ya no existe.
    ytmusic.close(mainWindow);
    mainWindow = null;
    windowFullscreen = false;
    emitWindowState = () => {};
  });

  /* ── Volver de minimizar ────────────────────────────────────────────────
   *
   * Minimizada, la ventana deja de producir cuadros y Windows le suelta la
   * superficie de dibujo. Al volver, lo que se ve hasta el primer cuadro nuevo
   * es el `backgroundColor` de la ventana — que es casi negro, y de ahí la
   * pantalla negra de un par de segundos.
   *
   * `invalidate()` le pide el repintado a cada proceso apenas vuelve, en vez de
   * esperar a que se despierten solos. Van los dos: la interfaz y el juego son
   * procesos distintos, y el que se ve tapado es el del juego.
   *
   * ── Y el otro lado del mismo problema ──────────────────────────────────
   *
   * `invalidate()` sirve para que el repintado ARRANQUE antes, pero no para que
   * termine rápido, y minimizado el cliente estaba en el peor escenario posible
   * para eso: con `disableBackgroundThrottling` puesto Chromium no le baja el
   * ritmo a una ventana que nadie ve, y con el V-Sync sacado no hay ningún
   * freno arriba, así que HaxBall seguía redibujando el canvas entero a mil y
   * pico de cuadros por segundo contra una superficie que ya no está en
   * pantalla. Al restaurar, la GPU tenía que rehacer la superficie mientras le
   * seguían llegando esos cuadros — y eso es el negro que tarda en irse.
   *
   * Minimizado se le pone un techo de 60. No se ve nada igual: lo único que
   * cambia es que la GPU tiene con qué atender el primer cuadro de verdad. */
  const repaint = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.invalidate();
    if (gameContents && !gameContents.isDestroyed()) gameContents.invalidate();
  };
  /*
   * ── Y por qué esto se MIDE en vez de mandarse de a pares ────────────────
   *
   * Antes eran `minimize` → true y `restore`/`show` → false. Los dos eventos
   * son un par, y en Windows el par se rompe: restaurar una ventana que estaba
   * maximizada emite `maximize`, no siempre `restore`. Cuando se perdía el
   * `false`, el preload se quedaba con el techo de 60 puesto y el jugador
   * seguía a 60 cuadros después de volver — hasta salir y volver a entrar a la
   * sala, que es lo único que lo arreglaba, porque entrar a una sala recarga la
   * página del juego y el preload arranca de cero.
   *
   * Preguntando `isMinimized()` en cada evento de ventana no hay nada que se
   * pueda quedar latcheado: cualquier evento posterior —el foco alcanza— lo
   * vuelve a poner en su lugar.
   */
  let wasMinimized = mainWindow.isMinimized();
  /**
   * @param {boolean} [forced] Lo que el evento YA dice sin preguntar. Se usa en
   *   `minimize`/`restore` por lo mismo que `emitState` recibe `fullscreen`: en
   *   Windows la ventana todavía contesta el estado viejo mientras se lo están
   *   cambiando. En el resto de los eventos no hay nada que suponer y se mide.
   */
  const syncMinimized = (forced) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const minimized = typeof forced === 'boolean' ? forced : mainWindow.isMinimized();
    sendToGames('game:minimized', minimized);
    // El repintado es para VOLVER de minimizar: se pide en la transición y no
    // en cada foco, que sería pedirlo por nada decenas de veces por sesión.
    if (wasMinimized && !minimized) repaint();
    wasMinimized = minimized;
  };
  mainWindow.on('minimize', () => syncMinimized(true));
  mainWindow.on('restore', () => syncMinimized(false));
  mainWindow.on('show', () => syncMinimized(false));
  // Y todo lo demás que dice que la ventana cambió de estado, para que ningún
  // aviso perdido pueda dejar el techo puesto: alcanza con volver a la ventana.
  for (const event of ['hide', 'focus', 'blur', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    mainWindow.on(event, () => syncMinimized());
  }
  // Alt+Tab recompone la imagen porque obliga al compositor a presentar otra
  // vez. Se pide explícitamente al volver, también si nunca estuvo minimizada.
  mainWindow.on('focus', repaintWindowSoon);

  // Sólo molestamos con la confirmación si hay una partida en curso.
  mainWindow.on('close', (event) => {
    if (allowClose || !playing || !store.get().general.confirmOnExit) return;
    event.preventDefault();
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Seguir jugando', 'Salir'],
      defaultId: 0,
      cancelId: 0,
      title: 'Cerrar TL App',
      message: 'Estás en una partida.',
      detail: 'Si salís ahora vas a abandonar el partido.'
    }).then((res) => {
      if (res.response !== 1) return;
      allowClose = true;
      mainWindow.close();
    });
  });

  // Los links externos abren en el navegador del sistema, nunca dentro.
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-redirect', event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * @param {object} [meta] De qué pestaña de juego viene, cuando importa. La
 *   interfaz lo recibe como segundo argumento y decide si es lo que está
 *   mirando o algo que pasó en una pestaña de atrás. Ver `tabMeta`.
 */
function send(channel, payload, meta) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (meta) mainWindow.webContents.send(channel, payload, meta);
    else if (payload === undefined) mainWindow.webContents.send(channel);
    else mainWindow.webContents.send(channel, payload);
  }
}

/** Al juego activo, y sólo a ése. Para lo que tiene que ver con la pantalla. */
function sendToGame(channel, payload) {
  if (gameContents && !gameContents.isDestroyed()) {
    if (payload === undefined) gameContents.send(channel);
    else gameContents.send(channel, payload);
  }
}

/**
 * A TODAS las pestañas de juego. Para lo que no depende de cuál se mira: la
 * configuración, el rol, si la ventana está minimizada, la proporción de la
 * cancha, el estado de la música.
 */
function sendToGames(channel, payload) {
  for (const contents of gameTabs) {
    if (contents.isDestroyed()) continue;
    if (payload === undefined) contents.send(channel);
    else contents.send(channel, payload);
  }
}

/** Con qué pestaña viene un mensaje del juego, para pasárselo a la interfaz. */
function tabMeta(event) {
  return { tab: event.sender.id, active: event.sender === gameContents };
}

/** Lo contrario: contestarle al que preguntó, esté al frente o atrás. */
function reply(event, channel, payload) {
  try {
    if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
  } catch { /* se fue mientras tanto */ }
}

/** Variables CSS del tema actual, para que la interfaz se pinte igual que el juego. */
function themeVars() {
  const look = store.get().appearance;
  return themes.appVars(themes.palette(look.theme, look.accent, look.customThemes));
}

/** Avisa a los dos lados de un cambio de configuración. */
function broadcastConfig(next) {
  sendToGames('game:config', gameConfig(next));
  applyGameZoom();
  /*
   * Y si el rol está activo. El juego dibuja cosas que son del VIP —hoy el
   * cartel de teclas— y la config sola no alcanza para saberlo: quien decide es
   * `isVip()` habilita localmente todos los beneficios de esta instalación.
   */
  sendToGames('game:vip', isVip());
  send('cfg:changed', next);
  send('theme:vars', themeVars());
  return next;
}

function gameConfig(config) {
  const { auth, ...clean } = config;
  const active = auth && (auth.items || []).find(item => item.id === auth.activeId);
  return { ...clean, auth: { activeId: active ? active.id : null, items: active ? [active] : [] },
    vip: { ...clean.vip, discord: null } };
}

/* ------------------------------------------------------------------ *
 * Los webviews: el del juego y el de YouTube Music
 * ------------------------------------------------------------------ *
 * Son dos y hay que distinguirlos, o el segundo pisaría al primero: hasta que
 * apareció la música, «cualquier webview» y «el juego» eran lo mismo.
 *
 * El reproductor terminó NO siendo un `<webview>` (es un `BrowserView`, y el
 * porqué está en ytmusic.js), así que hoy el único `<webview>` que hay es el del
 * juego. Aun así se lo reconoce por su PARTICIÓN y no por descarte: «todo lo que
 * hay es el juego» es exactamente la suposición que ya se rompió una vez.
 */
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_event, webPreferences, params) => {
    if (access.isLocked()) { _event.preventDefault(); return; }
    try {
      const url = new URL(params.src);
      if (url.protocol !== 'https:' || !isHaxballHost(url.hostname) || params.partition !== GAME_PARTITION) {
        _event.preventDefault(); return;
      }
    } catch { _event.preventDefault(); return; }
    delete webPreferences.preloadURL;
    webPreferences.preload = GAME_PRELOAD;
    // El preload tiene que compartir el `window` de HaxBall para poder
    // re-estilizarlo y escribir su configuración.
    webPreferences.contextIsolation = false;
    webPreferences.sandbox = false;
    // La página en sí nunca recibe Node; `require` queda sólo en el preload.
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.backgroundThrottling = false;
  });

  if (contents.getType() === 'webview' && contents.session === session.fromPartition(GAME_PARTITION)) {
    gameTabs.add(contents);
    tabInfo.set(contents, { view: null, room: null, playing: false, liveSettings: null });
    // La primera que aparece es la activa: la interfaz confirma después con
    // `tabs:activate`, pero mientras tanto que el juego tenga a quién hablarle.
    if (!gameContents || gameContents.isDestroyed()) setActiveGame(contents);
    for (const event of ['will-navigate', 'will-redirect']) contents.on(event, (e, target) => {
      try {
        const url = new URL(target);
        if (url.protocol !== 'https:' || !isHaxballHost(url.hostname)) e.preventDefault();
      } catch { e.preventDefault(); }
    });
    applyRuntimeFlags(store.get().perf);
    try {
      if (typeof contents.setBackgroundThrottling === 'function') {
        contents.setBackgroundThrottling(false);
      }
    } catch (eBt) {}
    contents.on('destroyed', () => {
      gameTabs.delete(contents);
      tabInfo.delete(contents);
      if (gameContents === contents) gameContents = null;
      // Si la que se fue estaba jugando, «hay alguien jugando» cambió.
      syncPlaying();
    });
    /*
     * La página del juego arranca de cero en cada navegación, y entrar a una
     * sala ES una navegación. Lo que el preload no puede averiguar solo —si la
     * ventana está minimizada, si hay un panel encima— se le vuelve a decir acá,
     * o el techo de cuadros queda mal puesto hasta el próximo cambio de estado.
     */
    contents.on('did-finish-load', () => {
      if (contents.isDestroyed()) return;
      const minimized = !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized());
      contents.send('game:minimized', minimized);
      contents.send('game:ui-panel', uiPanelOpen);
      contents.send('game:viewport', gameViewportLayout);
      contents.send('game:background', contents !== gameContents);
    });
    /*
     * El zoom va en `dom-ready` y no en `did-finish-load`: Chromium se acuerda
     * del zoom por sitio mientras dure la sesión, pero en el primer arranque no
     * hay nada guardado, y esperar a que termine de cargar la página entera se
     * vería como un salto de tamaño con la cancha ya dibujada.
     */
    contents.on('dom-ready', () => {
      applyRuntimeFlags(store.get().perf);
      applyGameZoom();
    });

    /* ── El «¿Seguro que querés salir de la sala?» de HaxBall ──────────── *
     *
     * Dentro de una sala, HaxBall pone su propio guardián de salida:
     *
     *   window.onbeforeunload = function(){ return "Are you sure you want to
     *                                              leave the room?" };
     *
     * y lo saca (`= null`) recién cuando desarma la vista de la sala. En una
     * pestaña de navegador eso es un cartel; acá NO hay cartel: Electron avisa
     * por `will-prevent-unload` y, si nadie contesta, hace lo que pide la
     * página — CANCELA la navegación, en silencio y sin error.
     *
     * De ahí salían tres cosas que parecían no tener nada que ver:
     *
     *   · Entrar por link estando en una sala no hacía nada. `rooms:join`
     *     navegaba, la navegación se cancelaba sola, y el jugador se quedaba
     *     en la sala anterior con el velo de «Conectando…» encima.
     *   · Cancelar ese intento tampoco salía: `rooms:leave` navega igual, así
     *     que también quedaba cancelada. La interfaz mostraba la lista de
     *     salas —eso lo hace sola— pero abajo seguía la sala vieja.
     *   · Y desde ahí no se podía entrar a NINGUNA sala hasta reiniciar, por
     *     lo mismo: la sala vieja seguía viva y seguía vetando cada
     *     navegación.
     *
     * Acá el guardián no tiene sentido: no hay ninguna navegación accidental
     * que atajar. Al juego se lo mueve desde la interfaz —entrar, salir,
     * recargar—, y todas esas son cosas que el jugador pidió. Así que se
     * contesta siempre lo mismo: seguí.
     */
    contents.on('will-prevent-unload', (event) => event.preventDefault());

    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  }
});

/* ------------------------------------------------------------------ *
 * Zoom del juego · Ctrl + / Ctrl - / Ctrl 0
 * ------------------------------------------------------------------ *
 * El factor se aplica a la escala de cámara del motor, antes de sus límites.
 * El canvas conserva su resolución nativa; el zoom de Chromium queda en 100%.
 * Ctrl - aleja incluso en vista dinámica. El máximo de visión fijado por el
 * estadio se respeta. Ctrl 0 vuelve a la escala original del modo elegido.
 */
const zoomControl = require('./game-zoom');
const ZOOM_STEPS = zoomControl.STEPS;
function gameZoomIndex() { return zoomControl.index(store.get().appearance.gameZoom); }
function applyGameZoom() {
  for (const contents of gameTabs) {
    if (contents.isDestroyed()) continue;
    try {
      // Render at native pixel density. Only the game's world/camera scale changes.
      if (contents.getZoomFactor() !== 1) contents.setZoomFactor(1);
      contents.send('game:zoom-factor', ZOOM_STEPS[gameZoomIndex()]);
    } catch (err) { logToApp('warn', 'No se pudo aplicar el zoom: ' + err.message); }
  }
}

/**
 * Llega del preload del juego —que es donde está el foco mientras se juega— y
 * también de la interfaz, para cuando el foco está en la barra o en un panel.
 *
 * `action`: `'in'`, `'out'` o cualquier otra cosa, que es volver a 100 %.
 */
listen('game:zoom', (_e, action) => {
  if (_e.sender !== gameContents && (!mainWindow || _e.sender !== mainWindow.webContents)) return;
  if (!['in', 'out', 'reset'].includes(action)) return;
  const index = gameZoomIndex();
  let next;
  if (action === 'in') next = ZOOM_STEPS[Math.min(index + 1, ZOOM_STEPS.length - 1)];
  else if (action === 'out') next = ZOOM_STEPS[Math.max(index - 1, 0)];
  else next = 1;

  /*
   * En las puntas de la escala no se guarda nada: mantener la tecla apretada
   * repite el evento decenas de veces por segundo, y cada `store.set` es una
   * escritura sincrónica del config.json. El cartel sale igual, que es lo que
   * dice «hasta acá llega».
   */
  if (Math.abs(next - ZOOM_STEPS[index]) > 1e-6) {
    /*
     * Se guarda, pero NO se llama a `broadcastConfig`: nadie más necesita este
     * número. Del otro lado, `game:config` rehace los ajustes de HaxBall, el
     * overlay, el cartel de teclas y el tema del documento — un tirón entero en
     * medio de la partida por cada golpe de tecla, y para nada, porque el zoom
     * lo aplica el webContents desde acá.
     */
    store.set({ appearance: { gameZoom: next } });
    applyGameZoom();
  }
  zoomToast(next);
});

/**
 * El cartel con el porcentaje, uno solo por gesto.
 *
 * Sin la espera, mantener la tecla apretada apila diez carteles —uno por
 * escalón— porque cada uno dice un número distinto y la deduplicación de la
 * interfaz sólo tapa los repetidos. Chrome muestra un globo que se actualiza
 * solo; esto es lo más parecido que se puede hacer con un sistema de carteles
 * que no se editan: se avisa cuando la mano se quedó quieta.
 */
let zoomToastTimer = null;
function zoomToast(factor) {
  clearTimeout(zoomToastTimer);
  zoomToastTimer = setTimeout(() => {
    send('game:toast', { message: `Zoom del juego ${Math.round(factor * 100)} %`, kind: '' });
  }, 150);
}

/* ------------------------------------------------------------------ *
 * Pestañas de juego
 * ------------------------------------------------------------------ *
 * Cada pestaña es un `<webview>` más en la misma partición: comparten el
 * localStorage de HaxBall (identidad, apodo, ajustes) y nada más. La interfaz
 * los monta y los saca; acá sólo se lleva cuál es el activo y qué se le dice a
 * cada uno según eso.
 *
 * La de atrás no se destruye ni se congela: sigue en su sala, con la conexión
 * viva. Lo que cambia es que se la silencia, baja el ritmo de cuadros (ver
 * `game:background` en el preload) y pierde la prioridad de proceso. Es lo que
 * hace que tener dos salas abiertas no cueste dos partidas dibujándose.
 */
function setActiveGame(contents) {
  if (!contents || contents.isDestroyed()) return;
  if (gameContents === contents) return;
  gameContents = contents;
  for (const tab of gameTabs) {
    if (tab.isDestroyed()) continue;
    const background = tab !== contents;
    try { tab.setAudioMuted(background); } catch { /* navegando */ }
    tab.send('game:background', background);
  }
  applyRuntimeFlags(store.get().perf);
  applyGameZoom();
  /*
   * La presencia —en qué sala estás, para que los otros clientes te reconozcan
   * y para Discord— es de la pestaña que se mira. Los `game:room-info` de las
   * de atrás se descartan (ver `BACKGROUND_OK_CHANNELS`), así que a la que
   * acaba de pasar al frente se le pide que lo vuelva a contar.
   */
  contents.send('game:report-room');
}

/**
 * La interfaz eligió otra pestaña. Devuelve lo último que esa pestaña dijo de
 * sí misma, para que la interfaz se ponga en esa pantalla sin esperar a que el
 * juego lo vuelva a contar.
 */
/**
 * Lo último que contó cada pestaña de juego. Es el respaldo de los avisos que
 * llegan por evento: si a la interfaz se le pierde uno (o llega antes de que se
 * suscriba), se pone al día con esto sin depender de que la pantalla cambie otra vez.
 */
handle('tabs:snapshot', () => {
  const out = {};
  for (const contents of gameTabs) {
    if (contents.isDestroyed()) continue;
    const info = tabInfo.get(contents) || {};
    out[contents.id] = {
      view: info.view || null,
      viewSeq: info.viewSeq || 0,
      room: info.room || null,
      playing: !!info.playing
    };
  }
  return out;
});

handle('tabs:activate', (_e, id) => {
  const contents = [...gameTabs].find((c) => !c.isDestroyed() && c.id === id);
  if (!contents) throw new Error('Esa pestaña ya no existe.');
  setActiveGame(contents);
  const info = tabInfo.get(contents) || {};
  return {
    view: info.view || null,
    room: info.room || null,
    playing: !!info.playing,
    liveSettings: info.liveSettings || null
  };
});

/* ------------------------------------------------------------------ *
 * Cuando un proceso se muere
 * ------------------------------------------------------------------ *
 * Hasta ahora esto no estaba mirado por nadie, y era la diferencia entre "la
 * app crashea" y saber POR QUÉ. Chromium tiene varios procesos que se pueden
 * caer por separado y ninguno avisa solo:
 *
 *   · El renderer del juego. Si se cae, el <webview> queda en blanco y la app
 *     sigue viva y aparentemente sana — parece que se colgó.
 *   · El renderer de la interfaz. Ahí sí se ve la ventana vacía.
 *   · El de YouTube Music, desde que existe la pestaña Música.
 *   · El proceso de GPU. Chromium lo levanta de nuevo solo, pero si se cae
 *     muchas veces seguidas pasa a software y todo se arrastra.
 *
 * `oom` y `crashed` son las razones que importan: la primera dice que se pasó
 * del techo de memoria, la segunda que se rompió. Van al log del cliente, que
 * es donde se pueden leer.
 */
/** Cuántas veces se repone el juego solo antes de dejarlo quieto. */
const MAX_GAME_RECOVERIES = 3;
let gameRecoveries = 0;

app.on('render-process-gone', (_event, contents, details) => {
  /*
   * Cuál se murió se pregunta por identidad, uno por uno.
   *
   * Antes era «o es la interfaz, o es el juego», y eso dejó de ser cierto en el
   * momento en que apareció el reproductor: con esa cuenta, YouTube Music
   * cayéndose —una página pesada, es lo que más se cae de las tres— se leía como
   * «se murió el juego» y disparaba la reposición. O sea que un tropiezo del
   * reproductor te habría recargado HaxBall y te habría sacado de la sala en
   * medio de un partido.
   */
  const esInterfaz = !!mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents;
  const esJuego = gameTabs.has(contents);
  const kind = esInterfaz ? 'interfaz' : esJuego ? 'juego' : 'YouTube Music';
  logToApp('error', `se murió el proceso de ${kind}: ${details.reason} (código ${details.exitCode})`);

  /*
   * La interfaz no se puede reponer desde acá sin perder el estado; el juego sí,
   * y es el que más importa. El reproductor no se repone a propósito: se lo
   * vuelve a montar solo la próxima vez que se entre a la pestaña, y recargarlo
   * en silencio sería ponerse a bajar YouTube de nuevo sin que nadie lo pida.
   */
  if (!esJuego || contents.isDestroyed()) return;
  if (details.reason === 'clean-exit' || details.reason === 'killed') return;
  if (gameRecoveries >= MAX_GAME_RECOVERIES) {
    logToApp('error', 'el juego se cayó demasiadas veces seguidas: no se repone más');
    send('game:crashed', { fatal: true, reason: details.reason });
    return;
  }
  gameRecoveries++;
  logToApp('warn', `reponiendo el juego (intento ${gameRecoveries}/${MAX_GAME_RECOVERIES})`);
  send('game:crashed', { fatal: false, reason: details.reason });
  try { contents.reload(); } catch (err) { logToApp('error', `no se pudo reponer: ${err.message}`); }
});

app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit') return;
  logToApp('error', `se murió un proceso de Chromium (${details.type}): ${details.reason}`);
});

/* ------------------------------------------------------------------ *
 * Ciclo de vida
 * ------------------------------------------------------------------ */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    try {
      powerSaveBlocker.start('prevent-app-suspension');
    } catch (ePsb) {}
    applyRuntimeFlags(store.get().perf);
    // Antes de crear la ventana: así la interfaz lee la racha ya sumada de hoy
    // en su primera lectura de la config, sin tener que refrescarla después.
    touchStreak();
    // La partición del webview: es donde vive la página de HaxBall.
    loadGamePatchCache();
    registerAssetProtocol('persist:haxball');
    filterRequests('persist:haxball');
    // Se pregunta ya, en paralelo con el resto del arranque: para cuando la
    // interfaz vaya a montar el juego, el veredicto suele estar listo.
    firstProbe = probeHaxball().catch(() => ({ down: false, reason: '' }));
    accessReady = access.init(app.getPath('userData'), (st) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('access:changed', st);
    }).catch(() => {});
    createWindow();
    const syncActiveDisplay = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      emitWindowState();
      repaintWindowSoon();
    };
    screen.on('display-metrics-changed', syncActiveDisplay);
    screen.on('display-added', syncActiveDisplay);
    screen.on('display-removed', syncActiveDisplay);
    startPresence();
    // Después de `createWindow`: el aviso de grabación nueva va a la ventana.
    startReplayWatch();
    pushMyAvatar();
    // Lo de ayer que no llegó a subir, y la racha de hoy.
    scheduleStatsPush(15000);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Último resguardo: si el sistema cierra la app, la config ya está en disco
  // porque cada `set` la escribe, pero esto cubre un cierre en el medio.
  app.on('before-quit', () => {
    store.save();
    replays.stopWatching();
  });
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */
// Only the application and its owned game webview may send IPC events.
const UI_ONLY_CHANNELS = new Set(['theme:boot-vars', 'game:moderate-request',
  'game:avatar-preview', 'keystrokes:move', 'music:bounds', 'music:move', 'game:viewport',
  'game:verify-bounds', 'ui:panel']);
/**
 * Lo que una pestaña de juego puede decir estando ATRÁS.
 *
 * Todo lo demás se ignora: una pestaña de atrás que reporta telemetría,
 * jugadores de la sala o pide un zoom estaría hablando de una pantalla que
 * nadie mira, y la interfaz lo tomaría como si fuera de la que sí. Acá entra
 * lo que no es «de la pantalla»: pedir la config, escribir ajustes de HaxBall
 * (el localStorage es compartido), contar en qué anda —que es lo que le da
 * nombre a la pestaña—, los goles de su partido (la interfaz los guarda aparte,
 * ver `tabMeta`) y lo que se contesta al propio remitente.
 */
const BACKGROUND_OK_CHANNELS = new Set(['game:bootstrap', 'cfg:set', 'game:log', 'tvm:debug-log',
  'game:settings-changed', 'game:adopt-settings', 'game:want-vip',
  'game:want-avatar-gif', 'game:want-ball-gif', 'music:want-state', 'game:auth', 'game:geo',
  'game:flags', 'game:avatar-current', 'game:keys-current', 'game:avatar-saved', 'game:mute',
  'game:themed', 'game:view', 'game:room-name', 'game:playing', 'game:live-settings',
  'game:open-url', 'game:goal', 'game:match-start', 'game:match-end', 'game:heatmap']);
function listen(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    const ui = mainWindow && event.sender === mainWindow.webContents &&
      (!event.senderFrame || event.senderFrame === mainWindow.webContents.mainFrame);
    const game = gameTabs.has(event.sender);
    if ((!ui && !game) || (UI_ONLY_CHANNELS.has(channel) && !ui)) {
      event.returnValue = null;
      return;
    }
    if (game && event.sender !== gameContents && !BACKGROUND_OK_CHANNELS.has(channel)) {
      event.returnValue = null;
      return;
    }
    return fn(event, ...args);
  });
}

let accessReady = Promise.resolve();

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!mainWindow || event.sender !== mainWindow.webContents ||
          (event.senderFrame && event.senderFrame !== mainWindow.webContents.mainFrame)) {
        throw new Error('Origen de solicitud no permitido');
      }
      return { ok: true, data: await fn(event, ...args) };
    } catch (err) {
      console.error(`[ipc:${channel}]`, err);
      return { ok: false, error: err.message || String(err) };
    }
  });
}

/* Música del menú: las del club (assets/music) y las que cada jugador suma ---- */
const MUSIC_EXT = /\.(mp3|ogg|m4a|wav|flac|opus)$/i;
const MUSIC_MAX_BYTES = 60 * 1024 * 1024;
const MUSIC_MAX_FILES = 60;
const userMusicDir = () => path.join(app.getPath('userData'), 'music');
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

async function listMusic(dir) {
  try { return (await fs.promises.readdir(dir)).filter((n) => MUSIC_EXT.test(n)).sort(byName); } catch { return []; }
}

handle('tracks:list', async () => {
  const club = (await listMusic(path.join(ROOT, 'assets', 'music')))
    .map((name) => ({ name, user: false, url: `../../assets/music/${encodeURIComponent(name)}` }));
  const dir = userMusicDir();
  const { pathToFileURL } = require('url');
  const mine = (await listMusic(dir))
    .map((name) => ({ name, user: true, url: pathToFileURL(path.join(dir, name)).href }));
  return [...club, ...mine];
});

handle('tracks:add', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Elegí tus canciones',
    filters: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'm4a', 'wav', 'flac', 'opus'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (res.canceled || !res.filePaths.length) return { added: 0, skipped: 0 };
  const dir = userMusicDir();
  await fs.promises.mkdir(dir, { recursive: true });
  let have = (await listMusic(dir)).length;
  let added = 0;
  let skipped = 0;
  for (const src of res.filePaths) {
    try {
      const stat = await fs.promises.stat(src);
      if (!stat.isFile() || stat.size > MUSIC_MAX_BYTES || have >= MUSIC_MAX_FILES || !MUSIC_EXT.test(src)) { skipped++; continue; }
      // Nombre limpio y sin pisar otro que ya esté.
      const clean = path.basename(src).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      const ext = path.extname(clean);
      const stem = clean.slice(0, clean.length - ext.length);
      let name = clean;
      for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${stem} (${i})${ext}`;
      await fs.promises.copyFile(src, path.join(dir, name));
      have++;
      added++;
    } catch { skipped++; }
  }
  return { added, skipped };
});

handle('tracks:remove', async (_e, name) => {
  const clean = path.basename(String(name || ''));
  if (!clean || clean !== name || !MUSIC_EXT.test(clean)) throw new Error('Nombre no válido');
  await fs.promises.unlink(path.join(userMusicDir(), clean));
  return true;
});

/* Lista de acceso (access.js) --------------------------------------- */
handle('access:status', async () => { await accessReady; return access.get(); });
handle('access:submit', (_e, key) => access.submit(key));
handle('access:recheck', () => access.recheck());

/* App / ventana ---------------------------------------------------- */
handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: `${os.type()} ${os.release()}`,
  cpu: os.cpus()[0] ? os.cpus()[0].model.trim() : 'Desconocido',
  totalMemory: os.totalmem(),
  userData: app.getPath('userData'),
  configPath: store.configPath(),
  gamePreload: GAME_PRELOAD,
  /*
   * Este arranque repuso la ventana como el jugador la había dejado, así que la
   * interfaz NO tiene que pedir el tamaño de la resolución al arrancar: ese
   * pedido desmaximiza y recentra (ver `win:set-size`), y deshacía lo repuesto
   * medio segundo después de abrir.
   */
  windowRestored,
  isDev
}));

listen('win:action', (_e, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  else if (action === 'close') mainWindow.close();
  // Sobre `windowFullscreen` y no sobre `isFullScreen()`: dos F11 seguidos
  // durante la transición se leían los dos como "estás adentro" y el segundo no
  // hacía nada.
  else if (action === 'fullscreen') toggleWindowFullscreen();
  else if (action === 'exit-fullscreen') setWindowFullscreen(false);
});

handle('win:state', () => ({
  maximized: !!mainWindow && mainWindow.isMaximized(),
  fullscreen: windowFullscreen,
  display: currentDisplayState()
}));

/**
 * Le da a la ventana el tamaño que hace falta para que la CANCHA quede exacta.
 *
 * El renderer manda el tamaño de ventana ya calculado —él es el único que sabe
 * cuánto le come su propia barra superior— y acá sólo se aplica, recortado a lo
 * que entra en la pantalla.
 *
 * Antes esto no existía: la resolución se leía UNA vez, al crear la ventana, y
 * cambiarla en Ajustes no hacía nada hasta reiniciar. Y encima el número era el
 * de la ventana, no el de la cancha, así que el juego siempre quedaba 42 px más
 * bajo de lo que decía la opción.
 */
handle('win:set-size', (_e, { width, height } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { applied: false };
  // En pantalla completa o maximizado no hay tamaño que dar: lo decide el SO.
  if (windowFullscreen) return { applied: false, reason: 'fullscreen' };
  if (mainWindow.isMaximized()) mainWindow.unmaximize();

  const want = {
    w: Math.max(MIN_STAGE_W, Math.round(Number(width) || 0)),
    h: Math.max(MIN_STAGE_H + TOPBAR_H, Math.round(Number(height) || 0))
  };
  if (!want.w || !want.h) return { applied: false };

  /*
   * Una resolución más grande que la pantalla dejaría la ventana con la mitad
   * afuera y sin forma de agarrar la barra para moverla.
   *
   * El recorte va contra el tamaño EXTERIOR: `setContentSize` no cuenta el
   * borde, así que recortar el contenido al área de trabajo devolvía una
   * ventana unos píxeles más grande que la pantalla — con los bordes fuera de
   * la vista y, después del `center()`, corrida de a mitades.
   */
  const area = screen.getDisplayMatching(mainWindow.getBounds()).workAreaSize;
  const bounds = mainWindow.getBounds();
  const [contentW, contentH] = mainWindow.getContentSize();
  const frame = { w: bounds.width - contentW, h: bounds.height - contentH };
  const w = Math.min(want.w, Math.max(MIN_STAGE_W, area.width - frame.w));
  const h = Math.min(want.h, Math.max(MIN_STAGE_H + TOPBAR_H, area.height - frame.h));

  mainWindow.setContentSize(w, h);
  mainWindow.center();
  return { applied: true, width: w, height: h, clamped: w !== want.w || h !== want.h };
});

/**
 * Reinicia el cliente. Casi todos los flags de Chromium sólo se leen al
 * arrancar, así que cambiarlos no sirve de nada hasta que el proceso vuelve a
 * empezar; esto ahorra tener que cerrar y abrir a mano.
 *
 * `allowClose` salta la confirmación de salida: el usuario ya decidió.
 */
handle('app:restart', () => {
  allowClose = true;
  app.relaunch();
  app.exit(0);
});

/* Configuración ---------------------------------------------------- */
handle('cfg:get', () => store.get());
handle('cfg:schema', () => ({
  game: haxball.schema(),
  themes: themes.list(store.get().appearance.customThemes),
  avatarMax: haxball.AVATAR_MAX,
  actions: haxball.ACTIONS,
  defaultKeys: haxball.DEFAULT_KEYS,
  countries: countries.COUNTRIES
}));

handle('theme:vars', () => themeVars());

/**
 * Las mismas variables, pero síncronas y para el arranque de la ventana.
 *
 * Es lo que hace que la pantalla de carga salga ya con el tema puesto en vez de
 * con el de la casa. Va por `sendSync` porque el preload las necesita antes del
 * primer cuadro; ver `paintBootTheme` en preload.js.
 */
listen('theme:boot-vars', (e) => {
  try {
    e.returnValue = themeVars();
  } catch {
    // Un tema roto no puede dejar la ventana esperando una respuesta que no
    // llega: `sendSync` bloquea al renderer hasta que se conteste algo.
    e.returnValue = null;
  }
});

handle('cfg:set', (_e, patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Configuración inválida');
  if (patch.vip && (Object.prototype.hasOwnProperty.call(patch.vip, 'discord') || '__replace' in patch.vip)) throw new Error('La sesión sólo se cambia con Discord');
  const next = store.set(patch);
  if (patch && patch.perf) applyRuntimeFlags(next.perf);
  if (patch && patch.music && 'audioOnly' in patch.music) {
    ytmusic.setAudioOnly(next.music.audioOnly !== false);
  }
  if (patch && patch.general && 'launchOnStartup' in patch.general) applyStartupFlag(next.general);
  // Cambiar de color o de fuente se tiene que ver en la sala sin esperar al
  // próximo latido.
  if (patch && patch.vip && patch.vip.cosmetics) beatPresence();
  return broadcastConfig(next);
});

handle('cfg:reset', () => broadcastConfig(store.reset()));

handle('cfg:export', async () => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar configuración',
    defaultPath: `TL-App-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return { saved: false };
  // La config incluye las identidades de HaxBall guardadas: son credenciales,
  // así que no viajan en un archivo que el usuario va a compartir.
  const rest = preferences.portable(store.get());
  fs.writeFileSync(res.filePath, JSON.stringify(rest, null, 2), 'utf8');
  return { saved: true, path: res.filePath };
});

handle('cfg:import', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar configuración',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths[0]) return { imported: false };
  if (fs.statSync(res.filePaths[0]).size > 1024 * 1024) throw new Error('La configuración supera 1 MB');
  const incoming = preferences.portable(JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8')));
  // Importar ajustes no tiene por qué borrar las identidades guardadas.
  const current = store.get();
  const next = store.replace({ ...current, ...incoming,
    general: { ...current.general, ...incoming.general },
    discord: { ...current.discord, ...incoming.discord },
    vip: { ...current.vip, ...incoming.vip, discord: current.vip.discord } });
  broadcastConfig(next);
  return { imported: true, config: next };
});

/* Temas personalizados ---------------------------------------------- */
handle('themes:save', (_e, theme) => {
  const list = [...(store.get().appearance.customThemes || [])];
  const id = theme.id || `custom-${crypto.randomBytes(8).toString('hex')}`;
  const clean = {
    id,
    label: String(theme.label || 'Mi tema').slice(0, 24),
    description: String(theme.description || '').slice(0, 80),
    dark: theme.dark !== false,
    bg: theme.bg,
    text: theme.text,
    accent: theme.accent
  };
  const at = list.findIndex((t) => t.id === id);
  at >= 0 ? list.splice(at, 1, clean) : list.push(clean);

  const next = store.set({ appearance: { customThemes: list, theme: id } });
  broadcastConfig(next);
  return { id, themes: themes.list(list) };
});

handle('themes:delete', (_e, id) => {
  const appearance = store.get().appearance;
  const list = (appearance.customThemes || []).filter((t) => t.id !== id);
  const patch = { customThemes: list };
  // Si borró el que estaba usando, vuelve al tema del club.
  if (appearance.theme === id) patch.theme = 'toda';

  const next = store.set({ appearance: patch });
  broadcastConfig(next);
  return { themes: themes.list(list) };
});

/* Identidades de HaxBall -------------------------------------------- */

/**
 * El auth es la identidad del jugador: lo que hace que una sala te reconozca
 * como vos. Vive en el localStorage de haxball.com (`player_auth_key`); acá se
 * guarda una copia para poder tener varias y cambiar entre ellas.
 */
handle('auth:state', () => ({
  ...store.get().auth,
  // Si la que está puesta no coincide con ninguna guardada, la interfaz ofrece
  // guardarla en vez de dejar que se pierda al cambiar de identidad.
  liveKnown: !!liveAuthKey && (store.get().auth.items || []).some((a) => a.key === liveAuthKey),
  liveAvailable: !!liveAuthKey
}));

handle('auth:saveCurrent', (_e, name) => {
  if (!liveAuthKey) throw new Error('El juego todavía no generó una identidad. Entrá una vez a la lista de salas.');
  const auth = store.get().auth;
  const items = [...(auth.items || [])];
  if (items.some((a) => a.key === liveAuthKey)) throw new Error('Esa identidad ya está guardada.');

  const item = {
    id: crypto.randomBytes(16).toString('hex'),
    name: String(name || '').trim().slice(0, 32) || `Identidad ${items.length + 1}`,
    key: liveAuthKey,
    createdAt: Date.now()
  };
  items.push(item);
  const next = store.set({ auth: { items, activeId: item.id } });
  broadcastConfig(next);
  return next.auth;
});

handle('auth:rename', (_e, id, name) => {
  const items = (store.get().auth.items || []).map((a) => (
    a.id === id ? { ...a, name: String(name || '').trim().slice(0, 32) || a.name } : a
  ));
  const next = store.set({ auth: { items } });
  broadcastConfig(next);
  return next.auth;
});

handle('auth:delete', async (_e, id) => {
  const auth = store.get().auth;
  const item = (auth.items || []).find((a) => a.id === id);
  if (!item) return auth;

  const res = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancelar', 'Borrar'],
    defaultId: 0,
    cancelId: 0,
    title: 'Borrar identidad',
    message: `¿Borrar «${item.name}»?`,
    detail: 'Si no tenés esta clave guardada en otro lado, la perdés para siempre y las salas dejan de reconocerte con ella.'
  });
  if (res.response !== 1) return auth;

  const items = (auth.items || []).filter((a) => a.id !== id);
  const next = store.set({
    auth: { items, activeId: auth.activeId === id ? null : auth.activeId }
  });
  broadcastConfig(next);
  return next.auth;
});

/**
 * Cambiar de identidad significa escribir otra clave en el localStorage del
 * juego, y eso HaxBall lo lee al arrancar: hay que recargarlo.
 */
handle('auth:activate', (_e, id) => {
  const auth = store.get().auth;
  if (id && !(auth.items || []).some((a) => a.id === id)) throw new Error('Esa identidad no existe.');
  const next = store.set({ auth: { activeId: id || null } });
  broadcastConfig(next);
  return next.auth;
});

handle('auth:export', async (_e, id) => {
  const item = (store.get().auth.items || []).find((a) => a.id === id);
  if (!item) throw new Error('Esa identidad no existe.');
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar identidad',
    defaultPath: `haxball-auth-${item.name.replace(/[\\/:*?"<>|]/g, '')}.txt`,
    filters: [{ name: 'Texto', extensions: ['txt'] }]
  });
  if (res.canceled || !res.filePath) return { saved: false };
  fs.writeFileSync(res.filePath, item.key, 'utf8');
  return { saved: true, path: res.filePath };
});

/** Pegar una clave que el jugador tenga anotada de otra instalación. */
handle('auth:add', (_e, { name, key }) => {
  const clean = String(key || '').trim();
  // HaxBall descarta en silencio una clave con el formato mal y arranca sin
  // identidad — en la sala se ve como "auth desconocida" y no hay forma de
  // adivinar por qué. Se valida acá para poder decirlo.
  if (!haxball.isValidAuthKey(clean)) {
    throw new Error('Esa no es una clave de HaxBall. Tiene que empezar con "idkey." y traer sus tres partes. Ojo: el auth corto que muestran los hosts es el identificador público, no la clave.');
  }

  const auth = store.get().auth;
  const items = [...(auth.items || [])];
  if (items.some((a) => a.key === clean)) throw new Error('Esa identidad ya está guardada.');

  const item = {
    id: crypto.randomBytes(16).toString('hex'),
    name: String(name || '').trim().slice(0, 32) || `Identidad ${items.length + 1}`,
    key: clean,
    createdAt: Date.now()
  };
  items.push(item);
  const next = store.set({ auth: { items, activeId: item.id } });
  broadcastConfig(next);
  return next.auth;
});

/* Replays ---------------------------------------------------------- */
handle('replays:list', () => replays.list());
handle('replays:chooseFolder', () => replays.chooseFolder(mainWindow));
handle('replays:open', (_e, file) => replays.open(file));
handle('replays:reveal', (_e, file) => replays.reveal(file));
handle('replays:rename', (_e, file, name) => replays.rename(file, name));
handle('replays:openFolder', () => shell.openPath(replays.folder()));

/* El análisis archivado de una grabación, si ya se hizo alguna vez. */
handle('replays:archived', (_e, file) => {
  const entry = replayArchive.get(file);
  return entry ? entry.summary : null;
});
handle('replays:archive', (_e, file, summary) => !!replayArchive.put(file, summary));

/*
 * Grabaciones nuevas en la carpeta.
 *
 * Sólo se avisan las que el archivo NO conoce. HaxBall deja el .hbr2 con un
 * nombre feo y lo primero que hace cualquiera es renombrarlo, y renombrar
 * dispara el mismo evento del sistema de archivos que crear: sin este filtro, la
 * misma grabación se anunciaría como nueva cada vez que se le cambia el nombre.
 * La identidad no es el nombre, es el contenido (ver `keyOf`).
 */
function startReplayWatch() {
  replays.watch((item) => {
    if (replayArchive.get(item.path)) return;
    send('replays:new', item);
  });
}

/* Saltar a un gol y el carrete: los dos los ejecuta el preload del juego, que es
   el único que llega al reproductor. Ver `seekReplay` y `startReel`. */
handle('replay:seek', (_e, ms) => {
  if (!gameContents || gameContents.isDestroyed()) throw new Error('El juego todavía no cargó.');
  sendToGame('game:seek-replay', { ms });
  return true;
});
handle('replay:reel', (_e, goals) => {
  if (!gameContents || gameContents.isDestroyed()) throw new Error('El juego todavía no cargó.');
  sendToGame('game:reel', { goals });
  return true;
});

/**
 * Reproduce el replay dentro del cliente: se lo pasamos al preload, que se lo
 * mete al <input type="file"> del propio reproductor de HaxBall.
 */
handle('replays:play', (_e, file) => {
  if (!gameContents || gameContents.isDestroyed()) throw new Error('El juego todavía no cargó.');
  const replay = replays.read(file);
  sendToGame('game:play-replay', replay);
  return { name: replay.name, size: replay.size };
});

handle('replays:trash', async (_e, file) => {
  const res = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancelar', 'Mandar a la papelera'],
    defaultId: 0,
    cancelId: 0,
    title: 'Eliminar replay',
    message: `¿Mandar "${path.basename(file)}" a la papelera de reciclaje?`,
    detail: 'Vas a poder recuperarlo desde la papelera de Windows.'
  });
  if (res.response !== 1) return replays.list();
  return replays.trash(file);
});

/* Estadísticas ------------------------------------------------------ */
/** Lo que la interfaz puede sumar de a uno. Nada se puede restar ni pisar. */
const STAT_COUNTERS = ['sessions', 'matches', 'goals', 'assists', 'ownGoals'];

handle('stats:add', (_e, patch = {}) => {
  const current = store.get().stats;
  const next = { lastPlayed: new Date().toISOString() };

  for (const key of STAT_COUNTERS) {
    const add = Math.max(0, Math.round(Number(patch[key]) || 0));
    if (add) next[key] = (current[key] || 0) + add;
  }
  const seconds = Math.max(0, Math.round(Number(patch.seconds) || 0));
  if (seconds) next.secondsPlayed = current.secondsPlayed + seconds;

  const stats = store.set({ stats: next }).stats;
  scheduleStatsPush();
  return stats;
});

/* ── Tus estadísticas en tu perfil del sitio ───────────────────────────────
 *
 * Se suben enteras (son ocho números), no de a diferencias: así el sitio se
 * corrige solo si alguna vez se pierde un envío, y no hay nada que reconciliar.
 * El servidor se queda con el más alto de cada uno, así que reinstalar no borra
 * lo que ya subiste.
 *
 * Nunca se avisa de un fallo: subir esto es un extra y el cliente funciona sin
 * cuenta y sin internet. Si no salió, sale en el próximo envío. */
let statsPushTimer = null;

/** Junta varios cambios seguidos en un solo envío. */
function scheduleStatsPush(delay = 60000) {
  if (statsPushTimer) return;
  statsPushTimer = setTimeout(() => {
    statsPushTimer = null;
    pushStats();
  }, delay);
  // Que esto no sea lo que mantiene viva la app al cerrarla.
  if (statsPushTimer.unref) statsPushTimer.unref();
}

async function pushStats() {
  const cfg = store.get();
  // Sin sesión no hay perfil al que subirlas, y no hay nada que decidir: tus
  // números son parte de tu perfil del sitio, no una opción.
  if (!cfg.vip.discord) return;
  await panel.pushStats(cfg.vip.discord, cfg.stats);
}

/* ── Racha de días ─────────────────────────────────────────────────────────
 *
 * Se cuenta al abrir el cliente, una vez por día y en hora LOCAL: la racha es de
 * días del jugador, no de UTC — si no, a la noche en Argentina el día ya cambió
 * y una racha real se cortaría sola.
 *
 * El día se compara como texto `YYYY-MM-DD` armado con el calendario local, y no
 * restándole 24 horas al reloj, que se corre con los cambios de horario. */
function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function touchStreak() {
  const stats = store.get().stats;
  const today = localDay();
  if (stats.lastDay === today) return;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const streak = stats.lastDay === localDay(yesterday) ? (stats.streak || 0) + 1 : 1;

  store.set({
    stats: {
      lastDay: today,
      streak,
      bestStreak: Math.max(stats.bestStreak || 0, streak)
    }
  });
}

/* ── Presencia: reconocer a otros con el cliente ───────────────────────────
 *
 * HaxBall no transmite nada que permita saber si el de al lado usa el mismo
 * cliente: la sala manda nombre, avatar y posición, y nada más. La única forma
 * de que dos clientes se reconozcan es que los dos le cuenten a un tercero
 * dónde están, y ese tercero es el sitio (ver `panel.js` y, del otro lado,
 * `server/services/clientPresence.js`).
 *
 * Acá vive el latido: cada ~30 s se manda «estoy en esta sala con este nombre»
 * y vuelve la lista de los otros clientes que están en la misma. Esa lista va
 * derecho al preload del juego, que es el que pinta la lista de jugadores.
 *
 * Sin sala no hay a quién reconocer, pero el latido sale igual: es de donde
 * salen las métricas de cuántos tienen el cliente abierto. Lo único que viaja
 * es un id anónimo, la versión y el sistema.                                */

/** Nombre del archivo con el id de instalación, dentro de userData. */
const INSTALL_FILE = 'install-id';

let installId = null;
let presenceTimer = null;
let presenceEveryMs = 30000;

/**
 * Lo que el preload del juego dice que está pasando ahora mismo.
 *
 * `room` es el token (o `name:…` hosteando) y se manda HASHEADO. `token` es el
 * mismo token en claro y no sale de acá salvo que invites a un amigo a mano.
 */
let roomInfo = { room: null, token: null, name: null, nick: null };

/**
 * Id anónimo y estable de ESTA instalación.
 *
 * Va en un archivo aparte y no en la config a propósito: la config se exporta e
 * importa entre PCs, y dos instalaciones con el mismo id se contarían como una.
 * Es azar puro — no sale de nada de la máquina ni de la persona.
 */
function getInstallId() {
  if (installId) return installId;
  const file = path.join(app.getPath('userData'), INSTALL_FILE);
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (/^[A-Za-z0-9_-]{8,64}$/.test(saved)) {
      installId = saved;
      return installId;
    }
  } catch { /* primera vez */ }

  installId = crypto.randomBytes(16).toString('hex');
  try {
    fs.writeFileSync(file, installId, 'utf8');
  } catch {
    /* Sin disco el id dura lo que la sesión: se cuenta de más una vez y ya. */
  }
  return installId;
}

/** Comparte el aspecto elegido; el servidor puede aplicar sus propias reglas. */
function myCosmetics() {
  const looks = store.get().vip.cosmetics || {};
  // Sólo viajan los identificadores de lo elegido, nunca CSS: el que dibuja es
  // el cliente del otro y no tiene por qué confiar en lo que le mandan.
  const out = {
    gradient: looks.gradient || null,
    font: looks.font && looks.font !== 'default' ? looks.font : null
  };
  return out.gradient || out.font ? out : null;
}

async function beatPresence() {
  const cfg = store.get();

  /*
   * Sólo se comparte una huella anónima de sala para aplicar las marcas del
   * cliente. No se publica el nombre de la sala ni preferencias sociales.
   */
  const res = await panel.beat({
    install: getInstallId(),
    version: app.getVersion(),
    os: `${os.type()} ${os.release()}`,
    profile: cfg.vip.discord,
    room: panel.roomFingerprint(roomInfo.room),
    nick: roomInfo.nick,
    cosmetics: myCosmetics()
  });
  if (!res) return;

  // El servidor decide el ritmo: así se puede aflojar sin sacar una versión.
  if (res.everyMs !== presenceEveryMs) {
    presenceEveryMs = res.everyMs;
    startPresence();
  }
  /*
   * Se guarda además de mandarse. El latido que dispara entrar a una sala suele
   * volver ANTES de que el juego termine de montar la vista, y sin esto esa
   * respuesta —la primera, la que trae a todos los que ya estaban— se perdía
   * contra un webview que todavía no escuchaba. Las marcas aparecían recién en
   * el latido siguiente.
   */
  lastPeers = { room: roomInfo.room, list: res.peers };
  sendToGame('game:peers', res.peers);
}

/**
 * Lo último que contestó el sitio, con la sala a la que corresponde.
 *
 * La sala va guardada y se compara antes de repetir: repintar en una sala las
 * marcas de OTRA sería ponerle el escudo a gente que no tiene el cliente, que es
 * peor que no ponerle nada a nadie.
 */
let lastPeers = { room: null, list: [] };

function startPresence() {
  clearInterval(presenceTimer);
  presenceTimer = setInterval(() => { beatPresence(); }, presenceEveryMs);
  if (presenceTimer.unref) presenceTimer.unref();
}

/**
 * El preload del juego avisa dónde está: la sala (ya hasheada) y con qué
 * nombre. Cada cambio dispara un latido, para no esperar hasta 30 segundos a
 * que aparezcan las marcas al entrar a una sala.
 */
listen('game:room-info', (_e, info) => {
  const room = info && info.room ? String(info.room).slice(0, 64) : null;
  const nick = info && info.nick ? String(info.nick).slice(0, 25) : null;
  const name = info && info.name ? String(info.name).slice(0, 60) : null;
  const token = info && info.token ? String(info.token).slice(0, 64) : null;
  if (room === roomInfo.room && nick === roomInfo.nick && name === roomInfo.name) return;
  roomInfo = { room, token, name, nick };

  /*
   * Lo que ya se sabía de ESTA sala, de vuelta y en el acto. Empezar o terminar
   * la partida rehace la vista entera, y ahí el juego se queda sin peers hasta
   * que conteste el sitio: un ratito con las filas peladas. Si la sala es otra
   * no se manda nada — el latido de abajo trae los que corresponden.
   */
  if (room && room === lastPeers.room && lastPeers.list.length) {
    sendToGame('game:peers', lastPeers.list);
  }
  beatPresence();
  /*
   * Y de paso, cómo se llama la sala guardada para «volver».
   *
   * Va acá y no en `game:room-name` porque este aviso trae el token Y el nombre
   * juntos: allá el nombre llega primero y el token puede seguir siendo el de
   * la sala anterior por un instante, que es exactamente cómo se le termina
   * poniendo a una sala el nombre de otra.
   */
  const saved = store.get().rooms;
  if (name && token && token === saved.lastToken && saved.lastName !== name) {
    store.set({ rooms: { lastName: name } });
    send('rooms:last', lastRoom());
  }
});

/*
 * El juego avisa que cambió la lista de la sala: entró o salió alguien.
 *
 * Quién más está usando el cliente lo contesta el sitio, y sólo llega en la
 * respuesta del latido. Tu propia entrada ya disparaba uno (acá arriba); la de
 * los demás no disparaba ninguno, así que el escudo del que entraba después que
 * vos esperaba hasta el próximo tic — treinta segundos.
 *
 * El freno vive de este lado y no en el preload: cada latido es una petición al
 * sitio, y el aviso llega desde el proceso del juego, que es el que no conviene
 * dejar mandando el ritmo. Cinco segundos alcanzan para que se sienta inmediato
 * sin convertir una sala que rota gente en una ráfaga de pedidos.
 */
const PEERS_NUDGE_MIN_MS = 5000;
let lastPeersNudge = 0;

listen('game:peers-stale', () => {
  // Fuera de una sala no hay peers que pedir, y el latido ya sale solo.
  if (!roomInfo.room) return;
  const now = Date.now();
  if (now - lastPeersNudge < PEERS_NUDGE_MIN_MS) return;
  lastPeersNudge = now;
  beatPresence();
});

/**
 * Qué fotos tiene ya la ventana que está viva AHORA.
 *
 * No alcanza con el caché de `avatars.js` —ese sabe qué se bajó, no qué llegó—.
 * Se vacía cuando la ventana vuelve a cargar: ahí el `state.avatars` del
 * renderer arranca en cero y hay que mandarle todo de nuevo, cosa que antes no
 * pasaba y dejaba las caras en blanco después de una recarga.
 */
let sentAvatars = new Set();

/** Baja las que falten y le manda a la ventana sólo lo que todavía no tiene. */
async function pushAvatars(urls) {
  const found = await avatars.resolve(urls);
  const fresh = {};
  for (const [url, data] of Object.entries(found)) {
    if (sentAvatars.has(url)) continue;
    sentAvatars.add(url);
    fresh[url] = data;
  }
  if (Object.keys(fresh).length) send('avatar:resolved', fresh);
}

/**
 * Tu propia foto. No alcanza con la del sondeo de amigos: esa necesita que el
 * sitio conteste, y tu foto tiene que estar en tu tarjeta de jugador aunque el
 * panel esté caído — la URL ya la trajo el login de Discord.
 */
function pushMyAvatar() {
  const profile = store.get().vip.discord;
  if (profile && profile.avatar) pushAvatars([profile.avatar]);
}

/* Los beneficios VIP de esta instalación están disponibles para el club. */
function isVip() {
  return true;
}

/**
 * Copia el archivo elegido a userData. Si quedara apuntando al original, mover
 * o borrar ese archivo dejaba el avatar (o el sonido) roto sin explicación.
 *
 * Estos recursos son locales a la instalación del club.
 */
async function pickAsset(title, filters, name) {
  const res = await dialog.showOpenDialog(mainWindow, { title, filters, properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return null;

  const source = res.filePaths[0];
  const stat = fs.statSync(source);
  if (stat.size > 8 * 1024 * 1024) throw new Error('El archivo no puede pasar los 8 MB.');

  const account = store.get().vip.discord;
  const owner = account && /^\d{15,25}$/.test(String(account.id)) ? String(account.id) : 'guest';
  const dir = path.join(app.getPath('userData'), 'vip', owner);
  fs.mkdirSync(dir, { recursive: true });

  // Content-addressed files can be shared by a migrated guest and an account.
  // Replacing an image must not delete a file referenced by another profile.
  const ext = path.extname(source).slice(1).toLowerCase();
  if (!filters.some(filter => filter.extensions.includes(ext))) throw new Error('Formato de archivo no permitido');
  const bytes = fs.readFileSync(source);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const target = path.join(dir, `${name}-${digest}.${ext}`);
  if (!fs.existsSync(target)) fs.writeFileSync(target, bytes);
  return target;
}

handle('vip:pickAvatar', async () => {
  const file = await pickAsset(
    'Elegí la imagen de tu avatar',
    [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    'avatar'
  );
  if (!file) return store.get().vip;
  return broadcastConfig(store.set({ vip: { avatarImage: file } })).vip;
});

handle('vip:pickBall', async () => {
  const file = await pickAsset(
    'Elegí la imagen de la pelota',
    [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    'ball'
  );
  if (!file) return store.get().vip;
  return broadcastConfig(store.set({ vip: { ballImage: file } })).vip;
});

handle('vip:pickGoalSound', async () => {
  const file = await pickAsset(
    'Elegí tu sonido de gol',
    [{ name: 'Audio', extensions: ['mp3', 'ogg', 'wav', 'm4a'] }],
    'goal'
  );
  if (!file) return store.get().vip;
  return broadcastConfig(store.set({ vip: { goalSound: file } })).vip;
});

handle('vip:pickHitSound', async () => {
  const file = await pickAsset(
    'Elegí tu sonido para la patada',
    [{ name: 'Audio', extensions: ['mp3', 'ogg', 'wav', 'm4a'] }],
    'hit'
  );
  if (!file) return store.get().vip;
  return broadcastConfig(store.set({ vip: { hitSound: file } })).vip;
});

handle('vip:clearAsset', (_e, which) => {
  const key = which === 'avatar' ? 'avatarImage'
    : which === 'ball' ? 'ballImage'
    : which === 'hit' ? 'hitSound'
    : 'goalSound';
  return broadcastConfig(store.set({ vip: { [key]: '' } })).vip;
});

/* Actualizaciones --------------------------------------------------- *
 * El feed y el instalador viven en un bucket de Cloudflare R2. El detalle del
 * formato está en updater.js.                                               */

/** Instalador ya descargado y verificado, esperando a que lo ejecuten. */
let pendingInstaller = null;

handle('update:check', () => updater.check(app.getVersion()));

handle('update:download', async () => {
  const dir = path.join(app.getPath('temp'), 'tvm-client-updates');
  const result = await updater.download(
    app.getVersion(),
    dir,
    (progress) => send('update:progress', progress)
  );
  pendingInstaller = result.path;
  return result;
});

/**
 * Ejecuta el instalador descargado y se aparta: NSIS necesita que el cliente
 * esté cerrado para reemplazar los archivos.
 */
handle('update:install', async () => {
  if (!pendingInstaller || !fs.existsSync(pendingInstaller)) {
    throw new Error('No hay ningún instalador descargado.');
  }
  const error = await shell.openPath(pendingInstaller);
  if (error) throw new Error(error);
  allowClose = true;
  setTimeout(() => app.quit(), 800);
  return { started: true };
});

/* Misceláneo -------------------------------------------------------- */
handle('shell:openExternal', (_e, url) => {
  if (!/^https?:/.test(url)) throw new Error('URL no permitida');
  return shell.openExternal(url);
});
handle('shell:openPath', (_e, target) => shell.openPath(target));

/* Salas -------------------------------------------------------------- */
handle('rooms:list', () => roomlist.fetchRooms(geo));
handle('flags:get', () => flags.get());

/**
 * Llevar el juego a otra URL, pasando siempre por `about:blank`.
 *
 * El paso por el blanco no es un adorno: la sala de la que se está saliendo
 * tiene WebRTC vivo, y cargar la sala nueva encima de la vieja dejaba la
 * conexión a medio morir. `about:blank` desarma la página entera —el juego se
 * entera, corre su propia limpieza— y recién después se carga la que va.
 *
 * Se saltea si ya estamos en el blanco: ahí no hay nada que desarmar.
 *
 * La carga final NO se espera. El que llama tiene que poder contestarle a la
 * interfaz en el acto para que ponga el velo de «Conectando…» sobre la carga;
 * esperarla sería mostrar el velo cuando ya no hace falta.
 *
 * Ojo con el guardián de salida de HaxBall: sin el `will-prevent-unload` de más
 * arriba, TODO esto se cancela solo y en silencio estando dentro de una sala.
 */
async function navigateGame(url) {
  if (!gameContents || gameContents.isDestroyed()) throw new Error('El juego todavía no cargó.');
  const contents = gameContents;

  let current = '';
  try { current = contents.getURL(); } catch { /* recién creado */ }

  if (/^https?:/i.test(current)) {
    try { contents.stop(); } catch { /* no había nada cargando */ }
    // Si el blanco falla igual se sigue: quedarse donde estaba es peor.
    try { await contents.loadURL('about:blank'); } catch { /* interrumpida */ }
    if (contents.isDestroyed()) return;
  }

  contents.loadURL(url).catch(() => { /* ya se está yendo a otro lado */ });
}

handle('rooms:join', async (_e, tokenOrLink) => {
  const token = roomlist.parseRoomLink(tokenOrLink);
  if (!token) throw new Error('Ese link no parece de una sala de HaxBall.');
  await navigateGame(roomlist.roomUrl(token));
  rememberRoom(token);
  return { token };
});

/* ── La última sala ─────────────────────────────────────────────────────── *
 *
 * Se guarda en el config y no en memoria: el caso que más importa no es
 * equivocarse de botón, es que se te cierre el cliente —o que lo cierres vos
 * enojado— y quieras volver a donde estabas.
 *
 * Se guarda el TOKEN, que es lo único con lo que se puede volver a entrar, y el
 * nombre sólo para poder decir a dónde. Hosteando no hay token —HaxBall lo
 * genera adentro—, así que una sala propia no se puede recuperar por acá.     */

function rememberRoom(token) {
  const clean = String(token || '').trim().slice(0, 64);
  if (!clean || clean === store.get().rooms.lastToken) return;
  // El nombre lo pone el juego cuando lo lea (`game:room-name`); acá todavía
  // puede no estar, y guardar el de la sala ANTERIOR sería peor que no guardar.
  store.set({ rooms: { lastToken: clean, lastName: null, lastAt: Date.now() } });
  send('rooms:last', lastRoom());
}

/** Lo que la interfaz necesita para ofrecer «volver». */
function lastRoom() {
  const saved = store.get().rooms;
  if (!saved.lastToken) return null;
  return { token: saved.lastToken, name: saved.lastName || null, at: saved.lastAt || 0 };
}

handle('rooms:last', () => lastRoom());

/**
 * La lista de salas del propio HaxBall: a dónde se vuelve al cancelar.
 *
 * Se le saca el `?c=` por si la URL configurada apunta a una sala: con el token
 * puesto, HaxBall vuelve a intentar la misma conexión de la que el jugador se
 * está queriendo ir.
 */
function roomlistUrl() {
  const raw = String(store.get().general.gameUrl || 'https://www.haxball.com/play');
  try {
    const url = new URL(raw);
    url.searchParams.delete('c');
    return url.toString();
  } catch {
    return 'https://www.haxball.com/play';
  }
}

/**
 * Cortar el «Conectando…» y volver a la lista.
 *
 * Es una navegación y no un `reload`: recargar dejaría al juego intentando lo
 * mismo. Y va por acá, no por `webview.reload()` en el renderer, porque la
 * gracia es poder salir incluso cuando la pantalla del juego quedó trabada.
 */
handle('rooms:leave', async () => {
  await navigateGame(roomlistUrl());
  return { ok: true };
});

/* Discord ----------------------------------------------------------- */
handle('discord:apply', () => discord.apply(store.get().discord));

/**
 * Cómo se dice dónde estás. `alone` es la línea de arriba cuando no se muestra
 * la sala; `under` va abajo de la sala cuando no hay música sonando.
 */
const PRESENCE_PLACES = {
  game: 'Jugando una partida',
  room: 'Esperando en una sala',
  replay: 'Viendo una repetición',
  menu: 'En el menú'
};

/** Lo último que contó la interfaz: dónde está el jugador y en qué sala. */
let presenceInfo = { place: 'menu', room: null };

/**
 * La presencia indica dónde está el jugador, sin publicar enlaces ni nombres
 * de sala de forma predeterminada.
 *
 * Solo se envían el lugar y el estado de juego; nunca datos de música ni
 * botones o enlaces externos.
 */
function pushDiscordPresence() {
  const cfg = store.get().discord;
  if (!cfg.enabled) return;
  const place = PRESENCE_PLACES[presenceInfo.place] ? presenceInfo.place : 'menu';
  const room = cfg.showRoom && presenceInfo.room ? String(presenceInfo.room).slice(0, 100) : '';
  discord.setActivity({
    details: 'Toda la lechita',
    state: room
      ? `HaxBall · ${PRESENCE_PLACES[place]} · ${room}`
      : `HaxBall · ${PRESENCE_PLACES[place]}`
  });
}

/**
 * La interfaz nos dice dónde está el jugador; acá se traduce a presencia.
 *
 * `room` es el nombre de la sala o, mirando un replay, el de la grabación. Se
 * comparte sólo si el jugador habilitó mostrarlo en los ajustes de Discord.
 *
 * @param {{place:string, room:string|null}} info
 */
handle('discord:presence', (_e, info) => {
  const cfg = store.get().discord;
  if (!cfg.enabled) return { ok: false };
  presenceInfo = {
    place: String(info?.place || 'menu'),
    room: info?.room ? String(info.room) : null
  };
  pushDiscordPresence();
  return { ok: true };
});

handle('rooms:create', (_e, options) => {
  if (!gameContents || gameContents.isDestroyed()) throw new Error('El juego todavía no cargó.');
  const name = String(options?.name || '').trim();
  if (!name) throw new Error('Falta el nombre de la sala.');
  sendToGame('game:create-room', {
    name: name.slice(0, 60),
    password: String(options?.password || '').slice(0, 40),
    maxPlayers: Math.min(20, Math.max(2, parseInt(options?.maxPlayers, 10) || 12)),
    listed: options?.listed !== false
  });
  return { ok: true };
});

/* Puente con el juego ----------------------------------------------- */
listen('game:settings-changed', (event, patch) => {
  if (!gameTabs.has(event.sender) || !patch || typeof patch !== 'object') return;
  const game = {};
  for (const setting of haxball.SETTINGS) {
    if (!Object.prototype.hasOwnProperty.call(patch, setting.id)) continue;
    if (!['string', 'number', 'boolean'].includes(typeof patch[setting.id])) continue;
    const value = haxball.normalize(setting, patch[setting.id]);
    if (value !== store.get().game[setting.id]) game[setting.id] = value;
  }
  if (!Object.keys(game).length) return;
  const next = store.set({ game });
  // The game already applied this change. Avoid rebuilding its HUD/theme.
  send('cfg:changed', next);
  send('game:settings-changed', game);
});
listen('game:bootstrap', (e) => {
  e.returnValue = {
    ok: true,
    data: {
      config: gameConfig(store.get()),
      // El refresco real del monitor: con eso el preload calcula solo su ritmo de
      // cuadros cuando están desbloqueados, sin pedirle nada al jugador.
      displayHz: displayHz(),
      // En desarrollo se dan por activos los cosméticos VIP, para poder probarlos
      // sin depender de que el sitio de verificación esté en línea.
      devMode: isDev
    }
  };
});

function displayHz() {
  try {
    const hz = screen.getPrimaryDisplay().displayFrequency;
    return Number.isFinite(hz) && hz >= 30 ? Math.round(hz) : 60;
  } catch {
    return 60;
  }
}

/**
 * ¿Se puede navegar a HaxBall?
 *
 * La interfaz pregunta esto ANTES de montar el `<webview>`. Al arranque la
 * consulta ya salió, así que lo normal es que esto conteste al instante; si
 * todavía está en camino, se espera a que termine —son unos pocos cientos de
 * milisegundos detrás de la pantalla de carga— porque montar el juego sin
 * saberlo es justo lo que cierra el cliente.
 *
 * `recheck` es para el botón de reintentar: fuerza una consulta nueva en vez de
 * contestar con el último veredicto.
 */
handle('game:health', async (_e, { recheck = false } = {}) => {
  if (recheck) return probeHaxball();
  if (firstProbe) await firstProbe.catch(() => {});
  return { down: haxballDown, reason: haxballReason };
});

/**
 * Abre la verificación de Cloudflare para que la resuelva el jugador.
 *
 * Sólo tiene sentido cuando lo que hay es el muro: si el sitio está caído de
 * verdad no hay nada que resolver y la ventana mostraría el mismo error.
 */
handle('game:verify', (_e, bounds) => {
  if (!haxballDown || haxballReason !== 'challenge') {
    return { open: false, reason: haxballReason };
  }
  return openChallengeView(bounds);
});

/**
 * Recarga el juego (cambiar de identidad o de ajustes lo necesita).
 *
 * Se recargan las pestañas que están en la lista de salas y nada más. Las que
 * están adentro de una sala no se tocan: recargar es salir, y entrar a la
 * próxima sala YA es una carga nueva del juego, con los ajustes nuevos puestos
 * por el preload antes de que arranque. La interfaz ya espera a que la pestaña
 * activa salga de la sala (`canReloadGame`); acá se cuida a las otras.
 *
 * @returns {{reloaded:number, skipped:number}}
 */
handle('game:reload', () => {
  if (!gameTabs.size) throw new Error('El juego todavía no cargó.');
  let reloaded = 0;
  let skipped = 0;
  for (const contents of gameTabs) {
    if (contents.isDestroyed()) continue;
    const info = tabInfo.get(contents);
    const idle = !info || info.view === null || info.view === 'roomlist';
    if (!idle) { skipped++; continue; }
    contents.reload();
    reloaded++;
  }
  return { reloaded, skipped };
});

/** Muestra el avatar fijo sin esperar a la próxima recarga. */
listen('game:avatar-preview', () => sendToGame('game:avatar-preview'));

listen('game:telemetry', (_e, payload) => send('game:telemetry', payload));
listen('game:viewport', (_e, layout) => {
  const width = Math.min(10000, Math.max(1, Number(layout && layout.width) || 16));
  const height = Math.min(10000, Math.max(1, Number(layout && layout.height) || 9));
  gameViewportLayout = { enabled: !!(layout && layout.enabled), width, height };
  sendToGames('game:viewport', gameViewportLayout);
});
listen('game:log', (_e, payload) => {
  // En desarrollo va también a la terminal. El log del preload del juego termina
  // en el devtools de la interfaz, que es justo el que nadie tiene abierto
  // cuando algo del juego no arranca; la terminal de `npm run dev` sí.
  if (isDev && payload) console.log(`[juego:${payload.level}] ${payload.source}: ${payload.message}`);
  send('game:log', payload);
});
/** El preload pide mostrar un aviso: hay un solo sistema de carteles, el de la app. */
listen('game:toast', (_e, payload) => send('game:toast', payload));
/** El engranaje del HUD del juego abre los ajustes del cliente, no los de HaxBall. */
listen('game:open-settings', () => send('game:open-settings'));
// La interfaz pide moderar o animar el avatar; el preload del juego lo ejecuta.
listen('game:moderate-request', (_e, action) => sendToGame('game:moderate', action));

/**
 * El juego pregunta si el rol está activo.
 *
 * `broadcastConfig` lo manda con cada cambio de configuración, pero el juego
 * carga cuando quiere —y recarga solo al cambiar de identidad—, así que arranca
 * sin saberlo. Preguntar es de una línea; adivinar desde el config, no.
 */
listen('game:want-vip', (e) => reply(e, 'game:vip', isVip()));

/**
 * Los bytes del avatar animado.
 *
 * El juego ya carga la imagen por `tvm-asset://`, pero de un `<img>` no se
 * pueden sacar los cuadros de un GIF: hay que decodificarlo, y para eso hace
 * falta el archivo entero. Va por IPC una sola vez, al cargar el avatar.
 *
 * Que se MUEVA es lo que pide el rol; la imagen fija no. Sin rol no se manda
 * nada y el GIF se ve como cualquier imagen: su primer cuadro.
 */
const MAX_GIF_BYTES = 8 * 1024 * 1024;

/**
 * Los primeros `n` bytes de un archivo, sin traerlo entero.
 *
 * Un avatar puede pesar 8 MB y esto se pregunta en cada carga del juego: para
 * saber si es un GIF alcanzan seis.
 */
function headOf(file, n) {
  const buf = Buffer.alloc(n);
  const fd = fs.openSync(file, 'r');
  try {
    const leidos = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, leidos);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Le manda al juego los bytes de un GIF, si de verdad lo es y si hay rol.
 *
 * Lo comparten el avatar y la pelota: la regla es la misma para los dos —la
 * imagen la puede poner cualquiera, que se MUEVA es lo que pide el rol— y el
 * control de firma y de tamaño no tiene por qué estar escrito dos veces.
 */
function sendGifTo(e, channel, file, what) {
  if (!file) return reply(e, channel, null);
  try {
    // Quién es un GIF lo dice la FIRMA, no el nombre: una imagen bajada de la
    // web se guarda como `.png` con un GIF adentro más seguido de lo que
    // parece, y filtrando por extensión eso no animaba nunca.
    if (!gif.esGif(headOf(file, 6))) return reply(e, channel, null);

    const stat = fs.statSync(file);
    if (stat.size > MAX_GIF_BYTES) {
      send('game:toast', { message: `El GIF pesa ${Math.round(stat.size / 1048576)} MB y el máximo son 8 MB.`, kind: 'err' });
      return reply(e, channel, null);
    }
    reply(e, channel, { file, bytes: fs.readFileSync(file) });
  } catch (err) {
    reply(e, channel, null);
    send('game:log', { level: 'error', message: `no se pudo leer el GIF de ${what}: ${err.message}`, source: 'vip', at: Date.now() });
  }
}

/**
 * Silenciar o volver a leer a alguien, desde el menú del jugador.
 *
 * La lista se guarda entera y no por diferencias: son unos pocos apodos y así
 * el tope de 100 se aplica en un solo lugar. Sin tope, un config.json con una
 * lista enorme haría que cada mensaje del chat la recorra entera.
 */
listen('game:mute', (_e, payload) => {
  const nick = String((payload && payload.nick) || '').trim().slice(0, 25);
  if (!nick) return;

  const current = (store.get().chat.muted || []).filter((n) => String(n).trim() !== nick);
  const next = payload && payload.muted ? [...current, nick].slice(-100) : current;
  broadcastConfig(store.set({ chat: { muted: { __replace: next } } }));
});

listen('game:want-avatar-gif', (e) => sendGifTo(e, 'game:avatar-gif', store.get().vip.avatarImage, 'el avatar'));
listen('game:want-ball-gif', (e) => sendGifTo(e, 'game:ball-gif', store.get().vip.ballImage, 'la pelota'));

/** La interfaz enciende o apaga el modo mover del cartel de teclas. */
listen('keystrokes:move', (_e, on) => sendToGame('game:keystrokes-move', !!on));

/**
 * El modo mover se apagó desde el juego: el jugador tocó en cualquier otro lado.
 * La interfaz tiene que enterarse o su botón queda ofreciendo terminar algo que
 * ya terminó.
 */
listen('keystrokes:move-off', () => send('keystrokes:move-off'));

/**
 * El cartel de teclas terminó de arrastrarse: se guarda dónde quedó.
 *
 * Los porcentajes se recortan acá y no del lado del juego: esto entra a la
 * config, y lo que entra a la config se valida en el proceso que la escribe.
 */
listen('keystrokes:moved', (_e, at) => {
  const clamp = (value) => Math.min(97, Math.max(0, Number(value) || 0));
  broadcastConfig(store.set({ vip: { keystrokes: { x: clamp(at && at.x), y: clamp(at && at.y) } } }));
});

/* ------------------------------------------------------------------ *
 * YouTube Music
 * ------------------------------------------------------------------ *
 * El proceso principal es el que habla con el reproductor (ver ytmusic.js). Acá
 * están los dos lados del puente: los mandos que llegan —de la pestaña Música y
 * del cartel de la cancha, que son dos procesos distintos pidiendo lo mismo— y
 * el estado, que sale para los dos a la vez.
 */

/** El último estado, para el que llegue tarde (una recarga del juego, otra vista). */
let musicState = ytmusic.state();

ytmusic.onChange((next) => {
  musicState = next;
  send('music:state', next);
  // El cartel vive adentro del documento del juego y es otro proceso: se le
  // manda igual, aunque no haya nadie mirando la pestaña Música.
  sendToGames('game:music', next);
  rememberVolume(next.volume);
});

/* ── El volumen, entre sesiones ─────────────────────────────────────────── *
 *
 * YouTube Music no se lo guarda: cada arranque del cliente volvía al 100%, y
 * bajarlo todos los días es exactamente el tipo de cosa que uno espera que la
 * app recuerde. Así que se lee del reproductor mientras suena, se anota, y se le
 * vuelve a poner apenas carga (ver `applySavedVolume` en ytmusic.js).           */

let volumeSaveTimer = null;
/** El volumen que está esperando para guardarse, para poder guardarlo al cerrar. */
let volumePending = null;

function saveVolumeNow() {
  clearTimeout(volumeSaveTimer);
  volumeSaveTimer = null;
  if (volumePending === null) return;
  const v = volumePending;
  volumePending = null;
  try {
    /*
     * `store.set` y no `broadcastConfig`: esto no lo mira nadie de la interfaz
     * —el cartel lee el volumen del propio reproductor— y avisar de un cambio de
     * config repintaría los paneles cada vez que se mueve la barra.
     */
    store.set({ music: { volume: v } });
    ytmusic.setSavedVolume(v);
  } catch (err) {
    console.error('[ytmusic] no se pudo guardar el volumen:', err.message);
  }
}

function rememberVolume(volume) {
  if (!Number.isFinite(volume)) return;
  const v = Math.min(1, Math.max(0, volume));
  /*
   * La espera va ANTES de comparar, y ése era el error. Al arrancar, la página
   * decía 100 un instante (el de fábrica) y eso quedaba programado para
   * guardarse; un segundo después se le ponía el guardado, pero como ése era
   * igual al del config, la función volvía antes de cancelar lo programado — y
   * el 100 se guardaba igual encima. Ahora cualquier valor nuevo cancela lo que
   * estaba esperando, también si es para volver al que ya estaba.
   */
  clearTimeout(volumeSaveTimer);
  volumeSaveTimer = null;
  volumePending = null;

  // En pasos de 1%: esto llega mientras alguien arrastra la barra, y escribir el
  // config por una diferencia que nadie oye es escribirlo veinte veces por gesto.
  const antes = Number(store.get().music.volume);
  if (Math.round(v * 100) === Math.round((Number.isFinite(antes) ? antes : 1) * 100)) return;

  volumePending = v;
  volumeSaveTimer = setTimeout(saveVolumeNow, 700);
}

// Cerrar el cliente con el volumen recién tocado no puede perderlo: el último
// cambio se guarda en el acto en vez de esperar a un temporizador que ya no va
// a correr.
app.on('before-quit', saveVolumeNow);

/** Alguien recién llegó y necesita saber qué está sonando. */
listen('music:want-state', (e) => {
  try {
    e.sender.send(gameTabs.has(e.sender) ? 'game:music' : 'music:state', musicState);
  } catch { /* se fue mientras tanto */ }
});

handle('music:state', () => musicState);

/**
 * Un mando. Contesta lo que dijo el reproductor en vez de tragarse el fallo:
 * «el botón no está en la página» es lo que hay que ver si YouTube Music le
 * cambia el markup a su barra, y si eso se pierde el síntoma es un botón que
 * no hace nada y no dice por qué.
 */
handle('music:cmd', (_e, payload) =>
  ytmusic.command(String(payload && payload.kind || ''), payload ? payload.value : undefined));

/** Y el mismo mando, pero desde el cartel de la cancha, que no usa `invoke`. */
listen('music:cmd', (_e, payload) => {
  ytmusic.command(String(payload && payload.kind || ''), payload ? payload.value : undefined);
});

handle('music:login', () => ytmusic.login(mainWindow));
handle('music:logout', () => ytmusic.logout());
handle('music:home', () => { ytmusic.goHome(); return { ok: true }; });
handle('music:reload', () => { ytmusic.reload(); return { ok: true }; });

/* ── Dónde se ve el reproductor ─────────────────────────────────────────── *
 *
 * El reproductor es un `BrowserView`, o sea que NO vive adentro del documento:
 * lo pega el proceso principal sobre la ventana, en las coordenadas que le pasa
 * la interfaz, que es la única que sabe qué pestaña está abierta y qué hay
 * encima. Es el mismo trato que ya tenía la verificación de Cloudflare.
 *
 * `bounds` en `null` es «ahora no se tiene que ver»: se va fuera de pantalla y
 * la música sigue sonando. Ver `open`/`setBounds` en ytmusic.js.
 */
handle('music:show', (_e, bounds) => {
  if (!store.get().music.enabled) return { ok: false, reason: 'apagada' };
  // Antes de abrir: es lo que se le pone al reproductor apenas termine de cargar.
  ytmusic.setSavedVolume(Number(store.get().music.volume));
  ytmusic.setAudioOnly(store.get().music.audioOnly !== false);
  const primera = !ytmusic.state().ready && !ytmusic.visible();
  const res = ytmusic.open(mainWindow, bounds || null);
  // Queda en el log a propósito: si algún día YouTube Music deja de responder,
  // lo primero que hay que saber es si se llegó a abrir.
  if (primera && res.ok) logToApp('info', 'YouTube Music abierto');
  return res;
});

/** Reubicarlo. Llega seguido —al cambiar de pestaña, al mover la ventana—. */
listen('music:bounds', (_e, bounds) => ytmusic.setBounds(mainWindow, bounds || null));

/** Apagarlo del todo. Acá sí muere la música: es lo que se pidió. */
handle('music:close', () => { ytmusic.close(mainWindow); return { ok: true }; });

/** F7 desde la cancha: mostrar o esconder el cartel. */
listen('music:toggle-hud', () => {
  const on = !store.get().music.hud.enabled;
  broadcastConfig(store.set({ music: { hud: { enabled: on } } }));
});

/** La interfaz enciende o apaga el modo mover del cartel de música. */
listen('music:move', (_e, on) => sendToGame('game:music-move', !!on));

/** Se apagó desde el juego: el jugador tocó en cualquier otro lado. */
listen('music:move-off', () => send('music:move-off'));

/** El cartel terminó de arrastrarse. Los porcentajes se recortan del lado que escribe. */
listen('music:moved', (_e, at) => {
  const clamp = (value) => Math.min(97, Math.max(0, Number(value) || 0));
  broadcastConfig(store.set({ music: { hud: { x: clamp(at && at.x), y: clamp(at && at.y) } } }));
});

/** El usuario lo activó con /anim en el chat: se guarda para la próxima sesión. */
listen('game:avatar-saved', (_e, payload) => {
  const patch = { animated: !!payload?.animated };
  if (payload && typeof payload.frames === 'string') patch.frames = payload.frames.slice(0, 40);
  broadcastConfig(store.set({ avatar: patch }));
});

/**
 * Primer arranque tras la actualización: lo que el jugador ya tenía puesto
 * dentro de HaxBall pasa a la config del cliente, en vez de perderse.
 */
listen('game:adopt-settings', (_e, payload) => {
  if (store.get().general.adoptedGameSettings) return;
  const patch = {
    general: { adoptedGameSettings: true },
    game: payload?.game || {}
  };
  if (payload?.nickname) patch.general.nickname = String(payload.nickname).slice(0, 25);
  if (payload?.avatar) patch.avatar = { static: haxball.clampAvatar(payload.avatar) };
  broadcastConfig(store.set(patch));
});

/** La identidad que el juego tiene puesta ahora mismo. */
listen('game:auth', (_e, payload) => {
  liveAuthKey = payload && payload.key ? String(payload.key) : null;
  send('auth:live', { available: !!liveAuthKey });
});

/**
 * El avatar que el juego tiene puesto ahora mismo. Si el cliente todavía no
 * tiene uno propio, se adopta ése: la pantalla de Aspecto arranca mostrando lo
 * que el jugador ya venía usando en HaxBall en vez de "sin avatar".
 */
/** Los controles que el juego tiene puestos, para partir de ahí. */
listen('game:keys-current', (_e, payload) => {
  send('keys:live', { keys: haxball.cleanKeys(payload && payload.keys) });
});

listen('game:avatar-current', (_e, payload) => {
  const face = haxball.clampAvatar(payload && payload.face);
  if (!face) return;
  if (!store.get().avatar.static) {
    broadcastConfig(store.set({ avatar: { static: face } }));
  }
  send('avatar:live', { face });
});

listen('game:flags', async (_e, info) => {
  const data = await flags.update(info);
  if (data) send('flags:ready', data);
});

listen('game:geo', (_e, value) => {
  const first = !geo;
  geo = value;
  // La primera vez avisamos: la lista se pidió sin ubicación y no tiene distancias.
  if (first) send('rooms:stale');
});

/**
 * Qué pantalla de HaxBall está activa: la interfaz decide qué mostrar.
 *
 * Llega de cualquier pestaña, con la marca de cuál. La interfaz cambia de
 * pantalla sólo si es la que se mira; de las otras se queda con el dato para
 * el rótulo de la pestaña.
 */
listen('game:view', (e, kind) => {
  const info = tabInfo.get(e.sender);
  if (info) {
    info.view = kind;
    // Número de aviso: la interfaz lo compara contra el último que recibió para
    // darse cuenta de si se le perdió alguno (ver `reconcileTabs` en app.js).
    info.viewSeq = (info.viewSeq || 0) + 1;
    // Fuera de una sala no hay sala: si quedara guardado, al activar la
    // pestaña se contaría el nombre de la anterior.
    if (kind === 'roomlist') { info.room = null; info.playing = false; }
  }
  send('game:view', kind, { ...tabMeta(e), seq: info ? info.viewSeq : 0 });
});

/**
 * La interfaz abrió o cerró un panel encima de la cancha. El juego usa el dato
 * para bajar el ritmo de cuadros mientras el jugador está mirando otra cosa:
 * con los cuadros desbloqueados, la cancha satura el proceso de GPU y ese mismo
 * proceso es el que tiene que dibujar el panel.
 */
listen('ui:panel', (_e, open) => {
  uiPanelOpen = !!open;
  sendToGames('game:ui-panel', uiPanelOpen);
});

/**
 * El nombre de la sala, leído del propio HaxBall. Es lo que le da nombre a la
 * presencia de Discord cuando se entra por un link y no hay ninguna fila
 * seleccionada en la lista del cliente.
 */
listen('game:room-name', (e, name) => {
  const info = tabInfo.get(e.sender);
  if (info) info.room = name || null;
  send('game:room-name', name || null, tabMeta(e));
});

/**
 * Si los ajustes de HaxBall se pueden cambiar con el juego andando. Depende de
 * que haya entrado el parche del bundle (ver `game-patch.js`); cuando no, la
 * interfaz vuelve a ofrecer la recarga en vez de no hacer nada.
 */
listen('game:live-settings', (e, info) => {
  const mine = tabInfo.get(e.sender);
  if (mine) mine.liveSettings = info || { available: false };
  send('game:live-settings', info || { available: false }, tabMeta(e));
});

/**
 * Un link del chat. Se abre en el navegador del sistema, nunca acá adentro: la
 * ventana del juego no es un navegador y no tiene con qué volver.
 */
listen('game:open-url', (_e, url) => {
  if (/^https?:\/\//i.test(String(url || ''))) shell.openExternal(String(url));
});

/** El preload ya inyectó el tema: recién ahí conviene mostrar el juego. */
listen('game:themed', () => {
  // El juego volvió a cargar entero y bien: la cuenta de caídas seguidas se
  // borra, así que una caída aislada cada tantas horas no gasta los reintentos.
  gameRecoveries = 0;
  send('game:themed');
});

/* ── Que la pantalla no se apague jugando ─────────────────────────────────
 *
 * `powerSaveBlocker.start()` devuelve un id y `stop(id)` lo necesita. Acá se
 * llamaba `stop()` pelado, y eso tira un TypeError de Electron ("Insufficient
 * number of arguments") en cada final de partida. Dos consecuencias, las dos
 * calladas hasta que se miraba la consola:
 *
 *   · el bloqueo NUNCA se soltaba, así que la pantalla no se apagaba más aunque
 *     dejaras de jugar;
 *   · y como el id de `start()` se tiraba, cada partida nueva encima sumaba otro
 *     bloqueo arriba del anterior.
 */
let displayBlocker = null;

function keepDisplayAwake(on) {
  try {
    if (on) {
      if (displayBlocker === null || !powerSaveBlocker.isStarted(displayBlocker)) {
        displayBlocker = powerSaveBlocker.start('prevent-display-sleep');
      }
      return;
    }
    if (displayBlocker !== null && powerSaveBlocker.isStarted(displayBlocker)) {
      powerSaveBlocker.stop(displayBlocker);
    }
    displayBlocker = null;
  } catch (err) {
    // Que la pantalla se apague no puede ser motivo para tirar la app abajo.
    logToApp('warn', `no se pudo cambiar el bloqueo de pantalla: ${err.message}`);
  }
}

/** HaxBall monta .game-view sólo cuando estás jugando o viendo un replay. */
listen('game:playing', (e, value) => {
  const info = tabInfo.get(e.sender);
  if (info) info.playing = !!value;
  send('game:playing', !!value, tabMeta(e));
  syncPlaying();
});

/**
 * «Hay alguien jugando» es de la app entera, no de la pestaña que se mira:
 * decide si cerrar pide confirmación y si la pantalla se puede apagar. Con una sola pestaña era el
 * último `game:playing`; con varias es «alguna».
 */
function syncPlaying() {
  let any = false;
  for (const [contents, info] of tabInfo) {
    if (!contents.isDestroyed() && info.playing) { any = true; break; }
  }
  if (any === playing) return;
  playing = any;
  keepDisplayAwake(playing);
}

/* ── Resumen del partido ──────────────────────────────────────────────────
 *
 * Los tres llegan del preload del juego, que es el único que ve la cancha, y
 * van derecho a la interfaz, que es la única que dibuja el resumen. */

/** Un gol, ya con autor y asistencia resueltos. */
listen('game:goal', (e, payload) => send('game:goal', payload || {}, tabMeta(e)));

/** Arrancó un partido nuevo: el resumen anterior ya no vale. */
listen('game:match-start', (e) => send('game:match-start', undefined, tabMeta(e)));

/** Se terminó: recién acá la interfaz suma el partido a tus estadísticas. */
listen('game:match-end', (e, score) => {
  send('game:match-end', score || null, tabMeta(e));
});
/* El mapa de calor del partido que se acaba de terminar. Llega justo antes
   del fin, que es cuando el preload todavía tiene la grilla sin vaciar. */
listen('game:heatmap', (e, payload) => send('game:heatmap', payload || null, tabMeta(e)));

/** F9 adentro del juego: abre y cierra el dock de amigos. */

/** Alt+T, Alt+W y Alt+1…4 adentro del juego: las pestañas las lleva la interfaz. */
listen('tabs:key', (_e, action) => {
  if (['new', 'close', 'next', 'prev'].includes(action) || /^go:[1-4]$/.test(String(action))) {
    send('tabs:key', action);
  }
});

/**
 * Tab dentro del juego, o el botón «Resumen» del reproductor de replays. El
 * botón manda `analyze` para que la interfaz, además de abrir el panel, pida el
 * análisis de la grabación entera.
 */
listen('game:toggle-stats', (_e, payload) => send('game:toggle-stats', payload || {}));

/* ── Análisis de una grabación entera ─────────────────────────────────────
 *
 * El trabajo lo hace el preload del juego, que es el único que llega al
 * reproductor. Acá se espera la respuesta y se la devuelve a quien la pidió, así
 * la interfaz escribe un `await` y no tiene que armar un evento suelto con su
 * propio tiempo de espera.
 */
let analyzing = false;

handle('replay:analyze', () => new Promise((resolve, reject) => {
  if (!gameContents || gameContents.isDestroyed()) {
    reject(new Error('El juego todavía no cargó.'));
    return;
  }
  if (analyzing) {
    reject(new Error('Ya hay un análisis en curso.'));
    return;
  }
  analyzing = true;

  const done = (fn, value) => {
    analyzing = false;
    clearTimeout(timer);
    ipcMain.removeListener('game:replay-summary', onSummary);
    fn(value);
  };
  // Una grabación larga tarda unos segundos; más que esto es que algo se colgó.
  const timer = setTimeout(() => done(reject, new Error('El análisis tardó demasiado.')), 60000);
  const onSummary = (_e, payload) => done(resolve, payload || { ok: false, reason: 'El juego no contestó.' });

  ipcMain.once('game:replay-summary', onSummary);
  sendToGame('game:analyze-replay');
}));
