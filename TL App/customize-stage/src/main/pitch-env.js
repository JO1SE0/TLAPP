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

// Los colores de cada hinchada: los de las camisetas del partido si se conocen
// (los pone paintEnv / paintAlive), y si no, rojo y azul.
const RED0 = '#d24a4a';
const BLUE0 = '#3d6ad6';
let RED = RED0;
let BLUE = BLUE0;
/** Las franjas de cada camiseta (1 a 3 colores), para vestir a la hinchada. */
const KIT = { Red: [RED0], Blue: [BLUE0] };

/** Toma las camisetas del partido: { Red: [colores], Blue: [colores] } en #rrggbb. */
function useKits(kits) {
  const ok = (a) => Array.isArray(a) && a.length && a.every((c) => /^#[0-9a-f]{6}$/i.test(c));
  KIT.Red = kits && ok(kits.Red) ? kits.Red.slice(0, 3) : [RED0];
  KIT.Blue = kits && ok(kits.Blue) ? kits.Blue.slice(0, 3) : [BLUE0];
  RED = KIT.Red[0];
  BLUE = KIT.Blue[0];
  LIVE.pk = `${KIT.Red.join('')}${KIT.Blue.join('')}`;
}
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
  return LIVE.gap || Math.max(80, halfH * 0.5);
}

/**
 * Las medidas con las que se dibuja: el ancho llega hasta el fondo de la red
 * (todo lo de las cabeceras queda detrás de los arcos) y el hueco frente a cada
 * arco es el alto real de su boca. Sin datos de los arcos, lo de siempre.
 */
function envDims(bounds) {
  // Sin puntos en la red, una profundidad razonable para el ancho del arco.
  const gd = Number.isFinite(bounds.goalDepth) && bounds.goalDepth > 4 ? Math.min(260, bounds.goalDepth) : Math.max(30, (bounds.goalY || 64) * 0.5);
  const gap = bounds.goalY > 0 ? bounds.goalY + 26 : Math.max(80, bounds.halfH * 0.5);
  return { W0: bounds.halfW, W: bounds.halfW + gd, H: bounds.halfH, gap };
}

/* ── Piso ─────────────────────────────────────────────────────────── */

/** Un piso con textura: base, manchas grandes y granitos. */
function ground(ctx, rnd, W, H, base, spots, grain) {
  // Bien grande: con la ventana abierta o el zoom alejado no se tiene que ver el borde.
  const X = W + 1400, Y = H + 1000;
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
    ctx.strokeStyle = Array.isArray(shirt) ? shirt[0] : shirt;
    ctx.lineWidth = 3.2 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 5 * s, y); ctx.lineTo(x - 8.5 * s, y - 9 * s);
    ctx.moveTo(x + 5 * s, y); ctx.lineTo(x + 8.5 * s, y - 9 * s);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  const stripes = Array.isArray(shirt) ? shirt : null;
  ctx.fillStyle = stripes ? stripes[0] : shirt;
  ctx.beginPath(); ctx.ellipse(x, y + 1, 7.2 * s, 4.8 * s, 0, 0, 7); ctx.fill();
  if (stripes && stripes.length > 1) {
    // Camiseta a franjas: bandas verticales de los otros colores.
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y + 1, 7.2 * s, 4.8 * s, 0, 0, 7); ctx.clip();
    for (let k = 1; k < stripes.length; k++) {
      ctx.fillStyle = stripes[k];
      const bx = x - 7.2 * s + (k / stripes.length) * 14.4 * s;
      ctx.fillRect(bx - 1.6 * s, y - 4, 3.2 * s, 10 * s);
      if (stripes.length === 2) ctx.fillRect(x - 7.2 * s + 0.2 * 14.4 * s - 1.6 * s, y - 4, 3.2 * s, 10 * s);
    }
    ctx.restore();
  }
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
  if (r < 0.62) { const k = team === 'Red' ? KIT.Red : KIT.Blue; return k.length > 1 ? k : k[0]; }
  if (r < 0.72) return '#f1f1ec';
  return pick(rnd, NEUTRAL);
}

