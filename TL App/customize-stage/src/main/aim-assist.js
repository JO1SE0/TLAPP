/*
 * Ayudas de apuntado: matemática pura, sin tocar el DOM ni el juego.
 *
 * El bundle de HaxBall está minificado, así que no se conocen los nombres de los
 * campos de la física. En vez de adivinarlos se SONDEA la forma de los objetos
 * (qué propiedad es un vector, cuál es la velocidad, cuáles son paredes y cuáles
 * arcos) y se deja un diagnóstico para poder ajustar si algo no encaja.
 *
 * Física de HaxBall, por paso (1/60 s): pos += vel; choque con paredes
 * (rebote = bCoef disco × bCoef pared); vel *= damping. La patada suma
 * `kickStrength` en la dirección disco→pelota.
 */
'use strict';

const isNum = Number.isFinite;
function isVec(o) { return !!o && typeof o === 'object' && isNum(o.x) && isNum(o.y); }

/** Las propiedades propias de `obj` que son vectores. */
function vecEntries(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (isVec(v)) out.push([k, v]);
  }
  return out;
}

/** Un vértice tiene x, y y además otros números (bCoef, máscaras); un punto no. */
function isVertexLike(v) {
  let extra = 0;
  for (const k of Object.keys(v)) if (k !== 'x' && k !== 'y' && typeof v[k] === 'number') extra++;
  return extra >= 1;
}

function numbersOf(obj) {
  const out = [];
  for (const k of Object.keys(obj)) if (typeof obj[k] === 'number') out.push([k, obj[k]]);
  return out;
}

/**
 * Recorre el mundo y arma la geometría: paredes (segmentos rectos) y arcos.
 * Devuelve también `diag`, un resumen corto para el registro de errores.
 */
function probeWorld(world, discsKey) {
  const segments = [];
  const goals = [];
  const diag = { arrays: [] };
  if (!world || typeof world !== 'object') return { segments, goals, diag };

  for (const key of Object.keys(world)) {
    if (key === discsKey) continue;
    const arr = world[key];
    if (!Array.isArray(arr) || !arr.length) continue;
    const first = arr[0];
    if (!first || typeof first !== 'object') continue;
    const vecs = vecEntries(first);
    const vertexes = vecs.filter(([, v]) => isVertexLike(v));
    const points = vecs.filter(([, v]) => !isVertexLike(v));
    const kind = vertexes.length >= 2 ? 'segments' : points.length >= 2 ? 'goals' : points.length === 1 ? 'planes' : 'other';
    diag.arrays.push(`${key}:${arr.length}:${kind}`);

    if (kind === 'segments') {
      const kv = vertexes.map(([k]) => k).slice(0, 2);
      // La pared rebota con su propio bCoef: se toma el número no-entero ≤ 2 más razonable.
      const bKey = numbersOf(first).filter(([, n]) => n >= 0 && n <= 2 && !Number.isInteger(n)).map(([k]) => k)[0]
        || numbersOf(first).filter(([, n]) => n >= 0 && n <= 2).map(([k]) => k)[0];
      for (const s of arr) {
        const a = s[kv[0]]; const b = s[kv[1]];
        if (!isVec(a) || !isVec(b)) continue;
        segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, bc: bKey && isNum(s[bKey]) ? s[bKey] : 1, ref: s });
      }
      diag.segKeys = kv.concat(bKey ? [bKey] : []);
    } else if (kind === 'goals') {
      const kp = points.map(([k]) => k).slice(0, 2);
      const others = Object.keys(first).filter((k) => !kp.includes(k) && first[k] !== null && first[k] !== undefined);
      const tKey = others[0];
      for (const g of arr) {
        const a = g[kp[0]]; const b = g[kp[1]];
        if (!isVec(a) || !isVec(b)) continue;
        goals.push({ p0: a, p1: b, team: tKey ? g[tKey] : null });
      }
      diag.goalKeys = kp.concat(tKey ? [tKey] : []);
    }
  }
  return { segments, goals, diag };
}

/** Distancia punto→segmento: devuelve el punto más cercano y su distancia. */
function closestOnSegment(px, py, s) {
  const dx = s.bx - s.ax; const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - s.ax) * dx + (py - s.ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = s.ax + dx * t; const cy = s.ay + dy * t;
  return { cx, cy, d: Math.hypot(px - cx, py - cy) };
}

/**
 * Simula la pelota hacia adelante. `ball` = { x, y, vx, vy, r, damp, bc }.
 * Corta cuando se frena, cruza un arco o se agotan los pasos.
 */
