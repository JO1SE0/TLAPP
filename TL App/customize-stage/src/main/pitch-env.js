'use strict';

/*
 * Alrededores de la cancha: potrero de noche, club de barrio, potrero LED y
 * canchita F5.
 *
 * Todo se dibuja UNA vez, adentro del cache del estadio (ver `skinPitch` en
 * game-preload.js): en la partida no cuesta nada por cuadro. El gol se ve
 * rehaciendo ese cache dos veces (al empezar el festejo y al terminar): el LED
 * dice ¡GOL! y la gente del equipo que metió levanta los brazos.
 *
 * Se dibuja en coordenadas de CANCHA (el centro es 0,0; `halfW`/`halfH` son la
 * mitad del ancho y del alto del campo), afuera de las líneas, y dejando libre
 * la boca de cada arco. Lo que no entra en la vista simplemente no se ve.
 *
 * Con «Lado fijo» el juego espeja la cancha entera, cache incluido: los textos
 * se escriben espejados para que se lean derecho.
 */

const ENVS = [
  ['none', 'Nada'],
  ['noche', 'Potrero de noche'],
  ['barrio', 'Club de barrio'],
  ['led', 'Potrero LED'],
  ['f5', 'Canchita F5']
];
const IDS = new Set(ENVS.map(([id]) => id).filter((id) => id !== 'none'));
const has = (id) => IDS.has(id);

const RED = '#d24a4a';
const BLUE = '#3d6ad6';
const CROWD = [RED, BLUE, '#e8e2d0', '#2b2b2b', '#7a6a55', '#c9a24a'];

/** Azar con semilla: la misma gente en el mismo lugar cada vez que se rehace. */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** La boca del arco: en los fondos no se dibuja nada en esa franja. */
function goalGap(halfH) {
  return Math.max(80, halfH * 0.5);
}

function fence(ctx, x, y, w, h, alpha) {
  ctx.save();
  ctx.strokeStyle = `rgba(200,205,195,${alpha})`;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(x, y, w, h);
  // Los postes, cada tanto.
  ctx.fillStyle = '#8d9088';
  for (let i = 0; i <= w; i += 80) {
    ctx.beginPath(); ctx.arc(x + i, y, 2.4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x + i, y + h, 2.4, 0, 7); ctx.fill();
  }
  ctx.restore();
}

/** Malla de alambre en una franja (de afuera hacia el borde del alambrado). */
function mesh(ctx, x, y, w, h, step, alpha) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = `rgba(205,210,200,${alpha})`;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let i = -h; i < w; i += step) {
    ctx.moveTo(x + i, y); ctx.lineTo(x + i + h, y + h);
    ctx.moveTo(x + i + h, y); ctx.lineTo(x + i, y + h);
  }
  ctx.stroke();
  ctx.restore();
}

function tree(ctx, x, y, r) {
  ctx.fillStyle = '#1b3518';
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.fillStyle = '#284d23';
  ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.68, 0, 7); ctx.fill();
}

