/*
 * Bienvenida del club: una intro corta con el escudo, "TODA LA LECCE" y el
 * plantel, con un sonido sintetizado (sin archivos: Web Audio).
 *
 * Se muestra una vez por arranque, después de la pantalla de carga. Se salta con
 * un clic o cualquier tecla. Sólo anima `opacity` y `transform`, y desaparece del
 * DOM al terminar: no deja nada corriendo.
 */
(function () {
  'use strict';

  /** Cuándo (en segundos) pasa cada cosa. Lo comparten la imagen y el sonido. */
  const T = { impact: 1.2, names: 1.95, nameStep: 0.085, hello: 3.35, end: 4.9, fade: 0.7 };

  const NOTES = [587.33, 659.25, 739.99, 880, 987.77, 1174.66, 1318.51]; // Re mayor pentatónica

  /** Cola de reverberación: ruido que decae. Barata y suficiente para dar sala. */
  function impulse(ac, seconds, power) {
    const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, power);
    }
    return buf;
  }

  function noiseBuffer(ac, seconds) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * Programa todo el sonido en `ac` (real o offline), empezando en `t0`.
   * Devuelve el nodo maestro, para poder bajarlo al saltear.
   */
  function buildSound(ac, dest, t0, nameCount) {
    const master = ac.createGain();
    master.gain.value = 0.62;
    master.connect(dest);

    const verb = ac.createConvolver();
    verb.buffer = impulse(ac, 2.2, 2.4);
    const verbGain = ac.createGain();
    verbGain.gain.value = 0.38;
    verb.connect(verbGain);
    verbGain.connect(master);

    const out = (node, wet) => {
      node.connect(master);
      if (wet) node.connect(verb);
    };

    const env = (g, at, attack, peak, decay) => {
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(peak, at + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    };

    // 1. El barrido que sube hasta el golpe.
    const whoosh = ac.createBufferSource();
    whoosh.buffer = noiseBuffer(ac, T.impact + 0.3);
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2.2;
    band.frequency.setValueAtTime(180, t0);
    band.frequency.exponentialRampToValueAtTime(3600, t0 + T.impact);
    const wg = ac.createGain();
    wg.gain.setValueAtTime(0.0001, t0);
    wg.gain.exponentialRampToValueAtTime(0.5, t0 + T.impact - 0.04);
    wg.gain.exponentialRampToValueAtTime(0.0001, t0 + T.impact + 0.25);
    whoosh.connect(band);
    band.connect(wg);
    out(wg, true);
    whoosh.start(t0);

    // 2. El golpe: bombo grave que cae de tono + un chasquido de aire.
    const boom = ac.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(150, t0 + T.impact);
    boom.frequency.exponentialRampToValueAtTime(40, t0 + T.impact + 0.7);
    const bg = ac.createGain();
    env(bg, t0 + T.impact, 0.006, 0.95, 1.5);
    boom.connect(bg);
    out(bg, false);
    boom.start(t0 + T.impact);
    boom.stop(t0 + T.impact + 2.2);

    const air = ac.createBufferSource();
    air.buffer = noiseBuffer(ac, 0.8);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const ag = ac.createGain();
    env(ag, t0 + T.impact, 0.004, 0.22, 0.55);
    air.connect(hp);
    hp.connect(ag);
    out(ag, true);
    air.start(t0 + T.impact);

    // 3. El acorde de campana: Re mayor con novena, parciales de campana.
    const chord = [146.83, 293.66, 440, 587.33, 739.99, 880, 1108.73];
    chord.forEach((f, i) => {
      for (const [mult, level] of [[1, 1], [2.01, 0.22], [2.76, 0.12]]) {
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * mult;
        const g = ac.createGain();
        const peak = (i === 0 ? 0.28 : 0.125) * level;
        env(g, t0 + T.impact + i * 0.018, 0.008, peak, 3.0 - i * 0.18);
        o.connect(g);
        out(g, true);
        o.start(t0 + T.impact + i * 0.018);
        o.stop(t0 + T.impact + 3.6);
      }
    });

    // 4. Un destello por cada nombre.
    for (let i = 0; i < nameCount; i++) {
      const at = t0 + T.names + i * T.nameStep;
      const f = NOTES[(i * 3) % NOTES.length] * (i % 2 ? 1 : 2);
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ac.createGain();
      env(g, at, 0.003, 0.1, 0.34);
      o.connect(g);
      out(g, true);
      o.start(at);
      o.stop(at + 0.5);
    }

    // 5. El cierre: el acorde vuelve a subir y se apaga despacio.
    for (const f of [293.66, 369.99, 440, 587.33]) {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0 + T.hello - 0.15);
      g.gain.linearRampToValueAtTime(0.1, t0 + T.hello + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + T.end + 0.4);
      o.connect(g);
      out(g, true);
      o.start(t0 + T.hello - 0.15);
      o.stop(t0 + T.end + 0.5);
    }
    return master;
  }

  let current = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  /** Corre la bienvenida. `opts`: { sound, nick, english }. */
  function play(opts) {
    if (current) return;
    const o = opts || {};
    const names = Array.from(document.querySelectorAll('.roster__list li')).map((li) => li.textContent.trim()).filter(Boolean);

    const root = el('div', 'wl');
    root.id = 'welcome';
    root.setAttribute('role', 'presentation');
    const bg = el('div', 'wl__bg');
    const center = el('div', 'wl__center');
    const crestWrap = el('div', 'wl__crestwrap');
    const crest = el('img', 'wl__crest');
    crest.src = '../../assets/toda-la-lecce.png';
    crest.alt = '';
    crestWrap.append(el('i', 'wl__ring'), el('i', 'wl__ring wl__ring--b'), crest, el('i', 'wl__shine'));
    const title = el('div', 'wl__title', 'TODA LA LECCE');
    const line = el('div', 'wl__line');
    const list = el('ul', 'wl__names');
    names.forEach((n, i) => {
      const li = el('li', '', n);
      li.style.animationDelay = `${(T.names + i * T.nameStep).toFixed(3)}s`;
      list.append(li);
    });
    const hello = el('div', 'wl__hello', o.english ? `Welcome${o.nick ? `, ${o.nick}` : ''}` : `Bienvenido${o.nick ? `, ${o.nick}` : ''}`);
    hello.style.animationDelay = `${T.hello}s`;
    center.append(crestWrap, title, line, list, hello);
    const skip = el('div', 'wl__skip', o.english ? 'Click to skip' : 'Clic para saltar');
    root.append(bg, center, skip);
    document.body.append(root);

    // Sonido: un AudioContext propio que se cierra al terminar.
    let ac = null;
    let master = null;
    if (o.sound) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        ac = new Ctx();
        if (ac.state === 'suspended') ac.resume().catch(() => {});
        master = buildSound(ac, ac.destination, ac.currentTime + 0.05, names.length);
      } catch (e) { ac = null; }
    }

    let done = false;
    const timers = [];
    const finish = (quick) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', onSkip, true);
      root.removeEventListener('pointerdown', onSkip, true);
      if (master && ac) {
        try {
          const t = ac.currentTime;
          master.gain.cancelScheduledValues(t);
          master.gain.setValueAtTime(master.gain.value, t);
          master.gain.linearRampToValueAtTime(0.0001, t + (quick ? 0.25 : 0.6));
        } catch (e) { /* nada que hacer */ }
      }
      root.classList.add('is-out');
      setTimeout(() => {
        root.remove();
        if (ac) ac.close().catch(() => {});
        current = null;
      }, quick ? 320 : T.fade * 1000);
    };
    const onSkip = (e) => {
      if (e.type === 'keydown') { e.preventDefault(); e.stopPropagation(); }
      finish(true);
    };
    window.addEventListener('keydown', onSkip, true);
    root.addEventListener('pointerdown', onSkip, true);
    timers.push(setTimeout(() => finish(false), T.end * 1000));
    current = { finish };
    // Un cuadro después, para que arranquen las animaciones de CSS.
    requestAnimationFrame(() => root.classList.add('is-on'));
  }

  window.TLWelcome = { play, buildSound, T };
})();
