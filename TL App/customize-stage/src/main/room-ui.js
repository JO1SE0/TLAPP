'use strict';

/**
 * Lo que el cliente AGREGA a la sala de HaxBall: la moderación por grupo, los
 * botones de kick/ban de cada fila, lo que suma al menú de un jugador, las
 * insignias de TVM/VIP/amigo y la fila de un VIP.
 *
 * ── Por qué vive aparte de `themes.js` ──────────────────────────────────────
 *
 * `themes.gameCss()` re-estiliza lo que es DE HaxBall, y con el tema Clásico no
 * devuelve nada — ése es todo el punto de Clásico. Pero lo nuestro no tiene un
 * aspecto «de fábrica» al que volver: con Clásico puesto, los botones de
 * moderación quedaban como botones grises del navegador con una letra adentro.
 * Esto se aplica siempre, con la paleta que toque (Clásico también tiene una).
 *
 * Y es un módulo y no una cadena dentro del preload para que la muestra visual
 * (y cualquier prueba) arme la sala con EXACTAMENTE el mismo CSS que el juego.
 *
 * Todo va con prefijo `tvm-` y los selectores de HaxBall que se tocan son los
 * que llevan una clase nuestra: nada de acá cambia el aspecto de algo que el
 * cliente no haya puesto.
 */

const fs = require('fs');
const path = require('path');

/* ── La tipografía del cliente ────────────────────────────────────────────── *
 *
 * La interfaz del cliente es toda en Outfit, y el juego —que es un documento de
 * haxball.com— no la tenía: la sala salía en Segoe UI, con otra forma de letra
 * que la barra de arriba, y se notaba que eran dos programas pegados.
 *
 * Va incrustada como `data:` y no por `tvm-asset://`: una fuente de otro origen
 * pasa por CORS, y el esquema propio no está marcado para eso. Son tres pesos de
 * 14 KB; se leen una vez y la hoja se pone una vez por documento.
 */
const FONT_STACK = '"Outfit", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
let fontFaces = null;

function fontFaceCss() {
  if (fontFaces !== null) return fontFaces;
  const out = [];
  for (const weight of [400, 600, 700]) {
    try {
      const file = path.join(__dirname, '..', 'renderer', 'fonts', `outfit-${weight}.woff2`);
      const data = fs.readFileSync(file).toString('base64');
      out.push(`@font-face { font-family: "Outfit"; src: url(data:font/woff2;base64,${data}) format("woff2"); ` +
        `font-weight: ${weight}; font-style: normal; font-display: swap; }`);
    } catch { /* sin el archivo, la pila de fuentes cae a Segoe UI */ }
  }
  fontFaces = out.join('\n');
  return fontFaces;
}

/* ── Íconos ──────────────────────────────────────────────────────────────── *
 * De contorno, viewBox de 24, las mismas puntas redondeadas que el resto del
 * cliente. Se dibujan a 13–14 px, así que cada uno es de dos o tres trazos: más
 * detalle a ese tamaño se junta en una mancha. */
const ICONS = {
  // Salir por la puerta: la flecha sale del marco. «Echar» es eso.
  kick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10"/><path d="M15 8l4 4-4 4"/><path d="M19 12H9"/></svg>',
  // Prohibido: el mismo que usa HaxBall en su botón (icon-block).
  ban: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><path d="M6.3 6.3l11.4 11.4"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l7 2.8v5.2c0 4.3-2.9 7.8-7 9.6-4.1-1.8-7-5.3-7-9.6V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  addFriend: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="8.5" r="3.6"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z"/><path d="M9 9.5l6 5M15 9.5l-6 5"/></svg>',
  unmute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z"/><path d="M8.5 11.5h7"/></svg>'
};

/**
 * El diamante del VIP.
 *
 * Relleno y con caras, no de contorno. A 16 px un trazo de 1,6 queda en un
 * píxel escaso, y la piedra de línea al lado del escudo —que es un sólido—
 * se veía como un dibujo de otra app. Las seis caras en tres tonos del mismo
 * celeste le dan volumen sin un solo brillo: la luz está pintada, no es un
 * halo. El filo oscuro la despega de cualquier fondo, claro u oscuro.
 *
 * Ojo: la muestra «cómo te ven en la lista» de `index.html` usa este mismo
 * dibujo. Si se cambia acá, hay que cambiarlo allá.
 */
const VIP_GEM_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M7 4 2 9h7.5z" fill="#95e6fc"/>' +
  '<path d="M7 4h10l-2.5 5h-5z" fill="#dcfaff"/>' +
  '<path d="M17 4l5 5h-7.5z" fill="#62ccf2"/>' +
  '<path d="M2 9h7.5L12 21z" fill="#3dbdf3"/>' +
  '<path d="M9.5 9h5L12 21z" fill="#1c9fd9"/>' +
  '<path d="M14.5 9H22L12 21z" fill="#0a7fb9"/>' +
  '<path d="M7 4h10l5 5-10 12L2 9z" fill="none" stroke="#062a3e" stroke-width="1.4" stroke-linejoin="round"/>' +
  '</svg>';

/*
 * Un busto y medio: el de adelante entero y el de atrás asomando. Es el mismo
 * recurso que usa el icono de Amigos de la barra, y a 16 px es lo que se lee
 * como "dos personas" sin convertirse en una mancha.
 */
const FRIEND_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<circle cx="9" cy="8" r="3.4"/>' +
  '<path d="M2.8 20.2a6.2 6.2 0 0 1 12.4 0"/>' +
  '<path d="M16.4 5.2a3.4 3.4 0 0 1 0 6.4"/>' +
  '<path d="M18.2 14.6a6.2 6.2 0 0 1 3 5.6"/>' +
  '</svg>';

