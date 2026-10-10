'use strict';

/* Compartido con el renderer: la vista previa del panel (renderer/js/preview.js)
   carga este archivo como script común. Por eso no puede usar `require` ni
   declarar al nivel de arriba nombres que ya use app.js. */

/**
 * Dibujo de la personalización visual: texturas de cancha, escudo central,
 * aspecto de las fichas, forma del aro propio y cola de color.
 *
 * Todo es local —sólo se ve en esta pantalla— y está pensado para costar casi
 * nada:
 *
 *   · Lo de la CANCHA (textura, escudo) se pinta adentro del cache del estadio,
 *     o sea una vez por invalidación y no una vez por cuadro.
 *   · Las texturas se generan UNA vez (un tile chico) y se reutilizan.
 *   · El aspecto de las fichas son un par de rellenos con degradé por disco; sin
 *     sombras ni `filter`, que son lo único caro de un canvas 2D.
 *   · La cola es un buffer circular fijo: cero asignaciones por cuadro.
 */

const TAU = Math.PI * 2;

/* ── Texturas de cancha ─────────────────────────────────────────────── */

/**
 * Cada acabado: un tono (se pinta con el modo `color`, que conserva las líneas
 * y las sombras de la cancha) y un tile de grano que se aplica con `overlay`.
 */
const TEXTURES = {
  wood: { tint: '#b4803f', strength: 0.88, tile: 'wood', lum: 0 },
  ice: { tint: '#a8d6ee', strength: 0.82, tile: 'ice', lum: 0.12 },
  sand: { tint: '#dcbc7a', strength: 0.92, tile: 'sand', lum: 0.28 },
  concrete: { tint: '#8a949f', strength: 0.9, tile: 'concrete', lum: 0.22 },
  night: { tint: '#1d4636', strength: 0.92, tile: 'turf', lum: -0.12 },
  clay: { tint: '#b4573a', strength: 0.92, tile: 'clay', lum: 0.12 },
  checker: { tint: '#3b6ea5', strength: 0.9, tile: 'checker', lum: 0.1 },
  carbon: { tint: '#4a4f58', strength: 0.92, tile: 'carbon', lum: -0.05 },
  marble: { tint: '#c9ccd2', strength: 0.9, tile: 'marble', lum: 0.3 },
  hex: { tint: '#2f8f9d', strength: 0.9, tile: 'hex', lum: 0.08 },
  stars: { tint: '#17224a', strength: 0.95, tile: 'stars', lum: -0.18 },
  brick: { tint: '#a0503c', strength: 0.92, tile: 'brick', lum: 0.06 },
  snow: { tint: '#e4eef6', strength: 0.92, tile: 'snow', lum: 0.5 },
  neon: { tint: '#1b1a45', strength: 0.95, tile: 'neon', lum: -0.12 },
  lava: { tint: '#52180a', strength: 0.95, tile: 'lava', lum: -0.05 },
  waves: { tint: '#2d7fb8', strength: 0.92, tile: 'waves', lum: 0.1 }
};

function textureSpec(key) {
  return TEXTURES[key] || null;
}

