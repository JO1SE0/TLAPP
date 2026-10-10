'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/* ------------------------------------------------------------------ *
 * El tema, antes del primer cuadro
 * ------------------------------------------------------------------ *
 * La pantalla de carga se pintaba siempre del tema de la casa —violeta sobre
 * casi negro— tuviera el jugador el tema que tuviera, y recién al terminar el
 * arranque la app entera cambiaba de color de golpe.
 *
 * Es un problema de tiempos, no de CSS: las variables del tema las manda el
 * proceso principal y la interfaz las aplica cuando ya cargó (`applyThemeVars`),
 * y para entonces la pantalla de carga lleva un rato a la vista.
 *
 * Acá se piden de forma SÍNCRONA. Es la única manera de tenerlas antes de que
 * se pinte nada: este archivo corre antes que cualquier script de la página, y
 * un `invoke` con promesa se resolvería un turno más tarde, o sea después del
 * primer cuadro. Es una llamada de ida y vuelta, una sola vez por ventana, con
 * el proceso principal recién arrancado y sin nada en cola.
 */
function paintBootTheme() {
  const root = document.documentElement;
  if (!root) return false;
  try {
    const vars = ipcRenderer.sendSync('theme:boot-vars');
    if (!vars) return true; // contestó que no hay nada: no se reintenta
    for (const [name, value] of Object.entries(vars)) {
      if (value) root.style.setProperty(name, value);
    }
  } catch {
    // Sin tema, la pantalla de carga usa los valores de respaldo del CSS. No es
    // motivo para dejar la ventana sin preload.
  }
  return true;
}

/*
 * En Electron 13 el preload corre con el documento recién creado, así que el
 * `<html>` puede no existir todavía. Si no está, se espera al primer cambio de
 * estado del documento, que sigue siendo antes de que el navegador pinte.
 */
if (!paintBootTheme()) {
  document.addEventListener('readystatechange', paintBootTheme, { once: true });
}

/** Desenvuelve el { ok, data, error } que devuelve el main process. */
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || res.ok !== true) throw new Error((res && res.error) || 'Error desconocido');
  return res.data;
}

/**
 * `meta` es el segundo argumento que el proceso principal agrega cuando el
 * mensaje viene de una pestaña de juego en particular (ver `tabMeta` en
 * main.js). Los que no lo necesitan lo ignoran.
 */
