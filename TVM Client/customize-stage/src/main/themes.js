'use strict';

/**
 * Temas del cliente.
 *
 * Un tema es una paleta y se aplica en los dos lados:
 *
 *   · La interfaz del cliente — `appVars()` devuelve las variables CSS que el
 *     renderer cuelga de <html>.
 *   · Las pantallas de HaxBall — `gameCss()` genera la hoja que el preload
 *     inyecta dentro del iframe del juego.
 *
 * Antes había dos cosas separadas y el tema sólo cambiaba el juego; ahora la
 * misma paleta manda en toda la app.
 *
 * Los selectores del juego salen de `game.css` (el propio de HaxBall), leído en
 * vivo desde el iframe. Todo va con !important porque game.css es específico.
 *
 * Regla de oro: sólo se tocan color, borde, radio, sombra, tipografía y
 * espaciado. Nada de cambiar display/position de elementos estructurales — si
 * HaxBall cambia su markup, las reglas dejan de aplicar pero el juego sigue
 * funcionando. La única excepción es el HUD de botones de la partida, que sí se
 * reordena, porque tal cual viene se superpone con el overlay.
 */

/**
 * @typedef {object} Palette
 * @property {boolean} dark
 * @property {string} bg      Fondo más profundo
 * @property {string} bg1     Fondo intermedio
 * @property {string} panel   Superficie de tarjetas y diálogos
 * @property {string} panelTop Arriba del degradé de las tarjetas
 * @property {string} field   Fondo de inputs
 * @property {string} text    Texto principal
 * @property {string} dim     Texto secundario — tiene que seguir siendo legible
 * @property {string} faint   Texto terciario (etiquetas, unidades)
 * @property {string} accent  null = usa el acento elegido por el usuario
 * @property {string} accentText Texto sobre el acento
 */

const BUILT_IN = {
  tvm: {
    label: 'Clásico',
    description: 'Violeta oscuro clásico.',
    dark: true,
    bg: '#08070c', bg1: '#100d18', panel: '#171326', panelTop: '#1f1932',
    field: '#0a0812',
    text: '#f3f0fb', dim: '#c0b8d6', faint: '#8f87a6',
    accent: null, accentText: '#ffffff'
  },
  toda: {
    label: 'TL App · Club',
    description: 'Azul marino y dorado del escudo de Toda la Lecce.',
    dark: true,
    bg: '#0a1327', bg1: '#0f1d3a', panel: '#172a50', panelTop: '#203860',
    field: '#0b1630',
    text: '#f4f0df', dim: '#c9d0e0', faint: '#97a3bd',
    accent: '#c9a85c', accent2: '#a8873f', accentText: '#0c1630'
  },
  oscuro: {
    label: 'Oscuro',
    description: 'Gris neutro, sin color de marca.',
    dark: true,
    bg: '#0c0c0f', bg1: '#131317', panel: '#1a1a20', panelTop: '#22222a',
    field: '#0a0a0d',
    text: '#f0f0f4', dim: '#bcbcc8', faint: '#8b8b99',
    accent: '#6f7080', accentText: '#ffffff'
  },
  medianoche: {
    label: 'Medianoche',
    description: 'Azul profundo, como una cancha de noche.',
    dark: true,
    bg: '#060a14', bg1: '#0b1220', panel: '#111b2e', panelTop: '#17253d',
    field: '#070c16',
    text: '#eef3fb', dim: '#b3c2da', faint: '#7f8fa8',
    accent: '#3b82f6', accentText: '#ffffff'
  },
  esmeralda: {
    label: 'Esmeralda',
    description: 'Verde césped, oscuro y sobrio.',
    dark: true,
    bg: '#05100c', bg1: '#0a1a14', panel: '#0f2620', panelTop: '#15332a',
    field: '#06120e',
    text: '#eefaf4', dim: '#aecfc2', faint: '#7ba193',
    accent: '#10b981', accentText: '#04241a'
  },
  carmesi: {
    label: 'Carmesí',
    description: 'Rojo intenso sobre negro.',
    dark: true,
    bg: '#0d0607', bg1: '#160a0d', panel: '#231014', panelTop: '#2e161b',
    field: '#0f0709',
    text: '#fbeef0', dim: '#d8b6bc', faint: '#a8858c',
    accent: '#e0384f', accentText: '#ffffff'
  },
  ambar: {
    label: 'Ámbar',
    description: 'Dorado cálido, poco contraste azul.',
    dark: true,
    bg: '#0d0a05', bg1: '#171106', panel: '#241a0b', panelTop: '#302310',
    field: '#0f0b05',
    text: '#fdf4e5', dim: '#dbc79f', faint: '#a99a74',
    accent: '#f0a422', accentText: '#241703'
  },
  /* ── Temas de dos acentos ───────────────────────────────────────────────
   *
   * Los de arriba son de UN color: el acento tiñe todo y el fondo es su versión
   * apagada. Estos mezclan dos, y la mezcla aparece en tres lugares —el cono de
   * fondo (`aura`), el degradé de los botones principales y la barrita de los
   * títulos—, nunca como dos colores peleando por el mismo elemento. Un segundo
   * acento suelto por la interfaz no se lee como un tema: se lee como un error.
   *
   * ── Por qué los acentos no son más brillantes ──────────────────────────
   *
   * El botón principal se pinta con un degradé que va de un acento al otro, y
   * el texto lo cruza entero con UN solo color. O sea que los dos extremos
   * tienen que aguantar el mismo texto encima. Los pares están elegidos con esa
   * condición: los ocho colores dan ~4.7 de contraste con el blanco, mejor que
   * Medianoche (3.68) y Carmesí (4.33), que ya estaban.
   *
   * Lo brillante va en el `aura`, que es fondo y nunca lleva texto encima: ahí
   * sí entran los verdes y los rosas que le dan el nombre a cada tema.
   *
   */
  aurora: {
    label: 'Aurora',
    description: 'Verde y violeta, como el cielo del norte.',
    dark: true,
    bg: '#040c10', bg1: '#08161c', panel: '#0d222a', panelTop: '#122e35',
    field: '#051115',
    text: '#e9f8f6', dim: '#a8cbc9', faint: '#789e9e',
    accent: '#158367', accent2: '#8258e4', accentText: '#ffffff',
    aura: { stops: ['#12b489', '#2fd8c4', '#8258e4', '#2a1f52'], seconds: 34 }
  },
  ocaso: {
    label: 'Ocaso',
    description: 'Naranja que se apaga en magenta.',
    dark: true,
    bg: '#10060a', bg1: '#1b0b11', panel: '#28111b', panelTop: '#351822',
    field: '#12070c',
    text: '#fdeef1', dim: '#dbb3ba', faint: '#ab848e',
    accent: '#c44e13', accent2: '#d32b85', accentText: '#ffffff',
    aura: { stops: ['#f0762c', '#e8437f', '#8e2bb0', '#2a0d20'], seconds: 30 }
  },
  nebulosa: {
    label: 'Nebulosa',
    description: 'Azul y rosa sobre índigo.',
    dark: true,
    bg: '#07071a', bg1: '#0c0d26', panel: '#151638', panelTop: '#1d1d47',
    field: '#08081b',
    text: '#efeffd', dim: '#b7b7dc', faint: '#8989b2',
    accent: '#3f6be7', accent2: '#ba33cf', accentText: '#ffffff',
    aura: { stops: ['#3f6be7', '#7b4ee0', '#ce46c9', '#141a4a'], seconds: 38 }
  },
  claro: {
    label: 'Claro',
    description: 'Fondo blanco. Para jugar de día.',
    dark: false,
    bg: '#f4f4f8', bg1: '#ffffff', panel: '#ffffff', panelTop: '#fbfbfe',
    field: '#f0f0f5',
    text: '#16141f', dim: '#4b4760', faint: '#6d6885',
    accent: null, accentText: '#ffffff'
  },
  /*
   * El único claro con dos acentos. El cono de fondo va en pastel a propósito:
   * sobre blanco, los mismos colores que en un tema oscuro se ven como una
   * mancha de tinta, no como luz.
   */
  amanecer: {
    label: 'Amanecer',
    description: 'Claro, con rosa y lavanda.',
    dark: false,
    bg: '#f8f4f6', bg1: '#ffffff', panel: '#ffffff', panelTop: '#fdf6f8',
    field: '#f3ecef',
    text: '#1c1420', dim: '#574559', faint: '#78677d',
    accent: '#d5345f', accent2: '#8857dd', accentText: '#ffffff',
    aura: { stops: ['#ffc2d2', '#ffdcc0', '#cfc0ff', '#ffe8f0'], seconds: 40 }
  },
  clasico: {
    label: 'Clásico',
    description: 'HaxBall tal cual, sin tocar. La app queda oscura.',
    dark: true,
    bg: '#0c0c0f', bg1: '#131317', panel: '#1a1a20', panelTop: '#22222a',
    field: '#0a0a0d',
    text: '#f0f0f4', dim: '#bcbcc8', faint: '#8b8b99',
    accent: null, accentText: '#ffffff',
    /** En la tarjeta se muestra el azul de los botones del propio HaxBall. */
    previewAccent: '#3f7ab0',
    /** El juego no se re-estiliza: es todo el punto de este tema. */
    skipGame: true
  },

};

