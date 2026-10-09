'use strict';

const i18n = require('./game-i18n');

/* ------------------------------------------------------------------ *
 * Parche al vuelo del bundle de HaxBall
 * ------------------------------------------------------------------ *
 * HaxBall redibuja la cancha entera en CADA cuadro: el fondo con su patrón,
 * el rectángulo del campo, la línea del medio, el círculo central, los arcos.
 * A 1360×818 eso es el grueso del cuadro, y no cambia entre cuadro y cuadro
 * salvo que se mueva la cámara o cambie el estadio.
 *
 * El cliente Zero saca de ahí su diferencia de rendimiento —medido por Santi,
 * ~950 cuadros contra nuestros ~200 en el mismo estadio— cacheando ese dibujo
 * en un canvas aparte. Pueden hacerlo porque se sirven su propia copia del
 * bundle. Nosotros cargamos el `game-min.js` real de haxball.com, así que en
 * vez de mantener un fork lo parcheamos al pasar.
 *
 * ── Por qué el parche es estructural y no por nombres ───────────────────
 *
 * El bundle está minificado y los nombres cambian entre versiones: el método
 * que dibuja el estadio se llama `Br` en la copia de Zero y `Dr` en el que
 * sirve HaxBall hoy. Buscar `Dr` sería romperse en la próxima actualización.
 *
 * Lo que sí es estable es la FORMA del sitio donde hay que entrar: la
 * secuencia que arma la transformación de mundo justo antes de dibujar.
 *
 *   this.c.translate(this.oa.width/2,(this.oa.height+b-k)/2);
 *   this.c.scale(h,h);
 *   this.c.translate(-this.Ya.x,-this.Ya.y);
 *   this.c.lineWidth=3;
 *   this.Dr(c.U);
 *
 * El parche captura de ahí los nombres que necesita (el canvas, la cámara, el
 * zoom, los dos padding, el método y su argumento) y genera el reemplazo con
 * esos mismos nombres.
 *
 * ── Si no aplica, no pasa nada ──────────────────────────────────────────
 *
 * `patch()` devuelve el original intacto y `applied:false`. El cliente sigue
 * funcionando exactamente como hoy, sólo sin la mejora. Una actualización de
 * HaxBall no lo puede romper, y el log lo dice para que se note.
 * ------------------------------------------------------------------ */

/**
 * Sitio de inserción. Los `\s*` son necesarios: el minificador de HaxBall mete
 * saltos de línea cada ~80 caracteres, en medio de cualquier expresión.
 */
const CALL_SITE = new RegExp(
  [
    // this.c.translate(this.<cv>.width/2,(this.<cv>.height+<tp>-<bp>)/2);
    'this\\.c\\.translate\\(\\s*this\\.(\\w+)\\.width\\s*/\\s*2\\s*,\\s*\\(\\s*this\\.\\1\\.height\\s*\\+\\s*(\\w+)\\s*-\\s*(\\w+)\\s*\\)\\s*/\\s*2\\s*\\)\\s*;',
    // this.c.scale(<z>,<z>);
    'this\\.c\\.scale\\(\\s*(\\w+)\\s*,\\s*\\4\\s*\\)\\s*;',
    // this.c.translate(-this.<cam>.x,-this.<cam>.y);
    'this\\.c\\.translate\\(\\s*-\\s*this\\.(\\w+)\\.x\\s*,\\s*-\\s*this\\.\\5\\.y\\s*\\)\\s*;',
    // this.c.lineWidth=<lw>;
    'this\\.c\\.lineWidth\\s*=\\s*(\\d+)\\s*;',
    // this.<draw>(<arg>);
    'this\\.(\\w+)\\(\\s*([\\w.]+)\\s*\\)\\s*;'
  ].join('\\s*')
);

/* ------------------------------------------------------------------ *
 * Parche 2: exponer los ajustes del juego
 * ------------------------------------------------------------------ *
 * Los ajustes de HaxBall (cámara, escala, avatares, chat, sonido) se leen del
 * localStorage UNA vez, al arrancar, y quedan cacheados adentro del bundle:
 *
 *   class ra{constructor(a,b,c,d){...this.jn=c(d)}   // valor cacheado
 *            v(){return this.jn}                     // leer
 *            ia(a){this.jn=a; ...setItem(this.D,...)}}  // escribir
 *
 * Por eso escribir el localStorage desde afuera no cambiaba nada hasta la
 * próxima recarga: el juego ya no lo vuelve a mirar. Y como recargar te saca de
 * la sala, el cliente terminaba pidiendo "reiniciá el juego" para algo que la
 * propia HaxBall cambia en vivo desde su menú — su botón de sonido hace
 * exactamente `m.j.ye.ia(!m.j.ye.v())`.
 *
 * Todas esas opciones cuelgan de un único objeto que el bundle guarda en `m.j`,
 * y `m` es una clase interna del IIFE: desde afuera no se llega. Este parche lo
 * publica en `window` al construirse, y el preload le escribe con `ia()`.
 *
 * El anclaje es la ÚLTIMA opción del bloque. Los nombres de los campos están
 * minificados y cambian entre versiones, pero las claves de storage no pueden
 * cambiar sin romperle los ajustes guardados a todo el mundo.
 */
const SETTINGS_SITE = /this\.\w+\s*=\s*\w+\(\s*"low_latency_canvas"\s*,[^)]*\)\s*;/;

/* ------------------------------------------------------------------ *
 * Parche 3: el estado de la partida, cuadro a cuadro
 * ------------------------------------------------------------------ *
 * Para saber QUIÉN hizo el gol hace falta el estado real del juego: dónde está
 * la pelota, dónde está cada jugador y cómo se llama. Antes esto se adivinaba
 * mirando el canvas (qué se dibujaba y dónde), y no podía funcionar: del canvas
 * salen posiciones, nunca nombres.
 *
 * El estado sí existe adentro del bundle, y hay un lugar donde pasa entero y una
 * sola vez por cuadro: el dibujo del minimapa.
 *
 *   wr(a,b,c){ var d=a.M;                       // a = la sala, M = la partida
 *              if(null!=d) for( d=d.va.H[0],    // va.H[0] = la pelota
 *                               this.Jk(d.a,d.S,b,c),   // a = posición, S = color
 *                               d=0, a=a.K;     // K = los jugadores
 *                               d<a.length; ){
 *                let e=a[d]; ++d;
 *                null!=e.I && this.Jk(e.I.a,e.fa.S,b,c) } }  // I = disco, fa = equipo
 *
 * De esa única forma salen TODOS los nombres minificados que necesitamos, así
 * que no hay que adivinar ninguno: se capturan y se publican en `window.__tvmF`
 * para que el preload los use. Igual que el resto de los parches, el anclaje es
 * estructural y no por nombre — `wr` se va a llamar de otra forma en la próxima
 * versión de HaxBall, pero la forma del minimapa no cambia.
 *
 * Se llama a `window.__tvmTick` y no se hace el trabajo acá porque el que sabe
 * qué hacer con el estado es el preload, que es el que tiene el IPC.
 */
const MINIMAP_SITE = new RegExp(
  [
    // <fn>(<room>,<w>,<h>){var <d>=<room>.<game>;
    '(\\w+)\\(\\s*(\\w+)\\s*,\\s*(\\w+)\\s*,\\s*(\\w+)\\s*\\)\\s*\\{\\s*var\\s+(\\w+)\\s*=\\s*\\2\\.(\\w+)\\s*;',
    // if(null!=<d>)for(<d>=<d>.<world>.<discs>[0],
    'if\\s*\\(\\s*null\\s*!=\\s*\\5\\s*\\)\\s*for\\s*\\(\\s*\\5\\s*=\\s*\\5\\.(\\w+)\\.(\\w+)\\[\\s*0\\s*\\]\\s*,',
    // this.<dot>(<d>.<pos>,<d>.<color>,<w>,<h>),<d>=0,<room>=<room>.<players>;
    'this\\.(\\w+)\\(\\s*\\5\\.(\\w+)\\s*,\\s*\\5\\.(\\w+)\\s*,\\s*\\3\\s*,\\s*\\4\\s*\\)\\s*,',
    '\\s*\\5\\s*=\\s*0\\s*,\\s*\\2\\s*=\\s*\\2\\.(\\w+)\\s*;',
    // <d><<room>.length;){let <p>=<room>[<d>];++<d>;
    '\\s*\\5\\s*<\\s*\\2\\.length\\s*;\\s*\\)\\s*\\{\\s*let\\s+(\\w+)\\s*=\\s*\\2\\[\\s*\\5\\s*\\]\\s*;\\s*\\+\\+\\s*\\5\\s*;',
    // null!=<p>.<disc>&&this.<dot>(<p>.<disc>.<pos>,<p>.<team>.<color>,<w>,<h>)}}
    'null\\s*!=\\s*\\13\\.(\\w+)\\s*&&\\s*this\\.\\9\\(\\s*\\13\\.\\14\\.\\10\\s*,\\s*\\13\\.(\\w+)\\.\\11\\s*,\\s*\\3\\s*,\\s*\\4\\s*\\)\\s*\\}\\s*\\}'
  ].join('\\s*')
);

/**
 * El radio del disco, que decide a qué distancia cuenta como toque.
 *
 *   lm(a,b){ 0>a.V || (this.c.beginPath(), …
 *
 * Va aparte del minimapa porque ahí el radio no aparece. Si no encaja no se
 * pierde el gol: el preload usa los radios de fábrica (15 el jugador, 10 la
 * pelota) y sólo se equivoca en estadios con discos de otro tamaño.
 */
