/*
 * Datos de una canción para el cartel «Ahora suena»: título, artista y, si el
 * archivo la trae, la tapa.
 *
 *   · título y artista salen del nombre del archivo («07 - Artista - Título»):
 *     los mp3 que se bajan de la web casi nunca traen etiquetas.
 *   · la tapa se lee de la etiqueta ID3v2 (cuadro APIC), si existe.
 */
'use strict';

const fs = require('fs');

const NOISE = /\s*[(\[]?\b(official\s*(music\s*)?(video|audio)|video\s*oficial|audio\s*oficial|visualizer|lyric\s*video|prod\.?\s*by[^)\]]*)\b[)\]]?/gi;

function parseName(name) {
  let s = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ');
  s = s.replace(/^\s*\d+\s*[-.)]\s*/, '').replace(NOISE, '').replace(/\s{2,}/g, ' ').trim();
  const i = s.indexOf(' - ');
  if (i > 0) return { artist: s.slice(0, i).trim(), title: s.slice(i + 3).trim() || s };
  return { artist: '', title: s };
}

const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

/** Tapa embebida (data URL) o null. Sólo ID3v2.3 / 2.4 y hasta ~3 MB. */
async function readCover(file) {
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    const head = Buffer.alloc(10);
    await fh.read(head, 0, 10, 0);
    if (head.toString('latin1', 0, 3) !== 'ID3') return null;
    const ver = head[3];
    if (ver !== 3 && ver !== 4) return null;
    const size = Math.min(syncsafe(head, 6), 3 * 1024 * 1024);
    const buf = Buffer.alloc(size);
    await fh.read(buf, 0, size, 10);
    let o = 0;
    while (o + 10 < size) {
      const id = buf.toString('latin1', o, o + 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const len = ver === 4 ? syncsafe(buf, o + 4) : buf.readUInt32BE(o + 4);
      const body = o + 10;
      if (len <= 0 || body + len > size) break;
      if (id === 'APIC') {
        const enc = buf[body];
        let p = body + 1;
        let e = buf.indexOf(0, p);
        if (e < 0) return null;
        let mime = buf.toString('latin1', p, e) || 'image/jpeg';
        p = e + 1 + 1; // tipo de imagen
        // Descripción: termina en 0 (o en 00 00 si es UTF-16).
        if (enc === 1 || enc === 2) {
          while (p + 1 < body + len && !(buf[p] === 0 && buf[p + 1] === 0)) p += 2;
          p += 2;
        } else {
          p = buf.indexOf(0, p) + 1;
        }
        if (!/^image\//i.test(mime)) mime = mime.toLowerCase() === 'jpg' ? 'image/jpeg' : 'image/' + mime.toLowerCase();
        const img = buf.subarray(p, body + len);
        if (img.length < 200) return null;
        return `data:${mime};base64,${img.toString('base64')}`;
      }
      o = body + len;
    }
    return null;
  } catch { return null; } finally { if (fh) await fh.close().catch(() => {}); }
}

module.exports = { parseName, readCover };
