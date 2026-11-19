'use strict';

/*
 * Pelotas 3D modeladas sobre la esfera entera.
 *
 * Antes la pelota 3D usaba el dibujo plano de la miniatura como cara de
 * adelante y el mismo dibujo espejado como cara de atrás. Lo que en el dibujo
 * está cerca del borde viene aplastado, así que al girar se estiraba, y donde se
 * juntaban las dos caras las formas no coincidían.
 *
 * Acá cada estilo es una función de la DIRECCIÓN (un punto de la esfera) a un
 * color: la de fútbol tiene sus 12 pentágonos y 20 hexágonos de verdad, la de
 * tenis su costura que da la vuelta, la Tierra sus continentes. Se calcula una
 * sola vez por estilo en un mapa de cubo (6 caras de N×N) y al dibujar sólo se
 * lee: girar no cuesta más que antes.
 *
 * Ejes: +z mira hacia la pantalla (la cara que coincide con la miniatura), +x a
 * la derecha y +y hacia ABAJO (como el canvas).
 */

const N = 96; // texels por lado de cada cara del cubo

/* ── Vectores y ruido ───────────────────────────────────────────── */
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    r += hash3(xi + i, yi + j, zi + k) * (i ? u : 1 - u) * (j ? v : 1 - v) * (k ? w : 1 - w);
  }
  return r;
}
function fbm(p, freq, oct, seed) {
  let a = 0.5, f = freq, s = 0, n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * vnoise(p[0] * f + seed * 17.1, p[1] * f + seed * 3.7, p[2] * f - seed * 9.3);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}
/** Puntos casi parejos sobre la esfera (espiral de Fibonacci). */
function fibonacci(n, seed) {
  const out = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * g + seed;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}
function randomPoints(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = hash3(i, seed, 7) * Math.PI * 2;
    const z = hash3(i, seed, 11) * 2 - 1;
    const r = Math.sqrt(1 - z * z);
    out.push([Math.cos(a) * r, Math.sin(a) * r, z]);
  }
  return out;
}
/** Mejor y segundo mejor coseno contra una lista de centros (celdas de Voronoi). */
function nearest2(p, centers) {
  let b1 = -2, b2 = -2, i1 = -1;
  for (let i = 0; i < centers.length; i++) {
    const d = dot(p, centers[i]);
    if (d > b1) { b2 = b1; b1 = d; i1 = i; } else if (d > b2) b2 = d;
  }
  return { i: i1, d1: b1, d2: b2 };
}

/* ── Sólidos ────────────────────────────────────────────────────── */
// Icosaedro con un vértice mirando a la pantalla (+z): la de fútbol muestra un
// pentágono en el centro, como la miniatura.
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  // Rotar para que v[5] quede en +z.
  const target = v[5];
  const ax = norm([target[1], -target[0], 0]); // eje perpendicular a target y z
  const ang = Math.acos(target[2]);
  const rot = (p) => { // Rodrigues: rota `ang` alrededor de `ax` (lleva target → +z)
    const c = Math.cos(ang), s = Math.sin(ang), k = ax;
    const kd = dot(k, p);
    const cr = [k[1] * p[2] - k[2] * p[1], k[2] * p[0] - k[0] * p[2], k[0] * p[1] - k[1] * p[0]];
    return norm([p[0] * c + cr[0] * s + k[0] * kd * (1 - c), p[1] * c + cr[1] * s + k[1] * kd * (1 - c), p[2] * c + cr[2] * s + k[2] * kd * (1 - c)]);
  };
  v = v.map(rot);
  if (v[5][2] < 0) v = v.map((p) => [p[0], p[1], -p[2]]);
  // Caras: tríos de vértices a distancia de arista.
  const edge = Math.max(...v.slice(1).map((p) => dot(p, v[0])));
  const faces = [];
  for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) for (let c = b + 1; c < 12; c++) {
    if (dot(v[a], v[b]) > edge - 1e-6 && dot(v[a], v[c]) > edge - 1e-6 && dot(v[b], v[c]) > edge - 1e-6) {
      faces.push(norm([v[a][0] + v[b][0] + v[c][0], v[a][1] + v[b][1] + v[c][1], v[a][2] + v[b][2] + v[c][2]]));
    }
  }
  return { verts: v, faces };
})();

