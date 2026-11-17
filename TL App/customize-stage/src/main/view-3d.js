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

/* Tribunas: escalones alrededor de la cancha. Diseño propio y genérico. */
const STEPS = 9;
const STEP_D = 34;
const STEP_H = 17;
const SEAT_A = [0.12, 0.13, 0.17];
const SEAT_B = [0.55, 0.44, 0.17];

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
   luz (piso) · 3 sombra redonda · 4 color sin luz */
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
  if (uMode == 2) { gl_FragColor = texture2D(uTex, vUv); return; }
  if (uMode == 1) {
    // La camiseta se gira con la cámara para que el número se lea derecho.
    vec2 uv = uRot > 0.5 ? vec2(vUv.y, 1.0 - vUv.x) : (uRot < -0.5 ? vec2(1.0 - vUv.y, vUv.x) : vUv);
    vec4 t = texture2D(uTex, uv);
    gl_FragColor = vec4(t.rgb * lit, 1.0);
    return;
  }
  gl_FragColor = vec4(uColor.rgb * lit, uColor.a);
}`;
/* Nombres: un rectángulo en coordenadas de pantalla, siempre de frente. */
const VS2 = `
attribute vec2 aPos; uniform vec2 uCenter; uniform vec2 uSize; varying vec2 vUv;
void main() { vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(uCenter + aPos * uSize, 0.0, 1.0); }`;
const FS2 = `
precision mediump float; varying vec2 vUv; uniform sampler2D uTex;
void main() { gl_FragColor = texture2D(uTex, vUv); }`;

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
 * 3 izquierda (-x). Devuelve dos tandas de escalones (colores alternados).
 * Los lados de arriba y abajo se estiran hasta las esquinas; los costados no,
 * para que no se pisen dos caras en el mismo lugar.
 */
function stands(side, hx, hy) {
  const gap = 46;
  const depth = STEPS * STEP_D;
  const horiz = side < 2;
  const a0 = (horiz ? hy : hx) + gap;
  const lh = horiz ? hx + gap + depth : hy + gap;
  const sign = side === 0 || side === 2 ? 1 : -1;
  const out = [[], []];
  const put = (arr, a, y, l, na, ny) => {
    const x = horiz ? l : sign * a, z = horiz ? sign * a : l;
    const nx = horiz ? 0 : sign * na, nz = horiz ? sign * na : 0;
    arr.push(x, y, z, nx, ny, nz, 0, 0);
  };
  const quad = (arr, p) => { for (const k of [0, 1, 2, 0, 2, 3]) put(arr, ...p[k]); };
  for (let i = 0; i <= STEPS; i++) {
    const last = i === STEPS;
    const d0 = a0 + i * STEP_D, d1 = last ? d0 + 16 : d0 + STEP_D;
    const top = last ? (STEPS * STEP_H + 46) : (i + 1) * STEP_H;
    const arr = out[last ? 0 : i % 2];
    // Tapa del escalón.
    quad(arr, [[d0, top, -lh, 0, 1], [d1, top, -lh, 0, 1], [d1, top, lh, 0, 1], [d0, top, lh, 0, 1]]);
    // Frente, mirando a la cancha.
    quad(arr, [[d0, 0, -lh, -1, 0], [d0, top, -lh, -1, 0], [d0, top, lh, -1, 0], [d0, 0, lh, -1, 0]]);
  }
  return [new Float32Array(out[0]), new Float32Array(out[1])];
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
  let standBufs = null;
  /* Cámara que sigue a tu ficha (vista vertical): se suaviza para que no tiemble. */
  let follow = null;
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
  function upload(t, source) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

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
    U2 = { uCenter: gl.getUniformLocation(prog2, 'uCenter'), uSize: gl.getUniformLocation(prog2, 'uSize'), uTex: gl.getUniformLocation(prog2, 'uTex'), aPos: gl.getAttribLocation(prog2, 'aPos') };

    mesh.side = buffer(cylinderSide(40));
    mesh.cap = buffer(cap(40));
    mesh.ball = buffer(sphere(14, 24));
    mesh.quad = buffer(quad());
    quad2 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad2);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    floorTex = texture(null, true);

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
    const s = Math.min(2, maxTex / (2 * hx), maxTex / (2 * hy));
    const W = Math.max(2, Math.round(2 * hx * s)), H = Math.max(2, Math.round(2 * hy * s));
    floorCv.width = W; floorCv.height = H;
    const ctx = floorCv.getContext('2d', { alpha: false });
    const r = F.r;
    const oc = r.c, ov = r[N.cv];
    r.c = ctx;
    r[N.cv] = { width: W, height: H };
    try {
      ctx.setTransform(s, 0, 0, s, W / 2, H / 2);
      ctx.lineWidth = 3;
      r[N.drawFloor](st);
      if (typeof view.__tvmSkin === 'function') {
        ctx.save();
        try { view.__tvmSkin(ctx, W, H, st); } catch (e) { /* la piel es un adorno */ }
        ctx.restore();
      }
      ctx.setTransform(s, 0, 0, s, W / 2, H / 2);
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
    upload(floorTex, floorCv);
    floorX = hx; floorY = hy;
    if (standBufs) for (const side of standBufs) for (const m of side) gl.deleteBuffer(m.b);
    standBufs = [0, 1, 2, 3].map((side) => stands(side, bx || hx, by || hy).map(buffer));
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
   * La camiseta sale del PATRÓN con el que el juego pinta la ficha en 2D, no del
   * canvas de 64×64 de abajo. Es lo mismo que se ve en 2D, incluido lo que pone
   * el cliente encima (tu avatar con imagen, el GIF, las formas de ficha), que
   * reemplazan el patrón y no siempre ese canvas. Se rearma sólo cuando el
   * patrón cambia: casi nunca, y con GIF una vez por cuadro del GIF (64×64).
   */
  const kitCv = view.document.createElement('canvas');
  kitCv.width = kitCv.height = 64;
  const kitCtx = kitCv.getContext('2d');
  function paintKit(t, L, N) {
    const pat = L[N.pattern];
    kitCtx.setTransform(1, 0, 0, 1, 0, 0);
    kitCtx.clearRect(0, 0, 64, 64);
    if (pat) {
      kitCtx.fillStyle = pat;
      kitCtx.fillRect(0, 0, 64, 64);
    } else {
      const ctx = L[N.tex];
      if (ctx && ctx.canvas) kitCtx.drawImage(ctx.canvas, 0, 0);
    }
    upload(t.kit, kitCv);
    // Si sale vacía, que quede escrito: es lo primero que hay que mirar.
    if (kitChecks < 4) {
      kitChecks++;
      try {
        const px = kitCtx.getImageData(0, 0, 64, 64).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 64) sum += px[i] + px[i + 1] + px[i + 2] + px[i + 3];
        if (sum === 0) log('warn', `vista 3D: la camiseta salió vacía (patrón: ${pat ? 'sí' : 'no'})`);
      } catch (e) { log('warn', `vista 3D: no se pudo revisar la camiseta (${e && e.message})`); }
    }
  }
  function texturesFor(L, N) {
    let t = per.get(L);
    if (!t) { t = { kit: texture(null, false), kitPat: undefined, name: texture(null, true), nameStr: undefined, seen: 0 }; per.set(L, t); }
    t.seen = frameNo;
    const pat = L[N.pattern];
    if (pat !== t.kitPat) {
      paintKit(t, L, N);
      t.kitPat = pat;
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
    let tx = mx * gameTarget.x, tz = gameTarget.y;
    if (cam.follow) {
      const me = F.me;
      const team = F.pl && F.pl[N.team];
      const tid = team ? team[N.teamId] : 0;
      if (me && (tid === 1 || tid === 2) && me[N.pos]) {
        // El rojo ataca hacia la derecha y el azul hacia la izquierda: la cámara
        // se para detrás de tu arco y mira al del rival.
        const attack = (tid === 1 ? 1 : -1) * mx;
        ox = -attack; oz = 0;
        const p = me[N.pos];
        const gx = mx * p.x + attack * visH * 0.2, gz = p.y;
        const dt = Math.min(0.1, Math.max(0, Number(F.dt) || 0.016));
        if (!follow || follow.attack !== attack || Math.abs(follow.x - gx) + Math.abs(follow.z - gz) > 600) {
          follow = { x: gx, z: gz, attack };
        } else {
          const k = 1 - Math.exp(-dt * 9);
          follow.x += (gx - follow.x) * k;
          follow.z += (gz - follow.z) * k;
        }
        tx = follow.x; tz = follow.z;
      } else {
        // Mirando (sin ficha en la cancha): la de la tribuna.
        cam = CAMS.tribuna;
        follow = null;
      }
    } else follow = null;
    const tilt = cam.tilt * Math.PI / 180;
    const D = (visH / 2) / Math.tan(FOV / 2) * cam.dist;
    const back = D * Math.sin(tilt);
    perspective(proj, FOV, W / H, D * 0.05, D * 8);
    lookAt(viewM, tx + ox * back, D * Math.cos(tilt), tz + oz * back, tx, 0, tz);
    multiply(vp, proj, viewM);
    // La tribuna que queda detrás de la cámara no se dibuja: taparía la cancha.
    const behind = oz === 1 ? 0 : oz === -1 ? 1 : ox === 1 ? 2 : 3;

    gl.viewport(0, 0, W, H);
    gl.clearColor(0.05, 0.06, 0.08, 1);
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

    // Piso: primero el suelo de afuera, después la cancha.
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    draw(mesh.quad, 4, tx, -0.5, tz, D * 6, 1, D * 6, groundRgb[0] * 0.55, groundRgb[1] * 0.55, groundRgb[2] * 0.55, 1);
    gl.bindTexture(gl.TEXTURE_2D, floorTex);
    draw(mesh.quad, 2, 0, 0, 0, mx * floorX, 1, floorY, 1, 1, 1, 1);

    // Juntar lo que hay en la cancha.
    const discs = world[N.discs] || [];
    const players = F.room[N.players] || [];
    const map = r[N.draw];
    playerDiscs.clear();
    names.length = 0;

    // Sombras (sobre el piso, debajo de todo lo demás).
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (let i = 0; i < discs.length; i++) {
      const d = discs[i];
      const rad = d[N.radius];
      if (!(rad >= 0)) break;
      if ((d[N.color] | 0) === -1 && i !== 0) continue;
      const pos = d[N.pos];
      draw(mesh.quad, 3, mx * pos.x + rad * 0.3, 0.3, pos.y + rad * 0.25, rad * 1.4, 1, rad * 1.4, 0, 0, 0, 0.42);
    }
    gl.disable(gl.BLEND);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);

    // Tribunas.
    if (standBufs) {
      for (let side = 0; side < 4; side++) {
        if (side === behind) continue;
        draw(standBufs[side][0], 0, 0, 0, 0, 1, 1, 1, SEAT_A[0], SEAT_A[1], SEAT_A[2], 1);
        draw(standBufs[side][1], 0, 0, 0, 0, 1, 1, 1, SEAT_B[0], SEAT_B[1], SEAT_B[2], 1);
      }
    }

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
      const t = texturesFor(L, N);
      const kick = L[N.stroke] === 'white';
      const c = kick ? 0.95 : 0.09;
      draw(mesh.side, 0, x, 0, zz, rad, CONTACT_Y, rad, c, c, c, 1);
      gl.bindTexture(gl.TEXTURE_2D, t.kit);
      draw(mesh.cap, 1, x, 0, zz, rad, CONTACT_Y, rad, 1, 1, 1, 1);
      names.push(t, x, zz, rad);
    }

    // Pelota y discos del estadio (palos y adornos).
    for (let i = 0; i < discs.length; i++) {
      const d = discs[i];
      if (playerDiscs.has(d)) continue;
      const rad = d[N.radius];
      if (!(rad >= 0)) break;
      const col = d[N.color] | 0;
      if (col === -1 && i !== 0) continue;
      const pos = d[N.pos];
      // Sin arreglos nuevos: esto corre por cada disco en cada cuadro.
      const cr = col === -1 ? 1 : ((col >>> 16) & 255) / 255;
      const cg = col === -1 ? 1 : ((col >>> 8) & 255) / 255;
      const cb = col === -1 ? 1 : (col & 255) / 255;
      if (i === 0) {
        // El ecuador de la pelota, a la altura de las tapas de las fichas.
        draw(mesh.ball, 0, mx * pos.x, CONTACT_Y, pos.y, rad, rad, rad, cr, cg, cb, 1);
      } else {
        const h = Math.max(rad * POST_H, CONTACT_Y + 4);
        draw(mesh.side, 0, mx * pos.x, 0, pos.y, rad, h, rad, cr * 0.8, cg * 0.8, cb * 0.8, 1);
        draw(mesh.cap, 0, mx * pos.x, 0, pos.y, rad, h, rad, cr, cg, cb, 1);
      }
    }
    gl.disableVertexAttribArray(U.aNor);
    gl.disableVertexAttribArray(U.aUv);

    // Nombres: siempre de frente y debajo de la ficha en la pantalla, del tamaño
    // que le toca por la distancia (los de lejos, un poco más chicos).
    if (names.length) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(prog2);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad2);
      gl.vertexAttribPointer(U2.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(U2.uTex, 0);
      const half = H / 2;
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
    try { if (gameCv) gameCv.style.visibility = ''; } catch (e) { /* nada */ }
    try { if (glCv) glCv.remove(); if (hudCv) hudCv.remove(); } catch (e) { /* nada */ }
    try { view.removeEventListener('resize', place); } catch (e) { /* nada */ }
    log('warn', `vista 3D apagada: ${why}. Sigue en 2D.`);
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
    dispose() { fallback('apagada'); }
  };
}

module.exports = { install, CAMS };
