/* Sonidos de gol sintetizados (sin archivos). Los usan la partida y la vista previa. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TLGoalSfx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STYLES = [
    ['default', 'El del juego', 'Game default'],
    ['hinchada', 'Hinchada', 'Crowd roar'],
    ['estadio', 'Estadio', 'Stadium'],
    ['bombo', 'Bombo', 'Bass drum'],
    ['vuvuzela', 'Vuvuzela', 'Vuvuzela'],
    ['aplausos', 'Aplausos', 'Applause'],
    ['silbato', 'Silbato', 'Whistle']
  ];

  function tone(ctx, out, t, freq, dur, type, vol, slideTo) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(ctx, out, t, dur, vol, freq, q) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t); s.stop(t + dur + 0.05);
  }

  /* Ruido con crecida lenta: la base de una multitud. */
  function swell(ctx, out, t, dur, vol, freq, q, attack) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + attack + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t); s.stop(t + dur + 0.05);
  }

  /* Una «voz» de hinchada: dientes de sierra filtrados como una «a» gritada. */
  function voice(ctx, out, t, base, dur, vol) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.18, t + dur * 0.35);
    o.frequency.linearRampToValueAtTime(base * 0.92, t + dur);
    const vib = ctx.createOscillator();
    const vg = ctx.createGain();
    vib.frequency.value = 5 + Math.random() * 2; vg.gain.value = base * 0.015;
    vib.connect(vg); vg.connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1250; f2.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(out);
    o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
  }

  function thump(ctx, out, t, vol, low) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(low ? 150 : 190, t);
    o.frequency.exponentialRampToValueAtTime(low ? 42 : 55, t + 0.18);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (low ? 0.55 : 0.4));
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.7);
    noise(ctx, out, t, 0.05, vol * 0.5, 2200, 0.8);
  }

  function crowd(ctx, out, t, dur, vol) {
    swell(ctx, out, t, dur, vol * 0.9, 500, 0.6, 0.45);
    swell(ctx, out, t, dur, vol * 0.7, 1100, 0.7, 0.35);
    swell(ctx, out, t + 0.1, dur, vol * 0.4, 2600, 0.9, 0.3);
    for (let i = 0; i < 9; i++) voice(ctx, out, t + 0.05 + Math.random() * 0.5, 130 + Math.random() * 110, dur * (0.55 + Math.random() * 0.3), vol * 0.07);
  }

  const RECIPES = {
    hinchada(c, o, t) { crowd(c, o, t, 3.2, 0.9); },
    estadio(c, o, t) {
      crowd(c, o, t + 0.25, 3.6, 1);
      thump(c, o, t, 0.9, true);
      thump(c, o, t + 0.55, 0.7, true);
    },
    bombo(c, o, t) {
      thump(c, o, t, 0.95, true);
      thump(c, o, t + 0.3, 0.8, false);
      thump(c, o, t + 0.6, 0.8, false);
      thump(c, o, t + 0.9, 1, true);
      swell(c, o, t + 0.2, 1.8, 0.25, 700, 0.6, 0.5);
    },
    vuvuzela(c, o, t) {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.12);
      g.gain.setValueAtTime(0.28, t + 1.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
      lp.connect(g); g.connect(o);
      [233, 233.9, 466, 699].forEach((f, i) => {
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f * 0.96, t);
        osc.frequency.linearRampToValueAtTime(f, t + 0.15);
        const og = c.createGain(); og.gain.value = i < 2 ? 0.5 : 0.25;
        osc.connect(og); og.connect(lp);
        osc.start(t); osc.stop(t + 1.8);
      });
      swell(c, o, t, 1.6, 0.06, 1500, 1.5, 0.1);
    },
    aplausos(c, o, t) {
      for (let i = 0; i < 40; i++) noise(c, o, t + Math.random() * 2.2, 0.04 + Math.random() * 0.05, 0.3, 1800 + Math.random() * 2500, 0.8);
      swell(c, o, t, 2.4, 0.14, 2500, 0.5, 0.4);
    },
    silbato(c, o, t) {
      /* Silbato de árbitro: tono con la bolilla (trino rápido) en el medio. */
      const osc = c.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(2750, t);
      osc.frequency.linearRampToValueAtTime(2950, t + 0.9);
      const trill = c.createOscillator(); trill.frequency.value = 38;
      const tg = c.createGain(); tg.gain.value = 0.5;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
      g.gain.setValueAtTime(0.5, t + 0.75);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      trill.connect(tg); tg.connect(g.gain);
      osc.connect(g); g.connect(o);
      osc.start(t); trill.start(t); osc.stop(t + 1.05); trill.stop(t + 1.05);
      noise(c, o, t, 0.9, 0.05, 3600, 2);
    }
  };

  let shared = null;
  function play(style, volume, AC) {
    const recipe = RECIPES[style];
    if (!recipe) return false;
    const Ctor = AC || (typeof AudioContext !== 'undefined' ? AudioContext : null);
    if (!Ctor) return false;
    try {
      if (!shared) shared = new Ctor();
      const ctx = shared;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      const master = ctx.createGain();
      master.gain.value = Math.min(1, Math.max(0, volume));
      master.connect(ctx.destination);
      recipe(ctx, master, ctx.currentTime + 0.01);
      return true;
    } catch (e) { return false; }
  }

  /*
   * Palo: el golpe de una pelota contra un caño de acero hueco. Cuatro capas:
   *  · un golpe seco grave (el cuerpo del impacto, ~90 Hz que cae rápido),
   *  · un «clac» corto de ruido filtrado medio (el contacto),
   *  · el tono del caño, grave y largo (~210 Hz) con parciales inarmónicos de
   *    tubo (2.76×, 5.40×, 8.93×) que se apagan cada uno a su ritmo,
   *  · y cada parcial doblado con otro apenas desafinado: ese batido es el
   *    brillo «metálico» que le da el aire de cosa dura y gruesa.
   * Todo pasa por un pasabajos para que no quede agudo ni chillón.
   * `strength` (0..1) cambia volumen y dureza.
   */
  function postRecipe(ctx, out, t, strength) {
    // Un caño de acero de verdad, no una campanita: se lo GOLPEA con un chasquido
    // cortísimo y la barra suena sola, con parciales que no son armónicos y que
    // se apagan a distinta velocidad (los agudos primero). Así cada golpe es
    // "tonng" y no "ding". La fuerza sólo cambia el volumen, no el timbre.
    const k = Math.min(1, Math.max(0.35, strength));
    const sr = ctx.sampleRate;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    lp.Q.value = 0.5;
    const trim = ctx.createGain();
    trim.gain.value = 0.5 * (0.5 + 0.5 * k);
    lp.connect(trim);
    trim.connect(out);

    // Ruido repetible (siempre el mismo chasquido): suena igual de "palo" cada vez.
    const noiseBuf = (seconds, seed) => {
      const n = Math.max(2, Math.floor(sr * seconds));
      const buf = ctx.createBuffer(1, n, sr);
      const d = buf.getChannelData(0);
      let st = seed >>> 0;
      for (let i = 0; i < n; i++) {
        st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
        d[i] = ((st / 4294967295) * 2 - 1) * (1 - i / n);
      }
      return buf;
    };

    // El golpe: dos chasquidos, uno medio y otro más seco.
    // 4 ms de chasquido y después silencio hasta 1,3 s: mantiene vivos a los
    // filtros todo el tiempo que suena la barra (el motor los apaga antes si se
    // quedan sin entrada).
    const burst = ctx.createBufferSource();
    // Se arma una vez por contexto y se reusa: son ~250 KB que no hace falta repetir.
    if (!ctx.__tlPostBurst) {
      ctx.__tlPostBurst = ctx.createBuffer(1, Math.floor(sr * 1.3), sr);
      ctx.__tlPostBurst.getChannelData(0).set(noiseBuf(0.004, 12345).getChannelData(0));
    }
    burst.buffer = ctx.__tlPostBurst;
    burst.start(t);
    const hit = ctx.createBufferSource();
    hit.buffer = noiseBuf(0.006, 777);
    const hitBp = ctx.createBiquadFilter();
    hitBp.type = 'bandpass'; hitBp.frequency.value = 2800; hitBp.Q.value = 1;
    const hitGain = ctx.createGain();
    hitGain.gain.value = 0.62;
    hit.connect(hitBp); hitBp.connect(hitGain); hitGain.connect(lp);
    hit.start(t);

    // La barra: modos de un caño libre-libre (1 · 2,76 · 5,4 · 8,9 …), cada uno
    // un filtro muy resonante. [frecuencia, duración (s), ganancia calibrada].
    const wobble = 1 + (Math.random() - 0.5) * 0.012;   // cada golpe, apenas distinto
    const modes = [[330, 0.22, 900], [905, 0.15, 504], [1770, 0.09, 128], [2930, 0.05, 101], [4350, 0.032, 30]];
    for (const [freq, tau, gain] of modes) {
      const f = freq * wobble;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = Math.PI * f * tau;
      // La ganancia va ANTES del filtro: el motor corta la cola del filtro cuando
      // baja de cierto nivel relativo a su propia salida, y amplificando después
      // quedaba cortada con el sonido todavía audible.
      const g = ctx.createGain();
      g.gain.value = gain * (sr === 48000 ? 1 : 0.95);
      burst.connect(g); g.connect(bp); bp.connect(lp);
    }

    // El cuerpo del impacto: un "tump" corto, que baja de tono, sin ser grave.
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(130, t);
    body.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.5, t + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    body.connect(bodyGain); bodyGain.connect(lp);
    body.start(t); body.stop(t + 0.2);
  }

  /* Gancho de volumen/contexto compartido con `play`. */
  function playPost(volume, strength, AC) {
    const Ctor = AC || (typeof AudioContext !== 'undefined' ? AudioContext : null);
    if (!Ctor) return false;
    try {
      if (!shared) shared = new Ctor();
      const ctx = shared;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      const master = ctx.createGain();
      master.gain.value = Math.min(1, Math.max(0, volume));
      master.connect(ctx.destination);
      postRecipe(ctx, master, ctx.currentTime + 0.005, strength);
      return true;
    } catch (e) { return false; }
  }

  return { STYLES, play, playPost, has: (s) => !!RECIPES[s] };
});
