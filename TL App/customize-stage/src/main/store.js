'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const haxball = require('./haxball-settings');

const FILE = 'config.json';

const DEFAULTS = {
  version: 22,
  general: {
    gameUrl: 'https://www.haxball.com/play',
    nickname: '',
    launchOnStartup: false,
    confirmOnExit: true,
    /** En la pantalla de inicio: racha, partidos, goles y horas jugadas. */
    welcomeSummary: true,
    /**
     * Resolución de LA CANCHA, no de la ventana: `'AnchoxAlto'` dibuja el juego
     * a ese tamaño y lo estira hasta llenar la ventana (o la pantalla), o
     * `'auto'`, que es dibujarlo del tamaño que tenga la ventana, sin estirar.
     * El estirado lo hace el preload del juego (`applyGameViewport`).
     */
    resolution: 'auto',
    fakePing: 0,
    /**
     * La primera vez que corre esta versión, el cliente se queda con lo que el
     * jugador ya tenía puesto dentro de HaxBall (extrapolación, avatar, sonido)
     * en vez de pisárselo con los valores de fábrica. Después manda la config.
     */
    adoptedGameSettings: false,
    /**
     * Con qué tecla se abre el resumen del partido.
     *
     * Tab viene de fábrica, pero es la MISMA que HaxBall usa para el chat, y el
     * preload la corta en captura para que no hagan las dos cosas a la vez. O
     * sea que mientras esto diga `Tab`, el chat no se abre con Tab — que es
     * exactamente de lo que se quejan los que juegan con el chat abierto.
     *
     * Con cualquier otro valor (o con `''`, que es «ninguna») el preload deja
     * pasar Tab y vuelve a ser de HaxBall.
     */
    summaryKey: 'Tab'
  },
  /**
   * Cómo quedó la ventana la última vez, para volver a abrirla igual.
   *
   * `width`/`height` son del CONTENIDO y `x`/`y` del marco: son las unidades que
   * devuelven `getContentSize()` y `getBounds()`, y las mismas que espera
   * `win:set-size`. Mezclar el tamaño exterior con el del contenido es lo que
   * hacía que la ventana abriera unos píxeles corrida de donde se la dejó.
   *
   * En cero significa «nunca se guardó»: ahí manda `general.resolution`.
   */
  window: {
    width: 0,
    height: 0,
    x: null,
    y: null,
    maximized: false
  },
  appearance: {
    accent: '#8C702A',
    /** Un solo tema para toda la app y para las pantallas de HaxBall. */
    theme: 'toda',
    /** Temas que armó el jugador: { id, label, description, dark, bg, text, accent } */
    customThemes: [],
    language: 'es',
    cleanMode: true,
    animations: true,
    /** Intro del club al abrir la app y su sonido. */
    welcome: true,
    welcomeSound: true,
    /** Partículas doradas flotando en el menú. */
    sparks: true,
    /** Música del menú de salas (archivos en assets/music) y su volumen. */
    music: true,
    /** Sonidos suaves al pasar el mouse y apretar botones. */
    uiSounds: true,
    musicVolume: 0.35,
    /** Saca el chat de la pantalla durante la partida y en la sala. */
    hideChat: false,
    /** El cartel de gol estilo TV, con autor y asistencia. */
    goalBanner: true,
    /** Tamaño de la botonera flotante de la partida. */
    hudScale: 1,
    /** Factor de zoom de cámara: conserva la resolución nativa del canvas. */
    gameZoom: 1
  },
  // Ajustes propios de HaxBall (ver haxball-settings.js)
  game: {
    ...haxball.defaults(),
    chatTimestamps: false
  },
  perf: {
    flatGraphics: false,
    /**
     * FPS siempre desbloqueados: se le saca a Chromium el V-Sync y el limitador
     * del compositor. Combinado con desynchronized: false en el canvas, Electron 13
     * entrega ~900-1000 FPS fluidos sin stuttering.
     */
    unlockFps: true,
    /**
     * Límite de FPS, en cuadros por segundo. `0` es sin límite.
     *
     * Mismos valores que el cliente Zero (0/30/60/144/240). Si se elige un
     * techo, el limitador saltea cuadros para no pasar de ese número.
     */
    fpsCap: 0,
    highProcessPriority: true,
    disableBackgroundThrottling: true,
    // GPU
    gpuRasterization: true,
    zeroCopy: true,
    forceGpu: false,
    highPerformanceGpu: true,
    noOcclusionPause: true,
    // Audio
    lowLatencyAudio: true,
    // Diagnóstico
    disableHardwareAcceleration: false
  },
  overlay: {
    enabled: false,
    position: 'top-right',
    opacity: 0.85,
    showFps: true,
    showPing: true,
    showClock: false,
    showSession: true
  },
  replays: {
    folder: path.join(os.homedir(), 'Downloads')
  },
  /**
   * La última sala en la que estuviste, para poder volver. Ver `rememberRoom`
   * en main.js: se guarda el token porque es lo único con lo que se entra, y el
   * nombre sólo para poder decir a dónde se vuelve.
   */
  rooms: {
    lastToken: null,
    lastName: null,
    lastAt: 0
  },
  /**
   * Los avisos de amigos que además suenan.
   *
   * El aviso visual (el toast) sale siempre: es la respuesta a algo que pasó y
   * no molesta a nadie. El sonido sí interrumpe —suena arriba de la partida— así
   * que va por separado y cada tipo se apaga solo.
   *
   * No hay archivos de audio: los tonos los sintetiza la ventana con WebAudio
   * (ver `notifySound()` en app.js). Así el aviso no depende de un .mp3 que
   * empaquetar, y suena igual con el juego mudo.
   */
  notify: {
    messages: true,
    invites: true,
    requests: true,
    volume: 0.5
  },
  /** Tokens de salas marcadas como favoritas. */
  favorites: [],
  discord: {
    enabled: true,
    // Aplicación de Discord del cliente. El nombre que Discord muestra en
    // grande («jugando a …») es el nombre de ESTA aplicación, no algo que se
    // pueda mandar por RPC: se cambia en discord.com/developers.
    appId: '1557982543301574767',
    showRoom: false,
    /** El tema de YouTube Music que suena, con su tapa chiquita. */
    showMusic: false
  },
  avatar: {
    /** Avatar fijo de HaxBall: hasta 2 caracteres (clave `avatar`). */
    static: '',
    /** Si está en true, el cliente rota los cuadros con /avatar. */
    animated: false,
    frames: '',
    /** Piso real: 500 ms. Más rápido llena el chat de "Avatar set". */
    intervalMs: 700
  },
  /**
   * Controles del juego: { códigoDeTecla: acción }. Vacío significa "los que
   * tenga HaxBall"; en cuanto el jugador toca algo se guarda el mapa entero.
   */
  keys: {},
  /**
   * Bandera con la que te ven en las salas. Vacío = la que detecte HaxBall solo.
   * Se escribe en `geo_override`, que le gana a la detección automática.
   */
  countryOverride: '',
  /**
   * Personalización: avatar, pelota, sonidos y aspecto en la lista de jugadores.
   * El nombre `vip` es histórico y se conserva para no perder lo ya guardado;
   * en TL App todo está habilitado y no hay inicio de sesión con Discord.
   */
  vip: {
    /** Perfil de Discord, o null si nunca inició sesión. */
    discord: null,
    /** Imagen del avatar. Se copia a userData; sólo la ve quien la puso. */
    avatarImage: '',
    /**
     * Imagen de la pelota. Mismas reglas que el avatar: se copia a userData y la
     * dibuja tu propia máquina sobre la cancha, así que sólo la ves vos —
     * HaxBall no transmite nada del aspecto de la pelota.
     *
     * La imagen es de todos; que se MUEVA (un GIF) es lo que pide el rol.
     */
    ballImage: '',
    /** Sonido de gol propio. Idem: archivo copiado a userData. */
    goalSound: '',
    goalVolume: 0.7,
    /**
     * Sonido propio para los golpes a la pelota. Suena con los toques de
     * CUALQUIERA, no sólo con los tuyos, y sólo lo oís vos: es tu máquina la
     * que lo reproduce, igual que el sonido de gol.
     */
    hitSound: '',
    hitVolume: 0.7,
    /**
     * Cómo te ven en la lista de jugadores los OTROS que tienen el cliente.
     *
     * A diferencia del resto de los cosméticos, esto no lo dibuja tu máquina
     * sino la de ellos: viaja en el latido de presencia y el servidor lo limpia
     * antes de repartirlo. Vacío = como cualquiera.
     */
    cosmetics: {
      /** Id de uno de los degradados de la lista, o vacío. */
      gradient: '',
      font: 'default'
    },
    /**
     * El cartel de teclas sobre la cancha.
     *
     * Muestra ACCIONES, no teclas: una flecha por dirección y un símbolo para
     * patear, que se encienden con cualquiera de las teclas atadas a esa acción
     * (ver `keystrokes` en game-preload.js). Sólo lo ve quien lo tiene puesto.
     */
    keystrokes: {
      enabled: false,
      /**
       * Dónde queda, en PORCENTAJE del alto y el ancho de la ventana.
       *
       * En porcentaje y no en píxeles a propósito: la resolución de la ventana
       * se cambia desde Ajustes, y una posición en píxeles dejaría el cartel
       * fuera de la pantalla —o encima de la cancha— cada vez que se achica.
       */
      x: 3,
      y: 70,
      /** De 0,7 a 1,6. Multiplica el lado de cada tecla. */
      scale: 1,
      /** Color del encendido. Vacío = el acento del tema. */
      color: '',
      /** El botón de patear se puede sacar y dejar sólo las direcciones. */
      showKick: true
    }
  },
  /**
   * Identidades de HaxBall. La clave real vive en el localStorage del juego
   * (`player_auth_key`); acá se guardan las que el jugador quiera conservar
   * para poder cambiar entre ellas.
   */
  auth: {
    items: [],
    activeId: null
  },
  updates: {
    /**
     * Sólo esto es configurable. La URL del feed y el canal están fijos en
     * updater.js: de ahí sale el instalador que después se ejecuta en la
     * máquina del jugador, así que no puede depender de la config.
     */
    autoCheck: true
  },
  /**
   * Lo que el cliente le cuenta al sitio. Las dos cosas son opcionales y se
   * pueden apagar: el cliente entero anda sin internet y sin cuenta. Qué sale
   * exactamente de la PC está en `src/main/panel.js`.
   */
  /**
   * Tu carrera en el cliente. Todo se cuenta acá, en tu PC: son números tuyos y
   * el cliente anda sin cuenta ni internet. Iniciar sesión sólo hace falta para
   * VERLOS (y, más adelante, para que suban a tu perfil del sitio).
   *
   * Los goles y las asistencias salen del mismo motor que arma el resumen del
   * partido, así que dependen del parche del bundle y sólo cuentan en partidas
   * de verdad: mirar un replay no suma nada.
   */
  stats: {
    sessions: 0,
    secondsPlayed: 0,
    lastPlayed: null,
    /** Partidos que arrancaron con vos adentro. */
    matches: 0,
    goals: 0,
    assists: 0,
    ownGoals: 0,
    /** Días seguidos abriendo el cliente, y el récord. */
    streak: 0,
    bestStreak: 0,
    /** El último día que se abrió, `YYYY-MM-DD` en hora local. */
    lastDay: null
  },

  /**
   * A quién no querés leer.
   *
   * Es una lista de APODOS, y no puede ser otra cosa: adentro de la cancha
   * HaxBall no tiene identidad —ver `myShare` en app.js—. De ahí salen los dos
   * límites, que están a la vista en la interfaz: si esa persona se cambia el
   * nombre vuelve a aparecer, y si otro se pone el mismo nombre también se
   * silencia. Se filtra en TU pantalla y nada más: no se le avisa a nadie ni
   * sale de la máquina.
   */
  chat: {
    muted: []
  },
  /**
   * YouTube Music adentro del cliente.
   *
   * Apagado no se monta NADA: ni el `<webview>`, ni el sondeo, ni el cartel. El
   * que no la usa no paga ni un proceso ni un milisegundo — que es la única
   * forma honesta de meterle un navegador entero adentro a un cliente de juego.
   *
   */
  music: {
    enabled: false,
    /**
     * Prefiere la pista de audio y no compone el videoclip. Reduce bastante el
     * trabajo de GPU mientras la cancha usa el mismo proceso gráfico.
     */
    audioOnly: true,
    /**
     * El volumen con el que quedó el reproductor, de 0 a 1.
     *
     * Se guarda acá y no se le deja a YouTube Music porque YouTube Music no lo
     * guarda entre sesiones: cada vez que arranca el cliente volvía al 100%. El
     * cliente lo lee del reproductor mientras suena y se lo vuelve a poner
     * apenas carga (ver `rememberVolume` en main.js).
     */
    volume: 1,
    /** El cartel sobre la cancha: lo que se ve mientras jugás. */
    hud: {
      enabled: false,
      /**
       * Dónde queda, en PORCENTAJE del alto y el ancho de la ventana.
       *
       * En porcentaje y no en píxeles por lo mismo que el cartel de teclas: la
       * resolución de la ventana se cambia desde Ajustes, y una posición en
       * píxeles dejaría el cartel fuera de pantalla cada vez que se achica.
       */
      x: 3,
      y: 4,
      /** De 0,7 a 1,6. Multiplica todo el cartel. */
      scale: 1,
      /** Sin título ni artista: sólo los tres botones, para el que quiere poco. */
      compact: false
    }
  },
  /*
   * Lo que el cliente dibuja SOBRE la cancha.
   *
   * Todo lo de acá pasa por un solo filtro: ¿le da al jugador información que
   * un rival con HaxBall pelado no tenga en ese mismo instante? Si la respuesta
   * es sí, no va. Lo que hay son ayudas de lectura —encontrarte a vos mismo,
   * distinguir equipos sin depender del color, seguir una pelota que va a mil—
   * y devoluciones de algo que ya pasó. Nada predice nada.
   *
   * `replay*` es la excepción y por eso está separado: en una grabación no hay
   * a quién ventajear, así que ahí las mismas ayudas van sin límite.
   */
  /**
   * Grosor de líneas y tamaño de fichas y pelota. Todo es un multiplicador sobre
   * lo que dibuja HaxBall (1 = como viene) y sólo cambia TU pantalla: no toca la
   * física ni lo que ven los demás. «Gráficos planos» (perf) manda sobre el
   * grosor. Ver `visual` en game-preload.js.
   */
  visual: {
    pitchLine: 1,
    discLine: 1,
    ballLine: 1,
    ballSize: 1,
    discSize: 1,
    /** Acabado de la cancha: `none` · `wood` · `ice` · `sand` · `concrete` · `night`. */
    texture: 'none',
    /** Escudo del club como marca de agua en el círculo del medio. */
    crest: false,
    crestOpacity: 0.18,
    crestSize: 0.45,
    /** Color de las líneas claras de la cancha y de los palos. Vacío = como viene. */
    lineColor: '',
    postColor: '',
    /** Contorno de las fichas y de la pelota. Vacío = como viene. */
    discOutline: '',
    ballOutline: '',
    /** Aspecto de la pelota: `default` · `soccer` · `neon` · `gold` · `beach` · `eight` · `star`. */
    ballStyle: 'default',
    /** Color de la pelota (se multiplica sobre su relleno). Vacío = como viene. */
    ballColor: '',
    /** Brillo de neón en las líneas de la cancha. */
    lineGlow: false,
    /** Luz de la cancha: `none` · `vignette` · `spot` · `corners`. */
    pitchLight: 'none',
    /** Sombra suave bajo las fichas y la pelota. */
    softShadows: false,
    /** Aspecto de las fichas: `default` · `sphere` · `glass` · `neon` · `metal` · `bubble` · `target` · `stripes` · `gem` · `cartoon` · `dots`. */
    discStyle: 'default',
    /** Tu aro: `default` · `double` · `dashed` · `crown`. Color vacío = el acento. */
    ringStyle: 'default',
    ringColor: '',
    /** Cola de color detrás de tu ficha. */
    selfTrail: false,
    selfTrailColor: '',
    /** Nombres sobre las fichas. Vacío/1 = como vienen. */
    nameScale: 1,
    nameColor: '',
    nameOutline: false,
    nameFont: 'default',
    /** Chat del juego. `chatBg` -1 = como viene. */
    chatScale: 1,
    chatBg: -1,
    chatFont: 'default',
    /** Fondo de los menús: `none` · `club` · `aurora` · `grid`. */
    menuBg: 'none'
  },
  /**
   * Looks guardados con nombre: un conjunto de ajustes visuales que se aplica
   * de un clic. `saved`: [{ name, data }].
   */
  looks: {
    saved: []
  },
  pitch: {
    ball3d: false,
    /**
     * El color de la cancha. Ver el bloque grande de `skinPitch` en
     * game-preload.js para cómo se pinta sin tapar las líneas.
     *
     * Viene apagado: la cancha de HaxBall es parte de cómo se lee el juego y
     * cambiarla es una decisión, no un valor de fábrica.
     */
    skin: {
      /** `off` · `theme` (sigue el tema del cliente) · `custom` (el color de acá). */
      mode: 'off',
      color: '#2e7d5b',
      /** Cuánto pesa el tono nuevo, de 0 a 1. */
      strength: 0.8,
      /** Oscurecer (negativo) o aclarar (positivo), de -0,6 a 0,6. */
      brightness: 0,
      /**
       * El afuera de la cancha. Vacío = el mismo tono que el campo, que es lo
       * que se ve bien sin decidir nada: la fusión le respeta la luminosidad,
       * así que el borde igual queda más oscuro que el césped.
       */
      outside: '',
      /** Franjas de césped cortado. `0` las apaga; entre 4 y 24 se ven bien. */
      stripes: 0
    },
    /**
     * Modo espejo: `off` · `red` · `blue`.
     *
     * El lado que querés ver SIEMPRE. Jugando del otro, la cancha se da vuelta
     * entera —y las teclas con ella— así que te seguís viendo donde estás
     * acostumbrado. Ver «Parche 8» en game-patch.js y `wantMirror` en
     * game-preload.js.
     *
     * Viene apagado. No es una ayuda que se pueda dejar puesta y olvidar: te
     * cambia izquierda por derecha, y eso hay que elegirlo.
     */
    mirror: 'off',
    /** Aro en tu propio disco. Encontrarte en un 4v4 es la fricción número uno. */
    selfRing: true,
    /**
     * Modo daltónico: un aro por equipo que se distingue por FORMA (lleno o
     * punteado) y no por color, así que sirve igual con los colores que le
     * ponga la sala.
     */
    teamRings: false,
    /** Destello del color del equipo que convirtió. */
    goalFlash: true,
    /** Sacudón de cámara en el gol. */
    goalShake: true,
    /**
     * Estela de la pelota: por dónde ESTUVO, nunca por dónde va.
     *
     * Sólo en grabaciones. En vivo pasaba el filtro de arriba —es pasado, no
     * predicción— pero igual se sacó: encima de una pelota que va a mil, la
     * cola tapa justo el pedazo de cancha que hay que mirar. En un replay, en
     * cambio, es para lo que uno lo abre.
     */
    replayTrail: true,
    /** Cuánta cola se ve, en milisegundos de partido. */
    trailMs: 320,
    /**
     * La estela deja de ser una cola y pasa a ser todo el camino de la pelota
     * desde el saque. Viene APAGADA: encendida, la estela deja de parecer una
     * estela y se lee como una mancha —que es justo lo que hace el mapa de
     * calor— y las dos cosas se confunden. Quien la quiera, la prende.
     */
    replayFullTrail: false,
    /** En replays, un aro marca al último que tocó la pelota. */
    replayLastTouch: true,
    /**
     * Cámara libre en replays: arrastrar con el mouse corre la vista, doble
     * clic la devuelve. En vivo no existe — ver el bloque de arriba.
     */
    replayFreeCam: true,
    /** Mapa de calor de la pelota, acumulado durante la grabación. */
    replayHeatmap: false
  }
};

