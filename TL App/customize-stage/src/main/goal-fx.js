/*
 * Festejo de gol personalizado.
 *
 * Es APARTE del efecto original del club (el destello dorado con el escudo):
 * ese no se toca. Este es opcional, lo elige cada uno y se dibuja con un solo
 * canvas que existe nada más que mientras dura el festejo.
 *
 * Por qué no cuesta rendimiento:
 *   · Cero costo fuera del festejo: no hay canvas, ni listeners, ni temporizadores.
 *   · Mientras dura se dibuja a 75 cuadros por segundo como mucho, aunque el
 *     juego vaya a 1000: el resto de los `requestAnimationFrame` salen en la
 *     primera línea sin tocar nada.
 *   · Un tope de partículas (400), sin objetos nuevos por cuadro: los arreglos se
 *     arman al empezar y se reciclan.
 *   · El canvas no captura el mouse ni el teclado (pointer-events: none).
 *   · Sin `shadowBlur` en las partículas (es lo más caro del canvas 2D): el brillo
 *     sale de mezclar en modo «lighter».
 *
 * Es un script clásico que sirve en dos lados: lo carga game-preload (festejo de
 * verdad) y la interfaz (botón «Probar»). Por eso todo va adentro de una función
 * y no declara nada global salvo `TLGoalFx`.
 */