/** Un bloque de gente (tribuna o montón): filas con algo de desorden. */
function crowd(ctx, rnd, x0, y0, x1, y1, o, gapX = 16, gapY = 15, density = 0.9) {
  // Cuánta gente hay en la sala llena más o menos la tribuna.
  density *= LIVE.fill;
  const seed = Math.floor(rnd() * 1e9);
  if (REG) REG.crowds.push({ x0, y0, x1, y1, gapX, gapY, density, seed });
  // Con vida, la tribuna entera la dibuja la capa viva (se mueve toda junta).
  if (LIVE.alive) return;
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
  // Una zona a lo largo crece con el largo de la cancha; una de costado, con el ancho.
  n = more(n, Math.min(6, Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? LIVE.kx : LIVE.ky));
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
    if (REG && REG.bulbs.length < 160) REG.bulbs.push([x, y]);
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
  // Con vida, los trapos van arriba de la tribuna que se mueve: los pega la capa viva.
  if (REG && LIVE.alive && !REG.__inTrapo) { REG.trapos.push({ x, y, w, h, kind, text }); return; }
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
const LIVE = { score: '', scorer: '', names: [], wet: false, snow: false, night: false, gap: 0, pk: '', fill: 1, kx: 1, ky: 1 };
/**
 * Cuántas veces más grande es la cancha que una común (de largo y de ancho).
 * Lo que va en cantidad fija (gente suelta, mesas, autos, vacas, luces) se
 * multiplica por esto: en un x7 no quedan diez personas perdidas.
 */
function more(n, k) { return Math.max(1, Math.round(n * k)); }
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
  const nFlags = more(6, LIVE.kx);
  for (let i = 0; i < nFlags; i++) flagPole(ctx, -W + 40 + i * ((2 * W - 80) / (nFlags - 1)), -H - 112, i % 2 ? BLUE : RED, i % 3 === 0 ? '#f4f1ea' : null);
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
  const nTab = more(6, LIVE.kx);
  for (let i = 0; i < nTab; i++) table(ctx, rnd, -W + 30 + i * ((2 * W - 60) / (nTab - 1)), -H - 80);
  crowd(ctx, rnd, -W + 10, -H - 60, W - 10, -H - 52, o, 17, 10, 0.75);
  // Abajo: bancos, gente esperando y el estacionamiento.
  dugout(ctx, rnd, -150, H + 58, 120, 'Red', o);
  dugout(ctx, rnd, 30, H + 58, 120, 'Blue', o);
  crowd(ctx, rnd, -W + 10, H + 64, -170, H + 100, o, 15, 14, 0.72);
  crowd(ctx, rnd, 170, H + 64, W - 10, H + 100, o, 15, 14, 0.72);
  const nCar = more(9, LIVE.kx);
  for (let i = 0; i < nCar; i++) car(ctx, -W - 40 + i * ((2 * W + 80) / (nCar - 1)), H + 140, 0, pick(rnd, CARS));
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
  const nCow = more(6, LIVE.kx);
  for (let i = 0; i < nCow; i++) {
    const cx = -W + 40 + i * ((2 * W - 80) / (nCow - 1)) + (rnd() - 0.5) * 40, cy = -H - 60 - rnd() * 40, ca = (rnd() - 0.5) * 2.4;
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
  // Deck de madera donde está la gente.
  const deck = (x, y, w, h) => {
    ctx.fillStyle = '#7a5a3e'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let yy = y + 5; yy < y + h; yy += 6) ctx.fillRect(x, yy, w, 1);
  };
  deck(-W - 20, -H - 78, 2 * W + 40, 44);
  deck(-W - 20, H + 34, 2 * W + 40, 44);
  // Sillones con gente en las esquinas.
  for (const [x, y] of [[-W - 100, -H - 40], [W + 100, H + 50]]) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 26, y - 8, 56, 26);
    ctx.fillStyle = '#3d4a5e'; ctx.fillRect(x - 30, y - 12, 56, 26);
    ctx.fillStyle = '#4b5a72'; ctx.fillRect(x - 30, y - 12, 56, 8);
    for (let k = 0; k < 3; k++) person(ctx, rnd, x - 18 + k * 16, y + 4, shirtFor(rnd, x < 0 ? 'Red' : 'Blue'), false, 0.9);
  }
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
  // Las calles que cruzan, detrás de cada arco: por ahí pasa el auto (nunca
  // por encima de la gente).
  const cross = W + 250;
  for (const sx of [-1, 1]) {
    ctx.fillStyle = '#3d4046'; ctx.fillRect(sx * cross - 34, -H - 600, 68, 2 * H + 1200);
    ctx.fillStyle = 'rgba(240,240,230,0.55)';
    for (let y = -H - 600; y < H + 600; y += 30) ctx.fillRect(sx * cross - 1.5, y, 3, 16);
  }
  const clearOf = (x, w) => Math.abs(x + w / 2 - cross) > w / 2 + 40 && Math.abs(x + w / 2 + cross) > w / 2 + 40;
  // Casas de los dos lados (menos donde cruzan las calles).
  for (let x = -W - 420; x < W + 420; x += 0) { const w = 60 + rnd() * 40; if (clearOf(x, w)) house(ctx, rnd, x, -H - 86, w, 90, true, o); x += w + 4; }
  for (let x = -W - 420; x < W + 420; x += 0) { const w = 60 + rnd() * 40; if (clearOf(x, w)) house(ctx, rnd, x, H + 86, w, 90, false, o); x += w + 4; }
  // Árboles en la vereda, autos estacionados en el cordón, vecinos mirando.
  const offStreet = (x) => Math.abs(Math.abs(x) - cross) > 60;
  for (let x = -W - 300; x < W + 300; x += 120) { if (offStreet(x + 30)) tree(ctx, rnd, x + 30, -H - 66, 22); if (offStreet(x + 90)) tree(ctx, rnd, x + 90, H + 66, 22); }
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -W - 70 : W + 70;
    car(ctx, x0, -H - 30, 0, pick(rnd, CARS)); car(ctx, x0 + sx * 60, -H - 30, 0, pick(rnd, CARS));
    car(ctx, x0, H + 26, Math.PI, pick(rnd, CARS)); car(ctx, x0 + sx * 70, H + 26, Math.PI, pick(rnd, CARS));
    // Las «tribunas» son la gente en la esquina.
    scatter(ctx, rnd, x0 - 25, -gap, x0 + 25, -40, 6, o);
    scatter(ctx, rnd, x0 - 25, 40, x0 + 25, gap, 6, o);
    ball(ctx, x0 + sx * 40, 0, 4.5);
  }
  // Vecinos en sillas de plástico en las veredas, mirando el partido.
  for (const y of [-H - 74, H + 58]) {
    for (let x = -W + 20; x < W - 10; x += 34) {
      if (rnd() < 0.3) continue;
      ctx.fillStyle = pick(rnd, ['#e8e2d0', '#3d6ad6', '#c9a24a', '#e86f4a']); ctx.fillRect(x - 6, y - 6, 12, 12);
      person(ctx, rnd, x, y, shirtFor(rnd, x < 0 ? 'Red' : 'Blue'), o.cheer === (x < 0 ? 'Red' : 'Blue'), 0.95);
    }
  }
  crowd(ctx, rnd, -W + 10, -H - 40, W - 10, -H - 28, o, 18, 12, 0.7);
  crowd(ctx, rnd, -W + 10, H + 28, W - 10, H + 38, o, 20, 12, 0.6);
  dog(ctx, W * 0.4, H + 60);
  if (REG) REG.lane = { x: W + 250, y0: -H - 500, y1: H + 500 };
  // Kiosco en la esquina y cables de luz cruzando.
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-W - 160, -H - 60, 60, 36);
  ctx.fillStyle = '#f0c25a'; ctx.fillRect(-W - 164, -H - 64, 60, 36);
  paint(ctx, 'KIOSCO', -W - 134, -H - 46, '900 11px sans-serif', '#7a2f1c', o.mirror);
  ctx.strokeStyle = 'rgba(20,20,20,0.55)'; ctx.lineWidth = 1;
  for (const k of [-0.6, 0.1, 0.7]) { ctx.beginPath(); ctx.moveTo(W * k - 40, -H - 90); ctx.quadraticCurveTo(W * k, 0, W * k + 40, H + 90); ctx.stroke(); }
  // Zapatillas colgadas del cable.
  ctx.fillStyle = '#f1f1ec'; ctx.fillRect(W * 0.1 - 3, -4, 6, 10); ctx.fillRect(W * 0.1 + 4, -2, 6, 10);
  for (let x = -W - 200; x < W + 200; x += 210) { if (offStreet(x)) lampPost(ctx, x, -H - 52, true, 150); if (offStreet(x + 105)) lampPost(ctx, x + 105, H + 52, true, 150); }
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
  crowd(ctx, rnd, -W + 10, -H - 40, W - 10, -H - 28, o, 15, 12, 0.85);
  crowd(ctx, rnd, -W + 10, H + 26, W - 10, H + 64, o, 15, 12, 0.85);
  // Árbol grande con su sombra, el bicicletero y la maestra con el silbato.
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(-W - 110, -H - 10, 70, 46, 0.3, 0, 7); ctx.fill();
  tree(ctx, rnd, -W - 120, -H - 30, 50);
  for (let i = 0; i < 5; i++) bike(ctx, W + 40 + i * 12, -H - 60, Math.PI / 2);
  person(ctx, rnd, -W - 30, H - 30, '#5b3a5e', false, 1.05);
  ctx.fillStyle = '#f0c25a'; ctx.beginPath(); ctx.arc(-W - 24, H - 34, 1.8, 0, 7); ctx.fill();
  const pack = (x, y) => { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 2, y + 2, 12, 14); ctx.fillStyle = pick(rnd, [RED, BLUE, '#3aa37a', '#f0c25a', '#b25ab5']); ctx.fillRect(x, y, 12, 14); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 2, y + 8, 8, 4); };
  for (const sx of [-1, 1]) {
    for (let i = 0; i < more(6, LIVE.ky); i++) pack(sx * (W + 30 + rnd() * 50), -H + rnd() * (H - gap - 20));
    for (let i = 0; i < more(6, LIVE.ky); i++) pack(sx * (W + 30 + rnd() * 50), gap + 10 + rnd() * (H - gap - 20));
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
function fresaDT(ctx, x, y, up, team, mirror, wag = 0, mood = '') {
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
  // Gol en contra: se tapa los ojos con las patitas.
  if (mood === 'sad') {
    ctx.fillStyle = '#7a4a3a';
    ctx.beginPath(); ctx.ellipse(0, -1.5, 2.2, 1.7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = FW;
    ctx.beginPath(); ctx.arc(-3.8, -5, 3.4, 0, 7); ctx.arc(3.8, -5, 3.4, 0, 7); ctx.fill();
    ctx.strokeStyle = FL; ctx.lineWidth = 0.6;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 3.8 - 1.4, -6); ctx.lineTo(sx * 3.8 - 1.4, -3.8); ctx.moveTo(sx * 3.8 + 0.2, -6.4); ctx.lineTo(sx * 3.8 + 0.2, -3.6); ctx.stroke(); }
    ctx.strokeStyle = '#7a4a3a'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-2, 1.6); ctx.quadraticCurveTo(0, 0.2, 2, 1.6); ctx.stroke();
    ctx.restore();
    return;
  }
  // Cara: ojos, nariz y boca (abierta si festeja). Parpadeo y mate: ojos cerraditos.
  if (mood === 'blink' || mood === 'mate') {
    ctx.strokeStyle = '#2a1d16'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(-3.4, -5.6, 1.6, 0.2, Math.PI - 0.2); ctx.moveTo(5, -5.3); ctx.arc(3.4, -5.6, 1.6, 0.2, Math.PI - 0.2); ctx.stroke();
  } else {
    ctx.fillStyle = '#2a1d16';
    ctx.beginPath(); ctx.ellipse(-3.4, -5, 1.6, 1.8, 0, 0, 7); ctx.ellipse(3.4, -5, 1.6, 1.8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-2.9, -5.6, 0.6, 0, 7); ctx.arc(3.9, -5.6, 0.6, 0, 7); ctx.fill();
  }
  ctx.fillStyle = '#7a4a3a';
  ctx.beginPath(); ctx.ellipse(0, -1.5, 2.2, 1.7, 0, 0, 7); ctx.fill();
  // Mate: la calabacita en las patas y la bombilla a la boca.
  if (mood === 'mate') {
    ctx.strokeStyle = '#c9c4b8'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(1, 1); ctx.lineTo(4.5, 6); ctx.stroke();
    ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.ellipse(5.5, 9, 4.2, 3.8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#4c7a2e'; ctx.beginPath(); ctx.ellipse(5.5, 7.4, 2.8, 1.3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = FW; ctx.beginPath(); ctx.arc(1.5, 10.5, 2.8, 0, 7); ctx.arc(9.5, 10.5, 2.8, 0, 7); ctx.fill();
    ctx.strokeStyle = '#7a4a3a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-2, 0.6); ctx.quadraticCurveTo(0, 2, 2, 0.6); ctx.stroke();
    ctx.restore();
    return;
  }
  // Indicando: una pata estirada hacia la cancha.
  if (mood === 'point') {
    ctx.strokeStyle = FS; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(7, 4); ctx.lineTo(15, -12 + wag); ctx.stroke(); ctx.lineCap = 'butt';
    curl(ctx, 15.5, -13 + wag, 3);
  }
  // Gritando: la boca bien abierta y las patas haciendo de megáfono.
  if (mood === 'shout') {
    ctx.fillStyle = '#5a2a2a'; ctx.beginPath(); ctx.ellipse(0, 2.4, 2.6, 2.8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#e8737a'; ctx.beginPath(); ctx.ellipse(0, 3.4, 1.6, 1.4, 0, 0, 7); ctx.fill();
    curl(ctx, -4.6, 2.2, 2.8); curl(ctx, 4.6, 2.2, 2.8);
    ctx.restore();
    return;
  }
  if (up) {
 ctx.fillStyle = '#e8737a'; ctx.beginPath(); ctx.ellipse(0, 2, 1.8, 2.4, 0, 0, 7); ctx.fill(); }
  else { ctx.strokeStyle = '#7a4a3a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-2, 0.6); ctx.quadraticCurveTo(0, 2, 2, 0.6); ctx.stroke(); }
  // Empate: se rasca la cabeza con una pata y le sale un signo de pregunta.
  if (mood === 'scratch') {
    ctx.strokeStyle = FS; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(9, 3); ctx.lineTo(10 + wag, -10); ctx.stroke();
    curl(ctx, 10 + wag, -11, 3);
    paint(ctx, '?', 15, -20, '900 9px sans-serif', '#f0c25a', mirror);
  }
  ctx.restore();
}

/**
 * Fresa caminando la línea, vista de arriba: el cuerpo de costado, las cuatro
 * patas alternando (`f` 0/1) y la gorra. `dir`: 1 hacia la derecha, -1 a la izquierda.
 */
function fresaWalk(ctx, team, mirror, f, dir) {
  ctx.save();
  ctx.scale(1.15 * dir, 1.15);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(2, 7, 18, 7, 0, 0, 7); ctx.fill();
  // Patas: diagonales juntas, como camina un perro.
  ctx.fillStyle = FW;
  const a = f ? 3 : -3;
  for (const [px, py, s2] of [[8, -6, 1], [8, 7, -1], [-9, -6, -1], [-9, 7, 1]]) { ctx.beginPath(); ctx.arc(px + a * s2, py, 2.8, 0, 7); ctx.fill(); }
  // Cola arriba, con el pompón.
  ctx.strokeStyle = FS; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-12, 0); ctx.quadraticCurveTo(-18, -2 + a * 0.6, -20, -5 + a); ctx.stroke();
  curl(ctx, -20.5, -6 + a, 3.2);
  ctx.fillStyle = FS; ctx.beginPath(); ctx.ellipse(-1, 0, 14, 8.5, 0, 0, 7); ctx.fill();
  for (const [cx, cy] of [[-9, -4], [-9, 4], [-3, -6], [-3, 6], [3, -6], [3, 6], [-12, 0]]) curl(ctx, cx, cy, 3.4);
  // Orejas que se bambolean y la cabeza.
  ctx.fillStyle = FS;
  ctx.beginPath(); ctx.ellipse(10, -7 - a * 0.3, 5, 3.6, 0.3, 0, 7); ctx.ellipse(10, 7 + a * 0.3, 5, 3.6, -0.3, 0, 7); ctx.fill();
  ctx.fillStyle = FW; ctx.beginPath(); ctx.arc(14, 0, 7.5, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(20, 0, 4.2, 3.2, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#7a4a3a'; ctx.beginPath(); ctx.arc(23.5, 0, 1.7, 0, 7); ctx.fill();
  // Gorra vista de arriba, la visera para adelante.
  ctx.fillStyle = team === 'Blue' ? '#2d55b0' : '#b83a3a';
  ctx.beginPath(); ctx.ellipse(19, 0, 3.2, 6, 0, -Math.PI / 2, Math.PI / 2); ctx.fill();
  ctx.fillStyle = team === 'Blue' ? BLUE : RED; ctx.beginPath(); ctx.arc(13, 0, 6.2, 0, 7); ctx.fill();
  ctx.restore();
  paint(ctx, 'TL', 13 * 1.15 * dir, 0, '900 5px sans-serif', '#ffffff', mirror);
}

/** Globito de diálogo con el texto (respeta el espejo). */
function bubble(g, text, mirror, color = '#1f2329') {
  g.font = '900 8px sans-serif';
  const w = Math.max(22, g.measureText(text).width + 10), h = 13;
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-w / 2 + 1.5, -h / 2 + 2, w, h);
  g.fillStyle = '#ffffff';
  g.beginPath();
  if (g.roundRect) g.roundRect(-w / 2, -h / 2, w, h, 4); else g.rect(-w / 2, -h / 2, w, h);
  g.fill();
  g.beginPath(); g.moveTo(-w / 2 + 6, h / 2 - 0.5); g.lineTo(-w / 2 + 3, h / 2 + 5); g.lineTo(-w / 2 + 11, h / 2 - 0.5); g.fill();
  paint(g, text, 0, 0.5, '900 8px sans-serif', color, mirror, w - 6);
}

/** La pizarra con la jugada que está marcando (globito de táctica). */
function tacticBubble(g, mirror, k) {
  const w = 30, h = 20;
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-w / 2 + 1.5, -h / 2 + 2, w, h);
  g.fillStyle = '#f4f1ea'; g.fillRect(-w / 2, -h / 2, w, h);
  g.strokeStyle = '#3a3f48'; g.lineWidth = 1; g.strokeRect(-w / 2, -h / 2, w, h);
  g.beginPath(); g.moveTo(-w / 2 + 4, h / 2); g.lineTo(-w / 2 + 2, h / 2 + 5); g.lineTo(-w / 2 + 9, h / 2); g.fillStyle = '#f4f1ea'; g.fill();
  g.save(); if (mirror) g.scale(-1, 1);
  const r = seeded(170 + k);
  g.fillStyle = RED; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(-10 + r() * 8, -6 + i * 6, 1.6, 0, 7); g.fill(); }
  g.fillStyle = BLUE; for (let i = 0; i < 2; i++) { g.beginPath(); g.arc(4 + r() * 6, -4 + i * 8, 1.6, 0, 7); g.fill(); }
  g.strokeStyle = '#d24a4a'; g.lineWidth = 1; g.setLineDash([2, 1.5]);
  g.beginPath(); g.moveTo(-8, 4); g.quadraticCurveTo(0, -8 + r() * 6, 10, 0); g.stroke(); g.setLineDash([]);
  g.beginPath(); g.moveTo(10, 0); g.lineTo(7, -1.5); g.moveTo(10, 0); g.lineTo(8, 2.5); g.stroke();
  g.restore();
}

