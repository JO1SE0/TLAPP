'use strict';
/*
 * Ayudas de entrenamiento: zona de patada, línea de tiro, trayectoria completa
 * y cono de efecto.
 *
 * ── Sólo para practicar ─────────────────────────────────────────────────────
 *
 * Todo esto PREDICE: dice adónde va a ir la pelota. Con un rival en la cancha
 * sería información que él no tiene, y eso choca con la regla de todo lo que el
 * cliente dibuja en vivo (ver `pitch` en store.js). Por eso el preload sólo lo
 * prende cuando estás solo en la cancha — tu sala de práctica —, y este módulo
 * no sabe nada de salas: recibe números y dibuja.
 *
 * ── De dónde sale la física ─────────────────────────────────────────────────
 *
 * Los nombres del motor están minificados y cambian con cada versión de HaxBall,
 * así que no se adivinan: se APRENDEN mirando cómo se mueve la pelota, paso de
 * física por paso de física, en la sala real. En HaxBall cada paso hace:
 *
 *   pos += vel;  vel = (vel + gravedad) * frenado;  después, los choques.
 *
 * O sea que el campo que cumple `pos_nueva − pos_vieja == ese campo` es la
 * velocidad, y el número que cumple `vel_nueva == (vel_vieja + g) * ese número`
 * es el frenado. Se cuenta sólo cuando UN solo candidato encaja, así un estadio
 * con frenado 1 y masa 1 no confunde los dos.
 *
 * La patada es `vel += dirección * fuerza` (la dirección va del centro del
 * jugador al de la pelota), y llega si entre los dos bordes quedan menos de 4
 * unidades. La fuerza se mide sola en la primera patada; hasta entonces vale 5,
 * la de fábrica.
 *
 * Las paredes (planos, segmentos rectos y curvos, vértices y palos) se leen del
 * mundo de la partida y se filtran con las máscaras de choque de la pelota: la
 * línea del medio del saque inicial no la frena, la red del arco sí.
 *
 * ── Costo ───────────────────────────────────────────────────────────────────
 *
 * Nada de esto corre si las ayudas están apagadas. Prendidas, la simulación se
 * rehace una vez por paso de física como mucho (no por cuadro dibujado) y escribe
 * en buffers fijos: no genera basura para el recolector.
 */

const KICK_GAP = 4;
const DEFAULT_KICK = 5;
const MAX_STEPS = 420;
const STOP_SPEED2 = 0.05 * 0.05;
const CONE_DEG = 24;
const EPS = 1e-6;

const isPoint = (o) => !!o && typeof o === 'object' && typeof o.x === 'number' && typeof o.y === 'number' && Object.keys(o).length === 2;
const isInt = (n) => Number.isInteger(n);

/* ── Lo aprendido (nombres de campos) ─────────────────────────────────────── */

const phys = {
  vel: null,
  grav: null,
  damp: null,
  kick: 0,
  kicks: []
};

const learn = {
  ball: null,
  vecKeys: null,
  numKeys: null,
  px: 0, py: 0,
  prevVec: Object.create(null),
  prevNum: Object.create(null),
  hitsV: Object.create(null),
  hitsD: Object.create(null),
  seen: false
};

function resetLearning() {
  learn.ball = null;
  learn.vecKeys = null;
  learn.numKeys = null;
  learn.seen = false;
  learn.prevVec = Object.create(null);
  learn.prevNum = Object.create(null);
  learn.hitsV = Object.create(null);
  learn.hitsD = Object.create(null);
}

function ready() {
  return !!(phys.vel && phys.damp);
}