/* ── Color ──────────────────────────────────────────────────────────────── */

function parse(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  return m ? m.slice(1).map((h) => parseInt(h, 16)) : null;
}

function rgba(hex, alpha) {
  const c = parse(hex);
  return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})` : hex;
}

/** Mezcla hacia `b` en proporción `t`. Devuelve `#rrggbb`. */
function mix(a, b, t) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return a;
  const to = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${x.map((v, i) => to(v + (y[i] - v) * t)).join('')}`;
}

/* Los rojos y azules de HaxBall, sin tocar: son reglas del juego, no del tema. */
const DANGER = '#f0525f';

/**
 * La fila de un VIP, como variables para la hoja de abajo.
 *
 * ── Qué cambió y por qué ───────────────────────────────────────────────────
 *
 * Antes el aura eran los dos extremos encendidos más un halo hacia afuera. El
 * halo es lo que se veía «quemado»: una sombra de color de 9 px que se salía de
 * la fila y se pisaba con la de al lado. Y el hover de los temas (`background`
 * con !important) la borraba entera al pasar el mouse.
 *
 * Ahora es una tarjeta: un filo de color a la izquierda —como el de la fila
 * elegida en la lista de salas, que ya es el idioma de «esto es especial» en
 * esta interfaz—, un barrido del color que se apaga antes de llegar a las
 * insignias y un hilo de borde. Sin nada que se salga de la fila. El nombre va
 * en degradado del mismo color, que es lo primero que se busca con el ojo.
 *
 * En un tema claro el nombre va con los tonos plenos oscurecidos: los claros
 * que se leen sobre la lista oscura, sobre blanco no se leen.
 *
 * @param {{a:string,b:string,text:string}} look
 * @param {{light?:boolean}} [opts]
 */
function triplet(hex) {
  const c = parse(hex);
  return c ? `${c[0]} ${c[1]} ${c[2]}` : '255 255 255';
}

function peerLook(look, opts = {}) {
  const light = !!opts.light;
  return {
    '--tvm-a-rgb': triplet(look.a),
    '--tvm-b-rgb': triplet(look.b),
    '--tvm-vip-bg': `linear-gradient(90deg, ${rgba(look.a, light ? 0.3 : 0.26)} 0%, ${rgba(look.b, light ? 0.14 : 0.12)} 42%, ${rgba(look.b, 0)} 78%)`,
    '--tvm-vip-bg-hi': `linear-gradient(90deg, ${rgba(look.a, light ? 0.42 : 0.38)} 0%, ${rgba(look.b, light ? 0.22 : 0.2)} 50%, ${rgba(look.b, 0.04)} 92%)`,
    '--tvm-vip-edge': `inset 0 0 0 1px ${rgba(look.a, light ? 0.45 : 0.3)}, inset 0 1px 0 rgba(255, 255, 255, ${light ? 0.5 : 0.1})`,
    '--tvm-vip-name': light
      ? `linear-gradient(90deg, ${mix(look.b, '#000000', 0.25)}, ${mix(look.b, '#000000', 0.5)})`
      : `linear-gradient(90deg, ${look.text}, ${look.a})`
  };
}

/**
 * La hoja de lo que agrega el cliente a la sala.
 *
 * @param {object} p paleta resuelta de `themes.palette()`
 * @param {{animations?: boolean}} [opts]
 */
function css(p, opts = {}) {
  const animations = opts.animations !== false;
  const light = p.dark === false;
  const panel = p.panel;
  const quiet = rgba(p.text, light ? 0.06 : 0.07);
  const quietHi = rgba(p.text, light ? 0.11 : 0.13);
  const line = rgba(p.text, light ? 0.12 : 0.1);
  const danger = light ? '#c8283a' : DANGER;

  return `
/* ═══ TL App · lo que el cliente agrega a la sala ═══ */

/* ── El que habla, en el color de su equipo ───────────────────────
   El nick lo separa el cliente (ver tagSpeaker): HaxBall escribe cada mensaje
   como un solo texto. */
.chatbox-view .tvm-chat-nick { font-weight: 700; color: ${p.text}; }
.chatbox-view .tvm-chat-nick--red { color: ${p.red}; }
.chatbox-view .tvm-chat-nick--blue { color: ${p.blue}; }
.chatbox-view .tvm-chat-nick--spec { color: ${p.dim}; }

/* ── Te nombraron: la línea se marca (ver checkMention) ───────────── */
.chatbox-view p.tvm-mention { background: ${rgba(p.accent, light ? 0.16 : 0.14)}; box-shadow: inset 3px 0 0 ${p.accent}; border-radius: 3px; }

/* ── Íconos de trazo ─────────────────────────────────────────── */
.tvm-ico {
  display: block;
  width: 14px; height: 14px;
  fill: none; stroke: currentColor; stroke-width: 1.9;
  stroke-linecap: round; stroke-linejoin: round;
  pointer-events: none;
}

/* ── Moderación por grupo, en la columna de herramientas ────────
   La columna de HaxBall mide 80 px clavados (.teams > .tools); se la ensancha
   a 132 y los px salen del spacer, que es elástico: las listas de equipo no se
   mueven. Con 124, en la tipografía de HaxBall (Clásico) el «4» de «Espec. 4»
   quedaba afuera. */