/** La nubecita que le llueve encima con el gol en contra. */
function sadCloud(g, f) {
  g.fillStyle = '#8e97a3';
  for (const [x, y, r] of [[-5, 0, 4.5], [0, -2, 5.5], [5, 0, 4.5], [0, 1.5, 4.5]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(120,170,230,0.9)'; g.lineWidth = 1;
  g.beginPath();
  for (const x of [-5, -1, 3, 6]) { const y0 = 6 + (((x + f * 3) % 4) + 4) % 4; g.moveTo(x, y0); g.lineTo(x - 0.8, y0 + 3); }
  g.stroke();
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
  barrio: (W, H, t) => [t === 'Blue' ? 26 : -26, H + 38, false, 0],
  led: (W, H, t) => [t === 'Blue' ? 8 : -8, H + 46, false, 0],
  f5: (W, H, t) => [t === 'Blue' ? 14 : -14, H + 70, false, 0],
  estadio: (W, H, t) => [t === 'Blue' ? 30 : -30, H + 44, false, 0],
  noche: (W, H, t) => [t === 'Blue' ? W * 0.45 : -W * 0.45, H + 84, true, 50],
  playa: (W, H, t) => [t === 'Blue' ? W * 0.5 : -W * 0.5, H + 66, true, 44],
  campo: (W, H, t) => [t === 'Blue' ? 20 : -20, H + 76, true, 34],
  azotea: (W, H, t) => [t === 'Blue' ? W * 0.5 : -W * 0.5, H + 84, true, 50],
  cortada: (W, H, t) => [t === 'Blue' ? W * 0.3 : -W * 0.3, H + 34, true, 40],
  colegio: (W, H, t) => [t === 'Blue' ? W * 0.5 : -W * 0.5, H + 76, true, 46]
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
  key = LIVE.pk + key;
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

/*
 * La tribuna como bloque vivo. Cada bloque de gente se arma como imagen en
 * tres versiones —quieta A, quieta B (todos corridos un pelito, algunos con
 * los brazos arriba) y todos arriba— y en cada cuadro se pega: alternar A y B
 * la hace respirar, y pegar «arriba» recortado a una franja que avanza es la
 * ola. Nadie aparece suelto: se mueve la tribuna entera.
 */
const BLOCKS = new Map();
let blocksScene = '';
const B_PX = 1.6;

function crowdBlock(B, mode, tag) {
  const key = `${B.seed}|${B.density}|${mode}|${tag}`;
  let bl = BLOCKS.get(key);
  if (bl) return bl;
  const pad = 14;
  const w = B.x1 - B.x0 + pad * 2, h = B.y1 - B.y0 + pad * 2;
  const cv = mkCanvas(Math.ceil(w * B_PX), Math.ceil(h * B_PX));
  const g = cv.getContext('2d');
  g.setTransform(B_PX, 0, 0, B_PX, (pad - B.x0) * B_PX, (pad - B.y0) * B_PX);
  const rnd = seeded(B.seed);
  const jit = seeded(B.seed + (mode === 'b' ? 7919 : mode === 'up' ? 104729 : 1));
  for (let y = B.y0; y <= B.y1; y += B.gapY) {
    const shift = (Math.round((y - B.y0) / B.gapY) % 2) * B.gapX * 0.5;
    for (let x = B.x0 + shift; x <= B.x1; x += B.gapX) {
      if (rnd() > B.density) continue;
      const px = x + (rnd() - 0.5) * B.gapX * 0.35;
      const py = y + (rnd() - 0.5) * 3;
      const team = px < 0 ? 'Red' : 'Blue';
      const shirt = shirtFor(rnd, team);
      const look = rnd() * 1e9;
      const dx = mode === 'a' ? 0 : (jit() - 0.5) * 1.6, dy = mode === 'a' ? 0 : (jit() - 0.5) * 1.4;
      const up = mode === 'up' ? jit() < 0.9 : jit() < 0.04;
      person(g, seeded(look), px + dx, py + dy - (up ? 1.5 : 0), shirt, up);
    }
  }
  // De noche, la gente se oscurece igual que el resto del fondo.
  if (tag.includes('n')) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(6,10,24,0.5)';
    g.fillRect(0, 0, cv.width, cv.height);
  }
  bl = { cv, x: B.x0 - pad, y: B.y0 - pad, w, h };
  BLOCKS.set(key, bl);
  return bl;
}

function drawBlock(ctx, bl, dy = 0) {
  ctx.drawImage(bl.cv, bl.x, bl.y + dy, bl.w, bl.h);
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
  const { W0, W, H, gap } = envDims(bounds);
  LIVE.gap = gap;
  useKits(o.kits);
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
    ctx.rect(-W0, -H, 2 * W0, 2 * H);
    ctx.clip('evenodd');
    // La tribuna: respira (A/B), pasa la ola cada tanto y en el gol salta la del que metió.
    const tag = `${LIVE.wet ? 'w' : ''}${LIVE.snow ? 's' : ''}${night ? 'n' : ''}${LIVE.pk}`;
    if (blocksScene !== id + tag) { BLOCKS.clear(); blocksScene = id + tag; }
    const beat = Math.floor(t / 420) % 2;
    const wf = (t % 24000) / 24000;
    const waveX = wf < 0.4 ? -W - 300 + (wf / 0.4) * (2 * W + 600) : NaN;
    for (const B of reg.crowds) {
      if (!see((B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, Math.max(B.x1 - B.x0, B.y1 - B.y0) / 2 + 20)) continue;
      const cheering = o.hot && o.cheer;
      drawBlock(ctx, crowdBlock(B, beat ? 'b' : 'a', tag)); n++;
      // Festejo: la mitad del que metió, toda arriba y saltando.
      if (cheering) {
        const side = o.cheer === 'Red' ? -1 : 1;
        ctx.save();
        ctx.beginPath(); ctx.rect(side < 0 ? B.x0 - 20 : 0, B.y0 - 30, side < 0 ? -B.x0 + 20 : B.x1 + 20, B.y1 - B.y0 + 60); ctx.clip();
        drawBlock(ctx, crowdBlock(B, 'up', tag), -Math.abs(Math.sin(t / 150)) * 2.5);
        ctx.restore(); n++;
      } else if (waveX === waveX && waveX + 50 > B.x0 && waveX - 50 < B.x1) {
        // La ola: una franja que avanza con todos arriba.
        ctx.save();
        ctx.beginPath(); ctx.rect(waveX - 50, B.y0 - 30, 100, B.y1 - B.y0 + 60); ctx.clip();
        drawBlock(ctx, crowdBlock(B, 'up', tag), -2);
        ctx.restore(); n++;
      }
    }
    // Gol: papelitos, bengalas y humo del color del equipo sobre su tribuna.
    if (o.hot && (o.cheer === 'Red' || o.cheer === 'Blue')) {
      const ph = Math.floor(t / 170) % 3;
      for (const B of reg.crowds) {
        const cx = (B.x0 + B.x1) / 2;
        if ((o.cheer === 'Red' ? B.x0 >= 0 : B.x1 <= 0) || !see(cx, (B.y0 + B.y1) / 2, Math.max(B.x1 - B.x0, B.y1 - B.y0) / 2 + 60)) continue;
        drawBlock(ctx, fiestaBlock(B, o.cheer, ph, LIVE.pk)); n++;
      }
    }
    // Los trapos colgados y los LED van arriba de la gente.
    for (const T of reg.trapos) {
      if (!see(T.x + T.w / 2, T.y + T.h / 2, T.w / 2 + 6)) continue;
      const sp = sprite(`tr${T.kind}${T.text}${T.w}x${T.h}${o.mirror ? 1 : 0}${night ? 1 : 0}`, Math.max(T.w, T.h) / 2 + 4, (g) => {
        REG = { __inTrapo: true };
        try { trapo(g, -T.w / 2, -T.h / 2, T.w, T.h, T.kind, T.text, !!o.mirror); } finally { REG = null; }
        if (night) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(6,10,24,0.5)'; g.fillRect(0, 0, 9999, 9999); }
      });
      stamp(ctx, sp, T.x + T.w / 2, T.y + T.h / 2); n++;
    }
    // LED con el texto corriendo.
    for (const L of reg.leds) {
      const cx = L.vertical ? L.x + L.h / 2 : L.x + L.w / 2, cy = L.vertical ? L.y + L.w / 2 : L.y + L.h / 2;
      if (!see(cx, cy, Math.max(L.w, L.h) / 2 + 4)) continue;
      aliveLed(ctx, L, t, o.mirror); n++;
    }
    ctx.globalAlpha = night ? 0.62 : 1;
    // Banderazos: banderas grandes flameando adentro de la tribuna, de cada hinchada.
    for (const B of reg.crowds) {
      const span = B.x1 - B.x0;
      // Banderazos sólo con la tribuna bastante llena: en una vacía quedan flotando.
      if (span < 150 || B.y1 - B.y0 < 20 || B.density < 0.55) continue;
      const k = Math.max(1, Math.floor(span / 260));
      for (let i = 0; i < k; i++) {
        const fx = B.x0 + ((i + 0.5) / k) * span + (hash01(B.seed % 997 + i) - 0.5) * 40;
        const fy = B.y0 + (B.y1 - B.y0) * (0.3 + hash01(B.seed % 991 + i * 3) * 0.4);
        if (!see(fx + 20, fy, 40)) continue;
        const team = fx < 0 ? 'Red' : 'Blue';
        ctx.save(); ctx.translate(fx, fy); ctx.scale(1.5, 1.5);
        flagWave(ctx, 0, 0, team === 'Red' ? RED : BLUE, i % 2 ? '#f4f1ea' : null, t + i * 400);
        ctx.restore(); n++;
      }
    }
    // Lamparitas que titilan.
    for (const [i, [x, y]] of reg.bulbs.entries()) {
      if (hash01(Math.floor(t / 220) + i * 1.7) > 0.22 || !see(x, y, 6)) continue;
      ctx.fillStyle = 'rgba(255,230,170,0.55)'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff6d8'; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); n++;
    }
    // Una bandada que cruza de día (no en los de noche).
    if (!night && !['noche', 'azotea'].includes(id)) {
      const f = (t % 30000) / 30000;
      if (f < 0.5) {
        const bx = -W - 500 + (f / 0.5) * (2 * W + 1000), by = -H - 120 + Math.sin(f * 9) * 20;
        for (let k = 0; k < 5; k++) {
          const x = bx - k * 14 - (k % 2) * 4, y = by + (k % 2 ? 10 : -6) * Math.ceil(k / 2);
          if (!see(x, y, 10)) continue;
          ctx.strokeStyle = 'rgba(40,40,40,0.75)'; ctx.lineWidth = 1.4;
          const fl = 2 + Math.sin(t / 110 + k) * 2.5;
          ctx.beginPath(); ctx.moveTo(x - 5, y - fl); ctx.quadraticCurveTo(x - 2, y - 2, x, y); ctx.quadraticCurveTo(x + 2, y - 2, x + 5, y - fl); ctx.stroke(); n++;
        }
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
      if (C.kind) stamp(ctx, sprite(`horse${C.seed}`, 32, (g) => horse(g, 0, 0, C.a, C.kind)), x, y);
      else stamp(ctx, sprite(`cow${C.seed}`, 28, (g) => cow(g, seeded(C.seed), 0, 0, C.a)), x, y);
      n++;
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
      // Por la calle que cruza: uno sube por un lado y otro baja por el otro.
      for (const [k, sx] of [[0, 1], [1, -1]]) {
        const f = ((t + k * 4500) % 9000) / 9000;
        const y = sx > 0 ? reg.lane.y0 + f * (reg.lane.y1 - reg.lane.y0) : reg.lane.y1 - f * (reg.lane.y1 - reg.lane.y0);
        const x = sx * reg.lane.x + (sx > 0 ? 14 : -14);
        if (see(x, y, 30)) { stamp(ctx, sprite(`car${k}`, 26, (g) => car(g, 0, 0, 0, k ? '#c9a24a' : '#a33a33')), x, y, sx > 0 ? Math.PI / 2 : -Math.PI / 2); n++; }
      }
    }
    // Fogones: el fuego cambia de cuadro.
    for (const [i, F] of reg.fires.entries()) {
      if (!see(F.x, F.y, 28)) continue;
      const k = (Math.floor(t / 110) + i) % 3;
      const a0 = ctx.globalAlpha; ctx.globalAlpha = 1;
      stamp(ctx, sprite(`fire${k}`, 27, (g) => fireFrame(g, k)), F.x, F.y); n++;
      ctx.globalAlpha = a0;
    }
    // Surfistas que suben y bajan con las olas.
    for (const S of reg.surfers) {
      const x = S.x + Math.sin(t / 5200 + S.k * 2) * 30, y = S.y + Math.sin(t / 900 + S.k) * 3;
      if (!see(x, y, 16)) continue;
      stamp(ctx, sprite(`surf${S.k}`, 16, (g) => surferShape(g, S.k)), x, y); n++;
    }
    // El barrilete: hace ochos en el viento, con el hilo hasta el que lo remonta.
    if (reg.kite) {
      const K = reg.kite;
      const kx = K.x + 70 + Math.sin(t / 1700) * 40, ky = K.y - 120 + Math.sin(t / 850) * 18;
      if (see(kx, ky, 40) || see(K.x, K.y, 10)) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(K.x + 4, K.y - 4); ctx.quadraticCurveTo(K.x + 50, K.y - 40, kx, ky + 14); ctx.stroke();
        ctx.strokeStyle = 'rgba(240,194,90,0.85)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(kx, ky + 16); for (let k = 1; k < 5; k++) ctx.lineTo(kx + Math.sin(t / 200 + k) * 5, ky + 16 + k * 7); ctx.stroke();
        stamp(ctx, sprite(`kite${K.color}`, 20, (g) => kiteShape(g, K.color)), kx, ky); n++;
      }
    }
    // Luces rojas de las antenas.
    if (Math.floor(t / 700) % 2) {
      for (const [x, y] of reg.beacons) {
        if (!see(x, y, 8)) continue;
        ctx.fillStyle = 'rgba(255,60,48,0.35)'; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
        ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill(); n++;
      }
    }
    // Hamacas.
    for (const S of reg.swings) {
      const x = S.x + Math.sin(t / 620 + S.i * 1.9) * 12;
      if (!see(x, S.y, 12)) continue;
      stamp(ctx, sprite(`sw${S.i}`, 11, (g) => { const r = seeded(900 + S.i); person(g, r, 0, 0, '#f1f1ec', false, 0.8); }), x, S.y); n++;
    }
    // El ecualizador del DJ.
    if (reg.dj && see(reg.dj.x + 12, reg.dj.y, 20)) {
      for (let i = 0; i < 6; i++) {
        const hgt = 3 + Math.floor(hash01(Math.floor(t / 130) * 1.3 + i * 7.7) * 12);
        ctx.fillStyle = i < 3 ? '#4ae0c9' : '#e94ad8'; ctx.fillRect(reg.dj.x + i * 4, reg.dj.y + 28 - hgt, 3, hgt);
      }
      n++;
    }
    // Fresa: tiene su rutina de DT y reacciona al partido.
    if (reg.fresa && see(reg.fresa.x, reg.fresa.y, 60 + (reg.fresa.walk || 0))) n += fresaAlive(ctx, reg.fresa, t, o, night);
  } finally {
    ctx.restore();
  }
  return n;
}

/* ── Segunda tanda: más cosas en cada escenario ──────────────────────── */

/** Torre de luz: base de reticulado, banco de focos mirando a la cancha y la luz que tira. */
function floodTower(ctx, x, y, ax = 0, ay = 0) {
  const a = Math.atan2(ay - y, ax - x);
  LIGHTS.push({ x: x + Math.cos(a) * 60, y: y + Math.sin(a) * 60, warm: false, reach: 240 });
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lx = x + Math.cos(a) * 150, ly = y + Math.sin(a) * 150;
  const g = ctx.createRadialGradient(lx, ly, 10, lx, ly, 240);
  g.addColorStop(0, 'rgba(210,228,255,0.11)');
  g.addColorStop(1, 'rgba(210,228,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(lx - 240, ly - 240, 480, 480);
  ctx.restore();
  ctx.save();
  ctx.translate(x, y);
  // La sombra larga de la torre, para el lado de afuera.
  ctx.save(); ctx.rotate(a + Math.PI); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(4, -4, 80, 8); ctx.restore();
  ctx.fillStyle = '#353a42'; ctx.fillRect(-8, -8, 16, 16);
  ctx.strokeStyle = '#7a8390'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(8, 8); ctx.moveTo(8, -8); ctx.lineTo(-8, 8); ctx.stroke();
  ctx.strokeRect(-8, -8, 16, 16);
  ctx.rotate(a);
  ctx.fillStyle = '#1d2026'; ctx.fillRect(-1, -24, 13, 48);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = '#eef5ff'; ctx.fillRect(1 + j * 5, -21 + i * 11, 4, 9); }
  ctx.fillStyle = 'rgba(225,238,255,0.28)';
  ctx.beginPath(); ctx.ellipse(16, 0, 9, 27, 0, 0, 7); ctx.fill();
  ctx.restore();
}

/** Algo con sombra suave (techos, edificios): el dibujo va una vez, no cuesta. */
function shadowed(ctx, draw, blur = 9) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = blur; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 6;
  draw();
  ctx.restore();
}

/** Fogón en un tacho: el fuego tiene tres cuadros (la capa viva los alterna). */
function fireFrame(g, k) {
  const gl = g.createRadialGradient(0, 0, 2, 0, 0, 26);
  gl.addColorStop(0, 'rgba(255,196,90,0.5)'); gl.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = gl; g.beginPath(); g.arc(0, 0, 26, 0, 7); g.fill();
  g.fillStyle = '#3c3c3c'; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill();
  g.fillStyle = '#242424'; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill();
  const r = seeded(31 + k * 7);
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 3 === 0 ? '#ff6a1e' : i % 2 ? '#ff9a2e' : '#ffd86a'; g.beginPath(); g.arc((r() - 0.5) * 9, (r() - 0.5) * 9 - 1, 1.8 + r() * 3, 0, 7); g.fill(); }
}
function fire(ctx, x, y) {
  if (REG) REG.fires.push({ x, y });
  if (LIVE.alive) return;
  ctx.save(); ctx.translate(x, y); fireFrame(ctx, 0); ctx.restore();
}

