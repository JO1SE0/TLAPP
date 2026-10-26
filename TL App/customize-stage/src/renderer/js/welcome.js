/*
 * Bienvenida del club, al ritmo de la canción de arranque (assets/intro/welcome-beat.mp3).
 *
 * Línea de tiempo (segundos desde que empieza a sonar; los golpes del beat se
 * midieron sobre el audio: 4.0, 5.95, 7.95, 10.0, 12.0):
 *
 *   0.0 – 4.0  Subida: la cancha de HaxBall se dibuja en perspectiva, la pelota
 *              rueda hasta el medio, la luz crece y cuenta 3 · 2 · 1.
 *   4.0        Entra el beat: destello, onda de choque, el escudo cae y
 *              «TODA LA LECCE» golpea letra por letra. Se abren las franjas.
 *   5.95       El escudo y el título suben; entra el plantel: cada socio es una
 *              ficha de HaxBall que aparece a contratiempo (cada 0,25 s).
 *   7.95       La pelota se pasa entre las fichas. Todo late con cada golpe.
 *   10.0       «Bienvenido, <nick>» y la cinta HAXBALL · TL APP · TODA LA LECCE.
 *   12.0       Último golpe, destello final, y a las 13 se va al menú.
 *
 * Sólo anima `transform` y `opacity` (CSS y Web Animations, que corre en el
 * compositor). Se salta con un clic o cualquier tecla, y al terminar se borra
 * entero: no deja nada corriendo.
 */
