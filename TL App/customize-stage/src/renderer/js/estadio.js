/* ══════════════════════════════════════════════════════════════════════
   TL App — interfaz «Estadio»
   ══════════════════════════════════════════════════════════════════════
   La cara nueva de la app. Casi todo es CSS (estadio.css, bajo
   `html[data-ui="estadio"]`); este archivo sólo arma lo que el CSS no puede:

   · Salas en tres columnas: tu ficha y el plantel / el tablero / la sala
     elegida. Los botones de la columna derecha (Entrar, Auto-entrar, Crear
     sala, Cambiar nombre, Volver a la última sala) y tu tarjeta de perfil NO
     son copias: son los mismos nodos de siempre, movidos. Siguen con sus
     manejadores, su estado y sus ids, así que hacen exactamente lo mismo.
   · Al volver a la interfaz Clásica cada nodo vuelve a su lugar exacto.

   No corre nada solo: no hay temporizadores ni bucles. Cada parte se repinta
   cuando app.js avisa que cambió algo (salas, selección, club, música).
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const q = (sel, root) => (root || document).querySelector(sel);
  const en = () => typeof isEn === 'function' && isEn();
  const L = (es, eng) => (en() ? eng : es);
  const fmt = (n) => Number(n || 0).toLocaleString('es-AR');

  let mounted = false;
  let built = null;        // nodos creados por Estadio
  let moved = [];          // [{ node, mark }] para devolverlos a su lugar
  let lastMembers = null;  // último plantel recibido

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** Mueve un nodo existente a `host`, dejando una marca para devolverlo. */
  function take(sel, host) {
    const node = q(sel);
    if (!node || !host) return;
    const mark = document.createComment(`estadio:${sel}`);
    node.parentNode.insertBefore(mark, node);
    host.append(node);
    moved.push({ node, mark });
  }

  function giveBack() {
    for (const { node, mark } of moved.reverse()) {
      if (mark.parentNode) { mark.parentNode.insertBefore(node, mark); mark.remove(); }
    }
    moved = [];
  }

  /* ── Armado ─────────────────────────────────────────────────────── */
  function build() {
    const shell = q('#browser .browser__shell');
    if (!shell) return null;

    // Columna izquierda: tu ficha y el plantel.
    const left = el('aside', 'est-col est-left');
    const fichaLbl = el('div', 'est-label');
    const fichaSlot = el('div', 'est-ficha');
    const plLbl = el('div', 'est-label');
    const plTitle = el('span');
    const plCount = el('em', 'est-label__aside');
    plLbl.append(plTitle, plCount);
    const plList = el('div', 'est-plantel');
    left.append(fichaLbl, fichaSlot, plLbl, plList);

    // Cabecera del tablero (columna del medio).
    const head = el('header', 'est-boardhead');
    const titles = el('div', 'est-boardhead__t');
    const eyebrow = el('small', 'est-eyebrow');
    const h1 = el('h1', 'est-boardhead__h');
    titles.append(eyebrow, h1);
    const live = el('div', 'est-live');
    const mk = (cls) => { const d = el('div', `est-live__n ${cls || ''}`); const b = el('b', null, '—'); const s = el('small'); d.append(b, s); live.append(d); return { b, s }; };
    const nPlayers = mk();
    const nRooms = mk();
    const nClub = mk('is-club');
    head.append(titles, live);

    // Columna derecha: la sala elegida.
    const right = el('aside', 'est-col est-right');
    const roomLbl = el('div', 'est-label');
    const match = el('div', 'est-match');
    const mName = el('h3', 'est-match__name');
    const mMeta = el('div', 'est-match__meta');
    const mBig = el('div', 'est-score');
    const mDigits = el('div', 'est-score__n');
    const mCap = el('div', 'est-score__cap');
    mBig.append(mDigits, mCap);
    match.append(mName, mMeta, mBig);
    const goSlot = el('div', 'est-go');
    const duo1 = el('div', 'est-duo');
    const fav = el('button', 'est-btn est-fav');
    fav.type = 'button';
    duo1.append(fav);
    const duo2 = el('div', 'est-duo');
    const lastSlot = el('div', 'est-last');
    const spacer = el('div', 'est-spacer');
    const music = el('button', 'est-music');
    music.type = 'button';
    const mCover = el('span', 'est-music__cv');
    mCover.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17.5V6.2l10-2v11.3"/><circle cx="6.6" cy="17.6" r="2.4"/><circle cx="16.6" cy="15.6" r="2.4"/></svg>';
    const mTxt = el('span', 'est-music__t');
    const mTitle = el('b');
    const mArtist = el('small');
    mTxt.append(mTitle, mArtist);
    const mEq = el('span', 'est-music__eq');
    mEq.innerHTML = '<i></i><i></i><i></i><i></i>';
    music.append(mCover, mTxt, mEq);
    right.append(roomLbl, match, goSlot, duo1, duo2, lastSlot, spacer, music);

    // Eventos de lo que es propio de Estadio.
    fav.addEventListener('click', () => {
      if (typeof state === 'undefined' || !state.selected || typeof toggleFavorite !== 'function') return;
      toggleFavorite(state.selected);
    });
    music.addEventListener('click', () => { if (typeof goView === 'function') goView('musica'); });
    // Doble clic en la tarjeta de la sala: entra, igual que en la fila.
    match.addEventListener('dblclick', () => { const j = q('#actJoin'); if (j && !j.disabled) j.click(); });

    shell.prepend(left);
    const modes = q('#roomModes', shell);
    shell.insertBefore(head, modes || shell.firstChild);
    shell.append(right);

    // Piezas de siempre, a su lugar nuevo.
    take('#profCard', fichaSlot);
    take('#actJoin', goSlot);
    take('#actAutoJoin', duo1);
    take('#actCreate', duo2);
    take('#actChangeNick', duo2);
    take('#lastRoom', lastSlot);

    return {
      left, right, head, fichaLbl, plTitle, plCount, plList, eyebrow, h1,
      nPlayers, nRooms, nClub, roomLbl, mName, mMeta, mDigits, mCap, mBig, match, fav,
      music, mTitle, mArtist
    };
  }

  function mount(on) {
    on = !!on;
    if (on === mounted) return;
    if (on) {
      built = build();
      if (!built) return;
      mounted = true;
      texts();
      board();
      room();
      plantel(lastMembers);
      music();
      // El cartel LED estaba escondido (medía 0): se vuelve a medir para que corra parejo.
      const led = document.getElementById('ledTrack');
      if (led) delete led.dataset.sig;
      try { if (typeof paintLed === 'function') paintLed(); } catch (e) { /* adorno */ }
    } else {
      giveBack();
      if (built) for (const k of ['left', 'right', 'head']) if (built[k]) built[k].remove();
      built = null;
      mounted = false;
    }
    // Los atajos de Personalización ofrecen o no las secciones de la clásica.
    try { if (typeof state !== 'undefined' && typeof NAV_PAGES !== 'undefined' && NAV_PAGES.includes(state.view)) buildPanelNav(); } catch (e) { /* adorno */ }
  }

  /** Textos fijos: se repintan al cambiar de idioma (vía board/room). */
  function texts() {
    if (!built) return;
    built.fichaLbl.textContent = L('Tu ficha', 'Your card');
    built.plTitle.textContent = L('Plantel', 'Squad');
    built.eyebrow.textContent = L('Tablero', 'Board');
    built.h1.textContent = L('Salas en vivo', 'Live rooms');
    built.nPlayers.s.textContent = L('Jugadores', 'Players');
    built.nRooms.s.textContent = L('Salas', 'Rooms');
    built.nClub.s.textContent = L('Del club', 'Club');
    built.roomLbl.textContent = L('Sala elegida', 'Selected room');
  }

  /* ── Tablero: los números de arriba ──────────────────────────────── */
  function board() {
    if (!mounted || !built || typeof state === 'undefined') return;
    texts();
    const r = state.rooms || {};
    built.nPlayers.b.textContent = r.totalRooms ? fmt(r.totalPlayers) : '—';
    built.nRooms.b.textContent = r.totalRooms ? fmt(r.totalRooms) : '—';
    built.nClub.b.textContent = typeof state.clubOnline === 'number' ? String(state.clubOnline) : '—';
  }

  /* ── La sala elegida ─────────────────────────────────────────────── */
  function room() {
    if (!mounted || !built || typeof state === 'undefined') return;
    texts();
    const list = (state.rooms && state.rooms.list) || [];
    const r = state.selected ? list.find((x) => x.token === state.selected) : null;
    built.right.classList.toggle('has-room', !!r);
    built.fav.disabled = !r;
    const isFav = !!(r && typeof isFavorite === 'function' && isFavorite(r.token));
    built.fav.classList.toggle('is-on', isFav);
    built.fav.textContent = isFav ? L('★ Favorita', '★ Favourite') : L('☆ Favorita', '☆ Favourite');
    if (!r) {
      built.mName.textContent = L('Elegí una sala', 'Pick a room');
      built.mMeta.replaceChildren(el('span', null, L('Tocá una fila del tablero. Doble clic entra directo.', 'Click a row on the board. Double-click joins.')));
      built.mDigits.replaceChildren(el('span', 'est-score__dash', '–'));
      built.mCap.replaceChildren();
      built.mBig.className = 'est-score is-idle';
      return;
    }
    built.mName.textContent = r.name || '—';
    built.mName.title = r.name || '';
    const meta = [];
    const pair = (k, v) => { const s = el('span', null, `${k} `); s.append(el('b', null, v)); return s; };
    if (r.country) meta.push(pair(L('País', 'Country'), r.country));
    if (r.distance != null) meta.push(pair(L('Distancia', 'Distance'), `${fmt(r.distance)} km`));
    meta.push(el('span', r.password ? 'is-lock' : null, r.password ? L('🔒 Con clave', '🔒 Password') : L('Abierta', 'Open')));
    built.mMeta.replaceChildren(...meta);

    const full = r.players >= r.maxPlayers;
    const almost = !full && r.maxPlayers > 2 && r.players >= r.maxPlayers - 2 && r.players > 0;
    built.mBig.className = 'est-score' + (full ? ' is-full' : almost ? ' is-almost' : r.players ? ' is-open' : ' is-empty');
    const n = el('span', null, String(r.players));
    const of = el('small', null, `/${r.maxPlayers}`);
    built.mDigits.replaceChildren(n, of);
    const free = Math.max(0, r.maxPlayers - r.players);
    const state1 = full ? L('Llena', 'Full') : almost ? L('Casi llena', 'Almost full') : r.players ? L('Con lugar', 'Has room') : L('Vacía', 'Empty');
    const cap = [el('span', 'est-score__k', state1), el('b', null, full ? L('Sin lugares', 'No spots left') : (free === 1 ? L('Queda 1 lugar', '1 spot left') : L(`Quedan ${free} lugares`, `${free} spots left`)))];
    try {
      const mates = typeof clubRoomMap !== 'undefined' && clubRoomMap.get(String(r.name || '').trim().slice(0, 40).toLowerCase());
      if (mates && mates.length) cap.push(el('span', 'est-score__club', `${L('Del club', 'Club')}: ${mates.join(', ')}`));
    } catch (e) { /* adorno */ }
    built.mCap.replaceChildren(...cap);
  }

  /* ── El plantel ──────────────────────────────────────────────────── */
  function plantel(members) {
    if (Array.isArray(members)) lastMembers = members;
    if (!mounted || !built) return;
    texts();
    let rows = [];
    if (Array.isArray(lastMembers) && lastMembers.length) {
      const sorted = [...lastMembers].sort((a, b) => (b.online - a.online) || String(a.name).localeCompare(String(b.name)));
      rows = sorted.map((m) => ({ name: m.name, online: !!m.online, where: m.online ? (m.room ? m.room : L('en el menú', 'in the menu')) : '', room: m.online && m.room, self: !!m.self, m }));
    } else {
      // Sin datos del club (sin sesión o sin conexión): la planilla de siempre, sin estado.
      rows = Array.from(document.querySelectorAll('.roster__list li')).map((li) => ({ name: li.textContent.trim(), online: false, where: '' }));
    }
    const on = rows.filter((x) => x.online).length;
    built.plCount.textContent = Array.isArray(lastMembers) && lastMembers.length ? L(`${on} en línea`, `${on} online`) : '';
    built.plList.replaceChildren(...rows.map((x, i) => {
      const row = el(x.room && !x.self ? 'button' : 'div', 'est-pl' + (x.online ? ' is-live' : '') + (x.self ? ' is-self' : ''));
      if (row.tagName === 'BUTTON') {
        row.type = 'button';
        row.title = L(`Ir a la sala de ${x.name}`, `Go to ${x.name}'s room`);
        row.addEventListener('click', () => { try { if (typeof goToClubRoom === 'function') goToClubRoom(x.m); } catch (e) { /* nada */ } });
      }
      row.append(el('span', 'est-pl__n', String(i + 1).padStart(2, '0')), el('b', 'est-pl__name', x.self ? `${x.name} ${L('(vos)', '(you)')}` : x.name));
      row.title = row.title || (x.where ? `${x.name} · ${x.where}` : x.name);
      if (x.where) row.append(el('em', 'est-pl__where' + (x.room ? ' is-room' : ''), x.where));
      row.append(el('i', 'est-pl__dot'));
      return row;
    }));
  }

  /* ── Lo que suena ────────────────────────────────────────────────── */
  function music() {
    if (!mounted || !built) return;
    let title = '';
    let artist = '';
    let playing = false;
    try { if (typeof npInfo !== 'undefined' && npInfo) { title = npInfo.title || ''; artist = npInfo.artist || ''; } } catch (e) { /* nada */ }
    try { playing = typeof npPlaying !== 'undefined' && !!npPlaying; } catch (e) { /* nada */ }
    built.music.hidden = !title;
    built.music.classList.toggle('is-playing', playing);
    built.mTitle.textContent = title;
    built.mArtist.textContent = artist || L('Música del menú', 'Menu music');
    built.music.title = L('Abrir Música', 'Open Music');
  }

  window.TLEstadio = { mount, board, room, plantel, music };

  // Si la config ya se aplicó antes de que cargara este archivo, se arma acá.
  if (document.documentElement.dataset.ui === 'estadio') mount(true);
})();
