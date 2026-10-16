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


  /* ── Sonidos de patada ──────────────────────────────────────────────────
   * Cortitos (menos de 0,35 s), suaves y sin chillidos: pensados para oírse
   * miles de veces sin cansar. Cada golpe sale con una variación mínima de tono y
   * de volumen —lo que separa un sonido «vivo» de una ametralladora de clones—.
   * Todo se genera con osciladores y un ruido que se calcula UNA vez; no hay
   * archivos ni cuentas por cuadro, y por golpe se crean cinco o seis nodos.   */
  const KICK_STYLES = [
    ['default', 'El del juego', 'Game default'],
    ['lofi', 'Lo-fi', 'Lo-fi'],
    ['vinilo', 'Vinilo', 'Vinyl'],
    ['cassette', 'Cassette', 'Cassette'],
    ['madera', 'Madera', 'Wood block'],
    ['bongo', 'Bongó', 'Bongo'],
    ['burbuja', 'Burbuja', 'Bubble'],
    ['gota', 'Gota', 'Droplet'],
    ['tecla', 'Tecla', 'Keyboard'],
    ['cuero', 'Cuero', 'Leather'],
    ['pelotazo', 'Pelotazo', 'Heavy'],
    ['marimba', 'Marimba', 'Marimba'],
    ['chasquido', 'Chasquido', 'Finger snap'],
    ['vidrio', 'Vidrio', 'Glass tap'],
    ['pluck', 'Cuerda', 'Pluck'],
    ['redoblante', 'Redoblante', 'Snare']
  ];

  let noiseBuf = null;
  function noiseBuffer(ctx) {
    if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
    const n = Math.floor(ctx.sampleRate * 0.4);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /** Golpecito de ruido filtrado: el «clic» de casi todo golpe. */
  function tick(ctx, out, t, dur, vol, freq, q, type) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.2, dur + 0.02);
  }

  /** Tono que cae (o sube) de f0 a f1: el cuerpo del golpe. */
  function body(ctx, out, t, f0, f1, dur, vol, type) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur * 0.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.03);
  }

  /** Un pasabajos delante de `out`: lo que le da el aire «lo-fi» a un sonido. */
  function soften(ctx, out, freq) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = 0.5;
    f.connect(out);
    return f;
  }

  const PENTA = [392, 440, 523.25, 587.33, 659.25];

  const KICKS = {
    lofi(c, o, t, k) {
      const s = soften(c, o, 3200);
      body(c, s, t, 175 * k, 68 * k, 0.17, 0.95);
      tick(c, s, t, 0.03, 0.22, 1100, 0.8);
    },
    vinilo(c, o, t, k) {
      const s = soften(c, o, 4200);
      body(c, s, t, 150 * k, 62 * k, 0.14, 0.85);
      for (let i = 0; i < 4; i++) tick(c, s, t + 0.004 + Math.random() * 0.07, 0.004, 0.16 + Math.random() * 0.12, 5200, 0.7, 'highpass');
    },
    cassette(c, o, t, k) {
      const s = soften(c, o, 2800);
      body(c, s, t, 160 * k, 72 * k, 0.2, 0.55);
      body(c, s, t, 164 * k, 74 * k, 0.2, 0.4);
      tick(c, s, t, 0.14, 0.07, 3500, 0.5, 'lowpass');
    },
    madera(c, o, t, k) {
      tick(c, o, t, 0.05, 0.95, 950 * k, 9);
      body(c, o, t, 560 * k, 380 * k, 0.07, 0.3);
    },
    bongo(c, o, t, k) {
      body(c, o, t, 270 * k, 175 * k, 0.15, 0.8);
      tick(c, o, t, 0.022, 0.32, 1900, 1.2);
    },
    burbuja(c, o, t, k) {
      body(c, o, t, 380 * k, 1150 * k, 0.1, 0.6);
      body(c, o, t, 760 * k, 2200 * k, 0.06, 0.12);
    },
    gota(c, o, t, k) {
      body(c, o, t, 1550 * k, 640 * k, 0.11, 0.55);
      body(c, o, t, 3100 * k, 1300 * k, 0.04, 0.08, 'triangle');
    },
    tecla(c, o, t, k) {
      tick(c, o, t, 0.014, 0.45, 3300 * k, 1.5);
      body(c, o, t + 0.004, 145 * k, 92 * k, 0.07, 0.6);
      tick(c, o, t + 0.032, 0.01, 0.2, 2400, 1.5);
    },
    cuero(c, o, t, k) {
      body(c, o, t, 215 * k, 96 * k, 0.14, 0.8);
      tick(c, o, t, 0.06, 0.38, 700, 1);
    },
    pelotazo(c, o, t, k) {
      const s = soften(c, o, 2600);
      body(c, s, t, 135 * k, 48 * k, 0.32, 1);
      tick(c, s, t, 0.09, 0.5, 520, 0.7, 'lowpass');
    },
    marimba(c, o, t, k) {
      const f = PENTA[Math.floor(Math.random() * PENTA.length)] * (0.5 + 0.5 * k);
      body(c, o, t, f, f * 0.995, 0.3, 0.55);
      body(c, o, t, f * 4, f * 3.98, 0.08, 0.14);
      tick(c, o, t, 0.012, 0.18, 2200, 1);
    },
    chasquido(c, o, t, k) {
      tick(c, o, t, 0.04, 0.75, 2800 * k, 3);
      tick(c, o, t + 0.004, 0.022, 0.3, 1400, 1.5);
    },
    vidrio(c, o, t, k) {
      body(c, o, t, 1900 * k, 1890 * k, 0.24, 0.3);
      body(c, o, t, 2870 * k, 2860 * k, 0.17, 0.2);
      tick(c, o, t, 0.01, 0.2, 5200, 0.8, 'highpass');
    },
    pluck(c, o, t, k) {
      const f = 330 * k;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 2;
      lp.frequency.setValueAtTime(3000, t);
      lp.frequency.exponentialRampToValueAtTime(320, t + 0.2);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.4, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      lp.connect(g); g.connect(o);
      for (const m of [1, 1.005]) {
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f * m;
        osc.connect(lp);
        osc.start(t); osc.stop(t + 0.27);
      }
    },
    redoblante(c, o, t, k) {
      body(c, o, t, 195 * k, 150 * k, 0.1, 0.5);
      tick(c, o, t, 0.13, 0.42, 2300, 0.5);
    }
  };

  /* Parejos de volumen: los clics (madera, chasquido) tienen poco pico y sonarían
     muy bajito al lado de un pelotazo. Medidos contra un pico común de ~0,5. */
  const KICK_TRIM = {
    lofi: 0.9, vinilo: 1, cassette: 0.9, madera: 2.5, bongo: 1.1, burbuja: 1.2, gota: 1.4, tecla: 1.6,
    cuero: 1.1, pelotazo: 0.8, marimba: 1.25, chasquido: 3.6, vidrio: 1.6, pluck: 0.95, redoblante: 1.2
  };

  let kickBus = null;
  /** Deja listo el audio (lo que más tarda es crearlo): llamarlo al abrir la sala. */
  function warm(AC) {
    try {
      const Ctor = AC || (typeof AudioContext !== 'undefined' ? AudioContext : null);
      if (!Ctor) return false;
      if (!shared) shared = new Ctor();
      if (shared.state === 'suspended' && shared.resume) shared.resume();
      noiseBuffer(shared);
      return true;
    } catch (e) { return false; }
  }

  function playKick(style, volume, AC) {
    const recipe = KICKS[style];
    if (!recipe) return false;
    if (!warm(AC)) return false;
    try {
      const ctx = shared;
      if (!kickBus || kickBus.context !== ctx) {
        kickBus = ctx.createGain();
        kickBus.connect(ctx.destination);
      }
      // Volumen del jugador, con 0,6 de margen para que varias capas juntas no saturen.
      const vol = Math.min(1, Math.max(0, volume)) * 0.6;
      const hit = ctx.createGain();
      hit.gain.value = vol * (KICK_TRIM[style] || 1) * (0.92 + Math.random() * 0.16);
      hit.connect(kickBus);
      recipe(ctx, hit, ctx.currentTime + 0.002, 0.95 + Math.random() * 0.1);
      return true;
    } catch (e) { return false; }
  }

  return { STYLES, KICK_STYLES, KICKS, play, playKick, warm, has: (s) => !!RECIPES[s], hasKick: (s) => !!KICKS[s] };
});