/** Carrito de choripán con su parrillita, el humo y la cola. */
function choriCart(ctx, rnd, x, y, o, mirror) {
  shadowed(ctx, () => { ctx.fillStyle = '#e8e2d0'; ctx.fillRect(x - 30, y - 16, 60, 32); });
  ctx.fillStyle = '#b23a3a'; ctx.fillRect(x - 30, y - 16, 60, 8);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#f4f1ea' : '#b23a3a'; ctx.fillRect(x - 30 + i * 10, y - 22, 10, 6); }
  ctx.fillStyle = '#2a2523'; ctx.fillRect(x - 24, y - 4, 26, 14);
  ctx.fillStyle = '#8a3a22'; for (let i = 0; i < 4; i++) ctx.fillRect(x - 22 + i * 6, y - 2, 4, 10);
  paint(ctx, 'CHORI', x + 15, y + 3, '900 8px sans-serif', '#b23a3a', mirror);
  if (REG) REG.smoke.push({ x: x - 12, y: y - 10 });
  for (let k = 0; k < 4; k++) person(ctx, rnd, x + 44 + k * 15, y + 6 + (k % 2) * 4, shirtFor(rnd, x < 0 ? 'Red' : 'Blue'), false, 0.95);
}

/** Soga con ropa colgada (en las terrazas del barrio). */
function clothesline(ctx, rnd, x, y, w) {
  ctx.strokeStyle = 'rgba(230,230,230,0.6)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
  for (let i = 4; i < w - 6; i += 9 + rnd() * 6) {
    ctx.fillStyle = pick(rnd, ['#e86f4a', '#f4f1ea', '#4a7fd8', '#f0c25a', '#3aa37a', RED, BLUE]);
    ctx.fillRect(x + i, y - 1, 6 + rnd() * 3, 5 + rnd() * 4);
  }
}