/**
 * Metadatos que el renderer usa para dibujar las tarjetas de tema.
 */
function list(customThemes) {
  const out = {};
  for (const [id, p] of Object.entries(BUILT_IN)) {
    out[id] = {
      label: p.label,
      description: p.description,
      custom: false,
      /** Para el rol: la tarjeta lo dibuja con candado y `cfg:set` lo rechaza. */
      vip: !!p.vip,
      animated: !!p.aura,
      preview: preview(p)
    };
  }
  for (const theme of customThemes || []) {
    if (!theme || !theme.id) continue;
    const p = resolveCustom(theme);
    out[theme.id] = {
      label: theme.label || 'Personalizado',
      description: theme.description || 'Tema tuyo.',
      custom: true,
      preview: preview(p)
    };
  }
  return out;
}

/** Dorado de la identidad del club para los temas que siguen el acento elegido. */
const BRAND_ACCENT = '#8c702a';

/**
 * El color del acento que muestra la tarjeta de vista previa.
 *
 * Los temas con `accent: null` adoptan el que eligió el usuario, pero la
 * tarjeta NO puede usar ése: al cambiar de tema se teñían también las vistas
 * previas de los demás —ponías Carmesí y la barrita de TVM se volvía roja—.
 * Cada tarjeta muestra siempre un color fijo y representativo del tema.
 */
function preview(p) {
  return {
    bg: p.bg,
    panel: p.panelTop,
    accent: p.accent || p.previewAccent || BRAND_ACCENT,
    /** Sólo los temas de dos acentos: la tarjeta pinta su botón con los dos. */
    accent2: p.accent2 || null,
    text: p.text,
    dark: p.dark !== false,
    /** Los colores del aura: la tarjeta los anima igual que el fondo real. */
    aura: p.aura ? p.aura.stops : null
  };
}

/** Un tema personalizado sólo define unos pocos colores; el resto se deriva. */
function resolveCustom(theme) {
  const dark = theme.dark !== false;
  const bg = theme.bg || (dark ? '#0b0b10' : '#f5f5f9');
  const accent = theme.accent || null;
  const text = theme.text || (dark ? '#f2f1f7' : '#17161d');

  return {
    label: theme.label || 'Personalizado',
    description: theme.description || '',
    dark,
    bg,
    bg1: mix(bg, dark ? '#ffffff' : '#000000', 0.04),
    panel: mix(bg, dark ? '#ffffff' : '#000000', 0.08),
    panelTop: mix(bg, dark ? '#ffffff' : '#000000', 0.13),
    field: mix(bg, dark ? '#000000' : '#ffffff', 0.35),
    text,
    dim: mix(text, bg, 0.28),
    faint: mix(text, bg, 0.5),
    accent,
    accentText: readableOn(accent || '#7b3fe4')
  };
}

/**
 * Resuelve el tema pedido a una paleta completa y concreta: sin `accent: null`
 * y con los bordes ya calculados a partir del acento.
 */
function palette(id, accent, customThemes) {
  const base = BUILT_IN[id] || (customThemes || []).find((t) => t && t.id === id);
  const p = { ...(BUILT_IN[id] ? base : resolveCustom(base || {})) };
  if (!p.bg) Object.assign(p, BUILT_IN.tvm);

  if (!p.accent) {
    p.accent = accent || '#7b3fe4';
    p.accentText = readableOn(p.accent);
  }

  /*
   * El segundo acento, y qué pasa con los temas que no tienen.
   *
   * `duo` es la pregunta que se hacen `appVars` y `gameCss` antes de mezclar
   * nada: sin segundo acento no hay mezcla que hacer y todo se dibuja como
   * siempre. Es lo que garantiza que agregar esto no le cambie un pixel a los
   * ocho temas que ya estaban ni a los personalizados.
   */
  p.duo = !!(p.accent2 && p.accent2.toLowerCase() !== p.accent.toLowerCase());

  const onLight = p.dark === false;
  p.edge = rgba(p.accent, onLight ? 0.28 : 0.22);
  p.edgeSoft = onLight ? 'rgba(0,0,0,.09)' : 'rgba(255,255,255,.07)';
  p.surface = onLight ? 'rgba(0,0,0,.035)' : 'rgba(255,255,255,.045)';
  p.surfaceHi = onLight ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.08)';
  p.line = onLight ? 'rgba(0,0,0,.11)' : 'rgba(255,255,255,.09)';
  p.lineHi = onLight ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.17)';
  // Los equipos siempre se leen rojo y azul: son parte de las reglas del juego,
  // no del tema. Se ajusta el brillo para que contrasten con el fondo.
  p.red = onLight ? '#c02637' : '#ff6b76';
  p.blue = onLight ? '#1d5fc4' : '#6ba8ff';
  return p;
}

