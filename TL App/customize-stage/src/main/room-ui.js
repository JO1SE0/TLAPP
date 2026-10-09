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
function peerLook(look, opts = {}) {
  const light = !!opts.light;
  return {
    '--tvm-vip-bg': `linear-gradient(90deg, ${rgba(look.a, light ? 0.3 : 0.26)} 0%, ${rgba(look.b, light ? 0.14 : 0.12)} 42%, ${rgba(look.b, 0)} 78%)`,
    '--tvm-vip-bg-hi': `linear-gradient(90deg, ${rgba(look.a, light ? 0.42 : 0.38)} 0%, ${rgba(look.b, light ? 0.22 : 0.2)} 50%, ${rgba(look.b, 0.04)} 92%)`,
    '--tvm-vip-edge': `inset 3px 0 0 ${look.b}, inset 0 0 0 1px ${rgba(look.a, light ? 0.4 : 0.22)}`,
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
.player-list-item .tvm-marks {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0 8px 0 6px;
}
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
/* Verde: el celeste ya es el VIP y está pegado al lado. */
.player-list-item .tvm-mark--friend { color: #6ee7a8; }
.player-list-item .tvm-mark--friend svg {
  width: 100%; height: 100%; display: block;
  fill: none; stroke: currentColor; stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .45));
}

/* ── La fila de un VIP ─────────────────────────────────────────
   Los colores llegan por variables desde la fila (ver peerLook): acá va la
   forma. La especificidad es alta y lleva !important porque los temas pintan
   el hover de todas las filas con un fondo !important, que se comía el aura
   justo cuando uno pasaba el mouse. */
.room-view .player-list-item.tvm-peer-row,
.player-list-item.tvm-peer-row {
  overflow: hidden;
  border-radius: 4px !important;
  padding-left: 9px !important;
  background: var(--tvm-vip-bg) !important;
  box-shadow: var(--tvm-vip-edge) !important;
}
.room-view .player-list-item.tvm-peer-row:hover,
.player-list-item.tvm-peer-row:hover { background: var(--tvm-vip-bg-hi) !important; }
.player-list-item.tvm-peer-row [data-hook="name"] {
  font-weight: 700 !important;
  letter-spacing: .01em;
}
/* El nombre en degradado. Un admin conserva su dorado: es información, y un
   cosmético no la puede tapar. */
.player-list-item.tvm-peer-row:not(.admin) [data-hook="name"] {
  background-image: var(--tvm-vip-name);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: none !important;
}
${animations ? `/* Un reflejo que cruza la fila cada tanto. Sólo transform: lo mueve el
   compositor, y la sala ni siquiera está a la vista mientras se juega. */
.player-list-item.tvm-peer-row::after {
  content: "";
  position: absolute; top: 0; bottom: 0; left: 0; width: 60%;
  background: linear-gradient(100deg, rgba(255, 255, 255, 0) 20%, rgba(255, 255, 255, ${light ? 0.35 : 0.1}) 50%, rgba(255, 255, 255, 0) 80%);
  transform: translateX(-120%);
  animation: tvmVipSheen 7s ease-in-out infinite;
  pointer-events: none;
}
@keyframes tvmVipSheen {
  0%, 70% { transform: translateX(-120%); }
  90%, 100% { transform: translateX(220%); }
}` : ''}
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
