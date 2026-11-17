'use strict';

/**
 * Vista 3D de la cancha.
 *
 * ── Qué es ──────────────────────────────────────────────────────────────
 *
 * HaxBall dibuja en 2D. Esto vuelve a dibujar el MISMO cuadro en 3D (WebGL),
 * con la cámara inclinada: el piso es el propio dibujo del estadio de HaxBall
 * (con su pasto, sus líneas y la piel de la cancha del cliente) pegado sobre un
 * plano, las fichas son discos con la camiseta y el número arriba, la pelota es
 * una esfera, y cada cosa tiene su sombra.
 *
 * No calcula NADA del juego: las posiciones salen del cuadro que el juego ya
 * armó (ver `view-3d-patch.js`). La física, las teclas y la red no pasan por
 * acá. Es sólo otra forma de pintar lo mismo.
 *
 * ── Sólo existe si está prendida ────────────────────────────────────────
 *
 * El preload carga este archivo únicamente con `perf.view3d` prendido al
 * arrancar. Apagada, no se carga, no se crea ningún canvas y no corre nada.
 *
 * ── Si algo falla, vuelve el 2D ─────────────────────────────────────────
 *
 * Sin WebGL, con el contexto perdido o ante cualquier error, la vista se
 * desarma sola, vuelve a mostrar el canvas 2D y el juego sigue dibujándose
 * como siempre. Lo peor que puede pasar es quedarse en 2D.
 *
 * ── Costo ───────────────────────────────────────────────────────────────
 *
 * El cuadro 2D NO se dibuja mientras está la 3D (no se paga dos veces). Las
 * texturas se suben a la placa sólo cuando cambian (estadio, camiseta, nombre).
 * Por cuadro: unas pocas decenas de dibujos chicos y cero objetos nuevos.
 */

/* Perspectivas. `tilt` es cuánto se inclina la cámara desde la vertical, en
   grados; `dist` corrige la distancia para que entre lo mismo que en 2D.
   Dron, Tribuna y TV miran desde el lado de abajo de la cancha: arriba en la
   pantalla sigue siendo arriba en el teclado. Vertical se para detrás de TU
   arco, mirando al rival y siguiendo tu ficha (las teclas no giran: para
   avanzar hacia el arco rival se sigue usando la misma tecla de siempre). */
const CAMS = {
  dron: { tilt: 24, dist: 1.0 },
  tribuna: { tilt: 42, dist: 0.95 },
  tv: { tilt: 55, dist: 0.85 },
  vertical: { tilt: 52, dist: 0.8, follow: true }
};
/*
 * Lente cerrada (como una transmisión de TV, no como un celular). Con 40° los
 * bordes de la pantalla se estiraban y los ángulos de los pases no se veían
 * como son; con 28° la cancha casi no se deforma.
 */
const FOV = 28 * Math.PI / 180;

/*
 * Altura de contacto, en unidades de cancha.
 *
 * El juego decide los choques con CÍRCULOS en el piso. En 3D, lo que el ojo
 * compara es el borde de la tapa de la ficha con el ecuador de la pelota: si
 * están a distinta altura, con la cámara inclinada parece que se tocan antes o
 * después de lo que de verdad pasa. Por eso todas las fichas tienen la tapa a
 * la misma altura y la pelota tiene el centro justo ahí: así el contacto que se
 * ve es el mismo que calcula el juego.
 */
const CONTACT_Y = 6;
const POST_H = 1.6;

/*
 * Flechas de la vista vertical. La máscara del juego: arriba 1, abajo 2,
 * izquierda 4, derecha 8, patada 16. Con la cámara mirando hacia +x, arriba en
 * la pantalla es la derecha de la cancha; mirando hacia -x, es la izquierda.
 */
const ROT_POS = (a) => (a & 1 ? 8 : 0) | (a & 2 ? 4 : 0) | (a & 8 ? 2 : 0) | (a & 4 ? 1 : 0) | (a & 16);
const ROT_NEG = (a) => (a & 1 ? 4 : 0) | (a & 2 ? 8 : 0) | (a & 8 ? 1 : 0) | (a & 4 ? 2 : 0) | (a & 16);

/* Tribunas: escalones alrededor de la cancha. Diseño propio y genérico. */
const STEPS = 9;
const STEP_D = 34;
const STEP_H = 17;
const SEAT_A_ROW = [0.13, 0.15, 0.2];
const SEAT_B_ROW = [0.17, 0.19, 0.25];
const RISER = [0.36, 0.37, 0.4];
const WALL_BACK = [0.1, 0.11, 0.14];
const ROOF = [0.16, 0.17, 0.2];
const GOLD = [0.66, 0.53, 0.22];
const STAIRS = [0.42, 0.43, 0.46];
const LAMP = [1, 0.96, 0.82];
const SCREEN = [0.05, 0.07, 0.12];
/* Camisetas del público: mucho del club (dorado y negro), algo de blanco y de los equipos. */
const CROWD = [[0.72, 0.58, 0.24], [0.72, 0.58, 0.24], [0.08, 0.08, 0.1], [0.08, 0.08, 0.1], [0.9, 0.9, 0.9], [0.86, 0.33, 0.3], [0.32, 0.5, 0.86], [0.55, 0.44, 0.18]];
const SKIN = [[0.86, 0.68, 0.55], [0.72, 0.53, 0.4], [0.55, 0.38, 0.27], [0.93, 0.78, 0.66]];
/* Banderas: franjas de arriba a abajo. */
const BANNERS = [[[0.72, 0.58, 0.24], [0.06, 0.06, 0.08], [0.72, 0.58, 0.24]], [[0.06, 0.06, 0.08], [0.95, 0.95, 0.95], [0.06, 0.06, 0.08]], [[0.95, 0.95, 0.95], [0.72, 0.58, 0.24]]];

/* ── Matrices (columna mayor, como las quiere WebGL) ─────────────────── */
function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect; out[5] = f;
  out[10] = (far + near) * nf; out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}