/** Variables CSS para el documento del cliente. */
function appVars(p) {
  // Aura: el degradé animado de los temas VIP. Se manda como una lista de
  // paradas para que el CSS arme el `conic-gradient` y lo haga girar. Los temas
  // sin aura mandan `none`, y la capa se apaga sola.
  const aura = p.aura
    ? { '--aura-stops': `${p.aura.stops.join(', ')}, ${p.aura.stops[0]}`, '--aura-seconds': `${p.aura.seconds}s`, '--aura-on': '1' }
    : { '--aura-stops': 'transparent, transparent', '--aura-seconds': '0s', '--aura-on': '0' };

  /*
   * Canales sueltos, además del color.
   *
   * El CSS necesitaba transparencias sobre colores que sólo se conocen en
   * runtime, y eso se hacía con `color-mix()`. `color-mix()` es de Chrome 111 y
   * este cliente corre sobre Chromium 91 (ver por qué en `applyBootFlags`), así
   * que ahí esas declaraciones son inválidas y el navegador las tira enteras:
   * la interfaz quedaba sin la mitad de sus colores.
   *
   * Con los canales sueltos alcanza `rgb(var(--accent-rgb) / 45%)`, que es
   * exactamente lo mismo y funciona desde Chrome 65.
   */
  const rgb = (hex) => {
    const c = parse(hex);
    return c ? c.join(' ') : '0 0 0';
  };

  // Mezclas de color contra color: no se pueden hacer con `rgb()/alpha`, así
  // que se resuelven acá y viajan ya calculadas.
  const accentDeep = mix(p.accent, p.bg, 0.3);      // 70% acento
  const accentLift = mix(p.accent, p.accentText, 0.12);
  const accentMid = mix(p.accent, p.text, 0.55);    // 45% acento

  /*
   * El «otro extremo» de todo degradé de la interfaz: el segundo acento del
   * tema, o —si el tema tiene uno solo— el mismo acento apagado contra el
   * fondo, que es exactamente lo que había antes con `--accent-deep`.
   *
   * Por eso los botones, el interruptor y el segundo blob no necesitaron dos
   * versiones: piden `--accent-2` y el tema decide si eso es un color nuevo o
   * el de siempre un poco más oscuro.
   */
  const accent2 = p.duo ? p.accent2 : accentDeep;

  return {
    ...aura,
    '--accent': p.accent,
    '--accent-rgb': rgb(p.accent),
    '--accent-2': accent2,
    '--accent-2-rgb': rgb(accent2),
    '--accent-lift': accentLift,
    '--accent-mid': accentMid,
    '--bg-0-rgb': rgb(p.bg),
    '--text-rgb': rgb(p.text),
    '--accent-text-on': p.accentText,
    '--bg-0': p.bg,
    '--bg-1': p.bg1,
    '--bg-2': p.panel,
    '--panel': p.panel,
    '--panel-top': p.panelTop,
    '--field': p.field,
    '--surface': p.surface,
    '--surface-hi': p.surfaceHi,
    '--line': p.line,
    '--line-hi': p.lineHi,
    '--text': p.text,
    '--text-dim': p.dim,
    '--text-faint': p.faint,
    '--team-red': p.red,
    '--team-blue': p.blue,
    '--shadow-strong': p.dark === false ? '0 18px 40px -26px rgba(20,16,40,.35)' : '0 18px 40px -24px rgba(0,0,0,.9)'
  };
}

/* Selectores compartidos por todo el juego -------------------------- */
const BUTTONS = [
  '.dialog button',
  '.room-view button',
  '.room-view > .container button',
  '.chatbox-view-contents > .input button',
  '.connecting-view button',
  '.disconnected-view button',
  '.dialog .file-btn label',
  '.room-view > .container .file-btn label'
];

const FIELDS = [
  '.dialog input:not([type="range"])',
  '.room-view > .container input:not([type="range"])',
  '.chatbox-view-contents > .input input[type="text"]',
  '.dialog select',
  '.room-view > .container select'
];

const PANELS = ['.dialog', '.room-view > .container'];

const each = (list, suffix) => list.map((s) => `${s}${suffix}`).join(',');

/**
 * La tipografía del cliente. El `@font-face` lo pone el preload en el documento
 * del juego (ver `fontFaceCss` en room-ui.js); sin él, la pila cae a Segoe UI.
 */
const FONT = '"Outfit", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

/**
 * @param {Palette} p Paleta ya resuelta
 * @param {{hudScale?:number}} [options]
 */