/** Banderines: una tira de triangulitos de los dos colores. */
function bunting(ctx, x0, y0, x1, y1, sag) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + sag;
  ctx.strokeStyle = 'rgba(30,30,30,0.6)'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke();
  const n = Math.max(4, Math.round(Math.hypot(x1 - x0, y1 - y0) / 11));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
    const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;
    ctx.fillStyle = i % 3 === 2 ? '#f4f1ea' : i % 3 ? BLUE : RED;
    ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 7); ctx.fill();
  }
}

function horse(ctx, x, y, a, coat) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(4, 5, 22, 9, 0, 0, 7); ctx.fill();
  ctx.fillStyle = coat;
  ctx.beginPath(); ctx.ellipse(0, 0, 19, 8, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(21, 0, 9, 4.2, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#231710'; ctx.fillRect(9, -1.4, 15, 2.8);
  ctx.strokeStyle = '#231710'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-19, 0); ctx.lineTo(-28, 2); ctx.stroke(); ctx.lineCap = 'butt';
  ctx.restore();
}

function tractor(ctx, x, y, a) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-20, -14, 46, 32);
  ctx.fillStyle = '#1e1e1e'; ctx.fillRect(-22, -17, 16, 8); ctx.fillRect(-22, 9, 16, 8); ctx.fillRect(10, -13, 10, 5); ctx.fillRect(10, 8, 10, 5);
  ctx.fillStyle = '#c0392b'; ctx.fillRect(-18, -9, 40, 18);
  ctx.fillStyle = '#e8e2d0'; ctx.fillRect(-16, -7, 14, 14);
  ctx.fillStyle = '#333'; ctx.fillRect(12, -3, 4, 3);
  ctx.restore();
}

/** Garita del guardavidas con su bandera. */
function lifeguard(ctx, rnd, x, y) {
  shadowed(ctx, () => { ctx.fillStyle = '#c94a3a'; ctx.fillRect(x - 16, y - 16, 32, 32); });
  ctx.fillStyle = '#f4f1ea'; ctx.fillRect(x - 16, y - 16, 32, 7); ctx.fillRect(x - 16, y + 2, 32, 5);
  ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x - 16, y + 16); ctx.lineTo(x - 22, y + 34); ctx.moveTo(x + 16, y + 16); ctx.lineTo(x + 22, y + 34); ctx.stroke();
  person(ctx, rnd, x, y + 26, '#e33b2e', false, 0.95);
  flagPole(ctx, x + 20, y - 26, '#e33b2e', '#f0c25a');
}

function sandCastle(ctx, x, y) {
  ctx.fillStyle = 'rgba(120,90,40,0.3)'; ctx.beginPath(); ctx.arc(x + 3, y + 3, 15, 0, 7); ctx.fill();
  ctx.fillStyle = '#c7a868'; ctx.fillRect(x - 12, y - 12, 24, 24);
  ctx.fillStyle = '#b8995a'; for (const [dx, dy] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, 5, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#d4b878'; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
  ctx.fillStyle = '#e33b2e'; ctx.fillRect(x, y - 10, 5, 3);
}

/** Tabla de surf con el surfista (la capa viva lo hace subir y bajar con las olas). */
function surferShape(g, k) {
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(-12, 0, 10, 3, 0, 0, 7); g.fill();
  g.fillStyle = k % 2 ? '#f0c25a' : '#f4f1ea'; g.beginPath(); g.ellipse(0, 0, 13, 4, 0, 0, 7); g.fill();
  g.fillStyle = '#e33b2e'; g.fillRect(-10, -0.6, 20, 1.2);
  const r = seeded(60 + k);
  person(g, r, 1, 0, pick(r, ['#1f1f1f', '#2c4f8a', '#3aa37a']), false, 0.8);
}

/** Barrilete (de rombo, con cola). */
function kiteShape(g, color) {
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.moveTo(6, -6); g.lineTo(16, 6); g.lineTo(6, 22); g.lineTo(-4, 6); g.fill();
  g.fillStyle = color; g.beginPath(); g.moveTo(0, -12); g.lineTo(10, 0); g.lineTo(0, 16); g.lineTo(-10, 0); g.fill();
  g.fillStyle = '#f4f1ea'; g.beginPath(); g.moveTo(0, -12); g.lineTo(10, 0); g.lineTo(0, 0); g.fill(); g.beginPath(); g.moveTo(0, 16); g.lineTo(-10, 0); g.lineTo(0, 0); g.fill();
}

/** Hamacas del patio (los chicos los mueve la capa viva). */
function swings(ctx, rnd, x, y, n) {
  shadowed(ctx, () => { ctx.fillStyle = '#4a7fd8'; ctx.fillRect(x - 3, y - 6, 6, n * 26 + 12); });
  ctx.fillStyle = '#e86f4a'; ctx.fillRect(x - 6, y - 8, 12, 5); ctx.fillRect(x - 6, y + n * 26 + 3, 12, 5);
  for (let i = 0; i < n; i++) {
    const sy = y + 13 + i * 26;
    ctx.strokeStyle = 'rgba(40,40,40,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, sy - 6); ctx.lineTo(x - 18, sy - 6); ctx.moveTo(x, sy + 6); ctx.lineTo(x - 18, sy + 6); ctx.stroke();
    if (REG) REG.swings.push({ x: x - 20, y: sy, i });
    if (!LIVE.alive) person(ctx, rnd, x - 20, sy, '#f1f1ec', false, 0.8);
  }
}

/** Antena con la luz roja que titila (la titila la capa viva). */
function antenna(ctx, x, y) {
  ctx.strokeStyle = '#8a8f96'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 10, y - 16); ctx.moveTo(x + 4, y - 7); ctx.lineTo(x + 10, y - 4); ctx.stroke();
  ctx.fillStyle = '#ff3b30'; ctx.beginPath(); ctx.arc(x + 10, y - 16, 1.8, 0, 7); ctx.fill();
  if (REG) REG.beacons.push([x + 10, y - 16]);
}