(function (root) {
  'use strict';

  var STYLES = ['confetti', 'papelitos', 'fireworks', 'bengalas', 'shockwave', 'rings', 'lightning', 'flames', 'coins', 'emojis', 'beams', 'stars', 'meteors', 'aurora', 'bubbles', 'pixels', 'glitch'];
  /** «random» no es un estilo: elige uno distinto en cada gol. */
  var ANIMS = ['pop', 'slide', 'drop', 'zoom', 'wave', 'glitch', 'type'];
  var TEXT_STYLES = ['gradient', 'solid', 'neon', 'outline'];
  var POSITIONS = { top: 0.28, center: 0.5, bottom: 0.78 };
  var STREAK = ['DOBLETE', 'TRIPLETE', 'PÓKER', 'MANITA'];
  var TEAM_COLORS = { Red: ['#ff6b57', '#ffc15e'], Blue: ['#5b9bff', '#7ff0ff'] };
  var MAX_PARTICLES = 400;
  var FRAME_MS = 13;

  var active = null;

  function clamp(v, lo, hi, fallback) {
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    return n < lo ? lo : n > hi ? hi : n;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[(Math.random() * list.length) | 0]; }

  function safeColor(c, fallback) {
    var s = String(c || '').trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : fallback;
  }
  function rgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.replace(/./g, function (c) { return c + c; });
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    var c = rgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
  }
  function lighten(hex, k) {
    var c = rgb(hex);
    function f(v) { var x = Math.round(v + (255 - v) * k).toString(16); return x.length < 2 ? '0' + x : x; }
    return '#' + f(c[0]) + f(c[1]) + f(c[2]);
  }
  var easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  var easeOutBounce = function (t) { var n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; } if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; } t -= 2.625 / d; return n * t * t + 0.984375; };
  var easeOutBack = function (t) { var c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  /** Opciones saneadas: todo lo que viene de la config pasa por acá. */
  function cleanStyle(v) {
    return STYLES.indexOf(v) >= 0 ? v : null;
  }
  function normalize(o) {
    o = o || {};
    var team = o.team === 'Blue' ? 'Blue' : 'Red';
    var base = TEAM_COLORS[team];
    var custom = o.colorMode === 'custom';
    var c1 = custom ? safeColor(o.color, base[0]) : base[0];
    var c2 = custom ? safeColor(o.color2, base[1]) : base[1];
    var name = o.showName === false ? '' : String(o.name || '').slice(0, 24);
    var count = Math.max(1, Math.min(99, Math.round(Number(o.count) || 1)));

    // El texto puede traer varias frases separadas por « | »: se elige una por gol.
    var phrases = String(o.text == null ? 'GOL' : o.text).split('|').map(function (x) {
      return x.replace(/[\r\n\t]+/g, ' ').trim();
    }).filter(Boolean);
    var text = phrases.length ? pick(phrases) : '';
    text = text.replace(/\{nombre\}/gi, name || '').replace(/\{n\}/gi, String(count)).replace(/\s+/g, ' ').trim().slice(0, 18);
    // Racha: del segundo gol en adelante el cartel pasa a ser «DOBLETE», «TRIPLETE»…
    if (o.streak && count >= 2) text = count - 2 < STREAK.length ? STREAK[count - 2] : 'x' + count;

    var emoji = Array.from(String(o.emoji || '⚽🔥')).filter(function (ch) { return ch.trim(); }).slice(0, 8);

    var style = o.style === 'random' ? pick(STYLES) : (cleanStyle(o.style) || 'confetti');
    var layers = [];
    var extra = Array.isArray(o.layers) ? o.layers : [];
    for (var i = 0; i < extra.length && layers.length < 2; i++) {
      var st = extra[i] === 'random' ? pick(STYLES) : cleanStyle(extra[i]);
      if (st && st !== style && layers.indexOf(st) < 0) layers.push(st);
    }

    return {
      style: style,
      layers: layers,
      c1: c1,
      c2: c2,
      custom: custom,
      text: o.showText === false ? '' : text,
      name: name,
      intensity: clamp(o.intensity, 0.3, 2, 1),
      duration: clamp(o.duration, 1, 5, 2.4) * 1000,
      emoji: emoji.length ? emoji : ['⚽'],
      font: String(o.font || 'Impact, "Arial Black", system-ui, sans-serif'),
      textPos: POSITIONS[o.textPos] !== undefined ? o.textPos : 'top',
      textScale: clamp(o.textScale, 0.5, 1.6, 1),
      textAnim: ANIMS.indexOf(o.textAnim) >= 0 ? o.textAnim : 'pop',
      textStyle: TEXT_STYLES.indexOf(o.textStyle) >= 0 ? o.textStyle : 'gradient',
      textColor: safeColor(o.textColor, ''),
      vignette: !!o.vignette,
      flash: !!o.flash
    };
  }

  /* ── Efectos ──────────────────────────────────────────────────────────
   * Cada uno devuelve { update(dt, t), draw(ctx, W, H, t) }. `t` va de 0 a 1. */

  /** Mancha suave (centro claro que se apaga) para llamas, humo y destellos. Se arma una vez. */
  var blobSprite = null;
  function blob(ctx) {
    if (blobSprite !== null) return blobSprite;
    try {
      var c = ctx.canvas.ownerDocument.createElement('canvas');
      c.width = c.height = 64;
      var g = c.getContext('2d');
      var r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.35, 'rgba(255,255,255,.55)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 64);
      blobSprite = c;
    } catch (e) { blobSprite = false; }
    return blobSprite;
  }
  /** La misma mancha teñida. Se guarda por color para no repetir el trabajo. */
  var tinted = {};
  function tint(ctx, color) {
    var base = blob(ctx);
    if (!base) return null;
    if (tinted[color]) return tinted[color];
    try {
      var c = ctx.canvas.ownerDocument.createElement('canvas');
      c.width = c.height = 64;
      var g = c.getContext('2d');
      g.drawImage(base, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color; g.fillRect(0, 0, 64, 64);
      tinted[color] = c;
      return c;
    } catch (e) { return null; }
  }

  function makeConfetti(W, H, o) {
    var K = Math.max(0.8, Math.min(1.8, H / 700));
    var n = Math.min(MAX_PARTICLES, Math.round(260 * o.intensity));
    var colors = [o.c1, o.c2, lighten(o.c1, 0.55), lighten(o.c2, 0.55), '#ffffff', '#ffd54a'];
    var ps = [];
    for (var i = 0; i < n; i++) {
      var cannon = i % 3; // 0 = cañón izquierdo, 1 = derecho, 2 = lluvia desde arriba
      var p = { c: pick(colors), w: rnd(8, 15) * K, h: rnd(5, 10) * K, rot: rnd(0, 6.28), vr: rnd(-9, 9), flip: rnd(0, 6.28), vf: rnd(4, 11), delay: rnd(0, 0.3) };
      if (cannon === 0) { p.x = -10; p.y = H * 0.98; p.vx = rnd(300, 900) * (W / 1200); p.vy = -rnd(800, 1500) * (H / 800); }
      else if (cannon === 1) { p.x = W + 10; p.y = H * 0.98; p.vx = -rnd(300, 900) * (W / 1200); p.vy = -rnd(800, 1500) * (H / 800); }
      else { p.x = rnd(0, W); p.y = -20; p.vx = rnd(-60, 60); p.vy = rnd(80, 260); p.delay = rnd(0.05, 0.6); }
      ps.push(p);
    }
    return {
      update: function (dt, t) {
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (t < p.delay * 0.4) continue;
          p.vy += 900 * dt; p.vx *= 1 - 1.1 * dt; p.vy *= 1 - 0.55 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.flip += p.vf * dt;
        }
      },
      draw: function (ctx, W2, H2, t) {
        var fade = t > 0.78 ? Math.max(0, 1 - (t - 0.78) / 0.22) : 1;
        ctx.globalAlpha = fade;
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (t < p.delay * 0.4 || p.y > H2 + 30) continue;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(p.flip));
          ctx.fillStyle = p.c;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  function makeFireworks(W, H, o) {
    var K = Math.max(0.8, Math.min(1.8, H / 700));
    var shells = Math.max(4, Math.round(6 * o.intensity));
    var per = Math.min(110, Math.round(84 * o.intensity));
    var palette = [o.c1, o.c2, lighten(o.c1, 0.5), lighten(o.c2, 0.5), '#ffffff'];
    var list = [];
    for (var s = 0; s < shells; s++) {
      list.push({
        x: rnd(W * 0.14, W * 0.86), y: H, ty: rnd(H * 0.14, H * 0.5), at: 0.0 + s * (0.36 / shells) + rnd(0, 0.03),
        vy: -rnd(H * 1.8, H * 2.3), state: 0, col: pick(palette), col2: pick(palette), sparks: [], age: 0, size: rnd(0.8, 1.25)
      });
    }
    return {
      update: function (dt, t) {
        for (var i = 0; i < list.length; i++) {
          var f = list[i];
          if (f.state === 0 && t >= f.at) f.state = 1;
          if (f.state === 1) {
            f.vy *= 1 - 0.5 * dt; f.y += f.vy * dt;
            if (f.y <= f.ty || f.vy > -120) {
              f.state = 2;
              var ring = Math.random() < 0.35; // algunas explotan en anillo
              for (var k = 0; k < per; k++) {
                var a = (k / per) * 6.283 + rnd(-0.05, 0.05);
                var v = (ring ? rnd(330, 360) : rnd(120, 560)) * (H / 800) * f.size;
                f.sparks.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(1.1, 1.9), age: 0, c: k % 2 ? f.col : f.col2, tw: Math.random() < 0.25 });
              }
            }
          } else if (f.state === 2) {
            f.age += dt;
            for (var j = 0; j < f.sparks.length; j++) {
              var sp = f.sparks[j];
              sp.age += dt; sp.vx *= 1 - 1.25 * dt; sp.vy = sp.vy * (1 - 1.25 * dt) + 210 * dt;
              sp.x += sp.vx * dt; sp.y += sp.vy * dt;
            }
          }
        }
      },
      draw: function (ctx) {
        var glow = function (c) { return tint(ctx, c); };
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < list.length; i++) {
          var f = list[i];
          if (f.state === 1) {
            // El cohete: una estela que se apaga hacia atrás.
            var g = ctx.createLinearGradient(f.x, f.y, f.x, f.y + 70 * K);
            g.addColorStop(0, 'rgba(255,244,214,.95)');
            g.addColorStop(1, 'rgba(255,200,120,0)');
            ctx.fillStyle = g;
            ctx.fillRect(f.x - 2 * K, f.y, 4 * K, 70 * K);
          } else if (f.state === 2) {
            if (f.age < 0.35) {
              var fl = 1 - f.age / 0.35;
              var R = (40 + 150 * (1 - fl)) * K;
              var rg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, R);
              rg.addColorStop(0, rgba('#ffffff', 0.85 * fl));
              rg.addColorStop(0.4, rgba(f.col, 0.4 * fl));
              rg.addColorStop(1, rgba(f.col, 0));
              ctx.fillStyle = rg;
              ctx.fillRect(f.x - R, f.y - R, R * 2, R * 2);
            }
            for (var j = 0; j < f.sparks.length; j++) {
              var sp = f.sparks[j], l = 1 - sp.age / sp.life;
              if (l <= 0) continue;
              var tw = sp.tw ? (0.5 + 0.5 * Math.sin(sp.age * 40 + j)) : 1;
              var sz = (5 + 3 * l) * K;
              // Brillo suave alrededor de cada chispa (una de por medio, para cuidar el costo).
              if (glow && (j & 1) === 0) {
                var gs = glow(sp.c);
                if (gs) { ctx.globalAlpha = 0.55 * l * tw; ctx.drawImage(gs, sp.x - sz * 2.2, sp.y - sz * 2.2, sz * 4.4, sz * 4.4); ctx.globalAlpha = 1; }
              }
              ctx.fillStyle = rgba(sp.c, Math.min(1, l * 1.1) * tw);
              ctx.fillRect(sp.x - sz / 2, sp.y - sz / 2, sz, sz);
              // Cola de tres cuadritos que se achican.
              ctx.fillStyle = rgba(sp.c, l * 0.5 * tw);
              ctx.fillRect(sp.x - sp.vx * 0.03 - sz * 0.35, sp.y - sp.vy * 0.03 - sz * 0.35, sz * 0.7, sz * 0.7);
              ctx.fillStyle = rgba(sp.c, l * 0.25 * tw);
              ctx.fillRect(sp.x - sp.vx * 0.06 - sz * 0.25, sp.y - sp.vy * 0.06 - sz * 0.25, sz * 0.5, sz * 0.5);
            }
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  function makeShockwave(W, H, o) {
    var cx = W / 2, cy = H * 0.5, R = Math.sqrt(W * W + H * H) * 0.6;
    var rays = Math.round(14 * Math.max(0.7, o.intensity));
    return {
      update: function () {},
      draw: function (ctx, W2, H2, t) {
        ctx.globalCompositeOperation = 'lighter';
        // Destello de los bordes: entra rápido y se va.
        var edge = Math.max(0, 1 - t * 2.4);
        if (edge > 0) {
          var g = ctx.createRadialGradient(cx, cy, Math.min(W2, H2) * 0.35, cx, cy, Math.max(W2, H2) * 0.75);
          g.addColorStop(0, rgba(o.c1, 0));
          g.addColorStop(1, rgba(o.c1, 0.55 * edge));
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W2, H2);
        }
        // Rayos que giran y se abren.
        var ra = Math.max(0, 1 - t * 1.5);
        if (ra > 0) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(t * 1.6);
          ctx.fillStyle = rgba(o.c2, 0.22 * ra);
          for (var i = 0; i < rays; i++) {
            ctx.rotate(6.283 / rays);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(R * easeOutCubic(Math.min(1, t * 2.5)), -10 - 34 * t);
            ctx.lineTo(R * easeOutCubic(Math.min(1, t * 2.5)), 10 + 34 * t);
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        }
        // Tres ondas, una detrás de otra.
        for (var k = 0; k < 3; k++) {
          var tt = (t - k * 0.09) / 0.62;
          if (tt <= 0 || tt >= 1) continue;
          var r = R * easeOutCubic(tt);
          ctx.lineWidth = Math.max(1, 26 * (1 - tt));
          ctx.strokeStyle = rgba(k === 1 ? o.c2 : o.c1, 0.85 * (1 - tt));
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, 6.283);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  function makeLightning(W, H, o) {
    var bolts = [];
    var n = Math.max(2, Math.round(3 * o.intensity));
    function build(x0) {
      var pts = [[x0, -10]], x = x0, y = -10, branches = [];
      while (y < H * rnd(0.55, 0.9)) {
        y += rnd(H * 0.05, H * 0.1);
        x += rnd(-W * 0.045, W * 0.045);
        pts.push([x, y]);
        if (Math.random() < 0.22) {
          var bx = x, by = y, b = [[bx, by]];
          for (var i = 0; i < 4; i++) { by += rnd(H * 0.03, H * 0.06); bx += rnd(-W * 0.05, W * 0.05) + (bx > x ? 10 : -10); b.push([bx, by]); }
          branches.push(b);
        }
      }
      return { pts: pts, branches: branches };
    }
    for (var i = 0; i < n; i++) bolts.push({ shape: build(rnd(W * 0.12, W * 0.88)), at: i * 0.1 + rnd(0, 0.05), seed: Math.random() });
    function trace(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); }
    return {
      update: function () {},
      draw: function (ctx, W2, H2, t) {
        // Fogonazo blanco al principio.
        var flash = Math.max(0, 1 - t * 7);
        if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (0.5 * flash).toFixed(3) + ')'; ctx.fillRect(0, 0, W2, H2); }
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineJoin = 'round';
        for (var i = 0; i < bolts.length; i++) {
          var b = bolts[i], tt = (t - b.at) / 0.55;
          if (tt <= 0 || tt >= 1) continue;
          // Parpadeo: la descarga titila antes de apagarse.
          var fl = (Math.sin(tt * 38 + b.seed * 9) > -0.25 ? 1 : 0.25) * (1 - tt);
          ctx.strokeStyle = rgba(o.c1, 0.28 * fl); ctx.lineWidth = 16; trace(ctx, b.shape.pts);
          ctx.strokeStyle = rgba(o.c2, 0.6 * fl); ctx.lineWidth = 6; trace(ctx, b.shape.pts);
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.95 * fl).toFixed(3) + ')'; ctx.lineWidth = 2.4; trace(ctx, b.shape.pts);
          for (var k = 0; k < b.shape.branches.length; k++) {
            ctx.strokeStyle = rgba(o.c2, 0.55 * fl); ctx.lineWidth = 2; trace(ctx, b.shape.branches[k]);
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  function makeFlames(W, H, o) {
    var K = Math.max(0.8, Math.min(1.8, H / 700));
    var n = Math.min(MAX_PARTICLES, Math.round(150 * o.intensity));
    var ps = [];
    for (var i = 0; i < n; i++) {
      ps.push({ x: rnd(-10, W + 10), y: H + rnd(0, 30), vx: rnd(-26, 26), vy: -rnd(160, 560) * (H / 800), r: rnd(22, 58) * K, life: rnd(0.9, 1.7), age: -rnd(0, 1.0), ph: rnd(0, 6.28), hot: Math.random() < 0.4 });
    }
    var coreCol = lighten(o.c2, 0.45), outCol = o.c1;
    return {
      update: function (dt) {
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          p.age += dt;
          if (p.age < 0) continue;
          p.x += (p.vx + Math.sin(p.age * 6 + p.ph) * 44) * dt; p.y += p.vy * dt; p.vy *= 1 - 0.4 * dt;
        }
      },
      draw: function (ctx, W2, H2, t) {
        var pulse = (t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.2));
        // Brasa de fondo: la base de la pantalla se calienta.
        var g = ctx.createLinearGradient(0, H2, 0, H2 * 0.45);
        g.addColorStop(0, rgba(o.c1, 0.6 * pulse));
        g.addColorStop(1, rgba(o.c1, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, H2 * 0.45, W2, H2 * 0.55);
        var sOut = tint(ctx, outCol), sCore = tint(ctx, coreCol), sWhite = blob(ctx);
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (p.age < 0 || p.age > p.life) continue;
          var l = 1 - p.age / p.life, r = p.r * (0.45 + 0.8 * l);
          if (sOut) {
            // Lengua de fuego: más alta que ancha, y se estira hacia arriba.
            ctx.globalAlpha = 0.85 * l * pulse;
            ctx.drawImage(sOut, p.x - r, p.y - r * 1.9, r * 2, r * 3.2);
            if (p.hot && sCore) {
              ctx.globalAlpha = 0.9 * l * pulse;
              ctx.drawImage(sCore, p.x - r * 0.62, p.y - r * 1.0, r * 1.24, r * 1.9);
              if (sWhite) { ctx.globalAlpha = 0.55 * l * pulse; ctx.drawImage(sWhite, p.x - r * 0.3, p.y - r * 0.45, r * 0.6, r * 0.9); }
            }
          } else {
            ctx.fillStyle = rgba(outCol, 0.7 * l * pulse);
            ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.6, 0, 6.283); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  function makeCoins(W, H, o) {
    var K = Math.max(0.8, Math.min(1.8, H / 700));
    var n = Math.min(260, Math.round(120 * o.intensity));
    // Con colores del equipo las monedas son de oro igual: una moneda roja no es una moneda.
    var face = o.custom ? o.c1 : '#ffcf3a', rim = o.custom ? o.c2 : '#b87a08', shine = lighten(face, 0.6);
    var ps = [];
    for (var i = 0; i < n; i++) ps.push({ x: rnd(0, W), y: -rnd(20, H * 0.9), vy: rnd(300, 620) * (H / 800), vx: rnd(-40, 40), r: rnd(15, 27) * K, flip: rnd(0, 6.28), vf: rnd(5, 12), spark: Math.random() < 0.3 });
    return {
      update: function (dt) {
        for (var i = 0; i < ps.length; i++) { var p = ps[i]; p.y += p.vy * dt; p.x += p.vx * dt; p.flip += p.vf * dt; }
      },
      draw: function (ctx, W2, H2, t) {
        var fade = t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.2) : 1;
        ctx.globalAlpha = fade;
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (p.y < -30 || p.y > H2 + 30) continue;
          var c = Math.cos(p.flip), w = Math.abs(c) * p.r;
          // Borde (grosor de la moneda), cara y círculo interior grabado.
          ctx.fillStyle = rim;
          ctx.beginPath(); ctx.ellipse(p.x, p.y, Math.max(2, w + p.r * 0.1), p.r, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = c > 0 ? face : lighten(face, -0.0);
          ctx.beginPath(); ctx.ellipse(p.x, p.y, Math.max(1.5, w), p.r * 0.94, 0, 0, 6.283); ctx.fill();
          if (w > p.r * 0.35) {
            ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1, p.r * 0.09);
            ctx.beginPath(); ctx.ellipse(p.x, p.y, w * 0.68, p.r * 0.62, 0, 0, 6.283); ctx.stroke();
            ctx.fillStyle = rgba(shine, 0.7);
            ctx.beginPath(); ctx.ellipse(p.x - w * 0.3, p.y - p.r * 0.3, w * 0.18, p.r * 0.22, 0, 0, 6.283); ctx.fill();
          }
          if (p.spark && c > 0.92) {
            ctx.fillStyle = '#fff';
            ctx.fillRect(p.x - 1, p.y - p.r - 5, 2.4, 10); ctx.fillRect(p.x - 5, p.y - p.r - 1, 10, 2.4);
          }
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  function makeEmojis(W, H, o) {
    var n = Math.min(120, Math.round(46 * o.intensity));
    var ps = [];
    for (var i = 0; i < n; i++) {
      var a = rnd(-2.5, -0.64), v = rnd(380, 1100) * (H / 800);
      ps.push({ x: W / 2 + rnd(-60, 60), y: H * 0.78, vx: Math.cos(a) * v * (W / 1100), vy: Math.sin(a) * v, rot: rnd(-0.5, 0.5), vr: rnd(-4, 4), s: rnd(26, 58), e: pick(o.emoji), delay: rnd(0, 0.28) });
    }
    return {
      update: function (dt, t) {
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (t < p.delay) continue;
          p.vy += 820 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        }
      },
      draw: function (ctx, W2, H2, t) {
        var fade = t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.2) : 1;
        ctx.globalAlpha = fade;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (t < p.delay || p.y > H2 + 60) continue;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.font = Math.round(p.s) + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
          ctx.fillText(p.e, 0, 0);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  function makeBeams(W, H, o) {
    var cols = [o.c1, o.c2, lighten(o.c1, 0.4), lighten(o.c2, 0.4)];
    var beams = [];
    var n = Math.max(4, Math.round(7 * o.intensity));
    for (var i = 0; i < n; i++) beams.push({ x: i % 2 ? W * rnd(0.7, 1) : W * rnd(0, 0.3), y: H + 20, base: i % 2 ? -1.9 : -1.2, sweep: rnd(0.5, 0.9) * (i % 2 ? 1 : -1), phase: rnd(0, 6.28), w: rnd(0.08, 0.16), c: cols[i % cols.length] });
    return {
      update: function () {},
      draw: function (ctx, W2, H2, t) {
        var env = Math.min(1, t / 0.12) * (t > 0.78 ? Math.max(0, 1 - (t - 0.78) / 0.22) : 1);
        ctx.globalCompositeOperation = 'lighter';
        var L = Math.sqrt(W2 * W2 + H2 * H2);
        for (var i = 0; i < beams.length; i++) {
          var b = beams[i];
          var ang = b.base + Math.sin(t * 6 + b.phase) * b.sweep;
          var g = ctx.createLinearGradient(b.x, b.y, b.x + Math.cos(ang) * L, b.y + Math.sin(ang) * L);
          g.addColorStop(0, rgba(b.c, 0.5 * env));
          g.addColorStop(1, rgba(b.c, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x + Math.cos(ang - b.w) * L, b.y + Math.sin(ang - b.w) * L);
          ctx.lineTo(b.x + Math.cos(ang + b.w) * L, b.y + Math.sin(ang + b.w) * L);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  function makePapelitos(W, H, o) {
    var K = Math.max(0.8, Math.min(1.8, H / 700));
    // «Papelitos» de cancha: tiras finas que caen de arriba y se mecen.
    var n = Math.min(MAX_PARTICLES, Math.round(300 * o.intensity));
    var colors = [o.c1, o.c2, '#ffffff', lighten(o.c1, 0.5), lighten(o.c2, 0.5)];
    var ps = [];
    for (var i = 0; i < n; i++) {
      ps.push({ x: rnd(-20, W + 20), y: -rnd(10, H * 0.3), vy: rnd(230, 470) * (H / 800), sw: rnd(10, 50), sf: rnd(2, 6), ph: rnd(0, 6.28),
        w: rnd(4, 7) * K, h: rnd(14, 34) * K, rot: rnd(0, 6.28), vr: rnd(-4, 4), c: pick(colors), age: 0, delay: rnd(0, 0.2) });
    }
    return {
      update: function (dt, t) {
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (t < p.delay * 0.5) continue;
          p.age += dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        }
      },
      draw: function (ctx, W2, H2, t) {
        var fade = t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.2) : 1;
        ctx.globalAlpha = fade;
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (t < p.delay * 0.5 || p.y > H2 + 30) continue;
          var x = p.x + Math.sin(p.age * p.sf + p.ph) * p.sw;
          ctx.save();
          ctx.translate(x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(Math.abs(Math.cos(p.age * 5 + p.ph)) * 0.8 + 0.2, 1);
          ctx.fillStyle = p.c;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  function makeBengalas(W, H, o) {
    // Bengalas de tribuna: luz que titila, chispas que suben y humo.
    var flares = Math.max(2, Math.min(5, Math.round(3 * o.intensity)));
    var list = [];
    for (var f = 0; f < flares; f++) {
      var fl = { x: W * (0.12 + (0.76 * (f + 0.5)) / flares) + rnd(-20, 20), y: H * rnd(0.9, 0.98), seed: rnd(0, 6.28), sparks: [], smoke: [] };
      for (var k = 0; k < 34; k++) fl.sparks.push({ x: fl.x, y: fl.y, vx: rnd(-50, 50), vy: -rnd(120, 420) * (H / 800), life: rnd(0.5, 1.3), age: -rnd(0, 1.4) });
      for (var j = 0; j < 18; j++) fl.smoke.push({ x: fl.x + rnd(-20, 20), y: fl.y - 10, vx: rnd(-26, 26), vy: -rnd(40, 120) * (H / 800), r: rnd(24, 50), age: -rnd(0, 1.2), life: rnd(1.4, 2.3) });
      list.push(fl);
    }
    return {
      update: function (dt) {
        for (var i = 0; i < list.length; i++) {
          var fl = list[i], a, k;
          for (k = 0; k < fl.sparks.length; k++) {
            a = fl.sparks[k]; a.age += dt;
            if (a.age < 0) continue;
            a.vy += 260 * dt; a.x += a.vx * dt; a.y += a.vy * dt;
          }
          for (k = 0; k < fl.smoke.length; k++) {
            a = fl.smoke[k]; a.age += dt;
            if (a.age < 0) continue;
            a.x += a.vx * dt; a.y += a.vy * dt; a.r += 18 * dt;
          }
        }
      },
      draw: function (ctx, W2, H2, t) {
        var env = Math.min(1, t / 0.08) * (t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.2) : 1);
        var i, k, a, fl;
        // Humo primero (por debajo de la luz).
        for (i = 0; i < list.length; i++) {
          fl = list[i];
          for (k = 0; k < fl.smoke.length; k++) {
            a = fl.smoke[k];
            if (a.age < 0 || a.age > a.life) continue;
            var l = 1 - a.age / a.life;
            ctx.fillStyle = rgba(lighten(o.c1, 0.55), 0.16 * l * env);
            ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 6.283); ctx.fill();
          }
        }
        ctx.globalCompositeOperation = 'lighter';
        for (i = 0; i < list.length; i++) {
          fl = list[i];
          var flick = 0.78 + 0.22 * Math.sin(t * 60 + fl.seed) * Math.sin(t * 23 + fl.seed * 2);
          var R = Math.max(W2, H2) * 0.3 * flick;
          var g = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, R);
          g.addColorStop(0, rgba(lighten(o.c1, 0.4), 0.85 * env));
          g.addColorStop(0.2, rgba(o.c1, 0.5 * env));
          g.addColorStop(1, rgba(o.c1, 0));
          ctx.fillStyle = g;
          ctx.fillRect(fl.x - R, fl.y - R, R * 2, R * 2);
          for (k = 0; k < fl.sparks.length; k++) {
            a = fl.sparks[k];
            if (a.age < 0 || a.age > a.life) continue;
            var sl = 1 - a.age / a.life;
            ctx.fillStyle = rgba(k % 3 ? o.c2 : '#ffffff', sl * env);
            ctx.fillRect(a.x - 2.2, a.y - 2.2, 4.4, 4.4);
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  function makeStars(W, H, o) {
    var n = Math.min(300, Math.round(110 * o.intensity));
    var colors = [o.c1, o.c2, '#ffffff', lighten(o.c1, 0.6)];
    var ps = [];
    for (var i = 0; i < n; i++) {
      var a = rnd(0, 6.283), v = rnd(120, 900) * (H / 800);
      ps.push({ x: W / 2, y: H * 0.45, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: rnd(10, 32) * Math.max(0.8, Math.min(1.8, H / 700)), rot: rnd(0, 6.28), vr: rnd(-3, 3), c: pick(colors), tw: rnd(0, 6.28), delay: rnd(0, 0.2), five: Math.random() < 0.4 });
    }
    return {
      update: function (dt, t) {
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (t < p.delay) continue;
          p.vx *= 1 - 1.5 * dt; p.vy = p.vy * (1 - 1.5 * dt) + 90 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        }
      },
      draw: function (ctx, W2, H2, t) {
        var fade = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (t < p.delay) continue;
          var tw = 0.55 + 0.45 * Math.sin(t * 28 + p.tw);
          var r = p.s * tw;
          ctx.fillStyle = rgba(p.c, 0.9 * fade * tw);
          ctx.beginPath();
          var pts = p.five ? 5 : 4, inner = p.five ? 0.45 : 0.28;
          for (var k = 0; k < pts * 2; k++) {
            var rr = k % 2 ? r * inner : r, ang = p.rot + (k * Math.PI) / pts;
            var px = p.x + Math.cos(ang) * rr, py = p.y + Math.sin(ang) * rr;
            if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  function makeRings(W, H, o) {
    var cx = W / 2, cy = H * 0.5, R = Math.sqrt(W * W + H * H) * 0.55;
    var n = Math.max(4, Math.round(7 * o.intensity));
    return {
      update: function () {},
      draw: function (ctx, W2, H2, t) {
        ctx.globalCompositeOperation = 'lighter';
        for (var k = 0; k < n; k++) {
          var tt = (t - k * 0.07) / 0.7;
          if (tt <= 0 || tt >= 1) continue;
          var r = R * easeOutCubic(tt), a = 1 - tt;
          var col = k % 2 ? o.c2 : o.c1;
          ctx.lineWidth = 14 * a + 2;
          ctx.strokeStyle = rgba(col, 0.28 * a);
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.stroke();
          ctx.lineWidth = 3;
          ctx.strokeStyle = rgba(lighten(col, 0.6), 0.9 * a);
          ctx.setLineDash(k % 3 === 0 ? [18, 14] : []);
          ctx.lineDashOffset = -t * 260 * (k % 2 ? 1 : -1);
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  function makeGlitch(W, H, o) {
    var pat = null;
    return {
      update: function () {},
      draw: function (ctx, W2, H2, t) {
        // Cambia de «cuadro» unas 24 veces por segundo, no en cada dibujo.
        var step = Math.floor(t * 26);
        var seed = step * 9301 + 49297;
        function r() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
        var env = t < 0.12 ? 1 : Math.max(0, 1 - (t - 0.12) / 0.88);
        if (step % 5 === 0) { ctx.fillStyle = rgba('#ffffff', 0.18 * env); ctx.fillRect(0, 0, W2, H2); }
        ctx.globalCompositeOperation = 'lighter';
        var bars = Math.round((10 + 14 * o.intensity) * env) + 2;
        for (var i = 0; i < bars; i++) {
          var y = r() * H2, h = 2 + r() * H2 * 0.05, x = r() * W2 * 0.4, w = W2 * (0.2 + r() * 0.7);
          var pick3 = r();
          ctx.fillStyle = rgba(pick3 < 0.4 ? o.c1 : pick3 < 0.8 ? o.c2 : '#ffffff', 0.32 * env);
          ctx.fillRect(x, y, w, h);
          ctx.fillStyle = rgba(o.c2, 0.22 * env);
          ctx.fillRect(x + 8 * (r() - 0.5) * 6, y + 2, w, Math.max(1, h * 0.5));
        }
        ctx.globalCompositeOperation = 'source-over';
        // Líneas de monitor: un patrón chiquito que se repite (no se dibujan 300 rayas).
        if (!pat) {
          try {
            var c = ctx.canvas.ownerDocument.createElement('canvas');
            c.width = 4; c.height = 4;
            var g = c.getContext('2d');
            g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, 4, 1);
            pat = ctx.createPattern(c, 'repeat');
          } catch (e) { pat = false; }
        }
        if (pat) { ctx.globalAlpha = 0.7 * env; ctx.fillStyle = pat; ctx.fillRect(0, 0, W2, H2); ctx.globalAlpha = 1; }
      }
    };
  }

  function makeAurora(W, H, o) {
    var ribbons = [];
    var n = Math.max(3, Math.round(4 * o.intensity));
    var cols = [o.c1, o.c2, lighten(o.c1, 0.35), lighten(o.c2, 0.35)];
    for (var i = 0; i < n; i++) ribbons.push({ y: H * (0.12 + 0.13 * i), amp: rnd(26, 70), f: rnd(0.004, 0.009), sp: rnd(1.5, 3.4) * (i % 2 ? 1 : -1), ph: rnd(0, 6.28), th: H * rnd(0.22, 0.34), c: cols[i % cols.length] });
    return {
      update: function () {},
      draw: function (ctx, W2, H2, t) {
        var env = Math.min(1, t / 0.18) * (t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.25) : 1);
        ctx.globalCompositeOperation = 'lighter';
        var step = 28;
        for (var i = 0; i < ribbons.length; i++) {
          var b = ribbons[i];
          var g = ctx.createLinearGradient(0, b.y - b.amp, 0, b.y + b.th);
          g.addColorStop(0, rgba(b.c, 0));
          g.addColorStop(0.18, rgba(b.c, 0.5 * env));
          g.addColorStop(1, rgba(b.c, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          var x, y;
          for (x = 0; x <= W2 + step; x += step) {
            y = b.y + Math.sin(x * b.f + t * b.sp * 3 + b.ph) * b.amp + Math.sin(x * b.f * 2.3 - t * 2 + b.ph) * b.amp * 0.4;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          for (x = W2 + step; x >= 0; x -= step) {
            y = b.y + b.th + Math.sin(x * b.f * 0.8 + t * b.sp * 2 + b.ph) * b.amp * 0.8;
            ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  function makeMeteors(W, H, o) {
    var n = Math.min(80, Math.round(34 * o.intensity));
    var ps = [];
    var ang = 2.55; // hacia abajo y a la izquierda
    for (var i = 0; i < n; i++) {
      ps.push({ x: rnd(W * 0.1, W * 1.3), y: -rnd(10, H * 0.5), v: rnd(900, 1900) * (H / 800), len: rnd(160, 420), at: rnd(0, 0.45), w: rnd(3, 7), c: pick([o.c1, o.c2, '#ffffff']) });
    }
    var dx = Math.cos(ang), dy = Math.sin(ang);
    return {
      update: function (dt, t) {
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (t < p.at) continue;
          p.x += dx * p.v * dt; p.y += dy * p.v * dt;
        }
      },
      draw: function (ctx, W2, H2, t) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (t < p.at || p.y > H2 + 60 || p.x < -60) continue;
          var tx = p.x - dx * p.len, ty = p.y - dy * p.len;
          var g = ctx.createLinearGradient(p.x, p.y, tx, ty);
          g.addColorStop(0, rgba(p.c, 0.95));
          g.addColorStop(1, rgba(p.c, 0));
          ctx.strokeStyle = g; ctx.lineWidth = p.w;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tx, ty); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,.95)';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.w * 0.9, 0, 6.283); ctx.fill();
        }
        ctx.lineCap = 'butt';
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  function makePixels(W, H, o) {
    // Retro de 8 bits: cuadraditos que se mueven a pasos, como en una consola vieja.
    var n = Math.min(300, Math.round(140 * o.intensity));
    var colors = [o.c1, o.c2, '#ffffff', lighten(o.c1, 0.5)];
    var ps = [], last = -1;
    for (var i = 0; i < n; i++) {
      var a = rnd(0, 6.283), v = rnd(160, 820) * (H / 800);
      ps.push({ x: W / 2, y: H * 0.45, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, s: pick([8, 12, 16, 20]), c: pick(colors) });
    }
    return {
      update: function (dt, t) {
        var step = Math.floor(t * 16);
        if (step === last) return;
        var d = (step - last) / 16 * (o.duration / 1000);
        last = step;
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          p.vy += 900 * d; p.vx *= 1 - 0.7 * d;
          p.x += p.vx * d; p.y += p.vy * d;
        }
      },
      draw: function (ctx, W2, H2, t) {
        var fade = t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.25) : 1;
        ctx.globalAlpha = fade;
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (p.y > H2 + 30) continue;
          ctx.fillStyle = p.c;
          ctx.fillRect(Math.round(p.x / 4) * 4, Math.round(p.y / 4) * 4, p.s, p.s);
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  function makeBubbles(W, H, o) {
    var n = Math.min(140, Math.round(64 * o.intensity));
    var ps = [];
    for (var i = 0; i < n; i++) ps.push({ x: rnd(0, W), y: H + rnd(10, H * 0.7), r: rnd(8, 40), vy: -rnd(90, 320) * (H / 800), sw: rnd(8, 30), sf: rnd(1.5, 4), ph: rnd(0, 6.28), age: 0, c: Math.random() < 0.5 ? o.c1 : o.c2 });
    return {
      update: function (dt) {
        for (var i = 0; i < ps.length; i++) { var p = ps[i]; p.age += dt; p.y += p.vy * dt; }
      },
      draw: function (ctx, W2, H2, t) {
        var fade = t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.2) : 1;
        ctx.globalAlpha = fade;
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (p.y < -60) continue;
          var x = p.x + Math.sin(p.age * p.sf + p.ph) * p.sw;
          ctx.fillStyle = rgba(p.c, 0.14);
          ctx.beginPath(); ctx.arc(x, p.y, p.r, 0, 6.283); ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = rgba(lighten(p.c, 0.5), 0.75);
          ctx.beginPath(); ctx.arc(x, p.y, p.r, 0, 6.283); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,.7)';
          ctx.beginPath(); ctx.arc(x, p.y, p.r * 0.7, 3.6, 4.5); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  var MAKERS = {
    confetti: makeConfetti, papelitos: makePapelitos, fireworks: makeFireworks, bengalas: makeBengalas, shockwave: makeShockwave,
    rings: makeRings, lightning: makeLightning, flames: makeFlames, coins: makeCoins, emojis: makeEmojis, beams: makeBeams,
    stars: makeStars, meteors: makeMeteors, aurora: makeAurora, bubbles: makeBubbles, pixels: makePixels, glitch: makeGlitch
  };

  /* ── Texto ─────────────────────────────────────────────────────────── */
  function fillFor(ctx, o, fs) {
    if (o.textStyle === 'solid') return o.textColor || o.c1;
    if (o.textStyle === 'neon') return '#ffffff';
    if (o.textStyle === 'outline') return 'rgba(0,0,0,0)';
    if (o.textColor) return o.textColor;
    var g = ctx.createLinearGradient(0, -fs * 0.5, 0, fs * 0.5);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, lighten(o.c2, 0.25));
    g.addColorStop(1, o.c1);
    return g;
  }

  /** Dibuja una línea con el estilo elegido, centrada en (0,0). */
  function paintLine(ctx, str, fs, o, x, y) {
    ctx.lineJoin = 'round';
    if (o.textStyle === 'neon') {
      var col = o.textColor || o.c1;
      ctx.shadowColor = rgba(col, 0.95);
      ctx.shadowBlur = fs * 0.5;
      ctx.lineWidth = fs * 0.07;
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.strokeText(str, x, y);
      ctx.shadowBlur = fs * 0.2;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(str, x, y);
      ctx.shadowBlur = 0;
      return;
    }
    if (o.textStyle === 'outline') {
      ctx.shadowColor = rgba(o.c1, 0.8);
      ctx.shadowBlur = fs * 0.25;
      ctx.lineWidth = fs * 0.09;
      ctx.strokeStyle = o.textColor || '#ffffff';
      ctx.strokeText(str, x, y);
      ctx.shadowBlur = 0;
      return;
    }
    ctx.shadowColor = rgba(o.c1, 0.9);
    ctx.shadowBlur = fs * 0.35;
    ctx.lineWidth = fs * 0.12;
    ctx.strokeStyle = 'rgba(8,10,18,.85)';
    ctx.strokeText(str, x, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = fillFor(ctx, o, fs);
    ctx.fillText(str, x, y);
  }

  function drawText(ctx, W, H, t, o) {
    if (!o.text && !o.name) return;
    var inT = Math.min(1, t / 0.14);
    var outT = t > 0.74 ? Math.max(0, 1 - (t - 0.74) / 0.26) : 1;
    var a = outT * Math.min(1, inT * 1.6);
    if (a <= 0) return;
    var size = Math.max(40, Math.min(W * 0.16, H * 0.2)) * o.textScale;
    var cx = W / 2, cy = H * POSITIONS[o.textPos];
    var anim = o.textAnim;
    var sc = 1, rot = 0, dx = 0, dy = 0;
    if (anim === 'pop') { sc = 0.35 + 0.65 * easeOutBack(inT); rot = inT < 1 ? Math.sin(t * 90) * (1 - inT) * 0.03 : Math.sin(t * 9) * 0.008; }
    else if (anim === 'slide') { dx = -(1 - easeOutCubic(Math.min(1, t / 0.2))) * W * 0.7; sc = 1; }
    else if (anim === 'drop') { var d = Math.min(1, t / 0.22); dy = -(1 - easeOutBounce(d)) * H * 0.6; }
    else if (anim === 'zoom') { sc = 3.2 - 2.2 * easeOutCubic(Math.min(1, t / 0.16)); }
    else if (anim === 'glitch') { sc = 1; dx = (Math.floor(t * 40) % 3 === 0 && t < 0.5) ? Math.sin(t * 900) * 14 : 0; }
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(cx + dx, cy + dy);
    ctx.scale(sc, sc);
    ctx.rotate(rot);
    var fs = size;
    if (o.text) {
      ctx.font = '900 ' + fs + 'px ' + o.font;
      var w = ctx.measureText(o.text).width;
      var maxW = W * 0.86;
      if (w > maxW) { fs = Math.floor(fs * maxW / w); ctx.font = '900 ' + fs + 'px ' + o.font; w = ctx.measureText(o.text).width; }
      if (anim === 'type') {
        var shown = Math.max(1, Math.ceil(o.text.length * Math.min(1, t / 0.3)));
        paintLine(ctx, o.text.slice(0, shown), fs, o, 0, 0);
      } else if (anim === 'wave') {
        var x0 = -w / 2;
        for (var i = 0; i < o.text.length; i++) {
          var ch = o.text.charAt(i), cw = ctx.measureText(ch).width;
          var yy = Math.sin(t * 14 - i * 0.6) * fs * 0.12 * (t < 0.7 ? 1 : 0.4);
          ctx.textAlign = 'left';
          paintLine(ctx, ch, fs, o, x0, yy);
          x0 += cw;
        }
        ctx.textAlign = 'center';
      } else if (anim === 'glitch') {
        var on = Math.floor(t * 30) % 4 === 0 && t < 0.6;
        if (on) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(o.c1, 0.8); ctx.fillText(o.text, -6, 2);
          ctx.fillStyle = rgba(o.c2, 0.8); ctx.fillText(o.text, 6, -2);
          ctx.globalCompositeOperation = 'source-over';
        }
        paintLine(ctx, o.text, fs, o, 0, 0);
      } else {
        paintLine(ctx, o.text, fs, o, 0, 0);
      }
    }
    if (o.name) {
      var nfs = Math.round(size * 0.26);
      ctx.font = '700 ' + nfs + 'px ' + o.font;
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.05;
      ctx.strokeStyle = 'rgba(8,10,18,.85)';
      ctx.fillStyle = '#ffffff';
      var ny = o.text ? size * 0.72 : 0;
      ctx.strokeText(o.name, 0, ny);
      ctx.fillText(o.name, 0, ny);
    }
    ctx.restore();
  }

  /** Borde de pantalla que se enciende con el color del festejo. */
  function drawVignette(ctx, W, H, t, o) {
    var k = t < 0.1 ? t / 0.1 : t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
    if (k <= 0) return;
    var g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, rgba(o.c1, 0));
    g.addColorStop(1, rgba(o.c1, 0.5 * k));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ── Motor ─────────────────────────────────────────────────────────── */
  function stop() {
    if (!active) return;
    active.dead = true;
    try { if (active.raf) active.win.cancelAnimationFrame(active.raf); } catch (e) { /* ya no hay ventana */ }
    try { active.canvas.remove(); } catch (e) { /* ya no estaba */ }
    active = null;
  }

  function play(doc, options) {
    if (!doc || !doc.body) return false;
    var win = doc.defaultView;
    if (!win || typeof win.requestAnimationFrame !== 'function') return false;
    stop();

    var o = normalize(options);
    var W = Math.max(320, win.innerWidth || 0), H = Math.max(240, win.innerHeight || 0);
    var dpr = Math.min(1.25, win.devicePixelRatio || 1);
    var canvas = doc.createElement('canvas');
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;';
    doc.body.append(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return false; }
    ctx.scale(dpr, dpr);

    // Capas: cada estilo extra pesa un poco menos para que el total no se dispare.
    var styles = [o.style].concat(o.layers);
    var share = styles.length > 1 ? 0.7 : 1;
    var fxs = [];
    for (var si = 0; si < styles.length; si++) {
      var po = si === 0 ? o : Object.assign({}, o);
      po.intensity = o.intensity * share;
      fxs.push(MAKERS[styles[si]](W, H, po));
    }
    var s = { win: win, canvas: canvas, raf: 0, dead: false };
    active = s;
    var start = 0, last = 0;

    function frame(now) {
      if (s.dead) return;
      s.raf = win.requestAnimationFrame(frame);
      if (!start) { start = now; last = now; }
      if (now - last < FRAME_MS) return; // el juego va a 1000 FPS; esto no
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      var t = (now - start) / o.duration;
      if (t >= 1) { if (active === s) stop(); else { s.dead = true; canvas.remove(); } return; }
      ctx.clearRect(0, 0, W, H);
      if (o.vignette) drawVignette(ctx, W, H, t, o);
      if (o.flash && t < 0.12) { ctx.fillStyle = 'rgba(255,255,255,' + (0.55 * (1 - t / 0.12)).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
      for (var k = 0; k < fxs.length; k++) { fxs[k].update(dt, t); fxs[k].draw(ctx, W, H, t); }
      drawText(ctx, W, H, t, o);
    }
    s.raf = win.requestAnimationFrame(frame);
    return true;
  }

  var api = { play: play, stop: stop, STYLES: STYLES, ANIMS: ANIMS, normalize: normalize };
  root.TLGoalFx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