/** Curva de la costura de tenis / béisbol (da la vuelta entera). */
const SEAM = (() => {
  const pts = [];
  const a = 0.5, b = 0.5; // forma clásica: x=a cos t + b cos 3t …
  for (let i = 0; i < 160; i++) {
    const t = (i / 160) * Math.PI * 2;
    const p = norm([a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), 2 * Math.sqrt(a * b) * Math.sin(2 * t)]);
    // Se acuesta para que de frente se vea como en la miniatura (dos arcos a los costados).
    pts.push({ p: [p[0], p[2], p[1]], t });
  }
  return pts;
})();
function seamDist(p) {
  let best = -2, bt = 0;
  for (const s of SEAM) { const d = dot(p, s.p); if (d > best) { best = d; bt = s.t; } }
  return { ang: Math.acos(Math.min(1, best)), t: bt };
}

/* ── Calcomanías: un dibujo plano puesto sobre un casquete ─────── */
/*
 * Para lo que es un DIBUJO (el 8, la carita, el ojo, la moneda…): el centro de
 * la miniatura se pega sobre un casquete chico, donde casi no se deforma. Lo
 * demás de la pelota sigue con su material.
 */
function decal(src, p, center, right, down, alpha, srcFrac) {
  const c = dot(p, center);
  const ca = Math.cos(alpha);
  if (c <= ca) return null;
  const sa = Math.sin(alpha);
  const a = dot(p, right) / sa;
  const b = dot(p, down) / sa;
  const R = src.size / 2;
  const sx = R + a * srcFrac * R;
  const sy = R + b * srcFrac * R;
  const ix = Math.min(src.size - 1, Math.max(0, sx | 0));
  const iy = Math.min(src.size - 1, Math.max(0, sy | 0));
  const k = (iy * src.size + ix) * 4;
  const d = src.data;
  // Borde suave del casquete, para que no quede un recorte.
  const edge = smooth(ca, ca + (1 - ca) * 0.18, c);
  return { c: [d[k], d[k + 1], d[k + 2]], a: (d[k + 3] / 255) * edge };
}
const FRONT = [[0, 0, 1], [1, 0, 0], [0, 1, 0]];
const BACK = [[0, 0, -1], [-1, 0, 0], [0, 1, 0]];
function withDecal(base, d) { return d ? mixc(base, d.c, d.a) : base; }

/* ── Los modelos ───────────────────────────────────────────────── */
const C = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const RANDOM = {};
const ptsOf = (key, make) => RANDOM[key] || (RANDOM[key] = make());

