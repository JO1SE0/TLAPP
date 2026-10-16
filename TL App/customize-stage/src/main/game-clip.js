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
    liviana: { w: 480, h: 270, bps: 1000000 },
    normal: { w: 640, h: 360, bps: 1600000 },
    alta: { w: 960, h: 540, bps: 3000000 },
    ultra: { w: 1280, h: 720, bps: 5000000 }
  };
  const FPS_LIST = [12, 15, 24, 30, 60];
  const MAX_COLS = 15;
  const MAX_SIDE = 16384; // lado máximo de un canvas en Chromium
  const MAX_BYTES = 600 * 1048576; // tope de memoria de video de la grilla
  const ZOOMS = [1, 0.7, 0.5]; // qué parte de la pantalla se graba (centrada): 1 = toda

  /** Defaults y límites de la config de clips. */
  function clean(cfg) {
    const c = cfg || {};
    const sec = Number(c.seconds);
    return {
      enabled: !!c.enabled,
      quality: PRESETS[c.quality] ? c.quality : 'normal',
      fps: FPS_LIST.indexOf(Number(c.fps)) >= 0 ? Number(c.fps) : 15,
      seconds: Number.isFinite(sec) ? Math.min(30, Math.max(5, Math.round(sec))) : 15,
      autoGoal: !!c.autoGoal,
      zoom: ZOOMS.indexOf(Number(c.zoom)) >= 0 ? Number(c.zoom) : 1,
      key: typeof c.key === 'string' && c.key ? c.key : 'F9'
    };
  }

  /**
   * Medidas de la grilla para una config. `bytes` es lo que ocupa en la placa de
   * video (RGBA): se muestra en los ajustes para que nadie se lleve sorpresas.
   * Con mucha resolución y muchos cuadros por segundo, el tope de memoria
   * recorta cuántos segundos entran (`seconds` es lo que de verdad guarda).
   */
  function plan(cfg) {
    const c = clean(cfg);
    const p = { ...PRESETS[c.quality], fps: c.fps };
    const cols = Math.max(1, Math.min(MAX_COLS, Math.floor(MAX_SIDE / p.w)));
    let cap = p.fps * c.seconds;
    let rows = Math.ceil(cap / cols);
    while (cap > cols && (rows * p.h > MAX_SIDE || cols * p.w * rows * p.h * 4 > MAX_BYTES)) {
      cap -= cols;
      rows = Math.ceil(cap / cols);
    }
    return { ...p, cols, rows, cap, seconds: Math.min(c.seconds, Math.floor(cap / p.fps)), bytes: cols * p.w * rows * p.h * 4 };
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
  function mux(frames, w, h, fps, times) {
    // Con los tiempos reales de captura el video dura lo que duró la partida
    // (el temporizador del juego no es exacto); una pausa larga se acorta.
    const at = [];
    if (times && times.length === frames.length) {
      const maxGap = (4 * 1000) / fps;
      let acc = 0;
      for (let i = 0; i < frames.length; i++) {
        if (i) acc += Math.min(Math.max(times[i] - times[i - 1], 1), maxGap);
        at.push(Math.round(acc));
      }
    } else {
      for (let i = 0; i < frames.length; i++) at.push(Math.round((i * 1000) / fps));
    }
    const ms = (i) => at[i];
    const endMs = at.length ? at[at.length - 1] + Math.round(1000 / fps) : 0;
    const header = el([0x1a, 0x45, 0xdf, 0xa3], [
      el([0x42, 0x86], uint(1)), el([0x42, 0xf7], uint(1)), el([0x42, 0xf2], uint(4)), el([0x42, 0xf3], uint(8)),
      el([0x42, 0x82], text('webm')), el([0x42, 0x87], uint(2)), el([0x42, 0x85], uint(2))
    ]);
    const info = el([0x15, 0x49, 0xa9, 0x66], [
      el([0x2a, 0xd7, 0xb1], uint(1000000)),
      el([0x44, 0x89], float64(endMs)),
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
    let start = 0;
    while (start < frames.length) {
      const t0 = ms(start);
      let end = start;
      while (end < frames.length && ms(end) - t0 < 1000) end++;
      const blocks = [el([0xe7], uint(t0))];
      for (let i = start; i < end; i++) {
        const rel = ms(i) - t0;
        blocks.push(el([0xa3], [Uint8Array.from([0x81, (rel >> 8) & 255, rel & 255, 0x80]), frames[i]]));
      }
      const cluster = el([0x1f, 0x43, 0xb6, 0x75], blocks);
      cues.push(el([0xbb], [el([0xb3], uint(t0)), el([0xb7], [el([0xf7], uint(1)), el([0xf1], uint(offset))])]));
      children.push(cluster);
      offset += cluster.length;
      start = end;
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
    let times = null; // cuándo se copió cada cuadro (ms), en el mismo orden circular
    let timer = 0;
    let busy = false;
    let failures = 0;

    function release() {
      if (timer) view.clearInterval(timer);
      timer = 0;
      if (atlas) { atlas.width = 0; atlas.height = 0; }
      atlas = null; actx = null; geo = null; times = null; n = 0; failures = 0;
    }

    function build() {
      geo = plan(cfg);
      atlas = doc.createElement('canvas');
      atlas.width = geo.cols * geo.w;
      atlas.height = geo.rows * geo.h;
      actx = atlas.getContext('2d', { alpha: false });
      actx.imageSmoothingEnabled = true;
      // «high» filtra bien al achicar (con «low» las líneas y los textos salían escalonados).
      actx.imageSmoothingQuality = 'high';
      times = new Float64Array(geo.cap);
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
        // El encuadre: sólo la parte central de la pantalla (acerca la acción).
        const z = cfg.zoom;
        const sw = src.width * z;
        const sh = src.height * z;
        const sx = (src.width - sw) / 2;
        const sy = (src.height - sh) / 2;
        const k = Math.min(geo.w / sw, geo.h / sh);
        const dw = sw * k;
        const dh = sh * k;
        if (dw < geo.w - 0.5 || dh < geo.h - 0.5) {
          actx.fillStyle = '#000';
          actx.fillRect(x, y, geo.w, geo.h);
        }
        actx.drawImage(src, sx, sy, sw, sh, x + (geo.w - dw) / 2, y + (geo.h - dh) / 2, dw, dh);
        times[i] = view.performance.now();
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
      const changed = !geo || prev.quality !== cfg.quality || prev.seconds !== cfg.seconds || prev.zoom !== cfg.zoom || prev.fps !== cfg.fps;
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
        // Los cuadros salen chicos (la cancha es casi plana): se puede ir con calidad alta.
        const quality = 0.9;
        const encode = () => new Promise((resolve) => out.toBlob(resolve, 'image/webp', quality));

        const frames = [];
        const stamps = [];
        for (let k = 0; k < count; k++) {
          const i = (first + k) % g.cap;
          octx.drawImage(snap, (i % g.cols) * g.w, Math.floor(i / g.cols) * g.h, g.w, g.h, 0, 0, g.w, g.h);
          const blob = await encode();
          if (!blob || blob.type !== 'image/webp') return { ok: false, reason: 'unsupported' };
          const frame = vp8Of(new Uint8Array(await blob.arrayBuffer()));
          if (!frame) return { ok: false, reason: 'error', error: 'el cuadro WebP no tiene VP8' };
          frames.push(frame);
          stamps.push(times[i]);
          // Un respiro cada tanto: el juego sigue dibujando mientras se codifica.
          if (k % 4 === 3) await sleep(0);
        }
        const bytes = mux(frames, g.w, g.h, g.fps, stamps);
        const real = stamps.length > 1 ? (stamps[stamps.length - 1] - stamps[0]) / 1000 : count / g.fps;
        return { ok: true, bytes, seconds: real, width: g.w, height: g.h };
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