.room-view > .container > .teams > .tools { width: 132px !important; }
.tvm-tools {
  display: flex !important;
  flex-direction: column;
  gap: 3px;
  margin-top: 10px !important;
  padding: 8px 6px 6px;
  border-radius: 6px;
  background: ${quiet};
  box-shadow: 0 0 0 1px ${line} inset;
}
.tvm-tools__head {
  display: flex; align-items: center; gap: 5px;
  margin: 0 0 4px 1px;
  font-size: 9.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  color: ${p.dim};
}
.tvm-tools__head .tvm-ico { width: 12px; height: 12px; color: ${p.accent}; }
/* A quién alcanza, cuántos son y los dos botones al final. La etiqueta se queda
   con lo que sobra, así los botones de las cuatro filas quedan en columna. */
.tvm-tools__row {
  display: flex !important;
  align-items: center;
  gap: 3px;
  min-height: 24px;
  padding-left: 3px;
  border-radius: 4px;
  transition: background-color .12s ease;
}
.tvm-tools__row:hover { background: ${quiet}; }
.tvm-tools__who {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 600;
  color: ${p.text};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tvm-tools__dot { flex: none; width: 7px; height: 7px; border-radius: 2px; background: ${p.faint}; }
.tvm-tools__who--red .tvm-tools__dot { background: ${p.red}; }
.tvm-tools__who--blue .tvm-tools__dot { background: ${p.blue}; }
.tvm-tools__who--spec .tvm-tools__dot { background: transparent; box-shadow: 0 0 0 1.5px ${p.faint} inset; }
.tvm-tools__count {
  font-size: 10.5px; font-weight: 600;
  color: ${p.faint};
  font-variant-numeric: tabular-nums;
}
/* Armado: el primer clic avisa, el segundo ejecuta. La fila entera lo dice. */
.tvm-tools__row.is-armed { background: ${rgba(danger, 0.14)}; box-shadow: 0 0 0 1px ${rgba(danger, 0.45)} inset; }
.tvm-tools__row.is-armed .tvm-tools__who { color: ${light ? danger : '#ffb3b9'}; }
.tvm-tools__row.is-armed .tvm-tools__count,
.tvm-tools__row.is-armed .tvm-tools__dot { display: none; }

/* Los botones de acá y los de cada fila son el mismo objeto: un ícono en un
   cuadrado redondeado. Los selectores van largos a propósito: game.css y el
   tema pintan todo «.room-view button» y hay que ganarles. */
.room-view button.tvm-act,
.room-view > .container > .teams > .tools button.tvm-act {
  flex: none !important;
  display: inline-flex !important; align-items: center !important; justify-content: center !important;
  width: 24px !important; min-width: 24px !important; height: 22px !important;
  margin: 0 !important; padding: 0 !important;
  border: 0 !important; border-radius: 4px !important;
  background: ${quietHi} !important;
  color: ${p.dim} !important;
  box-shadow: none !important;
  font-size: 0 !important; line-height: 0 !important;
  cursor: pointer;
  transition: background-color .12s ease, color .12s ease, transform .1s ease !important;
}
.room-view button.tvm-act:hover:not(:disabled) {
  background: ${rgba(p.accent, 0.28)} !important;
  color: ${light ? p.text : '#ffffff'} !important;
}
.room-view button.tvm-act--danger:hover:not(:disabled) {
  background: ${rgba(danger, 0.26)} !important;
  color: ${light ? danger : '#ffc2c7'} !important;
}
.room-view button.tvm-act:active:not(:disabled) { transform: scale(.92) !important; }
.room-view button.tvm-act:disabled { opacity: .35 !important; cursor: default; background: ${quiet} !important; }
.room-view button.tvm-act.is-armed {
  background: ${danger} !important;
  color: #ffffff !important;
  box-shadow: 0 0 0 1px ${rgba('#ffffff', 0.25)} inset !important;
}

/* ── Kick/ban de cada jugador ───────────────────────────────────
   Aparecen al pasar el mouse, sobre el ping y no sobre el nombre: el ping se
   apaga y en su lugar queda la botonera, con el fondo de la lista para que no
   se lean los dos a la vez. */
.room-view .player-list-item { position: relative !important; }
.tvm-pa {
  position: absolute;
  right: 3px; top: 50%;
  display: flex; gap: 3px;
  padding: 2px;
  border-radius: 5px;
  background: ${panel};
  box-shadow: 0 0 0 1px ${line}, 0 4px 12px -4px rgba(0, 0, 0, ${light ? 0.25 : 0.7});
  opacity: 0;
  transform: translate(4px, -50%);
  pointer-events: none;
  transition: opacity .12s ease, transform .12s ease;
}
.room-view .player-list-item:hover .tvm-pa,
.tvm-pa.is-armed {
  opacity: 1;
  transform: translate(0, -50%);
  pointer-events: auto;
}
.room-view .player-list-item.tvm-has-pa:hover [data-hook="ping"] { opacity: 0 !important; }
.room-view .tvm-pa button.tvm-act { width: 22px !important; min-width: 22px !important; height: 20px !important; }
.room-view .tvm-pa .tvm-ico { width: 13px; height: 13px; }

/* ── El menú de un jugador (clic derecho) ─────────────────────── */
.tvm-menu-note {
  display: flex; align-items: center; gap: 7px;
  margin: 2px 0 4px;
  padding: 7px 9px;
  border-radius: 5px;
  background: ${quiet};
  box-shadow: 0 0 0 1px ${line} inset;
  font-size: 11px;
  line-height: 1.4;
  color: ${p.dim} !important;
  max-width: 240px;
  white-space: normal;
}
.tvm-menu-note b { color: ${p.text}; font-weight: 700; }
/* Centrados como los de HaxBall que tienen al lado: el ícono acompaña, no
   cambia la forma del cuadro. */
.dialog button.tvm-menu-btn {
  display: flex !important; align-items: center !important; justify-content: center !important;
  gap: 8px !important;
}
.dialog button.tvm-menu-btn .tvm-ico { width: 15px; height: 15px; flex: none; opacity: .9; }
.dialog .tvm-menu-sep {
  height: 1px;
  margin: 4px 2px !important;
  background: ${line};
}

/* ── El cuadro de echar: el ban como interruptor ────────────────
   La clase la pone el cliente al abrirse el cuadro (ver enhanceKickDialog):
   sin ella, el botón de HaxBall queda como siempre. */
.kick-player-view button[data-hook="ban-btn"].tvm-has-switch {
  display: flex !important; align-items: center !important; gap: 8px !important;
  text-align: left !important;
}
.kick-player-view button[data-hook="ban-btn"].tvm-has-switch > i { margin-right: 0 !important; opacity: .85; }
.kick-player-view button[data-hook="ban-btn"].tvm-has-switch [data-hook="ban-text"] { opacity: .7; }
.tvm-switch {
  position: relative; flex: none;
  margin-left: auto;
  width: 30px; height: 17px;
  border-radius: 4px;
  background: ${rgba(p.text, light ? 0.18 : 0.2)};
  box-shadow: 0 0 0 1px ${line} inset;
  transition: background-color .15s ease;
}
.tvm-switch::after {
  content: "";
  position: absolute; top: 2px; left: 2px;
  width: 13px; height: 13px;
  border-radius: 2px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .4);
  transition: transform .15s ease;
}
.kick-player-view.tvm-ban-on .tvm-switch { background: ${danger}; }
.kick-player-view.tvm-ban-on .tvm-switch::after { transform: translateX(13px); }
.kick-player-view.tvm-ban-on button[data-hook="ban-btn"].tvm-has-switch {
  box-shadow: 0 0 0 1px ${rgba(danger, 0.55)} inset !important;
}
/* Confirmar dice «Banear» y se ve como lo que es. */
.dialog.kick-player-view.tvm-ban-on .row > button[data-hook="kick"] {
  background: ${danger} !important;
  color: #ffffff !important;
  box-shadow: none !important;
}