/** Generador pseudoaleatorio con semilla: el mismo tile siempre, sin `Math.random`. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tiles = new Map();

/** El tile de la textura: gris medio con variaciones, listo para `overlay`. */
function tileFor(doc, name) {
  if (name === 'none') return null;
  let tile = tiles.get(name);
  if (tile) return tile;
  const size = 128;
  tile = doc.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const c = tile.getContext('2d');
  let seed = 17;
  for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) >>> 0;
  const rand = rng(seed);
  c.fillStyle = 'rgb(128,128,128)';
  c.fillRect(0, 0, size, size);

  if (name === 'wood') {
    // Tablas horizontales: cada una con su tono, una costura y vetas finas.
    const plank = 16;
    for (let y = 0; y < size; y += plank) {
      const shade = (rand() - 0.5) * 0.22;
      c.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
      c.fillRect(0, y, size, plank);
      c.fillStyle = 'rgba(0,0,0,0.38)';
      c.fillRect(0, y, size, 1);
      c.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 7; i++) {
        c.fillRect(rand() * size, y + 2 + rand() * (plank - 4), 14 + rand() * 40, 1);
      }
      // Junta entre tablas, corrida de una a otra.
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(Math.floor(rand() * size), y, 1, plank);
    }
  } else if (name === 'ice') {
    // Rayones finos y claros, como patines viejos.
    c.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      c.strokeStyle = `rgba(255,255,255,${0.1 + rand() * 0.2})`;
      c.beginPath();
      const x = rand() * size;
      const y = rand() * size;
      c.moveTo(x, y);
      c.lineTo(x + (rand() - 0.3) * 60, y + (rand() - 0.5) * 18);
      c.stroke();
    }
    for (let i = 0; i < 160; i++) {
      c.fillStyle = `rgba(255,255,255,${rand() * 0.12})`;
      c.fillRect(rand() * size, rand() * size, 2, 1);
    }
  } else if (name === 'sand') {
    // Ondas de duna: bandas suaves y grano fino.
    for (let y = 0; y < size; y += 8) {
      c.strokeStyle = (y / 8) % 2 ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';
      c.lineWidth = 2;
      c.beginPath();
      const ph = rand() * 6;
      for (let x = 0; x <= size; x += 8) c.lineTo(x, y + Math.sin((x / size) * TAU * 2 + ph) * 2.5);
      c.stroke();
    }
    for (let i = 0; i < 1400; i++) {
      c.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${rand() * 0.2})` : `rgba(0,0,0,${rand() * 0.18})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1);
    }
  } else if (name === 'concrete') {
    // Losas con juntas, manchas y motitas.
    for (let gy = 0; gy < 2; gy++) {
      for (let gx = 0; gx < 2; gx++) {
        const sh = (rand() - 0.5) * 0.16;
        c.fillStyle = sh > 0 ? `rgba(255,255,255,${sh})` : `rgba(0,0,0,${-sh})`;
        c.fillRect(gx * 64, gy * 64, 64, 64);
      }
    }
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(0, 0, size, 1); c.fillRect(0, 64, size, 1);
    c.fillRect(0, 0, 1, size); c.fillRect(64, 0, 1, size);
    for (let i = 0; i < 900; i++) {
      c.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${rand() * 0.14})` : `rgba(0,0,0,${rand() * 0.18})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1 + (rand() > 0.9 ? 1 : 0), 1);
    }
  } else if (name === 'turf') {
    // Pasto: hojitas verticales claras y oscuras.
    for (let i = 0; i < 900; i++) {
      c.strokeStyle = rand() > 0.5 ? `rgba(255,255,255,${0.06 + rand() * 0.14})` : `rgba(0,0,0,${0.08 + rand() * 0.16})`;
      c.lineWidth = 1;
      const x = rand() * size, y = rand() * size;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rand() - 0.5) * 2, y - 2 - rand() * 4); c.stroke();
    }
  } else if (name === 'clay') {
    // Polvo de ladrillo: grano grueso y piedritas.
    for (let i = 0; i < 1500; i++) {
      c.fillStyle = rand() > 0.5 ? `rgba(255,220,200,${rand() * 0.2})` : `rgba(60,10,0,${rand() * 0.22})`;
      const q = rand() > 0.85 ? 2 : 1;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), q, q);
    }
    for (let i = 0; i < 12; i++) {
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.beginPath(); c.arc(rand() * size, rand() * size, 1 + rand() * 1.5, 0, TAU); c.fill();
    }
  } else if (name === 'checker') {
    // Damero.
    const q = 32;
    for (let y = 0; y < size; y += q) {
      for (let x = 0; x < size; x += q) {
        if (((x + y) / q) % 2) { c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(x, y, q, q); }
        else { c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(x, y, q, q); }
      }
    }
  } else if (name === 'carbon') {
    // Fibra de carbono: trama en diagonal.
    const q = 8;
    for (let y = 0; y < size; y += q) {
      for (let x = 0; x < size; x += q) {
        const alt = ((x + y) / q) % 2;
        const g = c.createLinearGradient(x, y, x + q, y + q);
        g.addColorStop(0, alt ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.28)');
        g.addColorStop(1, alt ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.16)');
        c.fillStyle = g;
        c.fillRect(x, y, q, q);
      }
    }
  } else if (name === 'marble') {
    // Mármol: manchas suaves y vetas finas.
    for (let i = 0; i < 8; i++) {
      const bx = rand() * size, by = rand() * size, br = 26 + rand() * 24;
      const col = rand() > 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)';
      // Se dibuja también corrido un tile hacia cada lado: así empalma sin costura.
      for (let dx = -size; dx <= size; dx += size) {
        for (let dy = -size; dy <= size; dy += size) {
          const g = c.createRadialGradient(bx + dx, by + dy, 1, bx + dx, by + dy, br);
          g.addColorStop(0, col);
          g.addColorStop(1, 'rgba(128,128,128,0)');
          c.fillStyle = g;
          c.fillRect(0, 0, size, size);
        }
      }
    }
    for (let i = 0; i < 6; i++) {
      c.strokeStyle = `rgba(0,0,0,${0.12 + rand() * 0.2})`;
      c.lineWidth = 0.6 + rand() * 0.8;
      c.beginPath();
      const y0 = rand() * size;
      let x = 0, y = y0;
      c.moveTo(x, y);
      while (x < size - 14) { x += 10 + rand() * 14; y += (rand() - 0.5) * 22; c.lineTo(Math.min(x, size), y); }
      c.lineTo(size, y0); // termina a la altura donde empezó: empalma con el tile de al lado
      c.stroke();
    }
  } else if (name === 'hex') {
    // Panal de abejas.
    // Medidas pensadas para que el tile empalme sin costura: 4 períodos de 3r
    // de ancho y 7 filas de alto.
    tile.height = 129;
    c.fillStyle = 'rgb(128,128,128)';
    c.fillRect(0, 0, size, 129);
    c.strokeStyle = 'rgba(0,0,0,0.34)';
    c.lineWidth = 1.2;
    const r = size / 12, hh = 129 / 7;
    for (let row = -1; row < 8; row++) {
      for (let col = -1; col < 9; col++) {
        const cx = col * 1.5 * r, cy = row * hh + (col % 2 ? hh / 2 : 0);
        c.beginPath();
        for (let k = 0; k < 6; k++) c.lineTo(cx + r * Math.cos(k * TAU / 6), cy + r * Math.sin(k * TAU / 6));
        c.closePath(); c.stroke();
      }
    }
  } else if (name === 'stars') {
    // Cielo estrellado: puntos de varios tamaños, algunos con brillo.
    const dot = (x, y, rr, a) => {
      for (let dx = -size; dx <= size; dx += size) {
        for (let dy = -size; dy <= size; dy += size) {
          c.fillStyle = `rgba(255,255,255,${a})`;
          c.beginPath(); c.arc(x + dx, y + dy, rr, 0, TAU); c.fill();
        }
      }
    };
    for (let i = 0; i < 70; i++) dot(rand() * size, rand() * size, 0.5 + rand() * 0.6, 0.25 + rand() * 0.4);
    for (let i = 0; i < 8; i++) dot(rand() * size, rand() * size, 1.4 + rand() * 0.8, 0.8);
  } else if (name === 'brick') {
    // Ladrillos de 32×16, alternados; la mezcla es una línea oscura.
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 5; col++) {
        const x = col * 32 - (row % 2 ? 16 : 0);
        const sh = (rand() - 0.5) * 0.24;
        c.fillStyle = sh > 0 ? `rgba(255,255,255,${sh})` : `rgba(0,0,0,${-sh})`;
        c.fillRect(x, row * 16, 32, 16);
        c.fillStyle = 'rgba(0,0,0,0.42)';
        c.fillRect(x, row * 16, 32, 1.5);
        c.fillRect(x, row * 16, 1.5, 16);
      }
    }
    for (let i = 0; i < 500; i++) {
      c.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${rand() * 0.1})` : `rgba(0,0,0,${rand() * 0.12})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1);
    }
  } else if (name === 'snow') {
    // Nieve: manchas suaves y destellos.
    for (let i = 0; i < 40; i++) {
      const bx = rand() * size, by = rand() * size, br = 8 + rand() * 14;
      for (let dx = -size; dx <= size; dx += size) {
        for (let dy = -size; dy <= size; dy += size) {
          const g = c.createRadialGradient(bx + dx, by + dy, 0, bx + dx, by + dy, br);
          g.addColorStop(0, rand() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(80,110,150,0.08)');
          g.addColorStop(1, 'rgba(128,128,128,0)');
          c.fillStyle = g; c.fillRect(0, 0, size, size);
        }
      }
    }
    for (let i = 0; i < 90; i++) {
      c.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.4})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1);
    }
  } else if (name === 'neon') {
    // Cuadrícula de neón: líneas claras con un halo suave.
    for (let k = 0; k <= size; k += 32) {
      c.fillStyle = 'rgba(255,255,255,0.1)';
      c.fillRect(k - 2, 0, 5, size); c.fillRect(0, k - 2, size, 5);
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.fillRect(k, 0, 1.5, size); c.fillRect(0, k, size, 1.5);
    }
  } else if (name === 'lava') {
    // Magma: grietas brillantes sobre roca oscura.
    for (let i = 0; i < 4; i++) {
      const y0 = rand() * size;
      for (let pass = 0; pass < 2; pass++) {
        c.strokeStyle = pass ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.18)';
        c.lineWidth = pass ? 1.2 : 4;
        c.beginPath();
        let x = 0, y = y0;
        c.moveTo(x, y);
        const r2 = rng(seed + i * 101);
        while (x < size - 12) { x += 8 + r2() * 12; y += (r2() - 0.5) * 26; c.lineTo(Math.min(x, size), y); }
        c.lineTo(size, y0);
        c.stroke();
      }
    }
    for (let i = 0; i < 700; i++) {
      c.fillStyle = rand() > 0.5 ? `rgba(0,0,0,${rand() * 0.2})` : `rgba(255,255,255,${rand() * 0.08})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1);
    }
  } else if (name === 'waves') {
    // Agua: ondas que se repiten de punta a punta.
    for (let y = 0; y < size; y += 16) {
      c.strokeStyle = (y / 16) % 2 ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.16)';
      c.lineWidth = 1.6;
      c.beginPath();
      for (let x = 0; x <= size; x += 4) c.lineTo(x, y + 8 + Math.sin((x / size) * TAU * 2) * 4);
      c.stroke();
    }
  } else {
    // Grano: puntitos claros y oscuros.
    for (let i = 0; i < 1800; i++) {
      const light = rand() > 0.5;
      c.fillStyle = light ? `rgba(255,255,255,${rand() * 0.16})` : `rgba(0,0,0,${rand() * 0.16})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1);
    }
  }
  tiles.set(name, tile);
  return tile;
}

