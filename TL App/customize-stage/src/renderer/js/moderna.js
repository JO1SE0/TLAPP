/* ══════════════════════════════════════════════════════════════════════
   TL App — interfaz «Moderna» (azul y dorado)
   ══════════════════════════════════════════════════════════════════════
   Casi todo es CSS (moderna.css, bajo `html[data-ui="moderna"]`). Este
   archivo sólo arma lo que el CSS no puede: la columna derecha de Salas.

   · Sala elegida: nombre, datos, cuántos hay, y los botones Entrar y
     Auto-entrar. Esos botones NO son copias: son los mismos nodos de la
     barra de la lista, movidos. Conservan sus manejadores, su estado y sus
     ids, así que hacen exactamente lo mismo.
   · Tu tarjeta de perfil (la de siempre, movida) con tus números.
   · El club en línea.
   Al volver a la interfaz Clásica cada nodo vuelve a su lugar exacto.

   No corre nada solo: no hay temporizadores ni bucles. Cada parte se
   repinta cuando app.js avisa que cambió algo (salas, selección, club).
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const q = (sel, root) => (root || document).querySelector(sel);
  const en = () => typeof isEn === 'function' && isEn();
  const L = (es, eng) => (en() ? eng : es);
  const fmt = (n) => Number(n || 0).toLocaleString('es-AR');

  let mounted = false;
  let built = null;
  let moved = [];
  let lastMembers = null;

  const SVG = {
    star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
    pin: '<path d="M12 21s-6-5.4-6-10a6 6 0 0 1 12 0c0 4.6-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'
  };
  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.classList.add('md-ico');
    s.innerHTML = SVG[name];
    return s;
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  /** Mueve un nodo existente a `host`, dejando una marca para devolverlo. */
  function take(sel, host, before) {
    const node = q(sel);
    if (!node || !host) return;
    const mark = document.createComment(`moderna:${sel}`);
    node.parentNode.insertBefore(mark, node);
    if (before) host.insertBefore(node, before); else host.append(node);
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

    // Cabecera de la lista: «Salas» y cuánta gente hay.
    const head = el('header', 'md-head');
    const h1 = el('h1', 'md-head__t');
    const sub = el('p', 'md-head__s');
    head.append(h1, sub);
    shell.prepend(head);

    // Columna derecha.
    const side = el('aside', 'md-side');
    const room = el('section', 'md-room');
    const rKick = el('small', 'md-room__k');
    const rName = el('h2', 'md-room__n');
    const rMeta = el('p', 'md-room__m');
    const rBig = el('div', 'md-room__big');
    const rGo = el('div', 'md-room__go');
    const rDuo = el('div', 'md-room__duo');
    const fav = el('button', 'md-btn md-fav');
    fav.type = 'button';
    rDuo.append(fav);
    room.append(rKick, rName, rMeta, rBig, rGo, rDuo);

    const me = el('section', 'md-me');
    const club = el('section', 'md-club');
    const cTitle = el('b', 'md-club__t');
    const cAv = el('div', 'md-club__av');
    const cTxt = el('p', 'md-club__s');
    const cList = el('div', 'md-club__list');
    club.append(cTitle, cAv, cTxt, cList);
    side.append(room, me, club);
    shell.parentNode.append(side);
    shell.parentNode.classList.add('md-browser');

    fav.addEventListener('click', () => {
      if (typeof state === 'undefined' || !state.selected || typeof toggleFavorite !== 'function') return;
      toggleFavorite(state.selected);
    });
    room.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      const j = q('#actJoin');
      if (j && !j.disabled) j.click();
    });

    // Piezas de siempre, a su lugar nuevo.
    take('#actJoin', rGo);
    take('#actAutoJoin', rDuo);
    take('#profCard', me);

    return { head, h1, sub, side, room, rKick, rName, rMeta, rBig, fav, me, club, cTitle, cAv, cTxt, cList };
  }

  function mount(on) {
    on = !!on;
    if (on === mounted) return;
    if (on) {
      built = build();
      if (!built) return;
      mounted = true;
      board();
      room();
      plantel(lastMembers);
    } else {
      giveBack();
      if (built) {
        built.head.remove();
        built.side.parentNode && built.side.parentNode.classList.remove('md-browser');
        built.side.remove();
      }
      built = null;
      mounted = false;
    }
    try { if (typeof state !== 'undefined' && typeof NAV_PAGES !== 'undefined' && NAV_PAGES.includes(state.view)) buildPanelNav(); } catch (e) { /* adorno */ }
  }

  /* ── Cabecera ─────────────────────────────────────────────────────── */
  function board() {
    if (!mounted || !built || typeof state === 'undefined') return;
    built.h1.textContent = L('Salas', 'Rooms');
    const r = state.rooms || {};
    built.sub.textContent = r.totalRooms
      ? L(`${fmt(r.totalPlayers)} personas jugando en ${fmt(r.totalRooms)} salas`, `${fmt(r.totalPlayers)} people playing in ${fmt(r.totalRooms)} rooms`)
      : (r.loading ? L('Buscando salas…', 'Looking for rooms…') : L('Elegí una sala para jugar', 'Pick a room to play'));
  }

  /* ── La sala elegida ─────────────────────────────────────────────── */
  function room() {
    if (!mounted || !built || typeof state === 'undefined') return;
    const list = (state.rooms && state.rooms.list) || [];
    const r = state.selected ? list.find((x) => x.token === state.selected) : null;
    built.room.classList.toggle('has-room', !!r);
    built.rKick.textContent = L('SALA ELEGIDA', 'SELECTED ROOM');
    const isFav = !!(r && typeof isFavorite === 'function' && isFavorite(r.token));
    built.fav.disabled = !r;
    built.fav.classList.toggle('is-on', isFav);
    built.fav.replaceChildren(icon('star'), el('span', null, isFav ? L('Favorita', 'Favourite') : L('Favorita', 'Favourite')));
    if (!r) {
      built.rName.textContent = L('Ninguna todavía', 'None yet');
      built.rName.title = '';
      built.rMeta.textContent = L('Tocá una sala de la lista. Con doble clic entrás directo.', 'Click a room in the list. Double-click joins right away.');
      built.rBig.replaceChildren();
      built.rBig.className = 'md-room__big is-idle';
      return;
    }
    built.rName.textContent = r.name || '—';
    built.rName.title = r.name || '';
    const meta = [];
    if (r.country) meta.push(r.country);
    if (r.distance != null) meta.push(`${fmt(r.distance)} km`);
    meta.push(r.password ? L('Con clave', 'Password') : L('Abierta', 'Open'));
    try {
      const mates = typeof clubRoomMap !== 'undefined' && clubRoomMap.get(String(r.name || '').trim().slice(0, 40).toLowerCase());
      if (mates && mates.length) meta.push(L(`${mates.join(', ')} está adentro`, `${mates.join(', ')} inside`));
    } catch (e) { /* adorno */ }
    built.rMeta.textContent = meta.join(' · ');
    const full = r.players >= r.maxPlayers;
    const almost = !full && r.maxPlayers > 2 && r.players >= r.maxPlayers - 2 && r.players > 0;
    built.rBig.className = 'md-room__big' + (full ? ' is-full' : almost ? ' is-almost' : '');
    built.rBig.replaceChildren(el('b', null, String(r.players)), el('span', null, L(`/ ${r.maxPlayers} jugadores`, `/ ${r.maxPlayers} players`)));
  }

  /* ── El club ─────────────────────────────────────────────────────── */
  const TINTS = ['#2fd18a', '#7aa3e8', '#e1c57f', '#e5788a', '#b48cf0', '#f2b84b'];
  function plantel(members) {
    if (Array.isArray(members)) lastMembers = members;
    if (!mounted || !built) return;
    built.cTitle.textContent = L('Club en línea', 'Club online');
    const all = Array.isArray(lastMembers) ? lastMembers : [];
    const on = all.filter((m) => m && m.online);
    built.club.hidden = !all.length;
    built.cAv.replaceChildren(...on.slice(0, 7).map((m, i) => {
      const a = el('i', null, String(m.name || '?').trim().charAt(0).toUpperCase());
      a.style.background = TINTS[i % TINTS.length];
      a.title = m.name;
      return a;
    }));
    const names = on.map((m) => (m.self ? L('vos', 'you') : m.name));
    built.cTxt.textContent = !on.length ? L('No hay nadie conectado ahora.', 'Nobody online right now.')
      : names.length === 1 ? names[0]
        : `${names.slice(0, -1).join(', ')} ${L('y', 'and')} ${names[names.length - 1]}`;
    // Quienes están en una sala: un clic y vas.
    built.cList.replaceChildren(...on.filter((m) => m.room && !m.self).slice(0, 4).map((m) => {
      const b = el('button', 'md-club__go');
      b.type = 'button';
      b.title = L(`Ir a la sala de ${m.name}`, `Go to ${m.name}'s room`);
      b.append(icon('pin'), el('b', null, m.name), el('span', null, m.room));
      b.addEventListener('click', () => { try { if (typeof goToClubRoom === 'function') goToClubRoom(m); } catch (e) { /* nada */ } });
      return b;
    }));
  }

  function music() { /* la interfaz moderna no repite el tema que suena: ya está en la barra */ }

  window.TLModerna = { mount, board, room, plantel, music };
  if (document.documentElement.dataset.ui === 'moderna') mount(true);
})();
