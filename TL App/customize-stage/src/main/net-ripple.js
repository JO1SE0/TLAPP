'use strict';

/**
 * Red de los arcos, siempre a la vista, que ondula cuando entra un gol. Es sólo
 * un dibujo en tu pantalla: no toca la física ni lo que ven los demás.
 *
 * El tamaño sale de los PALOS: el juego los dibuja como discos sin jugador, y
 * el motor no publica el ancho del arco con un nombre fijo, así que se miden
 * ahí (los dos más separados que estén sobre la línea de gol de cada lado).
 *
 * Se dibuja en coordenadas de cancha, con `Path2D` para no tocar el trazo en
 * curso: el juego llama a esto con el círculo de la pelota ya armado y todavía
 * por rellenar.
 */

const DURATION_MS = 1400;
const COLS = 6;
const ROWS = 12;
/** Profundidad de la red como fracción de la boca del arco. */
const DEPTH_RATIO = 0.22;

/** Palos vistos por lado: -1 izquierda, 1 derecha. */
const posts = { '-1': null, '1': null };
const state = { at: 0, side: 1, pending: false };
const cache = new Map();

/** Estadio nuevo: se olvida todo lo medido. */
function reset() {
  posts['-1'] = null;
  posts['1'] = null;
  cache.clear();
  state.at = 0;
  state.pending = false;
}

/** Un disco sin jugador dibujado cerca de la línea de gol: puede ser un palo. */
function notePost(x, y, r, halfW) {
  if (!(halfW > 0) || !(r > 0)) return;
  const side = x >= 0 ? 1 : -1;
  if (Math.abs(Math.abs(x) - halfW) > Math.max(6, r * 2)) return;
  const p = posts[side] || (posts[side] = { x: 0, n: 0, y0: Infinity, y1: -Infinity });
  p.x = (p.x * p.n + x) / (p.n + 1);
  p.n = Math.min(p.n + 1, 50);
  if (y < p.y0) { p.y0 = y; cache.clear(); }
  if (y > p.y1) { p.y1 = y; cache.clear(); }
}

/** El juego confirmó un gol: se espera a ver de qué lado está la pelota. */
function trigger() {
  state.pending = true;
  state.at = performance.now();
}

/** Resuelve de qué lado entró el gol en cuanto la pelota está claramente hacia un lado. */
function track(ballX, halfW) {
  if (!state.at) return;
  const age = performance.now() - state.at;
  if (age > DURATION_MS + 1500) { state.at = 0; state.pending = false; return; }
  if (state.pending && Math.abs(ballX) > halfW * 0.5) {
    state.side = ballX > 0 ? 1 : -1;
    state.pending = false;
    state.at = performance.now(); // la onda arranca cuando ya se sabe el lado
  }
}

function meshFor(Path, side, p, wave) {
  const span = p.y1 - p.y0;
  const depth = span * DEPTH_RATIO;
  const x0 = p.x;
  const mesh = new Path();
  const pt = (u, v) => [x0 + side * (u * depth + wave(u, v)), p.y0 + v * span];
  for (let i = 0; i <= COLS; i++) {
    for (let j = 0; j <= ROWS; j++) {
      const [px, py] = pt(i / COLS, j / ROWS);
      if (j === 0) mesh.moveTo(px, py); else mesh.lineTo(px, py);
    }
  }
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i <= COLS; i++) {
      const [px, py] = pt(i / COLS, j / ROWS);
      if (i === 0) mesh.moveTo(px, py); else mesh.lineTo(px, py);
    }
  }
  return mesh;
}

/** Dibuja las dos redes. Sólo la del lado del gol se mueve. */
function draw(ctx, halfW, ballX) {
  track(ballX, halfW);
  const Path = ctx.canvas.ownerDocument.defaultView.Path2D;
  const now = performance.now();
  const t = state.at && !state.pending ? (now - state.at) / DURATION_MS : 2;
  const moving = t >= 0 && t < 1;
  const decay = moving ? 1 - t : 0;

  for (const side of [-1, 1]) {
    const p = posts[side];
    if (!p || !(p.y1 - p.y0 > 4)) continue;
    const shake = moving && side === state.side;
    let mesh;
    if (shake) {
      const amp = (p.y1 - p.y0) * 0.035 * decay;
      mesh = meshFor(Path, side, p, (u, v) => Math.sin(t * 22 - u * 3 - v * 1.5) * amp);
    } else {
      mesh = cache.get(side);
      if (!mesh) { mesh = meshFor(Path, side, p, () => 0); cache.set(side, mesh); }
    }
    ctx.save();
    ctx.strokeStyle = '#d0b878';
    ctx.lineWidth = 1;
    ctx.globalAlpha = shake ? 0.55 + 0.35 * decay : 0.5;
    ctx.stroke(mesh);
    ctx.restore();
  }
}

module.exports = { reset, notePost, trigger, draw };