function on(channel, cb) {
  const listener = (_e, payload, meta) => cb(payload, meta);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('tvm', {
  app: {
    info: () => call('app:info'),
    restart: () => call('app:restart'),
    openExternal: (url) => call('shell:openExternal', url),
    openPath: (target) => call('shell:openPath', target)
  },

  window: {
    minimize: () => ipcRenderer.send('win:action', 'minimize'),
    maximize: () => ipcRenderer.send('win:action', 'maximize'),
    close: () => ipcRenderer.send('win:action', 'close'),
    toggleFullscreen: () => ipcRenderer.send('win:action', 'fullscreen'),
    exitFullscreen: () => ipcRenderer.send('win:action', 'exit-fullscreen'),
    state: () => call('win:state'),
    /** Tamaño de ventana pedido para que la cancha quede en la resolución elegida. */
    setSize: (width, height) => call('win:set-size', { width, height }),
    onState: (cb) => on('win:state', cb)
  },

  config: {
    get: () => call('cfg:get'),
    schema: () => call('cfg:schema'),
    set: (patch) => call('cfg:set', patch),
    reset: () => call('cfg:reset'),
    export: () => call('cfg:export'),
    import: () => call('cfg:import'),
    onChange: (cb) => on('cfg:changed', cb)
  },

  theme: {
    vars: () => call('theme:vars'),
    onVars: (cb) => on('theme:vars', cb),
    save: (theme) => call('themes:save', theme),
    remove: (id) => call('themes:delete', id)
  },

  auth: {
    state: () => call('auth:state'),
    saveCurrent: (name) => call('auth:saveCurrent', name),
    add: (payload) => call('auth:add', payload),
    rename: (id, name) => call('auth:rename', id, name),
    remove: (id) => call('auth:delete', id),
    activate: (id) => call('auth:activate', id),
    export: (id) => call('auth:export', id),
    onLive: (cb) => on('auth:live', cb)
  },

  replays: {
    list: () => call('replays:list'),
    chooseFolder: () => call('replays:chooseFolder'),
    open: (file) => call('replays:open', file),
    reveal: (file) => call('replays:reveal', file),
    rename: (file, name) => call('replays:rename', file, name),
    trash: (file) => call('replays:trash', file),
    openFolder: () => call('replays:openFolder'),
    play: (file) => call('replays:play', file),
    /** Simula la grabación abierta de punta a punta y devuelve todo lo que pasó. */
    analyze: () => call('replay:analyze'),
    /** El análisis de otra vez, sin volver a simular nada. Null si nunca se hizo. */
    archived: (file) => call('replays:archived', file),
    archive: (file, summary) => call('replays:archive', file, summary),
    /** Deja el reproductor en ese milisegundo de la grabación. */
    seek: (ms) => call('replay:seek', ms),
    /** Encadena los goles: `[{ at, name }]` en milisegundos de grabación. */
    reel: (goals) => call('replay:reel', goals),
    /** Una grabación nueva apareció en la carpeta. */
    onNew: (cb) => on('replays:new', cb)
  },

  stats: {
    add: (payload) => call('stats:add', payload)
  },

  avatars: {
    onResolved: (cb) => on('avatar:resolved', cb)
  },

  access: {
    status: () => call('access:status'),
    submit: (key) => call('access:submit', key),
    recheck: () => call('access:recheck'),
    onChange: (cb) => on('access:changed', cb)
  },

  updates: {
    check: () => call('update:check'),
    download: () => call('update:download'),
    install: () => call('update:install'),
    onProgress: (cb) => on('update:progress', cb)
  },

  discord: {
    apply: () => call('discord:apply'),
    presence: (info) => call('discord:presence', info)
  },

  moderation: {
    kickAll: () => ipcRenderer.send('game:moderate-request', 'kick'),
    banAll: () => ipcRenderer.send('game:moderate-request', 'ban')
  },

  avatar: {
    /** Aplica el avatar fijo en la sala sin esperar a la próxima recarga. */
    preview: () => ipcRenderer.send('game:avatar-preview'),
    /** El avatar que HaxBall tiene guardado ahora mismo. */
    onLive: (cb) => on('avatar:live', cb)
  },

  keys: {
    /** Los controles que HaxBall tiene puestos ahora mismo. */
    onLive: (cb) => on('keys:live', cb),
    /**
     * Enciende o apaga el modo mover del cartel de teclas. Mientras está
     * encendido, el cartel se puede arrastrar por encima de la cancha; la
     * posición la guarda el proceso principal cuando se suelta.
     */
    moveHud: (on) => ipcRenderer.send('keystrokes:move', !!on),
    /** El modo mover se terminó solo: el jugador tocó fuera del cartel. */
    onMoveHudOff: (cb) => on('keystrokes:move-off', cb)
  },

  /**
   * YouTube Music. Todo pasa por el proceso principal: la ventana no habla con
   * Google ni con el `<webview>` directamente (ver ytmusic.js).
   */
  music: {
    /**
     * Mostrar el reproductor en ese rectángulo de la ventana. Lo abre si hacía
     * falta. `null` lo manda fuera de pantalla sin cortar la música.
     */
    show: (bounds) => call('music:show', bounds),
    /** Reubicarlo. Va por `send` porque llega seguido y no espera respuesta. */
    bounds: (rect) => ipcRenderer.send('music:bounds', rect),
    /** Apagarlo del todo: la vista se destruye y la música se corta. */
    close: () => call('music:close'),
    /** Qué está sonando ahora mismo. */
    state: () => call('music:state'),
    /** `playpause` · `next` · `prev` · `volume` (0..1) · `mute`. */
    cmd: (kind, value) => call('music:cmd', { kind, value }),
    /** Abre la ventana de Google. Resuelve cuando se cierra, entrara o no. */
    login: () => call('music:login'),
    logout: () => call('music:logout'),
    home: () => call('music:home'),
    reload: () => call('music:reload'),
    onState: (cb) => on('music:state', cb),
    /**
     * Enciende o apaga el modo mover del cartel de música. Mientras está
     * encendido se lo arrastra por encima de la cancha; la posición la guarda
     * el proceso principal cuando se suelta. Igual que el cartel de teclas.
     */
    moveHud: (value) => ipcRenderer.send('music:move', !!value),
    /** El modo mover se terminó solo: el jugador tocó fuera del cartel. */
    onMoveHudOff: (cb) => on('music:move-off', cb)
  },

  vip: {
    pickAvatar: () => call('vip:pickAvatar'),
    pickBall: () => call('vip:pickBall'),
    pickGoalSound: () => call('vip:pickGoalSound'),
    /** El sonido que suena con cada golpe a la pelota, sea de quien sea. */
    pickHitSound: () => call('vip:pickHitSound'),
    clearAsset: (which) => call('vip:clearAsset', which)
  },

  /**
   * Con quién jugaste. Lo calcula el sitio con los partidos que reportan los
   * hosts, no esta máquina: ver `rivals.js`. Devuelve `{ linked, at, people }`
   * — `linked` en false quiere decir que falta vincular la cuenta de Haxball,
   * que no es lo mismo que no haber jugado nunca.
   */
  rooms: {
    list: () => call('rooms:list'),
    join: (tokenOrLink) => call('rooms:join', tokenOrLink),
    /** Corta el intento de conexión y devuelve el juego a la lista de salas. */
    leave: () => call('rooms:leave'),
    create: (options) => call('rooms:create', options),
    /** La última sala en la que estuvo, para poder volver. `null` si no hay. */
    last: () => call('rooms:last'),
    onLast: (cb) => on('rooms:last', cb),
    onStale: (cb) => on('rooms:stale', cb),
    flags: () => call('flags:get'),
    onFlags: (cb) => on('flags:ready', cb)
  },

  /**
   * Pestañas de juego. Los `<webview>` los monta la interfaz; acá sólo se le
   * dice al proceso principal cuál está al frente y se reciben las teclas que
   * el jugador aprieta adentro del juego.
   */
  tabs: {
    /** Devuelve lo último que esa pestaña contó de sí: pantalla, sala, si juega. */
    activate: (webContentsId) => call('tabs:activate', webContentsId),
    /** Estado actual de todas las pestañas, por id de webContents (respaldo de los avisos). */
    snapshot: () => call('tabs:snapshot'),
    /** `'new'`, `'close'`, `'next'` o `'prev'`, desde adentro del juego. */
    onKey: (cb) => on('tabs:key', cb)
  },

  game: {
    onSettingsChanged: (cb) => on('game:settings-changed', cb),
    /** Recarga las pestañas que están en la lista de salas; las de adentro de una sala se dejan. */
    reload: () => call('game:reload'),
    /** Proporción de la cancha al usar pantalla completa. */
    viewport: (layout) => ipcRenderer.send('game:viewport', layout),
    /**
     * ¿Está HaxBall como para navegar ahí? Se pregunta antes de montar el
     * `<webview>`: con el sitio caído, esa navegación cierra el cliente.
     */
    health: (recheck = false) => call('game:health', { recheck }),
    onHealth: (cb) => on('game:health', cb),
    /**
     * Abre la verificación de Cloudflare en una ventana aparte, para que la
     * resuelva el jugador. El cliente no la responde por él.
     */
    verify: (bounds) => call('game:verify', bounds),
    /** Dónde quedó el hueco después de un cambio de tamaño de la ventana. */
    verifyBounds: (bounds) => ipcRenderer.send('game:verify-bounds', bounds),
    /**
     * La lupa del navegador sobre la página del juego: `'in'`, `'out'` o
     * `'reset'`. Jugando lo manda el preload del juego; esto es para cuando el
     * foco está en la interfaz.
     */
    zoom: (action) => ipcRenderer.send('game:zoom', action),
    /** Avisa que hay (o dejó de haber) un panel del cliente encima de la cancha. */
    panel: (open) => ipcRenderer.send('ui:panel', open),
    onTelemetry: (cb) => on('game:telemetry', cb),
    onLog: (cb) => on('game:log', cb),
    onToast: (cb) => on('game:toast', cb),
    onOpenSettings: (cb) => on('game:open-settings', cb),
    onPlaying: (cb) => on('game:playing', cb),
    onView: (cb) => on('game:view', cb),
    /** Nombre de la sala leído del propio HaxBall (para la presencia de Discord). */
    onRoomName: (cb) => on('game:room-name', cb),
    /** Si los ajustes del juego se pueden cambiar sin recargarlo. */
    onLiveSettings: (cb) => on('game:live-settings', cb),
    onThemed: (cb) => on('game:themed', cb),
    /** Un gol de la partida (o del replay), con autor y asistencia. */
    onGoal: (cb) => on('game:goal', cb),
    /** Arrancó un partido nuevo: hay que vaciar el resumen. */
    onMatchStart: (cb) => on('game:match-start', cb),
    /** Terminó: es cuando el partido entra en tus estadísticas. */
    onMatchEnd: (cb) => on('game:match-end', cb),
    /** El mapa de calor de la pelota. Llega justo antes del fin de partido. */
    onHeatmap: (cb) => on('game:heatmap', cb),
    /**
     * Tab dentro del juego, o el botón «Resumen» del reproductor. Con
     * `{ analyze: true }` además hay que analizar la grabación entera.
     */
    onToggleStats: (cb) => on('game:toggle-stats', cb)
  }
});