/** Cabina del DJ con parlantes. */
function djBooth(ctx, x, y, mirror) {
  shadowed(ctx, () => { ctx.fillStyle = '#16181d'; ctx.fillRect(x - 18, y - 34, 36, 68); });
  ctx.strokeStyle = '#c94ad8'; ctx.lineWidth = 1.5; ctx.strokeRect(x - 18, y - 34, 36, 68);
  for (const dy of [-46, 46]) { ctx.fillStyle = '#0d0e11'; ctx.fillRect(x - 12, y + dy - 9, 24, 18); ctx.fillStyle = '#2a2d34'; ctx.beginPath(); ctx.arc(x, y + dy, 7, 0, 7); ctx.fill(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y + dy, 3, 0, 7); ctx.fill(); }
  paint(ctx, 'DJ', x, y - 24, '900 9px sans-serif', '#e9a7f2', mirror);
  if (REG) REG.dj = { x: x - 12, y: y - 14 };
  if (!LIVE.alive) for (let i = 0; i < 6; i++) { ctx.fillStyle = i < 3 ? '#4ae0c9' : '#e94ad8'; ctx.fillRect(x - 12 + i * 4, y + 14 - 4 - i * 2, 3, 4 + i * 2); }
  person(ctx, seeded(77), x + 24, y, '#1f1f1f', false, 0.95);
}

/** Pileta del club con andariveles y alguno nadando. */
function pool(ctx, rnd, x, y, w, h) {
  shadowed(ctx, () => { ctx.fillStyle = '#d8d3c4'; ctx.fillRect(x - 8, y - 8, w + 16, h + 16); });
  ctx.fillStyle = '#3aa6c9'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; for (let i = 0; i < 18; i++) ctx.fillRect(x + rnd() * (w - 20), y + rnd() * (h - 4), 14 + rnd() * 10, 1.5);
  for (let j = 1; j < 4; j++) { ctx.strokeStyle = j % 2 ? 'rgba(240,80,60,0.8)' : 'rgba(255,255,255,0.8)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y + (j * h) / 4); ctx.lineTo(x + w, y + (j * h) / 4); ctx.stroke(); }
  ctx.setLineDash([]);
  for (let i = 0; i < 4; i++) { const sx = x + 10 + rnd() * (w - 20), sy = y + (Math.floor(rnd() * 4) + 0.5) * (h / 4); ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.ellipse(sx - 6, sy, 6, 2.5, 0, 0, 7); ctx.fill(); ctx.fillStyle = pick(rnd, SKIN); ctx.beginPath(); ctx.arc(sx, sy, 3, 0, 7); ctx.fill(); ctx.fillStyle = pick(rnd, ['#e33b2e', '#f0c25a', '#1f1f1f']); ctx.beginPath(); ctx.arc(sx, sy - 0.6, 3, Math.PI, 0); ctx.fill(); }
  ctx.strokeStyle = '#f0c25a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + w - 18, y + 14, 6, 0, 7); ctx.stroke();
}

/** La casa de campo: techo de chapa, galería y el aljibe. */
function farmhouse(ctx, x, y, w, h) {
  shadowed(ctx, () => { ctx.fillStyle = '#9aa0a3'; ctx.fillRect(x, y, w, h); }, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; for (let i = 0; i < w; i += 6) ctx.fillRect(x + i, y, 2, h);
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x, y + h / 2 - 1, w, 2);
  ctx.fillStyle = '#7a5a3a'; ctx.fillRect(x, y + h, w, 16);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 6; i < w; i += 22) ctx.fillRect(x + i, y + h, 3, 16);
  ctx.fillStyle = '#e8e0cc'; ctx.beginPath(); ctx.arc(x + w + 26, y + h - 6, 10, 0, 7); ctx.fill();
  ctx.fillStyle = '#2a4a5a'; ctx.beginPath(); ctx.arc(x + w + 26, y + h - 6, 6, 0, 7); ctx.fill();
}

/** Un micro del equipo, estacionado. */
function bus(ctx, x, y, a, color, mirror) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-56, -12, 118, 34);
  ctx.fillStyle = '#ecebe6'; ctx.fillRect(-60, -16, 120, 32);
  ctx.fillStyle = color; ctx.fillRect(-60, -4, 120, 8);
  ctx.fillStyle = 'rgba(30,40,55,0.8)'; ctx.fillRect(48, -14, 10, 28);
  ctx.fillStyle = '#9aa0a8'; ctx.fillRect(-30, -10, 14, 8); ctx.fillRect(10, -10, 14, 8);
  ctx.restore();
  paint(ctx, 'TL', x, y, '900 12px sans-serif', '#ffffff', mirror);
}

const EXTRA = {
  noche(ctx, W, H, o, rnd) {
    const gap = goalGap(H);
    for (let i = 0; i < more(9, LIVE.kx); i++) clothesline(ctx, rnd, -W - 200 + rnd() * (2 * W + 320), (rnd() < 0.5 ? -H - 150 : H + 145) + rnd() * 18, 34 + rnd() * 20);
    choriCart(ctx, rnd, -W - 190, -10, o, o.mirror);
    // Fogón en un tacho con los que se calientan alrededor.
    const fx = W + 200, fy = -gap - 40;
    fire(ctx, fx, fy);
    for (let k = 0; k < 5; k++) { const a = k * 1.25 + 0.3; person(ctx, rnd, fx + Math.cos(a) * 24, fy + Math.sin(a) * 20, shirtFor(rnd, 'Blue'), false, 0.95); }
    dog(ctx, W + 170, gap + 30);
  },
  barrio(ctx, W, H, o, rnd) {
    pool(ctx, rnd, -W - 380, -H - 30, 150, 90);
    for (let i = 0; i < 3; i++) { ctx.fillStyle = pick(rnd, ['#f0c25a', '#e86f4a', '#4a7fd8']); ctx.fillRect(-W - 220, -H - 20 + i * 26, 22, 10); }
    grill(ctx, rnd, -W - 230, H + 40, o);
    if (REG) REG.kids.push({ x: W + 220, y: 0, sx: 1 });
    stones(ctx, W + 170, 0, 16);
  },
  led(ctx, W, H, o, rnd) {
    for (const [x, y] of [[-W - 110, -H - 100], [W + 110, -H - 100], [-W - 110, H + 100], [W + 110, H + 100]]) floodTower(ctx, x, y);
    bus(ctx, -W - 250, 0, Math.PI / 2, RED, o.mirror);
    scatter(ctx, rnd, -W - 220, -60, -W - 190, 60, 3, o);
  },
  f5(ctx, W, H, o, rnd) {
    const x = W + 80, y = H + 150;
    shadowed(ctx, () => { ctx.fillStyle = '#2f6fb0'; ctx.fillRect(x, y - 14, 60, 30); });
    paint(ctx, 'BEBIDAS', x + 30, y + 1, '900 9px sans-serif', '#ffffff', o.mirror);
    for (let i = 0; i < 6; i++) bike(ctx, -W - 90 + i * 12, H + 150, Math.PI / 2);
    scatter(ctx, rnd, x - 30, y + 18, x + 70, y + 34, 4, o);
  },
  playa(ctx, W, H, o, rnd) {
    lifeguard(ctx, rnd, W + 170, -H - 52);
    // Parador: deck, barra y la guirnalda.
    const px = -W - 360, py = -H - 82;
    shadowed(ctx, () => { ctx.fillStyle = '#8a6a48'; ctx.fillRect(px, py, 160, 70); });
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; for (let yy = py + 5; yy < py + 70; yy += 6) ctx.fillRect(px, yy, 160, 1);
    ctx.fillStyle = '#5a3e26'; ctx.fillRect(px + 10, py + 8, 70, 16);
    paint(ctx, 'PARADOR TL', px + 45, py + 16, '900 9px sans-serif', '#f0c25a', o.mirror);
    for (let i = 0; i < 4; i++) table(ctx, rnd, px + 100 + (i % 2) * 36, py + 20 + Math.floor(i / 2) * 32);
    stringLights(ctx, px, py, px + 160, py, 8, 12, true);
    sandCastle(ctx, -W * 0.4, H + 168); sandCastle(ctx, W * 0.55, H + 175);
    if (REG) {
      const sea = REG.sea;
      const nS = more(4, LIVE.kx);
      for (let k = 0; k < nS; k++) REG.surfers.push({ x: -W - 300 + k * ((2 * W + 600) / (nS - 1)) + (rnd() - 0.5) * 80, y: sea - 46 - rnd() * 40, k: k % 4 });
      REG.kite = { x: W + 110, y: H + 170, color: RED };
    }
    if (!LIVE.alive && REG) for (const S of REG.surfers) { ctx.save(); ctx.translate(S.x, S.y); surferShape(ctx, S.k); ctx.restore(); }
    person(ctx, rnd, W + 110, H + 170, shirtFor(rnd, 'Blue'), false);
  },
  campo(ctx, W, H, o, rnd) {
    farmhouse(ctx, -W - 340, -H - 160, 130, 70);
    for (const [i, [x, y, c]] of [[W + 230, -H - 50, '#6b3f22'], [W + 275, -H - 15, '#2e211a'], [W + 200, -H + 30, '#b98559']].entries()) {
      const a = (rnd() - 0.5) * 2.2;
      if (REG) REG.cows.push({ x, y, a, seed: 40 + i, kind: c });
      if (!LIVE.alive) horse(ctx, x, y, a, c);
    }
    tractor(ctx, W + 262, gap0(H) + 6, 0.3);
    fire(ctx, -W - 250, 40);
    for (let k = 0; k < 5; k++) { const a = k * 1.25; person(ctx, rnd, -W - 250 + Math.cos(a) * 26, 40 + Math.sin(a) * 22, pick(rnd, ['#7a6a55', '#3f5a3a', '#e8e2d0']), false, 0.95); }
  },
  azotea(ctx, W, H, o, rnd) {
    for (let x = -W - 480; x < W + 480; x += 170 + rnd() * 80) { antenna(ctx, x, -H - 300 - rnd() * 40); antenna(ctx, x + 40, H + 260 + rnd() * 40); }
    djBooth(ctx, -W - 95, 0, o.mirror);
    // Jacuzzi en la otra punta.
    const jx = W + 100, jy = 0;
    shadowed(ctx, () => { ctx.fillStyle = '#cfd6dc'; ctx.beginPath(); ctx.arc(jx, jy, 34, 0, 7); ctx.fill(); });
    ctx.fillStyle = '#3fb6d8'; ctx.beginPath(); ctx.arc(jx, jy, 28, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc(jx + (rnd() - 0.5) * 40, jy + (rnd() - 0.5) * 40, 1.5 + rnd() * 2, 0, 7); ctx.fill(); }
    for (let k = 0; k < 4; k++) { const a = k * 1.57 + 0.5; ctx.fillStyle = pick(rnd, SKIN); ctx.beginPath(); ctx.arc(jx + Math.cos(a) * 20, jy + Math.sin(a) * 20, 3.6, 0, 7); ctx.fill(); ctx.fillStyle = pick(rnd, HAIR); ctx.beginPath(); ctx.arc(jx + Math.cos(a) * 20, jy + Math.sin(a) * 20 - 1, 3.4, Math.PI, 0); ctx.fill(); }
  },
  cortada(ctx, W, H, o, rnd) {
    const cross = W + 250;
    for (const y of [-H - 82, H + 80]) {
      let x = -W - 200;
      while (x < W + 200) { const nx = x + 120; if (Math.abs(Math.abs(x + 60) - cross) > 90) bunting(ctx, x, y, nx, y, 10); x = nx; }
    }
    grill(ctx, rnd, -W - 150, H + 66, o);
    stones(ctx, W + 160, 0, 16);
    if (REG) { REG.kids.push({ x: W + 130, y: 0, sx: 1 }); REG.runners.push({ x: -W - 150, y: 0, r: 34 }); }
  },
  colegio(ctx, W, H, o, rnd) {
    const gap = goalGap(H);
    swings(ctx, rnd, W + 240, gap + 10, 3);
    // Arenero con baldes.
    const ax = -W - 260, ay = H - 70;
    shadowed(ctx, () => { ctx.fillStyle = '#b9a27a'; ctx.fillRect(ax, ay, 90, 70); });
    ctx.fillStyle = '#e2cf9e'; ctx.fillRect(ax + 6, ay + 6, 78, 58);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = pick(rnd, ['#e86f4a', '#4a7fd8', '#f0c25a', '#3aa37a']); ctx.beginPath(); ctx.arc(ax + 16 + rnd() * 58, ay + 14 + rnd() * 42, 4, 0, 7); ctx.fill(); }
    for (let k = 0; k < 3; k++) person(ctx, rnd, ax + 20 + k * 25, ay + 30 + (k % 2) * 12, '#f1f1ec', false, 0.75);
  },
  estadio(ctx, W, H, o, rnd) {
    // Las esquinas: bandejas que cierran el estadio.
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x0 = sx < 0 ? -W - 200 : W + 60, x1 = sx < 0 ? -W - 60 : W + 200;
      const y0 = sy < 0 ? -H - 164 : H + 48, y1 = sy < 0 ? -H - 48 : H + 164;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x0 + 4, y0 + 5, x1 - x0, y1 - y0);
      ctx.fillStyle = '#353a44'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; for (let y = y0; y < y1; y += 12) ctx.fillRect(x0, y, x1 - x0, 1);
      crowd(ctx, rnd, x0 + 8, y0 + 6, x1 - 8, y1 - 8, o, 13, 12, 0.9);
    }
    // El techo sigue por los costados.
    ctx.fillStyle = 'rgba(10,12,16,0.75)';
    ctx.fillRect(-W - 234, -H - 200, 34, 2 * H + 400); ctx.fillRect(W + 200, -H - 200, 34, 2 * H + 400);
    ctx.strokeStyle = 'rgba(160,170,185,0.4)'; ctx.lineWidth = 1;
    for (let y = -H - 200; y < H + 200; y += 40) { ctx.beginPath(); ctx.moveTo(-W - 234, y); ctx.lineTo(-W - 200, y + 20); ctx.moveTo(W + 234, y); ctx.lineTo(W + 200, y + 20); ctx.stroke(); }
    for (const [x, y] of [[-W - 215, -H - 182], [W + 215, -H - 182], [-W - 215, H + 182], [W + 215, H + 182]]) floodTower(ctx, x, y);
    // Cámaras de la tele en la mitad de la cancha.
    for (const sy of [-1, 1]) { const y = sy * (H + 40); ctx.fillStyle = '#1b1e24'; ctx.fillRect(-14, y - 6, 28, 12); ctx.fillStyle = '#e33b2e'; ctx.beginPath(); ctx.arc(10, y - 3, 1.6, 0, 7); ctx.fill(); }
  }
};
/** El hueco del arco (lo usa el campo, que lo necesita fuera de su función). */
function gap0(H) { return goalGap(H); }

