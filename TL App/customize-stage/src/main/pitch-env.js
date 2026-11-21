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
  ['f5', 'Canchita F5']
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
  if (text) paint(ctx, text, x + w / 2, y + h / 2 + 0.5, `900 ${Math.round(h * 0.62)}px sans-serif`, kind === 'blanco' ? RED : '#ffffff', mirror);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath(); ctx.arc(x + 1.5, y + 1.5, 1.4, 0, 7); ctx.arc(x + w - 1.5, y + 1.5, 1.4, 0, 7); ctx.fill();
}

/** Bandera en un mástil, vista de arriba. */
function flagPole(ctx, x, y, color, color2) {
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
  const msg = hot ? '¡GOL!   ¡GOL!   ¡GOL!   ' : text;
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
  led(ctx, -130, -H - 82, 260, 20, '  TODA LA LECCE  ·', o.hot, o.mirror);
  // La hinchada parada contra el alambrado.
  crowd(ctx, rnd, -W + 10, -H - 50, -195, -H - 28, o, 15, 11, 0.82);
  crowd(ctx, rnd, 195, -H - 50, W - 10, -H - 28, o, 15, 11, 0.82);
  crowd(ctx, rnd, -W + 10, H + 28, W - 10, H + 62, o, 15, 11, 0.75);
  // Los fondos: los pibes con su pelota, motos, bici y el perro.
  for (const sx of [-1, 1]) {
    const x = sx * (W + 70);
    stones(ctx, x + sx * 40, -gap - 60, 14);
    scatter(ctx, rnd, x - 25, -H - 10, x + 25, -gap - 20, 4, o);
    ball(ctx, x + sx * 10, -gap - 40);
    moto(ctx, x + sx * 30, gap + 40, 1.4, pick(rnd, ['#b23a3a', '#2a2a2a', '#3d6ad6']));
    moto(ctx, x + sx * 48, gap + 46, 1.5, pick(rnd, ['#c9a24a', '#2a2a2a']));
    bike(ctx, x, gap + 80, 0.3 * sx);
    scatter(ctx, rnd, x - 30, gap + 10, x + 30, H + 20, 5, o);
  }
  dog(ctx, -W - 40, H + 12);
  fence(ctx, -W - 22, -H - 20, 2 * W + 44, 2 * H + 40, 0.55);
  // Trapos colgados del alambrado.
  trapo(ctx, -W + 30, -H - 26, 80, 14, 'rojo', 'TL', o.mirror);
  trapo(ctx, -W + 130, -H - 26, 64, 14, 'franjas-r', '', o.mirror);
  trapo(ctx, W - 194, -H - 26, 64, 14, 'franjas-b', '', o.mirror);
  trapo(ctx, W - 110, -H - 26, 80, 14, 'azul', 'LECCE', o.mirror);
  trapo(ctx, -60, H + 14, 120, 14, 'blanco', 'TODA LA LECCE', o.mirror);
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
  led(ctx, W * 0.18, H + 64, W * 0.7, 20, '  SOCIOS AL DÍA  ·  CUOTA EN EL BUFFET  ·', o.hot, o.mirror);
  // Costados: el buffet con mesas, autos estacionados y gente.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-W - 155, -56, 70, 120);
  ctx.fillStyle = '#6a3e35';
  ctx.fillRect(-W - 160, -60, 70, 120);
  ctx.fillStyle = '#e8ddc8';
  ctx.fillRect(-W - 92, -60, 6, 120);
  paint(ctx, 'BUFFET', -W - 125, 0, '900 12px sans-serif', '#f4e7c8', o.mirror);
  table(ctx, rnd, -W - 60, -gap - 30); table(ctx, rnd, -W - 60, gap + 30); table(ctx, rnd, -W - 110, -gap - 70);
  for (let i = 0; i < 4; i++) car(ctx, W + 110, -120 + i * 70, Math.PI / 2, pick(rnd, CARS));
  scatter(ctx, rnd, W + 40, -H, W + 75, -gap - 10, 4, o);
  scatter(ctx, rnd, W + 40, gap + 10, W + 75, H, 4, o);
  fence(ctx, -W - 20, -H - 20, 2 * W + 40, 2 * H + 40, 0.5);
  trapo(ctx, -W + 60, -H - 24, 90, 13, 'franjas-r', '', o.mirror);
  trapo(ctx, W - 150, -H - 24, 90, 13, 'franjas-b', '', o.mirror);
  trapo(ctx, -50, -H - 24, 100, 13, 'blanco', 'TODA LA LECCE', o.mirror);
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
  led(ctx, -W, -H - 32, 2 * W, 20, '  TODA LA LECCE  ·  TL APP  ·', o.hot, o.mirror);
  led(ctx, -W, H + 12, 2 * W, 20, '  TL APP  ·  TODA LA LECCE  ·', o.hot, o.mirror);
  for (const sx of [-1, 1]) {
    const x = sx < 0 ? -W - 36 : W + 16;
    led(ctx, x, -H, H - gap - 6, 20, '  TODA LA LECCE  ·', o.hot, o.mirror, true);
    led(ctx, x, gap + 6, H - gap - 6, 20, '  TL APP  ·', o.hot, o.mirror, true);
  }
  // Fotógrafos y alcanzapelotas detrás de los LED de abajo, y los bancos.
  for (let k = 0; k < 4; k++) photographer(ctx, rnd, -W + 30 + k * 26, H + 42, 1);
  for (let k = 0; k < 4; k++) photographer(ctx, rnd, W - 30 - k * 26, H + 42, -1);
  for (const [x, y] of [[-W - 8, -H - 40], [W + 8, -H - 40], [-W - 8, H + 40], [W + 8, H + 40]]) person(ctx, rnd, x, y, '#f0c25a', false, 0.9);
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
    ball(ctx, sx * (W + 80), 0);
  }
  // LED en las bandas.
  led(ctx, -W, -H - 32, 2 * W, 20, '  TL APP  ·  TODA LA LECCE  ·  F5 LOS MARTES  ·', o.hot, o.mirror);
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
    ctx.lineCap = 'butt';
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
