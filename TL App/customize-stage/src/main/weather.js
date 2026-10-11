/*
 * Clima sobre la cancha: lluvia, nieve, niebla, noche. Es sólo una capa de
 * dibujo en tu pantalla (no toca la física ni lo que ven los demás).
 * Una sola canvas transparente, ~30 cuadros por segundo, con partículas
 * livianas; se frena sola si el modo cambia o las animaciones están apagadas.
 */
'use strict';

const MODES = ['none', 'lluvia', 'nieve', 'niebla', 'noche'];

function install(doc, mode, level, animate) {
  if (!doc || !doc.body) return;
  const view = doc.defaultView;
  let st = doc.__tvmWeather;
  if (!MODES.includes(mode) || mode === 'none') {
    if (st) { st.stop(); doc.__tvmWeather = null; }
    return;
  }
  const lv = Math.min(1, Math.max(0.15, Number(level) || 0.6));
  if (st && st.mode === mode && st.animate === !!animate) { st.level = lv; return; }
  if (st) st.stop();

  const canvas = doc.createElement('canvas');
  canvas.id = 'tvm-weather';
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147480000;';
  doc.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const state = { mode, level: lv, animate: !!animate, canvas, raf: 0, parts: [], last: 0 };

  function resize() {
    canvas.width = Math.max(1, view.innerWidth);
    canvas.height = Math.max(1, view.innerHeight);
  }
  resize();
  view.addEventListener('resize', resize);

  function seed() {
    const n = mode === 'lluvia' ? 220 : mode === 'nieve' ? 140 : 0;
    state.parts = [];
    for (let i = 0; i < n; i++) {
      state.parts.push({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.9, s: Math.random() });
    }
  }
  seed();

  function paintStatic(w, h) {
    if (mode === 'niebla') {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, `rgba(210,220,230,${0.05 * state.level})`);
      g.addColorStop(1, `rgba(210,220,230,${0.45 * state.level})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'noche') {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.8);
      g.addColorStop(0, `rgba(8,16,48,${0.2 * state.level})`);
      g.addColorStop(1, `rgba(2,6,24,${0.8 * state.level})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function frame(t) {
    state.raf = view.requestAnimationFrame(frame);
    if (t - state.last < 33) return;
    const dt = Math.min(0.1, (t - state.last) / 1000);
    state.last = t;
    const w = canvas.width; const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    paintStatic(w, h);
    if (mode === 'lluvia') {
      ctx.strokeStyle = `rgba(190,210,240,${0.35 * state.level + 0.1})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const count = Math.floor(state.parts.length * state.level);
      for (let i = 0; i < count; i++) {
        const p = state.parts[i];
        p.y += p.v * dt * 1.6; p.x -= p.v * dt * 0.25;
        if (p.y > 1.05) { p.y = -0.05; p.x = Math.random() * 1.2; }
        if (p.x < -0.05) p.x = 1.05;
        const px = p.x * w; const py = p.y * h;
        ctx.moveTo(px, py);
        ctx.lineTo(px - 3, py + 14 + p.s * 10);
      }
      ctx.stroke();
    } else if (mode === 'nieve') {
      ctx.fillStyle = `rgba(255,255,255,${0.55 * state.level + 0.2})`;
      const count = Math.floor(state.parts.length * state.level);
      for (let i = 0; i < count; i++) {
        const p = state.parts[i];
        p.y += p.v * dt * 0.12; p.x += Math.sin((t / 900) + p.s * 6) * dt * 0.02;
        if (p.y > 1.03) { p.y = -0.03; p.x = Math.random(); }
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 1.2 + p.s * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (state.animate && (mode === 'lluvia' || mode === 'nieve')) state.raf = view.requestAnimationFrame(frame);
  else { paintStatic(canvas.width, canvas.height); }

  state.stop = () => {
    try { view.cancelAnimationFrame(state.raf); view.removeEventListener('resize', resize); canvas.remove(); } catch (e) { /* documento ya cerrado */ }
  };
  state.mode = mode;
  doc.__tvmWeather = state;
}

module.exports = { MODES, install };
