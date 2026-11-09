/*
 * El tema de la página Club.
 *
 * Mientras la página Club está abierta suena, bajito y en loop, el pedazo de
 * «Timeless» desde el 1:03 (donde entra el beat). La música del menú se frena
 * mientras tanto (`TLMusic.hold`) y al salir sigue desde donde estaba.
 *
 * El recorte (`assets/club-theme.ogg`) dura justo 16 compases a 120 BPM (32 s)
 * y arranca en un tiempo fuerte, así que el loop cae a tempo. Se reproduce con
 * Web Audio y no con <audio loop>: el loop de un <audio> deja un huequito al
 * volver al principio, y con un beat se nota.
 *
 * Al ritmo: los cuatro números de arriba entran uno por golpe con su cuenta. El
 * escudo sigue con su animación de siempre, no con el tema. Todo eso es sólo opacity/transform, y sólo con
 * la página abierta y en el menú: jugando no existe.
 */
(function () {
  'use strict';

  const URL_THEME = '../../assets/club-theme.ogg';
  const BEAT = 0.5;          // 120 BPM
  const FADE_IN = 0.8;
  const FADE_OUT = 0.6;
  const LEVEL = 0.75;        // respecto del volumen de la música de la app

  let ctx = null;
  let buffer = null;
  let loading = null;
  let src = null;
  let gain = null;
  let t0 = 0;
  let on = false;
  let raf = 0;
  let lastBeat = -1;
  let stopTimer = 0;

  function animOn() {
    return document.documentElement.dataset.animations !== 'off';
  }

  async function load() {
    if (buffer) return buffer;
    if (!loading) {
      loading = (async () => {
        let bytes = null;
        // Por el proceso principal: un fetch a file:// no anda en Electron.
        try {
          const b = window.tvm && window.tvm.clubTheme ? await window.tvm.clubTheme() : null;
          if (b && b.byteLength) bytes = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        } catch (e) { bytes = null; }
        if (!bytes) bytes = await (await fetch(URL_THEME)).arrayBuffer();
        if (!ctx) ctx = new AudioContext({ latencyHint: 'playback' });
        buffer = await ctx.decodeAudioData(bytes);
        return buffer;
      })().catch((e) => { loading = null; throw e; });
    }
    return loading;
  }

  /* ── Los números, uno por golpe ─────────────────────────────────────── */
  const KPIS = ['#kpiOnline', '#kpiPlayers', '#kpiGoals', '#kpiMatches'];

  function countUp(el) {
    const target = Number(String(el.textContent).replace(/[^\d.]/g, '')) || 0;
    if (!target) return;
    const t = performance.now();
    let written = '0';
    el.textContent = written;
    const step = () => {
      // Si otra parte de la app escribió un número nuevo, ése manda.
      if (el.textContent !== written) return;
      const k = Math.min(1, (performance.now() - t) / 420);
      written = String(Math.round(target * (1 - Math.pow(1 - k, 3))));
      el.textContent = written;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function hideKpis() {
    if (!animOn()) return;
    for (const id of KPIS) {
      const b = document.querySelector(id);
      const card = b && b.closest('.kpi');
      if (card) card.classList.add('kpi--wait');
    }
  }

  function showKpi(i) {
    const b = document.querySelector(KPIS[i]);
    const card = b && b.closest('.kpi');
    if (!card || !card.classList.contains('kpi--wait')) return;
    card.classList.remove('kpi--wait');
    if (animOn()) {
      card.animate([
        { opacity: 0, transform: 'translateY(10px) scale(.94)' },
        { opacity: 1, transform: 'translateY(0) scale(1.03)', offset: 0.6 },
        { opacity: 1, transform: 'none' }
      ], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
      countUp(b);
    }
  }

  function showAllKpis() {
    for (let i = 0; i < KPIS.length; i++) showKpi(i);
  }

  function tick() {
    raf = 0;
    if (!on || !ctx || !src) return;
    const beat = Math.floor(Math.max(0, ctx.currentTime - t0) / BEAT);
    if (beat !== lastBeat) {
      lastBeat = beat;
      // El escudo NO sigue el tema: mantiene su animación de siempre (crestFloat
      // en app.css). Al ritmo sólo entran los cuatro números del club.
      if (beat >= 1 && beat <= 4) showKpi(beat - 1);
    }
    // Entrados los cuatro números ya no hay nada que seguir: se corta el bucle.
    if (lastBeat >= 4) return;
    raf = requestAnimationFrame(tick);
  }

  async function start(opts) {
    clearTimeout(stopTimer);
    if (on) return;
    const M = window.TLMusic;
    const enabled = M ? M.enabled : true;
    if (!enabled) return;
    on = true;
    hideKpis();
    if (M) M.hold(true);
    try {
      await load();
    } catch (e) {
      on = false;
      showAllKpis();
      if (M) M.hold(false);
      return;
    }
    if (!on) return;
    try { if (ctx.state === 'suspended') await ctx.resume(); } catch (e) { /* sigue */ }
    if (!on) return;

    const vol = Math.min(1, Math.max(0, (opts && typeof opts.volume === 'number') ? opts.volume : (M ? M.volume : 0.35))) * LEVEL;
    gain = ctx.createGain();
    gain.connect(ctx.destination);
    src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gain);
    // Un respiro para que la música del menú termine de bajar.
    t0 = ctx.currentTime + 0.12;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + FADE_IN);
    src.start(t0);
    lastBeat = -1;
    if (!raf) raf = requestAnimationFrame(tick);
    // Si el audio no arrancara por algo, los números igual tienen que aparecer.
    setTimeout(() => { if (on) showAllKpis(); }, 2600);
  }

  function stop() {
    clearTimeout(stopTimer);
    const wasOn = on;
    on = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    showAllKpis();
    const s = src;
    const g = gain;
    src = null;
    gain = null;
    if (s && g && ctx) {
      const now = ctx.currentTime;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + FADE_OUT);
        s.stop(now + FADE_OUT + 0.05);
      } catch (e) { try { s.stop(); } catch (e2) { /* ya paró */ } }
    }
    if (wasOn && window.TLMusic) window.TLMusic.hold(false);
    // El hilo de audio no tiene por qué quedar despierto con la página cerrada.
    stopTimer = setTimeout(() => { if (!on && ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }, (FADE_OUT + 0.4) * 1000);
  }

  /** Cambió el volumen de la app con el tema sonando. */
  function setVolume(v) {
    if (!on || !gain || !ctx) return;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(Math.min(1, Math.max(0, v)) * LEVEL, now, 0.08);
  }

  window.TLClubTheme = {
    start,
    stop,
    setVolume,
    get playing() { return on; }
  };
})();
