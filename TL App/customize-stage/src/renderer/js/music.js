/*
 * Música del menú: las canciones del club (`assets/music`) y las que cada jugador
 * suma desde su PC suenan en el menú de salas.
 *
 * - Cada vez que aparece el menú arranca una distinta, al azar (nunca la misma).
 * - Si te quedás, siguen en orden (la 5, la 6, la 7...) y se funden una con otra.
 * - Al entrar a una sala sigue sonando, más bajo (hay que oír el juego).
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
    allowed: false, inGame: false, started: false, userPaused: false, held: false,
    likes: new Set(), hidden: new Set(), hist: [], queued: -1,
    introDone: false, errors: 0, xfade: 3000, crossing: false, loading: null, timers: new WeakMap()
  };

  // Dentro de una sala la música sigue, pero más baja, para oír el juego.
  const IN_GAME_GAIN = 0.4;
  const gain = () => Math.min(1, Math.max(0, M.volume)) * (M.inGame ? IN_GAME_GAIN : 1);
  const wantPlaying = () => M.enabled && M.allowed && !M.userPaused && !M.held && !S.on && M.tracks.length > 0 && !(M.inGame && M.inGameOff);
  const current = () => M.pool[M.cur];
  /** Una canción del club que empieza con «00» es la de arranque (hoy no hay ninguna): suena una sola vez, al abrir la app. */
  const isIntro = (t) => !!t && !t.user && /^\s*0+\s*[-.)]/.test(t.name || '');

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

  /** Frena y suelta el archivo: un reproductor parado no tiene por qué seguir con el mp3 abierto. */
  function release(a) {
    try { a.pause(); if (a !== current()) { a.removeAttribute('src'); a.load(); } } catch (e) { /* nada */ }
  }

  function state() {
    window.dispatchEvent(new CustomEvent('tl:musicstate', { detail: { paused: M.userPaused } }));
  }

  function announce() {
    const t = M.tracks[M.index % M.tracks.length];
    if (!t) return;
    window.dispatchEvent(new CustomEvent('tl:track', { detail: { title: t.title, artist: t.artist || '', name: t.name, user: !!t.user, playing: true } }));
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
    if (old && !old.paused) fade(old, 0, Math.max(400, crossMs || 0), () => release(old));
    announce();
  }

  /**
   * El que sigue: al azar, pero los que marcaste con corazón salen tres veces más seguido, no repite
   * ninguno de los últimos que sonaron y la de bienvenida no vuelve. Se elige de antemano para poder
   * mostrar «Sigue:» en la tarjeta.
   */
  function pickNext() {
    const n = M.tracks.length;
    if (n < 2) return n ? 0 : -1;
    const recent = new Set(M.hist.slice(-Math.min(4, Math.floor(n / 2))));
    const cur = M.index % n;
    const cand = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const t = M.tracks[i];
      if (i === cur || recent.has(t.name) || (M.introDone && isIntro(t))) continue;
      const w = M.likes.has(t.name) ? 3 : 1;
      cand.push([i, w]);
      total += w;
    }
    if (!cand.length) return (cur + 1) % n;
    let r = Math.random() * total;
    for (const [i, w] of cand) { r -= w; if (r <= 0) return i; }
    return cand[cand.length - 1][0];
  }
  const queued = () => {
    if (!(M.queued >= 0 && M.queued < M.tracks.length) || M.queued === M.index % M.tracks.length) M.queued = pickNext();
    return M.queued;
  };

  /** Avanza (o retrocede). Atrás vuelve a los que ya sonaron, en orden. */
  function step(dir, smooth) {
    if (!M.tracks.length) return;
    // Saltear con la música en pausa la retoma.
    if (M.userPaused) { M.userPaused = false; state(); }
    const n = M.tracks.length;
    const here = M.tracks[M.index % n];
    if (dir > 0) {
      if (here) { M.hist.push(here.name); if (M.hist.length > 40) M.hist.shift(); }
      M.index = queued();
      M.queued = -1;
    } else {
      let i = -1;
      while (M.hist.length && i < 0) i = M.tracks.findIndex((t) => t.name === M.hist.pop());
      M.index = i >= 0 ? i : ((M.index - 1) % n + n) % n;
      M.queued = -1;
    }
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
    const keep = M.all.filter((t) => (t.user || M.club) && !M.hidden.has(t.name));
    M.queued = -1;
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
        ? { name: t, title: titleOf(t), artist: '', url: `../../assets/music/${encodeURIComponent(t)}`, user: false }
        : { name: t.name, title: t.title || titleOf(t.name), artist: t.artist || '', url: t.url, user: !!t.user }));
    } catch (e) { M.all = []; }
    applyFilter();
  }

  /* ── Spotify como fuente ───────────────────────────────────────────────
   * Con «Spotify» elegido, las canciones de la app se callan y todo lo que ya
   * existe (tarjeta «Ahora suena», barra de arriba, página Música, botones)
   * muestra y maneja lo que suena en Spotify. Se le pregunta a Windows cada
   * ~1,5 s SÓLO en el menú y con la ventana a la vista: en una sala o partida
   * no se pregunta nada (lo último que se supo queda en la barra, y los botones
   * piden una sola lectura al tocarlos). */
  const S = {
    on: false, playing: false, title: '', artist: '', album: '', key: '', cover: '',
    pos: 0, dur: 0, at: 0, canSeek: false, status: 'idle', timer: 0, busy: false, heldPause: false
  };
  const sNow = () => (S.title ? { title: S.title, artist: S.artist, name: `spotify:${S.key}`, user: false, spotify: true } : null);
  const sCur = () => {
    if (!S.dur) return 0;
    const extra = S.playing ? (performance.now() - S.at) / 1000 : 0;
    return Math.min(S.dur, Math.max(0, S.pos + extra));
  };
  function sEmit(changedTrack, changedPlay) {
    if (changedTrack || changedPlay) {
      const n = sNow();
      window.dispatchEvent(new CustomEvent('tl:track', { detail: n ? { ...n, playing: S.playing } : { playing: false } }));
    }
    if (changedPlay) window.dispatchEvent(new CustomEvent('tl:musicstate', { detail: { paused: !S.playing } }));
    window.dispatchEvent(new CustomEvent('tl:spotify', { detail: { status: S.status } }));
  }
  async function sRead() {
    if (!S.on || S.busy || !window.tvm || !window.tvm.spotify) return;
    S.busy = true;
    let r = null;
    try { r = await window.tvm.spotify.get(); } catch (e) { r = null; }
    S.busy = false;
    if (!S.on) return;
    if (!r || r.ok === false) {
      const was = S.status;
      S.status = r && r.error === 'not windows' ? 'nowin' : 'error';
      if (was !== S.status) sEmit(false, false);
      return;
    }
    const title = String(r.title || '');
    const artist = String(r.artist || '');
    const key = String(r.key || `${artist}|${title}`);
    const playing = !!r.playing && !!title;
    const changedTrack = key !== S.key || title !== S.title;
    const changedPlay = playing !== S.playing;
    S.status = !r.running ? 'closed' : (title ? 'ok' : 'idle');
    S.title = title; S.artist = artist; S.album = String(r.album || ''); S.key = key;
    if (typeof r.cover === 'string') S.cover = r.cover;
    else if (changedTrack && r.mode !== 'smtc') S.cover = '';
    S.playing = playing;
    S.dur = Number(r.dur) || 0;
    S.pos = (Number(r.pos) || 0) + (playing ? Math.max(0, Number(r.age) || 0) : 0);
    S.at = performance.now();
    S.canSeek = !!r.canSeek && S.dur > 0;
    sEmit(changedTrack, changedPlay);
    if (changedTrack) window.dispatchEvent(new CustomEvent('tl:spotifycover'));
  }
  function sLoop() {
    clearTimeout(S.timer);
    S.timer = 0;
    if (!S.on || M.inGame) return;
    if (!document.hidden) sRead();
    S.timer = setTimeout(sLoop, document.hidden ? 5000 : 1500);
  }
  async function sCmd(name, arg) {
    if (!window.tvm || !window.tvm.spotify) return;
    try { await window.tvm.spotify.cmd(name, arg); } catch (e) { /* sin Spotify */ }
    // Spotify tarda un pelito en publicar el cambio.
    setTimeout(sRead, 350);
    setTimeout(sRead, 1100);
  }
  function setSpotify(on) {
    if (on === S.on) return;
    S.on = on;
    if (on) {
      S.status = 'idle';
      sync();
      sLoop();
    } else {
      clearTimeout(S.timer);
      S.timer = 0;
      Object.assign(S, { playing: false, title: '', artist: '', album: '', key: '', cover: '', dur: 0, pos: 0, heldPause: false });
      try { window.tvm.spotify.stop(); } catch (e) { /* nada */ }
      window.dispatchEvent(new CustomEvent('tl:track', { detail: { playing: false } }));
      window.dispatchEvent(new CustomEvent('tl:spotify', { detail: { status: 'off' } }));
      sync();
    }
  }
  document.addEventListener('visibilitychange', () => { if (S.on && !document.hidden && !M.inGame) sLoop(); });

  window.TLMusic = {
    /** Interruptor, volumen (0–1) y si entran las canciones del club. */
    configure(enabled, volume, club, source) {
      M.enabled = enabled !== false;
      if (source !== undefined) M.source = source === 'spotify' ? 'spotify' : 'tl';
      setSpotify(M.enabled && M.source === 'spotify');
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
      if (!M.started) {
        const intro = M.tracks.findIndex(isIntro);
        if (intro >= 0) M.index = intro;
        else if (M.tracks.length > 1) M.index = Math.floor(Math.random() * M.tracks.length);
      }
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
    /** `false` = no suena música mientras hay una sala o partida abierta (menos trabajo para la PC). */
    setInGameMusic(on) {
      M.inGameOff = !on;
      if (M.allowed && M.inGame) this.setInGame(true);
    },
    /** `true` dentro de una sala o partida: se silencia. */
    setInGame(flag) {
      M.inGame = !!flag;
      if (S.on) { if (M.inGame) { clearTimeout(S.timer); S.timer = 0; } else sLoop(); }
      if (!M.allowed) return;
      // No se corta ni cambia de tema: sólo baja (en sala) o vuelve (en el menú).
      const a = current();
      if (a && !a.paused && wantPlaying()) fade(a, gain(), 900);
      else sync();
    },
    /** Cuánto va de la canción que suena (0 a 1), para la barrita del cartel. */
    progress() { if (S.on) return S.dur ? sCur() / S.dur : 0; const a = current(); return a && isFinite(a.duration) && a.duration ? Math.min(1, a.currentTime / a.duration) : 0; },
    /** Los temas con corazón (suenan más seguido) y los ocultos (no suenan). Son nombres de archivo. */
    setLists(likes, hidden) {
      M.likes = new Set(Array.isArray(likes) ? likes : []);
      const next = new Set(Array.isArray(hidden) ? hidden : []);
      const changed = next.size !== M.hidden.size || [...next].some((x) => !M.hidden.has(x));
      M.hidden = next;
      M.queued = -1;
      if (changed && M.all.length) {
        const now = M.tracks[M.index % (M.tracks.length || 1)];
        applyFilter();
        // Si el que suena quedó oculto, se pasa al siguiente.
        if (now && next.has(now.name) && M.allowed && wantPlaying()) { M.index = Math.floor(Math.random() * Math.max(1, M.tracks.length)); playIndex(0); }
      }
    },
    /** Pausa / reanuda sin tocar el interruptor de ajustes. */
    toggle() {
      if (S.on) {
        S.pos = sCur(); S.at = performance.now();
        S.playing = !S.playing;
        S.heldPause = false;
        sEmit(false, true);
        sCmd('toggle');
        return;
      }
      if (!M.allowed || !M.enabled) return;
      const a = current();
      if (!M.userPaused) {
        M.userPaused = true;
        if (a && !a.paused) fade(a, 0, 250, () => { if (M.userPaused) a.pause(); });
        state();
      } else {
        M.userPaused = false;
        state();
        if (a && a.src) {
          const p = a.play();
          if (p && p.catch) p.catch(() => {});
          fade(a, gain(), 300);
        } else sync();
      }
    },
    get paused() { return S.on ? !S.playing : M.userPaused; },
    /**
     * Otra cosa necesita el parlante (el tema de la página Club): se baja y se
     * frena el que suena, sin tocar la pausa del jugador ni cambiar de tema. Al
     * soltarlo sigue desde donde quedó.
     */
    hold(flag) {
      const next = !!flag;
      if (next === M.held) return;
      M.held = next;
      // Spotify también se pausa mientras tanto, y sigue sólo si lo pausamos nosotros.
      if (S.on) {
        if (next && S.playing) { S.heldPause = true; S.playing = false; sEmit(false, true); sCmd('toggle'); }
        else if (!next && S.heldPause) { S.heldPause = false; S.playing = true; S.at = performance.now(); sEmit(false, true); sCmd('toggle'); }
      }
      if (M.allowed) sync();
    },
    get enabled() { return M.enabled; },
    get volume() { return M.volume; },
    /** Salta a una parte del tema actual (0 a 1). */
    seek(f) {
      if (S.on) {
        if (!S.canSeek) return;
        const t = Math.min(1, Math.max(0, f)) * S.dur;
        S.pos = t; S.at = performance.now();
        sCmd('seek', t);
        return;
      }
      const a = current(); if (a && isFinite(a.duration) && a.duration) a.currentTime = Math.min(1, Math.max(0, f)) * a.duration; },
    /** Segundos que lleva y que dura el tema actual. */
    time() { if (S.on) return { cur: sCur(), dur: S.dur }; const a = current(); return a && isFinite(a.duration) ? { cur: a.currentTime, dur: a.duration } : { cur: 0, dur: 0 }; },
    /** Lugar en la lista y el tema que viene. */
    get position() { if (S.on) return { i: 0, n: 0 }; return { i: M.tracks.length ? (M.index % M.tracks.length) + 1 : 0, n: M.tracks.length }; },
    get upNext() { if (S.on) return null; const n = M.tracks.length; const t = n > 1 ? M.tracks[queued()] : null; return t ? { title: t.title, artist: t.artist } : null; },
    /** Pasa a un tema puntual (por nombre de archivo). `false` si no está entre los que suenan. */
    playName(name) {
      if (S.on) return false;
      const i = M.tracks.findIndex((t) => t.name === name);
      if (i < 0) return false;
      if (M.index % M.tracks.length === i && this.playing) return true;
      const here = M.tracks[M.index % M.tracks.length];
      if (here) { M.hist.push(here.name); if (M.hist.length > 40) M.hist.shift(); }
      M.index = i;
      M.queued = -1;
      if (M.userPaused) { M.userPaused = false; state(); }
      if (M.allowed && wantPlaying()) playIndex(0);
      return true;
    },
    next() { if (S.on) sCmd('next'); else step(1, false); },
    prev() { if (S.on) sCmd('prev'); else step(-1, false); },
    skip() { if (S.on) sCmd('next'); else step(1, false); },
    /** Spotify: si está elegido, en qué anda (`ok` · `idle` · `closed` · `error` · `nowin`) y la tapa (data URL). */
    get spotify() { return S.on ? { status: S.status, cover: S.cover, canSeek: S.canSeek, album: S.album } : null; },
    /** Una lectura ya (por ejemplo, al abrir la página Música dentro de una sala). */
    spotifyRefresh() { if (S.on) sRead(); },
    /** Sólo para pruebas: duración del fundido. */
    setCrossfade(ms) { M.xfade = Math.max(0, Number(ms) || 0); },
    get count() { return M.tracks.length; },
    get tracks() { return M.all.map((t) => ({ name: t.name, title: t.title, artist: t.artist, user: t.user })); },
    /** El tema que suena ahora: { title, artist, name, user }. */
    get now() { if (S.on) return sNow(); const t = M.tracks[M.index % (M.tracks.length || 1)]; return t ? { title: t.title, artist: t.artist, name: t.name, user: !!t.user } : null; },
    get playing() { if (S.on) return S.playing; const a = current(); return !!(a && !a.paused && wantPlaying()); }
  };
})();
