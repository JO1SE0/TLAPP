/*
 * Partículas doradas del menú: motitas de luz que flotan despacio sobre la lista
 * de salas y los replays.
 *
 * Barato a propósito: unas 40 partículas, un sprite precalculado (nada de
 * gradientes por cuadro), tope de 30 cuadros por segundo, y el bucle se PARA solo
 * cuando no se ven: durante la partida, con la ventana oculta, con el panel
 * abierto o con el interruptor apagado. No queda nada corriendo.
 */
(function () {
  'use strict';

  const COUNT = 40;
  let count = COUNT;
  const FRAME_MS = 1000 / 30;
  // El lienzo se dibuja a la mitad de resolución y el navegador lo estira: son motas suaves, no se nota,
  // y se pintan/componen 4 veces menos píxeles por cuadro.
  const S = 0.5;
  let check = 0;
  let canvas = null;
  let ctx = null;
  let sprite = null;
  let sprites = [];
  let style = 'oro';
  let parts = [];
  let raf = 0;
  let last = 0;
  let enabled = false;
  let w = 0;
  let h = 0;

  function glow(c0, c1, c2) {
    const s = document.createElement('canvas');
    s.width = s.height = 32;
    const c = s.getContext('2d');
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, c0);
    g.addColorStop(0.25, c1);
    g.addColorStop(1, c2);
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    return s;
  }

  function star() {
    const s = document.createElement('canvas');
    s.width = s.height = 32;
    const c = s.getContext('2d');
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(16, 1); c.lineTo(18.2, 13.8); c.lineTo(31, 16); c.lineTo(18.2, 18.2);
    c.lineTo(16, 31); c.lineTo(13.8, 18.2); c.lineTo(1, 16); c.lineTo(13.8, 13.8);
    c.closePath();
    c.fill();
    return s;
  }

  function chip(color) {
    const s = document.createElement('canvas');
    s.width = 12; s.height = 20;
    const c = s.getContext('2d');
    c.fillStyle = color;
    c.fillRect(2, 2, 8, 16);
    return s;
  }

  function petal(color) {
    const s = document.createElement('canvas');
    s.width = 16; s.height = 24;
    const c = s.getContext('2d');
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(8, 12, 5, 10, 0, 0, Math.PI * 2);
    c.fill();
    return s;
  }

  /** Todos los dibujos se hacen una sola vez; por cuadro solo se copian. */
  function makeSprites(kind) {
    if (kind === 'estrellas') return [star()];
    if (kind === 'luciernagas') return [glow('rgba(235,255,170,1)', 'rgba(170,240,90,0.6)', 'rgba(120,220,60,0)')];
    if (kind === 'nieve') return [glow('rgba(255,255,255,1)', 'rgba(235,245,255,0.7)', 'rgba(220,235,255,0)')];
    if (kind === 'brasas') return [glow('rgba(255,235,170,1)', 'rgba(255,140,40,0.75)', 'rgba(255,80,0,0)'), glow('rgba(255,210,140,1)', 'rgba(255,100,30,0.6)', 'rgba(220,50,0,0)')];
    if (kind === 'neon') return [glow('rgba(190,255,255,1)', 'rgba(60,220,255,0.6)', 'rgba(0,160,255,0)'), glow('rgba(255,200,255,1)', 'rgba(255,70,230,0.55)', 'rgba(200,0,255,0)'), glow('rgba(215,200,255,1)', 'rgba(140,100,255,0.55)', 'rgba(90,40,255,0)')];
    if (kind === 'petalos') return ['#ffb3c7', '#ff8fb1', '#ffd1dc'].map(petal);
    if (kind === 'confeti') return ['#f2c14e', '#e8505b', '#4ea8de', '#6fcf97', '#c77dff'].map(chip);
    return [glow('rgba(255,240,190,1)', 'rgba(240,210,130,0.55)', 'rgba(208,184,120,0)')];
  }

  function spawn(p, anywhere) {
    const down = style === 'nieve' || style === 'confeti' || style === 'petalos';
    p.x = Math.random() * w;
    p.y = anywhere ? Math.random() * h : (down ? -20 : h + 20);
    p.r = 2 + Math.random() * 5;
    if (style === 'nieve') { p.r = 1.5 + Math.random() * 3.5; p.vy = 14 + Math.random() * 22; }
    else if (style === 'confeti') { p.r = 3 + Math.random() * 3; p.vy = 30 + Math.random() * 40; }
    else if (style === 'petalos') { p.r = 3 + Math.random() * 3; p.vy = 18 + Math.random() * 24; }
    else if (style === 'brasas') { p.r = 1.5 + Math.random() * 3.5; p.vy = -(22 + Math.random() * 38); }
    else if (style === 'luciernagas') { p.vy = (Math.random() - 0.5) * 10; }
    else p.vy = -(6 + Math.random() * 14); // píxeles por segundo, hacia arriba
    p.vx = (Math.random() - 0.5) * (style === 'luciernagas' ? 14 : style === 'petalos' ? 24 : style === 'brasas' ? 16 : 6);
    p.ph = Math.random() * Math.PI * 2;
    p.sp = 0.6 + Math.random() * 1.2;
    p.a = 0.25 + Math.random() * 0.45;
    p.k = Math.floor(Math.random() * sprites.length);
    return p;
  }

  function resize() {
    if (!canvas) return;
    w = window.innerWidth;
    h = window.innerHeight;
    const cw = Math.ceil(w * S);
    const ch = Math.ceil(h * S);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      if (ctx) ctx.setTransform(S, 0, 0, S, 0, 0);
    }
  }

  /** ¿Hay algo para mostrar ahora mismo? */
  function visible() {
    const app = document.getElementById('app');
    if (!enabled || document.hidden || !app) return false;
    if (app.dataset.stage === 'game') return false;
    if (document.getElementById('welcome')) return false;
    const panel = document.getElementById('panel');
    if (panel && !panel.hidden && panel.offsetParent !== null) return false;
    return true;
  }

  function frame(now) {
    raf = 0;
    // `visible()` toca el DOM (offsetParent fuerza recalcular estilos): se mira cada ~2 s, no en cada cuadro.
    // Los cambios de pantalla, panel y ventana ya avisan solos (ver `sync`).
    if (--check <= 0) { check = 60; if (!visible()) { stop(); return; } }
    raf = requestAnimationFrame(frame);
    if (now - last < FRAME_MS) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, w, h);
    const t = now / 1000;
    for (const p of parts) {
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(t * p.sp + p.ph) * 4) * dt;
      const off = style === 'nieve' || style === 'confeti' || style === 'petalos' ? p.y > h + 20 : p.y < -20;
      if (style === 'luciernagas') {
        // Vagan sin irse de la pantalla: rebotan suave en los bordes.
        if (p.y < 0 || p.y > h) p.vy = -p.vy;
        if (p.x < 0) p.x = w; else if (p.x > w) p.x = 0;
      } else if (off || p.x < -20 || p.x > w + 20) spawn(p, false);
      const sp = sprites[p.k];
      if (style === 'confeti' || style === 'petalos') {
        const rot = t * p.sp * 2 + p.ph;
        const sx = Math.abs(Math.cos(rot)); // el giro en 3D se finge achicando el ancho
        ctx.globalAlpha = style === 'petalos' ? 0.7 : 0.85;
        ctx.setTransform(sx * S, 0, 0, S, p.x * S, p.y * S);
        ctx.drawImage(sp, -p.r, -p.r * 1.6, p.r * 2, p.r * 3.2);
        ctx.setTransform(S, 0, 0, S, 0, 0);
        continue;
      }
      const tw = style === 'luciernagas'
        ? Math.max(0, Math.sin(t * p.sp * 1.3 + p.ph)) // prenden y apagan
        : 0.6 + 0.4 * Math.sin(t * p.sp * 1.7 + p.ph);
      const fade = style === 'oro' || style === 'estrellas' || style === 'brasas' || style === 'neon' ? Math.min(1, Math.max(0, p.y / 120)) : 1;
      ctx.globalAlpha = p.a * tw * fade * (style === 'nieve' ? 1.6 : 1);
      const sz = p.r * (style === 'estrellas' ? 3 : 4);
      ctx.drawImage(sp, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  function start() {
    if (raf || !canvas) return;
    canvas.hidden = false;
    check = 60;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ctx) ctx.clearRect(0, 0, w, h);
    if (canvas) canvas.hidden = true;
  }

  /** Vuelve a mirar si corresponde andar: se llama cuando cambia algo de la pantalla. */
  function sync() {
    if (visible()) start();
    else stop();
  }

  function init() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'sparks';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.hidden = true;
    document.body.append(canvas);
    ctx = canvas.getContext('2d', { alpha: true });
    sprites = makeSprites(style);
    resize();
    parts = Array.from({ length: count }, () => spawn({}, true));
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', sync);
    // La pantalla cambia entre menú y partida con atributos del #app.
    const app = document.getElementById('app');
    if (app) new MutationObserver(sync).observe(app, { attributes: true, attributeFilter: ['data-stage', 'data-view'] });
    const panel = document.getElementById('panel');
    if (panel) new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  }

  window.addEventListener('tl:welcome-done', () => sync());

  window.TLSparks = {
    setStyle(kind) {
      const k = ['oro', 'estrellas', 'luciernagas', 'nieve', 'confeti', 'brasas', 'neon', 'petalos'].includes(kind) ? kind : 'oro';
      if (k === style && sprites.length) return;
      style = k;
      sprites = makeSprites(k);
      if (parts.length) parts = parts.map(() => spawn({}, true));
    },
    setDensity(n) {
      count = Math.max(10, Math.min(120, Number(n) || COUNT));
      if (parts.length > count) parts.length = count;
      while (parts.length && parts.length < count) parts.push(spawn({}, true));
    },
    setEnabled(on) {
      enabled = !!on;
      if (enabled) init();
      sync();
    }
  };
})();
