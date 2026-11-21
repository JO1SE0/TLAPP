'use strict';

/*
 * Alrededores de la cancha: potrero de noche, club de barrio, potrero LED y
 * canchita F5.
 *
 * Todo se dibuja UNA vez, adentro del cache del estadio (ver `skinPitch` en
 * game-preload.js): en la partida no cuesta nada por cuadro, así que acá se
 * puede cargar de detalle sin miedo. El gol se ve rehaciendo ese cache dos
 * veces (al empezar el festejo y al terminar): el LED dice ¡GOL! y la gente
 * del equipo que metió levanta los brazos.
 *
 * Se dibuja en coordenadas de CANCHA (el centro es 0,0; `W`/`H` son la mitad
 * del ancho y del alto del campo), sólo afuera de las líneas y dejando libre la
 * boca de cada arco. Lo más importante va pegado a la cancha (arriba y abajo
 * se ven unas 80 unidades); lo de los costados y lo de más lejos se ve si la
 * ventana muestra más.
 *
 * Con «Lado fijo» el juego espeja la cancha entera, cache incluido: los textos
 * se escriben espejados para que se lean derecho.
 */

const ENVS = [
  ['none', 'Nada'],
  ['noche', 'Potrero de noche'],
  ['barrio', 'Club de barrio'],
  ['led', 'Potrero LED'],
  ['f5', 'Canchita F5'],
  ['playa', 'Playa'],
  ['campo', 'Campito'],
  ['azotea', 'Azotea'],
  ['cortada', 'La cortada'],
  ['colegio', 'Patio del colegio'],
  ['estadio', 'Estadio grande']
];
const IDS = new Set(ENVS.map(([id]) => id).filter((id) => id !== 'none'));
const has = (id) => IDS.has(id);

const RED = '#d24a4a';
const BLUE = '#3d6ad6';
const SKIN = ['#e9c4a0', '#d6a77f', '#b98559', '#8d5a3b', '#f2d3b6', '#6b4229'];
const HAIR = ['#2a1d14', '#1a1a1a', '#5a3b22', '#8a6a3c', '#3b2a1e', '#b9b2a6'];
const NEUTRAL = ['#e8e2d0', '#2b2b2b', '#6b6f78', '#7a6a55', '#c9a24a', '#3f5a3a', '#5b3a5e'];

/** Azar con semilla: la misma gente en el mismo lugar cada vez que se rehace. */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

/** La boca del arco: en los fondos no se dibuja nada en esa franja. */
function goalGap(halfH) {
  return Math.max(80, halfH * 0.5);
}

/* ── Piso ─────────────────────────────────────────────────────────── */

/** Un piso con textura: base, manchas grandes y granitos. */
function ground(ctx, rnd, W, H, base, spots, grain) {
  // Bien grande: con la ventana abierta o el zoom alejado no se tiene que ver el borde.
  const X = W + 700, Y = H + 500;
  ctx.fillStyle = base;
  ctx.fillRect(-X, -Y, 2 * X, 2 * Y);
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = pick(rnd, spots);
    ctx.beginPath();
    ctx.ellipse(-X + rnd() * 2 * X, -Y + rnd() * 2 * Y, 8 + rnd() * 30, 5 + rnd() * 16, rnd() * 3, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = pick(rnd, grain);
    const s = 1 + rnd() * 1.8;
    ctx.fillRect(-X + rnd() * 2 * X, -Y + rnd() * 2 * Y, s, s);
  }
  // Lluvia: charcos en el piso (abajo de la gente y de las cosas).
  if (LIVE.wet) {
    for (let i = 0; i < 70; i++) {
      const x = -W - 300 + rnd() * (2 * W + 600), y = -H - 200 + rnd() * (2 * H + 400);
      if (Math.abs(x) < W && Math.abs(y) < H) continue;
      puddle(ctx, x, y, 10 + rnd() * 22, 4 + rnd() * 7, 'rgba(200,220,255,0.16)');
    }
  }
  // Nieve: va en el piso, así la gente y las cosas quedan encima.
  if (LIVE.snow) {
    ctx.fillStyle = 'rgba(236,242,250,0.6)';
    ctx.fillRect(-X, -Y, 2 * X, 2 * Y);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = 'rgba(252,253,255,0.7)';
      ctx.beginPath(); ctx.ellipse(-X + rnd() * 2 * X, -Y + rnd() * 2 * Y, 8 + rnd() * 30, 4 + rnd() * 14, rnd() * 3, 0, 7); ctx.fill();
    }
  }
}

/** Matas de pasto sueltas (potrero). */
function tufts(ctx, rnd, W, H, n) {
  for (let i = 0; i < n; i++) {
    const side = rnd();
    let x, y;
    if (side < 0.5) { x = -W - 60 + rnd() * (2 * W + 120); y = (rnd() < 0.5 ? -1 : 1) * (H + 8 + rnd() * 120); }
    else { y = -H - 60 + rnd() * (2 * H + 120); x = (rnd() < 0.5 ? -1 : 1) * (W + 8 + rnd() * 160); }
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(78,112,58,0.75)' : 'rgba(96,130,66,0.7)';
    for (let k = 0; k < 5; k++) {
      ctx.beginPath(); ctx.arc(x + (rnd() - 0.5) * 9, y + (rnd() - 0.5) * 6, 1.6 + rnd() * 2, 0, 7); ctx.fill();
    }
  }
}

function puddle(ctx, x, y, rx, ry, glow) {
  ctx.fillStyle = 'rgba(40,52,62,0.75)';
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0.2, 0, 7); ctx.fill();
  ctx.fillStyle = glow || 'rgba(255,220,150,0.18)';
  ctx.beginPath(); ctx.ellipse(x - rx * 0.2, y - ry * 0.2, rx * 0.45, ry * 0.35, 0.2, 0, 7); ctx.fill();
}

/* ── Gente ────────────────────────────────────────────────────────── */

/**
 * Una persona vista de arriba: sombra, hombros con la remera (con luz de un
 * lado), cabeza con pelo. `up`: festeja con los brazos arriba.
 */
function person(ctx, rnd, x, y, shirt, up, scale = 1) {
  const s = scale;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(x + 2.5 * s, y + 3.5 * s, 7.5 * s, 5 * s, 0, 0, 7); ctx.fill();
  if (up) {
    ctx.strokeStyle = shirt;
    ctx.lineWidth = 3.2 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 5 * s, y); ctx.lineTo(x - 8.5 * s, y - 9 * s);
    ctx.moveTo(x + 5 * s, y); ctx.lineTo(x + 8.5 * s, y - 9 * s);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  ctx.fillStyle = shirt;
  ctx.beginPath(); ctx.ellipse(x, y + 1, 7.2 * s, 4.8 * s, 0, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath(); ctx.ellipse(x - 2 * s, y, 4 * s, 2.4 * s, 0, 0, 7); ctx.fill();
  const skin = pick(rnd, SKIN);
  if (up) {
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(x - 9 * s, y - 10 * s, 1.9 * s, 0, 7); ctx.arc(x + 9 * s, y - 10 * s, 1.9 * s, 0, 7); ctx.fill();
  }
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(x, y - 0.5 * s, 3.7 * s, 0, 7); ctx.fill();
  ctx.fillStyle = pick(rnd, HAIR);
  ctx.beginPath(); ctx.arc(x, y - 1.6 * s, 3.5 * s, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
  // Con nieve, gorro de lana; con lluvia, algunos abren el paraguas.
  if (LIVE.snow) {
    ctx.fillStyle = pick(rnd, [RED, BLUE, '#f1f1ec', '#3f5a3a']);
    ctx.beginPath(); ctx.arc(x, y - 1.2 * s, 3.9 * s, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#f1f1ec';
    ctx.beginPath(); ctx.arc(x, y - 4.8 * s, 1.4 * s, 0, 7); ctx.fill();
  } else if (LIVE.wet && !up && rnd() < 0.4) {
    const c = pick(rnd, ['#1f1f1f', RED, BLUE, '#3f5a3a', '#7a2f5e', '#c9a24a']);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(x + 3 * s, y + 3 * s, 10 * s, 0, 7); ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y - 1, 10 * s, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * 0.785; ctx.moveTo(x - Math.cos(a) * 10 * s, y - 1 - Math.sin(a) * 10 * s); ctx.lineTo(x + Math.cos(a) * 10 * s, y - 1 + Math.sin(a) * 10 * s); }
    ctx.stroke();
  }
}

/** La remera de un hincha: del equipo o de calle. */
function shirtFor(rnd, team) {
  const r = rnd();
  if (r < 0.62) return team === 'Red' ? RED : BLUE;
  if (r < 0.72) return '#f1f1ec';
  return pick(rnd, NEUTRAL);
}

/** Un bloque de gente (tribuna o montón): filas con algo de desorden. */
function crowd(ctx, rnd, x0, y0, x1, y1, o, gapX = 16, gapY = 15, density = 0.9) {
  if (REG) REG.crowds.push([x0, y0, x1, y1]);
  for (let y = y0; y <= y1; y += gapY) {
    const shift = (Math.round((y - y0) / gapY) % 2) * gapX * 0.5;
    for (let x = x0 + shift; x <= x1; x += gapX) {
      if (rnd() > density) continue;
      const px = x + (rnd() - 0.5) * gapX * 0.35;
      const py = y + (rnd() - 0.5) * 3;
      const team = px < 0 ? 'Red' : 'Blue';
      person(ctx, rnd, px, py, shirtFor(rnd, team), o.cheer === team && rnd() < 0.85);
    }
  }
}

/** Unos pocos sueltos, parados donde caigan dentro de una zona. */
function scatter(ctx, rnd, x0, y0, x1, y1, n, o) {
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
    const team = x < 0 ? 'Red' : 'Blue';
    person(ctx, rnd, x, y, shirtFor(rnd, team), o.cheer === team && rnd() < 0.7);
  }
}

/* ── Cosas ────────────────────────────────────────────────────────── */

function tree(ctx, rnd, x, y, r) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + r * 0.25, y + r * 0.3, r, r * 0.85, 0, 0, 7); ctx.fill();
  const tones = ['#1b3518', '#22421e', '#2b5326', '#346030'];
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.28, d = rnd() * r * 0.5;
    ctx.fillStyle = tones[i % 3];
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.45 + rnd() * 0.3), 0, 7); ctx.fill();
  }
  ctx.fillStyle = tones[3];
  ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, 7); ctx.fill();
}

