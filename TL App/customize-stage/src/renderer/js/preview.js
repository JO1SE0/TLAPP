/*
 * Vista previa de Personalización: una mini cancha que se dibuja con los mismos
 * dibujos que usa el juego (look.js) y con la config actual, para ver cómo queda
 * una ficha, la pelota o la cancha sin salir del panel.
 *
 * No es el juego: es una escena fija parecida (cancha de HaxBall, tu ficha, otra
 * ficha, la pelota). Sólo importa que lo que se toca se note.
 */
(function () {
  'use strict';
  const L = window.module && window.module.exports;
  try { delete window.module; } catch (e) { window.module = undefined; }
  if (!L || !L.discOverlay) return;

  const FONTS = {
    outfit: 'Outfit, system-ui, sans-serif',
    mono: 'Consolas, "Courier New", monospace',
    serif: 'Georgia, "Times New Roman", serif',
    round: '"Comic Sans MS", "Comic Neue", cursive',
    impact: 'Impact, "Arial Black", sans-serif'
  };
  const TAU = Math.PI * 2;
  const HALF_W = 300;
  const HALF_H = 150;

  function css(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function rgb(color) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || '').trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    if (!x || !y) return a;
    const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function rounded(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function num(v, lo, hi, fb) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb;
  }

  function draw(canvas, cfg) {
    if (!canvas || !cfg) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const V = cfg.visual || {};
    const P = cfg.pitch || {};
    const skin = P.skin || {};
    const sc = (W - 28) / (2 * HALF_W);
    const px = 1 / sc;

    const pitchLine = num(V.pitchLine, 0.3, 4, 1);
    const discLine = num(V.discLine, 0.3, 4, 1);
    const ballLine = num(V.ballLine, 0.3, 4, 1);
    const discSize = num(V.discSize, 0.5, 2, 1);
    const ballSize = num(V.ballSize, 0.5, 2, 1);
    const lineColor = L.safeColor(V.lineColor) || '#c7e6bd';
    const postColor = L.safeColor(V.postColor) || '#ffffff';
    const discOutline = L.safeColor(V.discOutline) || '#000000';
    const ballOutline = L.safeColor(V.ballOutline) || '#000000';
    const tex = L.textureSpec(V.texture);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);

    /* ── Cancha de HaxBall, sin retocar ─────────────────────────────── */
    ctx.fillStyle = '#586f45';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(sc, 0, 0, sc, W / 2, H / 2);
    const world = ctx.getTransform();
    ctx.beginPath();
    rounded(ctx, -HALF_W, -HALF_H, 2 * HALF_W, 2 * HALF_H, 6);
    ctx.fillStyle = '#718c5a';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    const bands = 12;
    const bw = (2 * HALF_W) / bands;
    for (let i = 0; i < bands; i += 2) ctx.fillRect(-HALF_W + i * bw, -HALF_H, bw, 2 * HALF_H);
    ctx.restore();

    ctx.lineWidth = 3 * pitchLine;
    ctx.strokeStyle = lineColor;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    rounded(ctx, -HALF_W, -HALF_H, 2 * HALF_W, 2 * HALF_H, 6);
    ctx.moveTo(0, -HALF_H);
    ctx.lineTo(0, HALF_H);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, TAU);
    ctx.stroke();
    // Arcos: dos palos y la línea de gol entre ellos.
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sx * HALF_W, -62);
      ctx.lineTo(sx * HALF_W, 62);
      ctx.stroke();
      for (const sy of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * HALF_W, sy * 62, 7, 0, TAU);
        ctx.fillStyle = postColor;
        ctx.fill();
        ctx.lineWidth = 2 * pitchLine;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.lineWidth = 3 * pitchLine;
        ctx.strokeStyle = lineColor;
      }
    }

    /* ── Color, textura y luz: la misma receta que en el juego ──────── */
    const modeOn = skin.mode === 'theme' || skin.mode === 'custom';
    let field = null;
    let outside = null;
    let strength = num(skin.strength, 0, 1, 0.8);
    let brightness = 0;
    let stripes = 0;
    if (modeOn) {
      if (skin.mode === 'custom') {
        field = L.safeColor(skin.color) || null;
        outside = L.safeColor(skin.outside) || field;
      } else {
        const accent = css('--accent', '#8c702a');
        const bg = css('--bg-0', '#0b1426');
        field = mix(accent, bg, 0.55);
        outside = bg;
      }
      brightness = num(skin.brightness, -0.6, 0.6, 0);
      stripes = Math.round(num(skin.stripes, 0, 24, 0));
    } else if (tex) {
      field = tex.tint;
      outside = tex.tint;
      strength = tex.strength;
      brightness = tex.lum || 0;
    }

    const tint = (region, color) => {
      ctx.save();
      ctx.setTransform(world);
      ctx.beginPath();
      if (region === 'out') ctx.rect(-W * 2, -H * 2, W * 4, H * 4);
      rounded(ctx, -HALF_W, -HALF_H, 2 * HALF_W, 2 * HALF_H, 6);
      ctx.clip(region === 'out' ? 'evenodd' : 'nonzero');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'color';
      ctx.globalAlpha = strength;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    };
    if (field && outside && outside !== field) {
      tint('in', field);
      tint('out', outside);
    } else if (field) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'color';
      ctx.globalAlpha = strength;
      ctx.fillStyle = field;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (stripes) {
      ctx.save();
      ctx.setTransform(world);
      ctx.beginPath();
      rounded(ctx, -HALF_W, -HALF_H, 2 * HALF_W, 2 * HALF_H, 6);
      ctx.clip();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgb(220,220,220)';
      const band = (2 * HALF_W) / stripes;
      for (let i = 0; i < stripes; i += 2) ctx.fillRect(-HALF_W + i * band, -HALF_H, band, 2 * HALF_H);
      ctx.restore();
    }

    if (tex) {
      ctx.save();
      try {
        ctx.setTransform(world);
        ctx.beginPath();
        rounded(ctx, -HALF_W, -HALF_H, 2 * HALF_W, 2 * HALF_H, 6);
        ctx.clip();
        L.paintTexture(ctx, world, { x: -W * 2 * px, y: -H * 2 * px, w: W * 4 * px, h: H * 4 * px }, tex.tile);
      } finally {
        ctx.restore();
      }
    }

    if (brightness) {
      const level = Math.round(255 * (1 - Math.abs(brightness)));
      const gray = brightness < 0 ? level : 255 - level;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = brightness < 0 ? 'multiply' : 'screen';
      ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    /* ── Fichas, pelota y nombres ───────────────────────────────────── */
    ctx.setTransform(sc, 0, 0, sc, W / 2, H / 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineJoin = 'round';

    const accent = css('--accent', '#d0b878');
    const nick = String((cfg.general && cfg.general.nickname) || '').trim() || 'Vos';
    const discs = [
      { x: -120, y: 25, team: '#e56e56', name: nick, mine: true },
      { x: 95, y: -50, team: '#5689e5', name: 'Rival' },
      { x: -25, y: -80, team: '#e56e56', name: 'Amigo' }
    ];
    const r0 = 15 * discSize;

    // Detrás de las fichas: el aro y la cola de tu ficha.
    const me = discs[0];
    if (V.selfTrail) {
      const c = L.safeColor(V.selfTrailColor) || accent;
      for (let i = 6; i >= 1; i--) {
        ctx.globalAlpha = 0.5 * (1 - i / 7);
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(me.x - i * 13, me.y + i * 2.5, r0 * (1 - i * 0.09), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const wantRing = P.selfRing || (V.ringStyle && V.ringStyle !== 'default') || !!V.ringColor;
    if (wantRing) {
      const col = L.safeColor(V.ringColor) || accent;
      if (!L.drawRing(ctx, V.ringStyle, col, me.x, me.y, r0, px)) {
        ctx.beginPath();
        ctx.lineWidth = 4.5 * px;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.arc(me.x, me.y, r0 + 4 * px, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.lineWidth = 2.4 * px;
        ctx.strokeStyle = col;
        ctx.arc(me.x, me.y, r0 + 4 * px, 0, TAU);
        ctx.stroke();
      }
    }

    for (const d of discs) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, r0, 0, TAU);
      ctx.fillStyle = d.team;
      ctx.fill();
      // El estilo de ficha es sólo de la tuya, igual que en el juego.
      if (d.mine && V.discStyle && V.discStyle !== 'default') L.discOverlay(ctx, V.discStyle, d.x, d.y, r0, null);
      ctx.lineWidth = 2 * discLine;
      ctx.strokeStyle = discOutline;
      ctx.stroke();
    }

    // La pelota.
    const br = 10 * ballSize;
    ctx.beginPath();
    ctx.arc(-55, 38, br, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2 * ballLine;
    ctx.strokeStyle = ballOutline;
    ctx.stroke();

    // Nombres.
    const scale = num(V.nameScale, 0.6, 2, 1);
    const family = FONTS[V.nameFont] || FONTS.outfit;
    ctx.font = `600 ${(13 * scale).toFixed(1)}px ${family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const d of discs) {
      const y = d.y - r0 - 5;
      if (V.nameOutline) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(d.name, d.x, y);
      }
      ctx.fillStyle = L.safeColor(V.nameColor) || '#ffffff';
      ctx.fillText(d.name, d.x, y);
    }

    ctx.restore();
  }

  window.TLPreview = { draw };
})();