/* ── Insignias de la lista de jugadores ──────────────────────────
   Van como hermanas del nombre y nunca adentro: el nombre es el texto con
   el que se emparejan las filas, y meterle un hijo lo rompería.

   HaxBall arma la fila como [bandera][nombre flex:1][ping 30px]. El cajón
   de las insignias se mete entre el nombre y el ping: como el nombre se
   lleva todo el ancho, quedan contra el borde derecho y alineadas entre
   todas las filas. */
/* El avatar del jugador, al lado del nombre: un disquito como el de la
   cancha. Hermano del nombre, nunca adentro (ver las insignias). */
.player-list-item .tvm-av {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 20px; height: 20px;
  margin: 0 6px 0 2px;
  border-radius: 50%;
  background: ${rgba(p.text, light ? 0.1 : 0.12)};
  box-shadow: inset 0 0 0 1px ${rgba(p.text, light ? 0.16 : 0.18)};
  color: ${p.text};
  font: 700 10.5px/1 "Segoe UI Emoji", "Segoe UI Symbol", sans-serif;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  vertical-align: middle;
}
.player-list-item .tvm-marks {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0 8px 0 6px;
  padding: 2px 7px;
  border-radius: 99px;
  background: ${rgba(p.text, light ? 0.07 : 0.08)};
  box-shadow: inset 0 0 0 1px ${rgba(p.text, light ? 0.1 : 0.09)};
}
.player-list-item .tvm-marks:empty { display: none; }
.player-list-item .tvm-mark { flex: none; display: block; width: 16px; height: 16px; }
.player-list-item .tvm-mark[hidden] { display: none; }
/* El escudo del club ya incluye un borde dorado. La sombra corta lo despega
   del fondo sin agregarle otro contorno. */
.player-list-item .tvm-mark--logo {
  object-fit: contain;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .55));
}
.player-list-item .tvm-mark--vip svg {
  width: 100%; height: 100%; display: block;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .5));
}
/* Socio: chapita plateada con texto, para que no se confunda con el escudo
   dorado del plantel ni con los íconos de VIP y amigo. */
.player-list-item .tvm-mark--socio {
  width: auto; height: 15px; padding: 0 5px; border-radius: 5px;
  font: 800 9px/15px system-ui, sans-serif; letter-spacing: .08em;
  color: #e6edf8; background: linear-gradient(180deg, #a9b6c9, #66748a);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .45), 0 1px 2px rgba(0, 0, 0, .5);
  text-shadow: 0 1px 0 rgba(0, 0, 0, .35);
}
/* Verde: el celeste ya es el VIP y está pegado al lado. */
.player-list-item .tvm-mark--friend { color: #6ee7a8; }
.player-list-item .tvm-mark--friend svg {
  width: 100%; height: 100%; display: block;
  fill: none; stroke: currentColor; stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .45));
}

/* ── La fila personalizada / del club: una «tarjeta de jugador» ──────
   Los colores llegan por variables desde la fila (ver applyPeerLook): acá va
   la forma. Va con !important porque los temas pintan el hover de todas las
   filas con un fondo !important.

   Todo es fijo: degradados, una veta de brillo y una textura finita pintados
   una sola vez, sin animaciones ni desenfoques. La sala no gasta nada de más
   por tener tarjetas lindas. Partes:
     · una franja de color a la izquierda (::after),
     · el ícono elegido dentro de una moneda con el degradado (::before),
     · el nombre en degradado con un brillo suave del mismo color,
     · el avatar y el ping con un aro / una pastilla del color de la tarjeta. */
