'use strict';

/**
 * Ajustes propios de HaxBall.
 *
 * HaxBall guarda su configuración en el localStorage de haxball.com. Cada
 * entrada de acá describe una clave real: qué valores acepta y cómo se llama
 * en la interfaz del cliente.
 *
 * El mapa salió de leer el propio `game-min.js` del juego, donde se declaran
 * todas de una:
 *
 *   this.qe = e("player_name","",25);   this.Rd = d("view_mode",-1);
 *   this.Qh = d("fps_limit",0);         this.zh = e("avatar",null,2);
 *   this.Wm = b("team_colors",!0);      this.Vk = b("show_indicators",!0);
 *   this.Xi = c("sound_volume",1);      this.ye = b("sound_main",!0);
 *   this.Wi = b("sound_chat",!0);       this.Om = b("sound_highlight",!0);
 *   this.Nm = b("sound_crowd",!0);      this.Zj = e("player_auth_key",null,1024);
 *   this.Ad = d("extrapolation",0);     this.Li = c("resolution_scale",1);
 *   this.Lm = b("show_avatars",!0);     this.lk = d("chat_height",160);
 *   this.Gh = d("chat_focus_height",140); this.Hh = c("chat_opacity",.8);
 *   this.kk = e("chat_bg_mode","compact",50); this.ki = b("low_latency_canvas",!0);
 *
 * donde `b` es booleano ("0"/"1"), `c` flotante, `d` entero y `e` texto con
 * largo máximo.
 *
 * Es la única fuente de verdad: la usa el preload para escribir las claves
 * antes de que arranque el juego, y la interfaz para dibujar los controles.
 */

const SETTINGS = [
  /* ── Video ───────────────────────────────────────────────── */
  {
    id: 'resolutionScale',
    key: 'resolution_scale',
    label: 'Escala de resolución',
    labelEn: 'Resolution scale',
    help: 'Bajala si te va lento: dibuja menos píxeles y sube los FPS.',
    helpEn: 'Lower it if it runs slow: fewer pixels drawn, more FPS.',
    type: 'select',
    group: 'video',
    default: '1',
    options: [
      { value: '1', label: '100% · nítido', labelEn: '100% · sharp' },
      { value: '0.75', label: '75%', labelEn: '75%' },
      { value: '0.5', label: '50%', labelEn: '50%' },
      { value: '0.25', label: '25% · máximo rendimiento', labelEn: '25% · max performance' }
    ]
  },

  {
    id: 'showAvatars',
    key: 'show_avatars',
    label: 'Ver avatares',
    labelEn: 'Show avatars',
    help: 'Los emojis que los jugadores muestran sobre su disco.',
    helpEn: 'The emojis players show over their disc.',
    type: 'toggle',
    group: 'video',
    default: '1'
  },
  {
    id: 'showIndicators',
    key: 'show_indicators',
    label: 'Ver indicadores de chat',
    labelEn: 'Show chat indicators',
    help: 'Marca quién está escribiendo.',
    helpEn: 'Marks who is typing.',
    type: 'toggle',
    group: 'video',
    default: '1'
  },
  {
    id: 'teamColors',
    key: 'team_colors',
    label: 'Colores de equipo personalizados',
    labelEn: 'Custom team colours',
    help: 'Deja que la sala pinte los equipos con sus propios colores.',
    helpEn: 'Lets the room paint teams with its own colours.',
    type: 'toggle',
    group: 'video',
    default: '1'
  },

  /* ── Chat ────────────────────────────────────────────────── */
  {
    id: 'chatOpacity',
    key: 'chat_opacity',
    label: 'Opacidad del chat',
    labelEn: 'Chat opacity',
    help: null,
    helpEn: null,
    type: 'range',
    group: 'chat',
    default: '0.8',
    min: 0.5,
    max: 1,
    step: 0.01,
    format: (v) => `${Math.round(Number(v) * 100)}%`
  },
  {
    id: 'chatHeight',
    key: 'chat_height',
    label: 'Alto del chat',
    labelEn: 'Chat height',
    help: 'Cuánto ocupa el chat cuando no estás escribiendo.',
    helpEn: 'How tall the chat is while you are not typing.',
    type: 'range',
    group: 'chat',
    default: '160',
    min: 0,
    max: 400,
    step: 1,
    format: (v) => `${v} px`
  },
  {
    id: 'chatFocusHeight',
    key: 'chat_focus_height',
    label: 'Alto del chat al escribir',
    labelEn: 'Chat height while typing',
    help: null,
    helpEn: null,
    type: 'range',
    group: 'chat',
    default: '140',
    min: 0,
    max: 400,
    step: 1,
    format: (v) => `${v} px`
  },
  {
    id: 'chatBgMode',
    key: 'chat_bg_mode',
    label: 'Fondo del chat',
    labelEn: 'Chat background',
    help: null,
    helpEn: null,
    type: 'select',
    group: 'chat',
    default: 'compact',
    options: [
      { value: 'compact', label: 'Compacto', labelEn: 'Compact' },
      { value: 'full', label: 'Ancho completo', labelEn: 'Full width' }
    ]
  },

  /* ── Sonido ──────────────────────────────────────────────── */
  {
    id: 'soundVolume',
    key: 'sound_volume',
    label: 'Volumen',
    labelEn: 'Volume',
    help: null,
    helpEn: null,
    type: 'range',
    group: 'sound',
    default: '1',
    min: 0,
    max: 1,
    step: 0.01,
    format: (v) => `${Math.round(Number(v) * 100)}%`
  },
  {
    id: 'soundMain',
    key: 'sound_main',
    label: 'Sonidos del juego',
    labelEn: 'Game sounds',
    help: null,
    helpEn: null,
    type: 'toggle',
    group: 'sound',
    default: '1'
  },
  {
    id: 'soundChat',
    key: 'sound_chat',
    label: 'Sonido del chat',
    labelEn: 'Chat sound',
    help: null,
    helpEn: null,
    type: 'toggle',
    group: 'sound',
    default: '1'
  },
  {
    id: 'soundHighlight',
    key: 'sound_highlight',
    label: 'Aviso cuando te nombran',
    labelEn: 'Nick highlight sound',
    help: 'Suena cuando alguien escribe tu nombre en el chat.',
    helpEn: 'Plays when someone types your name in chat.',
    type: 'toggle',
    group: 'sound',
    default: '1'
  },
  {
    id: 'soundCrowd',
    key: 'sound_crowd',
    label: 'Sonido de la hinchada',
    labelEn: 'Crowd sound',
    help: null,
    helpEn: null,
    type: 'toggle',
    group: 'sound',
    default: '1'
  }
];