/** Un poste de luz con su mancha en el piso. */
function lampPost(ctx, x, y, warm, reach = 170) {
  LIGHTS.push({ x, y, warm, reach });
  const c = warm ? '255,206,130' : '225,238,255';
  const g = ctx.createRadialGradient(x, y, 4, x, y, reach);
  g.addColorStop(0, `rgba(${c},0.30)`);
  g.addColorStop(0.5, `rgba(${c},0.10)`);
  g.addColorStop(1, `rgba(${c},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
  ctx.fillStyle = '#2b2e33';
  ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
  ctx.fillStyle = warm ? '#ffe3a8' : '#f4f9ff';
  ctx.fillRect(x - 11, y - 4, 22, 8);
}

/** Guirnalda de lamparitas entre dos puntos (cuelga un poco). */
function stringLights(ctx, x0, y0, x1, y1, sag, n, warm) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + sag;
  ctx.strokeStyle = 'rgba(30,30,30,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke();
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
    const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;
    ctx.fillStyle = warm ? 'rgba(255,210,120,0.25)' : 'rgba(220,240,255,0.25)';
    ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
    ctx.fillStyle = i % 3 === 0 ? '#ff9b6b' : (warm ? '#ffe2a0' : '#f2f8ff');
    ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill();
  }
}

/** Alambrado: línea con postes, sombra y la malla como una franja finita. */
function fence(ctx, x, y, w, h, alpha = 0.5) {
  ctx.save();
  ctx.strokeStyle = 'rgba(30,30,30,0.25)';
  ctx.lineWidth = 5;
  ctx.strokeRect(x + 2, y + 3, w, h);
  ctx.strokeStyle = `rgba(205,210,200,${alpha})`;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([2, 3]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = `rgba(205,210,200,${alpha * 0.45})`;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#9a9d95';
  const post = (px, py) => { ctx.beginPath(); ctx.arc(px, py, 2.8, 0, 7); ctx.fill(); };
  for (let i = 0; i <= w; i += 70) { post(x + i, y); post(x + i, y + h); }
  for (let j = 70; j < h; j += 70) { post(x, y + j); post(x + w, y + j); }
  ctx.restore();
}

/** Un trapo colgado (bandera de la hinchada) con texto o franjas. */
function trapo(ctx, x, y, w, h, kind, text, mirror) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 2, y + 3, w, h);
  if (kind === 'franjas-r' || kind === 'franjas-b') {
    const c = kind === 'franjas-r' ? RED : BLUE;
    const n = 6;
    for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? '#f4f1ea' : c; ctx.fillRect(x + (i * w) / n, y, w / n + 0.5, h); }
  } else {
    ctx.fillStyle = kind === 'azul' ? BLUE : kind === 'blanco' ? '#f4f1ea' : RED;
    ctx.fillRect(x, y, w, h);
  }
  if (text) paint(ctx, text, x + w / 2, y + h / 2 + 0.5, `900 ${Math.round(h * 0.62)}px sans-serif`, kind === 'blanco' ? RED : '#ffffff', mirror, w - 6);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath(); ctx.arc(x + 1.5, y + 1.5, 1.4, 0, 7); ctx.arc(x + w - 1.5, y + 1.5, 1.4, 0, 7); ctx.fill();
}

/** Bandera en un mástil, vista de arriba. */
function flagPole(ctx, x, y, color, color2) {
  if (REG) REG.flags.push({ x, y, color, color2 });
  if (LIVE.alive) return;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(x + 16, y + 6, 16, 5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, y - 2); ctx.quadraticCurveTo(x + 14, y - 7, x + 28, y - 2); ctx.lineTo(x + 28, y + 8); ctx.quadraticCurveTo(x + 14, y + 3, x, y + 8); ctx.fill();
  if (color2) { ctx.fillStyle = color2; ctx.fillRect(x + 9, y - 4, 9, 11); }
  ctx.fillStyle = '#ddd';
  ctx.beginPath(); ctx.arc(x, y + 3, 2.2, 0, 7); ctx.fill();
}

/** Un auto visto de arriba. `a`: ángulo. */
function car(ctx, x, y, a, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-21, -9, 46, 22);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-23, -11, 46, 22, 5); else ctx.rect(-23, -11, 46, 22);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(-20, -9, 40, 4);
  ctx.fillStyle = '#1c2633';
  ctx.fillRect(4, -8, 8, 16);
  ctx.fillRect(-15, -8, 6, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(5, -7, 3, 14);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(21, -9, 2, 4); ctx.fillRect(21, 5, 2, 4);
  ctx.restore();
}

function moto(ctx, x, y, a, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-9, -2, 20, 6);
  ctx.fillStyle = '#222';
  ctx.fillRect(-11, -1.5, 22, 3);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(-1, 0, 6, 3.5, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = '#999'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(8, -5); ctx.lineTo(8, 5); ctx.stroke();
  ctx.restore();
}

function bike(ctx, x, y, a) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.strokeStyle = '#2d2d2d'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.stroke();
  ctx.strokeStyle = '#c03b3b'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(5, 0); ctx.stroke();
  ctx.strokeStyle = '#888'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(7, -4); ctx.lineTo(7, 4); ctx.stroke();
  ctx.restore();
}

function dog(ctx, x, y) {
  if (REG) REG.dogs.push({ x, y });
  if (LIVE.alive) return;
  dogShape(ctx, x, y);
}

function dogShape(ctx, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + 2, 8, 4, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#8a5a2b';
  ctx.beginPath(); ctx.ellipse(x, y, 7, 3.6, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 7, y - 1, 3, 0, 7); ctx.fill();
  ctx.fillStyle = '#5c3a1a';
  ctx.beginPath(); ctx.arc(x + 8, y - 3.5, 1.4, 0, 7); ctx.fill();
  ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x - 11, y - 3); ctx.stroke();
}

/** Una pelota (la de los pibes que patean afuera). */
function ball(ctx, x, y, r = 4.5) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.arc(x + 1.5, y + 1.5, r, 0, 7); ctx.fill();
  ctx.fillStyle = '#f4f4f0';
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(x, y, r * 0.38, 0, 7); ctx.fill();
}

/** Arquito de potrero: dos piedras (o una mochila). */
function stones(ctx, x, y, dy) {
  for (const k of [-1, 1]) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x + 1.5, y + k * dy + 1.5, 5, 4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = k < 0 ? '#7d7a72' : '#3d5a8a';
    ctx.beginPath(); ctx.ellipse(x, y + k * dy, 5, 4, 0, 0, 7); ctx.fill();
  }
}

/** Banco de suplentes con techito transparente. */
function dugout(ctx, rnd, x, y, w, team, o) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 3, y + 4, w, 24);
  ctx.fillStyle = '#3b4049';
  ctx.fillRect(x, y, w, 24);
  for (let px = x + 10; px < x + w - 4; px += 15) person(ctx, rnd, px, y + 12, team === 'Red' ? RED : BLUE, o.cheer === team);
  ctx.fillStyle = 'rgba(160,200,230,0.35)';
  ctx.fillRect(x, y, w, 9);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, 24);
}

/** Mesa redonda de bar con sillas y gente. */
function table(ctx, rnd, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.arc(x + 2, y + 3, 10, 0, 7); ctx.fill();
  ctx.fillStyle = '#c9c4b8';
  ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill();
  ctx.fillStyle = '#b9332d';
  ctx.beginPath(); ctx.arc(x - 2, y - 1, 2, 0, 7); ctx.fill();
  ctx.fillStyle = '#d9a640';
  ctx.beginPath(); ctx.arc(x + 3, y + 2, 1.8, 0, 7); ctx.fill();
  for (let i = 0; i < 4; i++) {
    const a = i * 1.57 + 0.4;
    if (rnd() < 0.75) person(ctx, rnd, x + Math.cos(a) * 15, y + Math.sin(a) * 15, shirtFor(rnd, x < 0 ? 'Red' : 'Blue'), false, 0.85);
    else { ctx.fillStyle = '#4b4f57'; ctx.fillRect(x + Math.cos(a) * 15 - 4, y + Math.sin(a) * 15 - 4, 8, 8); }
  }
}

/** Fotógrafo con su lente apuntando a la cancha. */
function photographer(ctx, rnd, x, y, dir) {
  if (REG) REG.flashes.push({ x: dir > 0 ? x + 14 : x - 14, y });
  ctx.fillStyle = '#1f2329';
  ctx.fillRect(dir > 0 ? x + 5 : x - 14, y - 2, 9, 4);
  person(ctx, rnd, x, y, pick(rnd, ['#2b2b2b', '#3f5a3a', '#e8e2d0']), false, 0.85);
}

/** Techo de una casa con tanque de agua (vista de arriba). */
function roof(ctx, rnd, x, y, w, h, tone) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x + 5, y + 6, w, h);
  ctx.fillStyle = tone;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 4; i < w; i += 8) ctx.fillRect(x + i, y, 2, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  const tx = x + 8 + rnd() * (w - 24), ty = y + 6 + rnd() * (h - 20);
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath(); ctx.arc(tx + 7, ty + 7, 7, 0, 7); ctx.fill();
  ctx.fillStyle = '#3c3c3c';
  ctx.beginPath(); ctx.arc(tx + 6, ty + 6, 5, 0, 7); ctx.fill();
}

/* ── Carteles y texto ─────────────────────────────────────────────── */

/**
 * Un cartel LED. Fijo: el texto se repite a lo largo. En el gol dice ¡GOL!
 * en dorado. `mirror`: el juego lo va a dar vuelta, se escribe al revés.
 */
function led(ctx, x, y, w, h, text, hot, mirror, vertical) {
  if (REG) REG.leds.push({ x, y, w, h, text: hot ? (LIVE.scorer ? `¡GOL! · ${LIVE.scorer}   ` : '¡GOL!   ¡GOL!   ¡GOL!   ') : text, hot, vertical: !!vertical });
  ctx.save();
  // Vertical: el cartel ocupa de x a x+h y de y a y+w; se gira y se escribe a lo largo.
  if (vertical) { ctx.translate(x + h, y); ctx.rotate(Math.PI / 2); } else ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(2, 3, w, h);
  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#2a3242';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, 0, w, h);
  ctx.beginPath();
  ctx.rect(1, 1, w - 2, h - 2);
  ctx.clip();
  // Resplandor del panel y la grilla de puntitos: dan textura sin costar (es una vez).
  ctx.fillStyle = hot ? 'rgba(255,211,77,0.14)' : 'rgba(224,179,74,0.07)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 2; i < w; i += 3) ctx.fillRect(i, 1, 1, h - 2);
  const msg = hot ? (LIVE.scorer ? `¡GOL! · ${LIVE.scorer}   ` : '¡GOL!   ¡GOL!   ¡GOL!   ') : text;
  ctx.font = `700 ${Math.round(h * 0.66)}px monospace`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hot ? '#ffd34d' : '#f0c25a';
  // El espejo del juego da vuelta la X de la cancha: en un cartel acostado es
  // su largo; en uno parado, su ancho.
  if (mirror && !vertical) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  if (mirror && vertical) { ctx.translate(0, h); ctx.scale(1, -1); }
  const unit = ctx.measureText(msg).width || 1;
  for (let tx = 4; tx < w; tx += unit) ctx.fillText(msg, tx, h / 2 + 0.5);
  ctx.restore();
}

/** Texto suelto (paredón pintado, trapos), respetando el espejo. */
function paint(ctx, text, x, y, font, color, mirror, maxW) {
  ctx.save();
  ctx.translate(x, y);
  if (mirror) ctx.scale(-1, 1);
  ctx.font = font;
  // Un nombre largo no se sale del trapo: se achica para entrar.
  if (maxW) { const w = ctx.measureText(text).width; if (w > maxW) ctx.scale(maxW / w, maxW / w); }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/* ── Las cuatro ─────────────────────────────────────────────────────── */

/*
 * Lo que sale del partido, puesto por paintEnv antes de dibujar: el marcador
 * (los LED lo muestran), quién hizo el gol (en el festejo) y los nombres de
 * los que usan TL App en la sala (los trapos les dan aliento).
 */
const LIVE = { score: '', scorer: '', names: [], wet: false, snow: false, night: false };
/** Las luces de la escena (las anota lampPost): de noche son las que alumbran. */
const LIGHTS = [];
/**
 * Lo que la capa viva necesita saber del dibujo quieto: dónde quedaron los LED
 * (para correr el texto), los bloques de gente (para que algunos se paren) y
 * Fresa. Lo llena paintEnv y lo devuelve.
 */
let REG = null;

/** El texto de un LED con el resultado metido en el medio, si hay partido. */
function ledText(base) {
  return LIVE.score ? `  ${LIVE.score}  ·${base}` : base;
}

/** «FUERZA MATI» para el trapo número `i`, o el texto de siempre. */
function cheerName(i, fallback) {
  const n = LIVE.names[i];
  return n ? `FUERZA ${n}` : fallback;
}

const ROOFS = ['#5a4b42', '#6e5a4a', '#4d5560', '#6a3e35', '#7a6a58'];
const CARS = ['#a33a33', '#2c4f8a', '#d9d6cf', '#3c3c3c', '#7a8a4a', '#c9a24a'];

function potreroNoche(ctx, W, H, o) {
  const rnd = seeded(11);
  const gap = goalGap(H);
  ground(ctx, rnd, W, H, '#3d3326', ['rgba(70,58,42,0.6)', 'rgba(52,44,33,0.6)', 'rgba(70,90,52,0.35)'], ['rgba(255,240,210,0.06)', 'rgba(0,0,0,0.12)']);
  tufts(ctx, rnd, W, H, 160);
  puddle(ctx, -W * 0.55, -H - 30, 26, 9);
  puddle(ctx, W * 0.35, H + 34, 20, 7);
  // Atrás de todo: los techos del barrio.
  for (let x = -W - 220; x < W + 220; x += 70 + rnd() * 30) roof(ctx, rnd, x, -H - 175, 60 + rnd() * 25, 55, pick(rnd, ROOFS));
  for (let x = -W - 220; x < W + 220; x += 70 + rnd() * 30) roof(ctx, rnd, x, H + 120, 60 + rnd() * 25, 55, pick(rnd, ROOFS));
  // Paredón con un LED y pintadas.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-176, -H - 84, 360, 32);
  ctx.fillStyle = '#4a4843';
  ctx.fillRect(-180, -H - 88, 360, 32);
  paint(ctx, 'TL', -158, -H - 72, '900 18px sans-serif', RED, o.mirror);
  paint(ctx, 'LECCE', 156, -H - 72, 'italic 900 11px sans-serif', '#6b93ea', o.mirror);
  led(ctx, -130, -H - 82, 260, 20, ledText('  TODA LA LECCE  ·'), o.hot, o.mirror);
  // La hinchada parada contra el alambrado.
  crowd(ctx, rnd, -W + 10, -H - 50, -195, -H - 28, o, 15, 11, 0.82);
  crowd(ctx, rnd, 195, -H - 50, W - 10, -H - 28, o, 15, 11, 0.82);
  crowd(ctx, rnd, -W + 10, H + 28, W - 10, H + 62, o, 15, 11, 0.75);
  // Los fondos: los pibes con su pelota, motos, bici y el perro.
  for (const sx of [-1, 1]) {
    const x = sx * (W + 70);
    stones(ctx, x + sx * 40, -gap - 60, 14);
    scatter(ctx, rnd, x - 25, -H - 10, x + 25, -gap - 20, 4, o);
    if (REG) REG.kids.push({ x: x + sx * 10, y: -gap - 40, sx });
    if (!LIVE.alive) ball(ctx, x + sx * 10, -gap - 40);
    moto(ctx, x + sx * 30, gap + 40, 1.4, pick(rnd, ['#b23a3a', '#2a2a2a', '#3d6ad6']));
    moto(ctx, x + sx * 48, gap + 46, 1.5, pick(rnd, ['#c9a24a', '#2a2a2a']));
    bike(ctx, x, gap + 80, 0.3 * sx);
    scatter(ctx, rnd, x - 30, gap + 10, x + 30, H + 20, 5, o);
  }
  dog(ctx, -W - 40, H + 12);
  fence(ctx, -W - 22, -H - 20, 2 * W + 44, 2 * H + 40, 0.55);
  // Trapos colgados del alambrado.
  trapo(ctx, -W + 30, -H - 26, 80, 14, 'rojo', cheerName(1, 'TL'), o.mirror);
  trapo(ctx, -W + 130, -H - 26, 64, 14, 'franjas-r', '', o.mirror);
  trapo(ctx, W - 194, -H - 26, 64, 14, 'franjas-b', '', o.mirror);
  trapo(ctx, W - 110, -H - 26, 80, 14, 'azul', cheerName(2, 'LECCE'), o.mirror);
  trapo(ctx, -60, H + 14, 120, 14, 'blanco', cheerName(0, 'TODA LA LECCE'), o.mirror);
  // Luces: postes en las esquinas y guirnaldas.
  stringLights(ctx, -W - 50, -H - 50, -10, -H - 54, 10, 14, true);
  stringLights(ctx, 10, -H - 54, W + 50, -H - 50, 10, 14, true);
  stringLights(ctx, -W - 50, H + 66, W + 50, H + 66, 14, 28, true);
  for (const [x, y] of [[-W - 50, -H - 50], [W + 50, -H - 50], [-W - 50, H + 66], [W + 50, H + 66]]) lampPost(ctx, x, y, true, 190);
  tree(ctx, rnd, -W - 130, -H - 40, 40); tree(ctx, rnd, W + 135, -H - 30, 44);
  tree(ctx, rnd, -W - 140, H + 50, 46); tree(ctx, rnd, W + 130, H + 60, 40);
}

function clubBarrio(ctx, W, H, o) {
  const rnd = seeded(23);
  const gap = goalGap(H);
  ground(ctx, rnd, W, H, '#5d6158', ['rgba(80,84,76,0.55)', 'rgba(70,74,66,0.5)'], ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.1)']);
  // Vereda de baldosas alrededor del alambrado.
  ctx.fillStyle = '#8a8679';
  ctx.fillRect(-W - 60, -H - 22, 2 * W + 120, 2 * H + 44);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -W - 60; x < W + 60; x += 12) { ctx.moveTo(x, -H - 22); ctx.lineTo(x, H + 22); }
  for (let y = -H - 22; y < H + 22; y += 12) { ctx.moveTo(-W - 60, y); ctx.lineTo(W + 60, y); }
  ctx.stroke();
  // Tribunita de cemento arriba, llena.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-W + 24, -H - 100, 2 * W - 40, 84);
  for (let k = 0; k < 5; k++) {
    ctx.fillStyle = k % 2 ? '#7d7c77' : '#8c8b86';
    ctx.fillRect(-W + 20, -H - 104 + k * 16, 2 * W - 40, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-W + 20, -H - 104 + k * 16 + 14, 2 * W - 40, 2);
  }
  for (const x of [-W * 0.5, 0, W * 0.5]) { ctx.fillStyle = '#9a9994'; ctx.fillRect(x - 7, -H - 104, 14, 80); }
  crowd(ctx, rnd, -W + 30, -H - 98, -W * 0.5 - 12, -H - 34, o, 14, 16, 0.94);
  crowd(ctx, rnd, -W * 0.5 + 12, -H - 98, -12, -H - 34, o, 14, 16, 0.94);
  crowd(ctx, rnd, 12, -H - 98, W * 0.5 - 12, -H - 34, o, 14, 16, 0.94);
  crowd(ctx, rnd, W * 0.5 + 12, -H - 98, W - 30, -H - 34, o, 14, 16, 0.94);
  // Banderas en los mástiles arriba de la tribuna.
  for (let i = 0; i < 6; i++) flagPole(ctx, -W + 40 + i * ((2 * W - 80) / 5), -H - 112, i % 2 ? BLUE : RED, i % 3 === 0 ? '#f4f1ea' : null);
  // Abajo: bancos de suplentes, paredón pintado y el LED.
  dugout(ctx, rnd, -150, H + 26, 110, 'Red', o);
  dugout(ctx, rnd, 40, H + 26, 110, 'Blue', o);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-W - 56, H + 62, 2 * W + 120, 34);
  ctx.fillStyle = '#d8d0bd';
  ctx.fillRect(-W - 60, H + 58, 2 * W + 120, 34);
  for (let i = 0; i * 30 < 2 * W + 120; i++) { ctx.fillStyle = i % 2 ? RED : BLUE; ctx.fillRect(-W - 60 + i * 30, H + 58, 30, 5); }
  paint(ctx, 'TL', -W + 2, H + 77, '900 22px sans-serif', '#b23a3a', o.mirror);
  paint(ctx, 'CLUB SOCIAL Y DEPORTIVO TODA LA LECCE', -W * 0.42, H + 77, '800 12px sans-serif', '#333', o.mirror);
  led(ctx, W * 0.18, H + 64, W * 0.7, 20, ledText('  SOCIOS AL DÍA  ·  CUOTA EN EL BUFFET  ·'), o.hot, o.mirror);
  // Costados: el buffet con mesas, autos estacionados y gente.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-W - 155, -56, 70, 120);
  ctx.fillStyle = '#6a3e35';
  ctx.fillRect(-W - 160, -60, 70, 120);
  ctx.fillStyle = '#e8ddc8';
  ctx.fillRect(-W - 92, -60, 6, 120);
  paint(ctx, 'BUFFET', -W - 125, 0, '900 12px sans-serif', '#f4e7c8', o.mirror);
  if (REG) { REG.smoke.push({ x: -W - 140, y: -50 }); REG.walkers.push({ x0: -140, x1: -50, y: H + 56 }); REG.walkers.push({ x0: 50, x1: 140, y: H + 56 }); }
  table(ctx, rnd, -W - 60, -gap - 30); table(ctx, rnd, -W - 60, gap + 30); table(ctx, rnd, -W - 110, -gap - 70);
  for (let i = 0; i < 4; i++) car(ctx, W + 110, -120 + i * 70, Math.PI / 2, pick(rnd, CARS));
  scatter(ctx, rnd, W + 40, -H, W + 75, -gap - 10, 4, o);
  scatter(ctx, rnd, W + 40, gap + 10, W + 75, H, 4, o);
  fence(ctx, -W - 20, -H - 20, 2 * W + 40, 2 * H + 40, 0.5);
  trapo(ctx, -W + 60, -H - 24, 90, 13, 'franjas-r', '', o.mirror);
  trapo(ctx, W - 150, -H - 24, 90, 13, 'franjas-b', '', o.mirror);
  trapo(ctx, -50, -H - 24, 100, 13, 'blanco', cheerName(0, 'TODA LA LECCE'), o.mirror);
  for (const [x, y] of [[-W - 40, -H - 40], [W + 40, -H - 40], [-W - 40, H + 40], [W + 40, H + 40]]) lampPost(ctx, x, y, true, 160);
  tree(ctx, rnd, -W - 140, -H - 60, 44); tree(ctx, rnd, -W - 140, H + 70, 48);
  tree(ctx, rnd, W + 170, -H - 50, 40); tree(ctx, rnd, W + 175, H + 60, 44);
}

function potreroLed(ctx, W, H, o) {
  const rnd = seeded(37);
  const gap = goalGap(H);
  ground(ctx, rnd, W, H, '#35392f', ['rgba(60,66,52,0.6)', 'rgba(44,48,38,0.6)'], ['rgba(255,255,255,0.04)', 'rgba(0,0,0,0.12)']);
  // Pasto que sobra alrededor de la cancha.
  ctx.fillStyle = 'rgba(70,110,60,0.55)';
  ctx.fillRect(-W - 46, -H - 46, 2 * W + 92, 2 * H + 92);
  // Tribunas en los cuatro lados, llenas.
  ctx.fillStyle = '#4a4f57';
  ctx.fillRect(-W - 60, -H - 100, 2 * W + 120, 48);
  ctx.fillRect(-W - 60, H + 52, 2 * W + 120, 48);
  crowd(ctx, rnd, -W - 40, -H - 94, W + 40, -H - 58, o, 14, 12, 0.93);
  crowd(ctx, rnd, -W - 40, H + 58, W + 40, H + 96, o, 14, 12, 0.93);
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -W - 150 : W + 62, x1 = sx < 0 ? -W - 62 : W + 150;
    ctx.fillStyle = '#4a4f57';
    ctx.fillRect(x0 - 8, -H - 46, x1 - x0 + 16, H + 46 - gap - 22);
    ctx.fillRect(x0 - 8, gap + 22, x1 - x0 + 16, H + 46 - gap - 22);
    crowd(ctx, rnd, x0, -H - 40, x1, -gap - 30, o, 14, 13, 0.9);
    crowd(ctx, rnd, x0, gap + 30, x1, H + 40, o, 14, 13, 0.9);
  }
  fence(ctx, -W - 48, -H - 48, 2 * W + 96, 2 * H + 96, 0.45);
  // LED al ras del pasto en los cuatro lados (en los fondos, sin tapar el arco).
  led(ctx, -W, -H - 32, 2 * W, 20, ledText('  TODA LA LECCE  ·  TL APP  ·'), o.hot, o.mirror);
  led(ctx, -W, H + 12, 2 * W, 20, '  TL APP  ·  TODA LA LECCE  ·', o.hot, o.mirror);
  for (const sx of [-1, 1]) {
    const x = sx < 0 ? -W - 36 : W + 16;
    led(ctx, x, -H, H - gap - 6, 20, '  TODA LA LECCE  ·', o.hot, o.mirror, true);
    led(ctx, x, gap + 6, H - gap - 6, 20, '  TL APP  ·', o.hot, o.mirror, true);
  }
  // Fotógrafos y alcanzapelotas detrás de los LED de abajo, y los bancos.
  for (let k = 0; k < 4; k++) photographer(ctx, rnd, -W + 30 + k * 26, H + 42, 1);
  for (let k = 0; k < 4; k++) photographer(ctx, rnd, W - 30 - k * 26, H + 42, -1);
  for (const [x, y] of [[-W - 8, -H - 40], [W + 8, -H - 40], [-W - 8, H + 40], [W + 8, H + 40]]) {
    if (REG) REG.walkers.push({ x0: x - 40, x1: x + 40, y, shirt: '#f0c25a' });
    if (!LIVE.alive) person(ctx, rnd, x, y, '#f0c25a', false, 0.9);
  }
  dugout(ctx, rnd, -130, H + 34, 110, 'Red', o);
  dugout(ctx, rnd, 20, H + 34, 110, 'Blue', o);
  // Torres de luz en las esquinas.
  for (const [x, y] of [[-W - 110, -H - 100], [W + 110, -H - 100], [-W - 110, H + 100], [W + 110, H + 100]]) lampPost(ctx, x, y, false, 200);
}

function canchitaF5(ctx, W, H, o) {
  const rnd = seeded(53);
  const gap = goalGap(H);
  ground(ctx, rnd, W, H, '#2a2e35', ['rgba(40,44,52,0.6)', 'rgba(34,38,45,0.6)'], ['rgba(255,255,255,0.03)', 'rgba(0,0,0,0.12)']);
  // Sintético alrededor, con las franjas del corte.
  ctx.fillStyle = '#23663b';
  ctx.fillRect(-W - 44, -H - 44, 2 * W + 88, 2 * H + 88);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = -W - 44; x < W + 44; x += 24) ctx.fillRect(x, -H - 44, 12, 2 * H + 88);
  // Pasillos de cemento.
  ctx.fillStyle = '#4a4f57';
  ctx.fillRect(-W - 120, H + 50, 2 * W + 240, 60);
  ctx.fillRect(-W - 120, -H - 110, 2 * W + 240, 60);
  // Arriba: vestuarios y buffet; en el pasillo, las mesas.
  ctx.fillStyle = '#3a3f48';
  ctx.fillRect(-W - 120, -H - 175, 2 * W + 240, 66);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? '#454b55' : '#40464f';
    ctx.fillRect(-W - 110 + i * ((2 * W + 220) / 10), -H - 170, (2 * W + 220) / 10 - 6, 56);
  }
  paint(ctx, 'VESTUARIOS', -W * 0.5, -H - 140, '800 12px sans-serif', '#c9ced6', o.mirror);
  paint(ctx, 'BUFFET · TL', W * 0.5, -H - 140, '800 12px sans-serif', '#f0c25a', o.mirror);
  for (let i = 0; i < 6; i++) table(ctx, rnd, -W + 30 + i * ((2 * W - 60) / 5), -H - 80);
  // Abajo: bancos, gente esperando y el estacionamiento.
  dugout(ctx, rnd, -150, H + 58, 120, 'Red', o);
  dugout(ctx, rnd, 30, H + 58, 120, 'Blue', o);
  crowd(ctx, rnd, -W + 10, H + 64, -170, H + 100, o, 15, 14, 0.72);
  crowd(ctx, rnd, 170, H + 64, W - 10, H + 100, o, 15, 14, 0.72);
  for (let i = 0; i < 9; i++) car(ctx, -W - 40 + i * ((2 * W + 80) / 8), H + 140, 0, pick(rnd, CARS));
  // Costados: la canchita de al lado (se ve un pedazo) y la gente esperando turno.
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -W - 330 : W + 120;
    ctx.fillStyle = '#23663b';
    ctx.fillRect(x0, -H, 210, 2 * H);
    ctx.strokeStyle = 'rgba(240,248,240,0.75)'; ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 10, -H + 10, 190, 2 * H - 20);
    ctx.beginPath(); ctx.moveTo(x0 + 10, 0); ctx.lineTo(x0 + 200, 0); ctx.stroke();
    scatter(ctx, rnd, sx < 0 ? -W - 110 : W + 60, -H + 20, sx < 0 ? -W - 60 : W + 110, -gap - 20, 5, o);
    scatter(ctx, rnd, sx < 0 ? -W - 110 : W + 60, gap + 20, sx < 0 ? -W - 60 : W + 110, H - 20, 5, o);
    if (REG) REG.pitches.push({ x: x0 + 10, y: -H + 10, w: 190, h: 2 * H - 20 });
    if (!LIVE.alive) ball(ctx, sx * (W + 80), 0);
  }
  // LED en las bandas.
  led(ctx, -W, -H - 32, 2 * W, 20, ledText('  TL APP  ·  TODA LA LECCE  ·  F5 LOS MARTES  ·'), o.hot, o.mirror);
  led(ctx, -W, H + 12, 2 * W, 20, '  TODA LA LECCE  ·  TL APP  ·  RESERVÁ TU TURNO  ·', o.hot, o.mirror);
  // Red alta alrededor (con hueco en la boca de los arcos).
  const net = (x, y, w, h) => {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = 'rgba(235,240,245,0.38)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = x; i <= x + w; i += 6) { ctx.moveTo(i, y); ctx.lineTo(i, y + h); }
    for (let j = y; j <= y + h; j += 6) { ctx.moveTo(x, j); ctx.lineTo(x + w, j); }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  };
  net(-W - 40, -H - 46, 2 * W + 80, 10);
  net(-W - 40, H + 36, 2 * W + 80, 10);
  for (const x of [-W - 50, W + 40]) { net(x, -H - 46, 10, H + 46 - gap); net(x, gap, 10, H + 46 - gap); }
  // Luces LED blancas, de un lado al otro.
  for (const x of [-W * 0.66, -W * 0.22, W * 0.22, W * 0.66]) {
    for (const y of [-H - 50, H + 50]) lampPost(ctx, x, y, false, 150);
  }
}

/* ── Playa ──────────────────────────────────────────────────────────── */

function umbrella(ctx, x, y, r, colors) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.arc(x + r * 0.35, y + r * 0.45, r, 0, 7); ctx.fill();
  const n = colors.length * 2;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, (i / n) * 6.283, ((i + 1) / n) * 6.283); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, 7); ctx.fill();
  ctx.fillStyle = '#eee';
  ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill();
}

function towel(ctx, rnd, x, y, a) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  const c = pick(rnd, [RED, BLUE, '#f0c25a', '#3aa37a', '#e86fa0']);
  ctx.fillStyle = c; ctx.fillRect(-9, -16, 18, 32);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = -16; i < 16; i += 8) ctx.fillRect(-9, i, 18, 3);
  ctx.restore();
}

function lounger(ctx, rnd, x, y, a) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-6, -15, 15, 34);
  ctx.fillStyle = '#e9e4d8'; ctx.fillRect(-8, -17, 16, 34);
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
  for (let i = -13; i < 17; i += 5) { ctx.beginPath(); ctx.moveTo(-8, i); ctx.lineTo(8, i); ctx.stroke(); }
  ctx.restore();
  if (rnd() < 0.7) person(ctx, rnd, x, y - 6, pick(rnd, ['#e86fa0', '#3aa37a', '#f0c25a', RED, BLUE]), false, 0.9);
}

function playa(ctx, W, H, o) {
  const rnd = seeded(71);
  const gap = goalGap(H);
  ground(ctx, rnd, W, H, '#dcc48e', ['rgba(200,176,124,0.7)', 'rgba(232,212,160,0.7)'], ['rgba(140,110,60,0.18)', 'rgba(255,255,255,0.25)']);
  // El mar arriba: agua, olas y espuma.
  const sea = -H - 92;
  ctx.fillStyle = '#2f7fa8';
  ctx.fillRect(-W - 800, sea - 600, 2 * W + 1600, 600);
  ctx.fillStyle = '#3a93bd';
  ctx.fillRect(-W - 800, sea - 60, 2 * W + 1600, 60);
  ctx.fillStyle = 'rgba(126,198,214,0.9)';
  ctx.fillRect(-W - 800, sea - 18, 2 * W + 1600, 18);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = -W - 800; x < W + 800; x += 30) { ctx.moveTo(x, sea); ctx.quadraticCurveTo(x + 15, sea + 6, x + 30, sea); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
  for (let k = 1; k < 5; k++) {
    ctx.beginPath();
    for (let x = -W - 800 + k * 13; x < W + 800; x += 46) { ctx.moveTo(x, sea - 22 - k * 24); ctx.quadraticCurveTo(x + 12, sea - 18 - k * 24, x + 24, sea - 22 - k * 24); }
    ctx.stroke();
  }
  // Arena mojada pegada al agua.
  ctx.fillStyle = 'rgba(160,130,80,0.35)';
  ctx.fillRect(-W - 800, sea, 2 * W + 1600, 14);
  // Soga con banderines en lugar de alambrado.
  ctx.strokeStyle = 'rgba(80,60,30,0.7)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(-W - 20, -H - 18, 2 * W + 40, 2 * H + 36);
  for (let x = -W - 20; x <= W + 20; x += 18) {
    for (const y of [-H - 18, H + 18]) {
      ctx.fillStyle = (Math.round(x / 18) % 2) ? RED : BLUE;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 9, y); ctx.lineTo(x + 4.5, y + 7); ctx.fill();
    }
  }
  // Gente sentada mirando, sombrillas, lonas y reposeras.
  crowd(ctx, rnd, -W, -H - 52, W, -H - 30, o, 17, 12, 0.7);
  crowd(ctx, rnd, -W, H + 30, W, H + 52, o, 17, 12, 0.72);
  for (let x = -W - 40; x < W + 60; x += 95 + rnd() * 40) umbrella(ctx, x, H + 82 + rnd() * 20, 20, rnd() < 0.5 ? [RED, '#f4f1ea'] : [BLUE, '#f0c25a']);
  for (let x = -W; x < W; x += 70 + rnd() * 50) towel(ctx, rnd, x, H + 120 + rnd() * 30, (rnd() - 0.5) * 0.6);
  for (const sx of [-1, 1]) {
    const x = sx * (W + 70);
    umbrella(ctx, x, -gap - 50, 22, [RED, '#f4f1ea']);
    lounger(ctx, rnd, x - 22, -gap - 20, 0.1);
    lounger(ctx, rnd, x + 22, -gap - 22, -0.1);
    umbrella(ctx, x, gap + 60, 22, [BLUE, '#f4f1ea']);
    lounger(ctx, rnd, x - 22, gap + 90, 0.15);
    lounger(ctx, rnd, x + 22, gap + 92, -0.05);
    scatter(ctx, rnd, x - 30, -40, x + 30, 40, 4, o);
  }
  // Carrito de helados y la red de vóley.
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(W + 32, H + 64, 50, 26);
  ctx.fillStyle = '#f4f1ea'; ctx.fillRect(W + 28, H + 60, 50, 26);
  ctx.fillStyle = '#e86fa0'; ctx.fillRect(W + 28, H + 60, 50, 7);
  paint(ctx, 'HELADOS', W + 53, H + 77, '900 9px sans-serif', '#c43d7a', o.mirror);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-W - 150, H + 70); ctx.lineTo(-W - 150, H + 160); ctx.stroke();
  scatter(ctx, rnd, -W - 190, H + 80, -W - 165, H + 150, 2, o);
  scatter(ctx, rnd, -W - 135, H + 80, -W - 110, H + 150, 2, o);
  if (REG) REG.volley = { x: -W - 150, y: H + 115 };
  if (REG) REG.sea = sea;
  if (!LIVE.alive) ball(ctx, -W - 172, H + 100, 5);
  if (REG) REG.gulls = { y: -H - 160, x0: -W - 500, x1: W + 500 };
  led(ctx, -170, -H - 80, 340, 20, ledText('  TL BEACH  ·  TODA LA LECCE  ·'), o.hot, o.mirror);
  trapo(ctx, -W + 20, H + 12, 90, 14, 'franjas-r', '', o.mirror);
  trapo(ctx, -45, H + 12, 90, 14, 'blanco', cheerName(0, 'TODA LA LECCE'), o.mirror);
  trapo(ctx, W - 110, H + 12, 90, 14, 'franjas-b', '', o.mirror);
}

/* ── Campito ────────────────────────────────────────────────────────── */

function cow(ctx, rnd, x, y, a) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(4, 5, 20, 11, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#f1efe9';
  ctx.beginPath(); ctx.ellipse(0, 0, 19, 10, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#1e1e1e';
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(-10 + rnd() * 18, -5 + rnd() * 10, 3 + rnd() * 4, 2 + rnd() * 3, rnd() * 3, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#e9d9c8';
  ctx.beginPath(); ctx.ellipse(21, 0, 6, 5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#d8c6b0';
  ctx.beginPath(); ctx.arc(19, -6, 2, 0, 7); ctx.arc(19, 6, 2, 0, 7); ctx.fill();
  ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-19, 0); ctx.lineTo(-25, 3); ctx.stroke();
  ctx.restore();
}

function millBlades(ctx, x, y, turn) {
  ctx.fillStyle = '#b9bcbf';
  for (let i = 0; i < 12; i++) {
    ctx.save(); ctx.translate(x, y); ctx.rotate((i / 12) * 6.283 + turn);
    ctx.fillRect(4, -2, 20, 4);
    ctx.restore();
  }
  ctx.fillStyle = '#555';
  ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
}

function windmill(ctx, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + 30, y + 14, 34, 10, 0.35, 0, 7); ctx.fill();
  ctx.strokeStyle = '#7d7f80'; ctx.lineWidth = 2;
  for (const [dx, dy] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) { ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(x, y); ctx.stroke(); }
  if (REG) REG.mill = { x, y };
  if (!LIVE.alive) millBlades(ctx, x, y, 0);
  // El tanque australiano al lado.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.arc(x + 48, y + 30, 26, 0, 7); ctx.fill();
  ctx.fillStyle = '#9aa0a3';
  ctx.beginPath(); ctx.arc(x + 44, y + 26, 26, 0, 7); ctx.fill();
  ctx.fillStyle = '#4f7fa0';
  ctx.beginPath(); ctx.arc(x + 44, y + 26, 22, 0, 7); ctx.fill();
}

function pickup(ctx, x, y, a, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-25, -10, 56, 24);
  ctx.fillStyle = color; ctx.fillRect(-28, -12, 56, 24);
  ctx.fillStyle = '#1c2633'; ctx.fillRect(6, -10, 8, 20);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-26, -10, 26, 20);
  ctx.fillStyle = '#7a5a30'; ctx.fillRect(-23, -6, 9, 7);
  ctx.restore();
}

function grill(ctx, rnd, x, y, o) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 24, y - 10, 52, 26);
  ctx.fillStyle = '#5a5552'; ctx.fillRect(x - 27, y - 13, 52, 26);
  ctx.fillStyle = '#2a2523'; ctx.fillRect(x - 24, y - 10, 46, 20);
  ctx.fillStyle = '#ff7b2e';
  for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(x - 20 + rnd() * 40, y - 7 + rnd() * 14, 1.6, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#8a3a22';
  for (let i = 0; i < 5; i++) ctx.fillRect(x - 20 + i * 9, y - 6, 7, 12);
  if (REG) REG.smoke.push({ x: x + 10, y: y - 18 });
  if (!LIVE.alive) {
    ctx.fillStyle = 'rgba(220,220,220,0.18)';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + 10 + i * 9, y - 18 - i * 7, 8 + i * 2.5, 0, 7); ctx.fill(); }
  }
  for (let k = 0; k < 5; k++) { const a = 0.8 + k * 0.45; person(ctx, rnd, x + Math.cos(a) * 42, y + Math.sin(a) * 32, shirtFor(rnd, x < 0 ? 'Red' : 'Blue'), false); }
}

function hay(ctx, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.arc(x + 4, y + 5, 14, 0, 7); ctx.fill();
  ctx.fillStyle = '#c9a24a';
  ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(120,90,30,0.6)'; ctx.lineWidth = 1.2;
  for (let r = 4; r < 14; r += 4) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); }
}

function campo(ctx, W, H, o) {
  const rnd = seeded(89);
  const gap = goalGap(H);
  ground(ctx, rnd, W, H, '#6f8a45', ['rgba(110,140,70,0.7)', 'rgba(95,120,58,0.7)', 'rgba(150,130,80,0.5)'], ['rgba(40,60,20,0.18)', 'rgba(220,220,140,0.12)']);
  tufts(ctx, rnd, W, H, 220);
  // Camino de tierra abajo.
  ctx.fillStyle = '#a2865a';
  ctx.fillRect(-W - 800, H + 96, 2 * W + 1600, 34);
  ctx.fillStyle = 'rgba(80,60,30,0.25)';
  ctx.fillRect(-W - 800, H + 104, 2 * W + 1600, 4); ctx.fillRect(-W - 800, H + 118, 2 * W + 1600, 4);
  // Alambrado de campo: postes de madera e hilos.
  const posts = (x0, y0, x1, y1) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 40));
    ctx.strokeStyle = 'rgba(200,200,200,0.55)'; ctx.lineWidth = 1;
    for (const d of [-1.5, 1.5]) { ctx.beginPath(); ctx.moveTo(x0, y0 + d); ctx.lineTo(x1, y1 + d); ctx.stroke(); }
    ctx.fillStyle = '#6b4a2b';
    for (let i = 0; i <= n; i++) { const t = i / n; ctx.fillRect(x0 + (x1 - x0) * t - 2.5, y0 + (y1 - y0) * t - 2.5, 5, 5); }
  };
  posts(-W - 30, -H - 22, W + 30, -H - 22);
  posts(-W - 30, H + 22, -40, H + 22); posts(40, H + 22, W + 30, H + 22);
  // La tranquera en el medio, abierta.
  ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-40, H + 22); ctx.lineTo(-40, H + 58); ctx.stroke();
  // Vacas pastando arriba, del otro lado del alambre.
  for (let i = 0; i < 6; i++) {
    const cx = -W + 40 + i * ((2 * W - 80) / 5) + (rnd() - 0.5) * 40, cy = -H - 60 - rnd() * 40, ca = (rnd() - 0.5) * 2.4;
    if (REG) REG.cows.push({ x: cx, y: cy, a: ca, seed: i + 1 });
    if (!LIVE.alive) cow(ctx, rnd, cx, cy, ca);
  }
  // Molino y tanque, el asado, la camioneta, fardos.
  windmill(ctx, W + 110, -H - 50);
  grill(ctx, rnd, -W - 110, H - 10, o);
  pickup(ctx, -W - 100, -40, 1.4, '#b23a3a');
  pickup(ctx, W + 120, H + 60, 0.1, '#e6e2d8');
  hay(ctx, W + 70, gap + 40); hay(ctx, W + 92, gap + 58); hay(ctx, W + 68, gap + 70);
  // Gente mirando contra el alambre de abajo, con sillas y mate.
  crowd(ctx, rnd, -W + 20, H + 34, -60, H + 60, o, 18, 13, 0.7);
  crowd(ctx, rnd, 60, H + 34, W - 20, H + 60, o, 18, 13, 0.7);
  dog(ctx, -50, H + 70);
  for (const [x, y] of [[-W - 180, -H - 60], [-W - 160, H + 70], [W + 190, H - 20], [W + 200, -H - 140], [-W - 60, -H - 150], [60, -H - 160]]) tree(ctx, rnd, x, y, 40 + rnd() * 14);
  trapo(ctx, -W + 40, -H - 30, 90, 14, 'blanco', cheerName(0, 'LA LECCE'), o.mirror);
  trapo(ctx, W - 130, -H - 30, 90, 14, 'rojo', cheerName(1, 'TL'), o.mirror);
}

/* ── Azotea ─────────────────────────────────────────────────────────── */

function acUnit(ctx, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 3, y + 4, 26, 18);
  ctx.fillStyle = '#c8ccd2'; ctx.fillRect(x, y, 26, 18);
  ctx.fillStyle = '#8f959d';
  ctx.beginPath(); ctx.arc(x + 9, y + 9, 6, 0, 7); ctx.fill();
  ctx.strokeStyle = '#6d737b'; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 17, y + 3 + i * 4); ctx.lineTo(x + 24, y + 3 + i * 4); ctx.stroke(); }
}

function plant(ctx, rnd, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(x + 2, y + 3, 9, 0, 7); ctx.fill();
  ctx.fillStyle = '#a0522d'; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill();
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#2f6b2a' : '#3d8a35'; ctx.beginPath(); ctx.arc(x + (rnd() - 0.5) * 10, y + (rnd() - 0.5) * 10, 4 + rnd() * 3, 0, 7); ctx.fill(); }
}

/** Un edificio vecino, más abajo: techo oscuro y ventanas prendidas en el borde. */
function building(ctx, rnd, x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x + 10, y + 12, w, h);
  ctx.fillStyle = pick(rnd, ['#2c3038', '#33373f', '#2a2d33', '#3a3530']);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
  for (let i = x + 6; i < x + w - 6; i += 10) {
    for (const yy of [y + 3, y + h - 6]) {
      ctx.fillStyle = rnd() < 0.45 ? 'rgba(255,214,140,0.85)' : 'rgba(80,90,110,0.6)'; ctx.fillRect(i, yy, 5, 3);
      if (REG && REG.windows.length < 400) REG.windows.push([i, yy]);
    }
  }
  if (rnd() < 0.6) { ctx.fillStyle = '#444'; ctx.beginPath(); ctx.arc(x + w * 0.7, y + h * 0.4, 7, 0, 7); ctx.fill(); }
  if (rnd() < 0.4) { ctx.strokeStyle = '#777'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + w * 0.3, y + h * 0.5); ctx.lineTo(x + w * 0.3 + 14, y + h * 0.5 - 10); ctx.stroke(); }
}

function azotea(ctx, W, H, o) {
  const rnd = seeded(97);
  const gap = goalGap(H);
  // La ciudad abajo, de noche.
  ctx.fillStyle = '#14171d';
  ctx.fillRect(-W - 900, -H - 700, 2 * W + 1800, 2 * H + 1400);
  for (let i = 0; i < 1400; i++) { ctx.fillStyle = rnd() < 0.7 ? 'rgba(255,200,120,0.5)' : 'rgba(180,210,255,0.4)'; ctx.fillRect(-W - 900 + rnd() * (2 * W + 1800), -H - 700 + rnd() * (2 * H + 1400), 1.6, 1.6); }
  for (let x = -W - 520; x < W + 520; x += 120 + rnd() * 50) {
    building(ctx, rnd, x, -H - 330 - rnd() * 40, 90 + rnd() * 40, 70 + rnd() * 30);
    building(ctx, rnd, x, H + 220 + rnd() * 40, 90 + rnd() * 40, 70 + rnd() * 30);
  }
  for (const sx of [-1, 1]) for (let y = -H - 200; y < H + 200; y += 110 + rnd() * 40) building(ctx, rnd, sx < 0 ? -W - 420 - rnd() * 40 : W + 300 + rnd() * 40, y, 90 + rnd() * 30, 80 + rnd() * 20);
  // La terraza: piso de baldosas, pretil alrededor.
  const X = W + 150, Y = H + 112;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-X + 14, -Y + 16, 2 * X, 2 * Y);
  ctx.fillStyle = '#5e5b55'; ctx.fillRect(-X, -Y, 2 * X, 2 * Y);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -X; x < X; x += 16) { ctx.moveTo(x, -Y); ctx.lineTo(x, Y); }
  for (let y = -Y; y < Y; y += 16) { ctx.moveTo(-X, y); ctx.lineTo(X, y); }
  ctx.stroke();
  ctx.strokeStyle = '#b5b0a5'; ctx.lineWidth = 10; ctx.strokeRect(-X + 5, -Y + 5, 2 * X - 10, 2 * Y - 10);
  // Red alta alrededor de la canchita.
  ctx.strokeStyle = 'rgba(230,235,240,0.35)'; ctx.lineWidth = 0.8;
  ctx.save(); ctx.beginPath(); ctx.rect(-W - 34, -H - 34, 2 * W + 68, 2 * H + 68); ctx.rect(-W - 26, -H - 26, 2 * W + 52, 2 * H + 52); ctx.clip('evenodd');
  ctx.beginPath();
  for (let x = -W - 34; x < W + 34; x += 5) { ctx.moveTo(x, -H - 34); ctx.lineTo(x, H + 34); }
  for (let y = -H - 34; y < H + 34; y += 5) { ctx.moveTo(-W - 34, y); ctx.lineTo(W + 34, y); }
  ctx.stroke(); ctx.restore();
  ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 2; ctx.strokeRect(-W - 34, -H - 34, 2 * W + 68, 2 * H + 68);
  // Tanques de agua, equipos de aire, antenas y la sala de máquinas.
  for (const x of [-W - 120, -W - 80]) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.arc(x + 5, -H - 90 + 6, 18, 0, 7); ctx.fill(); ctx.fillStyle = '#2d3033'; ctx.beginPath(); ctx.arc(x, -H - 90, 18, 0, 7); ctx.fill(); ctx.fillStyle = '#41454a'; ctx.beginPath(); ctx.arc(x - 3, -H - 93, 12, 0, 7); ctx.fill(); }
  for (let i = 0; i < 4; i++) acUnit(ctx, W + 70, -H - 10 + i * 30);
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(-W - 135, H + 30, 80, 60);
  ctx.fillStyle = '#4d4a45'; ctx.fillRect(-W - 140, H + 24, 80, 60);
  paint(ctx, 'SALIDA', -W - 100, H + 54, '800 10px sans-serif', '#7fe0a0', o.mirror);
  // Gente: sentados en el borde, con sillas, y la mesa con bebidas.
  crowd(ctx, rnd, -W + 10, -H - 66, W - 10, -H - 44, o, 16, 12, 0.8);
  crowd(ctx, rnd, -W + 10, H + 44, W - 10, H + 66, o, 16, 12, 0.75);
  table(ctx, rnd, W + 110, H + 70); table(ctx, rnd, W + 110, H + 10);
  for (const [x, y] of [[-W - 130, -H - 95], [W + 130, -H - 95], [-W - 130, H + 95], [W + 130, H + 95], [W + 130, -H - 30]]) plant(ctx, rnd, x, y);
  // Guirnaldas y reflectores.
  stringLights(ctx, -W - 60, -H - 40, W + 60, -H - 40, 16, 34, true);
  stringLights(ctx, -W - 60, H + 40, W + 60, H + 40, 16, 34, true);
  for (const [x, y] of [[-W - 60, -H - 40], [W + 60, -H - 40], [-W - 60, H + 40], [W + 60, H + 40]]) lampPost(ctx, x, y, false, 170);
  led(ctx, -W, -H - 22, 2 * W, 16, ledText('  TL ROOFTOP  ·  TODA LA LECCE  ·'), o.hot, o.mirror);
  trapo(ctx, -50, H + 16, 100, 13, 'blanco', cheerName(0, 'TODA LA LECCE'), o.mirror);
  void gap;
}

/* ── La cortada ─────────────────────────────────────────────────────── */

/** Frente de una casa visto de arriba: techo, puerta y a veces el vecino en la vereda. */
function house(ctx, rnd, x, y, w, depth, up, o) {
  const dir = up ? -1 : 1;
  const top = up ? y - depth : y;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 4, top + 5, w, depth);
  ctx.fillStyle = pick(rnd, ['#c96f4a', '#b55a3c', '#d9c9a8', '#8a9aa6', '#e0d6c0', '#9a6a5a']);
  ctx.fillRect(x, top, w, depth);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 3; i < w; i += 7) ctx.fillRect(x + i, top, 2, depth);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, top, w, depth);
  // Puerta y ventana sobre la vereda.
  const fy = up ? y - 3 : y;
  ctx.fillStyle = '#4a3324'; ctx.fillRect(x + w * 0.2, fy, 10, 3);
  ctx.fillStyle = 'rgba(160,200,230,0.8)'; ctx.fillRect(x + w * 0.55, fy, 16, 3);
  if (rnd() < 0.6) {
    const px = x + w * 0.2 + 5, py = y + dir * 12;
    ctx.fillStyle = '#7a5a3a'; ctx.fillRect(px - 6, py - 6, 12, 12);
    person(ctx, rnd, px, py, shirtFor(rnd, px < 0 ? 'Red' : 'Blue'), o.cheer === (px < 0 ? 'Red' : 'Blue'), 0.95);
  }
  if (rnd() < 0.5) { ctx.fillStyle = '#3d8a35'; ctx.beginPath(); ctx.arc(x + w - 8, y + dir * 8, 5, 0, 7); ctx.fill(); }
}

function cortada(ctx, W, H, o) {
  const rnd = seeded(101);
  const gap = goalGap(H);
  // Asfalto (la cancha es la calle), cordón y vereda.
  ground(ctx, rnd, W, H, '#3d4046', ['rgba(60,64,70,0.7)', 'rgba(48,51,56,0.7)'], ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.18)']);
  ctx.fillStyle = '#4a4d53'; ctx.fillRect(-W - 800, -H - 46, 2 * W + 1600, 2 * H + 92);
  for (const y of [-H - 46, H + 40]) { ctx.fillStyle = '#c9c4b6'; ctx.fillRect(-W - 800, y, 2 * W + 1600, 6); }
  ctx.fillStyle = '#9b968a';
  ctx.fillRect(-W - 800, -H - 86, 2 * W + 1600, 40); ctx.fillRect(-W - 800, H + 46, 2 * W + 1600, 40);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -W - 800; x < W + 800; x += 14) { ctx.moveTo(x, -H - 86); ctx.lineTo(x, -H - 46); ctx.moveTo(x, H + 46); ctx.lineTo(x, H + 86); }
  ctx.stroke();
  // Casas de los dos lados.
  for (let x = -W - 420; x < W + 420; x += 0) { const w = 60 + rnd() * 40; house(ctx, rnd, x, -H - 86, w, 90, true, o); x += w + 4; }
  for (let x = -W - 420; x < W + 420; x += 0) { const w = 60 + rnd() * 40; house(ctx, rnd, x, H + 86, w, 90, false, o); x += w + 4; }
  // Árboles en la vereda, autos estacionados en el cordón, vecinos mirando.
  for (let x = -W - 300; x < W + 300; x += 120) { tree(ctx, rnd, x + 30, -H - 66, 22); tree(ctx, rnd, x + 90, H + 66, 22); }
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -W - 70 : W + 70;
    car(ctx, x0, -H - 30, 0, pick(rnd, CARS)); car(ctx, x0 + sx * 60, -H - 30, 0, pick(rnd, CARS));
    car(ctx, x0, H + 26, Math.PI, pick(rnd, CARS)); car(ctx, x0 + sx * 70, H + 26, Math.PI, pick(rnd, CARS));
    // Las «tribunas» son la gente en la esquina.
    scatter(ctx, rnd, x0 - 25, -gap, x0 + 25, -40, 6, o);
    scatter(ctx, rnd, x0 - 25, 40, x0 + 25, gap, 6, o);
    ball(ctx, x0 + sx * 40, 0, 4.5);
  }
  crowd(ctx, rnd, -W + 10, -H - 40, W - 10, -H - 28, o, 20, 12, 0.6);
  crowd(ctx, rnd, -W + 10, H + 28, W - 10, H + 38, o, 20, 12, 0.6);
  dog(ctx, W * 0.4, H + 60);
  if (REG) REG.lane = { y: -H - 16, x0: -W - 500, x1: W + 500 };
  // Kiosco en la esquina y cables de luz cruzando.
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-W - 160, -H - 60, 60, 36);
  ctx.fillStyle = '#f0c25a'; ctx.fillRect(-W - 164, -H - 64, 60, 36);
  paint(ctx, 'KIOSCO', -W - 134, -H - 46, '900 11px sans-serif', '#7a2f1c', o.mirror);
  ctx.strokeStyle = 'rgba(20,20,20,0.55)'; ctx.lineWidth = 1;
  for (const k of [-0.6, 0.1, 0.7]) { ctx.beginPath(); ctx.moveTo(W * k - 40, -H - 90); ctx.quadraticCurveTo(W * k, 0, W * k + 40, H + 90); ctx.stroke(); }
  // Zapatillas colgadas del cable.
  ctx.fillStyle = '#f1f1ec'; ctx.fillRect(W * 0.1 - 3, -4, 6, 10); ctx.fillRect(W * 0.1 + 4, -2, 6, 10);
  for (let x = -W - 200; x < W + 200; x += 210) { lampPost(ctx, x, -H - 52, true, 150); lampPost(ctx, x + 105, H + 52, true, 150); }
  trapo(ctx, -50, -H - 98, 100, 13, 'blanco', cheerName(0, 'TODA LA LECCE'), o.mirror);
}

/* ── Patio del colegio ──────────────────────────────────────────────── */

function colegio(ctx, W, H, o) {
  const rnd = seeded(113);
  const gap = goalGap(H);
  ground(ctx, rnd, W, H, '#a6a29a', ['rgba(150,146,138,0.6)', 'rgba(170,166,158,0.6)'], ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.12)']);
  // Baldosas grandes del patio.
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -W - 400; x < W + 400; x += 40) { ctx.moveTo(x, -H - 300); ctx.lineTo(x, H + 300); }
  for (let y = -H - 300; y < H + 300; y += 40) { ctx.moveTo(-W - 400, y); ctx.lineTo(W + 400, y); }
  ctx.stroke();
  // Paredes con murales arriba y abajo.
  const mural = (y, h) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-W - 196, y + 4, 2 * W + 392, h);
    ctx.fillStyle = '#e8e0cc'; ctx.fillRect(-W - 200, y, 2 * W + 400, h);
    const cols = ['#e86f4a', '#f0c25a', '#3aa37a', '#4a7fd8', '#b25ab5', '#e85a7a'];
    for (let x = -W - 190; x < W + 190; x += 26 + rnd() * 30) {
      ctx.fillStyle = pick(rnd, cols);
      const k = rnd();
      if (k < 0.33) { ctx.beginPath(); ctx.arc(x + 10, y + h / 2, h * 0.32, 0, 7); ctx.fill(); }
      else if (k < 0.66) { ctx.beginPath(); ctx.moveTo(x, y + h - 4); ctx.lineTo(x + 12, y + 4); ctx.lineTo(x + 24, y + h - 4); ctx.fill(); }
      else ctx.fillRect(x, y + h * 0.25, 18, h * 0.5);
    }
  };
  mural(-H - 104, 26);
  mural(H + 80, 26);
  paint(ctx, 'ESC. N° 7 · TODA LA LECCE', 0, -H - 91, '900 13px sans-serif', '#3a2a5a', o.mirror);
  // Bancos con chicos mirando y mochilas tiradas.
  for (let x = -W + 20; x < W - 60; x += 130) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 3, -H - 58, 90, 14);
    ctx.fillStyle = '#7a5a3a'; ctx.fillRect(x, -H - 62, 90, 14);
    for (let k = 0; k < 4; k++) if (rnd() < 0.8) person(ctx, rnd, x + 12 + k * 22, -H - 55, rnd() < 0.6 ? '#f1f1ec' : shirtFor(rnd, x < 0 ? 'Red' : 'Blue'), o.cheer === (x < 0 ? 'Red' : 'Blue'), 0.85);
  }
  crowd(ctx, rnd, -W + 10, H + 26, W - 10, H + 64, o, 16, 13, 0.75);
  const pack = (x, y) => { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 2, y + 2, 12, 14); ctx.fillStyle = pick(rnd, [RED, BLUE, '#3aa37a', '#f0c25a', '#b25ab5']); ctx.fillRect(x, y, 12, 14); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 2, y + 8, 8, 4); };
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) pack(sx * (W + 30 + rnd() * 50), -H + rnd() * (H - gap - 20));
    for (let i = 0; i < 6; i++) pack(sx * (W + 30 + rnd() * 50), gap + 10 + rnd() * (H - gap - 20));
  }
  // Rayuela, aro de básquet, mástil y el kiosco.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) ctx.strokeRect(-W - 150 + (i % 2 ? 0 : 0), -60 + i * 20, 24, 20);
  paint(ctx, 'CIELO', -W - 138, -76, '800 9px sans-serif', '#fff', o.mirror);
  ctx.fillStyle = '#555'; ctx.fillRect(W + 150, -10, 6, 20);
  ctx.strokeStyle = '#e86f4a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(W + 140, 0, 9, 0, 7); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillRect(W + 154, -14, 4, 28);
  flagPole(ctx, -W - 60, H + 50, '#7fb3e8', '#f1f1ec');
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(W + 64, H + 34, 70, 36);
  ctx.fillStyle = '#e86f4a'; ctx.fillRect(W + 60, H + 30, 70, 36);
  paint(ctx, 'KIOSCO', W + 95, H + 48, '900 11px sans-serif', '#fff', o.mirror);
  scatter(ctx, rnd, W + 40, H + 70, W + 140, H + 80, 4, o);
  if (REG) { REG.runners.push({ x: -W - 70, y: 0, r: 40 }); REG.runners.push({ x: W + 80, y: -40, r: 36 }); REG.runners.push({ x: W + 70, y: H - 30, r: 30 }); }
  // Árboles del patio.
  tree(ctx, rnd, -W - 120, H + 40, 36); tree(ctx, rnd, W + 130, -H - 40, 36);
}

/* ── Estadio grande ─────────────────────────────────────────────────── */

function bigScreen(ctx, x, y, w, h, mirror) {
  if (REG) REG.screens.push({ x, y, w, h });
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x + 5, y + 6, w, h);
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#3a4252'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = 'rgba(80,140,255,0.12)'; ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
  paint(ctx, LIVE.score || 'TODA LA LECCE', x + w / 2, y + h * 0.42, `900 ${Math.round(h * 0.28)}px sans-serif`, '#ffffff', mirror, w - 10);
  paint(ctx, 'TL APP', x + w / 2, y + h * 0.78, `800 ${Math.round(h * 0.18)}px sans-serif`, '#f0c25a', mirror);
}

function estadio(ctx, W, H, o) {
  const rnd = seeded(127);
  const gap = goalGap(H);
  ground(ctx, rnd, W, H, '#1c1f26', ['rgba(30,34,42,0.7)'], ['rgba(255,255,255,0.03)']);
  // Pasto que sobra y pista alrededor.
  ctx.fillStyle = '#3f7a3c'; ctx.fillRect(-W - 40, -H - 40, 2 * W + 80, 2 * H + 80);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = -W - 40; x < W + 40; x += 30) ctx.fillRect(x, -H - 40, 15, 2 * H + 80);
  // Las gradas: bandejas en escalones, con pasillos, en los cuatro lados.
  const stand = (x0, y0, x1, y1, horiz) => {
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x0 + 4, y0 + 5, x1 - x0, y1 - y0);
    ctx.fillStyle = '#3c414b'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    if (horiz) for (let y = y0; y < y1; y += 12) ctx.fillRect(x0, y, x1 - x0, 1);
    else for (let x = x0; x < x1; x += 12) ctx.fillRect(x, y0, 1, y1 - y0);
  };
  stand(-W - 60, -H - 170, W + 60, -H - 48, true);
  stand(-W - 60, H + 48, W + 60, H + 170, true);
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -W - 200 : W + 58, x1 = sx < 0 ? -W - 58 : W + 200;
    stand(x0, -H - 48, x1, H + 48, false);
  }
  // Gente: tupida, con pasillos.
  const aisles = [-W * 0.6, -W * 0.2, W * 0.2, W * 0.6];
  const block = (x0, y0, x1, y1) => {
    let prev = x0;
    for (const a of [...aisles.filter((v) => v > x0 && v < x1), x1]) { crowd(ctx, rnd, prev + 8, y0, a - 8, y1, o, 13, 12, 0.95); prev = a; }
  };
  block(-W - 50, -H - 164, W + 50, -H - 56);
  block(-W - 50, H + 56, W + 50, H + 164);
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -W - 192 : W + 66, x1 = sx < 0 ? -W - 66 : W + 192;
    crowd(ctx, rnd, x0, -H - 40, x1, -gap - 30, o, 13, 12, 0.95);
    crowd(ctx, rnd, x0, gap + 30, x1, H + 40, o, 13, 12, 0.95);
    // Pantalla gigante en cada cabecera.
    bigScreen(ctx, sx < 0 ? -W - 186 : W + 74, -30, 112, 60, o.mirror);
  }
  // Palcos vidriados en el medio de la platea de abajo.
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(-116, H + 64, 240, 32);
  ctx.fillStyle = '#2a3240'; ctx.fillRect(-120, H + 60, 240, 32);
  for (let i = 0; i < 8; i++) { ctx.fillStyle = 'rgba(150,200,240,0.45)'; ctx.fillRect(-116 + i * 30, H + 64, 26, 12); person(ctx, rnd, -103 + i * 30, H + 82, '#2b2b2b', false, 0.8); }
  // El techo: borde con sombra sobre las últimas filas.
  ctx.fillStyle = 'rgba(10,12,16,0.75)';
  ctx.fillRect(-W - 220, -H - 200, 2 * W + 440, 34);
  ctx.fillRect(-W - 220, H + 166, 2 * W + 440, 34);
  ctx.strokeStyle = 'rgba(160,170,185,0.4)'; ctx.lineWidth = 1;
  for (let x = -W - 220; x < W + 220; x += 40) { ctx.beginPath(); ctx.moveTo(x, -H - 200); ctx.lineTo(x + 20, -H - 166); ctx.moveTo(x, H + 200); ctx.lineTo(x + 20, H + 166); ctx.stroke(); }
  // LED de campo, bancos con techo, el túnel, fotógrafos.
  led(ctx, -W, -H - 30, 2 * W, 18, ledText('  TODA LA LECCE  ·  TL APP  ·  ESTADIO TL  ·'), o.hot, o.mirror);
  led(ctx, -W, H + 12, 2 * W, 18, ledText('  TL APP  ·  TODA LA LECCE  ·'), o.hot, o.mirror);
  dugout(ctx, rnd, -150, H + 32, 110, 'Red', o);
  dugout(ctx, rnd, 40, H + 32, 110, 'Blue', o);
  ctx.fillStyle = '#0d0f13'; ctx.fillRect(-20, H + 30, 40, 18);
  for (let k = 0; k < 3; k++) { photographer(ctx, rnd, -W - 22, -gap - 10 - k * 14, 1); photographer(ctx, rnd, -W - 22, gap + 10 + k * 14, 1); photographer(ctx, rnd, W + 22, -gap - 10 - k * 14, -1); photographer(ctx, rnd, W + 22, gap + 10 + k * 14, -1); }
  for (const [x, y] of [[-W - 210, -H - 180], [W + 210, -H - 180], [-W - 210, H + 180], [W + 210, H + 180]]) lampPost(ctx, x, y, false, 320);
  trapo(ctx, -W + 40, -H - 60, 110, 14, 'rojo', cheerName(1, 'TL'), o.mirror);
  trapo(ctx, -50, -H - 60, 100, 14, 'blanco', cheerName(0, 'TODA LA LECCE'), o.mirror);
  trapo(ctx, W - 150, -H - 60, 110, 14, 'azul', cheerName(2, 'LECCE'), o.mirror);
}

/* ── Fresa, la DT ───────────────────────────────────────────────────── */

const FW = '#fdfbf7', FS = '#ece4d6', FL = '#d9ccb8';

/** Un rulo blanco con su sombrita. */
function curl(ctx, x, y, r) {
  ctx.fillStyle = FW;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = FL; ctx.lineWidth = r * 0.18;
  ctx.beginPath(); ctx.arc(x, y + r * 0.1, r * 0.55, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
}

/**
 * Fresa, caniche blanca, de DT: sentada al lado del banco de su equipo con la
 * gorra de TL y la pizarrita. `up`: gol de su equipo, se para con las patitas
 * arriba y mueve la cola.
 */
function fresaDT(ctx, x, y, up, team, mirror, wag = 0) {
  const k = 1.15;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  if (up) ctx.translate(0, -5);
  // Sombra.
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath(); ctx.ellipse(3, up ? 17 : 12, 15, 6, 0, 0, 7); ctx.fill();
  // Cola (moviéndose si festeja).
  ctx.strokeStyle = FS; ctx.lineWidth = 3;
  const tx = (up ? 18 : 20) + wag * 4, ty = up ? -8 : -2;
  ctx.beginPath(); ctx.moveTo(10, 8); ctx.quadraticCurveTo((up ? 22 : 18) + wag * 2, up ? -2 : 4, tx, ty); ctx.stroke();
  curl(ctx, tx, ty - 1, 3.2);
  // Cuerpo con rulos.
  ctx.fillStyle = FS;
  ctx.beginPath(); ctx.ellipse(0, 7, 12, 9, 0, 0, 7); ctx.fill();
  for (const [cx, cy] of [[-8, 9], [-3, 13], [3, 13], [8, 9], [-10, 3], [10, 3]]) curl(ctx, cx, cy, 3.6);
  // Patitas: adelante o arriba.
  ctx.fillStyle = FW;
  if (up) { ctx.beginPath(); ctx.arc(-11, -9, 3.4, 0, 7); ctx.arc(11, -9, 3.4, 0, 7); ctx.fill(); ctx.strokeStyle = FS; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-7, 2); ctx.lineTo(-11, -7); ctx.moveTo(7, 2); ctx.lineTo(11, -7); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(-5, 15, 3.2, 0, 7); ctx.arc(5, 15, 3.2, 0, 7); ctx.fill(); }
  // Pizarrita táctica al costado (si está sentada).
  if (!up) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-25, 3, 11, 13);
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(-26, 1, 11, 13);
    ctx.strokeStyle = RED; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-24, 5); ctx.lineTo(-18, 9); ctx.moveTo(-24, 10); ctx.lineTo(-19, 4); ctx.stroke();
    ctx.fillStyle = BLUE; ctx.beginPath(); ctx.arc(-19, 11, 1.2, 0, 7); ctx.fill();
  }
  // Orejas largas de rulos.
  ctx.fillStyle = FS;
  ctx.beginPath(); ctx.ellipse(-10, -3, 4.5, 8, 0.2, 0, 7); ctx.ellipse(10, -3, 4.5, 8, -0.2, 0, 7); ctx.fill();
  curl(ctx, -11, 1, 3); curl(ctx, 11, 1, 3);
  // Cabeza.
  ctx.fillStyle = FW;
  ctx.beginPath(); ctx.arc(0, -6, 9.5, 0, 7); ctx.fill();
  // Gorra de TL con visera.
  const cap = team === 'Blue' ? BLUE : RED;
  ctx.fillStyle = cap;
  ctx.beginPath(); ctx.arc(0, -10, 8.5, Math.PI, 0); ctx.fill();
  ctx.fillStyle = team === 'Blue' ? '#2d55b0' : '#b83a3a';
  ctx.beginPath(); ctx.ellipse(0, -9.5, 9.5, 2.4, 0, 0, 7); ctx.fill();
  paint(ctx, 'TL', 0, -13.5, '900 5px sans-serif', '#ffffff', mirror);
  curl(ctx, -7.5, -10, 2.6); curl(ctx, 7.5, -10, 2.6);
  // Cara: ojos, nariz y boca (abierta si festeja).
  ctx.fillStyle = '#2a1d16';
  ctx.beginPath(); ctx.ellipse(-3.4, -5, 1.6, 1.8, 0, 0, 7); ctx.ellipse(3.4, -5, 1.6, 1.8, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-2.9, -5.6, 0.6, 0, 7); ctx.arc(3.9, -5.6, 0.6, 0, 7); ctx.fill();
  ctx.fillStyle = '#7a4a3a';
  ctx.beginPath(); ctx.ellipse(0, -1.5, 2.2, 1.7, 0, 0, 7); ctx.fill();
  if (up) { ctx.fillStyle = '#e8737a'; ctx.beginPath(); ctx.ellipse(0, 2, 1.8, 2.4, 0, 0, 7); ctx.fill(); }
  else { ctx.strokeStyle = '#7a4a3a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-2, 0.6); ctx.quadraticCurveTo(0, 2, 2, 0.6); ctx.stroke(); }
  ctx.restore();
}

/** Un bancucho para Fresa donde la escena no tiene banco de suplentes. */
function fresaBench(ctx, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 18, y + 4, 40, 14);
  ctx.fillStyle = '#7a5a3a'; ctx.fillRect(x - 21, y + 1, 40, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x - 21, y + 1, 40, 3);
}

/**
 * Dónde se sienta Fresa en cada escena: al lado del banco de su equipo, del
 * lado de adentro (hacia el medio). Donde no hay bancos, en un bancucho propio.
 */
const FRESA_SPOT = {
  barrio: (W, H, t) => [t === 'Blue' ? 26 : -26, H + 38, false],
  led: (W, H, t) => [t === 'Blue' ? 8 : -8, H + 46, false],
  f5: (W, H, t) => [t === 'Blue' ? 14 : -14, H + 70, false],
  estadio: (W, H, t) => [t === 'Blue' ? 30 : -30, H + 44, false],
  noche: (W, H, t) => [t === 'Blue' ? W * 0.45 : -W * 0.45, H + 84, true],
  playa: (W, H, t) => [t === 'Blue' ? W * 0.5 : -W * 0.5, H + 66, true],
  campo: (W, H, t) => [t === 'Blue' ? 20 : -20, H + 76, true],
  azotea: (W, H, t) => [t === 'Blue' ? W * 0.5 : -W * 0.5, H + 84, true],
  cortada: (W, H, t) => [t === 'Blue' ? W * 0.3 : -W * 0.3, H + 34, true],
  colegio: (W, H, t) => [t === 'Blue' ? W * 0.5 : -W * 0.5, H + 76, true]
};

/* ── Clima, noche y fuegos (sirven para todos) ──────────────────────── */

function weatherLayer(ctx, rnd, W, H) {
  const X = W + 700, Y = H + 500;
  if (LIVE.wet) {
    // Todo más oscuro y mojado; los charcos ya están en el piso.
    ctx.fillStyle = 'rgba(20,32,48,0.18)';
    ctx.fillRect(-X, -Y, 2 * X, 2 * Y);
  }
  if (LIVE.snow) {
    // Un velo frío y nieve sobre los techos y las cosas, sin tapar a la gente.
    ctx.fillStyle = 'rgba(225,235,250,0.12)';
    ctx.fillRect(-X, -Y, 2 * X, 2 * Y);
  }
}

function nightLayer(ctx, W, H) {
  const X = W + 700, Y = H + 500;
  ctx.fillStyle = 'rgba(6,10,24,0.55)';
  ctx.fillRect(-X, -Y, 2 * X, 2 * Y);
  const lights = LIGHTS.length ? LIGHTS : [[-W - 60, -H - 60], [W + 60, -H - 60], [-W - 60, H + 60], [W + 60, H + 60]].map(([x, y]) => ({ x, y, warm: false, reach: 220 }));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const L of lights) {
    const c = L.warm ? '255,190,110' : '190,215,255';
    const g = ctx.createRadialGradient(L.x, L.y, 4, L.x, L.y, L.reach * 1.1);
    g.addColorStop(0, `rgba(${c},0.32)`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(L.x - L.reach * 1.1, L.y - L.reach * 1.1, L.reach * 2.2, L.reach * 2.2);
  }
  ctx.restore();
}

/** Fuegos artificiales arriba de la hinchada del que ganó. */
function fireworks(ctx, rnd, W, H, team) {
  const cols = team === 'Blue' ? [BLUE, '#9fc0ff', '#f0c25a', '#ffffff'] : team === 'Red' ? [RED, '#ff9b8a', '#f0c25a', '#ffffff'] : ['#f0c25a', '#ffffff', '#9fc0ff', '#ff9b8a'];
  const side = team === 'Blue' ? 1 : team === 'Red' ? -1 : 0;
  const spots = [];
  for (let i = 0; i < 7; i++) {
    const x = side ? side * (W * 0.15 + rnd() * W * 0.95) : -W + rnd() * 2 * W;
    const y = (i % 2 ? -1 : 1) * (H + 40 + rnd() * 80);
    spots.push([x, y]);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, y] of spots) {
    const c = pick(rnd, cols), c2 = pick(rnd, cols);
    const r = 34 + rnd() * 30;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r * 1.4);
    g.addColorStop(0, 'rgba(255,240,200,0.35)'); g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
    const n = 26;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.283 + rnd() * 0.1;
      const rr = r * (0.75 + rnd() * 0.3);
      ctx.strokeStyle = k % 2 ? c : c2; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * rr * 0.35, y + Math.sin(a) * rr * 0.35); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); ctx.stroke();
      ctx.fillStyle = k % 2 ? c : c2;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 2.2, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
  }
  ctx.restore();
}

/* ── La capa viva ────────────────────────────────────────────────────── *
 * Lo que se mueve, dibujado en cada cuadro arriba del fondo guardado. Pocas
 * cosas y baratas: lo que no se ve se saltea, los LED son una imagen que se
 * corre (el texto se arma una vez) y nada pisa la cancha.
 */

const STRIPS = new Map();
const S_PX = 3;
const SPRITES = new Map();
const FOAM = { pat: null };

function mkCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

/**
 * Una figura dibujada una sola vez como imagen (a 3 px por unidad) y pegada en
 * cada cuadro: pegar es mucho más barato que volver a dibujar rulos y manchas.
 * `draw(g)` dibuja con el centro en (0,0), dentro de ±r unidades.
 */
function sprite(key, r, draw) {
  let sp = SPRITES.get(key);
  if (sp) return sp;
  if (SPRITES.size > 260) SPRITES.clear();
  const px = Math.ceil(r * 2 * S_PX);
  const cv = mkCanvas(px, px);
  const g = cv.getContext('2d');
  g.setTransform(S_PX, 0, 0, S_PX, px / 2, px / 2);
  draw(g);
  sp = { cv, r };
  SPRITES.set(key, sp);
  return sp;
}
function stamp(ctx, sp, x, y, a) {
  if (a) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.drawImage(sp.cv, -sp.r, -sp.r, sp.r * 2, sp.r * 2);
    ctx.restore();
  } else ctx.drawImage(sp.cv, x - sp.r, y - sp.r, sp.r * 2, sp.r * 2);
}

/** El texto de un LED armado una vez como imagen larga, para correrlo. */
function ledStrip(text, w, h, hot) {
  const key = `${text}|${w}|${h}|${hot ? 1 : 0}`;
  let st = STRIPS.get(key);
  if (st) return st;
  if (STRIPS.size > 40) STRIPS.clear();
  const probe = mkCanvas(1, 1).getContext('2d');
  probe.font = `700 ${Math.round(h * 0.66 * S_PX)}px monospace`;
  const unit = Math.max(8, probe.measureText(text).width / S_PX);
  const cw = Math.ceil((w + unit + 8) * S_PX), ch = Math.ceil(h * S_PX);
  const cv = mkCanvas(cw, ch);
  const g = cv.getContext('2d');
  g.fillStyle = '#07090d'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = hot ? 'rgba(255,211,77,0.14)' : 'rgba(224,179,74,0.07)'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 2 * S_PX; i < cw; i += 3 * S_PX) g.fillRect(i, S_PX, S_PX, ch - 2 * S_PX);
  g.font = probe.font; g.textBaseline = 'middle'; g.fillStyle = hot ? '#ffd34d' : '#f0c25a';
  for (let x = 4 * S_PX; x < cw; x += unit * S_PX) g.fillText(text, x, ch / 2 + S_PX * 0.5);
  st = { cv, unit };
  STRIPS.set(key, st);
  return st;
}

function aliveLed(ctx, L, t, mirror) {
  const st = ledStrip(L.text, L.w, L.h, L.hot);
  const off = ((t / 1000) * 34) % st.unit;
  ctx.save();
  if (L.vertical) { ctx.translate(L.x + L.h, L.y); ctx.rotate(Math.PI / 2); } else ctx.translate(L.x, L.y);
  if (mirror && !L.vertical) { ctx.translate(L.w, 0); ctx.scale(-1, 1); }
  if (mirror && L.vertical) { ctx.translate(0, L.h); ctx.scale(1, -1); }
  ctx.beginPath(); ctx.rect(1, 1, L.w - 2, L.h - 2); ctx.clip();
  ctx.drawImage(st.cv, off * S_PX, 0, L.w * S_PX, L.h * S_PX, 0, 0, L.w, L.h);
  ctx.restore();
}

/** Un número de 0 a 1 que salta parejo según la semilla (sin guardar azar). */
function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Los que se paran en la tribuna: unos pocos por bloque, cada uno a su ritmo. */
function crowdActors(reg) {
  if (reg.__actors) return reg.__actors;
  const out = [];
  let k = 1;
  for (const [x0, y0, x1, y1] of reg.crowds) {
    const n = Math.max(2, Math.min(9, Math.round(((x1 - x0) * (y1 - y0)) / 3000)));
    for (let i = 0; i < n; i++, k++) {
      out.push({ x: x0 + hash01(k) * (x1 - x0), y: y0 + hash01(k + 0.5) * (y1 - y0), per: 2600 + hash01(k + 0.3) * 4200, ph: hash01(k + 0.7), seed: 1000 + k });
    }
  }
  reg.__actors = out;
  return out;
}

function flagWave(ctx, x, y, color, color2, t) {
  const w = Math.sin(t / 260 + x) * 4, w2 = Math.sin(t / 260 + x + 1.4) * 4;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(x + 16, y + 6, 16, 5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, y - 2); ctx.quadraticCurveTo(x + 14, y - 2 + w, x + 28, y - 2 + w2);
  ctx.lineTo(x + 28, y + 8 + w2); ctx.quadraticCurveTo(x + 14, y + 8 + w, x, y + 8); ctx.fill();
  if (color2) { ctx.fillStyle = color2; ctx.fillRect(x + 9, y - 3 + w * 0.6, 9, 10); }
  ctx.fillStyle = '#ddd';
  ctx.beginPath(); ctx.arc(x, y + 3, 2.2, 0, 7); ctx.fill();
}

function gull(ctx, x, y, flap) {
  ctx.strokeStyle = 'rgba(250,250,250,0.9)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x - 7, y - flap); ctx.quadraticCurveTo(x - 3, y - 3, x, y); ctx.quadraticCurveTo(x + 3, y - 3, x + 7, y - flap); ctx.stroke();
}

/**
 * Dibuja lo que se mueve. `reg`: lo que devolvió paintEnv. `vis`: lo que se ve
 * de la cancha (en unidades), para saltear lo de afuera.
 */
function paintAlive(ctx, id, bounds, t, reg, o = {}, vis = null) {
  if (!reg || !bounds || !DRAW[id]) return 0;
  const W = bounds.halfW, H = bounds.halfH;
  const see = (x, y, r) => !vis || (x + r > vis.x0 && x - r < vis.x1 && y + r > vis.y0 && y - r < vis.y1);
  let n = 0;
  LIVE.wet = o.weather === 'rain' || o.weather === 'storm';
  LIVE.snow = o.weather === 'snow' || o.weather === 'blizzard';
  const night = !!o.night;
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.rect(-W * 50, -H * 50, W * 100, H * 100);
    ctx.rect(-W, -H, 2 * W, 2 * H);
    ctx.clip('evenodd');
    // LED con el texto corriendo.
    for (const L of reg.leds) {
      const cx = L.vertical ? L.x + L.h / 2 : L.x + L.w / 2, cy = L.vertical ? L.y + L.w / 2 : L.y + L.h / 2;
      if (!see(cx, cy, Math.max(L.w, L.h) / 2 + 4)) continue;
      aliveLed(ctx, L, t, o.mirror); n++;
    }
    ctx.globalAlpha = night ? 0.62 : 1;
    // La tribuna: algunos se paran y levantan los brazos (en el festejo ya están todos).
    if (!o.hot) {
      for (const a of crowdActors(reg)) {
        const f = ((t / a.per) + a.ph) % 1;
        if (f > 0.16 || !see(a.x, a.y, 14)) continue;
        const jump = Math.sin((f / 0.16) * Math.PI) * 3;
        const team = a.x < 0 ? 'Red' : 'Blue';
        const sp = sprite(`p${a.seed}${team}${LIVE.snow ? 's' : ''}`, 14, (g) => { const r = seeded(a.seed); person(g, r, 0, 0, shirtFor(r, team), true); });
        stamp(ctx, sp, a.x, a.y - jump); n++;
      }
    }
    // Banderas que flamean.
    for (const F of reg.flags) if (see(F.x + 14, F.y, 30)) { flagWave(ctx, F.x, F.y, F.color, F.color2, t); n++; }
    // Perros dando vueltas.
    for (const [i, D] of reg.dogs.entries()) {
      const a = t / 2600 + i * 2;
      const x = D.x + Math.cos(a) * 16, y = D.y + Math.sin(a) * 8;
      if (!see(x, y, 14)) continue;
      stamp(ctx, sprite('dog', 14, (g) => dogShape(g, 0, 0)), x, y, a + Math.PI / 2); n++;
    }
    // Los pibes que patean afuera: la pelota va y viene entre dos.
    for (const [i, K] of reg.kids.entries()) {
      if (!see(K.x, K.y, 40)) continue;
      const kid = (j) => sprite(`kid${i}_${j}`, 13, (g) => { const r = seeded(500 + i * 2 + j); person(g, r, 0, 0, shirtFor(r, K.sx < 0 ? 'Red' : 'Blue'), false); });
      stamp(ctx, kid(0), K.x - 24, K.y); stamp(ctx, kid(1), K.x + 24, K.y + 6);
      const f = (Math.sin(t / 700 + i) + 1) / 2;
      ball(ctx, K.x - 18 + f * 36, K.y + 3 - Math.sin(f * Math.PI) * 6, 4); n += 3;
    }
    // Canchitas de al lado: dos contra dos.
    for (const [i, P] of reg.pitches.entries()) {
      if (!see(P.x + P.w / 2, P.y + P.h / 2, Math.max(P.w, P.h) / 2)) continue;
      const cx = P.x + P.w / 2, cy = P.y + P.h / 2;
      let bx = 0, by = 0;
      for (let k = 0; k < 4; k++) {
        const ph = t / (1800 + k * 300) + k * 1.7 + i;
        const x = cx + Math.sin(ph) * P.w * 0.32, y = cy + Math.cos(ph * 0.8) * P.h * 0.32;
        bx += x; by += y;
        ctx.fillStyle = k < 2 ? RED : BLUE;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ball(ctx, bx / 4 + Math.sin(t / 400) * 6, by / 4, 4); n += 5;
    }
    // Humo (asado, buffet).
    for (const [i, S] of reg.smoke.entries()) {
      if (!see(S.x + 20, S.y - 30, 60)) continue;
      const puff = sprite('puff', 10, (g) => { g.fillStyle = 'rgba(220,220,220,0.22)'; g.beginPath(); g.arc(0, 0, 10, 0, 7); g.fill(); });
      const a0 = ctx.globalAlpha;
      for (let k = 0; k < 5; k++) {
        const f = ((t / 2800) + k / 5 + i * 0.13) % 1;
        const r = 6 + f * 14;
        ctx.globalAlpha = a0 * (1 - f);
        ctx.drawImage(puff.cv, S.x + f * 26 + Math.sin(f * 6 + k) * 4 - r, S.y - f * 46 - r, r * 2, r * 2);
      }
      ctx.globalAlpha = a0;
      n++;
    }
    // Vacas pastando: se corren despacito.
    for (const C of reg.cows) {
      const x = C.x + Math.sin(t / 9000 + C.seed) * 16, y = C.y + Math.cos(t / 11000 + C.seed) * 8;
      if (!see(x, y, 26)) continue;
      // Girar una imagen en cada cuadro sale caro: la vaca ya viene girada, sólo se corre.
      stamp(ctx, sprite(`cow${C.seed}`, 28, (g) => cow(g, seeded(C.seed), 0, 0, C.a)), x, y); n++;
    }
    if (reg.mill && see(reg.mill.x, reg.mill.y, 30)) { stamp(ctx, sprite('mill', 26, (g) => millBlades(g, 0, 0, 0)), reg.mill.x, reg.mill.y, t / 700); n++; }
    // Flashes de los fotógrafos.
    for (const [i, P] of reg.flashes.entries()) {
      if (hash01(Math.floor(t / 90) * 3.7 + i) > 0.035 || !see(P.x, P.y, 14)) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(P.x, P.y, 12, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(P.x, P.y, 4, 0, 7); ctx.fill(); n++;
    }
    // Pantallas gigantes: cada tanto cambian de cartel.
    for (const S of reg.screens) {
      if (Math.floor(t / 4000) % 2 === 0 || !see(S.x + S.w / 2, S.y + S.h / 2, S.w)) continue;
      ctx.fillStyle = '#0b0e14'; ctx.fillRect(S.x + 3, S.y + 3, S.w - 6, S.h - 6);
      paint(ctx, '¡VAMOS TL!', S.x + S.w / 2, S.y + S.h / 2, `900 ${Math.round(S.h * 0.3)}px sans-serif`, Math.floor(t / 300) % 2 ? '#f0c25a' : '#ffffff', o.mirror, S.w - 10); n++;
    }
    // Alcanzapelotas y suplentes que caminan.
    for (const [i, Wk] of reg.walkers.entries()) {
      const x = Wk.x0 + (Wk.x1 - Wk.x0) * (0.5 + 0.5 * Math.sin(t / 3200 + i * 1.3));
      if (!see(x, Wk.y, 12)) continue;
      stamp(ctx, sprite(`w${i}${Wk.shirt || ''}`, 12, (g) => { const r = seeded(700 + i); person(g, r, 0, 0, Wk.shirt || shirtFor(r, Wk.x0 < 0 ? 'Red' : 'Blue'), false, 0.9); }), x, Wk.y); n++;
    }
    // Chicos corriendo en el recreo.
    for (const [i, R] of reg.runners.entries()) {
      for (let k = 0; k < 3; k++) {
        const a = t / (1300 + k * 200) + k * 2.1 + i;
        const x = R.x + Math.cos(a) * R.r, y = R.y + Math.sin(a) * R.r * 0.7;
        if (!see(x, y, 10)) continue;
        stamp(ctx, sprite(`k${i}_${k}`, 11, (g) => { const r = seeded(800 + i * 3 + k); person(g, r, 0, 0, pick(r, ['#f1f1ec', RED, BLUE, '#3aa37a']), false, 0.8); }), x, y); n++;
      }
    }
    // Pelota de vóley en la playa.
    if (reg.volley && see(reg.volley.x, reg.volley.y, 50)) {
      const f = (Math.sin(t / 900) + 1) / 2;
      const x = reg.volley.x - 28 + f * 56, h = Math.sin(f * Math.PI) * 34;
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(x + 2, reg.volley.y + 4, 5, 2.5, 0, 0, 7); ctx.fill();
      ball(ctx, x, reg.volley.y - h, 5); n++;
    }
    // Olas: la espuma va y viene.
    if (reg.sea !== undefined && vis && reg.sea > vis.y0 - 20) {
      const y = reg.sea + 3 + Math.sin(t / 1300) * 5;
      // Una ola de muestra repetida con un patrón: un solo relleno de punta a punta.
      if (!FOAM.pat) {
        const cv = mkCanvas(30 * S_PX, 10 * S_PX), g = cv.getContext('2d');
        g.scale(S_PX, S_PX); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(0, 3); g.quadraticCurveTo(15, 9, 30, 3); g.stroke();
        FOAM.pat = ctx.createPattern(cv, 'repeat-x');
      }
      if (FOAM.pat) {
        ctx.save(); ctx.translate(0, y - 3); ctx.scale(1 / S_PX, 1 / S_PX);
        ctx.fillStyle = FOAM.pat; ctx.fillRect(Math.floor(vis.x0 / 30) * 30 * S_PX, 0, (vis.x1 - vis.x0 + 60) * S_PX, 10 * S_PX);
        ctx.restore();
      }
      n++;
    }
    if (reg.gulls) {
      for (let k = 0; k < 3; k++) {
        const span = reg.gulls.x1 - reg.gulls.x0;
        const x = reg.gulls.x0 + (((t / 40) + k * 260) % span), y = reg.gulls.y + k * 22 + Math.sin(t / 600 + k) * 8;
        if (see(x, y, 10)) { gull(ctx, x, y, 3 + Math.sin(t / 120 + k) * 3); n++; }
      }
    }
    // Ventanas que se prenden y se apagan.
    if (reg.windows.length) {
      for (let k = 0; k < 36; k++) {
        const w = reg.windows[Math.floor(hash01(k + 0.1) * reg.windows.length)];
        if (!see(w[0], w[1], 4)) continue;
        const on = hash01(Math.floor(t / 2600) + k * 3.1) < 0.5;
        ctx.fillStyle = on ? 'rgba(255,214,140,0.9)' : 'rgba(60,70,90,0.85)'; ctx.fillRect(w[0], w[1], 5, 3); n++;
      }
      // Un avión que cruza cada tanto, con las luces titilando.
      const f = (t % 18000) / 18000;
      const ax = -W - 600 + f * (2 * W + 1200), ay = -H - 230 + f * 60;
      if (see(ax, ay, 20)) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(180,190,210,0.7)'; ctx.fillRect(ax - 9, ay - 1.5, 18, 3); ctx.fillRect(ax - 2, ay - 8, 4, 16);
        ctx.fillStyle = Math.floor(t / 400) % 2 ? '#ff4040' : '#ffffff';
        ctx.beginPath(); ctx.arc(ax - 2, ay - 8, 1.8, 0, 7); ctx.arc(ax - 2, ay + 8, 1.8, 0, 7); ctx.fill(); n++;
        ctx.globalAlpha = night ? 0.62 : 1;
      }
    }
    // El auto que pasa por la cortada.
    if (reg.lane) {
      const f = (t % 9000) / 9000;
      const x = reg.lane.x0 + f * (reg.lane.x1 - reg.lane.x0);
      if (see(x, reg.lane.y, 30)) { car(ctx, x, reg.lane.y, 0, '#c9a24a'); n++; }
    }
    // Fresa: mueve la cola; en el gol de los suyos, festeja.
    if (reg.fresa && see(reg.fresa.x, reg.fresa.y, 30)) {
      const up = o.cheer === reg.fresa.team;
      const hop = up ? Math.abs(Math.sin(t / 160)) * 4 : (hash01(Math.floor(t / 3000)) < 0.25 ? Math.abs(Math.sin(t / 140)) * 2 : 0);
      ctx.globalAlpha = night ? 0.8 : 1;
      const wag = Math.round(Math.sin(t / (up ? 90 : 160)) * 3) / 3;
      const sp = sprite(`fresa${up ? 1 : 0}${reg.fresa.team}${o.mirror ? 1 : 0}${wag}`, 34, (g) => fresaDT(g, 0, 0, up, reg.fresa.team, !!o.mirror, wag));
      stamp(ctx, sp, reg.fresa.x, reg.fresa.y - hop);
      n++;
    }
  } finally {
    ctx.restore();
  }
  return n;
}

const DRAW = { noche: potreroNoche, barrio: clubBarrio, led: potreroLed, f5: canchitaF5, playa, campo, azotea, cortada, colegio, estadio };

/**
 * Dibuja los alrededores. `ctx` llega con la transformación de mundo puesta.
 * @param {{ halfW:number, halfH:number }} bounds
 * @param {{ cheer?: 'Red'|'Blue'|null, hot?: boolean, mirror?: boolean, score?: string, scorer?: string, names?: string[], weather?: string, night?: boolean, fireworks?: 'Red'|'Blue'|'draw'|null, fresa?: boolean, fresaTeam?: 'Red'|'Blue' }} o
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
    ctx.lineCap = 'butt';
    // Sólo afuera de la cancha: nada pisa el campo.
    const W = bounds.halfW, H = bounds.halfH;
    ctx.beginPath();
    ctx.rect(-W * 50, -H * 50, W * 100, H * 100);
    ctx.rect(-W, -H, 2 * W, 2 * H);
    ctx.clip('evenodd');
    LIVE.score = typeof o.score === 'string' ? o.score : '';
    LIVE.scorer = typeof o.scorer === 'string' ? o.scorer.toUpperCase().slice(0, 18) : '';
    LIVE.names = Array.isArray(o.names) ? o.names.filter((n) => typeof n === 'string' && n).map((n) => n.toUpperCase().slice(0, 14)).slice(0, 3) : [];
    LIVE.wet = o.weather === 'rain' || o.weather === 'storm';
    LIVE.snow = o.weather === 'snow' || o.weather === 'blizzard';
    LIVE.night = !!o.night;
    LIVE.alive = !!o.alive;
    LIGHTS.length = 0;
    REG = { leds: [], crowds: [], flags: [], dogs: [], kids: [], pitches: [], smoke: [], cows: [], flashes: [], screens: [], windows: [], walkers: [], runners: [], fresa: null, mill: null, volley: null, gulls: null, lane: null };
    fn(ctx, W, H, { cheer: o.cheer || null, hot: !!o.hot, mirror: !!o.mirror });
    // Fresa, la DT, en el banco del equipo de uno (rojo si mirás de afuera).
    if (o.fresa !== false && FRESA_SPOT[id]) {
      const team = o.fresaTeam === 'Blue' ? 'Blue' : 'Red';
      const [fx, fy, bench] = FRESA_SPOT[id](W, H, team);
      if (bench) fresaBench(ctx, fx, fy + 4);
      if (REG) REG.fresa = { x: fx, y: fy, team };
      if (!LIVE.alive) fresaDT(ctx, fx, fy, o.cheer === team, team, !!o.mirror);
    }
    const rnd = seeded(7);
    if (LIVE.wet || LIVE.snow) weatherLayer(ctx, rnd, W, H);
    if (LIVE.night) nightLayer(ctx, W, H);
    if (o.fireworks) fireworks(ctx, rnd, W, H, o.fireworks);
  } finally {
    ctx.restore();
  }
  const reg = REG;
  REG = null;
  return reg || true;
}

module.exports = { ENVS, has, paintEnv, paintAlive, goalGap };
