'use strict';

/**
 * Vista vertical (2D): la cancha de HaxBall girada 90°, de arco a arco.
 *
 * ── Qué hace ─────────────────────────────────────────────────────────────
 *
 * Gira el dibujo de la cancha para que tu equipo ataque siempre hacia arriba
 * de la pantalla (el rojo ataca a la derecha de la cancha y el azul a la
 * izquierda, así que el giro depende de tu equipo; mirando, como el rojo).
 * Las camisetas, los nombres y el globito de chat se enderezan para que se
 * lean derechos, y las flechas se giran igual que la cancha: arriba te lleva
 * hacia arriba de la pantalla, o sea al arco rival.
 *
 * No toca la física ni la red: sólo dónde se dibuja cada cosa y qué dirección
 * manda cada flecha (lo mismo que ya hace el modo espejo con izquierda y
 * derecha). El modo espejo se apaga solo mientras esto esté prendido.
 *
 * ── Sólo existe si está prendida ─────────────────────────────────────────
 *
 * Se aplica al servir el juego (ver `serveGameBundle` en main.js) y sólo con
 * `perf.vertical` prendido al arrancar. Apagada, el juego que se sirve es el
 * de siempre, byte por byte. Prender o apagar pide reiniciar por eso.
 *
 * ── Rendimiento: lo mismo que en horizontal ──────────────────────────────
 *
 *  · El caché de la cancha del cliente (el dibujo de la cancha guardado y
 *    pegado en cada cuadro) se pega girado, y la parte de cancha que cubre se
 *    calcula para la pantalla girada: ocupa lo mismo que en horizontal.
 *  · Las fichas «figurita» (cada ficha armada una vez y pegada de un saque)
 *    siguen andando: se pegan derechas en su lugar girado.
 *  · Por cuadro se suma un giro de la transformación y nada más.
 */

/* Un salto de línea del minificador puede caer en el medio de cualquier cosa. */
function loose(re) {
  let out = '';
  const src = re.source;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    out += ch;
    if (ch === '\\') { out += src[++i]; if (!/[\w]/.test(src[i])) out += '\\n?'; continue; }
    if (/[,;=&|!<>{}-]/.test(ch)) out += '\\n?';
  }
  return new RegExp(out, re.flags.replace('g', '') + 'g');
}
function all(source, re) { return [...source.matchAll(loose(re))]; }
function one(source, re) { const m = all(source, re); return m.length === 1 ? m[0] : null; }

