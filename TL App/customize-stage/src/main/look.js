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
  neon: { tint: '#150f3a', strength: 0.97, tile: 'neon', lum: -0.4 },
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
// Los acabados naturales usan un tile más grande: se nota menos que se repite.
const BIG_TILES = new Set(['wood', 'ice', 'sand', 'concrete', 'turf', 'clay', 'marble', 'snow', 'carbon']);

/** El tile de la textura: gris medio con variaciones, listo para `overlay`. */
function tileFor(doc, name) {
  if (name === 'none') return null;
  let tile = tiles.get(name);
  if (tile) return tile;
  const size = BIG_TILES.has(name) ? 256 : 128;
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
    // Tablas con veta larga, nudos, juntas de testa y bisel arriba y abajo.
    const plank = 32;
    const wrap = (fn) => { for (const dx of [-size, 0, size]) fn(dx); };
    for (let y = 0, row = 0; y < size; y += plank, row++) {
      const shade = (rand() - 0.5) * 0.26;
      c.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
      c.fillRect(0, y, size, plank);
      // Veta: líneas largas que ondulan con períodos enteros, para que empalme.
      for (let i = 0; i < 16; i++) {
        const yy = y + 2 + rand() * (plank - 4);
        const k = 1 + Math.floor(rand() * 2);
        const ph = rand() * TAU;
        const amp = 0.4 + rand() * 1.1;
        c.strokeStyle = rand() > 0.35 ? `rgba(0,0,0,${0.05 + rand() * 0.1})` : `rgba(255,255,255,${0.04 + rand() * 0.07})`;
        c.lineWidth = 0.6 + rand() * 0.9;
        c.beginPath();
        for (let x = 0; x <= size; x += 6) c.lineTo(x, yy + Math.sin((x / size) * TAU * k + ph) * amp);
        c.stroke();
      }
      // Nudo ocasional.
      if (rand() > 0.55) {
        const kx = rand() * size;
        const ky = y + plank / 2 + (rand() - 0.5) * 6;
        wrap((dx) => {
          for (let r = 7; r > 1; r -= 1.5) {
            c.strokeStyle = `rgba(0,0,0,${0.06 + (7 - r) * 0.03})`;
            c.lineWidth = 0.8;
            c.beginPath();
            c.ellipse(kx + dx, ky, r * 1.8, r * 0.8, 0, 0, TAU);
            c.stroke();
          }
        });
      }
      // Bisel: luz arriba, sombra abajo.
      c.fillStyle = 'rgba(255,255,255,0.14)';
      c.fillRect(0, y, size, 1);
      c.fillStyle = 'rgba(0,0,0,0.46)';
      c.fillRect(0, y + plank - 1, size, 1);
      // Juntas de testa, corridas entre tablas.
      const jx = Math.floor(((row * 0.37 + rand() * 0.3) % 1) * size);
      c.fillStyle = 'rgba(0,0,0,0.38)';
      c.fillRect(jx, y, 1, plank);
      c.fillStyle = 'rgba(255,255,255,0.1)';
      c.fillRect(jx + 1, y, 1, plank);
    }
    for (let i = 0; i < 700; i++) {
      c.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${rand() * 0.06})` : `rgba(0,0,0,${rand() * 0.07})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1);
    }
  } else if (name === 'ice') {
    // Hielo pulido: velos de escarcha, grietas ramificadas y rayones de patín.
    for (let i = 0; i < 26; i++) {
      const bx = rand() * size, by = rand() * size, br = 26 + rand() * 40;
      for (let dx = -size; dx <= size; dx += size) {
        for (let dy = -size; dy <= size; dy += size) {
          const g = c.createRadialGradient(bx + dx, by + dy, 0, bx + dx, by + dy, br);
          g.addColorStop(0, rand() > 0.4 ? 'rgba(255,255,255,0.1)' : 'rgba(90,140,190,0.09)');
          g.addColorStop(1, 'rgba(128,128,128,0)');
          c.fillStyle = g; c.fillRect(0, 0, size, size);
        }
      }
    }
    const crack = (x, y, ang, len, depth) => {
      const pts = [[x, y]];
      let cx = x, cy = y, a = ang;
      for (let l = 0; l < len; l += 7) {
        a += (rand() - 0.5) * 0.7;
        cx += Math.cos(a) * 7; cy += Math.sin(a) * 7;
        pts.push([cx, cy]);
        if (depth < 2 && rand() > 0.88) crack(cx, cy, a + (rand() > 0.5 ? 0.9 : -0.9), len * 0.5, depth + 1);
      }
      for (const [col, w, off] of [['rgba(0,0,0,0.16)', 1.6, 0.8], ['rgba(255,255,255,0.5)', 0.8, 0]]) {
        c.strokeStyle = col; c.lineWidth = w;
        c.beginPath();
        pts.forEach(([px, py], i) => (i ? c.lineTo(px + off, py + off) : c.moveTo(px + off, py + off)));
        c.stroke();
      }
    };
    for (let i = 0; i < 3; i++) crack(rand() * size, rand() * size, rand() * TAU, 70 + rand() * 60, 0);
    c.lineWidth = 1;
    for (let i = 0; i < 46; i++) {
      c.strokeStyle = `rgba(255,255,255,${0.1 + rand() * 0.22})`;
      c.beginPath();
      const x = rand() * size, y = rand() * size;
      c.moveTo(x, y);
      c.quadraticCurveTo(x + 30 + rand() * 40, y + (rand() - 0.5) * 20, x + 60 + rand() * 60, y + (rand() - 0.5) * 24);
      c.stroke();
    }
    for (let i = 0; i < 320; i++) {
      c.fillStyle = `rgba(255,255,255,${rand() * 0.14})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 2, 1);
    }
  } else if (name === 'sand') {
    // Dunas: ondulaciones largas con cresta clara y sombra, y grano fino.
    for (let y = 0; y < size; y += 14) {
      const k = 1 + Math.floor(rand() * 3);
      const ph = rand() * TAU;
      const amp = 2 + rand() * 3;
      for (const [col, dy, w] of [['rgba(0,0,0,0.13)', 2.2, 3], ['rgba(255,255,255,0.2)', 0, 1.6]]) {
        c.strokeStyle = col; c.lineWidth = w;
        c.beginPath();
        for (let x = 0; x <= size; x += 6) c.lineTo(x, y + dy + Math.sin((x / size) * TAU * k + ph) * amp);
        c.stroke();
      }
    }
    for (let i = 0; i < 5200; i++) {
      c.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${rand() * 0.22})` : `rgba(0,0,0,${rand() * 0.2})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1);
    }
    for (let i = 0; i < 26; i++) {
      const px = rand() * size, py = rand() * size, pr = 0.8 + rand() * 1.3;
      c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath(); c.arc(px + 0.7, py + 0.7, pr, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.2)'; c.beginPath(); c.arc(px, py, pr, 0, TAU); c.fill();
    }
  } else if (name === 'concrete') {
    // Losas de hormigón: junta biselada, manchas, poros y fisuras finas.
    for (let gy = 0; gy < 2; gy++) {
      for (let gx = 0; gx < 2; gx++) {
        const sh = (rand() - 0.5) * 0.18;
        c.fillStyle = sh > 0 ? `rgba(255,255,255,${sh})` : `rgba(0,0,0,${-sh})`;
        c.fillRect(gx * 128, gy * 128, 128, 128);
      }
    }
    for (let i = 0; i < 16; i++) {
      const bx = rand() * size, by = rand() * size, br = 18 + rand() * 38;
      const col = rand() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)';
      for (let dx = -size; dx <= size; dx += size) {
        for (let dy = -size; dy <= size; dy += size) {
          const g = c.createRadialGradient(bx + dx, by + dy, 0, bx + dx, by + dy, br);
          g.addColorStop(0, col); g.addColorStop(1, 'rgba(128,128,128,0)');
          c.fillStyle = g; c.fillRect(0, 0, size, size);
        }
      }
    }
    for (let i = 0; i < 1800; i++) {
      c.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${rand() * 0.13})` : `rgba(0,0,0,${rand() * 0.17})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1 + (rand() > 0.92 ? 1 : 0), 1);
    }
    for (let i = 0; i < 70; i++) {
      const px = Math.floor(rand() * size), py = Math.floor(rand() * size);
      c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(px, py, 2, 2);
      c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(px + 1, py + 2, 2, 1);
    }
    c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = 0.8;
    for (let i = 0; i < 2; i++) {
      let x = rand() * 128, y = rand() * 128;
      c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 7; k++) { x += (rand() - 0.5) * 12; y += 4 + rand() * 7; c.lineTo(x, y); }
      c.stroke();
    }
    for (const j of [0, 128]) {
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.fillRect(0, j, size, 2); c.fillRect(j, 0, 2, size);
      c.fillStyle = 'rgba(255,255,255,0.16)';
      c.fillRect(0, j + 2, size, 1); c.fillRect(j + 2, 0, 1, size);
    }
  } else if (name === 'turf') {
    // Pasto: franjas de corte con brillo alterno y hojitas inclinadas.
    for (let y = 0; y < size; y += 32) {
      c.fillStyle = (y / 32) % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
      c.fillRect(0, y, size, 32);
    }
    for (let i = 0; i < 3600; i++) {
      c.strokeStyle = rand() > 0.5 ? `rgba(255,255,255,${0.05 + rand() * 0.13})` : `rgba(0,0,0,${0.07 + rand() * 0.15})`;
      c.lineWidth = 1;
      const x = rand() * size, y = rand() * size, l = 2 + rand() * 4;
      const lean = (rand() - 0.5) * 2.4;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + lean, y - l); c.stroke();
    }
  } else if (name === 'clay') {
    // Tierra batida: grano grueso, pasadas de rastrillo y piedritas con sombra.
    for (let i = 0; i < 6; i++) {
      const y = rand() * size, k = 1 + Math.floor(rand() * 2), ph = rand() * TAU;
      c.strokeStyle = rand() > 0.5 ? 'rgba(255,225,205,0.1)' : 'rgba(60,10,0,0.1)';
      c.lineWidth = 3 + rand() * 4;
      c.beginPath();
      for (let x = 0; x <= size; x += 8) c.lineTo(x, y + Math.sin((x / size) * TAU * k + ph) * 4);
      c.stroke();
    }
    for (let i = 0; i < 5200; i++) {
      c.fillStyle = rand() > 0.5 ? `rgba(255,220,200,${rand() * 0.22})` : `rgba(60,10,0,${rand() * 0.24})`;
      const q = rand() > 0.88 ? 2 : 1;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), q, q);
    }
    for (let i = 0; i < 28; i++) {
      const px = rand() * size, py = rand() * size, pr = 1 + rand() * 1.6;
      c.fillStyle = 'rgba(40,5,0,0.3)'; c.beginPath(); c.arc(px + 0.9, py + 0.9, pr, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,235,220,0.18)'; c.beginPath(); c.arc(px, py, pr, 0, TAU); c.fill();
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
    // Fibra de carbono en sarga 2×2: cada hebra con su reflejo.
    const q = 8;
    for (let y = 0; y < size; y += q) {
      for (let x = 0; x < size; x += q) {
        const horiz = (((x + y * 2) / q) % 4 + 4) % 4 < 2;
        const g = horiz ? c.createLinearGradient(x, y, x, y + q) : c.createLinearGradient(x, y, x + q, y);
        g.addColorStop(0, horiz ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.1)');
        g.addColorStop(0.5, horiz ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.12)');
        g.addColorStop(1, horiz ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.26)');
        c.fillStyle = g;
        c.fillRect(x, y, q, q);
        c.fillStyle = 'rgba(0,0,0,0.3)';
        if (horiz) c.fillRect(x, y + q - 1, q, 1); else c.fillRect(x + q - 1, y, 1, q);
      }
    }
    for (let i = 0; i < 400; i++) {
      c.fillStyle = `rgba(255,255,255,${rand() * 0.05})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1);
    }
  } else if (name === 'marble') {
    // Mármol pulido: nubes suaves, venas que ramifican y un lustre.
    for (let i = 0; i < 14; i++) {
      const bx = rand() * size, by = rand() * size, br = 36 + rand() * 44;
      const col = rand() > 0.5 ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.09)';
      for (let dx = -size; dx <= size; dx += size) {
        for (let dy = -size; dy <= size; dy += size) {
          const g = c.createRadialGradient(bx + dx, by + dy, 1, bx + dx, by + dy, br);
          g.addColorStop(0, col); g.addColorStop(1, 'rgba(128,128,128,0)');
          c.fillStyle = g; c.fillRect(0, 0, size, size);
        }
      }
    }
    // Las venas son sumas de senos con períodos enteros: empalman de borde a borde.
    const vein = (y0, amp, w, a, k1, k2) => {
      const p1 = rand() * TAU, p2 = rand() * TAU;
      c.lineWidth = w;
      c.beginPath();
      for (let x = 0; x <= size; x += 3) {
        const y = y0 + Math.sin((x / size) * TAU * k1 + p1) * amp + Math.sin((x / size) * TAU * k2 + p2) * amp * 0.45;
        c.lineTo(x, y);
      }
      c.stroke();
    };
    for (let i = 0; i < 5; i++) {
      const y0 = rand() * size;
      const amp = 5 + rand() * 9;
      c.strokeStyle = 'rgba(255,255,255,0.06)'; vein(y0, amp, 5, 0, 1 + (i % 2), 3);
      c.strokeStyle = `rgba(40,45,60,${0.14 + rand() * 0.18})`; vein(y0 + 0.5, amp, 0.8 + rand() * 0.8, 0, 1 + (i % 2), 3);
    }
    for (let i = 0; i < 3; i++) {
      c.strokeStyle = 'rgba(40,45,60,0.1)';
      vein(rand() * size, 6 + rand() * 8, 0.5, 0, 2, 5);
    }
    for (let i = 0; i < 500; i++) {
      c.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${rand() * 0.08})` : `rgba(0,0,0,${rand() * 0.06})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1);
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
    // Nieve: capas suaves, ondulaciones de viento y destellos en cruz.
    for (let i = 0; i < 70; i++) {
      const bx = rand() * size, by = rand() * size, br = 10 + rand() * 24;
      for (let dx = -size; dx <= size; dx += size) {
        for (let dy = -size; dy <= size; dy += size) {
          const g = c.createRadialGradient(bx + dx, by + dy, 0, bx + dx, by + dy, br);
          g.addColorStop(0, rand() > 0.5 ? 'rgba(255,255,255,0.13)' : 'rgba(80,110,160,0.09)');
          g.addColorStop(1, 'rgba(128,128,128,0)');
          c.fillStyle = g; c.fillRect(0, 0, size, size);
        }
      }
    }
    for (let i = 0; i < 7; i++) {
      const y = rand() * size, k = 1 + Math.floor(rand() * 2), ph = rand() * TAU;
      for (const [col, dy, w] of [['rgba(70,100,150,0.09)', 2, 3], ['rgba(255,255,255,0.22)', 0, 1.5]]) {
        c.strokeStyle = col; c.lineWidth = w;
        c.beginPath();
        for (let x = 0; x <= size; x += 8) c.lineTo(x, y + dy + Math.sin((x / size) * TAU * k + ph) * 5);
        c.stroke();
      }
    }
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.4})`;
      c.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1);
    }
    for (let i = 0; i < 16; i++) {
      const sx = Math.floor(rand() * (size - 6)) + 3, sy = Math.floor(rand() * (size - 6)) + 3;
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.fillRect(sx, sy, 1, 1);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(sx - 2, sy, 5, 1); c.fillRect(sx, sy - 2, 1, 5);
    }
  } else if (name === 'neon') {
    // Cuadrícula de neón: líneas finas y claras con un halo suave, sobre fondo
    // bien oscuro para que brillen (más clara y gruesa se veía como una red).
    for (let k = 0; k <= size; k += 48) {
      c.fillStyle = 'rgba(255,255,255,0.07)';
      c.fillRect(k - 2.5, 0, 6, size); c.fillRect(0, k - 2.5, size, 6);
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.fillRect(k, 0, 1, size); c.fillRect(0, k, size, 1);
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

/* ── Luz de la cancha ───────────────────────────────────────────────── */

/**
 * Viñeta, foco o luces de esquina sobre la cancha. Corre dentro del caché de la
 * cancha (una vez por invalidación, no por cuadro), así que no cuesta cuadros.
 * `bounds` puede ser null: ahí se usa el centro de la superficie.
 */
function paintLight(ctx, w, h, world, bounds, mode) {
  const cx = bounds ? world.e : w / 2;
  const cy = bounds ? world.f : h / 2;
  const sx = bounds ? Math.abs(world.a) : 1;
  const hw = bounds ? bounds.halfW * sx : w / 2;
  const hh = bounds ? bounds.halfH * sx : h / 2;
  const diag = Math.hypot(hw, hh);
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const dark = (r0, r1, stops) => {
      const g = ctx.createRadialGradient(cx, cy, diag * r0, cx, cy, diag * r1);
      for (const [o, c] of stops) g.addColorStop(o, c);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    };
    const flood = (px, py, rad, color) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, color);
      g.addColorStop(0.5, color.replace(/[\d.]+\)$/, '0.08)'));
      g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    };
    if (mode === 'vignette') {
      // Caída suave en varios pasos: se nota el borde oscuro sin una "pared" negra.
      dark(0.4, 1.3, [[0, 'rgba(0,0,0,0)'], [0.4, 'rgba(0,0,0,0.12)'], [0.75, 'rgba(0,0,0,0.42)'], [1, 'rgba(0,0,0,0.62)']]);
    } else if (mode === 'stadium') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0,4,18,0.24)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'screen';
      for (const [kx, ky] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) flood(cx + kx * hw * 0.92, cy + ky * hh * 1.05, hw * 0.95, 'rgba(255,240,205,0.34)');
      flood(cx, cy, diag * 0.6, 'rgba(255,248,230,0.10)');
    } else if (mode === 'sunset') {
      const g = ctx.createLinearGradient(cx - hw, cy - hh, cx + hw, cy + hh);
      g.addColorStop(0, 'rgba(255,150,60,0.30)');
      g.addColorStop(0.5, 'rgba(255,90,120,0.06)');
      g.addColorStop(1, 'rgba(110,60,210,0.34)');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      dark(0.55, 1.3, [[0, 'rgba(20,0,30,0)'], [1, 'rgba(20,0,30,0.4)']]);
    } else if (mode === 'night') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgb(120,150,225)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'screen';
      flood(cx, cy, diag * 0.85, 'rgba(190,215,255,0.26)');
      dark(0.6, 1.3, [[0, 'rgba(0,0,20,0)'], [1, 'rgba(0,0,20,0.42)']]);
    } else if (mode === 'stripes') {
      const n = 14;
      const bw = (hw * 2) / n;
      for (let i = 0; i < n; i += 1) {
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.07)';
        ctx.fillRect(cx - hw + i * bw, 0, bw, h);
      }
      dark(0.5, 1.3, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.36)']]);
    } else if (mode === 'cinema') {
      const bar = Math.max(h * 0.12, 40);
      for (const top of [true, false]) {
        const g = ctx.createLinearGradient(0, top ? 0 : h, 0, top ? bar * 2.2 : h - bar * 2.2);
        g.addColorStop(0, 'rgba(0,0,0,0.78)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, top ? 0 : h - bar * 2.2, w, bar * 2.2);
      }
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = 'rgba(255,170,90,0.18)';
      ctx.fillRect(0, 0, w, h);
      dark(0.5, 1.3, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.4)']]);
    } else if (mode === 'spot') {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, diag * 0.9);
      g.addColorStop(0, 'rgba(255,244,214,0.3)');
      g.addColorStop(0.55, 'rgba(255,244,214,0.1)');
      g.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      dark(0.7, 1.35, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.3)']]);
    } else if (mode === 'corners') {
      ctx.globalCompositeOperation = 'screen';
      const rad = hw * 0.7;
      for (const [kx, ky] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const px = cx + kx * hw;
        const py = cy + ky * hh;
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, 'rgba(255,248,225,0.3)');
        g.addColorStop(1, 'rgba(255,248,225,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    }
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
/* Los degradados de las fichas se arman una vez por estilo y tamaño, alrededor del (0,0), y se
   corren con translate. Antes se creaban de nuevo por cada ficha en cada cuadro. */
const discGrads = new Map();
function discGradient(ctx, style, r) {
  const key = style + '|' + r.toFixed(2);
  let g = discGrads.get(key);
  if (g) return g;
  if (style === 'metal') {
    g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.32, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(0,0,0,0.4)');
  } else if (style === 'glass') {
    g = ctx.createRadialGradient(-r * 0.3, -r * 0.45, r * 0.05, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.28, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.7, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,0.28)');
  } else {
    g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.04)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
  }
  if (discGrads.size > 48) discGrads.clear();
  discGrads.set(key, g);
  return g;
}

function discOverlay(ctx, style, x, y, r, strokeFn) {
  if (!(r > 0)) return;
  // Camino rápido: los estilos de un solo degradado rellenan el trazado del disco tal cual está
  // (sin recorte ni rectángulo), con el degradado guardado. El trazado queda intacto para el contorno.
  if (style === 'metal' || style === 'glass' || style === 'sphere' || !style) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = discGradient(ctx, style || 'sphere', r);
    ctx.fill();
    ctx.restore();
    return;
  }
  // `stroke` es el que parchea el preload: llamarlo desde acá se re-entraba a sí
  // mismo (era lo que hacía desaparecer todo con «Neón»). Se usa el original.
  const doStroke = () => (strokeFn ? strokeFn.call(ctx) : ctx.stroke());
  let rebuild = false;
  ctx.save();
  try {
    ctx.clip();
    let fill = null;
    if (style === 'neon') {
      // Tubo de neón: el centro se oscurece un poco para que el aro brille de
      // verdad, y el aro lleva un halo ancho y tenue, uno medio y el filo claro.
      rebuild = true;
      const core = ctx.createRadialGradient(x, y, 0, x, y, r * 0.78);
      core.addColorStop(0, 'rgba(0,0,0,0.3)');
      core.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = core;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.strokeStyle = '#ffffff';
      for (const [w, a] of [[0.3, 0.14], [0.17, 0.28], [0.07, 0.95]]) {
        ctx.globalAlpha = a;
        ctx.lineWidth = Math.max(0.5, r * w);
        ctx.beginPath();
        ctx.arc(x, y, r * 0.74, 0, TAU);
        doStroke();
      }
      ctx.globalAlpha = 1;
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

/* ── Aspecto de la pelota ───────────────────────────────────────────── */

function pentagon(ctx, cx, cy, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * TAU) / 5;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

/**
 * El dibujo de un estilo (con su color) como textura cuadrada, para la pelota
 * 3D: se pinta UNA vez sobre un lienzo aparte con el mismo código de siempre y
 * se guardan los píxeles. Se reusa mientras no cambie el estilo ni el color.
 */
const BALL_TEX = 128;
const ballTextures = new Map();
function ballTexture(ctx, style, tint) {
  const key = `${style}|${tint || ''}`;
  let tex = ballTextures.get(key);
  if (tex) return tex;
  const c = ctx.canvas.ownerDocument.createElement('canvas');
  c.width = c.height = BALL_TEX;
  const g = c.getContext('2d');
  const h = BALL_TEX / 2;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(h, h, h, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(h, h, h, 0, TAU);
  ballOverlay(g, style, h, h, h, null, tint, null);
  tex = { size: BALL_TEX, data: g.getImageData(0, 0, BALL_TEX, BALL_TEX).data };
  c.width = 0;
  if (ballTextures.size > 24) ballTextures.clear();
  ballTextures.set(key, tex);
  return tex;
}

/**
 * Dibujo sobre la pelota ya rellenada. Igual que `discOverlay`: usa el trazo en
 * curso (el círculo de la pelota) como recorte y se llama justo antes del
 * `stroke()`. `strokeFn` es el `stroke` original, para no re-entrar al parche.
 */
function ballOverlay(ctx, style, x, y, r, strokeFn, tint, fx3d) {
  if (!(r > 0)) return;
  const doStroke = () => (strokeFn ? strokeFn.call(ctx) : ctx.stroke());
  // Con la pelota 3D puesta el dibujo gira con ella y el sombreado va ENCIMA
  // (antes el estilo se pintaba plano sobre el sombreado y lo tapaba).
  let turned = false;
  ctx.save();
  try {
    ctx.clip();
    // Pelota 3D de verdad: el dibujo se mapea sobre una esfera que rueda.
    if (fx3d && fx3d.sphere && fx3d.state) {
      fx3d.sphere(ctx, x, y, r, fx3d.state, ballTexture(ctx, style, tint));
      if (style === 'default' && fx3d.surface) fx3d.surface(ctx, x, y, r, fx3d.state);
      fx3d.shade(ctx, x, y, r);
      return;
    }
    // El color de la pelota: se multiplica sobre el relleno, así una blanca toma el
    // color elegido y una con imagen sólo se tiñe.
    if (tint) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = tint;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (fx3d) {
      ctx.save();
      turned = true;
      ctx.translate(x, y);
      ctx.rotate(fx3d.spin);
      ctx.translate(-x, -y);
    }
    if (style === 'soccer') {
      // Pentágono negro al medio y cinco más cortados por el borde.
      ctx.fillStyle = '#16181d';
      pentagon(ctx, x, y, r * 0.36, -Math.PI / 2);
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 5 + TAU / 10;
        pentagon(ctx, x + Math.cos(a) * r * 0.98, y + Math.sin(a) * r * 0.98, r * 0.34, a);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(22,24,29,0.55)';
      ctx.lineWidth = Math.max(0.4, r * 0.06);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 5;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r * 0.36, y + Math.sin(a) * r * 0.36);
        ctx.lineTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7);
        doStroke();
      }
    } else if (style === 'neon') {
      // Esfera de neón: fondo oscuro, luz que sube desde el borde y un aro
      // brillante con su halo.
      ctx.fillStyle = 'rgba(6,12,34,0.86)';
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      const glow = ctx.createRadialGradient(x, y, r * 0.3, x, y, r);
      glow.addColorStop(0, 'rgba(0,229,255,0)');
      glow.addColorStop(1, 'rgba(0,229,255,0.55)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.strokeStyle = '#00e5ff';
      for (const [w, a] of [[0.26, 0.16], [0.13, 0.4]]) {
        ctx.globalAlpha = a;
        ctx.lineWidth = Math.max(0.6, r * w);
        ctx.beginPath();
        ctx.arc(x, y, r * 0.66, 0, TAU);
        doStroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(0.5, r * 0.05);
      ctx.strokeStyle = '#c9fdff';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.66, 0, TAU);
      doStroke();
      const core = ctx.createRadialGradient(x, y, 0, x, y, r * 0.3);
      core.addColorStop(0, 'rgba(200,253,255,0.5)');
      core.addColorStop(1, 'rgba(200,253,255,0)');
      ctx.fillStyle = core;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    } else if (style === 'gold') {
      const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
      g.addColorStop(0, 'rgba(255,240,170,0.95)');
      g.addColorStop(0.45, 'rgba(214,170,60,0.92)');
      g.addColorStop(0.7, 'rgba(255,226,120,0.92)');
      g.addColorStop(1, 'rgba(150,108,30,0.95)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    } else if (style === 'beach') {
      const cols = ['#e5483f', '#ffffff', '#f2c230', '#ffffff', '#3b8be0', '#ffffff'];
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = cols[i];
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r * 1.1, (i * TAU) / 6, ((i + 1) * TAU) / 6);
        ctx.closePath();
        ctx.fill();
      }
    } else if (style === 'eight') {
      ctx.fillStyle = '#111317';
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#111317';
      ctx.font = `bold ${(r * 0.8).toFixed(2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('8', x, y + r * 0.04);
    } else if (style === 'star') {
      ctx.fillStyle = '#f2c230';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 ? r * 0.28 : r * 0.7;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = x + Math.cos(a) * rad;
        const py = y + Math.sin(a) * rad;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = Math.max(0.4, r * 0.07);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      doStroke();
    } else if (style !== 'default') {
      extraBall(ctx, style, x, y, r);
    }
    if (turned) {
      turned = false;
      ctx.restore();
    }
    if (fx3d) fx3d.shade(ctx, x, y, r);
  } finally {
    if (turned) ctx.restore();
    ctx.restore();
    // El contorno que viene después usa el trazo del círculo: se vuelve a armar.
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
  }
}

