/*
 * Música del menú: las canciones del club (`assets/music`) y las que cada jugador
 * suma desde su PC suenan en el menú de salas.
 *
 * - Cada vez que aparece el menú arranca una distinta, al azar (nunca la misma).
 * - Si te quedás, siguen en orden (la 5, la 6, la 7...) y se funden una con otra.
 * - Al entrar a una sala se silencia (hay que oír el juego).
 * - Arranca cuando termina la bienvenida.
 *
 * Dos reproductores se turnan para poder fundir el final de un tema con el
 * principio del siguiente. Cada cambio de tema avisa con el evento `tl:track`.
 */
(function () {
  'use strict';

  const FADE_MS = 700;
  const M = {
    all: [], tracks: [], index: 0, pool: [], cur: 0,
    enabled: true, volume: 0.35, club: true,
    allowed: false, inGame: false, started: false,
    errors: 0, xfade: 3000, crossing: false, loading: null, timers: new WeakMap()
  };

  const gain = () => Math.min(1, Math.max(0, M.volume));
  const wantPlaying = () => M.enabled && M.allowed && !M.inGame && M.tracks.length > 0;
  const current = () => M.pool[M.cur];

  function titleOf(name) {
    return String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/^\s*\d+\s*[-.)]\s*/, '').replace(/_/g, ' ').trim();
  }

  function fade(a, target, ms, done) {
    if (!a) return;
    clearInterval(M.timers.get(a));
    const from = a.volume;
    const t0 = performance.now();
    const id = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
      try { a.volume = Math.min(1, Math.max(0, from + (target - from) * k)); } catch (e) { /* nada */ }
      if (k >= 1) { clearInterval(id); if (done) done(); }
    }, 40);
    M.timers.set(a, id);
  }

  function announce() {
    const t = M.tracks[M.index % M.tracks.length];
    if (!t) return;
    window.dispatchEvent(new CustomEvent('tl:track', { detail: { title: t.title, user: !!t.user, playing: true } }));
  }

  function make() {
    const a = new Audio();
    a.preload = 'auto';
    a.volume = 0;
    a.addEventListener('timeupdate', () => onTime(a));
    a.addEventListener('ended', () => { if (a === current()) { M.errors = 0; step(1, false); } });
    a.addEventListener('error', () => {
      if (a !== current()) return;
      // Un archivo roto se salta; si fallan todos, se corta para no entrar en un ciclo.
      M.errors += 1;
      if (M.errors >= M.tracks.length) { M.errors = 0; return; }
      step(1, false);
    });
    return a;
  }

  function ensure() {
    if (!M.pool.length) M.pool = [make(), make()];
  }

  function load(a) {
    a.src = M.tracks[M.index % M.tracks.length].url;
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* sin permiso todavía: se reintenta con el próximo gesto */ });
  }

  /** Empieza la pista `M.index` en el otro reproductor, fundiendo con la que sonaba. */
  function playIndex(crossMs) {
    if (!M.tracks.length) return;
    ensure();
    const old = current();
    M.cur = M.cur ? 0 : 1;
    const a = current();
    load(a);
    a.volume = 0;
    fade(a, gain(), Math.max(FADE_MS, crossMs || 0));
    if (old && !old.paused) fade(old, 0, Math.max(400, crossMs || 0), () => old.pause());
    announce();
  }

  /** Avanza (o retrocede) en la lista. */
  function step(dir, smooth) {
    if (!M.tracks.length) return;
    const n = M.tracks.length;
    M.index = ((M.index + dir) % n + n) % n;
    if (wantPlaying()) playIndex(smooth ? M.xfade : 0);
  }

  function onTime(a) {
    if (a !== current() || M.crossing || a.paused || !isFinite(a.duration)) return;
    if (M.tracks.length < 2 || !wantPlaying()) return;
    if (a.duration - a.currentTime <= M.xfade / 1000 && a.duration > (M.xfade / 1000) * 2) {
      M.crossing = true;
      setTimeout(() => { M.crossing = false; }, M.xfade + 300);
      step(1, true);
    }
  }

  function sync() {
    ensure();
    const a = current();
    if (wantPlaying()) {
      if (!a.src) playIndex(0);
      else if (a.paused) {
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
        fade(a, gain(), FADE_MS);
        announce();
      } else fade(a, gain(), 250);
    } else if (a && !a.paused) {
      fade(a, 0, 500, () => { if (!wantPlaying()) a.pause(); });
      window.dispatchEvent(new CustomEvent('tl:track', { detail: { playing: false } }));
    }
  }

  function applyFilter() {
    const keep = M.all.filter((t) => t.user || M.club);
    // Se conserva la pista que suena si sigue en la lista.
    const now = M.tracks[M.index % (M.tracks.length || 1)];
    M.tracks = keep;
    const at = now ? keep.findIndex((t) => t.url === now.url) : -1;
    M.index = at >= 0 ? at : 0;
  }

  async function loadTracks() {
    try {
      const list = await window.tvm.tracks.list();
      M.all = (Array.isArray(list) ? list : []).map((t) => (typeof t === 'string'
        ? { name: t, title: titleOf(t), url: `../../assets/music/${encodeURIComponent(t)}`, user: false }
        : { name: t.name, title: titleOf(t.name), url: t.url, user: !!t.user }));
    } catch (e) { M.all = []; }
    applyFilter();
  }

  window.TLMusic = {
    /** Interruptor, volumen (0–1) y si entran las canciones del club. */
    configure(enabled, volume, club) {
      M.enabled = enabled !== false;
      if (typeof volume === 'number' && isFinite(volume)) M.volume = Math.min(1, Math.max(0, volume));
      const wantClub = club !== false;
      const clubChanged = wantClub !== M.club;
      M.club = wantClub;
      if (clubChanged && M.all.length) {
        const was = current();
        applyFilter();
        if (M.allowed && was && !was.paused) { playIndex(0); return; }
      }
      const a = current();
      if (a && !a.paused && wantPlaying()) fade(a, gain(), 150);
      if (M.allowed) sync();
    },
    /** La bienvenida terminó (o no hay): desde acá puede sonar. */
    async start() {
      M.allowed = true;
      if (!M.loading) M.loading = loadTracks();
      await M.loading;
      // La primera de la sesión es al azar; después van en orden.
      if (M.tracks.length > 1 && !M.started) M.index = Math.floor(Math.random() * M.tracks.length);
      M.started = true;
      sync();
    },
    /** Después de agregar o quitar canciones propias. */
    async reload() {
      const now = M.tracks[M.index % (M.tracks.length || 1)];
      await loadTracks();
      const at = now ? M.tracks.findIndex((t) => t.url === now.url) : -1;
      if (at >= 0) M.index = at;
      if (M.allowed && wantPlaying() && !(current() && !current().paused)) sync();
    },
    /** `true` dentro de una sala o partida: se silencia. */
    setInGame(flag) {
      const back = M.inGame && !flag;
      M.inGame = !!flag;
      if (!M.allowed) return;
      // Cada vez que aparece el menú suena una canción distinta al azar, nunca la misma.
      if (back && wantPlaying()) {
        if (M.tracks.length > 1) {
          const pick = Math.floor(Math.random() * (M.tracks.length - 1));
          M.index = (M.index % M.tracks.length + 1 + pick) % M.tracks.length;
        }
        playIndex(0);
        return;
      }
      sync();
    },
    /** Cuánto va de la canción que suena (0 a 1), para la barrita del cartel. */
    progress() { const a = current(); return a && isFinite(a.duration) && a.duration ? Math.min(1, a.currentTime / a.duration) : 0; },
    next() { step(1, false); },
    prev() { step(-1, false); },
    skip() { step(1, false); },
    /** Sólo para pruebas: duración del fundido. */
    setCrossfade(ms) { M.xfade = Math.max(0, Number(ms) || 0); },
    get count() { return M.tracks.length; },
    get tracks() { return M.all.map((t) => ({ name: t.name, title: t.title, user: t.user })); }
  };
})();
