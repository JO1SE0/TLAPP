/* Cursor de mira para la cancha: un SVG chiquito como cursor del canvas. */
'use strict';

const STYLES = ['default', 'cruz', 'punto', 'circulo', 'mira', 'club'];

function cleanColor(c) {
  return /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? String(c) : '#ffffff';
}

function svgFor(style, color, size) {
  const s = Math.max(16, Math.min(64, Math.round(Number(size) || 28)));
  const c = cleanColor(color);
  const m = s / 2;
  const dark = 'rgba(0,0,0,0.65)';
  const line = (x1, y1, x2, y2) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${dark}" stroke-width="4" stroke-linecap="round"/>` +
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`;
  let body = '';
  const g = Math.round(s * 0.14);
  const e = 3;
  if (style === 'cruz' || style === 'mira') {
    body += line(e, m, m - g, m) + line(m + g, m, s - e, m) + line(m, e, m, m - g) + line(m, m + g, m, s - e);
  }
  if (style === 'punto' || style === 'mira') {
    body += `<circle cx="${m}" cy="${m}" r="2.6" fill="${dark}"/><circle cx="${m}" cy="${m}" r="1.8" fill="${c}"/>`;
  }
  if (style === 'circulo') {
    body += `<circle cx="${m}" cy="${m}" r="${m - 4}" fill="none" stroke="${dark}" stroke-width="4"/>` +
      `<circle cx="${m}" cy="${m}" r="${m - 4}" fill="none" stroke="${c}" stroke-width="2"/>`;
  }
  if (style === 'club') {
    body += `<circle cx="${m}" cy="${m}" r="${m - 4}" fill="none" stroke="#203860" stroke-width="5"/>` +
      `<circle cx="${m}" cy="${m}" r="${m - 4}" fill="none" stroke="#d0b878" stroke-width="2.4"/>` +
      `<circle cx="${m}" cy="${m}" r="2.6" fill="#d0b878"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${body}</svg>`;
  return { svg, hot: Math.round(m), size: s };
}

/** CSS para el cursor, o '' si está en «default». */
function css(style, color, size) {
  if (!STYLES.includes(style) || style === 'default') return '';
  const { svg, hot } = svgFor(style, color, size);
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return `canvas { cursor: url("${url}") ${hot} ${hot}, crosshair !important; }`;
}

module.exports = { STYLES, css, svgFor };
