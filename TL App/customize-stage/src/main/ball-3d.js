'use strict';

// Small Canvas-only effect: no WebGL context, timers or changes to game physics.
const rolls = new WeakMap();
function motion(ctx, x, y, radius, now) {
  let s = rolls.get(ctx);
  if (!s || now - s.at > 500 || Math.hypot(x - s.x, y - s.y) > radius * 12) {
    s = { x, y, at: now, a: 0, b: 0, m: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    rolls.set(ctx, s);
  }
  s.a = (s.a + (x - s.x) / radius) % (Math.PI * 2);
  s.b = (s.b - (y - s.y) / radius) % (Math.PI * 2);
  roll(s.m, (x - s.x) / radius, -(y - s.y) / radius);
  s.x = x; s.y = y; s.at = now;
  return s;
}
/**
 * Gira la orientación `m` (matriz 3×3 por filas) lo que rueda la pelota al
 * moverse: `th` alrededor del eje vertical (ir de lado) y `ph` alrededor del
 * horizontal (ir hacia arriba o abajo). Los ejes son los de la pantalla, así el
 * giro se compone sin ángulos de Euler y la pelota puede dar toda la vuelta.
 */
function roll(m, th, ph) {
  if (!th && !ph) return;
  const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
  // Rx(ph) · Ry(th), y eso por la orientación que ya tenía.
  const a = [ct, 0, st, sp * st, cp, -sp * ct, -cp * st, sp, cp * ct];
  const out = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = a[i * 3] * m[j] + a[i * 3 + 1] * m[3 + j] + a[i * 3 + 2] * m[6 + j];
    }
  }
  // Se vuelve a ortonormalizar: tantas multiplicaciones juntas se van desviando.
  let n = Math.hypot(out[0], out[1], out[2]);
  for (let j = 0; j < 3; j++) out[j] /= n;
  const d = out[0] * out[3] + out[1] * out[4] + out[2] * out[5];
  for (let j = 0; j < 3; j++) out[3 + j] -= d * out[j];
  n = Math.hypot(out[3], out[4], out[5]);
  for (let j = 0; j < 3; j++) out[3 + j] /= n;
  out[6] = out[1] * out[5] - out[2] * out[4];
  out[7] = out[2] * out[3] - out[0] * out[5];
  out[8] = out[0] * out[4] - out[1] * out[3];
  for (let i = 0; i < 9; i++) m[i] = out[i];
}

/** Pasa un dibujo (imagen o canvas) a una textura cuadrada de lado `size`. */
function textureOf(doc, source, size) {
  const c = doc.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  g.clip();
  g.drawImage(source, 0, 0, size, size);
  const data = g.getImageData(0, 0, size, size).data;
  c.width = 0;
  return { size, data };
}

// Un solo lienzo de trabajo, reusado: nada se crea por cuadro.
let work = null;
let workImage = null;

/**
 * La pelota como esfera de verdad. Para cada píxel del círculo se busca qué
 * punto de la esfera hay ahí (proyección ortogonal), se lo gira con la
 * orientación de la pelota y se lee el color de esa parte del dibujo. El dibujo
 * se toma como las DOS caras de la pelota —frente y dorso, espejado— y se
 * mezclan cerca del borde para que no se note la costura: al rodar, el
 * estampado se corre, se achata hacia el borde, pasa por atrás y vuelve.
 *
 * Cuesta un recorrido por los píxeles de la pelota (unas pocas decenas por lado)
 * y sólo corre cuando hay pelota 3D con estilo o imagen.
 */