/**
 * Pinta el tile sobre la cancha. El contexto ya viene con el recorte puesto (o
 * no) por quien llama; acá sólo se rellena la superficie en coordenadas de
 * mundo, así las tablas y el grano se quedan quietos al mover la cámara.
 */
function paintTexture(ctx, world, view, name) {
  const tile = tileFor(ctx.canvas.ownerDocument, name);
  if (!tile) return;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.save();
  try {
    ctx.setTransform(world);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = pattern;
    ctx.fillRect(view.x, view.y, view.w, view.h);
  } finally {
    ctx.restore();
  }
}

/* ── Escudo en el centro ────────────────────────────────────────────── */

/**
 * La marca de agua. `bounds` puede ser null (estadio sin medidas): ahí se usa
 * un tamaño fijo razonable.
 */
function paintCrest(ctx, world, bounds, img, opacity, sizeRatio) {
  if (!img || !(img.naturalWidth > 0)) return;
  const base = bounds ? Math.min(bounds.halfH, bounds.halfW / 2) * 2 : 280;
  const s = Math.max(20, base * sizeRatio);
  const ar = img.naturalHeight / img.naturalWidth || 1;
  ctx.save();
  try {
    ctx.setTransform(world);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(0.9, Math.max(0.02, opacity));
    ctx.drawImage(img, -s / 2, (-s * ar) / 2, s, s * ar);
  } finally {
    ctx.restore();
  }
}

