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
  function blip(type, f0, f1, dur, peak, delay, cut, detune) {
    const a = ctx();
    if (!a) return;
    const t = a.currentTime + (delay || 0);
    const o = a.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cut || 6500;
    if (detune) o.detune.value = detune;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  /*
   * Tres estilos. Cada uno define los cuatro sonidos con las mismas notas base, así
   * que cambiar de estilo cambia el carácter, no el volumen general.
   */
  const STYLES = {
    // Moderno: tics cristalinos y pops redondos.
    modern: {
      hover() { const f = SCALE[Math.floor(Math.random() * SCALE.length)]; blip('sine', f, f * 1.12, 0.05, 0.028); },
      click() { blip('triangle', 520, 1040, 0.075, 0.07); blip('sine', 1560, 1560, 0.045, 0.03, 0.012); },
      on() { blip('triangle', 700, 700, 0.07, 0.055); blip('triangle', 1050, 1050, 0.1, 0.055, 0.065); },
      off() { blip('triangle', 1050, 1050, 0.07, 0.05); blip('triangle', 700, 700, 0.1, 0.05, 0.065); }
    },
    // Suave: sólo senos graves y largos, casi un susurro.
    soft: {
      hover() { const f = SCALE[Math.floor(Math.random() * 3)] * 0.5; blip('sine', f, f, 0.11, 0.016); },
      click() { blip('sine', 392, 523, 0.14, 0.05); },
      on() { blip('sine', 523, 523, 0.12, 0.04); blip('sine', 659, 659, 0.16, 0.04, 0.08); },
      off() { blip('sine', 659, 659, 0.12, 0.035); blip('sine', 523, 523, 0.16, 0.035, 0.08); }
    },
    // Arcade: ondas cuadradas de 8 bits, con arpegios.
    arcade: {
      hover() { const f = [988, 1175, 1319][Math.floor(Math.random() * 3)]; blip('square', f, f, 0.03, 0.014); },
      click() { blip('square', 440, 880, 0.06, 0.035); blip('square', 1320, 1320, 0.04, 0.025, 0.05); },
      on() { [523, 659, 784].forEach((f, i) => blip('square', f, f, 0.06, 0.03, i * 0.055)); },
      off() { [784, 659, 523].forEach((f, i) => blip('square', f, f, 0.06, 0.03, i * 0.055)); }
    }
  };
  /** Un chasquido de vinilo, bajito: da el aire de lofi. */
  function crackle(peak, delay) {
    const a = ctx();
    if (!a) return;
    const t = a.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(a.sampleRate * 0.012));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = a.createBufferSource();
    src.buffer = buf;
    const hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = a.createGain();
    g.gain.value = peak;
    src.connect(hp); hp.connect(g); g.connect(out);
    src.start(t);
  }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const wob = () => (Math.random() * 24 - 12); // desafinación leve, tipo cinta
  // Escalas pentatónicas menores: cualquier nota combina con cualquier otra.
  const LOFI = [262, 294, 330, 392, 440, 523];
  const WOOD = [523, 587, 659, 784, 880];

  STYLES.lofi = {
    hover() { blip('triangle', pick(LOFI), pick(LOFI), 0.1, 0.022, 0, 1500, wob()); },
    click() { crackle(0.02); blip('triangle', 294, 294, 0.17, 0.05, 0, 1600, wob()); blip('triangle', 440, 440, 0.2, 0.04, 0.02, 1500, wob()); },
    on() { crackle(0.015); blip('triangle', 330, 330, 0.14, 0.045, 0, 1500, wob()); blip('triangle', 494, 494, 0.2, 0.045, 0.09, 1500, wob()); },
    off() { crackle(0.015); blip('triangle', 494, 494, 0.14, 0.04, 0, 1500, wob()); blip('triangle', 330, 330, 0.2, 0.04, 0.09, 1500, wob()); }
  };

  // Madera: golpecitos de marimba, redondos y cortos.
  const wood = (f, peak, delay) => {
    blip('sine', f, f, 0.14, peak, delay, 3200);
    blip('sine', f * 4, f * 4, 0.035, peak * 0.35, delay, 5000);
  };
  STYLES.wood = {
    hover() { const f = pick(WOOD); blip('sine', f, f, 0.06, 0.022, 0, 3000); },
    click() { wood(392, 0.08); },
    on() { wood(523, 0.06); wood(784, 0.06, 0.07); },
    off() { wood(784, 0.055); wood(523, 0.055, 0.07); }
  };

  // Burbuja: gotitas de agua, el tono sube rápido y se apaga.
  STYLES.bubble = {
    hover() { const f = 500 + Math.random() * 300; blip('sine', f, f * 1.7, 0.05, 0.02, 0, 3500); },
    click() { blip('sine', 320, 980, 0.1, 0.06, 0, 4000); blip('sine', 640, 1500, 0.07, 0.025, 0.015, 4000); },
    on() { blip('sine', 380, 900, 0.08, 0.05, 0, 4000); blip('sine', 560, 1300, 0.09, 0.05, 0.07, 4000); },
    off() { blip('sine', 560, 1300, 0.08, 0.045, 0, 4000); blip('sine', 380, 900, 0.09, 0.045, 0.07, 4000); }
  };

  let style = 'modern';
  const sounds = {
    hover: () => STYLES[style].hover(),
    click: () => STYLES[style].click(),
    on: () => STYLES[style].on(),
    off: () => STYLES[style].off()
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
    configure(flag, name) {
      enabled = flag !== false;
      if (name && STYLES[name]) style = name;
    },
    play(name) { if (enabled && sounds[name]) sounds[name](); }
  };
})();