const NICK_KEY = 'player_name';
/**
 * Avatar fijo de HaxBall. El juego lo recorta con
 *
 *   Xc(a, b) { return a.length <= b ? a : O.substr(a, 0, b) }   // b = 2
 *
 * o sea: dos **unidades UTF-16**, no dos caracteres. Un emoji fuera del plano
 * básico (🔥) ya ocupa las dos; uno del plano básico (⚽) ocupa una. Mandarle
 * "⚽🔥" hacía que HaxBall guardara "⚽\uD83D" — medio emoji, que se dibuja como
 * un rombo con signo de pregunta.
 */
const AVATAR_KEY = 'avatar';
const AVATAR_MAX = 2;

/**
 * Recorta respetando los límites de cada símbolo: agrega cuadros enteros
 * mientras entren en el presupuesto de HaxBall, y nunca parte uno al medio.
 */
function clampAvatar(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (value.length <= AVATAR_MAX) return value;

  let out = '';
  for (const glyph of graphemes(value)) {
    if (out.length + glyph.length > AVATAR_MAX) break;
    out += glyph;
  }
  return out;
}

/** Parte el texto en símbolos completos (un emoji con modificador es uno solo). */
function graphemes(text) {
  const value = String(text || '');
  try {
    const segmenter = new Intl.Segmenter('es', { granularity: 'grapheme' });
    return [...segmenter.segment(value)].map((s) => s.segment).filter((c) => c.trim());
  } catch {
    return [...value].filter((c) => c.trim());
  }
}
/* ── Identidad (auth) ───────────────────────────────────────────────── *
 * HaxBall guarda la identidad en `player_auth_key` como
 *
 *     idkey.<x>.<y>.<d>
 *
 * que son las tres componentes de una clave ECDSA P-256 en formato JWK: `x` e
 * `y` son el punto público y `d` el escalar privado. Sale de game-min.js:
 *
 *   static fp(a){ a=a.split(".");
 *                 if(4!=a.length || "idkey"!=a[0]) return Promise.reject("Invalid id format");
 *                 return V.Ls(a[1],a[2],a[3])... }
 *
 * y se carga así:
 *
 *   let a = m.j.Zj.v();
 *   null == a ? V.gp().then(...)          // no había: genera una nueva
 *             : V.fp(a).then(...).catch(function(){})   // había: la importa
 *
 * Ese `.catch(function(){})` vacío es la trampa: si lo guardado no tiene el
 * formato exacto, HaxBall **se traga el error sin decir nada** y arranca sin
 * identidad. En la sala eso se ve como "auth desconocida", sin ninguna pista de
 * que el problema fue la clave. Por eso se valida antes de guardarla: es la
 * única forma de que el jugador se entere.
 *
 * Ojo con lo que se pega: el `auth` corto que muestran los hosts es el
 * identificador PÚBLICO, no la clave. Ése no sirve — hay que copiar el valor
 * entero de `player_auth_key`.
 */
