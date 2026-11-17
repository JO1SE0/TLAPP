'use strict';

/**
 * Vista 3D: el enganche dentro del bundle de HaxBall.
 *
 * ── Sólo existe si la vista 3D está prendida ────────────────────────────
 *
 * Esto NO es uno de los parches de `game-patch.js` y no entra en su cache. Se
 * aplica al servir el bundle (ver `serveGameBundle` en main.js) y únicamente
 * cuando `perf.view3d` está prendido al arrancar. Con la vista 3D apagada el
 * juego que se sirve es, byte por byte, el mismo de siempre: no hay ni una
 * comprobación de más por cuadro. Prender o apagar pide reiniciar justamente
 * por eso.
 *
 * ── Qué agrega ──────────────────────────────────────────────────────────
 *
 * Una sola cosa, en el método que dibuja cada cuadro: después de que el juego
 * movió la cámara y actualizó las texturas de los jugadores, y antes de pintar
 * nada en el canvas 2D, le pasa el cuadro a `window.__tvm3d`. Si esa función
 * dibujó la escena 3D, el cuadro 2D se saltea (no se paga dos veces) y sólo se
 * corren los carteles del juego (pausa, gol) sobre una capa transparente.
 * Si devuelve `false` —o tira un error— el cuadro sigue por el camino 2D de
 * siempre, como si esto no existiera.
 *
 * No toca la física, las teclas ni la red: sólo decide quién dibuja.
 *
 * ── Nombres ─────────────────────────────────────────────────────────────
 *
 * El bundle está minificado y los nombres cambian entre versiones. Igual que
 * `game-patch.js`, se capturan por la FORMA del código y se publican en
 * `window.__tvm3dN` para que la vista los use. Si una sola forma no aparece, no
 * se aplica nada y el juego queda en 2D.
 */