/* ── Más pelotas ────────────────────────────────────────────────────────
 * Todas se dibujan ya recortadas contra el círculo de la pelota (ver
 * `ballOverlay`), con trazados simples: nada de imágenes ni de cuentas por
 * cuadro más allá de unas decenas de líneas. Cada una pinta su propio fondo.
 */
function disc(ctx, x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function polygon(ctx, cx, cy, r, sides, rot) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * TAU) / sides;
    if (i) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

/** Dos costuras curvas, como las del tenis y el béisbol. */
function twoSeams(ctx, x, y, r, off, sweep) {
  ctx.beginPath();
  ctx.arc(x - r * off, y, r * 1.02, -sweep, sweep);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + r * off, y, r * 1.02, Math.PI - sweep, Math.PI + sweep);
  ctx.stroke();
}

function extraBall(ctx, style, x, y, r) {
  const lw = Math.max(0.4, r * 0.07);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (style === 'panels') {
    // Fútbol moderno: tres palas curvas que giran desde el centro.
    disc(ctx, x, y, r, '#f6f6f4');
    for (let k = 0; k < 3; k++) {
      const a = (k * TAU) / 3 - Math.PI / 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(r * 0.5, -r * 0.95, r * 1.2, -r * 0.25);
      ctx.quadraticCurveTo(r * 0.85, r * 0.3, 0, 0);
      ctx.fillStyle = k === 1 ? '#e8a21a' : '#2563c9';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,24,34,0.55)';
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(20,24,34,0.35)';
    ctx.lineWidth = lw * 0.8;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.62, 0, TAU);
    ctx.stroke();
  } else if (style === 'triangles') {
    // Fútbol de triángulos: uno al medio y tres cortados por el borde.
    disc(ctx, x, y, r, '#f4f4f2');
    ctx.fillStyle = '#d4312b';
    polygon(ctx, x, y, r * 0.42, 3, -Math.PI / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,24,34,0.55)';
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.fillStyle = '#1f3f8f';
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 6 + (k * TAU) / 3;
      polygon(ctx, x + Math.cos(a) * r * 1.0, y + Math.sin(a) * r * 1.0, r * 0.5, 3, a + Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  } else if (style === 'vintage') {
    // Fútbol de cuero: marrón, con costuras y la tira de cordones.
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#b9703a');
    g.addColorStop(1, '#6e3a18');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.strokeStyle = 'rgba(40,20,8,0.7)';
    ctx.lineWidth = lw;
    twoSeams(ctx, x, y, r, 1.3, 0.9);
    ctx.strokeStyle = '#f0e2c0';
    ctx.lineWidth = lw * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.55);
    ctx.lineTo(x, y + r * 0.55);
    ctx.stroke();
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x - r * 0.18, y + i * r * 0.22 - r * 0.05);
      ctx.lineTo(x + r * 0.18, y + i * r * 0.22 + r * 0.05);
      ctx.stroke();
    }
  } else if (style === 'tennis') {
    disc(ctx, x, y, r, '#cfe232');
    ctx.fillStyle = 'rgba(120,140,10,0.22)';
    for (const [dx, dy] of [[-0.5, -0.3], [0.2, -0.6], [0.55, 0.1], [-0.2, 0.45], [0.3, 0.6], [-0.65, 0.3]]) {
      ctx.beginPath();
      ctx.arc(x + dx * r, y + dy * r, r * 0.16, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = '#fbfbf2';
    ctx.lineWidth = Math.max(0.6, r * 0.11);
    twoSeams(ctx, x, y, r, 1.28, 0.95);
  } else if (style === 'basket') {
    disc(ctx, x, y, r, '#df7a2b');
    ctx.strokeStyle = '#2a1608';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - r * 1.35, y, r * 1.02, -0.78, 0.78);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r * 1.35, y, r * 1.02, Math.PI - 0.78, Math.PI + 0.78);
    ctx.stroke();
  } else if (style === 'volley') {
    disc(ctx, x, y, r, '#f7f4ea');
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.7);
    ctx.fillStyle = '#2f6fdb';
    ctx.fillRect(-r * 1.4, -r * 0.62, r * 2.8, r * 0.42);
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(-r * 1.4, -r * 0.2, r * 2.8, r * 0.42);
    ctx.fillStyle = '#2f6fdb';
    ctx.fillRect(-r * 1.4, r * 0.22, r * 2.8, r * 0.42);
    ctx.restore();
    ctx.strokeStyle = 'rgba(30,30,40,0.45)';
    ctx.lineWidth = lw * 0.8;
    for (const k of [-0.62, -0.2, 0.22, 0.64]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.7);
      ctx.beginPath();
      ctx.moveTo(-r * 1.4, k * r);
      ctx.lineTo(r * 1.4, k * r);
      ctx.stroke();
      ctx.restore();
    }
  } else if (style === 'baseball') {
    disc(ctx, x, y, r, '#f6f1e4');
    ctx.strokeStyle = '#c4282f';
    ctx.lineWidth = Math.max(0.5, r * 0.09);
    ctx.setLineDash([r * 0.13, r * 0.1]);
    twoSeams(ctx, x, y, r, 1.2, 0.85);
    ctx.setLineDash([]);
  } else if (style === 'golf') {
    disc(ctx, x, y, r, '#f8f8f6');
    ctx.fillStyle = 'rgba(70,80,95,0.2)';
    ctx.beginPath();
    const step = r * 0.36;
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        const px = x + i * step + (j & 1 ? step / 2 : 0);
        const py = y + j * step * 0.87;
        if ((px - x) * (px - x) + (py - y) * (py - y) < r * r * 1.2) {
          ctx.moveTo(px + step * 0.34, py);
          ctx.arc(px, py, step * 0.34, 0, TAU);
        }
      }
    }
    ctx.fill();
  } else if (style === 'bowling') {
    const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    g.addColorStop(0, '#2c4aa8');
    g.addColorStop(0.5, '#171f4a');
    g.addColorStop(1, '#3a1a5c');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = '#05060c';
    for (const [dx, dy, k] of [[-0.22, -0.5, 0.13], [0.2, -0.5, 0.13], [0, -0.22, 0.16]]) {
      ctx.beginPath();
      ctx.arc(x + dx * r, y + dy * r, r * k, 0, TAU);
      ctx.fill();
    }
  } else if (style === 'earth') {
    disc(ctx, x, y, r, '#2b6fb8');
    ctx.fillStyle = '#4ea35b';
    for (const [dx, dy, rx, ry, rot] of [[-0.35, -0.2, 0.42, 0.28, 0.5], [0.45, 0.25, 0.3, 0.45, -0.3], [-0.1, 0.62, 0.35, 0.16, 0.1], [0.3, -0.62, 0.3, 0.14, -0.2]]) {
      ctx.beginPath();
      ctx.ellipse(x + dx * r, y + dy * r, rx * r, ry * r, rot, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const [dx, dy, rx, ry] of [[0.1, -0.1, 0.4, 0.07], [-0.4, 0.4, 0.3, 0.06]]) {
      ctx.beginPath();
      ctx.ellipse(x + dx * r, y + dy * r, rx * r, ry * r, 0.3, 0, TAU);
      ctx.fill();
    }
  } else if (style === 'moon') {
    disc(ctx, x, y, r, '#b8b6ae');
    for (const [dx, dy, k] of [[-0.35, -0.3, 0.3], [0.38, 0.1, 0.22], [-0.05, 0.5, 0.2], [0.35, -0.55, 0.14], [-0.6, 0.25, 0.13]]) {
      ctx.fillStyle = 'rgba(70,70,66,0.38)';
      ctx.beginPath();
      ctx.arc(x + dx * r, y + dy * r, r * k, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      ctx.arc(x + dx * r - r * 0.02, y + dy * r - r * 0.02, r * k, Math.PI * 0.9, Math.PI * 1.7);
      ctx.stroke();
    }
  } else if (style === 'disco') {
    disc(ctx, x, y, r, '#8d939c');
    const n = 6;
    const cell = (r * 2) / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = (i * 37 + j * 53 + i * j * 11) % 5;
        ctx.fillStyle = ['#e9edf2', '#b4bac4', '#7d848f', '#d3d8e0', '#5d636d'][h];
        ctx.fillRect(x - r + i * cell + 0.4, y - r + j * cell + 0.4, cell - 0.8, cell - 0.8);
      }
    }
  } else if (style === 'orb') {
    // Orbe: espiral clara sobre un fondo violeta profundo, con núcleo brillante.
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#5ff0d0');
    g.addColorStop(0.3, '#2a8f9e');
    g.addColorStop(0.7, '#2a1466');
    g.addColorStop(1, '#0d0722');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.strokeStyle = 'rgba(190,255,240,0.55)';
    ctx.lineWidth = Math.max(0.5, r * 0.08);
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = t * TAU * 1.6;
      const rad = r * (0.12 + t * 0.8);
      if (i) ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      else ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.stroke();
  } else if (style === 'pumpkin') {
    disc(ctx, x, y, r, '#e8741c');
    ctx.strokeStyle = 'rgba(110,40,0,0.5)';
    ctx.lineWidth = lw * 1.2;
    for (const k of [0, 0.38, 0.72]) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * (1 - k) * 0.9 + r * 0.05, r * 1.05, 0, 0, TAU);
      ctx.stroke();
    }
  } else if (style === 'melon') {
    disc(ctx, x, y, r, '#3f9a45');
    ctx.strokeStyle = '#1d5a29';
    ctx.lineWidth = r * 0.16;
    for (const k of [-0.62, -0.2, 0.22, 0.64]) {
      ctx.beginPath();
      ctx.moveTo(x + k * r, y - r);
      ctx.quadraticCurveTo(x + k * r * 1.5, y, x + k * r, y + r);
      ctx.stroke();
    }
  } else if (style === 'eye') {
    disc(ctx, x, y, r, '#f4efe9');
    ctx.strokeStyle = 'rgba(200,60,60,0.45)';
    ctx.lineWidth = lw * 0.7;
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6 + 0.3;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 1.05);
      ctx.lineTo(x + Math.cos(a + 0.15) * r * 0.7, y + Math.sin(a + 0.15) * r * 0.7);
      ctx.stroke();
    }
    ctx.fillStyle = '#2a8bd6';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.52, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#05080f';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.24, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(x - r * 0.16, y - r * 0.16, r * 0.1, 0, TAU);
    ctx.fill();
  } else if (style === 'tango') {
    // Mundial retro: blanca con tres «hélices» negras de arcos que se tocan.
    disc(ctx, x, y, r, '#f6f4ee');
    ctx.strokeStyle = '#15171b';
    ctx.lineWidth = r * 0.13;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 3;
      const cx = x + Math.cos(a) * r * 0.55;
      const cy = y + Math.sin(a) * r * 0.55;
      for (const k of [0.22, 0.4]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r * k, a + Math.PI * 0.55, a + Math.PI * 1.45);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#15171b';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.09, 0, TAU);
    ctx.fill();
  } else if (style === 'nine') {
    // Bola 9 de billar: blanca con la franja amarilla y el número.
    disc(ctx, x, y, r, '#f7f5ef');
    ctx.fillStyle = '#f1c21b';
    ctx.fillRect(x - r, y - r * 0.5, r * 2, r);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.38, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#111317';
    ctx.font = `bold ${(r * 0.56).toFixed(2)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('9', x, y + r * 0.03);
  } else if (style === 'cue') {
    // Bola blanca de billar: blanca con un punto rojo chico.
    disc(ctx, x, y, r, '#fbfaf6');
    ctx.fillStyle = '#c8293e';
    ctx.beginPath();
    ctx.arc(x + r * 0.28, y - r * 0.22, r * 0.16, 0, TAU);
    ctx.fill();
  } else if (style === 'saturn') {
    // Planeta con anillo: bandas ocres y el anillo cruzado.
    disc(ctx, x, y, r, '#d9b57a');
    ctx.fillStyle = 'rgba(150,100,50,0.45)';
    for (const [dy, h] of [[-0.55, 0.16], [-0.18, 0.12], [0.3, 0.18]]) ctx.fillRect(x - r, y + dy * r, r * 2, h * r);
    ctx.strokeStyle = 'rgba(245,232,200,0.95)';
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.15, r * 0.32, -0.35, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,90,50,0.6)';
    ctx.lineWidth = r * 0.04;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.98, r * 0.24, -0.35, 0, TAU);
    ctx.stroke();
  } else if (style === 'xmas') {
    // Navidad: esfera roja de árbol con guarda dorada y copos.
    disc(ctx, x, y, r, '#b8172b');
    ctx.fillStyle = '#e6c04f';
    ctx.fillRect(x - r, y - r * 0.14, r * 2, r * 0.28);
    ctx.fillStyle = '#ffffff';
    for (const [dx, dy, k] of [[-0.5, -0.52, 0.07], [0.42, -0.45, 0.06], [-0.1, -0.7, 0.05], [0.5, 0.5, 0.07], [-0.45, 0.48, 0.06], [0.05, 0.68, 0.05]]) {
      ctx.beginPath();
      ctx.arc(x + dx * r, y + dy * r, r * k, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.35, y - r * 0.3, r * 0.22, r * 0.12, -0.6, 0, TAU);
    ctx.fill();
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
  if (style === 'glow') {
    // Halo: tres vueltas cada vez más finas y más claras.
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    const widths = [9, 5.5, 2.2];
    const alphas = [0.16, 0.3, 0.95];
    const prev = ctx.globalAlpha;
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = prev * alphas[i];
      ctx.lineWidth = widths[i] * px;
      ctx.beginPath();
      ctx.arc(x, y, r + 4 * px, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = prev;
    return true;
  }
  if (style === 'dots') {
    // Un anillo de puntitos redondos.
    DASH[0] = 0.1;
    DASH[1] = 5.5 * px;
    ctx.setLineDash(DASH);
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.4 * px;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r + 5 * px, 0, TAU);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.lineCap = 'butt';
    return true;
  }
  if (style === 'arrow') {
    // Una flechita que apunta a tu ficha desde arriba.
    const w = r * 0.9;
    const h = r * 0.8;
    const tip = y - r - 3 * px;
    ctx.beginPath();
    ctx.moveTo(x, tip);
    ctx.lineTo(x - w / 2, tip - h);
    ctx.lineTo(x + w / 2, tip - h);
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



/* ── El anillo de tu ficha (el gris que dibuja HaxBall) ─────────────────
 * HaxBall pinta un aro blanco al 30 % de radio 25 alrededor de TU disco.
 * Acá se redibuja con color, opacidad, distancia y difuminado propios. Con
 * difuminado el aro es una banda con degradé hacia los dos lados, así que
 * nunca queda una línea dura que tape el fondo. */
function drawOwnRing(ctx, x, y, r, color, alpha, soft) {
  const hex = safeColor(color) || '#ffffff';
  const R = parseInt(hex.slice(1, 3), 16);
  const G = parseInt(hex.slice(3, 5), 16);
  const B = parseInt(hex.slice(5, 7), 16);
  const a = Math.min(1, Math.max(0.02, Number(alpha) || 0.3));
  const s = Math.min(1, Math.max(0, Number(soft) || 0));
  ctx.save();
  try {
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    if (s < 0.02) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(${R},${G},${B},${a})`;
    } else {
      const half = 1.5 + s * 12;
      const g = ctx.createRadialGradient(x, y, Math.max(0, r - half), x, y, r + half);
      g.addColorStop(0, `rgba(${R},${G},${B},0)`);
      g.addColorStop(0.5, `rgba(${R},${G},${B},${a})`);
      g.addColorStop(1, `rgba(${R},${G},${B},0)`);
      ctx.lineWidth = half * 2;
      ctx.strokeStyle = g;
    }
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