const MODELS = {
  soccer(p) {
    const cells = ptsOf('soccer', () => ICO.verts.concat(ICO.faces));
    const n = nearest2(p, cells);
    if (n.d1 - n.d2 < 0.012) return [55, 58, 66];
    return n.i < 12 ? [22, 24, 29] : [246, 246, 244];
  },
  triangles(p) {
    p = TRI_ROT(p); // una cara (no un vértice) mirando al frente, como la miniatura
    const n = nearest2(p, ICO.faces);
    if (n.d1 - n.d2 < 0.012) return [236, 236, 240];
    return [[217, 40, 52], [246, 246, 248], [30, 60, 140]][TRI_COLORS()[n.i]];
  },
  vintage(p) { return panelBall(p, [C('#7a4a2a'), C('#8a5632'), C('#6d4024')], [52, 30, 18], 0.35); },
  volley(p) { return panelBall(p, [C('#f3f3f0'), C('#1f4fa8'), C('#f2c418')], [120, 120, 130], 0.05); },
  tennis(p) {
    const s = seamDist(p);
    const fuzz = fbm(p, 9, 3, 2);
    const base = mixc(C('#c9e33a'), C('#e2f25a'), fuzz);
    if (s.ang < 0.05) return mixc([250, 250, 245], base, smooth(0.035, 0.05, s.ang));
    return base;
  },
  baseball(p) {
    const s = seamDist(p);
    const base = mixc(C('#f4f1ea'), C('#e6e1d6'), fbm(p, 6, 2, 3));
    if (s.ang < 0.018) return mixc(C('#cfc8bb'), base, s.ang / 0.018);
    if (s.ang > 0.03 && s.ang < 0.085 && Math.sin(s.t * 110) > 0.15) return C('#d0262f');
    return base;
  },
  basket(p) {
    const base = mixc(C('#e3631e'), C('#c9521a'), fbm(p, 14, 2, 5));
    // Dos círculos máximos (el ecuador y uno de costado) y las dos curvas
    // alrededor del eje que queda libre, un poco girado para que de frente se vea
    // como la miniatura: una línea al medio y dos arcos a los lados.
    const c = Math.cos(0.35), sn = Math.sin(0.35);
    const q = [p[0] * c + p[2] * sn, p[1], -p[0] * sn + p[2] * c];
    const w = 0.022;
    if (Math.abs(q[1]) < w || Math.abs(q[2]) < w) return [28, 22, 20];
    if (Math.abs(Math.abs(q[0]) - 0.72) < w * 1.1) return [28, 22, 20];
    return base;
  },
  golf(p) {
    const pts = ptsOf('golf', () => fibonacci(420, 0.3));
    const n = nearest2(p, pts);
    const ang = Math.acos(Math.min(1, n.d1));
    const base = [246, 246, 246];
    if (ang < 0.07) {
      // Hoyuelo: más oscuro en el lado de arriba a la izquierda (la luz viene de ahí).
      const c = pts[n.i];
      const side = (p[0] - c[0]) * -0.7 + (p[1] - c[1]) * -0.7;
      const k = 1 - ang / 0.07;
      return mixc(base, side > 0 ? [190, 192, 196] : [222, 224, 228], k);
    }
    return base;
  },
  bowling(p) {
    const m = fbm(p, 2.5, 4, 8);
    const swirl = Math.sin((p[0] * 3 + m * 6) + p[1] * 2);
    let c = mixc(C('#0b0d16'), C('#2a2f4a'), clamp01(0.5 + 0.5 * swirl) * 0.8);
    const holes = [[-0.17, -0.28], [0.17, -0.28], [0, 0.05]];
    for (const [hx, hy] of holes) {
      const h = norm([hx, hy, 1]);
      const ang = Math.acos(Math.min(1, dot(p, h)));
      if (ang < 0.085) c = mixc([4, 4, 6], c, smooth(0.06, 0.085, ang));
    }
    return c;
  },
  earth(p) {
    const lat = -p[1]; // arriba = −y
    if (Math.abs(lat) > 0.9 + 0.04 * fbm(p, 5, 2, 1)) return [240, 245, 250];
    const land = fbm(p, 2.2, 5, 4);
    if (land > 0.53) {
      const dry = fbm(p, 6, 2, 9);
      return mixc(C('#3f8f3a'), C('#a08048'), smooth(0.45, 0.7, dry) * (1 - Math.abs(lat)));
    }
    return mixc(C('#1d5fb4'), C('#2b7ad0'), smooth(0.35, 0.53, land));
  },
  moon(p) {
    let g = 150 + 60 * (fbm(p, 4, 4, 6) - 0.5);
    const craters = ptsOf('moon', () => randomPoints(26, 5).map((c, i) => ({ c, r: 0.06 + 0.16 * hash3(i, 2, 3) })));
    for (const k of craters) {
      const ang = Math.acos(Math.min(1, dot(p, k.c)));
      if (ang < k.r) g -= 38 * (1 - ang / k.r);
      else if (ang < k.r * 1.25) g += 28 * (1 - (ang - k.r) / (k.r * 0.25));
    }
    g = Math.max(60, Math.min(230, g));
    return [g, g, g + 6];
  },
  disco(p) {
    const lat = Math.asin(Math.max(-1, Math.min(1, p[1])));
    const rows = 18;
    const ri = Math.floor(((lat + Math.PI / 2) / Math.PI) * rows);
    const cols = Math.max(4, Math.round(36 * Math.cos(((ri + 0.5) / rows) * Math.PI - Math.PI / 2)));
    const lon = Math.atan2(p[0], p[2]);
    const cf = ((lon + Math.PI) / (Math.PI * 2)) * cols;
    const ci = Math.floor(cf);
    const rf = ((lat + Math.PI / 2) / Math.PI) * rows - ri;
    if (rf < 0.1 || cf - ci < 0.1) return [40, 40, 46];
    const b = 120 + 135 * hash3(ri, ci, 4);
    return [b, b, b + 8];
  },
  orb(p) { return spiral(p, C('#1a0f3a'), C('#53e0ff'), 0.6); },
  candy(p) {
    const th = Math.acos(Math.max(-1, Math.min(1, p[2])));
    const s = Math.sin(3 * Math.atan2(p[1], p[0]) + 5 * th);
    return s > 0 ? [216, 32, 50] : [250, 250, 250];
  },
  pumpkin(p, deco) {
    const lon = Math.atan2(p[0], p[2]);
    const rib = Math.abs(Math.cos(5 * lon));
    let c = mixc(C('#b9520f'), C('#f08a1c'), 0.35 + 0.65 * rib);
    if (-p[1] > 0.93) c = mixc(C('#3d5a1e'), C('#6b4a22'), fbm(p, 9, 2, 3));
    return withDecal(c, deco && decal(deco, p, ...FRONT, 0.68, 0.62));
  },
  melon(p) {
    const lon = Math.atan2(p[0], p[2]);
    const lat = Math.asin(Math.max(-1, Math.min(1, p[1])));
    const s = Math.sin(9 * lon + 0.8 * Math.sin(5 * lat) + 1.5 * fbm(p, 5, 2, 4));
    return s > 0.25 ? mixc(C('#0f4d16'), C('#123d12'), fbm(p, 8, 2, 1)) : mixc(C('#3c9a2c'), C('#58b83a'), fbm(p, 7, 2, 2));
  },
  sun(p) {
    const g = fbm(p, 7, 4, 3);
    return mixc(C('#e86a10'), C('#ffd24a'), smooth(0.3, 0.75, g));
  },
  fire(p) {
    const t = fbm([p[0] * 1.2, p[1] * 0.6 + fbm(p, 3, 2, 7), p[2] * 1.2], 3.5, 4, 2);
    const k = clamp01((t - 0.25) * 2);
    return k < 0.5 ? mixc(C('#6e0d05'), C('#ef4a12'), k * 2) : mixc(C('#ef4a12'), C('#ffe07a'), (k - 0.5) * 2);
  },
  lava(p) {
    const cells = ptsOf('lava', () => randomPoints(34, 9));
    const n = nearest2(p, cells);
    const crack = n.d1 - n.d2;
    if (crack < 0.03) return mixc(C('#ffd34a'), C('#ff6a12'), crack / 0.03);
    if (crack < 0.05) return mixc(C('#ff6a12'), C('#2a120c'), (crack - 0.03) / 0.02);
    return mixc(C('#1a0d0a'), C('#3a1c12'), fbm(p, 6, 2, 1));
  },
  ice(p) {
    const cells = ptsOf('ice', () => randomPoints(22, 3));
    const n = nearest2(p, cells);
    const base = mixc(C('#9fd8f2'), C('#d9f3fc'), fbm(p, 4, 3, 5));
    if (n.d1 - n.d2 < 0.012) return mixc(C('#5aa6cf'), base, (n.d1 - n.d2) / 0.012);
    return base;
  },
  gold(p) {
    // Metal liso: vetas largas y suaves en diagonal, sin manchas.
    const sheen = 0.5 + 0.5 * Math.sin((p[0] - p[1]) * 2.2 + p[2] * 0.8);
    return mixc(C('#c79c48'), C('#f3da8a'), sheen * 0.85 + 0.1);
  },
  neon(p) {
    let c = mixc(C('#04121f'), C('#0b3446'), fbm(p, 3, 2, 3));
    for (const z0 of [0.75, -0.75]) {
      const d = Math.abs(p[2] - z0);
      c = mixc(c, C('#00e5ff'), Math.exp(-(d * d) / 0.02) * 0.55);
      if (d < 0.025) c = mixc(C('#c9fdff'), c, d / 0.025);
    }
    return c;
  },
  beach(p) {
    if (Math.abs(p[2]) > 0.94) return [250, 250, 250];
    const a = Math.atan2(p[0], -p[1]);
    const i = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6 + 0.5) % 6;
    return [C('#f3c331'), C('#f6f6f6'), C('#e94b3c'), C('#f6f6f6'), C('#3d8fdc'), C('#f6f6f6')][(i + 6) % 6];
  },
  argentina(p, deco) {
    const c = Math.abs(p[1]) < 0.33 ? [250, 250, 250] : C('#74acdf');
    let out = withDecal(c, deco && decal(deco, p, ...FRONT, 0.2, 0.2));
    out = withDecal(out, deco && decal(deco, p, ...BACK, 0.2, 0.2));
    return out;
  },
  checker(p) {
    const ax = Math.abs(p[0]), ay = Math.abs(p[1]), az = Math.abs(p[2]);
    let s, t, f;
    if (ax >= ay && ax >= az) { s = p[1] / ax; t = p[2] / ax; f = p[0] > 0 ? 0 : 1; } else if (ay >= az) { s = p[0] / ay; t = p[2] / ay; f = p[1] > 0 ? 2 : 3; } else { s = p[0] / az; t = p[1] / az; f = p[2] > 0 ? 4 : 5; }
    const i = Math.floor((s + 1) * 1.5), j = Math.floor((t + 1) * 1.5);
    return (i + j + f) % 2 ? [20, 20, 22] : [246, 246, 246];
  },
  yinyang(p) {
    // De frente es el yin-yang de la miniatura; el color depende sólo de (x, y),
    // así que da la vuelta sin costuras.
    const x = p[0], y = p[1];
    const dTop = Math.hypot(x, y + 0.5), dBot = Math.hypot(x, y - 0.5);
    if (dTop < 0.15) return [245, 245, 245];
    if (dBot < 0.15) return [18, 18, 20];
    let dark = x > 0;
    if (dTop < 0.5) dark = true;
    if (dBot < 0.5) dark = false;
    return dark ? [18, 18, 20] : [245, 245, 245];
  },
  saturn(p) {
    const lat = p[1] + 0.25 * p[0];
    const b = Math.sin(lat * 14 + 1.5 * fbm(p, 4, 2, 1));
    let c = mixc(C('#c98f4a'), C('#efcf96'), 0.5 + 0.5 * b);
    if (Math.abs(lat) < 0.05) c = mixc(c, [80, 50, 30], 0.6);
    return c;
  },
  eight(p, deco) { return withDecal([16, 16, 18], deco && decal(deco, p, ...FRONT, 0.5, 0.5)); },
  smile(p, deco) { return withDecal(C('#ffd43b'), deco && decal(deco, p, ...FRONT, 0.95, 0.82)); },
  heart(p, deco) {
    let c = withDecal(C('#fde2ea'), deco && decal(deco, p, ...FRONT, 0.75, 0.66));
    return withDecal(c, deco && decal(deco, p, ...BACK, 0.75, 0.66));
  },
  star(p, deco) {
    let c = withDecal([250, 250, 250], deco && decal(deco, p, ...FRONT, 0.8, 0.74));
    return withDecal(c, deco && decal(deco, p, ...BACK, 0.8, 0.74));
  },
  eye(p) {
    const th = Math.acos(Math.max(-1, Math.min(1, p[2])));
    if (th < 0.2) {
      const hl = Math.hypot(p[0] + 0.07, p[1] + 0.08);
      return hl < 0.045 ? [255, 255, 255] : [10, 10, 14];
    }
    if (th < 0.42) return mixc(C('#1c63c4'), C('#4fa6f0'), (th - 0.2) / 0.22);
    if (th < 0.45) return [20, 40, 80];
    let c = [246, 243, 238];
    // Venitas finas, sólo hacia los costados y el fondo.
    if (th > 1.0) {
      const v = Math.abs(vnoise(p[0] * 4 + 3, p[1] * 4, p[2] * 4) - 0.5);
      if (v < 0.018) c = mixc(c, C('#d23a3a'), (1 - v / 0.018) * 0.7 * smooth(1.0, 1.4, th));
    }
    return c;
  },
  donut(p) {
    const th = Math.acos(Math.abs(p[2]));
    if (th < 0.32) return mixc(C('#6b3a1c'), C('#9b5a2c'), th / 0.32);
    const sp = ptsOf('donut', () => randomPoints(140, 4));
    const n = nearest2(p, sp);
    if (n.d1 > 0.9985) return [[255, 255, 255], [80, 170, 255], [255, 220, 60], [120, 220, 120], [255, 120, 60]][n.i % 5];
    return mixc(C('#f27fb0'), C('#f9a6cc'), fbm(p, 5, 2, 2));
  },
  peso(p, deco) {
    let c = mixc(C('#9a9ca2'), C('#d6d8de'), fbm(p, 8, 2, 4));
    c = withDecal(c, deco && decal(deco, p, ...FRONT, 1.15, 0.98));
    return withDecal(c, deco && decal(deco, p, ...BACK, 1.15, 0.98));
  }
};
// Estilos cuyo modelo usa la miniatura como calcomanía.
const DECALS = new Set(['eight', 'smile', 'heart', 'star', 'pumpkin', 'peso', 'argentina']);