function gameCss(p, options = {}) {
  if (p.skipGame) return '';

  const glow = rgba(p.accent, 0.4);
  const tint = rgba(p.accent, 0.14);
  const tintHi = rgba(p.accent, 0.24);
  const hud = Math.min(1.4, Math.max(0.8, Number(options.hudScale) || 1));

  /*
   * La mezcla de los temas de dos acentos, acá adentro.
   *
   * Son tres lugares y ninguno es casual: el resplandor de arriba (que es fondo
   * y no lleva nada encima), el botón principal de cada pantalla y la barrita
   * del título. Todo lo demás —bordes, tintes, la fila seleccionada, el HUD—
   * sigue con un solo acento a propósito: lo que hace legible una pantalla es
   * que un color signifique una cosa, y repartir dos por todos lados sería
   * volver al problema que resolvió el bloque de botones de más abajo.
   *
   * Sin segundo acento, `accentEnd` es el mismo verde/rojo/azul de siempre
   * oscurecido, o sea el degradé que ya existía, y las tres reglas salen
   * idénticas a como estaban.
   */
  const accentEnd = p.duo ? p.accent2 : darken(p.accent, 0.22);
  const topGlow = p.duo
    ? `radial-gradient(90% 72% at 16% -18%, ${rgba(p.accent, 0.16)}, transparent 58%),
              radial-gradient(90% 72% at 84% -14%, ${rgba(p.accent2, 0.15)}, transparent 58%)`
    : `radial-gradient(120% 80% at 50% -20%, ${rgba(p.accent, 0.13)}, transparent 62%)`;
  const accentBar = p.duo ? `linear-gradient(180deg, ${p.accent}, ${p.accent2})` : p.accent;

  /*
   * Rojo de «esto no se deshace» (parar, echar, banear) y dorado de admin. No
   * salen del acento: un tema Carmesí no puede convertir cada botón en una
   * advertencia, ni uno Ámbar dejar al admin del mismo color que el resto.
   */
  const danger = p.dark === false ? '#c8283a' : '#f0525f';
  const adminGold = p.dark === false ? '#a06a00' : '#ffd166';
  const bgc = parse(p.bg) || [12, 12, 15];
  const chatBg = `rgba(${bgc.join(', ')}, var(--chat-opacity, 1))`;

  return `
/* ═══ TL App · tema "${p.label}" ═════════════════════════ */

html, body {
  background: ${topGlow}, ${p.bg} !important;
  color: ${p.text} !important;
  font-family: ${FONT} !important;
  -webkit-font-smoothing: antialiased;
}

/* ── Paneles ─────────────────────────────────────────────── */
${PANELS.join(',')},
.choose-nickname-view > .dialog {
  background: ${p.panel} !important;
  border: 1px solid ${p.edge} !important;
  border-radius: 8px !important;
  box-shadow: 0 24px 60px -28px rgba(0,0,0,.9) !important;
  color: ${p.text} !important;
}

${each(PANELS, ' > h1')} {
  color: ${p.text} !important;
  font-size: 18px !important;
  font-weight: 700 !important;
  letter-spacing: -.005em !important;
  border-bottom: 1px solid ${p.edgeSoft} !important;
  padding-bottom: 12px !important;
  margin-bottom: 4px !important;
}
/* Barrita de acento delante del título */
${each(PANELS, ' > h1::before')} {
  content: "";
  display: inline-block;
  width: 3px; height: 15px;
  margin-right: 10px;
  vertical-align: -2px;
  border-radius: 1px;
  background: ${accentBar};
}

/* ── Botones ─────────────────────────────────────────────── *
 * Por defecto son CALLADOS: superficie tenue y un borde. Antes todos venían
 * pintados con el degradé del acento y la sala terminaba siendo una pared de
 * pastillas de colores gritando lo mismo — Auto, Rand, Lock, Reset, Pick y las
 * flechitas, todo con el mismo peso que "Empezar partido".
 *
 * El acento queda reservado para la acción principal de cada pantalla (más
 * abajo). Es lo que hace que se entienda de un vistazo qué botón importa. */
${BUTTONS.join(',')} {
  background: ${rgba(p.text, 0.07)} !important;
  color: ${p.text} !important;
  border: 0 !important;
  border-radius: 5px !important;
  font-family: ${FONT} !important;
  font-size: 13.5px !important;
  font-weight: 600 !important;
  letter-spacing: .01em !important;
  box-shadow: 0 0 0 1px ${p.edgeSoft} inset !important;
  /* Sólo la presión se anima. El color entra y sale seco: el fundido de medio
     segundo al pasar el mouse hacía que los botones se sintieran blandos. */
  transition: transform .1s ease !important;
}
${each(BUTTONS, ':hover:not(:disabled)')} {
  background: ${tintHi} !important;
  color: ${p.dark === false ? p.text : '#fff'} !important;
  box-shadow: 0 0 0 1px ${rgba(p.accent, 0.4)} inset !important;
}
${each(BUTTONS, ':active:not(:disabled)')} { transform: scale(.975) !important; }
${each(BUTTONS, ':disabled')} {
  background: ${p.field} !important;
  color: ${p.faint} !important;
  box-shadow: none !important;
}

/* Las acciones principales: acá sí manda el acento. */
.room-view > .container > .controls button[data-hook="start-btn"],
.roomlist-view > .dialog > .splitter > .buttons > button[data-hook="join"],
.room-password-view > .dialog .buttons > button[data-hook="ok"],
.choose-nickname-view > .dialog > button[data-hook="ok"] {
  background: ${p.duo ? `linear-gradient(90deg, ${p.accent}, ${p.accent2})` : p.accent} !important;
  color: ${p.accentText} !important;
  box-shadow: none !important;
}
.room-view > .container > .controls button[data-hook="start-btn"]:hover:not(:disabled),
.roomlist-view > .dialog > .splitter > .buttons > button[data-hook="join"]:hover:not(:disabled),
.room-password-view > .dialog .buttons > button[data-hook="ok"]:hover:not(:disabled),
.choose-nickname-view > .dialog > button[data-hook="ok"]:hover:not(:disabled) {
  filter: brightness(1.1) !important;
  box-shadow: none !important;
}

/* ── Campos ──────────────────────────────────────────────── */
${FIELDS.join(',')} {
  background: ${p.field} !important;
  color: ${p.text} !important;
  border: 1px solid ${p.edge} !important;
  border-radius: 5px !important;
  font-family: ${FONT} !important;
  transition: border-color .14s ease, box-shadow .14s ease !important;
}
${each(FIELDS, ':focus')} {
  border-color: ${p.accent} !important;
  outline: none !important;
  box-shadow: 0 0 0 2px ${rgba(p.accent, 0.2)} !important;
}
/* Etiqueta + campo en una sola pieza («Motivo», «Nombre de la sala»,
   «Contraseña»). game.css la pinta con el azul fijo de sus botones (#244967),
   que en cualquier tema que no sea ése quedaba como un parche de otro color. */
.dialog .label-input,
.room-view > .container .label-input {
  align-items: center !important;
  padding: 3px 3px 3px 11px !important;
  border-radius: 5px !important;
  background: ${rgba(p.text, p.dark === false ? 0.04 : 0.05)} !important;
  box-shadow: 0 0 0 1px ${p.edgeSoft} inset !important;
}
.dialog .label-input label,
.room-view > .container .label-input label {
  color: ${p.dim} !important;
  font-size: 13px !important;
}

/* ── Pantalla de nickname ────────────────────────────────── */
.choose-nickname-view > .dialog { min-width: 340px !important; }
.choose-nickname-view > .dialog > [data-hook="ok"] { width: 100% !important; margin-top: 4px !important; }

/* ── Contraseña de la sala ───────────────────────────────── *
 * Es la pantalla que aparece al entrar a una sala cerrada. Sale del mismo molde
 * que la de nickname para que no se sienta otra app. */
.room-password-view > .dialog { min-width: 340px !important; }
.room-password-view > .dialog .buttons {
  display: flex !important;
  gap: 8px !important;
  margin-top: 6px !important;
}
.room-password-view > .dialog .buttons > button { flex: 1 !important; }

/* ── Lista de salas ──────────────────────────────────────── */
.roomlist-view > .dialog [data-hook="count"] {
  color: ${p.dim} !important;
  font-weight: 600 !important;
  font-variant-numeric: tabular-nums;
}
.roomlist-view > .dialog > p {
  color: ${p.faint} !important;
  font-size: 12.5px !important;
}

.roomlist-view > .dialog > .splitter > .list {
  background: ${rgba(p.bg, 0.6)} !important;
  border: 1px solid ${p.edgeSoft} !important;
  border-radius: 6px !important;
  overflow: hidden !important;
}
.roomlist-view > .dialog > .splitter > .list thead {
  background: ${rgba(p.text, 0.035)} !important;
}
/* Ojo: las columnas tienen ancho fijo en game.css, así que el padding
   horizontal se mantiene chico o el texto se corta. */
.roomlist-view > .dialog > .splitter > .list thead td {
  color: ${p.dim} !important;
  font-size: 10px !important;
  font-weight: 700 !important;
  letter-spacing: .08em !important;
  text-transform: uppercase !important;
  padding: 9px 4px !important;
}
.roomlist-view > .dialog > .splitter > .list thead td:first-child { padding-left: 11px !important; }
.roomlist-view > .dialog > .splitter > .list .separator {
  background: ${p.edgeSoft} !important;
  height: 1px !important;
}
.roomlist-view > .dialog > .splitter > .list td {
  padding: 6px 4px !important;
  color: ${p.text} !important;
  font-size: 12.5px !important;
  border: 0 !important;
}
.roomlist-view > .dialog > .splitter > .list td:first-child { padding-left: 11px !important; }
.roomlist-view > .dialog > .splitter > .list td:not(:first-child) {
  color: ${p.dim} !important;
  font-variant-numeric: tabular-nums;
}
.roomlist-view > .dialog > .splitter > .list tbody tr {
  transition: background .12s ease !important;
}
.roomlist-view > .dialog > .splitter > .list tbody tr:hover {
  background: ${tint} !important;
}
.roomlist-view > .dialog > .splitter > .list tbody tr.selected {
  background: ${tintHi} !important;
  box-shadow: inset 3px 0 0 ${p.accent} !important;
}
.roomlist-view > .dialog > .splitter > .list tbody tr.old td { opacity: .55 !important; }

/* Botonera lateral */
.roomlist-view > .dialog > .splitter > .buttons > button,
.roomlist-view > .dialog > .splitter > .buttons > .file-btn > label {
  width: 100% !important;
  justify-content: flex-start !important;
  border-radius: 5px !important;
}
/* «Join Room» es la acción principal: se destaca sobre las demás */
.roomlist-view > .dialog > .splitter > .buttons > button[data-hook="join"] {
  box-shadow: none !important;
}
/* Las secundarias quedan sobrias para que no compitan */
.roomlist-view > .dialog > .splitter > .buttons > button[data-hook="settings"],
.roomlist-view > .dialog > .splitter > .buttons > button[data-hook="changenick"],
.roomlist-view > .dialog > .splitter > .buttons > .file-btn > label {
  background: ${rgba(p.text, 0.08)} !important;
  color: ${p.dim} !important;
  box-shadow: 0 0 0 1px ${p.edgeSoft} inset !important;
}
.roomlist-view > .dialog > .splitter > .buttons > button[data-hook="settings"]:hover,
.roomlist-view > .dialog > .splitter > .buttons > button[data-hook="changenick"]:hover,
.roomlist-view > .dialog > .splitter > .buttons > .file-btn > label:hover {
  background: ${rgba(p.text, 0.13)} !important;
  color: ${p.text} !important;
}

/* Filtros */
.roomlist-view > .dialog > .splitter .filters { color: ${p.dim} !important; }
.roomlist-view > .dialog > .splitter .filters .bool {
  border-radius: 4px !important;
  font-size: 11.5px !important;
  border: 1px solid ${p.edgeSoft} !important;
}
.roomlist-view > .dialog > .splitter .filters .bool:hover {
  background: ${tint} !important;
  border-color: ${rgba(p.accent, 0.35)} !important;
  color: ${p.text} !important;
}

/* Aviso superior */
.roomlist-view > .notice {
  background: ${rgba(p.accent, 0.16)} !important;
  border: 1px solid ${rgba(p.accent, 0.32)} !important;
  border-radius: 6px !important;
  color: ${p.text} !important;
}

/* ── Sala ────────────────────────────────────────────────── */
.room-view > .container > .teams .player-list-view .list {
  background: ${rgba(p.bg, 0.55)} !important;
  border: 1px solid ${p.edgeSoft} !important;
  border-radius: 6px !important;
  padding: 3px 0 !important;
}
/* Filas un poco más aireadas y en 14 px: a 15 en negrita de fábrica, con
   treinta jugadores, la lista era una pared. El alto de línea no cambia, así
   que entran los mismos por pantalla. */
.room-view .player-list-item {
  margin: 1px 4px !important;
  padding: 4px 7px !important;
  border-radius: 4px !important;
  color: ${p.text} !important;
  font-size: 14px !important;
  transition: background-color .12s ease !important;
}
.room-view .player-list-item:hover { background: ${tint} !important; }
.room-view .player-list-item .flagico {
  margin-right: 7px !important;
  border-radius: 2px !important;
  box-shadow: 0 0 0 1px ${rgba(p.dark === false ? '#000000' : '#ffffff', 0.12)} !important;
}
.room-view .player-list-item [data-hook="name"] { color: ${p.text} !important; }
/* El admin: dorado y con una corona chica delante. El dorado solo se confundía
   con el color de un VIP, y la corona es un pseudo-elemento: el texto del nombre
   —con el que el cliente empareja filas— queda intacto. */
.room-view .player-list-item.admin [data-hook="name"] {
  color: ${adminGold} !important;
  font-weight: 700 !important;
}
.room-view .player-list-item.admin [data-hook="name"]::before {
  content: "";
  display: inline-block;
  width: 12px; height: 12px;
  margin-right: 5px;
  vertical-align: -1px;
  background: ${adminGold};
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M3 18.5 1.8 7.6l5.6 4.3L12 4.2l4.6 7.7 5.6-4.3L21 18.5z'/%3E%3C/svg%3E") center / contain no-repeat;
}
/* El ping se leía casi apagado; con "dim" se lee sin gritar. */
.room-view .player-list-item [data-hook="ping"] {
  color: ${p.dim} !important;
  font-variant-numeric: tabular-nums;
  font-size: 11.5px !important;
  transition: opacity .12s ease !important;
}
.room-view > .container > .settings {
  padding: 10px 14px !important;
  border-radius: 6px !important;
  background: ${rgba(p.text, p.dark === false ? 0.035 : 0.04)} !important;
  box-shadow: 0 0 0 1px ${p.edgeSoft} inset !important;
}
.room-view > .container > .settings > div:last-child { margin-bottom: 0 !important; }
.room-view > .container > .settings > div > .lbl { color: ${p.dim} !important; font-size: 12px !important; }
.room-view > .container > .settings > div > .val { color: ${p.text} !important; font-weight: 600 !important; }
.room-view > .container > .settings [data-hook="stadium-name"].custom { color: ${adminGold} !important; }
.room-view > .container > .settings select { height: 26px !important; padding: 0 8px !important; }

/* Parar es la acción que corta el partido: roja, pero apagada hasta que se la
   busca. Pausa, neutra. */
.room-view > .container > .controls { gap: 8px !important; }
.room-view > .container > .controls > * { margin: 0 !important; }
.room-view > .container > .controls button {
  padding: 8px 16px !important;
  border-radius: 5px !important;
}
.room-view > .container > .controls button > i { margin-right: 6px !important; }
.room-view > .container > .controls button[data-hook="stop-btn"] {
  background: ${rgba(danger, 0.16)} !important;
  color: ${p.dark === false ? danger : '#ffb3b9'} !important;
  box-shadow: 0 0 0 1px ${rgba(danger, 0.45)} inset !important;
}
.room-view > .container > .controls button[data-hook="stop-btn"]:hover:not(:disabled) {
  background: ${danger} !important;
  color: #ffffff !important;
}

/* Rojo / Espectadores / Azul.
   Son encabezados de columna, no botones de acción: van planos, con el color
   del equipo puesto en el texto y en una línea inferior. Antes eran pastillas
   rellenas con brillo, que pesaban más que "Empezar partido".

   Ojo con el color del texto: game.css trae
   .player-list-view.t-red button[data-hook=join-btn]{color:#ff8686}
   — rojo claro sobre rojo, ilegible. Se pisa sí o sí. */
.room-view > .container > .teams .player-list-view .buttons button[data-hook="join-btn"] {
  background: ${rgba(p.text, 0.05)} !important;
  color: ${p.dim} !important;
  font-weight: 700 !important;
  font-size: 12px !important;
  letter-spacing: .08em !important;
  text-transform: uppercase !important;
  text-shadow: none !important;
  border-radius: 4px 4px 0 0 !important;
  box-shadow: inset 0 -2px 0 ${p.edgeSoft} !important;
}
.room-view > .container > .teams .player-list-view .buttons button[data-hook="join-btn"]:hover:not(:disabled) {
  background: ${rgba(p.text, 0.09)} !important;
}
.room-view > .container > .teams .player-list-view.t-red .buttons button[data-hook="join-btn"] {
  color: ${p.red} !important;
  box-shadow: inset 0 -2px 0 ${p.red} !important;
}
.room-view > .container > .teams .player-list-view.t-blue .buttons button[data-hook="join-btn"] {
  color: ${p.blue} !important;
  box-shadow: inset 0 -2px 0 ${p.blue} !important;
}

/* Las flechitas de mover jugador: iconos, no botones de color. */
.room-view > .container > .teams .player-list-view .buttons button:not([data-hook="join-btn"]) {
  background: transparent !important;
  color: ${p.faint} !important;
  box-shadow: none !important;
  padding: 5px 9px !important;
}
.room-view > .container > .teams .player-list-view .buttons button:not([data-hook="join-btn"]):hover:not(:disabled) {
  background: ${rgba(p.text, 0.08)} !important;
  color: ${p.text} !important;
  box-shadow: none !important;
}

/* Auto · Rand · Lock · Reset: una columna discreta al costado. */
.room-view > .container > .teams > .tools button {
  background: transparent !important;
  color: ${p.faint} !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  box-shadow: 0 0 0 1px ${p.edgeSoft} inset !important;
}
.room-view > .container > .teams > .tools button:hover:not(:disabled) {
  background: ${rgba(p.text, 0.07)} !important;
  color: ${p.text} !important;
  box-shadow: 0 0 0 1px ${rgba(p.accent, 0.35)} inset !important;
}

/* El título de la sala: game.css le mete un subrayado rojo de 3 px. */
.room-view > .container > h1 {
  border-bottom-color: ${p.edgeSoft} !important;
  border-bottom-width: 1px !important;
}

/* Cabecera de la sala: Rec / Link / Leave, como pastillas chicas. */
.room-view > .container > .header-btns { display: flex !important; gap: 6px !important; }
.room-view > .container > .header-btns > :not(:last-child) { margin-right: 0 !important; }
.room-view > .container > .header-btns button {
  padding: 6px 11px !important;
  border-radius: 5px !important;
  font-size: 12.5px !important;
  background: ${rgba(p.text, 0.08)} !important;
  color: ${p.text} !important;
  box-shadow: 0 0 0 1px ${p.edgeSoft} inset !important;
}
.room-view > .container > .header-btns button > i { margin-right: 5px !important; opacity: .85; }
.room-view > .container > .header-btns button:hover:not(:disabled) {
  background: ${tintHi} !important;
  color: ${p.dark === false ? p.text : '#fff'} !important;
}
/* Grabando: el punto rojo y la pastilla lo dicen sin tener que buscarlo. */
.room-view > .container > .header-btns [data-hook="rec-btn"].active {
  background: ${rgba(danger, 0.16)} !important;
  color: ${p.dark === false ? danger : '#ffc4c9'} !important;
  box-shadow: 0 0 0 1px ${rgba(danger, 0.5)} inset !important;
}
.room-view > .container > .header-btns [data-hook="rec-btn"].active i { color: ${danger} !important; opacity: 1; }
.room-view > .container > .header-btns button[data-hook="leave-btn"]:hover {
  background: ${rgba(danger, 0.24)} !important;
  color: ${p.dark === false ? danger : '#ff9aa2'} !important;
}

/* ── Diálogos sobre la partida ───────────────────────────── *
   El velo de fábrica es verde oliva (rgba(115,136,92,.5)) y ningún tema lo
   tocaba: el menú de un jugador aparecía sobre una mancha verde. */
.game-view > [data-hook="popups"] { background-color: ${rgba(p.bg, 0.62)} !important; }

/* El menú de un jugador (clic derecho): nombre, admin, echar y cerrar. */
.game-view > [data-hook="popups"] > .dialog { min-width: 240px !important; }
.dialog > button[data-hook="admin"] {
  color: ${p.dark === false ? p.text : lighten(p.accent, 0.55)} !important;
}
/* Echar es la acción que duele: roja al pasar el mouse, no antes. */
.dialog > button[data-hook="kick"]:hover:not(:disabled) {
  background: ${rgba(danger, 0.24)} !important;
  color: ${p.dark === false ? danger : '#ffc2c7'} !important;
  box-shadow: 0 0 0 1px ${rgba(danger, 0.5)} inset !important;
}
/* Cerrar no es una acción: va sin fondo, para que no compita. */
.dialog > button[data-hook="close"] {
  background: transparent !important;
  color: ${p.dim} !important;
  box-shadow: none !important;
}
.dialog > button[data-hook="close"]:hover { background: ${rgba(p.text, 0.07)} !important; color: ${p.text} !important; }

/* El cuadro de echar: motivo, ban y confirmar. */
.dialog.kick-player-view { min-width: 330px !important; }
.dialog.kick-player-view > button[data-hook="ban-btn"] {
  padding: 9px 11px !important;
  border-radius: 5px !important;
}
.dialog.kick-player-view .row > button { padding: 8px 12px !important; border-radius: 5px !important; }
.dialog.kick-player-view .row > button[data-hook="close"] {
  background: transparent !important;
  color: ${p.dim} !important;
  box-shadow: 0 0 0 1px ${p.edgeSoft} inset !important;
}
.dialog.kick-player-view .row > button[data-hook="kick"] {
  background: ${rgba(danger, 0.85)} !important;
  color: #ffffff !important;
  box-shadow: none !important;
}
.dialog.kick-player-view .row > button[data-hook="kick"]:hover { background: ${danger} !important; }

/* ── Chat ────────────────────────────────────────────────── *
 * Una sola caja: la de HaxBall. Antes el registro tenía su propio recuadro
 * adentro de la caja del chat, o sea dos bordes y dos fondos para lo mismo.
 *
 * El fondo respeta la opacidad que elige el jugador en los ajustes de HaxBall
 * (--chat-opacity): su game.css la aplica sobre su gris azulado, y el tema la
 * pisaba con un fondo propio que no la miraba — el que había bajado la opacidad
 * para ver la cancha detrás del chat se quedaba con la caja maciza. Con el modo
 * «fondo completo» (chat-bg-full) HaxBall saca este fondo y ahí no se toca. */
.game-view:not(.chat-bg-full) .chatbox-view-contents {
  background-color: ${chatBg} !important;
  border: 1px solid ${p.edgeSoft} !important;
  border-bottom: 0 !important;
  border-radius: 6px 6px 0 0 !important;
}
.chatbox-view-contents { padding: 6px 10px 8px !important; }
/* La manija para agrandarlo: una raya, y del acento cuando se la toca. */
.chatbox-view-contents > .drag::before {
  background-color: ${rgba(p.text, 0.16)} !important;
  border-radius: 1px !important;
}
.chatbox-view-contents > .drag:hover::before { background-color: ${p.accent} !important; }
.chatbox-view-contents > .log { padding-right: 4px !important; }
.chatbox-view-contents > .log::-webkit-scrollbar { width: 4px; }
.chatbox-view-contents > .log::-webkit-scrollbar-track { background: transparent; }
.chatbox-view-contents > .log::-webkit-scrollbar-thumb { background: ${rgba(p.text, 0.18)}; border-radius: 2px; }
/* Tamaño e interlineado para todos. El COLOR de cada mensaje no se toca: los
   anuncios lo trae el host de la sala con sendAnnouncement, y pisarlo rompería
   los colores de su liga. */
.chatbox-view-contents > .log .log-contents p {
  font-size: 13.5px !important;
  line-height: 1.45 !important;
}
.chatbox-view-contents > .log .log-contents > p:not(:last-child) { margin-bottom: 2px !important; }
/* Los avisos de la sala (entró, salió, empezó): apagados, que son contexto y
   no conversación. El verde de fábrica competía con los mensajes. */
.chatbox-view-contents > .log .log-contents p.notice {
  color: ${p.dim} !important;
  font-size: 12.5px !important;
}
/* Te nombraron: una marca a la izquierda y un fondo apenas, sin gritar. */
.chatbox-view-contents > .log .log-contents p.highlight {
  padding: 1px 6px !important;
  border-radius: 2px !important;
  background: ${rgba(p.accent, 0.14)} !important;
  box-shadow: inset 2px 0 0 ${p.accent} !important;
}
/* Los anuncios: el filo va del color del propio mensaje (currentColor), no del
   rojo fijo de fábrica. */
.chatbox-view-contents > .log .log-contents p.announcement {
  border-left: 2px solid currentColor !important;
  padding-left: 8px !important;
}
/* El campo: 19 px de fábrica era un renglón para escribir con lupa. */
.chatbox-view-contents > .input { height: 28px !important; }
.chatbox-view-contents > .input input[type="text"] {
  padding: 0 10px !important;
  border-radius: 4px !important;
  font-size: 13.5px !important;
}
.chatbox-view-contents > .autocompletebox {
  background: ${p.panel} !important;
  color: ${p.text} !important;
  border: 1px solid ${p.edge} !important;
  border-radius: 5px !important;
  box-shadow: 0 12px 28px -14px rgba(0,0,0,.8) !important;
  overflow: hidden !important;
}
.chatbox-view-contents > .autocompletebox > div { padding: 0 24px 0 10px !important; }
.chatbox-view-contents > .autocompletebox > div.selected,
.chatbox-view-contents > .autocompletebox > div:hover {
  background: ${tintHi} !important;
  color: ${p.text} !important;
}

/* ── HUD de partida ──────────────────────────────────────── *
 * Marcador y reloj son UNA sola pieza, no un recuadro sobre los goles y el
 * reloj suelto al costado.
 *
 * El markup de HaxBall (leído en vivo del juego) es:
 *
 *   .game-state-view > .bar-container > .bar
 *       > .scoreboard      ( .teamicon.red · .score · "-" · .score · .teamicon.blue )
 *       > .fps-limit-fix   ← div de 1×1 con una animación infinita, cosa suya
 *       > .game-timer-view ( span.overtime · .digit ×2 · span.null ":" · .digit ×2 )
 *
 * Dos cosas de su game.css que hay que tener presentes:
 *
 *   · .fps-limit-fix es position:absolute, así que NO ocupa lugar. Servía
 *     acá de separador entre marcador y reloj y en realidad no separaba nada:
 *     de ahí que los goles y el tiempo se vieran pegados. La separación ahora
 *     la pone el propio reloj, con margen, aire y una línea.
 *
 *   · .overtime es un span con el texto "OVERTIME!" SIEMPRE presente, sólo
 *     que con visibility:hidden. Como sigue ocupando su ancho, el hueco entre
 *     el marcador y los dígitos medía exactamente lo que mide el cartel: al
 *     encenderse lo llenaba justo y quedaba tocando los dos lados. Se esconde
 *     de verdad mientras está apagado y se lo dibuja como una pastilla con su
 *     propio aire.
 *
 * Nada de sombras con blur grande ni backdrop-filter: esto se repinta en cada
 * cuadro y un desenfoque encima del canvas obliga a recomponer la cancha
 * entera. */
.game-state-view .bar-container { filter: none !important; }

.game-state-view .bar {
  height: auto !important;
  align-items: stretch !important;
  padding: 8px 26px !important;
  background: ${rgba(p.bg, 0.93)} !important;
  border: 1px solid ${p.edge} !important;
  border-top: 0 !important;
  border-radius: 0 0 8px 8px !important;
  box-shadow: 0 2px 0 ${rgba(p.accent, 0.5)} inset !important;
  color: ${p.text} !important;
  font: 700 16px ${FONT} !important;
}

/* El recuadro ahora es la barra entera: el marcador va suelto adentro. */
.game-state-view .bar > .scoreboard {
  margin-right: 0 !important;
  gap: 10px !important;
  background: none !important;
  border: 0 !important;
  padding: 0 !important;
}
.game-state-view .bar > .scoreboard .score {
  width: auto !important;
  min-width: 22px !important;
  font-variant-numeric: tabular-nums;
  font-weight: 700 !important;
  font-size: 19px !important;
  letter-spacing: .01em !important;
  color: ${p.text} !important;
}
/* El guión entre los goles: presente pero callado. */
.game-state-view .bar > .scoreboard > div:not(.score):not(.teamicon) {
  color: ${p.faint} !important;
  font-weight: 600 !important;
}
/* Los indicadores de equipo pasan a ser puntos, como en un marcador de TV */
.game-state-view .bar > .scoreboard .teamicon {
  width: 10px !important;
  height: 10px !important;
  border-radius: 2px !important;
  box-shadow: 0 0 10px -1px currentColor !important;
}
.game-state-view .bar > .scoreboard .teamicon.red { background: ${p.red} !important; color: ${p.red} !important; }
.game-state-view .bar > .scoreboard .teamicon.blue { background: ${p.blue} !important; color: ${p.blue} !important; }

/* El reloj se separa solo del marcador: aire a los dos lados de una línea. */
.game-state-view .bar > .game-timer-view {
  align-items: center !important;
  margin-left: 24px !important;
  padding-left: 24px !important;
  border-left: 1px solid ${p.edgeSoft} !important;
  font-variant-numeric: tabular-nums;
  font-weight: 700 !important;
  font-size: 16px !important;
  letter-spacing: .06em !important;
}
.game-state-view .bar > .game-timer-view > .digit { width: 12px !important; }
.game-state-view .bar > .game-timer-view > .null { padding: 0 1px !important; }
/* Los colores de reposo van con :not(.time-warn) a propósito. Ver abajo. */
.game-state-view .bar > .game-timer-view:not(.time-warn),
.game-state-view .bar > .game-timer-view:not(.time-warn) > .digit { color: ${p.dim} !important; }
.game-state-view .bar > .game-timer-view:not(.time-warn) > .null { color: ${p.faint} !important; }
/* ── Los últimos 30 segundos ─────────────────────────────── *
   HaxBall le pone la clase time-warn al reloj cuando faltan menos de 30 s
   (this.Ye > this.Ga - 30 en el bundle) y lo hace parpadear entre blanco y
   rojo cada 0,3 s. El tema le fijaba el color a los dígitos con !important, y
   una animación no puede pisar un !important: el reloj quedaba rojo y quieto.
   Ahora, con la clase puesta, los dígitos no tienen color fijo y parpadean con
   la misma cadencia del original, en el rojo del tema. */
@keyframes tvm-time-warn {
  from { color: ${p.text}; }
  to { color: ${p.red}; }
}
.game-state-view .bar > .game-timer-view.time-warn,
.game-state-view .bar > .game-timer-view.time-warn > .digit,
.game-state-view .bar > .game-timer-view.time-warn > .null {
  animation: tvm-time-warn .3s infinite alternate linear !important;
}

/* Apagado no ocupa lugar: si no, reserva justo su ancho y al encenderse queda
   encajado entre el marcador y los dígitos, sin un pixel de aire. */
.game-timer-view > .overtime { display: none !important; }
.game-timer-view > .overtime.on {
  display: inline-block !important;
  margin-right: 16px !important;
  padding: 3px 10px !important;
  border-radius: 3px !important;
  background: ${rgba(p.accent, 0.18)} !important;
  box-shadow: 0 0 0 1px ${rgba(p.accent, 0.42)} inset !important;
  color: ${lighten(p.accent, 0.45)} !important;
  font-size: 10px !important;
  font-weight: 800 !important;
  letter-spacing: .14em !important;
  line-height: 1.4 !important;
  white-space: nowrap !important;
}

/* ── Botonera de la partida (sonido · Menu · engranaje) ──── *
 * Viene de game.css como una barra pegada arriba a la derecha, de 35 px, con
 * los botones a 15 px en negrita. Forzarlos a círculos de 38 px hacía que el
 * texto "Menu" desbordara y se leyera gigante detrás de todo. Acá se arma como
 * una pastilla flotante, con los botones a su ancho real y el texto recortado
 * dentro del botón. */
.game-view > .buttons {
  top: 8px !important;
  right: 10px !important;
  height: auto !important;
  align-items: center !important;
  gap: ${Math.round(6 * hud)}px !important;
  padding: ${Math.round(5 * hud)}px ${Math.round(6 * hud)}px !important;
  background: ${rgba(p.bg, 0.88)} !important;
  border: 1px solid ${p.edge} !important;
  border-radius: 6px !important;
  box-shadow: 0 8px 22px -12px rgba(0,0,0,.85) !important;
  z-index: 3 !important;
}
.game-view > .buttons > :not(:last-child) { margin-right: 0 !important; }

.game-view > .buttons button {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: ${Math.round(6 * hud)}px !important;
  width: auto !important;
  min-width: ${Math.round(30 * hud)}px !important;
  height: ${Math.round(30 * hud)}px !important;
  max-width: ${Math.round(132 * hud)}px !important;
  padding: 0 ${Math.round(10 * hud)}px !important;
  background: ${rgba(p.text, 0.08)} !important;
  color: ${p.text} !important;
  border: 1px solid ${p.edgeSoft} !important;
  border-radius: 4px !important;
  box-shadow: none !important;
  font-size: ${Math.round(12 * hud)}px !important;
  font-weight: 600 !important;
  line-height: 1 !important;
  /* Sin esto el texto del botón se sale de la pastilla */
  overflow: hidden !important;
  white-space: nowrap !important;
  text-overflow: ellipsis !important;
}
.game-view > .buttons button > i {
  font-size: ${Math.round(14 * hud)}px !important;
  line-height: 1 !important;
  margin: 0 !important;
  opacity: .95;
}
/* El engranaje va sin texto: queda cuadrado */
.game-view > .buttons button[data-hook="settings"],
.game-view > .buttons button[data-hook="sound-btn"] {
  min-width: ${Math.round(30 * hud)}px !important;
  padding: 0 !important;
}
.game-view > .buttons button:hover:not(:disabled) {
  background: ${tintHi} !important;
  color: ${p.dark === false ? p.text : '#fff'} !important;
  border-color: ${rgba(p.accent, 0.55)} !important;
  filter: none !important;
}
/* El tooltip se posicionaba fuera de la pastilla recortada */
.game-view > .buttons button .tooltip {
  background: ${p.panel} !important;
  border: 1px solid ${p.edge} !important;
  border-radius: 4px !important;
  color: ${p.text} !important;
  font-size: 11.5px !important;
  white-space: nowrap !important;
}

/* Lo que el CLIENTE agrega a la sala —moderación, kick/ban de cada fila, lo
   del menú del jugador, insignias, la fila VIP— vive en room-ui.js y se aplica
   también con Clásico. Acá queda sólo el aspecto de lo que es de HaxBall.

   (Sin comillas invertidas en los comentarios de esta hoja: vive adentro de un
   template literal y la cortarían. Pasó, y no se cae en el arranque sino que
   deja al juego sin tema entero — «p.text.spacer is not a function».) */

/* ── Estadísticas ────────────────────────────────────────── */
.stats-view {
  background: ${rgba(p.bg, 0.78)} !important;
  border: 1px solid ${p.edgeSoft} !important;
  border-radius: 6px !important;
  color: ${p.text} !important;
}

/* ── Controles de replay ─────────────────────────────────── */
.replay-controls-view {
  background: linear-gradient(0deg, ${rgba(p.bg, 0.96)}, ${rgba(p.panel, 0.88)}) !important;
  border-top: 1px solid ${p.edge} !important;
  padding: 8px 12px !important;
}
.replay-controls-view button {
  background: ${rgba(p.text, 0.09)} !important;
  box-shadow: 0 0 0 1px ${p.edgeSoft} inset !important;
  border-radius: 4px !important;
  color: ${p.text} !important;
  padding: 6px 12px !important;
}
.replay-controls-view button:hover:not(:disabled) {
  background: ${tintHi} !important;
  color: ${p.dark === false ? p.text : '#fff'} !important;
}
.replay-controls-view [data-hook="time"],
.replay-controls-view [data-hook="spd"] {
  color: ${p.text} !important;
  font-variant-numeric: tabular-nums;
  font-weight: 600 !important;
}
.replay-controls-view .timebar .barbg {
  background: ${rgba(p.text, 0.14)} !important;
  border-radius: 2px !important;
  height: 6px !important;
}
.replay-controls-view .timebar .bar {
  background: linear-gradient(90deg, ${p.accent}, ${p.duo ? p.accent2 : lighten(p.accent, 0.3)}) !important;
  border-radius: 2px !important;
  box-shadow: 0 0 12px ${glow} !important;
}
.replay-controls-view .timebar .timetooltip {
  background: ${p.panel} !important;
  border: 1px solid ${p.edge} !important;
  border-radius: 4px !important;
  color: ${p.text} !important;
  font-variant-numeric: tabular-nums;
}
.replay-controls-view .timebar .marker.k1 { background: ${p.red} !important; }
.replay-controls-view .timebar .marker.k2 { background: ${p.blue} !important; }

/* ── Conexión ────────────────────────────────────────────── */
.connecting-view, .disconnected-view, .view-wrapper {
  background: ${p.bg} !important;
  color: ${p.text} !important;
}
.connecting-view-log p { color: ${p.dim} !important; font-size: 12px !important; }
.spinner > div { background: ${p.accent} !important; }

/* ── Barras de scroll ────────────────────────────────────── */
.ps__thumb-y, .ps__thumb-x {
  background: ${rgba(p.accent, 0.6)} !important;
  border-radius: 2px !important;
}
.ps__rail-y, .ps__rail-x { background: transparent !important; opacity: .6 !important; }
.ps__rail-y:hover > .ps__thumb-y { background: ${p.accent} !important; }

/* ── Tooltips ────────────────────────────────────────────── */
.dialog button .tooltip, .room-view button .tooltip {
  background: ${p.panel} !important;
  border: 1px solid ${p.edge} !important;
  border-radius: 4px !important;
  color: ${p.text} !important;
  font-size: 11.5px !important;
}
`;
}

