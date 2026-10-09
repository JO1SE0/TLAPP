/* ══════════════════════════════════════════════════════════
   TL App — renderer
   ══════════════════════════════════════════════════════════ */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const t = (key, vars) => window.i18n.t(key, vars);
const isEn = () => window.i18n.language === 'en';

const appearancePage = $('.page[data-page="aspecto"] .page__inner');
const settingsPage = $('.page[data-page="ajustes"] .page__inner');
if (!appearancePage || !settingsPage) throw new Error('No se encontraron las páginas para reubicar los ajustes de Cuenta.');
/*
 * Orden final de las páginas. Las secciones de Cuenta no tienen página propia:
 * se reparten acá, y el orden va de lo que más se toca a lo que menos.
 *
 *   Aspecto:  tema · acento · tu jugador · la pelota · la cancha · replays ·
 *             en partida · cartel de teclas · overlay · música · sonidos ·
 *             lista de jugadores
 *   Ajustes:  cliente · audio · identidades · discord · actualizaciones ·
 *             configuración
 */
const accountSection = (sel) => {
  const section = $(`.page[data-page="cuenta"] ${sel}`);
  if (!section) throw new Error(`Falta la sección de cuenta ${sel}.`);
  return section;
};
const pitchSection = $('[data-sec="cancha"]', appearancePage);
if (!pitchSection) throw new Error('Falta la sección de la cancha.');
pitchSection.before(accountSection('[data-sec="jugador"]'), accountSection('[data-sec="pelota"]'));
appearancePage.append(accountSection('[data-sec="sonidos"]'), accountSection('#vipCard'));

const settingsUpdates = $('[data-sec="actualizaciones"]', settingsPage);
if (!settingsUpdates) throw new Error('Falta la sección de actualizaciones.');
settingsUpdates.before(accountSection('[data-sec="identidades"]'), accountSection('[data-sec="discord"]'));

const state = {
  config: null,
  schema: null,
  info: null,
  rooms: { list: [], totalPlayers: 0, totalRooms: 0, fetchedAt: 0, error: null, loading: false },
  /**
   * Fallos seguidos al pedir la lista. Va afuera de `rooms` a propósito: ese
   * objeto se reemplaza entero con lo que contesta el proceso principal, así que
   * cualquier cosa nuestra que viva adentro se pierde en el primer éxito.
   */
  roomsFailures: 0,
  sort: 'distance',
  flags: null,
  onlyFavs: false,
  /** Token de la sala que estamos esperando a que tenga lugar. */
  autoJoin: null,
  /** Pendiente mientras el usuario confirma su apodo en la pantalla de inicio. */
  pendingJoin: null,
  replays: { folder: '', items: [], error: null },
  auth: { items: [], activeId: null, liveAvailable: false, liveKnown: false },
  /** El `<webview>` de la pestaña de juego ACTIVA. Ver «Pestañas de juego». */
  webview: null,
  /** Todas las pestañas de juego, en el orden de la barra. */
  tabs: [],
  activeTab: null,
  /** Si ya se le ofreció al jugador la ventana de verificación de Cloudflare. */
  verifyAsked: false,
  view: 'play',
  stage: 'browser',
  /** Pantalla activa; la manda Electron para no ofrecer resoluciones imposibles. */
  display: null,
  selected: null,
  createListed: true,
  playing: false,
  playedSeconds: 0,
  /** El avatar que HaxBall tiene guardado, para partir de ahí. */
  liveAvatar: '',
  /** Nombre de la sala en la que estás, leído del propio HaxBall. */
  gameRoomName: null,
  /**
   * Nombre de la sala a la que pediste entrar (o que acabás de crear), para la
   * presencia de Discord mientras HaxBall todavía no dijo el suyo. Antes acá se
   * usaba la fila marcada en la lista, que no es lo mismo: al crear una sala
   * seguía marcada la que hubieras tocado antes y Discord mostraba ESA.
   */
  joinedRoomName: null,
  /** La última sala en la que estuviste, para el botón de volver. */
  lastRoom: null,
  /** Tu código de amigo, tal como lo manda el sitio. */
  friendCode: null,
  /** Los controles que HaxBall tiene puestos, mientras el cliente no los toque. */
  liveKeys: null,
  /** Si vip.js tiene cargados el server y el rol: si no, no se puede comprobar. */
  /**
   * Si los ajustes de HaxBall se pueden cambiar con el juego andando. Lo dice el
   * preload al cargar la partida: depende de que haya entrado el parche del
   * bundle. Mientras no se sepa, se asume que no y se recarga como antes.
   */
  liveGameSettings: false,
  /**
   * En qué anda la actualización, para el cartel fijo de arriba.
   *
   * `phase` es 'idle' | 'available' | 'downloading' | 'ready' | 'failed'. Vive
   * acá y no en el DOM porque el cartel se repinta entero al cambiar de idioma,
   * y leer el estado del texto que uno mismo escribió no termina bien.
   */
  update: { phase: 'idle', latest: '', percent: 0, dismissed: false }
};

/* ══════════════════════════════════════════════════════════
   Pantalla de carga
   ══════════════════════════════════════════════════════════
   Ya está pintada cuando este archivo empieza a correr: va primera en el HTML y
   sin `hidden`, así que entra en el primer cuadro que dibuja la ventana. Acá
   sólo se le va contando en qué anda el arranque y al final se la saca.

   ── Por qué esto va ARRIBA DE TODO ────────────────────────────────────────

   Vivía al final del archivo, y ahí la red de seguridad no protegía de nada: si
   algo de las 2900 líneas de arriba tiraba —alcanza con enganchar un listener a
   un botón cuyo id ya no está en el HTML—, el módulo se cortaba ahí y NUNCA se
   llegaba a programar el temporizador que saca la pantalla ni el que escribe el
   consejo. Resultado: carga infinita, sin consejo y sin ningún error a la vista.
   Pasó exactamente así con el botón «Replays» de la barra de acciones, que se
   sacó del HTML y dejó su listener colgado.

   Arriba, los dos temporizadores quedan armados antes de que exista la
   oportunidad de romper nada. Lo peor que puede pasar ahora es una app a medias
   —visible, y con el error en pantalla—, no una app trabada.
   ══════════════════════════════════════════════════════════ */

/**
 * Mínimo que se queda en pantalla.
 *
 * El arranque tarda distinto en cada máquina y a veces resuelve en 200 ms. Sin
 * un piso, la pantalla de carga sería un destello — peor que no tenerla, porque
 * se lee como un parpadeo defectuoso. Con esto siempre se alcanza a leer «TL
 * App» y el cliente se siente igual de rápido en cualquier PC.
 */
const SPLASH_MIN_MS = 3000;
const splashSince = performance.now();

/** Los pasos del arranque, para que la barra tenga algo que contar. */
function splashStep(key) {
  const node = $('#splashStatus');
  if (node) node.textContent = t(key);
}

/**
 * Una sola frase al azar por arranque, como el «¿Sabías que…?» de Discord.
 *
 * No rotan: la pantalla dura tres segundos y cambiar el texto en el medio se lee
 * como un error, no como una segunda frase. Por eso el sorteo es del ÍNDICE y se
 * hace una sola vez: `splashTip()` se llama dos veces —al principio y de nuevo
 * cuando ya se sabe el idioma— y las dos tienen que decir lo mismo.
 */
const SPLASH_TIPS = {
  es: [
    'Presioná F8 para abrir los ajustes en cualquier momento.',
    'Guardá tus salas favoritas haciendo clic en la estrella.',
    'Usá Auto-entrar para unirte automáticamente cuando haya un lugar libre.',
    'Pegá un link de sala directamente en la barra superior.',
    'Los beneficios de personalización para el club ya están habilitados.',
    'Configurá tus teclas en Ajustes para una respuesta óptima.',
    'Guardá y revisá tus partidas grabadas desde la sección de Replays.'
  ],
  en: [
    'Press F8 to open the settings at any time.',
    'Save your favourite rooms by clicking the star.',
    'Use Auto-join to get in automatically as soon as a slot frees up.',
    'Paste a room link straight into the top bar.',
    'Club customisation perks are already enabled.',
    'Set up your keys in Settings for the best response.',
    'Save and rewatch your recorded matches from the Replays section.'
  ]
};

const splashTipIndex = Math.floor(Math.random() * SPLASH_TIPS.es.length);

function splashTip() {
  const node = $('#splashTip');
  if (!node) return;
  const english = isEn();
  const list = english ? SPLASH_TIPS.en : SPLASH_TIPS.es;
  node.replaceChildren();
  const label = document.createElement('b');
  label.textContent = english ? 'Did you know? ' : '¿Sabías que? ';
  node.append(label, document.createTextNode(list[splashTipIndex % list.length]));
}

let splashHidden = false;
async function hideSplash() {
  if (splashHidden) return;
  splashHidden = true;
  const splash = $('#splash');
  if (!splash) return;

  const left = SPLASH_MIN_MS - (performance.now() - splashSince);
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));

  splash.classList.add('is-out');
  setTimeout(() => splash.remove(), 450);
}

/*
 * Red de seguridad: la pantalla se va SIEMPRE, pase lo que pase más abajo. El
 * consejo se escribe enseguida, no al final del arranque, así que se lee durante
 * los tres segundos en vez de aparecer justo cuando la pantalla se está yendo.
 */
setTimeout(hideSplash, SPLASH_MIN_MS + 200);
setTimeout(splashTip, 20);

/**
 * Un error que corta el arranque tiene que VERSE.
 *
 * Antes moría en la consola de un devtools que nadie tiene abierto y la app
 * quedaba en la pantalla de carga sin decir nada, que es lo más caro de
 * diagnosticar: no hay ni por dónde empezar a buscar.
 */
window.addEventListener('error', (event) => {
  const detail = event.error && event.error.message ? event.error.message : event.message;
  const where = event.filename ? ` (${String(event.filename).split('/').pop()}:${event.lineno})` : '';
  const text = `Error al arrancar: ${detail}${where}`;
  console.error('[TL App] el renderer falló:', event.error || event.message);

  const status = document.querySelector('#splashStatus');
  if (status) status.textContent = text;

  // El cartel se arma a mano, sin usar nada del resto del archivo: justamente
  // sirve para los casos en los que el resto del archivo no llegó a existir.
  if (document.querySelector('#bootError')) return;
  const bar = document.createElement('div');
  bar.id = 'bootError';
  bar.textContent = text;
  bar.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:100000',
    'padding:10px 14px', 'background:#3a0d16', 'color:#ffb4bd',
    'font:12px/1.4 system-ui,sans-serif', 'border-top:1px solid #7a1f2e',
    'white-space:pre-wrap', '-webkit-app-region:no-drag'
  ].join(';');
  const put = () => document.body && document.body.append(bar);
  document.body ? put() : window.addEventListener('DOMContentLoaded', put);
});

/* ── Formatos ───────────────────────────────────────────── */
const pad = (n) => String(n).padStart(2, '0');

const FORMATTERS = {
  chatOpacity: (v) => `${Math.round(Number(v) * 100)}%`,
  soundVolume: (v) => `${Math.round(Number(v) * 100)}%`,
  chatFocusHeight: (v) => `${Math.round(Number(v))} px`,
  chatHeight: (v) => `${Math.round(Number(v))} px`,
  extrapolation: (v) => `${Math.round(Number(v))} ms`
};

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${pad(m)}m` : `${m}m`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatDate(ms) {
  return new Date(ms).toLocaleString(isEn() ? 'en-GB' : 'es-AR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

/* ── Avisos ─────────────────────────────────────────────── *
 * Un solo sistema de carteles en toda la app. El preload del juego dibujaba
 * los suyos en el medio de la pantalla y una misma acción (reproducir un
 * replay, por ejemplo) terminaba mostrando dos avisos distintos a la vez.
 * Ahora el juego pide el aviso por IPC y sale acá.
 *
 * Encima se descartan los repetidos seguidos: si dos caminos avisan lo mismo
 * dentro de un segundo, se muestra uno.
 */
const recentToasts = new Map();

/**
 * @param {{label:string, run:Function}} [action] Botón dentro del aviso. Con uno,
 *   el aviso dura más: hay algo que decidir y tres segundos no alcanzan.
 */
function toast(message, kind = '', action = null) {
  const text = String(message || '').trim();
  if (!text) return null;

  const now = Date.now();
  const last = recentToasts.get(text);
  if (last && now - last < 1200) return null;
  recentToasts.set(text, now);
  if (recentToasts.size > 30) recentToasts.clear();

  const node = document.createElement('div');
  node.className = `toast${kind ? ` is-${kind}` : ''}`;
  node.append(document.createTextNode(text));

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast__btn';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      node.remove();
      action.run();
    });
    node.append(button);
  }

  $('#toasts').append(node);
  setTimeout(() => dismissToast(node), action ? 14000 : 3200);
  return node;
}

/** Saca un aviso ya: lo usa el «Entrando a la sala…» cuando se terminó de entrar. */
function dismissToast(node) {
  if (!node || !node.isConnected || node.classList.contains('is-out')) return;
  node.classList.add('is-out');
  node.addEventListener('animationend', () => node.remove(), { once: true });
  // Por si la animación no corre (ventana en segundo plano): no queda colgado.
  setTimeout(() => node.remove(), 600);
}

/**
 * Cambiarle el texto a un botón sin llevarse puesto su icono.
 *
 * `textContent = …` borra los hijos, y casi todos los botones llevan su dibujo
 * adelante. Es exactamente lo mismo que hace `applyStatic` con los que traen el
 * texto puesto desde el HTML; esto es para los que lo eligen en el momento.
 */
function setButtonLabel(btn, text) {
  if (!btn) return;
  const icon = btn.querySelector(':scope > svg[data-icon]');
  if (icon) btn.replaceChildren(icon, document.createTextNode(text));
  else btn.textContent = text;
}

async function guard(promise, prefix = 'Error') {
  try {
    return await promise;
  } catch (err) {
    toast(`${prefix}: ${err.message}`, 'err');
    return null;
  }
}

/* ── Config y tema ──────────────────────────────────────── */
function applyConfig(config) {
  state.config = config;
  const root = document.documentElement;
  // `ambient` ya no existe: el fondo dejó de animarse (blobs y aura quietos),
  // así que era un interruptor que no apagaba nada. Ver theme.css.
  root.dataset.animations = config.appearance.animations ? 'on' : 'off';
  window.i18n.setLanguage(config.appearance.language || 'es');
  // `setLanguage` repinta TODO lo que tiene data-i18n, y hay dos botones que
  // dicen otra cosa mientras su modo está encendido. Ver `paintKeysMoveButton`.
  paintKeysMoveButton();
  paintMusicMoveButton();
  /*
   * Prender o apagar la música monta o desmonta el reproductor, y eso puede
   * llegar de cualquier lado: la pestaña Música, la tarjeta de Aspecto, o F7 en
   * medio de un partido. Se resuelve donde llega la config y no en cada botón.
   */
  syncMusic();
  // Quién sos vive en la barra: el apodo o la foto pueden haber cambiado.
  paintMeChip();
}

/**
 * El tema ya no vive sólo dentro del juego: el main resuelve la paleta y manda
 * las variables CSS, y con eso se pinta el cliente entero.
 */
function applyThemeVars(vars) {
  if (!vars) return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    if (value) root.style.setProperty(name, value);
  }
  // El tema claro necesita otros rojos/verdes y menos brillo en los blobs.
  root.dataset.scheme = isLightColor(vars['--bg-0']) ? 'light' : 'dark';
  // Un atributo y no el valor de la variable: el CSS lo leía con
  // [style*="--aura-on: 0"], que depende de cómo el navegador serialice el
  // style inline y no acertaba nunca — por eso los temas VIP no animaban nada.
  root.dataset.aura = vars['--aura-on'] === '1' ? 'on' : 'off';

  /*
   * La muestra del color del cartel de teclas enseña el acento del tema mientras
   * no haya uno elegido a mano, así que cambiar de tema la dejaba mostrando el
   * anterior. Va acá y no en `refreshThemeVars` porque ésta es la única puerta
   * por la que pasan las dos vías: la que pide las variables y la que las recibe
   * empujadas desde el main (`theme.onVars`).
   */
  if (state.config) paintKeysColor();
}

/**
 * El acento que se está VIENDO, que no es `appearance.accent`.
 *
 * `appearance.accent` es el color que eligió el usuario, y sólo lo usan los
 * temas que no traen uno propio (ver `palette()` en themes.js): con «Azul»
 * puesto, el acento vivo es el azul del tema y el de la config sigue siendo el
 * violeta de la marca. Quien quiera mostrar «el color del tema» tiene que leer
 * la variable, que es la que ya resolvió el proceso principal.
 */
function themeAccent() {
  const css = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return /^#[0-9a-f]{6}$/i.test(css) ? css : (state.config.appearance.accent || '#7B3FE4');
}

function parseHex(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  return m ? m.slice(1).map((h) => parseInt(h, 16)) : null;
}

function isLightColor(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
}

/**
 * Mezcla dos colores. `amount` es cuánto del segundo entra (0 a 1).
 *
 * Esto lo hacía `color-mix()` en CSS, que es de Chrome 111: acá corre Chromium
 * 91 (ver `applyBootFlags` en main.js), donde la declaración entera es inválida
 * y el navegador la tira. Las muestras de color de acento quedaban sin fondo:
 * ocho cuadraditos vacíos. Es el mismo motivo por el que `themes.js` resuelve
 * sus mezclas en el proceso principal.
 */
/**
 * Llena una barra de progreso.
 *
 * Escribe `--fill` en vez del ancho porque la barra se encoge con `scaleX`: ver
 * `.xpbar > i` en app.css. Se redondea a dos decimales para que dos repintados
 * con el mismo progreso no cuenten como un cambio y disparen la transición.
 */
function paintXp(el, ratio) {
  if (!el) return;
  const fill = Math.max(0, Math.min(1, Number(ratio) || 0));
  el.style.setProperty('--fill', fill.toFixed(2));
}

function mixHex(a, b, amount) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const t = Math.max(0, Math.min(1, amount));
  const ch = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * t);
  return `#${[ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

async function refreshThemeVars() {
  const vars = await guard(tvm.theme.vars(), 'Error');
  applyThemeVars(vars);
}

async function patchConfig(patch) {
  const next = await guard(tvm.config.set(patch), 'Error');
  if (next) applyConfig(next);
  return next;
}

/* ══════════════════════════════════════════════════════════
   Fábrica de filas
   ══════════════════════════════════════════════════════════
   Antes había tres maneras de dibujar lo mismo: `switchRow` para los
   interruptores, un `.field` armado a mano para los selectores y las barras, y
   `.looksrow` para lo que iba en fila. Cada una decidía por su cuenta dónde
   ponía la etiqueta, de qué tamaño y con cuánto aire, y por eso dos controles
   vecinos casi nunca arrancaban a la misma altura.

   Ahora sale todo de acá: nombre a la izquierda, control a la derecha.

   La descripción es OPCIONAL y va con una regla: sólo si dice algo que el
   nombre no dice, y en una línea. Lo que necesita un párrafo no se muestra
   siempre — se pasa como `hint` y queda guardado en el `ⓘ` que aparece al lado
   del nombre. Eso es lo que sacó de la pantalla las ~490 palabras de notas que
   había repartidas por Aspecto y Ajustes.
   ══════════════════════════════════════════════════════════ */

/**
 * Una fila del panel.
 *
 * `control` puede ser un nodo o una lista; van todos dentro de `.row__ctl`.
 * Con `block: true` el control baja abajo y ocupa el ancho entero, que es lo
 * que hace falta cuando no es un control sino una grilla (los temas, las
 * teclas, los degradados).
 */
function settingRow({ label, description, hint, control, block = false, id, className }) {
  const row = document.createElement('div');
  row.className = `row${block ? ' row--block' : ''}${className ? ` ${className}` : ''}`;
  if (id) row.id = id;

  if (label || description || hint) {
    const text = document.createElement('div');
    text.className = 'row__text';

    const title = document.createElement('span');
    title.className = 'row__label';
    title.append(document.createTextNode(label || ''));
    if (hint) title.append(hintMark(hint));
    text.append(title);

    if (description) {
      const desc = document.createElement('span');
      desc.className = 'row__desc';
      desc.textContent = description;
      text.append(desc);
    }
    row.append(text);
  }

  const ctl = document.createElement('div');
  ctl.className = 'row__ctl';
  for (const node of [].concat(control || [])) if (node) ctl.append(node);
  row.append(ctl);
  return row;
}

/** El `ⓘ`. El globo lo dibuja `showHint`; acá va sólo la marca. */
function hintMark(text) {
  const mark = document.createElement('i');
  mark.className = 'hint';
  mark.tabIndex = 0;
  mark.textContent = 'i';
  mark.dataset.hintText = text;
  mark.setAttribute('aria-label', isEn() ? 'More information' : 'Más información');
  return mark;
}

function buildSwitches(container, items, onToggle) {
  container.replaceChildren();
  for (const item of items) container.append(switchRow(item, onToggle));
}

function switchRow(item, onToggle) {
  const toggle = document.createElement('button');
  toggle.className = 'switch';
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', item.label);

  const sync = (value) => {
    toggle.classList.toggle('is-on', !!value);
    toggle.setAttribute('aria-checked', String(!!value));
  };
  sync(item.value());

  toggle.addEventListener('click', async () => {
    sync(!item.value());
    await onToggle(item, !item.value());
    sync(item.value());
  });

  const row = settingRow({
    label: item.label,
    description: item.description,
    hint: item.hint,
    control: toggle
  });

  /*
   * El ↻ de «pide reinicio» se colgaba del final de la descripción, así que un
   * interruptor sin descripción no podía mostrarlo — y varias de las banderas
   * del motor no la tienen. Ahora la marca se agrega a la descripción si ya
   * existe y se crea una línea propia si no.
   */
  if (item.restart) {
    const em = document.createElement('em');
    em.textContent = `↻ ${t('perf.restartMark')}`;
    const existing = row.querySelector('.row__desc');
    if (existing) existing.append(' · ', em);
    else {
      const line = document.createElement('span');
      line.className = 'row__desc';
      line.append(em);
      row.querySelector('.row__text').append(line);
    }
  }

  return row;
}

/** Una fila con un `<select>`. `options` son `[valor, texto]`. */
function selectRow({ label, description, hint, id, options, value, onChange, block = false }) {
  const select = document.createElement('select');
  if (id) select.id = id;
  for (const [optValue, optLabel] of options) {
    const option = document.createElement('option');
    option.value = String(optValue);
    option.textContent = optLabel;
    select.append(option);
  }
  select.value = String(value);
  select.addEventListener('change', () => onChange(select.value, select));
  const row = settingRow({ label, description, hint, control: select, block });
  row.dataset.ctl = 'select';
  return row;
}

/**
 * Una fila con una barra y su número al lado.
 *
 * `onInput` corre mientras se arrastra (para lo que se ve al instante) y
 * `onChange` al soltar (para lo que se guarda). Separarlos no es un detalle:
 * guardar en cada `input` escribe el config.json una vez por píxel del
 * arrastre.
 */
function rangeRow({ label, description, hint, id, min, max, step, value, format, onInput, onChange, block = false }) {
  const input = document.createElement('input');
  input.type = 'range';
  if (id) input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  const shown = document.createElement('b');
  shown.className = 'row__val';
  const fmt = format || ((v) => v);
  shown.textContent = fmt(value);

  input.addEventListener('input', () => {
    syncRangeFill(input);
    shown.textContent = fmt(Number(input.value));
    if (onInput) onInput(Number(input.value));
  });
  if (onChange) input.addEventListener('change', () => onChange(Number(input.value)));

  // El relleno se calcula con el ancho, así que hay que pedirlo una vez que el
  // elemento ya está en el documento.
  queueMicrotask(() => syncRangeFill(input));

  const row = settingRow({ label, description, hint, control: [input, shown], block });
  row.dataset.ctl = 'range';
  return row;
}

/** Una fila que es sólo un aviso en medio de una lista de filas. */
function noteRow(text, warn = false) {
  const row = document.createElement('div');
  row.className = 'row row--text';
  const p = document.createElement('p');
  p.className = `note${warn ? ' note--warn' : ''}`;
  p.textContent = text;
  row.append(p);
  return row;
}

/* ══════════════════════════════════════════════════════════
   El `ⓘ`
   ══════════════════════════════════════════════════════════
   Un solo globo para toda la app. No puede vivir adentro de la fila: la página
   tiene `overflow-y: auto` y la tarjeta del panel `overflow: hidden` MÁS
   `contain: paint`, que además la convierte en el bloque contenedor de
   cualquier `position: fixed` de adentro. Un globo hijo se cortaría contra las
   dos cosas. Éste cuelga de `<body>` y se posiciona a mano.
   ══════════════════════════════════════════════════════════ */
let hintTip = null;

function hintText(mark) {
  return mark.dataset.hintText || (mark.dataset.hint ? t(mark.dataset.hint) : '');
}

function showHint(mark) {
  const text = hintText(mark);
  if (!text) return;

  if (!hintTip) {
    hintTip = document.createElement('div');
    hintTip.className = 'hinttip';
    hintTip.setAttribute('role', 'tooltip');
    document.body.append(hintTip);
  }
  hintTip.textContent = text;
  hintTip.hidden = false;

  // Se mide DESPUÉS de escribir el texto: el alto depende de cuántas líneas
  // entren, y eso no se sabe hasta que el texto está adentro.
  const anchor = mark.getBoundingClientRect();
  const tip = hintTip.getBoundingClientRect();
  const margin = 8;

  let left = anchor.left + anchor.width / 2 - tip.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tip.width - margin));

  // Arriba del `ⓘ` salvo que no entre, y ahí abajo.
  let top = anchor.top - tip.height - 6;
  if (top < margin) top = anchor.bottom + 6;

  hintTip.style.left = `${Math.round(left)}px`;
  hintTip.style.top = `${Math.round(top)}px`;
}

function hideHint() {
  if (hintTip) hintTip.hidden = true;
}

document.addEventListener('pointerover', (e) => {
  const mark = e.target.closest && e.target.closest('.hint');
  if (mark) showHint(mark);
  else if (hintTip && !hintTip.hidden) hideHint();
});
document.addEventListener('focusin', (e) => {
  const mark = e.target.closest && e.target.closest('.hint');
  if (mark) showHint(mark);
});
document.addEventListener('focusout', hideHint);
/*
 * El globo es `position: fixed` y no sabe nada de lo que lo ancló: si eso se
 * mueve, se queda flotando sobre otra cosa. Los tres casos en que se mueve sin
 * que el mouse se mueva:
 *
 *   · scroll de la página (por eso va en captura: el que scrollea es el
 *     contenedor, y ese evento no burbujea);
 *   · cambio de tamaño de la ventana — entrar o salir de pantalla completa con
 *     el mouse quieto sobre un `ⓘ` lo dejaba clavado arriba de todo;
 *   · el mouse se va de la ventana, que no dispara ningún `pointerover` nuevo.
 */
document.addEventListener('scroll', hideHint, true);
window.addEventListener('resize', hideHint);
window.addEventListener('blur', hideHint);
document.addEventListener('pointerleave', hideHint);

/* ══════════════════════════════════════════════════════════
   Índice de secciones y buscador
   ══════════════════════════════════════════════════════════
   Las cuatro pestañas de ajustes suman unos sesenta controles. Sin un índice,
   encontrar uno era scrollear y leer; y sin buscador, saber de antemano en cuál
   de las cuatro estaba.

   El índice se arma leyendo el HTML, no una lista aparte: cualquier
   `[data-sec]` dentro de la página activa entra solo. El título sale de su
   `.sec__title` (o del `data-sec-label`, para el `<details>` de «Avanzado»),
   así que se traduce con el resto de la página y no hay dos copias del mismo
   texto que se puedan ir a distinto lado.

   El buscador filtra las CUATRO páginas a la vez, no sólo la abierta: escribís
   «gol» y el índice te muestra que hay algo en Aspecto y algo en Cuenta, con
   cuántas filas en cada una. Ésa es la parte que no se podía resolver
   scrolleando.

   Lo que el filtro esconde se marca con la clase `is-filtered` y NO con la
   propiedad `hidden`. No es lo mismo: `hidden` ya lo usa la app para cosas que
   no vienen al caso (la sección de rivales sin datos, el largo de la estela con
   la estela apagada, el tamaño personalizado de ventana). Si el filtro usara
   `hidden`, al limpiar la búsqueda las destaparía a todas.
   ══════════════════════════════════════════════════════════ */
const NAV_PAGES = ['rendimiento', 'aspecto', 'ajustes'];
const NAV_PAGE_LABEL = {
  rendimiento: 'nav.performance',
  aspecto: 'nav.appearance',
  ajustes: 'nav.settings'
};

/** Las páginas que llevan índice. Replays no: es una lista con su buscador. */
function navPage(name) {
  return NAV_PAGES.includes(name) ? $(`.page[data-page="${name}"]`) : null;
}

/** ¿Se ve? Cuenta tanto lo que escondió la app como lo que escondió el filtro. */
function isShown(el) {
  return !el.hidden && !el.classList.contains('is-filtered');
}

/**
 * El título que muestra el índice para una sección.
 *
 * Se le saca el `ⓘ`: es una `<i>` con la letra «i» adentro, así que sin esto
 * el índice decía «La canchai».
 */
function secTitle(sec) {
  if (sec.dataset.secLabel) return t(sec.dataset.secLabel);
  const title = sec.querySelector('.sec__title');
  if (!title) return sec.dataset.sec;
  const copia = title.cloneNode(true);
  for (const marca of copia.querySelectorAll('.hint')) marca.remove();
  return copia.textContent.trim();
}

/** Todo el texto por el que se puede encontrar una fila, incluido su `ⓘ`. */
function rowText(row) {
  const hints = $$('.hint', row).map(hintText).join(' ');
  return `${row.textContent} ${hints}`.toLowerCase();
}

/**
 * Aplica el filtro a una página y devuelve cuántas filas quedaron por sección.
 * Sin búsqueda destapa todo y devuelve `null`, que es lo que le dice al índice
 * que no dibuje contadores.
 */
function filterPage(page, query) {
  const counts = new Map();
  for (const sec of $$('[data-sec]', page)) {
    const rows = $$('.row', sec);
    if (!query) {
      sec.classList.remove('is-filtered');
      for (const row of rows) row.classList.remove('is-filtered');
      continue;
    }
    // El nombre de la sección también cuenta: buscar «audio» tiene que traer la
    // sección Audio entera y no sólo las filas que digan esa palabra.
    const secHit = secTitle(sec).toLowerCase().includes(query);
    let hits = 0;
    for (const row of rows) {
      const hit = secHit || rowText(row).includes(query);
      row.classList.toggle('is-filtered', !hit);
      if (hit && !row.hidden) hits++;
    }
    counts.set(sec.dataset.sec, hits);
    sec.classList.toggle('is-filtered', hits === 0);
    // Un `<details>` con resultados adentro se abre solo: si no, el índice dice
    // que hay tres coincidencias en «Avanzado» y no se ve ninguna.
    if (hits > 0 && sec.tagName === 'DETAILS') sec.open = true;
  }
  return counts;
}

/** El cartel de «no encontré nada», al fondo de la página activa. */
function paintEmptyState(page, show) {
  const previo = $('.page__empty', page);
  if (previo) previo.remove();
  if (!show) return;
  const box = emptyState(t('panel.noResults'), t('panel.noResultsText'));
  box.classList.add('page__empty');
  $('.page__inner', page).append(box);
}

/**
 * Dibuja el índice de la pestaña abierta.
 *
 * Con el buscador vacío lista las secciones de la página activa. Con algo
 * escrito lista las secciones CON RESULTADOS de las cuatro páginas, agrupadas
 * por pestaña y con el número de coincidencias al costado.
 */
function buildPanelNav() {
  const list = $('#panelNavList');
  const input = $('#settingsSearch');
  if (!list || !input) return;

  const query = (input.value || '').trim().toLowerCase();
  const activa = state.view;
  list.replaceChildren();

  let total = 0;

  for (const name of query ? NAV_PAGES : [activa]) {
    const page = navPage(name);
    if (!page) continue;

    const counts = filterPage(page, query);
    // Una sección que la app esconde por su cuenta —los rivales sin datos, el
    // cartel de música apagado— no va al índice: sería un renglón que no lleva
    // a ningún lado.
    const secs = $$('[data-sec]', page).filter(isShown);

    if (query) {
      const hits = secs.reduce((n, sec) => n + (counts.get(sec.dataset.sec) || 0), 0);
      total += hits;
      if (!hits) continue;
      const head = document.createElement('span');
      head.className = 'pnav__group';
      head.textContent = t(NAV_PAGE_LABEL[name]);
      list.append(head);
    }

    for (const sec of secs) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'pnav__i';
      item.dataset.goPage = name;
      item.dataset.goSec = sec.dataset.sec;
      item.append(document.createTextNode(secTitle(sec)));
      if (query) {
        const n = document.createElement('span');
        n.className = 'pnav__n';
        n.textContent = String(counts.get(sec.dataset.sec) || 0);
        item.append(n);
      }
      list.append(item);
    }
  }

  const page = navPage(activa);
  if (page) paintEmptyState(page, Boolean(query) && total === 0);

  $('#settingsSearchClear').hidden = !query;
  syncNavSpy();
}

/**
 * Abrir una pestaña parado en una sección.
 *
 * Es lo que necesitan los atajos que vienen de afuera del panel —el menú de
 * «yo», el botón de cambiar apodo, el engranaje de adentro del juego—: antes
 * cada uno hacía `setView` y después buscaba un id a mano con
 * `scrollIntoView`, y cuando la tarjeta se mudaba de página el atajo quedaba
 * apuntando a un elemento que ya no estaba ahí, sin fallar y sin hacer nada.
 */
function goToSection(page, sec) {
  setView(page);
  requestAnimationFrame(() => {
    const target = $(`.page[data-page="${page}"] [data-sec="${sec}"]`);
    if (target) target.scrollIntoView({ block: 'start' });
  });
}

/**
 * Limpia el filtro de TODAS las páginas.
 *
 * Hace falta al cerrar el panel: si no, la próxima vez que se abre aparece la
 * página filtrada por una búsqueda de la sesión anterior y con el campo vacío,
 * o sea media pestaña que no está y ninguna explicación de por qué.
 */
function clearPanelSearch() {
  const input = $('#settingsSearch');
  if (input) input.value = '';
  for (const name of NAV_PAGES) {
    const page = navPage(name);
    if (page) { filterPage(page, ''); paintEmptyState(page, false); }
  }
}

/*
 * ═══ Qué sección estás mirando ═══
 *
 * Se marca la última cuyo borde de arriba ya pasó la línea de lectura, que es
 * lo que el ojo entiende por «estoy en ésta». Se calcula dentro de un
 * `requestAnimationFrame` y no en cada evento de scroll: el scroll dispara
 * decenas de veces por segundo y esto lee posiciones, que es justo lo que
 * obliga al navegador a maquetar.
 */
let spyPending = false;

function syncNavSpy() {
  const page = navPage(state.view);
  const list = $('#panelNavList');
  if (!page || !list) return;

  const secs = $$('[data-sec]', page).filter(isShown);
  if (!secs.length) return;

  const linea = page.getBoundingClientRect().top + 56;
  let actual = secs[0].dataset.sec;
  for (const sec of secs) {
    if (sec.getBoundingClientRect().top <= linea) actual = sec.dataset.sec;
  }
  // Al final del scroll gana la última: si no, una sección corta abajo de todo
  // nunca llega a cruzar la línea y el índice se queda una atrás para siempre.
  if (page.scrollTop + page.clientHeight >= page.scrollHeight - 4) {
    actual = secs[secs.length - 1].dataset.sec;
  }

  for (const item of $$('.pnav__i', list)) {
    item.classList.toggle('is-on', item.dataset.goSec === actual && item.dataset.goPage === state.view);
  }
}

function scheduleNavSpy() {
  if (spyPending) return;
  spyPending = true;
  requestAnimationFrame(() => { spyPending = false; syncNavSpy(); });
}

$('#panelNavList').addEventListener('click', (e) => {
  const item = e.target.closest('.pnav__i');
  if (!item) return;
  const { goPage, goSec } = item.dataset;
  const saltar = () => {
    const sec = $(`.page[data-page="${goPage}"] [data-sec="${goSec}"]`);
    if (sec) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  if (goPage !== state.view) { setView(goPage); requestAnimationFrame(saltar); }
  else saltar();
});

$('#settingsSearch').addEventListener('input', buildPanelNav);
$('#settingsSearchClear').addEventListener('click', () => {
  clearPanelSearch();
  buildPanelNav();
  $('#settingsSearch').focus();
});
// Escape con algo escrito limpia la búsqueda en vez de cerrar el panel: cerrarlo
// pierde lo que estabas buscando y hay que volver a entrar.
$('#settingsSearch').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !e.currentTarget.value) return;
  e.stopPropagation();
  e.preventDefault();
  clearPanelSearch();
  buildPanelNav();
});

for (const page of $$('.page')) page.addEventListener('scroll', scheduleNavSpy, { passive: true });

function syncRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

function emptyState(title, text) {
  const box = document.createElement('div');
  box.className = 'empty';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  box.append(strong, p);
  return box;
}

function paintDefList(target, rows) {
  target.replaceChildren();
  for (const [label, value] of rows) {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dd.title = value;
    wrap.append(dt, dd);
    target.append(wrap);
  }
}

/* ══════════════════════════════════════════════════════════
   Pedir un texto
   ══════════════════════════════════════════════════════════
   Electron no implementa window.prompt: devuelve null siempre y sin errores.
   Por eso «Renombrar» en los replays no hacía nada. Este modal lo reemplaza.
   ══════════════════════════════════════════════════════════ */
let askResolve = null;

function ask({ title, label, value = '', hint = '', ok, maxLength = 120 }) {
  $('#askTitle').textContent = title;
  $('#askLabel').textContent = label;
  $('#askOk').textContent = ok || t('ask.ok');
  $('#askInput').value = value;
  $('#askInput').maxLength = maxLength;
  $('#askHint').textContent = hint;
  $('#askHint').hidden = !hint;
  $('#askModal').hidden = false;
  $('#askInput').focus();
  $('#askInput').select();

  return new Promise((resolve) => { askResolve = resolve; });
}

function closeAsk(value) {
  $('#askModal').hidden = true;
  const resolve = askResolve;
  askResolve = null;
  if (resolve) resolve(value);
}

$('#askForm').addEventListener('submit', (e) => {
  e.preventDefault();
  closeAsk($('#askInput').value);
});
$('#askCancel').addEventListener('click', () => closeAsk(null));
$('#askClose').addEventListener('click', () => closeAsk(null));
$('#askModal').addEventListener('click', (e) => {
  if (e.target === $('#askModal')) closeAsk(null);
});

/* ══════════════════════════════════════════════════════════
   Navegación
   ══════════════════════════════════════════════════════════ */
/*
 * La navegación es el riel de la izquierda. Antes era una botonera horizontal
 * en la barra de arriba con una pastilla que se deslizaba al activo; la
 * pastilla se fue con ella y no hay nada que recolocar al cambiar de pestaña ni
 * al redimensionar (`movePill` existía sólo para eso).
 */
const nav = $('#rail');

/**
 * Muestra u oculta el panel, separando el trabajo caro de la animación.
 *
 * Abrir una página del panel por primera vez cuesta entre 23 y 74 ms de
 * maquetado —medido: Aspecto es la peor, con los temas, el avatar y el
 * overlay—. Si la animación de entrada arranca en ese mismo instante, esos
 * milisegundos se comen los primeros cuadros y se ve el tirón.
 *
 * Así que va en dos pasos: primero se muestra (y se fuerza el maquetado leyendo
 * `offsetHeight`, que obliga al navegador a hacer la cuenta ahora), y recién en
 * el cuadro siguiente se enciende la transición, que ya no tiene nada pesado
 * encima.
 */
/**
 * Maquetar las páginas del panel una vez, al arrancar.
 *
 * Medido en el cliente real: la PRIMERA vez que se abre cada página cuesta
 * 39 ms Rendimiento y 57 ms Aspecto; de ahí en adelante, 5 ms. O sea que el
 * tirón no es de todas las veces — es de la primera de cada pestaña, y como uno
 * las va abriendo de a una, se siente en todas.
 *
 * Acá se paga ese precio de una sola vez mientras la app todavía está
 * arrancando y nadie está mirando. El panel se muestra sin la clase `is-open`,
 * así que el velo y la tarjeta están en opacidad cero: no se ve nada, y todo
 * pasa dentro de una misma tarea, sin que se dibuje ningún cuadro en el medio.
 */
function warmPanel() {
  const panel = $('#panel');
  const pages = $$('.page');
  const activa = pages.find((p) => p.classList.contains('is-active')) || null;
  const estaba = panel.hidden;

  panel.hidden = false;
  for (const page of pages) {
    pages.forEach((p) => p.classList.toggle('is-active', p === page));
    void page.offsetHeight;
  }
  pages.forEach((p) => p.classList.toggle('is-active', p === activa));
  panel.hidden = estaba;
}

/**
 * Muestra u oculta el panel.
 *
 * Lo único que se anima es el velo, y es un color plano: se compone sin
 * repintar nada. Por eso alcanza con encender la clase acá mismo — leer
 * `offsetHeight` en el medio fija el estado de partida para que la transición
 * tenga desde dónde salir.
 *
 * Antes esto esperaba dos cuadros para arrancar, porque la tarjeta también se
 * animaba y había que sacarle el maquetado de encima. Esa animación ya no
 * existe (ver el comentario en app.css), así que se fue también la espera —y
 * con ella el riesgo de quedarse invisible si los cuadros no llegaban.
 */
/* Eventos del mouse/teclado sobre el panel no necesitan propagarse más allá:
   evita que handlers globales del documento procesen clics que ya manejó la UI. */
const PANEL_BLOCK_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'pointerdown', 'pointerup'];
const panelBlockHandler = (e) => e.stopPropagation();

/*
 * Sólo el panel. Avisarle al juego que hay algo encima lo hace `setView`, que es
 * el que sabe de las DOS cosas que lo tapan: este panel y la pestaña Música.
 */
function openPanel(open) {
  const panel = $('#panel');
  if (!open) {
    panel.classList.remove('is-open');
    panel.hidden = true;
    for (const evt of PANEL_BLOCK_EVENTS) panel.removeEventListener(evt, panelBlockHandler);
    return;
  }
  if (!panel.hidden) return; // ya estaba abierto: se cambió de pestaña, nada más
  panel.hidden = false;
  void panel.offsetHeight;
  panel.classList.add('is-open');
  for (const evt of PANEL_BLOCK_EVENTS) panel.addEventListener(evt, panelBlockHandler);
}

function setView(name) {
  state.view = name;
  $('#app').dataset.view = name;
  document.documentElement.dataset.view = name;

  $$('.railitem').forEach((item) => item.classList.toggle('is-active', item.dataset.view === name));

  // Primero todos los cambios de clase y recién después el scroll. Escribir
  // `scrollTop` en el medio del bucle obliga a maquetar ahí mismo, y con cuatro
  // páginas eso eran cuatro maquetados forzados por cada cambio de pestaña.
  let activa = null;
  for (const page of $$('.page')) {
    const esActiva = page.dataset.page === name;
    page.classList.toggle('is-active', esActiva);
    if (esActiva) activa = page;
  }
  if (activa && activa.scrollTop !== 0) activa.scrollTop = 0;
  // La verificación de Cloudflare flota por encima de este documento, así que
  // no se esconde sola al cambiar de pestaña: taparía Ajustes. Ver
  // `syncVerifyBounds`.
  syncVerifyBounds();
  // Acomodar un cartel se hace sobre la cancha: abrir cualquier panel encima es
  // dejar de acomodarlo, igual que tocar en otro lado del juego.
  if (name !== 'play') { stopKeysMoving(); stopMusicMoving(); }

  /*
   * «Salas» es el fondo; el resto se abre como panel encima. «Música» es la
   * excepción: también tapa la cancha, pero su reproductor no es HTML sino una
   * vista que el proceso principal pega sobre la ventana (ver ytmusic.js), así
   * que la pestaña es una pantalla propia (`.mstage`) que le hace el lugar y le
   * dice dónde ponerse.
   */
  const musica = name === 'musica';
  /*
   * El índice de secciones sólo tiene sentido en las cuatro pestañas de
   * ajustes. Replays trae su propia lista y su propio buscador, así que ahí la
   * columna de la izquierda no se dibuja y la página se queda con todo el
   * ancho (ver `[data-nav="off"]` en app.css).
   */
  $('#panel').dataset.nav = NAV_PAGES.includes(name) ? 'on' : 'off';
  openPanel(name !== 'play' && !musica);
  // Para el juego las dos cosas son lo mismo: con cualquiera de ellas encima
  // nadie está mirando la cancha y puede bajar el ritmo.
  tvm.game.panel(name !== 'play');

  if (name === 'replays') loadReplays();
  if (name === 'cuenta') loadAuth();
  /*
   * El índice se rearma en cada cambio de pestaña porque lista las secciones de
   * la que está abierta. Va DESPUÉS del `scrollTop = 0` de arriba: el marcador
   * de «estoy en ésta» se calcula con posiciones reales, y con el scroll a
   * medio camino marcaría la sección equivocada por un cuadro.
   */
  if (NAV_PAGES.includes(name)) buildPanelNav();
  /*
   * El reproductor flota por ENCIMA de este documento y no se esconde solo al
   * cambiar de pestaña: hay que correrlo o taparía lo que se abra. Va en cada
   * cambio de vista, se entre o se salga de Música.
   */
  if (musica) syncMusic();
  else syncMusicBounds();
  if (name === 'play' && state.stage === 'browser') refreshRoomsIfStale();
}

/**
 * Las teclas, de vuelta a la cancha.
 *
 * Todo lo que se abre encima del juego —el dock de amigos, el perfil, pasar a
 * pantalla completa— se lleva el foco al documento de la app, que no usa las
 * teclas para nada. Desde afuera se ve un juego que dejó de responder: la
 * pelota se sigue moviendo pero tu jugador no, hasta que hacés clic en la
 * cancha. Por eso el que se lo llevó tiene que devolverlo.
 */
function focusGame() {
  if (state.stage === 'game' && state.webview) state.webview.focus();
}

/** El juego se muestra sólo dentro de una sala; si no, mandamos nuestra lista. */
function setStage(kind) {
  if (state.stage === kind) return;
  state.stage = kind;
  $('#app').dataset.stage = kind;
  // El fondo ambiental se apaga cuando hay cancha detrás, no cuando estás en la
  // pestaña Salas: con los paneles encima son cosas distintas.
  document.documentElement.dataset.stage = kind;
  if (kind === 'browser') {
    // Fuera de una sala no hay nombre que mostrar: si quedara guardado, la
    // próxima sala arrancaría con el nombre de la anterior.
    state.gameRoomName = null;
    state.joinedRoomName = null;
    refreshRoomsIfStale();
  }
  pushPresence();
}

/**
 * Deja escrito en `<html>` si el riel está afuera, para que los avisos se corran.
 *
 * Dentro de una sala el riel se esconde y vuelve solo al pasar el mouse por el
 * borde izquierdo (`.railedge:hover ~ .rail`). Los avisos, con el riel guardado,
 * cuelgan de ese mismo borde — así que cuando el riel volvía le caía justo
 * encima: tapaba los botones de navegación y, como el aviso sí recibe el
 * puntero, además se comía el clic. El riel quedaba muerto mientras hubiera un
 * cartel en pantalla.
 *
 * El hover pasa adentro de `.app` y los avisos son hermanos de `.app`, así que
 * en CSS no hay cómo llegar: haría falta `:has()`, que no existe en el Chromium
 * de Electron 13. Se sube a mano acá y el resto lo hace el CSS.
 *
 * Se escucha en los DOS elementos porque el riel se queda afuera con el mouse en
 * cualquiera de ellos, y son la misma condición partida en dos cajas: apoyar el
 * mouse en el borde lo saca, y moverlo hacia los botones lo mantiene.
 */
function watchRail() {
  const root = document.documentElement;
  const out = () => { root.dataset.rail = 'out'; };
  const back = () => { delete root.dataset.rail; };
  for (const el of [$('#railEdge'), nav]) {
    el.addEventListener('mouseenter', out);
    el.addEventListener('mouseleave', back);
  }
}
watchRail();

nav.addEventListener('click', (e) => {
  const item = e.target.closest('.railitem');
  if (!item) return;
  // Volver a tocar la pestaña abierta cierra el panel, como cualquier menú.
  setView(item.dataset.view === state.view ? 'play' : item.dataset.view);
});

/** Cierra el panel y vuelve al fondo (la cancha o la lista de salas). */
function closePanel() {
  // La búsqueda no sobrevive al cierre: volver a abrir y encontrarse media
  // pestaña filtrada por algo que escribiste hace rato, con el campo vacío, se
  // lee como una pestaña rota.
  clearPanelSearch();
  if (state.view !== 'play') setView('play');
}

/* ── Tu perfil ─────────────────────────────────────────────────────────────
 *
 * El chip de la barra abre esto. Es lo único de la interfaz que responde «quién
 * sos» sin obligarte a entrar a una pestaña: antes el apodo estaba en Ajustes,
 * el rol en Aspecto y la foto en ningún lado.
 *
 * NO muestra cuándo vence el VIP. `discord.expiresAt` es el `exp` del token que
 * firma el sitio (ver vip.js), o sea cuándo hay que volver a preguntar — no
 * cuándo se te cae el rol. Poner esa fecha sería decir algo que no es.
 */
function meMenuOpen() {
  return !$('#meMenu').hidden;
}

function paintMeChip() {
  const profile = vipProfile();
  const nick = state.config.general.nickname || t('me.noNick');
  const vip = isVip();

  $('#meChipName').textContent = profile ? profile.username : nick;
  $('#meChipVip').hidden = true; // TL App no tiene niveles VIP
  paintFace($('#meChipAvatar'), profile ? { name: profile.username, avatar: profile.avatar } : { name: nick });
}

function paintMeMenu() {
  const profile = vipProfile();
  const nick = state.config.general.nickname || '';
  const vip = isVip();

  $('#meMenuName').textContent = profile ? profile.username : (nick || t('me.noNick'));
  paintFace($('#meMenuAvatar'), profile ? { name: profile.username, avatar: profile.avatar } : { name: nick });
  $('#meMenuNick').textContent = nick;

  const estado = $('#meMenuState');
  estado.replaceChildren();
  if (vip) {
    // TL App: todos los beneficios están activos para todo el equipo, sin insignia ni vencimiento.
    const activo = document.createElement('span');
    activo.className = 'ok';
    activo.append(document.createElement('i'), document.createTextNode(t('me.vipActive')));
    estado.append(activo);

  } else {
    estado.textContent = profile ? t('me.noRole') : t('me.noSession');
  }

  $('#meMenuLogout').hidden = !profile;
  $('#meMenuSep').hidden = !profile;
}

function toggleMeMenu(on) {
  const menu = $('#meMenu');
  const abrir = on === undefined ? menu.hidden : on;
  if (abrir) paintMeMenu();
  menu.hidden = !abrir;
  $('#btnMe').classList.toggle('is-on', abrir);
  $('#btnMe').setAttribute('aria-expanded', abrir ? 'true' : 'false');
}

$('#btnMe').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMeMenu();
});

// Cualquier clic afuera lo cierra; el de adentro no tiene que atravesarlo.
$('#meMenu').addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { if (meMenuOpen()) toggleMeMenu(false); });

$('#meMenu').addEventListener('click', (e) => {
  const item = e.target.closest('.memenu__i');
  if (!item) return;
  toggleMeMenu(false);
  const que = item.dataset.me;
  if (que === 'perfil') openProfile(null);
  else if (que === 'nick') showStart(null);
  else if (que === 'aspecto') goToSection('aspecto', 'jugador');
  else if (que === 'vip') goToSection('aspecto', 'sonidos');
  else if (que === 'ajustes') setView('ajustes');
});

$('#panelClose').addEventListener('click', closePanel);
$('#panelScrim').addEventListener('click', closePanel);
window.addEventListener('resize', () => {
  // Cambió el alto del panel: entran más (o menos) filas de sala en pantalla.
  paintRoomWindow(true);
});

/* ══════════════════════════════════════════════════════════
   Salas
   ══════════════════════════════════════════════════════════ */
async function loadRooms() {
  state.rooms.loading = true;
  state.rooms.error = null;
  renderRooms();
  try {
    const data = await tvm.rooms.list();
    state.rooms = { ...data, list: data.rooms, loading: false, error: null };
    state.roomsFailures = 0;
  } catch (err) {
    state.rooms.loading = false;
    state.rooms.error = err.message;
    /*
     * La hora del intento se anota TAMBIÉN cuando falla.
     *
     * Sin esto, el pedido fallido no dejaba marca y `refreshRoomsIfStale` veía
     * la lista eternamente vieja: cada vez que la interfaz lo tocaba —cambiar de
     * pestaña, volver de una sala, cualquier cosa— salía otro pedido en el acto.
     * Con HaxBall caído contestando 403 eso es machacar a una API que justamente
     * está pidiendo que la dejen en paz.
     */
    state.rooms.fetchedAt = Date.now();
    state.roomsFailures = (state.roomsFailures || 0) + 1;
  }
  renderRooms();
}

/** Cuánto se espera antes de volver a pedir: 20 s, y el doble en cada fallo. */
const ROOMS_TTL = 20000;
const ROOMS_TTL_MAX = 5 * 60 * 1000;

function roomsTtl() {
  return Math.min(ROOMS_TTL * 2 ** (state.roomsFailures || 0), ROOMS_TTL_MAX);
}

/** Evita machacar la API: refresca sólo si la lista ya está vieja. */
function refreshRoomsIfStale() {
  if (state.rooms.loading) return;
  if (Date.now() - (state.rooms.fetchedAt || 0) < roomsTtl()) return;
  loadRooms();
}

function isFavorite(token) {
  return (state.config.favorites || []).includes(token);
}

async function toggleFavorite(token) {
  const favorites = [...(state.config.favorites || [])];
  const at = favorites.indexOf(token);
  if (at >= 0) favorites.splice(at, 1);
  else favorites.push(token);
  await patchConfig({ favorites });
  renderRooms();
}

/** Salas de la casa: van arriba de todo, marcadas como patrocinadas. */
function isSponsored() {
  return false; // TL App no destaca salas de terceros
}

/** Último desempate: el orden en el que la API devolvió las salas. */
const byIndex = (a, b) => a.index - b.index;

/**
 * Orden geográfico. Es el que hace que funcionen los separadores.
 *
 * Muchos hosts publican salas "separador" (═══ NOMBRE ═══, 0/2 y con
 * contraseña) para que en la lista queden encerrando a las suyas. El truco es
 * la ubicación: medido en vivo, las salas reales de un mismo host están todas en
 * -34.6890,-58.4210 y los separadores en -34.6889,-58.4211 y -34.6891,-58.4209
 * — corridos una diezmilésima de grado (unos 11 metros) en direcciones
 * opuestas. Ordenando por distancia al jugador, uno cae justo antes del bloque
 * y el otro justo después.
 *
 * De ahí que la distancia se compare SIN redondear: a 376 km esos 11 metros
 * desaparecen al pasar a kilómetros enteros y el sándwich se deshace.
 */
const byGeo = (a, b) => {
  const da = Number.isFinite(a.distanceExact) ? a.distanceExact : Infinity;
  const db = Number.isFinite(b.distanceExact) ? b.distanceExact : Infinity;
  return da - db || byIndex(a, b);
};

function roomComparator() {
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  if (state.sort === 'players') return (a, b) => b.players - a.players || byIndex(a, b);
  if (state.sort === 'name') return (a, b) => byName(a, b) || byIndex(a, b);
  return byGeo;
}

function visibleRooms() {
  const query = $('#roomSearch').value.trim().toLowerCase();
  let list = state.rooms.list || [];
  if (query) list = list.filter((r) => r.name.toLowerCase().includes(query));
  if (state.onlyFavs) list = list.filter((r) => isFavorite(r.token));

  const compare = roomComparator();
  const sponsored = [];
  const rest = [];
  for (const room of list) (isSponsored(room) ? sponsored : rest).push(room);

  // Las patrocinadas van siempre en orden geográfico, aunque el jugador haya
  // elegido otro criterio: ordenarlas por jugadores o por nombre rompería el
  // sándwich de separadores que arma el host.
  return [...sponsored.sort(byGeo), ...rest.sort(compare)];
}

/* ── Dibujado por ventana ───────────────────────────────── *
 * La lista trae más de mil salas y en pantalla entran unas veinte. Se dibujan
 * sólo esas veinte, con dos bloques vacíos arriba y abajo que ocupan el lugar
 * del resto para que la barra de scroll mida bien.
 *
 * Antes se creaban las mil filas —unos seis mil nodos— y se dejaba que el CSS
 * (`content-visibility`) salteara el maquetado de las que no se veían. Pero
 * existir cuesta igual: memoria, y una revisión de visibilidad por fila en cada
 * cuadro mientras se scrollea. De ahí venían los tirones al bajar por la lista.
 *
 * Todas las salas siguen estando: lo que cambia es cuántas hay dibujadas a la
 * vez, no cuántas se pueden ver. */
const ROW_H = 32;
/** Filas de más arriba y abajo del borde, para que el scroll no muestre huecos. */
const OVERSCAN = 6;

/** Las salas que corresponde mostrar ahora, ya filtradas y ordenadas. */
let roomView = [];
let roomParts = null;
let paintedFrom = -1;
let paintedTo = -1;

function roomListParts() {
  if (roomParts) return roomParts;
  const container = $('#roomList');
  const top = document.createElement('div');
  top.className = 'rtable__pad';
  const rows = document.createElement('div');
  const bottom = document.createElement('div');
  bottom.className = 'rtable__pad';
  container.replaceChildren(top, rows, bottom);

  let frame = 0;
  container.addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paintRoomWindow();
    });
  }, { passive: true });

  /* Cuántas filas entran depende del alto de la caja, y ese alto cambia: al
     cerrarse la pantalla de inicio, al pasar a pantalla completa, al agrandar
     la ventana. Si no se vuelve a dibujar, quedan menos filas de las que
     entran y debajo se ve un hueco.

     Se compara el alto a mano: el observador también avisa por cambios que no
     son de alto, y redibujar de prendido a apagado desde adentro de su propio
     callback es la receta del bucle. */
  if (typeof ResizeObserver === 'function') {
    let lastHeight = 0;
    new ResizeObserver(() => {
      const h = container.clientHeight;
      if (h === lastHeight) return;
      lastHeight = h;
      paintRoomWindow(true);
    }).observe(container);
  }

  roomParts = { container, top, rows, bottom };
  return roomParts;
}

/** @param {boolean} force Redibuja aunque la ventana visible no haya cambiado. */
function paintRoomWindow(force = false) {
  const { container, top, rows, bottom } = roomListParts();
  const total = roomView.length;

  if (!total) {
    top.style.height = '0px';
    bottom.style.height = '0px';
    paintedFrom = paintedTo = -1;
    return;
  }

  const height = container.clientHeight || 420;
  const window_ = Math.ceil(height / ROW_H) + OVERSCAN * 2;
  /* El tope importa: si la lista se achica (una búsqueda, por ejemplo) mientras
     estabas abajo de todo, el scroll que quedó guardado apunta más allá del
     final. Sin recortarlo, la ventana caía fuera de la lista y no se dibujaba
     ni una fila: la búsqueda parecía no encontrar nada. */
  const maxFirst = Math.max(0, total - window_);
  const first = Math.min(maxFirst, Math.max(0, Math.floor(container.scrollTop / ROW_H) - OVERSCAN));
  const last = Math.min(total, first + window_);
  if (!force && first === paintedFrom && last === paintedTo) return;
  paintedFrom = first;
  paintedTo = last;

  top.style.height = `${first * ROW_H}px`;
  bottom.style.height = `${Math.max(0, total - last) * ROW_H}px`;

  const frag = document.createDocumentFragment();
  for (let i = first; i < last; i++) frag.append(roomRow(roomView[i]));
  rows.replaceChildren(frag);
}

/** Mensaje en lugar de la lista (error, sin resultados, todavía cargando). */
function showRoomsMessage(node) {
  const { top, rows, bottom } = roomListParts();
  roomView = [];
  paintedFrom = paintedTo = -1;
  top.style.height = '0px';
  bottom.style.height = '0px';
  rows.replaceChildren(...(node ? [node] : []));
}

function renderRooms() {
  const summary = $('#roomsSummary');

  if (state.rooms.loading && !state.rooms.list.length) {
    summary.textContent = t('rooms.loading');
    showRoomsMessage(null);
    return;
  }
  if (state.rooms.error) {
    summary.textContent = '';
    showRoomsMessage(emptyState(t('rooms.error'), state.rooms.error));
    return;
  }

  summary.textContent = t('rooms.summary', {
    players: state.rooms.totalPlayers.toLocaleString('es-AR'),
    rooms: state.rooms.totalRooms.toLocaleString('es-AR')
  });

  const list = visibleRooms();

  if (!list.length) {
    const hasQuery = $('#roomSearch').value.trim().length > 0;
    showRoomsMessage(emptyState(
      hasQuery ? t('rooms.noResults') : t('rooms.empty'),
      hasQuery ? t('rooms.noResultsText') : t('rooms.emptyText')
    ));
    syncJoinButton();
    return;
  }

  roomView = list;
  paintRoomWindow(true);

  checkAutoJoin();
  syncJoinButton();
}

/** Cambió el filtro o el orden: la lista es otra, así que se mira desde arriba. */
function renderRoomsFromTop() {
  roomListParts().container.scrollTop = 0;
  renderRooms();
}

function roomRow(room) {
  const full = room.players >= room.maxPlayers;
  const almostFull = !full && room.maxPlayers > 2 && room.players >= room.maxPlayers - 2 && room.players > 0;
  const openRoom = !full && !almostFull && room.players > 0;
  const sponsored = isSponsored(room);
  const row = document.createElement('div');
  row.className = 'rrow';
  if (full) row.classList.add('is-full');
  else if (almostFull) row.classList.add('is-almost-full');
  else if (openRoom) row.classList.add('is-open-room');
  if (!room.players) row.classList.add('is-empty');
  if (sponsored) row.classList.add('is-sponsored');
  if (state.selected === room.token) row.classList.add('is-selected');
  row.dataset.token = room.token;

  const dist = document.createElement('span');
  dist.className = 'rrow__dist';
  dist.textContent = room.distance != null ? `${room.distance.toLocaleString('es-AR')} km` : '';

  const flag = flagElement(room.country);

  const name = document.createElement('span');
  name.className = 'rrow__name';
  if (room.password) {
    const lock = document.createElement('span');
    lock.className = 'rrow__lock';
    lock.textContent = '🔒';
    lock.title = t('rooms.locked');
    name.append(lock);
  }
  const label = document.createElement('span');
  label.className = 'rrow__label';
  label.textContent = room.name;
  label.title = room.name;
  name.append(label);

  if (sponsored) {
    const badge = document.createElement('span');
    badge.className = 'rrow__badge';
    badge.textContent = t('rooms.sponsored');
    name.append(badge);
  }

  const players = document.createElement('span');
  players.className = 'rrow__players';
  players.textContent = `${room.players}/${room.maxPlayers}`;

  const fav = document.createElement('button');
  fav.className = `rrow__fav${isFavorite(room.token) ? ' is-on' : ''}`;
  fav.type = 'button';
  fav.dataset.fav = '1';
  fav.textContent = '★';
  fav.title = t('rooms.fav');

  row.append(dist, flag, name, players, fav);
  // Sin listeners por fila: la lista entera puede pasar el millar de salas y
  // colgarle tres manejadores a cada una era el grueso del costo de dibujarla.
  // Se delega en el contenedor (ver más abajo).
  return row;
}

/* Un solo juego de manejadores para toda la tabla. */
$('#roomList').addEventListener('click', (e) => {
  const row = e.target.closest('.rrow');
  if (!row) return;
  if (e.target.closest('[data-fav]')) {
    e.stopPropagation();
    toggleFavorite(row.dataset.token);
    return;
  }
  selectRoom(row.dataset.token);
});

$('#roomList').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.rrow');
  if (row && !e.target.closest('[data-fav]')) joinRoom(row.dataset.token);
});

/**
 * Bandera del sprite de HaxBall. Si todavía no se pudo bajar, cae al código
 * de país en texto, que es mejor que un hueco.
 */
function flagElement(country) {
  const flag = document.createElement('span');
  const position = state.flags && state.flags.positions[country];
  if (position) {
    flag.className = 'rrow__flag';
    flag.style.backgroundPosition = `${position[0]}px ${position[1]}px`;
    flag.title = country;
  } else {
    flag.className = 'rrow__flag rrow__flag--text';
    flag.textContent = country || '';
  }
  return flag;
}

function applyFlags(data) {
  if (!data || !data.image) return;
  state.flags = data;
  document.documentElement.style.setProperty('--flag-sprite', `url("${data.image}")`);
  renderRooms();
  /*
   * Y la de Ajustes, que era la que quedaba mal.
   *
   * El sprite se baja DESPUÉS de que la interfaz se pintó por primera vez, así
   * que cuando `renderCountry` pintó tu bandera todavía no había con qué: caía
   * al respaldo de texto —el «AR» a la izquierda del select— y ahí se quedaba,
   * porque lo único que volvía a pintarla era cambiar el select. De ahí que
   * hubiera que poner otro país y volver al tuyo para verla.
   */
  if (state.config) paintCountryFlag(state.config.countryOverride || '');
}

function selectRoom(token) {
  state.selected = token;
  $$('.rrow').forEach((row) => row.classList.toggle('is-selected', row.dataset.token === token));
  syncJoinButton();
}

function syncJoinButton() {
  $('#actJoin').disabled = !state.selected;
  $('#actAutoJoin').disabled = !state.selected && !state.autoJoin;
  $('#actAutoJoin').classList.toggle('is-on', !!state.autoJoin);
}

/** Antes de entrar siempre se confirma el apodo en la pantalla de inicio. */
/* ── Volver a la última sala ────────────────────────────────────── */
function paintLastRoom(last) {
  const button = $('#lastRoom');
  if (!button) return;
  state.lastRoom = last || null;
  button.hidden = !last || !last.token;
  // El mismo atajo, en la barra de arriba: se ve desde cualquier pantalla.
  const top = $('#topLastRoom');
  if (top) {
    top.hidden = !last || !last.token;
    top.title = last && last.name ? last.name : '';
    const nameEl = $('#topLastRoomName');
    if (nameEl) {
      nameEl.textContent = last && last.name ? last.name : '';
      nameEl.hidden = !(last && last.name);
    }
  }
  if (!last || !last.token) return;
  // Sin nombre igual se ofrece: el token alcanza para volver, y decir «la
  // última sala» a secas es mejor que esconder el botón.
  $('#lastRoomName').textContent = last.name || '';
}

async function refreshLastRoom() {
  paintLastRoom(await guard(tvm.rooms.last(), 'Error'));
}

$('#lastRoom').addEventListener('click', () => {
  if (state.lastRoom && state.lastRoom.token) joinRoom(state.lastRoom.token);
});
$('#topLastRoom').addEventListener('click', () => {
  if (state.lastRoom && state.lastRoom.token) joinRoom(state.lastRoom.token);
});

function joinRoom(tokenOrLink) {
  const room = (state.rooms.list || []).find((r) => r.token === tokenOrLink);
  state.pendingJoin = tokenOrLink;
  showStart(room ? room.name : null);
}

async function doJoin(tokenOrLink) {
  const res = await guard(tvm.rooms.join(tokenOrLink), t('toast.badLink'));
  if (!res) return false;
  /*
   * La fila se busca por el token que devuelve el main, no por lo que se tecleó.
   *
   * Entrando por link, lo que llega acá es un `https://…/play?c=…` entero y
   * ninguna fila de la lista tiene eso como token, así que la sala se quedaba
   * sin nombre: la presencia de Discord mostraba «En una sala» a secas hasta que
   * el juego alcanzara a leer el título —y si esa lectura fallaba, nunca—.
   * `rooms:join` ya parsea el link y devuelve el token pelado; con eso la fila
   * aparece igual que entrando desde la lista.
   */
  const room = (state.rooms.list || []).find((r) => r.token === res.token);
  // Antes de `setStage`, que ya publica la presencia: si no, Discord anuncia la
  // sala anterior durante ese instante.
  state.gameRoomName = null;
  state.joinedRoomName = room ? room.name : null;
  setView('play');
  setStage('game');
  showLoading(t('game.connecting'));
  dismissToast(state.joiningToast);
  state.joiningToast = toast(t('toast.joining'), 'ok');
  return true;
}

/* ── Auto-entrar ────────────────────────────────────────── */
function toggleAutoJoin() {
  if (state.autoJoin) {
    state.autoJoin = null;
    toast(t('rooms.autoJoinOff'), 'ok');
    syncJoinButton();
    return;
  }
  if (!state.selected) return;
  const room = (state.rooms.list || []).find((r) => r.token === state.selected);
  state.autoJoin = state.selected;
  syncJoinButton();
  toast(t('rooms.autoJoinOn', { name: room ? room.name.slice(0, 24) : '' }), 'ok');
  loadRooms();
}

/**
 * En vez de golpear la sala una y otra vez, mira la lista (que ya se refresca)
 * y entra recién cuando hay lugar. Es más amable con el servidor y con el host.
 */
function checkAutoJoin() {
  if (!state.autoJoin || state.stage === 'game') return;
  const room = (state.rooms.list || []).find((r) => r.token === state.autoJoin);
  if (!room || room.players >= room.maxPlayers) return;
  const token = state.autoJoin;
  state.autoJoin = null;
  syncJoinButton();
  doJoin(token);
}

/* ── Pantalla de inicio ─────────────────────────────────── */
/** Racha, partidos, goles y horas jugadas, con los números reales de este equipo. */
function paintStartSummary(roomName) {
  const box = $('#startSummary');
  if (!box) return;
  const stats = state.config.stats || {};
  const hours = Math.floor((stats.secondsPlayed || 0) / 3600);
  const chips = [];
  if (stats.streak > 0) chips.push(t('stats.streak', { days: stats.streak }));
  if (stats.matches > 0) chips.push(t('start.sum.matches', { n: stats.matches }));
  if (stats.goals > 0) chips.push(t('start.sum.goals', { n: stats.goals }));
  if (stats.assists > 0) chips.push(t('start.sum.assists', { n: stats.assists }));
  if (hours > 0) chips.push(t('start.sum.hours', { n: hours }));
  const show = !roomName && state.config.general.welcomeSummary !== false && chips.length > 0;
  box.hidden = !show;
  box.replaceChildren(...(show ? chips : []).map((text) => {
    const chip = document.createElement('span');
    chip.className = 'startsummary__chip';
    chip.textContent = text;
    return chip;
  }));
}

function showStart(roomName) {
  paintStartSummary(roomName);
  $('#startTitle').textContent = roomName ? t('start.titleRoom') : t('start.title');
  $('#startText').textContent = roomName || t('start.text');
  $('#startNick').value = state.config.general.nickname || '';
  $('#startBack').hidden = !roomName && !state.booted;
  $('#startScreen').hidden = false;
  $('#startNick').focus();
  $('#startNick').select();
}

function hideStart() {
  $('#startScreen').hidden = true;
  state.pendingJoin = null;
}

$('#startForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nick = $('#startNick').value.trim();
  if (!nick) return;

  const changed = nick !== state.config.general.nickname;
  if (changed) {
    await patchConfig({ general: { nickname: nick } });
    renderSettings();
  }
  // Sin esto la tarjeta «¿Cómo te llamás?» del navegador de salas seguía
  // visible aunque el nombre ya estuviera puesto en la pantalla de inicio.
  renderNickCard();

  const pending = state.pendingJoin;
  hideStart();
  state.booted = true;

  /*
   * Recargar el juego va al final y aparte: si fallara, la pantalla de inicio ya
   * se cerró y el nombre ya quedó guardado, en vez de trabarse a medio paso.
   *
   * Y las dos cosas juntas nunca: entrar a una sala YA es una carga nueva del
   * juego —con el nombre nuevo puesto por el preload antes de que arranque—, así
   * que recargar además era mandar dos navegaciones al mismo webview a ver cuál
   * llegaba primero.
   */
  if (pending) doJoin(pending);
  // Por el mismo camino que el apodo de Ajustes: si estás en una sala, se anota
  // y se aplica al salir en vez de sacarte de ella. Ver `canReloadGame`.
  else if (changed) scheduleGameReload();
});

/**
 * El <webview> puede no estar montado todavía; nunca vale trabar el flujo.
 *
 * Se pregunta primero si HaxBall está en pie: recargar contra el sitio caído es
 * lo que cierra el cliente (ver `mountGame`). Si no está, en vez de recargar se
 * muestra el cartel, y el juego que ya estaba cargado se queda como está.
 *
 * Recarga y punto: el «¿ahora se puede?» se contesta antes, en `canReloadGame`,
 * y el único que llama acá es `runPendingReload`.
 */
async function reloadGame() {
  try {
    if (!state.webview || typeof state.webview.reload !== 'function') return;
    const health = await tvm.game.health(true).catch(() => ({ down: false }));
    if (health.down) return showGameDown(health.reason);
    // Por el proceso principal y no con `state.webview.reload()`: recarga todas
    // las pestañas que están en la lista de salas, no sólo la que se mira, y
    // deja en paz a las que están adentro de una sala (ver `game:reload`).
    await tvm.game.reload();
  } catch (err) {
    console.error('no se pudo recargar el juego:', err);
  }
}

$('#startBack').addEventListener('click', hideStart);

$('#roomsRefresh').addEventListener('click', () => {
  const icon = $('#roomsRefresh svg');
  if (icon) {
    icon.classList.remove('is-spinning');
    void icon.offsetWidth;
    icon.classList.add('is-spinning');
    setTimeout(() => icon.classList.remove('is-spinning'), 500);
  }
  loadRooms();
});
/* La lista puede pasar el millar de filas: rehacerla en cada tecla era el pico
   de CPU más grande de la pantalla. Se espera a que el jugador deje de tipear. */
let searchTimer = null;
$('#roomSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderRoomsFromTop, 140);
});
$('#roomSort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderRoomsFromTop();
});

$('#linkForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = $('#linkInput').value.trim();
  if (!value) return;
  joinRoom(value);
  $('#linkInput').value = '';
});

/* ── Barra de acciones ──────────────────────────────────── */
$('#actJoin').addEventListener('click', () => {
  if (state.selected) joinRoom(state.selected);
});
$('#actAutoJoin').addEventListener('click', toggleAutoJoin);
$('#favToggle').addEventListener('click', () => {
  state.onlyFavs = !state.onlyFavs;
  $('#favToggle').classList.toggle('is-on', state.onlyFavs);
  renderRoomsFromTop();
});

// El botón «Replays» de la barra de acciones ya no está: a Replays se entra por
// la pestaña de la barra de navegación. El listener quedó colgado apuntando a un
// id que no existe, y eso tiraba TODO el renderer (ver la red de seguridad del
// arranque, al principio de este archivo).
$('#actChangeNick').addEventListener('click', () => {
  goToSection('aspecto', 'jugador');
  $('#nickname').focus();
  $('#nickname').select();
});

/* ── Crear sala ─────────────────────────────────────────── */
const CREATE_SWITCH = {
  es: { label: 'Mostrar en la lista pública', description: 'Sólo entra quien tenga el link.' },
  en: { label: 'Show in the public list', description: 'Only people with the link can join.' }
};

function openCreateModal() {
  const lang = isEn() ? 'en' : 'es';
  const nick = state.config.general.nickname || 'HaxBall';

  $('#createName').value = `${nick}'s room`;
  $('#createPass').value = '';

  const max = $('#createMax');
  max.replaceChildren();
  for (let n = 2; n <= 20; n++) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = String(n);
    max.append(opt);
  }
  max.value = '12';

  buildSwitches($('#createSwitches'), [{
    ...CREATE_SWITCH[lang],
    key: 'listed',
    value: () => state.createListed
  }], (item, value) => { state.createListed = value; });

  $('#createModal').hidden = false;
  $('#createName').focus();
  $('#createName').select();
}

function closeCreateModal() {
  $('#createModal').hidden = true;
}

$('#actCreate').addEventListener('click', () => {
  if (!state.config.general.nickname) {
    $('#nickInput').focus();
    return;
  }
  openCreateModal();
});
$('#createClose').addEventListener('click', closeCreateModal);
$('#createCancel').addEventListener('click', closeCreateModal);
$('#createModal').addEventListener('click', (e) => {
  if (e.target === $('#createModal')) closeCreateModal();
});

$('#createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const options = {
    name: $('#createName').value.trim(),
    password: $('#createPass').value,
    maxPlayers: Number($('#createMax').value),
    listed: state.createListed
  };
  if (!options.name) return;

  closeCreateModal();
  const res = await guard(tvm.rooms.create(options), 'Error');
  if (!res) return;
  // El nombre de LA SALA QUE SE ESTÁ CREANDO. HaxBall lo confirma después,
  // leyendo el título de la sala; hasta entonces éste es el bueno.
  state.gameRoomName = null;
  state.joinedRoomName = options.name;
  // HaxBall puede pedir su verificación anti-bot: hay que mostrarle el juego.
  setStage('game');
  toast(t('create.creating'), 'ok');
});

/* ── Nombre del jugador ─────────────────────────────────── */
function renderNickCard() {
  const missing = !state.config.general.nickname;
  $('#nickCard').hidden = !missing;
  if (missing) $('#nickInput').value = '';
}

$('#nickForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nick = $('#nickInput').value.trim();
  if (!nick) return;
  await patchConfig({ general: { nickname: nick } });
  renderNickCard();
  renderSettings();
  toast(t('toast.nickSaved'), 'ok');
  scheduleGameReload();
});

/* ══════════════════════════════════════════════════════════
   Ajustes de HaxBall (esquema)
   ══════════════════════════════════════════════════════════ */
/* ── Aplicar un ajuste de HaxBall ────────────────────────────────────────────
 *
 * Casi todos se aplican solos: el preload le escribe el valor al juego que ya
 * está corriendo (ver `applyGameSettingsLive`) y HaxBall los relee mientras
 * dibuja. Acá no hay nada que hacer más que avisar.
 *
 * Los que HaxBall lee una sola vez —hoy sólo la extrapolación, marcada con
 * `live: false` en el esquema— siguen necesitando recargar el juego. Y ahí
 * estaba el otro problema: si estabas en una partida se avisaba «se aplica
 * cuando salgas» y NO QUEDABA NADA PENDIENTE, así que al salir no se aplicaba
 * tampoco. Ahora queda anotado y se aplica al terminar la partida.
 */
let reloadTimer = null;
/** Un cambio que necesita recargar y está esperando a que termines de jugar. */
let reloadPending = false;

function appliesLive(setting) {
  return setting ? setting.live !== false && state.liveGameSettings : false;
}

/**
 * @param {object} [setting] el ajuste que se tocó; sin él se asume que hay que
 *                           recargar (los controles, la bandera y el apodo).
 */
function applyGameSetting(setting) {
  if (appliesLive(setting)) {
    // El preload ya lo empujó al juego con el `game:config` de `patchConfig`.
    toast(t('toast.applied'), 'ok');
    return;
  }
  scheduleGameReload();
}

/**
 * ¿Se puede recargar el juego ahora sin costarle nada al jugador?
 *
 * Recargar es volver a cargar la página del juego, y eso es salir de la sala.
 * Jugando no se discute; en una sala tampoco, aunque el partido no haya
 * empezado — sacar a alguien de la sala por haber tocado un ajuste es peor que
 * hacerle esperar a que salga.
 *
 * Hasta ahora esto no hacía falta de casualidad: dentro de una sala HaxBall
 * vetaba toda navegación con su `onbeforeunload` y la recarga se perdía sola,
 * en silencio y con el ajuste sin aplicar. El veto ya no está (ver
 * `will-prevent-unload` en main.js), así que la decisión se toma acá.
 */
function canReloadGame() {
  return !state.playing && state.stage !== 'game';
}

function scheduleGameReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    if (!canReloadGame()) {
      // Se anota para cuando salga: antes se avisaba y se perdía.
      reloadPending = true;
      toast(t('toast.applyLater'), 'ok');
      return;
    }
    runPendingReload();
  }, 700);
}

/** Lo que quedó esperando, si ya se puede. Es el único que dispara lo anotado. */
function flushPendingReload() {
  if (!reloadPending || !canReloadGame()) return;
  runPendingReload();
}

function runPendingReload() {
  reloadPending = false;
  if (!state.webview) return;
  reloadGame();
  toast(t('toast.applied'), 'ok');
}

/** Los textos del esquema vienen en los dos idiomas. */
function label(setting) {
  return (isEn() && setting.labelEn) || setting.label;
}
function help(setting) {
  return isEn() ? setting.helpEn : setting.help;
}

function renderGameSettings(container, group) {
  container.replaceChildren();
  for (const setting of state.schema.game.filter((s) => s.group === group)) {
    container.append(gameSettingControl(setting));
  }
}

/*
 * Un ajuste propio de HaxBall, dibujado como fila del panel.
 *
 * Las ayudas del esquema (`help` / `helpEn` en haxball-settings.js) se
 * recortaron a media línea cada una, así que van todas como descripción de la
 * fila y ninguna necesita el `ⓘ`.
 */
function gameSettingControl(setting) {
  const current = state.config.game[setting.id];
  const description = help(setting);
  const hint = null;

  if (setting.type === 'toggle') {
    // `value` se lee de la config viva, no de una copia: si no, después de
    // tocarlo el interruptor volvía solo a la posición anterior.
    return switchRow({
      label: label(setting),
      description,
      hint,
      value: () => {
        const now = state.config.game[setting.id];
        return now === '1' || now === true;
      }
    }, async (_item, value) => {
      await patchConfig({ game: { [setting.id]: value ? '1' : '0' } });
      applyGameSetting(setting);
    });
  }

  if (setting.type === 'select') {
    return selectRow({
      label: label(setting),
      description,
      hint,
      id: `hb-${setting.id}`,
      options: setting.options.map((opt) => [opt.value, (isEn() && opt.labelEn) || opt.label]),
      value: current,
      onChange: async (value) => {
        await patchConfig({ game: { [setting.id]: value } });
        applyGameSetting(setting);
      }
    });
  }

  const fmt = FORMATTERS[setting.format] || ((v) => v);
  const commit = async (raw) => {
    await patchConfig({ game: { [setting.id]: String(raw) } });
    applyGameSetting(setting);
  };

  /*
   * Los ajustes finos (la extrapolación) además se tipean: con el paso en 1 la
   * barra sola es incómoda. La caja de número reemplaza al número de sólo
   * lectura que llevan las demás barras, no se suma a él.
   */
  if (setting.precise) {
    const range = document.createElement('input');
    range.type = 'range';
    range.id = `hb-${setting.id}`;
    range.min = setting.min;
    range.max = setting.max;
    range.step = setting.step;
    range.value = current;

    const box = document.createElement('input');
    box.type = 'number';
    box.className = 'numbox';
    box.min = setting.min;
    box.max = setting.max;
    box.step = setting.step;
    box.value = current;

    const unit = document.createElement('span');
    unit.className = 'numbox__unit';
    unit.textContent = setting.unit || '';

    const holder = document.createElement('span');
    holder.className = 'numbox__wrap';
    holder.append(box, unit);

    range.addEventListener('input', () => {
      box.value = range.value;
      syncRangeFill(range);
    });
    range.addEventListener('change', () => commit(range.value));
    box.addEventListener('change', () => {
      // Tipear fuera de rango es fácil; se recorta en vez de rechazarlo.
      const n = Math.min(setting.max, Math.max(setting.min, Number(box.value) || 0));
      box.value = n;
      range.value = n;
      syncRangeFill(range);
      commit(n);
    });
    queueMicrotask(() => syncRangeFill(range));

    return settingRow({ label: label(setting), description, hint, control: [range, holder] });
  }

  return rangeRow({
    label: label(setting),
    description,
    hint,
    id: `hb-${setting.id}`,
    min: setting.min,
    max: setting.max,
    step: setting.step,
    value: current,
    format: fmt,
    onChange: commit
  });
}

/* ══════════════════════════════════════════════════════════
   Rendimiento
   ══════════════════════════════════════════════════════════ */
const PERF_GROUPS = {
  perfLatency: [
    { key: 'highProcessPriority', label: 'Prioridad alta', description: 'Le pide más CPU a Windows.', restart: false },
    { key: 'disableBackgroundThrottling', label: 'Sin freno en segundo plano', description: 'No baja el ritmo sin el foco.', restart: true }
  ],
  perfGpu: [
    /*
     * Estaba en la config (`perf.unlockFps`, prendido de fábrica) pero se había
     * caído del panel. El que lo tenía apagado —por la migración v8 de las
     * configs viejas, o traído de otra PC por la sincronización— quedaba con los
     * FPS clavados en el refresco del monitor y sin ninguna forma de volver.
     */
    { key: 'unlockFps', label: 'FPS sin límite', description: 'Deja pasar los FPS del refresco del monitor.', hint: 'Apaga el V-Sync. Si igual quedan clavados en los Hz de tu monitor, revisá que el panel de tu placa de video (NVIDIA, AMD o Intel) no tenga la sincronización vertical forzada.', restart: true },
    { key: 'flatGraphics', label: 'Gráficos planos', description: 'Saca texturas y sombras de la cancha.', restart: false },
    { key: 'gpuRasterization', label: 'Rasterizado por GPU', description: 'Descarga el dibujado en la placa de video.', restart: true },
    { key: 'zeroCopy', label: 'Copia cero', description: 'Menos copias de memoria por cuadro.', restart: true },
    { key: 'highPerformanceGpu', label: 'Usar la placa dedicada', description: 'Pide la placa buena, no la integrada.', restart: true },
    { key: 'forceGpu', label: 'Forzar aceleración', description: 'Ignora la lista de drivers bloqueados.', hint: 'Activalo sólo si el cliente no te está tomando la placa de video.', restart: true }
  ],
  perfSystem: [
    // La publicidad de haxball.com ya no se carga nunca y no hay interruptor:
    // eran 676 MB contra 1033 MB y tres procesos menos. Nadie ganaba nada
    // apagándolo, así que dejó de ser una decisión del jugador.
    { key: 'noOcclusionPause', label: 'No pausar si algo tapa la ventana', description: 'Windows pausa si cree que está tapada.', restart: true },
    { key: 'lowLatencyAudio', label: 'Audio de baja latencia', description: 'Usa la ruta de audio directa de Windows.', restart: true },
    { key: 'disableHardwareAcceleration', label: 'Desactivar aceleración por hardware', description: 'Sólo para diagnosticar: el render pasa a la CPU.', hint: 'Va bastante más lento. Sirve para saber si una falla gráfica viene del driver de video.', restart: true }
  ]
};

const PERF_GROUPS_EN = {
  perfLatency: [
    { key: 'highProcessPriority', label: 'High priority', description: 'Asks Windows for more CPU.', restart: false },
    { key: 'disableBackgroundThrottling', label: 'No background throttling', description: 'Keeps the pace without focus.', restart: true }
  ],
  perfGpu: [
    { key: 'unlockFps', label: 'Unlimited FPS', description: 'Lets FPS go past the monitor refresh rate.', hint: 'Turns V-Sync off. If FPS still stick to your monitor Hz, check that your graphics card panel (NVIDIA, AMD or Intel) is not forcing vertical sync.', restart: true },
    { key: 'flatGraphics', label: 'Flat graphics', description: 'Removes pitch textures and shadows.', restart: false },
    { key: 'gpuRasterization', label: 'GPU rasterization', description: 'Moves drawing onto the graphics card.', restart: true },
    { key: 'zeroCopy', label: 'Zero copy', description: 'Fewer memory copies per frame.', restart: true },
    { key: 'highPerformanceGpu', label: 'Use the dedicated GPU', description: 'Asks for the good GPU, not the integrated one.', restart: true },
    { key: 'forceGpu', label: 'Force acceleration', description: 'Ignores the blocked driver list.', hint: 'Only turn it on if the client is not picking up your graphics card.', restart: true }
  ],
  perfSystem: [
    { key: 'noOcclusionPause', label: 'Do not pause when covered', description: 'Windows pauses when it thinks it is hidden.', restart: true },
    { key: 'lowLatencyAudio', label: 'Low latency audio', description: 'Uses the direct Windows audio path.', restart: true },
    { key: 'disableHardwareAcceleration', label: 'Disable hardware acceleration', description: 'Diagnostics only: rendering moves to the CPU.', hint: 'It runs noticeably slower. Use it to tell whether a graphics glitch comes from the video driver.', restart: true }
  ]
};

/*
 * ═══ Perfiles de rendimiento ═══
 *
 * Acá vivían dos botones que aplicaban un paquete de ajustes de una: «Modo
 * competitivo» y «PC de baja gama». Se sacaron por pedido, y el pedido tenía
 * razón: un botón que cambia diez cosas a la vez deja la configuración en un
 * estado que después nadie sabe de dónde salió.
 *
 * Vuelven contestando eso, no ignorándolo:
 *
 *   · Cada perfil dice qué hace ANTES de tocarlo, en su propia línea.
 *   · Todo lo que tocan sigue visible y editable en esta misma pantalla, fila
 *     por fila. No hay nada que el perfil ponga y no se pueda ver.
 *   · Apenas cambiás un solo control a mano, el estado pasa a «Personalizado».
 *     El perfil no se queda figurando como el dueño de una configuración que
 *     ya no es la suya, que era exactamente el problema.
 *
 * Los tres perfiles tocan las MISMAS claves, así que comparar dos es comparar
 * una columna: no hay ajuste que uno ponga y otro deje como estaba, porque eso
 * es lo que hace imposible saber qué quedó puesto.
 */
const PERF_PRESET_KEYS = ['flatGraphics', 'gpuRasterization', 'zeroCopy', 'highPerformanceGpu', 'highProcessPriority', 'disableBackgroundThrottling'];

const PERF_PRESETS = [
  {
    id: 'calidad',
    values: { flatGraphics: false, gpuRasterization: true, zeroCopy: false, highPerformanceGpu: true, highProcessPriority: false, disableBackgroundThrottling: false },
    fpsCap: 0
  },
  {
    id: 'equilibrado',
    values: { flatGraphics: false, gpuRasterization: true, zeroCopy: true, highPerformanceGpu: true, highProcessPriority: true, disableBackgroundThrottling: true },
    fpsCap: 0
  },
  {
    id: 'fps',
    values: { flatGraphics: true, gpuRasterization: true, zeroCopy: true, highPerformanceGpu: true, highProcessPriority: true, disableBackgroundThrottling: true },
    fpsCap: 0
  }
];

/** Cuál de los tres está puesto exactamente, o `null` si es una mezcla. */
function activePerfPreset() {
  const perf = state.config.perf || {};
  return PERF_PRESETS.find((preset) =>
    PERF_PRESET_KEYS.every((key) => Boolean(perf[key]) === Boolean(preset.values[key]))
  ) || null;
}

function renderPerfPresets() {
  const box = $('#perfPresets');
  const estado = $('#perfPresetState');
  if (!box) return;
  box.replaceChildren();

  const actual = activePerfPreset();
  if (estado) estado.textContent = actual ? t(`perf.preset.${actual.id}`) : t('perf.preset.custom');

  for (const preset of PERF_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `presetbtn${actual === preset ? ' is-on' : ''}`;

    const name = document.createElement('b');
    name.textContent = t(`perf.preset.${preset.id}`);
    const what = document.createElement('small');
    what.textContent = t(`perf.preset.${preset.id}Help`);
    btn.append(name, what);

    btn.addEventListener('click', async () => {
      await patchConfig({ perf: { ...preset.values, fpsCap: preset.fpsCap } });
      /*
       * Casi todas estas claves son banderas de Chromium y se leen una sola vez,
       * antes de que exista la ventana: sin el aviso, la persona toca un perfil,
       * no ve cambiar nada y da por hecho que el botón no anda.
       */
      needsRestart();
      renderPerf();
      toast(t('perf.preset.applied', { name: t(`perf.preset.${preset.id}`) }), 'ok');
    });
    box.append(btn);
  }
}

/*
 * Techo de cuadros.
 *
 * Misma lista que el cliente Zero, con el mismo sentido: frena hacia abajo. El
 * que deja pasar del refresco del monitor es el interruptor «FPS desbloqueados»
 * de acá abajo, que apaga el V-Sync de Chromium; éste, solo, nunca sube de lo
 * que dé la pantalla.
 *
 * No pide reinicio: el techo lo aplica el preload del juego en caliente.
 */
const FPS_CAP_OPTIONS = [
  { value: 0, label: 'Sin límite (recomendado)', labelEn: 'Unlimited (recommended)' },
  { value: 30, label: '30 FPS', labelEn: '30 FPS' },
  { value: 60, label: '60 FPS', labelEn: '60 FPS' },
  { value: 144, label: '144 FPS', labelEn: '144 FPS' },
  { value: 240, label: '240 FPS', labelEn: '240 FPS' }
];

function renderFpsCap() {
  const container = $('#perfFpsCap');
  if (!container) return;
  container.replaceChildren(selectRow({
    label: t('perf.fpsCap'),
    description: t('perf.fpsCapHelp'),
    hint: t('perf.fpsCapHint'),
    id: 'perf-fpscap',
    options: FPS_CAP_OPTIONS.map((opt) => [opt.value, (isEn() && opt.labelEn) || opt.label]),
    value: Number(state.config.perf.fpsCap) || 0,
    onChange: (value) => patchConfig({ perf: { fpsCap: Number(value) || 0 } })
  }));
}

function renderPerf() {
  renderGameSettings($('#gameVideo'), 'video');
  renderGameSettings($('#gameNet'), 'net');
  renderFpsCap();
  renderKeys();

  const groups = isEn() ? PERF_GROUPS_EN : PERF_GROUPS;
  for (const [id, items] of Object.entries(groups)) {
    buildSwitches(
      $(`#${id}`),
      items.map((item) => ({ ...item, value: () => state.config.perf[item.key] })),
      async (item, value) => {
        await patchConfig({ perf: { [item.key]: value } });
        if (item.restart) needsRestart();
        // Tocar un solo interruptor a mano deja de ser «Equilibrado» y pasa a
        // ser «Personalizado». Es lo que evita que un perfil se quede figurando
        // como dueño de algo que ya no puso él.
        renderPerfPresets();
      }
    );
  }
  renderPerfPresets();
}

/*
 * ═══ El aviso de reinicio ═══
 *
 * Los interruptores marcados con ↻ no hacen nada hasta que el cliente vuelve a
 * arrancar: son banderas de Chromium y se leen una sola vez, antes de que exista
 * la ventana. Avisarlo bien importa, porque si no la persona toca tres cosas,
 * no ve ningún cambio y da por hecho que el cliente está roto.
 *
 * El cartel vive fuera del panel, fijo arriba de la ventana, y no se va solo:
 * ni con un temporizador, ni al cerrar el panel, ni al cambiar de pestaña. Sale
 * únicamente si reiniciás o si lo descartás a mano — y si después tocás otro
 * interruptor de los que piden reinicio, vuelve.
 */
function needsRestart() {
  const bar = $('#restartNotice');
  if (!bar.hidden) return; // ya estaba: no reiniciar la animación de entrada
  bar.hidden = false;
}

/* ══════════════════════════════════════════════════════════
   Controles del juego
   ══════════════════════════════════════════════════════════
   HaxBall los guarda en `player_keys` como { códigoDeTecla: acción }. Varias
   teclas pueden apuntar a la misma acción, así que cada fila lista todas las
   suyas. Mientras la config del cliente esté vacía se muestran las que el juego
   tenga puestas; al primer cambio se guarda el mapa entero.
   ══════════════════════════════════════════════════════════ */
const ACTION_LABELS = {
  es: { Up: 'Arriba', Down: 'Abajo', Left: 'Izquierda', Right: 'Derecha', Kick: 'Patear', ToggleChat: 'Chat' },
  en: { Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right', Kick: 'Kick', ToggleChat: 'Chat' }
};

/** Nombres cortos para códigos que en crudo no se entienden. */
const KEY_NAMES = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Espacio', ControlLeft: 'Ctrl izq', ControlRight: 'Ctrl der',
  ShiftLeft: 'Shift izq', ShiftRight: 'Shift der',
  AltLeft: 'Alt izq', AltRight: 'Alt der', Enter: 'Enter', Tab: 'Tab'
};

function keyLabel(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  // "KeyW" → "W", "Digit4" → "4", "Numpad0" → "Num 0"
  const m = code.match(/^(Key|Digit|Numpad)(.+)$/);
  if (!m) return code;
  return m[1] === 'Numpad' ? `Num ${m[2]}` : m[2];
}

/** El mapa que se está mostrando: el del cliente si lo tocó, si no el del juego. */
function activeKeys() {
  const own = state.config.keys || {};
  return Object.keys(own).length ? own : (state.liveKeys || {});
}

let capturingFor = null;

/*
 * Con qué tecla se abre el resumen del partido.
 *
 * Está acá y no en «Aspecto» porque es lo mismo que el resto de esta tarjeta:
 * qué hace cada tecla. Y sobre todo porque es la respuesta a un reclamo
 * concreto — Tab es la tecla del chat de HaxBall, el cliente se la quedaba para
 * el resumen, y el que juega con el chat abierto se quedaba sin chat.
 *
 * Las opciones esquivan a propósito F8, F9 y F11, que ya tienen dueño en el
 * preload (overlay, amigos y pantalla completa).
 */
const SUMMARY_KEYS = [
  { value: 'Tab', label: 'Tab', note: { es: 'le saca el chat a HaxBall', en: 'takes chat away from HaxBall' } },
  { value: 'F1', label: 'F1', note: null },
  { value: 'F2', label: 'F2', note: null },
  { value: 'F4', label: 'F4', note: null },
  { value: '', label: null, note: null }
];

function renderSummaryKey() {
  const container = $('#summaryKeyField');
  if (!container) return;

  const current = state.config.general.summaryKey;
  const options = SUMMARY_KEYS.map((opt) => {
    const name = opt.label || t('keys.summaryNone');
    const note = opt.note && (isEn() ? opt.note.en : opt.note.es);
    return [opt.value, note ? `${name} — ${note}` : name];
  });
  // Una tecla que no está en la lista (config a mano) no se pierde: se agrega.
  if (typeof current === 'string' && current && !SUMMARY_KEYS.some((o) => o.value === current)) {
    options.push([current, current]);
  }

  container.replaceChildren(selectRow({
    label: t('keys.summary'),
    // El párrafo entero sobre Tab y el chat se fue al `ⓘ`: es la explicación
    // más larga que había en toda la pantalla y estaba puesta debajo de un
    // selector que la mayoría no toca nunca.
    hint: t('keys.summaryHelp'),
    id: 'summary-key',
    options,
    value: typeof current === 'string' ? current : 'Tab',
    onChange: async (value) => {
    await patchConfig({ general: { summaryKey: value } });

    /*
     * Sacar el resumen de Tab no alcanza para que vuelva el chat.
     *
     * El cliente le escribe a HaxBall su propio mapa de teclas, y ahí Tab no
     * está atado a nada: se lo sacó a propósito cuando el resumen se lo quedó
     * (ver `DEFAULT_KEYS` en `haxball-settings.js`). Sin esto, el que cambia la
     * opción esperando recuperar el chat se queda con una tecla que no hace
     * NADA, que es peor que el problema que vino a resolver.
     *
     * Sólo si el chat no tiene ya otra tecla puesta: al que se lo ató a otra
     * cosa no hay que pisárselo.
     */
    if (value !== 'Tab') {
      const keys = activeKeys();
      const hasChat = Object.keys(keys).some((code) => keys[code] === 'ToggleChat');
      if (!hasChat) {
        await bindKey('Tab', 'ToggleChat');
        toast(t('keys.summaryChatBack'), 'ok');
        return;
      }
    }
    renderSummaryKey();
    scheduleGameReload();
    }
  }));
}

function renderKeys() {
  const lang = isEn() ? 'en' : 'es';
  const keys = activeKeys();
  const list = $('#keyList');
  list.replaceChildren();
  renderSummaryKey();

  for (const action of state.schema.actions) {
    const row = document.createElement('div');
    row.className = 'keyrow';

    const name = document.createElement('strong');
    name.className = 'keyrow__name';
    name.textContent = ACTION_LABELS[lang][action] || action;

    const chips = document.createElement('div');
    chips.className = 'keyrow__chips';

    const bound = Object.keys(keys).filter((code) => keys[code] === action);
    for (const code of bound) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'keychip';
      chip.title = `${code} — ${t('keys.remove')}`;
      chip.textContent = keyLabel(code);
      // Dejar una acción sin ninguna tecla te deja sin poder moverte.
      chip.disabled = bound.length < 2;
      chip.addEventListener('click', () => unbindKey(code));
      chips.append(chip);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = `keyadd${capturingFor === action ? ' is-capturing' : ''}`;
    // El latido mientras espera una tecla es la única señal de que está
    // escuchando, así que sobrevive al interruptor de animaciones.
    if (capturingFor === action) add.dataset.keepMotion = '';
    add.textContent = capturingFor === action ? t('keys.press') : '+';
    add.addEventListener('click', () => startCapture(action));
    chips.append(add);

    row.append(name, chips);
    list.append(row);
  }
}

function startCapture(action) {
  capturingFor = capturingFor === action ? null : action;
  renderKeys();
}

/**
 * Mientras se espera una tecla, el resto de la app no la ve: si no, capturar
 * Espacio o una flecha además scrolleaba o activaba un botón.
 */
window.addEventListener('keydown', (e) => {
  if (!capturingFor) return;
  e.preventDefault();
  e.stopPropagation();

  const action = capturingFor;
  capturingFor = null;
  if (e.code === 'Escape') return renderKeys();
  bindKey(e.code, action);
}, true);

async function bindKey(code, action) {
  const next = { ...activeKeys(), [code]: action };
  await patchConfig({ keys: next });
  renderKeys();
  scheduleGameReload();
}

async function unbindKey(code) {
  const next = { ...activeKeys() };
  delete next[code];
  // `patchConfig` hace merge profundo, así que borrar una clave requiere
  // reemplazar el objeto entero: se manda con la marca de reemplazo.
  await patchConfig({ keys: { __replace: next } });
  renderKeys();
  scheduleGameReload();
}

$('#keysReset').addEventListener('click', async () => {
  await patchConfig({ keys: { __replace: {} } });
  renderKeys();
  scheduleGameReload();
  toast(t('keys.wasReset'), 'ok');
});

// Descartarlo es una decisión explícita: los cambios siguen sin aplicarse, pero
// ya se avisó y no tiene sentido seguir tapando la pantalla.
$('#dismissRestart').addEventListener('click', () => { $('#restartNotice').hidden = true; });

$('#restartNow').addEventListener('click', async () => {
  // Reiniciar cierra la conexión con la sala: si hay partido, se avisa.
  if (state.playing && !window.confirm(t('perf.restartConfirm'))) return;
  await guard(tvm.app.restart(), 'Error');
});

/* ══════════════════════════════════════════════════════════
   Aspecto
   ══════════════════════════════════════════════════════════ */
const ACCENTS = ['#7B3FE4', '#9B5CFF', '#5B2BC4', '#B14CFF', '#4F46E5', '#00C2A8', '#FF4D6D', '#F0A422'];

const AVATAR_PRESETS = ['⚽', '🔥', '⭐', '💀', '👑', '🐐', '🚀', '🧊', '⚡', '🍀', '🎯', '😎'];

/*
 * «Fondo animado» se fue: ya no hay ningún fondo que animar. Los blobs estaban
 * quietos desde antes y el aura de los temas VIP dejó de girar, así que el
 * interruptor prometía algo que no hacía.
 *
 * «Animaciones» se queda, pero ahora casi no hay diferencia entre encendido y
 * apagado: era el síntoma —apagarlo se sentía mucho más fluido— y lo que se
 * arregló fue la causa. Los indicadores de progreso no lo obedecen nunca (ver
 * `data-keep-motion` en theme.css).
 */
const LOOK_SWITCHES = {
  es: [
    { key: 'cleanMode', label: 'Sólo la cancha', description: 'Sin el menú ni los costados del sitio.' },
    { key: 'animations', label: 'Animaciones', description: 'Apagalo para que todo sea instantáneo.' },
    { key: 'goalBanner', label: 'Cartel de gol', description: 'El cartel estilo TV con autor y asistencia.', hint: 'El resumen del partido se sigue armando igual, esté puesto o no.' }
  ],
  en: [
    { key: 'cleanMode', label: 'Pitch only', description: "Hides HaxBall's site menu and side panels." },
    { key: 'animations', label: 'Animations', description: 'Turn it off to make everything instant.' },
    { key: 'goalBanner', label: 'Goal banner', description: 'The TV-style banner with scorer and assist.', hint: 'The match summary is still built the same, whether this is on or off.' }
  ]
};

const OVERLAY_SWITCHES = {
  es: [
    { key: 'enabled', label: 'Mostrar overlay', description: 'Panel flotante con tus datos en vivo.' },
    { key: 'showFps', label: 'FPS', description: null },
    { key: 'showPing', label: 'Ping', description: 'Se lee de la lista de jugadores.' },
    { key: 'showSession', label: 'Tiempo de sesión', description: null },
    { key: 'showClock', label: 'Reloj', description: null }
  ],
  en: [
    { key: 'enabled', label: 'Show overlay', description: 'Floating panel with your live data.' },
    { key: 'showFps', label: 'FPS', description: null },
    { key: 'showPing', label: 'Ping', description: 'Read from the player list.' },
    { key: 'showSession', label: 'Session time', description: null },
    { key: 'showClock', label: 'Clock', description: null }
  ]
};

/*
 * Lo que se dibuja sobre la cancha.
 *
 * Las descripciones dicen qué se ve, no cómo está hecho.
 */
const PITCH_SWITCHES = {
  es: [
    { key: 'selfRing', label: 'Marcar tu disco', description: 'Un aro de tu color sobre tu disco.', hint: 'En un 4v4 es lo que te ahorra tener que buscarte.' },
    { key: 'teamRings', label: 'Modo daltónico', description: 'Un aro por equipo, lleno o punteado.', hint: 'Se distinguen por la forma y no por el color, así que sirve con cualquier color que le ponga la sala.' },
    { key: 'goalFlash', label: 'Efecto de gol', description: 'Onda dorada, escudo y chispas con los colores del club.', hint: 'Dura poco más de un segundo y no tapa la cancha.' },
    { key: 'goalShake', label: 'Sacudón en el gol', description: 'La cancha pega un golpe.', hint: 'No mueve la cámara del juego ni te cambia lo que podés ver.' }
  ],
  en: [
    { key: 'selfRing', label: 'Mark your disc', description: 'A ring in your colour on your disc.', hint: 'In a 4v4 it saves you from hunting for yourself.' },
    { key: 'teamRings', label: 'Colourblind mode', description: 'One ring per team, solid or dashed.', hint: 'They are told apart by shape and not by colour, so it works with whatever colours the room picks.' },
    { key: 'goalFlash', label: 'Goal effect', description: 'Golden shockwave, crest and sparks in the club colours.', hint: 'It lasts just over a second and does not cover the pitch.' },
    { key: 'goalShake', label: 'Goal shake', description: 'The pitch takes a hit.', hint: 'It does not move the game camera or change what you can see.' }
  ]
};

/*
 * La estela abre esta lista y no la de arriba a propósito: en vivo se sacó
 * —tapaba justo la pelota que uno está mirando— y acá es de las cosas para las
 * que uno abre una grabación. Ver `replayTrail` en `store.js`.
 */
const PITCH_REPLAY_SWITCHES = {
  es: [
    { key: 'replayTrail', label: 'Estela de la pelota', description: 'La cola de por dónde ya pasó.', hint: 'No predice nada: es por dónde la pelota estuvo.' },
    { key: 'replayFullTrail', label: 'Estela completa', description: 'Todo el camino desde el saque.', hint: 'En vez de la cola de los últimos segundos.' },
    { key: 'replayLastTouch', label: 'Marcar quién la tocó', description: 'Un aro sobre el último que la tocó.' },
    { key: 'replayFreeCam', label: 'Cámara libre', description: 'Arrastrá para mover la vista.', hint: 'Doble clic la devuelve a la cámara del juego.' },
    { key: 'replayHeatmap', label: 'Mapa de calor sobre la cancha', description: 'Pinta la cancha con el recorrido de la pelota.', hint: 'Con la estela puesta las dos se mezclan. El mapa del partido que jugaste sale siempre en el resumen, sin tocar esto.' }
  ],
  en: [
    { key: 'replayTrail', label: 'Ball trail', description: 'The tail of where it already went.', hint: 'It predicts nothing: it is where the ball has been.' },
    { key: 'replayFullTrail', label: 'Full trail', description: 'The whole path since kickoff.', hint: 'Instead of the last few seconds of tail.' },
    { key: 'replayLastTouch', label: 'Mark the last touch', description: 'A ring on whoever touched it last.' },
    { key: 'replayFreeCam', label: 'Free camera', description: 'Drag to move the view.', hint: 'Double click puts it back on the game camera.' },
    { key: 'replayHeatmap', label: 'Heatmap over the pitch', description: 'Paints the pitch with the ball path.', hint: 'With the trail on, the two blend together. The map of a match you played always shows up in the summary, without touching this.' }
  ]
};

/**
 * Los dos interruptores propios del chat. Van juntos porque se dibujan en la
 * misma tarjeta, pero uno vive en `appearance` y el otro en `game`: por eso
 * cada uno declara en qué rama de la config se guarda.
 */
const CHAT_SWITCHES = {
  es: [
    {
      key: 'hideChat',
      scope: 'appearance',
      label: 'Ocultar el chat',
      description: 'Saca el chat de la pantalla.', hint: 'En la sala y en la partida. Se sigue jugando igual: sólo dejás de verlo y de poder escribir.'
    },
    {
      key: 'chatTimestamps',
      scope: 'game',
      label: 'Hora en el chat',
      description: 'Agrega la hora local delante de cada mensaje.'
    }
  ],
  en: [
    {
      key: 'hideChat',
      scope: 'appearance',
      label: 'Hide the chat',
      description: 'Takes the chat off screen.', hint: 'Both in the room and in the match. You still play the same: you just stop seeing it and typing.'
    },
    {
      key: 'chatTimestamps',
      scope: 'game',
      label: 'Chat timestamps',
      description: 'Adds the local time before each message.'
    }
  ]
};

const AVATAR_SWITCH = {
  es: { label: 'Avatar animado', description: 'Rota los cuadros mientras estás en una sala.', hint: 'Cada cambio manda un /avatar a la sala, así que muy rápido molesta a los demás.' },
  en: { label: 'Animated avatar', description: 'Rotates the frames while you are in a room.', hint: 'Each change sends an /avatar to the room, so too fast annoys everyone else.' }
};

const THEME_DARK_SWITCH = {
  es: { label: 'Tema oscuro', description: 'Apagalo si elegiste un fondo claro.' },
  en: { label: 'Dark theme', description: 'Turn it off on a light background.' }
};

function renderThemes() {
  const box = $('#themes');
  box.replaceChildren();

  for (const [id, meta] of Object.entries(state.schema.themes)) {
    /*
     * Los temas de dos acentos son del rol. `bloqueado` es «es VIP y vos no»:
     * la tarjeta se sigue viendo entera —la gracia es que se vea lo que te
     * estás perdiendo— pero apagada y con la chapita.
     */
    const bloqueado = false;
    const card = document.createElement('button');
    card.className = `themecard${state.config.appearance.theme === id ? ' is-on' : ''}`
      + (meta.vip ? ' is-vip' : '') + (bloqueado ? ' is-locked' : '');
    card.type = 'button';

    const preview = document.createElement('div');
    preview.className = 'themecard__preview';
    preview.style.background = `linear-gradient(160deg, ${meta.preview.panel}, ${meta.preview.bg})`;
    if (meta.preview.aura) {
      preview.classList.add('has-aura');
      preview.style.setProperty('--card-aura', `${meta.preview.aura.join(', ')}, ${meta.preview.aura[0]}`);
    }
    preview.style.setProperty('--sw-line', meta.preview.dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.16)');
    // Nunca `var(--accent)`: es el acento vivo y teñía la vista previa de los
    // otros temas al cambiar de tema. `preview.accent` ya viene resuelto y fijo.
    preview.style.setProperty('--sw-accent', meta.preview.accent2
      ? `linear-gradient(120deg, ${meta.preview.accent}, ${meta.preview.accent2})`
      : meta.preview.accent);
    for (let i = 0; i < 3; i++) {
      const bar = document.createElement('div');
      bar.className = 'themecard__bar';
      preview.append(bar);
    }
    const btn = document.createElement('div');
    btn.className = 'themecard__btn';
    preview.append(btn);

    const name = document.createElement('strong');
    name.textContent = meta.label;
    const desc = document.createElement('small');
    desc.textContent = meta.description;

    card.append(preview, name, desc);


    // Sólo los VIP pueden tener temas personalizados: el lápiz de edición
    // aparece únicamente si sos VIP y el tema es custom.
    if (meta.custom) {
      const edit = document.createElement('span');
      edit.className = 'themecard__edit';
      edit.textContent = '✎';
      edit.title = t('look.customEdit');
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        openThemeEditor(id);
      });
      card.append(edit);
    }

    card.addEventListener('click', async () => {
      /*
       * Sin el rol se avisa acá y no se manda nada. `cfg:set` lo rechaza igual
       * —esa es la guarda de verdad—, pero devolver un error genérico por algo
       * que la tarjeta ya muestra con candado se lee como si la app se hubiera
       * roto. Esto dice qué pasa.
       */
      await patchConfig({ appearance: { theme: id } });
      await refreshThemeVars();
      renderThemes();
      toast(t('toast.themeApplied', { name: meta.label }), 'ok');
    });
    box.append(card);
  }
}

function renderAspect() {
  const lang = isEn() ? 'en' : 'es';

  renderThemes();

  // Crear temas propios es un beneficio VIP: el botón se muestra sólo si tenés
  // el rol, y se oculta si no.
  $('#themeCreate').hidden = false;

  const swatches = $('#swatches');
  swatches.replaceChildren();
  for (const color of ACCENTS) {
    const dot = document.createElement('button');
    dot.className = `swatch${color.toLowerCase() === state.config.appearance.accent.toLowerCase() ? ' is-on' : ''}`;
    dot.type = 'button';
    dot.title = color;
    dot.style.background = `linear-gradient(140deg, ${color}, ${mixHex(color, '#120a26', 0.45)})`;
    dot.addEventListener('click', async () => {
      await patchConfig({ appearance: { accent: color } });
      await refreshThemeVars();
      renderAspect();
    });
    swatches.append(dot);
  }
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.className = 'colorinput';
  picker.value = state.config.appearance.accent;
  picker.addEventListener('input', (e) => document.documentElement.style.setProperty('--accent', e.target.value));
  picker.addEventListener('change', async (e) => {
    await patchConfig({ appearance: { accent: e.target.value } });
    await refreshThemeVars();
    renderAspect();
  });
  swatches.append(picker);

  buildSwitches(
    $('#lookSwitches'),
    LOOK_SWITCHES[lang].map((i) => ({ ...i, value: () => state.config.appearance[i.key] })),
    (item, value) => patchConfig({ appearance: { [item.key]: value } })
  );

  renderAvatar();

  renderGameSettings($('#gameChat'), 'chat');
  const extra = document.createElement('div');
  buildSwitches(
    extra,
    CHAT_SWITCHES[lang].map((i) => ({ ...i, value: () => !!state.config[i.scope][i.key] })),
    (item, value) => patchConfig({ [item.scope]: { [item.key]: value } })
  );
  $('#gameChat').append(extra);

  buildSwitches(
    $('#overlaySwitches'),
    OVERLAY_SWITCHES[lang].map((i) => ({ ...i, value: () => state.config.overlay[i.key] })),
    (item, value) => patchConfig({ overlay: { [item.key]: value } })
  );

  $('#overlayPos').value = state.config.overlay.position;
  $('#overlayOpacity').value = state.config.overlay.opacity;
  $('#overlayOpacityValue').textContent = `${Math.round(state.config.overlay.opacity * 100)}%`;
  syncRangeFill($('#overlayOpacity'));

  $('#hudScale').value = state.config.appearance.hudScale;
  $('#hudScaleValue').textContent = `${Math.round(state.config.appearance.hudScale * 100)}%`;
  syncRangeFill($('#hudScale'));

  renderPitch();
  // El cartel de música NO cuelga de `renderVip` como el de teclas: escuchar
  // música no es un beneficio de rol.
  renderMusicHud();
}

/* ── Color de la cancha ─────────────────────────────────────────── *
 *
 * Los presets no son una paleta de colores lindos: son canchas. Cada uno sale
 * de algo que se reconoce —el césped de siempre, una cancha de noche, el piso
 * de un futsal— porque «verde 2E7D5B» no le dice nada a nadie y «Nocturna» sí.
 */
const PITCH_SKINS = [
  { id: 'grass', label: 'Césped', labelEn: 'Grass', color: '#2e7d5b', outside: '', strength: 0.8, brightness: 0, stripes: 10 },
  { id: 'night', label: 'Nocturna', labelEn: 'Night', color: '#1c3d63', outside: '#0a0f17', strength: 0.85, brightness: -0.28, stripes: 0 },
  { id: 'clay', label: 'Polvo de ladrillo', labelEn: 'Clay', color: '#a4553a', outside: '', strength: 0.8, brightness: -0.05, stripes: 0 },
  { id: 'futsal', label: 'Futsal', labelEn: 'Futsal', color: '#2f6f8f', outside: '#243447', strength: 0.9, brightness: 0.05, stripes: 0 },
  { id: 'ice', label: 'Hielo', labelEn: 'Ice', color: '#7fb3d5', outside: '', strength: 0.7, brightness: 0.18, stripes: 0 },
  { id: 'carbon', label: 'Carbón', labelEn: 'Carbon', color: '#3b3f46', outside: '#111316', strength: 0.9, brightness: -0.3, stripes: 14 }
];

function skinCfg() {
  return (state.config.pitch && state.config.pitch.skin) || {};
}

/*
 * El color de la cancha.
 *
 * La explicación larga —que no tapa las líneas, que lo claro sigue siendo
 * claro, que no da ventaja— está en el `ⓘ` del título de la sección, en el
 * HTML. Acá abajo cada control dice lo suyo en media línea.
 */
function renderPitchSkin() {
  const box = $('#pitchSkin');
  if (!box) return;
  box.replaceChildren();

  const skin = skinCfg();
  const en = isEn();

  /* ── Qué manda ──────────────────────────────────────────────────── */
  const mode = ['off', 'theme', 'custom'].includes(skin.mode) ? skin.mode : 'off';
  box.append(selectRow({
    label: en ? 'Pitch colour' : 'Color de la cancha',
    id: 'pitch-skin-mode',
    options: [
      ['off', en ? 'Stock HaxBall' : 'Como viene HaxBall'],
      ['theme', en ? 'Follow the client theme' : 'Seguir el tema del cliente'],
      ['custom', en ? 'My own colour' : 'Color propio']
    ],
    value: mode,
    onChange: async (value) => {
      await patchConfig({ pitch: { skin: { mode: value } } });
      renderPitchSkin();
    }
  }));

  // Con el color de fábrica no hay nada más que decidir: los controles de abajo
  // estarían ahí para no hacer nada.
  if (mode === 'off') return;

  /* ── Los presets y el color, sólo con «color propio» ────────────── */
  if (mode === 'custom') {
    const presets = document.createElement('div');
    presets.className = 'swatches';
    for (const preset of PITCH_SKINS) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `swatch${sameSkin(preset, skin) ? ' is-on' : ''}`;
      dot.title = (en && preset.labelEn) || preset.label;
      dot.style.background = `linear-gradient(140deg, ${preset.color}, ${mixHex(preset.color, '#0b0d10', 0.5)})`;
      dot.addEventListener('click', async () => {
        await patchConfig({
          pitch: {
            skin: {
              color: preset.color,
              outside: preset.outside,
              strength: preset.strength,
              brightness: preset.brightness,
              stripes: preset.stripes
            }
          }
        });
        renderPitchSkin();
      });
      presets.append(dot);
    }
    box.append(settingRow({
      label: en ? 'Ready-made pitches' : 'Canchas listas',
      control: presets,
      block: true
    }));

    /* ── Los dos colores ─────────────────────────────────────────────
       El campo y el borde van juntos y en la misma fila porque se eligen
       mirando uno contra el otro: lo que importa no es cada color sino el
       contraste entre los dos. */
    const colores = [
      skinColorPicker(en ? 'Field' : 'Campo', skin.color || '#2e7d5b', (value) => ({ color: value })),
      /*
       * El borde arranca en el color del campo y no en negro: así el primer
       * clic abre el selector donde uno está y no en un color que nadie eligió.
       */
      skinColorPicker(
        en ? 'Surround' : 'Borde',
        skin.outside || skin.color || '#2e7d5b',
        (value) => ({ outside: value })
      )
    ];

    // Volver a «el mismo que el campo», que es el valor de fábrica y que un
    // selector de color no puede expresar: siempre devuelve un color.
    if (skin.outside) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'btn btn--ghost btn--sm';
      reset.textContent = en ? 'Match the field' : 'Igual al campo';
      reset.addEventListener('click', async () => {
        await patchConfig({ pitch: { skin: { outside: '' } } });
        renderPitchSkin();
      });
      colores.push(reset);
    }

    box.append(settingRow({
      label: en ? 'Field and surround' : 'Campo y borde',
      control: colores
    }));
  }

  /* ── Cuánto ─────────────────────────────────────────────────────── */
  box.append(skinRange({
    id: 'pitch-skin-strength',
    label: en ? 'Strength' : 'Intensidad',
    min: 20,
    max: 100,
    step: 1,
    value: Math.round(numOr(skin.strength, 0.8) * 100),
    format: (v) => `${v}%`,
    hint: en
      ? 'How much of the new colour goes in. Lower keeps more of the original pitch.'
      : 'Cuánto entra del color nuevo. Más abajo, más se parece a la cancha de siempre.',
    onChange: (v) => patchConfig({ pitch: { skin: { strength: v / 100 } } })
  }));

  box.append(skinRange({
    id: 'pitch-skin-brightness',
    label: en ? 'Light' : 'Luz',
    min: -60,
    max: 60,
    step: 1,
    value: Math.round(numOr(skin.brightness, 0) * 100),
    format: (v) => (v === 0 ? (en ? 'as is' : 'como está') : `${v > 0 ? '+' : ''}${v}%`),
    hint: en
      ? 'Darkens or lifts the whole pitch. The lines keep their contrast either way.'
      : 'Oscurece o levanta toda la cancha. Las líneas mantienen su contraste igual.',
    onChange: (v) => patchConfig({ pitch: { skin: { brightness: v / 100 } } })
  }));

  box.append(skinRange({
    id: 'pitch-skin-stripes',
    label: en ? 'Mown stripes' : 'Franjas de césped',
    min: 0,
    max: 24,
    step: 1,
    value: Math.round(numOr(skin.stripes, 0)),
    format: (v) => (v === 0 ? (en ? 'off' : 'sin franjas') : String(v)),
    hint: en
      ? 'Bands across the field, like a freshly mown pitch. They stay put in the world, not on your screen, and never spill outside the field.'
      : 'Franjas a lo ancho del campo, como una cancha recién cortada. Se quedan quietas sobre el campo aunque muevas la cámara, y no se salen del borde.',
    onChange: (v) => patchConfig({ pitch: { skin: { stripes: v } } })
  }));
}

/** Un cuadradito de color con su nombre al lado. */
function skinColorPicker(label, value, toPatch) {
  const wrap = document.createElement('label');
  wrap.className = 'skincolor';

  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'colorinput';
  input.value = value;
  input.addEventListener('change', async (e) => {
    await patchConfig({ pitch: { skin: toPatch(e.target.value) } });
    renderPitchSkin();
  });

  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(input, text);
  return wrap;
}

/** ¿Este preset es exactamente lo que hay puesto? */
function sameSkin(preset, skin) {
  return (skin.color || '').toLowerCase() === preset.color
    && (skin.outside || '').toLowerCase() === preset.outside
    && numOr(skin.strength, 0.8) === preset.strength
    && numOr(skin.brightness, 0) === preset.brightness
    && numOr(skin.stripes, 0) === preset.stripes;
}

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Una barra de la cancha.
 *
 * Se guarda al soltar (`change`) y no mientras se arrastra: cada `input`
 * escribiría el config.json y tiraría el cache del estadio, o sea repintar la
 * cancha entera en cada píxel del arrastre. Por eso pasa `onChange` y no
 * `onInput` a `rangeRow`.
 */
function skinRange({ id, label, min, max, step, value, format, hint, onChange }) {
  return rangeRow({ id, label, hint, min, max, step, value, format, onChange });
}

/* ── Ayudas sobre la cancha ─────────────────────────────────────── */
/*
 * El selector del modo espejo.
 *
 * Es un select y no un interruptor porque son tres estados y el del medio no
 * existe: «espejado» sin decir de qué lado no quiere decir nada. Las opciones
 * se nombran por el lado que vas a VER —«Verme siempre del lado rojo»— y no por
 * el equipo, que es la confusión que tiene la función: lo que se elige no es un
 * equipo, es un lugar de la pantalla.
 */
function renderPitchMirror() {
  const box = $('#pitchMirror');
  if (!box) return;
  box.replaceChildren();

  const en = isEn();
  const actual = (state.config.pitch || {}).mirror;
  const value = ['off', 'red', 'blue'].includes(actual) ? actual : 'off';

  box.append(selectRow({
    label: en ? 'Always play on' : 'Verme siempre en',
    // La explicación de cómo se dan vuelta las teclas está en el `ⓘ` y no en
    // la fila: es el párrafo más largo de la página y explica cómo funciona,
    // no qué elegir.
    hint: en
      ? 'You pick a side and always see yourself on it. When you get the other team, the whole pitch flips and you are back where you are used to. Left and right swap with the view, so you still steer with the pitch. Only your screen changes: everyone else sees the match exactly as always.'
      : 'Elegís un lado y te ves siempre de ese lado. Cuando te toca el equipo de enfrente, la cancha se da vuelta entera y volvés a estar donde estás acostumbrado. Izquierda y derecha se cambian junto con la vista, así que seguís manejando con la cancha. Lo único que cambia es tu pantalla; el resto ve el partido igual que siempre.',
    id: 'pitch-mirror',
    options: [
      ['off', en ? 'Whatever side I get' : 'El lado que me toque'],
      ['red', en ? 'The red side (left)' : 'El lado rojo (izquierda)'],
      ['blue', en ? 'The blue side (right)' : 'El lado azul (derecha)']
    ],
    value,
    onChange: async (elegido) => {
      await patchConfig({ pitch: { mirror: elegido } });
      renderPitchMirror();
    }
  }));

  /*
   * El aviso de que se cambian las teclas sale sólo con el modo puesto.
   * Apagado no hay nada que advertir, y una nota permanente sobre algo que no
   * está pasando es ruido.
   */
  if (value !== 'off') {
    box.append(noteRow(en
      ? 'Left and right swap along with the view, so you steer with the pitch and not against it.'
      : 'Izquierda y derecha se cambian junto con la vista: seguís manejando con la cancha y no contra ella.'));
  }
}

function renderPitch() {
  const lang = isEn() ? 'en' : 'es';
  renderPitchSkin();
  renderPitchMirror();

  /*
   * El valor se lee de `state.config` en cada consulta y NO de una copia
   * tomada acá: `patchConfig` reemplaza el objeto entero, así que un
   * `pitch` capturado quedaría viejo y el interruptor volvería solo a su
   * posición anterior apenas lo tocás.
   */
  const live = (key) => !!(state.config.pitch || {})[key];

  buildSwitches(
    $('#pitchSwitches'),
    PITCH_SWITCHES[lang].map((i) => ({ ...i, value: () => live(i.key) })),
    (item, value) => patchConfig({ pitch: { [item.key]: value } })
  );

  buildSwitches(
    $('#pitchReplaySwitches'),
    PITCH_REPLAY_SWITCHES[lang].map((i) => ({ ...i, value: () => live(i.key) })),
    async (item, value) => {
      await patchConfig({ pitch: { [item.key]: value } });
      if (item.key === 'replayTrail' || item.key === 'replayFullTrail') syncTrailField();
    }
  );

  const ms = Number((state.config.pitch || {}).trailMs) || 320;
  $('#pitchTrailMs').value = ms;
  $('#pitchTrailMsValue').textContent = `${ms} ms`;
  syncRangeFill($('#pitchTrailMs'));
  syncTrailField();
}

/**
 * El largo sólo importa si hay una cola que medir: sin estela no hace nada, y
 * con la estela COMPLETA tampoco —esa va desde el saque, no tiene largo—.
 */
function syncTrailField() {
  const pitch = state.config.pitch || {};
  $('#pitchTrailField').hidden = !pitch.replayTrail || !!pitch.replayFullTrail;
}

$('#pitchTrailMs').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#pitchTrailMsValue').textContent = `${Number(e.target.value)} ms`;
});
$('#pitchTrailMs').addEventListener('change', (e) => patchConfig({ pitch: { trailMs: Number(e.target.value) } }));

$('#overlayPos').addEventListener('change', (e) => patchConfig({ overlay: { position: e.target.value } }));
$('#overlayOpacity').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#overlayOpacityValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#overlayOpacity').addEventListener('change', (e) => patchConfig({ overlay: { opacity: Number(e.target.value) } }));

$('#hudScale').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#hudScaleValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#hudScale').addEventListener('change', (e) => patchConfig({ appearance: { hudScale: Number(e.target.value) } }));

/* ── Avatar ─────────────────────────────────────────────── */
function avatarFrames(text) {
  const value = String(text || '').trim();
  if (!value) return [];
  try {
    const segmenter = new Intl.Segmenter('es', { granularity: 'grapheme' });
    return [...segmenter.segment(value)].map((s) => s.segment).filter((c) => c.trim());
  } catch {
    return [...value].filter((c) => c.trim());
  }
}

function renderAvatar() {
  const lang = isEn() ? 'en' : 'es';
  const avatar = state.config.avatar || {};

  $('#avatarStatic').value = avatar.static || '';
  // El placeholder deja ver el avatar que trae HaxBall aunque el campo del
  // cliente esté vacío: se entiende que hay uno puesto y de dónde salió.
  $('#avatarStatic').placeholder = state.liveAvatar || '⚽';
  $('#avatarFrames').value = avatar.frames || '';
  $('#avatarSpeed').value = avatar.intervalMs || 700;
  $('#avatarSpeedValue').textContent = `${avatar.intervalMs || 700} ms`;
  syncRangeFill($('#avatarSpeed'));
  paintAvatarPreview();

  const presets = $('#avatarPresets');
  presets.replaceChildren();
  for (const emoji of AVATAR_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emojibtn';
    button.textContent = emoji;
    button.addEventListener('click', () => setStaticAvatar(emoji));
    presets.append(button);
  }

  buildSwitches($('#avatarSwitch'), [{
    ...AVATAR_SWITCH[lang],
    key: 'animated',
    value: () => !!state.config.avatar.animated
  }], async (item, value) => {
    await patchConfig({ avatar: { animated: value } });
    syncAvatarFields();
  });

  renderAvatarImage();
  renderBallImage();
  syncAvatarFields();
}

/**
 * La imagen sobre el disco.
 *
 * Vivía adentro de la tarjeta VIP y ahora es de todos: la dibuja tu propia
 * máquina sobre tu propio disco y no sale de tu pantalla, así que no hay nada
 * que destrabar. Lo que sigue siendo del rol es que se MUEVA — un GIF sin rol
 * se ve como en cualquier lado sin animación: su primer cuadro, quieto.
 */
function renderAvatarImage() {
  const file = (state.config.vip || {}).avatarImage || '';
  const face = $('#vipAvatarPreview');
  face.replaceChildren();
  if (file) {
    const img = document.createElement('img');
    img.src = fileUrl(file);
    face.append(img);
  } else {
    face.textContent = '—';
  }

  /*
   * La línea de abajo aparece sólo cuando hay algo que decir.
   *
   * Antes acá vivía una descripción fija de tres renglones que estaba siempre,
   * dijera algo o no. Lo único que de verdad hay que avisar es cuando la imagen
   * NO se va a ver: sin un avatar de texto puesto el cliente no tiene con qué
   * reconocer cuál disco es el tuyo, y la imagen no se dibuja nunca.
   */
  const nota = $('#avatarImageNote');
  const avatar = state.config.avatar || {};
  const sinMarca = !avatar.static && !state.liveAvatar
    && !(avatar.animated && avatarFrames(avatar.frames).length);
  const esGif = /\.gif$/i.test(file);

  const aviso = !file ? ''
    : sinMarca ? t('avatar.imageNeedsText')
      : esGif ? t('avatar.gifOn')
        : '';

  nota.hidden = !aviso;
  nota.textContent = aviso;
  nota.classList.toggle('note--warn', !!aviso && sinMarca);
}

/**
 * La imagen de la pelota.
 *
 * Más simple que la del avatar: la pelota no necesita ninguna «marca» para que
 * el cliente sepa cuál es —es una sola y el parche del bundle la señala—, así
 * que lo único que hay para avisar es lo del GIF y el rol.
 */
function renderBallImage() {
  buildSwitches($('#ball3dSwitch'), [
    { key: 'ball3d', label: t('ball.3d'), description: t('ball.3dHelp'), value: () => !!state.config.pitch.ball3d },
    { key: 'netRipple', label: t('net.ripple'), description: t('net.rippleHelp'), value: () => !!state.config.pitch.netRipple }
  ], (item, value) => patchConfig({ pitch: { [item.key]: value } }));
  const file = (state.config.vip || {}).ballImage || '';
  const face = $('#vipBallPreview');
  face.replaceChildren();
  if (file) {
    const img = document.createElement('img');
    img.src = fileUrl(file);
    face.append(img);
  } else {
    face.textContent = '—';
  }

  const nota = $('#ballImageNote');
  const esGif = /\.gif$/i.test(file);
  const aviso = !file ? ''
    : esGif ? t('ball.gifOn')
      : t('ball.onlyYou');

  nota.hidden = !aviso;
  nota.textContent = aviso;
  nota.classList.toggle('note--warn', false);
}

function syncAvatarFields() {
  const on = !!state.config.avatar.animated;
  $('#avatarFramesField').hidden = !on;
  $('#avatarSpeedField').hidden = !on;
}

function paintAvatarPreview() {
  const avatar = state.config.avatar || {};
  // Si el cliente todavía no tiene avatar propio se muestra el que HaxBall ya
  // tenía guardado, que es el que el jugador ve en la cancha ahora mismo.
  const face = avatar.animated
    ? (avatarFrames(avatar.frames)[0] || '')
    : (avatar.static || state.liveAvatar || '');
  const box = $('#avatarPreview');
  box.textContent = face || t('avatar.none');
  box.classList.toggle('is-empty', !face);
}

/**
 * HaxBall recorta el avatar a dos unidades UTF-16, no a dos caracteres: 🔥 ya
 * ocupa las dos. Se agregan símbolos enteros mientras entren, para que nunca
 * viaje medio emoji.
 */
function clampAvatar(text) {
  const max = state.schema.avatarMax;
  const value = String(text || '').trim();
  if (value.length <= max) return value;

  let out = '';
  for (const glyph of avatarFrames(value)) {
    if (out.length + glyph.length > max) break;
    out += glyph;
  }
  return out;
}

async function setStaticAvatar(value) {
  const face = clampAvatar(value);
  // Una bandera o un emoji de familia ocupan cuatro unidades o más: no entran
  // en el presupuesto de HaxBall y se caen enteros. Mejor decirlo.
  if (value && !face) {
    toast(t('avatar.tooBig'), 'err');
    $('#avatarStatic').value = state.config.avatar.static || '';
    return;
  }
  $('#avatarStatic').value = face;
  await patchConfig({ avatar: { static: face } });
  paintAvatarPreview();
  // El avatar fijo se puede cambiar en caliente con /avatar: no hace falta
  // recargar el juego ni esperar a la próxima sesión.
  tvm.avatar.preview();
}

$('#avatarStatic').addEventListener('change', (e) => setStaticAvatar(e.target.value));

$('#avatarFrames').addEventListener('change', async (e) => {
  const frames = e.target.value.trim().slice(0, 40);
  if (frames && avatarFrames(frames).length < 2) {
    toast(t('avatar.needTwo'), 'err');
    return;
  }
  await patchConfig({ avatar: { frames } });
  paintAvatarPreview();
});

$('#avatarSpeed').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#avatarSpeedValue').textContent = `${e.target.value} ms`;
});
$('#avatarSpeed').addEventListener('change', (e) => patchConfig({ avatar: { intervalMs: Number(e.target.value) } }));

/* ══════════════════════════════════════════════════════════
   VIP
   ══════════════════════════════════════════════════════════
   Los beneficios de esta instalación están habilitados sin iniciar sesión.
   ══════════════════════════════════════════════════════════ */
function vipProfile() {
  return (state.config.vip && state.config.vip.discord) || null;
}

function isVip() {
  return true;
}

/**
 * Cuánto te queda de VIP, en días.
 *
 * Sale de `vipUntil`, que es lo que el panel sabe de tu suscripción, y NUNCA de
 * `expiresAt`: ése es el vencimiento del token firmado —cuánto se cree la app
 * este veredicto sin volver a preguntar— y dura horas o un par de días. Con
 * `expiresAt` el cartel diría «te quedan 7 días» a todo el mundo, para siempre,
 * y encima se reiniciaría solo en cada comprobación.
 *
 * `Infinity` es un VIP que no vence, que es lo que significa `vipUntil: null` en
 * el contrato del panel (ver el README) y lo que devuelve hoy para las cuentas
 * con el rol permanente. Ojo con esto si algún día se venden meses: un panel que
 * no complete la fecha va a hacer que TODOS se lean como permanentes.
 *
 * @returns {number|null} días enteros hacia arriba, `Infinity` si no vence, o
 *                        `null` si no hay rol o la fecha ya pasó.
 */
function vipDaysLeft(profile) {
  if (!profile || !profile.vip) return null;
  // Sin fecha —o con una ilegible— no hay cuenta regresiva que hacer.
  const hasta = profile.vipUntil ? Date.parse(profile.vipUntil) : NaN;
  if (!Number.isFinite(hasta)) return Infinity;

  const faltan = hasta - Date.now();
  if (faltan <= 0) return null;
  // Por días enteros y hacia arriba: al que le quedan 30 horas le quedan dos
  // días, no uno. Redondear para abajo le regala un día de menos al que paga.
  return Math.ceil(faltan / 86400000);
}

/** La frase entera, para la tarjeta de VIP en Aspecto. */
function vipRemaining(profile) {
  const dias = vipDaysLeft(profile);
  if (dias === null) return null;
  if (dias === Infinity) return t('vip.noExpiry');

  // Sin la hora: `formatDate` la incluye, y en una fecha a dos semanas los
  // minutos no le dicen nada a nadie.
  const dia = new Date(Date.parse(profile.vipUntil)).toLocaleDateString(isEn() ? 'en-GB' : 'es-AR',
    { day: '2-digit', month: 'short', year: 'numeric' });
  return dias === 1 ? t('vip.lastDay', { when: dia }) : t('vip.daysLeft', { days: dias, when: dia });
}

/**
 * La versión corta, para la fila del menú de la barra: ahí al lado del chip VIP
 * y del «activo» no entra una oración con fecha.
 */
function vipRemainingShort(profile) {
  const dias = vipDaysLeft(profile);
  if (dias === null) return null;
  if (dias === Infinity) return t('me.vipForever');
  return dias === 1 ? t('me.vipLastDay') : t('me.vipDays', { days: dias });
}

function renderVip() {
  renderVipAssets();
}

/* ── Cómo te ven los demás ──────────────────────────────────────────────────
 *
 * Es el único cosmético VIP que no dibuja tu máquina: viaja en el latido de
 * presencia y lo pinta el cliente de la otra persona sobre tu fila de la lista
 * de jugadores (ver `panel.js` y `paintPeers` en `game-preload.js`). El sitio
 * lo limpia antes de repartirlo, así que acá alcanza con guardarlo. */

const LOOK_FONTS = {
  outfit: 'Outfit, system-ui, sans-serif',
  mono: 'ui-monospace, Consolas, monospace',
  serif: 'Georgia, "Times New Roman", serif',
  round: '"Comic Sans MS", "Segoe UI", sans-serif',
  impact: 'Impact, "Arial Black", sans-serif'
};

/**
 * Los degradados que se pueden elegir. Tienen que ser los MISMOS ids que en
 * `game-preload.js` (el que los dibuja en la sala) y en `client.routes.js` del
 * sitio (el que los valida). Lo que viaja por la red es el id, nunca el CSS.
 */
const LOOK_GRADIENTS = {
  violeta:    { label: 'Violeta',    a: '#a78bfa', b: '#7c3aed', text: '#ddd0ff' },
  oceano:     { label: 'Océano',     a: '#7dd3fc', b: '#0ea5e9', text: '#cdeeff' },
  esmeralda:  { label: 'Esmeralda',  a: '#6ee7b7', b: '#10b981', text: '#ccf5e4' },
  fuego:      { label: 'Fuego',      a: '#fdba74', b: '#f97316', text: '#ffe0c4' },
  rubi:       { label: 'Rubí',       a: '#fda4af', b: '#f43f5e', text: '#ffd7dc' },
  rosa:       { label: 'Rosa',       a: '#f9a8d4', b: '#ec4899', text: '#ffd9ed' },
  oro:        { label: 'Oro',        a: '#fde68a', b: '#f59e0b', text: '#ffeeb8' },
  medianoche: { label: 'Medianoche', a: '#94a3b8', b: '#475569', text: '#dbe3ec' }
};

/** '#rrggbb' → 'rgba(r, g, b, alpha)'. */
function rgbaOf(hex, alpha) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * La fila de un VIP, igual que la dibuja el juego.
 *
 * Es la MISMA receta que `peerLook` en `room-ui.js` (con la lista oscura de
 * HaxBall, que es sobre la que se la ve), y tiene que seguir siéndolo: esta
 * muestra existe para enseñar lo que va a ver el de al lado, así que si las dos
 * se separan, miente.
 */
function auraOf(look) {
  return {
    '--tvm-vip-bg': `linear-gradient(90deg, ${rgbaOf(look.a, 0.26)} 0%, ${rgbaOf(look.b, 0.12)} 42%, ${rgbaOf(look.b, 0)} 78%)`,
    '--tvm-vip-bg-hi': `linear-gradient(90deg, ${rgbaOf(look.a, 0.38)} 0%, ${rgbaOf(look.b, 0.2)} 50%, ${rgbaOf(look.b, 0.04)} 92%)`,
    '--tvm-vip-edge': `inset 3px 0 0 ${look.b}, inset 0 0 0 1px ${rgbaOf(look.a, 0.22)}`,
    '--tvm-vip-name': `linear-gradient(90deg, ${look.text}, ${look.a})`
  };
}

/** El cuadradito del selector: ahí sí va el color macizo, es la identidad. */
function swatchOf(look) {
  return `linear-gradient(135deg, ${look.a}, ${look.b})`;
}

function looksOf() {
  return (state.config.vip && state.config.vip.cosmetics) || {};
}

/*
 * Los mismos controles viven en dos lugares —Ajustes y el perfil— y son el MISMO
 * cosmético: los dos escriben en `config.vip.cosmetics`. Por eso el pintado es
 * uno solo y lo que cambia son los elementos; duplicarlo sería garantizar que
 * algún día uno de los dos quede viejo.
 */
const VIP_LOOK_IDS = {
  demo: '#vipLookPreview', name: '#vipLookName',
  font: '#vipLookFont', gradients: '#vipGradients'
};
const PROFILE_LOOK_IDS = {
  demo: '#profileLookPreview', name: '#profileLookName',
  font: '#profileLookFont', gradients: '#profileGradients'
};

/**
 * @param {object} ids    qué elementos pintar (ver arriba)
 * @param {object} looks  `{ gradient, font }`
 * @param {{editable:boolean, name:string}} opts  sin `editable` la muestra se
 *        dibuja igual pero no se toca el selector ni los degradados: es el
 *        cosmético de otra persona.
 */
function paintLooks(ids, looks, { editable = true, name } = {}) {
  // La muestra es la fila del juego, con el degradado a lo ancho: es
  // exactamente lo que va a ver el de al lado.
  const look = LOOK_GRADIENTS[looks.gradient];
  const aura = look ? auraOf(look) : null;
  const demo = $(ids.demo);
  for (const key of ['--tvm-vip-bg', '--tvm-vip-bg-hi', '--tvm-vip-edge', '--tvm-vip-name']) {
    if (aura) demo.style.setProperty(key, aura[key]);
    else demo.style.removeProperty(key);
  }
  demo.style.color = look ? look.text : '';
  demo.classList.toggle('is-on', !!look);
  $(ids.name).textContent = name;
  $(ids.name).style.fontFamily = LOOK_FONTS[looks.font] || '';

  if (!editable) return;
  $(ids.font).value = looks.font || 'default';
  $(ids.gradients).replaceChildren(...Object.entries(LOOK_GRADIENTS).map(([id, item]) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'gradients__item';
    swatch.style.backgroundImage = swatchOf(item);
    swatch.title = item.label;
    swatch.setAttribute('aria-label', item.label);
    swatch.setAttribute('aria-pressed', String(looks.gradient === id));
    swatch.classList.toggle('is-on', looks.gradient === id);
    swatch.addEventListener('click', () => saveLooks({ gradient: looks.gradient === id ? '' : id }));
    return swatch;
  }));
}

function renderVipLooks() {
  paintLooks(VIP_LOOK_IDS, looksOf(), {
    name: (state.config.general.nickname || '').trim() || t('vip.looksYou')
  });
}

/**
 * Guarda el cosmético y REPINTA.
 *
 * El repintado no es opcional y faltaba: `patchConfig` guarda y llama a
 * `applyConfig`, que sólo toca el idioma y las animaciones — no sabe nada de los
 * degradados. Así que al clickear un degradado la elección se guardaba bien y
 * viajaba a la sala, pero acá no se movía nada: ni el recuadro marcado ni la
 * muestra de la fila. Parecía que el botón no hacía nada, y sólo se veía el
 * cambio al volver a entrar a la pestaña.
 *
 * Se espera al guardado antes de repintar porque `renderVipLooks` lee de
 * `state.config`, y quien lo actualiza es `applyConfig` con la respuesta del
 * proceso principal: repintar antes dibujaría el estado viejo.
 */
async function saveLooks(patch) {
  const next = await patchConfig({ vip: { cosmetics: { ...looksOf(), ...patch } } });
  if (!next) return;
  renderVipLooks();
  // El mismo cosmético se elige desde el perfil: si está abierto, se mueve ahí.
  if (state.profileOpen && state.profileMine) {
    state.profileWho = { ...state.profileWho, cosmetics: looksOf() };
    paintProfile();
  }
}

$('#vipLookFont').addEventListener('change', (e) => saveLooks({ font: e.target.value }));
$('#vipLookClear').addEventListener('click', () => saveLooks({ gradient: '', font: 'default' }));

function renderVipAssets() {
  const vipCfg = state.config.vip || {};
  renderVipLooks();

  $('#vipGoalName').textContent = vipCfg.goalSound
    ? vipCfg.goalSound.split(/[\\/]/).pop()
    : '—';

  const volume = vipCfg.goalVolume ?? 0.7;
  $('#vipGoalVolume').value = volume;
  $('#vipGoalVolumeValue').textContent = `${Math.round(volume * 100)}%`;
  syncRangeFill($('#vipGoalVolume'));

  $('#vipHitName').textContent = vipCfg.hitSound
    ? vipCfg.hitSound.split(/[\\/]/).pop()
    : '—';

  const hitVolume = vipCfg.hitVolume ?? 0.7;
  $('#vipHitVolume').value = hitVolume;
  $('#vipHitVolumeValue').textContent = `${Math.round(hitVolume * 100)}%`;
  syncRangeFill($('#vipHitVolume'));

  renderKeysHud();
}

/* ── El cartel de teclas ───────────────────────────────────────────────────
 *
 * Lo dibuja `game-preload.js` encima de la cancha; acá sólo se lo configura.
 *
 * Muestra DIRECCIONES y no letras, así que no hay nada que elegir sobre qué
 * tecla mostrar: la celda de la derecha se enciende con cualquiera de las que
 * el jugador tenga atadas a «derecha». Por eso los controles son sólo de
 * aspecto: qué se muestra, de qué color, de qué tamaño y dónde.
 */
const KEYS_HUD_SWITCHES = {
  es: [
    { key: 'enabled', label: 'Mostrarlo', description: 'Flechas y patada sobre la cancha, encendiéndose al apretar.' },
    { key: 'showKick', label: 'Incluir la patada', description: 'Apagalo para dejar sólo las cuatro direcciones.' }
  ],
  en: [
    { key: 'enabled', label: 'Show it', description: 'Arrows and kick over the pitch.' },
    { key: 'showKick', label: 'Include the kick', description: 'Leaves just the four directions.' }
  ]
};

function keysHudCfg() {
  return (state.config.vip || {}).keystrokes || {};
}

function renderKeysHud() {
  const lang = isEn() ? 'en' : 'es';
  const cfg = keysHudCfg();

  /*
   * El `value` lee por `keysHudCfg()` y no por el `cfg` de arriba: guardar
   * reemplaza `state.config` por un objeto NUEVO, así que una referencia
   * capturada acá se queda con los valores viejos y el interruptor volvería solo
   * a su posición anterior apenas se lo toca.
   */
  buildSwitches(
    $('#keysHudSwitches'),
    KEYS_HUD_SWITCHES[lang].map((i) => ({ ...i, value: () => !!keysHudCfg()[i.key] })),
    (item, value) => patchConfig({ vip: { keystrokes: { [item.key]: value } } })
  );

  paintKeysColor();

  const scale = Number(cfg.scale) || 1;
  $('#keysHudSize').value = scale;
  $('#keysHudSizeValue').textContent = `${Math.round(scale * 100)}%`;
  syncRangeFill($('#keysHudSize'));

  paintKeysMoveButton();
}

/**
 * La muestra de color del cartel y el botón que la devuelve al tema.
 *
 * Vacío quiere decir «el acento del tema», y un `<input type=color>` no sabe
 * mostrar eso: se le pone el acento, que es exactamente lo que se va a ver.
 *
 * El acento VIVO, no `appearance.accent`: el cartel lo pinta `keystrokeColor()`
 * con `currentPalette().accent`, y con cualquier tema que traiga color propio
 * —azul, verde, rojo…— esos dos son distintos. De ahí venía el bug: «Color del
 * tema» dejaba la muestra en violeta mientras la cancha pintaba otra cosa, y
 * parecía que el botón no hiciera nada más que poner violeta.
 *
 * Está aparte de `renderKeysHud` porque cambiar de tema tiene que repintarla sin
 * rehacer los interruptores. Ver `applyThemeVars`.
 */
function paintKeysColor() {
  const elegido = /^#[0-9a-f]{6}$/i.test(String(keysHudCfg().color || ''));
  $('#keysHudColor').value = elegido ? keysHudCfg().color : themeAccent();
  // Y se dice cuál de las dos cosas está mostrando, que del cuadradito no se
  // deduce: el botón se apaga cuando el color del tema ya es el que está puesto,
  // o sea cuando no hay nada que volver.
  $('#keysHudReset').disabled = !elegido;
}

/**
 * El botón de acomodar el cartel de teclas, que dice dos cosas distintas.
 *
 * Está aparte porque hay que volver a pintarlo desde `applyConfig`, y ésa es la
 * historia del bug: el botón tiene `data-i18n`, y cada vez que se guarda algo
 * llega la config nueva → `applyConfig` → `setLanguage` → `applyStatic`, que le
 * escribe encima el texto de la clave. O sea que arrastrar el cartel —que
 * guarda la posición— dejaba el botón diciendo «Acomodar en pantalla» con el
 * modo todavía encendido, y había que tocarlo dos veces para salir.
 */
function paintKeysMoveButton() {
  const btn = $('#keysHudMove');
  if (!btn) return;
  setButtonLabel(btn, t(state.keysMoving ? 'keys.hudMoving' : 'keys.hudMove'));
  btn.classList.toggle('is-on', !!state.keysMoving);
}

/** Si está acomodándose ahora mismo. No se guarda: dura lo que dura el gesto. */
state.keysMoving = false;

/** Termina el modo mover, venga de donde venga. */
function stopKeysMoving() {
  if (!state.keysMoving) return;
  state.keysMoving = false;
  tvm.keys.moveHud(false);
  paintKeysMoveButton();
}

// El juego avisa cuando el jugador tocó fuera del cartel: el modo se terminó
// allá y acá sólo queda acompañarlo.
tvm.keys.onMoveHudOff(() => {
  state.keysMoving = false;
  paintKeysMoveButton();
});

$('#keysHudColor').addEventListener('change', (e) =>
  patchConfig({ vip: { keystrokes: { color: e.target.value } } }));

$('#keysHudReset').addEventListener('click', async () => {
  await patchConfig({ vip: { keystrokes: { color: '' } } });
  // Volver al color del tema no lo puede mostrar el propio `<input type=color>`:
  // hay que repintarlo con el acento, que es lo que se va a ver en la cancha.
  renderKeysHud();
});

$('#keysHudSize').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#keysHudSizeValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#keysHudSize').addEventListener('change', (e) =>
  patchConfig({ vip: { keystrokes: { scale: Number(e.target.value) } } }));

$('#keysHudMove').addEventListener('click', () => {
  /*
   * Acomodarlo es arrastrarlo sobre la cancha, así que hay que estar viéndola:
   * con el panel del cliente abierto encima, el cartel queda tapado y el
   * arrastre no se ve. Al encender el modo se cierra el panel.
   */
  if (state.stage !== 'game') {
    toast(t('keys.hudNeedGame'), 'err');
    return;
  }
  state.keysMoving = !state.keysMoving;
  tvm.keys.moveHud(state.keysMoving);
  paintKeysMoveButton();
  if (state.keysMoving) closePanel();
});

/* ══════════════════════════════════════════════════════════
   YouTube Music
   ══════════════════════════════════════════════════════════

   Tres piezas y ninguna habla con Google:

     · La pestaña Música (`.mstage`), que es YouTube Music de verdad adentro de
       un `<webview>` con su propia partición.
     · El cartel sobre la cancha, que lo dibuja `game-preload.js` — acá sólo se
       lo configura, igual que el de teclas.
     · Los mandos, que van todos al proceso principal. El porqué de cada
       decisión está en `src/main/ytmusic.js`.

   Apagada no se monta NADA: sin `<webview>`, sin sesión, sin sondeo. El que no
   la usa no paga un proceso más. */

const MUSIC_SWITCHES = {
  es: [
    { key: 'enabled', where: 'music', label: 'YouTube Music', description: 'El reproductor, en la pestaña Música.', hint: 'Apagada no se abre nada: ni el reproductor, ni la sesión, ni el cartel.' },
    { key: 'audioOnly', where: 'music', label: 'Modo liviano (sin videoclip)', description: 'Prefiere la versión de canción, sin video.', hint: 'Evita componer el videoclip para dejarle la placa de video al juego.' },
    { key: 'enabled', where: 'hud', label: 'Mostrar el cartel', description: 'Qué suena y los botones, sobre la cancha.' },
    { key: 'compact', where: 'hud', label: 'Sólo los botones', description: 'Sin título ni artista: sólo tres botones.' }
  ],
  en: [
    { key: 'enabled', where: 'music', label: 'YouTube Music', description: 'The player, in the Music tab.', hint: 'Off, nothing is opened at all: no player, no session, no overlay.' },
    { key: 'audioOnly', where: 'music', label: 'Light mode (no video)', description: 'Prefers the song version, no video.', hint: 'Avoids compositing the video clip so the GPU stays available for the game.' },
    { key: 'enabled', where: 'hud', label: 'Show the overlay', description: 'What is playing plus the buttons.' },
    { key: 'compact', where: 'hud', label: 'Buttons only', description: 'No title, no artist: just three buttons.' }
  ]
};

/**
 * La rama `music` del config, o un objeto vacío si todavía no llegó.
 *
 * Lo de «todavía no llegó» no es defensa de más: `state.config` arranca en
 * `null` y `boot()` lo espera. Mientras tanto la ventana puede cambiar de tamaño
 * —la reposición del arranque la redimensiona— y ese `resize` entra acá antes de
 * que exista config. Sin esta guarda, el cliente moría en el arranque con un
 * «Cannot read property 'music' of null» y no se veía nada más.
 */
function musicCfg() {
  return (state.config && state.config.music) || {};
}

function musicHudCfg() {
  return musicCfg().hud || {};
}

/** Lo último que contestó el proceso principal sobre qué está sonando. */
state.music = null;
/** ¿Está abierto el reproductor? La vista la maneja el proceso principal. */
state.musicOpen = false;
/** Si el cartel se está acomodando ahora mismo. No se guarda: dura el gesto. */
state.musicMoving = false;

function renderMusicHud() {
  const lang = isEn() ? 'en' : 'es';

  /*
   * El `value` se lee por función y no por una referencia capturada acá: guardar
   * reemplaza `state.config` por un objeto NUEVO, así que una referencia vieja
   * dejaría al interruptor volviendo solo a su posición anterior. Es la misma
   * trampa que documenta `renderKeysHud`.
   */
  buildSwitches(
    $('#musicSwitches'),
    MUSIC_SWITCHES[lang].map((item) => ({
      ...item,
      value: () => (item.where === 'hud' ? !!musicHudCfg()[item.key] : !!musicCfg()[item.key])
    })),
    (item, value) => patchConfig(item.where === 'hud'
      ? { music: { hud: { [item.key]: value } } }
      : { music: { [item.key]: value } })
  );

  const scale = Number(musicHudCfg().scale) || 1;
  $('#musicHudSize').value = scale;
  $('#musicHudSizeValue').textContent = `${Math.round(scale * 100)}%`;
  syncRangeFill($('#musicHudSize'));

  paintMusicMoveButton();
}

function paintMusicMoveButton() {
  const btn = $('#musicHudMove');
  if (!btn) return;
  setButtonLabel(btn, t(state.musicMoving ? 'music.hudMoving' : 'music.hudMove'));
  btn.classList.toggle('is-on', !!state.musicMoving);
}

/** Termina el modo acomodar, venga de donde venga. */
function stopMusicMoving() {
  if (!state.musicMoving) return;
  state.musicMoving = false;
  tvm.music.moveHud(false);
  paintMusicMoveButton();
}

// El juego avisa cuando el jugador tocó fuera del cartel: el modo se terminó
// allá y acá sólo queda acompañarlo.
tvm.music.onMoveHudOff(() => {
  state.musicMoving = false;
  paintMusicMoveButton();
});

$('#musicHudSize').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#musicHudSizeValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#musicHudSize').addEventListener('change', (e) =>
  patchConfig({ music: { hud: { scale: Number(e.target.value) } } }));

$('#musicHudMove').addEventListener('click', () => {
  // Acomodarlo es arrastrarlo sobre la cancha, así que hay que estar viéndola.
  // Mismo motivo que el cartel de teclas.
  if (state.stage !== 'game') {
    toast(t('music.hudNeedGame'), 'err');
    return;
  }
  if (!musicHudCfg().enabled) {
    toast(t('music.hudNeedOn'), 'err');
    return;
  }
  state.musicMoving = !state.musicMoving;
  tvm.music.moveHud(state.musicMoving);
  paintMusicMoveButton();
  if (state.musicMoving) { closePanel(); setView('play'); }
});

$('#musicHudOpen').addEventListener('click', () => setView('musica'));
$('#musicHudSettings').addEventListener('click', () => {
  setView('aspecto');
  $('#musicHudCard').scrollIntoView({ block: 'start' });
});

/* ── La pestaña ───────────────────────────────────────────────────────── */

/**
 * Monta el reproductor. La partición y el user-agent los decide el proceso
 * principal (ver ytmusic.js): acá no se repiten, que es donde se
 * desincronizarían.
 *
 * El `<webview>` se crea UNA vez por sesión. Moverlo de lugar en el DOM o
 * esconderlo con `display:none` lo re-adjunta —o sea, recarga la página y corta
 * la música—, y por eso la pestaña es una pantalla propia escondida con
 * `visibility` (ver `.mstage` en app.css).
 */
/**
 * Dónde va el reproductor, en coordenadas de la ventana.
 *
 * El `BrowserView` lo pega el proceso principal y no sabe nada de este
 * documento, así que la medida sale de acá — igual que la verificación de
 * Cloudflare (ver `verifyBounds`). `getBoundingClientRect()` ya da píxeles
 * independientes del dispositivo, que es lo que `setBounds` espera.
 *
 * @returns {object|null} el rectángulo, o `null` si ahora NO se tiene que ver.
 */
function musicBounds() {
  if (!musicCfg().enabled) return null;
  // Sólo en su pestaña. Un `BrowserView` va por encima de TODO el documento, así
  // que en cualquier otra vista taparía la app entera.
  if (state.view !== 'musica') return null;
  /*
   * Y tampoco con algo encima. El dock de amigos, el perfil y los avisos son
   * HTML de esta ventana, o sea que quedan DEBAJO de la vista: si no se la
   * corriera, abrir el dock desde la pestaña Música no mostraría el dock.
   */
  if (state.friendsOpen || state.profileOpen) return null;

  const box = $('#musicFrame').getBoundingClientRect();
  if (!box.width || !box.height) return null;
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height)
  };
}

/**
 * Le dice al proceso principal dónde poner el reproductor, o que lo saque de
 * encima. Es barato y sin respuesta: se puede llamar todas las veces que haga
 * falta.
 */
function syncMusicBounds() {
  if (!musicCfg().enabled) return;
  tvm.music.bounds(musicBounds());
}

window.addEventListener('resize', syncMusicBounds);

/**
 * Abre el reproductor si hace falta y lo deja en su lugar.
 *
 * La primera apertura se deja para cuando el motor esté libre: cargar YouTube
 * Music es cargar una aplicación web entera, y al arrancar eso compite con lo
 * único que de verdad no puede esperar, que es el juego. Es el mismo trato que
 * tiene el precalentado del panel en `boot`.
 */
function mountMusic() {
  if (state.musicOpen) return syncMusicBounds();
  if (state.musicMounting) return;
  state.musicMounting = true;

  const go = async () => {
    state.musicMounting = false;
    // Lo pudo apagar mientras esperábamos al motor.
    if (!musicCfg().enabled || state.musicOpen) return;
    const res = await tvm.music.show(musicBounds()).catch(() => null);
    if (res && res.ok) state.musicOpen = true;
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 3000 });
  else setTimeout(go, 800);
}

/** Apaga el reproductor del todo. Acá sí se corta la música: es lo que se pidió. */
function unmountMusic() {
  state.musicMounting = false;
  if (!state.musicOpen) return;
  state.musicOpen = false;
  state.music = null;
  tvm.music.close().catch(() => {});
}

function paintMusicStage() {
  const on = !!musicCfg().enabled;
  $('#mstage').dataset.on = String(on);
  $('#musicFrame').hidden = !on;
  $('#musicOff').hidden = on;

  const now = state.music;
  const signed = !!(now && now.signedIn === true);
  // Mientras no se sepa (la página todavía no cargó) no se dice nada: «sin
  // sesión» en ese momento sería mentira la mitad de las veces.
  const known = !!(now && now.signedIn !== null && now.signedIn !== undefined);
  $('#musicWho').textContent = !on || !known ? '' : t(signed ? 'music.signedIn' : 'music.signedOut');
  $('#musicLogin').hidden = !on || signed;
  $('#musicLogout').hidden = !on || !signed;
}

/** Todo lo que cambia cuando se prende, se apaga o cambia de estado. */
function syncMusic() {
  if (musicCfg().enabled) {
    mountMusic();
    /*
     * Y se pide una foto del estado, en vez de esperar al primer aviso: el
     * proceso principal sólo avisa cuando algo CAMBIA, así que con la música ya
     * sonando desde antes —volver a esta pestaña, recargar la interfaz— no
     * habría nada que esperar y la barra quedaría en blanco.
     */
    tvm.music.state().then((now) => {
      if (!now) return;
      state.music = now;
      paintMusicStage();
    }).catch(() => {});
  } else {
    unmountMusic();
  }
  paintMusicStage();
  // Después de pintar: el hueco recién ahí tiene su tamaño de verdad.
  syncMusicBounds();
}

tvm.music.onState((next) => {
  state.music = next;
  paintMusicStage();
});

$('#musicEnable').addEventListener('click', async () => {
  await patchConfig({ music: { enabled: true } });
  syncMusic();
  renderMusicHud();
});

$('#musicHome').addEventListener('click', () => tvm.music.home());
$('#musicReload').addEventListener('click', () => tvm.music.reload());

$('#musicLogin').addEventListener('click', async () => {
  const btn = $('#musicLogin');
  btn.disabled = true;
  try {
    // La promesa vuelve cuando se cierra la ventana, haya entrado o no: el
    // veredicto lo trae el sondeo, que ya está mirando la página recargada.
    await tvm.music.login();
  } finally {
    btn.disabled = false;
  }
});

$('#musicLogout').addEventListener('click', async () => {
  if (!window.confirm(t('music.logoutConfirm'))) return;
  const res = await guard(tvm.music.logout(), 'Error');
  if (res) toast(t('music.loggedOut'), 'ok');
});

/** file:// para mostrar una imagen del disco dentro del renderer. */
function fileUrl(filePath) {
  return encodeURI(`file:///${String(filePath).replace(/\\/g, '/').replace(/^\/+/, '')}`);
}

/**
 * Todo lo que cambia de lugar cuando el rol aparece o se cae. Va junto porque
 * el rol ahora se comprueba solo cada tanto: esto puede pasar sin que el
 * usuario haya tocado nada.
 */
// La imagen del avatar ya no vive en la tarjeta VIP: lo que se repinta es la
// tarjeta «Tu avatar», que se ve con rol y sin él.
$('#vipPickAvatar').addEventListener('click', async () => {
  const next = await guard(tvm.vip.pickAvatar(), 'Error');
  if (next) { state.config.vip = next; renderAvatarImage(); }
});
$('#vipClearAvatar').addEventListener('click', async () => {
  const next = await guard(tvm.vip.clearAsset('avatar'), 'Error');
  if (next) { state.config.vip = next; renderAvatarImage(); }
});
$('#vipPickBall').addEventListener('click', async () => {
  const next = await guard(tvm.vip.pickBall(), 'Error');
  if (next) { state.config.vip = next; renderBallImage(); }
});
$('#vipClearBall').addEventListener('click', async () => {
  const next = await guard(tvm.vip.clearAsset('ball'), 'Error');
  if (next) { state.config.vip = next; renderBallImage(); }
});
// No hace falta recargar el juego: el bundle parcheado pregunta por el sonido
// propio cada vez que va a reproducir, así que el cambio se nota en el gol
// siguiente. Ver `patchSounds` en `game-patch.js`.
$('#vipPickGoal').addEventListener('click', async () => {
  const next = await guard(tvm.vip.pickGoalSound(), 'Error');
  if (next) { state.config.vip = next; renderVipAssets(); }
});
$('#vipClearGoal').addEventListener('click', async () => {
  const next = await guard(tvm.vip.clearAsset('goal'), 'Error');
  if (next) { state.config.vip = next; renderVipAssets(); }
});

$('#vipGoalVolume').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#vipGoalVolumeValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#vipGoalVolume').addEventListener('change', (e) => {
  patchConfig({ vip: { goalVolume: Number(e.target.value) } });
});

$('#vipPickHit').addEventListener('click', async () => {
  const next = await guard(tvm.vip.pickHitSound(), 'Error');
  if (next) { state.config.vip = next; renderVipAssets(); }
});
$('#vipClearHit').addEventListener('click', async () => {
  const next = await guard(tvm.vip.clearAsset('hit'), 'Error');
  if (next) { state.config.vip = next; renderVipAssets(); }
});

$('#vipHitVolume').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#vipHitVolumeValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#vipHitVolume').addEventListener('change', (e) => {
  patchConfig({ vip: { hitVolume: Number(e.target.value) } });
});

/* ── Editor de temas ────────────────────────────────────── */
let editingTheme = null;

function openThemeEditor(id) {
  const custom = (state.config.appearance.customThemes || []).find((theme) => theme.id === id);
  editingTheme = custom ? { ...custom } : {
    id: null,
    label: '',
    dark: true,
    bg: '#0b0b10',
    text: '#f2f1f7',
    accent: state.config.appearance.accent
  };

  $('#themeName').value = editingTheme.label || '';
  $('#themeBg').value = editingTheme.bg;
  $('#themeText').value = editingTheme.text;
  $('#themeAccent').value = editingTheme.accent;
  $('#themeDelete').hidden = !custom;

  buildSwitches($('#themeDarkSwitch'), [{
    ...THEME_DARK_SWITCH[isEn() ? 'en' : 'es'],
    key: 'dark',
    value: () => editingTheme.dark !== false
  }], (_item, value) => {
    editingTheme.dark = value;
    paintThemePreview();
  });

  paintThemePreview();
  $('#themeModal').hidden = false;
  $('#themeName').focus();
}

function paintThemePreview() {
  const box = $('#themePreview');
  const bg = $('#themeBg').value;
  const text = $('#themeText').value;
  const accent = $('#themeAccent').value;

  box.style.setProperty('--pv-bg', bg);
  box.style.setProperty('--pv-text', text);
  box.style.setProperty('--pv-accent', accent);
  box.style.setProperty('--pv-panel', mixHex(bg, editingTheme.dark !== false ? '#ffffff' : '#000000', 0.1));
  box.style.setProperty('--pv-line', mixHex(bg, text, 0.2));
  box.style.setProperty('--pv-dim', mixHex(text, bg, 0.3));
  box.style.setProperty('--pv-accent-text', readableOn(accent));
}

function mixHex(a, b, amount) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const to = (v) => v.toString(16).padStart(2, '0');
  return `#${pa.map((v, i) => to(Math.round(v + (pb[i] - v) * amount))).join('')}`;
}

function parseHex(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  return m ? m.slice(1).map((h) => parseInt(h, 16)) : null;
}

function readableOn(hex) {
  const c = parseHex(hex);
  if (!c) return '#ffffff';
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? '#12101a' : '#ffffff';
}

['#themeBg', '#themeText', '#themeAccent'].forEach((sel) => {
  $(sel).addEventListener('input', paintThemePreview);
});

$('#themeCreate').addEventListener('click', () => openThemeEditor(null));
$('#themeClose').addEventListener('click', () => { $('#themeModal').hidden = true; });
$('#themeCancel').addEventListener('click', () => { $('#themeModal').hidden = true; });
$('#themeModal').addEventListener('click', (e) => {
  if (e.target === $('#themeModal')) $('#themeModal').hidden = true;
});

$('#themeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    id: editingTheme.id,
    label: $('#themeName').value.trim(),
    description: isEn() ? 'Your own theme.' : 'Tema tuyo.',
    dark: editingTheme.dark !== false,
    bg: $('#themeBg').value,
    text: $('#themeText').value,
    accent: $('#themeAccent').value
  };
  if (!payload.label) return;

  const res = await guard(tvm.theme.save(payload), 'Error');
  if (!res) return;
  state.schema.themes = res.themes;
  state.config = await tvm.config.get();
  applyConfig(state.config);
  await refreshThemeVars();
  renderThemes();
  $('#themeModal').hidden = true;
  toast(t('toast.themeApplied', { name: payload.label }), 'ok');
});

$('#themeDelete').addEventListener('click', async () => {
  if (!editingTheme || !editingTheme.id) return;
  if (!window.confirm(t('look.customDeleteConfirm'))) return;
  const res = await guard(tvm.theme.remove(editingTheme.id), 'Error');
  if (!res) return;
  state.schema.themes = res.themes;
  state.config = await tvm.config.get();
  applyConfig(state.config);
  await refreshThemeVars();
  renderThemes();
  $('#themeModal').hidden = true;
});

/* ══════════════════════════════════════════════════════════
   Replays
   ══════════════════════════════════════════════════════════ */
async function loadReplays() {
  const data = await guard(tvm.replays.list(), 'Error');
  if (!data) return;
  state.replays = data;
  renderReplays();
}

function renderReplays() {
  const { folder, items, error } = state.replays;
  $('#replayFolder').textContent = folder;
  $('#replayFolder').title = folder;

  const query = $('#replaySearch').value.trim().toLowerCase();
  const filtered = query ? items.filter((r) => r.name.toLowerCase().includes(query)) : items;

  const list = $('#replayList');
  list.replaceChildren();

  if (error) {
    list.append(emptyState(t('replays.empty'), error));
    return;
  }
  if (!filtered.length) {
    list.append(emptyState(
      query ? t('rooms.noResults') : t('replays.empty'),
      query ? t('rooms.noResultsText') : t('replays.emptyText')
    ));
    return;
  }

  filtered.forEach((replay, index) => {
    const row = document.createElement('article');
    row.className = 'replay';
    row.style.setProperty('--n', index);

    const body = document.createElement('div');
    body.className = 'replay__body';
    const name = document.createElement('div');
    name.className = 'replay__name';
    name.textContent = replay.name;
    name.title = replay.name;
    const meta = document.createElement('div');
    meta.className = 'replay__meta';
    meta.textContent = `${formatDate(replay.updatedAt)} · ${formatBytes(replay.size)} · ${replay.format}`;
    body.append(name, meta);

    /*
     * Lo que dio el análisis, si esta grabación ya se analizó alguna vez. Es la
     * única parte visible del archivo en disco, y es la que hace que la lista
     * deje de ser nombres y fechas: «14 goles · 22:40» dice cuál era ésta.
     */
    if (replay.digest) {
      const tag = document.createElement('div');
      tag.className = 'replay__digest';
      tag.textContent = [
        t(replay.digest.goals === 1 ? 'replays.goals1' : 'replays.goalsN', { n: replay.digest.goals }),
        formatDuration(replay.digest.seconds),
        replay.digest.matches > 1 ? t('replays.matchesN', { n: replay.digest.matches }) : ''
      ].filter(Boolean).join(' · ');
      body.append(tag);
    }

    const actions = document.createElement('div');
    actions.className = 'replay__actions';
    const more = document.createElement('div');
    more.className = 'replay__more';
    more.append(
      actionButton(t('replays.rename'), () => renameReplay(replay), 'ghost', ICONS.pencil),
      actionButton(t('replays.reveal'), () => tvm.replays.reveal(replay.path), 'ghost', ICONS.folder),
      actionButton(t('replays.delete'), async () => {
        const updated = await guard(tvm.replays.trash(replay.path), 'Error');
        if (updated) { state.replays = updated; renderReplays(); }
      }, 'danger', ICONS.trash)
    );
    // El ▶ de antes era un carácter de texto: de otra familia, de otro peso
    // y sin manera de que acompañara al resto de los iconos.
    actions.append(more, actionButton(t('replays.play'), () => playReplay(replay), 'primary', ICONS.play));

    row.append(body, actions);
    list.append(row);
  });
}

/**
 * Los dibujos de los botones que se arman desde acá.
 *
 * Son los mismos trazos que los del HTML —rejilla de 24, sin relleno, la regla
 * de `svg[data-icon]` pone el grosor y las puntas—, sólo que estos botones no
 * existen hasta que hay algo que mostrar: un amigo, una grabación, una clave.
 */
const ICONS = {
  check: '<path d="M5 12.6 9.7 17.3 19 7.6"/>',
  close: '<path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6"/>',
  trash: '<path d="M4.5 7h15M9.8 7V5.4A1.4 1.4 0 0 1 11.2 4h1.6a1.4 1.4 0 0 1 1.4 1.4V7M6.6 7l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.4 7"/>',
  pencil: '<path d="M4.5 19.5h3.2L18.3 8.9a1.6 1.6 0 0 0 0-2.3l-.9-.9a1.6 1.6 0 0 0-2.3 0L4.5 16.3z"/>',
  folder: '<path d="M3.6 7.4A1.9 1.9 0 0 1 5.5 5.5h3.2l1.9 2.4h7.9a1.9 1.9 0 0 1 1.9 1.9v7.3a1.9 1.9 0 0 1-1.9 1.9H5.5a1.9 1.9 0 0 1-1.9-1.9z"/>',
  play: '<path d="M8.7 5.9v12.2l10-6.1z"/>',
  refresh: '<path d="M4.3 12a7.7 7.7 0 1 0 2.4-5.5L3.4 9.6M3.2 4.6l.2 5.2 5.2-.2"/>',
  upload: '<path d="M12 20.2V9.2M7.6 13.6 12 9.2l4.4 4.4M4.5 4.5h15"/>',
  login: '<path d="M13.4 4.2h4.4a1.5 1.5 0 0 1 1.5 1.5v12.6a1.5 1.5 0 0 1-1.5 1.5h-4.4M10.6 8.4 14.2 12l-3.6 3.6M14.2 12H4.6"/>',
  logout: '<path d="M10.6 4.2H6.2a1.5 1.5 0 0 0-1.5 1.5v12.6a1.5 1.5 0 0 0 1.5 1.5h4.4M16.4 8.4 20 12l-3.6 3.6M20 12H9.4"/>',
  userPlus: '<circle cx="10" cy="8.2" r="3.7"/><path d="M3.4 20c0-3.4 2.9-5.6 6.6-5.6M17.5 13.5v6M14.5 16.5h6"/>',
  chat: '<path d="M20 12.4c0 3.8-3.6 6.9-8 6.9-1 0-2-.2-2.9-.5L4 20.4l1.5-3.6A6.6 6.6 0 0 1 4 12.4c0-3.8 3.6-6.9 8-6.9s8 3.1 8 6.9z"/>'
};

function iconSvg(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('data-icon', '');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}

/**
 * @param {string} text
 * @param {Function} onClick
 * @param {string} [kind]  ghost (por defecto), primary o danger
 * @param {string} [icon]  un valor de `ICONS`, adelante del texto
 */
function actionButton(text, onClick, kind = 'ghost', icon = null) {
  const btn = document.createElement('button');
  btn.className = `btn btn--${kind} btn--sm`;
  if (icon) btn.append(iconSvg(icon));
  btn.append(document.createTextNode(text));
  btn.addEventListener('click', onClick);
  return btn;
}

async function playReplay(replay) {
  const res = await guard(tvm.replays.play(replay.path), 'Error');
  if (!res) return;
  // El análisis guardado es de la grabación anterior: se tira acá y no al
  // abrir el panel, que es donde ya sería tarde para notarlo.
  state.summary = null;
  state.summaryError = null;
  // Sin la extensión, que no le dice nada a nadie en la presencia de Discord.
  state.replayName = res.name.replace(/\.hbr2?$/i, '');
  /* De qué archivo es lo que se está mirando. Es lo que permite buscar su
     análisis en el archivo y guardar el nuevo. Una grabación abierta con el
     botón del propio HaxBall no pasa por acá y queda sin ruta: se la analiza
     igual, sólo que sin archivar. */
  state.replayPath = replay.path;
  setView('play');
  setStage('game');
  pushPresence();
  toast(t('toast.playing', { name: res.name }), 'ok');
}

async function renameReplay(replay) {
  const next = await ask({
    title: t('replays.rename'),
    label: t('replays.renamePrompt'),
    value: replay.name.replace(/\.hbr2?$/i, ''),
    maxLength: 90
  });
  if (next === null || !next.trim()) return;

  const updated = await guard(tvm.replays.rename(replay.path, next.trim()), 'Error');
  if (updated) { state.replays = updated; renderReplays(); toast(t('toast.renamed'), 'ok'); }
}

$('#replaySearch').addEventListener('input', renderReplays);
$('#replayRefresh').addEventListener('click', loadReplays);
$('#replayOpenFolder').addEventListener('click', () => tvm.replays.openFolder());
$('#replayChoose').addEventListener('click', async () => {
  const updated = await guard(tvm.replays.chooseFolder(), 'Error');
  if (updated) { state.replays = updated; renderReplays(); }
});

/* ══════════════════════════════════════════════════════════
   Amigos
   ══════════════════════════════════════════════════════════
   Un dock pegado al borde derecho, no una pestaña. Vive en la ventana de la app
   —fuera del <webview> del juego—, así que se dibuja ENCIMA de la cancha sin
   tocarla: se abre jugando, con F9, y el partido sigue.

   Lo que hay que cuidar para que no moleste de verdad es el FOCO. Mientras el
   juego tiene el foco, las teclas van al webview; en cuanto se hace clic acá
   adentro, dejan de ir. Por eso cerrar el dock le devuelve el foco al juego, y
   por eso nada de acá lo roba solo al abrirse.

   El estado entero viene del sitio en cada sondeo (ver `client.routes.js`): acá
   no se guarda nada que haya que mantener al día a mano, se dibuja lo último que
   llegó. Lo propio es sólo a quién estás mirando.
   ══════════════════════════════════════════════════════════ */

state.friends = null;
state.friendPick = null;
state.friendsOpen = false;

/* ── Hasta cuándo leíste ───────────────────────────────────────────────────
 *
 * Esto era un CONTADOR en memoria —cuántos mensajes recibidos había cuando
 * abriste el panel— y arrancaba en cero en cada sesión. Como el sitio manda la
 * charla ENTERA en cada sondeo, al abrir la app «recibidos» eran cuarenta y
 * «vistos» cero: el punto del botón de Amigos se encendía siempre, sin nada
 * nuevo que leer, y se apagaba al abrir el panel para volver a aparecer al
 * arranque siguiente.
 *
 * Lo que se guarda ahora es la FECHA del último mensaje que miraste, y se
 * guarda en el almacenamiento de la ventana: es un detalle de esta pantalla y
 * de esta máquina, no algo que tenga que viajar al sitio ni entrar a la config
 * que se exporta. */
const FRIEND_SEEN_KEY = 'tvm.friendsSeenAt';

function loadFriendSeen() {
  try {
    const at = Number(localStorage.getItem(FRIEND_SEEN_KEY));
    return Number.isFinite(at) && at > 0 ? at : 0;
  } catch {
    return 0;
  }
}

state.friendSeenAt = loadFriendSeen();

/** La fecha del último mensaje que te mandaron. `0` si no te mandaron ninguno. */
function lastReceivedAt(data) {
  if (!data || !data.me) return 0;
  let last = 0;
  for (const message of data.messages) {
    if (message.from !== data.me.id && message.at > last) last = message.at;
  }
  return last;
}

/** Todo lo recibido hasta ahora queda leído. */
function markFriendsSeen(data) {
  const last = lastReceivedAt(data);
  if (!last || last <= state.friendSeenAt) return;
  state.friendSeenAt = last;
  try {
    localStorage.setItem(FRIEND_SEEN_KEY, String(last));
  } catch {
    /* Sin almacenamiento el punto vuelve a ser de una sesión: no es grave. */
  }
}

/**
 * Las fotos de perfil que ya llegaron: URL del CDN de Discord → `data:`.
 *
 * Las baja el proceso principal (ver `avatars.js`) porque la CSP de esta ventana
 * no deja pedir imágenes de afuera, y manda sólo las nuevas: lo que ya está acá
 * no vuelve a viajar en cada sondeo.
 */
state.avatars = new Map();

tvm.avatars.onResolved((found) => {
  for (const [url, data] of Object.entries(found || {})) state.avatars.set(url, data);
  // Pueden llegar después del estado que las nombró: hay que repintar. La tuya
  // sale a buscarse en cuanto arranca la app, así que puede volver antes de que
  // haya config con qué dibujar nada.
  if (!state.config) return;
  /*
   * Y tu propia cara arriba a la derecha.
   *
   * Faltaba, y por eso el chip de la barra se quedaba con la inicial para
   * siempre: se pinta UNA vez al arrancar, cuando tu foto todavía se está
   * bajando, y nada lo volvía a tocar cuando llegaba. El menú disimulaba el
   * problema porque se repinta cada vez que se abre — así que la foto aparecía
   * adentro del desplegable y no en el botón que lo abre.
   */
  paintMeChip();
  if (meMenuOpen()) paintMeMenu();
});

/* ── Los avisos que suenan ─────────────────────────────────────────────────
 *
 * Sin archivos de audio: los tonos los sintetiza la ventana con WebAudio. Un
 * aviso son dos o tres sinusoides con una envolvente corta, que es exactamente
 * lo que hay adentro de un .mp3 de aviso — y así no hay nada que empaquetar en
 * el instalador, nada que se pueda perder y nada que cargar en el arranque.
 *
 * El aviso VISUAL sale siempre: es la respuesta a algo que pasó y no molesta a
 * nadie. El sonido es lo que interrumpe —suena arriba de la partida—, así que
 * cada tipo se apaga por separado desde Ajustes → Avisos de amigos.
 */

/** Cada aviso, como pares [frecuencia en Hz, duración en segundos]. */
const NOTIFY_TONES = {
  // Mensaje: dos notas cortas que suben. Es el que más va a sonar, así que es
  // el más discreto de los tres.
  messages: [[880, 0.07], [1174.7, 0.13]],
  // Invitación: sube más y termina arriba, porque es lo que pide una acción.
  invites: [[659.3, 0.07], [880, 0.07], [1318.5, 0.17]],
  // Solicitud: dos notas y la segunda BAJA. Que el contorno sea al revés es lo
  // que lo hace distinguible sin mirar la pantalla.
  requests: [[587.3, 0.09], [493.9, 0.17]]
};

/**
 * Uno solo para toda la sesión.
 *
 * Chromium tope los AudioContext en seis por documento: uno por sonido deja de
 * sonar al séptimo aviso y no avisa por ningún lado.
 */
let audioCtx = null;

/** @param {'messages'|'invites'|'requests'} kind */
function notifySound(kind) {
  const cfg = state.config && state.config.notify;
  if (!cfg || !cfg[kind]) return;
  const volume = Math.max(0, Math.min(1, Number(cfg.volume ?? 0.5)));
  if (volume) playTones(NOTIFY_TONES[kind], volume);
}

function playTones(tones, volume) {
  if (!tones) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    // Un contexto creado sin un gesto del usuario arranca suspendido. Nada de
    // esto es crítico: se pide seguir y, si no se puede, el aviso es mudo.
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    let at = audioCtx.currentTime + 0.01;
    for (const [hz, seconds] of tones) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      /*
       * La envolvente no es un adorno: una ganancia que arranca y corta en seco
       * mete un chasquido —el salto de la onda a cero— que se escucha más que
       * la nota. Sube en 12 ms y se apaga exponencial hasta el final.
       */
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(volume * 0.22, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(at);
      osc.stop(at + seconds + 0.02);
      // Las notas se pisan un cuarto: encadenadas suenan a aviso, una detrás de
      // la otra suenan a tres pitidos sueltos.
      at += seconds * 0.75;
    }
  } catch {
    /* Sin audio el cliente anda igual: el aviso visual ya salió. */
  }
}

function friendById(id) {
  return (state.friends && state.friends.friends.find((f) => f.id === id)) || null;
}

function friendName(id) {
  const friend = friendById(id);
  return friend ? friend.name : '—';
}

/* ── Fotos de perfil ────────────────────────────────────────────────────────
 *
 * Lo que trae el sitio es la URL de la foto en el CDN de Discord; la imagen la
 * baja el proceso principal y llega acá como `data:`. Mientras no haya foto
 * —porque todavía no bajó, porque falló, o porque la persona no tiene— se dibuja
 * la inicial, que es lo que había antes y cumple igual. */

function initialOf(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

/** Llena un hueco de foto ya existente en el HTML. */
function paintFace(el, person) {
  const url = person && person.avatar;
  const data = url ? state.avatars.get(url) : null;
  el.classList.toggle('is-photo', !!data);

  if (!data) {
    el.replaceChildren(document.createTextNode(initialOf(person && person.name)));
    return el;
  }
  const img = document.createElement('img');
  img.src = data;
  img.alt = '';
  el.replaceChildren(img);
  return el;
}

/**
 * Una foto nueva para una fila de lista.
 * @param {object} person   con `name` y `avatar`
 * @param {boolean|null} online  si se le pinta el puntito de estado
 */
function faceEl(person, online) {
  const face = document.createElement('span');
  face.className = 'pfp';
  paintFace(face, person);
  if (online !== null && online !== undefined) {
    // El estado va ENCIMA de la foto y no al lado: en una columna de 320 px cada
    // píxel de ancho es una letra menos del nombre.
    face.append(statusDot(online));
  }
  return face;
}

/* ── Abrir y cerrar ─────────────────────────────────────── */

function openFriends(pick) {
  if (pick) state.friendPick = pick;
  setFriendsOpen(true);
  // Y repintar aunque ya estuviera abierto: `setFriendsOpen` corta cuando no hay
  // cambio de estado, así que sin esto abrir la charla de alguien con el dock ya
  // abierto —desde un aviso de mensaje, o desde su perfil— no movía nada.
  renderFriends();
}

function toggleFriends() {
  setFriendsOpen(!state.friendsOpen);
}

function setFriendsOpen(open) {
  if (open === state.friendsOpen) return;
  state.friendsOpen = open;
  $('#friendsDock').hidden = !open;
  $('#btnFriends').classList.toggle('is-on', open);
  /*
   * El dock es HTML de esta ventana y el reproductor es una vista que va por
   * ENCIMA: sin correrla, abrir el dock desde la pestaña Música no mostraría
   * nada. Ver `musicBounds`.
   */
   syncMusicBounds();

  if (open) {
    renderFriends();
    return;
  }
  // Cerrar tiene que devolverle el foco al juego. Ver `focusGame`.
  focusGame();
}

$('#dockClose').addEventListener('click', () => setFriendsOpen(false));
$('#dockBack').addEventListener('click', () => {
  state.friendPick = null;
  renderFriends();
});

/* ── Pintado ────────────────────────────────────────────── */

function renderFriends() {
  /*
   * El contador de la barra va ANTES del corte por dock cerrado. Saber cuántos
   * amigos hay conectados sin abrir nada es justamente para lo que está: si se
   * pintara sólo con el cajón abierto, el número aparecería recién cuando ya
   * tenés la lista completa delante.
   */
  paintFriendsCount(state.friends ? state.friends.friends.filter((f) => f.online).length : 0);

  if (!state.friendsOpen) {
    paintFriendsDot();
    return;
  }

  const data = state.friends;
  const logged = !!vipProfile();
  const friend = logged && data ? friendById(state.friendPick) : null;

  $('#dockLocked').hidden = logged;
  $('#dockListView').hidden = !logged || !!friend;
  $('#dockChatView').hidden = !friend;
  $('#dockBack').hidden = !friend;
  // El título es siempre «Amigos», incluso adentro de una conversación: con
  // quién estás hablando se lee abajo, al lado de su foto, que es donde entra.
  $('#dockTitle').textContent = t('friends.title');
  // Tu fila no depende de que el sitio conteste: se pinta antes de irse.
  if (logged && !friend) paintMyRow();

  if (!logged || !data) {
    $('#dockCount').textContent = '';
    paintFriendsDot();
    return;
  }

  // Con el dock abierto, lo recibido está visto: el punto se apaga.
  markFriendsSeen(data);
  paintFriendsDot();

  if (friend) {
    // La cuenta de conectados es de la LISTA. Quedaba puesta al entrar a una
    // conversación —«0 de 2 en línea» arriba de una charla— porque de acá se
    // salía antes de tocarla.
    $('#dockCount').textContent = '';
    paintFriendChat(data, friend);
    return;
  }

  const online = data.friends.filter((f) => f.online).length;
  $('#dockCount').textContent = data.friends.length
    ? t('friends.online', { online, total: data.friends.length })
    : '';
  paintFriendRequests(data);
  paintFriendList(data);
}

/** El punto del botón: hay una solicitud o un mensaje sin leer. */
function paintFriendsDot() {
  const data = state.friends;
  const pending = data ? data.requests.in.length : 0;
  const unread = !!data && !!data.me && data.messages.some(
    (message) => message.from !== data.me.id && message.at > state.friendSeenAt
  );
  $('#friendsDot').hidden = !(pending || (!state.friendsOpen && unread));
}

function paintFriendRequests(data) {
  const rows = [...data.requests.in, ...data.requests.out];
  // El grupo entero desaparece cuando no hay ninguna: un título «Solicitudes»
  // sobre la nada ocupa lo mismo que una solicitud y no dice nada.
  $('#friendReqGroup').hidden = !rows.length;
  $('#friendReqCount').textContent = rows.length || '';

  $('#friendReqList').replaceChildren(...rows.map((request) => {
    const incoming = data.requests.in.includes(request);
    const row = document.createElement('div');
    row.className = 'friendreq';

    const text = document.createElement('span');
    const who = document.createElement('b');
    who.textContent = request.name;
    const what = document.createElement('span');
    // Sin el espacio de adelante que llevaba antes: las dos partes ya no van
    // seguidas en un renglón, van una debajo de la otra (`.friendreq__who > span`
    // es una grilla), y ahí el espacio quedaba como una sangría de un carácter.
    what.textContent = incoming ? t('friends.wantsIn') : t('friends.wantsOut');
    text.append(who, what);

    const line = document.createElement('div');
    line.className = 'friendreq__who';
    line.append(faceEl(request, null), text);

    const actions = document.createElement('div');
    actions.className = 'rowactions';
    if (incoming) {
      actions.append(actionButton(t('friends.accept'), () =>
        friendAction({ action: 'accept', friend: request.id }), 'primary', ICONS.check));
    }
    actions.append(actionButton(incoming ? t('friends.reject') : t('friends.cancel'), () =>
      friendAction({ action: 'remove', friend: request.id }), 'ghost', ICONS.close));

    row.append(line, actions);
    return row;
  }));
}

/**
 * Cuántos amigos hay conectados, en el botón de la barra.
 *
 * Va al lado del icono y con punto verde. El punto ROJO de la esquina es otra
 * cosa —hay algo sin leer— y lo maneja `friendsDot`: un solo globito con un
 * número quería decir las dos cosas a la vez y no se entendía ninguna.
 */
function paintFriendsCount(n) {
  const caja = $('#friendsOnline');
  if (!caja) return;
  caja.hidden = !n;
  if (n) $('b', caja).textContent = String(n);
}

/**
 * La lista, partida en dos: conectados y desconectados, cada grupo con su
 * título y su cuenta.
 *
 * Antes era una sola tira ordenada como viniera del sitio, y ahí un amigo
 * conectado y uno que no se veían exactamente igual salvo por un punto de 9 px:
 * había que leer las cinco filas para encontrar a quién se le podía escribir.
 */
function paintFriendList(data) {
  const online = data.friends.filter((friend) => friend.online);
  const offline = data.friends.filter((friend) => !friend.online);

  fillFriendGroup('#friendOnGroup', '#friendOnCount', '#friendList', online);
  fillFriendGroup('#friendOffGroup', '#friendOffCount', '#friendListOff', offline);
  paintFriendsCount(online.length);

  // El cartel de lista vacía va aparte de los grupos: si viviera adentro de uno,
  // se escondería con él justo cuando es lo único que hay para mostrar.
  $('#friendEmpty').replaceChildren(
    ...(data.friends.length ? [] : [emptyState(t('friends.empty'), t('friends.emptyText'))])
  );
}

function fillFriendGroup(groupSel, countSel, rowsSel, friends) {
  $(groupSel).hidden = !friends.length;
  $(countSel).textContent = friends.length || '';
  $(rowsSel).replaceChildren(...friends.map(friendRow));
}

function friendRow(friend) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'friend';
  row.addEventListener('click', () => {
    state.friendPick = friend.id;
    renderFriends();
  });

  const body = document.createElement('span');
  body.className = 'friend__body';
  const name = document.createElement('b');
  name.textContent = friend.name;
  if (friend.vip) name.append(vipGem());
  body.append(name, friendWhere(friend));

  row.append(faceEl(friend, friend.online), body);
  return row;
}

/**
 * Tu tarjeta, arriba del panel: es de donde se abre tu perfil.
 *
 * Sale de `myProfile()` y no de la respuesta del sitio para que siga estando
 * cuando el sitio no contesta: tu nombre, tu foto y tu nivel los sabe esta PC.
 */
function paintMyRow() {
  const me = myProfile();
  paintFace($('#dockMeFace'), me);
  $('#dockMeName').textContent = me.name;
  $('#dockMeLevel').textContent = t('profile.levelLine', { level: me.stats.level });
}

/**
 * Cuánto hace de un instante, en palabras. Para «última vez en línea».
 *
 * Se corta en la semana: más allá de eso el dato deja de decir «se fue recién»
 * y pasa a decir «no viene más», y para eso alcanza la fecha.
 */
function agoText(at) {
  const ms = Date.now() - Number(at);
  if (!Number.isFinite(ms) || ms < 0) return null;

  const min = Math.floor(ms / 60000);
  if (min < 1) return t('friends.seenNow');
  if (min < 60) return t('friends.seenMin', { n: min });

  // `hour12: false` a mano: en es-AR el formato por defecto sale «06:50 a. m.»,
  // que ocupa el doble y no es como se escribe la hora en ningún otro lado de
  // la app.
  const hora = new Date(Number(at)).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const hoy = new Date();
  const cuando = new Date(Number(at));
  const mismoDia = hoy.toDateString() === cuando.toDateString();
  if (mismoDia) return t('friends.seenToday', { time: hora });

  const ayer = new Date(hoy.getTime() - 86400000);
  if (ayer.toDateString() === cuando.toDateString()) return t('friends.seenYesterday', { time: hora });

  const dias = Math.floor(ms / 86400000);
  if (dias < 7) return t('friends.seenDays', { n: dias });
  return t('friends.seenLong', { date: cuando.toLocaleDateString('es-AR') });
}

/**
 * Dónde está un amigo, o cuándo se lo vio por última vez.
 *
 * `lastSeen` lo manda el sitio y puede no venir: clientes viejos, o el amigo lo
 * tiene apagado. Sin él queda el texto de siempre, así que esto no depende de
 * que el panel esté actualizado para no romperse.
 *
 * Y si VOS lo apagaste, tampoco lo ves: la reciprocidad se cumple también acá
 * y no sólo del lado del sitio, porque es lo que dice el interruptor.
 */
function whereText(friend) {
  if (!friend.online) {
    const veLaUltima = true;
    const cuando = veLaUltima && friend.lastSeen ? agoText(friend.lastSeen) : null;
    return cuando ? t('friends.lastSeen', { when: cuando }) : t('friends.offline');
  }
  return friend.room ? t('friends.inRoom', { room: friend.room }) : t('friends.inMenu');
}

function friendWhere(friend) {
  const where = document.createElement('span');
  where.className = 'friend__where';
  where.textContent = whereText(friend);
  return where;
}

/**
 * El punto de estado que va apoyado en la foto: verde conectado, gris no.
 *
 * Está aparte de `faceEl` porque hay un `.pfp` que no se crea acá sino que ya
 * está en el HTML —el de la cabecera de la conversación— y necesita el mismo.
 */
function statusDot(online) {
  const dot = document.createElement('i');
  dot.className = `pfp__dot${online ? ' is-on' : ''}`;
  return dot;
}

/**
 * La marca de VIP.
 *
 * Es el MISMO dibujo que se le pinta a la fila en la sala (`VIP_GEM_SVG` en
 * `room-ui.js`) y que muestra el «cómo te ven» del panel VIP: la piedra rellena
 * con las caras en tres celestes y un filo oscuro. Antes acá era el carácter
 * `◆` a secas, y después un rombo de contorno que a 12 px quedaba en un píxel
 * escaso al lado del nombre.
 */
function vipGem() {
  const gem = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gem.setAttribute('viewBox', '0 0 24 24');
  gem.setAttribute('class', 'friend__gem');
  gem.innerHTML =
    '<path d="M7 4 2 9h7.5z" fill="#95e6fc"/><path d="M7 4h10l-2.5 5h-5z" fill="#dcfaff"/>' +
    '<path d="M17 4l5 5h-7.5z" fill="#62ccf2"/><path d="M2 9h7.5L12 21z" fill="#3dbdf3"/>' +
    '<path d="M9.5 9h5L12 21z" fill="#1c9fd9"/><path d="M14.5 9H22L12 21z" fill="#0a7fb9"/>' +
    '<path d="M7 4h10l5 5-10 12L2 9z" fill="none" stroke="#062a3e" stroke-width="1.4" stroke-linejoin="round"/>';
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = 'VIP';
  gem.prepend(title);
  return gem;
}

/*
 * El tilde de un mensaje tuyo: enviado, entregado, leído o fallado.
 *
 * `message.state` lo tiene que poner el sitio. Cuando no viene —panel viejo, o
 * el otro tiene las confirmaciones apagadas— queda en «enviado», que es lo
 * único que este cliente sabe con certeza: que el POST salió bien.
 *
 * El azul del leído sólo se dibuja si VOS tenés las confirmaciones prendidas.
 * Es la misma reciprocidad que aplica `whereText` con la última conexión.
 */
const TICK_SENT = 'M3 6.5 6.4 10 13 3';
const TICK_DOUBLE = 'M2 6.5 5.4 10 12 3M8.6 6.5 12 10l6.6-7';

function messageTick(message) {
  const estado = message.state || 'sent';
  const tick = document.createElement('span');
  tick.className = `tick tick--${estado}`;

  if (estado === 'failed') {
    tick.textContent = '!';
    tick.title = t('friends.msgFailed');
    return tick;
  }

  const leido = estado === 'read';
  const doble = leido || estado === 'delivered';
  if (leido) tick.classList.add('is-read');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', doble ? TICK_DOUBLE : TICK_SENT);
  svg.append(path);
  tick.append(svg);
  tick.title = t(leido ? 'friends.msgRead' : doble ? 'friends.msgDelivered' : 'friends.msgSent');
  return tick;
}

function paintFriendChat(data, friend) {
  /*
   * Con quién estás hablando, armado como una fila de la lista.
   *
   * El nombre estaba arriba, en el título del panel, y ahí no entra: un nombre
   * de Discord normal salía cortado con «…» y al lado quedaba la cuenta de
   * conectados de la lista, que en una conversación no dice nada. Y debajo, con
   * todas las letras, un «Desconectado» que es exactamente lo que el punto de la
   * lista dice sin ocupar un renglón.
   */
  paintFace($('#chatFace'), friend);
  $('#chatFace').append(statusDot(friend.online));

  const name = $('#chatName');
  name.textContent = friend.name;
  if (friend.vip) name.append(vipGem());
  // Dónde está sólo se dice si está: desconectado ya lo dice el punto.
  $('#chatWhere').textContent = friend.online ? whereText(friend) : '';
  // Invitar necesita las dos cosas: alguien a quien invitar y una sala con link.
  $('#chatInvite').hidden = !state.canInvite;
  /*
   * A qué sala lo estás mandando, que desde el botón solo no se ve. Y sin sala,
   * la frase entera: en el chat el botón dice «Invitar» a secas —los tres de esa
   * fila no entran en el dock con la frase larga— así que el «a mi sala» tiene
   * que estar en algún lado.
   */
  $('#chatInvite').title = state.roomLabel
    ? t('friends.inRoom', { room: state.roomLabel })
    : t('friends.invite');

  const mine = data.me.id;
  const talk = data.messages.filter((m) =>
    (m.from === mine && m.to === friend.id) || (m.from === friend.id && m.to === mine));

  const log = $('#chatLog');
  if (!talk.length) {
    log.replaceChildren(emptyState(t('friends.noChat'), t('friends.noChatText')));
    return;
  }

  log.replaceChildren(...talk.map((message) => {
    const esMio = message.from === mine;
    const row = document.createElement('div');
    row.className = `msg${esMio ? ' msg--mine' : ''}`;
    const text = document.createElement('span');
    text.className = 'msg__text';
    text.textContent = message.text;
    const when = document.createElement('span');
    when.className = 'msg__at';
    when.textContent = formatDate(message.at);
    // El estado es sólo de los tuyos: en los que te llegan no significa nada.
    if (esMio) when.append(messageTick(message));
    row.append(text, when);
    return row;
  }));
  // Lo último es lo que importa.
  log.scrollTop = log.scrollHeight;
}

/* ── Acciones ───────────────────────────────────────────── */

function friendAction(payload) {
  return Promise.reject(new Error('Las funciones sociales no están disponibles en esta edición del club.'));
}

/* ── El código de amigo ─────────────────────────────────────────── *
 *
 * Ocho letras y números que no dicen nada de quién sos. Existe para no
 * depender del nombre de Discord, que se cambia, que hay que escribir igualito
 * y que además es lo que la persona muestra en todos lados: pasar el código por
 * el chat de una sala no regala nada más que el código.
 *
 * Se reconoce solo en el campo de agregar: pedirle a alguien que elija entre
 * «por nombre» y «por código» es hacerle explicar al programa algo que el
 * programa puede mirar.
 *
 * Pero mirar no alcanza para DECIDIR, y esto casi sale mal: «shank444» son ocho
 * caracteres del alfabeto del código y encaja perfecto. Si la forma decidiera,
 * agregar a esa persona por su nombre fallaría con «ese código no es de nadie».
 * Así que cuando tiene forma de código se mandan los dos campos y el sitio
 * prueba primero como código y después como nombre — ver el caso `add` en
 * client.routes.js.                                                          */
const FRIEND_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-?[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/i;

function looksLikeCode(value) {
  return FRIEND_CODE.test(String(value || '').trim());
}

function paintFriendCode(code) {
  const box = $('#friendCodeBox');
  if (!box) return;
  state.friendCode = code || null;
  box.hidden = !code;
  if (code) $('#friendCodeValue').textContent = code;
}

$('#friendCodeValue').addEventListener('click', async () => {
  if (!state.friendCode) return;
  try {
    await navigator.clipboard.writeText(state.friendCode);
    toast(t('friends.copied'), 'ok');
  } catch {
    // Sin portapapeles queda a la vista igual, que es lo que importa.
    toast(t('friends.copyFailed'), 'err');
  }
});

$('#friendCodeNew').addEventListener('click', async () => {
  if (!window.confirm(t('friends.newCodeConfirm'))) return;
  const res = await friendAction({ action: 'newcode' });
  if (!res || !res.code) return;
  paintFriendCode(res.code);
  toast(t('friends.newCodeDone'), 'ok');
});

$('#friendAddForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#friendAddName');
  const value = input.value.trim();
  if (!value) return;

  const byCode = looksLikeCode(value);
  const res = await friendAction(
    byCode ? { action: 'add', code: value, username: value } : { action: 'add', username: value }
  );
  if (!res) return;
  input.value = '';
  /*
   * Con algo que tenía forma de código no se puede decir «ya son amigos con
   * Fulano»: puede haber entrado por el código, y el código no dice de quién
   * es. Se avisa sin nombre y la lista lo muestra en el próximo latido.
   */
  const done = res.friend
    ? (byCode ? t('friends.nowFriendsAnon') : t('friends.nowFriends', { name: value }))
    : t('friends.sent');
  toast(done, 'ok');
});

$('#chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chatText');
  const text = input.value.trim();
  if (!text || !state.friendPick) return;
  input.value = '';
  await friendAction({ action: 'message', friend: state.friendPick, text });
});

$('#chatInvite').addEventListener('click', async () => {
  if (!state.friendPick) return;
  const res = await friendAction({ action: 'invite', friend: state.friendPick });
  if (res) toast(t('friends.inviteSent', { name: friendName(state.friendPick) }), 'ok');
});

$('#chatRemove').addEventListener('click', async () => {
  const friend = friendById(state.friendPick);
  if (!friend) return;
  const res = await friendAction({ action: 'remove', friend: friend.id });
  if (!res) return;
  state.friendPick = null;
  toast(t('friends.removed', { name: friend.name }), 'ok');
});

/* ══════════════════════════════════════════════════════════
   Perfiles
   ══════════════════════════════════════════════════════════
   La misma tarjeta para el tuyo y para el de un amigo: quién sos, en qué nivel
   vas, tus números y cómo te ven en la sala. Lo único que cambia es que lo tuyo
   se edita.

   Vive en un modal por encima del dock —y por lo tanto por encima del juego—
   porque se abre DESDE el dock, y el dock se abre jugando.

   De dónde salen los datos:

     · El tuyo, del sitio (`me` en la foto de amigos) y, si el sitio no contesta,
       de lo que hay en esta PC. Un perfil que se apaga porque se cayó el panel
       no sirve de nada: los números son tuyos y están en tu disco.
     · El de un amigo, del sitio y sólo del sitio (acción `profile`). No hay otra
       fuente posible: nada de eso pasa por tu máquina.
   ══════════════════════════════════════════════════════════ */

state.profileOpen = false;
/** A quién estás mirando: un perfil ya resuelto, o null mientras carga. */
state.profileWho = null;
state.profileMine = true;

/**
 * Tu perfil, con lo mejor que se tenga a mano.
 *
 * El sitio manda los contadores ya fusionados entre tus instalaciones; lo local
 * es de esta PC nada más. Se prefiere el del sitio y se cae al local cuando no
 * hay respuesta — que es también lo que pasa antes del primer sondeo.
 */
function myProfile() {
  const discord = vipProfile() || {};
  const remote = (state.friends && state.friends.me) || null;
  const local = state.config.stats;

  return {
    id: remote ? remote.id : 0,
    name: discord.username || (remote && remote.name) || '—',
    avatar: discord.avatar || (remote && remote.avatar) || null,
    vip: isVip(),
    online: true,
    room: null,
    bio: remote ? remote.bio : null,
    slug: remote ? remote.slug : null,
    stats: (remote && remote.stats) || withLevel(local),
    cosmetics: looksOf()
  };
}

/** Los mismos campos que calcula el sitio, para cuando los calcula el cliente. */
function withLevel(stats) {
  const xp = xpOf(stats);
  const { level, into, need } = levelOf(xp);
  return { ...stats, xp, level, levelInto: into, levelNeed: need };
}

/**
 * Abre un perfil. Sin id, el tuyo.
 *
 * El de un amigo se pide al sitio, así que la tarjeta se abre primero con lo que
 * ya se sabe de él —nombre, foto, si está conectado— y se completa cuando llega
 * la respuesta. Abrir en blanco y esperar se ve como si no hubiera pasado nada.
 */
/**
 * Un perfil que ya vino resuelto de afuera: el de alguien de tu sala, abierto
 * desde el menú de clic derecho de la lista de jugadores. Acá no hay nada que
 * pedir, ya llegó todo.
 */
async function openProfile(id) {
  state.profileMine = !id;
  state.profileWho = id ? friendById(id) : myProfile();
  state.profileOpen = true;
  $('#profileModal').hidden = false;
  paintProfile();
  // La tarjeta es HTML y el reproductor una vista por encima: ver `musicBounds`.
  syncMusicBounds();

  if (!id) return;
  const res = await friendAction({ action: 'profile', friend: id });
  // Pudo cerrarlo o abrir otro mientras venía la respuesta.
  if (!res || !res.profile || !state.profileOpen) return;
  if (state.profileWho && state.profileWho.id !== res.profile.id) return;
  state.profileWho = res.profile;
  paintProfile();
}

function closeProfile() {
  if (!state.profileOpen) return;
  state.profileOpen = false;
  state.profileWho = null;
  $('#profileModal').hidden = true;
  syncMusicBounds();
  // Igual que al cerrar el dock: si estabas jugando, las teclas vuelven al juego.
  if (!state.friendsOpen) focusGame();
}

function paintProfile() {
  const who = state.profileWho;
  if (!who) return;
  const mine = state.profileMine;

  paintFace($('#profileFace'), who);
  $('#profileName').textContent = who.name;
  $('#profileName').append(...(who.vip ? [vipGem()] : []));
  $('#profileWhere').textContent = mine
    ? t('profile.you')
    : who.online
      ? (who.room ? t('friends.inRoom', { room: who.room }) : t('friends.inMenu'))
      : t('friends.offline');

  paintProfileLevel(who.stats);
  paintProfileBio(who, mine);
  paintProfileStats(who.stats);
  paintProfileLooks(who, mine);
  paintProfileActions(who, mine);
}

function paintProfileLevel(stats) {
  // Sin estadísticas todavía, el nivel es 1 y la barra está vacía: es la verdad,
  // no un hueco.
  const level = stats ? stats.level : 1;
  const into = stats ? stats.levelInto : 0;
  const need = stats ? stats.levelNeed : 100;
  $('#profileLevel').textContent = String(level);
  $('#profileXp').textContent = `${into} / ${need} XP`;
  paintXp($('#profileXpFill'), into / need);
}

function paintProfileBio(who, mine) {
  const text = (who.bio || '').trim();
  $('#profileBio').hidden = mine || !text;
  $('#profileBio').textContent = text;

  $('#profileBioForm').hidden = !mine;
  if (!mine) return;
  // No se pisa lo que esté escribiendo: un sondeo que llega en el medio no puede
  // borrarle la frase a medio escribir.
  if (document.activeElement !== $('#profileBioText')) $('#profileBioText').value = text;
  paintBioLeft();
}

function paintBioLeft() {
  const left = 140 - $('#profileBioText').value.length;
  $('#profileBioLeft').textContent = String(left);
}

function paintProfileStats(stats) {
  const has = stats && (stats.matches || stats.goals || stats.secondsPlayed);
  $('#profileStats').hidden = !has;
  $('#profileNoStats').hidden = !!has;
  if (has) paintDefList($('#profileStats'), statLines(stats));
}

/** Las filas de números que se ven igual en tu tarjeta y en un perfil. */
function statLines(stats) {
  const matches = stats.matches || 0;
  const average = matches ? (stats.goals || 0) / matches : 0;
  return [
    [t('stats.matches'), String(matches)],
    [t('stats.goals'), String(stats.goals || 0)],
    [t('stats.average'), matches ? average.toFixed(2) : '—'],
    [t('stats.assists'), String(stats.assists || 0)],
    [t('stats.bestStreak'), t('stats.days', { days: stats.bestStreak || 0 })],
    [t('settings.timePlayed'), formatDuration(stats.secondsPlayed)]
  ];
}

/**
 * Cómo se ve su fila en la sala.
 *
 * En el tuyo se elige; en el de un amigo sólo se mira, y sólo si está conectado
 * con el cliente: el degradado viaja en el latido de presencia, no está guardado
 * en ninguna base.
 */
function paintProfileLooks(who, mine) {
  const looks = who.cosmetics || {};
  const editable = mine && isVip();
  const show = mine || !!(looks.gradient || looks.font);

  $('#profileLookWrap').hidden = !show;
  if (!show) return;

  $('#profileLookEdit').hidden = !editable;
  $('#profileLookLocked').hidden = !mine || editable;

  paintLooks(PROFILE_LOOK_IDS, looks, {
    editable,
    name: (mine ? (state.config.general.nickname || '').trim() : who.nick || who.name) || t('vip.looksYou')
  });
}

/**
 * Los botones de abajo dependen de si ya son amigos, y eso lo dice el sitio
 * (`friend`) y no la lista de acá: este perfil puede venir de la sala, donde no
 * hay con qué saberlo.
 */
function paintProfileActions(who, mine) {
  const actions = $('#profileActions');
  if (mine) {
    actions.replaceChildren();
    return;
  }

  // Todavía no son amigos: lo único que se puede hacer es pedirlo. Y sólo desde
  // la sala, que es de donde salió la llave.
  if (!who.friend) {
    actions.replaceChildren(...(who.peer ? [actionButton(t('profile.add'), async () => {
      const res = await friendAction({ action: 'addPeer', peer: who.peer });
      if (!res) return;
      closeProfile();
      toast(res.friend ? t('friends.nowFriends', { name: who.name }) : t('friends.sent'), 'ok');
    }, 'primary', ICONS.userPlus)] : []));
    return;
  }

  const buttons = [
    actionButton(t('profile.message'), () => {
      closeProfile();
      openFriends(who.id);
    }, 'primary', ICONS.chat)
  ];
  if (state.canInvite) {
    buttons.push(actionButton(t('friends.invite'), async () => {
      const res = await friendAction({ action: 'invite', friend: who.id });
      if (res) toast(t('friends.inviteSent', { name: who.name }), 'ok');
    }, 'ghost', ICONS.userPlus));
  }
  /*
   * Lo de arriba al revés: está jugando y querés entrar vos.
   *
   * `canAskJoin` lo decide el sitio —hace falta saber si está en una sala Y si
   * acepta que le pidan, que es una preferencia suya que este cliente no tiene—,
   * así que el botón aparece sólo cuando la respuesta ya vino con el perfil.
   *
   * No manda ningún link ni te mete en ningún lado: le llega un aviso y el link
   * te lo manda él, si quiere.
   */
  if (who.canAskJoin) {
    buttons.push(actionButton(t('friends.askJoin'), async () => {
      const res = await friendAction({ action: 'askJoin', friend: who.id });
      if (res) toast(t('friends.askJoinSent', { name: who.name }), 'ok');
    }, 'ghost', ICONS.chat));
  }
  actions.replaceChildren(...buttons);
}

$('#profileClose').addEventListener('click', closeProfile);
// Clic en el velo, no en la tarjeta: es la forma de cerrar que ya tienen los
// otros modales de la app.
$('#profileModal').addEventListener('click', (e) => {
  if (e.target === $('#profileModal')) closeProfile();
});

$('#dockMe').addEventListener('click', () => openProfile(null));
$('#chatProfile').addEventListener('click', () => {
  if (state.friendPick) openProfile(state.friendPick);
});

$('#profileLookFont').addEventListener('change', (e) => saveLooks({ font: e.target.value }));
$('#profileLookClear').addEventListener('click', () => saveLooks({ gradient: '', font: 'default' }));

/* ══════════════════════════════════════════════════════════
   Identidades de HaxBall
   ══════════════════════════════════════════════════════════ */
async function loadAuth() {
  const data = await guard(tvm.auth.state(), 'Error');
  if (!data) return;
  state.auth = data;
  renderAuth();
}

function renderAuth() {
  const list = $('#authList');
  list.replaceChildren();

  $('#authSave').disabled = !state.auth.liveAvailable || state.auth.liveKnown;
  $('#authSave').title = state.auth.liveKnown ? t('auth.alreadySaved') : '';

  if (!(state.auth.items || []).length) {
    list.append(emptyState(t('auth.empty'), t('auth.emptyText')));
    return;
  }

  for (const item of state.auth.items) {
    const row = document.createElement('div');
    row.className = `authrow${state.auth.activeId === item.id ? ' is-active' : ''}`;

    const body = document.createElement('div');
    body.className = 'authrow__body';

    const name = document.createElement('div');
    name.className = 'authrow__name';
    name.append(document.createTextNode(item.name));
    if (state.auth.activeId === item.id) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = t('auth.inUse');
      name.append(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'authrow__meta';
    // Nunca se muestra la clave entera: alcanza con poder distinguirlas.
    meta.textContent = `${t('auth.added')} ${formatDate(item.createdAt)} · ••••${String(item.key).slice(-6)}`;
    body.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'authrow__actions';

    if (state.auth.activeId !== item.id) {
      actions.append(actionButton(t('auth.use'), () => activateAuth(item.id), 'primary', ICONS.check));
    }
    actions.append(
      actionButton(t('auth.rename'), () => renameAuth(item), 'ghost', ICONS.pencil),
      actionButton(t('auth.export'), async () => {
        const res = await guard(tvm.auth.export(item.id), 'Error');
        if (res && res.saved) toast(t('auth.exported'), 'ok');
      }, 'ghost', ICONS.upload),
      actionButton(t('replays.delete'), async () => {
        const next = await guard(tvm.auth.remove(item.id), 'Error');
        if (next) { state.auth = { ...state.auth, ...next }; renderAuth(); }
      }, 'danger', ICONS.trash)
    );

    row.append(body, actions);
    list.append(row);
  }
}

async function activateAuth(id) {
  const next = await guard(tvm.auth.activate(id), 'Error');
  if (!next) return;
  state.auth = { ...state.auth, ...next };
  renderAuth();
  // HaxBall lee la identidad al arrancar: salir a la sala (lobby) fuerza una
  // recarga en blanco que inyecta la nueva Auth sin reconectarte al host.
  await guard(tvm.rooms.leave(), 'Error');
  toast(t('auth.switched'), 'ok');
}

async function renameAuth(item) {
  const name = await ask({
    title: t('auth.rename'),
    label: t('auth.nameLabel'),
    value: item.name,
    maxLength: 32
  });
  if (name === null || !name.trim()) return;
  const next = await guard(tvm.auth.rename(item.id, name.trim()), 'Error');
  if (next) { state.auth = { ...state.auth, ...next }; renderAuth(); }
}

$('#authSave').addEventListener('click', async () => {
  const name = await ask({
    title: t('auth.saveCurrent'),
    label: t('auth.nameLabel'),
    value: state.config.general.nickname || '',
    hint: t('auth.saveHint'),
    maxLength: 32
  });
  if (name === null) return;
  const next = await guard(tvm.auth.saveCurrent(name.trim()), 'Error');
  if (next) { await loadAuth(); toast(t('auth.saved'), 'ok'); }
});

$('#authAdd').addEventListener('click', async () => {
  const key = await ask({
    title: t('auth.add'),
    label: t('auth.keyLabel'),
    hint: t('auth.keyHint'),
    maxLength: 1024,
    ok: t('ask.ok')
  });
  if (key === null || !key.trim()) return;

  const name = await ask({
    title: t('auth.add'),
    label: t('auth.nameLabel'),
    maxLength: 32
  });
  if (name === null) return;

  const next = await guard(tvm.auth.add({ name: name.trim(), key: key.trim() }), 'Error');
  if (next) { await loadAuth(); toast(t('auth.saved'), 'ok'); }
});

/* ══════════════════════════════════════════════════════════
   Ajustes
   ══════════════════════════════════════════════════════════ */
const SYSTEM_SWITCHES = {
  es: [
    { key: 'launchOnStartup', label: 'Abrir con Windows', description: 'El cliente arranca al iniciar sesión.' },
    { key: 'confirmOnExit', label: 'Confirmar antes de cerrar', description: 'Sólo pregunta si estás en medio de una partida.' },
    { key: 'welcomeSummary', label: 'Resumen al abrir', description: 'Muestra tu racha, partidos, goles y horas jugadas en la pantalla de inicio.' }
  ],
  en: [
    { key: 'launchOnStartup', label: 'Launch with Windows', description: 'The client starts when you log in.' },
    { key: 'confirmOnExit', label: 'Confirm before closing', description: 'Only asks if you are in a match.' },
    { key: 'welcomeSummary', label: 'Summary on start', description: 'Shows your streak, matches, goals and hours played on the start screen.' }
  ]
};

/**
 * Bandera con la que te ven en las salas. HaxBall la deduce de la conexión y
 * guarda el resultado, pero respeta un override: es lo que se escribe acá.
 */
function renderCountry() {
  const select = $('#countrySelect');
  const current = state.config.countryOverride || '';

  if (!select.options.length) {
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = t('flag.auto');
    select.append(auto);
    for (const country of state.schema.countries) {
      const option = document.createElement('option');
      option.value = country.code;
      option.textContent = country.name;
      select.append(option);
    }
  }

  select.value = current;
  paintCountryFlag(current);
}

function paintCountryFlag(code) {
  const box = $('#countryFlag');
  const position = code && state.flags && state.flags.positions[code.toUpperCase()];
  if (position) {
    box.className = 'flagrow__flag';
    box.style.backgroundPosition = `${position[0]}px ${position[1]}px`;
    box.textContent = '';
  } else {
    box.className = 'flagrow__flag flagrow__flag--text';
    box.style.backgroundPosition = '';
    box.textContent = code ? code.toUpperCase() : '🌐';
  }
}

$('#countrySelect').addEventListener('change', async (e) => {
  await patchConfig({ countryOverride: e.target.value });
  paintCountryFlag(e.target.value);
  scheduleGameReload();
});

function renderSettings() {
  const lang = isEn() ? 'en' : 'es';
  $('#nickname').value = state.config.general.nickname;
  $('#langSelect').value = state.config.appearance.language || 'es';
  
  // La lista, la opción elegida y las casillas del tamaño a mano salen todas
  // de acá: dependen de la pantalla, así que no se pueden escribir una vez.
  syncResolutionOptions();

  renderCountry();

  buildSwitches(
    $('#systemSwitches'),
    SYSTEM_SWITCHES[lang].map((i) => ({ ...i, value: () => state.config.general[i.key] })),
    (item, value) => patchConfig({ general: { [item.key]: value } })
  );

  renderGameSettings($('#gameSound'), 'sound');
  renderNotify();
  renderAbout();
}

/* ══════════════════════════════════════════════════════════
   Resolución del juego
   ══════════════════════════════════════════════════════════
   Lo que se elige acá es el tamaño de la CANCHA en píxeles CSS: el iframe del
   juego se dibuja a ese tamaño y se estira hasta llenar la ventana (o la
   pantalla entera). `'auto'` es no estirar: la cancha mide lo que la ventana.
   Ver el bloque «Resolución» más abajo y `applyGameViewport` en game-preload.js.

   El techo sigue siendo el monitor, y no «la resolución del monitor» a secas:
   es su tamaño EN PÍXELES CSS, que en Windows con escalado al 150 % es dos
   tercios de los píxeles físicos. Una superficie más grande que eso no aporta
   detalle —Chromium compone más píxeles y después los reduce— y en drivers
   viejos era el camino al cuadro negro de las transiciones.

   El límite lo manda el proceso principal en cada `win:state`, y ese aviso sale
   también cuando cambia la configuración de pantallas (ver `syncActiveDisplay`
   en main.js), así que enchufar un monitor o cambiar la resolución de Windows
   con el cliente abierto vuelve a armar esta lista sola.
   ══════════════════════════════════════════════════════════ */

/** Lo más chico que tiene sentido: es también el mínimo que acepta el main. */
const RES_MIN = { w: 640, h: 480 };

/**
 * Los tamaños que se ofrecen, de mayor a menor.
 *
 * Se listan todos, pero sólo se dibujan los que entran. La lista está escrita
 * acá y no en el HTML justamente porque no es fija: depende de la pantalla.
 */
const RES_PRESETS = [
  { w: 2560, h: 1440, note: '16:9' },
  { w: 1920, h: 1080, note: '16:9' },
  { w: 1600, h: 900, note: '16:9' },
  { w: 1366, h: 768, note: '16:9' },
  { w: 1360, h: 860, note: null },
  { w: 1280, h: 720, note: '16:9' },
  { w: 1080, h: 1080, note: '1:1' },
  { w: 1024, h: 768, note: '4:3' },
  { w: 800, h: 600, note: '4:3' }
];

/** Límite del monitor activo, en las mismas unidades CSS que la ventana. */
function displayResolutionLimit() {
  const size = state.display && state.display.size;
  const w = Math.round(Number(size && size.width) || 0);
  const h = Math.round(Number(size && size.height) || 0);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** ¿Entra este tamaño en la pantalla? Sin pantalla conocida, se deja pasar. */
function resFits(w, h) {
  const limit = displayResolutionLimit();
  return !limit || (w <= limit.w && h <= limit.h);
}

/**
 * Recorta un tamaño a lo que entra, conservando la proporción.
 *
 * El piso por eje va DESPUÉS de escalar y no es cosmético: escalar solo podía
 * dejar un lado por debajo del mínimo. Con «8000×600» en un 1920×1080 la escala
 * es 0,24 y el alto terminaba en 144 px — más chico que los 480 que el propio
 * proceso principal exige, así que se guardaba en la config un tamaño que la
 * ventana después no respetaba, y la cancha quedaba con una proporción que no
 * eligió nadie.
 */
function clampResolution(w, h) {
  const limit = displayResolutionLimit();
  let outW = Math.round(w);
  let outH = Math.round(h);

  if (limit && (outW > limit.w || outH > limit.h)) {
    const scale = Math.min(limit.w / outW, limit.h / outH);
    outW = Math.round(outW * scale);
    outH = Math.round(outH * scale);
  }

  const maxW = limit ? Math.max(RES_MIN.w, limit.w) : Infinity;
  const maxH = limit ? Math.max(RES_MIN.h, limit.h) : Infinity;
  outW = Math.min(maxW, Math.max(RES_MIN.w, outW));
  outH = Math.min(maxH, Math.max(RES_MIN.h, outH));

  return { w: outW, h: outH, clamped: outW !== Math.round(w) || outH !== Math.round(h) };
}

function resLabel(preset) {
  const partes = [`${preset.w}x${preset.h}`];
  if (preset.default) partes.push(`(${t('settings.resDefaultTag')})`);
  else if (preset.note) partes.push(`(${preset.note})`);
  return partes.join(' ');
}

/**
 * Arma la lista de resoluciones con las que entran en la pantalla.
 *
 * Antes las que no entraban se dibujaban igual, deshabilitadas y con un «no
 * compatible con esta pantalla» pegado al final. Eran cuatro renglones que sólo
 * servían para decir que no, en un desplegable de seis. Ahora directamente no
 * están.
 *
 * La única que se cuela sin cumplir el filtro es la que está puesta en la
 * config: si el monitor cambió y ya no entra, sigue apareciendo —marcada— para
 * que el desplegable no mienta sobre lo que hay guardado.
 */
function syncResolutionOptions() {
  const select = $('#resSelect');
  if (!select) return;

  const limit = displayResolutionLimit();
  const actual = String(state.config.general.resolution || 'auto');
  const [actualW, actualH] = actual.split('x').map(Number);
  const esPreset = RES_PRESETS.some((p) => `${p.w}x${p.h}` === actual);

  select.replaceChildren();
  // Primero «como la ventana»: la cancha del tamaño que tenga, sin estirar.
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = t('settings.resAuto');
  select.append(auto);
  for (const preset of RES_PRESETS) {
    if (!resFits(preset.w, preset.h)) continue;
    const option = document.createElement('option');
    option.value = `${preset.w}x${preset.h}`;
    option.textContent = resLabel(preset);
    select.append(option);
  }

  // Lo guardado, si es un preset que dejó de entrar. Un tamaño a mano no hace
  // falta agregarlo: para eso está «Personalizada…», que lo muestra en sus dos
  // casillas.
  if (esPreset && !resFits(actualW, actualH)) {
    const option = document.createElement('option');
    option.value = actual;
    option.textContent = `${actual} — ${t('settings.resTooBig')}`;
    select.append(option);
  }

  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = t('settings.resCustom');
  select.append(custom);

  // Y recién ahora se elige: escribir `value` antes de que existan las opciones
  // no selecciona nada y deja el desplegable en la primera.
  const propio = !select.querySelector(`option[value="${actual}"]`);
  select.value = propio ? 'custom' : actual;
  $('#resCustomWrap').hidden = !propio;
  if (propio) {
    $('#resCustomW').value = actualW || '';
    $('#resCustomH').value = actualH || '';
  }

  const width = $('#resCustomW');
  const height = $('#resCustomH');
  if (width) { width.min = String(RES_MIN.w); width.max = limit ? String(limit.w) : ''; }
  if (height) { height.min = String(RES_MIN.h); height.max = limit ? String(limit.h) : ''; }

  const nota = $('#resMaxNote');
  if (nota) nota.textContent = [t('settings.resHint'), limit ? t('settings.resMax', { w: limit.w, h: limit.h }) : ''].filter(Boolean).join(' ');
  const notaCustom = $('#resCustomNote');
  if (notaCustom) {
    notaCustom.textContent = limit
      ? t('settings.resRange', { minW: RES_MIN.w, minH: RES_MIN.h, maxW: limit.w, maxH: limit.h })
      : '';
  }
}

/**
 * La pantalla cambió: revisar que lo guardado siga siendo posible.
 *
 * Pasa de verdad —desenchufar el monitor de al lado, cambiar la resolución de
 * Windows, abrir el cliente en la notebook después de usarlo en el monitor
 * grande— y sin esto la config se quedaba con un tamaño que ninguna ventana
 * podía tener: el main lo recortaba en silencio en cada arranque y el
 * desplegable seguía mostrando el número viejo.
 */
async function reconcileResolution() {
  const limit = displayResolutionLimit();
  if (!limit) return;
  const [w, h] = String(state.config.general.resolution || '').split('x').map(Number);
  if (!(w > 0 && h > 0) || resFits(w, h)) return;

  const fixed = clampResolution(w, h);
  await patchConfig({ general: { resolution: `${fixed.w}x${fixed.h}` } });
  syncResolutionOptions();
  toast(t('toast.resDisplayChanged', { w: fixed.w, h: fixed.h }), '');
  if (state.applyResolution) await state.applyResolution();
}

/* ── Avisos de amigos ───────────────────────────────────── *
 * Lo que se apaga acá es el TONO, no el cartel: ver `notifySound()`. */
const NOTIFY_SWITCHES = {
  es: [
    { key: 'messages', label: 'Mensajes', description: 'Cuando un amigo te escribe.' },
    { key: 'invites', label: 'Invitaciones', description: 'Cuando un amigo te invita a su sala.' },
    { key: 'requests', label: 'Solicitudes de amistad', description: 'Cuando alguien te quiere agregar.' }
  ],
  en: [
    { key: 'messages', label: 'Messages', description: 'When a friend writes to you.' },
    { key: 'invites', label: 'Invites', description: 'When a friend invites you to their room.' },
    { key: 'requests', label: 'Friend requests', description: 'When someone wants to add you.' }
  ]
};

function renderNotify() {
  const lang = isEn() ? 'en' : 'es';
  buildSwitches(
    $('#notifySwitches'),
    NOTIFY_SWITCHES[lang].map((i) => ({ ...i, value: () => !!state.config.notify[i.key] })),
    (item, value) => patchConfig({ notify: { [item.key]: value } })
  );

  const volume = state.config.notify.volume ?? 0.5;
  $('#notifyVolume').value = volume;
  $('#notifyVolumeValue').textContent = `${Math.round(volume * 100)}%`;
  syncRangeFill($('#notifyVolume'));
}

$('#notifyVolume').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#notifyVolumeValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});

$('#notifyVolume').addEventListener('change', (e) => {
  const volume = Number(e.target.value);
  patchConfig({ notify: { volume } });
  /*
   * Y una prueba, al soltar y no al arrastrar: elegir un volumen sin oírlo es
   * elegir a ciegas. Suena el de mensajes —el que más va a sonar— y se toca
   * derecho en vez de por `notifySound()`, que respeta el interruptor: acá el
   * usuario pidió escucharlo.
   */
  if (volume) playTones(NOTIFY_TONES.messages, volume);
});

const DISCORD_SWITCHES = {
  es: [
    { key: 'enabled', label: 'Mostrar en Discord', description: 'Muestra que estás usando TL App y si estás en una sala.' },
    { key: 'showRoom', label: 'Mostrar el nombre de la sala', description: 'Si lo apagás sólo dice dónde estás.' },
  ],
  en: [
    { key: 'enabled', label: 'Show on Discord', description: 'Shows that you are using TL App and whether you are in a room.' },
    { key: 'showRoom', label: 'Show the room name', description: 'If off it only says where you are.' },
  ]
};

function renderDiscord() {
  const lang = isEn() ? 'en' : 'es';
  buildSwitches(
    $('#discordSwitches'),
    DISCORD_SWITCHES[lang].map((i) => ({ ...i, value: () => state.config.discord[i.key] })),
    async (item, value) => {
      await patchConfig({ discord: { [item.key]: value } });
      applyDiscord();
    }
  );
}

async function applyDiscord() {
  try {
    const res = await tvm.discord.apply();
    $('#discordStatus').textContent = res.message;
    $('#discordStatus').className = `statusline${res.status === 'on' ? ' is-ok' : res.status === 'error' ? ' is-err' : ''}`;
    if (res.status === 'on') pushPresence();
  } catch (err) {
    $('#discordStatus').textContent = err.message;
    $('#discordStatus').className = 'statusline is-err';
  }
}

/* ══════════════════════════════════════════════════════════
   Actualizaciones
   ══════════════════════════════════════════════════════════
   El feed y los instaladores viven en un bucket de Cloudflare R2. Acá sólo se
   pide, se muestra el progreso y se lanza el instalador; toda la lógica (y la
   verificación del sha256) está en el proceso principal.
   ══════════════════════════════════════════════════════════ */
const UPDATE_SWITCH = {
  es: { label: 'Buscar al abrir', description: 'Consulta el feed una vez por arranque.', hint: 'No descarga nada por su cuenta: sólo avisa.' },
  en: { label: 'Check on launch', description: 'Queries the feed once per start.', hint: 'It never downloads anything on its own: it only tells you.' }
};

function renderUpdates() {
  const lang = isEn() ? 'en' : 'es';

  buildSwitches($('#updateSwitches'), [{
    ...UPDATE_SWITCH[lang],
    key: 'autoCheck',
    value: () => !!state.config.updates.autoCheck
  }], (item, value) => patchConfig({ updates: { [item.key]: value } }));

  // El cartel de arriba tiene sus textos armados a mano: sin esto se quedaría
  // en el idioma anterior, porque no lleva data-i18n.
  paintUpdateNotice();
}

/* ── El cartel de versión nueva ────────────────────────────────────────────
 *
 * Antes esto era un toast: cuatro segundos, y si estabas jugando ni lo veías.
 * Enterarse de una versión nueva no es una confirmación al pasar — es lo mismo
 * que el aviso de reinicio, y por eso comparte su forma: barra fija arriba, sin
 * temporizador, y se va cuando actuás o la descartás.
 *
 * La descarga pasa ACÁ ADENTRO, no en Ajustes → Actualizaciones: mandar a la
 * persona a buscar la pestaña era el motivo por el que nadie actualizaba. La
 * página de ajustes sigue estando y sigue funcionando igual — las dos miran el
 * mismo `tvm.updates` y el progreso se pinta en los dos lados.
 */
function paintUpdateNotice() {
  const bar = $('#updateNotice');
  const { phase, latest } = state.update;
  bar.hidden = phase === 'idle';
  if (bar.hidden) return;

  const busy = phase === 'downloading';
  const done = phase === 'ready';

  $('#updateNoticeTitle').textContent = done
    ? t('update.readyTitle', { v: latest })
    : t('update.title');

  $('#updateNoticeText').textContent = done
    ? t('update.readyText')
    : busy
      ? t('update.downloading', { v: latest })
      : phase === 'failed'
        ? t('update.failed')
        : t('update.text', { v: latest, now: (state.info && state.info.version) || '' });

  const go = $('#updateNoticeGo');
  setButtonLabel(go, done
    ? t('update.install')
    : phase === 'failed'
      ? t('update.retry')
      : t('update.get'));
  go.disabled = busy;

  // Descartar mientras baja dejaría la descarga corriendo sin nada que la
  // muestre: mientras hay progreso, el único camino es esperar.
  $('#updateNoticeLater').disabled = busy;

  $('#updateNoticeBar').hidden = !busy;
  $('#updateNoticeFill').style.transform = `scaleX(${Math.min(1, Math.max(0, state.update.percent / 100))})`;
}

/** @param {'idle'|'available'|'downloading'|'ready'|'failed'} phase */
function setUpdatePhase(phase, extra = {}) {
  state.update = { ...state.update, phase, ...extra };
  paintUpdateNotice();
}

$('#updateNoticeLater').addEventListener('click', () => setUpdatePhase('idle', { dismissed: true }));

$('#updateNoticeGo').addEventListener('click', () =>
  (state.update.phase === 'ready' ? installUpdate() : downloadUpdate()));

function setUpdateStatus(message, kind = '') {
  $('#updateStatus').textContent = message;
  $('#updateStatus').className = `statusline${kind ? ` is-${kind}` : ''}`;
}

/** @param {boolean} downloading Mientras baja, no se puede volver a pedir. */
function syncUpdateButtons({ canDownload = false, canInstall = false, downloading = false } = {}) {
  $('#updateCheck').disabled = downloading;
  $('#updateDownload').hidden = !canDownload;
  $('#updateDownload').disabled = downloading;
  $('#updateInstall').hidden = !canInstall;
}

async function checkUpdates({ silent = false } = {}) {
  if (!silent) setUpdateStatus(t('settings.checking'));
  let res;
  try {
    res = await tvm.updates.check();
  } catch (err) {
    if (!silent) setUpdateStatus(err.message, 'err');
    return null;
  }

  $('#updateNotes').textContent = res.notes || '';
  $('#updateNotes').hidden = !res.notes;
  setUpdateStatus(res.message, res.status === 'available' ? 'ok' : '');
  syncUpdateButtons({ canDownload: !!res.canDownload });

  /*
   * La novedad se avisa con el cartel de arriba, esté donde esté el usuario.
   * Antes era un toast de cuatro segundos: si estabas jugando no lo veías, y si
   * lo veías tenías que ir a buscar la pestaña de Actualizaciones igual.
   *
   * Sólo se levanta si `canDownload`: una versión anunciada sin instalador no
   * tiene ningún botón que ofrecer, y el mensaje ya está en la pestaña.
   */
  if (res.status === 'available' && res.canDownload) {
    state.update.latest = res.latest;
    // «Ahora no» vale para toda la sesión: buscar de nuevo desde la pestaña de
    // Actualizaciones no puede resucitar un cartel que se cerró a propósito.
    if (state.update.phase === 'idle' && !state.update.dismissed) {
      setUpdatePhase('available', { percent: 0 });
    } else {
      paintUpdateNotice();
    }
  }
  return res;
}

function paintUpdateProgress(progress) {
  // El cartel de arriba y la pestaña de ajustes miran la misma descarga: la
  // baje el que la baje, las dos barras tienen que moverse.
  if (state.update.phase === 'downloading') {
    state.update.percent = progress.percent == null ? 0 : progress.percent;
    $('#updateNoticeFill').style.transform =
      `scaleX(${Math.min(1, Math.max(0, state.update.percent / 100))})`;
  }

  $('#updateProgress').hidden = false;
  const fill = $('#updateProgressFill');
  if (progress.percent == null) {
    fill.classList.add('is-indeterminate');
    $('#updateProgressText').textContent = formatBytes(progress.received);
    return;
  }
  fill.classList.remove('is-indeterminate');
  // Escala en vez de ancho: ver el comentario de .progress__bar en app.css.
  fill.style.transform = `scaleX(${Math.min(1, Math.max(0, progress.percent / 100))})`;
  $('#updateProgressText').textContent = `${progress.percent}% · ${formatBytes(progress.received)}`;
}

$('#updateCheck').addEventListener('click', () => checkUpdates());

/**
 * Baja el instalador.
 *
 * La llaman las dos puertas —el cartel de arriba y el botón de la pestaña— y es
 * la MISMA descarga, así que las dos vistas se mueven juntas: no puede pasar que
 * el cartel diga «Actualizar» mientras la pestaña ya está bajando.
 */
async function downloadUpdate() {
  if (state.update.phase === 'downloading') return;
  setUpdatePhase('downloading', { percent: 0 });
  syncUpdateButtons({ downloading: true });
  setUpdateStatus(t('settings.downloading'));
  $('#updateProgress').hidden = false;

  const res = await guard(tvm.updates.download(), 'Error');
  $('#updateProgress').hidden = true;

  if (!res) {
    setUpdatePhase('failed');
    setUpdateStatus(t('settings.downloadFailed'), 'err');
    syncUpdateButtons({ canDownload: true });
    return;
  }
  setUpdatePhase('ready', { latest: res.version });
  setUpdateStatus(t(res.verified ? 'settings.readyVerified' : 'settings.ready', { v: res.version }), 'ok');
  syncUpdateButtons({ canInstall: true });
}

/** Instalar cierra el cliente: si hay partido, se avisa igual que al reiniciar. */
async function installUpdate() {
  if (state.playing && !window.confirm(t('perf.restartConfirm'))) return;
  await guard(tvm.updates.install(), 'Error');
}

$('#updateDownload').addEventListener('click', () => downloadUpdate());
$('#updateInstall').addEventListener('click', () => installUpdate());

/**
 * Le cuenta a Discord dónde estás: menú, sala o partida.
 *
 * El nombre sale primero del propio HaxBall (`state.gameRoomName`, que manda el
 * preload leyendo el título de la sala) y, mientras ése no llegue, del nombre
 * de la sala a la que se pidió entrar o que se acaba de crear.
 *
 * Acá antes se usaba la fila MARCADA en nuestra lista, y eso mostraba salas que
 * no eran: al crear una sala seguía marcada la que hubieras tocado antes en el
 * navegador de salas, así que Discord anunciaba esa otra sala en vez de la
 * recién creada. Marcar una fila no es estar en esa sala.
 */
function pushPresence() {
  if (!state.config.discord.enabled) return;

  // Un replay no es una sala: lo que se muestra es el nombre de la grabación,
  // que es lo único que identifica lo que estás mirando.
  const replay = state.gameView === 'replay';
  const name = replay ? state.replayName : (state.gameRoomName || state.joinedRoomName);
  const place = state.stage !== 'game' ? 'menu' : replay ? 'replay' : state.playing ? 'game' : 'room';

  tvm.discord.presence({
    place,
    room: state.stage === 'game' ? name : null
  }).catch(() => {});
}

/* ══════════════════════════════════════════════════════════
   Tu carrera: estadísticas, nivel y racha
   ══════════════════════════════════════════════════════════
   Los números se cuentan siempre, con sesión o sin ella: son tuyos y se guardan
   en tu PC. La sesión de Discord hace falta para VERLOS, que es lo que los
   convierte en un perfil y no en un contador suelto.

   La experiencia no se guarda: se calcula a partir de las estadísticas. Así no
   hay dos verdades que puedan quedar desincronizadas, y el sitio puede sacar el
   mismo nivel de los mismos números.
   ══════════════════════════════════════════════════════════ */

/** Cuánto vale cada cosa. Un gol es más que un partido; jugar también suma. */
const XP = { goals: 12, assists: 8, matches: 5, ownGoals: 0, perTenMinutes: 2 };

function xpOf(stats) {
  return Math.max(0,
    (stats.goals || 0) * XP.goals +
    (stats.assists || 0) * XP.assists +
    (stats.matches || 0) * XP.matches +
    Math.floor((stats.secondsPlayed || 0) / 600) * XP.perTenMinutes);
}

/**
 * Nivel y progreso dentro del nivel.
 *
 * Del nivel L al L+1 hacen falta `50L + 50` XP (100, 150, 200, …), o sea que
 * para llegar al nivel L hacen falta `25 (L-1)(L+2)` en total. Invertir esa
 * cuadrática da el nivel de una, sin recorrer niveles uno por uno.
 */
function levelOf(xp) {
  const total = (l) => 25 * (l - 1) * (l + 2);
  const level = Math.max(1, Math.floor((-1 + Math.sqrt(9 + (4 * xp) / 25)) / 2));
  return { level, into: xp - total(level), need: 50 * level + 50 };
}

function renderAbout() {
  paintDefList($('#aboutList'), [
    [t('settings.version'), `v${state.info.version}`],
    [t('settings.configFile'), state.info.configPath]
  ]);

}

/** Suma lo que acaba de pasar y repinta con lo que devolvió el disco. */
function addStats(patch) {
  return tvm.stats.add(patch).then((stats) => {
    if (!stats) return;
    state.config.stats = stats;
  }).catch(() => { /* no es crítico */ });
}


$('#langSelect').addEventListener('change', async (e) => {
  await patchConfig({ appearance: { language: e.target.value } });
  renderAll();
  renderRooms();
  renderTabs();
});

$('#resSelect').addEventListener('change', async (e) => {
  const val = e.target.value;
  if (val === 'custom') {
    $('#resCustomWrap').hidden = false;
    return;
  }
  $('#resCustomWrap').hidden = true;
  await patchConfig({ general: { resolution: val } });
  // Antes acá se disparaba un `resize` a mano, que no redimensionaba nada: sólo
  // repintaba con el mismo tamaño de siempre. Ahora se pide el tamaño de verdad.
  if (state.applyResolution) await state.applyResolution();
});

/*
 * El tamaño a mano se recorta MIENTRAS se escribe, no sólo al aplicar.
 *
 * El atributo `max` de un `<input type=number>` no impide tipear de más: pinta
 * el campo como inválido y nada más. Sin esto se podía dejar «9999» escrito, y
 * lo que quedaba guardado era otro número — el recortado— sin que la casilla se
 * enterara nunca.
 */
for (const [id, eje] of [['#resCustomW', 'w'], ['#resCustomH', 'h']]) {
  $(id).addEventListener('change', (e) => {
    const limit = displayResolutionLimit();
    const n = parseInt(e.target.value, 10);
    if (!Number.isFinite(n)) return;
    const max = limit ? limit[eje] : Infinity;
    e.target.value = String(Math.min(max, Math.max(RES_MIN[eje], n)));
  });
}

$('#resCustomApply').addEventListener('click', async (e) => {
  e.preventDefault();
  const w = parseInt($('#resCustomW').value, 10);
  const h = parseInt($('#resCustomH').value, 10);
  if (!(w >= RES_MIN.w && h >= RES_MIN.h)) {
    toast(t('toast.resMin'), 'err');
    return;
  }
  // `clampResolution` reduce los dos lados juntos para no deformar la cancha y
  // recién después le pone el piso a cada eje. El porqué del orden está en su
  // propio comentario.
  const fixed = clampResolution(w, h);
  $('#resCustomW').value = fixed.w;
  $('#resCustomH').value = fixed.h;
  if (fixed.clamped) toast(t('toast.resClamped'), '');
  await patchConfig({ general: { resolution: `${fixed.w}x${fixed.h}` } });
  if (state.applyResolution) await state.applyResolution();
});

$('#nickname').addEventListener('change', async (e) => {
  await patchConfig({ general: { nickname: e.target.value.trim() } });
  renderNickCard();
  toast(t('toast.nickSaved'), 'ok');
  scheduleGameReload();
});

$('#cfgExport').addEventListener('click', async () => {
  const res = await guard(tvm.config.export(), 'Error');
  if (res && res.saved) toast(t('toast.exported'), 'ok');
});

$('#cfgImport').addEventListener('click', async () => {
  const res = await guard(tvm.config.import(), 'Error');
  if (res && res.imported) {
    applyConfig(res.config);
    state.schema = await tvm.config.schema();
    await refreshThemeVars();
    renderAll();
    toast(t('toast.imported'), 'ok');
  }
});

$('#cfgReset').addEventListener('click', async () => {
  if (!window.confirm(t('settings.resetConfirm'))) return;
  const next = await guard(tvm.config.reset(), 'Error');
  if (next) {
    applyConfig(next);
    await refreshThemeVars();
    renderAll();
    toast(t('toast.reset'), 'ok');
  }
});

/* ══════════════════════════════════════════════════════════
   El juego
   ══════════════════════════════════════════════════════════ */
/**
 * Montar el juego, pero sólo si hay juego al que entrar.
 *
 * Con HaxBall caído —o con el muro de Cloudflare puesto— apuntar el `<webview>`
 * al sitio cierra el cliente entero a los pocos segundos: se cae Chromium al
 * confirmar esa navegación, sin pasar por JavaScript y sin dejar nada en el log
 * (el detalle está en `main.js`, en la sección «HaxBall caído»). Por eso se
 * pregunta antes y, si no está, no se monta nada: se muestra el cartel y se
 * espera a que vuelva, que el main avisa solo.
 */
async function mountGame() {
  const health = await tvm.game.health().catch(() => ({ down: false, reason: '' }));
  if (health.down) return showGameDown(health.reason);
  createGameTab();
}

/* ══════════════════════════════════════════════════════════
   Pestañas de juego
   ══════════════════════════════════════════════════════════
   Cada pestaña es un `<webview>` más apuntado a HaxBall, en la MISMA partición:
   comparten identidad, apodo y ajustes —es el mismo jugador— y nada más. Así se
   puede estar en una sala esperando el partido y, mientras, practicar un x1 en
   otra.

   Sólo una se ve: la activa. Las demás se quedan montadas donde están, de un
   píxel e invisibles (`.is-bg` en app.css), con la sala y la conexión vivas
   pero en silencio y a diez cuadros por segundo. No se mueven en el DOM ni se
   esconden con `display: none`: lo primero recarga el `<webview>` y lo segundo
   lo congela (el porqué, medido, está en app.css).

   Lo que la interfaz sabe «del juego» —qué pantalla tiene puesta, en qué sala
   está, si juega, los goles del partido— es de UNA pestaña. Vive en `state`
   para la activa, y al cambiar se guarda en `tab.snap` y se repone el de la
   otra (`snapshotTab`/`restoreTab`). Los avisos del proceso principal llegan
   con la marca de qué pestaña los mandó (`meta.tab`), y `tabBucket` decide si
   van a `state` o al bolsillo de una de atrás.
   ══════════════════════════════════════════════════════════ */

/** Más que esto son procesos de Chromium de más; cada uno es un HaxBall entero. */
const MAX_GAME_TABS = 4;

/** Lo que es de una pestaña y no de la app. Mismos nombres que en `state`. */
const TAB_FIELDS = ['gameView', 'gameRoomName', 'joinedRoomName', 'playing', 'liveGameSettings',
  'liveGoals', 'heatmap', 'matchCard', 'summary', 'summaryError', 'replayPath', 'replayName',
  'playedSeconds'];

function freshSnap() {
  return {
    gameView: null, gameRoomName: null, joinedRoomName: null, playing: false,
    liveGameSettings: false, liveGoals: [], heatmap: null, matchCard: null,
    summary: null, summaryError: null, replayPath: null, replayName: null, playedSeconds: 0
  };
}

let tabSeq = 0;

/**
 * Monta un HaxBall nuevo y lo pone al frente.
 *
 * El `<webview>` se agrega al lado de los que ya hay, nunca en lugar de ellos.
 * Antes acá había un `replaceChildren`, que con una sola pestaña era lo mismo.
 */
function createGameTab() {
  if (state.tabs.length >= MAX_GAME_TABS) {
    toast(t('tabs.max', { n: MAX_GAME_TABS }), 'err');
    return null;
  }

  const view = document.createElement('webview');
  const tab = { id: ++tabSeq, wcId: null, view, snap: freshSnap() };
  view.className = 'is-bg';
  view.dataset.tab = String(tab.id);
  view.setAttribute('src', state.config.general.gameUrl);
  view.setAttribute('partition', 'persist:haxball');
  view.setAttribute('preload', pathToFileUrl(state.info.gamePreload));
  view.setAttribute('allowpopups', '');
  view.setAttribute('webpreferences', 'contextIsolation=no,sandbox=no,nodeIntegration=no,backgroundThrottling=no');

  // Ojo: NO se oculta la carga en 'dom-ready'. Ahí HaxBall todavía está sin
  // estilar y se veía un parpadeo del diseño original. Se espera a que el
  // preload avise que ya aplicó el tema (game:themed) y a que la pantalla sea
  // una de verdad.
  view.addEventListener('dom-ready', () => {
    if (tab === state.activeTab) $('#stageError').hidden = true;
  });

  /*
   * El id del webContents es lo que ata los avisos del proceso principal
   * (`meta.tab`) con esta pestaña. Se toma apenas el invitado existe —antes de
   * que cargue nada— para que ni el primer `game:view` llegue sin dueño.
   */
  view.addEventListener('did-attach', () => {
    try { tab.wcId = view.getWebContentsId(); } catch { return; }
    // Una pestaña recién creada ya está al frente cuando el invitado aparece:
    // `activateTab` corrió sin id y no pudo avisar. Sin esto, el proceso
    // principal seguiría hablándole a la anterior —entrar a una sala desde la
    // nueva navegaría la vieja.
    if (tab === state.activeTab) tvm.tabs.activate(tab.wcId).catch(() => {});
  });

  view.addEventListener('did-fail-load', (e) => {
    // HaxBall carga publicidad de terceros que suele fallar: sólo nos importa
    // que se caiga el frame principal.
    if (!e.isMainFrame || e.errorCode === -3) return;
    // Y sólo de la pestaña que se está mirando: el cartel es uno solo.
    if (tab !== state.activeTab) return;
    // ERR_BLOCKED_BY_CLIENT: lo frenó el main porque el sitio no está en pie.
    // No es un error de carga; se pregunta el motivo para no decir «verificá»
    // cuando lo que pasa es que HaxBall está caído, ni al revés.
    if (e.errorCode === -20) {
      tvm.game.health()
        .then((h) => showGameDown(h.reason))
        .catch(() => showGameDown(''));
      return;
    }
    hideLoading();
    $('#stageError').hidden = false;
    $('#stageError').querySelector('h2').dataset.i18n = 'game.error';
    $('#stageError').querySelector('h2').textContent = t('game.error');
    // El detalle es el código de Chromium, que no se traduce: sin clave, para
    // que un cambio de idioma no lo reemplace por otro texto.
    delete $('#stageErrorText').dataset.i18n;
    $('#stageErrorText').textContent = `${e.errorDescription || ''} (${e.errorCode})`;
  });

  $('#stageFrame').append(view);
  state.tabs.push(tab);
  activateTab(tab);
  return tab;
}

/** La pestaña que mandó un aviso, o `null` si no dijo (o ya no está). */
function tabByMeta(meta) {
  if (!meta || meta.tab == null) return null;
  const found = state.tabs.find((tab) => tab.wcId === meta.tab);
  if (found) return found;
  // El id se toma en `did-attach`; si un aviso le ganó de mano y hay una sola
  // pestaña sin id, es ésa.
  const orphans = state.tabs.filter((tab) => tab.wcId == null);
  if (orphans.length === 1) { orphans[0].wcId = meta.tab; return orphans[0]; }
  return null;
}

/**
 * Dónde va lo que dijo el juego: a `state` si es la pestaña activa (o no se
 * sabe cuál es), al bolsillo de la pestaña si está atrás.
 *
 * @returns {{ s: object, active: boolean, tab: object|null }}
 */
function tabBucket(meta) {
  const tab = tabByMeta(meta);
  if (!tab || tab === state.activeTab) return { s: state, active: true, tab: tab || state.activeTab };
  return { s: tab.snap, active: false, tab };
}

function snapshotTab(tab) {
  for (const field of TAB_FIELDS) tab.snap[field] = state[field];
}

function restoreTab(tab) {
  for (const field of TAB_FIELDS) state[field] = tab.snap[field];
}

/** Dónde está una pestaña, con los mismos nombres que usa HaxBall (`game:view`). */
function tabView(tab) {
  return tab === state.activeTab ? state.gameView : tab.snap.gameView;
}

function tabInRoom(tab) {
  const kind = tabView(tab);
  return !!kind && kind !== 'roomlist';
}

/** El rótulo de la pestaña: la sala si está en una, si no en qué anda. */
function tabLabel(tab) {
  const s = tab === state.activeTab ? state : tab.snap;
  const kind = s.gameView;
  if (kind === 'replay') return s.replayName || t('tabs.replay');
  if (s.gameRoomName) return s.gameRoomName;
  if (s.joinedRoomName && kind !== 'roomlist') return s.joinedRoomName;
  if (!kind) {
    // Todavía no llegó el aviso de pantalla: se usa lo que la interfaz sí sabe.
    // En la lista de salas (escenario «browser») es el menú, no «Cargando…».
    if (tab === state.activeTab) return state.stage === 'game' ? t('tabs.connecting') : t('tabs.lobby');
    return t('tabs.loading');
  }
  if (kind === 'roomlist') return t('tabs.lobby');
  if (kind === 'connecting') return t('tabs.connecting');
  return t('tabs.room');
}

/** Para el punto de color: `game` jugando, `room` en una sala, `connecting`, `idle`. */
function tabState(tab) {
  const s = tab === state.activeTab ? state : tab.snap;
  if (s.playing) return 'game';
  if (s.gameView === 'connecting') return 'connecting';
  if (tabInRoom(tab)) return 'room';
  return 'idle';
}

/**
 * Pone una pestaña al frente.
 *
 * Lo de la que sale se guarda en su bolsillo y lo de la que entra se repone en
 * `state`, y recién después se le avisa al proceso principal —que es el que
 * silencia a la otra, le baja el ritmo y le da la prioridad a ésta— y se
 * vuelve a poner la pantalla que corresponde (`onGameView`), igual que si el
 * juego acabara de decirla.
 */
async function activateTab(tab) {
  if (!tab || tab === state.activeTab) return;
  const prev = state.activeTab;
  if (prev) {
    snapshotTab(prev);
    prev.view.classList.add('is-bg');
  }

  state.activeTab = tab;
  state.webview = tab.view;
  tab.view.classList.remove('is-bg');
  restoreTab(tab);
  renderTabs();

  // Lo que el proceso principal sabe de esta pestaña. Cubre lo que haya
  // pasado mientras la pestaña no tenía dueño (ver `tabByMeta`).
  if (tab.wcId != null) {
    const info = await tvm.tabs.activate(tab.wcId).catch(() => null);
    // Mientras se esperaba pudo cambiar otra vez.
    if (state.activeTab !== tab) return;
    if (info) {
      if (info.view && !state.gameView) state.gameView = info.view;
      if (info.room && !state.gameRoomName) state.gameRoomName = info.room;
      state.playing = !!info.playing;
      if (info.liveSettings) state.liveGameSettings = !!info.liveSettings.available;
    }
  }

  // La pantalla de esta pestaña, como si el juego acabara de decirla. Una que
  // todavía no dijo nada es la lista de salas sin velo, y sigue diciendo
  // «Cargando…» en la barra hasta que hable.
  if (state.gameView) onGameView(state.gameView);
  else { setStage('browser'); hideLoading(); pushPresence(); }
  renderTabs();
  if (state.repaintStats) state.repaintStats();
  focusGame();
}

/**
 * Cierra una pestaña. Sacar el `<webview>` del DOM destruye ese HaxBall, o sea
 * que si estaba en una sala, sale de ella: por eso se pregunta.
 */
function closeTab(tab) {
  if (!tab) return;
  if (state.tabs.length <= 1) {
    toast(t('tabs.last'), '');
    return;
  }
  if (tabInRoom(tab) && !window.confirm(t('tabs.closeConfirm', { name: tabLabel(tab) }))) return;

  const index = state.tabs.indexOf(tab);
  if (index < 0) return;
  state.tabs.splice(index, 1);

  if (tab === state.activeTab) {
    // Lo jugado en ésta se cuenta ahora: al reponer la otra, el contador es de ella.
    flushPlayTime();
    // Sin `snapshotTab`: la que se va no tiene a dónde volver.
    state.activeTab = null;
    state.webview = null;
    const next = state.tabs[Math.min(index, state.tabs.length - 1)];
    tab.view.remove();
    activateTab(next);
    return;
  }
  tab.view.remove();
  renderTabs();
}

function newGameTab() {
  if (state.tabs.length >= MAX_GAME_TABS) {
    toast(t('tabs.max', { n: MAX_GAME_TABS }), 'err');
    return;
  }
  if (!state.webview) {
    // Sin ninguna montada, «nueva» es la primera: pasa por la comprobación de
    // que HaxBall esté en pie, como al arrancar.
    mountGame();
    return;
  }
  const tab = createGameTab();
  if (tab && state.tabs.length === 2) toast(t('tabs.opened'), '');
}

function switchTab(step) {
  if (state.tabs.length < 2 || !state.activeTab) return;
  const index = state.tabs.indexOf(state.activeTab);
  const next = (index + step + state.tabs.length) % state.tabs.length;
  activateTab(state.tabs[next]);
}

/**
 * Dibuja la barra de pestañas. Se rehace entera: son cuatro botones como
 * mucho, y así el rótulo, el punto y el activo salen siempre del estado.
 */
function renderTabs() {
  const host = $('#gameTabs');
  if (!host) return;
  host.dataset.count = String(state.tabs.length);
  const nodes = state.tabs.map((tab) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `gametab${tab === state.activeTab ? ' is-active' : ''}`;
    btn.dataset.tab = String(tab.id);
    btn.dataset.state = tabState(tab);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', tab === state.activeTab ? 'true' : 'false');
    const label = tabLabel(tab);
    btn.title = label;

    const dot = document.createElement('i');
    dot.className = 'gametab__dot';
    const text = document.createElement('span');
    text.className = 'gametab__label';
    text.textContent = label;
    const close = document.createElement('span');
    close.className = 'gametab__x';
    close.dataset.close = String(tab.id);
    close.title = t('tabs.close');
    close.innerHTML = '<svg data-icon viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    btn.append(dot, text, close);
    return btn;
  });
  host.replaceChildren(...nodes);
  const add = $('#gameTabAdd');
  if (add) add.disabled = state.tabs.length >= MAX_GAME_TABS;
}

function tabById(id) {
  return state.tabs.find((tab) => String(tab.id) === String(id)) || null;
}

$('#gameTabs').addEventListener('click', (e) => {
  const close = e.target.closest('[data-close]');
  if (close) {
    e.stopPropagation();
    closeTab(tabById(close.dataset.close));
    return;
  }
  const btn = e.target.closest('.gametab');
  if (btn) activateTab(tabById(btn.dataset.tab));
});
// Botón del medio: cerrar, como en cualquier navegador.
$('#gameTabs').addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;
  const btn = e.target.closest('.gametab');
  if (btn) { e.preventDefault(); closeTab(tabById(btn.dataset.tab)); }
});
$('#gameTabAdd').addEventListener('click', newGameTab);

/**
 * Las teclas de pestañas. Adentro del juego las manda el preload (`tabs:key`):
 * Alt+T, Alt+W y Alt+1…4 — con Alt y no con Ctrl porque Ctrl es patear de
 * fábrica, ver `tabAction` en game-preload.js. Con el foco en la interfaz
 * valen ésas y también las de navegador (Ctrl+T, Ctrl+W, Ctrl+Tab).
 */
function onTabKey(action) {
  if (action === 'new') newGameTab();
  else if (action === 'close') closeTab(state.activeTab);
  else if (action === 'next') switchTab(1);
  else if (action === 'prev') switchTab(-1);
  else if (/^go:[1-4]$/.test(String(action))) {
    const tab = state.tabs[Number(action.slice(3)) - 1];
    if (tab) activateTab(tab);
  }
}
tvm.tabs.onKey(onTabKey);

/* ── HaxBall caído ──────────────────────────────────────────────────────── *
 *
 * El cartel es el mismo de siempre, con otro texto: acá no falló la conexión
 * del jugador, falló el sitio. Distinguirlo importa porque si no, el que lo lee
 * se pone a revisar su internet.                                            */

/**
 * El cliente sigue andando: es HaxBall el que no está.
 *
 * Hay dos casos distintos y conviene no mezclarlos. Si el sitio está caído no
 * queda más que esperar; pero si lo que hay es la verificación de Cloudflare,
 * eso se resuelve y se juega igual, así que se la muestra acá mismo para
 * pasarla, en vez de dejar al jugador mirando un cartel que no es cierto.
 */
function showGameDown(reason) {
  hideLoading();
  $('#stageError').hidden = false;

  const challenge = reason === 'challenge';
  const titleKey = challenge ? 'game.verify' : 'game.down';
  const textKey = challenge ? 'game.verifyText' : 'game.downText';

  const title = $('#stageError').querySelector('h2');
  // La clave se deja puesta, no sólo el texto: si el jugador cambia el idioma
  // con el cartel en pantalla, se retraduce éste y no el de «no se pudo cargar».
  title.dataset.i18n = titleKey;
  title.textContent = t(titleKey);
  $('#stageErrorText').dataset.i18n = textKey;
  $('#stageErrorText').textContent = t(textKey);

  const btnKey = challenge ? 'game.verifyBtn' : 'rooms.retry';
  $('#retryLoad').dataset.i18n = btnKey;
  setButtonLabel($('#retryLoad'), t(btnKey));

  // El hueco de la verificación sólo tiene sentido si hay muro que pasar.
  $('#verifyHost').hidden = !challenge;

  // Se muestra sola la primera vez —es lo que destraba el juego— pero no se
  // vuelve a pedir en cada consulta: el botón está ahí para eso.
  if (challenge && !state.verifyAsked) {
    state.verifyAsked = true;
    tvm.game.verify(verifyBounds()).catch(() => {});
  }
}

/**
 * Dónde va la verificación, en coordenadas de la ventana.
 *
 * El `BrowserView` lo pega el proceso principal y no sabe nada de este
 * documento, así que la medida sale de acá. `getBoundingClientRect()` ya da
 * píxeles independientes del dispositivo, que es lo que `setBounds` espera.
 */
function verifyBounds() {
  const host = $('#verifyHost');
  const box = host.getBoundingClientRect();
  // Con el hueco fuera de pantalla —otra pestaña abierta— la medida da cero.
  // Ahí se lo manda lejos en vez de dejarlo pegado arriba a la izquierda,
  // porque un BrowserView no se puede achicar hasta desaparecer.
  if (!box.width || !box.height) return { x: -20000, y: -20000, width: 10, height: 10 };
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

/**
 * Vuelve a decirle al main dónde va la verificación.
 *
 * El `BrowserView` vive por encima de este documento y no sabe que algo se
 * movió: no se acomoda con el layout ni se esconde al cambiar de pestaña. Hay
 * que avisarle en cada cambio de tamaño y en cada cambio de vista, o queda
 * flotando donde estaba el hueco antes, tapando lo que haya debajo.
 */
function syncVerifyBounds() {
  const host = $('#verifyHost');
  if (!host || host.hidden) return;
  // Fuera de la pantalla del juego no hay dónde ponerla: se la manda lejos.
  const onStage = state.view === 'play';
  tvm.game.verifyBounds(onStage ? verifyBounds() : { x: -20000, y: -20000, width: 10, height: 10 });
}

window.addEventListener('resize', syncVerifyBounds);

/*
 * El main mira cada tanto si volvió, así que esto llega solo: no hay que
 * quedarse tocando «Reintentar».
 */
tvm.game.onHealth(({ down, reason }) => {
  if (down) {
    // Si el juego ya estaba cargado se lo deja en paz: una partida empezada
    // sigue andando entre los jugadores aunque el sitio se haya caído.
    if (!state.webview) showGameDown(reason);
    return;
  }

  // Volvió: si más adelante hay otro muro, la verificación se vuelve a ofrecer.
  state.verifyAsked = false;
  $('#verifyHost').hidden = true;
  $('#stageError').hidden = true;
  if (!state.webview) {
    showLoading(t('game.loading'));
    mountGame();
  }
});

/* ── La pantalla de «Conectando…» ───────────────────────────────────────── *
 *
 * Se puede salir de acá. Antes no: si HaxBall no terminaba de conectar —sala
 * caída, red que se corta, o el propio juego colgado en su `.connecting-view`—
 * el velo se quedaba puesto para siempre y no había forma de volver a la lista
 * sin cerrar el cliente. El aviso aparece recién si tarda, para no sugerir que
 * algo anda mal cuando la conexión es normal.                               */

/** A partir de acá, una conexión normal ya tendría que haber entrado. */
const STUCK_AFTER_MS = 8000;

let stuckTimer = null;

function showLoading(text) {
  $('#loadingText').textContent = text;
  $('#stageLoading').classList.remove('is-hidden');

  $('#loadingHint').hidden = true;
  clearTimeout(stuckTimer);
  stuckTimer = setTimeout(() => {
    $('#loadingHint').hidden = false;
    if (state.stage !== 'game') return;
    if (!state.gameView || state.gameView === 'loading') {
      state.gameView = 'connecting';
      renderTabs();
    }
    hideLoading();
  }, STUCK_AFTER_MS);
}

function hideLoading() {
  clearTimeout(stuckTimer);
  stuckTimer = null;
  $('#loadingHint').hidden = true;
  $('#stageLoading').classList.add('is-hidden');
}

/** ¿Está el velo puesto? Es lo que decide si Escape cancela o no hace nada. */
function isLoadingVisible() {
  return state.stage === 'game' && !$('#stageLoading').classList.contains('is-hidden');
}

/**
 * Cancelar: se abandona el intento y se vuelve al navegador de salas.
 *
 * La interfaz se acomoda primero y el juego después. Si `rooms:leave` fallara
 * —el webview todavía no montado, por ejemplo—, el jugador igual sale de la
 * pantalla trabada, que es de lo que se trata.
 */
function cancelConnecting() {
  state.autoJoin = null;
  state.pendingJoin = null;
  hideLoading();
  setStage('browser');
  setView('play');
  syncJoinButton();
  tvm.rooms.leave().catch(() => {});
  toast(t('toast.cancelled'), '');
}

$('#loadingCancel').addEventListener('click', cancelConnecting);

function pathToFileUrl(filePath) {
  return encodeURI(`file:///${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`);
}

$('#retryLoad').addEventListener('click', async () => {
  $('#stageError').hidden = true;
  showLoading(t('game.loading'));

  // Fuerza una consulta nueva en vez de creerle al último veredicto: el botón
  // es justamente para cuando el jugador cree que HaxBall ya volvió.
  const health = await tvm.game.health(true).catch(() => ({ down: false }));
  if (health.down) {
    // Tocar el botón es pedirlo de nuevo a propósito: si hay muro, la ventana
    // se vuelve a abrir aunque el jugador la hubiera cerrado antes.
    if (health.reason === 'challenge') state.verifyAsked = false;
    return showGameDown(health.reason);
  }

  if (state.webview) state.webview.reload();
  else mountGame();
});

/**
 * Qué pantalla de HaxBall está activa decide si mostramos el juego o la lista.
 *
 * `password` es la pantalla que pide la contraseña de una sala cerrada. Faltaba
 * acá, así que el cliente la trataba como pantalla desconocida, dejaba el juego
 * escondido detrás de la lista y no había dónde escribir la contraseña: el
 * juego quedaba plantado en esa pantalla y desde ahí ya no se podía entrar a
 * ninguna sala ni crear una.
 */
const GAME_STAGES = {
  room: 'game', game: 'game', connecting: 'game',
  disconnected: 'game', dialog: 'game', password: 'game',
  replay: 'game'
};

/** Pantallas donde el juego ya terminó de cargar y se puede mostrar. */
/**
 * Un aviso de «cambió la pantalla» de una pestaña de juego, venga por evento o
 * de la consulta de respaldo (`reconcileTabs`).
 */
function handleViewEvent(kind, meta) {
  const { s, active, tab } = tabBucket(meta);
  if (tab && meta && Number.isFinite(meta.seq)) tab.viewSeq = Math.max(tab.viewSeq || 0, meta.seq);
  if (!active) {
    // Una pestaña de atrás cambió de pantalla: sólo cambia su rótulo. Si
    // volvió a la lista, lo de la sala en la que estaba ya no vale.
    s.gameView = kind;
    if (kind === 'roomlist') {
      s.gameRoomName = null;
      s.joinedRoomName = null;
      s.playing = false;
    }
    renderTabs();
    return;
  }
  const era = state.gameView;
  onGameView(kind);
  // Abrir una grabación dispara el análisis solo. Salir de ella tira lo que
  // se había leído: el resumen es de la grabación, no de la pantalla.
  if (kind === 'replay' && era !== 'replay') scheduleAutoAnalyze();
  else if (kind !== 'replay' && era === 'replay') {
    state.summary = null;
    state.summaryError = null;
    state.replayPath = null;
  }
  renderTabs();
}

/**
 * Respaldo de los avisos de pantalla.
 *
 * La interfaz decide qué mostrar —la lista de salas propia, el velo de
 * «Conectando…», el rótulo de cada pestaña— según el último «cambió la
 * pantalla» que le llega del juego. Si uno se pierde (llegó antes de que la
 * interfaz se suscribiera, o se cruzó con otro), todo queda desfasado: el velo
 * puesto con la sala ya conectada, la pestaña diciendo «Cargando…» o, al salir
 * de una sala, la lista nativa de HaxBall en lugar de la nuestra.
 *
 * El proceso principal numera cada aviso. Una vez por segundo se le pregunta el
 * último número de cada pestaña y, si es mayor que el que esta interfaz vio, se
 * aplica el estado actual. Si no se perdió nada, no hace nada.
 */
let reconciling = false;
async function reconcileTabs() {
  if (reconciling || document.hidden || !state.tabs.length) return;
  reconciling = true;
  try {
    const snap = await tvm.tabs.snapshot();
    for (const tab of state.tabs.slice()) {
      const info = tab.wcId != null ? snap[tab.wcId] : null;
      if (!info) continue;
      if (info.view && info.viewSeq > (tab.viewSeq || 0)) {
        handleViewEvent(info.view, { tab: tab.wcId, seq: info.viewSeq });
      }
      // El nombre de la sala también puede haberse perdido.
      const bucket = tab === state.activeTab ? state : tab.snap;
      if (info.room && bucket.gameRoomName !== info.room && info.view && info.view !== 'roomlist') {
        bucket.gameRoomName = info.room;
        if (tab === state.activeTab) {
          pushPresence();
          if (state.stage === 'game') hideLoading();
        }
        renderTabs();
      }
    }
  } catch {
    /* sin respaldo esta vuelta: la próxima */
  } finally {
    reconciling = false;
  }
}
setInterval(reconcileTabs, 1000);

const SETTLED = new Set(['roomlist', 'room', 'game', 'disconnected', 'dialog', 'password', 'replay']);

function onGameView(kind) {
  // Qué pantalla del juego está puesta decide de qué es el resumen: de la
  // partida en curso o de la grabación entera.
  state.gameView = kind;
  setStage(GAME_STAGES[kind] || 'browser');
  // El «Conectando…» se mantiene hasta estar realmente dentro de la sala.
  // Estar en la sala o en la partida no necesita que el tema ya esté confirmado:
  // esperar ese aviso era lo que dejaba el velo puesto con la sala ya conectada.
  if (kind === 'room' || kind === 'game' || kind === 'replay') {
    hideLoading();
    dismissToast(state.joiningToast);
  } else if (state.themed && (SETTLED.has(kind) || kind === 'connecting')) hideLoading();
  else if (kind === 'connecting') showLoading(t('game.connecting'));
  pushPresence();
  /*
   * Salió de la sala: lo que estaba esperando para no interrumpir, ahora sí.
   *
   * El aviso lo da el JUEGO, no nosotros, y esa es la gracia: llega cuando ya
   * está afuera de verdad, así que la recarga no se pisa con la navegación que
   * lo sacó (salir cancelando, por ejemplo, es una navegación nuestra).
   */
  if (kind === 'roomlist') flushPendingReload();
}

function setPlaying(playing) {
  if (state.playing === playing) return;
  state.playing = playing;
  // Discord pasa de «En una sala» a «En una partida» y al revés.
  pushPresence();
  if (playing) {
    state.playedSeconds = 0;
    addStats({ sessions: 1 });
  } else {
    flushPlayTime();
    // Lo que quedó esperando a que terminaras de jugar. Puede que sigas en la
    // sala, y ahí todavía no: lo decide `canReloadGame`.
    flushPendingReload();
  }
}

function flushPlayTime() {
  const seconds = Math.round(state.playedSeconds);
  state.playedSeconds = 0;
  if (seconds < 3) return;
  addStats({ seconds });
}

/* ── Atajos ─────────────────────────────────────────────── */
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#askModal').hidden) { e.preventDefault(); closeAsk(null); return; }
    if (!$('#themeModal').hidden) { e.preventDefault(); $('#themeModal').hidden = true; return; }
    if (!$('#createModal').hidden) { e.preventDefault(); closeCreateModal(); return; }
    // Tu menú de la barra es lo más chico y lo último que se abre: sale primero.
    if (meMenuOpen()) { e.preventDefault(); toggleMeMenu(false); return; }
    // El perfil está por encima del dock, así que se cierra primero.
    if (state.profileOpen) { e.preventDefault(); closeProfile(); return; }
    // El dock antes que el panel: es lo último que se abrió y lo que está más
    // encima. Cerrarlo además devuelve el foco al juego.
    if (state.friendsOpen) { e.preventDefault(); setFriendsOpen(false); return; }
    // Con el velo puesto no hay nada abajo con lo que interactuar: Escape es la
    // misma salida que el botón «Cancelar».
    if (isLoadingVisible()) { e.preventDefault(); cancelConnecting(); return; }
    if (state.view !== 'play') { e.preventDefault(); closePanel(); return; }
    // Última red: si quedaste en pantalla completa sin barra, Escape te saca.
    if ($('#app').dataset.fullscreen === 'true') {
      e.preventDefault();
      tvm.window.exitFullscreen();
    }
  }
  if (e.key === 'F11') {
    e.preventDefault();
    tvm.window.toggleFullscreen();
  }

  /*
   * Ctrl +, Ctrl - y Ctrl 0 zoomean LA CANCHA, no esta ventana.
   *
   * Acá sólo llegan cuando el foco está en la interfaz —la barra, un panel, el
   * buscador de salas—; jugando las agarra el preload del juego. Que hagan lo
   * mismo en los dos lados es todo el punto: si no, el atajo funcionaría o no
   * según dónde hubieras hecho clic por última vez.
   *
   * La tabla de teclas es la misma que la de `zoomAction` en game-preload.js;
   * está explicada allá.
   */
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    const zoom = gameZoomAction(e);
    if (zoom) {
      e.preventDefault();
      tvm.game.zoom(zoom);
    }
    // Las pestañas de juego, con las teclas de cualquier navegador. Acá no hay
    // partido que las confunda; adentro del juego son con Alt (ver `onTabKey`).
    const key = String(e.key || '').toLowerCase();
    const tab = key === 't' ? 'new' : key === 'w' ? 'close' : key === 'tab' ? (e.shiftKey ? 'prev' : 'next') : null;
    if (tab) {
      e.preventDefault();
      onTabKey(tab);
    }
  }
  // Y las mismas que adentro del juego, para que el atajo no dependa de dónde
  // quedó el foco: Alt+T, Alt+W, Alt+1…4.
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const code = String(e.code || '');
    const tab = code === 'KeyT' ? 'new' : code === 'KeyW' ? 'close' : /^(Digit|Numpad)[1-4]$/.test(code) ? `go:${code.slice(-1)}` : null;
    if (tab) {
      e.preventDefault();
      onTabKey(tab);
    }
  }
});

function gameZoomAction(e) {
  if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd' || e.code === 'Equal') return 'in';
  if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' || e.code === 'Minus') return 'out';
  if (e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0') return 'reset';
  return null;
}


$$('[data-win]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.win;
    if (action === 'minimize') tvm.window.minimize();
    if (action === 'maximize') tvm.window.maximize();
    if (action === 'close') tvm.window.close();
  });
});

$('#btnFullscreen').addEventListener('click', () => tvm.window.toggleFullscreen());

function setTopbarCollapsed(collapsed) {
  const app = $('#app');
  const hideButton = $('#btnTopbarToggle');
  const showButton = $('#btnTopbarReveal');
  app.dataset.topbarCollapsed = String(collapsed);
  hideButton.setAttribute('aria-expanded', String(!collapsed));
  showButton.hidden = !collapsed;
  showButton.setAttribute('aria-expanded', String(!collapsed));
}

$('#btnTopbarToggle').addEventListener('click', () => setTopbarCollapsed(true));
$('#btnTopbarReveal').addEventListener('click', () => {
  setTopbarCollapsed(false);
  $('#btnTopbarToggle').focus();
});

/* Sin foco no hay nadie mirando: se frenan las animaciones decorativas. */
const setFocus = (on) => { document.documentElement.dataset.focus = on ? 'on' : 'off'; };
window.addEventListener('focus', () => setFocus(true));
window.addEventListener('blur', () => setFocus(false));
setFocus(document.hasFocus());

/* ══════════════════════════════════════════════════════════
   Arranque
   ══════════════════════════════════════════════════════════ */
/* ── Líneas y tamaños ───────────────────────────────────────────────────────
 * Multiplicadores sobre lo que dibuja HaxBall (100% = como viene). Se aplican
 * en la pantalla de cada uno, así que no afectan a nadie más.
 */
const VISUAL_LINES = [
  { key: 'pitchLine', label: 'visual.pitchLine', min: 0.3, max: 4 },
  { key: 'discLine', label: 'visual.discLine', min: 0.3, max: 4 },
  { key: 'ballLine', label: 'visual.ballLine', min: 0.3, max: 4 }
];
const VISUAL_SIZES = [
  { key: 'discSize', label: 'visual.discSize', min: 0.6, max: 1.6 },
  { key: 'ballSize', label: 'visual.ballSize', min: 0.6, max: 1.6 }
];

function renderVisual() {
  const cfg = state.config.visual || {};
  const build = (host, items) => {
    host.replaceChildren();
    for (const item of items) {
      const value = Number(cfg[item.key]) || 1;
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<div class="row__text"><span class="row__label"></span></div>' +
        '<div class="row__ctl"><input type="range" step="0.05" /><b class="row__val"></b></div>';
      row.querySelector('.row__label').textContent = t(item.label);
      const input = row.querySelector('input');
      const out = row.querySelector('.row__val');
      input.min = item.min;
      input.max = item.max;
      input.value = value;
      out.textContent = `${Math.round(value * 100)}%`;
      syncRangeFill(input);
      input.addEventListener('input', () => {
        syncRangeFill(input);
        out.textContent = `${Math.round(Number(input.value) * 100)}%`;
      });
      input.addEventListener('change', () => patchConfig({ visual: { [item.key]: Number(input.value) } }));
      host.append(row);
    }
  };
  build($('#visualLines'), VISUAL_LINES);
  build($('#visualSizes'), VISUAL_SIZES);
  $('#visualFlatNote').hidden = !(state.config.perf && state.config.perf.flatGraphics);
}

$('#visualReset').addEventListener('click', async () => {
  await patchConfig({ visual: { pitchLine: 1, discLine: 1, ballLine: 1, ballSize: 1, discSize: 1 } });
  renderVisual();
});

/* ── Personalización visual ─────────────────────────────────────────────────
 * Todo vive en `config.visual` y sólo se ve en esta pantalla. Cada fila se arma
 * desde una tabla: agregar un ajuste es agregar una línea.
 */
/** Guarda y vuelve a pintar: estas filas dependen unas de otras. */
async function lookPatch(patch) {
  const next = await patchConfig(patch);
  renderLook();
  return next;
}

const FONT_OPTIONS = [
  ['default', 'look.font.default'], ['outfit', 'look.font.outfit'], ['mono', 'look.font.mono'],
  ['serif', 'look.font.serif'], ['round', 'look.font.round'], ['impact', 'look.font.impact']
];

const LOOK_SECTIONS = {
  lookPitch: [
    { key: 'texture', type: 'select', label: 'look.texture', options: [['none', 'look.opt.none'], ['wood', 'look.tex.wood'], ['ice', 'look.tex.ice'], ['sand', 'look.tex.sand'], ['concrete', 'look.tex.concrete'], ['night', 'look.tex.night']] },
    { key: 'crest', type: 'switch', label: 'look.crest', desc: 'look.crestHelp' },
    { key: 'crestOpacity', type: 'range', label: 'look.crestOpacity', min: 0.05, max: 0.6, step: 0.01, showIf: (v) => v.crest },
    { key: 'crestSize', type: 'range', label: 'look.crestSize', min: 0.2, max: 1, step: 0.01, showIf: (v) => v.crest },
    { key: 'lineColor', type: 'color', label: 'look.lineColor', desc: 'look.lineColorHelp' },
    { key: 'postColor', type: 'color', label: 'look.postColor' }
  ],
  lookDiscs: [
    { key: 'discStyle', type: 'select', label: 'look.discStyle', options: [['default', 'look.opt.none'], ['sphere', 'look.ds.sphere'], ['glass', 'look.ds.glass'], ['neon', 'look.ds.neon'], ['metal', 'look.ds.metal']] },
    { key: 'discOutline', type: 'color', label: 'look.discOutline' },
    { key: 'ballOutline', type: 'color', label: 'look.ballOutline' },
    { key: 'ringStyle', type: 'select', label: 'look.ringStyle', desc: 'look.ringHelp', options: [['default', 'look.opt.simple'], ['double', 'look.ring.double'], ['dashed', 'look.ring.dashed'], ['crown', 'look.ring.crown']] },
    { key: 'ringColor', type: 'color', label: 'look.ringColor' },
    { key: 'selfTrail', type: 'switch', label: 'look.selfTrail', desc: 'look.selfTrailHelp' },
    { key: 'selfTrailColor', type: 'color', label: 'look.selfTrailColor', showIf: (v) => v.selfTrail }
  ],
  lookNames: [
    { key: 'nameScale', type: 'range', label: 'look.nameScale', min: 0.6, max: 2, step: 0.05 },
    { key: 'nameColor', type: 'color', label: 'look.nameColor' },
    { key: 'nameOutline', type: 'switch', label: 'look.nameOutline' },
    { key: 'nameFont', type: 'select', label: 'look.nameFont', options: FONT_OPTIONS }
  ],
  lookChat: [
    { key: 'chatScale', type: 'range', label: 'look.chatScale', min: 0.7, max: 1.8, step: 0.05 },
    { key: 'chatBg', type: 'range', label: 'look.chatBg', min: 0, max: 0.9, step: 0.05, original: -1 },
    { key: 'chatFont', type: 'select', label: 'look.chatFont', options: FONT_OPTIONS }
  ],
  lookMenu: [
    { key: 'menuBg', type: 'select', label: 'look.menuBg', options: [['none', 'look.opt.none'], ['club', 'look.menu.club'], ['aurora', 'look.menu.aurora'], ['grid', 'look.menu.grid']] }
  ]
};

const LOOK_DEFAULTS = {
  texture: 'none', crest: false, crestOpacity: 0.18, crestSize: 0.45, lineColor: '', postColor: '',
  discStyle: 'default', discOutline: '', ballOutline: '', ringStyle: 'default', ringColor: '',
  selfTrail: false, selfTrailColor: '', nameScale: 1, nameColor: '', nameOutline: false, nameFont: 'default',
  chatScale: 1, chatBg: -1, chatFont: 'default', menuBg: 'none'
};

function lookValue(key) {
  const v = state.config.visual || {};
  return v[key] === undefined ? LOOK_DEFAULTS[key] : v[key];
}

function lookRow(item) {
  const value = lookValue(item.key);
  let control;
  if (item.type === 'switch') {
    const toggle = document.createElement('button');
    toggle.className = 'switch' + (value ? ' is-on' : '');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(!!value));
    toggle.addEventListener('click', () => lookPatch({ visual: { [item.key]: !lookValue(item.key) } }));
    return settingRow({ label: t(item.label), description: item.desc ? t(item.desc) : '', control: toggle });
  }
  if (item.type === 'select') {
    control = document.createElement('select');
    for (const [val, label] of item.options) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = t(label);
      control.append(o);
    }
    control.value = value;
    control.addEventListener('change', () => lookPatch({ visual: { [item.key]: control.value } }));
    return settingRow({ label: t(item.label), description: item.desc ? t(item.desc) : '', control });
  }
  if (item.type === 'color') {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = value || '#888888';
    input.classList.toggle('is-unset', !value);
    input.addEventListener('change', () => lookPatch({ visual: { [item.key]: input.value } }));
    const clear = document.createElement('button');
    clear.className = 'btn btn--ghost btn--sm';
    clear.type = 'button';
    clear.textContent = value ? t('look.remove') : t('look.original');
    clear.disabled = !value;
    clear.addEventListener('click', () => lookPatch({ visual: { [item.key]: '' } }));
    return settingRow({ label: t(item.label), description: item.desc ? t(item.desc) : '', control: [input, clear] });
  }
  // range
  const input = document.createElement('input');
  input.type = 'range';
  input.min = item.min;
  input.max = item.max;
  input.step = item.step;
  const unset = item.original !== undefined && value === item.original;
  input.value = unset ? item.min : value;
  const out = document.createElement('b');
  out.className = 'row__val';
  out.textContent = unset ? t('look.original') : `${Math.round(Number(value) * 100)}%`;
  syncRangeFill(input);
  input.addEventListener('input', () => {
    syncRangeFill(input);
    out.textContent = `${Math.round(Number(input.value) * 100)}%`;
  });
  input.addEventListener('change', () => lookPatch({ visual: { [item.key]: Number(input.value) } }));
  const nodes = [input, out];
  if (item.original !== undefined) {
    const reset = document.createElement('button');
    reset.className = 'btn btn--ghost btn--sm';
    reset.type = 'button';
    reset.textContent = t('look.original');
    reset.disabled = unset;
    reset.addEventListener('click', () => lookPatch({ visual: { [item.key]: item.original } }));
    nodes.push(reset);
  }
  return settingRow({ label: t(item.label), description: item.desc ? t(item.desc) : '', control: nodes });
}

function renderLookSections() {
  const values = state.config.visual || {};
  for (const [hostId, items] of Object.entries(LOOK_SECTIONS)) {
    const host = $(`#${hostId}`);
    if (!host) continue;
    host.replaceChildren();
    for (const item of items) {
      if (item.showIf && !item.showIf({ ...LOOK_DEFAULTS, ...values })) continue;
      host.append(lookRow(item));
    }
  }
  const app = $('#app');
  if (app) app.dataset.menubg = lookValue('menuBg') || 'none';
}

/* Looks guardados: una foto de los ajustes visuales, con nombre. */
const LOOK_PITCH_KEYS = ['ball3d', 'netRipple', 'selfRing', 'teamRings', 'goalFlash', 'goalShake', 'skin'];
const LOOK_MAX = 12;

function currentLookData() {
  const cfg = state.config;
  const pitch = {};
  for (const key of LOOK_PITCH_KEYS) if (cfg.pitch && cfg.pitch[key] !== undefined) pitch[key] = JSON.parse(JSON.stringify(cfg.pitch[key]));
  return { visual: { ...(cfg.visual || {}) }, pitch };
}

function renderLooks() {
  const host = $('#lookList');
  if (!host) return;
  host.replaceChildren();
  const saved = ((state.config.looks || {}).saved) || [];
  if (!saved.length) {
    const empty = document.createElement('p');
    empty.className = 'sec__desc';
    empty.textContent = t('looks.empty');
    host.append(empty);
    return;
  }
  for (const entry of saved) {
    const apply = document.createElement('button');
    apply.className = 'btn btn--ghost btn--sm';
    apply.type = 'button';
    apply.textContent = t('looks.apply');
    apply.addEventListener('click', async () => {
      await lookPatch(JSON.parse(JSON.stringify(entry.data || {})));
      toast(t('looks.applied', { name: entry.name }));
    });
    const del = document.createElement('button');
    del.className = 'btn btn--ghost btn--sm';
    del.type = 'button';
    del.textContent = t('looks.delete');
    del.addEventListener('click', () => lookPatch({ looks: { saved: saved.filter((x) => x.name !== entry.name) } }));
    host.append(settingRow({ label: entry.name, control: [apply, del] }));
  }
}

$('#lookSave').addEventListener('click', async () => {
  const input = $('#lookName');
  const name = input.value.trim().slice(0, 24);
  if (!name) { toast(t('looks.needName'), 'err'); return; }
  const saved = (((state.config.looks || {}).saved) || []).filter((x) => x.name !== name);
  if (saved.length >= LOOK_MAX) { toast(t('looks.full', { max: LOOK_MAX }), 'err'); return; }
  saved.push({ name, data: currentLookData() });
  await lookPatch({ looks: { saved } });
  input.value = '';
  toast(t('looks.saved', { name }));
});

function renderLook() {
  renderLookSections();
  renderLooks();
}

function renderAll() {
  window.i18n.applyStatic();
  renderPerf();
  renderVisual();
  renderLook();
  renderAspect();
  renderSettings();
  renderDiscord();
  renderUpdates();
  renderVip();
  renderNickCard();
  renderAuth();
}

async function boot() {
  const [config, schema, info, vars] = await Promise.all([
    tvm.config.get(), tvm.config.schema(), tvm.app.info(), tvm.theme.vars()
  ]);
  state.schema = schema;
  state.info = info;
  applyConfig(config);
  applyThemeVars(vars);

  // Recién acá se sabe el idioma y la versión: hasta este punto la pantalla de
  // carga muestra el texto que trae el HTML.
  splashStep('splash.config');
  splashTip();
  $('#splashVersion').textContent = `v${info.version}`;

  $('#roomSort').value = state.sort;
  tvm.rooms.flags().then(applyFlags).catch(() => {});

  splashStep('splash.ui');
  renderAll();
  setView('play');
  mountGame();
  loadRooms();
  loadAuth();

  // Se deja para cuando el motor esté libre: no tiene que demorar el primer
  // dibujo, sólo llegar antes de que el usuario toque una pestaña.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warmPanel, { timeout: 2500 });
  else setTimeout(warmPanel, 600);

  // Pantalla de inicio al abrir la app. Queda armada detrás de la de carga, así
  // que cuando ésta se funde el apodo ya está pedido y no hay un paso vacío.
  showStart(null);
  applyDiscord();
  splashStep('splash.ready');

  tvm.config.onChange((next) => {
    applyConfig(next);
  });
  tvm.game.onSettingsChanged((patch) => {
    const groups = new Set(state.schema.game.filter(s => Object.hasOwnProperty.call(patch, s.id)).map(s => s.group));
    if (groups.has('chat')) renderAspect();
    for (const group of groups) {
      if (group === 'chat') continue;
      const selector = { sound: '#gameSound', video: '#gameVideo', net: '#gameNet' }[group];
      const host = selector && $(selector);
      if (host) renderGameSettings(host, group);
    }
  });
  tvm.theme.onVars(applyThemeVars);

  /* ── Resolución ────────────────────────────────────────────────────────
   *
   * La resolución que elige el jugador es la de LA CANCHA, no la de la ventana,
   * y se aplica siempre igual, en ventana o en pantalla completa: el iframe del
   * juego se dibuja a ese tamaño y se ESTIRA hasta llenar el escenario. Si la
   * proporción no coincide, se deforma — es lo que se pide con «1080x1080»: una
   * cancha cuadrada estirada a lo ancho, como el «stretched» de cualquier
   * shooter. Sólo cambia el iframe: los HUD del cliente no se deforman.
   *
   * La ventana no se toca. Antes en modo ventana se la redimensionaba para que
   * el escenario midiera exactamente eso, y no era lo que se quería: elegir
   * 1080x1080 daba una ventana cuadrada, no un juego estirado. El tamaño de la
   * ventana es del jugador (se recuerda entre sesiones, ver `window` en
   * main.js) y la resolución es del juego.
   *
   * El estirado lo hace el preload dentro del webview (`applyGameViewport` en
   * game-preload.js), contra el tamaño real del documento del juego: acá sólo
   * se le dice qué resolución. Si la pedida no entra en el escenario se baja en
   * bloque, conservando la proporción, para no pedirle a Chromium una
   * superficie más grande que lo que se ve.                                  */

  function wantedResolution() {
    const [w, h] = String(state.config.general.resolution || '').split('x').map(Number);
    if (!(w > 0 && h > 0)) return null;
    const limit = displayResolutionLimit();
    // Una superficie más grande que el monitor no aporta detalle: sólo hace que
    // Chromium componga más píxeles y luego los reduzca. En drivers viejos era
    // además el camino al cuadro negro/duplicado de las transiciones.
    if (!limit || (w <= limit.w && h <= limit.h)) return { w, h };
    const scale = Math.min(limit.w / w, limit.h / h);
    return {
      w: Math.max(1, Math.round(w * scale)),
      h: Math.max(1, Math.round(h * scale))
    };
  }

  /*
   * ── Quién manda sobre «estoy en pantalla completa» ─────────────────────
   *
   * Uno solo, y son los eventos de la ventana.
   *
   * Antes cada `resize` volvía a preguntar (`tvm.window.state()`), y ahí hay una
   * trampa que el main ya documenta del otro lado (ver `emitState`): en Windows,
   * con la ventana sin marco, `isFullScreen()` sigue contestando `true` mientras
   * se está SALIENDO de pantalla completa. Salir dispara un puñado de `resize`,
   * así que la última respuesta en llegar era la vieja y ganaba.
   *
   * De ahí salía el cuelgue: salías de pantalla completa y la app se quedaba
   * creyendo que seguías adentro. La barra de arriba no volvía —ahí se esconde
   * sola—, el juego se quedaba escalado contra un escenario que ya no medía eso
   * (estirado y cortado contra el borde) y encima sin el foco, así que no
   * respondía a ninguna tecla. Se veía exactamente como un juego congelado.
   *
   * `enter-full-screen` / `leave-full-screen` sí dicen a qué estado se pasó. Se
   * guarda ESO, y el `resize` reacomoda con lo último que se sabe en vez de
   * volver a preguntar.
   */
  let fullscreenNow = false;
  let lastViewportRequest = '';

  /**
   * Nunca se transforma el `<webview>` entero desde acá: el cartel de música,
   * las teclas y otros overlays viven dentro de él y una escala no uniforme los
   * estiraría. El webview mide siempre el escenario (CSS) y el estirado pasa
   * adentro, sobre el iframe del juego. Va a TODAS las pestañas: el proceso
   * principal lo reparte y lo repite en cada carga del juego.
   */
  function applyViewportLayout(fullscreen) {
    $('#app').dataset.fullscreen = String(fullscreen);
    const res = wantedResolution();
    const layout = {
      enabled: !!res,
      width: res ? res.w : 16,
      height: res ? res.h : 9
    };
    const requestKey = `${layout.enabled}|${layout.width}|${layout.height}`;
    // El iframe recibe su propio `resize`; no hace falta bombardear el proceso
    // principal durante cada cuadro de la animación de pantalla completa.
    if (requestKey !== lastViewportRequest) {
      lastViewportRequest = requestKey;
      tvm.game.viewport(layout);
    }
  }

  /** Se cambió la resolución en Ajustes: se reestira la cancha, y nada más. */
  async function applyResolution() {
    applyViewportLayout(fullscreenNow);
  }

  /**
   * El único lugar donde `fullscreenNow` cambia de valor.
   *
   * @param {boolean} fullscreen  lo que dice el evento, no lo que contesta la ventana
   */
  function onWindowState(next) {
    const fullscreen = !!(next && next.fullscreen);
    if (next && next.display) {
      const antes = state.display && state.display.id;
      const distinta = antes !== next.display.id
        || !state.display
        || state.display.size.width !== next.display.size.width
        || state.display.size.height !== next.display.size.height;
      state.display = next.display;
      syncResolutionOptions();
      /*
       * Cambiar de monitor o cambiar la resolución de Windows con el cliente
       * abierto puede dejar guardado un tamaño que ya no existe. Se corrige una
       * sola vez, cuando la pantalla de verdad cambió — no en cada `win:state`,
       * que llega también al mover la ventana.
       */
      if (distinta) reconcileResolution();
    }
    const changed = fullscreenNow !== fullscreen;
    fullscreenNow = fullscreen;
    applyViewportLayout(fullscreen);
    if (!changed) return;

    /*
     * El aviso llega ANTES de que la ventana cambie de tamaño, así que la
     * medida de `.stage` que acaba de usarse todavía es la de antes y la escala
     * sale contra el escenario viejo. Se reacomoda en el cuadro siguiente, ya
     * con la maqueta nueva. Son dos rAF y no uno: el primero es el cuadro en el
     * que Chromium aplica el cambio de tamaño, el segundo es el primero que se
     * puede medir de verdad.
     */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => applyViewportLayout(fullscreenNow));
    });

    // F11 se aprieta jugando: sin esto las teclas se quedan en el documento de
    // la app y la cancha no responde. Ver `focusGame`.
    focusGame();
  }

  tvm.window.onState(onWindowState);
  tvm.window.state().then(onWindowState);
  // El `resize` no vuelve a preguntar: reacomoda con lo último que se sabe.
  window.addEventListener('resize', () => applyViewportLayout(fullscreenNow));

  // La resolución se aplica de entrada: el estirado es del juego, no de la
  // ventana, así que da lo mismo cómo haya quedado ésta.
  applyResolution();
  state.applyResolution = applyResolution;

  tvm.game.onView((kind, meta) => handleViewEvent(kind, meta));

  tvm.game.onRoomName((name, meta) => {
    const { s, active } = tabBucket(meta);
    s.gameRoomName = name || null;
    if (active) {
      pushPresence();
      // Si la sala ya tiene nombre, ya estamos adentro: el velo sobra.
      if (name && state.stage === 'game') { hideLoading(); dismissToast(state.joiningToast); }
    }
    renderTabs();
  });
  tvm.game.onThemed(() => {
    state.themed = true;
    // El tema confirma que el juego ya tiene un documento visible. No esperes
    // el evento de vista: puede perderse y dejar tapada una sala ya conectada.
    if (state.stage === 'game') hideLoading();
  });
  
  /* ── Resumen del partido y cartel de gol ───────────────────────────────
   *
   * Los goles llegan del preload del juego, que es el que ve la cancha, ya con
   * el autor y la asistencia resueltos (ver `game-preload.js`). Acá sólo se
   * guardan y se dibujan.
   *
   * Hay dos resúmenes, y no es lo mismo uno que otro:
   *
   *   · En vivo se arma con lo que va pasando, gol por gol. Es lo único que se
   *     puede hacer: el partido todavía no terminó.
   *   · En un replay se analiza la GRABACIÓN ENTERA de una sola vez, sin
   *     reproducirla. El preload la simula sin dibujarla (ver `analyzeReplay`),
   *     así que el resumen está completo apenas se abre el panel, no importa
   *     hasta dónde se haya mirado. Encima trae los toques de cada uno, que es
   *     lo que permite desempatar el MVP.                                    */

  /** Los goles del partido que se está viendo, en orden. */
  state.liveGoals = [];
  /** El análisis de la grabación abierta, si ya se hizo. */
  state.summary = null;
  state.summaryError = null;
  state.analyzing = false;
  // Para el cambio de pestaña, que vive afuera de `boot()` y repone el resumen
  // de la que entra.
  state.repaintStats = repaintStats;

  tvm.game.onMatchStart((_p, meta) => {
    const { s, active } = tabBucket(meta);
    s.liveGoals = [];
    // El mapa era del partido anterior: al arrancar otro deja de tener sentido.
    s.heatmap = null;
    s.matchCard = null;
    if (active) repaintStats();
  });

  /*
   * Las estadísticas se cierran cuando el partido TERMINA, no gol por gol.
   *
   * Así lo que queda contado es un partido jugado hasta el final: si te vas a la
   * mitad, si te echan o si se cae la sala, no suma nada — y no queda un partido
   * a medias con tres goles tuyos adentro. El precio es que un cierre a lo bruto
   * (cerrar la app en medio de un partido) también se pierde, que es exactamente
   * lo que se quiere.
   */
  tvm.game.onMatchEnd((_score, meta) => {
    // Sólo lo que jugaste: una grabación no cuenta ni cuando termina, y un
    // partido que terminó en una pestaña de atrás tampoco — no estabas ahí.
    const { s, active } = tabBucket(meta);
    if (!active || s.gameView !== 'game') return;
    addStats({ matches: 1, ...myShare(state.liveGoals) });
  });

  /*
   * El mapa de calor del partido.
   *
   * Llega una sola vez, al terminar, y se guarda hasta que arranque el
   * siguiente: el resumen se mira DESPUÉS del pitazo, así que borrarlo en el
   * momento en que llega sería borrarlo justo antes de que alguien lo abra.
   */
  tvm.game.onHeatmap((payload, meta) => {
    const { s, active } = tabBucket(meta);
    const p = payload || {};
    s.heatmap = p.heat && p.heat.url ? p.heat : null;
    s.matchCard = p.card && p.card.players && p.card.players.length ? p.card : null;
    if (active) repaintStats();
  });

  /**
   * Lo tuyo de este partido: goles, asistencias y goles en contra.
   *
   * El único hilo entre "el que hizo el gol" y "vos" es el nombre: HaxBall no
   * tiene identidad en la cancha. Si dos jugadores usan el mismo nick en la
   * misma sala, el cliente no los puede distinguir — y ellos tampoco.
   */
  function myShare(goals) {
    const me = (state.config.general.nickname || '').trim();
    const share = { goals: 0, assists: 0, ownGoals: 0 };
    if (!me) return share;

    for (const goal of goals) {
      if (goal.scorer === me) share[goal.own ? 'ownGoals' : 'goals']++;
      if (goal.assist === me) share.assists++;
    }
    return share;
  }

  let goalBannerTimer = null;

  tvm.game.onGoal((goal, meta) => {
    const team = goal.team === 'Red' ? 'Red' : 'Blue';
    const { s, active } = tabBucket(meta);
    s.liveGoals.push({ ...goal, team });
    // El gol de una pestaña de atrás se anota para su resumen; el cartel es de
    // lo que se está mirando.
    if (!active) return;
    showGoalBanner(team, goal);
    repaintStats();
  });

  /**
   * El cartel estilo TV. Se muestra igual en una partida que en un replay: es
   * justamente donde más se quiere ver quién la mandó a guardar.
   */
  function showGoalBanner(team, goal) {
    const banner = $('#tvmGoalBanner');
    const assistWrap = $('#goalAssistWrap');

    // Apagado no se dibuja, pero el gol se cuenta y entra al resumen igual: son
    // dos cosas distintas y sólo se está sacando el cartel de la pantalla.
    if (state.config.appearance.goalBanner === false) {
      banner.hidden = true;
      return;
    }

    banner.classList.toggle('goal-banner--red', team === 'Red');
    banner.classList.toggle('goal-banner--blue', team === 'Blue');
    $('#goalTitle').textContent = goal.own ? '¡GOL EN CONTRA!' : '¡GOL!';
    // Sin parche del bundle no hay nombres: mejor cantar el gol del equipo que
    // inventar un autor.
    $('#goalScorer').textContent = goal.scorer || t(team === 'Red' ? 'stats.red' : 'stats.blue');

    if (goal.assist) {
      assistWrap.hidden = false;
      $('#goalAssist').textContent = goal.assist;
    } else {
      assistWrap.hidden = true;
    }

    banner.hidden = false;
    clearTimeout(goalBannerTimer);
    // En un replay acelerado el cartel dura lo mismo EN PARTIDO, no en pantalla.
    const speed = Math.max(1, Number(goal.speed) || 1);
    goalBannerTimer = setTimeout(() => { banner.hidden = true; }, 5000 / speed);
  }

  /**
   * Analiza la grabación abierta de punta a punta. El juego se queda quieto
   * mientras dura —es una simulación de miles de cuadros de una sentada—, pero
   * este panel vive en otro proceso, así que el «Analizando…» se ve igual.
   */
  async function runAnalysis() {
    if (state.analyzing) return;
    state.analyzing = true;
    state.summaryError = null;
    repaintStats();

    try {
      const summary = await tvm.replays.analyze();
      state.summary = summary && summary.ok ? summary : null;
      state.summaryError = state.summary ? null : (summary && summary.reason) || 'No se pudo analizar.';
      // Un .hbr2 es un archivo cerrado: lo que dio hoy va a dar siempre. Se
      // guarda para no volver a simular nunca esta grabación.
      if (state.summary && state.replayPath) {
        tvm.replays.archive(state.replayPath, state.summary).catch(() => {});
      }
    } catch (err) {
      state.summary = null;
      state.summaryError = err.message;
    } finally {
      state.analyzing = false;
      repaintStats();
    }
  }

  /*
   * ── El análisis en segundo plano ───────────────────────────────────────
   *
   * Antes había que pedirlo: abrir el panel, o apretar «Resumen». Ahora se hace
   * solo apenas se abre una grabación, así que para cuando el usuario quiere
   * ver los números ya están.
   *
   * Y si esa grabación ya se analizó alguna vez, no se simula nada: el
   * resultado sale del archivo en disco (ver `replay-archive.js`). Eso importa
   * más de lo que parece — la simulación congela el juego un par de segundos, y
   * volver a pagarla cada vez que uno reabre la misma grabación es el tipo de
   * cosa que hace que una función buena se sienta pesada.
   */

  /*
   * El reproductor se publica cuando arranca su control de velocidad, no cuando
   * aparece la pantalla. Esperar un toque evita el primer intento fallido.
   */
  const ANALYZE_DELAY_MS = 1500;
  let analyzeTimer = 0;

  async function autoAnalyze() {
    if (state.gameView !== 'replay' || state.summary || state.analyzing) return;

    if (state.replayPath) {
      const saved = await tvm.replays.archived(state.replayPath).catch(() => null);
      if (saved) {
        state.summary = saved;
        state.summaryError = null;
        repaintStats();
        return;
      }
    }
    // El usuario puede haber salido de la grabación mientras se leía el archivo.
    if (state.gameView === 'replay') runAnalysis();
  }

  function scheduleAutoAnalyze() {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(() => autoAnalyze(), ANALYZE_DELAY_MS);
  }

  /**
   * La tabla de jugadores y el MVP, a partir de los goles.
   *
   * El puntaje es de los que se pueden comprobar a ojo con la lista de goles de
   * acá abajo, y por eso es tan simple: 3 por gol, 2 por asistencia, −2 en
   * contra. Los toques —que sólo existen cuando se analizó una grabación
   * entera— no suman: desempatan, para que entre dos con los mismos números
   * quede arriba el que más jugó la pelota.
   */
  function summarize(goals, roster) {
    const rows = new Map();
    const rowFor = (name, team) => {
      let row = rows.get(name);
      if (!row) {
        row = { name, team: team || '', goals: 0, assists: 0, own: 0, touches: 0, points: 0 };
        rows.set(name, row);
      } else if (team && !row.team) {
        row.team = team;
      }
      return row;
    };

    for (const goal of goals) {
      // En un gol en contra el autor es del equipo que NO sumó: el suyo es el
      // que dice el propio gol, no el del marcador.
      if (goal.scorer) {
        const row = rowFor(goal.scorer, goal.scorerTeam || goal.team);
        if (goal.own) row.own++;
        else row.goals++;
      }
      if (goal.assist) rowFor(goal.assist, goal.team).assists++;
    }
    for (const player of roster) rowFor(player.name, player.team).touches = player.touches || 0;

    const list = [...rows.values()];
    for (const row of list) row.points = row.goals * 3 + row.assists * 2 - row.own * 2;
    list.sort((a, b) =>
      b.points - a.points ||
      b.goals - a.goals ||
      b.assists - a.assists ||
      b.touches - a.touches ||
      a.name.localeCompare(b.name));

    // Un MVP que no hizo nada no es un MVP.
    return { list, mvp: list.find((row) => row.points > 0) || null };
  }

  function repaintStats() {
    const panel = $('#tvmStatsPanel');
    if (panel.hidden) return;

    const isReplay = state.gameView === 'replay';
    const summary = isReplay ? state.summary : null;
    const goals = summary ? summary.goals : state.liveGoals;
    const { list, mvp } = summarize(goals, summary ? summary.players : []);
    // Mientras se analiza no hay nada firme que mostrar: lo de antes ya no vale
    // y lo nuevo todavía no está. Si el análisis falla, en cambio, sí se muestra
    // lo que se vio en vivo: es menos que el resumen completo, pero es cierto.
    const busy = state.analyzing;

    $('#statsTitle').textContent = t(isReplay ? 'stats.titleReplay' : 'stats.title');
    $('#statsAnalyze').hidden = !isReplay || state.analyzing;
    setButtonLabel($('#statsAnalyze'), t(state.summary ? 'stats.again' : 'stats.analyze'));

    // El marcador es la cuenta de goles, no el último que llegó: así también da
    // el total de una grabación con varios partidos seguidos.
    $('#scoreRed').textContent = busy ? '—' : String(goals.filter((g) => g.team === 'Red').length);
    $('#scoreBlue').textContent = busy ? '—' : String(goals.filter((g) => g.team === 'Blue').length);

    $('#statsSub').textContent = statsSubtitle(summary, goals);
    paintStatsNote(summary, goals);

    $('#statsMvp').hidden = busy || !mvp;
    if (mvp && !busy) {
      $('#statsMvpName').textContent = mvp.name;
      // Los toques sólo existen si se analizó la grabación: en vivo no se cuentan
      // y poner «0 toques» sería mentir.
      $('#statsMvpLine').textContent = [
        t('stats.mvpLine', { goals: mvp.goals, assists: mvp.assists }),
        mvp.touches ? t('stats.mvpTouches', { touches: mvp.touches }) : ''
      ].filter(Boolean).join(' · ');
    }

    $('#statsPlayersBlock').hidden = busy || !list.length;
    if (!busy) paintStatsPlayers(list);

    $('#statsGoalsBlock').hidden = busy || !goals.length;
    if (!busy) paintStatsGoals(goals, summary ? summary.matches : null);
    // Saltar a un gol necesita saber en qué milisegundo de la GRABACIÓN entró,
    // y eso sólo lo sabe el análisis. En vivo no hay a dónde saltar.
    $('#statsReel').hidden = busy || !seekableGoals(goals).length;

    paintHeatmap(busy);
    paintMatchCard(busy);
  }

  /**
   * La ficha del partido: posesión, pases, distancia y el remate más fuerte.
   *
   * Sale del mismo mensaje que el mapa y por la misma razón: los números los
   * cuenta el proceso del juego, que es el único que ve la cancha cuadro a
   * cuadro. Acá sólo se muestran.
   */
  function paintMatchCard(busy) {
    /*
     * En una grabación la ficha sale del análisis, no del partido en vivo: son
     * los números de lo que se está mirando. Fuera de la grabación, la del
     * último partido jugado.
     */
    const card = state.gameView === 'replay'
      ? (state.summary && state.summary.card)
      : state.matchCard;
    const block = $('#statsCardBlock');
    block.hidden = busy || !card || !card.players || !card.players.length;
    if (block.hidden) return;

    const rojo = (card.teams && card.teams.Red) || 0;
    const azul = (card.teams && card.teams.Blue) || 0;
    const suma = rojo + azul;
    // Se normaliza a 100: la suma de las posesiones individuales puede quedar
    // un punto corta por los redondeos de cada jugador.
    const pRojo = suma ? Math.round((rojo / suma) * 100) : 50;
    $('#cardPossRed').style.width = `${pRojo}%`;
    $('#cardPossRedN').textContent = `${pRojo}%`;
    $('#cardPossBlueN').textContent = `${100 - pRojo}%`;

    const cuerpo = $('#cardRows');
    cuerpo.replaceChildren();
    for (const fila of card.players) {
      const tr = document.createElement('tr');
      if (fila.team === 'Red' || fila.team === 'Blue') tr.className = `is-${fila.team.toLowerCase()}`;
      for (const valor of [
        fila.name,
        `${fila.possession}%`,
        String(fila.passes),
        String(fila.turnovers),
        fila.distance ? `${(fila.distance / 1000).toFixed(2)} km` : '—',
        fila.topShot ? `${fila.topShot} km/h` : '—'
      ]) {
        const td = document.createElement('td');
        td.textContent = valor;
        tr.append(td);
      }
      cuerpo.append(tr);
    }
  }

  /**
   * El mapa de calor del partido.
   *
   * Llega como PNG chiquito —un píxel por celda— y se agranda por CSS: el
   * suavizado del navegador es justamente lo que convierte los cuadraditos en
   * manchas. La proporción sale de las medidas de CANCHA que manda el juego, no
   * del tamaño del PNG, para que no quede estirado.
   */
  function paintHeatmap(busy) {
    // Mismo criterio que la ficha: en una grabación, el del análisis.
    const img = state.gameView === 'replay'
      ? (state.summary && state.summary.heat)
      : state.heatmap;
    const block = $('#statsHeatBlock');
    block.hidden = busy || !img || !img.url;
    if (block.hidden) return;

    // La imagen se crea la primera vez y después se reusa: así el documento
    // nunca tiene un <img> sin src, y no hay forma de que se vea rota.
    const caja = $('#statsHeatBox');
    let el = caja.firstElementChild;
    if (!el) {
      el = document.createElement('img');
      el.alt = '';
      caja.append(el);
    }
    if (el.src !== img.url) el.src = img.url;
    el.style.aspectRatio = img.w && img.h ? `${img.w} / ${img.h}` : '2 / 1';
  }

  function statsSubtitle(summary, goals) {
    if (state.analyzing) return t('stats.analyzing');
    // Sin análisis —en vivo, o porque falló— lo que hay es lo que se vio pasar.
    if (!summary) return t('stats.live');
    const clock = formatDuration(summary.seconds);
    return summary.matches.length > 1
      ? t('stats.recapMatches', { goals: goals.length, matches: summary.matches.length, clock })
      : t('stats.recap', { goals: goals.length, clock });
  }

  /** El renglón que explica qué está pasando cuando el panel no es un resumen. */
  function paintStatsNote(summary, goals) {
    const note = $('#statsNote');
    let text = '';
    let kind = '';

    if (state.analyzing) text = t('stats.analyzingNote');
    else if (state.summaryError) { text = state.summaryError; kind = 'is-bad'; }
    else if (summary && summary.partial) { text = t('stats.partial'); kind = 'is-warn'; }
    else if (!goals.length) text = t(summary ? 'stats.emptyReplay' : 'stats.empty');
    // Sin el parche del bundle los goles llegan sin autor: se dice, en vez de
    // dejar una tabla vacía sin explicación.
    else if (goals.some((goal) => !goal.scorer)) { text = t('stats.noPatch'); kind = 'is-warn'; }

    note.hidden = !text;
    note.textContent = text;
    note.className = `stats-panel__note${kind ? ` ${kind}` : ''}`;
  }

  function paintStatsPlayers(list) {
    $('#statsPlayers').replaceChildren(...list.map((row) => {
      const tr = document.createElement('tr');

      const cell = document.createElement('td');
      const who = document.createElement('div');
      who.className = 'stats-table__who';
      who.append(teamDot(row.team), statsSpan('stats-table__name', row.name));
      who.title = row.name;
      if (row.own) {
        who.append(statsSpan('stats-table__own',
          row.own > 1 ? `${t('stats.own')} ×${row.own}` : t('stats.own')));
      }
      cell.append(who);
      tr.append(cell);

      for (const value of [row.goals, row.assists, row.touches || '—', row.points]) {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        tr.append(cell);
      }
      return tr;
    }));
  }

  /*
   * ── El carrete de goles ────────────────────────────────────────────────
   *
   * `goal.at` es el milisegundo de la grabación en el que entró cada uno, y lo
   * pone el análisis. Con eso un gol deja de ser un renglón de una lista y pasa
   * a ser un lugar: se puede saltar ahí, y se pueden encadenar todos.
   *
   * En vivo el campo no existe —la partida no es un archivo, no hay a dónde
   * saltar— y por eso todo esto se decide mirando el dato y no la pantalla.
   */
  function seekableGoals(goals) {
    if (state.gameView !== 'replay') return [];
    return (goals || []).filter((goal) => Number.isFinite(goal.at));
  }

  /** Salta a un gol. Cierra el panel: nadie quiere mirar la jugada tapada. */
  function jumpToGoal(goal) {
    if (!Number.isFinite(goal.at)) return;
    toggleStatsPanel(false);
    tvm.replays.seek(Math.max(0, goal.at - 6000)).catch((err) => toast(err.message, 'err'));
  }

  $('#statsReel').addEventListener('click', () => {
    const list = seekableGoals(state.summary ? state.summary.goals : []);
    if (!list.length) return;
    toggleStatsPanel(false);
    tvm.replays
      .reel(list.map((goal) => ({ at: goal.at, name: goal.scorer || '' })))
      .catch((err) => toast(err.message, 'err'));
  });

  function paintStatsGoals(goals, matches) {
    const several = matches && matches.length > 1;
    const saltables = seekableGoals(goals).length > 0;
    const nodes = [];
    let shown = -1;

    goals.forEach((goal) => {
      // Una grabación puede tener varios partidos seguidos: se separan, porque
      // si no el marcador de la lista parece que va y viene.
      if (several && goal.match !== shown) {
        shown = goal.match;
        const head = document.createElement('li');
        head.className = 'stats-goals__match';
        const match = matches[goal.match];
        head.textContent = t('stats.matchN', { n: goal.match + 1 }) +
          (match ? ` · ${match.red}–${match.blue}` : '');
        nodes.push(head);
      }

      const row = document.createElement('li');
      row.className = `stats-goal stats-goal--${goal.team === 'Red' ? 'red' : 'blue'}`;

      row.append(statsSpan('stats-goal__clock', goal.clock || '—'));

      const who = statsSpan('stats-goal__who', goal.scorer || t('stats.noScorer'));
      if (!goal.scorer) who.classList.add('is-faint');
      row.append(who);

      if (goal.own) row.append(statsSpan('stats-goal__own', t('stats.own')));
      if (goal.assist) row.append(statsSpan('stats-goal__assist', t('stats.assist', { name: goal.assist })));
      if (goal.score) row.append(statsSpan('stats-goal__score', `${goal.score.red}–${goal.score.blue}`));

      /*
       * El renglón entero salta a la jugada. Es un <li> y no un <button> porque
       * el botón traía su propia caja y rompía la grilla de la lista; lo que
       * hace falta del botón es el teclado, y eso se pide a mano.
       */
      if (saltables && Number.isFinite(goal.at)) {
        row.classList.add('is-seekable');
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.title = t('stats.jump');
        row.addEventListener('click', () => jumpToGoal(goal));
        row.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          jumpToGoal(goal);
        });
      }

      nodes.push(row);
    });

    $('#statsGoals').replaceChildren(...nodes);
  }

  function statsSpan(className, text) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  function teamDot(team) {
    const dot = document.createElement('span');
    dot.className = 'team-dot';
    if (team === 'Red' || team === 'Blue') dot.classList.add(`team-dot--${team.toLowerCase()}`);
    return dot;
  }

  function toggleStatsPanel(force) {
    const panel = $('#tvmStatsPanel');
    const show = force === undefined ? panel.hidden : force;
    panel.hidden = !show;
    if (!show) return;
    /* En un replay el resumen es de la grabación ENTERA, así que abrirlo es
       pedir el análisis. Normalmente ya está hecho —se dispara solo al abrir la
       grabación—, y va por `autoAnalyze` y no por `runAnalysis` para que también
       acá valga el archivo en disco: si esta grabación ya se analizó, se lee, no
       se vuelve a simular. */
    if (state.gameView === 'replay' && !state.summary && !state.analyzing) autoAnalyze();
    else repaintStats();
  }

  tvm.game.onToggleStats((info) => {
    // El botón «Resumen» del reproductor abre y analiza; estando abierto, cierra.
    if (info && info.analyze && $('#tvmStatsPanel').hidden) return toggleStatsPanel(true);
    toggleStatsPanel();
  });

  $('#closeStatsPanel').addEventListener('click', () => toggleStatsPanel(false));
  $('#statsAnalyze').addEventListener('click', () => runAnalysis());

  /*
   * Tab también acá, para cuando el foco está en la app y no adentro del juego
   * (recién arrancado, o después de tocar algo del cliente). El caso normal
   * —jugando, con el foco en el <webview>— lo resuelve el preload del juego:
   * las teclas de un webview nunca llegan a este documento.
   */
  window.addEventListener('keydown', (e) => {
    // La misma tecla que en el preload, y de la misma config: si acá quedaba
    // Tab fija, cambiar la opción no servía de nada con el foco en la app.
    const wanted = state.config.general.summaryKey;
    const key = typeof wanted === 'string' ? wanted : 'Tab';
    if (!key || e.key !== key || e.ctrlKey || e.altKey || e.metaKey) return;
    if (state.stage !== 'game') return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (active && active.isContentEditable)) return;
    e.preventDefault();
    toggleStatsPanel();
  });

  /*
   * Una grabación nueva en la carpeta.
   *
   * HaxBall la guarda donde van las descargas y no le avisa a nadie, así que
   * sin esto aparecía recién cuando el usuario entraba a la pestaña y
   * refrescaba a mano. El aviso llega una sola vez por grabación —el vigilante
   * ya filtró las que sólo se renombraron— y sólo se anuncia si el usuario no
   * está mirando la lista, donde la vería aparecer sola.
   */
  tvm.replays.onNew((item) => {
    loadReplays();
    if (state.view !== 'replays') toast(t('toast.newReplay', { name: item.name }), 'ok');
  });

  tvm.game.onLiveSettings(({ available }, meta) => { tabBucket(meta).s.liveGameSettings = !!available; });
  // El resumen se vacía con `game:match-start`, que llega del propio juego
  // cuando arranca un partido nuevo: entrar a una sala no es empezar a jugar.
  tvm.game.onPlaying((playing, meta) => {
    const { s, active } = tabBucket(meta);
    if (active) setPlaying(playing);
    else s.playing = !!playing;
    renderTabs();
  });
  // El engranaje del HUD del juego abre estos ajustes, no los de HaxBall.
  tvm.game.onOpenSettings(() => setView('ajustes'));
  tvm.game.onToast(({ message, kind }) => toast(message, kind));
  // La ubicación llega después de que carga el juego: recién ahí hay distancias.
  tvm.rooms.onStale(() => { state.rooms.fetchedAt = 0; refreshRoomsIfStale(); });
  tvm.rooms.onLast((last) => paintLastRoom(last));
  refreshLastRoom();
  tvm.rooms.onFlags(applyFlags);
  tvm.auth.onLive(() => loadAuth());
  tvm.avatar.onLive(({ face }) => {
    state.liveAvatar = face || '';
    renderAvatar();
  });
  tvm.keys.onLive(({ keys }) => {
    state.liveKeys = keys || null;
    renderKeys();
  });
  tvm.updates.onProgress(paintUpdateProgress);

  // Una sola consulta al feed por arranque, y sólo si el usuario la dejó puesta.
  if (state.config.updates.autoCheck) checkUpdates({ silent: true });

  // Los FPS y el ping ya no se muestran acá arriba: están en el overlay, dentro
  // de la cancha. Lo único que queda es contar el tiempo jugado.
  tvm.game.onTelemetry(() => {
    if (!state.playing) return;
    state.playedSeconds++;
    if (state.playedSeconds >= 60) flushPlayTime();
  });

  // Los avisos al usuario llegan por game:toast; esto es sólo diagnóstico.
  tvm.game.onLog(({ level, message, source }) => {
    if (level === 'error') console.error(`[${source}]`, message);
  });

  window.addEventListener('beforeunload', flushPlayTime);
}

/*
 * La pantalla de carga se saca en el `finally`, no dentro de `boot()`.
 *
 * Dos razones. Una: si el arranque falla a mitad de camino, esconderla igual es
 * obligatorio — una app que se queda para siempre en «Cargando» no deja ni ver
 * el error. Dos: el resto de `boot()` engancha los listeners de IPC, y esperar
 * el mínimo de la pantalla ahí adentro los dejaría sin registrar durante más de
 * un segundo, justo mientras el juego arranca y empieza a mandar eventos.
 */
boot()
  .catch((err) => {
    console.error(err);
    toast(err.message, 'err');
  })
  .finally(hideSplash);