function simulate(ball, geo, maxSteps) {
  const pts = [];
  let { x, y, vx, vy } = ball;
  const r = ball.r || 10;
  const damp = ball.damp || 0.99;
  const bc = isNum(ball.bc) ? ball.bc : 0.5;
  const segs = (geo && geo.segments) || [];
  const goals = (geo && geo.goals) || [];
  let end = null;

  for (let i = 0; i < (maxSteps || 240); i++) {
    const px = x; const py = y;
    x += vx; y += vy;

    // ¿Cruzó la línea de algún arco?
    for (const g of goals) {
      if (segmentsCross(px, py, x, y, g.p0.x, g.p0.y, g.p1.x, g.p1.y)) { end = { x, y, why: 'goal', goal: g, step: i }; break; }
    }
    if (end) { pts.push({ x, y }); break; }

    // Rebote con las paredes.
    for (const s of segs) {
      const c = closestOnSegment(x, y, s);
      if (c.d < r && c.d > 1e-6) {
        const nx = (x - c.cx) / c.d; const ny = (y - c.cy) / c.d;
        x = c.cx + nx * r; y = c.cy + ny * r;
        const vn = vx * nx + vy * ny;
        if (vn < 0) {
          const k = (1 + bc * (s.bc == null ? 1 : s.bc)) * vn;
          vx -= k * nx; vy -= k * ny;
        }
      }
    }
    vx *= damp; vy *= damp;
    if (i % 2 === 0) pts.push({ x, y });
    if (Math.hypot(vx, vy) < 0.02) { end = { x, y, why: 'stop', step: i }; break; }
  }
  if (!end) end = { x, y, why: 'range', step: maxSteps || 240 };
  return { pts, end };
}

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax; const d1y = by - ay; const d2x = dx - cx; const d2y = dy - cy;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Tramos libres del arco visto desde la pelota. Devuelve intervalos [t0,t1] en
 * 0..1 sobre el arco (p0→p1) por los que un tiro recto no choca con un rival.
 */
function freeSpans(ball, goal, rivals, ballR) {
  const N = 48;
  const free = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const gx = goal.p0.x + (goal.p1.x - goal.p0.x) * t;
    const gy = goal.p0.y + (goal.p1.y - goal.p0.y) * t;
    let ok = true;
    for (const rv of rivals) {
      const dx = gx - ball.x; const dy = gy - ball.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-6) continue;
      const u = ((rv.x - ball.x) * dx + (rv.y - ball.y) * dy) / len2;
      if (u <= 0 || u >= 1) continue;
      const d = Math.hypot(rv.x - (ball.x + dx * u), rv.y - (ball.y + dy * u));
      if (d < (rv.r || 15) + (ballR || 10)) { ok = false; break; }
    }
    free.push(ok);
  }
  const spans = [];
  let start = -1;
  for (let i = 0; i <= N; i++) {
    if (free[i] && start < 0) start = i;
    if ((!free[i] || i === N) && start >= 0) {
      const endI = free[i] ? i : i - 1;
      spans.push([start / N, endI / N]);
      start = -1;
    }
  }
  return spans;
}

/**
 * ¿Algún rival llega a la trayectoria antes que la pelota? Estimación: un
 * disco avanza como mucho ~2.6 px por paso. Devuelve el primer punto en peligro.
 */
function dangerOnPath(path, rivals, ballR, speed) {
  const v = speed || 2.6;
  for (let i = 0; i < path.length; i++) {
    const steps = (i + 1) * 2;
    for (const rv of rivals) {
      const d = Math.hypot(rv.x - path[i].x, rv.y - path[i].y) - (rv.r || 15) - (ballR || 10);
      if (d <= v * steps) return { point: path[i], rival: rv, index: i };
    }
  }
  return null;
}

/**
 * Seguimiento de la pelota: velocidad por paso de física. Se prueba qué vector
 * del disco acompaña el movimiento; si ninguno, se estima por diferencias.
 */
function createBallTracker() {
  const st = { velKey: null, votes: {}, prev: null, prevAt: 0, est: { vx: 0, vy: 0 }, damp: 0.99, tried: false };
  function update(disc, posKey, now) {
    const pos = disc[posKey];
    if (!isVec(pos)) return null;
    if (st.prev && now > st.prevAt) {
      const dx = pos.x - st.prev.x; const dy = pos.y - st.prev.y;
      const dt = (now - st.prevAt) / (1000 / 60);
      if (dt > 0.05) {
        st.est = { vx: dx / dt, vy: dy / dt };
        if (!st.velKey && Math.hypot(st.est.vx, st.est.vy) > 0.5) {
          for (const [k, v] of vecEntries(disc)) {
            if (k === posKey) continue;
            if (Math.abs(v.x - st.est.vx) < 0.6 && Math.abs(v.y - st.est.vy) < 0.6) st.votes[k] = (st.votes[k] || 0) + 1;
          }
          for (const k of Object.keys(st.votes)) if (st.votes[k] >= 6) st.velKey = k;
        }
      }
    }
    st.prev = { x: pos.x, y: pos.y }; st.prevAt = now;
    if (!st.tried) {
      st.tried = true;
      const cand = numbersOf(disc).filter(([, n]) => n > 0.9 && n < 1).map(([, n]) => n);
      if (cand.length) st.damp = cand[0];
    }
    const sv = st.velKey && isVec(disc[st.velKey]) ? disc[st.velKey] : null;
    return { x: pos.x, y: pos.y, vx: sv ? sv.x : st.est.vx, vy: sv ? sv.y : st.est.vy, damp: st.damp, velKey: st.velKey };
  }
  return { update, state: st };
}

module.exports = { isVec, probeWorld, simulate, freeSpans, dangerOnPath, createBallTracker, closestOnSegment, segmentsCross };