const AUTH_KEY = 'player_auth_key';

/** Las tres componentes van en base64url; en P-256 son 32 bytes → 43 caracteres. */
const AUTH_RE = /^idkey\.[A-Za-z0-9_-]{40,48}\.[A-Za-z0-9_-]{40,48}\.[A-Za-z0-9_-]{40,48}$/;

function isValidAuthKey(value) {
  return AUTH_RE.test(String(value || '').trim());
}

/* ── Bandera ────────────────────────────────────────────────────────── *
 * HaxBall detecta el país solo y lo guarda en `geo`. Además respeta un
 * `geo_override` que, si está, gana:
 *
 *   Vh(){ return null != this.af.v() ? this.af.v()
 *        : null != this.$e.v() ? this.$e.v() : new la }     // af = geo_override
 *
 * Las dos claves guardan el mismo objeto serializado:
 *
 *   De(){ return JSON.stringify({ lat: ..., lon: ..., code: ... }) }
 *   gg(a){ ... b.ub = a.code.toLowerCase() ... }
 *
 * O sea `{"lat":-34.6,"lon":-58.4,"code":"ar"}`, con el código en minúsculas.
 * La latitud y la longitud importan: son las que usan las salas para ordenar
 * por distancia, así que conviene mandar las del país elegido y no dejarlas en
 * cero, que caería en medio del Atlántico.
 */
const GEO_KEY = 'geo';
const GEO_OVERRIDE_KEY = 'geo_override';

function serializeGeo({ lat, lon, code }) {
  return JSON.stringify({
    lat: Number(lat) || 0,
    lon: Number(lon) || 0,
    code: String(code || '').toLowerCase().slice(0, 3)
  });
}

function parseGeo(raw) {
  if (!raw) return null;
  try {
    const { lat, lon, code } = JSON.parse(raw);
    if (!code) return null;
    return { lat: Number(lat) || 0, lon: Number(lon) || 0, code: String(code).toLowerCase() };
  } catch {
    return null;
  }
}

/* ── Controles ──────────────────────────────────────────────────────── *
 * HaxBall guarda los controles en `player_keys` como un JSON plano
 * { códigoDeTecla: acción }, donde el código es el `KeyboardEvent.code`
 * ("KeyW", "ArrowUp", "Space", "Numpad0"…). Varias teclas pueden apuntar a la
 * misma acción; de ahí que el mapa vaya de tecla a acción y no al revés.
 *
 * Sale de game-min.js:
 *
 *   class sa {
 *     De()        { return JSON.stringify({ [code]: action, ... }) }
 *     static Sh(a){ return sa.gg(JSON.parse(a)) }
 *     static wk() { ...los valores de fábrica de abajo... }
 *   }
 */
const KEYS_KEY = 'player_keys';

/** Las acciones que entiende el juego, en el orden en que se muestran. */
const ACTIONS = ['Up', 'Down', 'Left', 'Right', 'Kick', 'ToggleChat'];

