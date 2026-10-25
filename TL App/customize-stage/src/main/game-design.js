'use strict';
/*
 * Diseño "iOS" (Personalización → Diseño) adentro del juego: lista de salas de
 * HaxBall, la sala (equipos, ajustes, botones), los carteles (apodo, clave,
 * menú de un jugador, kick/ban, elegir cancha), el chat y el marcador.
 *
 * Se pone ENCIMA del tema (themes.gameCss) y de room-ui.css, en un <style>
 * propio que va último. Cada regla lleva `html:root` adelante: misma regla que
 * la del tema con un poco más de peso, así gana sin pelear con el orden.
 *
 * Sólo pintura estática: sin backdrop-filter, sin animaciones, sin sombras
 * grandes sobre lo que se mueve. Nada de esto se vuelve a calcular por cuadro.
 *
 * El tema "HaxBall original" (skipGame) se respeta: su gracia es no tocar el
 * juego, así que ahí esto no hace nada.
 */
const { rgba } = require('./room-ui');

const FONT = '-apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

function css(p, opts = {}) {
  if (!p || p.skipGame || opts.design !== 'ios') return '';
  const R = 'html:root';
  const light = p.dark === false;
  const fill = light ? 'rgba(118,118,128,.12)' : 'rgba(118,118,128,.24)';
  const fill2 = light ? 'rgba(118,118,128,.2)' : 'rgba(118,118,128,.36)';
  const group = rgba(p.text, light ? 0.045 : 0.065);
  const sep = rgba(p.text, 0.11);
  const thumb = rgba(p.text, 0.22);
  const danger = light ? '#c8283a' : '#f0525f';
  const accentText = p.accentText || '#ffffff';
  const sheet = `0 30px 80px -24px rgba(0,0,0,.75), 0 0 0 1px ${rgba(p.text, 0.07)}`;
  const s = (sel) => sel.split(',').map((x) => `${R} ${x.trim()}`).join(', ');

  return `
/* ── Letra ── */
${s('body')} { font-family: ${FONT} !important; letter-spacing: -.005em; }
${s('.dialog button, .room-view button, .dialog input, .room-view input, .dialog select, .room-view select, .chatbox-view-contents')} { font-family: ${FONT} !important; }

/* ── Hojas: carteles, sala y lista de salas ── */
${s('.dialog, .room-view > .container, .choose-nickname-view > .dialog, .game-view > [data-hook="popups"] > .dialog')} {
  border: 0 !important;
  border-radius: 26px !important;
  background: ${p.bg1 || p.panel} !important;
  box-shadow: ${sheet} !important;
}
${s('.dialog > h1, .room-view > .container > h1, .game-view > [data-hook="popups"] > .dialog > h1')} {
  font-size: 17px !important; font-weight: 600 !important; letter-spacing: -.01em !important;
  border-bottom: 1px solid ${sep} !important;
}
${s('.dialog > h1::before, .room-view > .container > h1::before')} { display: none !important; }
${s('.game-view > [data-hook="popups"]')} { background-color: rgba(0,0,0,.45) !important; }

/* ── Botones cápsula con relleno gris ── */
${s('.dialog button, .room-view button, .connecting-view button, .disconnected-view button, .dialog .file-btn label, .room-view > .container .file-btn label, .chatbox-view-contents > .input button')} {
  border: 0 !important;
  border-radius: 99px !important;
  background: ${fill} !important;
  color: ${p.text} !important;
  font-weight: 600 !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
  box-shadow: none !important;
  clip-path: none !important;
  filter: none !important;
  transition: none !important;
}
${s('.dialog button:hover:not(:disabled), .room-view button:hover:not(:disabled), .connecting-view button:hover, .disconnected-view button:hover, .dialog .file-btn label:hover, .room-view > .container .file-btn label:hover')} {
  background: ${fill2} !important; color: ${p.text} !important; box-shadow: none !important; transform: none !important; filter: none !important;
}
${s('.dialog button:active:not(:disabled), .room-view button:active:not(:disabled)')} { opacity: .7 !important; transform: none !important; }

/* La acción principal de cada pantalla: el acento, liso. */
${s('.room-view > .container > .controls button[data-hook="start-btn"], .roomlist-view > .dialog > .splitter > .buttons > button[data-hook="join"], .room-password-view > .dialog .buttons > button[data-hook="ok"], .choose-nickname-view > .dialog > button[data-hook="ok"], .dialog.pick-stadium-view > .splitter > .buttons > button:first-child')} {
  background: ${p.accent} !important; color: ${accentText} !important; box-shadow: none !important;
}
${s('.room-view > .container > .controls button[data-hook="start-btn"]:hover:not(:disabled), .roomlist-view > .dialog > .splitter > .buttons > button[data-hook="join"]:hover:not(:disabled), .room-password-view > .dialog .buttons > button[data-hook="ok"]:hover:not(:disabled), .choose-nickname-view > .dialog > button[data-hook="ok"]:hover:not(:disabled), .dialog.pick-stadium-view > .splitter > .buttons > button:first-child:hover:not(:disabled)')} {
  background: ${p.accent} !important; color: ${accentText} !important; filter: brightness(1.08) !important;
}
/* Lo que no se deshace: rojo. */
${s('.room-view > .container > .controls button[data-hook="stop-btn"], .dialog > button[data-hook="kick"], .dialog.kick-player-view .row > button[data-hook="kick"]')} {
  background: ${rgba(danger, 0.18)} !important; color: ${light ? danger : '#ffb3b9'} !important;
}
${s('.room-view > .container > .controls button[data-hook="stop-btn"]:hover:not(:disabled), .dialog > button[data-hook="kick"]:hover:not(:disabled), .dialog.kick-player-view .row > button[data-hook="kick"]:hover')} {
  background: ${danger} !important; color: #ffffff !important;
}
/* «Cerrar» y parecidos: texto del acento, sin relleno. */
${s('.dialog > button[data-hook="close"], .dialog.kick-player-view .row > button[data-hook="close"], .game-view > [data-hook="popups"] > .dialog > button[data-hook="close"]')} {
  background: transparent !important; color: ${p.accent} !important;
}
${s('.dialog > button[data-hook="close"]:hover, .dialog.kick-player-view .row > button[data-hook="close"]:hover')} { background: ${fill} !important; }

/* ── Campos ── */
${s('.dialog input:not([type="range"]), .room-view > .container input:not([type="range"]), .dialog select, .room-view > .container select, .dialog.pick-stadium-view input:not([type="range"]), .game-view > [data-hook="popups"] > .dialog.kick-player-view input:not([type="range"])')} {
  border: 0 !important;
  border-radius: 10px !important;
  background: ${fill} !important;
  color: ${p.text} !important;
  box-shadow: none !important;
}
${s('.dialog input:focus, .room-view > .container input:focus, .dialog select:focus, .room-view > .container select:focus')} {
  box-shadow: 0 0 0 3px ${rgba(p.accent, 0.35)} !important; outline: none !important;
}
${s('.dialog .label-input, .room-view > .container .label-input')} {
  border-radius: 12px !important; background: ${group} !important; box-shadow: none !important;
}

/* ── Lista de salas de HaxBall ── */
${s('.roomlist-view > .dialog > .splitter > .list')} {
  border: 0 !important; border-radius: 16px !important; background: ${group} !important;
}
${s('.roomlist-view > .dialog > .splitter > .list thead')} { background: transparent !important; }
${s('.roomlist-view > .dialog > .splitter > .list thead td')} { font-size: 11px !important; letter-spacing: .06em !important; }
${s('.roomlist-view > .dialog > .splitter > .list .separator')} { background: ${sep} !important; }
${s('.roomlist-view > .dialog > .splitter > .list tbody tr:hover')} { background: ${rgba(p.text, 0.05)} !important; }
${s('.roomlist-view > .dialog > .splitter > .list tbody tr.selected')} { background: ${rgba(p.accent, 0.22)} !important; box-shadow: none !important; }
${s('.roomlist-view > .dialog > .splitter > .buttons > button, .roomlist-view > .dialog > .splitter > .buttons > .file-btn > label')} { border-radius: 99px !important; }
${s('.roomlist-view > .dialog > .splitter .filters .bool')} { border: 0 !important; border-radius: 99px !important; background: ${fill} !important; }
${s('.roomlist-view > .notice')} { border: 0 !important; border-radius: 99px !important; background: ${rgba(p.accent, 0.18)} !important; }

/* ── La sala ── */
${s('.room-view > .container > .teams .player-list-view .list')} {
  border: 0 !important; border-radius: 16px !important; background: ${group} !important; box-shadow: none !important;
}
${s('.room-view .player-list-item')} { border-radius: 10px !important; }
${s('.room-view > .container > .teams .player-list-view .buttons button[data-hook="join-btn"]')} {
  border-radius: 99px !important; background: ${fill} !important; box-shadow: none !important; font-size: 12px !important;
}
${s('.room-view > .container > .teams .player-list-view .buttons button:not([data-hook="join-btn"])')} { background: transparent !important; }
${s('.room-view > .container > .teams .player-list-view.t-red .buttons button[data-hook="join-btn"]')} { color: ${p.red} !important; background: ${rgba(p.red, 0.16)} !important; }
${s('.room-view > .container > .teams .player-list-view.t-blue .buttons button[data-hook="join-btn"]')} { color: ${p.blue} !important; background: ${rgba(p.blue, 0.16)} !important; }
${s('.room-view > .container > .teams > .tools button')} { border-radius: 99px !important; background: ${fill} !important; box-shadow: none !important; transform: none !important; }
${s('.room-view > .container > .settings')} {
  border-radius: 20px !important; background: ${group} !important; box-shadow: none !important;
}
${s('.room-view > .container > .settings input, .room-view > .container > .settings select')} { border-radius: 10px !important; }
${s('.room-view > .container > .controls button')} { border-radius: 99px !important; transform: none !important; }

/* ── Menú de un jugador y kick/ban ── */
${s('.game-view > [data-hook="popups"] > .dialog > button, .dialog.kick-player-view .row > button, .game-view > [data-hook="popups"] > .dialog.kick-player-view > button[data-hook="ban-btn"], .dialog button.tvm-menu-btn')} { border-radius: 12px !important; }
${s('.dialog .tvm-menu-sep')} { background: ${sep} !important; }
/* El interruptor de «banear», de iPhone. */
${s('.tvm-switch')} { width: 38px !important; height: 23px !important; border-radius: 99px !important; background: ${fill2} !important; box-shadow: none !important; }
${s('.tvm-switch::after')} { width: 19px !important; height: 19px !important; border-radius: 50% !important; box-shadow: 0 2px 6px rgba(0,0,0,.2) !important; }
${s('.kick-player-view.tvm-ban-on .tvm-switch')} { background: ${danger} !important; }
${s('.kick-player-view.tvm-ban-on .tvm-switch::after')} { transform: translateX(15px) !important; }

/* ── Elegir cancha ── */
${s('.dialog.pick-stadium-view > .splitter > .list')} { border-radius: 16px !important; background: ${group} !important; box-shadow: none !important; }
${s('.dialog.pick-stadium-view > .splitter > .list > *')} { border-radius: 10px !important; }
${s('.dialog.pick-stadium-view > .splitter > .list > .selected, .dialog.pick-stadium-view > .splitter > .list > [class*="select"]')} {
  background: ${rgba(p.accent, 0.22)} !important; box-shadow: none !important;
}

/* ── Chat ── */
${s('.game-view:not(.chat-bg-full) .chatbox-view-contents')} { border: 0 !important; border-radius: 16px 16px 0 0 !important; }
${s('.chatbox-view-contents > .input input[type="text"]')} { border: 0 !important; border-radius: 99px !important; background: ${fill} !important; padding: 0 14px !important; }
${s('.chatbox-view-contents > .autocompletebox')} { border: 0 !important; border-radius: 14px !important; box-shadow: ${sheet} !important; }
${s('.chatbox-view-contents > .log .log-contents p.highlight')} { border-radius: 8px !important; box-shadow: none !important; }

/* ── Marcador de arriba (sólo el de fábrica: los estilos propios se respetan) ── */
${opts.scoreboard && opts.scoreboard !== 'default' ? '' : `${s('.game-state-view .bar')} { border: 0 !important; border-radius: 0 0 18px 18px !important; box-shadow: 0 8px 24px -12px rgba(0,0,0,.6) !important; }`}

/* ── Barras de desplazamiento finitas ── */
${s('::-webkit-scrollbar-thumb')} { background: ${thumb} !important; border-radius: 99px !important; }
`;
}

module.exports = { css };
