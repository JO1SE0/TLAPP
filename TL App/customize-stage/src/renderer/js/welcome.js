/*
 * Bienvenida del club: intro corta y moderna. Una línea de luz se abre en dos
 * paneles, el escudo cae con onda de choque, "TODA LA LECCE" sube letra por letra
 * y aparece una frase. Sonido sintetizado (sin archivos: Web Audio).
 *
 * Se muestra una vez por arranque, después de la pantalla de carga. Se salta con
 * un clic o cualquier tecla. Sólo anima `opacity` y `transform`, y desaparece del
 * DOM al terminar: no deja nada corriendo.
 */
(function () {
  'use strict';

  /** Cuándo (en segundos) pasa cada cosa. Lo comparten la imagen (CSS) y el sonido. */
  const T = { impact: 1.15, title: 1.3, hello: 2.2, phrase: 2.65, end: 5.8, fade: 0.8 };

  const PHRASES_ES = [
    'Acá se juega con el corazón', 'Del barrio al mundo', 'La pasión no se negocia',
    'Siempre juntos, siempre Lecce', 'Hoy se sale a ganar', 'Pura garra, puro club',
    'El que juega acá, juega por todos', 'Que ruede la pelota',
  ];
  const PHRASES_EN = [
    'We play with heart', 'From the block to the world', 'Passion is not negotiable',
    'Always together, always Lecce', 'Today we play to win', 'Pure grit, pure club',
    'Play for everyone', 'Let the ball roll',
  ];

  function noiseBuffer(ac, seconds) {
    const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Eco corto y filtrado, estilo delay de producción moderna. */
  function makeDelay(ac, dest) {
    const d = ac.createDelay(1);
    d.delayTime.value = 0.18;
    const fb = ac.createGain();
    fb.gain.value = 0.34;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const wet = ac.createGain();
    wet.gain.value = 0.42;
    d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.connect(dest);
    return d;
  }

  /**
   * Programa todo el sonido en `ac` (real o offline), empezando en `t0`.
   * Devuelve el nodo maestro, para poder bajarlo al saltear.
   */
  function buildSound(ac, dest, t0) {
    const master = ac.createGain();
    master.gain.value = 0.6;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(dest);
    const delay = makeDelay(ac, master);

    const out = (node, echo) => {
      node.connect(master);
      if (echo) node.connect(delay);
    };
    const env = (g, at, attack, peak, decay) => {
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(peak, at + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    };
    const I = t0 + T.impact;

    // 1. Riser: ruido que sube de agudos + sierra que sube de tono hasta el golpe.
    const rs = ac.createBufferSource();
    rs.buffer = noiseBuffer(ac, T.impact + 0.2);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.Q.value = 5;
    hp.frequency.setValueAtTime(300, t0);
    hp.frequency.exponentialRampToValueAtTime(7500, I);
    const rg = ac.createGain();
    rg.gain.setValueAtTime(0.0001, t0);
    rg.gain.exponentialRampToValueAtTime(0.38, I - 0.03);
    rg.gain.linearRampToValueAtTime(0.0001, I + 0.02);
    rs.connect(hp); hp.connect(rg); out(rg, false);
    rs.start(t0);

    const saw = ac.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(110, t0);
    saw.frequency.exponentialRampToValueAtTime(880, I);
    const slp = ac.createBiquadFilter();
    slp.type = 'lowpass';
    slp.frequency.setValueAtTime(300, t0);
    slp.frequency.exponentialRampToValueAtTime(5000, I);
    const sg = ac.createGain();
    sg.gain.setValueAtTime(0.0001, t0);
    sg.gain.exponentialRampToValueAtTime(0.13, I - 0.03);
    sg.gain.linearRampToValueAtTime(0.0001, I + 0.02);
    saw.connect(slp); slp.connect(sg); out(sg, false);
    saw.start(t0); saw.stop(I + 0.05);

    // 2. Golpe 808: sub que cae de tono + click corto.
    const sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(130, I);
    sub.frequency.exponentialRampToValueAtTime(42, I + 0.35);
    const subg = ac.createGain();
    env(subg, I, 0.004, 0.95, 1.4);
    sub.connect(subg); out(subg, false);
    sub.start(I); sub.stop(I + 1.8);

    const click = ac.createBufferSource();
    click.buffer = noiseBuffer(ac, 0.2);
    const cbp = ac.createBiquadFilter();
    cbp.type = 'bandpass';
    cbp.frequency.value = 2400;
    const cg = ac.createGain();
    env(cg, I, 0.002, 0.3, 0.09);
    click.connect(cbp); cbp.connect(cg); out(cg, false);
    click.start(I);

    // 3. Acorde moderno: sierras desafinadas con filtro que se cierra (Re mayor, novena).
    [146.83, 220, 293.66, 369.99, 440, 659.25].forEach((f, i) => {
      for (const det of [-9, 9]) {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(4200, I);
        lp.frequency.exponentialRampToValueAtTime(500, I + 1.6);
        const g = ac.createGain();
        env(g, I, 0.01, i === 0 ? 0.11 : 0.06, 1.7);
        o.connect(lp); lp.connect(g); out(g, true);
        o.start(I); o.stop(I + 2);
      }
    });

    // 4. Arpegio pluck al subir el título, con hi-hats.
    const arp = [587.33, 739.99, 880, 1108.73, 880, 1318.51, 1108.73, 1480];
    arp.forEach((f, i) => {
      const at = t0 + T.title + i * 0.115;
      const o = ac.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(5200, at);
      lp.frequency.exponentialRampToValueAtTime(700, at + 0.22);
      const g = ac.createGain();
      env(g, at, 0.003, 0.05, 0.24);
      o.connect(lp); lp.connect(g); out(g, true);
      o.start(at); o.stop(at + 0.4);
    });
    for (let i = 0; i < 8; i++) {
      const at = t0 + T.title + i * 0.115 + (i % 2 ? 0.0575 : 0);
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(ac, 0.1);
      const f = ac.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7800;
      const g = ac.createGain();
      env(g, at, 0.002, i % 2 ? 0.05 : 0.08, 0.04);
      n.connect(f); f.connect(g); out(g, false);
      n.start(at);
    }

    // 5. Campanita de la frase + cierre: pad que sube y se apaga.
    [1318.51, 1760].forEach((f, i) => {
      const at = t0 + T.phrase + i * 0.14;
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ac.createGain();
      env(g, at, 0.004, 0.09, 0.9);
      o.connect(g); out(g, true);
      o.start(at); o.stop(at + 1.1);
    });
    for (const f of [293.66, 369.99, 440, 587.33]) {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0 + T.hello);
      g.gain.linearRampToValueAtTime(0.07, t0 + T.phrase + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + T.end + 0.4);
      o.connect(g); out(g, true);
      o.start(t0 + T.hello); o.stop(t0 + T.end + 0.5);
    }
    // 6. Destellos agudos mientras caen las chispas (sube y se apaga).
    [1975.53, 2349.32, 2637.02, 3135.96, 2637.02, 3951.07].forEach((f, i) => {
      const at = t0 + T.hello + 0.15 + i * 0.16;
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ac.createGain();
      env(g, at, 0.003, 0.035, 0.7);
      o.connect(g); out(g, true);
      o.start(at); o.stop(at + 0.9);
    });
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
    const eng = !!o.english;

    const root = el('div', 'wl');
    root.id = 'welcome';
    root.setAttribute('role', 'presentation');
    const center = el('div', 'wl__center');
    const crestWrap = el('div', 'wl__crestwrap');
    const crest = el('img', 'wl__crest');
    crest.src = '../../assets/toda-la-lecce.png';
    crest.alt = '';
    crestWrap.append(el('i', 'wl__ring'), el('i', 'wl__ring wl__ring--b'), crest);

    const title = el('div', 'wl__title');
    let ci = 0;
    ['TODA', 'LA', 'LECCE'].forEach((w) => {
      const word = el('span', 'wl__word');
      for (const c of w) {
        const ch = el('span', 'wl__ch', c);
        ch.style.setProperty('--d', `${(T.title + ci * 0.045).toFixed(3)}s`);
        word.append(ch);
        ci++;
      }
      title.append(word);
    });

    const hello = el('div', 'wl__hello', eng ? `Welcome${o.nick ? `, ${o.nick}` : ''}` : `Bienvenido${o.nick ? `, ${o.nick}` : ''}`);
    const list = eng ? PHRASES_EN : PHRASES_ES;
    const phrase = el('div', 'wl__phrase');
    list[Math.floor(Math.random() * list.length)].split(' ').forEach((w, i) => {
      const sp = el('span', '', w);
      sp.style.animationDelay = `${(T.phrase + i * 0.09).toFixed(3)}s`;
      phrase.append(sp);
    });
    // Chispas que salen del escudo al impacto (posiciones al azar, una sola vez).
    for (let i = 0; i < 18; i++) {
      const sp = el('i', 'wl__spark');
      const ang = (i / 18) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 110 + Math.random() * 210;
      sp.style.setProperty('--x', `${(Math.cos(ang) * dist).toFixed(0)}px`);
      sp.style.setProperty('--y', `${(Math.sin(ang) * dist).toFixed(0)}px`);
      sp.style.setProperty('--s', (0.5 + Math.random() * 1.1).toFixed(2));
      sp.style.animationDelay = `${(T.impact + Math.random() * 0.08).toFixed(3)}s`;
      crestWrap.append(sp);
    }
    crestWrap.prepend(el('i', 'wl__halo'));

    // Una pelota que recorre una línea bajo el título.
    const track = el('div', 'wl__track');
    track.append(el('i', 'wl__trackline'), el('i', 'wl__ball'));

    center.append(crestWrap, title, track, hello, phrase);

    // La cancha dibujándose en perspectiva, dos haces de luz y polvo dorado.
    const pitch = el('div', 'wl__pitch');
    pitch.innerHTML = '<svg viewBox="0 0 800 460" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="20" y="20" width="760" height="420" rx="6"/>' +
      '<path d="M400 20V440"/><circle cx="400" cy="230" r="70"/>' +
      '<path d="M20 140h110v180H20M780 140H670v180h110"/>' +
      '<path d="M20 185h45v90H20M780 185h-45v90h45"/></g></svg>';
    const dust = el('div', 'wl__dustwrap');
    for (let i = 0; i < 14; i++) {
      const d = el('i', 'wl__dust');
      d.style.left = `${(Math.random() * 100).toFixed(1)}%`;
      d.style.setProperty('--r', `${(40 + Math.random() * 45).toFixed(0)}vh`);
      d.style.setProperty('--d', `${(2.2 + Math.random() * 1.8).toFixed(2)}s`);
      d.style.animationDelay = `${(T.hello + Math.random() * 1.6).toFixed(2)}s`;
      d.style.width = d.style.height = `${(2 + Math.random() * 3).toFixed(1)}px`;
      dust.append(d);
    }

    root.append(
      el('div', 'wl__bg'), pitch, el('i', 'wl__beam'), el('i', 'wl__beam wl__beam--r'), dust,
      el('i', 'wl__streak'), el('i', 'wl__streak wl__streak--b'), center,
      el('i', 'wl__panel wl__panel--t'), el('i', 'wl__panel wl__panel--b'), el('i', 'wl__line'),
      el('i', 'wl__flash'), el('i', 'wl__bar'),
      el('div', 'wl__skip', eng ? 'Click to skip' : 'Clic para saltar')
    );
    document.body.append(root);
    // Mientras corre, el menú de abajo no pinta nada (visibility) y las partículas se frenan.
    document.documentElement.classList.add('is-welcoming');
    // Seguro: pase lo que pase, el menú nunca queda oculto más de 9 s.
    setTimeout(() => document.documentElement.classList.remove('is-welcoming'), 9000);

    // Sonido: un AudioContext propio que se cierra al terminar.
    let ac = null;
    let master = null;
    if (o.sound) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        ac = new Ctx();
        if (ac.state === 'suspended') ac.resume().catch(() => {});
        master = buildSound(ac, ac.destination, ac.currentTime + 0.05);
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
      // El menú entra con un deslizamiento corto apenas empieza la salida.
      document.documentElement.classList.remove('is-welcoming');
      document.documentElement.classList.add('tl-enter');
      setTimeout(() => document.documentElement.classList.remove('tl-enter'), 1100);
      setTimeout(() => {
        root.remove();
        if (ac) ac.close().catch(() => {});
        current = null;
        window.dispatchEvent(new Event('tl:welcome-done'));
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
