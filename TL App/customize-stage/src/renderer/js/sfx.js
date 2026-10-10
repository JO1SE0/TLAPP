/*
 * Sonidos de la interfaz: un "tic" suave al pasar el mouse por un botón y un "pop"
 * al apretarlo, con variantes para los interruptores (sube al prender, baja al
 * apagar). Se sintetizan con Web Audio (sin archivos) y son cortitos y bajos.
 *
 * Un solo oyente delegado en el documento: no se le agrega nada a cada botón.
 * No suena dentro de una sala/partida ni durante la bienvenida.
 */
(function () {
  'use strict';

  const TARGETS = 'button, .btn, .iconbtn, .ghostbtn, .wbtn, .railitem, a[href], select, summary, [role="button"], [role="tab"], [role="switch"], .launch, .rrow, .themecard, .chip, [data-sfx]';
  const HOVER_GAP_MS = 55;
  const SCALE = [1568, 1760, 1976, 2349, 2637]; // notas agudas, todas de la misma escala

  let enabled = true;
  let ac = null;
  let out = null;
  let lastHover = 0;
  let lastEl = null;

  function ctx() {
    if (!ac) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        ac = new Ctx();
        out = ac.createGain();
        out.gain.value = 0.7;
        out.connect(ac.destination);
      } catch (e) { ac = null; return null; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }

  function blocked() {
    const app = document.getElementById('app');
    if (app && app.dataset.stage === 'game') return true;
    return !!document.getElementById('welcome');
  }

  /** Una nota corta: frecuencia inicial → final, con ataque casi instantáneo. */
  function blip(type, f0, f1, dur, peak, delay) {
    const a = ctx();
    if (!a) return;
    const t = a.currentTime + (delay || 0);
    const o = a.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  const sounds = {
    hover() {
      const f = SCALE[Math.floor(Math.random() * SCALE.length)];
      blip('sine', f, f * 1.12, 0.05, 0.028);
    },
    click() {
      blip('triangle', 520, 1040, 0.075, 0.07);
      blip('sine', 1560, 1560, 0.045, 0.03, 0.012);
    },
    on() {
      blip('triangle', 700, 700, 0.07, 0.055);
      blip('triangle', 1050, 1050, 0.1, 0.055, 0.065);
    },
    off() {
      blip('triangle', 1050, 1050, 0.07, 0.05);
      blip('triangle', 700, 700, 0.1, 0.05, 0.065);
    }
  };

  const isOff = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true';
  const isSwitch = (el) => el.matches('[role="switch"], .switch');

  document.addEventListener('pointerover', (e) => {
    if (!enabled || e.pointerType === 'touch' || blocked()) return;
    const el = e.target.closest && e.target.closest(TARGETS);
    if (!el || isOff(el) || el === lastEl) return;
    lastEl = el;
    const now = performance.now();
    if (now - lastHover < HOVER_GAP_MS) return;
    lastHover = now;
    sounds.hover();
  }, true);
  document.addEventListener('pointerout', (e) => {
    if (lastEl && (!e.relatedTarget || !lastEl.contains(e.relatedTarget))) lastEl = null;
  }, true);

  document.addEventListener('pointerdown', (e) => {
    if (!enabled || blocked() || e.button !== 0) return;
    const el = e.target.closest && e.target.closest(TARGETS);
    if (!el || isOff(el) || isSwitch(el)) return;
    sounds.click();
  }, true);

  // Los interruptores suenan según quedaron: se lee después de que la app procesa el clic.
  document.addEventListener('click', (e) => {
    if (!enabled || blocked()) return;
    const el = e.target.closest && e.target.closest('[role="switch"], .switch');
    if (!el || isOff(el)) return;
    setTimeout(() => {
      const on = el.getAttribute('aria-checked') === 'true' || el.classList.contains('is-on') || el.classList.contains('on');
      (on ? sounds.on : sounds.off)();
    }, 30);
  }, true);

  window.TLSfx = {
    configure(flag) { enabled = flag !== false; },
    play(name) { if (enabled && sounds[name]) sounds[name](); }
  };
})();