/* Gira un punto para que la cara del icosaedro más de frente quede justo en +z
   (se usa al revés: se gira el punto que se consulta). */
let triRot = null;
function TRI_ROT(p) {
  if (!triRot) {
    const f = ICO.faces.reduce((a, b) => (b[2] > a[2] ? b : a));
    // Rotación que lleva +z a f; aplicarla al punto consultado equivale a girar el sólido.
    const ax = norm([-f[1], f[0], 0]);
    const ang = Math.acos(Math.max(-1, Math.min(1, f[2])));
    triRot = { ax, c: Math.cos(ang), s: Math.sin(ang) };
  }
  const { ax: k, c, s } = triRot;
  const kd = dot(k, p);
  const cr = [k[1] * p[2] - k[2] * p[1], k[2] * p[0] - k[0] * p[2], k[0] * p[1] - k[1] * p[0]];
  return [p[0] * c + cr[0] * s + k[0] * kd * (1 - c), p[1] * c + cr[1] * s + k[1] * kd * (1 - c), p[2] * c + cr[2] * s + k[2] * kd * (1 - c)];
}

/* Colores de las caras del icosaedro: tres, sin que dos vecinas se repitan,
   con la de adelante (la de la miniatura) en rojo. */
let triColors = null;
function TRI_COLORS() {
  if (triColors) return triColors;
  const F = ICO.faces;
  const near = Math.max(...F.slice(1).map((f) => dot(f, F[0])));
  const order = F.map((f, i) => i).sort((a, b) => F[b][2] - F[a][2]);
  const col = new Array(F.length).fill(-1);
  for (const i of order) {
    const used = new Set();
    for (let j = 0; j < F.length; j++) if (j !== i && col[j] >= 0 && dot(F[i], F[j]) > near - 1e-6) used.add(col[j]);
    let c = i === order[0] ? 0 : 0;
    while (used.has(c)) c++;
    col[i] = c % 3;
  }
  triColors = col;
  return col;
}

