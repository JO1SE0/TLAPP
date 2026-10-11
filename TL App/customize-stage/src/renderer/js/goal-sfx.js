/* Sonidos de gol sintetizados (sin archivos). Los usan la partida y la vista previa. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TLGoalSfx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STYLES = [
    ['default', 'El del juego', 'Game default'],
    ['bocina', 'Bocina', 'Air horn'],
    ['campanas', 'Campanas', 'Bells'],
    ['aplausos', 'Aplausos', 'Applause'],
    ['silbato', 'Silbato', 'Whistle'],
    ['tribuna', 'Tribuna', 'Stands'],
    ['retro', 'Retro', 'Retro']
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

  const RECIPES = {
    bocina(c, o, t) {
      [220, 277, 330].forEach((f) => tone(c, o, t, f, 1.1, 'sawtooth', 0.22));
      tone(c, o, t + 0.05, 440, 1.0, 'square', 0.08);
    },
    campanas(c, o, t) {
      [880, 1175, 1319, 1760].forEach((f, i) => {
        tone(c, o, t + i * 0.12, f, 1.4, 'sine', 0.22);
        tone(c, o, t + i * 0.12, f * 2.76, 0.6, 'sine', 0.05);
      });
    },
    aplausos(c, o, t) {
      for (let i = 0; i < 26; i++) noise(c, o, t + Math.random() * 1.6, 0.05 + Math.random() * 0.05, 0.35, 1800 + Math.random() * 2500, 0.8);
      noise(c, o, t, 1.8, 0.12, 2500, 0.4);
    },
    silbato(c, o, t) {
      tone(c, o, t, 2900, 0.35, 'sine', 0.22, 3100);
      tone(c, o, t + 0.4, 2900, 0.7, 'sine', 0.22, 3200);
      noise(c, o, t, 1.1, 0.04, 3500, 3);
    },
    tribuna(c, o, t) {
      noise(c, o, t, 2.2, 0.35, 700, 0.5);
      noise(c, o, t + 0.2, 1.8, 0.2, 1400, 0.6);
      tone(c, o, t, 180, 1.8, 'sawtooth', 0.05, 260);
    },
    retro(c, o, t) {
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(c, o, t + i * 0.09, f, 0.12, 'square', 0.12));
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

  return { STYLES, play, has: (s) => !!RECIPES[s] };
});