function lookAt(out, ex, ey, ez, cx, cy, cz) {
  let zx = ex - cx, zy = ey - cy, zz = ez - cz;
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  // up = (0,1,0)
  let xx = zz, xy = 0, xz = -zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
  out[15] = 1;
  return out;
}
function multiply(out, a, b) {
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[i * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[i * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[i * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/* ── Sombreadores ────────────────────────────────────────────────────── */
const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUv;
uniform mat4 uVP; uniform vec3 uOff; uniform vec3 uScale;
varying vec3 vNor; varying vec2 vUv;
void main() {
  vNor = aNor; vUv = aUv;
  gl_Position = uVP * vec4(aPos * uScale + uOff, 1.0);
}`;
/* uMode: 0 color con luz · 1 textura con luz (tapa de la ficha) · 2 textura sin
   luz (piso) · 3 sombra redonda · 4 color sin luz · 5 color por vértice · 6 aro */
const FS = `
precision mediump float;
varying vec3 vNor; varying vec2 vUv;
uniform int uMode; uniform vec4 uColor; uniform sampler2D uTex; uniform float uRot;
const vec3 L = vec3(-0.35, 0.86, 0.38);
void main() {
  if (uMode == 3) {
    float d = length(vUv - 0.5) * 2.0;
    gl_FragColor = vec4(0.0, 0.0, 0.0, uColor.a * smoothstep(1.0, 0.35, d));
    return;
  }
  float lit = 0.55 + 0.5 * max(dot(normalize(vNor), normalize(L)), 0.0);
  if (uMode == 4) { gl_FragColor = uColor; return; }
  if (uMode == 5) { gl_FragColor = vec4(vNor, 1.0); return; }
  if (uMode == 2) { gl_FragColor = texture2D(uTex, vUv); return; }
  if (uMode == 6) {
    // Aro en el piso (el tuyo): un anillo suave.
    float d = length(vUv - 0.5) * 2.0;
    float a = smoothstep(0.78, 0.86, d) * (1.0 - smoothstep(0.94, 1.0, d));
    gl_FragColor = vec4(uColor.rgb, uColor.a * a);
    return;
  }
  if (uMode == 1) {
    // La tapa es el MISMO dibujo de la ficha que hace el 2D (camiseta, avatar,
    // estilo y contorno), un poco más grande que el disco para que entre el
    // contorno. Lo que queda afuera del dibujo no se pinta.
    // La camiseta se gira con la cámara para que el número se lea derecho.
    vec2 uv = uRot > 0.5 ? vec2(vUv.y, 1.0 - vUv.x) : (uRot < -0.5 ? vec2(1.0 - vUv.y, vUv.x) : vUv);
    vec4 t = texture2D(uTex, uv);
    if (t.a < 0.5) discard;
    gl_FragColor = vec4(t.rgb * lit, 1.0);
    return;
  }
  gl_FragColor = vec4(uColor.rgb * lit, uColor.a);
}`;
/* Nombres: un rectángulo en coordenadas de pantalla, siempre de frente. */
const VS2 = `
attribute vec2 aPos; uniform vec2 uCenter; uniform vec2 uSize; uniform float uDepth; varying vec2 vUv;
void main() { vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(uCenter + aPos * uSize, uDepth, 1.0); }`;
/* Nombres y la pelota del cliente. La pelota se recorta por su silueta para
   que las fichas que pasan adelante la tapen bien. */
const FS2 = `
precision mediump float; varying vec2 vUv; uniform sampler2D uTex; uniform float uCut;
void main() { vec4 t = texture2D(uTex, vUv); if (t.a < uCut) discard; gl_FragColor = t; }`;

/* ── Mallas (en espacio local: radio 1, alto 1) ──────────────────────── */
function cylinderSide(seg) {
  const v = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const x0 = Math.cos(a0), z0 = Math.sin(a0), x1 = Math.cos(a1), z1 = Math.sin(a1);
    v.push(x0, 0, z0, x0, 0, z0, 0, 0, x1, 0, z1, x1, 0, z1, 0, 0, x1, 1, z1, x1, 0, z1, 0, 0,
      x0, 0, z0, x0, 0, z0, 0, 0, x1, 1, z1, x1, 0, z1, 0, 0, x0, 1, z0, x0, 0, z0, 0, 0);
  }
  return new Float32Array(v);
}
function cap(seg) {
  const v = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const x0 = Math.cos(a0), z0 = Math.sin(a0), x1 = Math.cos(a1), z1 = Math.sin(a1);
    v.push(0, 1, 0, 0, 1, 0, 0.5, 0.5,
      x1, 1, z1, 0, 1, 0, (x1 + 1) / 2, (z1 + 1) / 2,
      x0, 1, z0, 0, 1, 0, (x0 + 1) / 2, (z0 + 1) / 2);
  }
  return new Float32Array(v);
}
function sphere(lat, lon) {
  const v = [];
  const p = (i, j) => {
    const t = (i / lat) * Math.PI, f = (j / lon) * Math.PI * 2;
    const x = Math.sin(t) * Math.cos(f), y = Math.cos(t), z = Math.sin(t) * Math.sin(f);
    return [x, y, z, x, y, z, j / lon, i / lat];
  };
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
      v.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  return new Float32Array(v);
}
/*
 * Tribunas de un lado. `side`: 0 abajo (+z), 1 arriba (-z), 2 derecha (+x),
 * 3 izquierda (-x).
 *
 * Los cuatro lados forman UN anillo: cada escalón se corta a 45° en las
 * esquinas (como un marco de cuadro), así no queda ningún hueco ni dos caras
 * pisándose. Arriba de todo, una pared de fondo y un alero que cierran el
 * estadio. Devuelve tres tandas: asientos A, asientos B y estructura.
 */
const STAND_GAP = 46;
const ROOF_H = 54;
function stands(side, hx, hy, tiers = STEPS) {
  const horiz = side < 2;
  const a0 = (horiz ? hy : hx) + STAND_GAP;   // distancia del centro al primer escalón
  const l0 = (horiz ? hx : hy) + STAND_GAP;   // medio largo del primer escalón
  const sign = side === 0 || side === 2 ? 1 : -1;
  // 0 asientos A · 1 asientos B · 2 estructura · 3 público (quieto: no cuesta nada por cuadro)
  const out = [[], [], [], []];
  // De (a: hacia afuera, y, l: a lo largo) a coordenadas de cancha.
  const P = (a, y, l) => (horiz ? [l, y, sign * a] : [sign * a, y, l]);
  const quad = (arr, p, rgb) => face(arr, p, rgb, true);
  const flat = (arr, p, rgb) => face(arr, p, rgb, false);
  // Azar con semilla: el mismo estadio sale siempre igual.
  let seed = 9301 + side * 4973 + Math.round(l0) * 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // Escaleras: separan sectores cada ~200 de largo.
  const aisleEvery = 200;
  const isAisle = (l) => Math.abs(((l % aisleEvery) + aisleEvery) % aisleEvery - aisleEvery / 2) < 7;

  for (let i = 0; i < tiers; i++) {
    const ai = a0 + i * STEP_D, an = ai + STEP_D;
    const li = l0 + i * STEP_D, ln = li + STEP_D;
    const y = (i + 1) * STEP_H, yb = i * STEP_H;
    const seat = i % 2 ? SEAT_B_ROW : SEAT_A_ROW;
    // Tapa del escalón (trapecio: más largo afuera, por la esquina a 45°).
    quad(out[i % 2], [P(ai, y, -li), P(an, y, -ln), P(an, y, ln), P(ai, y, li)], seat);
    // Frente del escalón, de hormigón: es lo que dibuja cada fila.
    quad(out[2], [P(ai, yb, -li), P(ai, y, -li), P(ai, y, li), P(ai, yb, li)], RISER);
    // Escaleras, un poco más claras, encima de la tapa.
    for (let l = -li + aisleEvery / 2; l < li; l += aisleEvery) {
      const c = l - (((l % aisleEvery) + aisleEvery) % aisleEvery) + aisleEvery / 2;
      quad(out[2], [P(ai, y + 0.15, c - 6), P(an, y + 0.15, c - 6), P(an, y + 0.15, c + 6), P(ai, y + 0.15, c + 6)], STAIRS);
    }
    // Público: uno cada ~9, con huecos, mirando a la cancha.
    const am = ai + STEP_D * 0.55;
    for (let l = -li + 6; l < li - 6; l += 8.5 + rnd() * 2) {
      if (isAisle(l) || rnd() < 0.16) continue;
      const shirt = CROWD[Math.floor(rnd() * CROWD.length)];
      const skin = SKIN[Math.floor(rnd() * SKIN.length)];
      const k = 0.82 + rnd() * 0.3;
      const bh = 8 * k, bw = 2.8 * k, hs = 1.9 * k;
      const person = (p, rgb) => {
        for (const j of [0, 1, 2, 0, 2, 3]) out[3].push(p[j][0], p[j][1], p[j][2], rgb[0], rgb[1], rgb[2], 0, 0);
      };
      person([P(am, y, l - bw), P(am, y + bh, l - bw), P(am, y + bh, l + bw), P(am, y, l + bw)], shirt);
      person([P(am - 0.2, y + bh + 0.4, l - hs), P(am - 0.2, y + bh + 0.4 + 2 * hs, l - hs), P(am - 0.2, y + bh + 0.4 + 2 * hs, l + hs), P(am - 0.2, y + bh + 0.4, l + hs)], skin);
    }
  }
  // Banderas del club colgadas del frente de la primera fila.
  if (tiers >= 2) {
    const fy0 = 1.5, fy1 = STEP_H * 2 - 2;
    let n = 0;
    for (let l = -l0 + 60; l < l0 - 60; l += 150, n++) {
      const w = 34 + (n % 3) * 8;
      const a = a0 - 0.6;
      const stripes = BANNERS[n % BANNERS.length];
      const sh = (fy1 - fy0) / stripes.length;
      stripes.forEach((rgb, k) => flat(out[2], [P(a, fy0 + k * sh, l - w), P(a, fy0 + (k + 1) * sh, l - w), P(a, fy0 + (k + 1) * sh, l + w), P(a, fy0 + k * sh, l + w)], rgb));
    }
  }
  // Del lado de la cámara: sólo los escalones de abajo, con su baranda dorada.
  if (tiers < STEPS) {
    const aT = a0 + tiers * STEP_D, lT = l0 + tiers * STEP_D, yT = tiers * STEP_H;
    quad(out[1], [P(aT, yT, -lT), P(aT, yT + 3, -lT), P(aT, yT + 3, lT), P(aT, yT, lT)], GOLD);
    return out.map((v) => new Float32Array(v));
  }
  // Pared de fondo y alero.
  const aN = a0 + STEPS * STEP_D, lN = l0 + STEPS * STEP_D, yN = STEPS * STEP_H;
  quad(out[2], [P(aN, yN, -lN), P(aN, yN + ROOF_H, -lN), P(aN, yN + ROOF_H, lN), P(aN, yN, lN)], WALL_BACK);
  const aR = aN - STEP_D * 3.2, lR = lN - STEP_D * 3.2;
  quad(out[2], [P(aR, yN + ROOF_H, -lR), P(aN + 6, yN + ROOF_H + 8, -lN - 6), P(aN + 6, yN + ROOF_H + 8, lN + 6), P(aR, yN + ROOF_H, lR)], ROOF);
  // Filo dorado del alero, lo que se ve de lejos.
  quad(out[1], [P(aR, yN + ROOF_H - 4, -lR), P(aR, yN + ROOF_H, -lR), P(aR, yN + ROOF_H, lR), P(aR, yN + ROOF_H - 4, lR)], GOLD);
  // Focos debajo del alero: encendidos, siempre.
  for (let l = -lR + 20; l < lR - 20; l += 46) {
    flat(out[2], [P(aR - 0.4, yN + ROOF_H - 10, l - 6), P(aR - 0.4, yN + ROOF_H - 5, l - 6), P(aR - 0.4, yN + ROOF_H - 5, l + 6), P(aR - 0.4, yN + ROOF_H - 10, l + 6)], LAMP);
  }
  // Una pantalla en el medio del lado de enfrente.
  if (side === 1) {
    const sw = Math.min(160, l0 * 0.35), sy = yN + 6, sh = ROOF_H - 22;
    flat(out[2], [P(aN - 0.6, sy, -sw - 4), P(aN - 0.6, sy + sh + 4, -sw - 4), P(aN - 0.6, sy + sh + 4, sw + 4), P(aN - 0.6, sy, sw + 4)], GOLD);
    flat(out[2], [P(aN - 1.2, sy + 2, -sw), P(aN - 1.2, sy + sh + 2, -sw), P(aN - 1.2, sy + sh + 2, sw), P(aN - 1.2, sy + 2, sw)], SCREEN);
  }
  return out.map((v) => new Float32Array(v));
}

/* ── Estadio: paredes, arcos, carteles y torres ─────────────────────────
 *
 * Todo se arma UNA vez por estadio, en coordenadas de cancha, con la luz ya
 * horneada en el color de cada vértice: en cada cuadro es un solo dibujo.
 */
const LIGHT = (() => { const l = [-0.35, 0.86, 0.38], n = Math.hypot(...l); return l.map((v) => v / n); })();
const BOARD_H = 12;
const BOARD_A = [0.07, 0.08, 0.11];
const BOARD_B = [0.62, 0.5, 0.2];

function shade(nx, ny, nz) {
  return 0.55 + 0.5 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
}
/* Un cuadrilátero: cuatro puntas [x, y, z], un color y si lleva luz. */
function face(arr, p, rgb, lit, uvs) {
  let k = 1;
  if (lit) {
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
    const vx = p[3][0] - p[0][0], vy = p[3][1] - p[0][1], vz = p[3][2] - p[0][2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // Sin caras de atrás: se ilumina el lado que mira a la luz.
    k = Math.max(shade(nx, ny, nz), shade(-nx, -ny, -nz));
  }
  for (const i of [0, 1, 2, 0, 2, 3]) {
    const v = p[i];
    arr.push(v[0], v[1], v[2], rgb[0] * k, rgb[1] * k, rgb[2] * k, uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0);
  }
}
/* Un poste de 6 caras. */
function pole(arr, x, z, r, h, rgb, y0 = 0) {
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
    const x0 = x + Math.cos(a0) * r, z0 = z + Math.sin(a0) * r, x1 = x + Math.cos(a1) * r, z1 = z + Math.sin(a1) * r;
    face(arr, [[x0, y0, z0], [x1, y0, z1], [x1, y0 + h, z1], [x0, y0 + h, z0]], rgb, true);
  }
}
/* Una caja alineada a los ejes. */
function box(arr, x0, y0, z0, x1, y1, z1, rgb) {
  face(arr, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], rgb, true);
  face(arr, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], rgb, true);
  face(arr, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], rgb, true);
  face(arr, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], rgb, true);
  face(arr, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], rgb, true);
}
function rgbOfInt(c) {
  return c < 0 ? [0.85, 0.85, 0.85] : [((c >>> 16) & 255) / 255, ((c >>> 8) & 255) / 255, (c & 255) / 255];
}

/*
 * Arma todo lo fijo del estadio. `ball` es el disco de la pelota: las paredes
 * que la hacen rebotar se levantan (a la altura del ecuador de la pelota, para
 * que el toque se vea donde pasa), las demás quedan como líneas en el piso.
 */
function decor(N, st, discs, bx, by) {
  const ball = discs[0];
  const solid = [], net = [], ends = [];
  /*
   * Las paredes quedan como las dibuja el juego: líneas en el piso. Se probó
   * levantarlas y en una cancha real quedaban como bordes blancos gruesos.
   */
  void ball;
  // Arcos: travesaño y marco del color de sus palos, y red de verdad.
  const goals = st[N.goals] || [];
  for (const g of goals) {
    const p0 = g && g[N.goalA], p1 = g && g[N.goalB];
    if (!p0 || !p1) continue;
    const dx = p1.x - p0.x, dz = p1.y - p0.y;
    const w = Math.hypot(dx, dz);
    if (!(w > 1)) continue;
    let nx = -dz / w, nz = dx / w;
    // La red va hacia afuera de la cancha.
    if (nx * (p0.x + p1.x) + nz * (p0.y + p1.y) < 0) { nx = -nx; nz = -nz; }
    const GH = Math.max(26, Math.min(56, w * 0.32));
    const GD = Math.max(22, Math.min(46, GH * 0.85));
    const BH = GH * 0.55;
    ends.push(p0.x, p0.y, GH, p1.x, p1.y, GH);
    // El color del marco: el de los palos que pone el estadio (si hay), si no blanco.
    let frame = [0.95, 0.95, 0.95];
    for (const d of discs) {
      const q = d && d[N.pos];
      if (!q || (d[N.color] | 0) < 0) continue;
      if (Math.hypot(q.x - p0.x, q.y - p0.y) < 6 || Math.hypot(q.x - p1.x, q.y - p1.y) < 6) { frame = rgbOfInt(d[N.color] | 0); break; }
    }
    // Travesaño redondeado: cuatro caras finitas.
    const t = 2.6;
    const bar = (ax0, az0, ax1, az1, y) => {
      const ox = nx * t, oz = nz * t;
      face(solid, [[ax0 - ox, y + t, az0 - oz], [ax1 - ox, y + t, az1 - oz], [ax1 + ox, y + t, az1 + oz], [ax0 + ox, y + t, az0 + oz]], frame, true);
      face(solid, [[ax0 - ox, y - t, az0 - oz], [ax1 - ox, y - t, az1 - oz], [ax1 - ox, y + t, az1 - oz], [ax0 - ox, y + t, az0 - oz]], frame, true);
      face(solid, [[ax0 + ox, y - t, az0 + oz], [ax1 + ox, y - t, az1 + oz], [ax1 + ox, y + t, az1 + oz], [ax0 + ox, y + t, az0 + oz]], frame, true);
    };
    bar(p0.x, p0.y, p1.x, p1.y, GH - t);
    // Marco de atrás: dos parantes bajos y una barra en el piso, finitos y claros.
    const bx0 = p0.x + nx * GD, bz0 = p0.y + nz * GD, bx1 = p1.x + nx * GD, bz1 = p1.y + nz * GD;
    const light = [Math.min(1, frame[0] * 0.6 + 0.4), Math.min(1, frame[1] * 0.6 + 0.4), Math.min(1, frame[2] * 0.6 + 0.4)];
    pole(solid, bx0, bz0, 1.3, BH, light);
    pole(solid, bx1, bz1, 1.3, BH, light);
    // Red: techo inclinado, fondo y costados. Trama cada 6 y un velo suave.
    const uv = (len, hgt) => [[0, 0], [len / 6, 0], [len / 6, hgt / 6], [0, hgt / 6]];
    const roofLen = Math.hypot(GD, GH - BH);
    face(net, [[p0.x, GH, p0.y], [p1.x, GH, p1.y], [bx1, BH, bz1], [bx0, BH, bz0]], [1, 1, 1], false, uv(w, roofLen));
    face(net, [[bx0, 0, bz0], [bx1, 0, bz1], [bx1, BH, bz1], [bx0, BH, bz0]], [1, 1, 1], false, uv(w, BH));
    face(net, [[p0.x, 0, p0.y], [bx0, 0, bz0], [bx0, BH, bz0], [p0.x, GH, p0.y]], [1, 1, 1], false, uv(GD, GH));
    face(net, [[p1.x, 0, p1.y], [bx1, 0, bz1], [bx1, BH, bz1], [p1.x, GH, p1.y]], [1, 1, 1], false, uv(GD, GH));
  }

  // Carteles alrededor de la cancha: bajos, oscuros, con el filo dorado del club.
  const ax = bx + 24, az = by + 24;
  for (const [x0, z0, x1, z1] of [[-ax, -az, ax, -az], [ax, -az, ax, az], [ax, az, -ax, az], [-ax, az, -ax, -az]]) {
    face(solid, [[x0, 0, z0], [x1, 0, z1], [x1, BOARD_H - 2.5, z1], [x0, BOARD_H - 2.5, z0]], BOARD_A, true);
    face(solid, [[x0, BOARD_H - 2.5, z0], [x1, BOARD_H - 2.5, z1], [x1, BOARD_H, z1], [x0, BOARD_H, z0]], BOARD_B, true);
  }

  // Torres de luz en las cuatro esquinas, detrás de las tribunas.
  const tx = bx + STAND_GAP + STEPS * STEP_D + 30, tz = by + STAND_GAP + STEPS * STEP_D + 30;
  const towerH = STEPS * STEP_H + ROOF_H + 150;
  for (const [x, z] of [[-tx, -tz], [tx, -tz], [tx, tz], [-tx, tz]]) {
    pole(solid, x, z, 7, towerH, [0.32, 0.33, 0.36]);
    const sx = x > 0 ? -1 : 1, sz = z > 0 ? -1 : 1;
    box(solid, x - 34, towerH, z - 34, x + 34, towerH + 22, z + 34, [0.2, 0.21, 0.24]);
    // Los focos, mirando a la cancha: sin luz propia, siempre encendidos.
    face(solid, [[x - 30, towerH + 2, z + sz * 35], [x + 30, towerH + 2, z + sz * 35], [x + 30, towerH + 20, z + sz * 35], [x - 30, towerH + 20, z + sz * 35]], [1, 0.95, 0.78], false);
    face(solid, [[x + sx * 35, towerH + 2, z - 30], [x + sx * 35, towerH + 2, z + 30], [x + sx * 35, towerH + 20, z + 30], [x + sx * 35, towerH + 20, z - 30]], [1, 0.95, 0.78], false);
  }

  return { solid: new Float32Array(solid), net: new Float32Array(net), ends: new Float32Array(ends) };
}

/* Cuadrado en el piso, de -1 a 1, con la v hacia +z (abajo en la pantalla 2D). */
function quad() {
  return new Float32Array([
    -1, 0, -1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, -1, 0, 1, 0, 1, 0,
    -1, 0, -1, 0, 1, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1
  ]);
}

/**
 * @param {Window} view la ventana del juego (iframe)
 * @param {{ cam?: string, antialias?: boolean, lowLatency?: boolean, log?: Function }} opts
 */
function install(view, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  let camName = CAMS[opts.cam] ? opts.cam : 'tribuna';
  let dead = false;
  let gl = null, glCv = null, hudCv = null, hudCtx = null, gameCv = null;
  let prog = null, prog2 = null, U = null, U2 = null;
  const mesh = {};
  let quad2 = null;
  const vp = new Float32Array(16), proj = new Float32Array(16), viewM = new Float32Array(16);

  /* Piso */
  let floorTex = null, floorFor = null, floorDirty = true, floorX = 0, floorY = 0, groundRgb = [0.18, 0.3, 0.14];
  const floorCv = view.document.createElement('canvas');

  /* Tribunas: por lado, dos tandas de escalones. Se rearman con el piso. */
  let standBufs = null, standLow = null;
  /* Estadio fijo (paredes, arcos, carteles, torres), la red y las puntas de los arcos. */
  let decorSolid = null, decorNet = null, goalEnds = new Float32Array(0), netTex = null;
  /* Cámara que sigue a tu ficha (vista vertical): se suaviza para que no tiemble. */
  let follow = null;
  /* Uniones: un solo buffer que se rellena en cada cuadro (sin crear nada). */
  let jointBuf = null, jointData = new Float32Array(48 * 64);
  const jointMesh = { b: null, n: 0 };
  function jv(n, x, z, r, g, b) {
    jointData[n] = x; jointData[n + 1] = 1.2; jointData[n + 2] = z;
    jointData[n + 3] = r; jointData[n + 4] = g; jointData[n + 5] = b;
    jointData[n + 6] = 0; jointData[n + 7] = 0;
    return n + 8;
  }
  /* Las flechas giradas que hay puestas ahora (o ninguna). */
  let rotOn = null;
  function setRot(fn) {
    if (fn === rotOn) return;
    rotOn = fn;
    view.__tvm3dRot = fn || undefined;
    // Que las teclas que ya estás apretando cambien de sentido ya, no en la próxima.
    try { if (view.__tvmInputSync && typeof view.__tvmInputSync.A === 'function') view.__tvmInputSync.A(); } catch (e) { /* nada */ }
  }

  /* Diagnóstico: las primeras camisetas que se suben se revisan una vez. */
  let kitChecks = 0;

  /* Texturas por jugador: datos de dibujo del juego → { kit, kitPat, name, nameStr, seen } */
  const per = new Map();
  let frameNo = 0;
  const playerDiscs = new Set();
  let paused = false;
  let lastW = 0, lastH = 0;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'sombreador');
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'programa');
    return p;
  }
  function buffer(data) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { b, n: data.length / 8 };
  }
  function texture(source, smooth) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smooth ? gl.LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return t;
  }
  function upload(t, source, mip) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    /*
     * Con mipmaps lo lejano se lee de una versión achicada: mucho menos trabajo
     * para la placa y sin brillitos. WebGL 1 sólo los arma en potencias de 2.
     */
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
  }
  const pow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

  /* Se arma la primera vez que hay un cuadro: ahí recién existe el canvas del juego. */
  function setup(cv) {
    const doc = view.document;
    gameCv = cv;
    glCv = doc.createElement('canvas');
    glCv.className = 'tvm-3d';
    hudCv = doc.createElement('canvas');
    hudCv.className = 'tvm-3d-hud';
    for (const c of [glCv, hudCv]) {
      c.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;';
    }
    gl = glCv.getContext('webgl', {
      alpha: false,
      antialias: opts.antialias !== false,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      desynchronized: !!opts.lowLatency
    });
    if (!gl) throw new Error('sin WebGL');
    hudCtx = hudCv.getContext('2d');
    glCv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fallback('se perdió el contexto de la placa'); });

    prog = program(VS, FS);
    U = {};
    for (const n of ['uVP', 'uOff', 'uScale', 'uMode', 'uColor', 'uTex', 'uRot']) U[n] = gl.getUniformLocation(prog, n);
    U.aPos = gl.getAttribLocation(prog, 'aPos');
    U.aNor = gl.getAttribLocation(prog, 'aNor');
    U.aUv = gl.getAttribLocation(prog, 'aUv');
    prog2 = program(VS2, FS2);
    U2 = { uCenter: gl.getUniformLocation(prog2, 'uCenter'), uSize: gl.getUniformLocation(prog2, 'uSize'), uTex: gl.getUniformLocation(prog2, 'uTex'), uDepth: gl.getUniformLocation(prog2, 'uDepth'), uCut: gl.getUniformLocation(prog2, 'uCut'), aPos: gl.getAttribLocation(prog2, 'aPos') };

    mesh.side = buffer(cylinderSide(28));
    mesh.cap = buffer(cap(28));
    mesh.ball = buffer(sphere(12, 20));
    mesh.quad = buffer(quad());
    quad2 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad2);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    floorTex = texture(null, true);
    jointBuf = gl.createBuffer();
    {
      const c = doc.createElement('canvas');
      c.width = c.height = 32;
      const x = c.getContext('2d');
      // Un velo apenas blanco (para que la red se lea como superficie) y la trama.
      x.fillStyle = 'rgba(255,255,255,0.13)';
      x.fillRect(0, 0, 32, 32);
      x.strokeStyle = 'rgba(255,255,255,0.9)';
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(0, 1); x.lineTo(32, 1); x.moveTo(1, 0); x.lineTo(1, 32);
      x.moveTo(0, 17); x.lineTo(32, 17); x.moveTo(17, 0); x.lineTo(17, 32);
      x.stroke();
      netTex = texture(null, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      // Sin mipmaps a propósito: promediada de lejos, la trama se vuelve un velo
      // gris macizo. Es de 32×32: leerla entera no cuesta nada.
      upload(netTex, c, false);
    }

    // Las capas van pegadas al canvas del juego, que queda en su lugar pero sin verse.
    const parent = cv.parentNode;
    parent.insertBefore(glCv, cv.nextSibling);
    parent.insertBefore(hudCv, glCv.nextSibling);
    cv.style.visibility = 'hidden';
    view.addEventListener('resize', place);
    view.__tvm3dHud = hudCtx;
    log('info', `vista 3D: lista (${camName})`);
  }

  /* Mismo lugar y tamaño que el canvas del juego. */
  function place() {
    if (!gameCv || !glCv) return;
    const r = gameCv.getBoundingClientRect();
    for (const c of [glCv, hudCv]) {
      c.style.left = `${r.left}px`;
      c.style.top = `${r.top}px`;
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
    }
  }
  function syncSize() {
    const w = gameCv.width, h = gameCv.height;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    glCv.width = w; glCv.height = h;
    hudCv.width = w; hudCv.height = h;
    place();
  }

  /* El piso: el propio dibujo del estadio de HaxBall, una vez por estadio. */
  function buildFloor(F, N, st) {
    const bx = Math.abs(Number(st[N.boundX]) || 0), by = Math.abs(Number(st[N.boundY]) || 0);
    const hx = Math.max(200, bx) + 140, hy = Math.max(120, by) + 140;
    const maxTex = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
    // Potencias de 2 (para los mipmaps), ~1,5 píxeles por unidad y nunca más de lo que banca la placa.
    const W = Math.min(maxTex, pow2(Math.round(2 * hx * 1.5))), H = Math.min(maxTex, pow2(Math.round(2 * hy * 1.5)));
    const sx = W / (2 * hx), sy = H / (2 * hy);
    floorCv.width = W; floorCv.height = H;
    const ctx = floorCv.getContext('2d', { alpha: false });
    const r = F.r;
    const oc = r.c, ov = r[N.cv];
    r.c = ctx;
    r[N.cv] = { width: W, height: H };
    try {
      ctx.setTransform(sx, 0, 0, sy, W / 2, H / 2);
      ctx.lineWidth = 3;
      r[N.drawFloor](st);
      if (typeof view.__tvmSkin === 'function') {
        ctx.save();
        try { view.__tvmSkin(ctx, W, H, st); } catch (e) { /* la piel es un adorno */ }
        ctx.restore();
      }
      ctx.setTransform(sx, 0, 0, sy, W / 2, H / 2);
      ctx.lineWidth = 3;
      r[N.drawWalls](st);
    } finally {
      r.c = oc;
      r[N.cv] = ov;
    }
    // El color del borde de la textura sigue de largo hasta el horizonte.
    try {
      const px = ctx.getImageData(1, 1, 1, 1).data;
      groundRgb = [px[0] / 255, px[1] / 255, px[2] / 255];
    } catch (e) { /* queda el anterior */ }
    upload(floorTex, floorCv, true);
    floorX = hx; floorY = hy;
    if (standBufs) for (const side of standBufs) for (const m of side) gl.deleteBuffer(m.b);
    standBufs = [0, 1, 2, 3].map((side) => stands(side, bx || hx - 140, by || hy - 140).map(buffer));
    if (standLow) for (const side of standLow) for (const m of side) gl.deleteBuffer(m.b);
    standLow = [0, 1, 2, 3].map((side) => stands(side, bx || hx - 140, by || hy - 140, 2).map(buffer));
    if (decorSolid) gl.deleteBuffer(decorSolid.b);
    if (decorNet) gl.deleteBuffer(decorNet.b);
    const discs0 = (F.world && F.world[N.discs]) || [];
    const d = decor(N, st, discs0, bx || hx - 140, by || hy - 140);
    decorSolid = d.solid.length ? buffer(d.solid) : null;
    decorNet = d.net.length ? buffer(d.net) : null;
    goalEnds = d.ends;
    floorFor = st;
    floorDirty = false;
  }

  /* ── Dibujo ── */
  let curMode = -1;
  function use(m) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.b);
    gl.vertexAttribPointer(U.aPos, 3, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(U.aNor, 3, gl.FLOAT, false, 32, 12);
    gl.vertexAttribPointer(U.aUv, 2, gl.FLOAT, false, 32, 24);
  }
  function draw(m, mode, x, y, z, sx, sy, sz, r, g, b, a) {
    use(m);
    if (mode !== curMode) { gl.uniform1i(U.uMode, mode); curMode = mode; }
    gl.uniform3f(U.uOff, x, y, z);
    gl.uniform3f(U.uScale, sx, sy, sz);
    gl.uniform4f(U.uColor, r, g, b, a);
    gl.drawArrays(gl.TRIANGLES, 0, m.n);
  }

  /*
   * La tapa de la ficha: los MISMOS pasos con los que el juego dibuja la ficha
   * en 2D (relleno con su camiseta, círculo, contorno), hechos sobre un canvas
   * chico del documento del juego. Así se enganchan solos todos los ajustes del
   * cliente que actúan sobre ese dibujo —avatar con imagen, GIF, formas y
   * estilos de ficha, contornos, gráficos planos— y lo que ves en 3D es lo
   * mismo que verías en 2D, sin copiar a mano cada ajuste.
   *
   * El disco ocupa KIT_R de los KIT/2 píxeles: el resto es margen para el
   * contorno, y la tapa en 3D se agranda en esa misma proporción.
   */
  const KIT = 128, KIT_R = 50;
  const KIT_SCALE = (KIT / 2) / KIT_R;
  const kitCv = view.document.createElement('canvas');
  kitCv.width = kitCv.height = KIT;
  const kitCtx = kitCv.getContext('2d');
  function paintKit(t, L, N, d, pl, check) {
    const rad = d[N.radius] || 15, pos = d[N.pos];
    const k = KIT_R / rad;
    const ctx = kitCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, KIT, KIT);
    // Coordenadas de cancha, igual que el juego: hay ajustes que miran dónde está la ficha.
    ctx.setTransform(k, 0, 0, k, KIT / 2 - k * pos.x, KIT / 2 - k * pos.y);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.fillStyle = L[N.pattern] || '#888';
    ctx.strokeStyle = L[N.stroke] || 'black';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, rad, 0, 2 * Math.PI, false);
    ctx.save();
    const sc = rad / 32;
    ctx.translate(pos.x, pos.y);
    ctx.scale(sc, sc);
    ctx.translate(-32, -32);
    ctx.fill();
    ctx.restore();
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    /*
     * Respaldo: si el dibujo salió vacío en el centro (no debería), la ficha
     * va con el color de su equipo y no negra. Se mira sólo cuando cambió la
     * camiseta, que es casi nunca: leer el canvas cuesta.
     */
    if (check) {
      try {
        const px = ctx.getImageData(KIT / 2 - 6, KIT / 2 - 6, 12, 12).data;
        let alpha = 0;
        for (let i = 3; i < px.length; i += 4) alpha += px[i];
        if (!alpha) {
          const team = pl && pl[N.team];
          const c = team ? team[N.color] | 0 : 0x888888;
          ctx.fillStyle = `rgb(${(c >>> 16) & 255},${(c >>> 8) & 255},${c & 255})`;
          ctx.beginPath();
          ctx.arc(KIT / 2, KIT / 2, KIT_R, 0, 2 * Math.PI);
          ctx.fill();
          if (!t.warned) { t.warned = true; log('warn', 'vista 3D: una ficha salió vacía, va con el color del equipo'); }
        }
      } catch (e) { /* sin lectura: queda lo que hay */ }
    }
    upload(t.kit, kitCv, true);
  }

  /*
   * La pelota del cliente, igual: los pasos del 2D (color, círculo, el gancho
   * de la pelota del cliente y el contorno) en un canvas propio, que después se
   * pega de frente a la cámara. Sólo si hay algo personalizado: si no, va la
   * esfera de siempre, que no cuesta nada.
   */
  const BALL = 64, BALL_R = 18;
  let ballLastX = NaN, ballLastY = NaN;
  const ballCv = view.document.createElement('canvas');
  ballCv.width = ballCv.height = BALL;
  const ballCtx = ballCv.getContext('2d');
  let ballTex = null;
  function paintBall(d, N) {
    const rad = d[N.radius] || 10, pos = d[N.pos];
    // Quieta y sin animación: queda la que ya está en la placa.
    if (ballTex && Math.abs(pos.x - ballLastX) + Math.abs(pos.y - ballLastY) < 0.05 && frameNo % 6 !== 0) return;
    ballLastX = pos.x; ballLastY = pos.y;
    const k = BALL_R / rad;
    const ctx = ballCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, BALL, BALL);
    ctx.setTransform(k, 0, 0, k, BALL / 2 - k * pos.x, BALL / 2 - k * pos.y);
    ctx.lineWidth = 2;
    const col = d[N.color] | 0;
    ctx.beginPath();
    ctx.fillStyle = col === -1 ? 'rgba(255,255,255,255)' : `rgba(${(col >>> 16) & 255},${(col >>> 8) & 255},${col & 255},255)`;
    ctx.strokeStyle = 'black';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, rad, 0, 2 * Math.PI, false);
    let done = false;
    try { done = typeof view.__tvmBall === 'function' && !!view.__tvmBall(ctx, pos.x, pos.y, rad, 0); } catch (e) { done = false; }
    if (!done && col !== -1) ctx.fill();
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!ballTex) ballTex = texture(null, true);
    upload(ballTex, ballCv, true);
  }

  function texturesFor(L, N, d, mine, pl) {
    let t = per.get(L);
    if (!t) { t = { kit: texture(null, true), kitPat: undefined, kitStroke: undefined, kitRad: 0, name: texture(null, true), nameStr: undefined, seen: 0 }; per.set(L, t); }
    t.seen = frameNo;
    const pat = L[N.pattern], st = L[N.stroke], rad = d[N.radius];
    // Se rehace cuando cambia la camiseta, el borde de la patada o el radio. La
    // tuya además cada 8 cuadros: los estilos del cliente pueden ser animados.
    if (pat !== t.kitPat || st !== t.kitStroke || rad !== t.kitRad || (mine && (frameNo & 7) === 0)) {
      paintKit(t, L, N, d, pl, pat !== t.kitPat);
      t.kitPat = pat; t.kitStroke = st; t.kitRad = rad;
    }
    const nm = L[N.name];
    if (nm !== t.nameStr) {
      const ctx = L[N.nameCv];
      if (ctx && ctx.canvas) upload(t.name, ctx.canvas);
      t.nameStr = nm;
    }
    return t;
  }
  function sweep() {
    for (const [L, t] of per) {
      if (frameNo - t.seen > 120) { gl.deleteTexture(t.kit); gl.deleteTexture(t.name); per.delete(L); }
    }
  }

  /* Reusados en cada cuadro para no crear basura. */
  const names = [];
  const clip = new Float32Array(4);
  function project(x, y, z) {
    const m = vp;
    clip[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    clip[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    clip[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    clip[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
    return clip[3] > 0;
  }

  function frame(F) {
    const N = view.__tvm3dN;
    if (!N) return false;
    if (!gl) setup(F.cv);
    if (gl.isContextLost()) return false;
    syncSize();
    frameNo++;

    const r = F.r, game = F.game, world = F.world;
    const st = game[N.stadium];
    if (!st) return false;
    if (floorDirty || st !== floorFor) buildFloor(F, N, st);

    let mirror = false;
    if (typeof view.__tvmWantMirror === 'function') { try { mirror = !!view.__tvmWantMirror(r); } catch (e) { mirror = false; } }
    const mx = mirror ? -1 : 1;

    // Pausa: el mismo gris que pone el juego.
    const p = Number(game[N.paused]) > 0;
    if (p !== paused) { paused = p; glCv.style.filter = p ? 'grayscale(70%)' : ''; }

    // Cámara.
    const W = glCv.width, H = glCv.height;
    const z = Number(F.z) > 0 ? Number(F.z) : 1.5 * (view.devicePixelRatio || 1);
    const visH = H / z;
    const gameTarget = r[N.cam] || { x: 0, y: 0 };
    let cam = CAMS[camName] || CAMS.tribuna;
    // Dónde se para la cámara respecto del punto que mira (en el piso): por
    // defecto, del lado de abajo de la cancha.
    let ox = 0, oz = 1;
    /*
     * La cámara es propia y suave, a propósito.
     *
     * La del juego sigue a las posiciones EXTRAPOLADAS: con extrapolación alta,
     * cada tecla que tocás mueve tu ficha (y la cámara) al toque y después se
     * corrige, y en 3D eso se nota como tirones. Acá se mira lo mismo que mira
     * HaxBall —la pelota y tu ficha, sin que tu ficha se salga de cuadro— pero
     * el punto se persigue con un filtro de ~0,4 s: se mueve fluido y no
     * responde a cada toque de tecla ni a cada corrección de la red.
     */
    const discsNow = world[N.discs] || [];
    const ballD = discsNow[0];
    const bp = ballD && ballD[N.pos];
    const me = F.me && F.me[N.pos] ? F.me : null;
    const mp = me ? me[N.pos] : null;
    let gx, gz, attack = 0;
    if (cam.follow) {
      const team = F.pl && F.pl[N.team];
      const tid = team ? team[N.teamId] : 0;
      if (mp && (tid === 1 || tid === 2)) {
        // El rojo ataca hacia la derecha y el azul hacia la izquierda: la cámara
        // se para detrás de tu arco y mira al del rival.
        attack = (tid === 1 ? 1 : -1) * mx;
        ox = -attack; oz = 0;
        setRot(attack > 0 ? ROT_POS : ROT_NEG);
      } else {
        // Mirando (sin ficha en la cancha): la de la tribuna.
        cam = CAMS.tribuna;
        setRot(null);
      }
    } else setRot(null);
    if (bp && mp) {
      // Como HaxBall: el medio entre la pelota y vos, pero sin dejarte afuera.
      gx = mx * (bp.x + mp.x) / 2; gz = (bp.y + mp.y) / 2;
      const lim = visH * 0.3;
      const mxp = mx * mp.x;
      if (gx - mxp > lim) gx = mxp + lim; else if (mxp - gx > lim) gx = mxp - lim;
      if (gz - mp.y > lim) gz = mp.y + lim; else if (mp.y - gz > lim) gz = mp.y - lim;
    } else if (bp) {
      gx = mx * bp.x; gz = bp.y;
    } else {
      gx = mx * gameTarget.x; gz = gameTarget.y;
    }
    // En la vertical se mira un poco más adelante, hacia el arco rival.
    if (attack) gx += attack * visH * 0.12;
    const dt = Math.min(0.1, Math.max(0, Number(F.dt) || 0.016));
    if (!follow || follow.cam !== camName || follow.attack !== attack || Math.abs(follow.x - gx) + Math.abs(follow.z - gz) > 2500) {
      follow = { x: gx, z: gz, cam: camName, attack };
    } else {
      const kf = 1 - Math.exp(-dt * 2.6);
      follow.x += (gx - follow.x) * kf;
      follow.z += (gz - follow.z) * kf;
    }
    const tx = follow.x, tz = follow.z;
    const tilt = cam.tilt * Math.PI / 180;
    const D = (visH / 2) / Math.tan(FOV / 2) * cam.dist;
    const back = D * Math.sin(tilt);
    perspective(proj, FOV, W / H, D * 0.05, D * 8);
    lookAt(viewM, tx + ox * back, D * Math.cos(tilt), tz + oz * back, tx, 0, tz);
    multiply(vp, proj, viewM);
    // La tribuna que queda detrás de la cámara no se dibuja: taparía la cancha.
    const behind = oz === 1 ? 0 : oz === -1 ? 1 : ox === 1 ? 2 : 3;

    gl.viewport(0, 0, W, H);
    gl.clearColor(0.035, 0.045, 0.08, 1); // cielo de noche
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(prog);
    curMode = -1;
    gl.enableVertexAttribArray(U.aPos);
    gl.enableVertexAttribArray(U.aNor);
    gl.enableVertexAttribArray(U.aUv);
    gl.uniformMatrix4fv(U.uVP, false, vp);
    gl.uniform1i(U.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    // En espejo se dan vuelta las posiciones y el piso, no las camisetas: igual que
    // en 2D, el número tiene que seguir leyéndose derecho. En la vista vertical
    // se giran con la cámara, por lo mismo.
    gl.uniform1f(U.uRot, ox > 0 ? -1 : ox < 0 ? 1 : 0);

    /*
     * Orden de dibujo: de adelante hacia atrás. Primero lo que tapa (fichas,
     * pelota, estadio), después el piso y el suelo de afuera: la placa
     * descarta antes de pintarlo todo lo que ya quedó tapado. Lo transparente
     * (sombras, red, nombres) va al final.
     */
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);

    // Juntar lo que hay en la cancha.
    const discs = world[N.discs] || [];
    const players = F.room[N.players] || [];
    const map = r[N.draw];
    playerDiscs.clear();
    names.length = 0;
    let ballSprite = null;
    // Los discos de los jugadores, antes de todo: las sombras y los aros los necesitan.
    const playerSet = playerDiscs;
    for (let i = 0; i < players.length; i++) { const d = players[i][N.disc]; if (d) playerSet.add(d); }

    // Jugadores: disco con la camiseta arriba y el borde de la patada al costado.
    // Todas las tapas a la misma altura (ver CONTACT_Y).
    for (let i = 0; i < players.length; i++) {
      const pl = players[i];
      const d = pl[N.disc];
      if (!d) continue;
      playerDiscs.add(d);
      const L = map && map.get(pl[N.id]);
      const rad = d[N.radius];
      if (!(rad >= 0) || !L) continue;
      const pos = d[N.pos];
      const x = mx * pos.x, zz = pos.y;
      const mine = d === F.me;
      const t = texturesFor(L, N, d, mine, pl);
      const kick = L[N.stroke] === 'white';
      const c = kick ? 0.95 : 0.09;
      draw(mesh.side, 0, x, 0, zz, rad, CONTACT_Y, rad, c, c, c, 1);
      gl.bindTexture(gl.TEXTURE_2D, t.kit);
      // La tapa un poco más grande: el dibujo trae su contorno alrededor.
      draw(mesh.cap, 1, x, 0.02, zz, rad * KIT_SCALE, CONTACT_Y, rad * KIT_SCALE, 1, 1, 1, 1);
      names.push(t, x, zz, rad);
    }

    // Pelota y discos del estadio (palos y adornos).
    for (let i = 0; i < discs.length; i++) {
      const d = discs[i];
      if (playerDiscs.has(d)) continue;
      const rad = d[N.radius];
      if (!(rad >= 0)) break;
      const col = d[N.color] | 0;
      const pos = d[N.pos];
      // Sin color: en 2D es sólo el aro negro (y la pelota rebota igual contra
      // él). Acá, una pared fina negra a la misma altura: se ve y se entiende.
      if (col === -1 && i !== 0) continue; // ya va como aro en el piso
      // Sin arreglos nuevos: esto corre por cada disco en cada cuadro.
      const cr = col === -1 ? 1 : ((col >>> 16) & 255) / 255;
      const cg = col === -1 ? 1 : ((col >>> 8) & 255) / 255;
      const cb = col === -1 ? 1 : (col & 255) / 255;
      if (i === 0) {
        // La del cliente (estilo, color, imagen, tamaño…) va de frente más abajo.
        let custom = false;
        try { custom = typeof opts.ballCustom === 'function' && !!opts.ballCustom(); } catch (e) { custom = false; }
        if (custom) { paintBall(d, N); ballSprite = d; continue; }
        // El ecuador de la pelota, a la altura de las tapas de las fichas.
        draw(mesh.ball, 0, mx * pos.x, CONTACT_Y, pos.y, rad, rad, rad, cr, cg, cb, 1);
      } else {
        let h = Math.max(rad * POST_H, CONTACT_Y + 4);
        // Si está en la punta de un arco, es un palo: llega hasta el travesaño.
        for (let k = 0; k < goalEnds.length; k += 3) {
          const ddx = pos.x - goalEnds[k], ddz = pos.y - goalEnds[k + 1];
          if (ddx * ddx + ddz * ddz <= (rad + 3) * (rad + 3)) { h = goalEnds[k + 2]; break; }
        }
        draw(mesh.side, 0, mx * pos.x, 0, pos.y, rad, h, rad, cr * 0.8, cg * 0.8, cb * 0.8, 1);
        draw(mesh.cap, 0, mx * pos.x, 0, pos.y, rad, h, rad, cr, cg, cb, 1);
      }
    }
    // Uniones entre discos: cintas finas del color de la unión, como las líneas del 2D.
    const js = world[N.joints];
    if (js && js.length) {
      if (jointData.length < js.length * 48) jointData = new Float32Array(js.length * 48);
      let n = 0;
      for (let i = 0; i < js.length; i++) {
        const j = js[i];
        const col = j[N.jointColor];
        if (!(col >= 0)) continue;
        const da = discs[j[N.jointA]], db = discs[j[N.jointB]];
        if (!da || !db) continue;
        const pa = da[N.pos], pb = db[N.pos];
        const ax = mx * pa.x, az = pa.y, bx = mx * pb.x, bz = pb.y;
        let px = -(bz - az), pz = bx - ax;
        const len = Math.hypot(px, pz) || 1;
        px = (px / len) * 1.5; pz = (pz / len) * 1.5;
        const cr = ((col >>> 16) & 255) / 255, cg = ((col >>> 8) & 255) / 255, cb = (col & 255) / 255;
        n = jv(n, ax - px, az - pz, cr, cg, cb);
        n = jv(n, bx - px, bz - pz, cr, cg, cb);
        n = jv(n, bx + px, bz + pz, cr, cg, cb);
        n = jv(n, ax - px, az - pz, cr, cg, cb);
        n = jv(n, bx + px, bz + pz, cr, cg, cb);
        n = jv(n, ax + px, az + pz, cr, cg, cb);
      }
      if (n) {
        gl.bindBuffer(gl.ARRAY_BUFFER, jointBuf);
        gl.bufferData(gl.ARRAY_BUFFER, jointData.subarray(0, n), gl.DYNAMIC_DRAW);
        jointMesh.b = jointBuf; jointMesh.n = n / 8;
        draw(jointMesh, 5, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1);
      }
    }
    // Estadio fijo: paredes que hacen rebotar la pelota, arcos, carteles, torres.
    if (decorSolid) {
      draw(decorSolid, 5, 0, 0, 0, mx, 1, 1, 1, 1, 1, 1);
    }
    // Tribunas.
    if (standBufs) {
      for (let side = 0; side < 4; side++) {
        // La del lado de la cámara, baja: cierra el estadio sin tapar la cancha.
        const set = side === behind ? standLow : standBufs;
        const parts = set[side];
        for (let k = 0; k < parts.length; k++) {
          const m = parts[k];
          if (!m.n) continue;
          draw(m, 5, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1);
        }
      }
    }

    // Piso: la cancha y después el suelo de afuera (lo tapado no se pinta).
    gl.bindTexture(gl.TEXTURE_2D, floorTex);
    draw(mesh.quad, 2, 0, 0, 0, mx * floorX, 1, floorY, 1, 1, 1, 1);

    draw(mesh.quad, 4, tx, -0.5, tz, D * 6, 1, D * 6, groundRgb[0] * 0.55, groundRgb[1] * 0.55, groundRgb[2] * 0.55, 1);

    // Sombras (sobre el piso, debajo de todo lo demás).
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (let i = 0; i < discs.length; i++) {
      const d = discs[i];
      const rad = d[N.radius];
      if (!(rad >= 0)) break;
      const pos = d[N.pos];
      // Sin color: en 2D es sólo un aro negro fino en el piso. Igual acá, y sin sombra.
      if (i !== 0 && (d[N.color] | 0) === -1 && !playerSet.has(d)) {
        draw(mesh.quad, 6, mx * pos.x, 0.4, pos.y, rad + 1.2, 1, rad + 1.2, 0, 0, 0, 0.85);
        continue;
      }
      draw(mesh.quad, 3, mx * pos.x + rad * 0.3, 0.3, pos.y + rad * 0.25, rad * 1.4, 1, rad * 1.4, 0, 0, 0, 0.42);
    }
    // Tu aro en el piso: el mismo círculo claro que pone el juego en 2D.
    if (F.me && F.me[N.pos] && F.me[N.radius] >= 0) {
      const mp = F.me[N.pos];
      draw(mesh.quad, 6, mx * mp.x, 0.35, mp.y, 26, 1, 26, 1, 1, 1, 0.38);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // La red: transparente, después de todo lo sólido y sin tapar profundidad.
    if (decorNet) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindTexture(gl.TEXTURE_2D, netTex);
      draw(decorNet, 2, 0, 0, 0, mx, 1, 1, 1, 1, 1, 1);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.disableVertexAttribArray(U.aNor);
    gl.disableVertexAttribArray(U.aUv);

    // La pelota del cliente: de frente, con profundidad (la tapan las fichas que
    // pasan adelante) y recortada por su silueta.
    const half = H / 2;
    if (ballSprite || names.length) {
      gl.useProgram(prog2);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad2);
      gl.vertexAttribPointer(U2.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(U2.uTex, 0);
    }
    if (ballSprite) {
      const pos = ballSprite[N.pos], rad = ballSprite[N.radius];
      if (project(mx * pos.x, CONTACT_Y, pos.y)) {
        const ppu = (proj[5] * half) / clip[3];
        const size = rad * ((BALL / 2) / BALL_R) * ppu;
        gl.enable(gl.DEPTH_TEST);
        gl.uniform1f(U2.uDepth, Math.max(-1, Math.min(1, clip[2] / clip[3])));
        gl.uniform1f(U2.uCut, 0.5);
        gl.bindTexture(gl.TEXTURE_2D, ballTex);
        gl.uniform2f(U2.uCenter, clip[0] / clip[3], clip[1] / clip[3]);
        gl.uniform2f(U2.uSize, size / (W / 2), size / half);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
    // Nombres: siempre de frente y debajo de la ficha en la pantalla, del tamaño
    // que le toca por la distancia (los de lejos, un poco más chicos).
    if (names.length) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(U2.uDepth, 0);
      gl.uniform1f(U2.uCut, 0.004);
      for (let i = 0; i < names.length; i += 4) {
        if (!project(names[i + 1], CONTACT_Y, names[i + 2])) continue;
        const cx = clip[0] / clip[3], cy = clip[1] / clip[3];
        // Píxeles por unidad de cancha a esa distancia, acotado para que se lea.
        const ppu = Math.max(z * 0.7, Math.min(z * 1.3, (proj[5] * half) / clip[3]));
        const sw = (40 * ppu) / (W / 2), sh = (8.5 * ppu) / half;
        const down = ((names[i + 3] + 6) * ppu) / half;
        gl.bindTexture(gl.TEXTURE_2D, names[i].name);
        gl.uniform2f(U2.uCenter, cx, cy - down - sh);
        gl.uniform2f(U2.uSize, sw, sh);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.disable(gl.BLEND);
    }
    gl.disableVertexAttribArray(U.aPos);

    if ((frameNo & 255) === 0) sweep();
    return true;
  }

  /* Cualquier problema: se desarma todo y el juego vuelve a su 2D de siempre. */
  function fallback(why) {
    if (dead) return;
    dead = true;
    try { view.__tvm3d = undefined; view.__tvm3dHud = undefined; } catch (e) { /* nada */ }
    try { setRot(null); } catch (e) { /* nada */ }
    try { if (gameCv) gameCv.style.visibility = ''; } catch (e) { /* nada */ }
    try { if (glCv) glCv.remove(); if (hudCv) hudCv.remove(); } catch (e) { /* nada */ }
    try { view.removeEventListener('resize', place); } catch (e) { /* nada */ }
    log(why === 'la apagaste' ? 'info' : 'warn', `vista 3D apagada: ${why}. Sigue en 2D.`);
  }

  view.__tvm3d = (F) => {
    if (dead) return false;
    try {
      return frame(F);
    } catch (err) {
      fallback(err && err.message ? err.message : String(err));
      return false;
    }
  };

  return {
    setCam(name) { if (CAMS[name]) camName = name; },
    refreshFloor() { floorDirty = true; },
    dispose() { fallback('la apagaste'); }
  };
}

module.exports = { install, CAMS };