/* ── Clima de la cancha ─────────────────────────────────────────────────
 * Partículas en coordenadas de cancha, dibujadas por debajo de las fichas.
 * Reglas de costo: buffers fijos (cero asignaciones por cuadro), un trazo por
 * capa, sin sombras ni filtros, y el tiempo sale del reloj (no del cuadro), así
 * que a 60 o a 240 FPS cae igual de rápido. Es sólo ambientación.
 * ------------------------------------------------------------------ */

const WX_MAX = 320;
const wx = {
  x: new Float32Array(WX_MAX),
  y: new Float32Array(WX_MAX),
  z: new Float32Array(WX_MAX),
  a: new Float32Array(WX_MAX),
  p: new Float32Array(WX_MAX),
  kind: '',
  last: 0,
  flashAt: 0,
  nextFlash: 0,
  sprite: null,
  fog: null
};

/** Textura de niebla que cierra en los bordes (se desliza sin costuras). */
function wxFogTexture() {
  if (wx.fog) return wx.fog;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  // Manchas con posiciones fijas (no al azar): la niebla se ve igual en cada arranque.
  const blobs = [[40, 90, 150], [150, 170, 120], [250, 60, 170], [340, 150, 140], [430, 80, 130], [90, 210, 110], [300, 220, 120], [470, 190, 100], [200, 120, 100]];
  const sprite = wxSprite();
  for (const [bx, by, br] of blobs) {
    for (const dx of [-512, 0, 512]) g.drawImage(sprite, bx + dx - br, by - br, br * 2, br * 2);
  }
  wx.fog = c;
  return c;
}