/** Paneles de cuero (de a tres por cara del cubo, alternando el sentido). */
function panelBall(p, colors, seam, grain) {
  const ax = Math.abs(p[0]), ay = Math.abs(p[1]), az = Math.abs(p[2]);
  let f, s;
  if (ax >= ay && ax >= az) { f = 0; s = p[1] / ax; } else if (ay >= az) { f = 1; s = p[2] / ay; } else { f = 2; s = p[0] / az; }
  const strip = s < -1 / 3 ? 0 : s < 1 / 3 ? 1 : 2;
  const edge = Math.min(Math.abs(s + 1 / 3), Math.abs(s - 1 / 3));
  const corner = Math.max(ax, ay, az);
  const second = ax + ay + az - corner - Math.min(ax, ay, az);
  if (edge < 0.035 || corner - second < 0.03) return seam;
  let c = colors[(strip + f) % colors.length];
  if (grain) c = mixc(c, [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8], fbm(p, 12, 2, f) * grain * 2);
  return c;
}
function spiral(p, dark, bright, k) {
  const th = Math.acos(Math.max(-1, Math.min(1, p[2])));
  const s = Math.sin(Math.atan2(p[1], p[0]) + th * 7);
  const g = Math.pow(clamp01(0.5 + 0.5 * s), 6) * k;
  return mixc(mixc(dark, [60, 30, 110], fbm(p, 3, 2, 1) * 0.6), bright, g);
}