const SITES = {
  /* El centro de la pantalla en el cuadro: acá se decide el giro y se gira. */
  center: /this\.c\.translate\(this\.([\w$]+)\.width\/2,\(this\.\1\.height\+(\w+)-(\w+)\)\/2\);this\.c\.scale\(/,
  /* El jugador propio en el cuadro (para saber de qué equipo sos). */
  me: /,f=(?:this\.__tvmMe=)?a\.[\w$]+\(b\),g=null!=f\?f\.[\w$]+:null/,
  /* Lo que se ve de cancha, para la cámara: con la pantalla girada, ancho y alto se cambian. */
  view: /l=\(this\.[\w$]+\.height-b-k\)\/h;this\.[\w$]+\(c,g,n,l,d\);/,
  /* Equipo del jugador y su número (1 rojo, 2 azul). */
  team: /\?b\.[\w$]+\[a\.([\w$]+)\.([\w$]+)\]:a\.\1\.[\w$]+/,
  /* La camiseta de cada ficha: se endereza alrededor de su centro. */
  kit: /this\.c\.translate\(a\.a\.x,a\.a\.y\),this\.c\.scale\(b,b\),/,
  /* Nombres y globito de chat, por jugador. */
  label: /let g=this\.[\w$]+\.get\(f\.[\w$]+\);(?=c&&g\.)/,
  /* Las flechas: la máscara del juego (arriba 1, abajo 2, izquierda 4, derecha 8). */
  input: /this\.[\w$]+\.has\("Kick"\)&&\(a\|=16\);/
};

/* Dentro del caché de la cancha y de las fichas del cliente (PRELUDE de game-patch.js). */
const P = {
  mirror: 'if (window.__tvmWantMirror) {',
  visible: '    var vx0 = ex - cx / zoom, vx1 = ex + (vw - cx) / zoom;\n    var vy0 = ey - cy / zoom, vy1 = ey + (vh - cy) / zoom;',
  paste: '    if (mirror) self.c.setTransform(-1, 0, 0, 1, vw, 0);\n    else self.c.setTransform(1, 0, 0, 1, 0, 0);\n    var sc = zoom / cZoom;\n    var dx = cx + zoom * (c0x - ex), dy = cy + zoom * (c0y - ey);',
  grab: '    if (m.b !== 0 || m.c !== 0 || !m.a || !m.d) return;\n    dT.c = c; dT.a = m.a; dT.d = m.d; dT.e = m.e; dT.f = m.f; dT.burst = burst; dT.ok = true;',
  spot: '    var dx = a * x + dT.e, dy = d * y + dT.f;',
  back: '    c.setTransform(a, 0, 0, d, dT.e, dT.f);',
  backErr: '    try { c.setTransform(dT.a, 0, 0, dT.d, dT.e, dT.f); } catch (e10) {}'
};

/* Lo que se ve de cancha con la pantalla girada: las cuatro esquinas, llevadas a la cancha. */
const CORNERS = (() => {
  let s = '\n    if (window.__tvmRot) {' +
    ' var rc = Math.cos(window.__tvmRot), rs = Math.sin(window.__tvmRot), cu, cv2, cwx, cwy;' +
    ' vx0 = vy0 = 1e9; vx1 = vy1 = -1e9;';
  for (const [x, y] of [['0', '0'], ['vw', '0'], ['0', 'vh'], ['vw', 'vh']]) {
    s += ` cu = ${x} - cx; cv2 = ${y} - cy; cwx = ex + (cu * rc + cv2 * rs) / zoom; cwy = ey + (cv2 * rc - cu * rs) / zoom;` +
      ' if (cwx < vx0) vx0 = cwx; if (cwx > vx1) vx1 = cwx; if (cwy < vy0) vy0 = cwy; if (cwy > vy1) vy1 = cwy;';
  }
  return s + ' }';
})();

/**
 * Las flechas giradas. Rojo (cancha girada -90°): arriba en la pantalla es la
 * derecha de la cancha. Azul (+90°): arriba es la izquierda.
 */
const KEYS =
  'window.__tvmKeysRed=function(a){return(a&1?8:0)|(a&2?4:0)|(a&8?2:0)|(a&4?1:0)|(a&16)};' +
  'window.__tvmKeysBlue=function(a){return(a&1?4:0)|(a&2?8:0)|(a&8?1:0)|(a&4?2:0)|(a&16)};';

/**
 * @param {string} source el juego tal como se iba a servir (ya con game-patch)
 * @returns {{source: string, applied: boolean, reason: string}}
 */
function patchVertical(source) {
  const fail = (reason) => ({ source, applied: false, reason });
  if (typeof source !== 'string' || source.length < 1000) return fail('fuente vacía');
  if (source.includes('__tvmRot')) return fail('ya estaba girada');

  const center = one(source, SITES.center);
  const me = one(source, SITES.me);
  const view = one(source, SITES.view);
  const kit = one(source, SITES.kit);
  const label = one(source, SITES.label);
  const input = one(source, SITES.input);
  const teams = all(source, SITES.team);
  if (!center) return fail('no se encontró el centro de la pantalla');
  if (!me) return fail('no se encontró el jugador propio');
  if (!view) return fail('no se encontró lo que se ve de cancha');
  if (!kit) return fail('no se encontró la camiseta');
  if (!label) return fail('no se encontraron los nombres');
  if (!input) return fail('no se encontraron las flechas');
  if (!teams.length || teams.some((m) => m[1] !== teams[0][1] || m[2] !== teams[0][2])) return fail('no se encontró el equipo');
  const [, teamF, teamId] = teams[0];

  /* El caché del cliente, si está: hay que girarlo también o la cancha queda derecha. */
  const hasCache = source.includes('window.__tvmStadium = function');
  if (hasCache && Object.values(P).some((k) => !source.includes(k))) {
    return fail('no se encontró el caché de la cancha del cliente');
  }

  // Se arma de atrás hacia adelante para que los índices no se corran.
  const edits = [];
  // Giro según tu equipo, y las flechas que le corresponden.
  edits.push([center.index,
    `window.__tvmRot=(null!=f&&null!=f.${teamF}&&2==f.${teamF}.${teamId})?Math.PI/2:-Math.PI/2;` +
    'window.__tvmRotKeys=0<window.__tvmRot?window.__tvmKeysBlue:window.__tvmKeysRed;']);
  // Después del centro, el giro.
  edits.push([center.index + center[0].indexOf('this.c.scale('), 'this.c.rotate(window.__tvmRot);']);
  // Cámara: con la pantalla girada, lo que se ve de ancho es lo que antes era alto.
  edits.push([view.index + view[0].indexOf(';') + 1, 'if(window.__tvmRot){var __t=n;n=l;l=__t}']);
  // Camiseta derecha.
  edits.push([kit.index + kit[0].indexOf('this.c.scale('), 'window.__tvmRot&&this.c.rotate(-window.__tvmRot),']);
  // Nombres y globito: se enderezan alrededor de la ficha. El cierre va al final del cuerpo del bucle.
  const labelAt = label.index + label[0].length;
  edits.push([labelAt, 'window.__tvmRot&&(this.c.save(),this.c.translate(e.x,e.y),this.c.rotate(-window.__tvmRot),this.c.translate(-e.x,-e.y));']);
  const namesEnd = source.indexOf('}}', source.indexOf('50)', labelAt));
  if (namesEnd < 0 || namesEnd - labelAt > 700) return fail('no se encontró el final de los nombres');
  edits.push([namesEnd, ';window.__tvmRot&&this.c.restore()']);
  // Flechas: antes del espejo (que igual queda apagado).
  edits.push([input.index + input[0].length, 'window.__tvmRotKeys&&(a=window.__tvmRotKeys(a));']);

  edits.sort((a, b) => b[0] - a[0]);
  let out = source;
  for (const [at, ins] of edits) out = out.slice(0, at) + ins + out.slice(at);

  if (hasCache) {
    // Sin espejo mientras está girada: los dos juntos no tienen sentido.
    out = out.replace(P.mirror, 'if (window.__tvmWantMirror && !window.__tvmRot) {');
    // Lo que se ve, con la pantalla girada: el caché cubre lo mismo que en horizontal.
    out = out.replace(P.visible, P.visible + CORNERS);
    // El pegado del caché, girado alrededor del mismo centro que la cancha.
    out = out.replace(P.paste, P.paste +
      '\n    if (window.__tvmRot) { var co = Math.cos(window.__tvmRot), si = Math.sin(window.__tvmRot);' +
      ' self.c.setTransform(co, si, -si, co, cx, cy); dx = zoom * (c0x - ex); dy = zoom * (c0y - ey); }');
    // Fichas figurita: también con la transformación girada (90° justos).
    out = out.replace(P.grab,
      // 90° justos: el coseno no da 0 exacto (6e-17), se mira con tolerancia.
      '    var turned = !!window.__tvmRot && Math.abs(m.a) < 1e-9 && Math.abs(m.d) < 1e-9 && !!m.b && !!m.c;\n' +
      '    if (!turned && (m.b !== 0 || m.c !== 0 || !m.a || !m.d)) return;\n' +
      '    dT.c = c; dT.a = m.a; dT.d = m.d; dT.mb = turned ? m.b : 0; dT.mc = turned ? m.c : 0; dT.e = m.e; dT.f = m.f; dT.burst = burst; dT.ok = true;');
    out = out.replace(P.spot, P.spot +
      '\n    if (dT.mb) { dx = dT.mc * y + dT.e; dy = dT.mb * x + dT.f; a = Math.abs(dT.mb); d = Math.abs(dT.mc); mir = false; }');
    out = out.replace(P.back, '    c.setTransform(dT.a, dT.mb || 0, dT.mc || 0, dT.d, dT.e, dT.f);');
    out = out.replace(P.backErr, '    try { c.setTransform(dT.a, dT.mb || 0, dT.mc || 0, dT.d, dT.e, dT.f); } catch (e10) {}');
  }

  return { source: KEYS + '\n' + out, applied: true, reason: 'vista vertical enganchada' };
}

module.exports = { patchVertical };