/** Mancha blanca y suave que se reutiliza para la niebla. */
function wxSprite() {
  if (wx.sprite) return wx.sprite;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  wx.sprite = c;
  return c;
}

/**
 * El velo de color de cada clima (el piso mojado, la niebla tenue…). Es plano y
 * va DEBAJO de los jugadores, así que el juego lo mete adentro del cache de la
 * cancha y lo paga una vez, no en cada cuadro (ver `skipVeil`).
 */
function weatherVeil(kind, amount) {
  const k = Math.min(1, Math.max(0.2, amount || 0.6));
  switch (kind) {
    case 'rain': return 'rgba(18,34,62,0.09)';
    case 'storm': return 'rgba(14,26,52,0.16)';
    case 'snow': return 'rgba(235,245,255,0.05)';
    case 'dust': return `rgba(196,146,78,${(0.04 + 0.07 * k).toFixed(3)})`;
    case 'leaves': return 'rgba(120,70,20,0.05)';
    case 'embers': return 'rgba(255,110,30,0.045)';
    case 'fireflies': return 'rgba(6,12,34,0.13)';
    case 'blizzard': return 'rgba(225,238,255,0.09)';
    case 'fog': return `rgba(214,224,234,${(0.03 + 0.06 * k).toFixed(3)})`;
    default: return null;
  }
}

