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
  const FRAME_MS = 1000 / 30;
  let canvas = null;
  let ctx = null;
  let sprite = null;
  let parts = [];
  let raf = 0;
  let last = 0;
  let enabled = false;
  let w = 0;
  let h = 0;

  function makeSprite() {
    const s = document.createElement('canvas');
    s.width = s.height = 32;
    const c = s.getContext('2d');
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,240,190,1)');
    g.addColorStop(0.25, 'rgba(240,210,130,0.55)');
    g.addColorStop(1, 'rgba(208,184,120,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    return s;
  }

  function spawn(p, anywhere) {
    p.x = Math.random() * w;
    p.y = anywhere ? Math.random() * h : h + 20;
    p.r = 2 + Math.random() * 5;
    p.vy = -(6 + Math.random() * 14); // píxeles por segundo, hacia arriba
    p.vx = (Math.random() - 0.5) * 6;
    p.ph = Math.random() * Math.PI * 2;
    p.sp = 0.6 + Math.random() * 1.2;
    p.a = 0.25 + Math.random() * 0.45;
    return p;
  }

  function resize() {
    if (!canvas) return;
    w = window.innerWidth;
    h = window.innerHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /** ¿Hay algo para mostrar ahora mismo? */
  function visible() {
    const app = document.getElementById('app');
    if (!enabled || document.hidden || !app) return false;
    if (app.dataset.stage === 'game') return false;
    const panel = document.getElementById('panel');
    if (panel && !panel.hidden && panel.offsetParent !== null) return false;
    return true;
  }

  function frame(now) {
    raf = 0;
    if (!visible()) { stop(); return; }
    raf = requestAnimationFrame(frame);
    if (now - last < FRAME_MS) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(now / 1000 * p.sp + p.ph) * 4) * dt;
      if (p.y < -20 || p.x < -20 || p.x > w + 20) spawn(p, false);
      // Titila despacio y se apaga al acercarse al borde de arriba.
      const tw = 0.6 + 0.4 * Math.sin(now / 1000 * p.sp * 1.7 + p.ph);
      const fade = Math.min(1, Math.max(0, p.y / 120));
      ctx.globalAlpha = p.a * tw * fade;
      const s = p.r * 4;
      ctx.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function start() {
    if (raf || !canvas) return;
    canvas.hidden = false;
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
    ctx = canvas.getContext('2d');
    sprite = makeSprite();
    resize();
    parts = Array.from({ length: COUNT }, () => spawn({}, true));
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', sync);
    // La pantalla cambia entre menú y partida con atributos del #app.
    const app = document.getElementById('app');
    if (app) new MutationObserver(sync).observe(app, { attributes: true, attributeFilter: ['data-stage', 'data-view'] });
    const panel = document.getElementById('panel');
    if (panel) new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  }

  window.TLSparks = {
    setEnabled(on) {
      enabled = !!on;
      if (enabled) init();
      sync();
    }
  };
})();
