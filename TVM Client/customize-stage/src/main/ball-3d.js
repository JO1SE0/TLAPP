'use strict';

// Small Canvas-only effect: no WebGL context, timers or changes to game physics.
const rolls = new WeakMap();
function motion(ctx, x, y, radius, now) {
  let s = rolls.get(ctx);
  if (!s || now - s.at > 500 || Math.hypot(x - s.x, y - s.y) > radius * 12) {
    s = { x, y, at: now, a: 0, b: 0 };
    rolls.set(ctx, s);
  }
  s.a = (s.a + (x - s.x) / radius) % (Math.PI * 2);
  s.b = (s.b - (y - s.y) / radius) % (Math.PI * 2);
  s.x = x; s.y = y; s.at = now;
  return s;
}
function surface(ctx, x, y, r, s) {
  // Use Path2D so the game's current circle remains intact for its outline.
  const Path = ctx.canvas.ownerDocument.defaultView.Path2D;
  const ca = Math.cos(s.a), sa = Math.sin(s.a), cb = Math.cos(s.b), sb = Math.sin(s.b);
  ctx.strokeStyle = 'rgba(25,30,40,0.7)';
  ctx.lineWidth = Math.max(0.5, r * 0.07);
  for (let axis = 0; axis < 3; axis++) {
    const line = new Path();
    let visible = false;
    for (let i = 0; i <= 48; i++) {
      const t = i * Math.PI / 24;
      const p = axis === 0 ? [0, Math.cos(t), Math.sin(t)]
        : axis === 1 ? [Math.cos(t), 0, Math.sin(t)] : [Math.cos(t), Math.sin(t), 0];
      const px = ca * p[0] + sa * p[2];
      const z = -sa * p[0] + ca * p[2];
      const py = cb * p[1] - sb * z, pz = sb * p[1] + cb * z;
      if (pz >= 0) {
        if (visible) line.lineTo(x + px * r, y + py * r);
        else line.moveTo(x + px * r, y + py * r);
      }
      visible = pz >= 0;
    }
    ctx.stroke(line);
  }
}
function shade(ctx, x, y, r) {
  const light = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  light.addColorStop(0, 'rgba(255,255,255,0.5)');
  light.addColorStop(0.45, 'rgba(255,255,255,0.04)');
  light.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = light;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
module.exports = { motion, surface, shade };