function kickStrength() {
  if (!phys.kicks.length) return DEFAULT_KICK;
  const s = phys.kicks.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

/**
 * Un paso de física de la sala real, ANTES de patadas y movimiento.
 *
 * @param ball   el disco de la pelota
 * @param posKey el campo de la posición (ya lo da el parche)
 * @param radiusKey el del radio
 * @param players los discos de los jugadores, para medir la patada
 */
function step(ball, posKey, radiusKey, players) {
  if (!ball || typeof ball !== 'object') return;
  const pos = ball[posKey];
  if (!isPoint(pos)) return;

  if (learn.ball !== ball || !learn.vecKeys) {
    learn.ball = ball;
    learn.vecKeys = [];
    learn.numKeys = [];
    for (const k of Object.keys(ball)) {
      if (k === posKey) continue;
      const v = ball[k];
      if (isPoint(v)) learn.vecKeys.push(k);
      else if (typeof v === 'number' && k !== radiusKey) learn.numKeys.push(k);
    }
    learn.seen = false;
  }

  if (learn.seen) {
    if (!phys.vel) learnVelocity(pos);
    else if (!phys.damp) learnDamping(ball);
    else measureKick(ball, pos, radiusKey, players);
  }

  learn.px = pos.x;
  learn.py = pos.y;
  for (const k of learn.vecKeys) {
    const v = ball[k];
    let slot = learn.prevVec[k];
    if (!slot) slot = learn.prevVec[k] = { x: 0, y: 0 };
    slot.x = v ? v.x : 0;
    slot.y = v ? v.y : 0;
  }
  for (const k of learn.numKeys) learn.prevNum[k] = ball[k];
  learn.seen = true;
}

function learnVelocity(pos) {
  const dx = pos.x - learn.px;
  const dy = pos.y - learn.py;
  if (dx * dx + dy * dy < 0.0025) return;
  let match = null;
  let n = 0;
  for (const k of learn.vecKeys) {
    const v = learn.prevVec[k];
    if (v && Math.abs(v.x - dx) < EPS && Math.abs(v.y - dy) < EPS) { match = k; n++; }
  }
  if (n !== 1) return;
  learn.hitsV[match] = (learn.hitsV[match] || 0) + 1;
  if (learn.hitsV[match] >= 6) phys.vel = match;
}

function learnDamping(ball) {
  const v = ball[phys.vel];
  const pv = learn.prevVec[phys.vel];
  if (!v || !pv || pv.x * pv.x + pv.y * pv.y < 0.0025) return;
  let match = null;
  let n = 0;
  const gravs = [null, ...learn.vecKeys.filter((k) => k !== phys.vel)];
  for (const g of gravs) {
    const gv = g ? learn.prevVec[g] : null;
    const gx = gv ? gv.x : 0;
    const gy = gv ? gv.y : 0;
    for (const k of learn.numKeys) {
      const d = learn.prevNum[k];
      if (!(d > 0.3 && d <= 1)) continue;
      if (Math.abs(v.x - (pv.x + gx) * d) < EPS && Math.abs(v.y - (pv.y + gy) * d) < EPS) {
        // Con gravedad cero, «sin gravedad» y «gravedad (0,0)» son lo mismo:
        // no cuenta como dos candidatos.
        if (match && match.k === k) continue;
        match = { g, k };
        n++;
      }
    }
  }
  if (n !== 1) return;
  const id = `${match.g || ''}|${match.k}`;
  learn.hitsD[id] = (learn.hitsD[id] || 0) + 1;
  if (learn.hitsD[id] >= 6) {
    phys.damp = match.k;
    phys.grav = match.g;
  }
}

/** La fuerza de la patada, medida en el salto de velocidad que deja. */
function measureKick(ball, pos, radiusKey, players) {
  if (!players || !players.length) return;
  const v = ball[phys.vel];
  const pv = learn.prevVec[phys.vel];
  const d = learn.prevNum[phys.damp];
  if (!v || !pv || !(d > 0)) return;
  const g = phys.grav ? learn.prevVec[phys.grav] : null;
  const jx = v.x / d - (g ? g.x : 0) - pv.x;
  const jy = v.y / d - (g ? g.y : 0) - pv.y;
  const jump = Math.hypot(jx, jy);
  if (jump < 0.8) return;
  const rb = Number(ball[radiusKey]) || 10;
  for (const p of players) {
    const at = p && p.at;
    if (!at) continue;
    const ox = learn.px - at.x;
    const oy = learn.py - at.y;
    const dist = Math.hypot(ox, oy);
    if (!dist || dist - rb - p.r > KICK_GAP + 2) continue;
    const nx = ox / dist;
    const ny = oy / dist;
    const along = jx * nx + jy * ny;
    const across = Math.abs(-jx * ny + jy * nx);
    if (along > 0.5 && along < 40 && across < along * 0.2) {
      phys.kicks.push(along);
      if (phys.kicks.length > 9) phys.kicks.shift();
    }
    return;
  }
}

/* ── Paredes ─────────────────────────────────────────────────────────────── */

let wallsKey = null;
let walls = null;

/**
 * Lee las paredes del mundo y las deja en arrays planos. Se rehace sólo si
 * cambia el estadio.
 *
 * @returns {{planes:number[], segs:number[], arcs:number[], points:number[], bc:number}}
 */
let retryAt = 0;
function wallsOf(world, key, discsKey, posKey, radiusKey, ball, playerDiscs, now) {
  if (walls && wallsKey === key && (walls.ok || now < retryAt)) return walls;
  // Estadio nuevo: la fuerza de patada puede ser otra, se vuelve a medir.
  if (wallsKey !== key) phys.kicks.length = 0;
  wallsKey = key;
  walls = parseWalls(world, discsKey, posKey, radiusKey, ball, playerDiscs);
  // Si todavía no se pudo leer (la partida recién arranca), se reintenta en un rato y no en cada cuadro.
  if (!walls.ok) retryAt = now + 1000;
  return walls;
}

function numericKeys(o) {
  return Object.keys(o).filter((k) => typeof o[k] === 'number');
}

function parseWalls(world, discsKey, posKey, radiusKey, ball, playerDiscs) {
  const out = { planes: [], segs: [], arcs: [], points: [], bcBall: 0.5, ok: false };
  if (!world || !ball) return out;

  const discs = Array.isArray(world[discsKey]) ? world[discsKey] : [];
  const discSet = new Set(discs);
  let planes = null;
  let segments = null;
  let vertices = null;

  for (const k of Object.keys(world)) {
    const arr = world[k];
    if (!Array.isArray(arr) || !arr.length || arr === discs || arr.length > 5000) continue;
    const first = arr[0];
    if (!first || typeof first !== 'object') continue;
    const keys = Object.keys(first);
    const pts = keys.filter((p) => isPoint(first[p]));
    const refs = keys.filter((p) => first[p] && typeof first[p] === 'object' && !isPoint(first[p]) && !Array.isArray(first[p]));
    if (refs.length >= 2) {
      // Segmentos: apuntan a vértices. Las uniones (joints) apuntan a discos.
      const target = first[refs[0]];
      if (discSet.has(target)) continue;
      if (!segments) segments = { arr, refs };
    } else if (pts.length === 1 && refs.length === 0) {
      const unit = arr.every((it) => it && isPoint(it[pts[0]]) && Math.abs(Math.hypot(it[pts[0]].x, it[pts[0]].y) - 1) < 1e-6);
      if (unit && !planes) planes = { arr, nk: pts[0] };
      else if (!unit && !vertices) vertices = { arr, pk: pts[0] };
    }
  }

  // Los campos de rebote y máscaras se llaman igual en la pelota y en las paredes.
  const ballNums = new Set(numericKeys(ball));
  let shared = [...ballNums].filter((k) => k !== radiusKey && k !== posKey);
  for (const group of [planes, segments, vertices]) {
    if (!group) continue;
    const s = new Set(numericKeys(group.arr[0]));
    shared = shared.filter((k) => s.has(k));
  }
  const samples = [ball];
  for (const group of [planes, segments, vertices]) if (group) samples.push(...group.arr.slice(0, 40));
  let bcKey = shared.find((k) => samples.some((o) => typeof o[k] === 'number' && !isInt(o[k])));
  if (!bcKey) {
    const small = shared.filter((k) => samples.every((o) => typeof o[k] !== 'number' || (o[k] >= 0 && o[k] <= 3)));
    if (small.length === 1) bcKey = small[0];
  }
  const masks = shared.filter((k) => k !== bcKey && samples.every((o) => typeof o[k] !== 'number' || isInt(o[k])));
  const bcOf = (o) => (bcKey && typeof o[bcKey] === 'number' ? o[bcKey] : (o === ball ? 0.5 : 1));
  out.bcBall = bcOf(ball);
  const hits = (o) => {
    if (masks.length !== 2) return true;
    const a = masks[0];
    const b = masks[1];
    return ((ball[a] | 0) & (o[b] | 0)) !== 0 && ((ball[b] | 0) & (o[a] | 0)) !== 0;
  };

  if (planes) {
    const distKey = numericKeys(planes.arr[0]).find((k) => !shared.includes(k));
    if (distKey) {
      for (const p of planes.arr) {
        if (!hits(p)) continue;
        const n = p[planes.nk];
        out.planes.push(n.x, n.y, Number(p[distKey]) || 0, bcOf(p));
      }
    }
  }

  const vertPos = (v) => {
    if (!v || typeof v !== 'object') return null;
    if (vertices && isPoint(v[vertices.pk])) return v[vertices.pk];
    for (const k of Object.keys(v)) if (isPoint(v[k])) return v[k];
    return null;
  };

  if (segments) {
    const [r0, r1] = segments.refs;
    const segNums = numericKeys(segments.arr[0]).filter((k) => !shared.includes(k));
    for (const s of segments.arr) {
      if (!hits(s)) continue;
      const a = vertPos(s[r0]);
      const b = vertPos(s[r1]);
      if (!a || !b) continue;
      const bc = bcOf(s);
      const arc = arcOf(s, a, b, segNums);
      if (arc) out.arcs.push(arc.cx, arc.cy, arc.r, arc.mx, arc.my, arc.cosHalf, bc);
      else out.segs.push(a.x, a.y, b.x, b.y, bc);
    }
  }

  if (vertices) {
    for (const v of vertices.arr) {
      if (!hits(v)) continue;
      const p = v[vertices.pk];
      if (isPoint(p)) out.points.push(p.x, p.y, 0, bcOf(v));
    }
  }

  // Los palos y demás discos del estadio (no la pelota ni los jugadores).
  const players = new Set(playerDiscs || []);
  for (let i = 1; i < discs.length; i++) {
    const d = discs[i];
    if (!d || players.has(d) || !hits(d)) continue;
    const p = d[posKey];
    if (isPoint(p)) out.points.push(p.x, p.y, Number(d[radiusKey]) || 0, bcOf(d));
  }

  out.ok = !!(out.planes.length || out.segs.length || out.arcs.length);
  return out;
}

/**
 * Un segmento curvo: el centro es el punto propio que queda a la misma
 * distancia de las dos puntas (el otro punto propio de un segmento es la
 * normal, que mide 1). El arco va del lado contrario al centro si abre menos de
 * media vuelta, y del mismo lado si abre más; el ángulo se saca del campo que
 * cumple «cuerda = 2·radio·sen(ángulo/2)». Si no aparece, se toma el arco chico.
 */
function arcOf(s, a, b, segNums) {
  let c = null;
  for (const k of Object.keys(s)) {
    const p = s[k];
    if (!isPoint(p) || p === a || p === b) continue;
    const da = Math.hypot(a.x - p.x, a.y - p.y);
    const db = Math.hypot(b.x - p.x, b.y - p.y);
    if (da > 1e-3 && Math.abs(da - db) < 1e-3 * Math.max(1, da) && Math.abs(Math.hypot(p.x, p.y) - 1) > 1e-6) { c = p; break; }
  }
  if (!c) return null;
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  let span = 2 * Math.asin(Math.min(1, chord / (2 * r)));
  for (const k of segNums) {
    const deg = Math.abs(Number(s[k]));
    if (!(deg > 0 && deg <= 360)) continue;
    const rad = (deg * Math.PI) / 180;
    if (Math.abs(2 * r * Math.sin(rad / 2) - chord) < 1e-3 * Math.max(1, chord)) { span = rad; break; }
  }
  const midx = (a.x + b.x) / 2 - c.x;
  const midy = (a.y + b.y) / 2 - c.y;
  const ml = Math.hypot(midx, midy) || 1;
  const sign = span > Math.PI ? 1 : -1;
  return { cx: c.x, cy: c.y, r, mx: (sign * midx) / ml, my: (sign * midy) / ml, cosHalf: Math.cos(span / 2) };
}

/* ── Simulación ──────────────────────────────────────────────────────────── */

const path = new Float32Array(MAX_STEPS * 2 + 2);
const bounces = new Float32Array(32);
const sim = { n: 0, bounces: 0, firstHit: -1 };

/**
 * Corre la pelota desde (x, y) con velocidad (vx, vy) hasta que se frena.
 * Deja el recorrido en `path` (pares x, y) y los piques en `bounces`.
 */
function simulate(x, y, vx, vy, rb, damp, gx, gy, w) {
  sim.n = 0;
  sim.bounces = 0;
  sim.firstHit = -1;
  path[0] = x; path[1] = y; sim.n = 1;
  const bcB = w ? w.bcBall : 0.5;
  for (let i = 0; i < MAX_STEPS; i++) {
    x += vx; y += vy;
    vx = (vx + gx) * damp;
    vy = (vy + gy) * damp;
    let hit = false;
    if (w) {
      const P = w.planes;
      for (let j = 0; j < P.length; j += 4) {
        const nx = P[j], ny = P[j + 1];
        const pen = P[j + 2] - (x * nx + y * ny) + rb;
        if (pen > 0) {
          x += nx * pen; y += ny * pen;
          const vn = vx * nx + vy * ny;
          if (vn < 0) { const k = vn * (1 + bcB * P[j + 3]); vx -= nx * k; vy -= ny * k; }
          hit = true;
        }
      }
      const S = w.segs;
      for (let j = 0; j < S.length; j += 5) {
        const ax = S[j], ay = S[j + 1], bx = S[j + 2], by = S[j + 3];
        const ex = bx - ax, ey = by - ay;
        const len2 = ex * ex + ey * ey;
        let t = len2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / len2 : 0;
        if (t <= 0 || t >= 1) continue; // las puntas las atiende el vértice
        const qx = ax + ex * t, qy = ay + ey * t;
        if (collidePoint(qx, qy, 0, S[j + 4])) hit = true;
      }
      const A = w.arcs;
      for (let j = 0; j < A.length; j += 7) {
        const cx = A[j], cy = A[j + 1], R = A[j + 2];
        const dx = x - cx, dy = y - cy;
        const dl = Math.hypot(dx, dy);
        if (!dl || Math.abs(dl - R) >= rb) continue;
        if ((dx * A[j + 3] + dy * A[j + 4]) / dl < A[j + 5]) continue; // fuera del arco
        // El punto del arco más cercano hace de pared.
        const qx = cx + (dx / dl) * R, qy = cy + (dy / dl) * R;
        if (collidePoint(qx, qy, 0, A[j + 6])) hit = true;
      }
      const Q = w.points;
      for (let j = 0; j < Q.length; j += 4) {
        if (collidePoint(Q[j], Q[j + 1], Q[j + 2], Q[j + 3])) hit = true;
      }
    }
    path[sim.n * 2] = x;
    path[sim.n * 2 + 1] = y;
    sim.n++;
    if (hit) {
      if (sim.firstHit < 0) sim.firstHit = sim.n - 1;
      if (sim.bounces < 16) { bounces[sim.bounces * 2] = x; bounces[sim.bounces * 2 + 1] = y; sim.bounces++; }
    }
    if (vx * vx + vy * vy < STOP_SPEED2) break;
  }
  return sim;

  // Choque contra un punto (o un disco quieto) de radio `r`.
  function collidePoint(px, py, r, bc) {
    const dx = x - px, dy = y - py;
    const d2 = dx * dx + dy * dy;
    const lim = rb + r;
    if (d2 >= lim * lim || d2 === 0) return false;
    const d = Math.sqrt(d2);
    const nx = dx / d, ny = dy / d;
    const pen = lim - d;
    x += nx * pen; y += ny * pen;
    const vn = vx * nx + vy * ny;
    if (vn < 0) { const k = vn * (1 + bcB * bc); vx -= nx * k; vy -= ny * k; }
    return true;
  }
}

/* ── Dibujo ──────────────────────────────────────────────────────────────── */

const last = { x: NaN, y: NaN, vx: 0, vy: 0, w: null };
const DASH_ZONE = [3, 4];
const DASH_PATH = [5, 5];
const NO_DASH = [];
const cone = new Float32Array(4);

/**
 * Dibuja las ayudas en coordenadas de cancha.
 *
 * @param ctx  contexto ya transformado a la cancha
 * @param o    { me:{x,y,r}, ball:{x,y,vx,vy,r}, world, worldKey, keys, want:{zone,line,path,cone}, px, accent, clock }
 */
function paint(ctx, o) {
  const me = o.me;
  const b = o.ball;
  if (!me || !b) return;
  const px = o.px;
  const want = o.want;
  const dx = b.x - me.x;
  const dy = b.y - me.y;
  const dist = Math.hypot(dx, dy) || 1;
  const gap = dist - me.r - b.r;
  const inReach = gap < KICK_GAP;
  const accent = o.accent || '#d0b878';

  ctx.save();
  ctx.setLineDash(NO_DASH);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (want.zone) {
    ctx.beginPath();
    ctx.arc(me.x, me.y, me.r + KICK_GAP, 0, Math.PI * 2);
    ctx.lineWidth = (inReach ? 2.4 : 1.4) * px;
    ctx.strokeStyle = inReach ? 'rgba(90,240,140,0.95)' : 'rgba(255,255,255,0.45)';
    if (!inReach) { DASH_ZONE[0] = 3 * px; DASH_ZONE[1] = 4 * px; ctx.setLineDash(DASH_ZONE); }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    if (inReach) {
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = 'rgb(90,240,140)';
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // El resto sólo con la pelota cerca: lejos, una línea a mitad de cancha no
  // dice nada y tapa.
  if (gap > 90 || !(want.line || want.path || want.cone)) { ctx.restore(); return; }
  const near = Math.max(0.35, Math.min(1, 1 - (gap - KICK_GAP) / 90));

  const nx = dx / dist;
  const ny = dy / dist;
  const K = kickStrength();
  const damp = o.damp > 0 && o.damp <= 1 ? o.damp : 0.99;
  const gx = o.gx || 0;
  const gy = o.gy || 0;
  const vx = b.vx + nx * K;
  const vy = b.vy + ny * K;

  const w = o.walls;
  // Con la pelota quieta y vos quieto, el recorrido es el mismo: no se rehace.
  const same = Math.abs(last.x - b.x) < 0.01 && Math.abs(last.y - b.y) < 0.01 &&
    Math.abs(last.vx - vx) < 0.001 && Math.abs(last.vy - vy) < 0.001 && last.w === w;
  if (!same) {
    simulate(b.x, b.y, vx, vy, b.r, damp, gx, gy, w && w.ok ? w : null);
    last.x = b.x; last.y = b.y; last.vx = vx; last.vy = vy; last.w = w;
  }
  const s = sim;
  const firstEnd = s.firstHit > 0 ? s.firstHit : s.n - 1;

  if (want.cone) {
    const sp = Math.hypot(vx, vy) || 1;
    const reach = Math.min(700, sp * damp / Math.max(0.002, 1 - damp)) * 0.45;
    const th = (CONE_DEG * Math.PI) / 180;
    for (let i = 0; i < 2; i++) {
      const a = i ? th : -th;
      const cx = nx * Math.cos(a) - ny * Math.sin(a);
      const cy = nx * Math.sin(a) + ny * Math.cos(a);
      const ux = b.vx + cx * K;
      const uy = b.vy + cy * K;
      const ul = Math.hypot(ux, uy) || 1;
      cone[i * 2] = b.x + (ux / ul) * reach;
      cone[i * 2 + 1] = b.y + (uy / ul) * reach;
    }
    const g = ctx.createRadialGradient(b.x, b.y, b.r, b.x, b.y, reach);
    g.addColorStop(0, 'rgba(120,200,255,0.2)');
    g.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.globalAlpha = near;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(cone[0], cone[1]);
    ctx.lineTo(cone[2], cone[3]);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1 * px;
    ctx.strokeStyle = 'rgba(150,215,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(b.x, b.y); ctx.lineTo(cone[0], cone[1]);
    ctx.moveTo(b.x, b.y); ctx.lineTo(cone[2], cone[3]);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (want.path && s.n > 2) {
    // El recorrido entero, punteado y apagándose hacia el final.
    DASH_PATH[0] = 5 * px; DASH_PATH[1] = 5 * px;
    ctx.setLineDash(DASH_PATH);
    ctx.lineWidth = 1.8 * px;
    const start = want.line ? firstEnd : 0;
    const total = s.n - start;
    const parts = 4;
    for (let p = 0; p < parts; p++) {
      const i0 = start + Math.floor((total * p) / parts);
      const i1 = Math.min(s.n - 1, start + Math.floor((total * (p + 1)) / parts));
      if (i1 <= i0) continue;
      ctx.globalAlpha = near * (0.95 - p * 0.2);
      ctx.strokeStyle = 'rgba(255,214,90,1)';
      ctx.beginPath();
      ctx.moveTo(path[i0 * 2], path[i0 * 2 + 1]);
      for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(path[i * 2], path[i * 2 + 1]);
      ctx.stroke();
    }
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = near;
    ctx.fillStyle = 'rgba(255,214,90,0.95)';
    for (let i = 0; i < s.bounces; i++) {
      ctx.beginPath();
      ctx.arc(bounces[i * 2], bounces[i * 2 + 1], 2.6 * px, 0, Math.PI * 2);
      ctx.fill();
    }
    // Dónde se frena.
    const ex = path[(s.n - 1) * 2];
    const ey = path[(s.n - 1) * 2 + 1];
    ctx.lineWidth = 1.6 * px;
    ctx.strokeStyle = 'rgba(255,214,90,0.95)';
    ctx.beginPath();
    ctx.arc(ex, ey, b.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (want.line) {
    // Hasta el primer pique: es lo que sale de tu pie.
    ctx.globalAlpha = near;
    ctx.lineWidth = (inReach ? 3 : 2) * px;
    ctx.strokeStyle = inReach ? accent : 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.moveTo(path[0], path[1]);
    for (let i = 1; i <= firstEnd; i++) ctx.lineTo(path[i * 2], path[i * 2 + 1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function reset() {
  resetLearning();
  wallsKey = null;
  walls = null;
  last.x = NaN;
  last.w = null;
}

module.exports = {
  phys,
  ready,
  step,
  reset,
  resetLearning,
  wallsOf,
  parseWalls,
  simulate,
  sim,
  path,
  paint,
  kickStrength,
  KICK_GAP
};