function paintWeather(ctx, kind, amount, now, skipVeil) {
  const cv = ctx.canvas;
  if (!cv) return;
  const m = ctx.getTransform();
  const scale = Math.hypot(m.a, m.b);
  const det = m.a * m.d - m.b * m.c;
  if (!scale || !det) return;
  const W = cv.width;
  const H = cv.height;

  // El rectángulo de mundo que se ve (cajón que contiene a las cuatro esquinas).
  let vx = Infinity;
  let vy = Infinity;
  let mx = -Infinity;
  let my = -Infinity;
  for (let i = 0; i < 4; i++) {
    const sx = i & 1 ? W : 0;
    const sy = i & 2 ? H : 0;
    const wxp = (m.d * (sx - m.e) - m.c * (sy - m.f)) / det;
    const wyp = (m.a * (sy - m.f) - m.b * (sx - m.e)) / det;
    if (wxp < vx) vx = wxp;
    if (wxp > mx) mx = wxp;
    if (wyp < vy) vy = wyp;
    if (wyp > my) my = wyp;
  }
  const vw = mx - vx;
  const vh = my - vy;
  if (!(vw > 0) || !(vh > 0)) return;

  // Mundo por píxel de pantalla CSS: todo lo que se mide en píxeles pasa por acá.
  const px = (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) / scale;

  let dt = wx.last ? (now - wx.last) / 1000 : 0.016;
  wx.last = now;
  if (dt > 0.05) dt = 0.05;
  if (dt < 0) dt = 0;

  if (wx.kind !== kind) {
    wx.kind = kind;
    for (let i = 0; i < WX_MAX; i++) {
      wx.x[i] = vx + Math.random() * vw;
      wx.y[i] = vy + Math.random() * vh;
      wx.z[i] = Math.random();
      wx.a[i] = Math.random();
    }
    wx.nextFlash = now + 4000 + Math.random() * 6000;
  }

  const k = Math.min(1, Math.max(0.2, amount || 0.6));
  const t = now / 1000;
  const wrapX = (x) => vx + (((x - vx) % vw) + vw) % vw;
  const wrapY = (y) => vy + (((y - vy) % vh) + vh) % vh;

  ctx.save();
  try {
    if (kind === 'rain' || kind === 'storm') {
      const storm = kind === 'storm';
      // El suelo se pone un poco más oscuro y azulado, como mojado.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!skipVeil) {ctx.fillStyle = storm ? 'rgba(14,26,52,0.16)' : 'rgba(18,34,62,0.09)';
      ctx.fillRect(0, 0, W, H); }
      ctx.setTransform(m);

      const total = Math.round(WX_MAX * (0.35 + 0.65 * k));
      const drops = Math.round(total * 0.62);
      const wind = storm ? 0.5 : 0.2;
      const nrm = Math.hypot(wind, 1);
      const dx = wind / nrm;
      const dy = 1 / nrm;
      ctx.lineCap = 'round';
      for (let pass = 0; pass < 2; pass++) {
        // Las lejanas (z chico) finas y tenues; las cercanas más gruesas.
        ctx.beginPath();
        for (let i = 0; i < drops; i++) {
          const z = wx.z[i];
          if ((z > 0.5) !== (pass === 1)) continue;
          const speed = (storm ? 1250 : 900) + z * 550;
          const len = (storm ? 20 : 13) + z * 14;
          wx.x[i] = wrapX(wx.x[i] + dx * speed * px * dt);
          wx.y[i] = wrapY(wx.y[i] + dy * speed * px * dt);
          ctx.moveTo(wx.x[i], wx.y[i]);
          ctx.lineTo(wx.x[i] - dx * len * px, wx.y[i] - dy * len * px);
        }
        ctx.lineWidth = (pass ? 1.4 : 0.9) * px;
        ctx.strokeStyle = pass ? 'rgba(200,222,255,0.42)' : 'rgba(190,212,245,0.24)';
        ctx.stroke();
      }
      // Salpicaduras: anillos que se abren y se apagan en el piso.
      const rip0 = drops;
      for (let band = 0; band < 3; band++) {
        ctx.beginPath();
        for (let i = rip0; i < total; i++) {
          wx.a[i] += dt * (1.5 + wx.z[i] * 0.9);
          if (wx.a[i] >= 1) {
            wx.a[i] = 0;
            wx.x[i] = vx + Math.random() * vw;
            wx.y[i] = vy + Math.random() * vh;
          }
          if (Math.min(2, (wx.a[i] * 3) | 0) !== band) continue;
          const r = (1.5 + wx.a[i] * 11) * px;
          ctx.moveTo(wx.x[i] + r, wx.y[i]);
          ctx.arc(wx.x[i], wx.y[i], r, 0, TAU);
        }
        ctx.lineWidth = 1 * px;
        ctx.strokeStyle = `rgba(215,232,255,${[0.4, 0.24, 0.1][band]})`;
        ctx.stroke();
      }
      if (storm) {
        if (now > wx.nextFlash) {
          wx.flashAt = now;
          wx.nextFlash = now + 7000 + Math.random() * 9000;
        }
        const age = (now - wx.flashAt) / 360;
        if (wx.flashAt && age >= 0 && age < 1) {
          // Un destello corto con un segundo golpe tenue, nunca fuerte.
          const a = (age < 0.15 ? age / 0.15 : Math.max(0, 1 - age) / 0.85) * 0.1 * (1 + 0.5 * Math.sin(age * 22));
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = `rgba(225,235,255,${Math.max(0, a).toFixed(3)})`;
          ctx.fillRect(0, 0, W, H);
        }
      }
    } else if (kind === 'snow') {
      const total = Math.round(WX_MAX * (0.3 + 0.7 * k));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!skipVeil) {ctx.fillStyle = 'rgba(235,245,255,0.05)';
      ctx.fillRect(0, 0, W, H); }
      ctx.setTransform(m);
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (let i = 0; i < total; i++) {
          const z = wx.z[i];
          if ((z > 0.55) !== (pass === 1)) continue;
          const fall = 38 + z * 70;
          wx.x[i] = wrapX(wx.x[i] + Math.sin(t * (0.5 + z * 0.9) + wx.a[i] * 6.283) * 22 * px * dt + 8 * px * dt);
          wx.y[i] = wrapY(wx.y[i] + fall * px * dt);
          const r = (pass ? 2.3 + z * 1.2 : 1.1 + z * 0.9) * px;
          ctx.moveTo(wx.x[i] + r, wx.y[i]);
          ctx.arc(wx.x[i], wx.y[i], r, 0, TAU);
        }
        ctx.fillStyle = pass ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)';
        ctx.fill();
      }
    } else if (kind === 'dust') {
      const total = Math.round(WX_MAX * (0.3 + 0.7 * k));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!skipVeil) {ctx.fillStyle = `rgba(196,146,78,${(0.04 + 0.07 * k).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H); }
      ctx.setTransform(m);
      ctx.beginPath();
      for (let i = 0; i < total; i++) {
        const z = wx.z[i];
        const speed = 140 + z * 260;
        wx.x[i] = wrapX(wx.x[i] + speed * px * dt);
        wx.y[i] = wrapY(wx.y[i] + Math.sin(t * 0.9 + wx.a[i] * 6.283) * 12 * px * dt + 14 * px * dt);
        const l = (4 + z * 9) * px;
        ctx.rect(wx.x[i], wx.y[i], l, 1.1 * px);
      }
      ctx.fillStyle = 'rgba(232,200,140,0.42)';
      ctx.fill();
    } else if (kind === 'leaves') {
      // Hojas de otoño: elipses giradas en cuatro colores, una pasada por color.
      const total = Math.round(WX_MAX * (0.14 + 0.2 * k));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!skipVeil) {ctx.fillStyle = 'rgba(120,70,20,0.05)';
      ctx.fillRect(0, 0, W, H); }
      ctx.setTransform(m);
      const cols = ['rgba(214,120,38,0.85)', 'rgba(190,60,36,0.85)', 'rgba(222,176,52,0.85)', 'rgba(120,132,40,0.85)'];
      for (let c = 0; c < 4; c++) {
        ctx.beginPath();
        for (let i = c; i < total; i += 4) {
          const z = wx.z[i];
          wx.x[i] = wrapX(wx.x[i] + (26 + z * 38 + Math.sin(t * 0.9 + wx.a[i] * 6.283) * 34) * px * dt);
          wx.y[i] = wrapY(wx.y[i] + (34 + z * 44) * px * dt);
          const rx = (3 + z * 3.2) * px;
          const rot = t * (0.7 + z) + wx.a[i] * 6.283;
          ctx.moveTo(wx.x[i] + rx * Math.cos(rot), wx.y[i] + rx * Math.sin(rot));
          ctx.ellipse(wx.x[i], wx.y[i], rx, rx * 0.5, rot, 0, TAU);
        }
        ctx.fillStyle = cols[c];
        ctx.fill();
      }
    } else if (kind === 'embers') {
      // Brasas que suben y titilan. Mezcla aditiva: brillan sobre el piso.
      const total = Math.round(WX_MAX * (0.2 + 0.3 * k));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!skipVeil) {ctx.fillStyle = 'rgba(255,110,30,0.045)';
      ctx.fillRect(0, 0, W, H); }
      ctx.setTransform(m);
      ctx.globalCompositeOperation = 'lighter';
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (let i = 0; i < total; i++) {
          const z = wx.z[i];
          if ((z > 0.5) !== (pass === 1)) continue;
          wx.x[i] = wrapX(wx.x[i] + Math.sin(t * 1.3 + wx.a[i] * 6.283) * 18 * px * dt);
          wx.y[i] = wrapY(wx.y[i] - (42 + z * 90) * px * dt);
          const r = (pass ? 1.8 + z : 0.9 + z) * px;
          ctx.moveTo(wx.x[i] + r, wx.y[i]);
          ctx.arc(wx.x[i], wx.y[i], r, 0, TAU);
        }
        ctx.fillStyle = pass ? 'rgba(255,170,70,0.5)' : 'rgba(255,120,40,0.4)';
        ctx.fill();
      }
    } else if (kind === 'fireflies') {
      // Luciérnagas: manchas suaves que pulsan, sobre un toque de noche.
      const total = Math.round(14 + 34 * k);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!skipVeil) {ctx.fillStyle = 'rgba(6,12,34,0.13)';
      ctx.fillRect(0, 0, W, H); }
      ctx.setTransform(m);
      // Halo tenue y centro por luciérnaga, AGRUPADOS por intensidad: cuatro niveles por capa,
      // un trazo por nivel (8 `fill` por cuadro en vez de ~100 con el estado cambiando cada vez).
      const B = 4;
      for (let i = 0; i < total; i++) {
        const z = wx.z[i];
        wx.x[i] = wrapX(wx.x[i] + Math.cos(t * (0.3 + z * 0.4) + wx.a[i] * 6.283) * 16 * px * dt);
        wx.y[i] = wrapY(wx.y[i] + Math.sin(t * (0.4 + z * 0.3) + wx.a[i] * 9) * 14 * px * dt);
        wx.p[i] = 0.5 + 0.5 * Math.sin(t * (1.2 + z * 1.4) + wx.a[i] * 20);
      }
      for (const core of [false, true]) {
        ctx.fillStyle = core ? 'rgb(255,252,190)' : 'rgb(200,255,110)';
        for (let bk = 0; bk < B; bk++) {
          const lo = bk / B;
          const hi = (bk + 1) / B;
          ctx.beginPath();
          let any = false;
          for (let i = 0; i < total; i++) {
            const pl = wx.p[i];
            if (pl < lo || (pl >= hi && bk < B - 1)) continue;
            const r = (2 + wx.z[i] * 1.6) * px * (core ? 1 : 3.2);
            ctx.moveTo(wx.x[i] + r, wx.y[i]);
            ctx.arc(wx.x[i], wx.y[i], r, 0, TAU);
            any = true;
          }
          if (!any) continue;
          const mid = (bk + 0.5) / B;
          ctx.globalAlpha = core ? 0.35 + 0.65 * mid : 0.1 + 0.25 * mid;
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    } else if (kind === 'blizzard') {
      // Ventisca: nieve rápida y de costado.
      const total = Math.round(WX_MAX * (0.4 + 0.6 * k));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!skipVeil) {ctx.fillStyle = 'rgba(225,238,255,0.09)';
      ctx.fillRect(0, 0, W, H); }
      ctx.setTransform(m);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < total; i++) {
        const z = wx.z[i];
        const sx = 520 + z * 380;
        const sy = 120 + z * 90;
        wx.x[i] = wrapX(wx.x[i] + sx * px * dt);
        wx.y[i] = wrapY(wx.y[i] + sy * px * dt);
        const len = (8 + z * 14) * px;
        const nr = Math.hypot(sx, sy);
        ctx.moveTo(wx.x[i], wx.y[i]);
        ctx.lineTo(wx.x[i] - (sx / nr) * len, wx.y[i] - (sy / nr) * len);
      }
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
    } else if (kind === 'fog') {
      // La niebla es una textura que se arma UNA vez (manchas que cierran en los
      // bordes) y se desliza: dos capas a distinta velocidad, cuatro `drawImage`.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!skipVeil) {ctx.fillStyle = `rgba(214,224,234,${(0.03 + 0.06 * k).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H); }
      // Una sola capa: dos `drawImage` que juntos cubren la pantalla una vez.
      const tex = wxFogTexture();
      const u = (((t * 0.009) % 1) + 1) % 1;
      const x0 = -u * W;
      ctx.globalAlpha = 0.22 + 0.4 * k;
      ctx.drawImage(tex, x0, 0, W, H);
      ctx.drawImage(tex, x0 + W, 0, W, H);
    }
  } finally {
    ctx.restore();
  }
}

