/*
 * Música del menú: las canciones de `assets/music` suenan una tras otra mientras
 * estás en el menú de salas, y se silencian al entrar a una sala (hay que oír el
 * juego). Arranca cuando termina la bienvenida.
 *
 * La lista sale de la carpeta (la lee el proceso principal), así que agregar o
 * sacar canciones es copiar o borrar archivos, sin tocar código.
 */
(function () {
  'use strict';

  const FADE_MS = 700;
  const M = { tracks: [], index: 0, audio: null, enabled: true, volume: 0.35, allowed: false, inGame: false, errors: 0, fadeTimer: null, loading: null };

  const gain = () => Math.min(1, Math.max(0, M.volume));
  const wantPlaying = () => M.enabled && M.allowed && !M.inGame && M.tracks.length > 0;

  function fadeTo(target, ms, done) {
    const a = M.audio;
    if (!a) return;
    clearInterval(M.fadeTimer);
    const from = a.volume;
    const t0 = performance.now();
    M.fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
      try { a.volume = Math.min(1, Math.max(0, from + (target - from) * k)); } catch (e) { /* nada */ }
      if (k >= 1) { clearInterval(M.fadeTimer); if (done) done(); }
    }, 40);
  }

  function ensureAudio() {
    if (M.audio) return M.audio;
    const a = new Audio();
    a.preload = 'auto';
    a.volume = 0;
    a.addEventListener('ended', () => { M.errors = 0; next(); });
    a.addEventListener('error', () => {
      // Un archivo roto se salta; si fallan todos, se corta para no entrar en un ciclo.
      M.errors += 1;
      if (M.errors >= M.tracks.length) { M.errors = 0; return; }
      next();
    });
    M.audio = a;
    return a;
  }

  function trackUrl(name) {
    return `../../assets/music/${encodeURIComponent(name)}`;
  }

  function playCurrent() {
    if (!M.tracks.length) return;
    const a = ensureAudio();
    a.src = trackUrl(M.tracks[M.index % M.tracks.length]);
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* sin permiso todavía: se reintenta con el próximo gesto */ });
    fadeTo(gain(), FADE_MS);
  }

  function next() {
    if (!M.tracks.length) return;
    M.index = (M.index + 1) % M.tracks.length;
    if (wantPlaying()) playCurrent();
  }

  function sync() {
    if (wantPlaying()) {
      const a = ensureAudio();
      if (!a.src) playCurrent();
      else if (a.paused) {
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
        fadeTo(gain(), FADE_MS);
      } else fadeTo(gain(), 250);
    } else if (M.audio && !M.audio.paused) {
      const a = M.audio;
      fadeTo(0, 500, () => { if (!wantPlaying()) a.pause(); });
    }
  }

  async function loadTracks() {
    if (M.loading) return M.loading;
    M.loading = (async () => {
      try {
        const list = await window.tvm.tracks.list();
        M.tracks = Array.isArray(list) ? list : [];
      } catch (e) { M.tracks = []; }
    })();
    return M.loading;
  }

  window.TLMusic = {
    /** Interruptor y volumen (0–1) desde la configuración. */
    configure(enabled, volume) {
      M.enabled = enabled !== false;
      if (typeof volume === 'number' && isFinite(volume)) M.volume = Math.min(1, Math.max(0, volume));
      if (M.audio && !M.audio.paused && wantPlaying()) fadeTo(gain(), 150);
      if (M.allowed) sync();
    },
    /** La bienvenida terminó (o no hay): desde acá puede sonar. */
    async start() {
      M.allowed = true;
      await loadTracks();
      sync();
    },
    /** `true` dentro de una sala o partida: se silencia. */
    setInGame(flag) {
      M.inGame = !!flag;
      if (M.allowed) sync();
    },
    skip() { next(); },
    get count() { return M.tracks.length; }
  };
})();