/* ── Utilidades de color ───────────────────────────────────────────── */
function parse(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  return m ? m.slice(1).map((h) => parseInt(h, 16)) : null;
}

function rgba(hex, alpha) {
  const c = parse(hex);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${alpha})` : hex;
}

function lighten(hex, amount) {
  const c = parse(hex);
  if (!c) return hex;
  return `rgb(${c.map((v) => Math.round(v + (255 - v) * amount)).join(',')})`;
}

function darken(hex, amount) {
  const c = parse(hex);
  if (!c) return hex;
  return `rgb(${c.map((v) => Math.round(v * (1 - amount))).join(',')})`;
}

/** Mezcla dos colores en proporción `amount` del segundo. Devuelve hex. */
function mix(hexA, hexB, amount) {
  const a = parse(hexA);
  const b = parse(hexB);
  if (!a || !b) return hexA;
  const to = (v) => v.toString(16).padStart(2, '0');
  return `#${a.map((v, i) => to(Math.round(v + (b[i] - v) * amount))).join('')}`;
}

/**
 * Blanco o negro, el que se lea mejor encima del color. Sin esto, un acento
 * amarillo terminaba con texto blanco arriba y no se leía nada.
 */
function readableOn(hex) {
  const c = parse(hex);
  if (!c) return '#ffffff';
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.42 ? '#12101a' : '#ffffff';
}

module.exports = { BUILT_IN, list, palette, appVars, gameCss, readableOn, mix };