/* ── El cubo ───────────────────────────────────────────────────── */
function texelDir(face, s, t) {
  switch (face) {
    case 0: return norm([1, -t, -s]);
    case 1: return norm([-1, -t, s]);
    case 2: return norm([s, 1, t]);
    case 3: return norm([s, -1, -t]);
    case 4: return norm([s, -t, 1]);
    default: return norm([-s, -t, -1]);
  }
}

/** ¿Hay modelo 3D para este estilo? */
function has(style) { return !!MODELS[style]; }
function usesDecal(style) { return DECALS.has(style); }

/**
 * Arma el cubo de un estilo: 6·N·N colores, con 2×2 muestras por texel (bordes
 * suaves). `deco` es la miniatura (para los que la usan como calcomanía) y
 * `tint` el color elegido para la pelota (se multiplica).
 */
function bake(style, deco, tint) {
  const fn = MODELS[style];
  if (!fn) return null;
  const data = new Uint8ClampedArray(6 * N * N * 3);
  const tc = tint && /^#[0-9a-f]{6}$/i.test(tint) ? C(tint) : null;
  let o = 0;
  for (let face = 0; face < 6; face++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++, o += 3) {
        let r = 0, g = 0, b = 0;
        for (let sj = 0; sj < 2; sj++) for (let si = 0; si < 2; si++) {
          const s = ((i + 0.25 + si * 0.5) / N) * 2 - 1;
          const t = ((j + 0.25 + sj * 0.5) / N) * 2 - 1;
          const c = fn(texelDir(face, s, t), deco);
          r += c[0]; g += c[1]; b += c[2];
        }
        r /= 4; g /= 4; b /= 4;
        if (tc) { r = (r * tc[0]) / 255; g = (g * tc[1]) / 255; b = (b * tc[2]) / 255; }
        data[o] = r; data[o + 1] = g; data[o + 2] = b;
      }
    }
  }
  return { cube: true, n: N, data };
}

