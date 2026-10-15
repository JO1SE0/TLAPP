/*
 * Script de sala de TL App (API headless de HaxBall).
 *
 * Lo inyecta el cliente en https://html5.haxball.com/headless con dos cosas ya
 * puestas en `window`:
 *   · __TL_HOST — la configuración (nombre, cupo, modo, clave de admin…).
 *   · TLHost    — el puente con el cliente: TLHost.emit(tipo, datos).
 *
 * Dos modos, un solo script:
 *   · «interno»  — registra cada partido (ganador, goles, asistencias) y graba
 *                  el replay. Es lo que alimenta «Los reyes del x7».
 *   · «amistoso» — sólo comandos para manejar la sala; no registra nada.
 *
 * Todo lo que se escribe con «!» es comando y no se muestra en el chat.
 */
(function () {
  'use strict';

  var CFG = window.__TL_HOST || {};
  var BR = window.TLHost || { emit: function () {} };
  var MODE = CFG.mode === 'interno' ? 'interno' : 'amistoso';
  var RECORD = CFG.record === true;
  var ADMIN_KEY = String(CFG.adminKey || '');
  var HOST_NICK = String(CFG.hostNick || '').toLowerCase();

  /* ── Canchas y reglas por modo ─────────────────────────────────────────── */
  var SIZES = {
    x1: { size: 1, score: 3, time: 3 },
    x3: { size: 3, score: 0, time: 10 },
    x4: { size: 4, score: 0, time: 10 },
    x5: { size: 5, score: 0, time: 10 },
    x7: { size: 7, score: 0, time: 12 },
    train: { size: 0, score: 0, time: 0 }
  };
  var CUSTOM_MAPS = CFG.maps || {};
  var MAPS = {
    classic: 'Classic', easy: 'Easy', small: 'Small', big: 'Big', rounded: 'Rounded',
    hockey: 'Hockey', bighockey: 'Big Hockey', bigeasy: 'Big Easy', bigrounded: 'Big Rounded', huge: 'Huge'
  };

  /* ── Camisetas ─────────────────────────────────────────────────────────── */
  var KITS = {
    argentina: [90, 0x101010, [0x75AADB, 0xFFFFFF, 0x75AADB]],
    brasil: [0, 0x1B6B2F, [0xFFDF00]],
    boca: [0, 0xF7D117, [0x0A2A66, 0xF7D117, 0x0A2A66]],
    river: [45, 0xE30613, [0xFFFFFF, 0xE30613, 0xFFFFFF]],
    lecce: [90, 0x111111, [0xF4D100, 0xC8102E, 0xF4D100]],
    racing: [90, 0x111111, [0x7FC6F0, 0xFFFFFF, 0x7FC6F0]],
    independiente: [0, 0xFFFFFF, [0xD7141A]],
    sanlorenzo: [90, 0xFFFFFF, [0x0A2A66, 0xC8102E, 0x0A2A66]],
    rojo: [0, 0xFFFFFF, [0xE56E56]],
    azul: [0, 0xFFFFFF, [0x5689E5]],
    negro: [0, 0xFFFFFF, [0x1B1B1B]],
    blanco: [0, 0x222222, [0xF2F2F2]],
    verde: [0, 0xFFFFFF, [0x2E9E4F]],
    amarillo: [0, 0x222222, [0xF2D12E]],
    naranja: [0, 0xFFFFFF, [0xE8832A]],
    violeta: [0, 0xFFFFFF, [0x7B4FC9]]
  };

  var room = HBInit({
    roomName: String(CFG.name || 'Sala TL'),
    maxPlayers: Math.max(2, Math.min(30, Number(CFG.maxPlayers) || 16)),
    public: CFG.listed !== false,
    noPlayer: true,
    password: CFG.password ? String(CFG.password) : undefined,
    token: CFG.token ? String(CFG.token) : undefined
  });

  var sizeKey = CFG.size === 'train' && MODE !== 'interno' ? 'train' : SIZES['x' + CFG.size] ? 'x' + CFG.size : (MODE === 'interno' ? 'x7' : 'x3');
  var uniforms = { 1: null, 2: null };
  var game = null;
  var session = {}; // por nombre: { w, l, g, a, o, m } mientras la sala vive

  /* ── Utilidades ────────────────────────────────────────────────────────── */
  var fold = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var players = function () { return room.getPlayerList(); };
  var byId = function (id) { return players().filter(function (p) { return p.id === id; })[0] || null; };
  var running = function () { return !!room.getScores(); };

  function say(msg, to, color) {
    try { room.sendAnnouncement(msg, to == null ? null : to, color == null ? 0xE8CF8E : color, 'normal', 1); }
    catch (e) { try { room.sendChat(msg, to == null ? undefined : to); } catch (e2) { /* sin chat */ } }
  }

  function b64(u8) {
    var s = '';
    var step = 0x8000;
    for (var i = 0; i < u8.length; i += step) s += String.fromCharCode.apply(null, u8.subarray(i, i + step));
    return btoa(s);
  }

  function ensureAdmin() {
    var list = players();
    if (!list.length) return;
    if (list.some(function (p) { return p.admin; })) return;
    room.setPlayerAdmin(list[0].id, true);
    say(list[0].name + ' quedó como admin.');
  }

  /* ── Aplicar un modo (cancha, límites) ─────────────────────────────────── */
  function applyMode(key, announce) {
    var m = SIZES[key];
    if (!m) return false;
    sizeKey = key;
    var text = CUSTOM_MAPS[key];
    var loaded = false;
    if (text) { try { room.setCustomStadium(text); loaded = true; } catch (e) { loaded = false; } }
    room.setScoreLimit(m.score);
    room.setTimeLimit(m.time);
    room.setTeamsLock(false);
    if (announce) {
      var lim = (m.score ? m.score + ' goles' : 'sin límite de goles') + ', ' + (m.time ? m.time + ' min' : 'sin tiempo');
      say('Modo ' + key + ': ' + lim + '.' + (loaded ? '' : ' (Falta el mapa de ' + key + ': queda la cancha actual.)'));
    }
    BR.emit('mode', { mode: key });
    return true;
  }

  /* ── Equipos ───────────────────────────────────────────────────────────── */
  function swapTeams() {
    players().forEach(function (p) {
      if (p.team === 1) room.setPlayerTeam(p.id, 2);
      else if (p.team === 2) room.setPlayerTeam(p.id, 1);
    });
    var u = uniforms[1]; uniforms[1] = uniforms[2]; uniforms[2] = u;
    say('Equipos cambiados de lado.');
  }

  function shuffleTeams() {
    var m = SIZES[sizeKey];
    if (!m.size) { say('En !train no hay equipos para mezclar.'); return; }
    var pool = players().slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    pool.forEach(function (p, idx) {
      var team = idx < m.size ? 1 : idx < m.size * 2 ? 2 : 0;
      room.setPlayerTeam(p.id, team);
    });
    say('Equipos mezclados al azar (' + sizeKey + ').');
  }

  function setKit(team, name) {
    var kit = KITS[fold(name)];
    if (!kit) return false;
    room.setTeamColors(team, kit[0], kit[1], kit[2]);
    uniforms[team] = fold(name);
    return true;
  }

  function resetKit(team) {
    room.setTeamColors(team, 0, 0, []);
    uniforms[team] = null;
  }

  function applyKit(team, name) {
    if (!name) { resetKit(team); return; }
    setKit(team, name);
  }

  function kitCommand(args) {
    var a = args.map(fold);
    if (!a.length) {
      say('Camisetas: !camis rojo|azul <nombre> · !camis swap · !camis reset');
      say('Disponibles: ' + Object.keys(KITS).join(', '));
      return;
    }
    if (a[0] === 'swap') {
      var u1 = uniforms[1]; var u2 = uniforms[2];
      applyKit(1, u2); applyKit(2, u1);
      uniforms[1] = u2; uniforms[2] = u1;
      say('Camisetas intercambiadas.');
      return;
    }
    if (a[0] === 'reset') { resetKit(1); resetKit(2); say('Camisetas restablecidas.'); return; }
    var team = a[0] === 'rojo' || a[0] === 'red' ? 1 : a[0] === 'azul' || a[0] === 'blue' ? 2 : 0;
    if (!team || !a[1]) { say('Uso: !camis rojo|azul <nombre>'); return; }
    if (a[1] === 'reset') { resetKit(team); say('Camiseta del equipo ' + (team === 1 ? 'rojo' : 'azul') + ' restablecida.'); return; }
    if (!setKit(team, a[1])) { say('No conozco esa camiseta. Probá !camis para ver la lista.'); return; }
    say('Equipo ' + (team === 1 ? 'rojo' : 'azul') + ': ' + a[1] + '.');
  }

  /* ── Estadísticas de la sala ───────────────────────────────────────────── */
  function row(name) { return session[name] || (session[name] = { w: 0, l: 0, g: 0, a: 0, o: 0, m: 0 }); }

  function statsText() {
    var names = Object.keys(session);
    if (!names.length) return 'Todavía no hay partidos en esta sala.';
    names.sort(function (x, y) { return session[y].w - session[x].w || session[y].g - session[x].g; });
    return names.slice(0, 8).map(function (n, i) {
      var r = session[n];
      return (i + 1) + '. ' + n + ' — ' + r.w + ' ganados, ' + r.g + ' goles, ' + r.a + ' asist.';
    }).join('\n');
  }

  /* ── Registro de partido (interno) ─────────────────────────────────────── */
  function ensure(p) {
    if (!game || !p) return null;
    var s = game.stats[p.id];
    if (!s) s = game.stats[p.id] = { name: p.name, team: p.team, g: 0, a: 0, o: 0 };
    s.name = p.name;
    if (p.team > 0) s.team = p.team;
    return s;
  }

  function startGame() {
    game = { at: Date.now(), kicks: [], stats: {}, done: false };
    players().forEach(function (p) { if (p.team > 0) ensure(p); });
    if (MODE === 'interno' && RECORD) { try { room.startRecording(); } catch (e) { /* sin grabación */ } }
  }

  function finishGame(scores) {
    if (!game || game.done) return;
    game.done = true;
    var winner = scores.red > scores.blue ? 1 : scores.blue > scores.red ? 2 : 0;
    var onField = {};
    players().forEach(function (p) { if (p.team > 0) { onField[p.id] = p.team; ensure(p); } });
    var merged = {};
    Object.keys(game.stats).forEach(function (id) {
      var s = game.stats[id];
      var endTeam = onField[id] || 0;
      var played = endTeam > 0;
      if (!played && s.g === 0 && s.a === 0 && s.o === 0) return;
      var key = s.name;
      var r = merged[key] || (merged[key] = { n: key, t: (endTeam || s.team) - 1, g: 0, a: 0, o: 0, p: 0, w: 0 });
      r.g += s.g; r.a += s.a; r.o += s.o;
      if (played) { r.p = 1; if (winner && endTeam === winner) r.w = 1; r.t = endTeam - 1; }
    });
    var list = Object.keys(merged).map(function (k) { return merged[k]; });
    list.forEach(function (r) {
      var s = row(r.n);
      s.g += r.g; s.a += r.a; s.o += r.o;
      if (r.p) { s.m++; if (winner) { if (r.w) s.w++; else s.l++; } }
    });
    var result = {
      mode: sizeKey, at: game.at, seconds: Math.round(scores.time || 0),
      red: scores.red, blue: scores.blue, winner: winner === 1 ? 'red' : winner === 2 ? 'blue' : 'draw',
      players: list
    };
    var who = winner === 1 ? 'Rojo' : winner === 2 ? 'Azul' : 'Empate';
    say('Final: Rojo ' + scores.red + ' – ' + scores.blue + ' Azul (' + who + '). !stats para ver la tabla.');
    if (MODE === 'interno') {
      BR.emit('match', result);
      if (RECORD) {
        try {
          var rec = room.stopRecording();
          if (rec && rec.length) BR.emit('replay', { name: sizeKey + '-' + new Date(game.at).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '-' + scores.red + 'a' + scores.blue, data: b64(rec) });
        } catch (e) { /* sin replay */ }
      }
    }
  }

  /* ── Eventos de la sala ────────────────────────────────────────────────── */
  room.onRoomLink = function (url) { BR.emit('link', url); };

  room.onPlayerJoin = function (p) {
    say('Bienvenido ' + p.name + '. Escribí !ayuda para ver los comandos.', p.id);
    if (!players().some(function (x) { return x.admin; }) || (HOST_NICK && fold(p.name) === HOST_NICK)) {
      room.setPlayerAdmin(p.id, true);
    }
    BR.emit('players', { count: players().length });
  };

  room.onPlayerLeave = function () {
    ensureAdmin();
    BR.emit('players', { count: players().length });
  };

  room.onPlayerTeamChange = function (p) { if (game && !game.done) ensure(byId(p.id)); };

  room.onGameStart = function () { startGame(); };

  room.onGameStop = function () {
    if (game && !game.done) {
      game.done = true;
      if (MODE === 'interno' && RECORD) { try { room.stopRecording(); } catch (e) { /* nada */ } }
    }
  };

  room.onPlayerBallKick = function (p) {
    if (!game || game.done) return;
    game.kicks.push({ id: p.id, team: p.team, name: p.name, t: Date.now() });
    if (game.kicks.length > 8) game.kicks.shift();
  };

  room.onTeamGoal = function (team) {
    if (!game || game.done) return;
    var kicks = game.kicks;
    var last = kicks[kicks.length - 1];
    var line = 'Gol del equipo ' + (team === 1 ? 'rojo' : 'azul');
    if (last) {
      var s = ensure(byId(last.id)) || { g: 0, a: 0, o: 0 };
      if (last.team === team) {
        s.g++;
        var prev = kicks[kicks.length - 2];
        line = 'Gol de ' + last.name;
        if (prev && prev.team === team && prev.id !== last.id && Date.now() - prev.t < 12000) {
          var as = ensure(byId(prev.id));
          if (as) as.a++;
          line += ' (asist. ' + prev.name + ')';
        }
      } else {
        s.o++;
        line = 'Gol en contra de ' + last.name;
      }
    }
    game.kicks = [];
    say(line + '.');
  };

  room.onTeamVictory = function (scores) { finishGame(scores); };

  /* ── Comandos ──────────────────────────────────────────────────────────── */
  var HELP = [
    'Comandos de todos: !ayuda · !stats · !admin <clave>',
    'Admin: !x1 !x3 !x4 !x5 !x7 !train · !swap · !mezclar · !camis · !start · !stop · !pausa · !limite N · !tiempo N · !mapa nombre · !spec · !kick nombre'
  ];

  function isAdmin(p) { var cur = byId(p.id); return !!(cur && cur.admin); }

  function command(p, text) {
    var parts = text.slice(1).trim().split(/\s+/);
    var cmd = fold(parts.shift());
    var args = parts;

    if (cmd === 'ayuda' || cmd === 'help' || cmd === 'comandos') { HELP.forEach(function (l) { say(l, p.id); }); return; }
    if (cmd === 'stats' || cmd === 'tabla') { say(statsText(), p.id); return; }
    if (cmd === 'admin') {
      if (ADMIN_KEY && args[0] === ADMIN_KEY) { room.setPlayerAdmin(p.id, true); say(p.name + ' es admin.'); }
      else say('Clave incorrecta.', p.id);
      return;
    }
    if (!isAdmin(p)) { say('Ese comando es sólo para admins.', p.id); return; }

    if (SIZES[cmd]) {
      if (running()) { say('Frená el partido primero (!stop).', p.id); return; }
      applyMode(cmd, true);
      return;
    }
    switch (cmd) {
      case 'swap': case 'cambiar':
        if (running()) { say('Con el partido en juego no. Usá !stop primero.', p.id); return; }
        swapTeams(); return;
      case 'mezclar': case 'random':
        if (running()) { say('Con el partido en juego no. Usá !stop primero.', p.id); return; }
        shuffleTeams(); return;
      case 'camis': case 'camisetas': case 'camiseta': kitCommand(args); return;
      case 'start': case 'iniciar': room.startGame(); return;
      case 'stop': case 'parar': room.stopGame(); return;
      case 'pausa': room.pauseGame(!room.isGamePaused()); return;
      case 'reiniciar': room.stopGame(); setTimeout(function () { room.startGame(); }, 400); return;
      case 'limite': { var n = parseInt(args[0], 10); if (n >= 0 && n <= 30) { room.setScoreLimit(n); say('Límite de goles: ' + (n || 'sin límite') + '.'); } else say('Uso: !limite 7', p.id); return; }
      case 'tiempo': { var t = parseInt(args[0], 10); if (t >= 0 && t <= 60) { room.setTimeLimit(t); say('Tiempo: ' + (t || 'sin límite') + ' min.'); } else say('Uso: !tiempo 7', p.id); return; }
      case 'mapa': {
        if (running()) { say('Frená el partido primero (!stop).', p.id); return; }
        var name = MAPS[fold(args.join(''))];
        if (!name) { say('Mapas: ' + Object.keys(MAPS).join(', '), p.id); return; }
        room.setDefaultStadium(name); say('Cancha: ' + name + '.'); return;
      }
      case 'spec': players().forEach(function (x) { room.setPlayerTeam(x.id, 0); }); say('Todos a espectadores.'); return;
      case 'kick': {
        var target = fold(args.join(' '));
        var victim = players().filter(function (x) { return fold(x.name) === target; })[0];
        if (!victim) { say('No encuentro a ese jugador.', p.id); return; }
        room.kickPlayer(victim.id, 'Expulsado por un admin', false); return;
      }
      default: say('No conozco ese comando. !ayuda', p.id);
    }
  }

  room.onPlayerChat = function (p, text) {
    if (typeof text === 'string' && text.charAt(0) === '!') {
      try { command(p, text); } catch (e) { say('Error en el comando: ' + (e && e.message), p.id); }
      return false;
    }
    return true;
  };

  applyMode(sizeKey, false);
  BR.emit('ready', { mode: MODE, size: sizeKey });
})();