/* ── Aspecto de las fichas ──────────────────────────────────────────── */

/**
 * Brillo y relieve sobre un disco ya rellenado. Usa el trazo en curso (el
 * círculo del disco) como recorte, así que se llama justo antes del `stroke()`.
 */
function discOverlay(ctx, style, x, y, r, strokeFn) {
  if (!(r > 0)) return;
  // `stroke` es el que parchea el preload: llamarlo desde acá se re-entraba a sí
  // mismo (era lo que hacía desaparecer todo con «Neón»). Se usa el original.
  const doStroke = () => (strokeFn ? strokeFn.call(ctx) : ctx.stroke());
  let rebuild = false;
  ctx.save();
  try {
    ctx.clip();
    let fill = null;
    if (style === 'neon') {
      rebuild = true;
      ctx.lineWidth = Math.max(0.6, r * 0.16);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.8, 0, TAU);
      doStroke();
      ctx.lineWidth = Math.max(0.5, r * 0.07);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.8, 0, TAU);
      doStroke();
    } else if (style === 'metal') {
      fill = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
      fill.addColorStop(0, 'rgba(255,255,255,0.6)');
      fill.addColorStop(0.32, 'rgba(255,255,255,0)');
      fill.addColorStop(0.55, 'rgba(0,0,0,0.3)');
      fill.addColorStop(0.8, 'rgba(255,255,255,0.32)');
      fill.addColorStop(1, 'rgba(0,0,0,0.4)');
    } else if (style === 'glass') {
      fill = ctx.createRadialGradient(x - r * 0.3, y - r * 0.45, r * 0.05, x, y, r);
      fill.addColorStop(0, 'rgba(255,255,255,0.75)');
      fill.addColorStop(0.28, 'rgba(255,255,255,0.18)');
      fill.addColorStop(0.7, 'rgba(255,255,255,0)');
      fill.addColorStop(1, 'rgba(255,255,255,0.28)');
    } else if (style === 'bubble') {
      // Burbuja: borde claro y un reflejo chico arriba a la izquierda.
      fill = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
      fill.addColorStop(0, 'rgba(255,255,255,0)');
      fill.addColorStop(0.8, 'rgba(255,255,255,0.18)');
      fill.addColorStop(1, 'rgba(255,255,255,0.55)');
      ctx.fillStyle = fill;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.2, r * 0.12, -0.7, 0, TAU);
      ctx.fill();
      rebuild = true;
      fill = null;
    } else if (style === 'target') {
      // Diana: dos anillos concéntricos.
      rebuild = true;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = Math.max(0.5, r * 0.1);
      for (const k of [0.36, 0.7]) {
        ctx.beginPath();
        ctx.arc(x, y, r * k, 0, TAU);
        doStroke();
      }
    } else if (style === 'stripes') {
      // Rayas diagonales oscuras.
      ctx.fillStyle = 'rgba(0,0,0,0.26)';
      const w = r * 0.3;
      for (let i = -3; i <= 3; i += 2) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-0.785);
        ctx.fillRect(-r * 1.5, i * w - w / 2, r * 3, w);
        ctx.restore();
      }
    } else if (style === 'gem') {
      // Gema: ocho facetas alternando claro y oscuro.
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.26)' : 'rgba(255,255,255,0.24)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r * 1.1, (i * TAU) / 8, ((i + 1) * TAU) / 8);
        ctx.closePath();
        ctx.fill();
      }
      rebuild = true;
    } else if (style === 'cartoon') {
      // Sombreado de dibujo: media luna oscura abajo a la derecha + brillo.
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(x, y, r * 1.1, 0, TAU);
      ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.95, 0, TAU, true);
      ctx.fill('evenodd');
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(x - r * 0.42, y - r * 0.44, r * 0.14, 0, TAU);
      ctx.fill();
      rebuild = true;
    } else if (style === 'dots') {
      // Lunares claros.
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      for (const [dx, dy] of [[0, 0], [0.55, 0.05], [-0.55, 0.05], [0.28, -0.5], [-0.28, -0.5], [0.28, 0.52], [-0.28, 0.52]]) {
        ctx.beginPath();
        ctx.arc(x + dx * r, y + dy * r, r * 0.13, 0, TAU);
        ctx.fill();
      }
      rebuild = true;
    } else {
      // sphere
      fill = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
      fill.addColorStop(0, 'rgba(255,255,255,0.5)');
      fill.addColorStop(0.45, 'rgba(255,255,255,0.04)');
      fill.addColorStop(1, 'rgba(0,0,0,0.5)');
    }
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  } finally {
    ctx.restore();
    // Los estilos que dibujan con su propio trazado dejan el del disco hecho
    // pedazos, y el contorno que viene después lo usa: se vuelve a armar.
    if (rebuild) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
    }
  }
}