/**
 * Lo mismo que `bake`, pero de a pedacitos de ~4 ms entre cuadro y cuadro: los
 * más pesados tardan hasta ~250 ms y hechos de una vez se notaban como un tirón
 * en pleno partido. `done(tex)` se llama al terminar.
 */
function bakeAsync(style, deco, tint, done, timer) {
  const fn = MODELS[style];
  if (!fn) { done(null); return; }
  const later = timer || setTimeout;
  const data = new Uint8ClampedArray(6 * N * N * 3);
  const tc = tint && /^#[0-9a-f]{6}$/i.test(tint) ? C(tint) : null;
  let row = 0; // fila global: cara·N + j
  const total = 6 * N;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const step = () => {
    const until = now() + 4;
    while (row < total && now() < until) {
      const face = (row / N) | 0, j = row % N;
      let o = (face * N * N + j * N) * 3;
      for (let i = 0; i < N; i++, o += 3) {
        let r = 0, g = 0, b = 0;
        for (let sj = 0; sj < 2; sj++) for (let si = 0; si < 2; si++) {
          const c = fn(texelDir(face, ((i + 0.25 + si * 0.5) / N) * 2 - 1, ((j + 0.25 + sj * 0.5) / N) * 2 - 1), deco);
          r += c[0]; g += c[1]; b += c[2];
        }
        r /= 4; g /= 4; b /= 4;
        if (tc) { r = (r * tc[0]) / 255; g = (g * tc[1]) / 255; b = (b * tc[2]) / 255; }
        data[o] = r; data[o + 1] = g; data[o + 2] = b;
      }
      row++;
    }
    if (row < total) later(step, 0);
    else done({ cube: true, n: N, data });
  };
  later(step, 0);
}

module.exports = { has, usesDecal, bake, bakeAsync, N, texelDir };