const SITES = {
  /* Arranque del método del cuadro: nombre y el mapa disco → jugador. */
  head: /(\w+)\(a,b\)\{var c=window\.performance\.now\(\);let d=\(c-this\.\w+\)\/1E3;this\.\w+=c;this\.(\w+)\.clear\(\);/g,
  /* El partido, el mundo y el disco del jugador propio. */
  game: /if\(null!=a\.(\w+)\)\{c=a\.\1;var e=c\.(\w+),f=(?:this\.__tvmMe=)?a\.\w+\(b\),g=null!=f\?f\.(\w+):null/,
  /* La lista de jugadores y el mapa id → datos de dibujo. */
  players: /for\(var r=0,t=a\.(\w+);r<t\.length;\)\{let z=t\[r\];\+\+r;if\(null==z\.\w+\)continue;let L=this\.(\w+)\.get\(z\.(\w+)\)/,
  /* El punto de inserción: justo antes de armar la transformación de mundo. */
  hook: /this\.c\.translate\(this\.(\w+)\.width\/2,\(this\.\1\.height\+(\w+)-(\w+)\)\/2\);this\.c\.scale\(\w+,\w+\);this\.c\.translate\(-this\.(\w+)\.x,-this\.\4\.y\);/,
  /* El estadio y cómo se dibuja (con o sin el cache de game-patch). */
  stadium: /(?:this\.(\w+)\(c\.(\w+)\);this\.(\w+)\(c\.\2\)|window\.__tvmStadium\(this,"\w+","\w+",\w+,\w+,\w+,\d+,c\.(\w+),function\(s,t\)\{s\.(\w+)\(t\)\},function\(s,t\)\{s\.(\w+)\(t\)\}\));h=e\.(\w+);/,
  /* El final: carteles, pausa y limpieza. */
  tail: /this\.(\w+)\(c\);0>=c\.(\w+)&&\(this\.(\w+)\.(\w+)\(d\),this\.\3\.(\w+)\(this\.c\)\);this\.(\w+)\.clear\(\);this\.(\w+)\(a\)\}/
};

/* Fuera del método del cuadro: campos de discos, texturas y bordes de cámara. */
const FIELDS = {
  disc: /this\.c\.arc\(a\.(\w+)\.x,a\.\1\.y,a\.(\w+),0,2\*Math\.PI,!1\)/g,
  fill: /null==b\?\(this\.c\.fillStyle=\w+\.\w+\(a\.(\w+)\),this\.c\.strokeStyle="black"\):\(this\.c\.fillStyle=b\.(\w+),this\.c\.strokeStyle=b\.(\w+)\)/g,
  tex: /a\.width=64;a\.height=64;this\.(\w+)=a\.getContext\("2d",null\);/g,
  nameCv: /a\.width=160;a\.height=34;this\.(\w+)=a\.getContext\("2d",null\)/g,
  name: /a\.(\w+)!=this\.\1&&\(this\.\1=a\.\1,this\.\w+\(\)\)/g,
  bounds: /\w+\(a,b,c\)\{a>2\*c\.(\w+)\?this\.\w+\.x=0:[\s\S]*?b>2\*c\.(\w+)\?this\.\w+\.y=0/g,
  /* El equipo del jugador y su número (1 rojo, 2 azul): el mismo acceso aparece
     dos veces, idéntico, al elegir la camiseta. */
  team: /\?b\.\w+\[a\.(\w+)\.(\w+)\]:a\.\1\.\w+/g,
  /* Las uniones entre discos (cadenas, redes): color y los dos discos. */
  joint: /\w+\(a,b\)\{if\(!\(0>a\.(\w+)\)\)\{this\.c\.beginPath\(\);this\.c\.strokeStyle=\w+\.\w+\(a\.\1\);var c=b\[a\.(\w+)\];a=b\[a\.(\w+)\];/g,
  joints: /h=e\.\w+;r=0;for\(t=e\.(\w+);r<t\.length;\)this\.\w+\(t\[r\+\+\],h\)/g,
  /*
   * Donde el juego arma la máscara de teclas (arriba 1, abajo 2, izquierda 4,
   * derecha 8, patada 16). La vista vertical gira la cámara, así que gira
   * también las flechas, en el mismo lugar donde el modo espejo ya da vuelta
   * izquierda y derecha. Va ANTES del espejo: las flechas se piensan en lo que
   * se ve, y el espejo pasa de lo que se ve a la cancha.
   */
  input: /this\.(\w+)\.has\("Kick"\)&&\(a\|=16\);/g,
  /* Paredes (segmentos): la lista y cómo se dibuja cada una. */
  segs: /\w+\(a\)\{if\(null!=a\)\{var b=0;for\(a=a\.([\w$]+);b<a\.length;\)this\.[\w$]+\(a\[b\+\+\]\)\}\}/g,
  seg: /\w+\(a\)\{if\(a\.([\w$]+)\)\{this\.c\.beginPath\(\);this\.c\.strokeStyle=[\w$]+\.[\w$]+\(a\.([\w$]+)\);var b=a\.([\w$]+)\.[\w$]+,c=a\.([\w$]+)\.[\w$]+;if\(0!=0\*a\.([\w$]+)\)[\s\S]*?else\{a=a\.([\w$]+);/g,
  /* Con qué choca cada cosa: el mismo par de campos en discos y paredes. */
  mask: /0!=\(f\.([\w$]+)&c\.([\w$]+)\)&&0!=\(f\.\2&c\.\1\)/g,
  /* Los arcos: la lista (por su nombre en el archivo del estadio) y sus dos puntas. */
  goals: /\(this\.([\w$]+),"goals",/g,
  goal: /[\w$]+\.[\w$]+\(a\.p0,Array\);let d=[\w$]+\.[\w$]+\(a\.p1,Array\),e=b\.([\w$]+);e\.x=c\[0\];e\.y=c\[1\];c=b\.([\w$]+);/g
};

/**
 * El minificador de HaxBall mete un salto de línea cada ~80 caracteres, en el
 * medio de cualquier expresión. Las formas se escriben sin saltos y acá se les
 * permite uno después de cualquier símbolo que no sea parte de un nombre.
 */
function loose(re) {
  let out = '';
  const src = re.source;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    out += ch;
    if (ch === '\\') { out += src[++i]; if (!/[\w]/.test(src[i])) out += '\\n?'; continue; }
    if (/[,;=&|!<>{}]/.test(ch)) out += '\\n?';
  }
  return new RegExp(out);
}

/** Exactamente una aparición, o nada: dos querría decir que la forma ya no es específica. */
function one(source, re) {
  const all = [...source.matchAll(new RegExp(loose(re).source, 'g'))];
  return all.length === 1 ? all[0] : null;
}
function first(text, re) {
  return loose(re).exec(text);
}

/**
 * @param {string} source el bundle tal como se iba a servir (ya con game-patch)
 * @returns {{source: string, applied: boolean, reason: string}}
 */
function patch3d(source) {
  const fail = (reason) => ({ source, applied: false, reason });
  if (typeof source !== 'string' || source.length < 1000) return fail('fuente vacía');
  if (source.includes('__tvm3dN')) return fail('ya tenía la vista 3D');

  const head = one(source, SITES.head);
  if (!head) return fail('no se encontró el método del cuadro');
  const start = head.index;
  // El método termina en el cierre que sigue a la limpieza del final.
  const tailRe = loose(SITES.tail);
  const rest = source.slice(start);
  const tail = tailRe.exec(rest);
  if (!tail || tail.index > 6000) return fail('no se encontró el final del cuadro');
  const body = rest.slice(0, tail.index + tail[0].length);

  const game = first(body, SITES.game);
  const players = first(body, SITES.players);
  const hook = first(body, SITES.hook);
  const stadium = first(body, SITES.stadium);
  if (!game) return fail('no se encontró el partido');
  if (!players) return fail('no se encontró la lista de jugadores');
  if (!hook) return fail('no se encontró el punto de enganche');
  if (!stadium) return fail('no se encontró el estadio');

  const disc = one(source, FIELDS.disc);
  const fill = one(source, FIELDS.fill);
  const tex = one(source, FIELDS.tex);
  const nameCv = one(source, FIELDS.nameCv);
  const name = one(source, FIELDS.name);
  const bounds = one(source, FIELDS.bounds);
  if (!disc || !fill || !tex || !nameCv || !name || !bounds) return fail('faltan campos de discos o jugadores');
  const teams = [...source.matchAll(new RegExp(loose(FIELDS.team).source, 'g'))];
  if (!teams.length || teams.some((m) => m[1] !== teams[0][1] || m[2] !== teams[0][2])) return fail('no se encontró el equipo del jugador');
  const joint = one(source, FIELDS.joint);
  const joints = one(source, FIELDS.joints);
  const input = one(source, FIELDS.input);
  if (!joint || !joints) return fail('no se encontraron las uniones entre discos');
  if (!input) return fail('no se encontró la lectura de teclas');
  const segs = one(source, FIELDS.segs);
  const seg = one(source, FIELDS.seg);
  const goals = one(source, FIELDS.goals);
  const goal = one(source, FIELDS.goal);
  const masks = [...source.matchAll(new RegExp(loose(FIELDS.mask).source, 'g'))];
  if (!segs || !seg) return fail('no se encontraron las paredes');
  if (!goals || !goal) return fail('no se encontraron los arcos');
  if (!masks.length || masks.some((m) => m[1] !== masks[0][1] || m[2] !== masks[0][2])) return fail('no se encontró con qué choca cada cosa');

  const [, cv, tp, bp, cam] = hook;
  const N = {
    game: game[1], world: game[2], disc: game[3],
    players: players[1], draw: players[2], id: players[3],
    cam,
    stadium: stadium[2] || stadium[4],
    drawFloor: stadium[1] || stadium[5],
    drawWalls: stadium[3] || stadium[6],
    discs: stadium[7],
    pos: disc[1], radius: disc[2], color: fill[1], pattern: fill[2], stroke: fill[3],
    tex: tex[1], nameCv: nameCv[1], name: name[1],
    boundX: bounds[1], boundY: bounds[2],
    paused: tail[2],
    team: teams[0][1], teamId: teams[0][2],
    joints: joints[1], jointColor: joint[1], jointA: joint[2], jointB: joint[3],
    segs: segs[1], segVis: seg[1], segColor: seg[2], segA: seg[3], segB: seg[4], segCurve: seg[5], segCenter: seg[6],
    mask: masks[0][1], group: masks[0][2],
    goals: goals[1], goalA: goal[1], goalB: goal[2],
    cv
  };
  const [, hud, paused, notes, notesStep, notesDraw, ug, prune] = tail;

  /*
   * Lo que se inserta. `F` es un solo objeto que se reusa en cada cuadro (cero
   * basura). La capa de carteles (`__tvm3dHud`) es un contexto 2D transparente
   * del mismo tamaño que el canvas del juego: se le prestan los mismos métodos
   * del juego para que los carteles salgan idénticos.
   */
  const inject =
    'if(window.__tvm3d){var F=window.__tvm3dF||(window.__tvm3dF={});' +
    'F.r=this;F.room=a;F.game=c;F.world=e;F.me=g;F.pl=f;F.dt=d;F.z=h;F.cv=this.' + cv + ';' +
    'var __ok=!1;try{__ok=window.__tvm3d(F)}catch(__e){__ok=!1}' +
    'if(__ok){var __o=window.__tvm3dHud;if(__o){var __c=this.c;this.c=__o;try{' +
    '__o.setTransform(1,0,0,1,0,0);__o.clearRect(0,0,__o.canvas.width,__o.canvas.height);' +
    '__o.translate(this.' + cv + '.width/2,' + tp + '+(this.' + cv + '.height-' + tp + '-' + bp + ')/2);' +
    'this.' + hud + '(c);0>=c.' + paused + '&&(this.' + notes + '.' + notesStep + '(d),this.' + notes + '.' + notesDraw + '(__o))' +
    '}catch(__e){}finally{this.c=__c}}' +
    'this.' + ug + '.clear();this.' + prune + '(a);return}}';

  const at = start + hook.index;
  let out = source.slice(0, at) + inject + source.slice(at);
  // Las flechas giradas: sólo cuando la vista vertical lo pide (`__tvm3dRot`).
  const keyAt = out.indexOf(input[0]) + input[0].length;
  if (out.indexOf(input[0]) < 0) return fail('no se encontró la lectura de teclas');
  out = out.slice(0, keyAt) + 'window.__tvm3dRot&&(a=window.__tvm3dRot(a));' + out.slice(keyAt);
  out = `;window.__tvm3dN=${JSON.stringify(N)};\n` + out;
  return { source: out, applied: true, reason: 'vista 3D enganchada' };
}

module.exports = { patch3d };