function sphere(ctx, x, y, r, s, tex) {
  const doc = ctx.canvas.ownerDocument;
  const t = ctx.getTransform ? ctx.getTransform() : null;
  const sc = Math.abs((t && t.a) || 1) || 1;
  const D = Math.max(8, Math.min(144, Math.round(2 * r * sc)));
  if (!work || work.width !== D) {
    work = doc.createElement('canvas');
    work.width = work.height = D;
    workImage = work.getContext('2d').createImageData(D, D);
  }
  const out = workImage.data;
  const m = s.m, T = tex.size, src = tex.data;
  const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7], m8 = m[8];
  let o = 0;
  for (let py = 0; py < D; py++) {
    const v = ((py + 0.5) / D) * 2 - 1;
    for (let px = 0; px < D; px++, o += 4) {
      const u = ((px + 0.5) / D) * 2 - 1;
      const d = u * u + v * v;
      if (d > 1) { out[o + 3] = 0; continue; }
      const w = Math.sqrt(1 - d);
      // q = Rᵀ · (u, v, w): el punto de la pelota que mira hacia nosotros.
      // Se lee un pelito adentro del dibujo: justo en su borde los píxeles son
      // semitransparentes y dejaban puntitos en la costura entre frente y dorso.
      const qx = (m0 * u + m3 * v + m6 * w) * 0.955;
      const qy = (m1 * u + m4 * v + m7 * w) * 0.955;
      const qz = m2 * u + m5 * v + m8 * w;
      const row = Math.min(T - 1, ((qy + 1) * 0.5 * T) | 0) * T;
      const fi = (row + Math.min(T - 1, ((qx + 1) * 0.5 * T) | 0)) * 4;
      out[o + 3] = 255;
      if (qz >= 0.2) {
        out[o] = src[fi]; out[o + 1] = src[fi + 1]; out[o + 2] = src[fi + 2];
      } else {
        const bi = (row + Math.min(T - 1, ((1 - qx) * 0.5 * T) | 0)) * 4;
        if (qz <= -0.2) {
          out[o] = src[bi]; out[o + 1] = src[bi + 1]; out[o + 2] = src[bi + 2];
        } else {
          const k = (qz + 0.2) / 0.4;
          out[o] = src[bi] + (src[fi] - src[bi]) * k;
          out[o + 1] = src[bi + 1] + (src[fi + 1] - src[bi + 1]) * k;
          out[o + 2] = src[bi + 2] + (src[fi + 2] - src[bi + 2]) * k;
        }
      }
    }
  }
  work.getContext('2d').putImageData(workImage, 0, 0);
  ctx.drawImage(work, x - r, y - r, r * 2, r * 2);
}

function surface(ctx, x, y, r, s) {
  // Use Path2D so the game's current circle remains intact for its outline.
  const Path = ctx.canvas.ownerDocument.defaultView.Path2D;
  const ca = Math.cos(s.a), sa = Math.sin(s.a), cb = Math.cos(s.b), sb = Math.sin(s.b);
  ctx.strokeStyle = 'rgba(25,30,40,0.7)';
  ctx.lineWidth = Math.max(0.5, r * 0.07);
  for (let axis = 0; axis < 3; axis++) {
    const line = new Path();
    let visible = false;
    for (let i = 0; i <= 48; i++) {
      const t = i * Math.PI / 24;
      const p = axis === 0 ? [0, Math.cos(t), Math.sin(t)]
        : axis === 1 ? [Math.cos(t), 0, Math.sin(t)] : [Math.cos(t), Math.sin(t), 0];
      const px = ca * p[0] + sa * p[2];
      const z = -sa * p[0] + ca * p[2];
      const py = cb * p[1] - sb * z, pz = sb * p[1] + cb * z;
      if (pz >= 0) {
        if (visible) line.lineTo(x + px * r, y + py * r);
        else line.moveTo(x + px * r, y + py * r);
      }
      visible = pz >= 0;
    }
    ctx.stroke(line);
  }
}
function shade(ctx, x, y, r) {
  const light = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  light.addColorStop(0, 'rgba(255,255,255,0.5)');
  light.addColorStop(0.45, 'rgba(255,255,255,0.04)');
  light.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = light;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
module.exports = { motion, surface, shade, sphere, textureOf };
