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
 *   · El video se arma recién al clipear: se pasa la grilla a un MediaRecorder a
 *     la velocidad real y sale un .webm. Eso tarda lo que dura el clip y corre en
 *     segundo plano; el juego sigue y la grilla sigue grabando.
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

  function pickMime(view) {
    const MR = view.MediaRecorder;
    if (!MR || !MR.isTypeSupported) return '';
    for (const m of ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']) {
      if (MR.isTypeSupported(m)) return m;
    }
    return '';
  }

  /**
   * @param {Window} view  ventana donde corren los temporizadores y el MediaRecorder
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
     * Tarda lo que dura el clip (se reproduce a velocidad real hacia el grabador).
     */
    async function clip() {
      if (busy) return { ok: false, reason: 'busy' };
      if (!atlas || !geo || n < geo.fps) return { ok: false, reason: 'empty' };
      const mime = pickMime(view);
      if (!mime) return { ok: false, reason: 'unsupported' };
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
        const drawFrame = (k) => {
          const i = (first + k) % g.cap;
          octx.drawImage(snap, (i % g.cols) * g.w, Math.floor(i / g.cols) * g.h, g.w, g.h, 0, 0, g.w, g.h);
        };

        const stream = out.captureStream();
        const rec = new view.MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: g.bps });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const stopped = new Promise((r) => { rec.onstop = r; });

        drawFrame(0);
        rec.start(500);
        const t0 = view.performance.now();
        const step = 1000 / g.fps;
        let last = 0;
        await new Promise((resolve) => {
          const iv = view.setInterval(() => {
            const k = Math.floor((view.performance.now() - t0) / step);
            if (k >= count) { view.clearInterval(iv); resolve(); return; }
            if (k !== last) { drawFrame(k); last = k; }
          }, Math.max(8, Math.floor(step / 2)));
        });
        await sleep(150);
        rec.stop();
        await stopped;
        stream.getTracks().forEach((t) => t.stop());

        const blob = new view.Blob(chunks, { type: mime });
        const bytes = new Uint8Array(await blob.arrayBuffer());
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

  return { PRESETS, clean, plan, create };
});