const DISC_RADIUS_SITE =
  /\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*\{\s*0\s*>\s*\1\.(\w+)\s*\|\|\s*\(\s*this\.c\.beginPath\(\)/;

/**
 * El nombre del jugador. `" has joined"` es texto que ve el usuario en el chat:
 * no puede cambiar sin que se note, así que es mejor anclaje que cualquier
 * nombre minificado. El mismo campo lo usan los equipos ("Red", "Blue").
 */
const PLAYER_NAME_SITE = /""\s*\+\s*(\w+)\.(\w+)\s*\+\s*" has joined"/;

/**
 * Quién patea, dicho por el motor.
 *
 * Adivinar el toque por cercanía se equivoca de las dos formas: se pierde la
 * patada fuerte —entre dos cuadros dibujados la pelota ya se fue— y le cuenta un
 * toque al que sólo pasaba cerca. Pero el motor sabe exactamente cuándo alguien
 * patea, porque tiene que avisarlo para hacer sonar la patada:
 *
 *   if (d.Yb && 0>=d.Zc && 0<=d.Cc) {          // tiene la tecla apretada
 *     for (… los discos del mundo …)
 *       if (4 > n - k.V - d.I.V) { … impulso …; f = !0 }   // le llegó
 *     f && (null != this.Sa.yi && this.Sa.yi(d), …)        // ← acá
 *   }
 *
 * `Sa` es la sala y `yi` el enganche del sonido, que recibe al jugador. El
 * cliente lo envuelve —sin pisarlo, que si no se queda sin sonido— y con eso el
 * autor del gol pasa a salir del motor y no de una estimación.
 */
const KICK_SITE = new RegExp([
  // <f>&&(null!=this.<room>.<kick>&&this.<room>.<kick>(<p>),
  '(\\w+)\\s*&&\\s*\\(\\s*null\\s*!=\\s*this\\.(\\w+)\\.(\\w+)\\s*&&\\s*this\\.\\2\\.\\3\\s*\\(\\s*(\\w+)\\s*\\)\\s*,',
  // <p>.<kicking>=!1,<p>.<cooldown>=this.<room>.<reset>,
  '\\s*\\4\\.(\\w+)\\s*=\\s*!\\s*1\\s*,\\s*\\4\\.(\\w+)\\s*=\\s*this\\.\\2\\.(\\w+)\\s*,',
  // <p>.<credit>-=this.<room>.<cost>)
  '\\s*\\4\\.(\\w+)\\s*-=\\s*this\\.\\2\\.(\\w+)\\s*\\)'
].join(''));

/**
 * El aviso de «empieza un cuadro de física», del mismo método que la patada:
 *
 *   A(a){ if(0<this.Ta) …; else { var b=this.Sa.Ct; null!=b&&b(); b=this.Sa.K; …
 *
 * El juego web no lo usa nunca (queda en undefined), así que es nuestro. Se
 * llama una vez por cuadro SIMULADO de la sala que lo tenga puesto, sin
 * argumentos y antes de las patadas y el movimiento. Colgado de la sala real
 * (ver SOUND_SITE), es el reloj exacto de los toques que no son patada: no
 * depende de cuántos cuadros se dibujen ni de la extrapolación.
 */
const STEP_HOOK_SITE =
  /else\s*\{\s*var\s+(\w+)\s*=\s*this\.(\w+)\.(\w+)\s*;\s*null\s*!=\s*\1\s*&&\s*\1\(\s*\)\s*;\s*\1\s*=\s*this\.\2\.(\w+)\s*;/;

/* ------------------------------------------------------------------ *
 * Parche 4: velocidades de reproducción
 * ------------------------------------------------------------------ *
 * HaxBall YA tiene control de velocidad en el reproductor de replays — los
 * botones `-` y `+` al lado del `1x`— sólo que la lista de velocidades es corta:
 *
 *   let e=!0, f=2, g=[.5,.75,1,2,3];
 *   function b(){ let t=g[f]; a.Pl = e?t:0; c.get("spd").textContent = t+"x" }
 *
 * `a.Pl` es el multiplicador que el reproductor le aplica al reloj de la
 * partida (`this.Ub += b*this.Pl`), así que tocándolo se acelera la simulación
 * entera —físicas, chat, marcador— y no sólo el dibujo. Es exactamente lo que
 * queríamos, y por eso NO hay que tocar `performance.now`: ese camino aceleraba
 * el reloj de todo el documento (animaciones, timeouts, medición de FPS) para
 * conseguir de rebote algo que el juego ya ofrece bien hecho.
 *
 * Se hacen dos cosas: agrandar la lista de velocidades (con 0.25x, 4x, 8x y 16x)
 * y publicar un control en `window.__tvmReplay` para poder saltar a una
 * velocidad exacta desde los botones del cliente, en vez de clickear `+` cinco
 * veces.
 */
const SPEED_LIST_SITE =
  /(\w+)\s*=\s*!0\s*,\s*(\w+)\s*=\s*2\s*,\s*(\w+)\s*=\s*\[\s*\.5\s*,\s*\.75\s*,\s*1\s*,\s*2\s*,\s*3\s*\]/;

/** Las que quedan en el `-`/`+`. El cliente además pone botones directos. */
const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 2, 3, 4, 6, 8, 16];

const SPEED_APPLY_SITE = new RegExp(
  [
    // function <b>(){let <t>=<g>[<f>];
    'function\\s+(\\w+)\\s*\\(\\s*\\)\\s*\\{\\s*let\\s+(\\w+)\\s*=\\s*(\\w+)\\[\\s*(\\w+)\\s*\\]\\s*;',
    // <player>.<speed> = <playing> ? <t> : 0;
    '(\\w+)\\.(\\w+)\\s*=\\s*(\\w+)\\s*\\?\\s*\\2\\s*:\\s*0\\s*;',
    // <c>.get("spd").textContent = <t>+"x"}
    '(\\w+)\\.get\\(\\s*"spd"\\s*\\)\\.textContent\\s*=\\s*\\2\\s*\\+\\s*"x"\\s*\\}'
  ].join('\\s*')
);

/* ------------------------------------------------------------------ *
 * Parche 5: el reproductor por dentro
 * ------------------------------------------------------------------ *
 * Para resumir una grabación ENTERA no alcanza con mirarla: aunque se ponga a
 * 16x, hay que esperar la grabación entera y el resumen sale de lo que se llegó
 * a dibujar. Pero el reproductor no necesita que nadie lo mire — su avance es un
 * método común y corriente:
 *
 *   A(){ var a=window.performance.now(), b=a-this.hi; this.hi=a;
 *        0<this.Pd ? (this.Ub+=1E4, …)          // salto en la barra de tiempo
 *                  : this.Ub+=b*this.Pl;        // Pl = la velocidad
 *        a=this.Bf*this.uh; …                   // Bf = cuadros totales
 *        b=this.Ub*this.Ec; a=b|0;              // Ec = cuadros por ms
 *        for(this.Nk=b-a; this.Y<a; ){          // Y  = cuadro actual
 *          for(; null!=this.ug && this.vg==this.Y; )   // el evento que viene
 *            b=this.ug, b.apply(this.T), …, this.dm(); // T = la sala
 *          this.Y++; this.T.A(1) } }                   // un cuadro de física
 *
 * O sea: el reloj de pared decide CUÁNTOS cuadros simular, y después el trabajo
 * real es ese `for`. Con los nombres de esos campos en la mano, el cliente puede
 * correr el mismo `for` a mano de punta a punta —sin dibujar, sin esperar— y
 * mirar la sala en cada cuadro. Un partido de diez minutos son 36.000 cuadros de
 * física: se simulan enteros en un par de segundos.
 *
 * De acá salen todos los nombres que hacen falta, incluido `hc`, el enganche de
 * eventos del propio reproductor, que el cliente NO llama: es el que escribe el
 * chat y los avisos en pantalla, y un análisis no tiene por qué verse.
 */
const REPLAY_STEP_SITE = new RegExp(
  [
    // var <a>=window.performance.now(),<b>=<a>-this.<last>;this.<last>=<a>;
    'var\\s+(\\w+)\\s*=\\s*window\\.performance\\.now\\(\\)\\s*,\\s*(\\w+)\\s*=\\s*\\1\\s*-\\s*this\\.(\\w+)\\s*;\\s*this\\.\\3\\s*=\\s*\\1\\s*;',
    // 0<this.<seek>?(this.<clock>+=1E4,this.<clock>>this.<seek>&&(this.<clock>=this.<seek>,this.<seek>=-1)):
    '0\\s*<\\s*this\\.(\\w+)\\s*\\?\\s*\\(\\s*this\\.(\\w+)\\s*\\+=\\s*1E4\\s*,\\s*this\\.\\5\\s*>\\s*this\\.\\4\\s*&&\\s*\\(\\s*this\\.\\5\\s*=\\s*this\\.\\4\\s*,\\s*this\\.\\4\\s*=\\s*-\\s*1\\s*\\)\\s*\\)\\s*:',
    // this.<clock>+=<b>*this.<speed>;
    'this\\.\\5\\s*\\+=\\s*\\2\\s*\\*\\s*this\\.(\\w+)\\s*;',
    // <a>=this.<total>*this.<msPerFrame>;this.<clock>><a>&&(this.<clock>=<a>);
    '\\1\\s*=\\s*this\\.(\\w+)\\s*\\*\\s*this\\.(\\w+)\\s*;\\s*this\\.\\5\\s*>\\s*\\1\\s*&&\\s*\\(\\s*this\\.\\5\\s*=\\s*\\1\\s*\\)\\s*;',
    // <b>=this.<clock>*this.<framesPerMs>;<a>=<b>|0;
    '\\2\\s*=\\s*this\\.\\5\\s*\\*\\s*this\\.(\\w+)\\s*;\\s*\\1\\s*=\\s*\\2\\s*\\|\\s*0\\s*;',
    // for(this.<interp>=<b>-<a>;this.<frame><<a>;){
    'for\\s*\\(\\s*this\\.(\\w+)\\s*=\\s*\\2\\s*-\\s*\\1\\s*;\\s*this\\.(\\w+)\\s*<\\s*\\1\\s*;\\s*\\)\\s*\\{',
    // for(;null!=this.<next>&&this.<nextFrame>==this.<frame>;)
    'for\\s*\\(\\s*;\\s*null\\s*!=\\s*this\\.(\\w+)\\s*&&\\s*this\\.(\\w+)\\s*==\\s*this\\.\\11\\s*;\\s*\\)',
    // <b>=this.<next>,<b>.apply(this.<room>),null!=this.<hook>&&this.<hook>(<b>),this.<read>();
    '\\2\\s*=\\s*this\\.\\12\\s*,\\s*\\2\\.apply\\(\\s*this\\.(\\w+)\\s*\\)\\s*,\\s*null\\s*!=\\s*this\\.(\\w+)\\s*&&\\s*this\\.\\15\\(\\s*\\2\\s*\\)\\s*,\\s*this\\.(\\w+)\\(\\s*\\)\\s*;',
    // this.<frame>++;this.<room>.<step>(1)}
    'this\\.\\11\\s*\\+\\+\\s*;\\s*this\\.\\14\\.(\\w+)\\(\\s*1\\s*\\)\\s*\\}'
  ].join('\\s*')
);

/**
 * El "volver al principio" del reproductor, que es por dónde tiene que empezar
 * cualquier análisis:
 *
 *   Ji(){ this.vg=0; this.Ub=this.Y=this.Sc.a=0; this.T.na(this.Sc); this.dm() }
 *
 * Se busca con los nombres que ya capturó REPLAY_STEP_SITE, así que el patrón se
 * arma recién cuando ése encajó.
 */
function rewindSite(fields) {
  return new RegExp(
    `(\\w+)\\(\\s*\\)\\s*\\{\\s*this\\.${fields.nextFrame}\\s*=\\s*0\\s*;` +
    `\\s*this\\.${fields.clock}\\s*=\\s*this\\.${fields.frame}\\s*=\\s*this\\.(\\w+)\\.(\\w+)\\s*=\\s*0\\s*;`
  );
}

/* ------------------------------------------------------------------ *
 * Parche 6: el marcador de la partida
 * ------------------------------------------------------------------ *
 * En vivo los goles se ven venir mirando el HUD, que HaxBall mantiene al día.
 * Simulando una grabación a mano no hay HUD que mirar —nadie dibuja nada—, así
 * que el marcador hay que leerlo de la partida misma. Está en el objeto que el
 * HUD usa para pintarse:
 *
 *   this.Tb=new Ob(a.get("red-score"),0);       // ← quién es rojo y quién azul
 *   this.Ob=new Ob(a.get("blue-score"),0);
 *   …
 *   b=a.M;                                      // M = la partida
 *   …,this.Wc.fs(b.Nc|0),                       // Nc = segundos jugados
 *   this.Ob.set(b.Ob),this.Tb.set(b.Tb),…       // los dos marcadores
 *
 * Los `data-hook` son los que mandan: los campos están minificados, pero cuál de
 * los dos es el rojo lo dice el HTML, que no puede cambiar sin que se note.
 */
const SCORE_SITE = new RegExp(
  [
    // this.<redSet>=new <cls>(<c>.get("red-score"),0);this.<blueSet>=new <cls>(<c>.get("blue-score"),0);
    'this\\.(\\w+)\\s*=\\s*new\\s+(\\w+)\\(\\s*(\\w+)\\.get\\(\\s*"red-score"\\s*\\)\\s*,\\s*0\\s*\\)\\s*;',
    'this\\.(\\w+)\\s*=\\s*new\\s+\\2\\(\\s*\\3\\.get\\(\\s*"blue-score"\\s*\\)\\s*,\\s*0\\s*\\)\\s*;'
  ].join('\\s*')
);

const SCORE_FIELDS_SITE = new RegExp(
  [
    // <m>=<room>.<game>;null==<m>?
    '(\\w+)\\s*=\\s*(\\w+)\\.(\\w+)\\s*;\\s*null\\s*==\\s*\\1\\s*\\?',
    // this.<f>.hidden=!0:(this.<f>.hidden=!1,
    'this\\.(\\w+)\\.hidden\\s*=\\s*!\\s*0\\s*:\\s*\\(\\s*this\\.\\4\\.hidden\\s*=\\s*!\\s*1\\s*,',
    // this.<timer>.gs(60*<room>.<limit>),this.<timer>.fs(<m>.<time>|0),
    'this\\.(\\w+)\\.gs\\(\\s*60\\s*\\*\\s*\\2\\.(\\w+)\\s*\\)\\s*,\\s*this\\.\\5\\.fs\\(\\s*\\1\\.(\\w+)\\s*\\|\\s*0\\s*\\)\\s*,',
    // this.<setA>.set(<m>.<fieldA>),this.<setB>.set(<m>.<fieldB>)
    'this\\.(\\w+)\\.set\\(\\s*\\1\\.(\\w+)\\s*\\)\\s*,\\s*this\\.(\\w+)\\.set\\(\\s*\\1\\.(\\w+)\\s*\\)'
  ].join('\\s*')
);

/**
 * Ayudante que se antepone al bundle. Va en `window` porque así no hay que
 * encontrar la clase del renderer dentro del minificado: el sitio parcheado lo
 * llama por nombre global.
 */
const PRELUDE = `;(function(){
"use strict";
if (window.__tvmStadium) return;

/* Margen del cache, en píxeles de pantalla. Con el cache del tamaño exacto del
   canvas, mover la cámara dejaba franjas sin dibujar en el borde. */
var PAD = 96;

var cache = null, ctx = null;
var lastStadium = null, lastPrint = '', lastW = 0, lastH = 0;
var lastZoom = 0, lastTop = -1, lastBot = -1, lastCamX = 0, lastCamY = 0;
var flush = false, broken = false;

/* Estadística, leíble desde afuera con window.__tvmStadiumStats. */
var S = { hits: 0, misses: 0, why: {}, drawMs: 0, blitMs: 0 };
window.__tvmStadiumStats = S;

/* Alt+Tab y volver deja restos: se tira el cache para no arrastrar fantasmas. */
function markFlush() { flush = true; }
try {
  window.addEventListener('focus', markFlush);
  window.addEventListener('pageshow', markFlush);
  window.document.addEventListener('visibilitychange', function () {
    if (!window.document.hidden) markFlush();
  });
} catch (e) {}

/*
 * Huella del estadio: TODOS sus campos escalares.
 *
 * Zero compara una lista fija de campos elegidos a mano. Acá no: los nombres
 * están minificados y cambian entre versiones, así que elegir cuáles importan
 * es adivinar — y adivinar de menos significa cachear algo que en realidad
 * cambia, o sea la cancha congelada en pantalla. Recorrer los escalares cuesta
 * microsegundos contra redibujar la cancha entera.
 */
var printObject = null, printValues = Object.create(null), printCount = 0, printRevision = 0;
function print(o) {
  var count = 0, changed = o !== printObject;
  for (var k in o) {
    var v = o[k];
    var t = typeof v;
    if (t === 'number' || t === 'boolean' || t === 'string') {
      count++;
      if (!(k in printValues) || !Object.is(printValues[k], v)) changed = true;
    }
  }
  if (count !== printCount) changed = true;
  if (changed) {
    printValues = Object.create(null);
    for (var key in o) {
      var value = o[key], kind = typeof value;
      if (kind === 'number' || kind === 'boolean' || kind === 'string') printValues[key] = value;
    }
    printObject = o; printCount = count; printRevision++;
  }
  return printRevision;
}

window.__tvmStadiumFlush = markFlush;

/*
 * El pincel del cliente, en su propia función.
 *
 * Se llama en TODOS los caminos —con cache, sin cache y con el cache apagado
 * por un error— porque si no, apagar el cache apagaba también el aro, la estela
 * y el mapa, sin decir una palabra y hasta reiniciar. Son dos cosas
 * independientes: una es rendimiento y la otra es lo que el jugador pidió ver.
 */
function pintar(self, zoom) {
  if (!window.__tvmPaint) return;
  self.c.save();
  try { window.__tvmPaint(self.c, self, zoom); } catch (e4) {}
  self.c.restore();
}

/*
 * El repintado de la cancha, en el único momento en que sale gratis.
 *
 * Va pegado al dibujo del estadio y no al pincel de abajo: acá adentro lo que
 * hay pintado es la cancha SOLA —todavía no hay discos, ni nombres, ni pelota—,
 * así que se la puede tratar como una imagen entera sin llevarse puesto a nadie.
 * Y como esto corre dentro del camino del cache, se paga una vez por
 * invalidación y no una vez por cuadro: el resto del tiempo la cancha repintada
 * ya está adentro del cache y se copia igual que antes.
 *
 * Recibe el tamaño en píxeles porque el contexto viene con la transformación de
 * mundo puesta, y quien quiera pintar toda la superficie necesita saber cuánta
 * hay. El estadio va también: es de donde salen las medidas de la cancha.
 */
function skin(c, w, h, stadium) {
  if (!window.__tvmSkin) return;
  c.save();
  try { window.__tvmSkin(c, w, h, stadium); } catch (e5) {}
  c.restore();
}

window.__tvmStadium = function (self, cvKey, camKey, zoom, topPad, botPad, lineW, stadium, draw) {
  var cv = self[cvKey];
  var cam = self[camKey];

  /* ── El espejo ───────────────────────────────────────────────────────
     Se decide UNA vez por cuadro y acá, que es lo primero que corre del dibujo:
     todo lo que se pinta después —la cancha, los discos, la pelota, los
     nombres, los adornos del cliente— lee esta misma bandera, así que no hay
     forma de que la mitad del cuadro salga espejada y la otra mitad no.

     El vuelco se aplica ACÁ ARRIBA y no al final para que valga también cuando
     el cache está apagado: en ese camino la cancha se dibuja derecho sobre este
     contexto, unas líneas más abajo.

     El pivote es la cámara del juego y no la cancha. Es lo mismo cuando la
     cámara está quieta en el medio, y es lo correcto cuando sigue al jugador:
     espejar alrededor de la cancha te dejaría mirando el arco de enfrente.

     El desvío de la cámara libre se le suma después, al final de la función, y
     las dos vueltas componen bien: el translate(-off) de allá abajo entra por
     dentro de este espejo y termina dando centro - zoom*(mundo - cámara - off),
     que es exactamente la vista espejada corrida. */
  var mirror = false;
  if (window.__tvmWantMirror) {
    try { mirror = !!window.__tvmWantMirror(self); } catch (e6) { mirror = false; }
  }
  window.__tvmMirror = mirror;
  if (mirror && cam) {
    self.c.translate(cam.x, 0);
    self.c.scale(-1, 1);
    self.c.translate(-cam.x, 0);
  }

  if (broken || !cv || !cam) {
    draw(self, stadium);
    /* Sin cache esto se paga en cada cuadro. Se hace igual: el cache apagado es
       la excepción (un error, o un canvas que todavía no está), y quedarse sin
       los colores elegidos sin decir nada es peor que el costo. */
    skin(self.c, cv ? cv.width : 0, cv ? cv.height : 0, stadium);
    pintar(self, zoom);
    return;
  }

  try {
    var vw = cv.width, vh = cv.height;
    var cacheW = vw + 2 * PAD, cacheH = vh + 2 * PAD;

    /* ── Desvío de cámara (la cámara libre de los replays) ───────────────
       El cliente puede pedir correr la vista. No se toca el objeto de cámara
       del juego —lo reescribe él en cada cuadro y se perdería— sino que el
       desvío se SUMA acá y se trata como si fuera parte de la cámara: así el
       cache se invalida solo cuando la vista se corre de más, con la misma
       cuenta de siempre y sin un caso especial.

       Con su propio try: un error del cliente acá tiene que costar la cámara
       libre y NADA más. Sin esto caía en el catch de abajo, que apaga el cache
       del estadio para siempre — o sea que un bug en un adorno de los replays
       le bajaba los cuadros al juego hasta reiniciar. */
    var offX = 0, offY = 0;
    if (window.__tvmCam) {
      try {
        /* Se le pasan la cámara y el zoom del cuadro: con eso el cliente puede
           centrar la vista en un jugador (le resta la cámara a su posición) y
           pasar un clic de pantalla a coordenadas de cancha. Sin esto tendría
           que adivinar los dos, que es justamente lo que no se puede. */
        var off = window.__tvmCam(cam, zoom, cv);
        if (off) { offX = off.x || 0; offY = off.y || 0; }
      } catch (e0) { offX = 0; offY = 0; }
    }
    var ex = cam.x + offX, ey = cam.y + offY;

    var fp = print(stadium);
    var camDx = (lastCamX - ex) * zoom;
    var camDy = (lastCamY - ey) * zoom;
    var limit = PAD * 0.8;

    /* Contadores: sin esto no hay forma de saber si el cache acierta. Un cache
       que falla siempre no es neutro, es más lento que no tenerlo. */
    var why = null;
    if (!cache) why = 'sin cache';
    else if (flush) why = 'flush';
    else if (stadium !== lastStadium) why = 'otro estadio';
    else if (fp !== lastPrint) why = 'campos del estadio';
    else if (vw !== lastW || vh !== lastH) why = 'tamaño';
    else if (Math.abs(zoom - lastZoom) > 1e-3) why = 'zoom';
    else if (Math.abs(topPad - lastTop) > 0.5 || Math.abs(botPad - lastBot) > 0.5) why = 'padding';
    else if ((camDx * camDx + camDy * camDy) > limit * limit) why = 'cámara';

    if (why) { S.misses++; S.why[why] = (S.why[why] || 0) + 1; } else S.hits++;

    if (why) {
      flush = false;
      if (!cache) {
        cache = window.document.createElement('canvas');
        ctx = cache.getContext('2d', { alpha: false });
        if (!ctx) { broken = true; draw(self, stadium); return; }
      }
      if (cache.width !== cacheW || cache.height !== cacheH) {
        cache.width = cacheW;
        cache.height = cacheH;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cacheW, cacheH);
      ctx.translate(cacheW / 2, (cacheH + topPad - botPad) / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-ex, -ey);
      ctx.lineWidth = lineW;

      /* El dibujo del estadio lee this.<canvas>.width/height para su fondo, así
         que hay que mentirle el tamaño. No se toca el canvas real: asignarle
         .width lo borraría entero. */
      var realCtx = self.c, realCv = self[cvKey];
      self.c = ctx;
      self[cvKey] = { width: cacheW, height: cacheH };
      try {
        draw(self, stadium);
        skin(ctx, cacheW, cacheH, stadium);
      } finally {
        self.c = realCtx;
        self[cvKey] = realCv;
      }

      lastStadium = stadium; lastPrint = fp;
      lastW = vw; lastH = vh; lastZoom = zoom;
      lastTop = topPad; lastBot = botPad;
      lastCamX = ex; lastCamY = ey;
      camDx = 0; camDy = 0;
    }

    self.c.save();
    /* El cache se guarda SIEMPRE derecho: lo que espeja es la copia, no el
       dibujo. Así prender o apagar el espejo no invalida nada —el cache que
       había sigue sirviendo— y el estadio no se vuelve a dibujar por cambiar de
       equipo, que es justo el momento en que menos ganas hay de un tirón.

       setTransform(-1,0,0,1,vw,0) da vuelta la pantalla alrededor de su centro
       horizontal, que es el mismo centro que usa la transformación de mundo
       (el width/2 del canvas). Por eso el desplazamiento de cámara del
       drawImage NO cambia de signo: la cuenta ya sale con el mismo camDx que en
       el camino normal. */
    if (mirror) self.c.setTransform(-1, 0, 0, 1, vw, 0);
    else self.c.setTransform(1, 0, 0, 1, 0, 0);
    self.c.drawImage(cache, -PAD + camDx, -PAD + camDy);
    self.c.restore();

    /* El desvío se aplica a la transformación y NO se deshace: lo que se dibuja
       después de que esta función vuelve —los discos, la pelota, los nombres—
       tiene que moverse junto con la cancha. El juego resetea la transformación
       al empezar cada cuadro, así que no queda nada colgado. */
    if (offX || offY) self.c.translate(-offX, -offY);
  } catch (err) {
    /* Cualquier cosa rara: se apaga el cache para siempre y se vuelve al dibujo
       normal. Vale más perder los cuadros que dejar la cancha rota. */
    broken = true;
    try { window.console && window.console.warn && window.console.warn('[TVM] cache de estadio apagado:', err); } catch (e2) {}
    try { draw(self, stadium); } catch (e3) {}
  }

  /* ── El pincel del cliente ────────────────────────────────────────────
     Acá la cancha ya está y los discos todavía no, y la transformación de
     mundo del cuadro sigue puesta: es el único punto del cuadro donde se puede
     dibujar EN COORDENADAS DE CANCHA y por debajo de los jugadores. Por eso el
     aro y la estela quedan como parte del piso y no como una calcomanía encima
     de todo.

     Va afuera del try de arriba: que el cache se rompa no tiene por qué dejar
     al jugador sin lo que prendió. */
  pintar(self, zoom);
};
})();
`;

/**
 * Aplica el cache del estadio. Devuelve el original si el sitio no encaja.
 * @returns {{source: string, applied: boolean, reason: string}}
 */
function patchStadium(source) {
  const matches = source.match(new RegExp(CALL_SITE.source, 'g')) || [];
  if (matches.length === 0) {
    return { source, applied: false, reason: 'no se encontró el sitio de dibujo del estadio' };
  }
  // Más de uno querría decir que el patrón dejó de ser específico y estaríamos
  // parcheando cualquier cosa. Mejor no tocar nada.
  if (matches.length > 1) {
    return { source, applied: false, reason: `el patrón del estadio encajó ${matches.length} veces, se esperaba 1` };
  }

  let captured = null;
  const patched = source.replace(CALL_SITE, (_full, cv, tp, bp, z, cam, lw, draw, arg) => {
    captured = { cv, tp, bp, z, cam, lw, draw, arg };
    return (
      `this.c.translate(this.${cv}.width/2,(this.${cv}.height+${tp}-${bp})/2);` +
      `this.c.scale(${z},${z});` +
      `this.c.translate(-this.${cam}.x,-this.${cam}.y);` +
      `this.c.lineWidth=${lw};` +
      `window.__tvmStadium(this,"${cv}","${cam}",${z},${tp},${bp},${lw},${arg},` +
      `function(s,t){s.${draw}(t)});`
    );
  });

  return {
    source: PRELUDE + patched,
    applied: true,
    reason: `estadio cacheado (canvas=${captured.cv} cámara=${captured.cam} dibujo=${captured.draw})`
  };
}

/* ------------------------------------------------------------------ *
 * Parche 6: el avatar animado
 * ------------------------------------------------------------------ *
 * HaxBall arma la textura de cada disco en un canvas de 64×64 —las franjas del
 * equipo y encima el avatar— y de ahí saca el patrón con el que lo dibuja:
 *
 *   this.Kb.fillText(a,32,44);
 *   this.ak = this.Kb.createPattern(this.Kb.canvas,"no-repeat")
 *
 * Para animarlo hay que rehacer ese patrón, y no alcanza con repintar la
 * textura: medido en Chromium 91, un CanvasPattern se queda con una FOTO del
 * canvas y no lo vuelve a mirar. Rehacerlo, en cambio, es gratis: el que dibuja
 * el disco hace `fillStyle = b.ak` en cada cuadro y por cada disco, así que
 * alcanza con cambiarle el VALOR a esa propiedad cada tanto y el cuadro
 * siguiente ya sale con la textura nueva.
 *
 * El parche no hace nada de eso: sólo pasa el objeto —y el texto del avatar,
 * que es con lo que el cliente reconoce cuál disco es el tuyo— para que el
 * preload pueda escribirle la propiedad. Sin el parche, el avatar con imagen
 * fija sigue funcionando exactamente igual que hoy.
 */
/* ------------------------------------------------------------------ *
 * La imagen de la pelota
 * ------------------------------------------------------------------ *
 * Todos los discos —jugadores y pelota— los dibuja la misma función. Del
 * bundle, con los nombres minificados de esta versión:
 *
 *   lm(a,b){0>a.V||(this.c.beginPath(),
 *     null==b ? (this.c.fillStyle=T.nc(a.S),this.c.strokeStyle="black")
 *             : (this.c.fillStyle=b.ak,this.c.strokeStyle=b.To),
 *     this.c.beginPath(),
 *     this.c.arc(a.a.x,a.a.y,a.V,0,2*Math.PI,!1),
 *     null!=b ? (…rellena con el patrón del jugador…)
 *             : -1!=(a.S|0)&&this.c.fill(),     ← LA PELOTA
 *     this.c.stroke())}
 *
 * `b` es el jugador: trae `ak`, que es el patrón donde ya metemos el avatar.
 * Para la pelota `b` viene en null, así que la rama del `else` es suya sola y
 * es el único lugar que hay que tocar.
 *
 * Se engancha el relleno y no el `arc`: para cuando se llega acá el trazo del
 * círculo YA está armado, así que el preload puede hacerle `clip()` y dibujar
 * la imagen recortada a la pelota sin calcular nada. Y como el `stroke()` de
 * abajo queda afuera del parche, el contorno negro de HaxBall se sigue
 * dibujando igual.
 *
 * El hook devuelve `true` si dibujó; si devuelve cualquier otra cosa —no hay
 * imagen puesta, o se rompió— cae en el `fill()` de siempre y la pelota se ve
 * como toda la vida.
 *
 * ── Y no todo lo que entra por ahí es la pelota ────────────────────────────
 *
 * Los PALOS DEL ARCO también son discos sin jugador, así que salían con la
 * imagen puesta igual que la pelota. Quién es quién lo dice el índice: el disco
 * 0 es la pelota, y no es una suposición — el propio HaxBall lo hace así para
 * dibujar el minimapa (`d=d.va.H[0]`, ver MINIMAP_SITE).
 *
 * El índice no llega hasta `lm`, así que hay que traerlo del bucle que la
 * llama. Se pasa como tercer argumento y del otro lado se lee con
 * `arguments[2]`: así no hay que tocar la declaración de `lm`, que es la misma
 * que dibuja a los jugadores.
 */
const BALL_SITE = new RegExp(
  // -1!=(<disco>.<color>|0)&&this.<ctx>.fill()
  '-1\\s*!=\\s*\\((\\w+)\\.(\\w+)\\s*\\|\\s*0\\)\\s*&&\\s*this\\.(\\w+)\\.fill\\(\\)'
);

/*
 * El bucle que dibuja los discos que no son de nadie:
 *
 *   f=0;for(e=e.H;f<e.length;)
 *     if(g=e[f],++f,null==this.Ug.get(g)){ if(0>g.V)break; this.lm(g,null) }
 *
 * Se le engancha el índice, que después de `++f` es `f-1`.
 */
const BALL_LOOP_SITE = new RegExp(
  [
    '(\\w+)\\s*=\\s*0\\s*;\\s*for\\s*\\(\\s*(\\w+)\\s*=\\s*\\2\\.(\\w+)\\s*;',
    '\\s*\\1\\s*<\\s*\\2\\.length\\s*;\\s*\\)',
    '\\s*if\\s*\\(\\s*(\\w+)\\s*=\\s*\\2\\[\\s*\\1\\s*\\]\\s*,\\s*\\+\\+\\s*\\1\\s*,',
    '\\s*null\\s*==\\s*this\\.(\\w+)\\.get\\(\\s*\\4\\s*\\)\\s*\\)\\s*\\{',
    '\\s*if\\s*\\(\\s*0\\s*>\\s*\\4\\.(\\w+)\\s*\\)\\s*break\\s*;',
    '\\s*this\\.(\\w+)\\(\\s*\\4\\s*,\\s*null\\s*\\)\\s*\\}'
  ].join('')
);

function patchBall(source) {
  const relleno = source.match(new RegExp(BALL_SITE.source, 'g')) || [];
  if (relleno.length !== 1) {
    return { source, applied: false, reason: `el relleno de la pelota encajó ${relleno.length} veces, se esperaba 1` };
  }
  const bucle = source.match(new RegExp(BALL_LOOP_SITE.source, 'g')) || [];
  if (bucle.length !== 1) {
    /*
     * Sin el índice NO se aplica nada.
     *
     * Se podría parchear sólo el relleno y dibujar en todo disco sin jugador,
     * pero eso es justamente el bug: la imagen aparecía también en los palos
     * del arco. Mejor quedarse sin la función que dejarla mal.
     */
    return { source, applied: false, reason: `el bucle de discos encajó ${bucle.length} veces, se esperaba 1` };
  }

  let campos = null;
  let out = source.replace(BALL_SITE, (full, disco, color, ctx) => {
    campos = { disco, ctx };
    // `a.a` es la posición del disco y `a.V` el radio, los mismos que acaba de
    // usar el `arc()` de dos expresiones más arriba. `arguments[2]` es el índice
    // que le agrega el parche del bucle, de acá abajo.
    return `-1!=(${disco}.${color}|0)&&(window.__tvmBall&&window.__tvmBall(this.${ctx},${disco}.a.x,${disco}.a.y,${disco}.V,arguments[2])||this.${ctx}.fill())`;
  });

  out = out.replace(BALL_LOOP_SITE, (full, f) =>
    // Sólo la llamada: el resto del bucle queda intacto.
    full.replace(/(this\.\w+\(\s*\w+\s*,\s*)null(\s*\))/, `$1null,${f}-1$2`)
  );

  return {
    source: out,
    applied: true,
    reason: `pelota enganchada (disco=${campos.disco} ctx=${campos.ctx})`
  };
}

const AVATAR_SITE = new RegExp(
  [
    // this.<ctx>.fillText(<texto>,32,44);
    'this\\.(\\w+)\\.fillText\\(\\s*(\\w+)\\s*,\\s*32\\s*,\\s*44\\s*\\)\\s*;',
    // this.<pat>=this.<ctx>.createPattern(this.<ctx>.canvas,"no-repeat")
    'this\\.(\\w+)\\s*=\\s*this\\.\\1\\.createPattern\\(\\s*this\\.\\1\\.canvas\\s*,\\s*"no-repeat"\\s*\\)'
  ].join('\\s*')
);

function patchAvatar(source) {
  const matches = source.match(new RegExp(AVATAR_SITE.source, 'g')) || [];
  if (matches.length !== 1) {
    return { source, applied: false, reason: `la textura del disco encajó ${matches.length} veces, se esperaba 1` };
  }

  let campos = null;
  const patched = source.replace(AVATAR_SITE, (full, ctx, texto, pat) => {
    campos = { ctx, pat };
    /*
     * El aviso de ANTES es el que dice de quién es esta textura.
     *
     * Adentro de este método no hay ni jugador ni sala: sólo el objeto que
     * cachea la textura. Quién es su dueño lo dejó anotado `patchSelf` en
     * `__tvmMine`, y hay que leerlo acá y no dos líneas más abajo porque el
     * `fillText` que sigue es justamente donde el cliente mete la imagen: para
     * cuando avisa el segundo hook, la textura ya se dibujó.
     *
     * El sitio arranca después de un `;` (el de la fuente que se acaba de
     * elegir), así que va como sentencia. El segundo sigue con coma, que ahí sí
     * está en medio de una expresión encadenada.
     */
    return `window.__tvmAvatarPre&&window.__tvmAvatarPre(this);${full}`
      + `,window.__tvmAvatar&&window.__tvmAvatar(this,${texto},"${pat}")`;
  });

  return {
    source: patched,
    applied: true,
    reason: `textura del disco expuesta (ctx=${campos.ctx} patrón=${campos.pat})`
  };
}

/* ── Cuál de los discos sos vos ──────────────────────────────────────────── *
 *
 * El problema que resuelve: la imagen de avatar del VIP se ponía en el disco de
 * cualquiera que tuviera el MISMO texto de avatar que vos, porque el cliente
 * reconocía su textura por ese texto y por nada más. Dos jugadores con "SG" en
 * el avatar y los dos se llevaban tu foto.
 *
 * El juego, en cambio, sabe perfectamente cuál sos: es el jugador que sigue la
 * cámara. En el método que dibuja el cuadro (`Rc(<sala>,<tuId>)`) hace
 *
 *     f=a.ma(b), g=null!=f?f.I:null      // f = TU jugador, g = tu disco
 *
 * y `ma()` busca por `.Z`, que es la clave única del jugador en la sala —la
 * misma con la que se lo echa, y la que vale 0 para el host—. Unas líneas más
 * abajo, en el mismo método, está el bucle que le da a cada jugador su cache de
 * textura:
 *
 *     let L=this.nd.get(z.Z);                     // z = jugador, L = su cache
 *     null==L&&(L=new Hb,this.nd.set(z.Z,L));
 *     L.A(z,a);                                   // ← acá se rearma la textura
 *
 * O sea que en un mismo lugar están los dos: quién sos y de quién es cada
 * textura. Este parche sólo los junta: anota tu jugador en el dibujante y le
 * cuelga a cada cache un `__tvmMine` antes de que se rearme. Nada más — no
 * cambia una sola decisión del juego.
 *
 * El `null` cuando no hay jugador local es a propósito y no es lo mismo que
 * `false`: en un replay o en la vista previa de una sala no hay «vos», y ahí el
 * cliente vuelve al criterio viejo del texto en vez de no pintar nada.
 */
const SELF_SITE = new RegExp([
  // <f>=<sala>.<ma>(<tuId>),<g>=null!=<f>?<f>.<disco>:null
  '(\\w+)\\s*=\\s*(\\w+)\\.(\\w+)\\(\\s*(\\w+)\\s*\\)\\s*,',
  '\\s*(\\w+)\\s*=\\s*null\\s*!=\\s*\\1\\s*\\?\\s*\\1\\.(\\w+)\\s*:\\s*null'
].join(''));

const TEXTURE_LOOP_SITE = new RegExp([
  // for(var <r>=0,<t>=<sala>.<K>;<r><<t>.length;){let <z>=<t>[<r>];++<r>;
  'for\\s*\\(\\s*var\\s+(\\w+)\\s*=\\s*0\\s*,\\s*(\\w+)\\s*=\\s*(\\w+)\\.(\\w+)\\s*;',
  '\\s*\\1\\s*<\\s*\\2\\.length\\s*;\\s*\\)\\s*\\{',
  '\\s*let\\s+(\\w+)\\s*=\\s*\\2\\[\\s*\\1\\s*\\]\\s*;\\s*\\+\\+\\s*\\1\\s*;',
  // if(null==<z>.<disco>)continue;
  '\\s*if\\s*\\(\\s*null\\s*==\\s*\\5\\.(\\w+)\\s*\\)\\s*continue\\s*;',
  // let <L>=this.<nd>.get(<z>.<Z>);null==<L>&&(<L>=new <Hb>,this.<nd>.set(<z>.<Z>,<L>));
  '\\s*let\\s+(\\w+)\\s*=\\s*this\\.(\\w+)\\.get\\(\\s*\\5\\.(\\w+)\\s*\\)\\s*;',
  '\\s*null\\s*==\\s*\\7\\s*&&\\s*\\(\\s*\\7\\s*=\\s*new\\s+(\\w+)\\s*,',
  '\\s*this\\.\\8\\.set\\(\\s*\\5\\.\\9\\s*,\\s*\\7\\s*\\)\\s*\\)\\s*;',
  // <L>.<A>(<z>,<sala>);
  '\\s*\\7\\.(\\w+)\\(\\s*\\5\\s*,\\s*\\3\\s*\\)\\s*;'
].join(''));

function patchSelf(source) {
  const yo = source.match(new RegExp(SELF_SITE.source, 'g')) || [];
  if (yo.length !== 1) {
    return { source, applied: false, reason: `el jugador local encajó ${yo.length} veces, se esperaba 1` };
  }
  const bucle = source.match(new RegExp(TEXTURE_LOOP_SITE.source, 'g')) || [];
  if (bucle.length !== 1) {
    /*
     * Los dos o ninguno. Con el jugador anotado pero sin marcar las texturas no
     * cambia nada, y al revés se marcarían todas como ajenas: la imagen del
     * avatar desaparecería para todo el mundo, que es peor que el bug.
     */
    return { source, applied: false, reason: `el bucle de texturas encajó ${bucle.length} veces, se esperaba 1` };
  }

  let campos = null;
  let out = source.replace(SELF_SITE, (full, f, sala, ma) => {
    campos = { ma };
    return full.replace(`${f}=${sala}.${ma}(`, `${f}=this.__tvmMe=${sala}.${ma}(`);
  });

  out = out.replace(TEXTURE_LOOP_SITE, (full, r, t, sala, K, z, disco, L, nd, Z, clase, A) => {
    campos.id = Z;
    campos.clase = clase;
    // Antes de `A()`, que es donde se rearma la textura: si se marcara después,
    // el aviso llegaría un cuadro tarde y siempre con la respuesta anterior.
    return full.replace(
      new RegExp(`${L}\\.${A}\\(\\s*${z}\\s*,\\s*${sala}\\s*\\)\\s*;$`),
      `${L}.__tvmMine=null!=this.__tvmMe?${z}===this.__tvmMe:null;${L}.${A}(${z},${sala});`
    );
  });

  return {
    source: out,
    applied: true,
    reason: `jugador local enganchado (buscador=${campos.ma} id=${campos.id} textura=${campos.clase})`
  };
}

/* ------------------------------------------------------------------ *
 * Parche: los sonidos propios, enganchados donde el juego suena
 * ------------------------------------------------------------------ *
 * HaxBall define sus dos avisos uno al lado del otro:
 *
 *   a.yi=function(){m.Ra.md(m.Ra.Kp)};              // patada
 *   a.cj=function(d){m.Ra.md(m.Ra.qp);let e=…};     // gol
 *
 * donde `md` es literalmente «armá un buffer y reproducilo»: no filtra, no
 * junta repeticiones, no mira ajustes. O sea que el juego suena UNA vez por
 * patada porque el motor lo llama una sola vez, y no porque haya nada que lo
 * cuide después.
 *
 * Por eso el sonido propio se engancha ACÁ y no envolviendo el callback de la
 * sala desde afuera: en este punto es imposible que suene de más, que de menos
 * o que suene cuando el juego no sonaría. Si HaxBall no canta la patada al
 * falsear, el sonido propio tampoco.
 *
 * El reemplazo es una condición delante de la reproducción: si el cliente
 * contesta que ya sonó lo suyo, el aviso de fábrica se saltea; si no, suena
 * como siempre. El resto de `cj` —el cartel del gol, el saque del medio— queda
 * intacto, que es la razón de tocar sólo la primera sentencia.
 *
 * ── Este es además el único lugar donde se ve la sala DE VERDAD ────────────
 *
 * Lo que se dibuja no es la sala: es una copia. En partida, el juego arma cada
 * cuadro con `hg()`, que clona el estado confirmado (`this.T.vc()`) y lo simula
 * hacia adelante hasta «ahora» para tapar el ping:
 *
 *   Rk(a,b){ if(0>=a) return this.T; …; let c = this.T.vc(); … c.A(1) …; return c }
 *
 * y esa copia se vuelve a simular desde el estado confirmado en CADA cuadro. El
 * minimapa —de donde sale `__tvmTick`— recibe la copia. Contar toques ahí tenía
 * tres agujeros: la misma patada se re-simulaba cuadro a cuadro y se anotaba
 * intercalada con otros toques; las patadas que la predicción inventaba (un
 * rival que «sigue apretando» patear) contaban como reales; y las que pasaban
 * entre dos cuadros dibujados sin que ninguna predicción las viera no se
 * anotaban nunca. Con los cuadros limitados o la pestaña atrás, casi ninguna.
 *
 * Estos dos avisos, en cambio, los instala `Gi(sala)` SOLO sobre la sala real
 * (`zd`, el clonador, no copia los enganches), así que cada uno corre una vez
 * por patada y por gol confirmados. Por eso acá se publican tres cosas:
 *
 *   · `__tvmRoom(sala)` al instalarse: la sala real, para colgarle el paso de
 *     física (`Ct`, que el motor llama al principio de cada cuadro simulado).
 *   · `__tvmKick(jugador, sala)`: quién pateó. `this` es la sala porque el motor
 *     lo llama como `this.Sa.yi(d)`.
 *   · `__tvmGoal(equipo, sala)`: el equipo que sumó (`cj(d.Dg)`).
 *
 * `arguments[0]` y no un parámetro con nombre: el cuerpo es nuestro pero el
 * alcance es del bundle, y cualquier nombre corto que inventemos puede tapar
 * una de sus clases (hay una que se llama `p`).
 */
const SOUND_SITE = new RegExp([
  // <a>.<patada>=function(){<snd>.<play>(<snd>.<bufPatada>)};
  '(\\w+)\\.(\\w+)\\s*=\\s*function\\(\\)\\s*\\{\\s*((?:\\w+\\.)+\\w+)\\.(\\w+)\\(\\s*\\3\\.(\\w+)\\s*\\)\\s*\\}\\s*;',
  // <a>.<gol>=function(<d>){<snd>.<play>(<snd>.<bufGol>);
  '\\s*\\1\\.(\\w+)\\s*=\\s*function\\(\\s*(\\w+)\\s*\\)\\s*\\{\\s*\\3\\.\\4\\(\\s*\\3\\.(\\w+)\\s*\\)\\s*;'
].join(''));

function patchSounds(source) {
  const matches = source.match(new RegExp(SOUND_SITE.source, 'g')) || [];
  if (matches.length !== 1) {
    return { source, applied: false, reason: `los avisos de sonido encajaron ${matches.length} veces, se esperaba 1` };
  }

  const out = source.replace(SOUND_SITE, (_full, a, patada, snd, play, bufPatada, gol, d, bufGol) => (
    `window.__tvmRoom&&window.__tvmRoom(${a});` +
    `${a}.${patada}=function(){if(!(window.__tvmKick&&window.__tvmKick(arguments[0],this)))${snd}.${play}(${snd}.${bufPatada})};` +
    `${a}.${gol}=function(${d}){if(!(window.__tvmGoal&&window.__tvmGoal(${d},this)))${snd}.${play}(${snd}.${bufGol});`
  ));

  return { source: out, applied: true, reason: 'sonidos de patada y gol enganchados (sala real)' };
}

/* ------------------------------------------------------------------ *
 * Parche: el código de la sala, se haya entrado como se haya entrado
 * ------------------------------------------------------------------ *
 * Dos clientes se reconocen en la lista porque le cuentan al sitio en qué sala
 * están, y el sitio los junta por esa huella. La huella salía del `?c=` de la
 * dirección — y HaxBall NUNCA escribe ese `?c=`: sólo está si se entró por un
 * link. El que entraba desde la lista de salas, o el que hosteaba, caía al
 * nombre de la sala. Para el sitio eran dos salas distintas, y por eso a varios
 * con el cliente no se les veía el escudo.
 *
 * El código sí pasa, siempre, por un solo lugar: el que arma el link de la sala.
 *
 *   static oi(a,b){ return ""+pa.location.origin+"/play?c="+a+(b?"&p=1":"") }
 *
 * Lo llama el invitado apenas se conecta (`r.Ng = B.oi(a, !1)`) y el host
 * apenas el servidor le asigna el código (`k.yg = function(t){ … B.oi(t, …) }`).
 * Se publica ese `a` sin tocar lo que devuelve.
 */
const ROOM_LINK_SITE =
  /static (\w+)\((\w+),(\w+)\)\{return\s*""\+(\w+)\.location\.origin\+"\/play\?c="\+\2\+\(\3\?"&p=1":""\)\}/;

function patchRoomLink(source) {
  const matches = source.match(new RegExp(ROOM_LINK_SITE.source, 'g')) || [];
  if (matches.length !== 1) {
    return { source, applied: false, reason: `el link de la sala encajó ${matches.length} veces, se esperaba 1` };
  }
  const out = source.replace(ROOM_LINK_SITE, (full, fn, id, pass) =>
    full.replace(`static ${fn}(${id},${pass}){`,
      // En un try: esto corre adentro de la conexión a la sala, y un error
      // nuestro no puede dejar a nadie sin entrar.
      `static ${fn}(${id},${pass}){try{window.__tvmRoomLink&&window.__tvmRoomLink(${id})}catch(_tvm){}`));
  return { source: out, applied: true, reason: 'código de la sala expuesto' };
}

/** Publica el objeto de ajustes en `window.__tvmSettings`. Ver arriba. */
function patchSettings(source) {
  const matches = source.match(new RegExp(SETTINGS_SITE.source, 'g')) || [];
  if (matches.length !== 1) {
    return { source, applied: false, reason: `el bloque de ajustes encajó ${matches.length} veces, se esperaba 1` };
  }
  return {
    source: source.replace(SETTINGS_SITE, (full) => `${full}window.__tvmSettings=this;`),
    applied: true,
    reason: 'ajustes del juego expuestos'
  };
}

/**
 * Publica el estado de la partida en cada cuadro. Ver MINIMAP_SITE.
 *
 * El radio y el nombre son opcionales: sin radio se usan los de fábrica, sin
 * nombre el gol se cuenta igual pero sin autor. Sin el minimapa no hay nada que
 * hacer y el parche no se aplica.
 */
function patchTracking(source) {
  const matches = source.match(new RegExp(MINIMAP_SITE.source, 'g')) || [];
  if (matches.length !== 1) {
    return { source, applied: false, reason: `el minimapa encajó ${matches.length} veces, se esperaba 1` };
  }

  let fields = null;
  const patched = source.replace(
    MINIMAP_SITE,
    (full, _fn, room, _w, _h, _d, game, world, discs, _dot, pos, color, players, _p, disc, team) => {
      fields = { game, world, discs, pos, color, players, disc, team };
      // El `{` es el que abre el cuerpo de la función: el sitio empieza en el
      // nombre del método, así que no hay ninguna llave antes.
      return full.replace('{', `{window.__tvmTick&&window.__tvmTick(${room});`);
    }
  );

  const radius = source.match(DISC_RADIUS_SITE);
  const name = source.match(PLAYER_NAME_SITE);
  const kick = source.match(KICK_SITE);
  if (radius) fields.radius = radius[3];
  if (name) fields.name = name[2];
  if (kick) fields.kick = kick[3];

  /*
   * El paso de física sólo se publica si es el MISMO método que la patada: los
   * dos tienen que leer la sala por el mismo campo, y la lista que recorre tiene
   * que ser la de jugadores que ya capturó el minimapa. Si no coinciden, el
   * preload sigue contando con la copia dibujada, como antes.
   */
  const steps = source.match(new RegExp(STEP_HOOK_SITE.source, 'g')) || [];
  const step = steps.length === 1 ? source.match(STEP_HOOK_SITE) : null;
  if (step && kick && step[2] === kick[2] && step[4] === fields.players) fields.step = step[3];

  const missing = [];
  if (!radius) missing.push('radio');
  if (!name) missing.push('nombre');
  // Sin esto el toque se estima por cercanía, que se equivoca bastante.
  if (!kick) missing.push('patada');
  if (!fields.step) missing.push('paso de física');

  return {
    source: patched,
    fields,
    applied: true,
    reason: `estado de la partida expuesto${missing.length ? ` (sin ${missing.join(' ni ')})` : ''}`
  };
}

/* ------------------------------------------------------------------ *
 * El nombre de la sala, sin depender de que esté a la vista
 * ------------------------------------------------------------------ *
 * Leerlo del DOM no alcanza, y ése era el motivo de que la sala apareciera sin
 * nombre hasta que el jugador apretaba Escape. La vista de sala no está
 * escondida mientras jugás: NO EXISTE. El menú la agrega y la saca:
 *
 *   xe(a){ this.od!=a && (this.od=a,
 *          this.f.classList.toggle("showing-room-view", this.od),
 *          this.od ? this.ws.appendChild(this.Xa.f) : this.Xa.f.remove()) }
 *
 * y arranca cerrada (`this.od=!1`), así que entrando a una sala no hay ningún
 * `.room-view` de dónde leer el título. Recién al abrir el menú aparecía, y con
 * él el nombre, la presencia y todo lo que cuelga de saber en qué sala estás.
 *
 * El dato en sí está siempre: vive en el objeto de la sala, que ya nos llega
 * cuadro a cuadro por `__tvmTick` (ver MINIMAP_SITE). Lo único que falta es
 * saber cómo se llama ese campo, y eso lo dice el método que pinta el título:
 *
 *   A(a,b){ this.Fr!=a.lc && (this.Fr=a.lc, this.lc.textContent=a.lc); … }
 *
 * El ancla es que el MISMO campo aparezca como dato y como elemento
 * (`this.<f>.textContent = <sala>.<f>`), que es una forma bastante particular
 * como para confundirse con otra cosa: encaja una sola vez en todo el bundle.
 */
const ROOM_NAME_SITE = new RegExp([
  // <A>(<room>,<b>){this.<cache>!=<room>.<f>&&
  '\\(\\s*(\\w+)\\s*,\\s*(\\w+)\\s*\\)\\s*\\{\\s*this\\.(\\w+)\\s*!=\\s*\\1\\.(\\w+)\\s*&&',
  // (this.<cache>=<room>.<f>,this.<f>.textContent=<room>.<f>)
  '\\s*\\(\\s*this\\.\\3\\s*=\\s*\\1\\.\\4\\s*,\\s*this\\.\\4\\.textContent\\s*=\\s*\\1\\.\\4\\s*\\)'
].join('\\s*'));

/* ------------------------------------------------------------------ *
 * Dónde termina la cancha
 * ------------------------------------------------------------------ *
 * Para pintar el campo de un color y el afuera de otro —o para rayar el césped
 * sin que las rayas se derramen por todos lados— hay que saber dónde está el
 * borde. Está en el objeto del estadio, y el dibujo del fondo dice cuál es cuál:
 *
 *   Dr(a){ …
 *     var b=a.ce; let c=a.be, d=this;               // semi-ancho y semi-alto
 *     if(1==a.ud)                                    // 1 = césped, 2 = hockey
 *       …this.c.fillStyle=T.nc(a.td);                // color de AFUERA
 *        this.c.fillRect(0,0,this.oa.width,this.oa.height);
 *        …this.vm(this.c,-b,-c,2*b,2*c,a.Gc);        // el campo, con esquinas
 *        …this.c.arc(0,0,a.bd,…)                     // el círculo del medio
 *
 * O sea que el campo es el rectángulo (-ce,-be)…(ce,be) en coordenadas de
 * cancha, las mismas que usa el motor. El ancla es toda esa secuencia junta —dos
 * medidas, el tipo de fondo, el relleno del afuera, el rectángulo dibujado con
 * las dos medidas negadas y duplicadas, y el círculo centrado—, que encaja una
 * sola vez en el bundle.
 */
const PITCH_SITE = new RegExp([
  // var <b>=<st>.<halfW>;let <c>=<st>.<halfH>,<d>=this;
  'var\\s+(\\w+)\\s*=\\s*(\\w+)\\.(\\w+)\\s*;\\s*let\\s+(\\w+)\\s*=\\s*\\2\\.(\\w+)\\s*,\\s*(\\w+)\\s*=\\s*this\\s*;',
  // if(1==<st>.<bgType>)
  '\\s*if\\s*\\(\\s*1\\s*==\\s*\\2\\.(\\w+)\\s*\\)',
  // …this.c.fillStyle=<T>.<nc>(<st>.<outside>)…
  '[\\s\\S]{0,200}?this\\.c\\.fillStyle\\s*=\\s*\\w+\\.\\w+\\(\\s*\\2\\.(\\w+)\\s*\\)',
  // …this.<roundRect>(this.c,-<b>,-<c>,2*<b>,2*<c>,<st>.<corner>)…
  '[\\s\\S]{0,400}?this\\.(\\w+)\\(\\s*this\\.c\\s*,\\s*-\\s*\\1\\s*,\\s*-\\s*\\4\\s*,\\s*2\\s*\\*\\s*\\1\\s*,\\s*2\\s*\\*\\s*\\4\\s*,\\s*\\2\\.(\\w+)\\s*\\)',
  // …this.c.arc(0,0,<st>.<circle>,…
  '[\\s\\S]{0,400}?this\\.c\\.arc\\(\\s*0\\s*,\\s*0\\s*,\\s*\\2\\.(\\w+)\\s*,'
].join(''));

/**
 * Publica las medidas de la cancha. No cambia una línea del bundle: sólo mira.
 * Ver PITCH_SITE.
 */
function patchPitchBounds(source) {
  const matches = source.match(new RegExp(PITCH_SITE.source, 'g')) || [];
  if (matches.length !== 1) {
    return { source, applied: false, reason: `el fondo de la cancha encajó ${matches.length} veces, se esperaba 1` };
  }
  const m = source.match(PITCH_SITE);
  return {
    source,
    fields: { pitch: { halfW: m[3], halfH: m[5], bgType: m[7], outside: m[8], corner: m[10], circle: m[11] } },
    applied: true,
    reason: `medidas de la cancha expuestas (ancho=${m[3]} alto=${m[5]})`
  };
}

/**
 * Publica en qué campo del objeto de la sala vive su nombre. No cambia una sola
 * línea del bundle: sólo mira. Ver ROOM_NAME_SITE.
 */
function patchRoomName(source) {
  const matches = source.match(new RegExp(ROOM_NAME_SITE.source, 'g')) || [];
  if (matches.length !== 1) {
    return { source, applied: false, reason: `el título de la sala encajó ${matches.length} veces, se esperaba 1` };
  }
  const m = source.match(ROOM_NAME_SITE);
  return { source, fields: { roomName: m[4] }, applied: true, reason: 'nombre de la sala expuesto' };
}

/**
 * Publica los nombres de los campos del reproductor. No cambia una sola línea
 * del bundle: sólo mira. Ver REPLAY_STEP_SITE.
 */
function patchReplayScan(source) {
  const matches = source.match(new RegExp(REPLAY_STEP_SITE.source, 'g')) || [];
  if (matches.length !== 1) {
    return { source, applied: false, reason: `el avance del reproductor encajó ${matches.length} veces, se esperaba 1` };
  }

  const m = source.match(REPLAY_STEP_SITE);
  const replay = {
    last: m[3],
    seek: m[4],
    clock: m[5],
    speed: m[6],
    total: m[7],
    msPerFrame: m[8],
    framesPerMs: m[9],
    interp: m[10],
    frame: m[11],
    next: m[12],
    nextFrame: m[13],
    room: m[14],
    read: m[16],
    step: m[17]
  };

  // Sin el "volver al principio" no hay análisis posible: se empieza por ahí.
  const rewind = source.match(rewindSite(replay));
  if (!rewind) {
    return { source, applied: false, reason: 'no se encontró el rebobinado del reproductor' };
  }
  replay.rewind = rewind[1];

  return {
    source,
    fields: { replay },
    applied: true,
    reason: `reproductor analizable (cuadro=${replay.frame} sala=${replay.room})`
  };
}

/** Publica dónde vive el marcador de la partida. Ver SCORE_SITE. */
function patchScore(source) {
  const view = source.match(SCORE_SITE);
  const fields = source.match(SCORE_FIELDS_SITE);
  if (!view || !fields) {
    return { source, applied: false, reason: 'no se encontró el marcador de la partida' };
  }

  const [, redSetter, , , blueSetter] = view;
  const [, , , game, , , , time, setterA, fieldA, setterB, fieldB] = fields;

  // Cuál de los dos marcadores es el rojo lo dice el HTML, no el orden.
  let red = null;
  let blue = null;
  for (const [setter, field] of [[setterA, fieldA], [setterB, fieldB]]) {
    if (setter === redSetter) red = field;
    if (setter === blueSetter) blue = field;
  }
  if (!red || !blue) {
    return { source, applied: false, reason: 'no se pudo distinguir el marcador rojo del azul' };
  }

  return {
    source,
    fields: { score: { game, red, blue, time } },
    applied: true,
    reason: `marcador expuesto (rojo=${red} azul=${blue})`
  };
}

/** Agranda la lista de velocidades del reproductor y publica el control. */
function patchReplaySpeed(source) {
  const list = source.match(new RegExp(SPEED_LIST_SITE.source, 'g')) || [];
  const apply = source.match(new RegExp(SPEED_APPLY_SITE.source, 'g')) || [];
  if (list.length !== 1 || apply.length !== 1) {
    return {
      source,
      applied: false,
      reason: `el reproductor encajó ${list.length}/${apply.length} veces, se esperaba 1/1`
    };
  }

  const normal = SPEEDS.indexOf(1);
  let out = source.replace(
    SPEED_LIST_SITE,
    (_full, playing, index, array) => `${playing}=!0,${index}=${normal},${array}=[${SPEEDS.join(',')}]`
  );

  out = out.replace(
    SPEED_APPLY_SITE,
    (_full, fn, value, array, index, player, speed, playing, controls) =>
      `function ${fn}(){` +
      `let ${value}=${array}[${index}];` +
      `${player}.${speed}=${playing}?${value}:0;` +
      `${controls}.get("spd").textContent=${value}+"x";` +
      // El control se republica en cada cambio de velocidad: así `speed` y
      // `playing` siempre reflejan lo que el reproductor tiene puesto ahora.
      // `player` es el reproductor mismo: de acá lo saca el análisis de la
      // grabación entera (ver REPLAY_STEP_SITE).
      `try{window.__tvmReplay={speed:${value},playing:${playing},player:${player},speeds:${array}.slice(),` +
      `set:function(s){var i=${array}.indexOf(s);` +
      `if(0>i){${array}.push(s);${array}.sort(function(x,y){return x-y});i=${array}.indexOf(s)}` +
      `${index}=i;${fn}()}}}catch(err){}` +
      `}`
  );

  return { source: out, applied: true, reason: `velocidades de replay ${SPEEDS[0]}x–${SPEEDS[SPEEDS.length - 1]}x` };
}

/* ------------------------------------------------------------------ *
 * Parche 8: el modo espejo
 * ------------------------------------------------------------------ *
 * Lo que se pide: elegir un lado —rojo o azul— y verse SIEMPRE de ese lado,
 * toque el equipo que toque. Cuando te toca el de enfrente, la cancha entera se
 * da vuelta y vos volvés a estar donde siempre estás.
 *
 * El vuelco en sí no se hace acá y es una línea. La transformación de mundo que
 * arma el juego antes de dibujar (ver CALL_SITE) manda el punto a
 *
 *     x = centro + zoom * (mundo.x - cámara.x)
 *
 * y espejar es cambiarle el signo a esa multiplicación. Eso lo hace el PRELUDE,
 * una vez por cuadro, y arrastra TODO lo que se dibuja después: la cancha, los
 * arcos, los discos, la pelota y los adornos del cliente. Ni uno de esos
 * dibujos hay que tocar.
 *
 * El trabajo de verdad son las tres cosas que no se pueden dar vuelta:
 *
 *  1. Las teclas. Con la vista espejada y el teclado intacto, apretás derecha y
 *     te ves ir a la izquierda. El modo sería injugable.
 *
 *  2. El nombre que va arriba de cada jugador. Se dibuja en coordenadas de
 *     cancha, así que el espejo lo da vuelta y queda ilegible.
 *
 *  3. El texto del avatar adentro del disco, por lo mismo.
 *
 * Los tres se resuelven acá y en un solo paso a propósito. Los dos primeros son
 * obligatorios —sin ellos el modo no se puede usar—, así que si alguno no
 * encaja el parche no se aplica y el cliente ni siquiera ofrece prender el
 * espejo: `fields.mirror` es lo que le da permiso. El tercero es cosmético y se
 * saltea solo.
 */

/**
 * 1. Las teclas.
 *
 *   A(){ let a=0;
 *        this.Qc.has("Up")&&(a=1); … this.Qc.has("Kick")&&(a|=16);
 *        if(null!=this.Bg&&a!=this.ng){this.ng=a;let b=new Ja;b.input=a;this.Bg(b)} }
 *
 * `Qc` son las acciones apretadas y `a` el número que las junta: 1 arriba, 2
 * abajo, 4 izquierda, 8 derecha, 16 patada.
 *
 * El swap va JUSTO ANTES del `if`, y ese lugar no es negociable: `b.input` es a
 * la vez lo que sale para el servidor y lo que corre tu propia simulación, así
 * que cambiándolo acá las dos ven exactamente el mismo número y no hay forma de
 * que se desincronicen. Hacerlo un renglón más abajo —o del lado de la red—
 * sería justamente el bug.
 *
 * El anclaje son los cinco nombres de acción. Son identificadores y no
 * etiquetas: el propio game-i18n.js se cuida de NO traducirlos (ver el aviso
 * junto a la tabla de controles), y no pueden cambiar sin romperle los
 * controles guardados a todo el mundo. Y por anclar en las ACCIONES y no en las
 * teclas, el swap sale bien con cualquier mapeo —flechas, WASD o el que tenga
 * puesto—, que es lo que no se podía conseguir mirando `event.code`.
 *
 * `__tvmInputSync` es el objeto mismo. Hace falta porque el juego sólo manda el
 * input cuando CAMBIA (`a!=this.ng`): si el espejo se da vuelta con una tecla
 * apretada, sin volver a llamar a este método el jugador sigue yendo para el
 * lado de antes hasta que suelte y apriete de nuevo.
 */
const MIRROR_INPUT_SITE = new RegExp([
  // <A>(){let <a>=0;
  '([\\w$]+)\\(\\s*\\)\\s*\\{\\s*let\\s+([\\w$]+)\\s*=\\s*0\\s*;',
  // this.<set>.has("Up")&&(<a>=1);
  '\\s*this\\.([\\w$]+)\\.has\\(\\s*"Up"\\s*\\)\\s*&&\\s*\\(\\s*\\2\\s*=\\s*1\\s*\\)\\s*;',
  '\\s*this\\.\\3\\.has\\(\\s*"Down"\\s*\\)\\s*&&\\s*\\(\\s*\\2\\s*\\|=\\s*2\\s*\\)\\s*;',
  '\\s*this\\.\\3\\.has\\(\\s*"Left"\\s*\\)\\s*&&\\s*\\(\\s*\\2\\s*\\|=\\s*4\\s*\\)\\s*;',
  '\\s*this\\.\\3\\.has\\(\\s*"Right"\\s*\\)\\s*&&\\s*\\(\\s*\\2\\s*\\|=\\s*8\\s*\\)\\s*;',
  '\\s*this\\.\\3\\.has\\(\\s*"Kick"\\s*\\)\\s*&&\\s*\\(\\s*\\2\\s*\\|=\\s*16\\s*\\)\\s*;',
  // if(null!=this.<cb>&&<a>!=this.<last>)
  '\\s*if\\s*\\(\\s*null\\s*!=\\s*this\\.([\\w$]+)\\s*&&\\s*\\2\\s*!=\\s*this\\.([\\w$]+)\\s*\\)'
].join(''));

/**
 * 2 y 3 en uno: lo que va pegado a cada jugador.
 *
 *   yr(a,b){ … let g=this.nd.get(f.Z);
 *            c&&g.mg&&this.c.drawImage(m.dn,e.x-.5*m.dn.width,e.y-35);  // «escribiendo»
 *            f!=b&&g.$o(this.c,e.x,e.y+50) }                            // el nombre
 *
 * Los dos son imágenes centradas en el jugador, así que los dos se arreglan con
 * la misma vuelta: espejarlos otra vez, alrededor del jugador. `translate(2x)`
 * más `scale(-1,1)` manda el punto p a 2x-p, o sea que lo que está sobre `x` se
 * queda donde está y lo de al lado cambia de mano; con el espejo de afuera
 * puesto, las dos vueltas se cancelan y el cartel sale derecho y en su lugar.
 *
 * Se envuelve la LLAMADA a `$o` y no su cuerpo. Adentro, el nombre se copia de
 * una textura con seis números pegados (`0,0,160,34,b-40,c-34,80,17`) que son
 * el tamaño del cartel; anclar ahí sería anclar en eso. Desde afuera alcanza
 * con saber que dibuja centrado en el jugador, que es lo que se ve.
 *
 * El camino sin espejo queda escrito aparte y textualmente igual al original:
 * esto corre por jugador y por cuadro, y con el espejo apagado —que es casi
 * siempre— no se paga ni un `save()` de más.
 */
const MIRROR_TAG_SITE = new RegExp([
  // <c>&&<g>.<mg>&&this.c.drawImage(<icono>,<e>.x-.5*<icono>.width,<e>.y-<arriba>);
  '([\\w$]+)\\s*&&\\s*([\\w$]+)\\.([\\w$]+)\\s*&&\\s*this\\.c\\.drawImage\\(\\s*((?:[\\w$]+\\.)+[\\w$]+)\\s*,',
  '\\s*([\\w$]+)\\.x\\s*-\\s*\\.5\\s*\\*\\s*\\4\\.width\\s*,\\s*\\5\\.y\\s*-\\s*(\\d+)\\s*\\)\\s*;',
  // <f>!=<yo>&&<g>.<tag>(this.c,<e>.x,<e>.y+<abajo>)
  '\\s*([\\w$]+)\\s*!=\\s*([\\w$]+)\\s*&&\\s*\\2\\.([\\w$]+)\\(\\s*this\\.c\\s*,\\s*\\5\\.x\\s*,\\s*\\5\\.y\\s*\\+\\s*(\\d+)\\s*\\)'
].join(''));

/**
 * 3. El texto del avatar, adentro del disco.
 *
 *   null!=b?(this.c.save(),b=a.V/32,this.c.translate(a.a.x,a.a.y),
 *            this.c.scale(b,b),this.c.translate(-32,-32),this.c.fill(),this.c.restore())
 *
 * Esa transformación no mueve el disco: el círculo ya está armado desde el
 * `arc()` de más arriba y un `path` no se entera de lo que pase después. Lo que
 * ubica es el PATRÓN con el que se rellena, o sea la textura de 64×64 donde
 * están las franjas del equipo y el texto del avatar.
 *
 * Así que un `scale(-1,1)` metido entre la escala y el `translate(-32,-32)` da
 * vuelta la textura sola, alrededor del centro del disco, y con el espejo de
 * afuera el avatar vuelve a leerse. Las franjas del equipo son simétricas: no
 * se nota que estén al revés porque no lo están.
 *
 * Éste es el opcional. Si no encaja, el modo espejo anda igual y lo único que
 * queda dado vuelta son las dos letras del avatar.
 */
const MIRROR_DISC_SITE = new RegExp([
  // this.c.translate(<a>.<pos>.x,<a>.<pos>.y),this.c.scale(<b>,<b>),this.c.translate(-32,-32)
  'this\\.c\\.translate\\(\\s*([\\w$]+)\\.([\\w$]+)\\.x\\s*,\\s*\\1\\.\\2\\.y\\s*\\)\\s*,',
  '\\s*this\\.c\\.scale\\(\\s*([\\w$]+)\\s*,\\s*\\3\\s*\\)\\s*,',
  '\\s*this\\.c\\.translate\\(\\s*-\\s*32\\s*,\\s*-\\s*32\\s*\\)'
].join(''));

/**
 * Los tres juntos. Publica `fields.mirror`, que es lo que el preload mira para
 * saber si tiene permitido prender el espejo: sin esto el cliente no ofrece el
 * modo, así que una actualización de HaxBall que rompa el anclaje del teclado
 * apaga la función entera en vez de dejar la vista dada vuelta y los controles
 * al revés.
 */
function patchMirror(source) {
  const teclas = source.match(new RegExp(MIRROR_INPUT_SITE.source, 'g')) || [];
  if (teclas.length !== 1) {
    return { source, applied: false, reason: `el input del teclado encajó ${teclas.length} veces, se esperaba 1` };
  }
  const carteles = source.match(new RegExp(MIRROR_TAG_SITE.source, 'g')) || [];
  if (carteles.length !== 1) {
    return { source, applied: false, reason: `los nombres sobre los jugadores encajaron ${carteles.length} veces, se esperaba 1` };
  }

  let metodo = null;
  let out = source.replace(MIRROR_INPUT_SITE, (full, apply, a) => {
    metodo = apply;
    return full
      // La primera llave del sitio es la que abre el cuerpo del método: el
      // patrón arranca en su nombre, así que no hay ninguna antes.
      .replace('{', '{window.__tvmInputSync=this;')
      .replace(
        /if\s*\(\s*null\s*!=\s*this\./,
        `window.__tvmMirror&&(${a}=(${a}&~12)|((${a}&4)<<1)|((${a}&8)>>1));if(null!=this.`
      );
  });

  out = out.replace(MIRROR_TAG_SITE, (_full, c, g, mg, icono, e, arriba, f, yo, tag, abajo) => {
    const vuelta = `this.c.save(),this.c.translate(2*${e}.x,0),this.c.scale(-1,1)`;
    const icon = `this.c.drawImage(${icono},${e}.x-.5*${icono}.width,${e}.y-${arriba})`;
    const nombre = `${g}.${tag}(this.c,${e}.x,${e}.y+${abajo})`;
    return (
      `${c}&&${g}.${mg}&&(window.__tvmMirror?(${vuelta},${icon},this.c.restore()):${icon});` +
      `${f}!=${yo}&&(window.__tvmMirror?(${vuelta},${nombre},this.c.restore()):${nombre})`
    );
  });

  const discos = out.match(new RegExp(MIRROR_DISC_SITE.source, 'g')) || [];
  const avatar = discos.length === 1;
  if (avatar) {
    out = out.replace(MIRROR_DISC_SITE, (full) =>
      full.replace(/(this\.c\.scale\(\s*[\w$]+\s*,\s*[\w$]+\s*\)\s*,)/, '$1window.__tvmMirror&&this.c.scale(-1,1),')
    );
  }

  return {
    source: out,
    fields: { mirror: { input: metodo, avatar } },
    applied: true,
    reason: `modo espejo listo (input=${metodo}${avatar ? '' : ', sin el avatar del disco'})`
  };
}

/**
 * Aplica los parches. Nunca tira: cada uno se aplica por su cuenta y el que no
 * encaja se saltea, así una actualización de HaxBall que rompa uno no se lleva
 * puesto al otro.
 *
 * @param {string} source el `game-min.js` tal como lo sirve HaxBall
 * @param {{lang?: string}} [opts] idioma al que traducir el juego (ver game-i18n.js)
 * @returns {{source: string, applied: boolean, reason: string}}
 */
// Change the world scale before camera bounds are calculated. The canvas backing
// resolution and devicePixelRatio stay native. Stadium maxViewWidth still applies.
const CAMERA_ZOOM_SITE = /(\b\w+=)(0!=this\.(\w+)\?this\.\w+\.height\/this\.\3:this\.\w+\*window\.devicePixelRatio\*this\.\w+)(;)/g;
function patchCameraZoom(source) {
  const matches = [...source.matchAll(CAMERA_ZOOM_SITE)];
  if (matches.length !== 1) return { source, applied: false, reason: 'zoom de cámara: anclaje no compatible' };
  const out = source.replace(CAMERA_ZOOM_SITE, (_all, lhs, expression, _field, end) =>
    `${lhs}(${expression})*(Math.max(.25,Math.min(3,Number(window.__tvmCameraZoom)||1)))${end}`);
  return { source: out, applied: true, fields: { cameraZoom: true }, reason: 'zoom de cámara nítido' };
}

function patch(source, opts) {
  if (typeof source !== 'string' || source.length < 1000) {
    return { source, applied: false, reason: 'fuente vacía o demasiado corta' };
  }
  if (source.includes('__tvmStadium') || source.includes('__tvmSettings') || source.includes('__tvmF')) {
    return { source, applied: false, reason: 'ya estaba parcheado' };
  }

  const done = [];
  const failed = [];
  const fields = {};
  let out = source;

  for (const step of [patchCameraZoom, patchSettings, patchStadium, patchTracking, patchRoomName, patchPitchBounds, patchReplaySpeed, patchReplayScan, patchScore, patchSelf, patchAvatar, patchBall, patchMirror, patchSounds, patchRoomLink]) {
    const res = step(out);
    out = res.source;
    if (res.fields) Object.assign(fields, res.fields);
    (res.applied ? done : failed).push(res.reason);
  }

  if (!done.length) return { source, applied: false, reason: failed.join('; ') };

  /*
   * La traducción va ÚLTIMA, y no es un detalle de estilo.
   *
   * Varios de los parches de arriba se anclan al texto en inglés del propio
   * juego para capturar nombres minificados — el más claro es
   * `PLAYER_NAME_SITE`, que encuentra el campo del nombre del jugador
   * buscando `""+d.D+" has joined"`. Si se tradujera antes, ese ancla no
   * existiría y el parche se caería solo, en silencio.
   */
  const lang = opts && opts.lang;
  if (lang && i18n.has(lang)) {
    const res = i18n.translate(out, lang);
    out = res.source;
    (res.applied ? done : failed).push(res.reason);
  }

  // Los nombres capturados van todos juntos y al principio del archivo: los pasos
  // que los publican son varios, y el preload quiere un solo lugar donde mirar.
  if (Object.keys(fields).length) out = `;window.__tvmF=${JSON.stringify(fields)};\n${out}`;

  return {
    source: out,
    applied: true,
    reason: done.join(' · ') + (failed.length ? ` (sin aplicar: ${failed.join('; ')})` : '')
  };
}

/* ------------------------------------------------------------------ *
 * Cache en disco
 * ------------------------------------------------------------------ *
 * Sin esto el parche no se aplicaría nunca en uso normal: el juego carga una
 * sola vez por sesión, y la primera vez es justamente la que se deja pasar sin
 * tocar. Guardándolo, la próxima vez que se abre el cliente ya está listo
 * antes de que el juego lo pida.
 *
 * La clave es la URL entera, que lleva el hash de despliegue de HaxBall. Si el
 * juego se actualiza, la clave no coincide, esa vez va sin parche y se guarda
 * la nueva. Se limpia solo.
 * ------------------------------------------------------------------ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Cuántas copias del bundle se guardan antes de borrar las viejas.
 *
 * Son cuatro y no tres desde que hay idiomas: cada actualización de HaxBall
 * deja una copia por idioma que se haya usado, y con tres entraba justo como
 * para que cambiar de idioma dos veces te borrara la del juego actual.
 */
const KEEP = 4;

/**
 * Versión de LO QUE PARCHEAMOS, no del bundle.
 *
 * Sin esto, al agregar un parche nuevo los clientes ya instalados seguirían
 * sirviendo para siempre la copia guardada con los parches viejos: la clave del
 * cache es la URL de HaxBall, que no cambia porque nosotros cambiemos de idea.
 * Subir este número descarta lo guardado y se vuelve a parchear una vez.
 *
 * **La tabla de `game-i18n.js` cuenta.** Agregar o corregir una traducción es
 * cambiar lo que parcheamos, y sin subir esto el jugador se queda con la copia
 * de antes hasta que HaxBall actualice — que puede ser nunca.
 */
/*
 * 13: los sonidos de patada y de gol se enganchan en el bundle, donde el juego
 *     los reproduce, en vez de envolver el callback de la sala desde afuera.
 * 14: el PRELUDE llama a `window.__tvmPaint` después de poner la cancha y antes
 *     de los discos, que es donde el cliente dibuja el aro propio, los aros de
 *     equipo y la estela de la pelota.
 * 15: el PRELUDE consulta `window.__tvmCam` y suma ese desvío a la cámara, que
 *     es lo que hace posible la cámara libre de los replays.
 * 16: el pincel se llama en TODOS los caminos del PRELUDE. Antes, apagar el
 *     cache del estadio apagaba también el aro, la estela y el mapa — dos cosas
 *     independientes que estaban atadas por accidente.
 * 17: `__tvmCam` recibe la cámara, el zoom y el canvas del cuadro, que es lo que
 *     hace falta para centrar la vista en un jugador y para saber a qué punto
 *     de la cancha le hiciste clic.
 * 22: los avisos de patada y gol pasan el jugador, el equipo y la sala real, y
 *     `__tvmRoom` publica esa sala: los toques se cuentan sobre la simulación
 *     confirmada y no sobre la copia extrapolada que se dibuja (ver SOUND_SITE).
 * 23: `__tvmRoomLink` publica el código de la sala al entrar o al hostear, así
 *     los clientes se reconocen aunque hayan entrado desde la lista de salas.
 */
const PATCH_VERSION = 23;

/** El idioma es parte de la clave: el mismo bundle parchea distinto en cada uno. */
function keyOf(url, lang) {
  return crypto.createHash('sha1').update(`${url}\n${lang || ''}`).digest('hex').slice(0, 16);
}

/** Un `lang` ausente (copias viejas) cuenta como «sin traducir». */
function normLang(lang) {
  return typeof lang === 'string' && lang ? lang : '';
}

/**
 * Lee lo guardado PARA ESTE IDIOMA. Devuelve un Map de URL original → texto
 * parcheado.
 *
 * Filtrar por idioma es lo que hace que cambiar de idioma no sirva una copia
 * en el idioma anterior. Lo que se pierde es una sola carga del juego: ver
 * `relangCache`, que justamente está para que ni eso.
 */
function loadCache(dir, lang) {
  const want = normLang(lang);
  const out = new Map();
  for (const { raw } of readAll(dir)) {
    if (normLang(raw.lang) !== want) continue;
    out.set(raw.url, raw.source);
  }
  return out;
}

/**
 * Lee y valida todas las entradas del cache.
 *
 * `source` tiene que estar parcheado de verdad y por ESTA versión: si se guardó
 * a medias, o con los parches de antes, servirlo sería peor que no tener nada.
 */
function readAll(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (raw && raw.v === PATCH_VERSION && typeof raw.url === 'string' && typeof raw.source === 'string' &&
          (raw.source.includes('__tvmStadium') || raw.source.includes('__tvmSettings'))) {
        out.push({ name, raw });
      }
    } catch {
      /* archivo corrupto: se ignora, se regenera solo */
    }
  }
  return out;
}

/**
 * Rearma las copias que hagan falta cuando el jugador cambió de idioma.
 *
 * Sin esto, cambiar el idioma costaba DOS arranques: en el primero no hay copia
 * para el idioma nuevo, así que el juego carga sin parchear y recién ahí se
 * baja y se prepara la buena. Como cada entrada guarda también el `original`
 * —el `game-min.js` crudo, tal como lo sirve HaxBall—, acá se vuelve a parchear
 * desde el disco, sin red y antes de que el juego pida nada.
 *
 * Devuelve cuántas copias nuevas se generaron.
 */
function relangCache(dir, lang) {
  const want = normLang(lang);
  const entries = readAll(dir);
  const have = new Set(entries.filter((e) => normLang(e.raw.lang) === want).map((e) => e.raw.url));

  let made = 0;
  for (const { raw } of entries) {
    if (have.has(raw.url) || typeof raw.original !== 'string') continue;
    const out = patch(raw.original, { lang: want });
    if (!out.applied) continue;
    if (saveCache(dir, raw.url, out.source, want, raw.original)) {
      have.add(raw.url);
      made++;
    }
  }
  return made;
}

/**
 * Guarda la copia parcheada y, al lado, el original del que salió.
 *
 * El original ocupa otros ~170 KB y paga solos: es lo único que permite
 * rearmar el bundle para otro idioma sin volver a bajarlo (`relangCache`).
 */
function saveCache(dir, url, source, lang, original) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${keyOf(url, lang)}.json`);
    const tmp = `${file}.tmp`;
    const entry = { v: PATCH_VERSION, url, lang: normLang(lang), source, at: Date.now() };
    if (typeof original === 'string') entry.original = original;
    fs.writeFileSync(tmp, JSON.stringify(entry), 'utf8');
    fs.renameSync(tmp, file);
    prune(dir);
    return true;
  } catch {
    return false;
  }
}

/** Deja sólo las `KEEP` más nuevas: cada actualización de HaxBall deja una. */
function prune(dir) {
  try {
    const files = fs.readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { n } of files.slice(KEEP)) {
      try { fs.unlinkSync(path.join(dir, n)); } catch {}
    }
  } catch {}
}

module.exports = {
  patch,
  loadCache,
  saveCache,
  relangCache,
  CALL_SITE,
  SETTINGS_SITE,
  MINIMAP_SITE,
  DISC_RADIUS_SITE,
  PLAYER_NAME_SITE,
  KICK_SITE,
  STEP_HOOK_SITE,
  SOUND_SITE,
  ROOM_LINK_SITE,
  SPEED_LIST_SITE,
  SPEED_APPLY_SITE,
  REPLAY_STEP_SITE,
  SCORE_SITE,
  SCORE_FIELDS_SITE,
  MIRROR_INPUT_SITE,
  MIRROR_TAG_SITE,
  MIRROR_DISC_SITE,
  SPEEDS,
  PRELUDE,
  PATCH_VERSION
};
