/*
 * Festejo de gol del club.
 *
 * Dos versiones, las dos con los colores del club (azul noche, oro y crema):
 *
 *   · `club`  — cuando mete alguien del plantel que usa la app. Escudo, «GOL»
 *               con un brillo que lo recorre, el nombre con filetes dorados,
 *               ondas de oro, un abanico de chispas y cintas que caen.
 *   · `lite`  — cuando mete cualquier otro. Una sola onda y un cartel corto.
 *
 * Todo es DOM con animaciones CSS de `transform` y `opacity`: las compone la
 * GPU, así que no corre JavaScript por cuadro y no cuesta FPS. El único trabajo
 * de JS es armar los elementos y sacarlos al terminar.
 */
(function (root) {
  'use strict';

  var STYLE_ID = 'tvm-cg-style';
  var BOX_ID = 'tvm-cg';
  var STREAK = ['DOBLETE', 'TRIPLETE', 'PÓKER', 'MANITA'];
  var FONT = '"Bahnschrift","Segoe UI Black","Segoe UI",system-ui,-apple-system,sans-serif';
  var GOLD = ['#f4f0df', '#e9d49a', '#d0b878', '#8a6f3a'];
  var CONF = ['#e9d49a', '#f4f0df', '#d0b878', '#3a5a9a', '#e9d49a'];

  var CSS = [
    '#tvm-cg{position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;font-family:' + FONT + ';contain:layout paint style}',
    '#tvm-cg *{box-sizing:border-box}',
    /* bordes: azul noche hacia afuera y un halo dorado en el filo */
    '.cg-vig{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,rgba(19,36,63,0) 40%,rgba(19,36,63,.58) 100%),radial-gradient(ellipse at center,rgba(208,184,120,0) 60%,rgba(208,184,120,.26) 100%);animation:cgVig 3.1s ease both;will-change:opacity}',
    '.cg-vig.lite{animation-duration:2s;filter:none;opacity:0}',
    '@keyframes cgVig{0%{opacity:0}12%{opacity:1}68%{opacity:.85}100%{opacity:0}}',
    /* destello inicial, rayos de luz y barras al costado del GOL */
    '.cg-flash{position:absolute;inset:0;opacity:0;background:radial-gradient(circle at 50% 46%,rgba(244,240,223,.85),rgba(233,212,154,.35) 28%,rgba(233,212,154,0) 60%);animation:cgFlash .7s ease-out both;will-change:opacity}',
    '@keyframes cgFlash{0%{opacity:0}12%{opacity:1}100%{opacity:0}}',
    '.cg-rays{position:absolute;left:50%;top:46%;width:80vmax;height:80vmax;margin:-40vmax 0 0 -40vmax;opacity:0;background:repeating-conic-gradient(from 0deg,rgba(233,212,154,.14) 0 5deg,rgba(233,212,154,0) 5deg 15deg);-webkit-mask-image:radial-gradient(circle,#000 0,rgba(0,0,0,.45) 16%,transparent 47%);mask-image:radial-gradient(circle,#000 0,rgba(0,0,0,.45) 16%,transparent 47%);animation:cgRays 3.1s ease both;will-change:transform,opacity}',
    '@keyframes cgRays{0%{opacity:0;transform:rotate(0) scale(.6)}15%{opacity:1}80%{opacity:.8}100%{opacity:0;transform:rotate(40deg) scale(1.15)}}',
    '.cg-bar{position:absolute;top:calc(36% + 8.2vmin);height:.55vmin;width:30vw;opacity:0;background:linear-gradient(90deg,transparent,#e9d49a 55%,#f4f0df);box-shadow:0 0 2vmin rgba(233,212,154,.8);animation:cgBar 3s cubic-bezier(.2,.8,.2,1) .15s both;will-change:transform,opacity;transform-origin:right center;right:calc(50% + 24vmin)}',
    '.cg-bar.r{right:auto;left:calc(50% + 24vmin);transform-origin:left center;background:linear-gradient(270deg,transparent,#e9d49a 55%,#f4f0df)}',
    '@keyframes cgBar{0%{opacity:0;transform:scaleX(0)}18%{opacity:1;transform:scaleX(1)}80%{opacity:.9;transform:scaleX(1)}100%{opacity:0;transform:scaleX(1)}}',
    /* marco dorado en los bordes */
    '.cg-frame{position:absolute;inset:0;opacity:0;box-shadow:inset 0 0 0 .35vmin rgba(233,212,154,.6);background:linear-gradient(90deg,rgba(233,212,154,.5),transparent 7vmin,transparent calc(100% - 7vmin),rgba(233,212,154,.5)),linear-gradient(180deg,rgba(233,212,154,.5),transparent 7vmin,transparent calc(100% - 7vmin),rgba(233,212,154,.5));animation:cgFrame 3s ease both;will-change:opacity}',
    '@keyframes cgFrame{0%{opacity:0}10%{opacity:1}30%{opacity:.5}45%{opacity:.9}80%{opacity:.5}100%{opacity:0}}',
    /* ondas */
    '.cg-ring{position:absolute;left:50%;top:46%;width:30vmin;height:30vmin;margin:-15vmin 0 0 -15vmin;border-radius:50%;border:.55vmin solid #e9d49a;box-shadow:0 0 3vmin rgba(208,184,120,.5);opacity:0;animation:cgRing 1.35s cubic-bezier(.16,.8,.3,1) both;will-change:transform,opacity}',
    '.cg-ring.r2{border-width:.25vmin;border-color:#f4f0df;animation-delay:.16s}',
    '.cg-ring.r3{border-color:#3a5a9a;animation-delay:.34s}',
    '.cg-ring.lite{width:22vmin;height:22vmin;margin:-11vmin 0 0 -11vmin;border-width:.35vmin;animation-duration:1.1s}',
    '@keyframes cgRing{0%{transform:scale(.15);opacity:.95}100%{transform:scale(3.3);opacity:0}}',
    /* escudo */
    '.cg-crest{position:absolute;left:50%;top:15%;width:15vmin;height:auto;margin-left:-7.5vmin;opacity:0;filter:drop-shadow(0 0 2.2vmin rgba(208,184,120,.65));animation:cgCrest 3.1s cubic-bezier(.2,.9,.25,1) both;will-change:transform,opacity}',
    '@keyframes cgCrest{0%{opacity:0;transform:translateY(3vmin) scale(.45)}13%{opacity:1;transform:translateY(-.6vmin) scale(1.1)}22%{transform:translateY(0) scale(1)}80%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-2vmin) scale(1.04)}}',
    /* GOL */
    '.cg-word{position:absolute;left:0;right:0;top:36%;text-align:center;font:900 17vmin/1 ' + FONT + ';letter-spacing:.12em;text-indent:.12em;white-space:nowrap}',
    '.cg-word span{position:relative;display:inline-block;opacity:0;color:transparent;-webkit-background-clip:text;background-clip:text;background-image:linear-gradient(105deg,transparent 38%,rgba(255,255,255,.95) 50%,transparent 62%),linear-gradient(180deg,#f4f0df 0%,#e9d49a 38%,#d0b878 62%,#8a6f3a 100%);background-size:320% 100%,100% 100%;background-position:160% 0,0 0;animation:cgLetter 3s cubic-bezier(.2,.8,.2,1) both,cgShine 1.1s ease both;will-change:transform,opacity}',
    '@keyframes cgLetter{0%{opacity:0;transform:translateY(6vmin) scale(.82)}16%{opacity:1;transform:translateY(-1vmin) scale(1.05)}24%{transform:translateY(0) scale(1)}80%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-3.5vmin) scale(1.02)}}',
    '@keyframes cgShine{from{background-position:160% 0,0 0}to{background-position:-60% 0,0 0}}',
    /* nombre y asistencia */
    '.cg-name{position:absolute;left:0;right:0;top:60%;display:flex;justify-content:center;align-items:center;gap:2.2vmin;font:700 3.6vmin/1 ' + FONT + ';letter-spacing:.24em;text-transform:uppercase;color:#f4f0df;text-shadow:0 .3vmin 1vmin rgba(10,20,40,.8)}',
    '.cg-name b{font-weight:700;opacity:0;animation:cgUp 3s ease .35s both}',
    '.cg-name i{display:block;height:.28vmin;width:11vmin;opacity:0;transform:scaleX(0);transform-origin:right center;background:linear-gradient(90deg,transparent,#e9d49a);animation:cgLine 3s ease .35s both}',
    '.cg-name i:last-child{transform-origin:left center;background:linear-gradient(270deg,transparent,#e9d49a)}',
    '@keyframes cgLine{0%{transform:scaleX(0);opacity:0}20%{transform:scaleX(1);opacity:1}80%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}',
    '@keyframes cgUp{0%{opacity:0;transform:translateY(1.6vmin)}16%{opacity:1;transform:translateY(0)}80%{opacity:1}100%{opacity:0;transform:translateY(-1vmin)}}',
    '.cg-sub{position:absolute;left:0;right:0;top:66%;text-align:center;font:600 2.3vmin/1 ' + FONT + ';letter-spacing:.2em;text-transform:uppercase;color:#d0b878;opacity:0;animation:cgUp 3s ease .55s both;text-shadow:0 .2vmin .8vmin rgba(10,20,40,.8)}',
    '.cg-pill{position:absolute;left:50%;top:71%;transform:translateX(-50%);padding:.9vmin 2.6vmin;border-radius:99px;background:linear-gradient(180deg,#e9d49a,#c9a95c);color:#13243f;font:800 2.3vmin/1 ' + FONT + ';letter-spacing:.2em;opacity:0;animation:cgPill 3s cubic-bezier(.2,.9,.25,1.2) .7s both;will-change:transform,opacity}',
    '@keyframes cgPill{0%{opacity:0;transform:translateX(-50%) scale(.6)}14%{opacity:1;transform:translateX(-50%) scale(1.08)}22%{transform:translateX(-50%) scale(1)}78%{opacity:1}100%{opacity:0;transform:translateX(-50%) scale(1)}}',
    /* franja del club */
    '.cg-club{position:absolute;left:0;right:0;bottom:10%;text-align:center;font:800 2.4vmin/1 ' + FONT + ';letter-spacing:.7em;text-indent:.7em;color:#d0b878;opacity:0;transform:scaleX(.6);animation:cgClub 3s cubic-bezier(.3,.7,.2,1) both;will-change:transform,opacity}',
    '@keyframes cgClub{0%,12%{opacity:0;transform:scaleX(.6)}34%{opacity:1;transform:scaleX(1)}80%{opacity:1;transform:scaleX(1)}100%{opacity:0;transform:scaleX(1)}}',
    /* chispas del centro */
    '.cg-sp{position:absolute;left:50%;top:46%;width:1.1vmin;height:1.1vmin;margin:-.55vmin 0 0 -.55vmin;border-radius:50%;opacity:0;animation:cgSpark 1.15s cubic-bezier(.1,.7,.3,1) both}',
    '@keyframes cgSpark{0%{opacity:1;transform:translate(0,0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.2)}}',
    /* cintas */
    '.cg-rb{position:absolute;top:-5vmin;width:.8vmin;height:2.6vmin;border-radius:1px;opacity:0;animation:cgFall var(--d) cubic-bezier(.3,.1,.55,1) var(--w) both}',
    '@keyframes cgFall{0%{opacity:0;transform:translate3d(0,0,0) rotate(0)}8%{opacity:1}100%{opacity:.9;transform:translate3d(var(--sx),118vh,0) rotate(var(--r))}}',
    /* versión corta */
    '.cgl{position:absolute;left:50%;top:11%;display:flex;align-items:center;gap:1.8vmin;padding:1.2vmin 3.2vmin 1.2vmin 2.4vmin;border-radius:.8vmin;background:linear-gradient(90deg,rgba(19,36,63,.92),rgba(19,36,63,.78));border-left:.7vmin solid #d0b878;box-shadow:0 1vmin 3vmin rgba(10,20,40,.5);opacity:0;animation:cgLite 2.1s cubic-bezier(.2,.9,.25,1) both;will-change:transform,opacity;overflow:hidden}',
    '.cgl::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(244,240,223,.28) 50%,transparent 65%);transform:translateX(-120%);animation:cgLiteShine 1.1s ease .25s both}',
    '@keyframes cgLiteShine{to{transform:translateX(120%)}}',
    '.cgl b{font:900 4.2vmin/1 ' + FONT + ';letter-spacing:.14em;background:linear-gradient(180deg,#f4f0df,#d0b878);-webkit-background-clip:text;background-clip:text;color:transparent}',
    '.cgl span{font:700 2.5vmin/1 ' + FONT + ';letter-spacing:.16em;text-transform:uppercase;color:#f4f0df;padding-left:1.8vmin;border-left:.2vmin solid rgba(208,184,120,.5)}',
    '.cgl-line{position:absolute;left:50%;top:calc(11% + 7.6vmin);height:.3vmin;width:18vmin;margin-left:0;background:linear-gradient(90deg,#d0b878,transparent);opacity:0;animation:cgLiteLine 2.1s ease .2s both}',
    '@keyframes cgLiteLine{0%{opacity:0;transform:translateX(-50%) scaleX(0)}25%{opacity:.9;transform:translateX(-50%) scaleX(1)}80%{opacity:.7;transform:translateX(-50%) scaleX(1)}100%{opacity:0;transform:translateX(-50%) scaleX(1)}}',
    '@keyframes cgLite{0%{opacity:0;transform:translate(-80%,0)}16%{opacity:1;transform:translate(-50%,0)}22%{transform:translate(-50%,0) scale(1.02)}28%{transform:translate(-50%,0) scale(1)}80%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-20%,0)}}'
  ].join('\n');

  function cleanName(v) {
    return String(v || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 22);
  }

  function el(doc, cls, tag, text) {
    var e = doc.createElement(tag || 'div');
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (doc.head || doc.documentElement).append(st);
  }

  var timer = 0;
  var warmed = null;

  /**
   * Se llama al entrar a la sala, no al primer gol: deja el estilo puesto y el escudo
   * ya decodificado, así el primer festejo no tiene que hacer nada de eso en el
   * mismo cuadro en que aparece.
   */
  function warm(doc, crestUrl) {
    try {
      if (!doc || !doc.head) return;
      ensureStyle(doc);
      if (crestUrl && warmed !== crestUrl) {
        warmed = crestUrl;
        var img = new doc.defaultView.Image();
        img.src = crestUrl;
        if (img.decode) img.decode().catch(function () {});
      }
    } catch (e) { /* adorno */ }
  }

  function stop(doc) {
    var old = doc && doc.getElementById(BOX_ID);
    if (old) old.remove();
    if (timer) { clearTimeout(timer); timer = 0; }
  }

  /**
   * @param {Document} doc
   * @param {{mode?: 'club'|'lite', name?: string, assist?: string, own?: boolean, count?: number, crest?: string}} o
   */
  function play(doc, o) {
    if (!doc || !doc.body) return false;
    o = o || {};
    var club = o.mode === 'club';
    stop(doc);
    ensureStyle(doc);

    var name = cleanName(o.name);
    var assist = cleanName(o.assist);
    var box = el(doc);
    box.id = BOX_ID;
    box.setAttribute('aria-hidden', 'true');

    box.append(el(doc, 'cg-vig' + (club ? '' : ' lite')));

    if (!club) {
      var pill = el(doc, 'cgl');
      pill.append(el(doc, '', 'b', 'GOL'));
      var label = o.own ? ('EN CONTRA' + (name ? ' · ' + name : '')) : name;
      if (label) pill.append(el(doc, '', 'span', label));
      box.append(pill, el(doc, 'cgl-line'));
      doc.body.append(box);
      timer = setTimeout(function () { stop(doc); }, 2300);
      return true;
    }

    box.append(el(doc, 'cg-flash'), el(doc, 'cg-rays'), el(doc, 'cg-frame'));
    // Cintas: de tres tamaños, con vaivén.
    var i;
    for (i = 0; i < 20; i++) {
      var rb = el(doc, 'cg-rb');
      rb.style.left = rnd(2, 98).toFixed(1) + '%';
      rb.style.background = CONF[i % CONF.length];
      rb.style.setProperty('--d', rnd(1.9, 3).toFixed(2) + 's');
      rb.style.setProperty('--w', rnd(0.05, 0.9).toFixed(2) + 's');
      rb.style.setProperty('--r', Math.round(rnd(200, 620)) + 'deg');
      rb.style.setProperty('--sx', Math.round(rnd(-14, 14)) + 'vmin');
      var sz = 0.6 + (i % 3) * 0.35;
      rb.style.width = sz.toFixed(2) + 'vmin';
      rb.style.height = (sz * 3.2).toFixed(2) + 'vmin';
      box.append(rb);
    }

    box.append(el(doc, 'cg-ring'), el(doc, 'cg-ring r2'), el(doc, 'cg-ring r3'));

    // Abanico de chispas desde el centro.
    var n = 14;
    for (i = 0; i < n; i++) {
      var sp = el(doc, 'cg-sp');
      var ang = (i / n) * Math.PI * 2 + (i % 2 ? 0.1 : -0.1);
      var dist = 20 + (i % 4) * 9;
      sp.style.background = GOLD[i % 3];
      sp.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'vmin');
      sp.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'vmin');
      sp.style.animationDelay = (0.05 + (i % 4) * 0.03).toFixed(2) + 's';
      box.append(sp);
    }

    if (o.crest) {
      var img = el(doc, 'cg-crest', 'img');
      img.alt = '';
      img.src = o.crest;
      box.append(img);
    }

    var word = el(doc, 'cg-word');
    'GOL'.split('').forEach(function (ch, idx) {
      var s = el(doc, '', 'span', ch);
      s.setAttribute('data-c', ch);
      var d = (0.1 + idx * 0.09).toFixed(2);
      s.style.animationDelay = d + 's,' + (0.5 + idx * 0.12).toFixed(2) + 's';
      word.append(s);
    });
    box.append(el(doc, 'cg-bar'), el(doc, 'cg-bar r'), word);

    var label2 = o.own ? ('EN CONTRA' + (name ? ' · ' + name : '')) : name;
    if (label2) {
      var nm = el(doc, 'cg-name');
      nm.append(el(doc, '', 'i'), el(doc, '', 'b', label2), el(doc, '', 'i'));
      box.append(nm);
    }
    if (assist && !o.own) box.append(el(doc, 'cg-sub', 'div', 'Asist. ' + assist));

    var count = Math.round(Number(o.count) || 1);
    if (count >= 2) {
      box.append(el(doc, 'cg-pill', 'div', count - 2 < STREAK.length ? STREAK[count - 2] : 'x' + count));
    }

    box.append(el(doc, 'cg-club', 'div', 'TODA LA LECCE'));
    doc.body.append(box);
    timer = setTimeout(function () { stop(doc); }, 3400);
    return true;
  }

  var api = { play: play, stop: stop, warm: warm };
  root.TLClubGoal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