let cache = null;
const listeners = new Set();
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function configPath() {
  return path.join(app.getPath('userData'), FILE);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Deep merge que conserva claves desconocidas pero garantiza los defaults. */
function merge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    // `{ clave: { __replace: X } }` pisa el subárbol en vez de fusionarlo. Hace
    // falta para poder BORRAR entradas de un mapa —desasignar una tecla de los
    // controles, por ejemplo—, cosa que un merge profundo por sí solo no puede.
    if (isPlainObject(value) && '__replace' in value) {
      out[key] = JSON.parse(JSON.stringify(value.__replace));
      continue;
    }
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? merge(out[key], value) : value;
  }
  return out;
}

/** Migra configs viejas: v1 tenía plugins, v2 pantalla completa automática. */
function migrate(stored) {
  if (!stored) return stored;
  const next = { ...stored };

  if (!(next.version >= 2)) {
    delete next.plugins;
    if (next.appearance) {
      delete next.appearance.theme;
      delete next.appearance.glass;
      delete next.appearance.zoom;
      delete next.appearance.gameFilter;
    }
  }
  if (!(next.version >= 3)) {
    if (next.general) delete next.general.fullscreenOnPlay;
    delete next.cloud;
  }

  // La app de Discord se agregó después: las configs que ya existían tienen el
  // campo vacío y el merge con los defaults no lo pisa.
  if (!(next.version >= 4) && next.discord && !next.discord.appId) {
    delete next.discord.appId;
    if (next.discord.enabled === false) delete next.discord.enabled;
  }

  // v5: el tema dejó de ser sólo del juego y pasó a mandar en toda la app.
  if (!(next.version >= 5)) {
    if (next.appearance && next.appearance.gameTheme) {
      next.appearance.theme = next.appearance.gameTheme;
      delete next.appearance.gameTheme;
    }
    // Antes el avatar animado se guardaba suelto y no se restauraba al abrir.
    if (next.avatar && next.avatar.frames && next.avatar.animated === undefined) {
      next.avatar.animated = true;
    }
    // Los ajustes que ahora maneja la app (extrapolación, sonido, avatar) los
    // tenía HaxBall en su propio localStorage: se adoptan en el primer arranque
    // en vez de reemplazarlos por los valores de fábrica.
    if (next.general) next.general.adoptedGameSettings = false;
  }

  // v6: el servidor de actualizaciones dejó de ser configurable. Se borran los
  // campos viejos para que un config.json de antes no siga arrastrando una URL.
  if (!(next.version >= 6) && next.updates) {
    delete next.updates.feedUrl;
    delete next.updates.channel;
  }

  // v7: los dos interruptores de cuadros pasaron a ser un solo modo de tres
  // estados. Tenerlos sueltos dejaba activar "sin límite" sin sacar el V-Sync,
  // que gastaba CPU sin dar un cuadro más.
  if (!(next.version >= 7) && next.perf) {
    if (next.perf.fpsMode === undefined) {
      next.perf.fpsMode = next.perf.uncapFps ? 'unlimited' : next.perf.noVsync ? 'nolimit' : 'vsync';
    }
    delete next.perf.noVsync;
    delete next.perf.uncapFps;
  }

  // v8: los modos de cuadros pasaron a ser un solo interruptor. El techo dejó
  // de configurarse a mano: lo calcula el cliente según el monitor.
  if (!(next.version >= 8) && next.perf) {
    if (next.perf.unlockFps === undefined) {
      // Sin un modo guardado, lo de fábrica: destrabado. Antes un `fpsMode` que
      // no existía contaba como «con V-Sync» y dejaba los FPS en los Hz del
      // monitor a todo el que venía de una versión vieja. Ver v18.
      next.perf.unlockFps = next.perf.fpsMode === undefined ||
        next.perf.fpsMode === 'unlimited' || next.perf.fpsMode === 'nolimit';
    }
    delete next.perf.fpsMode;
    delete next.perf.fpsTarget;
  }

  // v9: bloquear la publicidad de haxball.com dejó de ser opcional. Se borra la
  // clave para que un config viejo con el interruptor apagado no arrastre nada.
  if (!(next.version >= 9) && next.perf) delete next.perf.blockAds;

  // v10: el techo de cuadros dejó de ser configurable y quedó fijo en 3×.
  if (!(next.version >= 10) && next.perf) delete next.perf.fpsCeiling;

  // v11: el fondo dejó de animarse (blobs y aura quietos), así que «Fondo
  // animado» no apagaba nada. Se borra para que un config viejo no lo arrastre.
  if (!(next.version >= 11) && next.appearance) delete next.appearance.ambient;

  /*
   * v12: vuelve el techo de cuadros como opción del jugador, ahora con los
   * valores del cliente Zero. Se borró en la v10 porque el cliente lo calculaba
   * solo a partir del refresco; esa cuenta ya no existe.
   *
   * Los `fpsCeiling` viejos no se recuperan: eran un multiplicador del refresco
   * (2,5× / 1,5×), no cuadros por segundo, así que no hay a qué traducirlos.
   */
  if (!(next.version >= 12) && next.perf && next.perf.fpsCap === undefined) {
    next.perf.fpsCap = 0;
  }

  /*
   * v13: las ayudas sobre la cancha. No hay nada que migrar —es una rama nueva
   * y `merge` le pone los defaults sola—, pero la versión igual sube: es lo que
   * hace que un config viejo pase por acá una vez en vez de quedarse con la
   * rama a medias si mañana se le agrega un campo.
   */

  /*
   * v14: la estela pasó a ser sólo de grabaciones (`replayTrail`, que viene
   * prendida). `trail` era el interruptor en vivo y se borra: `merge` conserva
   * las claves que no conoce, así que si no se lo saca a mano queda para
   * siempre en el config de todos, sin que nadie lo lea.
   */
  if (!(next.version >= 14) && next.pitch) delete next.pitch.trail;

  /*
   * v15: YouTube Music. Rama nueva, así que no hay nada que traducir —`merge`
   * le pone los defaults sola— pero la versión igual sube: es lo que hace que
   * un config viejo pase por acá una sola vez, en vez de quedarse con la rama a
   * medias si mañana se le agrega un campo.
   */

  /*
   * v16: el modo espejo (`pitch.mirror`). Campo nuevo con default, así que no
   * hay nada que traducir —`merge` se lo pone sola— pero la versión igual sube:
   * es lo que hace que un config viejo pase por acá una sola vez.
   */

  /*
   * v17: la resolución pasó a ser del juego y no de la ventana. Antes
   * `1360x860` era el tamaño con el que se creaba la ventana, y estaba en el
   * config de todos sin que nadie lo eligiera; con el significado nuevo sería
   * estirar la cancha a 1360×860 en cualquier ventana. Pasa a `'auto'`, que es
   * lo que ya se veía: la cancha del tamaño de la ventana. Una resolución
   * elegida a mano se respeta.
   */
  if (!(next.version >= 17) && next.general && next.general.resolution === '1360x860') {
    next.general.resolution = 'auto';
  }

  /*
   * v18: «FPS sin límite» vuelve a prenderse, una vez.
   *
   * La v8 lo dejaba apagado a los que venían de antes aunque nunca lo hubieran
   * elegido, y el interruptor se había caído del panel: esos jugadores quedaban
   * con los FPS clavados en el refresco del monitor sin forma de volver. Ahora
   * el interruptor está de nuevo en Rendimiento, así que el que lo quiera
   * apagado lo apaga y queda apagado.
   */
  if (!(next.version >= 18) && next.perf && next.perf.unlockFps === false) {
    next.perf.unlockFps = true;
  }

  if (!(next.version >= 19) && next.appearance && next.appearance.theme === 'tvm') {
    next.appearance.theme = 'toda';
  }

  if (next.overlay) next.overlay.enabled = false;
  if (next.music) {
    next.music.enabled = false;
    if (next.music.hud) next.music.hud.enabled = false;
  }

  if (!(next.version >= 20) && next.appearance) {
    const customThemes = Array.isArray(next.appearance.customThemes)
      ? next.appearance.customThemes
      : [];
    const keepsCustomTheme = customThemes.some((theme) => theme && theme.id === next.appearance.theme);
    if (!keepsCustomTheme) next.appearance.theme = 'toda';
  }

  if (!(next.version >= 21)) {
    if (next.discord) {
      next.discord.showRoom = false;
      next.discord.showMusic = false;
    }
  }

  if (next.vip) next.vip.discord = null;
  delete next.privacy;
  next.version = 22;
  return next;
}