/* ── Marcas de partido ──────────────────────────────────────────────────
 * El resultado, grande y muy tenue, pintado en el piso de cada mitad. Se ve
 * mientras la pelota espera en el medio y se va con una animación apenas sale
 * del saque. Sólo repite el marcador que ya está en pantalla.
 * ------------------------------------------------------------------ */

const mm = {
  p: 0, dir: 0, rest: 0, last: 0, red: -1, blue: -1,
  shR: -1, shB: -1, prevR: -1, prevB: -1, bumpR: 0, bumpB: 0, pendR: false, pendB: false
};

function resetMatchMark() {
  mm.p = 0; mm.dir = 0; mm.rest = 0; mm.last = 0; mm.red = -1; mm.blue = -1; mm.lv = undefined;
  mm.shR = mm.shB = mm.prevR = mm.prevB = -1;
  mm.bumpR = mm.bumpB = 0;
  mm.pendR = mm.pendB = false;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (v) => 1 - Math.pow(1 - v, 3);
const easeInCubic = (v) => v * v * v;
const easeOutBack = (v) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2);
};

const MM_FONTS = {
  default: '"Bahnschrift","Segoe UI","Arial Narrow",system-ui,sans-serif',
  impact: '"Impact","Haettenschweiler","Arial Narrow Bold",sans-serif',
  mono: '"Consolas","Cascadia Mono","Courier New",monospace',
  serif: '"Georgia","Times New Roman",serif',
  round: '"Arial Rounded MT Bold","Trebuchet MS","Segoe UI",sans-serif',
  outfit: '"Segoe UI Black","Segoe UI","Arial Black",sans-serif'
};

