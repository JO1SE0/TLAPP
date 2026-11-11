(function () {
  const H = window.__H;
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme') || H.theme;
  H.cfg.appearance.theme = theme;
  if (params.get('ui')) H.cfg.appearance.ui = params.get('ui');
  const bootUi = 'classic';
  if (params.get('nav')) H.cfg.appearance.nav = params.get('nav');
  H.cfg.general.nickname = 'Jefe';
  // datos de perfil de ejemplo
  H.cfg.stats = Object.assign({}, H.cfg.stats || {}, { matches: 40, goals: 22, assists: 9, streak: 3, secondsPlayed: 51000 });
  // tema antes del primer cuadro
  const v = H.vars[theme] || {};
  const paint=()=>{for (const k in v) if (v[k]) document.documentElement.style.setProperty(k, v[k]); document.documentElement.dataset.ui = bootUi; }; if (document.documentElement) paint(); else document.addEventListener('readystatechange', paint, {once:true});
  const names = ['Futsal x4 · Toda la Lecce', 'Real Soccer 3v3 🇦🇷', '═══ LIGA HAX ═══', 'Entreno Lecce', 'x3 Futsal Rankeado', 'Bazinga x2 | 24/7', 'Sala de Jefe', 'Big Hax 4v4', 'Penales y tiros libres', 'Volley hax'];
  const cc = ['AR', 'BR', 'AR', 'AR', 'UY', 'CL', 'AR', 'PE', 'ES', 'FR'];
  const rooms = names.map((name, i) => ({ token: 't' + i, name, country: cc[i], lat: -34 + i, lon: -58 + i, players: [8, 6, 0, 2, 10, 4, 1, 12, 3, 5][i], maxPlayers: [10, 12, 30, 8, 10, 6, 10, 16, 10, 8][i], password: i === 6, index: i, distance: [12, 900, 40, 9, 210, 1100, 3, 2600, 10000, 11000][i], distanceExact: 1 }));
  const replies = {
    'config.get': () => H.cfg,
    'config.schema': () => H.schema,
    'config.set': (p) => { for (const k in p) H.cfg[k] = Object.assign({}, H.cfg[k], p[k]); return H.cfg; },
    'theme.vars': (a, id) => H.vars[id || theme],
    'app.info': () => ({ version: '1.0.58', electron: '13.6.9', chrome: '91.0', node: '14', platform: 'Windows 10', cpu: 'Ryzen', totalMemory: 16e9, userData: 'C:/', configPath: 'C:/x.json', gamePreload: '/tmp/game-preload.js' }),
    'rooms.list': () => ({ rooms, totalRooms: rooms.length, totalPlayers: 51, fetchedAt: Date.now() }),
    'replays.list': () => ({ folder: 'C:/replays', items: [] }),
    'tracks.list': () => [],
    'presence.roster': () => [],
    'window.state': () => ({ maximized: false, fullscreen: false }),
    'auth.state': () => ({ identities: [], active: null }),
    'updates.check': () => ({ available: false, notes: '' }),
    'game.health': () => ({ down: false }),
  };
  function deep(path) {
    const f = function () {};
    return new Proxy(f, {
      get(t, k) {
        if (k === 'then') return undefined;
        if (k === Symbol.toPrimitive) return () => '';
        if (typeof k === 'symbol') return undefined;
        return deep(path ? path + '.' + k : k);
      },
      apply(t, self, args) {
        if (replies[path]) { try { return Promise.resolve(replies[path](...args)); } catch (e) { return Promise.reject(e); } }
        if (/\.on[A-Z]/.test(path)) return () => {};
        if (path === 'trimMemory' ) return undefined;
        return Promise.resolve(undefined);
      }
    });
  }
  window.tvm = deep('');
  try { localStorage.setItem('tl-skip-welcome', '1'); } catch (e) {}
})();