/** Valores del selector. `0` = sin límite. Cualquier otra cosa cae en 0. */
const FPS_CAPS = [0, 30, 60, 144, 240];

function normalizeFpsCap(raw) {
  const n = parseInt(raw, 10);
  return FPS_CAPS.includes(n) ? n : 0;
}

function load() {
  if (cache) return cache;
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    try { stored = JSON.parse(fs.readFileSync(configPath() + '.bak', 'utf8')); }
    catch { stored = {}; }
  }
  cache = merge(JSON.parse(JSON.stringify(DEFAULTS)), migrate(stored));
  return cache;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    // Se escribe primero a un archivo aparte y después se renombra: si la app
    // se cierra en el medio, el config.json viejo queda intacto en vez de
    // truncado — que era una forma de "se me borró la configuración".
    const target = configPath();
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(cache, null, 2), 'utf8');
    // Keep the last valid copy. Never replace a good backup with corrupted JSON.
    try {
      const previous = fs.readFileSync(target, 'utf8');
      JSON.parse(previous);
      fs.writeFileSync(target + '.bak.tmp', previous, 'utf8');
      fs.renameSync(target + '.bak.tmp', target + '.bak');
    } catch (err) {
      if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
    }
    fs.renameSync(temp, target);
    for (const fn of listeners) {
      try { fn(); } catch (err) { console.error('[store] respaldo por cuenta:', err.message); }
    }
    return true;
  } catch (err) {
    console.error('[store] no se pudo guardar la config:', err.message);
    return false;
  }
}

