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
  // Se muestra un recorte grande de la cancha —el arco de la izquierda y la mitad de
  // la cancha— y no la cancha entera: así las líneas, los contornos y los detalles
  // de las fichas se ven del tamaño de verdad.
  const VIEW_W = 410;
  const VIEW_CX = -110;

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

  /** El sombreado de la pelota 3D (el mismo de main/ball-3d.js). */
  function shade3d(ctx, x, y, r) {
    const light = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    light.addColorStop(0, 'rgba(255,255,255,0.5)');
    light.addColorStop(0.45, 'rgba(255,255,255,0.04)');
    light.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = light;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function num(v, lo, hi, fb) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb;
  }

  /* Tu imagen de césped (vip.pitchImage): se carga una vez y se repinta al llegar. */
  const pimg = { file: '', img: null };
  function pitchImg(cfg) {
    const file = (cfg.vip && cfg.vip.pitchImage) || '';
    if (!file) { pimg.file = ''; pimg.img = null; return null; }
    if (pimg.file !== file) {
      pimg.file = file;
      const img = new Image();
      img.onload = () => { if (pimg.file === file && typeof window.paintPreview === 'function') window.paintPreview(); };
      img.src = encodeURI(`file:///${String(file).replace(/\\/g, '/').replace(/^\/+/, '')}`);
      pimg.img = img;
    }
    return pimg.img && pimg.img.complete && pimg.img.naturalWidth ? pimg.img : null;
  }
  function cover(ctx, img, x, y, W, H, c) {
    const sw = img.naturalWidth; const sh = img.naturalHeight;
    const cc = c && c.on ? c : {};
    ctx.save();
    ctx.translate(x + W / 2, y + H / 2);
    ctx.rotate(((+cc.r || 0) * Math.PI) / 180);
    const k = Math.min(8, Math.max(0.2, +cc.z || 1)) * Math.max(W / sw, H / sh);
    ctx.scale(cc.fx ? -k : k, k);
    ctx.translate(-(sw / 2 + ((+cc.x || 0) * sw) / 2), -(sh / 2 + ((+cc.y || 0) * sh) / 2));
    ctx.drawImage(img, 0, 0, sw, sh);
    ctx.restore();
  }

  function draw(canvas, cfg, opts) {
    if (!canvas || !cfg) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const V = cfg.visual || {};
    const P = cfg.pitch || {};
    const skin = P.skin || {};
    // `opts` acerca la cámara a una zona (las miniaturas de la galería): ancho
    // visible y centro. Sin `opts` se ve el recorte de siempre.
    const o = opts || {};
    const sc = W / (o.w || VIEW_W);
    const tx = W / 2 - (o.cx === undefined ? VIEW_CX : o.cx) * sc;
    const ty = H / 2 - (o.cy || 0) * sc;
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
    const ballStyle = V.ballStyle || 'default';
    const tex = L.textureSpec(V.texture);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);

    /* ── Cancha de HaxBall, sin retocar ─────────────────────────────── */
    ctx.fillStyle = '#586f45';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(sc, 0, 0, sc, tx, ty);
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
    const pi = pitchImg(cfg);
    if (pi) {
      ctx.globalAlpha = num(skin.imageAlpha, 0.1, 1, 1);
      cover(ctx, pi, -HALF_W, -HALF_H, 2 * HALF_W, 2 * HALF_H, (cfg.vip || {}).pitchCrop);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    ctx.lineWidth = 3 * pitchLine;
    ctx.strokeStyle = lineColor;
    ctx.lineJoin = 'round';
    if (V.lineGlow) {
      ctx.shadowColor = lineColor;
      ctx.shadowBlur = 10;
    }
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
        if (V.postStyle && V.postStyle !== 'default') {
          const X = sx * HALF_W; const Y = sy * 62;
          const st = V.postStyle;
          if (st === 'neon') {
            ctx.fillStyle = '#0b0f14'; ctx.fill();
            ctx.save(); ctx.shadowColor = postColor === '#ffffff' ? '#45f0ff' : postColor; ctx.shadowBlur = 8; ctx.lineWidth = 2.2; ctx.strokeStyle = ctx.shadowColor;
            ctx.beginPath(); ctx.arc(X, Y, 5.6, 0, TAU); ctx.stroke(); ctx.restore();
          } else {
            const g = ctx.createRadialGradient(X - 2.8, Y - 3, 0.4, X, Y, 7);
            const stops = { metal: ['#ffffff', '#8d96a3', '#3a414b'], gold: ['#fff6cf', '#d9a93f', '#5e3f0e'], wood: ['#e0aa72', '#b07040', '#7a4a28'], glass: ['rgba(255,255,255,.95)', 'rgba(220,235,255,.5)', 'rgba(40,60,80,.7)'], ball: ['#ffffff', postColor, '#222'] }[st] || ['#fff', postColor, '#000'];
            g.addColorStop(0, stops[0]); g.addColorStop(0.55, stops[1]); g.addColorStop(1, stops[2]);
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, 7, 0, TAU); ctx.fill();
          }
          ctx.beginPath(); ctx.arc(X, Y, 7, 0, TAU);
        }
        ctx.lineWidth = 2 * pitchLine;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.lineWidth = 3 * pitchLine;
        ctx.strokeStyle = lineColor;
      }
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

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
    if (pi) {
      // Con imagen de césped el campo es la imagen (como en el juego): sólo se tiñe el afuera.
      if (outside) tint('out', outside);
    } else if (field && outside && outside !== field) {
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
      const cut = skin.cut || 'lines';
      const FW = 2 * HALF_W; const FH = 2 * HALF_H;
      const rows = Math.max(1, Math.round(FH / band)); const bh = FH / rows;
      ctx.beginPath();
      if (cut === 'diagonal') {
        for (let i = 0; i * band < (FW + FH) * 2; i += 2) { const x0 = -HALF_W - FH + i * band; ctx.moveTo(x0, -HALF_H); ctx.lineTo(x0 + band, -HALF_H); ctx.lineTo(x0 + band + FH, HALF_H); ctx.lineTo(x0 + FH, HALF_H); ctx.closePath(); }
      } else if (cut === 'checker') {
        for (let i = 0; i < stripes; i++) for (let j = 0; j < rows; j++) if ((i + j) % 2 === 0) ctx.rect(-HALF_W + i * band, -HALF_H + j * bh, band, bh);
      } else if (cut === 'circles') {
        const R = Math.hypot(HALF_W, HALF_H); const st = R / Math.max(2, Math.round(stripes / 2));
        for (let r = st; r <= R + st; r += 2 * st) { ctx.moveTo(r, 0); ctx.arc(0, 0, r, 0, TAU, false); ctx.moveTo(r + st, 0); ctx.arc(0, 0, r + st, 0, TAU, true); }
      } else if (cut === 'diamonds') {
        for (let i = 0; i < stripes; i++) for (let j = 0; j < rows; j++) { const cx = -HALF_W + (i + 0.5) * band; const cy = -HALF_H + (j + 0.5) * bh; ctx.moveTo(cx, cy - bh / 2); ctx.lineTo(cx + band / 2, cy); ctx.lineTo(cx, cy + bh / 2); ctx.lineTo(cx - band / 2, cy); ctx.closePath(); }
      } else {
        for (let i = 0; i < stripes; i += 2) ctx.rect(-HALF_W + i * band, -HALF_H, band, 2 * HALF_H);
      }
      ctx.fill();
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

    if (V.pitchLight && L.paintLight) L.paintLight(ctx, W, H, world, { halfW: HALF_W, halfH: HALF_H }, V.pitchLight);

    /* ── Fichas, pelota y nombres ───────────────────────────────────── */
    ctx.setTransform(sc, 0, 0, sc, tx, ty);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineJoin = 'round';

    const accent = css('--accent', '#d0b878');
    const nick = String((cfg.general && cfg.general.nickname) || '').trim() || 'Vos';
    // Colores de los equipos a elección (Fichas y pelota → Colores de los equipos).
    const mineTeams = V.teamColors === 'mine';
    const RED = (mineTeams && L.safeColor(V.teamRed)) || '#e56e56';
    const BLUE = (mineTeams && L.safeColor(V.teamBlue)) || '#5689e5';
    const discs = [
      { x: -178, y: 6, team: RED, name: nick, mine: true },
      { x: -62, y: -30, team: BLUE, name: 'Rival' },
      { x: -34, y: 42, team: RED, name: 'Amigo' }
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
    // El anillo gris que HaxBall dibuja alrededor de tu ficha, con lo que hayas elegido.
    if (L.drawOwnRing) {
      L.drawOwnRing(ctx, me.x, me.y, Number(V.ownRingRadius) || 25, V.ownRingColor, V.ownRingAlpha == null ? 0.3 : V.ownRingAlpha, V.ownRingSoft || 0);
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

    const shadow = (x, y, r) => {
      ctx.beginPath();
      ctx.arc(x + r * 0.16, y + r * 0.3, r * 1.04, 0, TAU);
      ctx.fillStyle = 'rgba(0,0,0,0.24)';
      ctx.fill();
    };
    for (const d of discs) {
      if (V.softShadows) shadow(d.x, d.y, r0);
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
    if (V.softShadows) shadow(-122, 26, br);
    ctx.beginPath();
    ctx.arc(-122, 26, br, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    const ballTint = L.safeColor(V.ballColor);
    const ball3d = P.ball3d ? { spin: 0.6, shade: shade3d } : null;
    if ((ballStyle !== 'default' || ballTint || ball3d) && L.ballOverlay) {
      L.ballOverlay(ctx, ballStyle, -122, 26, br, null, ballTint, ball3d);
    }
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

  /**
   * Miniatura de UN estilo (la pelota, la ficha o el aro) con la config actual
   * pero con el valor de la galería puesto: así se ve cómo queda antes de elegirlo.
   * Barata a propósito: un fondo, un disco y el dibujo del estilo; nada de cancha.
   */
  function swatch(canvas, kind, value, cfg) {
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const V = (cfg && cfg.visual) || {};
    const P = (cfg && cfg.pitch) || {};
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#6f8a58');
    g.addColorStop(1, '#5a7447');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const r = Math.min(W, H) * 0.36;
    const x = W / 2;
    const y = H / 2;
    const accent = css('--accent', '#d0b878');
    try {
      if (kind === 'ballStyle') {
        const tint = L.safeColor(V.ballColor);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        const fx = P.ball3d ? { spin: 0.6, shade: shade3d } : null;
        if (value !== 'default' || tint || fx) L.ballOverlay(ctx, value, x, y, r, null, tint, fx);
        ctx.lineWidth = Math.max(1, r * 0.1);
        ctx.strokeStyle = L.safeColor(V.ballOutline) || '#000000';
        ctx.stroke();
      } else if (kind === 'discStyle' || kind === 'ringStyle') {
        const rr = r * 0.8;
        // El grosor de un «píxel de pantalla» de la cancha, a esta escala.
        const px = rr * 0.025;
        if (kind === 'ringStyle') {
          const col = L.safeColor(V.ringColor) || accent;
          const ring = value === 'default' ? false : L.drawRing(ctx, value, col, x, y, rr, px);
          if (!ring) {
            ctx.beginPath();
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.arc(x, y, rr + 3, 0, TAU);
            ctx.stroke();
            ctx.beginPath();
            ctx.lineWidth = 1.8;
            ctx.strokeStyle = col;
            ctx.arc(x, y, rr + 3, 0, TAU);
            ctx.stroke();
          }
        }
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TAU);
        ctx.fillStyle = '#e56e56';
        ctx.fill();
        if (kind === 'discStyle' && value !== 'default') L.discOverlay(ctx, value, x, y, rr, null);
        ctx.lineWidth = Math.max(1, rr * 0.14) * 1;
        ctx.strokeStyle = L.safeColor(V.discOutline) || '#000000';
        ctx.stroke();
      }
    } finally {
      ctx.restore();
    }
  }

  window.TLPreview = { draw, swatch };
})();
