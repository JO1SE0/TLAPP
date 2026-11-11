/* ═══ Voz: la interfaz ════════════════════════════════════════════════
 *
 * Tres piezas, todas armadas una sola vez y después sólo con clases que cambian:
 *   · el botón de la barra de arriba (con las caras de quién está),
 *   · el panel que se abre desde ese botón,
 *   · la lista chiquita sobre la cancha (sólo en partida).
 *
 * Sobre la cancha no hay transiciones, sombras grandes ni desenfoque: se toca
 * el DOM sólo cuando alguien empieza o deja de hablar.
 */
(function () {
  'use strict';
  if (!window.tvm || !window.tvm.voice || !window.TLVoiceEngine) return;

  const V = window.tvm.voice;
  const en = () => (window.i18n && window.i18n.language === 'en');
  const T = (es, eng) => (en() ? eng : es);

  const ICON = {
    headset: '<path d="M4 15.5v-3a8 8 0 0 1 16 0v3"/><path d="M4 15.5a2 2 0 0 1 2-2h.8a1.2 1.2 0 0 1 1.2 1.2v3.6a1.2 1.2 0 0 1-1.2 1.2H6a2 2 0 0 1-2-2zM20 15.5a2 2 0 0 0-2-2h-.8a1.2 1.2 0 0 0-1.2 1.2v3.6a1.2 1.2 0 0 0 1.2 1.2h.8a2 2 0 0 0 2-2z"/>',
    headsetOff: '<path d="M4 15.5v-3a8 8 0 0 1 13.4-5.9M20 12.5v3"/><path d="M4 15.5a2 2 0 0 1 2-2h.8a1.2 1.2 0 0 1 1.2 1.2v3.6a1.2 1.2 0 0 1-1.2 1.2H6a2 2 0 0 1-2-2zM16 15v3.3a1.2 1.2 0 0 0 1.2 1.2h.8a2 2 0 0 0 2-2"/><path d="M3.5 3.5l17 17"/>',
    mic: '<rect x="9" y="3.2" width="6" height="11" rx="3"/><path d="M5.6 11a6.4 6.4 0 0 0 12.8 0M12 17.4v3.4M8.8 20.8h6.4"/>',
    micOff: '<path d="M15 10.4V6.2a3 3 0 0 0-5.8-1.1M9 9v2.2a3 3 0 0 0 4.6 2.5"/><path d="M5.6 11a6.4 6.4 0 0 0 10.2 5.1M18.4 11a6.4 6.4 0 0 1-.5 2.5M12 17.4v3.4M8.8 20.8h6.4M3.5 3.5l17 17"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14.1 2.5h-4.2l-.4 2.5A7.5 7.5 0 0 0 6.9 6.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4.2l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.3.9 2-3.4z"/>',
    leave: '<path d="M3 13.6c5-4.8 13-4.8 18 0l-2.4 2.6-3.6-1.4v-2.5a10.4 10.4 0 0 0-6 0v2.5l-3.6 1.4z"/>',
    club: '<path d="M12 3l7.5 3v5.3c0 4.6-3.2 8.2-7.5 9.7-4.3-1.5-7.5-5.1-7.5-9.7V6z"/>',
    room: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M12 5.5v13M3.5 10h3v4h-3M20.5 10h-3v4h3"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    wave: '<path d="M5 10v4M9 7v10M13 9v6M17 6v12M21 10v4"/>'
  };
  const svg = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

  /* Un color por persona, siempre el mismo (sale de su pid). */
  const HUES = [8, 28, 46, 145, 168, 195, 215, 250, 280, 320];
  function colorOf(pid) {
    let h = 0;
    for (const c of String(pid || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `hsl(${HUES[h % HUES.length]} 62% 52%)`;
  }
  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2);
    return s.toUpperCase();
  }
  function keyLabel(code) {
    const c = String(code || '');
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit\d$/.test(c)) return c.slice(5);
    const map = { Space: T('Espacio', 'Space'), ShiftLeft: 'Shift', ShiftRight: 'Shift D', ControlLeft: 'Ctrl', ControlRight: 'Ctrl D', AltLeft: 'Alt', AltRight: 'Alt Gr', CapsLock: 'Bloq Mayús', Backquote: '`', Tab: 'Tab', Mouse4: T('Mouse 4', 'Mouse 4'), Mouse5: T('Mouse 5', 'Mouse 5') };
    return map[c] || c.replace(/^(Numpad)/, 'Num ');
  }

  const cfg = () => (typeof state !== 'undefined' && state && state.config && state.config.voice) || {};
  const save = (patch) => { try { return patchConfig({ voice: patch }); } catch (e) { return null; } };

  let snap = { joined: false, joining: false, members: [], muted: false, deafened: false, sending: false };
  let target = 'club';          // a qué canal apunta el panel cuando no estás en ninguno
  let inRoom = false;
  let peekList = { club: [], room: [] };
  let netState = { state: 'off', error: '' };

  const engine = window.TLVoiceEngine.createEngine({
    join: (w) => V.join(w),
    leave: () => V.leave(),
    signal: (to, d) => V.signal(to, d),
    mute: (on) => V.mute(on).catch(() => {}),
    onMembers: (cb) => V.onMembers(cb),
    onSignal: (cb) => V.onSignal(cb),
    onStatus: (cb) => V.onStatus((st) => { netState = st || netState; cb(st); paintAll(); })
  }, {
    iceServers: [],
    settings: cfg(),
    onState: (s) => { snap = s; paintAll(); }
  });
  V.config().then((c) => {
    if (c && c.ice && c.ice.length) engine.setIce(c.ice); // los del club (TURN) van primero
    inRoom = !!(c && c.inRoom);
    paintAll();
  }).catch(() => {});
  V.onPtt((down) => engine.setPtt(down));

  /* ── botón de la barra ── */
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'voiceBtn';
  btn.className = 'vbtn';
  btn.innerHTML = `<span class="vbtn__ico">${svg('headset')}</span><span class="vbtn__faces"></span><span class="vbtn__label"></span><span class="vbtn__mic">${svg('mic')}</span>`;
  const audio = document.getElementById('audio');
  if (audio && audio.parentNode) audio.parentNode.insertBefore(btn, audio);
  const faces = btn.querySelector('.vbtn__faces');
  const blabel = btn.querySelector('.vbtn__label');
  const bmic = btn.querySelector('.vbtn__mic');

  /* ── panel ── */
  const pop = document.createElement('section');
  pop.id = 'voicePop';
  pop.className = 'vpop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.innerHTML = `
    <header class="vpop__head">
      <div class="vpop__title"><b></b><small></small></div>
      <span class="vpop__net"><i></i><span></span></span>
      <button type="button" class="vpop__x" aria-label="Cerrar">${svg('close')}</button>
    </header>
    <div class="vpop__seg" role="tablist">
      <button type="button" data-ch="club">${svg('club')}<span></span><em></em></button>
      <button type="button" data-ch="room">${svg('room')}<span></span><em></em></button>
    </div>
    <div class="vpop__alert" hidden></div>
    <div class="vpop__empty">
      <div class="vpop__hero">${svg('headset')}</div>
      <p class="vpop__lead"></p>
      <div class="vpop__peek"></div>
      <button type="button" class="vpop__join"></button>
      <small class="vpop__fine"></small>
    </div>
    <ul class="vpop__list" hidden></ul>
    <footer class="vpop__foot" hidden>
      <button type="button" class="vctl" data-act="mic"></button>
      <button type="button" class="vctl" data-act="deaf"></button>
      <div class="vpop__ptt"><b></b><small></small></div>
      <button type="button" class="vctl" data-act="gear">${svg('gear')}</button>
      <button type="button" class="vctl vctl--leave" data-act="leave">${svg('leave')}</button>
    </footer>`;
  document.body.append(pop);
  const $p = (s) => pop.querySelector(s);
  const list = $p('.vpop__list');

  /* ── sobre la cancha ── */
  const hud = document.createElement('div');
  hud.id = 'voiceHud';
  hud.className = 'vhud';
  hud.setAttribute('aria-hidden', 'true');
  hud.innerHTML = '<div class="vhud__list"></div><div class="vhud__me"><span class="vhud__dot"></span><span class="vhud__txt"></span></div>';
  (document.getElementById('stage') || document.body).append(hud);
  const hudList = hud.querySelector('.vhud__list');
  const hudMe = hud.querySelector('.vhud__me');

  /* ── invitación ── */
  const inv = document.createElement('div');
  inv.className = 'vinvite';
  inv.hidden = true;
  inv.innerHTML = `<div class="vinvite__faces"></div><div class="vinvite__txt"><b></b><small></small></div><button type="button" class="vinvite__go"></button><button type="button" class="vinvite__x" aria-label="Cerrar">${svg('close')}</button>`;
  document.body.append(inv);
  let invTimer = 0;

  function faceEl(m, size) {
    const s = document.createElement('span');
    s.className = 'vface';
    if (size) s.style.setProperty('--vs', `${size}px`);
    s.style.setProperty('--vc', colorOf(m.pid));
    s.textContent = initials(m.name);
    return s;
  }

  function errText(code) {
    switch (code) {
      case 'reglas': return T('La base del club todavía no acepta la voz: falta habilitar la carpeta «voice» en las reglas de Firebase.', 'The club database does not accept voice yet: the «voice» folder must be allowed in the Firebase rules.');
      case 'sin-clave': return T('Para usar la voz tenés que entrar con tu clave del club.', 'You need to sign in with your club key to use voice.');
      case 'sin-base': return T('Todavía no se bajó la dirección del club. Probá en unos segundos.', 'The club address has not loaded yet. Try again in a few seconds.');
      case 'sin-permiso': return T('El admin todavía no te habilitó la voz.', 'The admin has not enabled voice for you yet.');
      case 'sin-sala': return T('Entrá a una sala para usar su canal de voz.', 'Join a room to use its voice channel.');
      case 'red': return T('Sin conexión con la base del club. Se reintenta solo.', 'No connection to the club database. Retrying.');
      case 'permiso': return T('Windows no deja usar el micrófono. Revisá Configuración → Privacidad → Micrófono. Mientras tanto escuchás igual.', 'Windows blocks the microphone. Check Settings → Privacy → Microphone. You can still listen.');
      case 'sin-mic': return T('No se encontró un micrófono. Entraste para escuchar.', 'No microphone found. You joined to listen only.');
      default: return code ? T('No se pudo conectar a la voz.', 'Could not connect to voice.') : '';
    }
  }

  function statusLine(m) {
    if (m.self) return snap.sending ? T('Hablando', 'Talking') : (m.muted ? T('Micrófono apagado', 'Mic off') : T('Vos', 'You'));
    if (m.speaking) return T('Hablando', 'Talking');
    if (m.state === 'connecting' || m.state === 'waiting') return T('Conectando…', 'Connecting…');
    if (m.state === 'reconnecting') return T('Reconectando…', 'Reconnecting…');
    if (m.state === 'failed') return T('Sin conexión directa', 'No direct connection');
    if (m.muted) return T('Silenciado', 'Muted');
    return T('Conectado', 'Connected');
  }

  /* Filas: se arman una vez por persona y después sólo cambian clases y textos. */
  const rows = new Map();
  function rowFor(m) {
    let r = rows.get(m.pid);
    if (r) return r;
    const li = document.createElement('li');
    li.className = 'vrow';
    li.innerHTML = `<span class="vrow__av"></span><span class="vrow__txt"><b></b><small></small></span><span class="vrow__bars"><i></i><i></i><i></i></span><span class="vrow__muted">${svg('micOff')}</span>
      <div class="vrow__vol"><span>${svg('wave')}</span><input type="range" min="0" max="1" step="0.01"><em></em></div>`;
    li.querySelector('.vrow__av').append(faceEl(m, 36));
    const range = li.querySelector('input');
    const pct = li.querySelector('.vrow__vol em');
    range.addEventListener('input', () => {
      pct.textContent = `${Math.round(range.value * 100)}%`;
      if (typeof syncRangeFill === 'function') syncRangeFill(range);
      const peers = Object.assign({}, cfg().peers, { [m.pid]: Number(range.value) });
      engine.setSettings({ peers });
    });
    range.addEventListener('change', () => save({ peers: { [m.pid]: Number(range.value) } }));
    r = { li, name: li.querySelector('b'), sub: li.querySelector('small'), range, pct };
    rows.set(m.pid, r);
    return r;
  }

  function paintButton() {
    const on = snap.joined;
    btn.classList.toggle('is-on', on);
    btn.classList.toggle('is-joining', !!snap.joining);
    btn.classList.toggle('is-sending', !!snap.sending);
    btn.classList.toggle('is-muted', !!snap.muted);
    btn.classList.toggle('is-open', !pop.hidden);
    btn.title = on ? T('Voz: tocá para ver quién está', 'Voice: click to see who is here') : T('Voz con el club', 'Voice with the club');
    bmic.innerHTML = svg(snap.muted ? 'micOff' : 'mic');
    if (!on) {
      faces.replaceChildren();
      blabel.textContent = snap.joining ? T('Conectando…', 'Connecting…') : T('Voz', 'Voice');
      return;
    }
    const others = snap.members.filter((m) => !m.self);
    const shown = (others.length ? others : snap.members).slice(0, 3);
    const sig = shown.map((m) => `${m.pid}${m.speaking ? 1 : 0}`).join();
    if (faces.dataset.sig !== sig) {
      faces.dataset.sig = sig;
      faces.replaceChildren(...shown.map((m) => { const f = faceEl(m, 22); f.classList.toggle('is-talk', !!m.speaking); return f; }));
    }
    blabel.textContent = String(snap.members.length);
  }

  function paintPop() {
    if (pop.hidden) return;
    const joined = snap.joined;
    const ch = joined ? (snap.want || 'club') : target;
    $p('.vpop__title b').textContent = T('Voz', 'Voice');
    $p('.vpop__title small').textContent = ch === 'room' ? T('Canal de esta sala', 'This room\'s channel') : T('Canal del club', 'Club channel');
    const net = $p('.vpop__net');
    const failing = joined && snap.members.some((m) => m.state === 'failed');
    net.dataset.st = !joined ? 'off' : (snap.error ? 'bad' : (failing || snap.members.some((m) => !m.self && m.state !== 'connected') ? 'mid' : 'ok'));
    net.querySelector('span').textContent = !joined ? T('Desconectado', 'Off') : (snap.error ? T('Con problemas', 'Issues') : (net.dataset.st === 'mid' ? T('Conectando', 'Connecting') : T('Conectado', 'Connected')));

    for (const b of pop.querySelectorAll('.vpop__seg button')) {
      const c = b.dataset.ch;
      b.classList.toggle('is-on', c === ch);
      b.disabled = c === 'room' && !inRoom;
      b.querySelector('span').textContent = c === 'room' ? T('Sala', 'Room') : 'Club';
      const n = joined && c === ch ? snap.members.length : (peekList[c] || []).length;
      b.querySelector('em').textContent = n ? String(n) : '';
    }

    const alert = $p('.vpop__alert');
    const msg = errText(snap.error || snap.micError || (netState.state === 'error' ? netState.error : ''));
    alert.hidden = !msg;
    alert.textContent = msg;
    alert.classList.toggle('is-soft', !snap.error && !!snap.micError);

    $p('.vpop__empty').hidden = joined;
    list.hidden = !joined;
    $p('.vpop__foot').hidden = !joined;

    if (!joined) {
      $p('.vpop__lead').textContent = ch === 'room'
        ? T('Hablá con los del club que están en esta misma sala.', 'Talk with club members in this same room.')
        : T('Un canal abierto para todo el club, estés en el menú o jugando.', 'An open channel for the whole club, in the menu or in game.');
      const pk = (peekList[ch] || []).filter((m) => !m.self);
      const peek = $p('.vpop__peek');
      peek.replaceChildren();
      if (pk.length) {
        const fs = document.createElement('span');
        fs.className = 'vpop__peekfaces';
        fs.append(...pk.slice(0, 5).map((m) => faceEl(m, 26)));
        const tx = document.createElement('span');
        tx.textContent = pk.length === 1 ? T(`${pk[0].name} está adentro`, `${pk[0].name} is in`) : T(`${pk.length} personas adentro`, `${pk.length} people in`);
        peek.append(fs, tx);
      } else {
        const tx = document.createElement('span');
        tx.className = 'vpop__nobody';
        tx.textContent = T('No hay nadie todavía. Entrá y avisales.', 'Nobody yet. Join and let them know.');
        peek.append(tx);
      }
      const jb = $p('.vpop__join');
      jb.disabled = !!snap.joining || (ch === 'room' && !inRoom);
      jb.textContent = snap.joining ? T('Conectando…', 'Connecting…') : (ch === 'room' ? T('Entrar a la voz de la sala', 'Join room voice') : T('Entrar a la voz del club', 'Join club voice'));
      $p('.vpop__fine').textContent = T('El audio va directo entre las PCs. No se graba nada.', 'Audio goes straight between PCs. Nothing is recorded.');
      return;
    }

    // Lista
    const keep = new Set();
    let idx = 0;
    for (const m of snap.members) {
      keep.add(m.pid);
      const r = rowFor(m);
      if (list.children[idx] !== r.li) list.insertBefore(r.li, list.children[idx] || null);
      idx++;
      r.li.classList.toggle('is-self', !!m.self);
      r.li.classList.toggle('is-talk', !!m.speaking);
      r.li.classList.toggle('is-muted', !!m.muted);
      r.li.dataset.st = m.state;
      r.name.textContent = m.name + (m.self ? T(' (vos)', ' (you)') : '');
      r.sub.textContent = statusLine(m);
      if (!m.self && document.activeElement !== r.range) {
        if (r.range.value !== String(m.volume)) {
          r.range.value = String(m.volume);
          r.pct.textContent = `${Math.round(m.volume * 100)}%`;
          r.needFill = true;
        }
        if (r.needFill && typeof syncRangeFill === 'function') { r.needFill = false; syncRangeFill(r.range); }
      }
    }
    for (const [pid, r] of rows) if (!keep.has(pid)) { r.li.remove(); rows.delete(pid); }

    const mic = pop.querySelector('[data-act="mic"]');
    mic.innerHTML = svg(snap.muted ? 'micOff' : 'mic');
    mic.classList.toggle('is-off', !!snap.muted);
    mic.title = snap.muted ? T('Prender micrófono', 'Unmute') : T('Apagar micrófono', 'Mute');
    const deaf = pop.querySelector('[data-act="deaf"]');
    deaf.innerHTML = svg(snap.deafened ? 'headsetOff' : 'headset');
    deaf.classList.toggle('is-off', !!snap.deafened);
    deaf.title = snap.deafened ? T('Volver a escuchar', 'Undeafen') : T('No escuchar a nadie', 'Deafen');
    pop.querySelector('[data-act="gear"]').title = T('Ajustes de voz', 'Voice settings');
    pop.querySelector('[data-act="leave"]').title = T('Salir de la voz', 'Leave voice');

    const ptt = $p('.vpop__ptt');
    const v = cfg();
    ptt.classList.toggle('is-live', !!snap.sending);
    if (snap.muted) {
      ptt.querySelector('b').textContent = T('Micrófono apagado', 'Mic off');
      ptt.querySelector('small').textContent = T('Nadie te escucha', 'Nobody hears you');
    } else if (v.mode === 'open') {
      ptt.querySelector('b').textContent = snap.sending ? T('Te están escuchando', 'Transmitting') : T('Voz abierta', 'Open mic');
      ptt.querySelector('small').textContent = T('Se abre sola cuando hablás', 'Opens when you talk');
    } else {
      ptt.querySelector('b').innerHTML = '';
      const k = document.createElement('kbd');
      k.textContent = keyLabel(v.pttKey || 'KeyV');
      if (snap.sending) ptt.querySelector('b').append(document.createTextNode(T('Transmitiendo ', 'Transmitting ')), k);
      else ptt.querySelector('b').append(document.createTextNode(T('Mantené ', 'Hold ')), k);
      ptt.querySelector('small').textContent = snap.sending ? T('Soltá para cortar', 'Release to stop') : T('para hablar', 'to talk');
    }
  }

  function paintHud() {
    const mode = cfg().overlay || 'all';
    const on = snap.joined && mode !== 'off';
    hud.classList.toggle('is-on', on);
    if (!on) { if (hudList.childElementCount) hudList.replaceChildren(); return; }
    const others = snap.members.filter((m) => !m.self && (mode === 'all' || m.speaking));
    const sig = others.map((m) => `${m.pid}:${m.speaking ? 1 : 0}:${m.muted ? 1 : 0}`).join('|') + `|${mode}`;
    if (hudList.dataset.sig !== sig) {
      hudList.dataset.sig = sig;
      hudList.replaceChildren(...others.map((m) => {
        const d = document.createElement('div');
        d.className = `vhud__p${m.speaking ? ' is-talk' : ''}${m.muted ? ' is-muted' : ''}`;
        d.append(faceEl(m, 24));
        const n = document.createElement('span');
        n.className = 'vhud__n';
        n.textContent = m.muted ? `${m.name} · ${T('silenciado', 'muted')}` : m.name;
        d.append(n);
        return d;
      }));
    }
    const sending = !!snap.sending;
    const meSig = `${sending ? 1 : 0}${snap.muted ? 1 : 0}${cfg().mode}`;
    if (hudMe.dataset.sig !== meSig) {
      hudMe.dataset.sig = meSig;
      hudMe.classList.toggle('is-live', sending);
      hudMe.classList.toggle('is-muted', !!snap.muted);
      hudMe.querySelector('.vhud__txt').textContent = snap.muted ? T('Micrófono apagado', 'Mic off') : (sending ? T('Hablando', 'Talking') : (cfg().mode === 'open' ? T('Voz abierta', 'Open mic') : `${keyLabel(cfg().pttKey || 'KeyV')} ${T('para hablar', 'to talk')}`));
    }
  }

  function paintAll() { paintButton(); paintPop(); paintHud(); paintSettingsLive(); }

  /* ── abrir / cerrar el panel ── */
  function place() {
    const r = btn.getBoundingClientRect();
    const w = 360;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w));
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.round(r.bottom + 10)}px`;
  }
  async function refreshPeek() {
    try {
      const [club, room] = await Promise.all([V.peek('club').catch(() => []), inRoom ? V.peek('room').catch(() => []) : Promise.resolve([])]);
      peekList = { club: club || [], room: room || [] };
      paintPop();
    } catch (e) { /* nada */ }
  }
  function openPop() {
    pop.hidden = false;
    place();
    V.config().then((c) => { inRoom = !!(c && c.inRoom); if (!snap.joined) target = inRoom && target === 'room' ? 'room' : target; paintAll(); }).catch(() => {});
    if (!snap.joined) refreshPeek();
    paintAll();
  }
  function closePop() { pop.hidden = true; paintButton(); }
  btn.addEventListener('click', () => (pop.hidden ? openPop() : closePop()));
  $p('.vpop__x').addEventListener('click', closePop);
  document.addEventListener('pointerdown', (e) => {
    if (pop.hidden) return;
    if (pop.contains(e.target) || btn.contains(e.target)) return;
    closePop();
  }, true);
  window.addEventListener('resize', () => { if (!pop.hidden) place(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) closePop(); });

  for (const b of pop.querySelectorAll('.vpop__seg button')) {
    b.addEventListener('click', () => {
      const c = b.dataset.ch;
      if (snap.joined) { if ((snap.want || 'club') !== c) engine.join(c); }
      else { target = c; paintPop(); }
    });
  }
  $p('.vpop__join').addEventListener('click', () => engine.join(target));
  pop.querySelector('[data-act="mic"]').addEventListener('click', () => engine.setMuted(!snap.muted));
  pop.querySelector('[data-act="deaf"]').addEventListener('click', () => engine.setDeafened(!snap.deafened));
  pop.querySelector('[data-act="leave"]').addEventListener('click', () => engine.leave());
  pop.querySelector('[data-act="gear"]').addEventListener('click', () => {
    closePop();
    try { goToSection('ajustes', 'voz'); } catch (e) { /* nada */ }
  });

  /* ── apretar para hablar con el foco en el menú ── */
  let menuPtt = false;
  const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  document.addEventListener('keydown', (e) => {
    const v = cfg();
    if (!snap.joined || v.mode === 'open' || e.code !== (v.pttKey || 'KeyV') || e.repeat || typing(e.target) || capturing) return;
    menuPtt = true;
    engine.setPtt(true);
  }, true);
  document.addEventListener('keyup', (e) => {
    if (!menuPtt || e.code !== (cfg().pttKey || 'KeyV')) return;
    menuPtt = false;
    engine.setPtt(false);
  }, true);
  window.addEventListener('blur', () => { if (menuPtt) { menuPtt = false; engine.setPtt(false); } });

  /* ── invitación al entrar a una sala con gente del club en la voz ── */
  V.onInvite((data) => {
    if (snap.joined || !data || !data.count) return;
    inRoom = true;
    const names = data.names || [];
    inv.querySelector('.vinvite__faces').replaceChildren(...names.slice(0, 3).map((n, i) => faceEl({ pid: n + i, name: n }, 30)));
    inv.querySelector('b').textContent = names.length === 1
      ? T(`${names[0]} está en la voz de esta sala`, `${names[0]} is in this room's voice`)
      : T(`${names.slice(0, 2).join(' y ')}${data.count > 2 ? ` y ${data.count - 2} más` : ''} están en la voz de esta sala`, `${names.slice(0, 2).join(' and ')}${data.count > 2 ? ` and ${data.count - 2} more` : ''} are in this room's voice`);
    inv.querySelector('small').textContent = T('¿Te sumás?', 'Join them?');
    inv.querySelector('.vinvite__go').textContent = T('Unirme', 'Join');
    inv.hidden = false;
    clearTimeout(invTimer);
    invTimer = setTimeout(() => { inv.hidden = true; }, 14000);
  });
  inv.querySelector('.vinvite__go').addEventListener('click', () => { inv.hidden = true; engine.join('room'); });
  inv.querySelector('.vinvite__x').addEventListener('click', () => { inv.hidden = true; });

  /* ── Configuración → Sonido → Voz ── */
  let capturing = false;
  let meterRaf = 0;
  let meterEl = null;
  function renderSettings() {
    const host = document.getElementById('voiceSettings');
    if (!host || typeof settingRow !== 'function') return;
    const v = cfg();
    host.replaceChildren();

    // Modo
    const modes = document.createElement('div');
    modes.className = 'chips';
    for (const [id, es, eng] of [['ptt', 'Apretar para hablar', 'Push to talk'], ['open', 'Voz abierta', 'Open mic']]) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = `chip${(v.mode || 'ptt') === id ? ' is-active' : ''}`;
      c.textContent = T(es, eng);
      c.addEventListener('click', async () => { await save({ mode: id }); renderSettings(); });
      modes.append(c);
    }
    host.append(settingRow({ label: T('Cómo hablás', 'How you talk'), description: T('Con «apretar para hablar» sólo se te escucha mientras tenés la tecla apretada.', 'With push to talk you are only heard while holding the key.'), control: modes }));

    if ((v.mode || 'ptt') === 'ptt') {
      const k = document.createElement('button');
      k.type = 'button';
      k.className = 'btn btn--ghost btn--sm vkeybtn';
      k.textContent = keyLabel(v.pttKey || 'KeyV');
      k.addEventListener('click', () => {
        if (capturing) return;
        capturing = true;
        k.classList.add('is-wait');
        k.textContent = T('Apretá una tecla…', 'Press a key…');
        const done = (code) => {
          capturing = false;
          document.removeEventListener('keydown', onKey, true);
          k.classList.remove('is-wait');
          if (code) save({ pttKey: code }).then(renderSettings);
          else k.textContent = keyLabel(cfg().pttKey || 'KeyV');
        };
        const onKey = (e) => {
          e.preventDefault(); e.stopPropagation();
          if (e.code === 'Escape') return done(null);
          if (['Enter', 'NumpadEnter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return; // las del juego no
          done(e.code);
        };
        document.addEventListener('keydown', onKey, true);
      });
      host.append(settingRow({ label: T('Tecla para hablar', 'Talk key'), description: T('Anda en el menú y en la cancha. Escribiendo en el chat no cuenta.', 'Works in the menu and in game. Not while typing in chat.'), control: k }));
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'vsens';
      const r = document.createElement('input');
      r.type = 'range'; r.min = '0'; r.max = '1'; r.step = '0.01';
      r.value = String(v.sensitivity ?? 0.5);
      const meter = document.createElement('span');
      meter.className = 'vmeter';
      meter.innerHTML = '<i></i><b></b>';
      r.addEventListener('input', () => { engine.setSettings({ sensitivity: Number(r.value) }); positionThreshold(meter, Number(r.value)); if (typeof syncRangeFill === 'function') syncRangeFill(r); });
      r.addEventListener('change', () => save({ sensitivity: Number(r.value) }));
      wrap.append(meter, r);
      positionThreshold(meter, Number(r.value));
      meterEl = meter;
      host.append(settingRow({ label: T('Sensibilidad', 'Sensitivity'), description: T('La barra muestra tu voz mientras estás en un canal; la marca es desde dónde se abre.', 'The bar shows your voice while in a channel; the mark is where it opens.'), control: wrap }));
      if (typeof syncRangeFill === 'function') queueMicrotask(() => syncRangeFill(r));
    }

    // Micrófono
    const sel = document.createElement('select');
    sel.innerHTML = `<option value="">${T('El de Windows', 'System default')}</option>`;
    sel.value = v.device || '';
    navigator.mediaDevices && navigator.mediaDevices.enumerateDevices && navigator.mediaDevices.enumerateDevices().then((devs) => {
      for (const d of devs.filter((x) => x.kind === 'audioinput' && x.deviceId && x.deviceId !== 'default' && x.deviceId !== 'communications')) {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || T('Micrófono', 'Microphone');
        sel.append(o);
      }
      sel.value = v.device || '';
    }).catch(() => {});
    sel.addEventListener('change', async () => { await save({ device: sel.value }); engine.setSettings({ device: sel.value }); });
    host.append(settingRow({ label: T('Micrófono', 'Microphone'), control: sel }));

    // Volumen
    if (typeof rangeRow === 'function') {
      host.append(rangeRow({
        label: T('Volumen de las voces', 'Voice volume'), min: 0, max: 1, step: 0.01, value: v.volume ?? 1,
        format: (x) => `${Math.round(x * 100)}%`,
        onInput: (x) => engine.setSettings({ volume: x }),
        onChange: (x) => save({ volume: x })
      }));
    }

    // Ruido
    if (typeof buildSwitches === 'function') {
      const sw = document.createElement('div');
      sw.className = 'rows__flat';
      buildSwitches(sw, [{
        key: 'noise',
        label: T('Filtrar ruido de fondo', 'Filter background noise'),
        description: T('Teclado, ventilador y eco. Recomendado.', 'Keyboard, fan and echo. Recommended.'),
        value: () => cfg().noise !== false
      }], async (_item, value) => { await save({ noise: value }); engine.setSettings({ noise: value }); });
      host.append(sw);
    }

    // En la cancha
    const ov = document.createElement('div');
    ov.className = 'chips';
    for (const [id, es, eng] of [['all', 'Todos', 'Everyone'], ['speaking', 'Sólo quien habla', 'Only who talks'], ['off', 'Nada', 'Nothing']]) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = `chip${(v.overlay || 'all') === id ? ' is-active' : ''}`;
      c.textContent = T(es, eng);
      c.addEventListener('click', async () => { await save({ overlay: id }); renderSettings(); paintHud(); });
      ov.append(c);
    }
    host.append(settingRow({ label: T('Sobre la cancha', 'On the pitch'), description: T('Una lista chiquita arriba a la izquierda. No usa efectos: no cuesta FPS.', 'A small list at the top left. No effects: costs no FPS.'), control: ov }));
  }
  function positionThreshold(meter, sens) {
    // Mismo umbral que el motor, en escala de la barra (0 a 0.12 de nivel).
    const thr = 0.06 * Math.pow(0.1, Math.max(0, Math.min(1, sens)));
    meter.style.setProperty('--thr', `${Math.min(100, (thr / 0.12) * 100)}%`);
  }
  // La barra del micrófono se mueve sólo con la sección a la vista y estando en un canal.
  function paintSettingsLive() {
    const visible = meterEl && meterEl.isConnected && meterEl.offsetParent && snap.joined;
    if (visible && !meterRaf) {
      const loop = () => {
        if (!meterEl || !meterEl.isConnected || !meterEl.offsetParent || !snap.joined) { meterRaf = 0; return; }
        meterEl.style.setProperty('--lvl', String(Math.min(1, engine.level() / 0.12).toFixed(3)));
        meterRaf = setTimeout(loop, 100);
      };
      meterRaf = setTimeout(loop, 100);
    }
  }

  window.TLVoiceUI = {
    onConfig() { engine.setSettings(cfg()); renderSettings(); paintAll(); },
    render: renderSettings,
    engine,
    open: openPop
  };
  renderSettings();
  paintAll();
})();