.room-view .player-list-item.tvm-peer-row,
.player-list-item.tvm-peer-row {
  position: relative !important;
  overflow: hidden;
  min-height: 34px;
  border-radius: 12px !important;
  padding: 6px 10px 6px 14px !important;
  margin: 4px 7px !important;
  background:
    linear-gradient(112deg, transparent 0 52%, rgba(255, 255, 255, ${light ? 0.22 : 0.07}) 58%, transparent 65%),
    repeating-linear-gradient(135deg, rgba(255, 255, 255, ${light ? 0.08 : 0.03}) 0 2px, transparent 2px 8px),
    linear-gradient(90deg, rgb(var(--tvm-a-rgb) / ${light ? 34 : 30}%) 0%, rgb(var(--tvm-b-rgb) / ${light ? 18 : 15}%) 45%, rgb(var(--tvm-b-rgb) / 2%) 100%) !important;
  box-shadow:
    inset 0 0 0 1px rgb(var(--tvm-a-rgb) / ${light ? 55 : 38}%),
    inset 0 1px 0 rgba(255, 255, 255, ${light ? 0.55 : 0.12}),
    0 6px 16px -10px rgb(var(--tvm-b-rgb) / 70%) !important;
}
.room-view .player-list-item.tvm-peer-row:hover,
.player-list-item.tvm-peer-row:hover {
  background:
    linear-gradient(112deg, transparent 0 52%, rgba(255, 255, 255, ${light ? 0.28 : 0.1}) 58%, transparent 65%),
    repeating-linear-gradient(135deg, rgba(255, 255, 255, ${light ? 0.08 : 0.035}) 0 2px, transparent 2px 8px),
    linear-gradient(90deg, rgb(var(--tvm-a-rgb) / ${light ? 44 : 40}%) 0%, rgb(var(--tvm-b-rgb) / ${light ? 24 : 22}%) 50%, rgb(var(--tvm-b-rgb) / 5%) 100%) !important;
}
/* Franja de color a la izquierda. */
.player-list-item.tvm-peer-row::after {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  background: linear-gradient(180deg, rgb(var(--tvm-a-rgb)), rgb(var(--tvm-b-rgb)));
  box-shadow: 0 0 10px rgb(var(--tvm-a-rgb) / 70%);
  pointer-events: none;
}
.player-list-item.tvm-peer-row [data-hook="name"] {
  font-weight: 800 !important;
  letter-spacing: .015em;
}
/* El nombre en degradado, con un brillo del mismo color. Un admin conserva su
   dorado: es información, y un cosmético no la puede tapar. */
.player-list-item.tvm-peer-row:not(.admin) [data-hook="name"] {
  background-image: var(--tvm-vip-name);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: none !important;
  filter: drop-shadow(0 0 6px rgb(var(--tvm-a-rgb) / ${light ? 0 : 45}%)) drop-shadow(0 1px 0 rgba(0, 0, 0, ${light ? 0 : 0.35}));
}
/* El ícono elegido, dentro de una moneda con el degradado de la tarjeta. */
.player-list-item.tvm-peer-row[data-tvm-icon]::before {
  content: attr(data-tvm-icon);
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 22px; height: 22px;
  margin-right: 8px;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, rgb(var(--tvm-a-rgb)), rgb(var(--tvm-b-rgb)) 75%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .45), inset 0 -2px 0 rgba(0, 0, 0, .18), 0 0 0 1.5px rgba(255, 255, 255, .18), 0 2px 6px rgba(0, 0, 0, .35);
  font-size: 12px;
  line-height: 1;
  text-shadow: 0 1px 1px rgba(0, 0, 0, .35);
}
/* Avatar con aro del color de la tarjeta. */
.player-list-item.tvm-peer-row .tvm-av {
  width: 22px; height: 22px;
  background: rgb(var(--tvm-b-rgb) / ${light ? 85 : 38}%);
  box-shadow: 0 0 0 1.5px rgb(var(--tvm-a-rgb) / 85%), 0 0 8px rgb(var(--tvm-a-rgb) / 35%);
  color: #fff;
  font-weight: 800;
}
/* El escudo del club en la tarjeta: con un brillo dorado que lo separa del color. */
.player-list-item.tvm-peer-row .tvm-mark--logo { filter: drop-shadow(0 0 4px rgba(255, 205, 100, .65)) drop-shadow(0 1px 1px rgba(0, 0, 0, .55)); }
/* Insignias y ping como pastillas de la misma tarjeta. */
.player-list-item.tvm-peer-row .tvm-marks {
  background: rgba(0, 0, 0, ${light ? 0.06 : 0.22});
  box-shadow: inset 0 0 0 1px rgb(var(--tvm-a-rgb) / 40%);
}
.player-list-item.tvm-peer-row [data-hook="ping"] {
  min-width: 26px;
  padding: 2px 6px;
  border-radius: 99px;
  text-align: center;
  background: rgb(var(--tvm-a-rgb) / 14%);
  color: inherit !important;
  font-weight: 700;
}