/* ── Aro propio ─────────────────────────────────────────────────────── */

const DASH = [0, 0];
const NO_DASH = [];

/**
 * Tu aro, con la forma elegida. `px` es el grosor de un píxel de pantalla en
 * unidades de cancha. Devuelve `false` si el estilo es el de siempre y lo tiene
 * que dibujar quien llama.
 */
function drawRing(ctx, style, color, x, y, r, px) {
  if (style === 'double') {
    ctx.beginPath();
    ctx.lineWidth = 4 * px;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.arc(x, y, r + 4 * px, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.lineWidth = 2.2 * px;
    ctx.strokeStyle = color;
    ctx.arc(x, y, r + 4 * px, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.lineWidth = 1.6 * px;
    ctx.arc(x, y, r + 8.5 * px, 0, TAU);
    ctx.stroke();
    return true;
  }
  if (style === 'dashed') {
    ctx.beginPath();
    ctx.lineWidth = 4.5 * px;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.arc(x, y, r + 4.5 * px, 0, TAU);
    ctx.stroke();
    DASH[0] = 6 * px;
    DASH[1] = 4 * px;
    ctx.setLineDash(DASH);
    ctx.beginPath();
    ctx.lineWidth = 2.6 * px;
    ctx.strokeStyle = color;
    ctx.arc(x, y, r + 4.5 * px, 0, TAU);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    return true;
  }
  if (style === 'crown') {
    // Una corona chiquita sobre la ficha: cinco puntas.
    const w = r * 1.3;
    const h = r * 0.9;
    const top = y - r - 3 * px - h;
    const left = x - w / 2;
    ctx.beginPath();
    ctx.moveTo(left, top + h);
    ctx.lineTo(left, top + h * 0.25);
    ctx.lineTo(left + w * 0.25, top + h * 0.6);
    ctx.lineTo(x, top);
    ctx.lineTo(left + w * 0.75, top + h * 0.6);
    ctx.lineTo(left + w, top + h * 0.25);
    ctx.lineTo(left + w, top + h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.4 * px;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.stroke();
    return true;
  }
  return false;
}

/* ── Cola de tu ficha ───────────────────────────────────────────────── */

const TRAIL_N = 32;
const TRAIL_LIFE_MS = 420;
const trail = {
  x: new Float32Array(TRAIL_N),
  y: new Float32Array(TRAIL_N),
  at: new Float64Array(TRAIL_N),
  head: 0,
  count: 0
};

function resetTrail() {
  trail.head = 0;
  trail.count = 0;
}

/** Una muestra por cada tanto de recorrido: la cola sigue el camino, no el reloj. */
function noteTrail(x, y, now) {
  if (trail.count) {
    const last = (trail.head - 1 + TRAIL_N) % TRAIL_N;
    const dx = x - trail.x[last];
    const dy = y - trail.y[last];
    if (dx * dx + dy * dy < 4) {
      trail.at[last] = now; // quieto: la última muestra se mantiene fresca
      return;
    }
  }
  trail.x[trail.head] = x;
  trail.y[trail.head] = y;
  trail.at[trail.head] = now;
  trail.head = (trail.head + 1) % TRAIL_N;
  if (trail.count < TRAIL_N) trail.count++;
}

/** Tres tramos con la opacidad bajando, hacia atrás desde lo más nuevo. */
function drawTrail(ctx, color, r, now) {
  if (trail.count < 2) return;
  let n = 0;
  while (n < trail.count) {
    const idx = (trail.head - 1 - n + TRAIL_N * 2) % TRAIL_N;
    if (now - trail.at[idx] > TRAIL_LIFE_MS) break;
    n++;
  }
  if (n < 2) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  const PARTS = 3;
  for (let part = 0; part < PARTS; part++) {
    const from = Math.floor((n * part) / PARTS);
    const to = Math.min(Math.floor((n * (part + 1)) / PARTS), n - 1);
    if (to - from < 1) continue;
    const t = part / PARTS;
    ctx.globalAlpha = 0.5 * (1 - t);
    ctx.lineWidth = r * (1.5 - 1.1 * t);
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const idx = (trail.head - 1 - i + TRAIL_N * 2) % TRAIL_N;
      if (i === from) ctx.moveTo(trail.x[idx], trail.y[idx]);
      else ctx.lineTo(trail.x[idx], trail.y[idx]);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* ── Colores ────────────────────────────────────────────────────────── */

/**
 * ¿Es una línea «clara» de las que se pueden recolorear? Los trazos de la cancha
 * que traen su propio color (los arcos rojo y azul, por ejemplo) se dejan como
 * están: sólo se cambia el blanquecino que viene por defecto.
 */
function isLightLine(color) {
  if (typeof color !== 'string') return false;
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max > 170 && max - min < 70;
}

/** Sólo acepta `#rrggbb`: viene de la config y se vuelve a escribir en el canvas. */
function safeColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '';
}

module.exports = {
  TEXTURES,
  textureSpec,
  paintTexture,
  paintCrest,
  discOverlay,
  drawRing,
  noteTrail,
  drawTrail,
  resetTrail,
  isLightLine,
  safeColor
};
