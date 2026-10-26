/*
 * Bienvenida: la presentación del plantel, al ritmo de la canción de arranque
 * (assets/intro/welcome-beat.mp3, desde el 1:03 del tema).
 *
 * El tema va a 120 BPM: un golpe cada 0,5 s y un compás cada 2 s. Todo se
 * cuenta en golpes desde B0 (el primero, medido sobre el audio):
 *
 *   compases 0–1   Apertura: destello, el escudo cae, «TODA LA LECCE» con
 *                  glitch, «presenta» y «EL PLANTEL» golpe a golpe.
 *   compases 2–8   Un socio por cada 2 golpes: franja del color de su equipo,
 *                  su ficha de HaxBall gigante, el número, el nombre que sube
 *                  letra por letra y el nombre enorme corriendo de fondo.
 *   compases 8–10  Final: todo el plantel en formación, el escudo,
 *                  «Bienvenido, <nick>» y la cinta. Se va al menú.
 *
 * Todo con Web Animations sobre `transform`/`opacity` (lo compone la placa).
 * Cada animación deja su estado al terminar (`forwards`); las que se suman
 * después (salidas, latidos) se crean después y por eso mandan. Se salta con un
 * clic o cualquier tecla y al terminar se borra entero.
 */
(function () {
  'use strict';

  const B0 = 0.03;          // primer golpe (s), medido sobre el audio
  const BEAT = 0.5;         // 120 BPM
  const BAR = BEAT * 4;
  const AUDIO = '../../assets/intro/welcome-beat.mp3';
  const FALLBACK_SQUAD = ['Miclovin', 'Abiss', 'Paco Amoroso', 'Atuvi', 'Cuti', 'Paxe', 'Kag', 'Nardo', 'Mudryk', 'Ñandu', 'MG', 'Bruno', 'CGL'];
  const RED = '#e56e56';
  const BLUE = '#5689e5';

  /** Segundo del golpe `n` (puede ser fraccionario). */
  const b = (n) => B0 + n * BEAT;

  let current = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function squad() {
    const li = [...document.querySelectorAll('.roster__list li')].map((n) => n.textContent.trim()).filter(Boolean);
    return (li.length ? li : FALLBACK_SQUAD).slice(0, 16);
  }

  function initials(name) {
    const w = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
  }

  /** Letras sueltas, para hacerlas subir una por una. */
  function letters(cls, text) {
    const box = el('span', cls);
    for (const c of text) {
      const s = el('span', 'wp__l', c === ' ' ? ' ' : c);
      box.append(s);
    }
    return box;
  }

  function play(opts) {
    if (current) return;
    const o = opts || {};
    const eng = !!o.english;
    const names = squad();
    const N = names.length;

    /* Línea de tiempo en golpes. */
    const PLAYER0 = 8;                      // compás 2
    const PER = 2;                          // golpes por socio
    const FINAL = PLAYER0 + N * PER;        // golpe del final
    const END = FINAL + 8;                  // dos compases de final
    const endSec = b(END) + 0.15;

    const root = el('div', 'wp');
    root.id = 'welcome';
    root.setAttribute('role', 'presentation');

    /* ── Fondo vivo ── */
    const bg = el('div', 'wp__bg');
    const grid = el('div', 'wp__grid');
    const sweep = el('i', 'wp__sweep');
    const sweep2 = el('i', 'wp__sweep wp__sweep--b');
    const dust = el('div', 'wp__dust');
    for (let i = 0; i < 26; i++) {
      const d = el('i');
      d.style.left = `${(Math.random() * 100).toFixed(1)}%`;
      d.style.top = `${(Math.random() * 100).toFixed(1)}%`;
      d.style.setProperty('--s', (0.4 + Math.random() * 1.2).toFixed(2));
      d.style.animationDelay = `${(-Math.random() * 6).toFixed(2)}s`;
      dust.append(d);
    }
    bg.append(grid, sweep, sweep2, dust);

    const stage = el('div', 'wp__stage');

    /* ── Apertura ── */
    const open = el('div', 'wp__open');
    const rings = el('div', 'wp__rings');
    for (let i = 0; i < 3; i++) rings.append(el('i'));
    const crest = el('img', 'wp__crest');
    crest.src = '../../assets/toda-la-lecce.png';
    crest.alt = '';
    const titleBox = el('div', 'wp__title');
    const tMain = el('span', 'wp__tmain', 'TODA LA LECCE');
    const tR = el('span', 'wp__tghost wp__tghost--r', 'TODA LA LECCE');
    const tB = el('span', 'wp__tghost wp__tghost--b', 'TODA LA LECCE');
    titleBox.append(tR, tB, tMain);
    const presents = el('div', 'wp__presents', eng ? 'PRESENTS' : 'PRESENTA');
    const plantel = el('div', 'wp__plantel');
    const wEl = el('span', 'wp__pw', eng ? 'THE' : 'EL');
    const wPl = el('span', 'wp__pw wp__pw--big', eng ? 'SQUAD' : 'PLANTEL');
    plantel.append(wEl, wPl);
    open.append(rings, crest, titleBox, presents);

    /* ── Los socios ── */
    const scenes = names.map((name, i) => {
      const red = i % 2 === 0;
      const color = red ? RED : BLUE;
      const sc = el('div', 'wp__pl' + (i % 2 ? ' is-flip' : ''));
      sc.style.setProperty('--team', color);
      const band = el('i', 'wp__band');
      const band2 = el('i', 'wp__band wp__band--thin');
      const huge = el('div', 'wp__huge', `${name.toUpperCase()} · ${name.toUpperCase()} · ${name.toUpperCase()}`);
      const disc = el('div', 'wp__disc');
      disc.append(el('i', 'wp__stripes'), el('b', '', initials(name)));
      const info = el('div', 'wp__info');
      const num = el('div', 'wp__num', `#${String(i + 1).padStart(2, '0')}`);
      const nm = letters('wp__name', name);
      const tag = el('div', 'wp__tag', eng ? 'TODA LA LECCE · SQUAD' : 'TODA LA LECCE · SOCIO');
      const count = el('div', 'wp__count', `${String(i + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`);
      info.append(num, nm, tag);
      sc.append(band, band2, huge, disc, info, count, el('i', 'wp__cut'));
      return { sc, band, band2, huge, disc, info, num, nm, tag, count };
    });

    /* ── Final ── */
    const fin = el('div', 'wp__final');
    const fCrest = el('img', 'wp__fcrest');
    fCrest.src = crest.src;
    fCrest.alt = '';
    const fTitle = el('div', 'wp__ftitle', 'TODA LA LECCE');
    const team = el('div', 'wp__team');
    const half = Math.ceil(N / 2);
    const mini = names.map((name, i) => {
      const top = i < half;
      const row = top ? half : N - half;
      const k = top ? i : i - half;
      const x = (k - (row - 1) / 2) * Math.min(11.5, 86 / Math.max(1, row));
      const y = top ? -6.5 : 7.5;
      const p = el('div', 'wp__m' + (i % 2 ? ' is-blue' : ''));
      p.style.setProperty('--x', `${x.toFixed(2)}vw`);
      p.style.setProperty('--y', `${y}vh`);
      p.append(el('b', '', initials(name)), el('span', '', name));
      team.append(p);
      return p;
    });
    const hello = el('div', 'wp__hello');
    hello.append(el('small', '', eng ? 'WELCOME' : 'BIENVENIDO'), el('b', '', o.nick || 'TL APP'));
    const strip = el('div', 'wp__strip');
    strip.append(el('div', 'wp__stripline', 'HAXBALL ✦ TL APP ✦ TODA LA LECCE ✦ '.repeat(10)));
    fin.append(fCrest, fTitle, team, hello);

    stage.append(open, plantel, ...scenes.map((s) => s.sc), fin);
    const flash = el('i', 'wp__flash');
    const flashG = el('i', 'wp__flash wp__flash--gold');
    root.append(bg, stage, strip, el('i', 'wp__bar wp__bar--t'), el('i', 'wp__bar wp__bar--b'), flash, flashG,
      el('div', 'wp__corner', 'TL APP · HAXBALL CLIENT'), el('div', 'wp__skip', eng ? 'Click to skip' : 'Clic para saltar'));
    document.body.append(root);
    document.documentElement.classList.add('is-welcoming');
    setTimeout(() => document.documentElement.classList.remove('is-welcoming'), (endSec + 4) * 1000);

    /* ── Sonido ── */
    let audio = null;
    if (o.sound) {
      try {
        audio = new Audio(AUDIO);
        audio.preload = 'auto';
        audio.volume = Math.min(1, Math.max(0.15, Number(o.volume) || 0.7));
      } catch (e) { audio = null; }
    }

    const anims = [];
    /** Anima `node` a los `sec` segundos de empezar. `keep`: deja el último cuadro. */
    const at = (sec, node, frames, ms, easing = 'cubic-bezier(.2,.8,.2,1)', keep = true) => {
      anims.push(node.animate(frames, { delay: Math.max(0, sec * 1000), duration: ms, easing, fill: keep ? 'forwards' : 'none' }));
    };
    const pop = (sec, node, ms = 500) => at(sec, node, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: 0.15 }, { transform: 'scale(1)' }], ms, 'cubic-bezier(.2,.8,.2,1)', false);

    const build = () => {
      /* Fondo: se enciende con el primer golpe y la cámara late en cada compás. */
      at(b(0), bg, [{ opacity: 0.35 }, { opacity: 1 }], 600, 'ease-out');
      for (let n = 0; n <= END; n += 4) pop(b(n), stage, 480);
      at(b(0), sweep, [{ transform: 'translateX(-120vw) skewX(-20deg)' }, { transform: 'translateX(120vw) skewX(-20deg)' }], 900, 'cubic-bezier(.5,0,.3,1)');
      at(b(FINAL), sweep2, [{ transform: 'translateX(120vw) skewX(20deg)' }, { transform: 'translateX(-120vw) skewX(20deg)' }], 900, 'cubic-bezier(.5,0,.3,1)');
      for (const s of [b(0), b(FINAL)]) at(s, flash, [{ opacity: 0.95 }, { opacity: 0 }], 520, 'ease-out');
      for (let n = PLAYER0; n < FINAL; n += PER * 2) at(b(n), flashG, [{ opacity: 0.55 }, { opacity: 0 }], 380, 'ease-out');
      at(b(END - 4), flashG, [{ opacity: 0.8 }, { opacity: 0 }], 700, 'ease-out');

      /* Apertura */
      at(b(0), crest, [{ opacity: 0, transform: 'scale(3) rotate(-10deg)' }, { opacity: 1, transform: 'scale(.92) rotate(1deg)', offset: 0.6 }, { opacity: 1, transform: 'scale(1) rotate(0)' }], 520, 'cubic-bezier(.2,1.3,.3,1)');
      [...rings.children].forEach((r, i) => at(b(0) + i * 0.08, r, [{ opacity: 1, transform: 'translate(-50%,-50%) scale(.1)' }, { opacity: 0, transform: 'translate(-50%,-50%) scale(5)' }], 1100, 'cubic-bezier(.1,.7,.3,1)'));
      at(b(1), titleBox, [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)' }], 380, 'cubic-bezier(.2,1.3,.3,1)');
      // Glitch: las copias roja y azul tiemblan en cada golpe y vuelven a su lugar.
      for (const n of [1, 2, 3, 4, 5, 6]) {
        at(b(n), tR, [{ transform: 'translate(-1.2vmin, .3vmin)', opacity: 0.9 }, { transform: 'translate(.6vmin,-.2vmin)', opacity: 0.7, offset: 0.3 }, { transform: 'translate(0,0)', opacity: 0 }], 260, 'steps(4)', false);
        at(b(n), tB, [{ transform: 'translate(1.2vmin, -.3vmin)', opacity: 0.9 }, { transform: 'translate(-.6vmin,.2vmin)', opacity: 0.7, offset: 0.3 }, { transform: 'translate(0,0)', opacity: 0 }], 260, 'steps(4)', false);
      }
      at(b(2), presents, [{ opacity: 0, transform: 'translateY(2vmin)', letterSpacing: '1.4em' }, { opacity: 1, transform: 'translateY(0)', letterSpacing: '.7em' }], 700);
      at(b(4), open, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-14vh) scale(.62)' }], 420);
      at(b(4), presents, [{ opacity: 1 }, { opacity: 0 }], 200);
      at(b(4), wEl, [{ opacity: 0, transform: 'translateX(-14vw) skewX(-12deg)' }, { opacity: 1, transform: 'translateX(0) skewX(0)' }], 320, 'cubic-bezier(.2,1.2,.3,1)');
      at(b(5), wPl, [{ opacity: 0, transform: 'scale(2.4)' }, { opacity: 1, transform: 'scale(1)' }], 340, 'cubic-bezier(.2,1.3,.3,1)');
      at(b(6), plantel, [{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,-50%) scale(1.06)', offset: 0.15 }, { transform: 'translate(-50%,-50%) scale(1)' }], 400, 'cubic-bezier(.2,.8,.2,1)', false);
      // Todo se va contra la cámara justo antes del primer socio.
      at(b(7.5), open, [{ opacity: 1, transform: 'translateY(-14vh) scale(.62)' }, { opacity: 0, transform: 'translateY(-14vh) scale(2.4)' }], 260, 'cubic-bezier(.6,0,.9,.4)');
      at(b(7.5), plantel, [{ opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }, { opacity: 0, transform: 'translate(-50%,-50%) scale(2.6)' }], 260, 'cubic-bezier(.6,0,.9,.4)');

      /* Socios: entra en su golpe y se va justo antes del siguiente. */
      scenes.forEach((s, i) => {
        const t = b(PLAYER0 + i * PER);
        const out = b(PLAYER0 + (i + 1) * PER) - 0.13;
        const dir = i % 2 ? -1 : 1;
        at(t, s.sc, [{ opacity: 0 }, { opacity: 1 }], 1);
        at(t, s.band, [{ transform: `translateX(${110 * dir}vw) skewX(-14deg)` }, { transform: 'translateX(0) skewX(-14deg)' }], 260, 'cubic-bezier(.2,.9,.2,1)');
        at(t + 0.05, s.band2, [{ transform: `translateX(${130 * dir}vw) skewX(-14deg)` }, { transform: 'translateX(0) skewX(-14deg)' }], 300, 'cubic-bezier(.2,.9,.2,1)');
        at(t, s.huge, [{ transform: `translate(-50%,-50%) translateX(${12 * dir}vw)`, opacity: 0 }, { transform: 'translate(-50%,-50%) translateX(0)', opacity: 0.16, offset: 0.2 }, { transform: `translate(-50%,-50%) translateX(${-12 * dir}vw)`, opacity: 0.16 }], 1000, 'linear');
        at(t + 0.04, s.disc, [{ opacity: 0, transform: 'scale(0) rotate(-90deg)' }, { opacity: 1, transform: 'scale(1.08) rotate(6deg)', offset: 0.7 }, { opacity: 1, transform: 'scale(1) rotate(0)' }], 380, 'cubic-bezier(.2,1.2,.3,1)');
        pop(b(PLAYER0 + i * PER + 1), s.disc, 420);
        at(t + 0.06, s.num, [{ opacity: 0, transform: 'translateY(-3vmin)' }, { opacity: 1, transform: 'translateY(0)' }], 300);
        [...s.nm.children].forEach((l, k) => at(t + 0.1 + k * 0.025, l, [{ opacity: 0, transform: 'translateY(110%)' }, { opacity: 1, transform: 'translateY(0)' }], 300, 'cubic-bezier(.2,1.1,.3,1)'));
        at(t + 0.28, s.tag, [{ opacity: 0, transform: 'translateX(-3vmin)' }, { opacity: 1, transform: 'translateX(0)' }], 300);
        at(t + 0.1, s.count, [{ opacity: 0 }, { opacity: 1 }], 200);
        // Salida: la franja se va del otro lado y todo se corta en seco.
        at(out, s.band, [{ transform: 'translateX(0) skewX(-14deg)' }, { transform: `translateX(${-110 * dir}vw) skewX(-14deg)` }], 140, 'cubic-bezier(.7,0,1,.5)');
        at(out, s.band2, [{ transform: 'translateX(0) skewX(-14deg)' }, { transform: `translateX(${-130 * dir}vw) skewX(-14deg)` }], 140, 'cubic-bezier(.7,0,1,.5)');
        at(out, s.disc, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.5)' }], 130, 'ease-in');
        at(out, s.info, [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-6 * dir}vw)` }], 130, 'ease-in');
        at(out + 0.12, s.sc, [{ opacity: 1 }, { opacity: 0 }], 1);
      });

      /* Final */
      const F = b(FINAL);
      at(F, fin, [{ opacity: 0 }, { opacity: 1 }], 1);
      at(F, fCrest, [{ opacity: 0, transform: 'scale(2.6)' }, { opacity: 1, transform: 'scale(1)' }], 420, 'cubic-bezier(.2,1.3,.3,1)');
      at(F + 0.1, fTitle, [{ opacity: 0, transform: 'translateY(3vmin)', letterSpacing: '.6em' }, { opacity: 1, transform: 'translateY(0)', letterSpacing: '.12em' }], 600);
      mini.forEach((m, i) => at(F + 0.15 + i * 0.05, m, [{ opacity: 0, transform: 'translate(calc(-50% + var(--x)), calc(-50% + var(--y) - 5vh)) scale(0)' }, { opacity: 1, transform: 'translate(calc(-50% + var(--x)), calc(-50% + var(--y))) scale(1)' }], 420, 'cubic-bezier(.2,1.4,.3,1)'));
      for (let n = FINAL + 2; n < END; n += 2) pop(b(n), team, 460);
      at(b(FINAL + 4), hello, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(1.5)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], 420, 'cubic-bezier(.2,1.3,.3,1)');
      at(b(FINAL + 2), strip, [{ opacity: 1, transform: 'rotate(-2.5deg) scaleY(0)' }, { opacity: 1, transform: 'rotate(-2.5deg) scaleY(1)' }], 360);
      at(b(FINAL + 2), strip.firstChild, [{ transform: 'translateX(0)' }, { transform: 'translateX(-35%)' }], (endSec - b(FINAL + 2)) * 1000 + 600, 'linear');
      pop(b(END - 4), fCrest, 700);
    };

    let done = false;
    let started = false;
    const timers = [];

    const start = () => {
      if (started || done) return;
      started = true;
      root.classList.add('is-on');
      build();
      timers.push(setTimeout(() => finish(false), endSec * 1000));
    };

    const finish = (quick) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', onSkip, true);
      root.removeEventListener('pointerdown', onSkip, true);
      if (audio) {
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
      }, quick ? 320 : 900);
    };
    const onSkip = (e) => {
      if (e.type === 'keydown') { e.preventDefault(); e.stopPropagation(); }
      finish(true);
    };
    window.addEventListener('keydown', onSkip, true);
    root.addEventListener('pointerdown', onSkip, true);
    current = { finish };

    // La imagen arranca cuando el audio de verdad empieza a sonar, así cada
    // golpe cae con su corte. Sin audio (o bloqueado), arranca igual.
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

  window.TLWelcome = { play };
})();