function lamp(ctx, x, y, warm) {
  const c = warm ? '255,214,140' : '225,238,255';
  const g = ctx.createRadialGradient(x, y, 2, x, y, 150);
  g.addColorStop(0, `rgba(${c},0.22)`);
  g.addColorStop(1, `rgba(${c},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - 150, y - 150, 300, 300);
  ctx.fillStyle = warm ? '#ffe3a8' : '#f2f7ff';
  ctx.fillRect(x - 9, y - 3, 18, 6);
}

/** Una persona vista de arriba. `up`: brazos arriba (festejo). */
function person(ctx, x, y, color, up) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y + 3, 6.5, 0, 7); ctx.fill();
  ctx.fillStyle = '#d9b38c';
  ctx.beginPath(); ctx.arc(x, y - 4, 4.2, 0, 7); ctx.fill();
  if (up) {
    ctx.strokeStyle = '#d9b38c';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 1); ctx.lineTo(x - 9, y - 13);
    ctx.moveTo(x + 5, y - 1); ctx.lineTo(x + 9, y - 13);
    ctx.stroke();
  }
}

/** Una fila de gente entre (x0,y) y (x1,y), con algo de desorden. */
function row(ctx, rnd, x0, x1, y, gap, cheer, density = 1) {
  for (let x = x0; x <= x1; x += gap) {
    if (rnd() > density) continue;
    const px = x + (rnd() - 0.5) * gap * 0.6;
    const py = y + (rnd() - 0.5) * 6;
    const team = px < 0 ? 'Red' : 'Blue';
    const c = rnd() < 0.55 ? (team === 'Red' ? RED : BLUE) : CROWD[Math.floor(rnd() * CROWD.length)];
    person(ctx, px, py, c, cheer === team);
  }
}

/** Lo mismo, en vertical (laterales de los fondos). */
function column(ctx, rnd, x, y0, y1, gap, cheer, density = 1) {
  for (let y = y0; y <= y1; y += gap) {
    if (rnd() > density) continue;
    const px = x + (rnd() - 0.5) * 6;
    const py = y + (rnd() - 0.5) * gap * 0.6;
    const team = px < 0 ? 'Red' : 'Blue';
    const c = rnd() < 0.55 ? (team === 'Red' ? RED : BLUE) : CROWD[Math.floor(rnd() * CROWD.length)];
    person(ctx, px, py, c, cheer === team);
  }
}

/**
 * Un cartel LED. Fijo (no pasa el texto): se repite a lo largo. En el gol dice
 * ¡GOL! en dorado. `mirror`: el juego lo va a dar vuelta, se escribe al revés.
 */
function led(ctx, x, y, w, h, text, hot, mirror, vertical) {
  ctx.save();
  // Vertical: el cartel ocupa de x a x+h y de y a y+w; se gira y se escribe a lo largo.
  if (vertical) { ctx.translate(x + h, y); ctx.rotate(Math.PI / 2); } else ctx.translate(x, y);
  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1c2230';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, 0, w, h);
  ctx.beginPath();
  ctx.rect(1, 1, w - 2, h - 2);
  ctx.clip();
  const msg = hot ? '¡GOL!   ¡GOL!   ¡GOL!   ' : text;
  ctx.font = `700 ${Math.round(h * 0.66)}px monospace`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hot ? '#ffd34d' : '#e0b34a';
  // Puntitos de LED de fondo: dan la textura sin costar (es una vez).
  ctx.globalAlpha = 0.08;
  for (let i = 3; i < w; i += 4) ctx.fillRect(i, 1, 1, h - 2);
  ctx.globalAlpha = 1;
  const unit = ctx.measureText(msg).width || 1;
  // El espejo del juego da vuelta la X de la cancha: en un cartel acostado es
  // su largo; en uno parado, su ancho.
  if (mirror && !vertical) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  if (mirror && vertical) { ctx.translate(0, h); ctx.scale(1, -1); }
  for (let tx = 4; tx < w; tx += unit) ctx.fillText(msg, tx, h / 2 + 0.5);
  ctx.restore();
}

/** Texto suelto (paredón pintado), respetando el espejo. */
function paint(ctx, text, x, y, font, color, mirror) {
  ctx.save();
  ctx.translate(x, y);
  if (mirror) ctx.scale(-1, 1);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/* ── Las cuatro ─────────────────────────────────────────────────────── */

function potreroNoche(ctx, W, H, o) {
  const rnd = seeded(11);
  // Tierra alrededor.
  ctx.fillStyle = 'rgba(58,46,32,0.55)';
  ctx.fillRect(-W - 130, -H - 130, 2 * W + 260, 2 * H + 260);
  tree(ctx, -W - 95, -H - 90, 42); tree(ctx, W + 95, -H - 95, 40);
  tree(ctx, -W - 100, H + 95, 46); tree(ctx, W + 92, H + 90, 42);
  // Paredón con un LED chiquito.
  ctx.fillStyle = '#3b3a36';
  ctx.fillRect(-150, -H - 84, 300, 30);
  led(ctx, -136, -H - 79, 272, 20, '  TODA LA LECCE  ·', o.hot, o.mirror);
  row(ctx, rnd, -W + 20, -165, -H - 40, 30, o.cheer, 0.8);
  row(ctx, rnd, 165, W - 20, -H - 40, 30, o.cheer, 0.8);
  row(ctx, rnd, -W + 20, W - 20, H + 40, 30, o.cheer, 0.8);
  fence(ctx, -W - 22, -H - 22, 2 * W + 44, 2 * H + 44, 0.5);
  mesh(ctx, -W - 22, -H - 22, 2 * W + 44, 14, 9, 0.35);
  mesh(ctx, -W - 22, H + 8, 2 * W + 44, 14, 9, 0.35);
  lamp(ctx, -W - 55, -H - 55, true); lamp(ctx, W + 55, -H - 55, true);
  lamp(ctx, -W - 55, H + 55, true); lamp(ctx, W + 55, H + 55, true);
}

function clubBarrio(ctx, W, H, o) {
  const rnd = seeded(23);
  ctx.fillStyle = 'rgba(30,33,28,0.5)';
  ctx.fillRect(-W - 130, -H - 130, 2 * W + 260, 2 * H + 260);
  // Tribunita de cemento arriba, con la hinchada.
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = k % 2 ? '#6d6c68' : '#7a7975';
    ctx.fillRect(-W + 40, -H - 94 + k * 16, 2 * W - 80, 16);
  }
  for (let k = 0; k < 4; k++) row(ctx, rnd, -W + 56, W - 56, -H - 87 + k * 16, 20, o.cheer, 0.85);
  // Paredón pintado abajo y un LED bajo.
  ctx.fillStyle = '#c9c2b2';
  ctx.fillRect(-W - 60, H + 36, 2 * W + 120, 36);
  paint(ctx, 'TL', -W + 10, H + 54, '900 26px sans-serif', '#b23a3a', o.mirror);
  paint(ctx, 'TODA LA LECCE · DESDE SIEMPRE', -W / 3, H + 54, '700 15px sans-serif', '#333', o.mirror);
  paint(ctx, '★', W - 10, H + 54, '900 24px sans-serif', '#2a5bd7', o.mirror);
  led(ctx, W * 0.25, H + 43, W * 0.6, 22, '  CLUB TODA LA LECCE  ·  SOCIOS AL DÍA  ·', o.hot, o.mirror);
  tree(ctx, -W - 95, 0, 48); tree(ctx, W + 95, 0, 48);
  fence(ctx, -W - 22, -H - 22, 2 * W + 44, 2 * H + 44, 0.45);
  mesh(ctx, -W - 22, -H - 22, 2 * W + 44, 14, 9, 0.3);
  lamp(ctx, -W - 45, -H - 45, true); lamp(ctx, W + 45, -H - 45, true);
}

function potreroLed(ctx, W, H, o) {
  const rnd = seeded(37);
  const gap = goalGap(H);
  ctx.fillStyle = 'rgba(40,38,30,0.5)';
  ctx.fillRect(-W - 140, -H - 140, 2 * W + 280, 2 * H + 280);
  tree(ctx, -W - 110, -H - 105, 38); tree(ctx, W + 110, -H - 105, 38);
  tree(ctx, -W - 110, H + 105, 38); tree(ctx, W + 110, H + 105, 38);
  // Gente afuera del alambrado, en los cuatro lados.
  row(ctx, rnd, -W, W, -H - 74, 26, o.cheer, 0.85);
  row(ctx, rnd, -W, W, H + 74, 26, o.cheer, 0.85);
  column(ctx, rnd, -W - 74, -H, -gap - 10, 26, o.cheer, 0.85);
  column(ctx, rnd, -W - 74, gap + 10, H, 26, o.cheer, 0.85);
  column(ctx, rnd, W + 74, -H, -gap - 10, 26, o.cheer, 0.85);
  column(ctx, rnd, W + 74, gap + 10, H, 26, o.cheer, 0.85);
  fence(ctx, -W - 48, -H - 48, 2 * W + 96, 2 * H + 96, 0.45);
  // LED al ras del pasto en los cuatro lados (en los fondos, sin tapar el arco).
  led(ctx, -W, -H - 30, 2 * W, 20, '  TODA LA LECCE  ·  TL APP  ·', o.hot, o.mirror);
  led(ctx, -W, H + 10, 2 * W, 20, '  TL APP  ·  TODA LA LECCE  ·', o.hot, o.mirror);
  for (const sx of [-1, 1]) {
    const x = sx < 0 ? -W - 34 : W + 14;
    led(ctx, x, -H, H - gap, 20, '  TODA LA LECCE  ·', o.hot, o.mirror, true);
    led(ctx, x, gap, H - gap, 20, '  TODA LA LECCE  ·', o.hot, o.mirror, true);
  }
  lamp(ctx, -W - 75, -H - 75, false); lamp(ctx, W + 75, -H - 75, false);
  lamp(ctx, -W - 75, H + 75, false); lamp(ctx, W + 75, H + 75, false);
}

function canchitaF5(ctx, W, H, o) {
  const rnd = seeded(53);
  const gap = goalGap(H);
  ctx.fillStyle = 'rgba(28,31,36,0.6)';
  ctx.fillRect(-W - 130, -H - 130, 2 * W + 260, 2 * H + 260);
  // Luces LED blancas colgando arriba.
  for (const x of [-W * 0.6, 0, W * 0.6]) {
    const g = ctx.createRadialGradient(x, 0, 10, x, 0, Math.max(W, H) * 0.8);
    g.addColorStop(0, 'rgba(225,240,255,0.07)');
    g.addColorStop(1, 'rgba(225,240,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - W, -H - 120, 2 * W, 2 * H + 240);
    ctx.fillStyle = '#eef6ff';
    ctx.fillRect(x - 40, -H - 66, 80, 7);
  }
  led(ctx, -W, -H - 32, 2 * W, 20, '  TL APP  ·  TODA LA LECCE  ·  F5 LOS MARTES  ·', o.hot, o.mirror);
  led(ctx, -W, H + 12, 2 * W, 20, '  TODA LA LECCE  ·  TL APP  ·', o.hot, o.mirror);
  // Banco de suplentes.
  ctx.fillStyle = '#3a3f48';
  ctx.fillRect(-120, H + 52, 240, 22);
  row(ctx, rnd, -105, 105, H + 63, 22, o.cheer, 0.9);
  // Red alta alrededor (también detrás de los arcos, pero con hueco en la boca).
  const net = (x, y, w, h) => {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = 'rgba(235,240,245,0.4)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = x; i <= x + w; i += 7) { ctx.moveTo(i, y); ctx.lineTo(i, y + h); }
    for (let j = y; j <= y + h; j += 7) { ctx.moveTo(x, j); ctx.lineTo(x + w, j); }
    ctx.stroke();
    ctx.restore();
  };
  net(-W - 40, -H - 58, 2 * W + 80, 18);
  net(-W - 40, H + 40, 2 * W + 80, 10);
  for (const x of [-W - 58, W + 40]) { net(x, -H - 58, 18, H + 58 - gap); net(x, gap, 18, H + 58 - gap); }
}

const DRAW = { noche: potreroNoche, barrio: clubBarrio, led: potreroLed, f5: canchitaF5 };

/**
 * Dibuja los alrededores. `ctx` llega con la transformación de mundo puesta.
 * @param {{ halfW:number, halfH:number }} bounds
 * @param {{ cheer?: 'Red'|'Blue'|null, hot?: boolean, mirror?: boolean }} o
 */
function paintEnv(ctx, id, bounds, o = {}) {
  const fn = DRAW[id];
  if (!fn || !bounds) return false;
  ctx.save();
  try {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    ctx.filter = 'none';
    // Sólo afuera de la cancha: nada pisa el campo.
    const W = bounds.halfW, H = bounds.halfH;
    ctx.beginPath();
    ctx.rect(-W * 50, -H * 50, W * 100, H * 100);
    ctx.rect(-W, -H, 2 * W, 2 * H);
    ctx.clip('evenodd');
    fn(ctx, W, H, { cheer: o.cheer || null, hot: !!o.hot, mirror: !!o.mirror });
  } finally {
    ctx.restore();
  }
  return true;
}

module.exports = { ENVS, has, paintEnv, goalGap };
