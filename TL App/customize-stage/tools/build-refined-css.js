#!/usr/bin/env node
/*
 * Genera src/renderer/css/design-refined.gen.css a partir de theme.css y app.css.
 *
 * Los diseños "Refinado" e "iOS" (Aspecto → Diseño) lleva los tamaños de letra a una escala
 * fija de 9 pasos con mínimo de 11 px, los radios de esquina a 6 pasos y saca los
 * pesos finos. Para no romper la cascada se copia CADA regla que toca esas
 * propiedades (cambie o no el valor) con el prefijo html:is([data-design="refined"], [data-design="ios"]):
 * todas suben la misma especificidad y mantienen el orden, así que gana la misma
 * regla que ganaba antes, sólo que con el valor nuevo.
 *
 * Correr de nuevo cada vez que se toque app.css o theme.css:
 *   node tools/build-refined-css.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '..', 'src', 'renderer', 'css');
const SOURCES = ['theme.css', 'app.css'];
const OUT = path.join(CSS_DIR, 'design-refined.gen.css');
// Lo usan el diseño Refinado y el iOS (que se apoya en el Refinado).
const ATTR = ':is([data-design="refined"], [data-design="ios"])';

// ── Escalas ──────────────────────────────────────────────────────────────
const TYPE = [11, 12, 13, 14, 16, 18, 22, 28, 34];
const RADII = [6, 10, 14, 18, 24, 32];

function nearest(scale, v) {
  let best = scale[0];
  for (const s of scale) if (Math.abs(s - v) < Math.abs(best - v) || (Math.abs(s - v) === Math.abs(best - v) && s > best)) best = s;
  return best;
}
const fmt = (n) => String(+n.toFixed(2));
function typePx(v) {
  if (v >= 34) return v;            // titulares grandes: se dejan como están
  if (v < 11) return 11;            // mínimo legible
  return nearest(TYPE, v);
}
function radiusPx(v) {
  if (v <= 4 || v >= 50) return v;  // filos finos y píldoras quedan igual
  return nearest(RADII, v);
}

const mapPx = (value, fn) => value.replace(/(^|[\s(,/])(\d*\.?\d+)px\b/g, (m, pre, n) => pre + fmt(fn(parseFloat(n))) + 'px');

const PROPS = {
  'font-size': (v) => mapPx(v, typePx),
  // en el atajo `font` el tamaño es el número en px que va antes de la familia o del "/"
  font: (v) => v.replace(/(^|\s)(\d*\.?\d+)px(?=[\s/])/, (m, pre, n) => pre + fmt(typePx(parseFloat(n))) + 'px'),
  'font-weight': (v) => (/^[123]00$/.test(v.trim()) ? '400' : v),
  'border-radius': (v) => mapPx(v, radiusPx),
  'border-top-left-radius': (v) => mapPx(v, radiusPx),
  'border-top-right-radius': (v) => mapPx(v, radiusPx),
  'border-bottom-left-radius': (v) => mapPx(v, radiusPx),
  'border-bottom-right-radius': (v) => mapPx(v, radiusPx),
};
// variables de escala del propio theme.css
const VARS = {
  '--fs-2xs': '11px', '--fs-xs': '12px', '--fs-sm': '13px', '--fs-md': '14px', '--fs-lg': '16px', '--fs-xl': '22px',
  '--radius': '14px', '--radius-sm': '10px', '--r-ctl': '10px', '--r-surface': '14px',
};

// ── Parser mínimo (comentarios, strings, bloques anidados) ──────────────
function parse(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  function readUntil(stops) {
    let out = '', q = null, depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { out += c; if (c === '\\') { out += src[++i]; } else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; out += c; continue; }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth === 0 && stops.includes(c)) return out;
      out += c;
    }
    return out;
  }
  function block() {
    const nodes = [];
    while (i < src.length) {
      const head = readUntil('{};').trim();
      const c = src[i++];
      if (c === '}' || c === undefined) { return nodes; }
      if (c === ';') continue; // @import / @charset sueltos
      if (head.startsWith('@')) {
        const name = head.slice(1).split(/[\s(]/)[0].toLowerCase();
        if (name === 'media' || name === 'supports') nodes.push({ at: head, children: block() });
        else skip();
      } else {
        nodes.push({ selector: head, decls: decls() });
      }
    }
    return nodes;
  }
  function skip() { // salta un bloque { ... } entero (keyframes, font-face)
    let d = 1, q = null;
    for (; i < src.length && d > 0; i++) {
      const c = src[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '{') d++;
      else if (c === '}') d--;
    }
  }
  function decls() {
    const out = [];
    while (i < src.length) {
      const d = readUntil(';}');
      const c = src[i++];
      const k = d.indexOf(':');
      if (k > 0) out.push({ prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim() });
      if (c === '}') break;
    }
    return out;
  }
  return block();
}

function splitSelectors(sel) {
  const out = []; let cur = '', depth = 0;
  for (const c of sel) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function prefix(sel) {
  return splitSelectors(sel).map((s) => {
    if (/^:root\b/.test(s)) return s.replace(/^:root/, ':root' + ATTR);
    if (/^html\b/.test(s)) return s.replace(/^html/, 'html' + ATTR);
    return 'html' + ATTR + ' ' + s;
  }).join(',\n');
}

function emit(nodes, indent = '') {
  let out = '';
  for (const n of nodes) {
    if (n.at) {
      const inner = emit(n.children, indent + '  ');
      if (inner) out += `${indent}${n.at} {\n${inner}${indent}}\n`;
      continue;
    }
    const keep = [];
    for (const d of n.decls) {
      const imp = /!important\s*$/i.test(d.value);
      const val = d.value.replace(/\s*!important\s*$/i, '');
      if (PROPS[d.prop]) keep.push(`${d.prop}: ${PROPS[d.prop](val)}${imp ? ' !important' : ''}`);
      else if (VARS[d.prop] && /(^|,)\s*:root\s*($|,)/.test(n.selector)) keep.push(`${d.prop}: ${VARS[d.prop]}`);
    }
    if (keep.length) out += `${indent}${prefix(n.selector)} { ${keep.join('; ')}; }\n`;
  }
  return out;
}

let out = '/* GENERADO por tools/build-refined-css.js — no editar a mano. */\n';
for (const f of SOURCES) {
  const tree = parse(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'));
  out += `\n/* ── ${f} ── */\n` + emit(tree);
}
fs.writeFileSync(OUT, out);
console.log('ok', path.relative(process.cwd(), OUT), (out.length / 1024).toFixed(1) + ' KB');
