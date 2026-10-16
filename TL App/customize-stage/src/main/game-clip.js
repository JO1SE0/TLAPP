'use strict';

/*
 * Clips: guardar los últimos segundos de la partida como video.
 *
 * Cómo se mantiene liviano (la regla es que NO se note en los FPS):
 *
 *   · Mientras jugás NO se codifica video. Cada tanto —12 a 20 veces por
 *     segundo, no por cada cuadro del juego— se copia la cancha, ya achicada, a
 *     una grilla («atlas») que vive en la placa de video. Es una copia de
 *     canvas a canvas: no baja píxeles a la CPU ni toca el disco.
 *   · La grilla es circular: pisa los cuadros más viejos, así que la memoria es
 *     fija (ver `plan`, que también sirve a la interfaz para avisar cuánto es).
 *   · El video se arma recién al clipear: cada cuadro de la grilla se codifica
 *     (WebP) y se empaqueta en un .webm. Tarda un par de segundos, de a pocos
 *     cuadros por vez; el juego sigue y la grilla sigue grabando.
 *   · Apagado (por defecto) no corre nada: ni temporizador ni memoria.
 *
 * Es un módulo de DOM puro —sin electron— para poder probarlo en un navegador.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TLClip = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PRESETS = {
    liviana: { w: 320, h: 180, fps: 12, bps: 1000000 },
    normal: { w: 480, h: 270, fps: 15, bps: 1600000 },
    alta: { w: 640, h: 360, fps: 20, bps: 3000000 }
  };
  const COLS = 15;
  const MAX_SIDE = 16384; // lado máximo de un canvas en Chromium

  /** Defaults y límites de la config de clips. */
  function clean(cfg) {
    const c = cfg || {};
    const sec = Number(c.seconds);
    return {
      enabled: !!c.enabled,
      quality: PRESETS[c.quality] ? c.quality : 'normal',
      seconds: Number.isFinite(sec) ? Math.min(30, Math.max(5, Math.round(sec))) : 15,
      autoGoal: !!c.autoGoal,
      key: typeof c.key === 'string' && c.key ? c.key : 'F9'
    };
  }

  /**
   * Medidas de la grilla para una config. `bytes` es lo que ocupa en la placa de
   * video (RGBA): se muestra en los ajustes para que nadie se lleve sorpresas.
   */
  function plan(cfg) {
    const c = clean(cfg);
    const p = PRESETS[c.quality];
    let cap = p.fps * c.seconds;
    let rows = Math.ceil(cap / COLS);
    while (rows * p.h > MAX_SIDE || COLS * p.w > MAX_SIDE) {
      cap -= COLS;
      rows = Math.ceil(cap / COLS);
    }
    return { ...p, cols: COLS, rows, cap, seconds: c.seconds, bytes: COLS * p.w * rows * p.h * 4 };
  }

  /*
   * El video se arma a mano en vez de con MediaRecorder: en algunos Electron el
   * grabador queda «grabando» y no entrega nunca un solo trozo (salía un clip de
   * 0 bytes). Cada cuadro se codifica como WebP —que por dentro es un cuadro VP8
   * completo— y se los empaqueta en un contenedor WebM con su duración y su
   * índice, así el reproductor deja saltar a cualquier punto. Sin grabador, sin
   * esperar el tiempo real: tarda lo que cuesta codificar los cuadros.
   */
  function concat(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function sizeOf(n) {
    let len = 1;
    while (len < 8 && n >= Math.pow(2, 7 * len) - 1) len++;
    const out = new Uint8Array(len);
    let v = n;
    for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
    out[0] |= 1 << (8 - len);
    return out;
  }
  function el(id, payload) {
    const body = Array.isArray(payload) ? concat(payload) : payload;
    return concat([Uint8Array.from(id), sizeOf(body.length), body]);
  }
  function uint(n) {
    const bytes = [];
    let v = n;
    do { bytes.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0);
    return Uint8Array.from(bytes);
  }
  function float64(x) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, x);
    return b;
  }
  function text(str) { return Uint8Array.from(Array.from(str).map((c) => c.charCodeAt(0) & 127)); }

  /** El cuadro VP8 que va adentro de un WebP con pérdida (o null si no lo es). */
  function vp8Of(webp) {
    if (webp.length < 20 || text('RIFF').some((c, i) => webp[i] !== c) || text('WEBP').some((c, i) => webp[8 + i] !== c)) return null;
    let o = 12;
    while (o + 8 <= webp.length) {
      const tag = String.fromCharCode(webp[o], webp[o + 1], webp[o + 2], webp[o + 3]);
      const len = webp[o + 4] | (webp[o + 5] << 8) | (webp[o + 6] << 16) | (webp[o + 7] * 16777216);
      if (tag === 'VP8 ') return webp.subarray(o + 8, o + 8 + len);
      o += 8 + len + (len & 1);
    }
    return null;
  }

  /** Empaqueta cuadros VP8 (todos clave) en un .webm. */
  function mux(frames, w, h, fps) {
    const ms = (i) => Math.round((i * 1000) / fps);
    const header = el([0x1a, 0x45, 0xdf, 0xa3], [
      el([0x42, 0x86], uint(1)), el([0x42, 0xf7], uint(1)), el([0x42, 0xf2], uint(4)), el([0x42, 0xf3], uint(8)),
      el([0x42, 0x82], text('webm')), el([0x42, 0x87], uint(2)), el([0x42, 0x85], uint(2))
    ]);
    const info = el([0x15, 0x49, 0xa9, 0x66], [
      el([0x2a, 0xd7, 0xb1], uint(1000000)),
      el([0x44, 0x89], float64(ms(frames.length))),
      el([0x4d, 0x80], text('TL App')), el([0x57, 0x41], text('TL App'))
    ]);
    const tracks = el([0x16, 0x54, 0xae, 0x6b], [
      el([0xae], [
        el([0xd7], uint(1)), el([0x73, 0xc5], uint(1)), el([0x83], uint(1)), el([0x9c], uint(0)),
        el([0x86], text('V_VP8')),
        el([0xe0], [el([0xb0], uint(w)), el([0xba], uint(h))])
      ])
    ]);
    const children = [info, tracks];
    let offset = info.length + tracks.length;
    const cues = [];
    // Un grupo por segundo de video: cada uno con su entrada en el índice.
    for (let start = 0; start < frames.length; start += fps) {
      const t0 = ms(start);
      const blocks = [el([0xe7], uint(t0))];
      for (let i = start; i < Math.min(frames.length, start + fps); i++) {
        const rel = ms(i) - t0;
        blocks.push(el([0xa3], [Uint8Array.from([0x81, (rel >> 8) & 255, rel & 255, 0x80]), frames[i]]));
      }
      const cluster = el([0x1f, 0x43, 0xb6, 0x75], blocks);
      cues.push(el([0xbb], [el([0xb3], uint(t0)), el([0xb7], [el([0xf7], uint(1)), el([0xf1], uint(offset))])]));
      children.push(cluster);
      offset += cluster.length;
    }
    children.push(el([0x1c, 0x53, 0xbb, 0x6b], cues));
    return concat([header, el([0x18, 0x53, 0x80, 0x67], children)]);
  }

  /**
   * @param {Window} view  ventana donde corren los temporizadores
   * @param {{getCanvas: () => HTMLCanvasElement|null, onError?: (msg: string) => void}} hooks
   */
  function create(view, hooks) {
    const doc = view.document;
    let cfg = clean(null);
    let geo = null;
    let atlas = null;
    let actx = null;
    let n = 0; // cuadros copiados desde que arrancó
    let timer = 0;
    let busy = false;
    let failures = 0;

    function release() {
      if (timer) view.clearInterval(timer);
      timer = 0;
      if (atlas) { atlas.width = 0; atlas.height = 0; }
      atlas = null; actx = null; geo = null; n = 0; failures = 0;
    }

    function build() {
      geo = plan(cfg);
      atlas = doc.createElement('canvas');
      atlas.width = geo.cols * geo.w;
      atlas.height = geo.rows * geo.h;
      actx = atlas.getContext('2d', { alpha: false });
      actx.imageSmoothingQuality = 'low';
      n = 0;
      timer = view.setInterval(tick, Math.round(1000 / geo.fps));
    }

    function tick() {
      if (doc.hidden) return;
      let src = null;
      try { src = hooks.getCanvas(); } catch (e) { src = null; }
      // Sin sala (o con la cancha escondida) no hay nada que copiar.
      if (!src || src.width < 2 || src.height < 2 || !src.getClientRects().length) return;
      try {
        const i = n % geo.cap;
        const x = (i % geo.cols) * geo.w;
        const y = Math.floor(i / geo.cols) * geo.h;
        const k = Math.min(geo.w / src.width, geo.h / src.height);
        const dw = src.width * k;
        const dh = src.height * k;
        if (dw < geo.w - 0.5 || dh < geo.h - 0.5) {
          actx.fillStyle = '#000';
          actx.fillRect(x, y, geo.w, geo.h);
        }
        actx.drawImage(src, x + (geo.w - dw) / 2, y + (geo.h - dh) / 2, dw, dh);
        n++;
        failures = 0;
      } catch (e) {
        // Si copiar falla seguido no se insiste: se apaga solo y avisa una vez.
        if (++failures >= 8) {
          release();
          if (hooks.onError) hooks.onError('Los clips se apagaron: no se pudo copiar la cancha.');
        }
      }
    }

    function configure(next) {
      const prev = cfg;
      cfg = clean(next);
      if (!cfg.enabled) { release(); return; }
      const changed = !geo || prev.quality !== cfg.quality || prev.seconds !== cfg.seconds;
      if (changed) { release(); build(); }
    }

    function stop() { release(); }

    /** Cuántos segundos hay listos para clipear ahora mismo. */
    function ready() {
      return geo ? Math.min(n, geo.cap) / geo.fps : 0;
    }

    function sleep(ms) { return new Promise((r) => view.setTimeout(r, ms)); }

    /**
     * Arma el video con lo que hay en la grilla. Devuelve los bytes del .webm.
     * Cada cuadro se codifica aparte (ver `mux`), de a pocos por vez para que el
     * juego siga fluido, y el clip queda listo en un par de segundos.
     */
    async function clip() {
      if (busy) return { ok: false, reason: 'busy' };
      if (!atlas || !geo || n < geo.fps) return { ok: false, reason: 'empty' };
      busy = true;
      let snap = null;
      let out = null;
      try {
        const g = geo;
        const count = Math.min(n, g.cap);
        const first = n >= g.cap ? n % g.cap : 0;
        // Foto de la grilla: la de verdad sigue grabando mientras se codifica.
        snap = doc.createElement('canvas');
        snap.width = atlas.width;
        snap.height = atlas.height;
        snap.getContext('2d', { alpha: false }).drawImage(atlas, 0, 0);

        out = doc.createElement('canvas');
        out.width = g.w;
        out.height = g.h;
        const octx = out.getContext('2d', { alpha: false });
        const quality = g.w >= 640 ? 0.8 : g.w >= 480 ? 0.72 : 0.62;
        const encode = () => new Promise((resolve) => out.toBlob(resolve, 'image/webp', quality));

        const frames = [];
        for (let k = 0; k < count; k++) {
          const i = (first + k) % g.cap;
          octx.drawImage(snap, (i % g.cols) * g.w, Math.floor(i / g.cols) * g.h, g.w, g.h, 0, 0, g.w, g.h);
          const blob = await encode();
          if (!blob || blob.type !== 'image/webp') return { ok: false, reason: 'unsupported' };
          const frame = vp8Of(new Uint8Array(await blob.arrayBuffer()));
          if (!frame) return { ok: false, reason: 'error', error: 'el cuadro WebP no tiene VP8' };
          frames.push(frame);
          // Un respiro cada tanto: el juego sigue dibujando mientras se codifica.
          if (k % 4 === 3) await sleep(0);
        }
        const bytes = mux(frames, g.w, g.h, g.fps);
        return { ok: true, bytes, seconds: count / g.fps, width: g.w, height: g.h };
      } catch (e) {
        return { ok: false, reason: 'error', error: e && e.message };
      } finally {
        // Se suelta la memoria de la foto enseguida: no tiene que quedar nada.
        if (snap) { snap.width = 0; snap.height = 0; }
        if (out) { out.width = 0; out.height = 0; }
        busy = false;
      }
    }

    return { configure, stop, clip, ready, isBusy: () => busy, active: () => !!atlas };
  }

  return { PRESETS, clean, plan, create, mux, vp8Of };
});
