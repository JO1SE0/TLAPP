/*
 * Bienvenida del club: intro corta y moderna. Una línea de luz se abre en dos
 * paneles, el escudo cae con onda de choque, "TODA LA LECCE" sube letra por letra
 * y te da la bienvenida. Sonido «Minimal» sintetizado (sin archivos: Web Audio).
 *
 * Se muestra una vez por arranque, después de la pantalla de carga. Se salta con
 * un clic o cualquier tecla. Sólo anima `opacity` y `transform`, y desaparece del
 * DOM al terminar: no deja nada corriendo.
 */
(function () {
  'use strict';

  /** Cuándo (en segundos) pasa cada cosa. Lo comparten la imagen (CSS) y el sonido. */
  const T = { impact: 1.15, title: 1.3, hello: 2.2, phrase: 2.65, end: 5.8, fade: 0.8 };


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
  /*
   * Sonido «Minimal»: un soplido que sube hasta el golpe, un golpe grave y sordo,
   * una campana limpia y un acorde suave que se apaga. Nada de sierras ni arpegios.
   */
  function buildSound(ac, dest, t0) {
    const master = ac.createGain();
    master.gain.value = 0.55;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    master.connect(comp);
    comp.connect(dest);
    const delay = makeDelay(ac, master);
    const out = (node, echo) => { node.connect(master); if (echo) node.connect(delay); };
    const env = (g, at, attack, peak, decay) => {
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(peak, at + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    };
    const sine = (f, at, attack, peak, decay, echo, type) => {
      const o = ac.createOscillator();
      o.type = type || 'sine';
      o.frequency.value = f;
      const g = ac.createGain();
      env(g, at, attack, peak, decay);
      o.connect(g); out(g, echo);
      o.start(at); o.stop(at + attack + decay + 0.05);
    };
    const I = t0 + T.impact;

    // 1. Soplido: ruido por un filtro que se abre hasta el golpe.
    const ws = ac.createBufferSource();
    ws.buffer = noiseBuffer(ac, T.impact + 0.1);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, I - 0.85);
    bp.frequency.exponentialRampToValueAtTime(5000, I - 0.02);
    const wg = ac.createGain();
    wg.gain.setValueAtTime(0.0001, I - 0.85);
    wg.gain.exponentialRampToValueAtTime(0.34, I - 0.05);
    wg.gain.exponentialRampToValueAtTime(0.0001, I + 0.04);
    ws.connect(bp); bp.connect(wg); out(wg, false);
    ws.start(Math.max(t0, I - 0.85));

    // 2. Golpe sordo: grave que cae de tono, sin click.
    const sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(82, I);
    sub.frequency.exponentialRampToValueAtTime(40, I + 0.4);
    const sg = ac.createGain();
    env(sg, I, 0.006, 0.8, 0.9);
    sub.connect(sg); out(sg, false);
    sub.start(I); sub.stop(I + 1);

    // 3. Campana limpia (Do agudo con su quinta) y acorde suave debajo.
    sine(1046.5, I + 0.02, 0.005, 0.16, 2.4, true);
    sine(1568, I + 0.02, 0.005, 0.06, 1.6, true);
    for (const f of [261.63, 392, 659.25]) sine(f, I + 0.05, 0.45, 0.055, 2.6, true);

    // 4. Al aparecer el saludo, una segunda campanita más suave.
    sine(1318.51, t0 + T.hello, 0.005, 0.07, 1.4, true);
    sine(1975.53, t0 + T.hello + 0.12, 0.005, 0.035, 1.1, true);
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

    center.append(crestWrap, title, track, hello);

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