(function () {
  'use strict';

  /** Momentos clave, en segundos. Los comparte el CSS (por variables) y el JS. */
  const T = { drop: 4.0, squad: 5.95, pass: 7.95, hello: 10.0, last: 12.0, end: 13.0, fade: 0.9 };
  const BEATS = [4.0, 5.95, 7.95, 10.0, 12.0];
  const AUDIO = '../../assets/intro/welcome-beat.mp3';
  const FALLBACK_SQUAD = ['Miclovin', 'Abiss', 'Paco Amoroso', 'Atuvi', 'Cuti', 'Paxe', 'Kag', 'Nardo', 'Mudryk', 'Ñandu', 'MG', 'Bruno', 'CGL'];

  let current = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  /** El plantel sale del menú lateral, así queda siempre igual a lo que se ve ahí. */
  function squad() {
    const li = [...document.querySelectorAll('.roster__list li')].map((n) => n.textContent.trim()).filter(Boolean);
    return (li.length ? li : FALLBACK_SQUAD).slice(0, 14);
  }

  function initials(name) {
    const w = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
  }

  /** Corre la bienvenida. `opts`: { sound, nick, english, volume }. */
  function play(opts) {
    if (current) return;
    const o = opts || {};
    const eng = !!o.english;

    const root = el('div', 'wv');
    root.id = 'welcome';
    root.setAttribute('role', 'presentation');

    /* ── Fondo y cámara ── */
    const stage = el('div', 'wv__stage');
    const pitch = el('div', 'wv__pitch');
    pitch.innerHTML = '<svg viewBox="0 0 840 480" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" pathLength="1">' +
      '<rect x="40" y="40" width="760" height="400" rx="8" pathLength="1"/>' +
      '<path d="M420 40V440" pathLength="1"/><circle cx="420" cy="240" r="74" pathLength="1"/>' +
      '<path d="M40 175h-26v130h26M800 175h26v130h-26" pathLength="1"/></g>' +
      '<g fill="currentColor"><circle cx="40" cy="175" r="7"/><circle cx="40" cy="305" r="7"/><circle cx="800" cy="175" r="7"/><circle cx="800" cy="305" r="7"/></g></svg>';
    const glow = el('i', 'wv__glow');
    const count = el('div', 'wv__count');
    ['3', '2', '1'].forEach((n, i) => { const s = el('span', '', n); s.style.setProperty('--i', i); count.append(s); });
    const ball = el('i', 'wv__ball');
    const rings = el('div', 'wv__rings');
    for (let i = 0; i < 3; i++) { const r = el('i'); r.style.setProperty('--i', i); rings.append(r); }

    /* ── Escudo y título ── */
    const brand = el('div', 'wv__brand');
    const crestWrap = el('div', 'wv__crestwrap');
    const crest = el('img', 'wv__crest');
    crest.src = '../../assets/toda-la-lecce.png';
    crest.alt = '';
    crestWrap.append(el('i', 'wv__halo'), crest);
    const title = el('div', 'wv__title');
    let ci = 0;
    ['TODA', 'LA', 'LECCE'].forEach((w) => {
      const word = el('span', 'wv__word');
      for (const c of w) { const ch = el('span', 'wv__ch', c); ch.style.setProperty('--i', ci++); word.append(ch); }
      title.append(word);
    });
    brand.append(crestWrap, title);

    /* ── El plantel: fichas de HaxBall ── */
    const names = squad();
    const team = el('div', 'wv__squad');
    const half = Math.ceil(names.length / 2);
    const spots = [];
    names.forEach((name, i) => {
      const red = i < half;
      const row = red ? names.slice(0, half) : names.slice(half);
      const k = red ? i : i - half;
      const n = row.length;
      // Dos filas en arco suave: rojos arriba, azules abajo, como dos equipos en fila.
      const x = (k - (n - 1) / 2) * Math.min(12.5, 84 / Math.max(1, n));
      const y = (red ? -7 : 8) + Math.abs(k - (n - 1) / 2) * (red ? 0.9 : -0.9);
      spots.push({ x, y });
      const p = el('div', 'wv__p' + (red ? '' : ' is-blue'));
      p.style.setProperty('--x', `${x.toFixed(2)}vw`);
      p.style.setProperty('--y', `${y.toFixed(2)}vh`);
      p.style.setProperty('--d', `${(T.squad + 0.12 + i * 0.25).toFixed(3)}s`);
      const disc = el('span', 'wv__disc', initials(name));
      disc.append(el('i', 'wv__pop'));
      p.append(disc, el('span', 'wv__name', name));
      team.append(p);
    });
    const passBall = el('i', 'wv__pass');
    team.append(passBall);

    /* ── Bienvenida y cinta ── */
    const hello = el('div', 'wv__hello');
    hello.append(el('small', '', eng ? 'WELCOME' : 'BIENVENIDO'), el('b', '', o.nick ? o.nick : 'TL APP'));
    const strip = el('div', 'wv__strip');
    const line = el('div', 'wv__stripline');
    const words = 'HAXBALL ✦ TL APP ✦ TODA LA LECCE ✦ ';
    line.textContent = words.repeat(8);
    strip.append(line);

    const pitchWrap = el('div', 'wv__pitchwrap'); pitchWrap.append(pitch);
    const glowWrap = el('div', 'wv__glowwrap'); glowWrap.append(glow);
    const ballWrap = el('div', 'wv__ballwrap'); ballWrap.append(ball);
    stage.append(pitchWrap, glowWrap, count, ballWrap, rings, brand, team, hello);
    root.append(
      el('div', 'wv__bg'), stage, strip,
      el('i', 'wv__bar wv__bar--t'), el('i', 'wv__bar wv__bar--b'),
      el('i', 'wv__flash'), el('i', 'wv__flash wv__flash--last'),
      el('div', 'wv__tag', 'TL APP · HAXBALL CLIENT'),
      el('div', 'wv__skip', eng ? 'Click to skip' : 'Clic para saltar')
    );
    document.body.append(root);
    document.documentElement.classList.add('is-welcoming');
    // Seguro: pase lo que pase, el menú nunca queda oculto más de 16 s.
    setTimeout(() => document.documentElement.classList.remove('is-welcoming'), 16000);

    /* ── Sonido ── */
    let audio = null;
    if (o.sound) {
      try {
        audio = new Audio(AUDIO);
        audio.preload = 'auto';
        audio.volume = Math.min(1, Math.max(0.15, Number(o.volume) || 0.7));
      } catch (e) { audio = null; }
    }

    let done = false;
    let started = false;
    const timers = [];
    const anims = [];

    /** Lo que depende de dónde quedó cada ficha: el pase de la pelota y los latidos. */
    const startDynamic = () => {
      // La pelota se pasa entre seis fichas al azar, un pase por medio tiempo.
      const order = spots.map((s, i) => i).sort(() => Math.random() - 0.5).slice(0, 6);
      const frames = [{ transform: 'translate(-50%, -50%) translate(0vw, 30vh) scale(.6)', opacity: 0, offset: 0 }];
      order.forEach((idx, j) => {
        const s = spots[idx];
        frames.push({ transform: `translate(-50%, -50%) translate(${s.x}vw, ${s.y - 3.2}vh) scale(1)`, opacity: 1, offset: (j + 1) / (order.length + 1) });
      });
      frames.push({ transform: 'translate(-50%, -50%) translate(0vw, -6vh) scale(1.4)', opacity: 0, offset: 1 });
      anims.push(passBall.animate(frames, { delay: T.pass * 1000, duration: (T.hello - T.pass) * 1000, easing: 'ease-in-out', fill: 'both' }));
      // Cada golpe del beat: el escudo late (el último, más fuerte).
      for (const b of BEATS.slice(2)) {
        const big = b === T.last;
        anims.push(crestWrap.animate(
          [{ transform: 'scale(1)' }, { transform: `scale(${big ? 1.22 : 1.1})`, offset: 0.2 }, { transform: 'scale(1)' }],
          { delay: b * 1000, duration: big ? 700 : 500, easing: 'cubic-bezier(.2,.8,.2,1)' }
        ));
      }
      // Y el plantel también.
      for (const b of BEATS.slice(2)) {
        anims.push(team.animate(
          [{ transform: 'translate(-50%, -50%) scale(1)' }, { transform: 'translate(-50%, -50%) scale(1.07)', offset: 0.18 }, { transform: 'translate(-50%, -50%) scale(1)' }],
          { delay: b * 1000, duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' }
        ));
      }
    };

    const start = () => {
      if (started || done) return;
      started = true;
      root.classList.add('is-on');
      startDynamic();
      timers.push(setTimeout(() => finish(false), T.end * 1000));
    };

    const finish = (quick) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', onSkip, true);
      root.removeEventListener('pointerdown', onSkip, true);
      if (audio) {
        // Baja el volumen en vez de cortar en seco.
        const from = audio.volume;
        const t0 = performance.now();
        const ms = quick ? 300 : 900;
        const step = () => {
          const k = Math.min(1, (performance.now() - t0) / ms);
          try { audio.volume = from * (1 - k); } catch (e) { /* nada */ }
          if (k < 1) requestAnimationFrame(step); else { try { audio.pause(); audio.src = ''; } catch (e) { /* nada */ } }
        };
        requestAnimationFrame(step);
      }
      root.classList.add('is-out');
      document.documentElement.classList.remove('is-welcoming');
      document.documentElement.classList.add('tl-enter');
      setTimeout(() => document.documentElement.classList.remove('tl-enter'), 1100);
      setTimeout(() => {
        anims.forEach((a) => { try { a.cancel(); } catch (e) { /* nada */ } });
        root.remove();
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
    current = { finish };

    // La imagen arranca cuando el audio de verdad empieza a sonar, así el golpe
    // del beat y el escudo caen juntos. Si el audio no puede (sin sonido, o
    // bloqueado), arranca igual a los 300 ms.
    if (audio) {
      audio.addEventListener('playing', start, { once: true });
      audio.addEventListener('error', start, { once: true });
      const p = audio.play();
      if (p && p.catch) p.catch(start);
      timers.push(setTimeout(start, 1500));
    } else {
      requestAnimationFrame(() => setTimeout(start, 300));
    }
  }

  window.TLWelcome = { play, T };
})();
