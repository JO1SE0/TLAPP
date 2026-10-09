'use strict';

/**
 * Red del arco que ondula después de un gol. Es sólo un dibujo en tu pantalla:
 * no toca la física ni lo que ven los demás.
 *
 * Se dibuja en coordenadas de cancha (la misma transformación que el juego),
 * una vez por cuadro mientras dura el efecto, con `Path2D` para no tocar el
 * trazo en curso: el juego llama a esto con el círculo de la pelota ya armado
 * y todavía por rellenar.
 */

const DURATION_MS = 1400;

/** Mitad de la boca del arco, estimada: el motor no la publica con nombre fijo. */
const GOAL_HALF_RATIO = 0.4;

const state = { at: 0, side: 1, pending: false };

/** El juego confirmó un gol: se espera a ver de qué lado está la pelota. */
function trigger() {
  state.pending = true;
  state.at = performance.now();
}

/**
 * Se llama con la posición de la pelota en cada cuadro. Resuelve de qué lado
 * entró el gol la primera vez que la pelota está claramente hacia un lado.
 * Devuelve `true` si hay que dibujar.
 */
function active(ballX, halfW) {
  if (!state.at) return false;
  const age = performance.now() - state.at;
  if (age > DURATION_MS + 600) { state.at = 0; state.pending = false; return false; }
  if (state.pending && Math.abs(ballX) > halfW * 0.5) {
    state.side = ballX > 0 ? 1 : -1;
    state.pending = false;
    state.at = performance.now(); // la onda arranca cuando ya se sabe el lado
  }
  return !state.pending;
}

function draw(ctx, halfW, halfH) {
  const t = (performance.now() - state.at) / DURATION_MS;
  if (t < 0 || t >= 1) return;
  const Path = ctx.canvas.ownerDocument.defaultView.Path2D;
  const decay = 1 - t;
  const dir = state.side;
  const goalX = halfW * dir;
  const half = halfH * GOAL_HALF_RATIO;
  const depth = 22;
  const cols = 6;
  const rows = 10;
  const wave = (u, v) => Math.sin(t * 22 - u * 3 - v * 1.5) * 4 * decay;

  const mesh = new Path();
  for (let i = 0; i <= cols; i++) {
    const u = i / cols;
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const px = goalX + dir * (u * depth + wave(u, v));
      const py = -half + v * half * 2;
      if (j === 0) mesh.moveTo(px, py); else mesh.lineTo(px, py);
    }
  }
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const px = goalX + dir * (u * depth + wave(u, v));
      const py = -half + v * half * 2;
      if (i === 0) mesh.moveTo(px, py); else mesh.lineTo(px, py);
    }
  }
  ctx.save();
  ctx.strokeStyle = '#d0b878';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.65 * decay;
  ctx.stroke(mesh);
  ctx.restore();
}

module.exports = { trigger, active, draw };