function get() {
  return load();
}

/** Aplica un patch parcial (profundo) y lo persiste. Devuelve la config entera. */
function set(patch) {
  const previous = load();
  cache = merge(previous, patch);
  // El techo llega del `select` como texto y se usa como divisor en el preload:
  // un valor raro ahí deja los cuadros trabados sin que se note de dónde salió.
  if (cache.perf) cache.perf.fpsCap = normalizeFpsCap(cache.perf.fpsCap);
  if (!save()) { cache = previous; throw new Error('No se pudo guardar la configuración en disco'); }
  return cache;
}

function reset() {
  const current = load();
  cache = JSON.parse(JSON.stringify(DEFAULTS));
  cache.auth = current.auth;
  if (!save()) { cache = current; throw new Error('No se pudo guardar la configuración en disco'); }
  return cache;
}

/** Reemplaza toda la config (importar / restaurar desde la nube). */
function replace(next) {
  const previous = load();
  cache = merge(JSON.parse(JSON.stringify(DEFAULTS)), migrate(next) || {});
  if (!save()) { cache = previous; throw new Error('No se pudo guardar la configuración en disco'); }
  return cache;
}

module.exports = { DEFAULTS, FPS_CAPS, normalizeFpsCap, get, set, load, save, reset, replace, configPath, subscribe };