/*
 * El festejo del gol: papelitos, bengalas y humo del color del equipo en la
 * tribuna del que metió. Sin vida va una vez en el dibujo del gol; con vida se
 * arma como imagen por bloque (tres cuadros) y se alterna.
 */
/** Un color mezclado con blanco (`k` de 0 a 1). */
function tint(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const m = (c) => Math.round(c + (255 - c) * k);
  return `rgb(${m(n >> 16)},${m((n >> 8) & 255)},${m(n & 255)})`;
}

function fiestaDraw(g, B, team, phase) {
  const rnd = seeded(B.seed * 3 + phase * 101 + 17);
  const kit = team === 'Red' ? KIT.Red : KIT.Blue;
  const cols = [...kit, '#ffffff', '#ffffff', '#f4f1ea'];
  const side = (x) => (x < 0) === (team === 'Red');
  const w = B.x1 - B.x0, h = B.y1 - B.y0;
  const nf = Math.max(1, Math.round(w / 170));
  for (let i = 0; i < nf; i++) {
    const fx = B.x0 + ((i + 0.5) / nf) * w + (hash01(B.seed % 911 + i) - 0.5) * 30;
    const fy = B.y0 + h * (0.3 + hash01(B.seed % 577 + i * 5) * 0.5);
    if (!side(fx)) continue;
    // Humo: del color del equipo pero aclarado, así se ve arriba de su propia hinchada.
    const smoke = tint(kit[0], 0.45);
    for (let k = 0; k < 8; k++) {
      const f = ((k + phase / 3) % 8) / 8;
      g.globalAlpha = 0.42 * (1 - f * 0.8);
      g.fillStyle = k % 3 === 2 ? 'rgba(235,235,235,1)' : smoke;
      g.beginPath(); g.arc(fx + f * 46 + Math.sin(k * 1.7) * 6, fy - f * 70, 9 + f * 24, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    const r = 24 + (phase % 2) * 5;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gl = g.createRadialGradient(fx, fy, 0, fx, fy, r);
    gl.addColorStop(0, 'rgba(255,250,225,1)'); gl.addColorStop(0.22, 'rgba(255,120,50,0.85)'); gl.addColorStop(1, 'rgba(255,60,20,0)');
    g.fillStyle = gl; g.beginPath(); g.arc(fx, fy, r, 0, 7); g.fill();
    g.restore();
    g.fillStyle = '#fffbea'; g.beginPath(); g.arc(fx, fy, 2.6, 0, 7); g.fill();
  }
  const n = Math.min(520, Math.round((w * (h + 30)) / 60));
  for (let i = 0; i < n; i++) {
    const x = B.x0 + rnd() * w, y = B.y0 - 22 + rnd() * (h + 30);
    if (!side(x)) continue;
    g.fillStyle = pick(rnd, cols);
    if (rnd() < 0.5) g.fillRect(x, y, 2.6, 1.4); else g.fillRect(x, y, 1.4, 2.6);
  }
}

function fiestaBlock(B, team, phase, tag) {
  const key = `${B.seed}|f${team}${phase}|${tag}`;
  let bl = BLOCKS.get(key);
  if (bl) return bl;
  const pad = 90;
  const w = B.x1 - B.x0 + pad * 2, h = B.y1 - B.y0 + pad * 2;
  const cv = mkCanvas(Math.ceil(w * B_PX), Math.ceil(h * B_PX));
  const g = cv.getContext('2d');
  g.setTransform(B_PX, 0, 0, B_PX, (pad - B.x0) * B_PX, (pad - B.y0) * B_PX);
  fiestaDraw(g, B, team, phase);
  bl = { cv, x: B.x0 - pad, y: B.y0 - pad, w, h };
  BLOCKS.set(key, bl);
  return bl;
}

/**
 * Lo que hace Fresa en cada momento. Partido normal: cada ~5 s cambia de
 * actividad (sentada mirando con parpadeos, camina la línea, marca la jugada
 * con la pizarra, toma mate o grita «¡VAMOS!»). Gol de los suyos: salta, gira
 * y ladra «¡GOOOL!»; en contra: se tapa los ojos con una nubecita encima; al
 * final, vuelta olímpica si ganaron o se rasca la cabeza si empataron.
 * Todo son figuras guardadas: un par de pegadas por cuadro.
 */
function fresaAlive(ctx, F, t, o, night) {
  const team = F.team, mir = !!o.mirror, m = mir ? 1 : 0;
  const won = o.fireworks === team, draw = o.fireworks === 'draw';
  const sad = o.hot && o.cheer && o.cheer !== team;
  const up = o.hot && o.cheer === team;
  const ink = team === 'Blue' ? '#2d55b0' : '#b83a3a';
  ctx.globalAlpha = night ? 0.85 : 1;
  const at = (key, r, fn, x, y, a) => stamp(ctx, sprite(key, r, fn), x, y, a);
  let x = F.x, y = F.y;
  if (won || draw) {
    const mood = won ? '' : 'scratch';
    const wag = won ? Math.round(Math.sin(t / 90) * 3) / 3 : Math.round(Math.sin(t / 300) * 2) / 2;
    if (won) { const a = t / 650; x += Math.cos(a) * 20; y += Math.sin(a) * 9 - Math.abs(Math.sin(t / 150)) * 3; }
    at(`fresa${won ? 1 : 0}${team}${m}${wag}${mood}`, 34, (g) => fresaDT(g, 0, 0, won, team, mir, wag, mood), x, y);
    if (won && Math.floor(t / 1400) % 2) { at(`fbC${m}`, 34, (g) => bubble(g, '¡CAMPEONES!', mir, '#a87a00'), x + 36, y - 44); return 2; }
    return 1;
  }
  if (sad) {
    at(`fresa0${team}${m}0sad`, 34, (g) => fresaDT(g, 0, 0, false, team, mir, 0, 'sad'), x, y);
    const f = Math.floor(t / 140) % 4;
    at(`fcloud${f}`, 12, (g) => sadCloud(g, f), x + 2, y - 36 + Math.sin(t / 500));
    return 2;
  }
  if (up) {
    // Salta, y cada tanto pega un giro en el aire.
    const hop = Math.abs(Math.sin(t / 160)) * 6;
    const c = t % 1500, spin = c < 380 ? (c / 380) * Math.PI * 2 : 0;
    const wag = Math.round(Math.sin(t / 90) * 3) / 3;
    at(`fresa1${team}${m}${wag}`, 34, (g) => fresaDT(g, 0, 0, true, team, mir, wag), x, y - hop, spin);
    at(`fbG${team}${m}`, 34, (g) => bubble(g, '¡GOOOL!', mir, ink), x + 26, y - 36 - hop * 0.5);
    return 2;
  }
  // La rutina: una actividad por tramo, elegida con azar fijo según el tramo.
  const seg = Math.floor(t / 5200), p = (t % 5200) / 5200;
  const r = hash01(seg * 7.31 + team.length);
  const act = r < 0.3 ? 'sit' : r < 0.56 ? 'walk' : r < 0.7 ? 'point' : r < 0.84 ? 'mate' : 'shout';
  if (act === 'walk' && F.walk > 0) {
    const ph = p * Math.PI * 2;
    x += Math.sin(ph) * F.walk;
    const dir = Math.cos(ph) >= 0 ? 1 : -1;
    const f = Math.floor(t / 170) % 2;
    at(`fwalk${team}${m}${f}${dir}`, 34, (g) => fresaWalk(g, team, mir, f, dir), x, y);
    return 1;
  }
  let mood = act === 'sit' || act === 'walk' ? '' : act;
  if (mood === '' && (t % 3100) < 150) mood = 'blink';
  const talk = p > 0.12 && p < 0.8;
  const wv = mood === 'point' ? Math.round(Math.sin(t / 220) * 2) : Math.round(Math.sin(t / 160) * 3) / 3;
  const hop = mood === 'shout' && talk ? Math.abs(Math.sin(t / 130)) * 2.5 : 0;
  at(`fresa0${team}${m}${wv}${mood}`, 34, (g) => fresaDT(g, 0, 0, false, team, mir, wv, mood), x, y - hop);
  if (mood === 'shout' && talk) { const word = Math.floor(t / 900) % 2 ? '¡VAMOS!' : '¡GUAU!'; at(`fb${word}${team}${m}`, 34, (g) => bubble(g, word, mir, ink), x + 26, y - 34); return 2; }
  if (mood === 'point' && talk) { const k = seg % 4; at(`ftac${k}${m}`, 24, (g) => tacticBubble(g, mir, k), x + 28, y - 34); return 2; }
  return 1;
}

/**
 * Canchas altas (x5, x7, RS…): las cabeceras miden mucho más que en una común
 * y lo de cada escena queda en el medio. Se reparte más de lo mismo a lo largo
 * de cada fondo, salteando el centro (donde ya está lo de siempre).
 */
function bigEnds(ctx, id, W, H, o, rnd) {
  if (LIVE.ky < 1.25) return;
  const gap = goalGap(H);
  const ys = (step, skip) => { const out = []; for (let y = -H + 110; y <= H - 110; y += step) if (Math.abs(y) > skip) out.push(y + (rnd() - 0.5) * step * 0.3); return out; };
  for (const sx of [-1, 1]) {
    if (id === 'noche' || id === 'campo' || id === 'colegio' || id === 'barrio') {
      for (const y of ys(260, gap + 120)) {
        const x = sx * (W + 170 + rnd() * 60);
        if (id === 'barrio' && sx > 0) continue;
        tree(ctx, rnd, x, y, 34 + rnd() * 12);
        scatter(ctx, rnd, sx * (W + 60), y - 30, sx * (W + 110), y + 30, 2, o);
        if (id === 'campo' && rnd() < 0.5) hay(ctx, x - sx * 70, y + 40);
        if (id === 'noche' && rnd() < 0.4) moto(ctx, x - sx * 80, y + 30, 1.4, pick(rnd, ['#b23a3a', '#2a2a2a', '#3d6ad6']));
      }
    }
    if (id === 'barrio' && sx > 0) for (let y = -H + 40; y <= H - 40; y += 70) if (y < -160 || y > 130) car(ctx, W + 110, y, Math.PI / 2, pick(rnd, CARS));
    if (id === 'barrio' && sx < 0) for (const y of ys(200, gap + 140)) table(ctx, rnd, -W - 70 - rnd() * 40, y);
    if (id === 'playa') {
      for (const y of ys(190, gap + 130)) {
        const x = sx * (W + 80 + rnd() * 30);
        umbrella(ctx, x, y, 21, rnd() < 0.5 ? [RED, '#f4f1ea'] : [BLUE, '#f0c25a']);
        lounger(ctx, rnd, x - 22, y + 30, 0.1); lounger(ctx, rnd, x + 22, y + 32, -0.1);
        if (rnd() < 0.5) towel(ctx, rnd, x + sx * 70, y + 10, (rnd() - 0.5) * 0.6);
      }
    }
    if (id === 'cortada') {
      for (let y = -H + 60; y <= H - 60; y += 82) if (Math.abs(y) > gap + 50) car(ctx, sx * (W + 120), y, Math.PI / 2, pick(rnd, CARS));
      for (const y of ys(230, gap + 100)) {
        for (let k = 0; k < 3; k++) { const px = sx * (W + 60), py = y + k * 18; ctx.fillStyle = pick(rnd, ['#e8e2d0', '#3d6ad6', '#c9a24a', '#e86f4a']); ctx.fillRect(px - 6, py - 6, 12, 12); person(ctx, rnd, px, py, shirtFor(rnd, sx < 0 ? 'Red' : 'Blue'), o.cheer === (sx < 0 ? 'Red' : 'Blue'), 0.95); }
      }
    }
  }
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
    const { W0, W, H, gap } = envDims(bounds);
    LIVE.gap = gap;
    LIVE.kx = Math.max(1, Math.min(6, W0 / 420));
    LIVE.ky = Math.max(1, Math.min(6, H / 200));
    ctx.beginPath();
    ctx.rect(-W * 50, -H * 50, W * 100, H * 100);
    ctx.rect(-W0, -H, 2 * W0, 2 * H);
    ctx.clip('evenodd');
    LIVE.score = typeof o.score === 'string' ? o.score : '';
    LIVE.scorer = typeof o.scorer === 'string' ? o.scorer.toUpperCase().slice(0, 18) : '';
    LIVE.names = Array.isArray(o.names) ? o.names.filter((n) => typeof n === 'string' && n).map((n) => n.toUpperCase().slice(0, 14)).slice(0, 3) : [];
    LIVE.wet = o.weather === 'rain' || o.weather === 'storm';
    LIVE.snow = o.weather === 'snow' || o.weather === 'blizzard';
    LIVE.night = !!o.night;
    LIVE.alive = !!o.alive;
    LIVE.fill = Number.isFinite(o.fill) ? Math.max(0.25, Math.min(1, o.fill)) : 1;
    useKits(o.kits);
    LIGHTS.length = 0;
    REG = { leds: [], crowds: [], flags: [], dogs: [], kids: [], pitches: [], smoke: [], cows: [], flashes: [], screens: [], windows: [], walkers: [], runners: [], bulbs: [], trapos: [], fresa: null, mill: null, volley: null, gulls: null, lane: null, fires: [], surfers: [], kite: null, beacons: [], swings: [], dj: null };
    const so = { cheer: o.cheer || null, hot: !!o.hot, mirror: !!o.mirror };
    fn(ctx, W, H, so);
    if (EXTRA[id]) EXTRA[id](ctx, W, H, so, seeded(4049));
    bigEnds(ctx, id, W, H, so, seeded(5051));
    // Fresa, la DT, en el banco del equipo de uno (rojo si mirás de afuera).
    if (o.fresa !== false && FRESA_SPOT[id]) {
      const team = o.fresaTeam === 'Blue' ? 'Blue' : 'Red';
      const [fx, fy, bench, walk] = FRESA_SPOT[id](W, H, team);
      if (bench) fresaBench(ctx, fx, fy + 4);
      if (REG) REG.fresa = { x: fx, y: fy, team, walk: walk || 0 };
      if (!LIVE.alive) fresaDT(ctx, fx, fy, o.cheer === team, team, !!o.mirror);
    }
    // Gol sin vida: papelitos, bengalas y humo en la tribuna del que metió.
    if (o.hot && (o.cheer === 'Red' || o.cheer === 'Blue') && !LIVE.alive && REG) for (const B of REG.crowds) fiestaDraw(ctx, B, o.cheer, 0);
    // Viñeta: los bordes un poco más oscuros llevan la vista a la cancha.
    {
      const R = Math.hypot(W, H);
      const g = ctx.createRadialGradient(0, 0, R * 0.95, 0, 0, R * 2.1);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.42)');
      ctx.fillStyle = g;
      ctx.fillRect(-W - 900, -H - 700, 2 * W + 1800, 2 * H + 1400);
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

/** El color del piso de cada escenario (para cubrir lo que quede más allá del dibujo guardado). */
const GROUND = { noche: '#3d3326', barrio: '#5d6158', led: '#35392f', f5: '#2a2e35', playa: '#dcc48e', campo: '#6f8a45', azotea: '#14171d', cortada: '#3d4046', colegio: '#a6a29a', estadio: '#1c1f26' };
function groundColor(id) { return GROUND[id] || '#3a3a3a'; }

/** Hasta dónde llega el dibujo de cada escenario, para guardarlo de una sola vez. */
function extent(bounds) {
  const { W, H } = envDims(bounds);
  return { x: W + 430, y: H + 340 };
}

module.exports = { ENVS, has, paintEnv, paintAlive, goalGap, groundColor, extent, envDims };