const DEFAULT_KEYS = {
  ArrowUp: 'Up',
  KeyW: 'Up',
  ArrowDown: 'Down',
  KeyS: 'Down',
  ArrowLeft: 'Left',
  KeyA: 'Left',
  ArrowRight: 'Right',
  KeyD: 'Right',
  KeyX: 'Kick',
  Space: 'Kick',
  ControlLeft: 'Kick',
  ControlRight: 'Kick',
  ShiftLeft: 'Kick',
  ShiftRight: 'Kick',
  Numpad0: 'Kick'
  /*
   * Tab NO va atado a `ToggleChat`, aunque HaxBall lo traiga así de fábrica:
   * en este cliente Tab abre el resumen del partido. Dejarlo acá hacía que el
   * editor de controles mostrara «Chat: Tab», que desde que el preload corta
   * esa tecla en captura ya no era cierto.
   *
   * La acción sigue existiendo: el que la quiera puede atarle la tecla que se
   * le cante desde los controles.
   */
};

/** Descarta lo que no sea una acción conocida: el juego ignoraría el resto. */
function cleanKeys(map) {
  const out = {};
  for (const [code, action] of Object.entries(map || {})) {
    if (typeof code === 'string' && code && ACTIONS.includes(action)) out[code] = action;
  }
  return out;
}

function parseKeys(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const clean = cleanKeys(parsed);
    return Object.keys(clean).length ? clean : null;
  } catch {
    return null; // guardado corrupto: se cae a los valores de fábrica
  }
}

function serializeKeys(map) {
  return JSON.stringify(cleanKeys(map));
}

const BY_ID = new Map(SETTINGS.map((s) => [s.id, s]));
const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

/** Valores por defecto, listos para guardar en la config del cliente. */
function defaults() {
  return Object.fromEntries(SETTINGS.map((s) => [s.id, s.default]));
}

/**
 * Normaliza un valor al formato que espera HaxBall: los booleanos van como
 * "0"/"1" y los números como texto. Sin esto, un `true` de JSON se escribiría
 * literalmente y el juego lo leería como verdadero incluso apagado.
 */
function normalize(setting, value) {
  if (setting.type === 'toggle') {
    const on = value === true || value === '1' || value === 1;
    return on ? '1' : '0';
  }
  if (setting.type === 'range') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(setting.default);
    const clamped = Math.min(setting.max, Math.max(setting.min, n));
    const step = setting.step || 1;
    return String(Number((setting.min + Math.round((clamped - setting.min) / step) * step).toFixed(6)));
  }
  if (setting.options && !setting.options.some(option => String(option.value) === String(value))) return String(setting.default);
  return String(value);
}

/** Traduce la config del cliente a las claves reales de localStorage. */
function toStorage(gameConfig, nickname, avatar) {
  const entries = SETTINGS
    .filter((s) => gameConfig[s.id] !== undefined && gameConfig[s.id] !== null)
    .map((s) => [s.key, normalize(s, gameConfig[s.id])]);

  if (nickname) entries.push([NICK_KEY, String(nickname).slice(0, 25)]);
  // Un avatar vacío es una elección válida (quitarlo), pero HaxBall no
  // distingue "sin valor" de "vacío": sólo se escribe si hay algo.
  const face = clampAvatar(avatar);
  if (face) entries.push([AVATAR_KEY, face]);

  return Object.fromEntries(entries);
}

/**
 * Al revés: lee las claves de HaxBall y devuelve los ids del cliente. Se usa
 * para adoptar lo que el jugador ya tenía configurado dentro del juego en vez
 * de pisárselo con los valores de fábrica.
 *
 * @param {(key:string) => string|null} read
 */
function fromStorage(read) {
  const out = {};
  for (const [key, setting] of BY_KEY) {
    const raw = read(key);
    if (raw === null || raw === undefined || raw === '') continue;
    out[setting.id] = normalize(setting, raw);
  }
  return out;
}

/**
 * Versión serializable para el renderer: las funciones `format` no cruzan IPC,
 * así que se mandan como nombre y la interfaz las resuelve.
 */
function schema() {
  return SETTINGS.map(({ format, ...rest }) => ({
    ...rest,
    format: format ? rest.id : null
  }));
}

module.exports = {
  SETTINGS,
  NICK_KEY,
  AVATAR_KEY,
  AVATAR_MAX,
  AUTH_KEY,
  isValidAuthKey,
  GEO_KEY,
  GEO_OVERRIDE_KEY,
  serializeGeo,
  parseGeo,
  KEYS_KEY,
  ACTIONS,
  DEFAULT_KEYS,
  cleanKeys,
  parseKeys,
  serializeKeys,
  BY_ID,
  defaults,
  toStorage,
  fromStorage,
  normalize,
  clampAvatar,
  graphemes,
  schema
};