function paintMatchMark(ctx, o) {
  const now = o.now;
  let dt = mm.last ? (now - mm.last) / 1000 : 0.016;
  mm.last = now;
  if (dt > 0.1) dt = 0.1;
  if (dt < 0) dt = 0;
  const always = o.mode === 'always';

  if (mm.red >= 0 && o.red !== mm.red) mm.pendR = true;
  if (mm.blue >= 0 && o.blue !== mm.blue) mm.pendB = true;
  mm.red = o.red;
  mm.blue = o.blue;
  if (mm.shR < 0) mm.shR = o.red;
  if (mm.shB < 0) mm.shB = o.blue;

  const near = o.hasBall && Math.hypot(o.ballX, o.ballY) < 3;
  if (near) { if (!mm.rest) mm.rest = now; } else mm.rest = 0;
  if (always) mm.dir = 1;
  else if (near && now - mm.rest > 220) mm.dir = 1;
  else if (!near) mm.dir = -1;
  // En modo «siempre» el cartel sigue ahí durante el juego, más apagado.
  const liveTarget = always && !near ? 0.42 : 1;
  mm.lv = mm.lv === undefined ? liveTarget : mm.lv + (liveTarget - mm.lv) * Math.min(1, dt * 5);

  // Entra en 0.75 s y sale en 0.5 s.
  mm.p += (mm.dir > 0 ? dt / 0.75 : -dt / 0.5) * (mm.dir ? 1 : 0);
  if (mm.p > 1) mm.p = 1;
  if (mm.p <= 0) { mm.p = 0; return; }

  // El marcador nuevo arranca el contador cuando el cartel ya casi llegó.
  if (mm.dir > 0 && mm.p > 0.55) {
    if (mm.pendR) { mm.prevR = mm.shR; mm.shR = o.red; mm.bumpR = now; mm.pendR = false; }
    if (mm.pendB) { mm.prevB = mm.shB; mm.shB = o.blue; mm.bumpB = now; mm.pendB = false; }
  }
  if (mm.dir < 0) {
    if (mm.pendR) { mm.shR = o.red; mm.pendR = false; }
    if (mm.pendB) { mm.shB = o.blue; mm.pendB = false; }
  }

  const k = o.size > 0 ? o.size : 1;
  const size = Math.min(o.halfH * 0.62, o.halfW * 0.3) * k;
  if (!(size > 4)) return;
  const base = Math.min(1, Math.max(0, o.opacity)) * mm.lv;
  const style = o.style || 'ring';
  const anim = o.anim || 'rise';
  const pos = o.pos > 0 ? o.pos : 0.5;
  const burst = o.burst !== false;

  ctx.save();
  try {
    ctx.font = `800 ${size.toFixed(1)}px ${MM_FONTS[o.font] || MM_FONTS.default}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const mir = o.mirrored ? -1 : 1;
    for (let side = -1; side <= 1; side += 2) {
      const red = side < 0;
      const lag = 0.22;
      let q;
      if (mm.dir >= 0) q = clamp01((mm.p - (red ? 0 : lag)) / (1 - lag));
      else q = clamp01((mm.p - (red ? lag : 0)) / (1 - lag));
      if (q <= 0) continue;

      let sc;
      let ox = 0;
      let oy = 0;
      let a;
      if (mm.dir >= 0) {
        const e = easeOutBack(q);
        a = easeOutCubic(q);
        if (anim === 'zoom') { sc = 2.2 - 1.2 * easeOutCubic(q); a = easeOutCubic(clamp01(q * 1.4)); }
        else if (anim === 'slide') { sc = 0.9 + 0.1 * e; ox = side * (1 - easeOutCubic(q)) * o.halfW * 0.5; }
        else if (anim === 'drop') { sc = 1; oy = -(1 - e) * size * 1.6; a = clamp01(q * 2.5); }
        else { sc = 0.7 + 0.3 * e; oy = (1 - e) * size * 0.35; ox = side * (1 - easeOutCubic(q)) * o.halfW * 0.06; }
      } else {
        const e = easeInCubic(1 - q);
        sc = 1 + e * 0.28;
        ox = side * e * o.halfW * 0.16;
        oy = -e * size * 0.1;
        a = q;
      }
      const bump = red ? mm.bumpR : mm.bumpB;
      const since = bump ? (now - bump) / 1000 : 9;
      const roll = clamp01(since / 0.55);
      const value = red ? mm.shR : mm.shB;
      const prev = red ? mm.prevR : mm.prevB;
      const flash = since < 0.9 ? Math.exp(-since * 4.5) : 0;
      const pop = 1 + (burst ? 0.12 : 0.05) * flash;
      const custom = red ? o.colorR : o.colorB;
      const fill = custom || (o.tint === 'team' ? (red ? '#ff6b5e' : '#5fa6ff') : '#ffffff');

      ctx.save();
      ctx.translate(side * o.halfW * pos + ox, oy);
      ctx.scale(mir * sc * pop, sc * pop);

      const ringR = size * 0.74;
      const sweep = mm.dir >= 0 ? easeOutCubic(q) : q;
      const hasRing = style === 'ring' || style === 'neon' || style === 'badge';

      // Fondo de la insignia: disco tenue del color del equipo.
      if (style === 'badge') {
        ctx.globalAlpha = base * a * 0.22;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(0, 0, ringR, 0, TAU);
        ctx.fill();
      }
      if (hasRing && sweep > 0.01) {
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1.5, size * 0.022);
        ctx.strokeStyle = fill;
        ctx.globalAlpha = base * a * 0.85;
        ctx.beginPath();
        const start = -Math.PI / 2 + (mm.dir < 0 ? (1 - sweep) * TAU * 0.5 : 0);
        ctx.arc(0, 0, ringR, start, -Math.PI / 2 + TAU * sweep);
        if (style === 'neon') {
          // Brillo con trazos anchos y tenues en vez de `shadowBlur`: el desenfoque
          // se recalculaba en cada cuadro sobre un círculo enorme.
          const lw = ctx.lineWidth;
          const ga = ctx.globalAlpha;
          ctx.lineWidth = lw * 7; ctx.globalAlpha = ga * 0.12; ctx.stroke();
          ctx.lineWidth = lw * 3.5; ctx.globalAlpha = ga * 0.25; ctx.stroke();
          ctx.lineWidth = lw; ctx.globalAlpha = ga;
        }
        ctx.stroke();
      }
      if (burst && since < 0.9) {
        const pr = clamp01(since / 0.9);
        ctx.lineWidth = Math.max(1.5, size * 0.03 * (1 - pr));
        ctx.strokeStyle = fill;
        ctx.globalAlpha = base * a * (1 - pr) * 1.1;
        ctx.beginPath();
        ctx.arc(0, 0, ringR * (1 + 0.55 * easeOutCubic(pr)), 0, TAU);
        ctx.stroke();
        // Rayitas que salen del número al convertir.
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1.5, size * 0.025 * (1 - pr));
        ctx.globalAlpha = base * a * (1 - pr);
        ctx.beginPath();
        const r0 = ringR * (1.05 + 0.2 * pr);
        const r1 = ringR * (1.15 + 0.7 * easeOutCubic(pr));
        for (let n = 0; n < 14; n++) {
          const ang = (n / 14) * TAU + 0.2;
          ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
          ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
        }
        ctx.stroke();
      }

      // El número.
      ctx.save();
      ctx.beginPath();
      ctx.rect(-size * 1.4, -size * 0.8, size * 2.8, size * 1.6);
      ctx.clip();
      const drawNum = (txt, yoff, alpha) => {
        if (alpha <= 0.002) return;
        const y = size * 0.03 + yoff;
        if (style === '3d') {
          // Volumen: copias hacia abajo y a la derecha, más oscuras.
          ctx.fillStyle = '#000000';
          ctx.globalAlpha = alpha * 0.45;
          const depth = Math.max(2, Math.round(size * 0.05));
          for (let d = depth; d >= 1; d--) ctx.fillText(txt, d * 0.9, y + d * 0.9);
          ctx.fillStyle = fill;
          ctx.globalAlpha = alpha;
          ctx.fillText(txt, 0, y);
        } else if (style === 'outline') {
          ctx.globalAlpha = alpha * 0.18;
          ctx.fillStyle = fill;
          ctx.fillText(txt, 0, y);
          ctx.globalAlpha = Math.min(1, alpha * 1.6);
          ctx.lineWidth = Math.max(2, size * 0.045);
          ctx.strokeStyle = fill;
          ctx.strokeText(txt, 0, y);
        } else if (style === 'neon') {
          ctx.globalAlpha = alpha * 0.25;
          ctx.fillStyle = fill;
          ctx.fillText(txt, 0, y);
          ctx.globalAlpha = Math.min(1, alpha * 1.5);
          const lw = Math.max(2, size * 0.03);
          const ga = ctx.globalAlpha;
          ctx.strokeStyle = fill;
          // Mismo brillo que con `shadowBlur`, sin desenfocar texto gigante por cuadro.
          ctx.lineWidth = lw * 6; ctx.globalAlpha = ga * 0.1; ctx.strokeText(txt, 0, y);
          ctx.lineWidth = lw * 3; ctx.globalAlpha = ga * 0.22; ctx.strokeText(txt, 0, y);
          ctx.lineWidth = lw; ctx.globalAlpha = ga;
          ctx.strokeText(txt, 0, y);
        } else {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = fill;
          ctx.fillText(txt, 0, y);
        }
      };
      if (roll < 1 && prev >= 0 && prev !== value) {
        const er = easeOutCubic(roll);
        drawNum(String(prev), -er * size * 0.8, base * a * (1 - er));
        const en = easeOutBack(roll);
        drawNum(String(value), (1 - en) * size * 0.8, base * a * clamp01(roll * 2.2));
      } else {
        drawNum(String(value), 0, base * a);
      }
      ctx.restore();

      ctx.restore();
    }
  } finally {
    ctx.restore();
  }
}

module.exports = {
  TEXTURES,
  textureSpec,
  paintTexture,
  paintCrest,
  paintLight,
  discOverlay,
  ballOverlay,
  drawRing,
  noteTrail,
  drawTrail,
  resetTrail,
  isLightLine,
  paintWeather,
  weatherVeil,
  drawOwnRing,
  paintMatchMark,
  resetMatchMark,
  safeColor
};