/* Formas de la tarjeta (las elige cada uno en Personalización). */
/* Sólida: todo el color, letra blanca. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="solid"] {
  background:
    linear-gradient(112deg, transparent 0 50%, rgba(255, 255, 255, .16) 57%, transparent 64%),
    repeating-linear-gradient(135deg, rgba(255, 255, 255, .05) 0 2px, transparent 2px 8px),
    linear-gradient(90deg, rgb(var(--tvm-a-rgb) / 78%), rgb(var(--tvm-b-rgb) / 70%) 60%, rgb(var(--tvm-b-rgb) / 45%)) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .3), inset 0 -2px 0 rgba(0, 0, 0, .15), 0 8px 18px -10px rgb(var(--tvm-b-rgb)) !important;
}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="solid"]:not(.admin) [data-hook="name"] {
  background-image: none;
  -webkit-text-fill-color: #fff;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .45));
}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="solid"]::after { background: rgba(255, 255, 255, .55); box-shadow: none; }
.room-view .player-list-item.tvm-peer-row[data-tvm-style="solid"] [data-hook="ping"] { background: rgba(0, 0, 0, .2); color: #fff !important; }
/* Borde: casi sin relleno y un contorno de dos colores. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="outline"] {
  background:
    linear-gradient(112deg, transparent 0 52%, rgba(255, 255, 255, .05) 58%, transparent 65%),
    linear-gradient(90deg, rgb(var(--tvm-a-rgb) / 9%), rgb(var(--tvm-b-rgb) / 3%)) !important;
  box-shadow: inset 0 0 0 1.5px rgb(var(--tvm-b-rgb) / 90%), inset 0 0 0 3px rgb(var(--tvm-a-rgb) / 18%) !important;
}
/* Neón: contorno encendido con resplandor afuera. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="neon"] {
  overflow: visible;
  background:
    linear-gradient(112deg, transparent 0 52%, rgba(255, 255, 255, .06) 58%, transparent 65%),
    linear-gradient(90deg, rgb(var(--tvm-b-rgb) / 18%), rgb(var(--tvm-b-rgb) / 6%)) !important;
  box-shadow: inset 0 0 0 1.5px rgb(var(--tvm-a-rgb)), inset 0 0 14px rgb(var(--tvm-a-rgb) / 30%), 0 0 14px rgb(var(--tvm-b-rgb) / 60%) !important;
}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="neon"]::after { left: 1.5px; top: 1.5px; bottom: 1.5px; border-radius: 10px 0 0 10px; }
/* Franja: recta, con la franja más gruesa. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="bar"] {
  border-radius: 5px !important;
  padding-left: 16px !important;
}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="bar"]::after { width: 6px; }
/* Simple: sin tarjeta, sólo la moneda y el nombre. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="minimal"] {
  background: transparent !important;
  box-shadow: none !important;
}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="minimal"]::after { display: none; }
.room-view .player-list-item.tvm-peer-row[data-tvm-style="minimal"] [data-hook="ping"] { background: none; }
.room-view .player-list-item.tvm-peer-row[data-tvm-style="minimal"]:hover { background: rgb(var(--tvm-a-rgb) / 12%) !important; }
.room-view .player-list-item.tvm-peer-row[data-tvm-style="solid"]:hover,
.room-view .player-list-item.tvm-peer-row[data-tvm-style="outline"]:hover,
.room-view .player-list-item.tvm-peer-row[data-tvm-style="neon"]:hover,
.room-view .player-list-item.tvm-peer-row[data-tvm-style="bar"]:hover { filter: brightness(1.1); }
/* Formas con dibujo (cada una pinta su fondo; el nombre usa la letra elegida si hay una). */
/* Lujo: noche con filetes de tu color, versalitas y el ícono grande de marca de agua. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="lujo"]{border-radius:4px!important;background:linear-gradient(90deg,rgba(10,10,16,.85),rgb(var(--tvm-b-rgb)/18%) 70%,rgb(var(--tvm-a-rgb)/30%))!important;box-shadow:inset 0 1px 0 rgb(var(--tvm-a-rgb)/80%),inset 0 -1px 0 rgb(var(--tvm-a-rgb)/80%),0 0 0 1px rgba(0,0,0,.4)!important;padding-left:12px!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="lujo"]::after{content:attr(data-tvm-icon);left:auto;right:150px;top:50%;bottom:auto;width:auto;background:none;box-shadow:none;transform:translateY(-50%) rotate(-14deg);font-size:38px;opacity:.22;filter:saturate(.6)}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="lujo"][data-tvm-icon]::before{display:none}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="lujo"] [data-hook="name"]{font-family:Georgia,'Times New Roman',serif;font-variant:small-caps;letter-spacing:.1em!important;font-weight:700!important;font-size:15px}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="lujo"]:not(.admin) [data-hook="name"]{background-image:linear-gradient(180deg,#fff,rgb(var(--tvm-a-rgb)))!important;filter:none!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="lujo"] .tvm-av{background:transparent!important;box-shadow:0 0 0 1px rgb(var(--tvm-a-rgb))!important;color:rgb(var(--tvm-a-rgb))!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="lujo"] [data-hook="ping"]{background:none!important;font-family:Georgia,serif;color:rgb(var(--tvm-a-rgb))!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="lujo"] .tvm-marks{background:none!important;box-shadow:none!important}
/* Pincel: un brochazo de tus dos colores y letra a mano. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="pincel"]{background:transparent!important;box-shadow:none!important;overflow:visible}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="pincel"]::after{left:-4px;right:-4px;top:-3px;bottom:-3px;width:auto;z-index:-1;background:linear-gradient(90deg,rgb(var(--tvm-a-rgb)),rgb(var(--tvm-b-rgb)));box-shadow:none;-webkit-mask:url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%20400%2060%27%20preserveAspectRatio%3D%27none%27%3E%3Cpath%20d%3D%27M6%2034%20C20%2014%2060%2010%20110%2012%20C170%206%20230%2014%20300%2010%20C340%208%20380%2012%20394%2022%20C398%2030%20392%2040%20380%2044%20C330%2052%20260%2046%20200%2050%20C140%2054%2080%2050%2040%2052%20C18%2054%202%2046%206%2034Z%20M30%2018%20C80%208%20120%2014%20160%209%20L150%2016%20C110%2020%2070%2018%2030%2018Z%20M220%2050%20C260%2052%20300%2056%20340%2052%20L330%2058%20C290%2060%20250%2058%20220%2050Z%27%2F%3E%3C%2Fsvg%3E") center/100% 100% no-repeat;opacity:.85}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="pincel"]{isolation:isolate}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="pincel"]:not(.admin) [data-hook="name"]{background-image:none!important;-webkit-text-fill-color:#fff!important;font-family:'Comic Sans MS','Segoe Print',cursive;font-weight:900!important;font-size:16px;transform:rotate(-2deg);filter:drop-shadow(2px 2px 0 rgba(0,0,0,.45))!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="pincel"][data-tvm-icon]::before{background:#fff!important;box-shadow:0 2px 0 rgba(0,0,0,.3)!important;transform:rotate(-8deg)}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="pincel"] .tvm-av{background:rgba(0,0,0,.3)!important;box-shadow:0 0 0 2px #fff!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="pincel"] [data-hook="ping"]{background:rgba(0,0,0,.3)!important;color:#fff!important}
/* Mármol: piedra clara con vetas de tus colores y canto dorado. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="marmol"]{border-radius:8px!important;background:
 linear-gradient(115deg,transparent 0 20%,rgb(var(--tvm-b-rgb)/35%) 21%,transparent 23% 46%,rgba(0,0,0,.18) 47%,transparent 48.5%),
 linear-gradient(160deg,transparent 0 55%,rgb(var(--tvm-a-rgb)/45%) 56%,transparent 57.5% 80%,rgba(0,0,0,.12) 81%,transparent 82%),
 linear-gradient(80deg,transparent 0 68%,rgba(255,255,255,.5) 69%,transparent 70%),
 radial-gradient(160px 60px at 20% 30%,rgba(255,255,255,.9),transparent 70%),
 linear-gradient(90deg,#efe9e2,#ddd5cc)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.7),inset 0 -2px 0 rgba(0,0,0,.12),0 6px 14px -8px #000!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="marmol"]::after{width:5px;background:linear-gradient(180deg,#e9c46a,#a3741c);box-shadow:none}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="marmol"]:not(.admin) [data-hook="name"]{background-image:linear-gradient(90deg,rgb(var(--tvm-b-rgb)),#1b1b25)!important;filter:none!important;font-family:Georgia,serif;font-weight:700!important;font-size:15px}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="marmol"] .tvm-av{background:#fff!important;color:#333!important;box-shadow:0 0 0 1.5px #c9a24a!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="marmol"][data-tvm-icon]::before{background:radial-gradient(circle at 35% 30%,#fff3c4,#c9a24a)!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="marmol"] [data-hook="ping"]{background:rgba(0,0,0,.08)!important;color:#333!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="marmol"] .flag{box-shadow:0 0 0 1px rgba(0,0,0,.15)}
/* Acuarela: manchas de tus colores sobre papel claro. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuarela"]{border-radius:14px 6px 16px 8px!important;background:
 radial-gradient(70px 30px at 10% 40%,rgb(var(--tvm-a-rgb)/65%),transparent 70%),
 radial-gradient(90px 26px at 38% 70%,rgb(var(--tvm-b-rgb)/55%),transparent 72%),
 radial-gradient(80px 34px at 62% 30%,rgb(var(--tvm-a-rgb)/45%),transparent 70%),
 radial-gradient(110px 30px at 88% 60%,rgb(var(--tvm-b-rgb)/50%),transparent 72%),
 radial-gradient(40px 20px at 50% 50%,rgba(255,255,255,.18),transparent 70%),
 linear-gradient(90deg,#f6f1e7,#ece4d6)!important;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 6px 14px -8px rgba(0,0,0,.8)!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuarela"]::after{display:none}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuarela"]:not(.admin) [data-hook="name"]{background-image:none!important;-webkit-text-fill-color:#1d1a24!important;font-family:'Segoe Print','Comic Sans MS',cursive;font-weight:700!important;filter:none!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuarela"] .tvm-av{background:rgba(255,255,255,.7)!important;color:#333!important;box-shadow:0 0 0 1.5px rgb(var(--tvm-b-rgb))!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuarela"][data-tvm-icon]::before{background:rgba(255,255,255,.75)!important;box-shadow:none!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuarela"] [data-hook="ping"]{background:rgba(255,255,255,.6)!important;color:#333!important}
/* Acuarela de noche: las mismas manchas sobre papel oscuro. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuanoche"]{border-radius:14px 6px 16px 8px!important;background:
 radial-gradient(70px 30px at 10% 40%,rgb(var(--tvm-a-rgb)/70%),transparent 70%),
 radial-gradient(90px 26px at 38% 70%,rgb(var(--tvm-b-rgb)/60%),transparent 72%),
 radial-gradient(80px 34px at 62% 30%,rgb(var(--tvm-a-rgb)/50%),transparent 70%),
 radial-gradient(110px 30px at 88% 60%,rgb(var(--tvm-b-rgb)/55%),transparent 72%),
 radial-gradient(30px 14px at 25% 20%,rgba(255,255,255,.25),transparent 70%),
 radial-gradient(26px 12px at 70% 80%,rgba(255,255,255,.18),transparent 70%),
 linear-gradient(90deg,#15131d,#1b1826)!important;box-shadow:inset 0 0 0 1px rgb(var(--tvm-a-rgb)/30%),0 6px 14px -8px #000!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuanoche"]::after{display:none}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuanoche"]:not(.admin) [data-hook="name"]{background-image:none!important;-webkit-text-fill-color:#fff!important;font-family:'Segoe Print','Comic Sans MS',cursive;font-weight:700!important;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuanoche"] .tvm-av{background:rgba(0,0,0,.35)!important;box-shadow:0 0 0 1.5px rgb(var(--tvm-a-rgb))!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuanoche"][data-tvm-icon]::before{background:rgba(255,255,255,.18)!important;box-shadow:none!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuanoche"] [data-hook="ping"]{background:rgba(0,0,0,.35)!important;color:#fff!important}
/* Humo: hilos de tus colores sobre fondo oscuro, nombre en cursiva. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="humo"]{border-radius:10px!important;background:
 radial-gradient(60px 10px at 15% 30%,rgb(var(--tvm-a-rgb)/45%),transparent 80%),
 radial-gradient(90px 8px at 30% 62%,rgb(var(--tvm-a-rgb)/35%),transparent 80%),
 radial-gradient(120px 12px at 52% 38%,rgb(var(--tvm-b-rgb)/40%),transparent 80%),
 radial-gradient(80px 7px at 66% 72%,rgb(var(--tvm-a-rgb)/30%),transparent 80%),
 radial-gradient(140px 14px at 86% 45%,rgb(var(--tvm-b-rgb)/35%),transparent 80%),
 radial-gradient(70px 6px at 44% 20%,rgba(255,255,255,.12),transparent 80%),
 linear-gradient(90deg,#121118,#18161f)!important;box-shadow:inset 0 0 0 1px rgb(var(--tvm-a-rgb)/22%),0 6px 14px -8px #000!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="humo"]:not(.admin) [data-hook="name"]{background-image:none!important;-webkit-text-fill-color:#fff!important;font-family:Georgia,serif;font-style:italic;font-weight:700!important;filter:drop-shadow(0 0 6px rgb(var(--tvm-a-rgb)/60%))!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="humo"]::after{display:none}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="humo"] .tvm-av{background:rgba(0,0,0,.35)!important;box-shadow:0 0 0 1.5px rgb(var(--tvm-a-rgb))!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="humo"][data-tvm-icon]::before{background:rgba(255,255,255,.14)!important;box-shadow:none!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="humo"] [data-hook="ping"]{background:rgba(0,0,0,.35)!important;color:#fff!important}
/* Galaxia (la de entrada): estrellas y dos nebulosas de tus colores. */
.room-view .player-list-item.tvm-peer-row[data-tvm-style="galaxia"]{border-radius:10px!important;background:
 radial-gradient(1px 1px at 8% 30%,#fff,transparent),radial-gradient(1px 1px at 19% 75%,#fff,transparent),radial-gradient(1.5px 1.5px at 33% 22%,#fff,transparent),radial-gradient(1px 1px at 46% 68%,#cfe,transparent),radial-gradient(1px 1px at 57% 35%,#fff,transparent),radial-gradient(1.5px 1.5px at 66% 80%,#fff,transparent),radial-gradient(1px 1px at 74% 18%,#fff,transparent),radial-gradient(1px 1px at 88% 60%,#fff,transparent),radial-gradient(2px 2px at 95% 25%,#fff,transparent),
 radial-gradient(120px 40px at 35% 60%,rgb(var(--tvm-a-rgb)/45%),transparent 70%),
 radial-gradient(110px 36px at 70% 35%,rgb(var(--tvm-b-rgb)/45%),transparent 70%),
 radial-gradient(70px 24px at 55% 50%,rgba(255,255,255,.10),transparent 70%),
 linear-gradient(90deg,#07060f,#0d0a1c)!important;
 box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 6px 16px -8px #000!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="galaxia"]::after{display:none}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="galaxia"]:not(.admin) [data-hook="name"]{background-image:none!important;-webkit-text-fill-color:#fff!important;font-weight:800!important;letter-spacing:.04em;filter:drop-shadow(0 0 6px rgb(var(--tvm-a-rgb)))!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="galaxia"] [data-hook="ping"]{background:rgba(255,255,255,.1)!important;color:#fff!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="galaxia"] .tvm-av{box-shadow:0 0 0 1.5px #fff,0 0 8px rgb(var(--tvm-a-rgb))!important}
.room-view .player-list-item.tvm-peer-row[data-tvm-style="lujo"]:hover,
.room-view .player-list-item.tvm-peer-row[data-tvm-style="pincel"]:hover,
.room-view .player-list-item.tvm-peer-row[data-tvm-style="marmol"]:hover,
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuarela"]:hover,
.room-view .player-list-item.tvm-peer-row[data-tvm-style="acuanoche"]:hover,
.room-view .player-list-item.tvm-peer-row[data-tvm-style="humo"]:hover,
.room-view .player-list-item.tvm-peer-row[data-tvm-style="galaxia"]:hover { filter: brightness(1.12); }
`;
}

/** Un ícono de `ICONS` como elemento, con la clase de la hoja. */
function icon(doc, name) {
  const holder = doc.createElement('span');
  holder.innerHTML = ICONS[name] || '';
  const svg = holder.firstElementChild;
  if (svg) svg.setAttribute('class', 'tvm-ico');
  return svg;
}

module.exports = { ICONS, VIP_GEM_SVG, FRIEND_SVG, FONT_STACK, fontFaceCss, peerLook, css, icon, rgba, mix };
