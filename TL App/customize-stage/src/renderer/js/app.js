/* ══════════════════════════════════════════════════════════
   TL App — renderer
   ══════════════════════════════════════════════════════════ */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const t = (key, vars) => window.i18n.t(key, vars);
const isEn = () => window.i18n.language === 'en';

const appearancePage = $('.page[data-page="aspecto"] .page__inner');
const settingsPage = $('.page[data-page="ajustes"] .page__inner');
if (!appearancePage || !settingsPage) throw new Error('No se encontraron las páginas para reubicar los ajustes de Cuenta.');
/*
 * Orden final de las páginas. Las secciones de Cuenta no tienen página propia:
 * se reparten acá, y el orden va de lo que más se toca a lo que menos.
 *
 *   Aspecto:  tema · acento · tu jugador · la pelota · la cancha · replays ·
 *             en partida · cartel de teclas · overlay · música · sonidos ·
 *             lista de jugadores
 *   Ajustes:  cliente · audio · identidades · discord · actualizaciones ·
 *             configuración
 */
const accountSection = (sel) => {
  const section = $(`.page[data-page="cuenta"] ${sel}`);
  if (!section) throw new Error(`Falta la sección de cuenta ${sel}.`);
  return section;
};
const pitchSection = $('[data-sec="cancha"]', appearancePage);
if (!pitchSection) throw new Error('Falta la sección de la cancha.');
pitchSection.before(accountSection('[data-sec="jugador"]'), accountSection('[data-sec="pelota"]'));
appearancePage.append(accountSection('[data-sec="sonidos"]'), accountSection('#vipCard'));

const settingsUpdates = $('[data-sec="actualizaciones"]', settingsPage);
if (!settingsUpdates) throw new Error('Falta la sección de actualizaciones.');
settingsUpdates.before(accountSection('[data-sec="identidades"]'), accountSection('[data-sec="discord"]'));

/*
 * ═══ Dos pestañas, con pestañas adentro ═══
 *
 * Antes eran tres —Aspecto, Rendimiento y Ajustes— y cada una un scroll largo
 * con un índice de veinte renglones. Ahora son dos, y cada una se parte en unas
 * pocas solapas que se eligen en la columna de la izquierda:
 *
 *   Personalización: Estilo · Cancha · Fichas y pelota · En partida
 *   Configuración:   Rendimiento · Ajustes del juego
 *
 * Las secciones no se reescriben: se mudan de página y se les anota a qué
 * solapa pertenecen (`data-tab`). Lo que no es de la solapa activa se esconde
 * con la clase `is-tab-off`. Tres secciones largas (controles, líneas y tamaños,
 * cartel de teclas) no se muestran sueltas: en su lugar va una tarjeta que las
 * abre en una ventana aparte (ver `openSecModal`).
 */
const TAB_ICONS = {
  estilo: 'M12 3.8a8.2 8.2 0 1 0 0 16.4c1.1 0 1.9-.8 1.9-1.7 0-.5-.2-.9-.5-1.2a1.6 1.6 0 0 1 1.2-2.7h1.5a4 4 0 0 0 3.9-4c0-4-3.6-6.8-8-6.8z',
  cancha: 'M3 6h18v12H3zM12 6v12M3 10.5h3v3H3zM18 10.5h3v3h-3z',
  fichas: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8.6l3.2 2.3-1.2 3.7h-4l-1.2-3.7z',
  partida: 'M8.7 5.9v12.2l10-6.1z',
  rapido: 'M13 3 5 13.5h6L10 21l8-10.5h-6z',
  graficos: 'M4 5h16v11H4zM9 20h6M12 16v4',
  red: 'M3.5 9.2a12.5 12.5 0 0 1 17 0M6.6 12.4a8 8 0 0 1 10.8 0M9.7 15.5a3.6 3.6 0 0 1 4.6 0M12 18.8h.01',
  controles: 'M7.5 8h9a4.5 4.5 0 0 1 4.5 4.5v.5a3 3 0 0 1-5.1 2.1L14.6 14h-5.2l-1.3 1.1A3 3 0 0 1 3 13v-.5A4.5 4.5 0 0 1 7.5 8zM8 10.6v2.8M6.6 12h2.8',
  cliente: 'M4 5h16v14H4zM4 9.5h16M7 7.2h.01M9.6 7.2h.01',
  cuentas: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM5 20c0-3.5 3-6 7-6s7 2.5 7 6',
  sistema: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5'
};

const PANEL_TABS = {
  aspecto: [
    { id: 'estilo', label: 'tab.style', hint: 'tab.styleHint',
      secs: ['tema', 'acento', 'interfaz', 'densidad', 'animaciones', 'looks', 'menubg'] },
    { id: 'cancha', label: 'tab.pitch', hint: 'tab.pitchHint',
      secs: ['cancha', 'acabado', 'trazos', 'replays'] },
    { id: 'fichas', label: 'tab.discs', hint: 'tab.discsHint',
      secs: ['jugador', 'pelota', 'fichaslook', 'nombres'] },
    { id: 'partida', label: 'tab.ingame', hint: 'tab.ingameHint',
      secs: ['chatlook', 'statslook', 'partida', 'teclashud', 'overlay', 'sonidos', 'lista'] }
  ],
  ajustes: [
    { id: 'rapido', group: 'tabg.perf', label: 'tab.quick', hint: 'tab.quickHint', secs: ['perfil', 'respuesta'] },
    { id: 'graficos', group: 'tabg.perf', label: 'tab.gfx', hint: 'tab.gfxHint', secs: ['graficos'] },
    { id: 'red', group: 'tabg.perf', label: 'tab.net', hint: 'tab.netHint', secs: ['red', 'avanzado'] },
    { id: 'controles', group: 'tabg.game', label: 'tab.controls', hint: 'tab.controlsHint', secs: ['teclas'] },
    { id: 'cliente', group: 'tabg.game', label: 'tab.client', hint: 'tab.clientHint', secs: ['cliente', 'mezclador', 'audio'] },
    { id: 'cuentas', group: 'tabg.game', label: 'tab.accounts', hint: 'tab.accountsHint', secs: ['identidades', 'discord'] },
    { id: 'sistema', group: 'tabg.game', label: 'tab.system', hint: 'tab.systemHint', secs: ['actualizaciones', 'config'] }
  ]
};

/** Las secciones que se abren en ventana propia, y qué decir en su tarjeta. */
const MODAL_SECS = {
  trazos: { title: 'visual.title', desc: 'launch.trazos' },
  teclas: { title: 'keys.title', desc: 'launch.teclas' },
  teclashud: { title: 'keys.hudTitle', desc: 'launch.teclashud' }
};

(function organizePanel() {
  const perfPage = $('.page[data-page="rendimiento"]');
  const pages = { aspecto: appearancePage, ajustes: settingsPage };
  const findSec = (id) => $(`[data-sec="${id}"]`);

  // Lo de Rendimiento se muda a Configuración; las líneas y tamaños, a la cancha.
  if (perfPage) {
    for (const id of ['perfil', 'respuesta', 'graficos', 'red', 'teclas', 'avanzado']) {
      const sec = $(`[data-sec="${id}"]`, perfPage);
      if (sec) settingsPage.append(sec);
    }
    const trazos = $('[data-sec="trazos"]', perfPage);
    if (trazos) appearancePage.append(trazos);
    perfPage.remove();
  }

  for (const [page, tabs] of Object.entries(PANEL_TABS)) {
    const inner = pages[page];
    // Se anexan en el orden de la solapa: el orden del DOM es el orden en pantalla.
    // El encabezado de la página (`.pagehead`) queda arriba, donde estaba.
    for (const tab of tabs) {
      for (const id of tab.secs) {
        const sec = findSec(id);
        if (!sec) continue;
        sec.dataset.tab = tab.id;
        inner.append(sec);

        const meta = MODAL_SECS[id];
        if (!meta) continue;
        sec.dataset.modal = '1';
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'launch';
        card.dataset.tab = tab.id;
        card.dataset.launch = id;
        card.innerHTML =
          '<span class="launch__text"><b class="launch__title"></b><span class="launch__desc"></span></span>' +
          '<span class="launch__go"></span>';
        card.querySelector('.launch__title').dataset.i18n = meta.title;
        card.querySelector('.launch__desc').dataset.i18n = meta.desc;
        card.querySelector('.launch__go').dataset.i18n = 'launch.open';
        sec.before(card);
      }
    }
  }
})();

const state = {
  config: null,
  schema: null,
  info: null,
  rooms: { list: [], totalPlayers: 0, totalRooms: 0, fetchedAt: 0, error: null, loading: false },
  /**
   * Fallos seguidos al pedir la lista. Va afuera de `rooms` a propósito: ese
   * objeto se reemplaza entero con lo que contesta el proceso principal, así que
   * cualquier cosa nuestra que viva adentro se pierde en el primer éxito.
   */
  roomsFailures: 0,
  sort: 'distance',
  flags: null,
  onlyFavs: false,
  hideLocked: (() => { try { return localStorage.getItem('tl_hide_locked') === '1'; } catch (e) { return false; } })(),
  hideFull: (() => { try { return localStorage.getItem('tl_hide_full') === '1'; } catch (e) { return false; } })(),
  /** Token de la sala que estamos esperando a que tenga lugar. */
  autoJoin: null,
  /** Pendiente mientras el usuario confirma su apodo en la pantalla de inicio. */
  pendingJoin: null,
  replays: { folder: '', items: [], error: null },
  auth: { items: [], activeId: null, liveAvailable: false, liveKnown: false },
  /** El `<webview>` de la pestaña de juego ACTIVA. Ver «Pestañas de juego». */
  webview: null,
  /** Todas las pestañas de juego, en el orden de la barra. */
  tabs: [],
  activeTab: null,
  /** Si ya se le ofreció al jugador la ventana de verificación de Cloudflare. */
  verifyAsked: false,
  view: 'play',
  stage: 'browser',
  /** Pantalla activa; la manda Electron para no ofrecer resoluciones imposibles. */
  display: null,
  selected: null,
  createListed: true,
  playing: false,
  playedSeconds: 0,
  /** El avatar que HaxBall tiene guardado, para partir de ahí. */
  liveAvatar: '',
  /** Nombre de la sala en la que estás, leído del propio HaxBall. */
  gameRoomName: null,
  /**
   * Nombre de la sala a la que pediste entrar (o que acabás de crear), para la
   * presencia de Discord mientras HaxBall todavía no dijo el suyo. Antes acá se
   * usaba la fila marcada en la lista, que no es lo mismo: al crear una sala
   * seguía marcada la que hubieras tocado antes y Discord mostraba ESA.
   */
  joinedRoomName: null,
  /** La última sala en la que estuviste, para el botón de volver. */
  lastRoom: null,
  /** Tu código de amigo, tal como lo manda el sitio. */
  friendCode: null,
  /** Los controles que HaxBall tiene puestos, mientras el cliente no los toque. */
  liveKeys: null,
  /** Si vip.js tiene cargados el server y el rol: si no, no se puede comprobar. */
  /**
   * Si los ajustes de HaxBall se pueden cambiar con el juego andando. Lo dice el
   * preload al cargar la partida: depende de que haya entrado el parche del
   * bundle. Mientras no se sepa, se asume que no y se recarga como antes.
   */
  liveGameSettings: false,
  /**
   * En qué anda la actualización, para el cartel fijo de arriba.
   *
   * `phase` es 'idle' | 'available' | 'downloading' | 'ready' | 'failed'. Vive
   * acá y no en el DOM porque el cartel se repinta entero al cambiar de idioma,
   * y leer el estado del texto que uno mismo escribió no termina bien.
   */
  update: { phase: 'idle', latest: '', percent: 0, dismissed: false }
};

/* ══════════════════════════════════════════════════════════
   Pantalla de carga
   ══════════════════════════════════════════════════════════
   Ya está pintada cuando este archivo empieza a correr: va primera en el HTML y
   sin `hidden`, así que entra en el primer cuadro que dibuja la ventana. Acá
   sólo se le va contando en qué anda el arranque y al final se la saca.

   ── Por qué esto va ARRIBA DE TODO ────────────────────────────────────────

   Vivía al final del archivo, y ahí la red de seguridad no protegía de nada: si
   algo de las 2900 líneas de arriba tiraba —alcanza con enganchar un listener a
   un botón cuyo id ya no está en el HTML—, el módulo se cortaba ahí y NUNCA se
   llegaba a programar el temporizador que saca la pantalla ni el que escribe el
   consejo. Resultado: carga infinita, sin consejo y sin ningún error a la vista.
   Pasó exactamente así con el botón «Replays» de la barra de acciones, que se
   sacó del HTML y dejó su listener colgado.

   Arriba, los dos temporizadores quedan armados antes de que exista la
   oportunidad de romper nada. Lo peor que puede pasar ahora es una app a medias
   —visible, y con el error en pantalla—, no una app trabada.
   ══════════════════════════════════════════════════════════ */

/**
 * Mínimo que se queda en pantalla.
 *
 * El arranque tarda distinto en cada máquina y a veces resuelve en 200 ms. Sin
 * un piso, la pantalla de carga sería un destello — peor que no tenerla, porque
 * se lee como un parpadeo defectuoso. Con esto siempre se alcanza a leer «TL
 * App» y el cliente se siente igual de rápido en cualquier PC.
 */
const SPLASH_MIN_MS = 3000;
const splashSince = performance.now();

/** Los pasos del arranque, para que la barra tenga algo que contar. */
function splashStep(key) {
  const node = $('#splashStatus');
  if (node) node.textContent = t(key);
}

/**
 * Una sola frase al azar por arranque, como el «¿Sabías que…?» de Discord.
 *
 * No rotan: la pantalla dura tres segundos y cambiar el texto en el medio se lee
 * como un error, no como una segunda frase. Por eso el sorteo es del ÍNDICE y se
 * hace una sola vez: `splashTip()` se llama dos veces —al principio y de nuevo
 * cuando ya se sabe el idioma— y las dos tienen que decir lo mismo.
 */
const SPLASH_TIPS = {
  es: [
    'Presioná F8 para abrir los ajustes en cualquier momento.',
    'Guardá tus salas favoritas haciendo clic en la estrella.',
    'Usá Auto-entrar para unirte automáticamente cuando haya un lugar libre.',
    'Pegá un link de sala directamente en la barra superior.',
    'Los beneficios de personalización para el club ya están habilitados.',
    'Configurá tus teclas en Ajustes para una respuesta óptima.',
    'Guardá y revisá tus partidas grabadas desde la sección de Replays.'
  ],
  en: [
    'Press F8 to open the settings at any time.',
    'Save your favourite rooms by clicking the star.',
    'Use Auto-join to get in automatically as soon as a slot frees up.',
    'Paste a room link straight into the top bar.',
    'Club customisation perks are already enabled.',
    'Set up your keys in Settings for the best response.',
    'Save and rewatch your recorded matches from the Replays section.'
  ]
};

const splashTipIndex = Math.floor(Math.random() * SPLASH_TIPS.es.length);

function splashTip() {
  const node = $('#splashTip');
  if (!node) return;
  const english = isEn();
  const list = english ? SPLASH_TIPS.en : SPLASH_TIPS.es;
  node.replaceChildren();
  const label = document.createElement('b');
  label.textContent = english ? 'Did you know? ' : '¿Sabías que? ';
  node.append(label, document.createTextNode(list[splashTipIndex % list.length]));
}

let splashHidden = false;
async function hideSplash() {
  if (splashHidden) return;
  splashHidden = true;
  const splash = $('#splash');
  if (!splash) return;

  const left = SPLASH_MIN_MS - (performance.now() - splashSince);
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));

  splash.classList.add('is-out');
  setTimeout(() => splash.remove(), 450);
  setTimeout(startWelcome, 470);
}

/** La música del menú arranca cuando termina la bienvenida (o enseguida si no hay). */
function startMusic() {
  if (state.access && state.access.state === 'locked') return;
  if (window.TLMusic) window.TLMusic.start();
}
window.addEventListener('tl:welcome-done', startMusic);

/* ── Lista de acceso (main/access.js) ───────────────────────────────────── */
const GATE_TEXT = {
  es: {
    title: 'Acceso del equipo', sub: 'Poné tu clave personal para usar TL App.', ph: 'TL-XXXX-XXXX-XXXX', go: 'Entrar', checking: 'Verificando…',
    'need-key': '', 'bad-key': 'Esa clave no está en la lista.', revoked: 'Tu acceso fue quitado. No podés usar la app.',
    offline: 'No se pudo verificar la clave: hace falta conexión.', expired: 'Hace más de 3 días que no se verifica tu acceso. Conectate a internet.',
    'trial-ended': 'Tu prueba de TL App terminó. Pedile a miclo una clave nueva para seguir.',
    help: 'Si no tenés clave, pedísela a miclo.',
    outdated: 'Hay una versión nueva y obligatoria de TL App.', outdatedSub: 'Actualizá para seguir usando la app.', update: 'Actualizar ahora', updating: 'Buscando actualización…',
    noUpdate: 'Todavía no hay una actualización disponible. Probá en unos minutos.',
    'other-pc': 'Tu clave ya está en uso en otra PC.', otherSub: 'Cada clave sirve para una sola computadora. Pedile a miclo que la libere y esta pantalla se abre sola.',
    shared: 'Tu clave se usó desde otra PC.', sharedSub: 'Las claves no se comparten: quedó bloqueada en las dos computadoras. Hablá con miclo para resolverlo.',
    banned: 'Esta PC no está autorizada.', bannedSub: 'Esta computadora no puede usar esa clave. Si es un error, hablá con miclo.'
  },
  en: {
    title: 'Team access', sub: 'Enter your personal key to use TL App.', ph: 'TL-XXXX-XXXX-XXXX', go: 'Enter', checking: 'Checking…',
    'need-key': '', 'bad-key': 'That key is not on the list.', revoked: 'Your access was removed. You cannot use the app.',
    offline: 'Could not verify the key: a connection is required.', expired: 'Your access has not been verified for over 3 days. Please go online.',
    'trial-ended': 'Your TL App trial has ended. Ask miclo for a new key to keep going.',
    help: 'No key? Ask miclo.',
    outdated: 'A new, mandatory version of TL App is available.', outdatedSub: 'Update to keep using the app.', update: 'Update now', updating: 'Checking for updates…',
    noUpdate: 'No update is available yet. Try again in a few minutes.',
    'other-pc': 'Your key is already in use on another PC.', otherSub: 'Each key works on a single computer. Ask miclo to release it and this screen will open by itself.',
    shared: 'Your key was used from another PC.', sharedSub: 'Keys are not to be shared: it is now blocked on both computers. Talk to miclo to sort it out.',
    banned: 'This PC is not authorized.', bannedSub: 'This computer cannot use that key. If this is a mistake, talk to miclo.'
  }
};

/* ── Actualización obligatoria ────────────────────────────────
 * Si el capitán la tiene activa (panel → Acceso y versión) y hay una versión publicada más
 * nueva que la que tenés, la app muestra este cartel y no deja usarla hasta actualizar.
 * Sólo se pide al abrir la app: si ya estás en una sala, no te interrumpe. El capitán queda afuera. */
const FORCE_MSGS = {
  es: [
    'Tu TL App quedó en el siglo pasado. Actualizá y volvé a la cancha.',
    'El DT dice que sin la última versión no se juega. Actualizá y salís al campo.',
    'Esta versión ya está en el banco de suplentes. Actualizá para volver a ser titular.',
    'Salió una versión nueva y vos seguís con la vieja. Actualizá y seguimos.',
    'El árbitro no te deja entrar con la versión vieja. Actualizá y pasás.'
  ],
  en: [
    'Your TL App is stuck in the last century. Update and get back on the pitch.',
    'The coach says no update, no game. Update and take the field.',
    'This version has been benched. Update to be a starter again.',
    'A new version is out and you are still on the old one. Update and we go on.',
    'The referee will not let the old version in. Update and you are through.'
  ]
};
let forceMsg = '';
let forceActive = false;
async function enforceUpdate() {
  const st = state.access;
  if (!st || st.state !== 'ok' || !st.forceUpdate || st.captain || state.stage === 'game' || forceActive) return;
  try {
    const res = await tvm.updates.check();
    if (!(res && res.status === 'available' && res.canDownload !== false)) return;
    if (state.stage === 'game') return;
    forceActive = true;
    wasLocked = true;
    try { document.querySelectorAll('webview').forEach((w) => w.remove()); } catch (e) { /* nada */ }
    if (!forceMsg) { const list = FORCE_MSGS[isEn() ? 'en' : 'es']; forceMsg = list[Math.floor(Math.random() * list.length)]; }
    showGate('outdated', forceMsg);
  } catch (e) { /* sin red: se reintenta más tarde */ }
}
// Sólo al abrir la app (nunca a mitad de una tanda de partidos): una revisión a los pocos
// segundos y, si no hubo red, un reintento a los dos minutos mientras no se haya entrado a una sala.
setTimeout(enforceUpdate, 12000);
setTimeout(enforceUpdate, 120000);

function showGate(reason, extra) {
  const tx = GATE_TEXT[isEn() ? 'en' : 'es'];
  let gate = $('#gate');
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'gate';
    gate.className = 'gate';
    const card = document.createElement('form');
    card.className = 'gate__card';
    card.autocomplete = 'off';
    const img = document.createElement('img');
    img.src = '../../assets/toda-la-lecce.png';
    img.alt = '';
    img.className = 'gate__crest';
    const h = document.createElement('h2'); h.className = 'gate__title';
    const p = document.createElement('p'); p.className = 'gate__sub';
    const input = document.createElement('input'); input.className = 'gate__input'; input.type = 'password'; input.spellcheck = false; input.maxLength = 40;
    const btn = document.createElement('button'); btn.type = 'submit'; btn.className = 'gate__btn';
    const msg = document.createElement('div'); msg.className = 'gate__msg'; msg.setAttribute('role', 'alert');
    const help = document.createElement('div'); help.className = 'gate__help';
    card.append(img, h, p, input, btn, msg, help);
    gate.append(card);
    document.body.append(gate);
    card.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = GATE_TEXT[isEn() ? 'en' : 'es'];
      if (gate.classList.contains('is-outdated')) {
        // Versión vieja: el botón busca, baja e instala la actualización.
        btn.disabled = true; btn.textContent = t.updating; msg.textContent = '';
        try {
          const res = await tvm.updates.check();
          if (res && res.status === 'available' && res.canDownload !== false) {
            await tvm.updates.download();
            await tvm.updates.install();
            return;
          }
          msg.textContent = t.noUpdate;
        } catch (err) { msg.textContent = t.noUpdate; }
        btn.disabled = false; btn.textContent = t.update;
        return;
      }
      if (!input.value.trim()) return;
      btn.disabled = true; btn.textContent = t.checking; msg.textContent = '';
      try {
        const st = await tvm.access.submit(input.value);
        if (st.state === 'ok') { input.value = ''; return onAccess(st); }
        msg.textContent = t[st.reason] || t['bad-key'];
      } catch (err) { msg.textContent = t.offline; }
      btn.disabled = false; btn.textContent = t.go;
    });
  }
  const outdated = reason === 'outdated';
  const otherPc = reason === 'other-pc' || reason === 'shared' || reason === 'banned';
  gate.classList.toggle('is-outdated', outdated);
  gate.classList.toggle('is-info', otherPc);
  gate.querySelector('.gate__title').textContent = outdated ? tx.outdated : otherPc ? tx[reason] : tx.title;
  gate.querySelector('.gate__sub').textContent = outdated ? (extra || tx.outdatedSub) : otherPc ? tx[reason === 'other-pc' ? 'otherSub' : `${reason}Sub`] : tx.sub;
  gate.querySelector('.gate__input').placeholder = tx.ph;
  gate.querySelector('.gate__btn').textContent = outdated ? tx.update : tx.go;
  gate.querySelector('.gate__msg').textContent = outdated || otherPc ? '' : (tx[reason] || '');
  gate.querySelector('.gate__help').textContent = outdated || otherPc ? '' : tx.help;
  gate.hidden = false;
  document.body.classList.add('is-gated');
  setTimeout(() => { const i = gate.querySelector('.gate__input'); if (i) i.focus(); }, 50);
}

/* Aviso del capitán (access.json → announcement): se muestra una vez por aviso. */
function noticeSeen() { try { return localStorage.getItem('tl_notice_seen') || ''; } catch (e) { return ''; } }
function showNoticeIfReady() {
  const n = state.access && state.access.notice;
  if (!n || state.access.state === 'locked' || n.id === noticeSeen()) return;
  if (document.getElementById('welcome') || $('#startScreen') && !$('#startScreen').hidden && $('#startScreen').offsetParent) return;
  if (state.stage === 'game' || $('#notice') || $('.cap')) return;
  const en = isEn();
  const box = document.createElement('div');
  box.id = 'notice';
  box.className = 'gate notice';
  const card = document.createElement('div');
  card.className = 'gate__card';
  const img = document.createElement('img');
  img.src = '../../assets/toda-la-lecce.png';
  img.alt = '';
  img.className = 'gate__crest';
  const h = document.createElement('h2');
  h.className = 'gate__title';
  h.textContent = n.title || (en ? "Captain's notice" : 'Aviso del capitán');
  const p = document.createElement('p');
  p.className = 'notice__text';
  p.textContent = n.text;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gate__btn';
  btn.textContent = en ? 'Got it' : 'Entendido';
  btn.addEventListener('click', () => {
    try { localStorage.setItem('tl_notice_seen', n.id); } catch (e) { /* sin almacenamiento: se vuelve a mostrar */ }
    box.remove();
  });
  card.append(img, h, p, btn);
  box.append(card);
  document.body.append(box);
  setTimeout(() => btn.focus(), 50);
}
/* Aviso urgente del capitán: aparece enseguida, también dentro de una sala. */
function urgentSeen() { try { return localStorage.getItem('tl_urgent_seen') || ''; } catch (e) { return ''; } }
function showUrgentIfAny() {
  const u = state.access && state.access.urgent;
  if (!u || u.id === urgentSeen() || $('#urgent') || (state.access.state === 'locked')) return;
  const box = document.createElement('div');
  box.id = 'urgent';
  box.className = 'urgent';
  box.setAttribute('role', 'alertdialog');
  const head = document.createElement('b');
  head.textContent = u.title || (isEn() ? 'Urgent notice' : 'Aviso urgente');
  const p = document.createElement('p');
  p.textContent = u.text;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = isEn() ? 'Got it' : 'Entendido';
  btn.addEventListener('click', () => {
    try { localStorage.setItem('tl_urgent_seen', u.id); } catch (e) { /* se vuelve a mostrar */ }
    box.remove();
  });
  box.append(head, p, btn);
  document.body.append(box);
  if (window.TLSfx && typeof window.TLSfx.play === 'function') { try { window.TLSfx.play('open'); } catch (e) { /* sin sonido */ } }
}

/* «Te extrañamos»: si hacía varios días que no abrías la app (lo avisa el proceso principal). */
const BACK_MSGS = {
  es: ['Te extrañamos en la cancha. Qué bueno verte de vuelta.', 'El club no es lo mismo sin vos. Bienvenido de vuelta.', 'Pasaron {d} días y la camiseta te seguía esperando.'],
  en: ['We missed you on the pitch. Good to have you back.', 'The club is not the same without you. Welcome back.', '{d} days went by and your shirt kept waiting for you.']
};
function showBack(info) {
  if (!info || $('#backcard')) return;
  const wait = () => {
    if (document.getElementById('welcome') || $('#gate') && !$('#gate').hidden || $('#notice') || $('#news')) { setTimeout(wait, 3000); return; }
    const en = isEn();
    const list = BACK_MSGS[en ? 'en' : 'es'];
    const box = document.createElement('div');
    box.id = 'backcard';
    box.className = 'gate notice';
    const card = document.createElement('div');
    card.className = 'gate__card';
    const img = document.createElement('img');
    img.src = '../../assets/toda-la-lecce.png';
    img.alt = '';
    img.className = 'gate__crest';
    const h = document.createElement('h2');
    h.className = 'gate__title';
    h.textContent = en ? `Welcome back${info.name ? `, ${info.name}` : ''}!` : `¡Volviste${info.name ? `, ${info.name}` : ''}!`;
    const p = document.createElement('p');
    p.className = 'notice__text';
    p.textContent = list[Math.floor(Math.random() * list.length)].replace('{d}', String(info.days));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gate__btn';
    btn.textContent = en ? 'Let us play' : 'A jugar';
    btn.addEventListener('click', () => box.remove());
    card.append(img, h, p, btn);
    box.append(card);
    document.body.append(box);
    setTimeout(() => btn.focus(), 50);
  };
  setTimeout(wait, 4000);
}
if (window.tvm.presence && window.tvm.presence.onBack) window.tvm.presence.onBack(showBack);

/* «Qué hay de nuevo»: una vez por cada `id` de novedades.js, después del aviso del capitán. */
function newsSeen() { try { return localStorage.getItem('tl_news_seen') || ''; } catch (e) { return ''; } }
function showNewsIfReady() {
  const n = window.TL_NEWS;
  if (!n || n.id === newsSeen()) return;
  if (state.access && state.access.state === 'locked') return;
  if (document.getElementById('welcome') || $('#notice') || $('#news') || $('.cap') || state.stage === 'game') return;
  if ($('#startScreen') && !$('#startScreen').hidden && $('#startScreen').offsetParent) return;
  const en = isEn();
  const lang = en ? 'en' : 'es';
  const box = document.createElement('div');
  box.id = 'news';
  box.className = 'gate notice';
  const card = document.createElement('div');
  card.className = 'gate__card';
  const img = document.createElement('img');
  img.src = '../../assets/toda-la-lecce.png';
  img.alt = '';
  img.className = 'gate__crest';
  const h = document.createElement('h2');
  h.className = 'gate__title';
  h.textContent = n.title[lang];
  const ul = document.createElement('ul');
  ul.className = 'news__list';
  for (const line of n.items[lang]) { const li = document.createElement('li'); li.textContent = line; ul.append(li); }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gate__btn';
  btn.textContent = en ? 'Got it' : 'Entendido';
  btn.addEventListener('click', () => {
    try { localStorage.setItem('tl_news_seen', n.id); } catch (e) { /* sin almacenamiento: se vuelve a mostrar */ }
    box.remove();
  });
  card.append(img, h, ul, btn);
  box.append(card);
  document.body.append(box);
  // Escape o un clic afuera también lo cierran, por si la ventana es chica.
  const onKey = (e) => { if (e.key === 'Escape') btn.click(); };
  document.addEventListener('keydown', onKey, true);
  new MutationObserver((_m, ob) => { if (!box.isConnected) { document.removeEventListener('keydown', onKey, true); ob.disconnect(); } }).observe(document.body, { childList: true });
  box.addEventListener('mousedown', (e) => { if (e.target === box) btn.click(); });
  setTimeout(() => btn.focus(), 50);
}
setInterval(showNewsIfReady, 3000);

window.addEventListener('tl:welcome-done', () => setTimeout(showNoticeIfReady, 400));
// También cuando se cierra la pantalla de apodo: una consulta barata cada tanto, que sale enseguida si no hay nada.
setInterval(showNoticeIfReady, 2500);

let welcomePending = false;
let wasLocked = false;
/** Cartelito para quien usa una clave de prueba: cuánto le queda. Se actualiza cada medio minuto. */
let trialTimer = 0;
function paintTrialChip(st) {
  const end = st && st.trialEnd ? st.trialEnd : 0;
  let chip = document.getElementById('trialChip');
  if (!end) {
    if (chip) chip.remove();
    if (trialTimer) { clearInterval(trialTimer); trialTimer = 0; }
    return;
  }
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'trialChip';
    chip.className = 'trialchip';
    document.body.append(chip);
  }
  const draw = () => {
    const mins = Math.max(0, Math.ceil((end - Date.now()) / 60000));
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const left = d ? `${d} d ${h} h` : h ? `${h} h ${mins % 60} min` : `${mins} min`;
    chip.textContent = isEn() ? `Trial · ${left} left` : `Prueba · quedan ${left}`;
  };
  draw();
  if (trialTimer) clearInterval(trialTimer);
  trialTimer = setInterval(draw, 30000);
}

function onAccess(st) {
  state.access = st;
  if (st && st.state === 'ok' && wasLocked) {
    // El juego se arma una sola vez por sesión y, con el acceso cerrado, no se pudo montar:
    // al desbloquear se recarga la interfaz para que arranque completo.
    wasLocked = false;
    location.reload();
    return;
  }
  if (st && st.state === 'locked') {
    wasLocked = true;
    // Si había una partida abierta, se corta: el juego no puede seguir tapado por la pantalla.
    try { document.querySelectorAll('webview').forEach((w) => w.remove()); } catch (e) { /* nada */ }
    showGate(st.reason, st.minMessage);
    return;
  }
  const gate = $('#gate');
  if (gate && !forceActive) { gate.hidden = true; document.body.classList.remove('is-gated'); }
  const capBtn = $('#captainBtn');
  if (capBtn) capBtn.hidden = !(st && st.captain);
  paintTrialChip(st);
  const clubBtn = $('#rail [data-view="club"]');
  if (clubBtn) {
    clubBtn.hidden = !!(st && st.external);
    if (st && st.external && state.view === 'club') setView('play');
  }
  const hostRail = $('#hostRailBtn');
  if (hostRail) {
    hostRail.hidden = !(st && st.host);
    if (hostRail.hidden && state.view === 'hostear') setView('play');
  }
  const repBtn = $('#reportsBtn');
  if (repBtn) {
    repBtn.hidden = !(st && st.reports);
    if (repBtn.hidden && state.view === 'informes') setView('play');
  }
  paintHostAccess();
  showUrgentIfAny();
  if (welcomePending) { welcomePending = false; startWelcome(); }
  setTimeout(showNoticeIfReady, 900);
}

/** La bienvenida del club, una vez por arranque (ver welcome.js). */
function startWelcome() {
  if (state.access && state.access.state === 'locked') { welcomePending = true; return; }
  const cfg = state.config && state.config.appearance;
  if (!cfg || cfg.welcome === false || cfg.animations === false || !window.TLWelcome) { startMusic(); return; }
  try {
    window.TLWelcome.play({
      sound: cfg.welcomeSound !== false,
      nick: String((state.config.general && state.config.general.nickname) || '').trim(),
      english: isEn()
    });
  } catch (e) { startMusic(); /* una intro no puede romper el arranque */ }
}

/*
 * Red de seguridad: la pantalla se va SIEMPRE, pase lo que pase más abajo. El
 * consejo se escribe enseguida, no al final del arranque, así que se lee durante
 * los tres segundos en vez de aparecer justo cuando la pantalla se está yendo.
 */
setTimeout(hideSplash, SPLASH_MIN_MS + 200);
setTimeout(splashTip, 20);

/**
 * Un error que corta el arranque tiene que VERSE.
 *
 * Antes moría en la consola de un devtools que nadie tiene abierto y la app
 * quedaba en la pantalla de carga sin decir nada, que es lo más caro de
 * diagnosticar: no hay ni por dónde empezar a buscar.
 */
window.addEventListener('error', (event) => {
  const detail = event.error && event.error.message ? event.error.message : event.message;
  const where = event.filename ? ` (${String(event.filename).split('/').pop()}:${event.lineno})` : '';
  const text = `Error al arrancar: ${detail}${where}`;
  console.error('[TL App] el renderer falló:', event.error || event.message);

  const status = document.querySelector('#splashStatus');
  if (status) status.textContent = text;

  // El cartel se arma a mano, sin usar nada del resto del archivo: justamente
  // sirve para los casos en los que el resto del archivo no llegó a existir.
  if (document.querySelector('#bootError')) return;
  const bar = document.createElement('div');
  bar.id = 'bootError';
  bar.textContent = text;
  bar.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:100000',
    'padding:10px 14px', 'background:#3a0d16', 'color:#ffb4bd',
    'font:12px/1.4 system-ui,sans-serif', 'border-top:1px solid #7a1f2e',
    'white-space:pre-wrap', '-webkit-app-region:no-drag'
  ].join(';');
  const put = () => document.body && document.body.append(bar);
  document.body ? put() : window.addEventListener('DOMContentLoaded', put);
});

/* ── Formatos ───────────────────────────────────────────── */
const pad = (n) => String(n).padStart(2, '0');

const FORMATTERS = {
  chatOpacity: (v) => `${Math.round(Number(v) * 100)}%`,
  soundVolume: (v) => `${Math.round(Number(v) * 100)}%`,
  chatFocusHeight: (v) => `${Math.round(Number(v))} px`,
  chatHeight: (v) => `${Math.round(Number(v))} px`,
  extrapolation: (v) => `${Math.round(Number(v))} ms`
};

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${pad(m)}m` : `${m}m`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatDate(ms) {
  return new Date(ms).toLocaleString(isEn() ? 'en-GB' : 'es-AR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

/* ── Avisos ─────────────────────────────────────────────── *
 * Un solo sistema de carteles en toda la app. El preload del juego dibujaba
 * los suyos en el medio de la pantalla y una misma acción (reproducir un
 * replay, por ejemplo) terminaba mostrando dos avisos distintos a la vez.
 * Ahora el juego pide el aviso por IPC y sale acá.
 *
 * Encima se descartan los repetidos seguidos: si dos caminos avisan lo mismo
 * dentro de un segundo, se muestra uno.
 */
const recentToasts = new Map();

/**
 * @param {{label:string, run:Function}} [action] Botón dentro del aviso. Con uno,
 *   el aviso dura más: hay algo que decidir y tres segundos no alcanzan.
 */
function toast(message, kind = '', action = null) {
  const text = String(message || '').trim();
  if (!text) return null;

  const now = Date.now();
  const last = recentToasts.get(text);
  if (last && now - last < 1200) return null;
  recentToasts.set(text, now);
  if (recentToasts.size > 30) recentToasts.clear();

  const node = document.createElement('div');
  node.className = `toast${kind ? ` is-${kind}` : ''}`;
  node.append(document.createTextNode(text));

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast__btn';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      node.remove();
      action.run();
    });
    node.append(button);
  }

  $('#toasts').append(node);
  setTimeout(() => dismissToast(node), action ? 14000 : 3200);
  return node;
}

/** Saca un aviso ya: lo usa el «Entrando a la sala…» cuando se terminó de entrar. */
function dismissToast(node) {
  if (!node || !node.isConnected || node.classList.contains('is-out')) return;
  node.classList.add('is-out');
  node.addEventListener('animationend', () => node.remove(), { once: true });
  // Por si la animación no corre (ventana en segundo plano): no queda colgado.
  setTimeout(() => node.remove(), 600);
}

/**
 * Cambiarle el texto a un botón sin llevarse puesto su icono.
 *
 * `textContent = …` borra los hijos, y casi todos los botones llevan su dibujo
 * adelante. Es exactamente lo mismo que hace `applyStatic` con los que traen el
 * texto puesto desde el HTML; esto es para los que lo eligen en el momento.
 */
function setButtonLabel(btn, text) {
  if (!btn) return;
  const icon = btn.querySelector(':scope > svg[data-icon]');
  if (icon) btn.replaceChildren(icon, document.createTextNode(text));
  else btn.textContent = text;
}

async function guard(promise, prefix = 'Error') {
  try {
    return await promise;
  } catch (err) {
    toast(`${prefix}: ${err.message}`, 'err');
    return null;
  }
}

/* ── Config y tema ──────────────────────────────────────── */
function applyConfig(config) {
  state.config = config;
  const root = document.documentElement;
  // `ambient` ya no existe: el fondo dejó de animarse (blobs y aura quietos),
  // así que era un interruptor que no apagaba nada. Ver theme.css.
  root.dataset.animations = config.appearance.animations ? 'on' : 'off';
  window.i18n.setLanguage(config.appearance.language || 'es');
  // `setLanguage` repinta TODO lo que tiene data-i18n, y hay dos botones que
  // dicen otra cosa mientras su modo está encendido. Ver `paintKeysMoveButton`.
  paintKeysMoveButton();
  // Quién sos vive en la barra: el apodo o la foto pueden haber cambiado.
  paintMeChip();
  paintPreview();
  // Partículas del menú: dependen de su interruptor y de que las animaciones estén prendidas.
  if (window.TLMusic) window.TLMusic.configure(config.appearance.music !== false, config.appearance.musicVolume, config.appearance.musicClub !== false);
  if (window.TLSfx) window.TLSfx.configure(config.appearance.uiSounds !== false, config.appearance.uiSoundStyle);
  if (typeof paintAudio === 'function' && document.getElementById('audMusic')) paintAudio();
  if (window.TLSparks) {
    window.TLSparks.setStyle(config.appearance.sparkStyle || 'oro');
    window.TLSparks.setDensity(config.appearance.sparkCount || 40);
    window.TLSparks.setEnabled(config.appearance.sparks !== false && config.appearance.animations !== false);
  }
  const rd = document.documentElement.dataset;
  rd.pageTrans = config.appearance.pageTransition || 'fade';
  { const rr = config.appearance.roomRows; const prev = rd.roomRows; if (rr === 'dense' || rr === 'large') rd.roomRows = rr; else delete rd.roomRows; if (prev !== rd.roomRows) { try { if (roomParts) paintRoomWindow(true); } catch (e) { /* aún no hay lista */ } } }
  if (LAYOUT_IDS.includes(config.appearance.layout)) rd.layout = config.appearance.layout; else delete rd.layout;
  if (state.layoutSeen !== rd.layout) {
    state.layoutSeen = rd.layout;
    /* Consola arranca en el Inicio; al salir de ella el Inicio se cierra. */
    try { openHub(rd.layout === 'consola'); } catch (e) { /* aún no está armado */ }
  }
  if (config.appearance.density === 'compact' || config.appearance.density === 'comfy') rd.density = config.appearance.density; else delete rd.density;
  const flag = (k, name) => { if (config.appearance[k] === false) rd[name] = 'off'; else delete rd[name]; };
  flag('crestBreath', 'crestBreath');
  flag('roomCurtain', 'roomCurtain');
  flag('toggleBounce', 'toggleBounce');
  flag('listStagger', 'listStagger');
  flag('musicGlow', 'musicGlow');
  try { syncAccentDrift(); } catch (e) { /* adorno */ }
}

/**
 * La vista previa de Cancha y Fichas. Se redibuja con cada cambio de config y
 * al cambiar de solapa; fuera de esas dos solapas se esconde.
 */
let previewFrame = 0;
function paintPreview() {
  const box = document.getElementById('pv');
  if (!box) return;
  const modalCanvas = document.getElementById('pvCanvas2');
  if (modalCanvas && window.TLPreview && state.config) {
    requestAnimationFrame(() => { try { window.TLPreview.draw(modalCanvas, state.config); } catch (e) {} });
  }
  const panel = document.getElementById('panel');
  const on = state.view === 'aspecto'
    && ['cancha', 'fichas'].includes(currentTab('aspecto'))
    && !(panel && panel.classList.contains('is-searching'));
  box.hidden = !on;
  if (!on || !window.TLPreview || !state.config) return;
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(() => {
    try { window.TLPreview.draw(document.getElementById('pvCanvas'), state.config); } catch (e) { box.hidden = true; }
  });
}

/**
 * El tema ya no vive sólo dentro del juego: el main resuelve la paleta y manda
 * las variables CSS, y con eso se pinta el cliente entero.
 */
function applyThemeVars(vars) {
  if (!vars) return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    if (value) root.style.setProperty(name, value);
  }
  // El tema claro necesita otros rojos/verdes y menos brillo en los blobs.
  root.dataset.scheme = isLightColor(vars['--bg-0']) ? 'light' : 'dark';
  // Un atributo y no el valor de la variable: el CSS lo leía con
  // [style*="--aura-on: 0"], que depende de cómo el navegador serialice el
  // style inline y no acertaba nunca — por eso los temas VIP no animaban nada.
  root.dataset.aura = vars['--aura-on'] === '1' ? 'on' : 'off';

  /*
   * La muestra del color del cartel de teclas enseña el acento del tema mientras
   * no haya uno elegido a mano, así que cambiar de tema la dejaba mostrando el
   * anterior. Va acá y no en `refreshThemeVars` porque ésta es la única puerta
   * por la que pasan las dos vías: la que pide las variables y la que las recibe
   * empujadas desde el main (`theme.onVars`).
   */
  if (state.config) paintKeysColor();
}

/**
 * El acento que se está VIENDO, que no es `appearance.accent`.
 *
 * `appearance.accent` es el color que eligió el usuario, y sólo lo usan los
 * temas que no traen uno propio (ver `palette()` en themes.js): con «Azul»
 * puesto, el acento vivo es el azul del tema y el de la config sigue siendo el
 * violeta de la marca. Quien quiera mostrar «el color del tema» tiene que leer
 * la variable, que es la que ya resolvió el proceso principal.
 */
function themeAccent() {
  const css = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return /^#[0-9a-f]{6}$/i.test(css) ? css : (state.config.appearance.accent || '#7B3FE4');
}

function parseHex(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  return m ? m.slice(1).map((h) => parseInt(h, 16)) : null;
}

function isLightColor(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
}

/**
 * Mezcla dos colores. `amount` es cuánto del segundo entra (0 a 1).
 *
 * Esto lo hacía `color-mix()` en CSS, que es de Chrome 111: acá corre Chromium
 * 91 (ver `applyBootFlags` en main.js), donde la declaración entera es inválida
 * y el navegador la tira. Las muestras de color de acento quedaban sin fondo:
 * ocho cuadraditos vacíos. Es el mismo motivo por el que `themes.js` resuelve
 * sus mezclas en el proceso principal.
 */
/**
 * Llena una barra de progreso.
 *
 * Escribe `--fill` en vez del ancho porque la barra se encoge con `scaleX`: ver
 * `.xpbar > i` en app.css. Se redondea a dos decimales para que dos repintados
 * con el mismo progreso no cuenten como un cambio y disparen la transición.
 */
function paintXp(el, ratio) {
  if (!el) return;
  const fill = Math.max(0, Math.min(1, Number(ratio) || 0));
  el.style.setProperty('--fill', fill.toFixed(2));
}

function mixHex(a, b, amount) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const t = Math.max(0, Math.min(1, amount));
  const ch = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * t);
  return `#${[ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

async function refreshThemeVars() {
  const vars = await guard(tvm.theme.vars(), 'Error');
  applyThemeVars(vars);
}

async function patchConfig(patch) {
  const next = await guard(tvm.config.set(patch), 'Error');
  if (next) applyConfig(next);
  return next;
}

/* ══════════════════════════════════════════════════════════
   Fábrica de filas
   ══════════════════════════════════════════════════════════
   Antes había tres maneras de dibujar lo mismo: `switchRow` para los
   interruptores, un `.field` armado a mano para los selectores y las barras, y
   `.looksrow` para lo que iba en fila. Cada una decidía por su cuenta dónde
   ponía la etiqueta, de qué tamaño y con cuánto aire, y por eso dos controles
   vecinos casi nunca arrancaban a la misma altura.

   Ahora sale todo de acá: nombre a la izquierda, control a la derecha.

   La descripción es OPCIONAL y va con una regla: sólo si dice algo que el
   nombre no dice, y en una línea. Lo que necesita un párrafo no se muestra
   siempre — se pasa como `hint` y queda guardado en el `ⓘ` que aparece al lado
   del nombre. Eso es lo que sacó de la pantalla las ~490 palabras de notas que
   había repartidas por Aspecto y Ajustes.
   ══════════════════════════════════════════════════════════ */

/**
 * Una fila del panel.
 *
 * `control` puede ser un nodo o una lista; van todos dentro de `.row__ctl`.
 * Con `block: true` el control baja abajo y ocupa el ancho entero, que es lo
 * que hace falta cuando no es un control sino una grilla (los temas, las
 * teclas, los degradados).
 */
function settingRow({ label, description, hint, control, block = false, id, className }) {
  const row = document.createElement('div');
  row.className = `row${block ? ' row--block' : ''}${className ? ` ${className}` : ''}`;
  if (id) row.id = id;

  if (label || description || hint) {
    const text = document.createElement('div');
    text.className = 'row__text';

    const title = document.createElement('span');
    title.className = 'row__label';
    title.append(document.createTextNode(label || ''));
    if (hint) title.append(hintMark(hint));
    text.append(title);

    if (description) {
      const desc = document.createElement('span');
      desc.className = 'row__desc';
      desc.textContent = description;
      text.append(desc);
    }
    row.append(text);
  }

  const ctl = document.createElement('div');
  ctl.className = 'row__ctl';
  for (const node of [].concat(control || [])) if (node) ctl.append(node);
  row.append(ctl);
  return row;
}

/** El `ⓘ`. El globo lo dibuja `showHint`; acá va sólo la marca. */
function hintMark(text) {
  const mark = document.createElement('i');
  mark.className = 'hint';
  mark.tabIndex = 0;
  mark.textContent = 'i';
  mark.dataset.hintText = text;
  mark.setAttribute('aria-label', isEn() ? 'More information' : 'Más información');
  return mark;
}

function buildSwitches(container, items, onToggle) {
  container.replaceChildren();
  for (const item of items) container.append(switchRow(item, onToggle));
}

function switchRow(item, onToggle) {
  const toggle = document.createElement('button');
  toggle.className = 'switch';
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', item.label);

  const sync = (value) => {
    toggle.classList.toggle('is-on', !!value);
    toggle.setAttribute('aria-checked', String(!!value));
  };
  sync(item.value());

  toggle.addEventListener('click', async () => {
    const rd = document.documentElement.dataset;
    if (rd.animations !== 'off' && rd.toggleBounce !== 'off') {
      toggle.classList.remove('is-pop');
      void toggle.offsetWidth; // reinicia la animación si se aprieta rápido
      toggle.classList.add('is-pop');
      toggle.addEventListener('animationend', () => toggle.classList.remove('is-pop'), { once: true });
    }
    sync(!item.value());
    await onToggle(item, !item.value());
    sync(item.value());
  });

  const row = settingRow({
    label: item.label,
    description: item.description,
    hint: item.hint,
    control: toggle
  });

  /*
   * El ↻ de «pide reinicio» se colgaba del final de la descripción, así que un
   * interruptor sin descripción no podía mostrarlo — y varias de las banderas
   * del motor no la tienen. Ahora la marca se agrega a la descripción si ya
   * existe y se crea una línea propia si no.
   */
  if (item.restart) {
    const em = document.createElement('em');
    em.textContent = `↻ ${t('perf.restartMark')}`;
    const existing = row.querySelector('.row__desc');
    if (existing) existing.append(' · ', em);
    else {
      const line = document.createElement('span');
      line.className = 'row__desc';
      line.append(em);
      row.querySelector('.row__text').append(line);
    }
  }

  return row;
}

/** Una fila con un `<select>`. `options` son `[valor, texto]`. */
function selectRow({ label, description, hint, id, options, value, onChange, block = false }) {
  const select = document.createElement('select');
  if (id) select.id = id;
  for (const [optValue, optLabel] of options) {
    const option = document.createElement('option');
    option.value = String(optValue);
    option.textContent = optLabel;
    select.append(option);
  }
  select.value = String(value);
  select.addEventListener('change', () => onChange(select.value, select));
  const row = settingRow({ label, description, hint, control: select, block });
  row.dataset.ctl = 'select';
  return row;
}

/**
 * Una fila con una barra y su número al lado.
 *
 * `onInput` corre mientras se arrastra (para lo que se ve al instante) y
 * `onChange` al soltar (para lo que se guarda). Separarlos no es un detalle:
 * guardar en cada `input` escribe el config.json una vez por píxel del
 * arrastre.
 */
function rangeRow({ label, description, hint, id, min, max, step, value, format, onInput, onChange, block = false }) {
  const input = document.createElement('input');
  input.type = 'range';
  if (id) input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  const shown = document.createElement('b');
  shown.className = 'row__val';
  const fmt = format || ((v) => v);
  shown.textContent = fmt(value);

  input.addEventListener('input', () => {
    syncRangeFill(input);
    shown.textContent = fmt(Number(input.value));
    if (onInput) onInput(Number(input.value));
  });
  if (onChange) input.addEventListener('change', () => onChange(Number(input.value)));

  // El relleno se calcula con el ancho, así que hay que pedirlo una vez que el
  // elemento ya está en el documento.
  queueMicrotask(() => syncRangeFill(input));

  const row = settingRow({ label, description, hint, control: [input, shown], block });
  row.dataset.ctl = 'range';
  return row;
}

/** Una fila que es sólo un aviso en medio de una lista de filas. */
function noteRow(text, warn = false) {
  const row = document.createElement('div');
  row.className = 'row row--text';
  const p = document.createElement('p');
  p.className = `note${warn ? ' note--warn' : ''}`;
  p.textContent = text;
  row.append(p);
  return row;
}

/* ══════════════════════════════════════════════════════════
   El `ⓘ`
   ══════════════════════════════════════════════════════════
   Un solo globo para toda la app. No puede vivir adentro de la fila: la página
   tiene `overflow-y: auto` y la tarjeta del panel `overflow: hidden` MÁS
   `contain: paint`, que además la convierte en el bloque contenedor de
   cualquier `position: fixed` de adentro. Un globo hijo se cortaría contra las
   dos cosas. Éste cuelga de `<body>` y se posiciona a mano.
   ══════════════════════════════════════════════════════════ */
let hintTip = null;

function hintText(mark) {
  return mark.dataset.hintText || (mark.dataset.hint ? t(mark.dataset.hint) : '');
}

function showHint(mark) {
  const text = hintText(mark);
  if (!text) return;

  if (!hintTip) {
    hintTip = document.createElement('div');
    hintTip.className = 'hinttip';
    hintTip.setAttribute('role', 'tooltip');
    document.body.append(hintTip);
  }
  hintTip.textContent = text;
  hintTip.hidden = false;

  // Se mide DESPUÉS de escribir el texto: el alto depende de cuántas líneas
  // entren, y eso no se sabe hasta que el texto está adentro.
  const anchor = mark.getBoundingClientRect();
  const tip = hintTip.getBoundingClientRect();
  const margin = 8;

  let left = anchor.left + anchor.width / 2 - tip.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tip.width - margin));

  // Arriba del `ⓘ` salvo que no entre, y ahí abajo.
  let top = anchor.top - tip.height - 6;
  if (top < margin) top = anchor.bottom + 6;

  hintTip.style.left = `${Math.round(left)}px`;
  hintTip.style.top = `${Math.round(top)}px`;
}

function hideHint() {
  if (hintTip) hintTip.hidden = true;
}

document.addEventListener('pointerover', (e) => {
  const mark = e.target.closest && e.target.closest('.hint');
  if (mark) showHint(mark);
  else if (hintTip && !hintTip.hidden) hideHint();
});
document.addEventListener('focusin', (e) => {
  const mark = e.target.closest && e.target.closest('.hint');
  if (mark) showHint(mark);
});
document.addEventListener('focusout', hideHint);
/*
 * El globo es `position: fixed` y no sabe nada de lo que lo ancló: si eso se
 * mueve, se queda flotando sobre otra cosa. Los tres casos en que se mueve sin
 * que el mouse se mueva:
 *
 *   · scroll de la página (por eso va en captura: el que scrollea es el
 *     contenedor, y ese evento no burbujea);
 *   · cambio de tamaño de la ventana — entrar o salir de pantalla completa con
 *     el mouse quieto sobre un `ⓘ` lo dejaba clavado arriba de todo;
 *   · el mouse se va de la ventana, que no dispara ningún `pointerover` nuevo.
 */
document.addEventListener('scroll', hideHint, true);
window.addEventListener('resize', hideHint);
window.addEventListener('blur', hideHint);
document.addEventListener('pointerleave', hideHint);

/* ══════════════════════════════════════════════════════════
   Índice de secciones y buscador
   ══════════════════════════════════════════════════════════
   Las cuatro pestañas de ajustes suman unos sesenta controles. Sin un índice,
   encontrar uno era scrollear y leer; y sin buscador, saber de antemano en cuál
   de las cuatro estaba.

   El índice se arma leyendo el HTML, no una lista aparte: cualquier
   `[data-sec]` dentro de la página activa entra solo. El título sale de su
   `.sec__title` (o del `data-sec-label`, para el `<details>` de «Avanzado»),
   así que se traduce con el resto de la página y no hay dos copias del mismo
   texto que se puedan ir a distinto lado.

   El buscador filtra las CUATRO páginas a la vez, no sólo la abierta: escribís
   «gol» y el índice te muestra que hay algo en Aspecto y algo en Cuenta, con
   cuántas filas en cada una. Ésa es la parte que no se podía resolver
   scrolleando.

   Lo que el filtro esconde se marca con la clase `is-filtered` y NO con la
   propiedad `hidden`. No es lo mismo: `hidden` ya lo usa la app para cosas que
   no vienen al caso (la sección de rivales sin datos, el largo de la estela con
   la estela apagada, el tamaño personalizado de ventana). Si el filtro usara
   `hidden`, al limpiar la búsqueda las destaparía a todas.
   ══════════════════════════════════════════════════════════ */
const NAV_PAGES = ['aspecto', 'ajustes'];
const NAV_PAGE_LABEL = {
  aspecto: 'nav.personalize',
  ajustes: 'nav.config'
};

/** La solapa abierta de cada página. */
const panelTab = { aspecto: 'estilo', ajustes: 'rendimiento' };

function currentTab(page) {
  const tabs = PANEL_TABS[page] || [];
  return (tabs.find((x) => x.id === panelTab[page]) || tabs[0] || {}).id;
}

/** Muestra sólo lo de la solapa abierta (secciones y tarjetas que abren ventanas). */
function applyTab(page) {
  const el = navPage(page);
  if (!el || !PANEL_TABS[page]) return;
  const cur = currentTab(page);
  for (const node of $$('[data-tab]', el)) node.classList.toggle('is-tab-off', node.dataset.tab !== cur);
  // Orden de entrada de las secciones que se ven (ver «Las filas entran de a una» en app.css).
  let i = 0;
  for (const sec of $$('.page__inner > .sec', el)) {
    if (!sec.classList.contains('is-tab-off')) sec.style.setProperty('--i', String(i++));
  }
  paintPreview();
}

/** Las páginas que llevan índice. Replays no: es una lista con su buscador. */
function navPage(name) {
  return NAV_PAGES.includes(name) ? $(`.page[data-page="${name}"]`) : null;
}

/** ¿Se ve? Cuenta tanto lo que escondió la app como lo que escondió el filtro. */
function isShown(el) {
  return !el.hidden && !el.classList.contains('is-filtered');
}

/**
 * El título que muestra el índice para una sección.
 *
 * Se le saca el `ⓘ`: es una `<i>` con la letra «i» adentro, así que sin esto
 * el índice decía «La canchai».
 */
function secTitle(sec) {
  if (sec.dataset.secLabel) return t(sec.dataset.secLabel);
  const title = sec.querySelector('.sec__title');
  if (!title) return sec.dataset.sec;
  const copia = title.cloneNode(true);
  for (const marca of copia.querySelectorAll('.hint')) marca.remove();
  return copia.textContent.trim();
}

/** Todo el texto por el que se puede encontrar una fila, incluido su `ⓘ`. */
function rowText(row) {
  const hints = $$('.hint', row).map(hintText).join(' ');
  return `${row.textContent} ${hints}`.toLowerCase();
}

/**
 * Aplica el filtro a una página y devuelve cuántas filas quedaron por sección.
 * Sin búsqueda destapa todo y devuelve `null`, que es lo que le dice al índice
 * que no dibuje contadores.
 */
function filterPage(page, query) {
  const counts = new Map();
  for (const sec of $$('[data-sec]', page)) {
    const rows = $$('.row', sec);
    if (!query) {
      sec.classList.remove('is-filtered');
      for (const row of rows) row.classList.remove('is-filtered');
      continue;
    }
    // El nombre de la sección también cuenta: buscar «audio» tiene que traer la
    // sección Audio entera y no sólo las filas que digan esa palabra.
    const secHit = secTitle(sec).toLowerCase().includes(query);
    let hits = 0;
    for (const row of rows) {
      const hit = secHit || rowText(row).includes(query);
      row.classList.toggle('is-filtered', !hit);
      if (hit && !row.hidden) hits++;
    }
    counts.set(sec.dataset.sec, hits);
    sec.classList.toggle('is-filtered', hits === 0);
    // Un `<details>` con resultados adentro se abre solo: si no, el índice dice
    // que hay tres coincidencias en «Avanzado» y no se ve ninguna.
    if (hits > 0 && sec.tagName === 'DETAILS') sec.open = true;
  }
  return counts;
}

/** El cartel de «no encontré nada», al fondo de la página activa. */
function paintEmptyState(page, show) {
  const previo = $('.page__empty', page);
  if (previo) previo.remove();
  if (!show) return;
  const box = emptyState(t('panel.noResults'), t('panel.noResultsText'));
  box.classList.add('page__empty');
  $('.page__inner', page).append(box);
}

/**
 * Dibuja el índice de la pestaña abierta.
 *
 * Con el buscador vacío lista las secciones de la página activa. Con algo
 * escrito lista las secciones CON RESULTADOS de las cuatro páginas, agrupadas
 * por pestaña y con el número de coincidencias al costado.
 */
function buildPanelNav() {
  const list = $('#panelNavList');
  const input = $('#settingsSearch');
  if (!list || !input) return;

  const query = (input.value || '').trim().toLowerCase();
  const activa = state.view;
  const panel = $('#panel');
  list.replaceChildren();
  panel.classList.toggle('is-searching', Boolean(query));

  /*
   * Sin búsqueda: las solapas de la página, grandes y con una línea que dice qué
   * hay adentro. Son pocas a propósito —dos o cuatro— para que se vea de un
   * vistazo dónde está cada cosa.
   */
  if (!query) {
    for (const name of NAV_PAGES) {
      const page = navPage(name);
      if (page) { filterPage(page, ''); paintEmptyState(page, false); }
    }
    let lastGroup = '';
    for (const tab of PANEL_TABS[activa] || []) {
      if (tab.group && tab.group !== lastGroup) {
        lastGroup = tab.group;
        const gh = document.createElement('span');
        gh.className = 'pnav__group';
        gh.dataset.i18n = tab.group;
        gh.textContent = t(tab.group);
        list.append(gh);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pnav__tab';
      btn.dataset.go = tab.id;
      btn.classList.toggle('is-on', tab.id === currentTab(activa));
      const title = document.createElement('b');
      title.dataset.i18n = tab.label;
      title.textContent = t(tab.label);
      const hint = document.createElement('small');
      hint.dataset.i18n = tab.hint;
      hint.textContent = t(tab.hint);
      const ic = document.createElement('span');
      ic.className = 'pnav__ic';
      ic.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TAB_ICONS[tab.id] || ''}"/></svg>`;
      const txt = document.createElement('span');
      txt.className = 'pnav__tx';
      txt.append(title, hint);
      btn.append(ic, txt);
      list.append(btn);
    }
    applyTab(activa);
    renderTabBar(activa);
    $('#settingsSearchClear').hidden = true;
    return;
  }

  /*
   * Con algo escrito: se destapan todas las solapas y el índice lista las
   * secciones CON RESULTADOS de las dos páginas, agrupadas por página y con la
   * cantidad de coincidencias.
   */
  for (const name of NAV_PAGES) {
    for (const node of $$('[data-tab]', navPage(name))) node.classList.remove('is-tab-off');
  }

  let total = 0;
  for (const name of NAV_PAGES) {
    const page = navPage(name);
    if (!page) continue;

    const counts = filterPage(page, query);
    // Una sección que la app esconde por su cuenta —los rivales sin datos, el
    // cartel de música apagado— no va al índice: sería un renglón que no lleva
    // a ningún lado.
    const secs = $$('[data-sec]', page).filter(isShown);
    const hits = secs.reduce((n, sec) => n + (counts.get(sec.dataset.sec) || 0), 0);
    total += hits;
    if (!hits) continue;

    const head = document.createElement('span');
    head.className = 'pnav__group';
    head.textContent = t(NAV_PAGE_LABEL[name]);
    list.append(head);

    for (const sec of secs) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'pnav__i';
      item.dataset.goPage = name;
      item.dataset.goSec = sec.dataset.sec;
      item.append(document.createTextNode(secTitle(sec)));
      const n = document.createElement('span');
      n.className = 'pnav__n';
      n.textContent = String(counts.get(sec.dataset.sec) || 0);
      item.append(n);
      list.append(item);
    }
  }

  const page = navPage(activa);
  if (page) paintEmptyState(page, total === 0);

  $('#settingsSearchClear').hidden = false;
  syncNavSpy();
}

/**
 * Abrir una pestaña parado en una sección.
 *
 * Es lo que necesitan los atajos que vienen de afuera del panel —el menú de
 * «yo», el botón de cambiar apodo, el engranaje de adentro del juego—: antes
 * cada uno hacía `setView` y después buscaba un id a mano con
 * `scrollIntoView`, y cuando la tarjeta se mudaba de página el atajo quedaba
 * apuntando a un elemento que ya no estaba ahí, sin fallar y sin hacer nada.
 */
function goToSection(page, sec) {
  const target = $(`[data-sec="${sec}"]`);
  if (target && target.dataset.tab) panelTab[page] = target.dataset.tab;
  setView(page);
  requestAnimationFrame(() => {
    const el = $(`[data-sec="${sec}"]`);
    if (!el) return;
    if (el.dataset.modal) openSecModal(sec);
    else { setSecOpen(el, true); el.scrollIntoView({ block: 'start' }); }
  });
}

/** Abrir una página parada en una solapa. */
function goToTab(page, tab) {
  panelTab[page] = tab;
  if (state.view !== page) { setView(page); return; }
  buildPanelNav();
  const el = navPage(page);
  if (el) el.scrollTop = 0;
}

/*
 * ═══ Secciones en ventana propia ═══
 *
 * La sección se muda al contenedor de la ventana y vuelve a su lugar al cerrar:
 * no se copia ni se reescribe, así que todo lo que el resto de la app le tiene
 * enganchado (ids, escuchas, el redibujado) sigue funcionando igual.
 */
let secModal = null;

function openSecModal(id) {
  if (secModal) closeSecModal();
  const sec = $(`.page [data-sec="${id}"]`);
  if (!sec) return;
  const anchor = document.createComment(`sec:${id}`);
  sec.before(anchor);
  sec.classList.remove('is-tab-off');
  $('#secModalBody').append(sec);
  // Las líneas y tamaños se ven en el acto: una vista previa arriba de la ventana.
  if (id === 'trazos') {
    const pv = document.createElement('div');
    pv.className = 'pv pv--modal';
    pv.innerHTML = '<canvas id="pvCanvas2" width="1200" height="500"></canvas>';
    $('#secModalBody').prepend(pv);
  }
  $('#secModal').hidden = false;
  secModal = { sec, anchor, id };
  paintPreview();
  $('#secModalClose').focus();
}

function closeSecModal() {
  if (!secModal) return;
  const { sec, anchor } = secModal;
  secModal = null;
  const pv2 = $('.pv--modal');
  if (pv2) pv2.remove();
  if (anchor.parentNode) anchor.replaceWith(sec);
  $('#secModal').hidden = true;
  applyTab(state.view);
}

$('#secModalClose').addEventListener('click', closeSecModal);
$('#secModalScrim').addEventListener('click', closeSecModal);
/*
 * En el panel y no en `document`: el panel corta la propagación de los clics
 * (ver `PANEL_BLOCK_EVENTS`), así que un oyente de más arriba no los recibe nunca.
 * Las tarjetas se escuchan acá, donde el clic todavía llega.
 */
$('#panel').addEventListener('click', (e) => {
  const card = e.target.closest && e.target.closest('.launch');
  if (card) openSecModal(card.dataset.launch);
});

/**
 * Limpia el filtro de TODAS las páginas.
 *
 * Hace falta al cerrar el panel: si no, la próxima vez que se abre aparece la
 * página filtrada por una búsqueda de la sesión anterior y con el campo vacío,
 * o sea media pestaña que no está y ninguna explicación de por qué.
 */
function clearPanelSearch() {
  const input = $('#settingsSearch');
  if (input) input.value = '';
  for (const name of NAV_PAGES) {
    const page = navPage(name);
    if (page) { filterPage(page, ''); paintEmptyState(page, false); }
  }
}

/*
 * ═══ Qué sección estás mirando ═══
 *
 * Se marca la última cuyo borde de arriba ya pasó la línea de lectura, que es
 * lo que el ojo entiende por «estoy en ésta». Se calcula dentro de un
 * `requestAnimationFrame` y no en cada evento de scroll: el scroll dispara
 * decenas de veces por segundo y esto lee posiciones, que es justo lo que
 * obliga al navegador a maquetar.
 */
let spyPending = false;

function syncNavSpy() {
  const page = navPage(state.view);
  const list = $('#panelNavList');
  if (!page || !list) return;

  const secs = $$('[data-sec]', page).filter(isShown);
  if (!secs.length) return;

  const linea = page.getBoundingClientRect().top + 56;
  let actual = secs[0].dataset.sec;
  for (const sec of secs) {
    if (sec.getBoundingClientRect().top <= linea) actual = sec.dataset.sec;
  }
  // Al final del scroll gana la última: si no, una sección corta abajo de todo
  // nunca llega a cruzar la línea y el índice se queda una atrás para siempre.
  if (page.scrollTop + page.clientHeight >= page.scrollHeight - 4) {
    actual = secs[secs.length - 1].dataset.sec;
  }

  for (const item of $$('.pnav__i', list)) {
    item.classList.toggle('is-on', item.dataset.goSec === actual && item.dataset.goPage === state.view);
  }
}

function scheduleNavSpy() {
  if (spyPending) return;
  spyPending = true;
  requestAnimationFrame(() => { spyPending = false; syncNavSpy(); });
}

$('#panelNavList').addEventListener('click', (e) => {
  const tab = e.target.closest('.pnav__tab');
  if (tab) { goToTab(state.view, tab.dataset.go); return; }
  const item = e.target.closest('.pnav__i');
  if (!item) return;
  const { goPage, goSec } = item.dataset;
  const destino = $(`[data-sec="${goSec}"]`);
  if (destino && destino.dataset.tab) panelTab[goPage] = destino.dataset.tab;
  const saltar = () => {
    const sec = $(`.page[data-page="${goPage}"] [data-sec="${goSec}"]`);
    if (sec) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  if (goPage !== state.view) { setView(goPage); requestAnimationFrame(saltar); }
  else saltar();
});

$('#settingsSearch').addEventListener('input', buildPanelNav);
$('#settingsSearchClear').addEventListener('click', () => {
  clearPanelSearch();
  buildPanelNav();
  $('#settingsSearch').focus();
});
// Escape con algo escrito limpia la búsqueda en vez de cerrar el panel: cerrarlo
// pierde lo que estabas buscando y hay que volver a entrar.
$('#settingsSearch').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !e.currentTarget.value) return;
  e.stopPropagation();
  e.preventDefault();
  clearPanelSearch();
  buildPanelNav();
});

for (const page of $$('.page')) page.addEventListener('scroll', scheduleNavSpy, { passive: true });

function syncRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

function emptyState(title, text) {
  const box = document.createElement('div');
  box.className = 'empty';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  box.append(strong, p);
  return box;
}

function paintDefList(target, rows) {
  target.replaceChildren();
  for (const [label, value] of rows) {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dd.title = value;
    wrap.append(dt, dd);
    target.append(wrap);
  }
}

/* ══════════════════════════════════════════════════════════
   Pedir un texto
   ══════════════════════════════════════════════════════════
   Electron no implementa window.prompt: devuelve null siempre y sin errores.
   Por eso «Renombrar» en los replays no hacía nada. Este modal lo reemplaza.
   ══════════════════════════════════════════════════════════ */
let askResolve = null;

function ask({ title, label, value = '', hint = '', ok, maxLength = 120 }) {
  $('#askTitle').textContent = title;
  $('#askLabel').textContent = label;
  $('#askOk').textContent = ok || t('ask.ok');
  $('#askInput').value = value;
  $('#askInput').maxLength = maxLength;
  $('#askHint').textContent = hint;
  $('#askHint').hidden = !hint;
  $('#askModal').hidden = false;
  $('#askInput').focus();
  $('#askInput').select();

  return new Promise((resolve) => { askResolve = resolve; });
}

function closeAsk(value) {
  $('#askModal').hidden = true;
  const resolve = askResolve;
  askResolve = null;
  if (resolve) resolve(value);
}

$('#askForm').addEventListener('submit', (e) => {
  e.preventDefault();
  closeAsk($('#askInput').value);
});
$('#askCancel').addEventListener('click', () => closeAsk(null));
$('#askClose').addEventListener('click', () => closeAsk(null));
$('#askModal').addEventListener('click', (e) => {
  if (e.target === $('#askModal')) closeAsk(null);
});

/* ══════════════════════════════════════════════════════════
   Navegación
   ══════════════════════════════════════════════════════════ */
/*
 * La navegación es el riel de la izquierda. Antes era una botonera horizontal
 * en la barra de arriba con una pastilla que se deslizaba al activo; la
 * pastilla se fue con ella y no hay nada que recolocar al cambiar de pestaña ni
 * al redimensionar (`movePill` existía sólo para eso).
 */
const nav = $('#rail');

/**
 * Muestra u oculta el panel, separando el trabajo caro de la animación.
 *
 * Abrir una página del panel por primera vez cuesta entre 23 y 74 ms de
 * maquetado —medido: Aspecto es la peor, con los temas, el avatar y el
 * overlay—. Si la animación de entrada arranca en ese mismo instante, esos
 * milisegundos se comen los primeros cuadros y se ve el tirón.
 *
 * Así que va en dos pasos: primero se muestra (y se fuerza el maquetado leyendo
 * `offsetHeight`, que obliga al navegador a hacer la cuenta ahora), y recién en
 * el cuadro siguiente se enciende la transición, que ya no tiene nada pesado
 * encima.
 */
/**
 * Maquetar las páginas del panel una vez, al arrancar.
 *
 * Medido en el cliente real: la PRIMERA vez que se abre cada página cuesta
 * 39 ms Rendimiento y 57 ms Aspecto; de ahí en adelante, 5 ms. O sea que el
 * tirón no es de todas las veces — es de la primera de cada pestaña, y como uno
 * las va abriendo de a una, se siente en todas.
 *
 * Acá se paga ese precio de una sola vez mientras la app todavía está
 * arrancando y nadie está mirando. El panel se muestra sin la clase `is-open`,
 * así que el velo y la tarjeta están en opacidad cero: no se ve nada, y todo
 * pasa dentro de una misma tarea, sin que se dibuje ningún cuadro en el medio.
 */
function warmPanel() {
  const panel = $('#panel');
  const pages = $$('.page');
  const activa = pages.find((p) => p.classList.contains('is-active')) || null;
  const estaba = panel.hidden;

  panel.hidden = false;
  for (const page of pages) {
    pages.forEach((p) => p.classList.toggle('is-active', p === page));
    void page.offsetHeight;
  }
  pages.forEach((p) => p.classList.toggle('is-active', p === activa));
  panel.hidden = estaba;
}

/**
 * Muestra u oculta el panel.
 *
 * Lo único que se anima es el velo, y es un color plano: se compone sin
 * repintar nada. Por eso alcanza con encender la clase acá mismo — leer
 * `offsetHeight` en el medio fija el estado de partida para que la transición
 * tenga desde dónde salir.
 *
 * Antes esto esperaba dos cuadros para arrancar, porque la tarjeta también se
 * animaba y había que sacarle el maquetado de encima. Esa animación ya no
 * existe (ver el comentario en app.css), así que se fue también la espera —y
 * con ella el riesgo de quedarse invisible si los cuadros no llegaban.
 */
/* Eventos del mouse/teclado sobre el panel no necesitan propagarse más allá:
   evita que handlers globales del documento procesen clics que ya manejó la UI. */
const PANEL_BLOCK_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'pointerdown', 'pointerup'];
const panelBlockHandler = (e) => e.stopPropagation();

/*
 * Sólo el panel. Avisarle al juego que hay algo encima lo hace `setView`, que es
 * el que sabe de las DOS cosas que lo tapan: este panel y la pestaña Música.
 */
function openPanel(open) {
  const panel = $('#panel');
  if (!open) {
    panel.classList.remove('is-open');
    panel.hidden = true;
    for (const evt of PANEL_BLOCK_EVENTS) panel.removeEventListener(evt, panelBlockHandler);
    return;
  }
  if (!panel.hidden) return; // ya estaba abierto: se cambió de pestaña, nada más
  panel.hidden = false;
  void panel.offsetHeight;
  panel.classList.add('is-open');
  for (const evt of PANEL_BLOCK_EVENTS) panel.addEventListener(evt, panelBlockHandler);
}

function setView(name) {
  if (state.hub) openHub(false);
  state.view = name;
  $('#app').dataset.view = name;
  document.documentElement.dataset.view = name;

  $$('.railitem').forEach((item) => item.classList.toggle('is-active', item.dataset.view === name));

  // Primero todos los cambios de clase y recién después el scroll. Escribir
  // `scrollTop` en el medio del bucle obliga a maquetar ahí mismo, y con cuatro
  // páginas eso eran cuatro maquetados forzados por cada cambio de pestaña.
  let activa = null;
  for (const page of $$('.page')) {
    const esActiva = page.dataset.page === name;
    page.classList.toggle('is-active', esActiva);
    if (esActiva) activa = page;
  }
  if (activa && activa.scrollTop !== 0) activa.scrollTop = 0;
  // La verificación de Cloudflare flota por encima de este documento, así que
  // no se esconde sola al cambiar de pestaña: taparía Ajustes. Ver
  // `syncVerifyBounds`.
  syncVerifyBounds();
  // Acomodar un cartel se hace sobre la cancha: abrir cualquier panel encima es
  // dejar de acomodarlo, igual que tocar en otro lado del juego.
  if (name !== 'play') stopKeysMoving();

  /*
   * El índice de secciones sólo tiene sentido en las cuatro pestañas de
   * ajustes. Replays trae su propia lista y su propio buscador, así que ahí la
   * columna de la izquierda no se dibuja y la página se queda con todo el
   * ancho (ver `[data-nav="off"]` en app.css).
   */
  $('#panel').dataset.nav = NAV_PAGES.includes(name) ? 'on' : 'off';
  openPanel(name !== 'play');
  // Para el juego las dos cosas son lo mismo: con cualquiera de ellas encima
  // nadie está mirando la cancha y puede bajar el ritmo.
  tvm.game.panel(name !== 'play');

  if (name === 'replays') loadReplays();
  if (name === 'cuenta') loadAuth();
  if (name === 'club') { loadClubRank(); loadKings(); }
  if (name === 'hostear') loadHostState();
  if (name === 'informes') loadReports();
  /*
   * El índice se rearma en cada cambio de pestaña porque lista las secciones de
   * la que está abierta. Va DESPUÉS del `scrollTop = 0` de arriba: el marcador
   * de «estoy en ésta» se calcula con posiciones reales, y con el scroll a
   * medio camino marcaría la sección equivocada por un cuadro.
   */
  if (NAV_PAGES.includes(name)) buildPanelNav();
  if (name === 'play' && state.stage === 'browser') refreshRoomsIfStale();
}

/**
 * Las teclas, de vuelta a la cancha.
 *
 * Todo lo que se abre encima del juego —el dock de amigos, el perfil, pasar a
 * pantalla completa— se lleva el foco al documento de la app, que no usa las
 * teclas para nada. Desde afuera se ve un juego que dejó de responder: la
 * pelota se sigue moviendo pero tu jugador no, hasta que hacés clic en la
 * cancha. Por eso el que se lo llevó tiene que devolverlo.
 */
function focusGame() {
  if (state.stage === 'game' && state.webview) state.webview.focus();
}

/** Cortina con el escudo al entrar a una sala: un solo nodo que se borra al terminar. */
function roomCurtain() {
  const rd = document.documentElement.dataset;
  if (rd.animations === 'off' || rd.roomCurtain === 'off' || document.querySelector('.room-curtain')) return;
  const c = document.createElement('div');
  c.className = 'room-curtain';
  c.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.src = '../../assets/toda-la-lecce.png';
  img.alt = '';
  c.append(img);
  document.body.append(c);
  setTimeout(() => c.remove(), 1300);
}

/** El juego se muestra sólo dentro de una sala; si no, mandamos nuestra lista. */
function setStage(kind) {
  if (state.stage === kind) return;
  state.stage = kind;
  $('#app').dataset.stage = kind;
  if (kind === 'game') roomCurtain();
  if (window.TLMusic) window.TLMusic.setInGame(kind === 'game');
  if (kind === 'browser') setTimeout(showNoticeIfReady, 600);
  // El fondo ambiental se apaga cuando hay cancha detrás, no cuando estás en la
  // pestaña Salas: con los paneles encima son cosas distintas.
  document.documentElement.dataset.stage = kind;
  if (kind === 'game' && state.hub) openHub(false);
  paintNavExtras();
  if (kind === 'browser') {
    // Fuera de una sala no hay nombre que mostrar: si quedara guardado, la
    // próxima sala arrancaría con el nombre de la anterior.
    state.gameRoomName = null;
    state.joinedRoomName = null;
    refreshRoomsIfStale();
  }
  pushPresence();
}

/**
 * Deja escrito en `<html>` si el riel está afuera, para que los avisos se corran.
 *
 * Dentro de una sala el riel se esconde y vuelve solo al pasar el mouse por el
 * borde izquierdo (`.railedge:hover ~ .rail`). Los avisos, con el riel guardado,
 * cuelgan de ese mismo borde — así que cuando el riel volvía le caía justo
 * encima: tapaba los botones de navegación y, como el aviso sí recibe el
 * puntero, además se comía el clic. El riel quedaba muerto mientras hubiera un
 * cartel en pantalla.
 *
 * El hover pasa adentro de `.app` y los avisos son hermanos de `.app`, así que
 * en CSS no hay cómo llegar: haría falta `:has()`, que no existe en el Chromium
 * de Electron 13. Se sube a mano acá y el resto lo hace el CSS.
 *
 * Se escucha en los DOS elementos porque el riel se queda afuera con el mouse en
 * cualquiera de ellos, y son la misma condición partida en dos cajas: apoyar el
 * mouse en el borde lo saca, y moverlo hacia los botones lo mantiene.
 */
function watchRail() {
  const root = document.documentElement;
  const out = () => { root.dataset.rail = 'out'; };
  const back = () => { delete root.dataset.rail; };
  for (const el of [$('#railEdge'), nav]) {
    el.addEventListener('mouseenter', out);
    el.addEventListener('mouseleave', back);
  }
}
watchRail();

nav.addEventListener('click', (e) => {
  const item = e.target.closest('.railitem');
  if (!item || !item.dataset.view) return;
  // Volver a tocar la pestaña abierta cierra el panel, como cualquier menú.
  setView(item.dataset.view === state.view ? 'play' : item.dataset.view);
});

/** Cierra el panel y vuelve al fondo (la cancha o la lista de salas). */
function closePanel() {
  closeSecModal();
  // La búsqueda no sobrevive al cierre: volver a abrir y encontrarse media
  // pestaña filtrada por algo que escribiste hace rato, con el campo vacío, se
  // lee como una pestaña rota.
  clearPanelSearch();
  if (state.view !== 'play') setView('play');
}

/* ── Tu perfil ─────────────────────────────────────────────────────────────
 *
 * El chip de la barra abre esto. Es lo único de la interfaz que responde «quién
 * sos» sin obligarte a entrar a una pestaña: antes el apodo estaba en Ajustes,
 * el rol en Aspecto y la foto en ningún lado.
 *
 * NO muestra cuándo vence el VIP. `discord.expiresAt` es el `exp` del token que
 * firma el sitio (ver vip.js), o sea cuándo hay que volver a preguntar — no
 * cuándo se te cae el rol. Poner esa fecha sería decir algo que no es.
 */
function meMenuOpen() {
  return !$('#meMenu').hidden;
}

function paintMeChip() {
  const profile = vipProfile();
  const nick = state.config.general.nickname || t('me.noNick');
  const vip = isVip();

  $('#meChipName').textContent = profile ? profile.username : nick;
  $('#meChipVip').hidden = true; // TL App no tiene niveles VIP
  paintFace($('#meChipAvatar'), profile ? { name: profile.username, avatar: profile.avatar } : { name: nick });
  paintProfCard();
}

/** La tarjeta del riel: nombre, foto, nivel con su barra y partidos / goles / asistencias. */
function paintProfCard() {
  const card = $('#profCard');
  if (!card || !state.config) return;
  const profile = vipProfile();
  const nick = state.config.general.nickname || t('me.noNick');
  const name = profile ? profile.username : nick;
  const lv = withLevel(state.config.stats || {});
  $('#profCardName').textContent = name;
  paintFace($('#profCardAv'), profile ? { name: profile.username, avatar: profile.avatar } : { name: nick });
  $('#profCardLvl').textContent = (isEn() ? 'Level ' : 'Nivel ') + lv.level;
  const pct = Math.max(3, Math.min(100, Math.round((lv.levelInto / Math.max(1, lv.levelNeed)) * 100)));
  $('#profCardBar').style.width = `${pct}%`;
  $('#profCardRing').style.setProperty('--p', pct);
  $('#profCardBadge').textContent = String(lv.level);
  card.title = `${name} · ${isEn() ? 'Level' : 'Nivel'} ${lv.level} · ${Math.round(lv.levelInto)} / ${Math.round(lv.levelNeed)} XP`;
  $('#pcM').textContent = String(lv.matches || 0);
  $('#pcG').textContent = String(lv.goals || 0);
  $('#pcA').textContent = String(lv.assists || 0);
}
if ($('#profCard')) $('#profCard').addEventListener('click', () => openProfile());

function paintMeMenu() {
  const profile = vipProfile();
  const nick = state.config.general.nickname || '';
  const vip = isVip();

  $('#meMenuName').textContent = profile ? profile.username : (nick || t('me.noNick'));
  paintFace($('#meMenuAvatar'), profile ? { name: profile.username, avatar: profile.avatar } : { name: nick });
  $('#meMenuNick').textContent = nick;

  const estado = $('#meMenuState');
  estado.replaceChildren();
  if (vip) {
    // TL App: todos los beneficios están activos para todo el equipo, sin insignia ni vencimiento.
    const activo = document.createElement('span');
    activo.className = 'ok';
    activo.append(document.createElement('i'), document.createTextNode(t('me.vipActive')));
    estado.append(activo);

  } else {
    estado.textContent = profile ? t('me.noRole') : t('me.noSession');
  }

  $('#meMenuLogout').hidden = !profile;
  $('#meMenuSep').hidden = !profile;
}

function toggleMeMenu(on) {
  const menu = $('#meMenu');
  const abrir = on === undefined ? menu.hidden : on;
  if (abrir) paintMeMenu();
  menu.hidden = !abrir;
  $('#btnMe').classList.toggle('is-on', abrir);
  $('#btnMe').setAttribute('aria-expanded', abrir ? 'true' : 'false');
}

$('#btnMe').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMeMenu();
});

// Cualquier clic afuera lo cierra; el de adentro no tiene que atravesarlo.
$('#meMenu').addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { if (meMenuOpen()) toggleMeMenu(false); });

$('#meMenu').addEventListener('click', (e) => {
  const item = e.target.closest('.memenu__i');
  if (!item) return;
  toggleMeMenu(false);
  const que = item.dataset.me;
  if (que === 'perfil') openProfile(null);
  else if (que === 'nick') showStart(null);
  else if (que === 'aspecto') goToSection('aspecto', 'jugador');
  else if (que === 'vip') goToSection('aspecto', 'sonidos');
  else if (que === 'ajustes') goToTab('ajustes', 'juego');
});

$('#panelClose').addEventListener('click', closePanel);
$('#panelScrim').addEventListener('click', closePanel);
window.addEventListener('resize', () => {
  // Cambió el alto del panel: entran más (o menos) filas de sala en pantalla.
  paintRoomWindow(true);
});

/* ══════════════════════════════════════════════════════════
   Salas
   ══════════════════════════════════════════════════════════ */
let roomsEnter = false;
async function loadRooms() {
  state.rooms.loading = true;
  state.rooms.error = null;
  renderRooms();
  // Las filas viejas se apagan mientras llega la lista nueva, y la nueva entra en cascada.
  const hadRows = state.rooms.list && state.rooms.list.length > 0;
  const roomHost = $('#roomList');
  if (hadRows) roomHost.classList.add('is-loading');
  try {
    const data = await tvm.rooms.list();
    state.rooms = { ...data, list: data.rooms, loading: false, error: null };
    state.roomsFailures = 0;
    roomsEnter = hadRows;
  } catch (err) {
    state.rooms.loading = false;
    state.rooms.error = err.message;
    /*
     * La hora del intento se anota TAMBIÉN cuando falla.
     *
     * Sin esto, el pedido fallido no dejaba marca y `refreshRoomsIfStale` veía
     * la lista eternamente vieja: cada vez que la interfaz lo tocaba —cambiar de
     * pestaña, volver de una sala, cualquier cosa— salía otro pedido en el acto.
     * Con HaxBall caído contestando 403 eso es machacar a una API que justamente
     * está pidiendo que la dejen en paz.
     */
    state.rooms.fetchedAt = Date.now();
    state.roomsFailures = (state.roomsFailures || 0) + 1;
  }
  roomHost.classList.remove('is-loading');
  renderRooms();
}

/** Cuánto se espera antes de volver a pedir: 20 s, y el doble en cada fallo. */
const ROOMS_TTL = 20000;
const ROOMS_TTL_MAX = 5 * 60 * 1000;

function roomsTtl() {
  return Math.min(ROOMS_TTL * 2 ** (state.roomsFailures || 0), ROOMS_TTL_MAX);
}

/** Evita machacar la API: refresca sólo si la lista ya está vieja. */
function refreshRoomsIfStale() {
  if (state.rooms.loading) return;
  if (Date.now() - (state.rooms.fetchedAt || 0) < roomsTtl()) return;
  loadRooms();
}

function isFavorite(token) {
  return (state.config.favorites || []).includes(token);
}

async function toggleFavorite(token) {
  const favorites = [...(state.config.favorites || [])];
  const at = favorites.indexOf(token);
  if (at >= 0) favorites.splice(at, 1);
  else favorites.push(token);
  await patchConfig({ favorites });
  renderRooms();
}

/** Salas de la casa: van arriba de todo, marcadas como patrocinadas. */
function isSponsored() {
  return false; // TL App no destaca salas de terceros
}

/** Último desempate: el orden en el que la API devolvió las salas. */
const byIndex = (a, b) => a.index - b.index;

/**
 * Orden geográfico. Es el que hace que funcionen los separadores.
 *
 * Muchos hosts publican salas "separador" (═══ NOMBRE ═══, 0/2 y con
 * contraseña) para que en la lista queden encerrando a las suyas. El truco es
 * la ubicación: medido en vivo, las salas reales de un mismo host están todas en
 * -34.6890,-58.4210 y los separadores en -34.6889,-58.4211 y -34.6891,-58.4209
 * — corridos una diezmilésima de grado (unos 11 metros) en direcciones
 * opuestas. Ordenando por distancia al jugador, uno cae justo antes del bloque
 * y el otro justo después.
 *
 * De ahí que la distancia se compare SIN redondear: a 376 km esos 11 metros
 * desaparecen al pasar a kilómetros enteros y el sándwich se deshace.
 */
const byGeo = (a, b) => {
  const da = Number.isFinite(a.distanceExact) ? a.distanceExact : Infinity;
  const db = Number.isFinite(b.distanceExact) ? b.distanceExact : Infinity;
  return da - db || byIndex(a, b);
};

function roomComparator() {
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  if (state.sort === 'players') return (a, b) => b.players - a.players || byIndex(a, b);
  if (state.sort === 'name') return (a, b) => byName(a, b) || byIndex(a, b);
  return byGeo;
}

function visibleRooms() {
  const query = $('#roomSearch').value.trim().toLowerCase();
  let list = state.rooms.list || [];
  if (query) list = list.filter((r) => r.name.toLowerCase().includes(query));
  if (state.onlyFavs) list = list.filter((r) => isFavorite(r.token));
  if (state.hideLocked) list = list.filter((r) => !r.password);
  if (state.hideFull) list = list.filter((r) => r.players < r.maxPlayers);

  const compare = roomComparator();
  const sponsored = [];
  const rest = [];
  for (const room of list) (isSponsored(room) ? sponsored : rest).push(room);

  // Las patrocinadas van siempre en orden geográfico, aunque el jugador haya
  // elegido otro criterio: ordenarlas por jugadores o por nombre rompería el
  // sándwich de separadores que arma el host.
  return [...sponsored.sort(byGeo), ...rest.sort(compare)];
}

/* ── Dibujado por ventana ───────────────────────────────── *
 * La lista trae más de mil salas y en pantalla entran unas veinte. Se dibujan
 * sólo esas veinte, con dos bloques vacíos arriba y abajo que ocupan el lugar
 * del resto para que la barra de scroll mida bien.
 *
 * Antes se creaban las mil filas —unos seis mil nodos— y se dejaba que el CSS
 * (`content-visibility`) salteara el maquetado de las que no se veían. Pero
 * existir cuesta igual: memoria, y una revisión de visibilidad por fila en cada
 * cuadro mientras se scrollea. De ahí venían los tirones al bajar por la lista.
 *
 * Todas las salas siguen estando: lo que cambia es cuántas hay dibujadas a la
 * vez, no cuántas se pueden ver. */
const ROW_HEIGHTS = { dense: 26, normal: 32, large: 46 };
const rowH = () => ROW_HEIGHTS[document.documentElement.dataset.roomRows] || 32;
/** Filas de más arriba y abajo del borde, para que el scroll no muestre huecos. */
const OVERSCAN = 6;

/** Las salas que corresponde mostrar ahora, ya filtradas y ordenadas. */
let roomView = [];
let roomParts = null;
let paintedFrom = -1;
let paintedTo = -1;

function roomListParts() {
  if (roomParts) return roomParts;
  const container = $('#roomList');
  const top = document.createElement('div');
  top.className = 'rtable__pad';
  const rows = document.createElement('div');
  const bottom = document.createElement('div');
  bottom.className = 'rtable__pad';
  container.replaceChildren(top, rows, bottom);

  let frame = 0;
  container.addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paintRoomWindow();
    });
  }, { passive: true });

  /* Cuántas filas entran depende del alto de la caja, y ese alto cambia: al
     cerrarse la pantalla de inicio, al pasar a pantalla completa, al agrandar
     la ventana. Si no se vuelve a dibujar, quedan menos filas de las que
     entran y debajo se ve un hueco.

     Se compara el alto a mano: el observador también avisa por cambios que no
     son de alto, y redibujar de prendido a apagado desde adentro de su propio
     callback es la receta del bucle. */
  if (typeof ResizeObserver === 'function') {
    let lastHeight = 0;
    new ResizeObserver(() => {
      const h = container.clientHeight;
      if (h === lastHeight) return;
      lastHeight = h;
      paintRoomWindow(true);
    }).observe(container);
  }

  roomParts = { container, top, rows, bottom };
  return roomParts;
}

/** @param {boolean} force Redibuja aunque la ventana visible no haya cambiado. */
function paintRoomWindow(force = false) {
  const { container, top, rows, bottom } = roomListParts();
  const total = roomView.length;

  if (!total) {
    top.style.height = '0px';
    bottom.style.height = '0px';
    paintedFrom = paintedTo = -1;
    return;
  }

  const height = container.clientHeight || 420;
  const ROW_H = rowH();
  const window_ = Math.ceil(height / ROW_H) + OVERSCAN * 2;
  /* El tope importa: si la lista se achica (una búsqueda, por ejemplo) mientras
     estabas abajo de todo, el scroll que quedó guardado apunta más allá del
     final. Sin recortarlo, la ventana caía fuera de la lista y no se dibujaba
     ni una fila: la búsqueda parecía no encontrar nada. */
  const maxFirst = Math.max(0, total - window_);
  const first = Math.min(maxFirst, Math.max(0, Math.floor(container.scrollTop / ROW_H) - OVERSCAN));
  const last = Math.min(total, first + window_);
  if (!force && first === paintedFrom && last === paintedTo) return;
  paintedFrom = first;
  paintedTo = last;

  top.style.height = `${first * ROW_H}px`;
  bottom.style.height = `${Math.max(0, total - last) * ROW_H}px`;

  const frag = document.createDocumentFragment();
  for (let i = first; i < last; i++) frag.append(roomRow(roomView[i]));
  rows.replaceChildren(frag);
}

/** Mensaje en lugar de la lista (error, sin resultados, todavía cargando). */
function showRoomsMessage(node) {
  const { top, rows, bottom } = roomListParts();
  roomView = [];
  paintedFrom = paintedTo = -1;
  top.style.height = '0px';
  bottom.style.height = '0px';
  rows.replaceChildren(...(node ? [node] : []));
}

/** Filas grises que laten mientras llega la lista: se ve la forma de lo que viene. */
function roomSkeleton() {
  const h = rowH();
  const n = Math.min(24, Math.max(6, Math.ceil(((roomParts && roomParts.container.clientHeight) || 420) / h)));
  const wrap = document.createElement('div');
  wrap.className = 'rskel';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.setProperty('--rh', `${h}px`);
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'rskel__row';
    row.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
    wrap.append(row);
  }
  return wrap;
}

function renderRooms() {
  const summary = $('#roomsSummary');

  if (state.rooms.loading && !state.rooms.list.length) {
    summary.textContent = t('rooms.loading');
    showRoomsMessage(roomSkeleton());
    return;
  }
  if (state.rooms.error) {
    summary.textContent = '';
    showRoomsMessage(emptyState(t('rooms.error'), state.rooms.error));
    return;
  }

  summary.textContent = t('rooms.summary', {
    players: state.rooms.totalPlayers.toLocaleString('es-AR'),
    rooms: state.rooms.totalRooms.toLocaleString('es-AR')
  });
  try { paintStatusBar(); if (state.hub) paintHub(); } catch (e) { /* adorno */ }

  const list = visibleRooms();

  if (!list.length) {
    const hasQuery = $('#roomSearch').value.trim().length > 0 || state.hideLocked || state.hideFull || state.onlyFavs;
    showRoomsMessage(emptyState(
      hasQuery ? t('rooms.noResults') : t('rooms.empty'),
      hasQuery ? t('rooms.noResultsText') : t('rooms.emptyText')
    ));
    syncJoinButton();
    return;
  }

  const firstPaint = !roomView || !roomView.length;
  roomView = list;
  paintRoomWindow(true);
  if (firstPaint || roomsEnter) {
    roomsEnter = false;
    // Las filas entran en cascada sólo cuando la lista aparece, no al scrollear ni al filtrar.
    const host = $('#roomList');
    host.dataset.enter = '1';
    clearTimeout(host._enterT);
    host._enterT = setTimeout(() => { delete host.dataset.enter; }, 900);
  }

  checkAutoJoin();
  syncJoinButton();
}

/** Cambió el filtro o el orden: la lista es otra, así que se mira desde arriba. */
function renderRoomsFromTop() {
  roomListParts().container.scrollTop = 0;
  renderRooms();
}

/** Sala (en minúsculas, cortada a 40) → nombres del club que están adentro. */
const clubRoomMap = new Map();
let clubRoomSig = '';
function updateClubRooms(list) {
  const next = new Map();
  for (const m of (Array.isArray(list) ? list : [])) {
    if (!m || !m.online || !m.room || m.self || m.trial || m.ext) continue;
    const key = String(m.room).trim().slice(0, 40).toLowerCase();
    if (!next.has(key)) next.set(key, []);
    next.get(key).push(m.name);
  }
  const sig = [...next].map(([k, v]) => k + ':' + v.join(',')).sort().join('|');
  if (sig === clubRoomSig) return;
  clubRoomSig = sig;
  clubRoomMap.clear();
  for (const [k, v] of next) clubRoomMap.set(k, v);
  // Sólo se redibuja si la lista de salas está a la vista.
  if (state.view === 'play' && state.stage === 'browser' && state.rooms.list.length) renderRooms();
}

function roomRow(room) {
  const full = room.players >= room.maxPlayers;
  const almostFull = !full && room.maxPlayers > 2 && room.players >= room.maxPlayers - 2 && room.players > 0;
  const openRoom = !full && !almostFull && room.players > 0;
  const sponsored = isSponsored(room);
  const row = document.createElement('div');
  row.className = 'rrow';
  if (full) row.classList.add('is-full');
  else if (almostFull) row.classList.add('is-almost-full');
  else if (openRoom) row.classList.add('is-open-room');
  if (!room.players) row.classList.add('is-empty');
  if (sponsored) row.classList.add('is-sponsored');
  const mates = clubRoomMap.get(String(room.name || '').trim().slice(0, 40).toLowerCase());
  if (mates) row.classList.add('is-club');
  if (state.selected === room.token) row.classList.add('is-selected');
  row.dataset.token = room.token;

  const dist = document.createElement('span');
  dist.className = 'rrow__dist';
  dist.textContent = room.distance != null ? `${room.distance.toLocaleString('es-AR')} km` : '';

  const flag = flagElement(room.country);

  const name = document.createElement('span');
  name.className = 'rrow__name';
  if (room.password) {
    const lock = document.createElement('span');
    lock.className = 'rrow__lock';
    lock.textContent = '🔒';
    lock.title = t('rooms.locked');
    name.append(lock);
  }
  const label = document.createElement('span');
  label.className = 'rrow__label';
  label.textContent = room.name;
  label.title = room.name;
  name.append(label);

  if (sponsored) {
    const badge = document.createElement('span');
    badge.className = 'rrow__badge';
    badge.textContent = t('rooms.sponsored');
    name.append(badge);
  }

  const players = document.createElement('span');
  players.className = 'rrow__players';
  players.textContent = `${room.players}/${room.maxPlayers}`;

  const fav = document.createElement('button');
  fav.className = `rrow__fav${isFavorite(room.token) ? ' is-on' : ''}`;
  fav.type = 'button';
  fav.dataset.fav = '1';
  fav.textContent = '★';
  fav.title = t('rooms.fav');

  if (mates) {
    const club = document.createElement('span');
    club.className = 'rrow__club';
    club.textContent = '👥 ' + mates.length;
    club.title = mates.join(', ');
    name.append(club);
  }

  row.append(dist, flag, name, players, fav);
  // Sin listeners por fila: la lista entera puede pasar el millar de salas y
  // colgarle tres manejadores a cada una era el grueso del costo de dibujarla.
  // Se delega en el contenedor (ver más abajo).
  return row;
}

/* Un solo juego de manejadores para toda la tabla. */
$('#roomList').addEventListener('click', (e) => {
  const row = e.target.closest('.rrow');
  if (!row) return;
  if (e.target.closest('[data-fav]')) {
    e.stopPropagation();
    toggleFavorite(row.dataset.token);
    return;
  }
  selectRoom(row.dataset.token);
});

$('#roomList').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.rrow');
  if (row && !e.target.closest('[data-fav]')) joinRoom(row.dataset.token);
});

/**
 * Bandera del sprite de HaxBall. Si todavía no se pudo bajar, cae al código
 * de país en texto, que es mejor que un hueco.
 */
function flagElement(country) {
  const flag = document.createElement('span');
  const position = state.flags && state.flags.positions[country];
  if (position) {
    flag.className = 'rrow__flag';
    flag.style.backgroundPosition = `${position[0]}px ${position[1]}px`;
    flag.title = country;
  } else {
    flag.className = 'rrow__flag rrow__flag--text';
    flag.textContent = country || '';
  }
  return flag;
}

function applyFlags(data) {
  if (!data || !data.image) return;
  state.flags = data;
  document.documentElement.style.setProperty('--flag-sprite', `url("${data.image}")`);
  renderRooms();
  /*
   * Y la de Ajustes, que era la que quedaba mal.
   *
   * El sprite se baja DESPUÉS de que la interfaz se pintó por primera vez, así
   * que cuando `renderCountry` pintó tu bandera todavía no había con qué: caía
   * al respaldo de texto —el «AR» a la izquierda del select— y ahí se quedaba,
   * porque lo único que volvía a pintarla era cambiar el select. De ahí que
   * hubiera que poner otro país y volver al tuyo para verla.
   */
  if (state.config) paintCountryFlag(state.config.countryOverride || '');
}

function selectRoom(token) {
  state.selected = token;
  $$('.rrow').forEach((row) => row.classList.toggle('is-selected', row.dataset.token === token));
  syncJoinButton();
}

function syncJoinButton() {
  $('#actJoin').disabled = !state.selected;
  $('#actAutoJoin').disabled = !state.selected && !state.autoJoin;
  $('#actAutoJoin').classList.toggle('is-on', !!state.autoJoin);
}

/** Antes de entrar siempre se confirma el apodo en la pantalla de inicio. */
/* ── Volver a la última sala ────────────────────────────────────── */
function paintLastRoom(last) {
  const button = $('#lastRoom');
  if (!button) return;
  state.lastRoom = last || null;
  button.hidden = !last || !last.token;
  // El mismo atajo, en la barra de arriba: se ve desde cualquier pantalla.
  const top = $('#topLastRoom');
  if (top) {
    top.hidden = !last || !last.token;
    top.title = last && last.name ? last.name : '';
    const nameEl = $('#topLastRoomName');
    if (nameEl) {
      nameEl.textContent = last && last.name ? last.name : '';
      nameEl.hidden = !(last && last.name);
    }
  }
  if (!last || !last.token) return;
  // Sin nombre igual se ofrece: el token alcanza para volver, y decir «la
  // última sala» a secas es mejor que esconder el botón.
  $('#lastRoomName').textContent = last.name || '';
}

async function refreshLastRoom() {
  paintLastRoom(await guard(tvm.rooms.last(), 'Error'));
}

$('#lastRoom').addEventListener('click', () => {
  if (state.lastRoom && state.lastRoom.token) joinRoom(state.lastRoom.token);
});
$('#topLastRoom').addEventListener('click', () => {
  if (state.lastRoom && state.lastRoom.token) joinRoom(state.lastRoom.token);
});

function joinRoom(tokenOrLink) {
  const room = (state.rooms.list || []).find((r) => r.token === tokenOrLink);
  state.pendingJoin = tokenOrLink;
  showStart(room ? room.name : null);
}

async function doJoin(tokenOrLink) {
  const res = await guard(tvm.rooms.join(tokenOrLink), t('toast.badLink'));
  if (!res) return false;
  /*
   * La fila se busca por el token que devuelve el main, no por lo que se tecleó.
   *
   * Entrando por link, lo que llega acá es un `https://…/play?c=…` entero y
   * ninguna fila de la lista tiene eso como token, así que la sala se quedaba
   * sin nombre: la presencia de Discord mostraba «En una sala» a secas hasta que
   * el juego alcanzara a leer el título —y si esa lectura fallaba, nunca—.
   * `rooms:join` ya parsea el link y devuelve el token pelado; con eso la fila
   * aparece igual que entrando desde la lista.
   */
  const room = (state.rooms.list || []).find((r) => r.token === res.token);
  // Antes de `setStage`, que ya publica la presencia: si no, Discord anuncia la
  // sala anterior durante ese instante.
  state.gameRoomName = null;
  state.joinedRoomName = room ? room.name : null;
  setView('play');
  setStage('game');
  showLoading(t('game.connecting'));
  dismissToast(state.joiningToast);
  state.joiningToast = toast(t('toast.joining'), 'ok');
  return true;
}

/* ── Auto-entrar ────────────────────────────────────────── */
function toggleAutoJoin() {
  if (state.autoJoin) {
    state.autoJoin = null;
    toast(t('rooms.autoJoinOff'), 'ok');
    syncJoinButton();
    return;
  }
  if (!state.selected) return;
  const room = (state.rooms.list || []).find((r) => r.token === state.selected);
  state.autoJoin = state.selected;
  syncJoinButton();
  toast(t('rooms.autoJoinOn', { name: room ? room.name.slice(0, 24) : '' }), 'ok');
  loadRooms();
}

/**
 * En vez de golpear la sala una y otra vez, mira la lista (que ya se refresca)
 * y entra recién cuando hay lugar. Es más amable con el servidor y con el host.
 */
function checkAutoJoin() {
  if (!state.autoJoin || state.stage === 'game') return;
  const room = (state.rooms.list || []).find((r) => r.token === state.autoJoin);
  if (!room || room.players >= room.maxPlayers) return;
  const token = state.autoJoin;
  state.autoJoin = null;
  syncJoinButton();
  doJoin(token);
}

/* ── Pantalla de inicio ─────────────────────────────────── */
/** Racha, partidos, goles y horas jugadas, con los números reales de este equipo. */
function paintStartSummary(roomName) {
  const box = $('#startSummary');
  if (!box) return;
  const stats = state.config.stats || {};
  const hours = Math.floor((stats.secondsPlayed || 0) / 3600);
  const chips = [];
  if (stats.streak > 0) chips.push(t('stats.streak', { days: stats.streak }));
  if (stats.matches > 0) chips.push(t('start.sum.matches', { n: stats.matches }));
  if (stats.goals > 0) chips.push(t('start.sum.goals', { n: stats.goals }));
  if (stats.assists > 0) chips.push(t('start.sum.assists', { n: stats.assists }));
  if (hours > 0) chips.push(t('start.sum.hours', { n: hours }));
  const show = !roomName && state.config.general.welcomeSummary !== false && chips.length > 0;
  box.hidden = !show;
  box.replaceChildren(...(show ? chips : []).map((text) => {
    const chip = document.createElement('span');
    chip.className = 'startsummary__chip';
    chip.textContent = text;
    return chip;
  }));
}

function showStart(roomName) {
  paintStartSummary(roomName);
  $('#startTitle').textContent = roomName ? t('start.titleRoom') : t('start.title');
  $('#startText').textContent = roomName || t('start.text');
  $('#startNick').value = state.config.general.nickname || '';
  $('#startBack').hidden = !roomName && !state.booted;
  $('#startScreen').hidden = false;
  $('#startNick').focus();
  $('#startNick').select();
}

function hideStart() {
  $('#startScreen').hidden = true;
  state.pendingJoin = null;
}

$('#startForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nick = $('#startNick').value.trim();
  if (!nick) return;

  const changed = nick !== state.config.general.nickname;
  if (changed) {
    await patchConfig({ general: { nickname: nick } });
    renderSettings();
  }
  // Sin esto la tarjeta «¿Cómo te llamás?» del navegador de salas seguía
  // visible aunque el nombre ya estuviera puesto en la pantalla de inicio.
  renderNickCard();

  const pending = state.pendingJoin;
  hideStart();
  state.booted = true;

  /*
   * Recargar el juego va al final y aparte: si fallara, la pantalla de inicio ya
   * se cerró y el nombre ya quedó guardado, en vez de trabarse a medio paso.
   *
   * Y las dos cosas juntas nunca: entrar a una sala YA es una carga nueva del
   * juego —con el nombre nuevo puesto por el preload antes de que arranque—, así
   * que recargar además era mandar dos navegaciones al mismo webview a ver cuál
   * llegaba primero.
   */
  if (pending) doJoin(pending);
  // Por el mismo camino que el apodo de Ajustes: si estás en una sala, se anota
  // y se aplica al salir en vez de sacarte de ella. Ver `canReloadGame`.
  else if (changed) scheduleGameReload();
});

/**
 * El <webview> puede no estar montado todavía; nunca vale trabar el flujo.
 *
 * Se pregunta primero si HaxBall está en pie: recargar contra el sitio caído es
 * lo que cierra el cliente (ver `mountGame`). Si no está, en vez de recargar se
 * muestra el cartel, y el juego que ya estaba cargado se queda como está.
 *
 * Recarga y punto: el «¿ahora se puede?» se contesta antes, en `canReloadGame`,
 * y el único que llama acá es `runPendingReload`.
 */
async function reloadGame() {
  try {
    if (!state.webview || typeof state.webview.reload !== 'function') return;
    const health = await tvm.game.health(true).catch(() => ({ down: false }));
    if (health.down) return showGameDown(health.reason);
    // Por el proceso principal y no con `state.webview.reload()`: recarga todas
    // las pestañas que están en la lista de salas, no sólo la que se mira, y
    // deja en paz a las que están adentro de una sala (ver `game:reload`).
    await tvm.game.reload();
  } catch (err) {
    console.error('no se pudo recargar el juego:', err);
  }
}

$('#startBack').addEventListener('click', hideStart);

$('#roomsRefresh').addEventListener('click', () => {
  const icon = $('#roomsRefresh svg');
  if (icon) {
    icon.classList.remove('is-spinning');
    void icon.offsetWidth;
    icon.classList.add('is-spinning');
    setTimeout(() => icon.classList.remove('is-spinning'), 500);
  }
  loadRooms();
});
/* La lista puede pasar el millar de filas: rehacerla en cada tecla era el pico
   de CPU más grande de la pantalla. Se espera a que el jugador deje de tipear. */
let searchTimer = null;
$('#roomSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderRoomsFromTop, 140);
});
$('#roomSort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderRoomsFromTop();
});

$('#linkForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = $('#linkInput').value.trim();
  if (!value) return;
  joinRoom(value);
  $('#linkInput').value = '';
});

/* ── Barra de acciones ──────────────────────────────────── */
$('#actJoin').addEventListener('click', () => {
  if (state.selected) joinRoom(state.selected);
});
$('#actAutoJoin').addEventListener('click', toggleAutoJoin);
/* Punto rojo en «Capitán»: cada minuto se mira si hay algo sin ver (sólo para el capitán). */
async function refreshCaptainDot() {
  const btn = $('#captainBtn');
  if (!btn || btn.hidden || !window.TLCaptain) return;
  try {
    const p = await tvm.admin.pending();
    btn.classList.toggle('has-alert', window.TLCaptain.pendingCount(p) > 0 && !$('.cap'));
  } catch (e) { /* sin conexión: no se cambia */ }
}
setInterval(refreshCaptainDot, 60000);
setTimeout(refreshCaptainDot, 8000);

const capBtnEl = $('#captainBtn');
if (capBtnEl) capBtnEl.addEventListener('click', () => { if (window.TLCaptain) { window.TLCaptain.open(); capBtnEl.classList.remove('has-alert'); } });

/** «Ocultar con clave» y «Ocultar llenas»: botones que se prenden y se apagan, y se recuerdan. */
for (const [id, key, store] of [['#hideLocked', 'hideLocked', 'tl_hide_locked'], ['#hideFull', 'hideFull', 'tl_hide_full']]) {
  const btn = $(id);
  const paint = () => { btn.classList.toggle('is-on', !!state[key]); btn.setAttribute('aria-pressed', state[key] ? 'true' : 'false'); };
  paint();
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    try { localStorage.setItem(store, state[key] ? '1' : '0'); } catch (e) { /* sin almacenamiento: dura la sesión */ }
    paint();
    renderRoomsFromTop();
  });
}

$('#favToggle').addEventListener('click', () => {
  state.onlyFavs = !state.onlyFavs;
  $('#favToggle').classList.toggle('is-on', state.onlyFavs);
  renderRoomsFromTop();
});

// El botón «Replays» de la barra de acciones ya no está: a Replays se entra por
// la pestaña de la barra de navegación. El listener quedó colgado apuntando a un
// id que no existe, y eso tiraba TODO el renderer (ver la red de seguridad del
// arranque, al principio de este archivo).
$('#actChangeNick').addEventListener('click', () => {
  goToSection('aspecto', 'jugador');
  $('#nickname').focus();
  $('#nickname').select();
});

/* ── Crear sala ─────────────────────────────────────────── */
const CREATE_SWITCH = {
  es: { label: 'Mostrar en la lista pública', description: 'Sólo entra quien tenga el link.' },
  en: { label: 'Show in the public list', description: 'Only people with the link can join.' }
};

function openCreateModal() {
  const lang = isEn() ? 'en' : 'es';
  const nick = state.config.general.nickname || 'HaxBall';

  $('#createName').value = `${nick}'s room`;
  $('#createPass').value = '';

  const max = $('#createMax');
  max.replaceChildren();
  for (let n = 2; n <= 20; n++) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = String(n);
    max.append(opt);
  }
  max.value = '12';

  buildSwitches($('#createSwitches'), [{
    ...CREATE_SWITCH[lang],
    key: 'listed',
    value: () => state.createListed
  }], (item, value) => { state.createListed = value; });

  $('#createModal').hidden = false;
  $('#createName').focus();
  $('#createName').select();
}

function closeCreateModal() {
  $('#createModal').hidden = true;
}

$('#actCreate').addEventListener('click', () => {
  if (!state.config.general.nickname) {
    $('#nickInput').focus();
    return;
  }
  openCreateModal();
});
$('#createClose').addEventListener('click', closeCreateModal);
$('#createCancel').addEventListener('click', closeCreateModal);
$('#createModal').addEventListener('click', (e) => {
  if (e.target === $('#createModal')) closeCreateModal();
});

$('#createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const options = {
    name: $('#createName').value.trim(),
    password: $('#createPass').value,
    maxPlayers: Number($('#createMax').value),
    listed: state.createListed
  };
  if (!options.name) return;

  closeCreateModal();
  const res = await guard(tvm.rooms.create(options), 'Error');
  if (!res) return;
  // El nombre de LA SALA QUE SE ESTÁ CREANDO. HaxBall lo confirma después,
  // leyendo el título de la sala; hasta entonces éste es el bueno.
  state.gameRoomName = null;
  state.joinedRoomName = options.name;
  // HaxBall puede pedir su verificación anti-bot: hay que mostrarle el juego.
  setStage('game');
  toast(t('create.creating'), 'ok');
});

/* ── Nombre del jugador ─────────────────────────────────── */
function renderNickCard() {
  const missing = !state.config.general.nickname;
  $('#nickCard').hidden = !missing;
  if (missing) $('#nickInput').value = '';
}

$('#nickForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nick = $('#nickInput').value.trim();
  if (!nick) return;
  await patchConfig({ general: { nickname: nick } });
  renderNickCard();
  renderSettings();
  toast(t('toast.nickSaved'), 'ok');
  scheduleGameReload();
});

/* ══════════════════════════════════════════════════════════
   Ajustes de HaxBall (esquema)
   ══════════════════════════════════════════════════════════ */
/* ── Aplicar un ajuste de HaxBall ────────────────────────────────────────────
 *
 * Casi todos se aplican solos: el preload le escribe el valor al juego que ya
 * está corriendo (ver `applyGameSettingsLive`) y HaxBall los relee mientras
 * dibuja. Acá no hay nada que hacer más que avisar.
 *
 * Los que HaxBall lee una sola vez —hoy sólo la extrapolación, marcada con
 * `live: false` en el esquema— siguen necesitando recargar el juego. Y ahí
 * estaba el otro problema: si estabas en una partida se avisaba «se aplica
 * cuando salgas» y NO QUEDABA NADA PENDIENTE, así que al salir no se aplicaba
 * tampoco. Ahora queda anotado y se aplica al terminar la partida.
 */
let reloadTimer = null;
/** Un cambio que necesita recargar y está esperando a que termines de jugar. */
let reloadPending = false;

function appliesLive(setting) {
  return setting ? setting.live !== false && state.liveGameSettings : false;
}

/**
 * @param {object} [setting] el ajuste que se tocó; sin él se asume que hay que
 *                           recargar (los controles, la bandera y el apodo).
 */
function applyGameSetting(setting) {
  if (appliesLive(setting)) {
    // El preload ya lo empujó al juego con el `game:config` de `patchConfig`.
    toast(t('toast.applied'), 'ok');
    return;
  }
  scheduleGameReload();
}

/**
 * ¿Se puede recargar el juego ahora sin costarle nada al jugador?
 *
 * Recargar es volver a cargar la página del juego, y eso es salir de la sala.
 * Jugando no se discute; en una sala tampoco, aunque el partido no haya
 * empezado — sacar a alguien de la sala por haber tocado un ajuste es peor que
 * hacerle esperar a que salga.
 *
 * Hasta ahora esto no hacía falta de casualidad: dentro de una sala HaxBall
 * vetaba toda navegación con su `onbeforeunload` y la recarga se perdía sola,
 * en silencio y con el ajuste sin aplicar. El veto ya no está (ver
 * `will-prevent-unload` en main.js), así que la decisión se toma acá.
 */
function canReloadGame() {
  return !state.playing && state.stage !== 'game';
}

function scheduleGameReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    if (!canReloadGame()) {
      // Se anota para cuando salga: antes se avisaba y se perdía.
      reloadPending = true;
      toast(t('toast.applyLater'), 'ok');
      return;
    }
    runPendingReload();
  }, 700);
}

/** Lo que quedó esperando, si ya se puede. Es el único que dispara lo anotado. */
function flushPendingReload() {
  if (!reloadPending || !canReloadGame()) return;
  runPendingReload();
}

function runPendingReload() {
  reloadPending = false;
  if (!state.webview) return;
  reloadGame();
  toast(t('toast.applied'), 'ok');
}

/** Los textos del esquema vienen en los dos idiomas. */
function label(setting) {
  return (isEn() && setting.labelEn) || setting.label;
}
function help(setting) {
  return isEn() ? setting.helpEn : setting.help;
}

function renderGameSettings(container, group) {
  container.replaceChildren();
  for (const setting of state.schema.game.filter((s) => s.group === group)) {
    container.append(gameSettingControl(setting));
  }
}

/*
 * Un ajuste propio de HaxBall, dibujado como fila del panel.
 *
 * Las ayudas del esquema (`help` / `helpEn` en haxball-settings.js) se
 * recortaron a media línea cada una, así que van todas como descripción de la
 * fila y ninguna necesita el `ⓘ`.
 */
function gameSettingControl(setting) {
  const current = state.config.game[setting.id];
  const description = help(setting);
  const hint = null;

  if (setting.type === 'toggle') {
    // `value` se lee de la config viva, no de una copia: si no, después de
    // tocarlo el interruptor volvía solo a la posición anterior.
    return switchRow({
      label: label(setting),
      description,
      hint,
      value: () => {
        const now = state.config.game[setting.id];
        return now === '1' || now === true;
      }
    }, async (_item, value) => {
      await patchConfig({ game: { [setting.id]: value ? '1' : '0' } });
      applyGameSetting(setting);
    });
  }

  if (setting.type === 'select' && setting.slider) {
    // Los valores de siempre en una lista, y además una barra para cualquier número del mínimo al máximo.
    const pct = (v) => Math.round(Number(v) * 100);
    const select = document.createElement('select');
    select.id = `hb-${setting.id}`;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(pct(setting.min));
    range.max = String(pct(setting.max));
    range.step = '1';
    const shown = document.createElement('b');
    shown.className = 'row__val';
    const custom = document.createElement('option');
    custom.value = 'custom';
    const fill = (v) => {
      const p = pct(v);
      const preset = setting.options.find((o) => pct(o.value) === p);
      select.replaceChildren(...setting.options.map((opt) => {
        const o = document.createElement('option');
        o.value = String(opt.value);
        o.textContent = (isEn() && opt.labelEn) || opt.label;
        return o;
      }));
      if (!preset) {
        custom.textContent = isEn() ? `Custom · ${p}%` : `Personalizada · ${p}%`;
        select.append(custom);
      }
      select.value = preset ? String(preset.value) : 'custom';
      range.value = String(p);
      shown.textContent = `${p}%`;
      syncRangeFill(range);
    };
    fill(current);
    const commitScale = async (v) => {
      await patchConfig({ game: { [setting.id]: String(v) } });
      applyGameSetting(setting);
    };
    select.addEventListener('change', () => {
      if (select.value === 'custom') return;
      fill(select.value);
      commitScale(select.value);
    });
    range.addEventListener('input', () => { shown.textContent = `${range.value}%`; syncRangeFill(range); });
    range.addEventListener('change', () => {
      const v = Number(range.value) / 100;
      fill(v);
      commitScale(v);
    });
    queueMicrotask(() => syncRangeFill(range));
    const row = settingRow({ label: label(setting), description, hint, control: [select, range, shown] });
    row.dataset.ctl = 'select';
    return row;
  }

  if (setting.type === 'select') {
    return selectRow({
      label: label(setting),
      description,
      hint,
      id: `hb-${setting.id}`,
      options: setting.options.map((opt) => [opt.value, (isEn() && opt.labelEn) || opt.label]),
      value: current,
      onChange: async (value) => {
        await patchConfig({ game: { [setting.id]: value } });
        applyGameSetting(setting);
      }
    });
  }

  const fmt = FORMATTERS[setting.format] || ((v) => v);
  const commit = async (raw) => {
    await patchConfig({ game: { [setting.id]: String(raw) } });
    applyGameSetting(setting);
  };

  /*
   * Los ajustes finos (la extrapolación) además se tipean: con el paso en 1 la
   * barra sola es incómoda. La caja de número reemplaza al número de sólo
   * lectura que llevan las demás barras, no se suma a él.
   */
  if (setting.precise) {
    const range = document.createElement('input');
    range.type = 'range';
    range.id = `hb-${setting.id}`;
    range.min = setting.min;
    range.max = setting.max;
    range.step = setting.step;
    range.value = current;

    const box = document.createElement('input');
    box.type = 'number';
    box.className = 'numbox';
    box.min = setting.min;
    box.max = setting.max;
    box.step = setting.step;
    box.value = current;

    const unit = document.createElement('span');
    unit.className = 'numbox__unit';
    unit.textContent = setting.unit || '';

    const holder = document.createElement('span');
    holder.className = 'numbox__wrap';
    holder.append(box, unit);

    range.addEventListener('input', () => {
      box.value = range.value;
      syncRangeFill(range);
    });
    range.addEventListener('change', () => commit(range.value));
    box.addEventListener('change', () => {
      // Tipear fuera de rango es fácil; se recorta en vez de rechazarlo.
      const n = Math.min(setting.max, Math.max(setting.min, Number(box.value) || 0));
      box.value = n;
      range.value = n;
      syncRangeFill(range);
      commit(n);
    });
    queueMicrotask(() => syncRangeFill(range));

    return settingRow({ label: label(setting), description, hint, control: [range, holder] });
  }

  return rangeRow({
    label: label(setting),
    description,
    hint,
    id: `hb-${setting.id}`,
    min: setting.min,
    max: setting.max,
    step: setting.step,
    value: current,
    format: fmt,
    onChange: commit
  });
}

/* ══════════════════════════════════════════════════════════
   Rendimiento
   ══════════════════════════════════════════════════════════ */
const PERF_GROUPS = {
  perfLatency: [
    { key: 'highProcessPriority', label: 'Prioridad alta', description: 'Le pide más CPU a Windows.', restart: false },
    { key: 'disableBackgroundThrottling', label: 'Sin freno en segundo plano', description: 'No baja el ritmo sin el foco.', restart: true },
    { key: 'lowLatencyCanvas', label: 'Menos retardo de pantalla (experimental)', description: 'La imagen sale sin esperar al compositor.', hint: 'Puede achicar el tiempo entre tu tecla y lo que ves. Medilo con «Latencia de entrada» del overlay. Si ves tirones o parpadeos, apagalo.', restart: true }
  ],
  perfGpu: [
    /*
     * Estaba en la config (`perf.unlockFps`, prendido de fábrica) pero se había
     * caído del panel. El que lo tenía apagado —por la migración v8 de las
     * configs viejas, o traído de otra PC por la sincronización— quedaba con los
     * FPS clavados en el refresco del monitor y sin ninguna forma de volver.
     */
    { key: 'unlockFps', label: 'FPS sin límite', description: 'Deja pasar los FPS del refresco del monitor.', hint: 'Apaga el V-Sync. Si igual quedan clavados en los Hz de tu monitor, revisá que el panel de tu placa de video (NVIDIA, AMD o Intel) no tenga la sincronización vertical forzada.', restart: true },
    { key: 'flatGraphics', label: 'Gráficos planos', description: 'Saca texturas y sombras de la cancha.', restart: false },
    { key: 'gpuRasterization', label: 'Rasterizado por GPU', description: 'Descarga el dibujado en la placa de video.', restart: true },
    { key: 'zeroCopy', label: 'Copia cero', description: 'Menos copias de memoria por cuadro.', restart: true },
    { key: 'highPerformanceGpu', label: 'Usar la placa dedicada', description: 'Pide la placa buena, no la integrada.', restart: true },
    { key: 'forceGpu', label: 'Forzar aceleración', description: 'Ignora la lista de drivers bloqueados.', hint: 'Activalo sólo si el cliente no te está tomando la placa de video.', restart: true }
  ],
  perfSystem: [
    // La publicidad de haxball.com ya no se carga nunca y no hay interruptor:
    // eran 676 MB contra 1033 MB y tres procesos menos. Nadie ganaba nada
    // apagándolo, así que dejó de ser una decisión del jugador.
    { key: 'noOcclusionPause', label: 'No pausar si algo tapa la ventana', description: 'Windows pausa si cree que está tapada.', restart: true },
    { key: 'lowLatencyAudio', label: 'Audio de baja latencia', description: 'Usa la ruta de audio directa de Windows.', restart: true },
    { key: 'disableHardwareAcceleration', label: 'Desactivar aceleración por hardware', description: 'Sólo para diagnosticar: el render pasa a la CPU.', hint: 'Va bastante más lento. Sirve para saber si una falla gráfica viene del driver de video.', restart: true }
  ]
};

const PERF_GROUPS_EN = {
  perfLatency: [
    { key: 'highProcessPriority', label: 'High priority', description: 'Asks Windows for more CPU.', restart: false },
    { key: 'disableBackgroundThrottling', label: 'No background throttling', description: 'Keeps the pace without focus.', restart: true },
    { key: 'lowLatencyCanvas', label: 'Lower display lag (experimental)', description: 'Frames go out without waiting for the compositor.', hint: 'May shrink the time between your key and what you see. Measure it with the overlay “Input latency”. If you see stutter or flicker, turn it off.', restart: true }
  ],
  perfGpu: [
    { key: 'unlockFps', label: 'Unlimited FPS', description: 'Lets FPS go past the monitor refresh rate.', hint: 'Turns V-Sync off. If FPS still stick to your monitor Hz, check that your graphics card panel (NVIDIA, AMD or Intel) is not forcing vertical sync.', restart: true },
    { key: 'flatGraphics', label: 'Flat graphics', description: 'Removes pitch textures and shadows.', restart: false },
    { key: 'gpuRasterization', label: 'GPU rasterization', description: 'Moves drawing onto the graphics card.', restart: true },
    { key: 'zeroCopy', label: 'Zero copy', description: 'Fewer memory copies per frame.', restart: true },
    { key: 'highPerformanceGpu', label: 'Use the dedicated GPU', description: 'Asks for the good GPU, not the integrated one.', restart: true },
    { key: 'forceGpu', label: 'Force acceleration', description: 'Ignores the blocked driver list.', hint: 'Only turn it on if the client is not picking up your graphics card.', restart: true }
  ],
  perfSystem: [
    { key: 'noOcclusionPause', label: 'Do not pause when covered', description: 'Windows pauses when it thinks it is hidden.', restart: true },
    { key: 'lowLatencyAudio', label: 'Low latency audio', description: 'Uses the direct Windows audio path.', restart: true },
    { key: 'disableHardwareAcceleration', label: 'Disable hardware acceleration', description: 'Diagnostics only: rendering moves to the CPU.', hint: 'It runs noticeably slower. Use it to tell whether a graphics glitch comes from the video driver.', restart: true }
  ]
};

/*
 * ═══ Perfiles de rendimiento ═══
 *
 * Acá vivían dos botones que aplicaban un paquete de ajustes de una: «Modo
 * competitivo» y «PC de baja gama». Se sacaron por pedido, y el pedido tenía
 * razón: un botón que cambia diez cosas a la vez deja la configuración en un
 * estado que después nadie sabe de dónde salió.
 *
 * Vuelven contestando eso, no ignorándolo:
 *
 *   · Cada perfil dice qué hace ANTES de tocarlo, en su propia línea.
 *   · Todo lo que tocan sigue visible y editable en esta misma pantalla, fila
 *     por fila. No hay nada que el perfil ponga y no se pueda ver.
 *   · Apenas cambiás un solo control a mano, el estado pasa a «Personalizado».
 *     El perfil no se queda figurando como el dueño de una configuración que
 *     ya no es la suya, que era exactamente el problema.
 *
 * Los tres perfiles tocan las MISMAS claves, así que comparar dos es comparar
 * una columna: no hay ajuste que uno ponga y otro deje como estaba, porque eso
 * es lo que hace imposible saber qué quedó puesto.
 */
const PERF_PRESET_KEYS = ['flatGraphics', 'gpuRasterization', 'zeroCopy', 'highPerformanceGpu', 'highProcessPriority', 'disableBackgroundThrottling'];

const PERF_PRESETS = [
  {
    id: 'calidad',
    values: { flatGraphics: false, gpuRasterization: true, zeroCopy: false, highPerformanceGpu: true, highProcessPriority: false, disableBackgroundThrottling: false },
    fpsCap: 0
  },
  {
    id: 'equilibrado',
    values: { flatGraphics: false, gpuRasterization: true, zeroCopy: true, highPerformanceGpu: true, highProcessPriority: true, disableBackgroundThrottling: true },
    fpsCap: 0
  },
  {
    id: 'fps',
    values: { flatGraphics: true, gpuRasterization: true, zeroCopy: true, highPerformanceGpu: true, highProcessPriority: true, disableBackgroundThrottling: true },
    fpsCap: 0
  }
];

/** Cuál de los tres está puesto exactamente, o `null` si es una mezcla. */
function activePerfPreset() {
  const perf = state.config.perf || {};
  return PERF_PRESETS.find((preset) =>
    PERF_PRESET_KEYS.every((key) => Boolean(perf[key]) === Boolean(preset.values[key]))
  ) || null;
}

function renderPerfPresets() {
  const box = $('#perfPresets');
  const estado = $('#perfPresetState');
  if (!box) return;
  box.replaceChildren();

  const actual = activePerfPreset();
  if (estado) estado.textContent = actual ? t(`perf.preset.${actual.id}`) : t('perf.preset.custom');

  for (const preset of PERF_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `presetbtn${actual === preset ? ' is-on' : ''}`;

    const name = document.createElement('b');
    name.textContent = t(`perf.preset.${preset.id}`);
    const what = document.createElement('small');
    what.textContent = t(`perf.preset.${preset.id}Help`);
    btn.append(name, what);

    btn.addEventListener('click', async () => {
      await patchConfig({ perf: { ...preset.values, fpsCap: preset.fpsCap } });
      /*
       * Casi todas estas claves son banderas de Chromium y se leen una sola vez,
       * antes de que exista la ventana: sin el aviso, la persona toca un perfil,
       * no ve cambiar nada y da por hecho que el botón no anda.
       */
      needsRestart();
      renderPerf();
      toast(t('perf.preset.applied', { name: t(`perf.preset.${preset.id}`) }), 'ok');
    });
    box.append(btn);
  }
}

/*
 * Techo de cuadros.
 *
 * Misma lista que el cliente Zero, con el mismo sentido: frena hacia abajo. El
 * que deja pasar del refresco del monitor es el interruptor «FPS desbloqueados»
 * de acá abajo, que apaga el V-Sync de Chromium; éste, solo, nunca sube de lo
 * que dé la pantalla.
 *
 * No pide reinicio: el techo lo aplica el preload del juego en caliente.
 */
const FPS_CAP_OPTIONS = [
  { value: 0, label: 'Sin límite (recomendado)', labelEn: 'Unlimited (recommended)' },
  { value: 30, label: '30 FPS', labelEn: '30 FPS' },
  { value: 60, label: '60 FPS', labelEn: '60 FPS' },
  { value: 144, label: '144 FPS', labelEn: '144 FPS' },
  { value: 240, label: '240 FPS', labelEn: '240 FPS' }
];

function renderFpsCap() {
  const container = $('#perfFpsCap');
  if (!container) return;
  container.replaceChildren(selectRow({
    label: t('perf.fpsCap'),
    description: t('perf.fpsCapHelp'),
    hint: t('perf.fpsCapHint'),
    id: 'perf-fpscap',
    options: FPS_CAP_OPTIONS.map((opt) => [opt.value, (isEn() && opt.labelEn) || opt.label]),
    value: Number(state.config.perf.fpsCap) || 0,
    onChange: (value) => patchConfig({ perf: { fpsCap: Number(value) || 0 } })
  }));
}

function renderPerf() {
  renderGameSettings($('#gameVideo'), 'video');
  renderGameSettings($('#gameNet'), 'net');
  // La sección de red se dibuja con lo que HaxBall expone en su grupo «net»: si
  // no hay nada, una tarjeta con sólo un título es ruido, así que se esconde.
  const redSec = $('[data-sec="red"]');
  if (redSec) redSec.hidden = !$('#gameNet').childElementCount;
  renderFpsCap();
  renderKeys();

  const groups = isEn() ? PERF_GROUPS_EN : PERF_GROUPS;
  for (const [id, items] of Object.entries(groups)) {
    buildSwitches(
      $(`#${id}`),
      items.map((item) => ({ ...item, value: () => state.config.perf[item.key] })),
      async (item, value) => {
        await patchConfig({ perf: { [item.key]: value } });
        if (item.restart) needsRestart();
        // Tocar un solo interruptor a mano deja de ser «Equilibrado» y pasa a
        // ser «Personalizado». Es lo que evita que un perfil se quede figurando
        // como dueño de algo que ya no puso él.
        renderPerfPresets();
      }
    );
  }
  renderPerfPresets();
}

/*
 * ═══ El aviso de reinicio ═══
 *
 * Los interruptores marcados con ↻ no hacen nada hasta que el cliente vuelve a
 * arrancar: son banderas de Chromium y se leen una sola vez, antes de que exista
 * la ventana. Avisarlo bien importa, porque si no la persona toca tres cosas,
 * no ve ningún cambio y da por hecho que el cliente está roto.
 *
 * El cartel vive fuera del panel, fijo arriba de la ventana, y no se va solo:
 * ni con un temporizador, ni al cerrar el panel, ni al cambiar de pestaña. Sale
 * únicamente si reiniciás o si lo descartás a mano — y si después tocás otro
 * interruptor de los que piden reinicio, vuelve.
 */
function needsRestart() {
  const bar = $('#restartNotice');
  if (!bar.hidden) return; // ya estaba: no reiniciar la animación de entrada
  bar.hidden = false;
}

/* ══════════════════════════════════════════════════════════
   Controles del juego
   ══════════════════════════════════════════════════════════
   HaxBall los guarda en `player_keys` como { códigoDeTecla: acción }. Varias
   teclas pueden apuntar a la misma acción, así que cada fila lista todas las
   suyas. Mientras la config del cliente esté vacía se muestran las que el juego
   tenga puestas; al primer cambio se guarda el mapa entero.
   ══════════════════════════════════════════════════════════ */
const ACTION_LABELS = {
  es: { Up: 'Arriba', Down: 'Abajo', Left: 'Izquierda', Right: 'Derecha', Kick: 'Patear', ToggleChat: 'Chat' },
  en: { Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right', Kick: 'Kick', ToggleChat: 'Chat' }
};

/** Nombres cortos para códigos que en crudo no se entienden. */
const KEY_NAMES = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Espacio', ControlLeft: 'Ctrl izq', ControlRight: 'Ctrl der',
  ShiftLeft: 'Shift izq', ShiftRight: 'Shift der',
  AltLeft: 'Alt izq', AltRight: 'Alt der', Enter: 'Enter', Tab: 'Tab'
};

function keyLabel(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  // "KeyW" → "W", "Digit4" → "4", "Numpad0" → "Num 0"
  const m = code.match(/^(Key|Digit|Numpad)(.+)$/);
  if (!m) return code;
  return m[1] === 'Numpad' ? `Num ${m[2]}` : m[2];
}

/** El mapa que se está mostrando: el del cliente si lo tocó, si no el del juego. */
function activeKeys() {
  const own = state.config.keys || {};
  if (Object.keys(own).length) return own;
  // Si el juego todavía no reportó sus teclas (no entraste a ninguna sala), se
  // parte de las de fábrica: arrancar de un mapa vacío hacía que atar UNA tecla
  // dejara todas las demás acciones sin nada.
  return state.liveKeys || (state.schema && state.schema.defaultKeys) || {};
}

let capturingFor = null;

/*
 * Con qué tecla se abre el resumen del partido.
 *
 * Está acá y no en «Aspecto» porque es lo mismo que el resto de esta tarjeta:
 * qué hace cada tecla. Y sobre todo porque es la respuesta a un reclamo
 * concreto — Tab es la tecla del chat de HaxBall, el cliente se la quedaba para
 * el resumen, y el que juega con el chat abierto se quedaba sin chat.
 *
 * Las opciones esquivan a propósito F8, F9 y F11, que ya tienen dueño en el
 * preload (overlay, amigos y pantalla completa).
 */
const SUMMARY_KEYS = [
  { value: 'Tab', label: 'Tab', note: { es: 'le saca el chat a HaxBall', en: 'takes chat away from HaxBall' } },
  { value: 'F1', label: 'F1', note: null },
  { value: 'F2', label: 'F2', note: null },
  { value: 'F4', label: 'F4', note: null },
  { value: '', label: null, note: null }
];

function renderSummaryKey() {
  const container = $('#summaryKeyField');
  if (!container) return;

  const current = state.config.general.summaryKey;
  const options = SUMMARY_KEYS.map((opt) => {
    const name = opt.label || t('keys.summaryNone');
    const note = opt.note && (isEn() ? opt.note.en : opt.note.es);
    return [opt.value, note ? `${name} — ${note}` : name];
  });
  // Una tecla que no está en la lista (config a mano) no se pierde: se agrega.
  if (typeof current === 'string' && current && !SUMMARY_KEYS.some((o) => o.value === current)) {
    options.push([current, current]);
  }

  container.replaceChildren(selectRow({
    label: t('keys.summary'),
    // El párrafo entero sobre Tab y el chat se fue al `ⓘ`: es la explicación
    // más larga que había en toda la pantalla y estaba puesta debajo de un
    // selector que la mayoría no toca nunca.
    hint: t('keys.summaryHelp'),
    id: 'summary-key',
    options,
    value: typeof current === 'string' ? current : 'Tab',
    onChange: async (value) => {
    await patchConfig({ general: { summaryKey: value } });

    /*
     * Sacar el resumen de Tab no alcanza para que vuelva el chat.
     *
     * El cliente le escribe a HaxBall su propio mapa de teclas, y ahí Tab no
     * está atado a nada: se lo sacó a propósito cuando el resumen se lo quedó
     * (ver `DEFAULT_KEYS` en `haxball-settings.js`). Sin esto, el que cambia la
     * opción esperando recuperar el chat se queda con una tecla que no hace
     * NADA, que es peor que el problema que vino a resolver.
     *
     * Sólo si el chat no tiene ya otra tecla puesta: al que se lo ató a otra
     * cosa no hay que pisárselo.
     */
    if (value !== 'Tab') {
      const keys = activeKeys();
      const hasChat = Object.keys(keys).some((code) => keys[code] === 'ToggleChat');
      if (!hasChat) {
        await bindKey('Tab', 'ToggleChat');
        toast(t('keys.summaryChatBack'), 'ok');
        return;
      }
    }
    renderSummaryKey();
    scheduleGameReload();
    }
  }));
}

function renderKeys() {
  const lang = isEn() ? 'en' : 'es';
  const keys = activeKeys();
  const list = $('#keyList');
  list.replaceChildren();
  renderSummaryKey();

  for (const action of state.schema.actions) {
    const row = document.createElement('div');
    row.className = 'keyrow';

    const name = document.createElement('strong');
    name.className = 'keyrow__name';
    name.textContent = ACTION_LABELS[lang][action] || action;

    const chips = document.createElement('div');
    chips.className = 'keyrow__chips';

    const bound = Object.keys(keys).filter((code) => keys[code] === action);
    for (const code of bound) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'keychip';
      chip.title = `${code} — ${t('keys.remove')}`;
      chip.textContent = keyLabel(code);
      // Dejar una acción sin ninguna tecla te deja sin poder moverte.
      chip.disabled = bound.length < 2;
      chip.addEventListener('click', () => unbindKey(code));
      chips.append(chip);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = `keyadd${capturingFor === action ? ' is-capturing' : ''}`;
    // El latido mientras espera una tecla es la única señal de que está
    // escuchando, así que sobrevive al interruptor de animaciones.
    if (capturingFor === action) add.dataset.keepMotion = '';
    add.textContent = capturingFor === action ? t('keys.press') : '+';
    add.addEventListener('click', () => startCapture(action));
    chips.append(add);

    row.append(name, chips);
    list.append(row);
  }
}

function startCapture(action) {
  capturingFor = capturingFor === action ? null : action;
  renderKeys();
}

/**
 * Mientras se espera una tecla, el resto de la app no la ve: si no, capturar
 * Espacio o una flecha además scrolleaba o activaba un botón.
 */
window.addEventListener('keydown', (e) => {
  if (!capturingFor) return;
  e.preventDefault();
  e.stopPropagation();

  const action = capturingFor;
  capturingFor = null;
  if (e.code === 'Escape') return renderKeys();
  bindKey(e.code, action);
}, true);

async function bindKey(code, action) {
  const next = { ...activeKeys(), [code]: action };
  await patchConfig({ keys: next });
  renderKeys();
  scheduleGameReload();
}

async function unbindKey(code) {
  const next = { ...activeKeys() };
  delete next[code];
  // `patchConfig` hace merge profundo, así que borrar una clave requiere
  // reemplazar el objeto entero: se manda con la marca de reemplazo.
  await patchConfig({ keys: { __replace: next } });
  renderKeys();
  scheduleGameReload();
}

$('#keysReset').addEventListener('click', async () => {
  await patchConfig({ keys: { __replace: {} } });
  renderKeys();
  scheduleGameReload();
  toast(t('keys.wasReset'), 'ok');
});

// Descartarlo es una decisión explícita: los cambios siguen sin aplicarse, pero
// ya se avisó y no tiene sentido seguir tapando la pantalla.
$('#dismissRestart').addEventListener('click', () => { $('#restartNotice').hidden = true; });

$('#restartNow').addEventListener('click', async () => {
  // Reiniciar cierra la conexión con la sala: si hay partido, se avisa.
  if (state.playing && !window.confirm(t('perf.restartConfirm'))) return;
  await guard(tvm.app.restart(), 'Error');
});

/* ══════════════════════════════════════════════════════════
   Aspecto
   ══════════════════════════════════════════════════════════ */
const ACCENTS = ['#7B3FE4', '#9B5CFF', '#5B2BC4', '#B14CFF', '#4F46E5', '#00C2A8', '#FF4D6D', '#F0A422'];

const AVATAR_PRESETS = ['⚽', '🔥', '⭐', '💀', '👑', '🐐', '🚀', '🧊', '⚡', '🍀', '🎯', '😎'];

/*
 * «Fondo animado» se fue: ya no hay ningún fondo que animar. Los blobs estaban
 * quietos desde antes y el aura de los temas VIP dejó de girar, así que el
 * interruptor prometía algo que no hacía.
 *
 * «Animaciones» se queda, pero ahora casi no hay diferencia entre encendido y
 * apagado: era el síntoma —apagarlo se sentía mucho más fluido— y lo que se
 * arregló fue la causa. Los indicadores de progreso no lo obedecen nunca (ver
 * `data-keep-motion` en theme.css).
 */
const LOOK_SWITCHES = {
  es: [
    { key: 'cleanMode', label: 'Sólo la cancha', description: 'Sin el menú ni los costados del sitio.' },
    { key: 'animations', label: 'Animaciones', description: 'Apagalo para que todo sea instantáneo.' },
    { key: 'welcome', label: 'Bienvenida del club', description: 'Una intro corta con el escudo al abrir la app.' },
    { key: 'welcomeSound', label: 'Sonido de la bienvenida', description: 'Se puede apagar sin quitar la animación.' },
    { key: 'sparks', label: 'Partículas doradas', description: 'Motitas de luz flotando en el menú. Se apagan solas en la partida.' },
    { key: 'musicClub', label: 'Canciones del club en el menú', description: 'Apagalo si querés que suenen sólo las tuyas. El volumen y el apagado están arriba, en la barra.' }
  ],
  en: [
    { key: 'cleanMode', label: 'Pitch only', description: "Hides HaxBall's site menu and side panels." },
    { key: 'animations', label: 'Animations', description: 'Turn it off to make everything instant.' },
    { key: 'welcome', label: 'Club welcome', description: 'A short intro with the crest when the app opens.' },
    { key: 'welcomeSound', label: 'Welcome sound', description: 'Turn it off without removing the animation.' },
    { key: 'sparks', label: 'Golden particles', description: 'Specks of light floating in the menu. They stop on their own during a match.' },
    { key: 'musicClub', label: 'Club songs in the menu', description: 'Turn it off to hear only your own. Volume and mute are up in the top bar.' }
  ]
};

const OVERLAY_SWITCHES = {
  es: [
    { key: 'enabled', label: 'Mostrar overlay', description: 'Panel flotante con tus datos en vivo.' },
    { key: 'showFps', label: 'FPS', description: null },
    { key: 'showPing', label: 'Ping', description: 'Se lee de la lista de jugadores.' },
    { key: 'showLatency', label: 'Latencia de entrada', description: 'Tecla → cuadro del juego, en ms.', hint: 'No es el ping (eso es la red). Sirve para comparar antes y después de tocar los ajustes de rendimiento.' },
    { key: 'showSession', label: 'Tiempo de sesión', description: null },
    { key: 'showClock', label: 'Reloj', description: null }
  ],
  en: [
    { key: 'enabled', label: 'Show overlay', description: 'Floating panel with your live data.' },
    { key: 'showFps', label: 'FPS', description: null },
    { key: 'showPing', label: 'Ping', description: 'Read from the player list.' },
    { key: 'showLatency', label: 'Input latency', description: 'Key → game frame, in ms.', hint: 'This is not ping (that is the network). Use it to compare before and after changing performance settings.' },
    { key: 'showSession', label: 'Session time', description: null },
    { key: 'showClock', label: 'Clock', description: null }
  ]
};

/*
 * Lo que se dibuja sobre la cancha.
 *
 * Las descripciones dicen qué se ve, no cómo está hecho.
 */
const PITCH_SWITCHES = {
  es: [
    { key: 'selfRing', label: 'Marcar tu disco', description: 'Un aro de tu color sobre tu disco.', hint: 'En un 4v4 es lo que te ahorra tener que buscarte.' },
    { key: 'teamRings', label: 'Modo daltónico', description: 'Un aro por equipo, lleno o punteado.', hint: 'Se distinguen por la forma y no por el color, así que sirve con cualquier color que le ponga la sala.' },
    { key: 'goalFlash', label: 'Efecto de gol', description: 'Onda dorada, escudo y chispas con los colores del club.', hint: 'Dura poco más de un segundo y no tapa la cancha.' },
    { key: 'goalShake', label: 'Sacudón en el gol', description: 'La cancha pega un golpe.', hint: 'No mueve la cámara del juego ni te cambia lo que podés ver.' },
    { key: 'goalClub', label: 'Festejo del plantel', description: 'Lluvia dorada y «Toda la Lecce» cuando mete un gol alguien del plantel.', hint: 'Sólo se activa con jugadores verificados con su clave, así que nadie puede fingirlo.' }
  ],
  en: [
    { key: 'selfRing', label: 'Mark your disc', description: 'A ring in your colour on your disc.', hint: 'In a 4v4 it saves you from hunting for yourself.' },
    { key: 'teamRings', label: 'Colourblind mode', description: 'One ring per team, solid or dashed.', hint: 'They are told apart by shape and not by colour, so it works with whatever colours the room picks.' },
    { key: 'goalFlash', label: 'Goal effect', description: 'Golden shockwave, crest and sparks in the club colours.', hint: 'It lasts just over a second and does not cover the pitch.' },
    { key: 'goalShake', label: 'Goal shake', description: 'The pitch takes a hit.', hint: 'It does not move the game camera or change what you can see.' },
    { key: 'goalClub', label: 'Squad celebration', description: 'Golden rain and "Toda la Lecce" when a squad member scores.', hint: 'Only fires for players verified with their key, so nobody can fake it.' }
  ]
};

/*
 * La estela abre esta lista y no la de arriba a propósito: en vivo se sacó
 * —tapaba justo la pelota que uno está mirando— y acá es de las cosas para las
 * que uno abre una grabación. Ver `replayTrail` en `store.js`.
 */
const PITCH_REPLAY_SWITCHES = {
  es: [
    { key: 'replayTrail', label: 'Estela de la pelota', description: 'La cola de por dónde ya pasó.', hint: 'No predice nada: es por dónde la pelota estuvo.' },
    { key: 'replayFullTrail', label: 'Estela completa', description: 'Todo el camino desde el saque.', hint: 'En vez de la cola de los últimos segundos.' },
    { key: 'replayLastTouch', label: 'Marcar quién la tocó', description: 'Un aro sobre el último que la tocó.' },
    { key: 'replayFreeCam', label: 'Cámara libre', description: 'Arrastrá para mover la vista.', hint: 'Doble clic la devuelve a la cámara del juego.' },
    { key: 'replayHeatmap', label: 'Mapa de calor sobre la cancha', description: 'Pinta la cancha con el recorrido de la pelota.', hint: 'Con la estela puesta las dos se mezclan. El mapa del partido que jugaste sale siempre en el resumen, sin tocar esto.' }
  ],
  en: [
    { key: 'replayTrail', label: 'Ball trail', description: 'The tail of where it already went.', hint: 'It predicts nothing: it is where the ball has been.' },
    { key: 'replayFullTrail', label: 'Full trail', description: 'The whole path since kickoff.', hint: 'Instead of the last few seconds of tail.' },
    { key: 'replayLastTouch', label: 'Mark the last touch', description: 'A ring on whoever touched it last.' },
    { key: 'replayFreeCam', label: 'Free camera', description: 'Drag to move the view.', hint: 'Double click puts it back on the game camera.' },
    { key: 'replayHeatmap', label: 'Heatmap over the pitch', description: 'Paints the pitch with the ball path.', hint: 'With the trail on, the two blend together. The map of a match you played always shows up in the summary, without touching this.' }
  ]
};

/**
 * Los dos interruptores propios del chat. Van juntos porque se dibujan en la
 * misma tarjeta, pero uno vive en `appearance` y el otro en `game`: por eso
 * cada uno declara en qué rama de la config se guarda.
 */
const CHAT_SWITCHES = {
  es: [
    {
      key: 'hideChat',
      scope: 'appearance',
      label: 'Ocultar el chat',
      description: 'Saca el chat de la pantalla.', hint: 'En la sala y en la partida. Se sigue jugando igual: sólo dejás de verlo y de poder escribir.'
    },
    {
      key: 'chatTimestamps',
      scope: 'game',
      label: 'Hora en el chat',
      description: 'Agrega la hora local delante de cada mensaje.'
    }
  ],
  en: [
    {
      key: 'hideChat',
      scope: 'appearance',
      label: 'Hide the chat',
      description: 'Takes the chat off screen.', hint: 'Both in the room and in the match. You still play the same: you just stop seeing it and typing.'
    },
    {
      key: 'chatTimestamps',
      scope: 'game',
      label: 'Chat timestamps',
      description: 'Adds the local time before each message.'
    }
  ]
};

const AVATAR_SWITCH = {
  es: { label: 'Avatar animado', description: 'Rota los cuadros mientras estás en una sala.', hint: 'Cada cambio manda un /avatar a la sala, así que muy rápido molesta a los demás.' },
  en: { label: 'Animated avatar', description: 'Rotates the frames while you are in a room.', hint: 'Each change sends an /avatar to the room, so too fast annoys everyone else.' }
};

const THEME_DARK_SWITCH = {
  es: { label: 'Tema oscuro', description: 'Apagalo si elegiste un fondo claro.' },
  en: { label: 'Dark theme', description: 'Turn it off on a light background.' }
};

function renderThemes() {
  const box = $('#themes');
  box.replaceChildren();

  // Oscuros y claros por separado: son dos decisiones distintas («cómo quiero
  // ver la app» y después «cuál»), y con quince tarjetas mezcladas se perdía.
  const entries = Object.entries(state.schema.themes);
  const groups = [
    [isEn() ? 'Dark' : 'Oscuros', entries.filter(([, m]) => !m.preview || m.preview.dark !== false)],
    [isEn() ? 'Light' : 'Claros', entries.filter(([, m]) => m.preview && m.preview.dark === false)]
  ];
  for (const [groupLabel, list] of groups) {
    if (!list.length) continue;
    const gh = document.createElement('div');
    gh.className = 'themes__label';
    gh.innerHTML = '<span></span><i></i>';
    gh.firstChild.textContent = `${groupLabel} · ${list.length}`;
    box.append(gh);
  for (const [id, meta] of list) {
    /*
     * Los temas de dos acentos son del rol. `bloqueado` es «es VIP y vos no»:
     * la tarjeta se sigue viendo entera —la gracia es que se vea lo que te
     * estás perdiendo— pero apagada y con la chapita.
     */
    const bloqueado = false;
    const card = document.createElement('button');
    card.className = `themecard${state.config.appearance.theme === id ? ' is-on' : ''}`
      + (meta.vip ? ' is-vip' : '') + (bloqueado ? ' is-locked' : '');
    card.type = 'button';

    const preview = document.createElement('div');
    preview.className = 'themecard__preview';
    preview.style.background = `linear-gradient(160deg, ${meta.preview.panel}, ${meta.preview.bg})`;
    if (meta.preview.aura) {
      preview.classList.add('has-aura');
      preview.style.setProperty('--card-aura', `${meta.preview.aura.join(', ')}, ${meta.preview.aura[0]}`);
    }
    preview.style.setProperty('--sw-line', meta.preview.dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.16)');
    // Nunca `var(--accent)`: es el acento vivo y teñía la vista previa de los
    // otros temas al cambiar de tema. `preview.accent` ya viene resuelto y fijo.
    preview.style.setProperty('--sw-accent', meta.preview.accent2
      ? `linear-gradient(120deg, ${meta.preview.accent}, ${meta.preview.accent2})`
      : meta.preview.accent);
    // Una maqueta de la app: columna lateral y contenido con barras y botón.
    const side = document.createElement('i');
    side.className = 'themecard__side';
    const main = document.createElement('div');
    main.className = 'themecard__main';
    for (let i = 0; i < 3; i++) {
      const bar = document.createElement('div');
      bar.className = 'themecard__bar';
      main.append(bar);
    }
    const btn = document.createElement('div');
    btn.className = 'themecard__btn';
    main.append(btn);
    preview.append(side, main);

    const name = document.createElement('strong');
    name.textContent = meta.label;
    const desc = document.createElement('small');
    desc.textContent = meta.description;

    card.append(preview, name, desc);


    // Sólo los VIP pueden tener temas personalizados: el lápiz de edición
    // aparece únicamente si sos VIP y el tema es custom.
    if (meta.custom) {
      const edit = document.createElement('span');
      edit.className = 'themecard__edit';
      edit.textContent = '✎';
      edit.title = t('look.customEdit');
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        openThemeEditor(id);
      });
      card.append(edit);
    }

    card.addEventListener('click', async () => {
      /*
       * Sin el rol se avisa acá y no se manda nada. `cfg:set` lo rechaza igual
       * —esa es la guarda de verdad—, pero devolver un error genérico por algo
       * que la tarjeta ya muestra con candado se lee como si la app se hubiera
       * roto. Esto dice qué pasa.
       */
      await patchConfig({ appearance: { theme: id } });
      await refreshThemeVars();
      renderThemes();
      toast(t('toast.themeApplied', { name: meta.label }), 'ok');
    });
    box.append(card);
  }
  }
}

function renderAspect() {
  const lang = isEn() ? 'en' : 'es';

  renderThemes();

  // Crear temas propios es un beneficio VIP: el botón se muestra sólo si tenés
  // el rol, y se oculta si no.
  $('#themeCreate').hidden = false;

  const swatches = $('#swatches');
  swatches.replaceChildren();
  for (const color of ACCENTS) {
    const dot = document.createElement('button');
    dot.className = `swatch${color.toLowerCase() === state.config.appearance.accent.toLowerCase() ? ' is-on' : ''}`;
    dot.type = 'button';
    dot.title = color;
    dot.style.background = `linear-gradient(140deg, ${color}, ${mixHex(color, '#120a26', 0.45)})`;
    dot.addEventListener('click', async () => {
      await patchConfig({ appearance: { accent: color } });
      await refreshThemeVars();
      renderAspect();
    });
    swatches.append(dot);
  }
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.className = 'colorinput';
  picker.value = state.config.appearance.accent;
  picker.addEventListener('input', (e) => document.documentElement.style.setProperty('--accent', e.target.value));
  picker.addEventListener('change', async (e) => {
    await patchConfig({ appearance: { accent: e.target.value } });
    await refreshThemeVars();
    renderAspect();
  });
  swatches.append(picker);

  buildSwitches(
    $('#lookSwitches'),
    LOOK_SWITCHES[lang].map((i) => ({ ...i, value: () => state.config.appearance[i.key] })),
    (item, value) => patchConfig({ appearance: { [item.key]: value } })
  );

  renderMusicOwn();
  renderAvatar();

  renderGameSettings($('#gameChat'), 'chat');
  const extra = document.createElement('div');
  buildSwitches(
    extra,
    CHAT_SWITCHES[lang].map((i) => ({ ...i, value: () => !!state.config[i.scope][i.key] })),
    (item, value) => patchConfig({ [item.scope]: { [item.key]: value } })
  );
  $('#gameChat').append(extra);

  buildSwitches(
    $('#overlaySwitches'),
    OVERLAY_SWITCHES[lang].map((i) => ({ ...i, value: () => state.config.overlay[i.key] })),
    (item, value) => patchConfig({ overlay: { [item.key]: value } })
  );

  $('#overlayPos').value = state.config.overlay.position;
  $('#overlayOpacity').value = state.config.overlay.opacity;
  $('#overlayOpacityValue').textContent = `${Math.round(state.config.overlay.opacity * 100)}%`;
  syncRangeFill($('#overlayOpacity'));

  $('#hudScale').value = state.config.appearance.hudScale;
  $('#hudScaleValue').textContent = `${Math.round(state.config.appearance.hudScale * 100)}%`;
  syncRangeFill($('#hudScale'));

  renderPitch();
}

/* ── Color de la cancha ─────────────────────────────────────────── *
 *
 * Los presets no son una paleta de colores lindos: son canchas. Cada uno sale
 * de algo que se reconoce —el césped de siempre, una cancha de noche, el piso
 * de un futsal— porque «verde 2E7D5B» no le dice nada a nadie y «Nocturna» sí.
 */
const PITCH_SKINS = [
  { id: 'grass', label: 'Césped', labelEn: 'Grass', color: '#2e7d5b', outside: '', strength: 0.8, brightness: 0, stripes: 10 },
  { id: 'night', label: 'Nocturna', labelEn: 'Night', color: '#1c3d63', outside: '#0a0f17', strength: 0.85, brightness: -0.28, stripes: 0 },
  { id: 'clay', label: 'Polvo de ladrillo', labelEn: 'Clay', color: '#a4553a', outside: '', strength: 0.8, brightness: -0.05, stripes: 0 },
  { id: 'futsal', label: 'Futsal', labelEn: 'Futsal', color: '#2f6f8f', outside: '#243447', strength: 0.9, brightness: 0.05, stripes: 0 },
  { id: 'ice', label: 'Hielo', labelEn: 'Ice', color: '#7fb3d5', outside: '', strength: 0.7, brightness: 0.18, stripes: 0 },
  { id: 'carbon', label: 'Carbón', labelEn: 'Carbon', color: '#3b3f46', outside: '#111316', strength: 0.9, brightness: -0.3, stripes: 14 }
];

function skinCfg() {
  return (state.config.pitch && state.config.pitch.skin) || {};
}

/*
 * El color de la cancha.
 *
 * La explicación larga —que no tapa las líneas, que lo claro sigue siendo
 * claro, que no da ventaja— está en el `ⓘ` del título de la sección, en el
 * HTML. Acá abajo cada control dice lo suyo en media línea.
 */
function renderPitchSkin() {
  const box = $('#pitchSkin');
  if (!box) return;
  box.replaceChildren();

  const skin = skinCfg();
  const en = isEn();

  /* ── Qué manda ──────────────────────────────────────────────────── */
  const mode = ['off', 'theme', 'custom'].includes(skin.mode) ? skin.mode : 'off';
  box.append(selectRow({
    label: en ? 'Pitch colour' : 'Color de la cancha',
    id: 'pitch-skin-mode',
    options: [
      ['off', en ? 'Stock HaxBall' : 'Como viene HaxBall'],
      ['theme', en ? 'Follow the client theme' : 'Seguir el tema del cliente'],
      ['custom', en ? 'My own colour' : 'Color propio']
    ],
    value: mode,
    onChange: async (value) => {
      await patchConfig({ pitch: { skin: { mode: value } } });
      renderPitchSkin();
    }
  }));

  // Con el color de fábrica no hay nada más que decidir: los controles de abajo
  // estarían ahí para no hacer nada.
  if (mode === 'off') return;

  /* ── Los presets y el color, sólo con «color propio» ────────────── */
  if (mode === 'custom') {
    const presets = document.createElement('div');
    presets.className = 'swatches';
    for (const preset of PITCH_SKINS) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `swatch${sameSkin(preset, skin) ? ' is-on' : ''}`;
      dot.title = (en && preset.labelEn) || preset.label;
      dot.style.background = `linear-gradient(140deg, ${preset.color}, ${mixHex(preset.color, '#0b0d10', 0.5)})`;
      dot.addEventListener('click', async () => {
        await patchConfig({
          pitch: {
            skin: {
              color: preset.color,
              outside: preset.outside,
              strength: preset.strength,
              brightness: preset.brightness,
              stripes: preset.stripes
            }
          }
        });
        renderPitchSkin();
      });
      presets.append(dot);
    }
    box.append(settingRow({
      label: en ? 'Ready-made pitches' : 'Canchas listas',
      control: presets,
      block: true
    }));

    /* ── Los dos colores ─────────────────────────────────────────────
       El campo y el borde van juntos y en la misma fila porque se eligen
       mirando uno contra el otro: lo que importa no es cada color sino el
       contraste entre los dos. */
    const colores = [
      skinColorPicker(en ? 'Field' : 'Campo', skin.color || '#2e7d5b', (value) => ({ color: value })),
      /*
       * El borde arranca en el color del campo y no en negro: así el primer
       * clic abre el selector donde uno está y no en un color que nadie eligió.
       */
      skinColorPicker(
        en ? 'Surround' : 'Borde',
        skin.outside || skin.color || '#2e7d5b',
        (value) => ({ outside: value })
      )
    ];

    // Volver a «el mismo que el campo», que es el valor de fábrica y que un
    // selector de color no puede expresar: siempre devuelve un color.
    if (skin.outside) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'btn btn--ghost btn--sm';
      reset.textContent = en ? 'Match the field' : 'Igual al campo';
      reset.addEventListener('click', async () => {
        await patchConfig({ pitch: { skin: { outside: '' } } });
        renderPitchSkin();
      });
      colores.push(reset);
    }

    box.append(settingRow({
      label: en ? 'Field and surround' : 'Campo y borde',
      control: colores
    }));
  }

  /* ── Cuánto ─────────────────────────────────────────────────────── */
  box.append(skinRange({
    id: 'pitch-skin-strength',
    label: en ? 'Strength' : 'Intensidad',
    min: 20,
    max: 100,
    step: 1,
    value: Math.round(numOr(skin.strength, 0.8) * 100),
    format: (v) => `${v}%`,
    hint: en
      ? 'How much of the new colour goes in. Lower keeps more of the original pitch.'
      : 'Cuánto entra del color nuevo. Más abajo, más se parece a la cancha de siempre.',
    onChange: (v) => patchConfig({ pitch: { skin: { strength: v / 100 } } })
  }));

  box.append(skinRange({
    id: 'pitch-skin-brightness',
    label: en ? 'Light' : 'Luz',
    min: -60,
    max: 60,
    step: 1,
    value: Math.round(numOr(skin.brightness, 0) * 100),
    format: (v) => (v === 0 ? (en ? 'as is' : 'como está') : `${v > 0 ? '+' : ''}${v}%`),
    hint: en
      ? 'Darkens or lifts the whole pitch. The lines keep their contrast either way.'
      : 'Oscurece o levanta toda la cancha. Las líneas mantienen su contraste igual.',
    onChange: (v) => patchConfig({ pitch: { skin: { brightness: v / 100 } } })
  }));

  box.append(skinRange({
    id: 'pitch-skin-stripes',
    label: en ? 'Mown stripes' : 'Franjas de césped',
    min: 0,
    max: 24,
    step: 1,
    value: Math.round(numOr(skin.stripes, 0)),
    format: (v) => (v === 0 ? (en ? 'off' : 'sin franjas') : String(v)),
    hint: en
      ? 'Bands across the field, like a freshly mown pitch. They stay put in the world, not on your screen, and never spill outside the field.'
      : 'Franjas a lo ancho del campo, como una cancha recién cortada. Se quedan quietas sobre el campo aunque muevas la cámara, y no se salen del borde.',
    onChange: (v) => patchConfig({ pitch: { skin: { stripes: v } } })
  }));
}

/** Un cuadradito de color con su nombre al lado. */
function skinColorPicker(label, value, toPatch) {
  const wrap = document.createElement('label');
  wrap.className = 'skincolor';

  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'colorinput';
  input.value = value;
  input.addEventListener('change', async (e) => {
    await patchConfig({ pitch: { skin: toPatch(e.target.value) } });
    renderPitchSkin();
  });

  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(input, text);
  return wrap;
}

/** ¿Este preset es exactamente lo que hay puesto? */
function sameSkin(preset, skin) {
  return (skin.color || '').toLowerCase() === preset.color
    && (skin.outside || '').toLowerCase() === preset.outside
    && numOr(skin.strength, 0.8) === preset.strength
    && numOr(skin.brightness, 0) === preset.brightness
    && numOr(skin.stripes, 0) === preset.stripes;
}

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Una barra de la cancha.
 *
 * Se guarda al soltar (`change`) y no mientras se arrastra: cada `input`
 * escribiría el config.json y tiraría el cache del estadio, o sea repintar la
 * cancha entera en cada píxel del arrastre. Por eso pasa `onChange` y no
 * `onInput` a `rangeRow`.
 */
function skinRange({ id, label, min, max, step, value, format, hint, onChange }) {
  return rangeRow({ id, label, hint, min, max, step, value, format, onChange });
}

/* ── Ayudas sobre la cancha ─────────────────────────────────────── */
/*
 * El selector del modo espejo.
 *
 * Es un select y no un interruptor porque son tres estados y el del medio no
 * existe: «espejado» sin decir de qué lado no quiere decir nada. Las opciones
 * se nombran por el lado que vas a VER —«Verme siempre del lado rojo»— y no por
 * el equipo, que es la confusión que tiene la función: lo que se elige no es un
 * equipo, es un lugar de la pantalla.
 */
function renderPitchMirror() {
  const box = $('#pitchMirror');
  if (!box) return;
  box.replaceChildren();

  const en = isEn();
  const actual = (state.config.pitch || {}).mirror;
  const value = ['off', 'red', 'blue'].includes(actual) ? actual : 'off';

  box.append(selectRow({
    label: en ? 'Always play on' : 'Verme siempre en',
    // La explicación de cómo se dan vuelta las teclas está en el `ⓘ` y no en
    // la fila: es el párrafo más largo de la página y explica cómo funciona,
    // no qué elegir.
    hint: en
      ? 'You pick a side and always see yourself on it. When you get the other team, the whole pitch flips and you are back where you are used to. Left and right swap with the view, so you still steer with the pitch. Only your screen changes: everyone else sees the match exactly as always.'
      : 'Elegís un lado y te ves siempre de ese lado. Cuando te toca el equipo de enfrente, la cancha se da vuelta entera y volvés a estar donde estás acostumbrado. Izquierda y derecha se cambian junto con la vista, así que seguís manejando con la cancha. Lo único que cambia es tu pantalla; el resto ve el partido igual que siempre.',
    id: 'pitch-mirror',
    options: [
      ['off', en ? 'Whatever side I get' : 'El lado que me toque'],
      ['red', en ? 'The red side (left)' : 'El lado rojo (izquierda)'],
      ['blue', en ? 'The blue side (right)' : 'El lado azul (derecha)']
    ],
    value,
    onChange: async (elegido) => {
      await patchConfig({ pitch: { mirror: elegido } });
      renderPitchMirror();
    }
  }));

  /*
   * El aviso de que se cambian las teclas sale sólo con el modo puesto.
   * Apagado no hay nada que advertir, y una nota permanente sobre algo que no
   * está pasando es ruido.
   */
  if (value !== 'off') {
    box.append(noteRow(en
      ? 'Left and right swap along with the view, so you steer with the pitch and not against it.'
      : 'Izquierda y derecha se cambian junto con la vista: seguís manejando con la cancha y no contra ella.'));
  }
}

/* Respuesta de teclas: avisa si las «Teclas filtro» de Windows están prendidas. */
async function checkKeyResponse() {
  const en = isEn();
  $('#respTitle').textContent = en ? 'Key response' : 'Respuesta de teclas';
  $('#respCheck').textContent = en ? 'Check again' : 'Revisar de nuevo';
  $('#respOpen').textContent = en ? 'Open Windows keyboard settings' : 'Abrir ajustes de teclado de Windows';
  $('#respHelp').textContent = en
    ? 'To measure any change, turn on “Input latency” in the overlay (Rendering) and compare the milliseconds.'
    : 'Para medir cualquier cambio, prendé «Latencia de entrada» en el overlay y compará los milisegundos.';
  let r = null;
  try { r = await tvm.perfKeys.check(); } catch (e) { r = null; }
  const st = $('#respStatus');
  const open = $('#respOpen');
  open.hidden = true;
  if (!r || r.supported === false) {
    st.textContent = en ? 'This check is only available on Windows.' : 'Esta revisión sólo existe en Windows.';
  } else if (r.unknown) {
    st.textContent = en ? 'Could not read the Windows setting.' : 'No pude leer el ajuste de Windows.';
  } else if (r.filterKeys) {
    st.textContent = en
      ? 'Windows “Filter Keys” is ON: it adds a delay to every key. Turn it off.'
      : 'Las «Teclas filtro» de Windows están ENCENDIDAS: agregan un retardo a cada tecla. Conviene apagarlas.';
    open.hidden = false;
  } else {
    st.textContent = en ? 'Windows “Filter Keys” is off. Nothing slows your keys.' : 'Las «Teclas filtro» de Windows están apagadas: nada frena tus teclas.';
  }
}
$('#respCheck').addEventListener('click', checkKeyResponse);
$('#respOpen').addEventListener('click', () => { try { tvm.perfKeys.openSettings(); } catch (e) { /* sin permiso */ } });
setTimeout(checkKeyResponse, 1500);

function renderPitch() {
  const lang = isEn() ? 'en' : 'es';
  renderPitchSkin();
  renderPitchMirror();

  /*
   * El valor se lee de `state.config` en cada consulta y NO de una copia
   * tomada acá: `patchConfig` reemplaza el objeto entero, así que un
   * `pitch` capturado quedaría viejo y el interruptor volvería solo a su
   * posición anterior apenas lo tocás.
   */
  const live = (key) => !!(state.config.pitch || {})[key];

  buildSwitches(
    $('#pitchSwitches'),
    PITCH_SWITCHES[lang].map((i) => ({ ...i, value: () => live(i.key) })),
    (item, value) => patchConfig({ pitch: { [item.key]: value } })
  );

  buildSwitches(
    $('#pitchReplaySwitches'),
    PITCH_REPLAY_SWITCHES[lang].map((i) => ({ ...i, value: () => live(i.key) })),
    async (item, value) => {
      await patchConfig({ pitch: { [item.key]: value } });
      if (item.key === 'replayTrail' || item.key === 'replayFullTrail') syncTrailField();
    }
  );

  const ms = Number((state.config.pitch || {}).trailMs) || 320;
  $('#pitchTrailMs').value = ms;
  $('#pitchTrailMsValue').textContent = `${ms} ms`;
  syncRangeFill($('#pitchTrailMs'));
  syncTrailField();
}

/**
 * El largo sólo importa si hay una cola que medir: sin estela no hace nada, y
 * con la estela COMPLETA tampoco —esa va desde el saque, no tiene largo—.
 */
function syncTrailField() {
  const pitch = state.config.pitch || {};
  $('#pitchTrailField').hidden = !pitch.replayTrail || !!pitch.replayFullTrail;
}

$('#pitchTrailMs').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#pitchTrailMsValue').textContent = `${Number(e.target.value)} ms`;
});
$('#pitchTrailMs').addEventListener('change', (e) => patchConfig({ pitch: { trailMs: Number(e.target.value) } }));

$('#overlayPos').addEventListener('change', (e) => patchConfig({ overlay: { position: e.target.value } }));
$('#overlayOpacity').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#overlayOpacityValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#overlayOpacity').addEventListener('change', (e) => patchConfig({ overlay: { opacity: Number(e.target.value) } }));

/* Mis canciones: las suma cada jugador desde su PC (se guardan en su carpeta de datos). */
async function renderMusicOwn() {
  const box = $('#musicOwn');
  if (!box) return;
  const en = isEn();
  let mine = [];
  try { mine = (await tvm.tracks.list()).filter((t) => t.user); } catch (e) { mine = []; }
  box.replaceChildren();
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn--ghost btn--sm';
  add.textContent = en ? 'Add songs…' : 'Agregar canciones…';
  add.addEventListener('click', async () => {
    try {
      const r = await tvm.tracks.add();
      if (r && r.added) toast(en ? `${r.added} song(s) added` : `${r.added} canción(es) agregada(s)`, 'ok');
      if (r && r.skipped) toast(en ? `${r.skipped} skipped (too big or not audio)` : `${r.skipped} no se pudieron agregar (muy pesadas o no son audio)`, 'err');
      if (r && r.added && window.TLMusic) await window.TLMusic.reload();
      renderMusicOwn();
    } catch (e) { toast(e.message, 'err'); }
  });
  box.append(settingRow({
    label: en ? 'My songs' : 'Mis canciones',
    description: en ? 'Add mp3 files from your PC; they play along with the club songs.' : 'Sumá mp3 de tu PC: suenan junto con las del club.',
    control: add
  }));
  for (const t of mine) {
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn--ghost btn--sm';
    rm.textContent = en ? 'Remove' : 'Quitar';
    rm.addEventListener('click', async () => {
      try {
        await tvm.tracks.remove(t.name);
        if (window.TLMusic) await window.TLMusic.reload();
      } catch (e) { toast(e.message, 'err'); }
      renderMusicOwn();
    });
    box.append(settingRow({ label: t.name.replace(/\.[a-z0-9]+$/i, ''), control: rm }));
  }
}

/* «Ahora suena». Si a la derecha de la lista de salas hay un hueco ancho, es una tarjeta que se queda mientras suena
   la música; si no hay lugar, es una píldora que se muestra unos segundos al cambiar de tema. */
let npTimer = null;
let npTitle = '';
let npPlaying = false;
let npProgress = null;
const NP_CARD_W = 250;
function layoutNowPlaying() {
  const el = $('#nowPlaying');
  const panel = document.querySelector('.rpanel');
  const gap = panel && panel.offsetParent ? window.innerWidth - panel.getBoundingClientRect().right : 0;
  const card = gap >= NP_CARD_W + 40;
  el.classList.toggle('np--card', card);
  el.style.right = card ? `${Math.round((gap - NP_CARD_W) / 2)}px` : '';
  return card;
}
function showNowPlaying(ms) {
  const el = $('#nowPlaying');
  if (!el || !npTitle) return;
  const card = layoutNowPlaying();
  $('#npTitle').textContent = npTitle;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-in'));
  clearTimeout(npTimer);
  // La tarjeta se queda mientras suene algo; la píldora se va sola.
  if (!card) npTimer = setTimeout(hideNowPlaying, ms || 6000);
  clearInterval(npProgress);
  npProgress = setInterval(() => {
    const bar = $('#npBar');
    if (bar && window.TLMusic) bar.style.transform = `scaleX(${window.TLMusic.progress().toFixed(3)})`;
  }, 500);
}
function hideNowPlaying() {
  const el = $('#nowPlaying');
  if (!el) return;
  el.classList.remove('is-in');
  clearTimeout(npTimer);
  clearInterval(npProgress);
  npTimer = setTimeout(() => { if (!el.classList.contains('is-in')) el.hidden = true; }, 350);
}
window.addEventListener('resize', () => {
  const el = $('#nowPlaying');
  if (!el || el.hidden) return;
  if (layoutNowPlaying()) clearTimeout(npTimer);
  else { clearTimeout(npTimer); npTimer = setTimeout(hideNowPlaying, 4000); }
});
window.addEventListener('tl:track', (e) => {
  // Para el resplandor del fondo: sólo importa si suena o no.
  if (e.detail) document.documentElement.dataset.musicPlaying = e.detail.playing ? 'on' : 'off';
  const d = e.detail || {};
  $('#audEq').classList.toggle('is-playing', !!d.playing);
  $('#nowPlaying .eq').classList.toggle('is-playing', !!d.playing);
  $('#nowPlaying').classList.toggle('is-playing', !!d.playing);
  npPlaying = !!d.playing;
  if (d.playing && d.title) { npTitle = d.title; showNowPlaying(6000); }
  else if (!d.playing) hideNowPlaying();
});
$('#nowPlaying').addEventListener('mouseenter', () => clearTimeout(npTimer));
$('#nowPlaying').addEventListener('mouseleave', () => { if (!$('#nowPlaying').classList.contains('np--card')) npTimer = setTimeout(hideNowPlaying, 2500); });
// Al pasar por la música se muestra el tema; al pasar por los estilos de sonido se esconde, porque ahí se abre su selector.
$('#audMusic').addEventListener('mouseenter', () => showNowPlaying(4500));
$('.audio__sfx').addEventListener('mouseenter', hideNowPlaying);
$('#npPrev').addEventListener('click', () => window.TLMusic && window.TLMusic.prev());
$('#npNext').addEventListener('click', () => window.TLMusic && window.TLMusic.next());

/* Audio del menú (barra superior): música on/off, volumen y sonidos de botones. */
function paintAudio() {
  try { paintGameExtras(); } catch (e) { /* adorno */ }
  try { paintAnimations(); } catch (e) { /* adorno */ }
  try { paintDensity(); } catch (e) { /* adorno */ }
  try { paintLayout(); paintStatusBar(); } catch (e) { /* adorno */ }
  try { paintMixer(); } catch (e) { /* adorno */ }
  const ap = (state.config && state.config.appearance) || {};
  const vol = typeof ap.musicVolume === 'number' ? ap.musicVolume : 0.35;
  $('#audMusic').classList.toggle('is-off', ap.music === false);
  $('#audSfx').classList.toggle('is-off', ap.uiSounds === false);
  const styleNames = isEn()
    ? { soft: 'Soft', modern: 'Modern', arcade: 'Arcade', lofi: 'Lo-fi', wood: 'Wood', bubble: 'Bubble' }
    : { soft: 'Suave', modern: 'Moderno', arcade: 'Arcade', lofi: 'Lofi', wood: 'Madera', bubble: 'Burbuja' };
  document.querySelectorAll('#audSfxMenu .chip').forEach((chip) => {
    chip.textContent = styleNames[chip.dataset.style];
    chip.classList.toggle('is-active', chip.dataset.style === (ap.uiSoundStyle || 'modern'));
  });
  $('#audMusic').setAttribute('aria-pressed', String(ap.music !== false));
  $('#audSfx').setAttribute('aria-pressed', String(ap.uiSounds !== false));
  const range = $('#audVol');
  if (document.activeElement !== range) range.value = String(vol);
  syncRangeFill(range);
}
$('#audMusic').addEventListener('click', () => patchConfig({ appearance: { music: state.config.appearance.music === false } }));
$('#audSfx').addEventListener('click', () => patchConfig({ appearance: { uiSounds: state.config.appearance.uiSounds === false } }));
document.querySelectorAll('#audSfxMenu .chip').forEach((chip) => {
  chip.addEventListener('click', async () => {
    // Se oye el estilo elegido al instante, aunque la config tarde en volver.
    if (window.TLSfx) { window.TLSfx.configure(true, chip.dataset.style); window.TLSfx.play('on'); }
    await patchConfig({ appearance: { uiSoundStyle: chip.dataset.style, uiSounds: true } });
  });
});
$('#audVol').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  if (window.TLMusic) window.TLMusic.configure(state.config.appearance.music !== false, Number(e.target.value), state.config.appearance.musicClub !== false);
});
$('#audVol').addEventListener('change', (e) => patchConfig({ appearance: { musicVolume: Number(e.target.value), music: true } }));



/* Animaciones del menú: interruptores, transición, estilo y cantidad de partículas. */
const ANIM_SWITCHES = {
  es: [
    { key: 'crestBreath', label: 'Escudo que respira', description: 'Un latido muy suave del escudo en la barra y la pantalla de inicio.' },
    { key: 'roomCurtain', label: 'Cortina al entrar a una sala', description: 'El escudo tapa la pantalla un instante mientras carga la sala.' },
    { key: 'toggleBounce', label: 'Interruptores con rebote', description: 'Los interruptores dan un saltito al cambiar.' },
    { key: 'listStagger', label: 'Filas que entran de a una', description: 'Las salas y los ajustes aparecen en cascada al abrir la pantalla.' },
    { key: 'musicGlow', label: 'Fondo con la música', description: 'Un resplandor suave del color de acento late abajo mientras suena la música del menú.' },
    { key: 'accentDrift', label: 'Acento que cambia solo', description: 'El color de acento pasa despacio por el arcoíris (un paso cada 20 s). Se apaga solo al cerrar la app.' },
    { key: 'goalEdge', label: 'Destello de gol en los bordes', description: 'Un pulso con el color del equipo que anotó, en el borde de la pantalla.' },
    { key: 'joinSparkle', label: 'Chispas al entrar un compañero', description: 'Brilla el nombre cuando entra a la sala alguien verificado del club.' }
  ],
  en: [
    { key: 'crestBreath', label: 'Breathing crest', description: 'A very soft pulse on the crest in the sidebar and start screen.' },
    { key: 'roomCurtain', label: 'Curtain when entering a room', description: 'The crest covers the screen briefly while the room loads.' },
    { key: 'toggleBounce', label: 'Bouncy switches', description: 'Switches give a little hop when toggled.' },
    { key: 'listStagger', label: 'Rows that enter one by one', description: 'Rooms and settings cascade in when a screen opens.' },
    { key: 'musicGlow', label: 'Background with the music', description: 'A soft glow in the accent colour pulses at the bottom while the menu music plays.' },
    { key: 'accentDrift', label: 'Self-changing accent', description: 'The accent colour slowly walks the rainbow (one step every 20 s). It turns itself off when the app closes.' },
    { key: 'goalEdge', label: 'Goal glow on the screen edges', description: 'A pulse in the scoring team’s colour around the screen edge.' },
    { key: 'joinSparkle', label: 'Sparkles when a teammate joins', description: 'The name glows when a verified club member joins the room.' }
  ]
};
const PAGE_TRANS = [['off', 'Sin transición', 'None'], ['fade', 'Fundido', 'Fade'], ['slide', 'Deslizar', 'Slide'], ['zoom', 'Zoom', 'Zoom']];
const SPARK_STYLES = [['oro', 'Oro', 'Gold'], ['estrellas', 'Estrellas', 'Stars'], ['luciernagas', 'Luciérnagas', 'Fireflies'], ['nieve', 'Nieve', 'Snow'], ['confeti', 'Confeti', 'Confetti']];
const SPARK_COUNTS = [[20, 'Pocas', 'Few'], [40, 'Normal', 'Normal'], [80, 'Muchas', 'Many']];

function paintAnimations() {
  const host = $('#animSwitches');
  if (!host || !state.config) return;
  const lang = isEn() ? 'en' : 'es';
  const ap = state.config.appearance;
  $('#animTitle').textContent = lang === 'en' ? 'Menu animations' : 'Animaciones del menú';
  $('#animDesc').textContent = lang === 'en'
    ? 'Cheap motion only. Everything stops with “Animations” off.'
    : 'Sólo movimiento barato. Todo se apaga con «Animaciones» apagado.';
  $('#pageTransLabel').textContent = lang === 'en' ? 'Screen transition' : 'Transición entre pantallas';
  $('#sparkStyleLabel').textContent = lang === 'en' ? 'Menu particles' : 'Partículas del menú';
  $('#sparkDensLabel').textContent = lang === 'en' ? 'Particle amount' : 'Cantidad de partículas';
  buildSwitches(
    host,
    ANIM_SWITCHES[lang].map((i) => ({ ...i, value: () => !!state.config.appearance[i.key] })),
    (item, value) => patchConfig({ appearance: { [item.key]: value } })
  );
  const fill = (el, items, cur, attr) => {
    el.replaceChildren();
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (String(it[0]) === String(cur) ? ' is-active' : '');
      b.dataset[attr] = it[0];
      b.textContent = lang === 'en' ? it[2] : it[1];
      el.append(b);
    }
  };
  fill($('#pageTransChips'), PAGE_TRANS, ap.pageTransition || 'fade', 'pt');
  fill($('#sparkStyleChips'), SPARK_STYLES, ap.sparkStyle || 'oro', 'ss');
  fill($('#sparkDensChips'), SPARK_COUNTS, ap.sparkCount || 40, 'sc');
}
(function wireAnimations() {
  const on = (sel, attr, key, conv) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('click', (e) => {
      const b = e.target.closest(`[data-${attr}]`);
      if (b) patchConfig({ appearance: { [key]: conv ? conv(b.dataset[attr]) : b.dataset[attr] } });
    });
  };
  on('#pageTransChips', 'pt', 'pageTransition');
  on('#sparkStyleChips', 'ss', 'sparkStyle');
  on('#sparkDensChips', 'sc', 'sparkCount', Number);
})();

/*
 * Acento que cambia solo: un paso cada 20 s en vez de un bucle por cuadro. La
 * transición de 20 s del color la hace el motor de CSS (`--accent` registrado
 * como <color>), así que no hay JS corriendo entre un paso y el siguiente.
 */
let driftTimer = 0;
let driftHue = 0;
function hslHex(h, sat, lig) {
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function syncAccentDrift() {
  const ap = (state.config && state.config.appearance) || {};
  const want = ap.accentDrift === true && ap.animations !== false;
  if (!want) {
    if (driftTimer) { clearInterval(driftTimer); driftTimer = 0; refreshThemeVars(); }
    return;
  }
  if (driftTimer) return;
  const step = async () => {
    const app = document.getElementById('app');
    if (document.hidden || (app && app.dataset.stage === 'game')) return;
    driftHue = (driftHue + 24) % 360;
    const vars = await tvm.theme.vars(hslHex(driftHue, 0.62, 0.46)).catch(() => null);
    if (vars && driftTimer) applyThemeVars(vars);
  };
  driftTimer = setInterval(step, 20000);
  step();
}

/* Sonido de gol incluido y estilo del cartel de marcador. */
const SCOREBOARDS = [
  ['default', 'Normal', 'Default'], ['club', 'Club dorado', 'Gold club'], ['neon', 'Neón', 'Neon'],
  ['minimal', 'Minimal', 'Minimal'], ['tv', 'Clásico TV', 'TV classic']
];
function paintGameExtras() {
  const ap = (state.config && state.config.appearance) || {};
  const en = isEn();
  $('#goalSfxLabel').textContent = en ? 'Built-in goal sound' : 'Sonido de gol incluido';
  $('#goalSfxVolLabel').textContent = en ? 'Built-in volume' : 'Volumen del incluido';
  $('#scoreboardLabel').textContent = en ? 'Scoreboard style' : 'Cartel de marcador';
  const fill = (host, items, cur, attr) => {
    host.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (it[0] === cur ? ' is-active' : '');
      b.dataset[attr] = it[0];
      b.textContent = en ? it[2] : it[1];
      host.appendChild(b);
    }
  };
  fill($('#goalSfxChips'), (window.TLGoalSfx ? window.TLGoalSfx.STYLES : []), ap.goalSfx || 'default', 'sfx');
  fill($('#scoreboardChips'), SCOREBOARDS, ap.scoreboard || 'default', 'sb');
  const v = typeof ap.goalSfxVolume === 'number' ? ap.goalSfxVolume : 0.7;
  const r = $('#goalSfxVolume');
  if (document.activeElement !== r) r.value = String(v);
  $('#goalSfxVolumeValue').textContent = `${Math.round(v * 100)}%`;
  syncRangeFill(r);
}
$('#goalSfxChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sfx]');
  if (!b) return;
  const vol = state.config.appearance.goalSfxVolume ?? 0.7;
  if (window.TLGoalSfx) window.TLGoalSfx.play(b.dataset.sfx, vol);
  patchConfig({ appearance: { goalSfx: b.dataset.sfx } });
});
$('#scoreboardChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sb]');
  if (b) patchConfig({ appearance: { scoreboard: b.dataset.sb } });
});
$('#goalSfxVolume').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#goalSfxVolumeValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#goalSfxVolume').addEventListener('change', (e) => {
  const v = Number(e.target.value);
  const st = state.config.appearance.goalSfx;
  if (window.TLGoalSfx && st && st !== 'default') window.TLGoalSfx.play(st, v);
  patchConfig({ appearance: { goalSfxVolume: v } });
});
try { if (state && state.config) paintGameExtras(); } catch (e) { /* aún sin config */ }

$('#hudScale').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#hudScaleValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#hudScale').addEventListener('change', (e) => patchConfig({ appearance: { hudScale: Number(e.target.value) } }));

/* ── Avatar ─────────────────────────────────────────────── */
function avatarFrames(text) {
  const value = String(text || '').trim();
  if (!value) return [];
  try {
    const segmenter = new Intl.Segmenter('es', { granularity: 'grapheme' });
    return [...segmenter.segment(value)].map((s) => s.segment).filter((c) => c.trim());
  } catch {
    return [...value].filter((c) => c.trim());
  }
}

function renderAvatar() {
  const lang = isEn() ? 'en' : 'es';
  const avatar = state.config.avatar || {};

  $('#avatarStatic').value = avatar.static || '';
  // El placeholder deja ver el avatar que trae HaxBall aunque el campo del
  // cliente esté vacío: se entiende que hay uno puesto y de dónde salió.
  $('#avatarStatic').placeholder = state.liveAvatar || '⚽';
  $('#avatarFrames').value = avatar.frames || '';
  $('#avatarSpeed').value = avatar.intervalMs || 700;
  $('#avatarSpeedValue').textContent = `${avatar.intervalMs || 700} ms`;
  syncRangeFill($('#avatarSpeed'));
  paintAvatarPreview();

  const presets = $('#avatarPresets');
  presets.replaceChildren();
  for (const emoji of AVATAR_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emojibtn';
    button.textContent = emoji;
    button.addEventListener('click', () => setStaticAvatar(emoji));
    presets.append(button);
  }

  buildSwitches($('#avatarSwitch'), [{
    ...AVATAR_SWITCH[lang],
    key: 'animated',
    value: () => !!state.config.avatar.animated
  }], async (item, value) => {
    await patchConfig({ avatar: { animated: value } });
    syncAvatarFields();
  });

  renderAvatarImage();
  renderBallImage();
  syncAvatarFields();
}

/**
 * La imagen sobre el disco.
 *
 * Vivía adentro de la tarjeta VIP y ahora es de todos: la dibuja tu propia
 * máquina sobre tu propio disco y no sale de tu pantalla, así que no hay nada
 * que destrabar. Lo que sigue siendo del rol es que se MUEVA — un GIF sin rol
 * se ve como en cualquier lado sin animación: su primer cuadro, quieto.
 */
function renderAvatarImage() {
  const file = (state.config.vip || {}).avatarImage || '';
  const face = $('#vipAvatarPreview');
  face.replaceChildren();
  if (file) {
    const img = document.createElement('img');
    img.src = fileUrl(file);
    face.append(img);
  } else {
    face.textContent = '—';
  }

  /*
   * La línea de abajo aparece sólo cuando hay algo que decir.
   *
   * Antes acá vivía una descripción fija de tres renglones que estaba siempre,
   * dijera algo o no. Lo único que de verdad hay que avisar es cuando la imagen
   * NO se va a ver: sin un avatar de texto puesto el cliente no tiene con qué
   * reconocer cuál disco es el tuyo, y la imagen no se dibuja nunca.
   */
  const nota = $('#avatarImageNote');
  const avatar = state.config.avatar || {};
  const sinMarca = !avatar.static && !state.liveAvatar
    && !(avatar.animated && avatarFrames(avatar.frames).length);
  const esGif = /\.gif$/i.test(file);

  const aviso = !file ? ''
    : sinMarca ? t('avatar.imageNeedsText')
      : esGif ? t('avatar.gifOn')
        : '';

  nota.hidden = !aviso;
  nota.textContent = aviso;
  nota.classList.toggle('note--warn', !!aviso && sinMarca);
}

/**
 * La imagen de la pelota.
 *
 * Más simple que la del avatar: la pelota no necesita ninguna «marca» para que
 * el cliente sepa cuál es —es una sola y el parche del bundle la señala—, así
 * que lo único que hay para avisar es lo del GIF y el rol.
 */
function renderBallImage() {
  buildSwitches($('#ball3dSwitch'), [
    { key: 'ball3d', label: t('ball.3d'), description: t('ball.3dHelp'), value: () => !!state.config.pitch.ball3d }
  ], (item, value) => patchConfig({ pitch: { [item.key]: value } }));
  const file = (state.config.vip || {}).ballImage || '';
  const face = $('#vipBallPreview');
  face.replaceChildren();
  if (file) {
    const img = document.createElement('img');
    img.src = fileUrl(file);
    face.append(img);
  } else {
    face.textContent = '—';
  }

  const nota = $('#ballImageNote');
  const esGif = /\.gif$/i.test(file);
  const aviso = !file ? ''
    : esGif ? t('ball.gifOn')
      : t('ball.onlyYou');

  nota.hidden = !aviso;
  nota.textContent = aviso;
  nota.classList.toggle('note--warn', false);
}

function syncAvatarFields() {
  const on = !!state.config.avatar.animated;
  $('#avatarFramesField').hidden = !on;
  $('#avatarSpeedField').hidden = !on;
}

function paintAvatarPreview() {
  const avatar = state.config.avatar || {};
  // Si el cliente todavía no tiene avatar propio se muestra el que HaxBall ya
  // tenía guardado, que es el que el jugador ve en la cancha ahora mismo.
  const face = avatar.animated
    ? (avatarFrames(avatar.frames)[0] || '')
    : (avatar.static || state.liveAvatar || '');
  const box = $('#avatarPreview');
  box.textContent = face || t('avatar.none');
  box.classList.toggle('is-empty', !face);
}

/**
 * HaxBall recorta el avatar a dos unidades UTF-16, no a dos caracteres: 🔥 ya
 * ocupa las dos. Se agregan símbolos enteros mientras entren, para que nunca
 * viaje medio emoji.
 */
function clampAvatar(text) {
  const max = state.schema.avatarMax;
  const value = String(text || '').trim();
  if (value.length <= max) return value;

  let out = '';
  for (const glyph of avatarFrames(value)) {
    if (out.length + glyph.length > max) break;
    out += glyph;
  }
  return out;
}

async function setStaticAvatar(value) {
  const face = clampAvatar(value);
  // Una bandera o un emoji de familia ocupan cuatro unidades o más: no entran
  // en el presupuesto de HaxBall y se caen enteros. Mejor decirlo.
  if (value && !face) {
    toast(t('avatar.tooBig'), 'err');
    $('#avatarStatic').value = state.config.avatar.static || '';
    return;
  }
  $('#avatarStatic').value = face;
  await patchConfig({ avatar: { static: face } });
  paintAvatarPreview();
  // El avatar fijo se puede cambiar en caliente con /avatar: no hace falta
  // recargar el juego ni esperar a la próxima sesión.
  tvm.avatar.preview();
}

$('#avatarStatic').addEventListener('change', (e) => setStaticAvatar(e.target.value));

$('#avatarFrames').addEventListener('change', async (e) => {
  const frames = e.target.value.trim().slice(0, 40);
  if (frames && avatarFrames(frames).length < 2) {
    toast(t('avatar.needTwo'), 'err');
    return;
  }
  await patchConfig({ avatar: { frames } });
  paintAvatarPreview();
});

$('#avatarSpeed').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#avatarSpeedValue').textContent = `${e.target.value} ms`;
});
$('#avatarSpeed').addEventListener('change', (e) => patchConfig({ avatar: { intervalMs: Number(e.target.value) } }));

/* ══════════════════════════════════════════════════════════
   VIP
   ══════════════════════════════════════════════════════════
   Los beneficios de esta instalación están habilitados sin iniciar sesión.
   ══════════════════════════════════════════════════════════ */
function vipProfile() {
  return (state.config.vip && state.config.vip.discord) || null;
}

function isVip() {
  return true;
}

/**
 * Cuánto te queda de VIP, en días.
 *
 * Sale de `vipUntil`, que es lo que el panel sabe de tu suscripción, y NUNCA de
 * `expiresAt`: ése es el vencimiento del token firmado —cuánto se cree la app
 * este veredicto sin volver a preguntar— y dura horas o un par de días. Con
 * `expiresAt` el cartel diría «te quedan 7 días» a todo el mundo, para siempre,
 * y encima se reiniciaría solo en cada comprobación.
 *
 * `Infinity` es un VIP que no vence, que es lo que significa `vipUntil: null` en
 * el contrato del panel (ver el README) y lo que devuelve hoy para las cuentas
 * con el rol permanente. Ojo con esto si algún día se venden meses: un panel que
 * no complete la fecha va a hacer que TODOS se lean como permanentes.
 *
 * @returns {number|null} días enteros hacia arriba, `Infinity` si no vence, o
 *                        `null` si no hay rol o la fecha ya pasó.
 */
function vipDaysLeft(profile) {
  if (!profile || !profile.vip) return null;
  // Sin fecha —o con una ilegible— no hay cuenta regresiva que hacer.
  const hasta = profile.vipUntil ? Date.parse(profile.vipUntil) : NaN;
  if (!Number.isFinite(hasta)) return Infinity;

  const faltan = hasta - Date.now();
  if (faltan <= 0) return null;
  // Por días enteros y hacia arriba: al que le quedan 30 horas le quedan dos
  // días, no uno. Redondear para abajo le regala un día de menos al que paga.
  return Math.ceil(faltan / 86400000);
}

/** La frase entera, para la tarjeta de VIP en Aspecto. */
function vipRemaining(profile) {
  const dias = vipDaysLeft(profile);
  if (dias === null) return null;
  if (dias === Infinity) return t('vip.noExpiry');

  // Sin la hora: `formatDate` la incluye, y en una fecha a dos semanas los
  // minutos no le dicen nada a nadie.
  const dia = new Date(Date.parse(profile.vipUntil)).toLocaleDateString(isEn() ? 'en-GB' : 'es-AR',
    { day: '2-digit', month: 'short', year: 'numeric' });
  return dias === 1 ? t('vip.lastDay', { when: dia }) : t('vip.daysLeft', { days: dias, when: dia });
}

/**
 * La versión corta, para la fila del menú de la barra: ahí al lado del chip VIP
 * y del «activo» no entra una oración con fecha.
 */
function vipRemainingShort(profile) {
  const dias = vipDaysLeft(profile);
  if (dias === null) return null;
  if (dias === Infinity) return t('me.vipForever');
  return dias === 1 ? t('me.vipLastDay') : t('me.vipDays', { days: dias });
}

function renderVip() {
  renderVipAssets();
}

/* ── Cómo te ven los demás ──────────────────────────────────────────────────
 *
 * Es el único cosmético VIP que no dibuja tu máquina: viaja en el latido de
 * presencia y lo pinta el cliente de la otra persona sobre tu fila de la lista
 * de jugadores (ver `panel.js` y `paintPeers` en `game-preload.js`). El sitio
 * lo limpia antes de repartirlo, así que acá alcanza con guardarlo. */

const LOOK_FONTS = {
  outfit: 'Outfit, system-ui, sans-serif',
  mono: 'ui-monospace, Consolas, monospace',
  serif: 'Georgia, "Times New Roman", serif',
  round: '"Comic Sans MS", "Segoe UI", sans-serif',
  impact: 'Impact, "Arial Black", sans-serif'
};

/**
 * Los degradados que se pueden elegir. Tienen que ser los MISMOS ids que en
 * `game-preload.js` (el que los dibuja en la sala) y en `client.routes.js` del
 * sitio (el que los valida). Lo que viaja por la red es el id, nunca el CSS.
 */
const LOOK_GRADIENTS = {
  violeta:    { label: 'Violeta',    a: '#a78bfa', b: '#7c3aed', text: '#ddd0ff' },
  oceano:     { label: 'Océano',     a: '#7dd3fc', b: '#0ea5e9', text: '#cdeeff' },
  esmeralda:  { label: 'Esmeralda',  a: '#6ee7b7', b: '#10b981', text: '#ccf5e4' },
  fuego:      { label: 'Fuego',      a: '#fdba74', b: '#f97316', text: '#ffe0c4' },
  rubi:       { label: 'Rubí',       a: '#fda4af', b: '#f43f5e', text: '#ffd7dc' },
  rosa:       { label: 'Rosa',       a: '#f9a8d4', b: '#ec4899', text: '#ffd9ed' },
  oro:        { label: 'Oro',        a: '#fde68a', b: '#f59e0b', text: '#ffeeb8' },
  medianoche: { label: 'Medianoche', a: '#94a3b8', b: '#475569', text: '#dbe3ec' }
};

/** '#rrggbb' → 'rgba(r, g, b, alpha)'. */
function rgbaOf(hex, alpha) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * La fila de un VIP, igual que la dibuja el juego.
 *
 * Es la MISMA receta que `peerLook` en `room-ui.js` (con la lista oscura de
 * HaxBall, que es sobre la que se la ve), y tiene que seguir siéndolo: esta
 * muestra existe para enseñar lo que va a ver el de al lado, así que si las dos
 * se separan, miente.
 */
function auraOf(look) {
  return {
    '--tvm-vip-bg': `linear-gradient(90deg, ${rgbaOf(look.a, 0.26)} 0%, ${rgbaOf(look.b, 0.12)} 42%, ${rgbaOf(look.b, 0)} 78%)`,
    '--tvm-vip-bg-hi': `linear-gradient(90deg, ${rgbaOf(look.a, 0.38)} 0%, ${rgbaOf(look.b, 0.2)} 50%, ${rgbaOf(look.b, 0.04)} 92%)`,
    '--tvm-vip-edge': `inset 3px 0 0 ${look.b}, inset 0 0 0 1px ${rgbaOf(look.a, 0.22)}`,
    '--tvm-vip-name': `linear-gradient(90deg, ${look.text}, ${look.a})`
  };
}

/** El cuadradito del selector: ahí sí va el color macizo, es la identidad. */
function swatchOf(look) {
  return `linear-gradient(135deg, ${look.a}, ${look.b})`;
}

function looksOf() {
  return (state.config.vip && state.config.vip.cosmetics) || {};
}

/*
 * Los mismos controles viven en dos lugares —Ajustes y el perfil— y son el MISMO
 * cosmético: los dos escriben en `config.vip.cosmetics`. Por eso el pintado es
 * uno solo y lo que cambia son los elementos; duplicarlo sería garantizar que
 * algún día uno de los dos quede viejo.
 */
const VIP_LOOK_IDS = {
  demo: '#vipLookPreview', name: '#vipLookName',
  font: '#vipLookFont', gradients: '#vipGradients'
};
const PROFILE_LOOK_IDS = {
  demo: '#profileLookPreview', name: '#profileLookName',
  font: '#profileLookFont', gradients: '#profileGradients'
};

/**
 * @param {object} ids    qué elementos pintar (ver arriba)
 * @param {object} looks  `{ gradient, font }`
 * @param {{editable:boolean, name:string}} opts  sin `editable` la muestra se
 *        dibuja igual pero no se toca el selector ni los degradados: es el
 *        cosmético de otra persona.
 */
function paintLooks(ids, looks, { editable = true, name } = {}) {
  // La muestra es la fila del juego, con el degradado a lo ancho: es
  // exactamente lo que va a ver el de al lado.
  const look = LOOK_GRADIENTS[looks.gradient];
  const aura = look ? auraOf(look) : null;
  const demo = $(ids.demo);
  for (const key of ['--tvm-vip-bg', '--tvm-vip-bg-hi', '--tvm-vip-edge', '--tvm-vip-name']) {
    if (aura) demo.style.setProperty(key, aura[key]);
    else demo.style.removeProperty(key);
  }
  demo.style.color = look ? look.text : '';
  demo.classList.toggle('is-on', !!look);
  $(ids.name).textContent = name;
  $(ids.name).style.fontFamily = LOOK_FONTS[looks.font] || '';

  if (!editable) return;
  $(ids.font).value = looks.font || 'default';
  $(ids.gradients).replaceChildren(...Object.entries(LOOK_GRADIENTS).map(([id, item]) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'gradients__item';
    swatch.style.backgroundImage = swatchOf(item);
    swatch.title = item.label;
    swatch.setAttribute('aria-label', item.label);
    swatch.setAttribute('aria-pressed', String(looks.gradient === id));
    swatch.classList.toggle('is-on', looks.gradient === id);
    swatch.addEventListener('click', () => saveLooks({ gradient: looks.gradient === id ? '' : id }));
    return swatch;
  }));
}

function renderVipLooks() {
  paintLooks(VIP_LOOK_IDS, looksOf(), {
    name: (state.config.general.nickname || '').trim() || t('vip.looksYou')
  });
}

/**
 * Guarda el cosmético y REPINTA.
 *
 * El repintado no es opcional y faltaba: `patchConfig` guarda y llama a
 * `applyConfig`, que sólo toca el idioma y las animaciones — no sabe nada de los
 * degradados. Así que al clickear un degradado la elección se guardaba bien y
 * viajaba a la sala, pero acá no se movía nada: ni el recuadro marcado ni la
 * muestra de la fila. Parecía que el botón no hacía nada, y sólo se veía el
 * cambio al volver a entrar a la pestaña.
 *
 * Se espera al guardado antes de repintar porque `renderVipLooks` lee de
 * `state.config`, y quien lo actualiza es `applyConfig` con la respuesta del
 * proceso principal: repintar antes dibujaría el estado viejo.
 */
async function saveLooks(patch) {
  const next = await patchConfig({ vip: { cosmetics: { ...looksOf(), ...patch } } });
  if (!next) return;
  renderVipLooks();
  // El mismo cosmético se elige desde el perfil: si está abierto, se mueve ahí.
  if (state.profileOpen && state.profileMine) {
    state.profileWho = { ...state.profileWho, cosmetics: looksOf() };
    paintProfile();
  }
}

$('#vipLookFont').addEventListener('change', (e) => saveLooks({ font: e.target.value }));
$('#vipLookClear').addEventListener('click', () => saveLooks({ gradient: '', font: 'default' }));

function renderVipAssets() {
  const vipCfg = state.config.vip || {};
  renderVipLooks();

  $('#vipGoalName').textContent = vipCfg.goalSound
    ? vipCfg.goalSound.split(/[\\/]/).pop()
    : '—';

  const volume = vipCfg.goalVolume ?? 0.7;
  $('#vipGoalVolume').value = volume;
  $('#vipGoalVolumeValue').textContent = `${Math.round(volume * 100)}%`;
  syncRangeFill($('#vipGoalVolume'));

  $('#vipHitName').textContent = vipCfg.hitSound
    ? vipCfg.hitSound.split(/[\\/]/).pop()
    : '—';

  const hitVolume = vipCfg.hitVolume ?? 0.7;
  $('#vipHitVolume').value = hitVolume;
  $('#vipHitVolumeValue').textContent = `${Math.round(hitVolume * 100)}%`;
  syncRangeFill($('#vipHitVolume'));

  renderKeysHud();
}

/* ── El cartel de teclas ───────────────────────────────────────────────────
 *
 * Lo dibuja `game-preload.js` encima de la cancha; acá sólo se lo configura.
 *
 * Muestra DIRECCIONES y no letras, así que no hay nada que elegir sobre qué
 * tecla mostrar: la celda de la derecha se enciende con cualquiera de las que
 * el jugador tenga atadas a «derecha». Por eso los controles son sólo de
 * aspecto: qué se muestra, de qué color, de qué tamaño y dónde.
 */
const KEYS_HUD_SWITCHES = {
  es: [
    { key: 'enabled', label: 'Mostrarlo', description: 'Flechas y patada sobre la cancha, encendiéndose al apretar.' },
    { key: 'showKick', label: 'Incluir la patada', description: 'Apagalo para dejar sólo las cuatro direcciones.' }
  ],
  en: [
    { key: 'enabled', label: 'Show it', description: 'Arrows and kick over the pitch.' },
    { key: 'showKick', label: 'Include the kick', description: 'Leaves just the four directions.' }
  ]
};

function keysHudCfg() {
  return (state.config.vip || {}).keystrokes || {};
}

function renderKeysHud() {
  const lang = isEn() ? 'en' : 'es';
  const cfg = keysHudCfg();

  /*
   * El `value` lee por `keysHudCfg()` y no por el `cfg` de arriba: guardar
   * reemplaza `state.config` por un objeto NUEVO, así que una referencia
   * capturada acá se queda con los valores viejos y el interruptor volvería solo
   * a su posición anterior apenas se lo toca.
   */
  buildSwitches(
    $('#keysHudSwitches'),
    KEYS_HUD_SWITCHES[lang].map((i) => ({ ...i, value: () => !!keysHudCfg()[i.key] })),
    (item, value) => patchConfig({ vip: { keystrokes: { [item.key]: value } } })
  );

  paintKeysColor();

  const scale = Number(cfg.scale) || 1;
  $('#keysHudSize').value = scale;
  $('#keysHudSizeValue').textContent = `${Math.round(scale * 100)}%`;
  syncRangeFill($('#keysHudSize'));

  paintKeysMoveButton();
}

/**
 * La muestra de color del cartel y el botón que la devuelve al tema.
 *
 * Vacío quiere decir «el acento del tema», y un `<input type=color>` no sabe
 * mostrar eso: se le pone el acento, que es exactamente lo que se va a ver.
 *
 * El acento VIVO, no `appearance.accent`: el cartel lo pinta `keystrokeColor()`
 * con `currentPalette().accent`, y con cualquier tema que traiga color propio
 * —azul, verde, rojo…— esos dos son distintos. De ahí venía el bug: «Color del
 * tema» dejaba la muestra en violeta mientras la cancha pintaba otra cosa, y
 * parecía que el botón no hiciera nada más que poner violeta.
 *
 * Está aparte de `renderKeysHud` porque cambiar de tema tiene que repintarla sin
 * rehacer los interruptores. Ver `applyThemeVars`.
 */
function paintKeysColor() {
  const elegido = /^#[0-9a-f]{6}$/i.test(String(keysHudCfg().color || ''));
  $('#keysHudColor').value = elegido ? keysHudCfg().color : themeAccent();
  // Y se dice cuál de las dos cosas está mostrando, que del cuadradito no se
  // deduce: el botón se apaga cuando el color del tema ya es el que está puesto,
  // o sea cuando no hay nada que volver.
  $('#keysHudReset').disabled = !elegido;
}

/**
 * El botón de acomodar el cartel de teclas, que dice dos cosas distintas.
 *
 * Está aparte porque hay que volver a pintarlo desde `applyConfig`, y ésa es la
 * historia del bug: el botón tiene `data-i18n`, y cada vez que se guarda algo
 * llega la config nueva → `applyConfig` → `setLanguage` → `applyStatic`, que le
 * escribe encima el texto de la clave. O sea que arrastrar el cartel —que
 * guarda la posición— dejaba el botón diciendo «Acomodar en pantalla» con el
 * modo todavía encendido, y había que tocarlo dos veces para salir.
 */
function paintKeysMoveButton() {
  const btn = $('#keysHudMove');
  if (!btn) return;
  setButtonLabel(btn, t(state.keysMoving ? 'keys.hudMoving' : 'keys.hudMove'));
  btn.classList.toggle('is-on', !!state.keysMoving);
}

/** Si está acomodándose ahora mismo. No se guarda: dura lo que dura el gesto. */
state.keysMoving = false;

/** Termina el modo mover, venga de donde venga. */
function stopKeysMoving() {
  if (!state.keysMoving) return;
  state.keysMoving = false;
  tvm.keys.moveHud(false);
  paintKeysMoveButton();
}

// El juego avisa cuando el jugador tocó fuera del cartel: el modo se terminó
// allá y acá sólo queda acompañarlo.
tvm.keys.onMoveHudOff(() => {
  state.keysMoving = false;
  paintKeysMoveButton();
});

$('#keysHudColor').addEventListener('change', (e) =>
  patchConfig({ vip: { keystrokes: { color: e.target.value } } }));

$('#keysHudReset').addEventListener('click', async () => {
  await patchConfig({ vip: { keystrokes: { color: '' } } });
  // Volver al color del tema no lo puede mostrar el propio `<input type=color>`:
  // hay que repintarlo con el acento, que es lo que se va a ver en la cancha.
  renderKeysHud();
});

$('#keysHudSize').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#keysHudSizeValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#keysHudSize').addEventListener('change', (e) =>
  patchConfig({ vip: { keystrokes: { scale: Number(e.target.value) } } }));

$('#keysHudMove').addEventListener('click', () => {
  /*
   * Acomodarlo es arrastrarlo sobre la cancha, así que hay que estar viéndola:
   * con el panel del cliente abierto encima, el cartel queda tapado y el
   * arrastre no se ve. Al encender el modo se cierra el panel.
   */
  if (state.stage !== 'game') {
    toast(t('keys.hudNeedGame'), 'err');
    return;
  }
  state.keysMoving = !state.keysMoving;
  tvm.keys.moveHud(state.keysMoving);
  paintKeysMoveButton();
  if (state.keysMoving) closePanel();
});

/** file:// para mostrar una imagen del disco dentro del renderer. */
function fileUrl(filePath) {
  return encodeURI(`file:///${String(filePath).replace(/\\/g, '/').replace(/^\/+/, '')}`);
}

/**
 * Todo lo que cambia de lugar cuando el rol aparece o se cae. Va junto porque
 * el rol ahora se comprueba solo cada tanto: esto puede pasar sin que el
 * usuario haya tocado nada.
 */
// La imagen del avatar ya no vive en la tarjeta VIP: lo que se repinta es la
// tarjeta «Tu avatar», que se ve con rol y sin él.
$('#vipPickAvatar').addEventListener('click', async () => {
  const next = await guard(tvm.vip.pickAvatar(), 'Error');
  if (next) { state.config.vip = next; renderAvatarImage(); }
});
$('#vipClearAvatar').addEventListener('click', async () => {
  const next = await guard(tvm.vip.clearAsset('avatar'), 'Error');
  if (next) { state.config.vip = next; renderAvatarImage(); }
});
$('#vipPickBall').addEventListener('click', async () => {
  const next = await guard(tvm.vip.pickBall(), 'Error');
  if (next) { state.config.vip = next; renderBallImage(); }
});
$('#vipClearBall').addEventListener('click', async () => {
  const next = await guard(tvm.vip.clearAsset('ball'), 'Error');
  if (next) { state.config.vip = next; renderBallImage(); }
});
// No hace falta recargar el juego: el bundle parcheado pregunta por el sonido
// propio cada vez que va a reproducir, así que el cambio se nota en el gol
// siguiente. Ver `patchSounds` en `game-patch.js`.
$('#vipPickGoal').addEventListener('click', async () => {
  const next = await guard(tvm.vip.pickGoalSound(), 'Error');
  if (next) { state.config.vip = next; renderVipAssets(); }
});
$('#vipClearGoal').addEventListener('click', async () => {
  const next = await guard(tvm.vip.clearAsset('goal'), 'Error');
  if (next) { state.config.vip = next; renderVipAssets(); }
});

$('#vipGoalVolume').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#vipGoalVolumeValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#vipGoalVolume').addEventListener('change', (e) => {
  patchConfig({ vip: { goalVolume: Number(e.target.value) } });
});

$('#vipPickHit').addEventListener('click', async () => {
  const next = await guard(tvm.vip.pickHitSound(), 'Error');
  if (next) { state.config.vip = next; renderVipAssets(); }
});
$('#vipClearHit').addEventListener('click', async () => {
  const next = await guard(tvm.vip.clearAsset('hit'), 'Error');
  if (next) { state.config.vip = next; renderVipAssets(); }
});

$('#vipHitVolume').addEventListener('input', (e) => {
  syncRangeFill(e.target);
  $('#vipHitVolumeValue').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
$('#vipHitVolume').addEventListener('change', (e) => {
  patchConfig({ vip: { hitVolume: Number(e.target.value) } });
});

/* ── Editor de temas ────────────────────────────────────── */
let editingTheme = null;

function openThemeEditor(id) {
  const custom = (state.config.appearance.customThemes || []).find((theme) => theme.id === id);
  editingTheme = custom ? { ...custom } : {
    id: null,
    label: '',
    dark: true,
    bg: '#0b0b10',
    text: '#f2f1f7',
    accent: state.config.appearance.accent
  };

  $('#themeName').value = editingTheme.label || '';
  $('#themeBg').value = editingTheme.bg;
  $('#themeText').value = editingTheme.text;
  $('#themeAccent').value = editingTheme.accent;
  $('#themeDelete').hidden = !custom;

  buildSwitches($('#themeDarkSwitch'), [{
    ...THEME_DARK_SWITCH[isEn() ? 'en' : 'es'],
    key: 'dark',
    value: () => editingTheme.dark !== false
  }], (_item, value) => {
    editingTheme.dark = value;
    paintThemePreview();
  });

  paintThemePreview();
  $('#themeModal').hidden = false;
  $('#themeName').focus();
}

function paintThemePreview() {
  const box = $('#themePreview');
  const bg = $('#themeBg').value;
  const text = $('#themeText').value;
  const accent = $('#themeAccent').value;

  box.style.setProperty('--pv-bg', bg);
  box.style.setProperty('--pv-text', text);
  box.style.setProperty('--pv-accent', accent);
  box.style.setProperty('--pv-panel', mixHex(bg, editingTheme.dark !== false ? '#ffffff' : '#000000', 0.1));
  box.style.setProperty('--pv-line', mixHex(bg, text, 0.2));
  box.style.setProperty('--pv-dim', mixHex(text, bg, 0.3));
  box.style.setProperty('--pv-accent-text', readableOn(accent));
}

function mixHex(a, b, amount) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const to = (v) => v.toString(16).padStart(2, '0');
  return `#${pa.map((v, i) => to(Math.round(v + (pb[i] - v) * amount))).join('')}`;
}

function parseHex(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  return m ? m.slice(1).map((h) => parseInt(h, 16)) : null;
}

function readableOn(hex) {
  const c = parseHex(hex);
  if (!c) return '#ffffff';
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? '#12101a' : '#ffffff';
}

['#themeBg', '#themeText', '#themeAccent'].forEach((sel) => {
  $(sel).addEventListener('input', paintThemePreview);
});

$('#themeCreate').addEventListener('click', () => openThemeEditor(null));
$('#themeClose').addEventListener('click', () => { $('#themeModal').hidden = true; });
$('#themeCancel').addEventListener('click', () => { $('#themeModal').hidden = true; });
$('#themeModal').addEventListener('click', (e) => {
  if (e.target === $('#themeModal')) $('#themeModal').hidden = true;
});

$('#themeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    id: editingTheme.id,
    label: $('#themeName').value.trim(),
    description: isEn() ? 'Your own theme.' : 'Tema tuyo.',
    dark: editingTheme.dark !== false,
    bg: $('#themeBg').value,
    text: $('#themeText').value,
    accent: $('#themeAccent').value
  };
  if (!payload.label) return;

  const res = await guard(tvm.theme.save(payload), 'Error');
  if (!res) return;
  state.schema.themes = res.themes;
  state.config = await tvm.config.get();
  applyConfig(state.config);
  await refreshThemeVars();
  renderThemes();
  $('#themeModal').hidden = true;
  toast(t('toast.themeApplied', { name: payload.label }), 'ok');
});

$('#themeDelete').addEventListener('click', async () => {
  if (!editingTheme || !editingTheme.id) return;
  if (!window.confirm(t('look.customDeleteConfirm'))) return;
  const res = await guard(tvm.theme.remove(editingTheme.id), 'Error');
  if (!res) return;
  state.schema.themes = res.themes;
  state.config = await tvm.config.get();
  applyConfig(state.config);
  await refreshThemeVars();
  renderThemes();
  $('#themeModal').hidden = true;
});

/* ══════════════════════════════════════════════════════════
   Replays
   ══════════════════════════════════════════════════════════ */
async function loadReplays() {
  const data = await guard(tvm.replays.list(), 'Error');
  if (!data) return;
  state.replays = data;
  renderReplays();
}

/* Filtro y orden de la biblioteca: sólo viven en memoria, arrancan en «todos / más nuevos». */
const replayUi = { filter: 'all', sort: 'new', sig: '' };
const REPLAY_FILTERS = [
  ['all', 'Todos', 'All'], ['today', 'Hoy', 'Today'], ['week', 'Esta semana', 'This week'], ['digest', 'Con análisis', 'Analysed'], ['fav', '★ Favoritos', '★ Favourites']
];
const REPLAY_SORTS = [
  ['new', 'Más nuevos', 'Newest'], ['old', 'Más viejos', 'Oldest'], ['goals', 'Más goles', 'Most goals'], ['long', 'Más largos', 'Longest']
];

function paintReplayTools() {
  const en = isEn();
  const sig = `${replayUi.filter}|${replayUi.sort}|${en}`;
  if (replayUi.sig === sig) return;
  replayUi.sig = sig;
  $('#replayChips').replaceChildren(...REPLAY_FILTERS.map((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (f[0] === replayUi.filter ? ' is-active' : '');
    b.dataset.rf = f[0];
    b.textContent = en ? f[2] : f[1];
    return b;
  }));
  $('#replaySort').replaceChildren(...REPLAY_SORTS.map((o) => {
    const opt = document.createElement('option');
    opt.value = o[0];
    opt.textContent = en ? o[2] : o[1];
    opt.selected = o[0] === replayUi.sort;
    return opt;
  }));
}

/** «Hoy», «Ayer» o el día de la semana con la fecha, para los títulos de grupo. */
function replayDayLabel(ms) {
  const en = isEn();
  const d = new Date(ms);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  if (diff <= 0) return en ? 'Today' : 'Hoy';
  if (diff === 1) return en ? 'Yesterday' : 'Ayer';
  const text = d.toLocaleDateString(en ? 'en-GB' : 'es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Replays fijados (★): se guardan sólo en esta PC, por ruta. */
function replayPins() {
  try { return new Set(JSON.parse(localStorage.getItem('tl_replay_pins') || '[]')); } catch (e) { return new Set(); }
}
function toggleReplayPin(path) {
  const pins = replayPins();
  if (pins.has(path)) pins.delete(path); else pins.add(path);
  try { localStorage.setItem('tl_replay_pins', JSON.stringify([...pins])); } catch (e) { /* sin almacenamiento */ }
}

function renderReplays() {
  const { folder, items, error } = state.replays;
  const en = isEn();
  $('#replayFolder').textContent = folder;
  $('#replayFolder').title = folder;
  paintReplayTools();

  const query = $('#replaySearch').value.trim().toLowerCase();
  const now = Date.now();
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  let filtered = items;
  if (query) filtered = filtered.filter((r) => r.name.toLowerCase().includes(query));
  if (replayUi.filter === 'today') filtered = filtered.filter((r) => r.updatedAt >= dayStart);
  else if (replayUi.filter === 'week') filtered = filtered.filter((r) => now - r.updatedAt < 7 * 86400000);
  else if (replayUi.filter === 'digest') filtered = filtered.filter((r) => r.digest);
  else if (replayUi.filter === 'fav') filtered = filtered.filter((r) => replayPins().has(r.path));

  const byDate = replayUi.sort === 'new' || replayUi.sort === 'old';
  const pins = replayPins();
  if (replayUi.sort === 'old') filtered = [...filtered].sort((a, b) => a.updatedAt - b.updatedAt);
  else if (replayUi.sort === 'goals') filtered = [...filtered].sort((a, b) => ((b.digest && b.digest.goals) || -1) - ((a.digest && a.digest.goals) || -1));
  else if (replayUi.sort === 'long') filtered = [...filtered].sort((a, b) => ((b.digest && b.digest.seconds) || -1) - ((a.digest && a.digest.seconds) || -1));
  else filtered = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);

  /* Los fijados van primero, en su propio grupo, cuando la lista está por fecha. */
  if (byDate && pins.size && replayUi.filter !== 'fav') {
    filtered = [...filtered.filter((r) => pins.has(r.path)), ...filtered.filter((r) => !pins.has(r.path))];
  }

  const count = $('#replayCount');
  const total = items.reduce((n, r) => n + (r.size || 0), 0);
  count.textContent = items.length ? `${filtered.length}/${items.length} · ${formatBytes(total)}` : '';

  const list = $('#replayList');
  list.replaceChildren();

  if (error) {
    list.append(emptyState(t('replays.empty'), error));
    return;
  }
  if (!filtered.length) {
    const filtering = query || replayUi.filter !== 'all';
    list.append(emptyState(
      filtering ? t('rooms.noResults') : t('replays.empty'),
      filtering ? t('rooms.noResultsText') : t('replays.emptyText')
    ));
    return;
  }

  const frag = document.createDocumentFragment();
  let lastDay = '';
  filtered.forEach((replay, index) => {
    if (byDate) {
      const label = pins.has(replay.path) && replayUi.filter !== 'fav' ? (en ? '★ My best' : '★ Mis mejores') : replayDayLabel(replay.updatedAt);
      if (label !== lastDay) {
        lastDay = label;
        const h = document.createElement('h3');
        h.className = 'replay__day';
        h.textContent = label;
        frag.append(h);
      }
    }
    const row = document.createElement('article');
    row.className = 'replay';
    row.style.setProperty('--n', index);

    const when = new Date(replay.updatedAt);
    const date = document.createElement('div');
    date.className = 'replay__date';
    date.innerHTML = '<b></b><span></span>';
    date.firstChild.textContent = String(when.getDate());
    date.lastChild.textContent = when.toLocaleDateString(en ? 'en-GB' : 'es-AR', { month: 'short' }).replace('.', '');

    const body = document.createElement('div');
    body.className = 'replay__body';
    const name = document.createElement('div');
    name.className = 'replay__name';
    name.textContent = replay.name;
    name.title = replay.name;
    const meta = document.createElement('div');
    meta.className = 'replay__meta';
    meta.textContent = `${when.toLocaleTimeString(en ? 'en-GB' : 'es-AR', { hour: '2-digit', minute: '2-digit' })} · ${formatBytes(replay.size)} · ${replay.format}`;
    body.append(name, meta);

    /*
     * Lo que dio el análisis, si esta grabación ya se analizó alguna vez. Es la
     * única parte visible del archivo en disco, y es la que hace que la lista
     * deje de ser nombres y fechas: «14 goles · 22:40» dice cuál era ésta.
     */
    if (replay.digest) {
      const tags = document.createElement('div');
      tags.className = 'replay__digest';
      const mk = (text, cls) => { const c = document.createElement('span'); c.className = 'rchip' + (cls ? ` ${cls}` : ''); c.textContent = text; return c; };
      const d = replay.digest;
      if (Number.isFinite(d.red) && Number.isFinite(d.blue) && d.goals) tags.append(mk(`${d.red} – ${d.blue}`, 'rchip--score'));
      tags.append(
        mk(t(d.goals === 1 ? 'replays.goals1' : 'replays.goalsN', { n: d.goals })),
        mk(formatDuration(d.seconds))
      );
      if (d.matches > 1) tags.append(mk(t('replays.matchesN', { n: d.matches })));
      body.append(tags);
      /* La línea del partido: una marca por gol, roja o azul, donde cayó. */
      if (Array.isArray(d.marks) && d.marks.length) {
        const line = document.createElement('div');
        line.className = 'rline';
        line.setAttribute('aria-hidden', 'true');
        for (const m of d.marks) {
          const tick = document.createElement('i');
          tick.className = m[1] === 0 ? 'is-red' : 'is-blue';
          tick.style.left = `${(m[0] * 100).toFixed(1)}%`;
          line.append(tick);
        }
        body.append(line);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'replay__actions';
    const more = document.createElement('div');
    more.className = 'replay__more';
    more.append(
      actionButton(t('replays.rename'), () => renameReplay(replay), 'ghost', ICONS.pencil),
      actionButton(t('replays.reveal'), () => tvm.replays.reveal(replay.path), 'ghost', ICONS.folder),
      actionButton(t('replays.delete'), async () => {
        const updated = await guard(tvm.replays.trash(replay.path), 'Error');
        if (updated) { state.replays = updated; renderReplays(); }
      }, 'danger', ICONS.trash)
    );
    // El ▶ de antes era un carácter de texto: de otra familia, de otro peso
    // y sin manera de que acompañara al resto de los iconos.
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'replay__star' + (pins.has(replay.path) ? ' is-on' : '');
    star.textContent = pins.has(replay.path) ? '★' : '☆';
    star.title = en ? 'Pin to the top' : 'Fijar arriba';
    star.addEventListener('click', () => { toggleReplayPin(replay.path); renderReplays(); });
    actions.append(star, more, actionButton(t('replays.play'), () => playReplay(replay), 'primary', ICONS.play));

    row.append(date, body, actions);
    frag.append(row);
  });
  list.append(frag);
}

$('#replayChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rf]');
  if (!b) return;
  replayUi.filter = b.dataset.rf;
  renderReplays();
});
$('#replaySort').addEventListener('change', (e) => {
  replayUi.sort = e.target.value;
  renderReplays();
});

/**
 * Los dibujos de los botones que se arman desde acá.
 *
 * Son los mismos trazos que los del HTML —rejilla de 24, sin relleno, la regla
 * de `svg[data-icon]` pone el grosor y las puntas—, sólo que estos botones no
 * existen hasta que hay algo que mostrar: un amigo, una grabación, una clave.
 */
const ICONS = {
  check: '<path d="M5 12.6 9.7 17.3 19 7.6"/>',
  close: '<path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6"/>',
  trash: '<path d="M4.5 7h15M9.8 7V5.4A1.4 1.4 0 0 1 11.2 4h1.6a1.4 1.4 0 0 1 1.4 1.4V7M6.6 7l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.4 7"/>',
  pencil: '<path d="M4.5 19.5h3.2L18.3 8.9a1.6 1.6 0 0 0 0-2.3l-.9-.9a1.6 1.6 0 0 0-2.3 0L4.5 16.3z"/>',
  folder: '<path d="M3.6 7.4A1.9 1.9 0 0 1 5.5 5.5h3.2l1.9 2.4h7.9a1.9 1.9 0 0 1 1.9 1.9v7.3a1.9 1.9 0 0 1-1.9 1.9H5.5a1.9 1.9 0 0 1-1.9-1.9z"/>',
  play: '<path d="M8.7 5.9v12.2l10-6.1z"/>',
  refresh: '<path d="M4.3 12a7.7 7.7 0 1 0 2.4-5.5L3.4 9.6M3.2 4.6l.2 5.2 5.2-.2"/>',
  upload: '<path d="M12 20.2V9.2M7.6 13.6 12 9.2l4.4 4.4M4.5 4.5h15"/>',
  login: '<path d="M13.4 4.2h4.4a1.5 1.5 0 0 1 1.5 1.5v12.6a1.5 1.5 0 0 1-1.5 1.5h-4.4M10.6 8.4 14.2 12l-3.6 3.6M14.2 12H4.6"/>',
  logout: '<path d="M10.6 4.2H6.2a1.5 1.5 0 0 0-1.5 1.5v12.6a1.5 1.5 0 0 0 1.5 1.5h4.4M16.4 8.4 20 12l-3.6 3.6M20 12H9.4"/>',
  userPlus: '<circle cx="10" cy="8.2" r="3.7"/><path d="M3.4 20c0-3.4 2.9-5.6 6.6-5.6M17.5 13.5v6M14.5 16.5h6"/>',
  chat: '<path d="M20 12.4c0 3.8-3.6 6.9-8 6.9-1 0-2-.2-2.9-.5L4 20.4l1.5-3.6A6.6 6.6 0 0 1 4 12.4c0-3.8 3.6-6.9 8-6.9s8 3.1 8 6.9z"/>'
};

function iconSvg(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('data-icon', '');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}

/**
 * @param {string} text
 * @param {Function} onClick
 * @param {string} [kind]  ghost (por defecto), primary o danger
 * @param {string} [icon]  un valor de `ICONS`, adelante del texto
 */
function actionButton(text, onClick, kind = 'ghost', icon = null) {
  const btn = document.createElement('button');
  btn.className = `btn btn--${kind} btn--sm`;
  if (icon) btn.append(iconSvg(icon));
  btn.append(document.createTextNode(text));
  btn.addEventListener('click', onClick);
  return btn;
}

async function playReplay(replay) {
  const res = await guard(tvm.replays.play(replay.path), 'Error');
  if (!res) return;
  // El análisis guardado es de la grabación anterior: se tira acá y no al
  // abrir el panel, que es donde ya sería tarde para notarlo.
  state.summary = null;
  state.summaryError = null;
  // Sin la extensión, que no le dice nada a nadie en la presencia de Discord.
  state.replayName = res.name.replace(/\.hbr2?$/i, '');
  /* De qué archivo es lo que se está mirando. Es lo que permite buscar su
     análisis en el archivo y guardar el nuevo. Una grabación abierta con el
     botón del propio HaxBall no pasa por acá y queda sin ruta: se la analiza
     igual, sólo que sin archivar. */
  state.replayPath = replay.path;
  setView('play');
  setStage('game');
  pushPresence();
  toast(t('toast.playing', { name: res.name }), 'ok');
}

async function renameReplay(replay) {
  const next = await ask({
    title: t('replays.rename'),
    label: t('replays.renamePrompt'),
    value: replay.name.replace(/\.hbr2?$/i, ''),
    maxLength: 90
  });
  if (next === null || !next.trim()) return;

  const updated = await guard(tvm.replays.rename(replay.path, next.trim()), 'Error');
  if (updated) { state.replays = updated; renderReplays(); toast(t('toast.renamed'), 'ok'); }
}

$('#replaySearch').addEventListener('input', renderReplays);
$('#replayRefresh').addEventListener('click', loadReplays);
$('#replayOpenFolder').addEventListener('click', () => tvm.replays.openFolder());
$('#replayChoose').addEventListener('click', async () => {
  const updated = await guard(tvm.replays.chooseFolder(), 'Error');
  if (updated) { state.replays = updated; renderReplays(); }
});

/* ══════════════════════════════════════════════════════════
   Amigos
   ══════════════════════════════════════════════════════════
   Un dock pegado al borde derecho, no una pestaña. Vive en la ventana de la app
   —fuera del <webview> del juego—, así que se dibuja ENCIMA de la cancha sin
   tocarla: se abre jugando, con F9, y el partido sigue.

   Lo que hay que cuidar para que no moleste de verdad es el FOCO. Mientras el
   juego tiene el foco, las teclas van al webview; en cuanto se hace clic acá
   adentro, dejan de ir. Por eso cerrar el dock le devuelve el foco al juego, y
   por eso nada de acá lo roba solo al abrirse.

   El estado entero viene del sitio en cada sondeo (ver `client.routes.js`): acá
   no se guarda nada que haya que mantener al día a mano, se dibuja lo último que
   llegó. Lo propio es sólo a quién estás mirando.
   ══════════════════════════════════════════════════════════ */

state.friends = null;
state.friendPick = null;
state.friendsOpen = false;

/* ── Hasta cuándo leíste ───────────────────────────────────────────────────
 *
 * Esto era un CONTADOR en memoria —cuántos mensajes recibidos había cuando
 * abriste el panel— y arrancaba en cero en cada sesión. Como el sitio manda la
 * charla ENTERA en cada sondeo, al abrir la app «recibidos» eran cuarenta y
 * «vistos» cero: el punto del botón de Amigos se encendía siempre, sin nada
 * nuevo que leer, y se apagaba al abrir el panel para volver a aparecer al
 * arranque siguiente.
 *
 * Lo que se guarda ahora es la FECHA del último mensaje que miraste, y se
 * guarda en el almacenamiento de la ventana: es un detalle de esta pantalla y
 * de esta máquina, no algo que tenga que viajar al sitio ni entrar a la config
 * que se exporta. */
const FRIEND_SEEN_KEY = 'tvm.friendsSeenAt';

function loadFriendSeen() {
  try {
    const at = Number(localStorage.getItem(FRIEND_SEEN_KEY));
    return Number.isFinite(at) && at > 0 ? at : 0;
  } catch {
    return 0;
  }
}

state.friendSeenAt = loadFriendSeen();

/** La fecha del último mensaje que te mandaron. `0` si no te mandaron ninguno. */
function lastReceivedAt(data) {
  if (!data || !data.me) return 0;
  let last = 0;
  for (const message of data.messages) {
    if (message.from !== data.me.id && message.at > last) last = message.at;
  }
  return last;
}

/** Todo lo recibido hasta ahora queda leído. */
function markFriendsSeen(data) {
  const last = lastReceivedAt(data);
  if (!last || last <= state.friendSeenAt) return;
  state.friendSeenAt = last;
  try {
    localStorage.setItem(FRIEND_SEEN_KEY, String(last));
  } catch {
    /* Sin almacenamiento el punto vuelve a ser de una sesión: no es grave. */
  }
}

/**
 * Las fotos de perfil que ya llegaron: URL del CDN de Discord → `data:`.
 *
 * Las baja el proceso principal (ver `avatars.js`) porque la CSP de esta ventana
 * no deja pedir imágenes de afuera, y manda sólo las nuevas: lo que ya está acá
 * no vuelve a viajar en cada sondeo.
 */
state.avatars = new Map();

tvm.avatars.onResolved((found) => {
  for (const [url, data] of Object.entries(found || {})) state.avatars.set(url, data);
  // Pueden llegar después del estado que las nombró: hay que repintar. La tuya
  // sale a buscarse en cuanto arranca la app, así que puede volver antes de que
  // haya config con qué dibujar nada.
  if (!state.config) return;
  /*
   * Y tu propia cara arriba a la derecha.
   *
   * Faltaba, y por eso el chip de la barra se quedaba con la inicial para
   * siempre: se pinta UNA vez al arrancar, cuando tu foto todavía se está
   * bajando, y nada lo volvía a tocar cuando llegaba. El menú disimulaba el
   * problema porque se repinta cada vez que se abre — así que la foto aparecía
   * adentro del desplegable y no en el botón que lo abre.
   */
  paintMeChip();
  if (meMenuOpen()) paintMeMenu();
});

/* ── Los avisos que suenan ─────────────────────────────────────────────────
 *
 * Sin archivos de audio: los tonos los sintetiza la ventana con WebAudio. Un
 * aviso son dos o tres sinusoides con una envolvente corta, que es exactamente
 * lo que hay adentro de un .mp3 de aviso — y así no hay nada que empaquetar en
 * el instalador, nada que se pueda perder y nada que cargar en el arranque.
 *
 * El aviso VISUAL sale siempre: es la respuesta a algo que pasó y no molesta a
 * nadie. El sonido es lo que interrumpe —suena arriba de la partida—, así que
 * cada tipo se apaga por separado desde Ajustes → Avisos de amigos.
 */

/** Cada aviso, como pares [frecuencia en Hz, duración en segundos]. */
const NOTIFY_TONES = {
  // Mensaje: dos notas cortas que suben. Es el que más va a sonar, así que es
  // el más discreto de los tres.
  messages: [[880, 0.07], [1174.7, 0.13]],
  // Invitación: sube más y termina arriba, porque es lo que pide una acción.
  invites: [[659.3, 0.07], [880, 0.07], [1318.5, 0.17]],
  // Solicitud: dos notas y la segunda BAJA. Que el contorno sea al revés es lo
  // que lo hace distinguible sin mirar la pantalla.
  requests: [[587.3, 0.09], [493.9, 0.17]]
};

/**
 * Uno solo para toda la sesión.
 *
 * Chromium tope los AudioContext en seis por documento: uno por sonido deja de
 * sonar al séptimo aviso y no avisa por ningún lado.
 */
let audioCtx = null;

/** @param {'messages'|'invites'|'requests'} kind */
function notifySound(kind) {
  const cfg = state.config && state.config.notify;
  if (!cfg || !cfg[kind]) return;
  const volume = Math.max(0, Math.min(1, Number(cfg.volume ?? 0.5)));
  if (volume) playTones(NOTIFY_TONES[kind], volume);
}

function playTones(tones, volume) {
  if (!tones) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    // Un contexto creado sin un gesto del usuario arranca suspendido. Nada de
    // esto es crítico: se pide seguir y, si no se puede, el aviso es mudo.
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    let at = audioCtx.currentTime + 0.01;
    for (const [hz, seconds] of tones) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      /*
       * La envolvente no es un adorno: una ganancia que arranca y corta en seco
       * mete un chasquido —el salto de la onda a cero— que se escucha más que
       * la nota. Sube en 12 ms y se apaga exponencial hasta el final.
       */
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(volume * 0.22, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(at);
      osc.stop(at + seconds + 0.02);
      // Las notas se pisan un cuarto: encadenadas suenan a aviso, una detrás de
      // la otra suenan a tres pitidos sueltos.
      at += seconds * 0.75;
    }
  } catch {
    /* Sin audio el cliente anda igual: el aviso visual ya salió. */
  }
}

function friendById(id) {
  return (state.friends && state.friends.friends.find((f) => f.id === id)) || null;
}

function friendName(id) {
  const friend = friendById(id);
  return friend ? friend.name : '—';
}

/* ── Fotos de perfil ────────────────────────────────────────────────────────
 *
 * Lo que trae el sitio es la URL de la foto en el CDN de Discord; la imagen la
 * baja el proceso principal y llega acá como `data:`. Mientras no haya foto
 * —porque todavía no bajó, porque falló, o porque la persona no tiene— se dibuja
 * la inicial, que es lo que había antes y cumple igual. */

function initialOf(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

/** Llena un hueco de foto ya existente en el HTML. */
function paintFace(el, person) {
  const url = person && person.avatar;
  const data = url ? state.avatars.get(url) : null;
  el.classList.toggle('is-photo', !!data);

  if (!data) {
    el.replaceChildren(document.createTextNode(initialOf(person && person.name)));
    return el;
  }
  const img = document.createElement('img');
  img.src = data;
  img.alt = '';
  el.replaceChildren(img);
  return el;
}

/**
 * Una foto nueva para una fila de lista.
 * @param {object} person   con `name` y `avatar`
 * @param {boolean|null} online  si se le pinta el puntito de estado
 */
function faceEl(person, online) {
  const face = document.createElement('span');
  face.className = 'pfp';
  paintFace(face, person);
  if (online !== null && online !== undefined) {
    // El estado va ENCIMA de la foto y no al lado: en una columna de 320 px cada
    // píxel de ancho es una letra menos del nombre.
    face.append(statusDot(online));
  }
  return face;
}

/* ── Abrir y cerrar ─────────────────────────────────────── */

function openFriends(pick) {
  if (pick) state.friendPick = pick;
  setFriendsOpen(true);
  // Y repintar aunque ya estuviera abierto: `setFriendsOpen` corta cuando no hay
  // cambio de estado, así que sin esto abrir la charla de alguien con el dock ya
  // abierto —desde un aviso de mensaje, o desde su perfil— no movía nada.
  renderFriends();
}

function toggleFriends() {
  setFriendsOpen(!state.friendsOpen);
}

function setFriendsOpen(open) {
  if (open === state.friendsOpen) return;
  state.friendsOpen = open;
  $('#friendsDock').hidden = !open;
  $('#btnFriends').classList.toggle('is-on', open);

  if (open) {
    renderFriends();
    return;
  }
  // Cerrar tiene que devolverle el foco al juego. Ver `focusGame`.
  focusGame();
}

$('#dockClose').addEventListener('click', () => setFriendsOpen(false));
$('#dockBack').addEventListener('click', () => {
  state.friendPick = null;
  renderFriends();
});

/* ── Pintado ────────────────────────────────────────────── */

function renderFriends() {
  /*
   * El contador de la barra va ANTES del corte por dock cerrado. Saber cuántos
   * amigos hay conectados sin abrir nada es justamente para lo que está: si se
   * pintara sólo con el cajón abierto, el número aparecería recién cuando ya
   * tenés la lista completa delante.
   */
  paintFriendsCount(state.friends ? state.friends.friends.filter((f) => f.online).length : 0);

  if (!state.friendsOpen) {
    paintFriendsDot();
    return;
  }

  const data = state.friends;
  const logged = !!vipProfile();
  const friend = logged && data ? friendById(state.friendPick) : null;

  $('#dockLocked').hidden = logged;
  $('#dockListView').hidden = !logged || !!friend;
  $('#dockChatView').hidden = !friend;
  $('#dockBack').hidden = !friend;
  // El título es siempre «Amigos», incluso adentro de una conversación: con
  // quién estás hablando se lee abajo, al lado de su foto, que es donde entra.
  $('#dockTitle').textContent = t('friends.title');
  // Tu fila no depende de que el sitio conteste: se pinta antes de irse.
  if (logged && !friend) paintMyRow();

  if (!logged || !data) {
    $('#dockCount').textContent = '';
    paintFriendsDot();
    return;
  }

  // Con el dock abierto, lo recibido está visto: el punto se apaga.
  markFriendsSeen(data);
  paintFriendsDot();

  if (friend) {
    // La cuenta de conectados es de la LISTA. Quedaba puesta al entrar a una
    // conversación —«0 de 2 en línea» arriba de una charla— porque de acá se
    // salía antes de tocarla.
    $('#dockCount').textContent = '';
    paintFriendChat(data, friend);
    return;
  }

  const online = data.friends.filter((f) => f.online).length;
  $('#dockCount').textContent = data.friends.length
    ? t('friends.online', { online, total: data.friends.length })
    : '';
  paintFriendRequests(data);
  paintFriendList(data);
}

/** El punto del botón: hay una solicitud o un mensaje sin leer. */
function paintFriendsDot() {
  const data = state.friends;
  const pending = data ? data.requests.in.length : 0;
  const unread = !!data && !!data.me && data.messages.some(
    (message) => message.from !== data.me.id && message.at > state.friendSeenAt
  );
  $('#friendsDot').hidden = !(pending || (!state.friendsOpen && unread));
}

function paintFriendRequests(data) {
  const rows = [...data.requests.in, ...data.requests.out];
  // El grupo entero desaparece cuando no hay ninguna: un título «Solicitudes»
  // sobre la nada ocupa lo mismo que una solicitud y no dice nada.
  $('#friendReqGroup').hidden = !rows.length;
  $('#friendReqCount').textContent = rows.length || '';

  $('#friendReqList').replaceChildren(...rows.map((request) => {
    const incoming = data.requests.in.includes(request);
    const row = document.createElement('div');
    row.className = 'friendreq';

    const text = document.createElement('span');
    const who = document.createElement('b');
    who.textContent = request.name;
    const what = document.createElement('span');
    // Sin el espacio de adelante que llevaba antes: las dos partes ya no van
    // seguidas en un renglón, van una debajo de la otra (`.friendreq__who > span`
    // es una grilla), y ahí el espacio quedaba como una sangría de un carácter.
    what.textContent = incoming ? t('friends.wantsIn') : t('friends.wantsOut');
    text.append(who, what);

    const line = document.createElement('div');
    line.className = 'friendreq__who';
    line.append(faceEl(request, null), text);

    const actions = document.createElement('div');
    actions.className = 'rowactions';
    if (incoming) {
      actions.append(actionButton(t('friends.accept'), () =>
        friendAction({ action: 'accept', friend: request.id }), 'primary', ICONS.check));
    }
    actions.append(actionButton(incoming ? t('friends.reject') : t('friends.cancel'), () =>
      friendAction({ action: 'remove', friend: request.id }), 'ghost', ICONS.close));

    row.append(line, actions);
    return row;
  }));
}

/**
 * Cuántos amigos hay conectados, en el botón de la barra.
 *
 * Va al lado del icono y con punto verde. El punto ROJO de la esquina es otra
 * cosa —hay algo sin leer— y lo maneja `friendsDot`: un solo globito con un
 * número quería decir las dos cosas a la vez y no se entendía ninguna.
 */
function paintFriendsCount(n) {
  const caja = $('#friendsOnline');
  if (!caja) return;
  caja.hidden = !n;
  if (n) $('b', caja).textContent = String(n);
}

/**
 * La lista, partida en dos: conectados y desconectados, cada grupo con su
 * título y su cuenta.
 *
 * Antes era una sola tira ordenada como viniera del sitio, y ahí un amigo
 * conectado y uno que no se veían exactamente igual salvo por un punto de 9 px:
 * había que leer las cinco filas para encontrar a quién se le podía escribir.
 */
function paintFriendList(data) {
  const online = data.friends.filter((friend) => friend.online);
  const offline = data.friends.filter((friend) => !friend.online);

  fillFriendGroup('#friendOnGroup', '#friendOnCount', '#friendList', online);
  fillFriendGroup('#friendOffGroup', '#friendOffCount', '#friendListOff', offline);
  paintFriendsCount(online.length);

  // El cartel de lista vacía va aparte de los grupos: si viviera adentro de uno,
  // se escondería con él justo cuando es lo único que hay para mostrar.
  $('#friendEmpty').replaceChildren(
    ...(data.friends.length ? [] : [emptyState(t('friends.empty'), t('friends.emptyText'))])
  );
}

function fillFriendGroup(groupSel, countSel, rowsSel, friends) {
  $(groupSel).hidden = !friends.length;
  $(countSel).textContent = friends.length || '';
  $(rowsSel).replaceChildren(...friends.map(friendRow));
}

function friendRow(friend) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'friend';
  row.addEventListener('click', () => {
    state.friendPick = friend.id;
    renderFriends();
  });

  const body = document.createElement('span');
  body.className = 'friend__body';
  const name = document.createElement('b');
  name.textContent = friend.name;
  if (friend.vip) name.append(vipGem());
  body.append(name, friendWhere(friend));

  row.append(faceEl(friend, friend.online), body);
  return row;
}

/**
 * Tu tarjeta, arriba del panel: es de donde se abre tu perfil.
 *
 * Sale de `myProfile()` y no de la respuesta del sitio para que siga estando
 * cuando el sitio no contesta: tu nombre, tu foto y tu nivel los sabe esta PC.
 */
function paintMyRow() {
  const me = myProfile();
  paintFace($('#dockMeFace'), me);
  $('#dockMeName').textContent = me.name;
  $('#dockMeLevel').textContent = t('profile.levelLine', { level: me.stats.level });
}

/**
 * Cuánto hace de un instante, en palabras. Para «última vez en línea».
 *
 * Se corta en la semana: más allá de eso el dato deja de decir «se fue recién»
 * y pasa a decir «no viene más», y para eso alcanza la fecha.
 */
function agoText(at) {
  const ms = Date.now() - Number(at);
  if (!Number.isFinite(ms) || ms < 0) return null;

  const min = Math.floor(ms / 60000);
  if (min < 1) return t('friends.seenNow');
  if (min < 60) return t('friends.seenMin', { n: min });

  // `hour12: false` a mano: en es-AR el formato por defecto sale «06:50 a. m.»,
  // que ocupa el doble y no es como se escribe la hora en ningún otro lado de
  // la app.
  const hora = new Date(Number(at)).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const hoy = new Date();
  const cuando = new Date(Number(at));
  const mismoDia = hoy.toDateString() === cuando.toDateString();
  if (mismoDia) return t('friends.seenToday', { time: hora });

  const ayer = new Date(hoy.getTime() - 86400000);
  if (ayer.toDateString() === cuando.toDateString()) return t('friends.seenYesterday', { time: hora });

  const dias = Math.floor(ms / 86400000);
  if (dias < 7) return t('friends.seenDays', { n: dias });
  return t('friends.seenLong', { date: cuando.toLocaleDateString('es-AR') });
}

/**
 * Dónde está un amigo, o cuándo se lo vio por última vez.
 *
 * `lastSeen` lo manda el sitio y puede no venir: clientes viejos, o el amigo lo
 * tiene apagado. Sin él queda el texto de siempre, así que esto no depende de
 * que el panel esté actualizado para no romperse.
 *
 * Y si VOS lo apagaste, tampoco lo ves: la reciprocidad se cumple también acá
 * y no sólo del lado del sitio, porque es lo que dice el interruptor.
 */
function whereText(friend) {
  if (!friend.online) {
    const veLaUltima = true;
    const cuando = veLaUltima && friend.lastSeen ? agoText(friend.lastSeen) : null;
    return cuando ? t('friends.lastSeen', { when: cuando }) : t('friends.offline');
  }
  return friend.room ? t('friends.inRoom', { room: friend.room }) : t('friends.inMenu');
}

function friendWhere(friend) {
  const where = document.createElement('span');
  where.className = 'friend__where';
  where.textContent = whereText(friend);
  return where;
}

/**
 * El punto de estado que va apoyado en la foto: verde conectado, gris no.
 *
 * Está aparte de `faceEl` porque hay un `.pfp` que no se crea acá sino que ya
 * está en el HTML —el de la cabecera de la conversación— y necesita el mismo.
 */
function statusDot(online) {
  const dot = document.createElement('i');
  dot.className = `pfp__dot${online ? ' is-on' : ''}`;
  return dot;
}

/**
 * La marca de VIP.
 *
 * Es el MISMO dibujo que se le pinta a la fila en la sala (`VIP_GEM_SVG` en
 * `room-ui.js`) y que muestra el «cómo te ven» del panel VIP: la piedra rellena
 * con las caras en tres celestes y un filo oscuro. Antes acá era el carácter
 * `◆` a secas, y después un rombo de contorno que a 12 px quedaba en un píxel
 * escaso al lado del nombre.
 */
function vipGem() {
  const gem = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gem.setAttribute('viewBox', '0 0 24 24');
  gem.setAttribute('class', 'friend__gem');
  gem.innerHTML =
    '<path d="M7 4 2 9h7.5z" fill="#95e6fc"/><path d="M7 4h10l-2.5 5h-5z" fill="#dcfaff"/>' +
    '<path d="M17 4l5 5h-7.5z" fill="#62ccf2"/><path d="M2 9h7.5L12 21z" fill="#3dbdf3"/>' +
    '<path d="M9.5 9h5L12 21z" fill="#1c9fd9"/><path d="M14.5 9H22L12 21z" fill="#0a7fb9"/>' +
    '<path d="M7 4h10l5 5-10 12L2 9z" fill="none" stroke="#062a3e" stroke-width="1.4" stroke-linejoin="round"/>';
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = 'VIP';
  gem.prepend(title);
  return gem;
}

/*
 * El tilde de un mensaje tuyo: enviado, entregado, leído o fallado.
 *
 * `message.state` lo tiene que poner el sitio. Cuando no viene —panel viejo, o
 * el otro tiene las confirmaciones apagadas— queda en «enviado», que es lo
 * único que este cliente sabe con certeza: que el POST salió bien.
 *
 * El azul del leído sólo se dibuja si VOS tenés las confirmaciones prendidas.
 * Es la misma reciprocidad que aplica `whereText` con la última conexión.
 */
const TICK_SENT = 'M3 6.5 6.4 10 13 3';
const TICK_DOUBLE = 'M2 6.5 5.4 10 12 3M8.6 6.5 12 10l6.6-7';

function messageTick(message) {
  const estado = message.state || 'sent';
  const tick = document.createElement('span');
  tick.className = `tick tick--${estado}`;

  if (estado === 'failed') {
    tick.textContent = '!';
    tick.title = t('friends.msgFailed');
    return tick;
  }

  const leido = estado === 'read';
  const doble = leido || estado === 'delivered';
  if (leido) tick.classList.add('is-read');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', doble ? TICK_DOUBLE : TICK_SENT);
  svg.append(path);
  tick.append(svg);
  tick.title = t(leido ? 'friends.msgRead' : doble ? 'friends.msgDelivered' : 'friends.msgSent');
  return tick;
}

function paintFriendChat(data, friend) {
  /*
   * Con quién estás hablando, armado como una fila de la lista.
   *
   * El nombre estaba arriba, en el título del panel, y ahí no entra: un nombre
   * de Discord normal salía cortado con «…» y al lado quedaba la cuenta de
   * conectados de la lista, que en una conversación no dice nada. Y debajo, con
   * todas las letras, un «Desconectado» que es exactamente lo que el punto de la
   * lista dice sin ocupar un renglón.
   */
  paintFace($('#chatFace'), friend);
  $('#chatFace').append(statusDot(friend.online));

  const name = $('#chatName');
  name.textContent = friend.name;
  if (friend.vip) name.append(vipGem());
  // Dónde está sólo se dice si está: desconectado ya lo dice el punto.
  $('#chatWhere').textContent = friend.online ? whereText(friend) : '';
  // Invitar necesita las dos cosas: alguien a quien invitar y una sala con link.
  $('#chatInvite').hidden = !state.canInvite;
  /*
   * A qué sala lo estás mandando, que desde el botón solo no se ve. Y sin sala,
   * la frase entera: en el chat el botón dice «Invitar» a secas —los tres de esa
   * fila no entran en el dock con la frase larga— así que el «a mi sala» tiene
   * que estar en algún lado.
   */
  $('#chatInvite').title = state.roomLabel
    ? t('friends.inRoom', { room: state.roomLabel })
    : t('friends.invite');

  const mine = data.me.id;
  const talk = data.messages.filter((m) =>
    (m.from === mine && m.to === friend.id) || (m.from === friend.id && m.to === mine));

  const log = $('#chatLog');
  if (!talk.length) {
    log.replaceChildren(emptyState(t('friends.noChat'), t('friends.noChatText')));
    return;
  }

  log.replaceChildren(...talk.map((message) => {
    const esMio = message.from === mine;
    const row = document.createElement('div');
    row.className = `msg${esMio ? ' msg--mine' : ''}`;
    const text = document.createElement('span');
    text.className = 'msg__text';
    text.textContent = message.text;
    const when = document.createElement('span');
    when.className = 'msg__at';
    when.textContent = formatDate(message.at);
    // El estado es sólo de los tuyos: en los que te llegan no significa nada.
    if (esMio) when.append(messageTick(message));
    row.append(text, when);
    return row;
  }));
  // Lo último es lo que importa.
  log.scrollTop = log.scrollHeight;
}

/* ── Acciones ───────────────────────────────────────────── */

function friendAction(payload) {
  return Promise.reject(new Error('Las funciones sociales no están disponibles en esta edición del club.'));
}

/* ── El código de amigo ─────────────────────────────────────────── *
 *
 * Ocho letras y números que no dicen nada de quién sos. Existe para no
 * depender del nombre de Discord, que se cambia, que hay que escribir igualito
 * y que además es lo que la persona muestra en todos lados: pasar el código por
 * el chat de una sala no regala nada más que el código.
 *
 * Se reconoce solo en el campo de agregar: pedirle a alguien que elija entre
 * «por nombre» y «por código» es hacerle explicar al programa algo que el
 * programa puede mirar.
 *
 * Pero mirar no alcanza para DECIDIR, y esto casi sale mal: «shank444» son ocho
 * caracteres del alfabeto del código y encaja perfecto. Si la forma decidiera,
 * agregar a esa persona por su nombre fallaría con «ese código no es de nadie».
 * Así que cuando tiene forma de código se mandan los dos campos y el sitio
 * prueba primero como código y después como nombre — ver el caso `add` en
 * client.routes.js.                                                          */
const FRIEND_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-?[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/i;

function looksLikeCode(value) {
  return FRIEND_CODE.test(String(value || '').trim());
}

function paintFriendCode(code) {
  const box = $('#friendCodeBox');
  if (!box) return;
  state.friendCode = code || null;
  box.hidden = !code;
  if (code) $('#friendCodeValue').textContent = code;
}

$('#friendCodeValue').addEventListener('click', async () => {
  if (!state.friendCode) return;
  try {
    await navigator.clipboard.writeText(state.friendCode);
    toast(t('friends.copied'), 'ok');
  } catch {
    // Sin portapapeles queda a la vista igual, que es lo que importa.
    toast(t('friends.copyFailed'), 'err');
  }
});

$('#friendCodeNew').addEventListener('click', async () => {
  if (!window.confirm(t('friends.newCodeConfirm'))) return;
  const res = await friendAction({ action: 'newcode' });
  if (!res || !res.code) return;
  paintFriendCode(res.code);
  toast(t('friends.newCodeDone'), 'ok');
});

$('#friendAddForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#friendAddName');
  const value = input.value.trim();
  if (!value) return;

  const byCode = looksLikeCode(value);
  const res = await friendAction(
    byCode ? { action: 'add', code: value, username: value } : { action: 'add', username: value }
  );
  if (!res) return;
  input.value = '';
  /*
   * Con algo que tenía forma de código no se puede decir «ya son amigos con
   * Fulano»: puede haber entrado por el código, y el código no dice de quién
   * es. Se avisa sin nombre y la lista lo muestra en el próximo latido.
   */
  const done = res.friend
    ? (byCode ? t('friends.nowFriendsAnon') : t('friends.nowFriends', { name: value }))
    : t('friends.sent');
  toast(done, 'ok');
});

$('#chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chatText');
  const text = input.value.trim();
  if (!text || !state.friendPick) return;
  input.value = '';
  await friendAction({ action: 'message', friend: state.friendPick, text });
});

$('#chatInvite').addEventListener('click', async () => {
  if (!state.friendPick) return;
  const res = await friendAction({ action: 'invite', friend: state.friendPick });
  if (res) toast(t('friends.inviteSent', { name: friendName(state.friendPick) }), 'ok');
});

$('#chatRemove').addEventListener('click', async () => {
  const friend = friendById(state.friendPick);
  if (!friend) return;
  const res = await friendAction({ action: 'remove', friend: friend.id });
  if (!res) return;
  state.friendPick = null;
  toast(t('friends.removed', { name: friend.name }), 'ok');
});

/* ══════════════════════════════════════════════════════════
   Perfiles
   ══════════════════════════════════════════════════════════
   La misma tarjeta para el tuyo y para el de un amigo: quién sos, en qué nivel
   vas, tus números y cómo te ven en la sala. Lo único que cambia es que lo tuyo
   se edita.

   Vive en un modal por encima del dock —y por lo tanto por encima del juego—
   porque se abre DESDE el dock, y el dock se abre jugando.

   De dónde salen los datos:

     · El tuyo, del sitio (`me` en la foto de amigos) y, si el sitio no contesta,
       de lo que hay en esta PC. Un perfil que se apaga porque se cayó el panel
       no sirve de nada: los números son tuyos y están en tu disco.
     · El de un amigo, del sitio y sólo del sitio (acción `profile`). No hay otra
       fuente posible: nada de eso pasa por tu máquina.
   ══════════════════════════════════════════════════════════ */

state.profileOpen = false;
/** A quién estás mirando: un perfil ya resuelto, o null mientras carga. */
state.profileWho = null;
state.profileMine = true;

/**
 * Tu perfil, con lo mejor que se tenga a mano.
 *
 * El sitio manda los contadores ya fusionados entre tus instalaciones; lo local
 * es de esta PC nada más. Se prefiere el del sitio y se cae al local cuando no
 * hay respuesta — que es también lo que pasa antes del primer sondeo.
 */
function myProfile() {
  const discord = vipProfile() || {};
  const remote = (state.friends && state.friends.me) || null;
  const local = state.config.stats;

  return {
    id: remote ? remote.id : 0,
    name: discord.username || (remote && remote.name) || '—',
    avatar: discord.avatar || (remote && remote.avatar) || null,
    vip: isVip(),
    online: true,
    room: null,
    bio: remote ? remote.bio : null,
    slug: remote ? remote.slug : null,
    stats: (remote && remote.stats) || withLevel(local),
    cosmetics: looksOf()
  };
}

/** Los mismos campos que calcula el sitio, para cuando los calcula el cliente. */
function withLevel(stats) {
  const xp = xpOf(stats);
  const { level, into, need } = levelOf(xp);
  return { ...stats, xp, level, levelInto: into, levelNeed: need };
}

/**
 * Abre un perfil. Sin id, el tuyo.
 *
 * El de un amigo se pide al sitio, así que la tarjeta se abre primero con lo que
 * ya se sabe de él —nombre, foto, si está conectado— y se completa cuando llega
 * la respuesta. Abrir en blanco y esperar se ve como si no hubiera pasado nada.
 */
/**
 * Un perfil que ya vino resuelto de afuera: el de alguien de tu sala, abierto
 * desde el menú de clic derecho de la lista de jugadores. Acá no hay nada que
 * pedir, ya llegó todo.
 */
async function openProfile(id) {
  state.profileMine = !id;
  state.profileWho = id ? friendById(id) : myProfile();
  state.profileOpen = true;
  $('#profileModal').hidden = false;
  paintProfile();

  if (!id) return;
  const res = await friendAction({ action: 'profile', friend: id });
  // Pudo cerrarlo o abrir otro mientras venía la respuesta.
  if (!res || !res.profile || !state.profileOpen) return;
  if (state.profileWho && state.profileWho.id !== res.profile.id) return;
  state.profileWho = res.profile;
  paintProfile();
}

function closeProfile() {
  if (!state.profileOpen) return;
  state.profileOpen = false;
  state.profileWho = null;
  $('#profileModal').hidden = true;
  // Igual que al cerrar el dock: si estabas jugando, las teclas vuelven al juego.
  if (!state.friendsOpen) focusGame();
}

function paintProfile() {
  const who = state.profileWho;
  if (!who) return;
  const mine = state.profileMine;

  paintFace($('#profileFace'), who);
  $('#profileName').textContent = who.name;
  $('#profileName').append(...(who.vip ? [vipGem()] : []));
  $('#profileWhere').textContent = mine
    ? t('profile.you')
    : who.online
      ? (who.room ? t('friends.inRoom', { room: who.room }) : t('friends.inMenu'))
      : t('friends.offline');

  paintProfileLevel(who.stats);
  paintProfileBio(who, mine);
  paintProfileStats(who.stats);
  paintProfileLooks(who, mine);
  paintProfileActions(who, mine);
}

function paintProfileLevel(stats) {
  // Sin estadísticas todavía, el nivel es 1 y la barra está vacía: es la verdad,
  // no un hueco.
  const level = stats ? stats.level : 1;
  const into = stats ? stats.levelInto : 0;
  const need = stats ? stats.levelNeed : 100;
  $('#profileLevel').textContent = String(level);
  $('#profileXp').textContent = `${into} / ${need} XP`;
  paintXp($('#profileXpFill'), into / need);
}

function paintProfileBio(who, mine) {
  const text = (who.bio || '').trim();
  $('#profileBio').hidden = mine || !text;
  $('#profileBio').textContent = text;

  $('#profileBioForm').hidden = !mine;
  if (!mine) return;
  // No se pisa lo que esté escribiendo: un sondeo que llega en el medio no puede
  // borrarle la frase a medio escribir.
  if (document.activeElement !== $('#profileBioText')) $('#profileBioText').value = text;
  paintBioLeft();
}

function paintBioLeft() {
  const left = 140 - $('#profileBioText').value.length;
  $('#profileBioLeft').textContent = String(left);
}

function paintProfileStats(stats) {
  const has = stats && (stats.matches || stats.goals || stats.secondsPlayed);
  $('#profileStats').hidden = !has;
  $('#profileNoStats').hidden = !!has;
  if (has) paintDefList($('#profileStats'), statLines(stats));
}

/** Las filas de números que se ven igual en tu tarjeta y en un perfil. */
function statLines(stats) {
  const matches = stats.matches || 0;
  const average = matches ? (stats.goals || 0) / matches : 0;
  return [
    [t('stats.matches'), String(matches)],
    [t('stats.goals'), String(stats.goals || 0)],
    [t('stats.average'), matches ? average.toFixed(2) : '—'],
    [t('stats.assists'), String(stats.assists || 0)],
    [t('stats.bestStreak'), t('stats.days', { days: stats.bestStreak || 0 })],
    [t('settings.timePlayed'), formatDuration(stats.secondsPlayed)]
  ];
}

/**
 * Cómo se ve su fila en la sala.
 *
 * En el tuyo se elige; en el de un amigo sólo se mira, y sólo si está conectado
 * con el cliente: el degradado viaja en el latido de presencia, no está guardado
 * en ninguna base.
 */
function paintProfileLooks(who, mine) {
  const looks = who.cosmetics || {};
  const editable = mine && isVip();
  const show = mine || !!(looks.gradient || looks.font);

  $('#profileLookWrap').hidden = !show;
  if (!show) return;

  $('#profileLookEdit').hidden = !editable;
  $('#profileLookLocked').hidden = !mine || editable;

  paintLooks(PROFILE_LOOK_IDS, looks, {
    editable,
    name: (mine ? (state.config.general.nickname || '').trim() : who.nick || who.name) || t('vip.looksYou')
  });
}

/**
 * Los botones de abajo dependen de si ya son amigos, y eso lo dice el sitio
 * (`friend`) y no la lista de acá: este perfil puede venir de la sala, donde no
 * hay con qué saberlo.
 */
function paintProfileActions(who, mine) {
  const actions = $('#profileActions');
  if (mine) {
    actions.replaceChildren();
    return;
  }

  // Todavía no son amigos: lo único que se puede hacer es pedirlo. Y sólo desde
  // la sala, que es de donde salió la llave.
  if (!who.friend) {
    actions.replaceChildren(...(who.peer ? [actionButton(t('profile.add'), async () => {
      const res = await friendAction({ action: 'addPeer', peer: who.peer });
      if (!res) return;
      closeProfile();
      toast(res.friend ? t('friends.nowFriends', { name: who.name }) : t('friends.sent'), 'ok');
    }, 'primary', ICONS.userPlus)] : []));
    return;
  }

  const buttons = [
    actionButton(t('profile.message'), () => {
      closeProfile();
      openFriends(who.id);
    }, 'primary', ICONS.chat)
  ];
  if (state.canInvite) {
    buttons.push(actionButton(t('friends.invite'), async () => {
      const res = await friendAction({ action: 'invite', friend: who.id });
      if (res) toast(t('friends.inviteSent', { name: who.name }), 'ok');
    }, 'ghost', ICONS.userPlus));
  }
  /*
   * Lo de arriba al revés: está jugando y querés entrar vos.
   *
   * `canAskJoin` lo decide el sitio —hace falta saber si está en una sala Y si
   * acepta que le pidan, que es una preferencia suya que este cliente no tiene—,
   * así que el botón aparece sólo cuando la respuesta ya vino con el perfil.
   *
   * No manda ningún link ni te mete en ningún lado: le llega un aviso y el link
   * te lo manda él, si quiere.
   */
  if (who.canAskJoin) {
    buttons.push(actionButton(t('friends.askJoin'), async () => {
      const res = await friendAction({ action: 'askJoin', friend: who.id });
      if (res) toast(t('friends.askJoinSent', { name: who.name }), 'ok');
    }, 'ghost', ICONS.chat));
  }
  actions.replaceChildren(...buttons);
}

$('#profileClose').addEventListener('click', closeProfile);
// Clic en el velo, no en la tarjeta: es la forma de cerrar que ya tienen los
// otros modales de la app.
$('#profileModal').addEventListener('click', (e) => {
  if (e.target === $('#profileModal')) closeProfile();
});

$('#dockMe').addEventListener('click', () => openProfile(null));
$('#chatProfile').addEventListener('click', () => {
  if (state.friendPick) openProfile(state.friendPick);
});

$('#profileLookFont').addEventListener('change', (e) => saveLooks({ font: e.target.value }));
$('#profileLookClear').addEventListener('click', () => saveLooks({ gradient: '', font: 'default' }));

/* ══════════════════════════════════════════════════════════
   Identidades de HaxBall
   ══════════════════════════════════════════════════════════ */
async function loadAuth() {
  const data = await guard(tvm.auth.state(), 'Error');
  if (!data) return;
  state.auth = data;
  renderAuth();
}

function renderAuth() {
  const list = $('#authList');
  list.replaceChildren();

  $('#authSave').disabled = !state.auth.liveAvailable || state.auth.liveKnown;
  $('#authSave').title = state.auth.liveKnown ? t('auth.alreadySaved') : '';

  if (!(state.auth.items || []).length) {
    list.append(emptyState(t('auth.empty'), t('auth.emptyText')));
    return;
  }

  for (const item of state.auth.items) {
    const row = document.createElement('div');
    row.className = `authrow${state.auth.activeId === item.id ? ' is-active' : ''}`;

    const body = document.createElement('div');
    body.className = 'authrow__body';

    const name = document.createElement('div');
    name.className = 'authrow__name';
    name.append(document.createTextNode(item.name));
    if (state.auth.activeId === item.id) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = t('auth.inUse');
      name.append(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'authrow__meta';
    // Nunca se muestra la clave entera: alcanza con poder distinguirlas.
    meta.textContent = `${t('auth.added')} ${formatDate(item.createdAt)} · ••••${String(item.key).slice(-6)}`;
    body.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'authrow__actions';

    if (state.auth.activeId !== item.id) {
      actions.append(actionButton(t('auth.use'), () => activateAuth(item.id), 'primary', ICONS.check));
    }
    actions.append(
      actionButton(t('auth.rename'), () => renameAuth(item), 'ghost', ICONS.pencil),
      actionButton(t('auth.export'), async () => {
        const res = await guard(tvm.auth.export(item.id), 'Error');
        if (res && res.saved) toast(t('auth.exported'), 'ok');
      }, 'ghost', ICONS.upload),
      actionButton(t('replays.delete'), async () => {
        const next = await guard(tvm.auth.remove(item.id), 'Error');
        if (next) { state.auth = { ...state.auth, ...next }; renderAuth(); }
      }, 'danger', ICONS.trash)
    );

    row.append(body, actions);
    list.append(row);
  }
}

async function activateAuth(id) {
  const next = await guard(tvm.auth.activate(id), 'Error');
  if (!next) return;
  state.auth = { ...state.auth, ...next };
  renderAuth();
  // HaxBall lee la identidad al arrancar: salir a la sala (lobby) fuerza una
  // recarga en blanco que inyecta la nueva Auth sin reconectarte al host.
  await guard(tvm.rooms.leave(), 'Error');
  toast(t('auth.switched'), 'ok');
}

async function renameAuth(item) {
  const name = await ask({
    title: t('auth.rename'),
    label: t('auth.nameLabel'),
    value: item.name,
    maxLength: 32
  });
  if (name === null || !name.trim()) return;
  const next = await guard(tvm.auth.rename(item.id, name.trim()), 'Error');
  if (next) { state.auth = { ...state.auth, ...next }; renderAuth(); }
}

$('#authSave').addEventListener('click', async () => {
  const name = await ask({
    title: t('auth.saveCurrent'),
    label: t('auth.nameLabel'),
    value: state.config.general.nickname || '',
    hint: t('auth.saveHint'),
    maxLength: 32
  });
  if (name === null) return;
  const next = await guard(tvm.auth.saveCurrent(name.trim()), 'Error');
  if (next) { await loadAuth(); toast(t('auth.saved'), 'ok'); }
});

$('#authAdd').addEventListener('click', async () => {
  const key = await ask({
    title: t('auth.add'),
    label: t('auth.keyLabel'),
    hint: t('auth.keyHint'),
    maxLength: 1024,
    ok: t('ask.ok')
  });
  if (key === null || !key.trim()) return;

  const name = await ask({
    title: t('auth.add'),
    label: t('auth.nameLabel'),
    maxLength: 32
  });
  if (name === null) return;

  const next = await guard(tvm.auth.add({ name: name.trim(), key: key.trim() }), 'Error');
  if (next) { await loadAuth(); toast(t('auth.saved'), 'ok'); }
});

/* ══════════════════════════════════════════════════════════
   Ajustes
   ══════════════════════════════════════════════════════════ */
const SYSTEM_SWITCHES = {
  es: [
    { key: 'launchOnStartup', label: 'Abrir con Windows', description: 'El cliente arranca al iniciar sesión.' },
    { key: 'confirmOnExit', label: 'Confirmar antes de cerrar', description: 'Sólo pregunta si estás en medio de una partida.' },
    { key: 'welcomeSummary', label: 'Resumen al abrir', description: 'Muestra tu racha, partidos, goles y horas jugadas en la pantalla de inicio.' }
  ],
  en: [
    { key: 'launchOnStartup', label: 'Launch with Windows', description: 'The client starts when you log in.' },
    { key: 'confirmOnExit', label: 'Confirm before closing', description: 'Only asks if you are in a match.' },
    { key: 'welcomeSummary', label: 'Summary on start', description: 'Shows your streak, matches, goals and hours played on the start screen.' }
  ]
};

/**
 * Bandera con la que te ven en las salas. HaxBall la deduce de la conexión y
 * guarda el resultado, pero respeta un override: es lo que se escribe acá.
 */
function renderCountry() {
  const select = $('#countrySelect');
  const current = state.config.countryOverride || '';

  if (!select.options.length) {
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = t('flag.auto');
    select.append(auto);
    for (const country of state.schema.countries) {
      const option = document.createElement('option');
      option.value = country.code;
      option.textContent = country.name;
      select.append(option);
    }
  }

  select.value = current;
  paintCountryFlag(current);
}

function paintCountryFlag(code) {
  const box = $('#countryFlag');
  const position = code && state.flags && state.flags.positions[code.toUpperCase()];
  if (position) {
    box.className = 'flagrow__flag';
    box.style.backgroundPosition = `${position[0]}px ${position[1]}px`;
    box.textContent = '';
  } else {
    box.className = 'flagrow__flag flagrow__flag--text';
    box.style.backgroundPosition = '';
    box.textContent = code ? code.toUpperCase() : '🌐';
  }
}

$('#countrySelect').addEventListener('change', async (e) => {
  await patchConfig({ countryOverride: e.target.value });
  paintCountryFlag(e.target.value);
  scheduleGameReload();
});

function renderSettings() {
  const lang = isEn() ? 'en' : 'es';
  $('#nickname').value = state.config.general.nickname;
  $('#langSelect').value = state.config.appearance.language || 'es';
  
  // La lista, la opción elegida y las casillas del tamaño a mano salen todas
  // de acá: dependen de la pantalla, así que no se pueden escribir una vez.
  syncResolutionOptions();

  renderCountry();

  buildSwitches(
    $('#systemSwitches'),
    SYSTEM_SWITCHES[lang].map((i) => ({ ...i, value: () => state.config.general[i.key] })),
    (item, value) => patchConfig({ general: { [item.key]: value } })
  );

  renderGameSettings($('#gameSound'), 'sound');
  renderAbout();
}

/* ══════════════════════════════════════════════════════════
   Resolución del juego
   ══════════════════════════════════════════════════════════
   Lo que se elige acá es el tamaño de la CANCHA en píxeles CSS: el iframe del
   juego se dibuja a ese tamaño y se estira hasta llenar la ventana (o la
   pantalla entera). `'auto'` es no estirar: la cancha mide lo que la ventana.
   Ver el bloque «Resolución» más abajo y `applyGameViewport` en game-preload.js.

   El techo sigue siendo el monitor, y no «la resolución del monitor» a secas:
   es su tamaño EN PÍXELES CSS, que en Windows con escalado al 150 % es dos
   tercios de los píxeles físicos. Una superficie más grande que eso no aporta
   detalle —Chromium compone más píxeles y después los reduce— y en drivers
   viejos era el camino al cuadro negro de las transiciones.

   El límite lo manda el proceso principal en cada `win:state`, y ese aviso sale
   también cuando cambia la configuración de pantallas (ver `syncActiveDisplay`
   en main.js), así que enchufar un monitor o cambiar la resolución de Windows
   con el cliente abierto vuelve a armar esta lista sola.
   ══════════════════════════════════════════════════════════ */

/** Lo más chico que tiene sentido: es también el mínimo que acepta el main. */
const RES_MIN = { w: 640, h: 480 };

/**
 * Los tamaños que se ofrecen, de mayor a menor.
 *
 * Se listan todos, pero sólo se dibujan los que entran. La lista está escrita
 * acá y no en el HTML justamente porque no es fija: depende de la pantalla.
 */
const RES_PRESETS = [
  { w: 2560, h: 1440, note: '16:9' },
  { w: 1920, h: 1080, note: '16:9' },
  { w: 1600, h: 900, note: '16:9' },
  { w: 1366, h: 768, note: '16:9' },
  { w: 1360, h: 860, note: null },
  { w: 1280, h: 720, note: '16:9' },
  { w: 1080, h: 1080, note: '1:1' },
  { w: 1024, h: 768, note: '4:3' },
  { w: 800, h: 600, note: '4:3' }
];

/** Límite del monitor activo, en las mismas unidades CSS que la ventana. */
function displayResolutionLimit() {
  const size = state.display && state.display.size;
  const w = Math.round(Number(size && size.width) || 0);
  const h = Math.round(Number(size && size.height) || 0);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** ¿Entra este tamaño en la pantalla? Sin pantalla conocida, se deja pasar. */
function resFits(w, h) {
  const limit = displayResolutionLimit();
  return !limit || (w <= limit.w && h <= limit.h);
}

/**
 * Recorta un tamaño a lo que entra, conservando la proporción.
 *
 * El piso por eje va DESPUÉS de escalar y no es cosmético: escalar solo podía
 * dejar un lado por debajo del mínimo. Con «8000×600» en un 1920×1080 la escala
 * es 0,24 y el alto terminaba en 144 px — más chico que los 480 que el propio
 * proceso principal exige, así que se guardaba en la config un tamaño que la
 * ventana después no respetaba, y la cancha quedaba con una proporción que no
 * eligió nadie.
 */
function clampResolution(w, h) {
  const limit = displayResolutionLimit();
  let outW = Math.round(w);
  let outH = Math.round(h);

  if (limit && (outW > limit.w || outH > limit.h)) {
    const scale = Math.min(limit.w / outW, limit.h / outH);
    outW = Math.round(outW * scale);
    outH = Math.round(outH * scale);
  }

  const maxW = limit ? Math.max(RES_MIN.w, limit.w) : Infinity;
  const maxH = limit ? Math.max(RES_MIN.h, limit.h) : Infinity;
  outW = Math.min(maxW, Math.max(RES_MIN.w, outW));
  outH = Math.min(maxH, Math.max(RES_MIN.h, outH));

  return { w: outW, h: outH, clamped: outW !== Math.round(w) || outH !== Math.round(h) };
}

function resLabel(preset) {
  const partes = [`${preset.w}x${preset.h}`];
  if (preset.default) partes.push(`(${t('settings.resDefaultTag')})`);
  else if (preset.note) partes.push(`(${preset.note})`);
  return partes.join(' ');
}

/**
 * Arma la lista de resoluciones con las que entran en la pantalla.
 *
 * Antes las que no entraban se dibujaban igual, deshabilitadas y con un «no
 * compatible con esta pantalla» pegado al final. Eran cuatro renglones que sólo
 * servían para decir que no, en un desplegable de seis. Ahora directamente no
 * están.
 *
 * La única que se cuela sin cumplir el filtro es la que está puesta en la
 * config: si el monitor cambió y ya no entra, sigue apareciendo —marcada— para
 * que el desplegable no mienta sobre lo que hay guardado.
 */
function syncResolutionOptions() {
  const select = $('#resSelect');
  if (!select) return;

  const limit = displayResolutionLimit();
  const actual = String(state.config.general.resolution || 'auto');
  const [actualW, actualH] = actual.split('x').map(Number);
  const esPreset = RES_PRESETS.some((p) => `${p.w}x${p.h}` === actual);

  select.replaceChildren();
  // Primero «como la ventana»: la cancha del tamaño que tenga, sin estirar.
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = t('settings.resAuto');
  select.append(auto);
  for (const preset of RES_PRESETS) {
    if (!resFits(preset.w, preset.h)) continue;
    const option = document.createElement('option');
    option.value = `${preset.w}x${preset.h}`;
    option.textContent = resLabel(preset);
    select.append(option);
  }

  // Lo guardado, si es un preset que dejó de entrar. Un tamaño a mano no hace
  // falta agregarlo: para eso está «Personalizada…», que lo muestra en sus dos
  // casillas.
  if (esPreset && !resFits(actualW, actualH)) {
    const option = document.createElement('option');
    option.value = actual;
    option.textContent = `${actual} — ${t('settings.resTooBig')}`;
    select.append(option);
  }

  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = t('settings.resCustom');
  select.append(custom);

  // Y recién ahora se elige: escribir `value` antes de que existan las opciones
  // no selecciona nada y deja el desplegable en la primera.
  const propio = !select.querySelector(`option[value="${actual}"]`);
  select.value = propio ? 'custom' : actual;
  $('#resCustomWrap').hidden = !propio;
  if (propio) {
    $('#resCustomW').value = actualW || '';
    $('#resCustomH').value = actualH || '';
  }

  const width = $('#resCustomW');
  const height = $('#resCustomH');
  if (width) { width.min = String(RES_MIN.w); width.max = limit ? String(limit.w) : ''; }
  if (height) { height.min = String(RES_MIN.h); height.max = limit ? String(limit.h) : ''; }

  const nota = $('#resMaxNote');
  if (nota) nota.textContent = [t('settings.resHint'), limit ? t('settings.resMax', { w: limit.w, h: limit.h }) : ''].filter(Boolean).join(' ');
  const notaCustom = $('#resCustomNote');
  if (notaCustom) {
    notaCustom.textContent = limit
      ? t('settings.resRange', { minW: RES_MIN.w, minH: RES_MIN.h, maxW: limit.w, maxH: limit.h })
      : '';
  }
}

/**
 * La pantalla cambió: revisar que lo guardado siga siendo posible.
 *
 * Pasa de verdad —desenchufar el monitor de al lado, cambiar la resolución de
 * Windows, abrir el cliente en la notebook después de usarlo en el monitor
 * grande— y sin esto la config se quedaba con un tamaño que ninguna ventana
 * podía tener: el main lo recortaba en silencio en cada arranque y el
 * desplegable seguía mostrando el número viejo.
 */
async function reconcileResolution() {
  const limit = displayResolutionLimit();
  if (!limit) return;
  const [w, h] = String(state.config.general.resolution || '').split('x').map(Number);
  if (!(w > 0 && h > 0) || resFits(w, h)) return;

  const fixed = clampResolution(w, h);
  await patchConfig({ general: { resolution: `${fixed.w}x${fixed.h}` } });
  syncResolutionOptions();
  toast(t('toast.resDisplayChanged', { w: fixed.w, h: fixed.h }), '');
  if (state.applyResolution) await state.applyResolution();
}

const DISCORD_SWITCHES = {
  es: [
    { key: 'enabled', label: 'Mostrar en Discord', description: 'Muestra que estás usando TL App y si estás en una sala.' },
    { key: 'showRoom', label: 'Mostrar el nombre de la sala', description: 'Si lo apagás sólo dice dónde estás.' },
  ],
  en: [
    { key: 'enabled', label: 'Show on Discord', description: 'Shows that you are using TL App and whether you are in a room.' },
    { key: 'showRoom', label: 'Show the room name', description: 'If off it only says where you are.' },
  ]
};

function renderDiscord() {
  const lang = isEn() ? 'en' : 'es';
  buildSwitches(
    $('#discordSwitches'),
    DISCORD_SWITCHES[lang].map((i) => ({ ...i, value: () => state.config.discord[i.key] })),
    async (item, value) => {
      await patchConfig({ discord: { [item.key]: value } });
      applyDiscord();
    }
  );
}

async function applyDiscord() {
  try {
    const res = await tvm.discord.apply();
    $('#discordStatus').textContent = res.message;
    $('#discordStatus').className = `statusline${res.status === 'on' ? ' is-ok' : res.status === 'error' ? ' is-err' : ''}`;
    if (res.status === 'on') pushPresence();
  } catch (err) {
    $('#discordStatus').textContent = err.message;
    $('#discordStatus').className = 'statusline is-err';
  }
}

/* ══════════════════════════════════════════════════════════
   Actualizaciones
   ══════════════════════════════════════════════════════════
   El feed y los instaladores viven en un bucket de Cloudflare R2. Acá sólo se
   pide, se muestra el progreso y se lanza el instalador; toda la lógica (y la
   verificación del sha256) está en el proceso principal.
   ══════════════════════════════════════════════════════════ */
const UPDATE_SWITCH = {
  es: { label: 'Buscar al abrir', description: 'Consulta el feed una vez por arranque.', hint: 'No descarga nada por su cuenta: sólo avisa.' },
  en: { label: 'Check on launch', description: 'Queries the feed once per start.', hint: 'It never downloads anything on its own: it only tells you.' }
};

function renderUpdates() {
  const lang = isEn() ? 'en' : 'es';

  buildSwitches($('#updateSwitches'), [{
    ...UPDATE_SWITCH[lang],
    key: 'autoCheck',
    value: () => !!state.config.updates.autoCheck
  }], (item, value) => patchConfig({ updates: { [item.key]: value } }));

  // El cartel de arriba tiene sus textos armados a mano: sin esto se quedaría
  // en el idioma anterior, porque no lleva data-i18n.
  paintUpdateNotice();
}

/* ── El cartel de versión nueva ────────────────────────────────────────────
 *
 * Antes esto era un toast: cuatro segundos, y si estabas jugando ni lo veías.
 * Enterarse de una versión nueva no es una confirmación al pasar — es lo mismo
 * que el aviso de reinicio, y por eso comparte su forma: barra fija arriba, sin
 * temporizador, y se va cuando actuás o la descartás.
 *
 * La descarga pasa ACÁ ADENTRO, no en Ajustes → Actualizaciones: mandar a la
 * persona a buscar la pestaña era el motivo por el que nadie actualizaba. La
 * página de ajustes sigue estando y sigue funcionando igual — las dos miran el
 * mismo `tvm.updates` y el progreso se pinta en los dos lados.
 */
function paintUpdateNotice() {
  const bar = $('#updateNotice');
  const { phase, latest } = state.update;
  bar.hidden = phase === 'idle';
  if (bar.hidden) return;

  const busy = phase === 'downloading';
  const done = phase === 'ready';

  $('#updateNoticeTitle').textContent = done
    ? t('update.readyTitle', { v: latest })
    : t('update.title');

  $('#updateNoticeText').textContent = done
    ? t('update.readyText')
    : busy
      ? t('update.downloading', { v: latest })
      : phase === 'failed'
        ? t('update.failed')
        : t('update.text', { v: latest, now: (state.info && state.info.version) || '' });

  const go = $('#updateNoticeGo');
  setButtonLabel(go, done
    ? t('update.install')
    : phase === 'failed'
      ? t('update.retry')
      : t('update.get'));
  go.disabled = busy;

  // Descartar mientras baja dejaría la descarga corriendo sin nada que la
  // muestre: mientras hay progreso, el único camino es esperar.
  $('#updateNoticeLater').disabled = busy;

  $('#updateNoticeBar').hidden = !busy;
  $('#updateNoticeFill').style.transform = `scaleX(${Math.min(1, Math.max(0, state.update.percent / 100))})`;
}

/** @param {'idle'|'available'|'downloading'|'ready'|'failed'} phase */
function setUpdatePhase(phase, extra = {}) {
  state.update = { ...state.update, phase, ...extra };
  paintUpdateNotice();
}

$('#updateNoticeLater').addEventListener('click', () => setUpdatePhase('idle', { dismissed: true }));

$('#updateNoticeGo').addEventListener('click', () =>
  (state.update.phase === 'ready' ? installUpdate() : downloadUpdate()));

function setUpdateStatus(message, kind = '') {
  $('#updateStatus').textContent = message;
  $('#updateStatus').className = `statusline${kind ? ` is-${kind}` : ''}`;
}

/** @param {boolean} downloading Mientras baja, no se puede volver a pedir. */
function syncUpdateButtons({ canDownload = false, canInstall = false, downloading = false } = {}) {
  $('#updateCheck').disabled = downloading;
  $('#updateDownload').hidden = !canDownload;
  $('#updateDownload').disabled = downloading;
  $('#updateInstall').hidden = !canInstall;
}

async function checkUpdates({ silent = false } = {}) {
  if (!silent) setUpdateStatus(t('settings.checking'));
  let res;
  try {
    res = await tvm.updates.check();
  } catch (err) {
    if (!silent) setUpdateStatus(err.message, 'err');
    return null;
  }

  $('#updateNotes').textContent = res.notes || '';
  $('#updateNotes').hidden = !res.notes;
  setUpdateStatus(res.message, res.status === 'available' ? 'ok' : '');
  syncUpdateButtons({ canDownload: !!res.canDownload });

  /*
   * La novedad se avisa con el cartel de arriba, esté donde esté el usuario.
   * Antes era un toast de cuatro segundos: si estabas jugando no lo veías, y si
   * lo veías tenías que ir a buscar la pestaña de Actualizaciones igual.
   *
   * Sólo se levanta si `canDownload`: una versión anunciada sin instalador no
   * tiene ningún botón que ofrecer, y el mensaje ya está en la pestaña.
   */
  if (res.status === 'available' && res.canDownload) {
    state.update.latest = res.latest;
    // «Ahora no» vale para toda la sesión: buscar de nuevo desde la pestaña de
    // Actualizaciones no puede resucitar un cartel que se cerró a propósito.
    if (state.update.phase === 'idle' && !state.update.dismissed) {
      setUpdatePhase('available', { percent: 0 });
    } else {
      paintUpdateNotice();
    }
  }
  return res;
}

function paintUpdateProgress(progress) {
  // El cartel de arriba y la pestaña de ajustes miran la misma descarga: la
  // baje el que la baje, las dos barras tienen que moverse.
  if (state.update.phase === 'downloading') {
    state.update.percent = progress.percent == null ? 0 : progress.percent;
    $('#updateNoticeFill').style.transform =
      `scaleX(${Math.min(1, Math.max(0, state.update.percent / 100))})`;
  }

  $('#updateProgress').hidden = false;
  const fill = $('#updateProgressFill');
  if (progress.percent == null) {
    fill.classList.add('is-indeterminate');
    $('#updateProgressText').textContent = formatBytes(progress.received);
    return;
  }
  fill.classList.remove('is-indeterminate');
  // Escala en vez de ancho: ver el comentario de .progress__bar en app.css.
  fill.style.transform = `scaleX(${Math.min(1, Math.max(0, progress.percent / 100))})`;
  $('#updateProgressText').textContent = `${progress.percent}% · ${formatBytes(progress.received)}`;
}

$('#updateCheck').addEventListener('click', () => checkUpdates());

/**
 * Baja el instalador.
 *
 * La llaman las dos puertas —el cartel de arriba y el botón de la pestaña— y es
 * la MISMA descarga, así que las dos vistas se mueven juntas: no puede pasar que
 * el cartel diga «Actualizar» mientras la pestaña ya está bajando.
 */
async function downloadUpdate() {
  if (state.update.phase === 'downloading') return;
  setUpdatePhase('downloading', { percent: 0 });
  syncUpdateButtons({ downloading: true });
  setUpdateStatus(t('settings.downloading'));
  $('#updateProgress').hidden = false;

  const res = await guard(tvm.updates.download(), 'Error');
  $('#updateProgress').hidden = true;

  if (!res) {
    setUpdatePhase('failed');
    setUpdateStatus(t('settings.downloadFailed'), 'err');
    syncUpdateButtons({ canDownload: true });
    return;
  }
  setUpdatePhase('ready', { latest: res.version });
  setUpdateStatus(t(res.verified ? 'settings.readyVerified' : 'settings.ready', { v: res.version }), 'ok');
  syncUpdateButtons({ canInstall: true });
}

/** Instalar cierra el cliente: si hay partido, se avisa igual que al reiniciar. */
async function installUpdate() {
  if (state.playing && !window.confirm(t('perf.restartConfirm'))) return;
  await guard(tvm.updates.install(), 'Error');
}

$('#updateDownload').addEventListener('click', () => downloadUpdate());
$('#updateInstall').addEventListener('click', () => installUpdate());

/**
 * Le cuenta a Discord dónde estás: menú, sala o partida.
 *
 * El nombre sale primero del propio HaxBall (`state.gameRoomName`, que manda el
 * preload leyendo el título de la sala) y, mientras ése no llegue, del nombre
 * de la sala a la que se pidió entrar o que se acaba de crear.
 *
 * Acá antes se usaba la fila MARCADA en nuestra lista, y eso mostraba salas que
 * no eran: al crear una sala seguía marcada la que hubieras tocado antes en el
 * navegador de salas, así que Discord anunciaba esa otra sala en vez de la
 * recién creada. Marcar una fila no es estar en esa sala.
 */
function pushPresence() {
  if (!state.config.discord.enabled) return;

  // Un replay no es una sala: lo que se muestra es el nombre de la grabación,
  // que es lo único que identifica lo que estás mirando.
  const replay = state.gameView === 'replay';
  const name = replay ? state.replayName : (state.gameRoomName || state.joinedRoomName);
  const place = state.stage !== 'game' ? 'menu' : replay ? 'replay' : state.playing ? 'game' : 'room';

  tvm.discord.presence({
    place,
    room: state.stage === 'game' ? name : null
  }).catch(() => {});
}

/* ══════════════════════════════════════════════════════════
   Tu carrera: estadísticas, nivel y racha
   ══════════════════════════════════════════════════════════
   Los números se cuentan siempre, con sesión o sin ella: son tuyos y se guardan
   en tu PC. La sesión de Discord hace falta para VERLOS, que es lo que los
   convierte en un perfil y no en un contador suelto.

   La experiencia no se guarda: se calcula a partir de las estadísticas. Así no
   hay dos verdades que puedan quedar desincronizadas, y el sitio puede sacar el
   mismo nivel de los mismos números.
   ══════════════════════════════════════════════════════════ */

/** Cuánto vale cada cosa. Un gol es más que un partido; jugar también suma. */
const XP = { goals: 12, assists: 8, matches: 5, ownGoals: 0, perTenMinutes: 2 };

function xpOf(stats) {
  return Math.max(0,
    (stats.goals || 0) * XP.goals +
    (stats.assists || 0) * XP.assists +
    (stats.matches || 0) * XP.matches +
    Math.floor((stats.secondsPlayed || 0) / 600) * XP.perTenMinutes);
}

/**
 * Nivel y progreso dentro del nivel.
 *
 * Del nivel L al L+1 hacen falta `50L + 50` XP (100, 150, 200, …), o sea que
 * para llegar al nivel L hacen falta `25 (L-1)(L+2)` en total. Invertir esa
 * cuadrática da el nivel de una, sin recorrer niveles uno por uno.
 */
function levelOf(xp) {
  const total = (l) => 25 * (l - 1) * (l + 2);
  const level = Math.max(1, Math.floor((-1 + Math.sqrt(9 + (4 * xp) / 25)) / 2));
  return { level, into: xp - total(level), need: 50 * level + 50 };
}

function renderAbout() {
  paintDefList($('#aboutList'), [
    [t('settings.version'), `v${state.info.version}`],
    [t('settings.configFile'), state.info.configPath]
  ]);

}

/** Suma lo que acaba de pasar y repinta con lo que devolvió el disco. */
function addStats(patch) {
  return tvm.stats.add(patch).then((stats) => {
    if (!stats) return;
    state.config.stats = stats;
    paintProfCard();
  }).catch(() => { /* no es crítico */ });
}


$('#langSelect').addEventListener('change', async (e) => {
  await patchConfig({ appearance: { language: e.target.value } });
  renderAll();
  renderRooms();
  renderTabs();
});

$('#resSelect').addEventListener('change', async (e) => {
  const val = e.target.value;
  if (val === 'custom') {
    $('#resCustomWrap').hidden = false;
    return;
  }
  $('#resCustomWrap').hidden = true;
  await patchConfig({ general: { resolution: val } });
  // Antes acá se disparaba un `resize` a mano, que no redimensionaba nada: sólo
  // repintaba con el mismo tamaño de siempre. Ahora se pide el tamaño de verdad.
  if (state.applyResolution) await state.applyResolution();
});

/*
 * El tamaño a mano se recorta MIENTRAS se escribe, no sólo al aplicar.
 *
 * El atributo `max` de un `<input type=number>` no impide tipear de más: pinta
 * el campo como inválido y nada más. Sin esto se podía dejar «9999» escrito, y
 * lo que quedaba guardado era otro número — el recortado— sin que la casilla se
 * enterara nunca.
 */
for (const [id, eje] of [['#resCustomW', 'w'], ['#resCustomH', 'h']]) {
  $(id).addEventListener('change', (e) => {
    const limit = displayResolutionLimit();
    const n = parseInt(e.target.value, 10);
    if (!Number.isFinite(n)) return;
    const max = limit ? limit[eje] : Infinity;
    e.target.value = String(Math.min(max, Math.max(RES_MIN[eje], n)));
  });
}

$('#resCustomApply').addEventListener('click', async (e) => {
  e.preventDefault();
  const w = parseInt($('#resCustomW').value, 10);
  const h = parseInt($('#resCustomH').value, 10);
  if (!(w >= RES_MIN.w && h >= RES_MIN.h)) {
    toast(t('toast.resMin'), 'err');
    return;
  }
  // `clampResolution` reduce los dos lados juntos para no deformar la cancha y
  // recién después le pone el piso a cada eje. El porqué del orden está en su
  // propio comentario.
  const fixed = clampResolution(w, h);
  $('#resCustomW').value = fixed.w;
  $('#resCustomH').value = fixed.h;
  if (fixed.clamped) toast(t('toast.resClamped'), '');
  await patchConfig({ general: { resolution: `${fixed.w}x${fixed.h}` } });
  if (state.applyResolution) await state.applyResolution();
});

$('#nickname').addEventListener('change', async (e) => {
  await patchConfig({ general: { nickname: e.target.value.trim() } });
  renderNickCard();
  toast(t('toast.nickSaved'), 'ok');
  scheduleGameReload();
});

$('#cfgExport').addEventListener('click', async () => {
  const res = await guard(tvm.config.export(), 'Error');
  if (res && res.saved) toast(t('toast.exported'), 'ok');
});

$('#cfgImport').addEventListener('click', async () => {
  const res = await guard(tvm.config.import(), 'Error');
  if (res && res.imported) {
    applyConfig(res.config);
    state.schema = await tvm.config.schema();
    await refreshThemeVars();
    renderAll();
    toast(t('toast.imported'), 'ok');
  }
});

$('#cfgReset').addEventListener('click', async () => {
  if (!window.confirm(t('settings.resetConfirm'))) return;
  const next = await guard(tvm.config.reset(), 'Error');
  if (next) {
    applyConfig(next);
    await refreshThemeVars();
    renderAll();
    toast(t('toast.reset'), 'ok');
  }
});

/* ══════════════════════════════════════════════════════════
   El juego
   ══════════════════════════════════════════════════════════ */
/**
 * Montar el juego, pero sólo si hay juego al que entrar.
 *
 * Con HaxBall caído —o con el muro de Cloudflare puesto— apuntar el `<webview>`
 * al sitio cierra el cliente entero a los pocos segundos: se cae Chromium al
 * confirmar esa navegación, sin pasar por JavaScript y sin dejar nada en el log
 * (el detalle está en `main.js`, en la sección «HaxBall caído»). Por eso se
 * pregunta antes y, si no está, no se monta nada: se muestra el cartel y se
 * espera a que vuelva, que el main avisa solo.
 */
async function mountGame() {
  const health = await tvm.game.health().catch(() => ({ down: false, reason: '' }));
  if (health.down) return showGameDown(health.reason);
  createGameTab();
}

/* ══════════════════════════════════════════════════════════
   Pestañas de juego
   ══════════════════════════════════════════════════════════
   Cada pestaña es un `<webview>` más apuntado a HaxBall, en la MISMA partición:
   comparten identidad, apodo y ajustes —es el mismo jugador— y nada más. Así se
   puede estar en una sala esperando el partido y, mientras, practicar un x1 en
   otra.

   Sólo una se ve: la activa. Las demás se quedan montadas donde están, de un
   píxel e invisibles (`.is-bg` en app.css), con la sala y la conexión vivas
   pero en silencio y a diez cuadros por segundo. No se mueven en el DOM ni se
   esconden con `display: none`: lo primero recarga el `<webview>` y lo segundo
   lo congela (el porqué, medido, está en app.css).

   Lo que la interfaz sabe «del juego» —qué pantalla tiene puesta, en qué sala
   está, si juega, los goles del partido— es de UNA pestaña. Vive en `state`
   para la activa, y al cambiar se guarda en `tab.snap` y se repone el de la
   otra (`snapshotTab`/`restoreTab`). Los avisos del proceso principal llegan
   con la marca de qué pestaña los mandó (`meta.tab`), y `tabBucket` decide si
   van a `state` o al bolsillo de una de atrás.
   ══════════════════════════════════════════════════════════ */

/** Más que esto son procesos de Chromium de más; cada uno es un HaxBall entero. */
const MAX_GAME_TABS = 4;

/** Lo que es de una pestaña y no de la app. Mismos nombres que en `state`. */
const TAB_FIELDS = ['gameView', 'gameRoomName', 'joinedRoomName', 'playing', 'liveGameSettings',
  'liveGoals', 'heatmap', 'matchCard', 'summary', 'summaryError', 'replayPath', 'replayName',
  'playedSeconds'];

function freshSnap() {
  return {
    gameView: null, gameRoomName: null, joinedRoomName: null, playing: false,
    liveGameSettings: false, liveGoals: [], heatmap: null, matchCard: null,
    summary: null, summaryError: null, replayPath: null, replayName: null, playedSeconds: 0
  };
}

let tabSeq = 0;

/**
 * Monta un HaxBall nuevo y lo pone al frente.
 *
 * El `<webview>` se agrega al lado de los que ya hay, nunca en lugar de ellos.
 * Antes acá había un `replaceChildren`, que con una sola pestaña era lo mismo.
 */
function createGameTab() {
  if (state.tabs.length >= MAX_GAME_TABS) {
    toast(t('tabs.max', { n: MAX_GAME_TABS }), 'err');
    return null;
  }

  const view = document.createElement('webview');
  const tab = { id: ++tabSeq, wcId: null, view, snap: freshSnap() };
  view.className = 'is-bg';
  view.dataset.tab = String(tab.id);
  view.setAttribute('src', state.config.general.gameUrl);
  view.setAttribute('partition', 'persist:haxball');
  view.setAttribute('preload', pathToFileUrl(state.info.gamePreload));
  view.setAttribute('allowpopups', '');
  view.setAttribute('webpreferences', 'contextIsolation=no,sandbox=no,nodeIntegration=no,backgroundThrottling=no');

  // Ojo: NO se oculta la carga en 'dom-ready'. Ahí HaxBall todavía está sin
  // estilar y se veía un parpadeo del diseño original. Se espera a que el
  // preload avise que ya aplicó el tema (game:themed) y a que la pantalla sea
  // una de verdad.
  view.addEventListener('dom-ready', () => {
    if (tab === state.activeTab) $('#stageError').hidden = true;
  });

  /*
   * El id del webContents es lo que ata los avisos del proceso principal
   * (`meta.tab`) con esta pestaña. Se toma apenas el invitado existe —antes de
   * que cargue nada— para que ni el primer `game:view` llegue sin dueño.
   */
  view.addEventListener('did-attach', () => {
    try { tab.wcId = view.getWebContentsId(); } catch { return; }
    // Una pestaña recién creada ya está al frente cuando el invitado aparece:
    // `activateTab` corrió sin id y no pudo avisar. Sin esto, el proceso
    // principal seguiría hablándole a la anterior —entrar a una sala desde la
    // nueva navegaría la vieja.
    if (tab === state.activeTab) tvm.tabs.activate(tab.wcId).catch(() => {});
  });

  view.addEventListener('did-fail-load', (e) => {
    // HaxBall carga publicidad de terceros que suele fallar: sólo nos importa
    // que se caiga el frame principal.
    if (!e.isMainFrame || e.errorCode === -3) return;
    // Y sólo de la pestaña que se está mirando: el cartel es uno solo.
    if (tab !== state.activeTab) return;
    // ERR_BLOCKED_BY_CLIENT: lo frenó el main porque el sitio no está en pie.
    // No es un error de carga; se pregunta el motivo para no decir «verificá»
    // cuando lo que pasa es que HaxBall está caído, ni al revés.
    if (e.errorCode === -20) {
      tvm.game.health()
        .then((h) => showGameDown(h.reason))
        .catch(() => showGameDown(''));
      return;
    }
    hideLoading();
    $('#stageError').hidden = false;
    $('#stageError').querySelector('h2').dataset.i18n = 'game.error';
    $('#stageError').querySelector('h2').textContent = t('game.error');
    // El detalle es el código de Chromium, que no se traduce: sin clave, para
    // que un cambio de idioma no lo reemplace por otro texto.
    delete $('#stageErrorText').dataset.i18n;
    $('#stageErrorText').textContent = `${e.errorDescription || ''} (${e.errorCode})`;
  });

  $('#stageFrame').append(view);
  state.tabs.push(tab);
  activateTab(tab);
  return tab;
}

/** La pestaña que mandó un aviso, o `null` si no dijo (o ya no está). */
function tabByMeta(meta) {
  if (!meta || meta.tab == null) return null;
  const found = state.tabs.find((tab) => tab.wcId === meta.tab);
  if (found) return found;
  // El id se toma en `did-attach`; si un aviso le ganó de mano y hay una sola
  // pestaña sin id, es ésa.
  const orphans = state.tabs.filter((tab) => tab.wcId == null);
  if (orphans.length === 1) { orphans[0].wcId = meta.tab; return orphans[0]; }
  return null;
}

/**
 * Dónde va lo que dijo el juego: a `state` si es la pestaña activa (o no se
 * sabe cuál es), al bolsillo de la pestaña si está atrás.
 *
 * @returns {{ s: object, active: boolean, tab: object|null }}
 */
function tabBucket(meta) {
  const tab = tabByMeta(meta);
  if (!tab || tab === state.activeTab) return { s: state, active: true, tab: tab || state.activeTab };
  return { s: tab.snap, active: false, tab };
}

function snapshotTab(tab) {
  for (const field of TAB_FIELDS) tab.snap[field] = state[field];
}

function restoreTab(tab) {
  for (const field of TAB_FIELDS) state[field] = tab.snap[field];
}

/** Dónde está una pestaña, con los mismos nombres que usa HaxBall (`game:view`). */
function tabView(tab) {
  return tab === state.activeTab ? state.gameView : tab.snap.gameView;
}

function tabInRoom(tab) {
  const kind = tabView(tab);
  return !!kind && kind !== 'roomlist';
}

/** El rótulo de la pestaña: la sala si está en una, si no en qué anda. */
function tabLabel(tab) {
  const s = tab === state.activeTab ? state : tab.snap;
  const kind = s.gameView;
  if (kind === 'replay') return s.replayName || t('tabs.replay');
  if (s.gameRoomName) return s.gameRoomName;
  if (s.joinedRoomName && kind !== 'roomlist') return s.joinedRoomName;
  if (!kind) {
    // Todavía no llegó el aviso de pantalla: se usa lo que la interfaz sí sabe.
    // En la lista de salas (escenario «browser») es el menú, no «Cargando…».
    if (tab === state.activeTab) return state.stage === 'game' ? t('tabs.connecting') : t('tabs.lobby');
    return t('tabs.loading');
  }
  if (kind === 'roomlist') return t('tabs.lobby');
  if (kind === 'connecting') return t('tabs.connecting');
  return t('tabs.room');
}

/** Para el punto de color: `game` jugando, `room` en una sala, `connecting`, `idle`. */
function tabState(tab) {
  const s = tab === state.activeTab ? state : tab.snap;
  if (s.playing) return 'game';
  if (s.gameView === 'connecting') return 'connecting';
  if (tabInRoom(tab)) return 'room';
  return 'idle';
}

/**
 * Pone una pestaña al frente.
 *
 * Lo de la que sale se guarda en su bolsillo y lo de la que entra se repone en
 * `state`, y recién después se le avisa al proceso principal —que es el que
 * silencia a la otra, le baja el ritmo y le da la prioridad a ésta— y se
 * vuelve a poner la pantalla que corresponde (`onGameView`), igual que si el
 * juego acabara de decirla.
 */
async function activateTab(tab) {
  if (!tab || tab === state.activeTab) return;
  const prev = state.activeTab;
  if (prev) {
    snapshotTab(prev);
    prev.view.classList.add('is-bg');
  }

  state.activeTab = tab;
  state.webview = tab.view;
  tab.view.classList.remove('is-bg');
  restoreTab(tab);
  renderTabs();

  // Lo que el proceso principal sabe de esta pestaña. Cubre lo que haya
  // pasado mientras la pestaña no tenía dueño (ver `tabByMeta`).
  if (tab.wcId != null) {
    const info = await tvm.tabs.activate(tab.wcId).catch(() => null);
    // Mientras se esperaba pudo cambiar otra vez.
    if (state.activeTab !== tab) return;
    if (info) {
      if (info.view && !state.gameView) state.gameView = info.view;
      if (info.room && !state.gameRoomName) state.gameRoomName = info.room;
      state.playing = !!info.playing;
      if (info.liveSettings) state.liveGameSettings = !!info.liveSettings.available;
    }
  }

  // La pantalla de esta pestaña, como si el juego acabara de decirla. Una que
  // todavía no dijo nada es la lista de salas sin velo, y sigue diciendo
  // «Cargando…» en la barra hasta que hable.
  if (state.gameView) onGameView(state.gameView);
  else { setStage('browser'); hideLoading(); pushPresence(); }
  renderTabs();
  if (state.repaintStats) state.repaintStats();
  focusGame();
}

/**
 * Cierra una pestaña. Sacar el `<webview>` del DOM destruye ese HaxBall, o sea
 * que si estaba en una sala, sale de ella: por eso se pregunta.
 */
function closeTab(tab) {
  if (!tab) return;
  if (state.tabs.length <= 1) {
    toast(t('tabs.last'), '');
    return;
  }
  if (tabInRoom(tab) && !window.confirm(t('tabs.closeConfirm', { name: tabLabel(tab) }))) return;

  const index = state.tabs.indexOf(tab);
  if (index < 0) return;
  state.tabs.splice(index, 1);

  if (tab === state.activeTab) {
    // Lo jugado en ésta se cuenta ahora: al reponer la otra, el contador es de ella.
    flushPlayTime();
    // Sin `snapshotTab`: la que se va no tiene a dónde volver.
    state.activeTab = null;
    state.webview = null;
    const next = state.tabs[Math.min(index, state.tabs.length - 1)];
    tab.view.remove();
    activateTab(next);
    return;
  }
  tab.view.remove();
  renderTabs();
}

function newGameTab() {
  if (state.tabs.length >= MAX_GAME_TABS) {
    toast(t('tabs.max', { n: MAX_GAME_TABS }), 'err');
    return;
  }
  if (!state.webview) {
    // Sin ninguna montada, «nueva» es la primera: pasa por la comprobación de
    // que HaxBall esté en pie, como al arrancar.
    mountGame();
    return;
  }
  const tab = createGameTab();
  if (tab && state.tabs.length === 2) toast(t('tabs.opened'), '');
}

function switchTab(step) {
  if (state.tabs.length < 2 || !state.activeTab) return;
  const index = state.tabs.indexOf(state.activeTab);
  const next = (index + step + state.tabs.length) % state.tabs.length;
  activateTab(state.tabs[next]);
}

/**
 * Dibuja la barra de pestañas. Se rehace entera: son cuatro botones como
 * mucho, y así el rótulo, el punto y el activo salen siempre del estado.
 */
function renderTabs() {
  const host = $('#gameTabs');
  if (!host) return;
  host.dataset.count = String(state.tabs.length);
  const nodes = state.tabs.map((tab) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `gametab${tab === state.activeTab ? ' is-active' : ''}`;
    btn.dataset.tab = String(tab.id);
    btn.dataset.state = tabState(tab);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', tab === state.activeTab ? 'true' : 'false');
    const label = tabLabel(tab);
    btn.title = label;

    const dot = document.createElement('i');
    dot.className = 'gametab__dot';
    const text = document.createElement('span');
    text.className = 'gametab__label';
    text.textContent = label;
    const close = document.createElement('span');
    close.className = 'gametab__x';
    close.dataset.close = String(tab.id);
    close.title = t('tabs.close');
    close.innerHTML = '<svg data-icon viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    btn.append(dot, text, close);
    return btn;
  });
  host.replaceChildren(...nodes);
  const add = $('#gameTabAdd');
  if (add) add.disabled = state.tabs.length >= MAX_GAME_TABS;
}

function tabById(id) {
  return state.tabs.find((tab) => String(tab.id) === String(id)) || null;
}

$('#gameTabs').addEventListener('click', (e) => {
  const close = e.target.closest('[data-close]');
  if (close) {
    e.stopPropagation();
    closeTab(tabById(close.dataset.close));
    return;
  }
  const btn = e.target.closest('.gametab');
  if (btn) activateTab(tabById(btn.dataset.tab));
});
// Botón del medio: cerrar, como en cualquier navegador.
$('#gameTabs').addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;
  const btn = e.target.closest('.gametab');
  if (btn) { e.preventDefault(); closeTab(tabById(btn.dataset.tab)); }
});
$('#gameTabAdd').addEventListener('click', newGameTab);

/**
 * Las teclas de pestañas. Adentro del juego las manda el preload (`tabs:key`):
 * Alt+T, Alt+W y Alt+1…4 — con Alt y no con Ctrl porque Ctrl es patear de
 * fábrica, ver `tabAction` en game-preload.js. Con el foco en la interfaz
 * valen ésas y también las de navegador (Ctrl+T, Ctrl+W, Ctrl+Tab).
 */
function onTabKey(action) {
  if (action === 'new') newGameTab();
  else if (action === 'close') closeTab(state.activeTab);
  else if (action === 'next') switchTab(1);
  else if (action === 'prev') switchTab(-1);
  else if (/^go:[1-4]$/.test(String(action))) {
    const tab = state.tabs[Number(action.slice(3)) - 1];
    if (tab) activateTab(tab);
  }
}
tvm.tabs.onKey(onTabKey);

/* ── HaxBall caído ──────────────────────────────────────────────────────── *
 *
 * El cartel es el mismo de siempre, con otro texto: acá no falló la conexión
 * del jugador, falló el sitio. Distinguirlo importa porque si no, el que lo lee
 * se pone a revisar su internet.                                            */

/**
 * El cliente sigue andando: es HaxBall el que no está.
 *
 * Hay dos casos distintos y conviene no mezclarlos. Si el sitio está caído no
 * queda más que esperar; pero si lo que hay es la verificación de Cloudflare,
 * eso se resuelve y se juega igual, así que se la muestra acá mismo para
 * pasarla, en vez de dejar al jugador mirando un cartel que no es cierto.
 */
function showGameDown(reason) {
  hideLoading();
  $('#stageError').hidden = false;

  const challenge = reason === 'challenge';
  const titleKey = challenge ? 'game.verify' : 'game.down';
  const textKey = challenge ? 'game.verifyText' : 'game.downText';

  const title = $('#stageError').querySelector('h2');
  // La clave se deja puesta, no sólo el texto: si el jugador cambia el idioma
  // con el cartel en pantalla, se retraduce éste y no el de «no se pudo cargar».
  title.dataset.i18n = titleKey;
  title.textContent = t(titleKey);
  $('#stageErrorText').dataset.i18n = textKey;
  $('#stageErrorText').textContent = t(textKey);

  const btnKey = challenge ? 'game.verifyBtn' : 'rooms.retry';
  $('#retryLoad').dataset.i18n = btnKey;
  setButtonLabel($('#retryLoad'), t(btnKey));

  // El hueco de la verificación sólo tiene sentido si hay muro que pasar.
  $('#verifyHost').hidden = !challenge;

  // Se muestra sola la primera vez —es lo que destraba el juego— pero no se
  // vuelve a pedir en cada consulta: el botón está ahí para eso.
  if (challenge && !state.verifyAsked) {
    state.verifyAsked = true;
    tvm.game.verify(verifyBounds()).catch(() => {});
  }
}

/**
 * Dónde va la verificación, en coordenadas de la ventana.
 *
 * El `BrowserView` lo pega el proceso principal y no sabe nada de este
 * documento, así que la medida sale de acá. `getBoundingClientRect()` ya da
 * píxeles independientes del dispositivo, que es lo que `setBounds` espera.
 */
function verifyBounds() {
  const host = $('#verifyHost');
  const box = host.getBoundingClientRect();
  // Con el hueco fuera de pantalla —otra pestaña abierta— la medida da cero.
  // Ahí se lo manda lejos en vez de dejarlo pegado arriba a la izquierda,
  // porque un BrowserView no se puede achicar hasta desaparecer.
  if (!box.width || !box.height) return { x: -20000, y: -20000, width: 10, height: 10 };
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

/**
 * Vuelve a decirle al main dónde va la verificación.
 *
 * El `BrowserView` vive por encima de este documento y no sabe que algo se
 * movió: no se acomoda con el layout ni se esconde al cambiar de pestaña. Hay
 * que avisarle en cada cambio de tamaño y en cada cambio de vista, o queda
 * flotando donde estaba el hueco antes, tapando lo que haya debajo.
 */
function syncVerifyBounds() {
  const host = $('#verifyHost');
  if (!host || host.hidden) return;
  // Fuera de la pantalla del juego no hay dónde ponerla: se la manda lejos.
  const onStage = state.view === 'play';
  tvm.game.verifyBounds(onStage ? verifyBounds() : { x: -20000, y: -20000, width: 10, height: 10 });
}

window.addEventListener('resize', syncVerifyBounds);

/*
 * El main mira cada tanto si volvió, así que esto llega solo: no hay que
 * quedarse tocando «Reintentar».
 */
tvm.game.onHealth(({ down, reason }) => {
  if (down) {
    // Si el juego ya estaba cargado se lo deja en paz: una partida empezada
    // sigue andando entre los jugadores aunque el sitio se haya caído.
    if (!state.webview) showGameDown(reason);
    return;
  }

  // Volvió: si más adelante hay otro muro, la verificación se vuelve a ofrecer.
  state.verifyAsked = false;
  $('#verifyHost').hidden = true;
  $('#stageError').hidden = true;
  if (!state.webview) {
    showLoading(t('game.loading'));
    mountGame();
  }
});

/* ── La pantalla de «Conectando…» ───────────────────────────────────────── *
 *
 * Se puede salir de acá. Antes no: si HaxBall no terminaba de conectar —sala
 * caída, red que se corta, o el propio juego colgado en su `.connecting-view`—
 * el velo se quedaba puesto para siempre y no había forma de volver a la lista
 * sin cerrar el cliente. El aviso aparece recién si tarda, para no sugerir que
 * algo anda mal cuando la conexión es normal.                               */

/** A partir de acá, una conexión normal ya tendría que haber entrado. */
const STUCK_AFTER_MS = 8000;

let stuckTimer = null;

function showLoading(text) {
  $('#loadingText').textContent = text;
  $('#stageLoading').classList.remove('is-hidden');

  $('#loadingHint').hidden = true;
  clearTimeout(stuckTimer);
  stuckTimer = setTimeout(() => {
    $('#loadingHint').hidden = false;
    if (state.stage !== 'game') return;
    if (!state.gameView || state.gameView === 'loading') {
      state.gameView = 'connecting';
      renderTabs();
    }
    hideLoading();
  }, STUCK_AFTER_MS);
}

function hideLoading() {
  clearTimeout(stuckTimer);
  stuckTimer = null;
  $('#loadingHint').hidden = true;
  $('#stageLoading').classList.add('is-hidden');
}

/** ¿Está el velo puesto? Es lo que decide si Escape cancela o no hace nada. */
function isLoadingVisible() {
  return state.stage === 'game' && !$('#stageLoading').classList.contains('is-hidden');
}

/**
 * Cancelar: se abandona el intento y se vuelve al navegador de salas.
 *
 * La interfaz se acomoda primero y el juego después. Si `rooms:leave` fallara
 * —el webview todavía no montado, por ejemplo—, el jugador igual sale de la
 * pantalla trabada, que es de lo que se trata.
 */
function cancelConnecting() {
  state.autoJoin = null;
  state.pendingJoin = null;
  hideLoading();
  setStage('browser');
  setView('play');
  syncJoinButton();
  tvm.rooms.leave().catch(() => {});
  toast(t('toast.cancelled'), '');
}

$('#loadingCancel').addEventListener('click', cancelConnecting);

function pathToFileUrl(filePath) {
  return encodeURI(`file:///${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`);
}

$('#retryLoad').addEventListener('click', async () => {
  $('#stageError').hidden = true;
  showLoading(t('game.loading'));

  // Fuerza una consulta nueva en vez de creerle al último veredicto: el botón
  // es justamente para cuando el jugador cree que HaxBall ya volvió.
  const health = await tvm.game.health(true).catch(() => ({ down: false }));
  if (health.down) {
    // Tocar el botón es pedirlo de nuevo a propósito: si hay muro, la ventana
    // se vuelve a abrir aunque el jugador la hubiera cerrado antes.
    if (health.reason === 'challenge') state.verifyAsked = false;
    return showGameDown(health.reason);
  }

  if (state.webview) state.webview.reload();
  else mountGame();
});

/**
 * Qué pantalla de HaxBall está activa decide si mostramos el juego o la lista.
 *
 * `password` es la pantalla que pide la contraseña de una sala cerrada. Faltaba
 * acá, así que el cliente la trataba como pantalla desconocida, dejaba el juego
 * escondido detrás de la lista y no había dónde escribir la contraseña: el
 * juego quedaba plantado en esa pantalla y desde ahí ya no se podía entrar a
 * ninguna sala ni crear una.
 */
const GAME_STAGES = {
  room: 'game', game: 'game', connecting: 'game',
  disconnected: 'game', dialog: 'game', password: 'game',
  replay: 'game'
};

/** Pantallas donde el juego ya terminó de cargar y se puede mostrar. */
/**
 * Un aviso de «cambió la pantalla» de una pestaña de juego, venga por evento o
 * de la consulta de respaldo (`reconcileTabs`).
 */
function handleViewEvent(kind, meta) {
  const { s, active, tab } = tabBucket(meta);
  if (tab && meta && Number.isFinite(meta.seq)) tab.viewSeq = Math.max(tab.viewSeq || 0, meta.seq);
  if (!active) {
    // Una pestaña de atrás cambió de pantalla: sólo cambia su rótulo. Si
    // volvió a la lista, lo de la sala en la que estaba ya no vale.
    s.gameView = kind;
    if (kind === 'roomlist') {
      s.gameRoomName = null;
      s.joinedRoomName = null;
      s.playing = false;
    }
    renderTabs();
    return;
  }
  const era = state.gameView;
  onGameView(kind);
  // Abrir una grabación dispara el análisis solo. Salir de ella tira lo que
  // se había leído: el resumen es de la grabación, no de la pantalla.
  if (kind === 'replay' && era !== 'replay') scheduleAutoAnalyze();
  else if (kind !== 'replay' && era === 'replay') {
    state.summary = null;
    state.summaryError = null;
    state.replayPath = null;
  }
  renderTabs();
}

/**
 * Respaldo de los avisos de pantalla.
 *
 * La interfaz decide qué mostrar —la lista de salas propia, el velo de
 * «Conectando…», el rótulo de cada pestaña— según el último «cambió la
 * pantalla» que le llega del juego. Si uno se pierde (llegó antes de que la
 * interfaz se suscribiera, o se cruzó con otro), todo queda desfasado: el velo
 * puesto con la sala ya conectada, la pestaña diciendo «Cargando…» o, al salir
 * de una sala, la lista nativa de HaxBall en lugar de la nuestra.
 *
 * El proceso principal numera cada aviso. Una vez por segundo se le pregunta el
 * último número de cada pestaña y, si es mayor que el que esta interfaz vio, se
 * aplica el estado actual. Si no se perdió nada, no hace nada.
 */
let reconciling = false;
async function reconcileTabs() {
  if (reconciling || document.hidden || !state.tabs.length) return;
  reconciling = true;
  try {
    const snap = await tvm.tabs.snapshot();
    for (const tab of state.tabs.slice()) {
      const info = tab.wcId != null ? snap[tab.wcId] : null;
      if (!info) continue;
      if (info.view && info.viewSeq > (tab.viewSeq || 0)) {
        handleViewEvent(info.view, { tab: tab.wcId, seq: info.viewSeq });
      }
      // El nombre de la sala también puede haberse perdido.
      const bucket = tab === state.activeTab ? state : tab.snap;
      if (info.room && bucket.gameRoomName !== info.room && info.view && info.view !== 'roomlist') {
        bucket.gameRoomName = info.room;
        if (tab === state.activeTab) {
          pushPresence();
          if (state.stage === 'game') hideLoading();
        }
        renderTabs();
      }
    }
  } catch {
    /* sin respaldo esta vuelta: la próxima */
  } finally {
    reconciling = false;
  }
}
setInterval(reconcileTabs, 1000);

const SETTLED = new Set(['roomlist', 'room', 'game', 'disconnected', 'dialog', 'password', 'replay']);

function onGameView(kind) {
  // Qué pantalla del juego está puesta decide de qué es el resumen: de la
  // partida en curso o de la grabación entera.
  state.gameView = kind;
  setStage(GAME_STAGES[kind] || 'browser');
  // El «Conectando…» se mantiene hasta estar realmente dentro de la sala.
  // Estar en la sala o en la partida no necesita que el tema ya esté confirmado:
  // esperar ese aviso era lo que dejaba el velo puesto con la sala ya conectada.
  if (kind === 'room' || kind === 'game' || kind === 'replay') {
    hideLoading();
    dismissToast(state.joiningToast);
  } else if (state.themed && (SETTLED.has(kind) || kind === 'connecting')) hideLoading();
  else if (kind === 'connecting') showLoading(t('game.connecting'));
  pushPresence();
  /*
   * Salió de la sala: lo que estaba esperando para no interrumpir, ahora sí.
   *
   * El aviso lo da el JUEGO, no nosotros, y esa es la gracia: llega cuando ya
   * está afuera de verdad, así que la recarga no se pisa con la navegación que
   * lo sacó (salir cancelando, por ejemplo, es una navegación nuestra).
   */
  if (kind === 'roomlist') flushPendingReload();
}

function setPlaying(playing) {
  if (state.playing === playing) return;
  state.playing = playing;
  // Discord pasa de «En una sala» a «En una partida» y al revés.
  pushPresence();
  if (playing) {
    state.playedSeconds = 0;
    addStats({ sessions: 1 });
  } else {
    flushPlayTime();
    // Lo que quedó esperando a que terminaras de jugar. Puede que sigas en la
    // sala, y ahí todavía no: lo decide `canReloadGame`.
    flushPendingReload();
  }
}

function flushPlayTime() {
  const seconds = Math.round(state.playedSeconds);
  state.playedSeconds = 0;
  if (seconds < 3) return;
  addStats({ seconds });
}

/* ── Atajos ─────────────────────────────────────────────── */
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (secModal) { e.preventDefault(); closeSecModal(); return; }
    if (!$('#askModal').hidden) { e.preventDefault(); closeAsk(null); return; }
    if (!$('#themeModal').hidden) { e.preventDefault(); $('#themeModal').hidden = true; return; }
    if (!$('#createModal').hidden) { e.preventDefault(); closeCreateModal(); return; }
    // Tu menú de la barra es lo más chico y lo último que se abre: sale primero.
    if (meMenuOpen()) { e.preventDefault(); toggleMeMenu(false); return; }
    // El perfil está por encima del dock, así que se cierra primero.
    if (state.profileOpen) { e.preventDefault(); closeProfile(); return; }
    // El dock antes que el panel: es lo último que se abrió y lo que está más
    // encima. Cerrarlo además devuelve el foco al juego.
    if (state.friendsOpen) { e.preventDefault(); setFriendsOpen(false); return; }
    // Con el velo puesto no hay nada abajo con lo que interactuar: Escape es la
    // misma salida que el botón «Cancelar».
    if (isLoadingVisible()) { e.preventDefault(); cancelConnecting(); return; }
    if (state.view !== 'play') { e.preventDefault(); closePanel(); return; }
    // Última red: si quedaste en pantalla completa sin barra, Escape te saca.
    if ($('#app').dataset.fullscreen === 'true') {
      e.preventDefault();
      tvm.window.exitFullscreen();
    }
  }
  if (e.key === 'F11') {
    e.preventDefault();
    tvm.window.toggleFullscreen();
  }

  /*
   * Ctrl +, Ctrl - y Ctrl 0 zoomean LA CANCHA, no esta ventana.
   *
   * Acá sólo llegan cuando el foco está en la interfaz —la barra, un panel, el
   * buscador de salas—; jugando las agarra el preload del juego. Que hagan lo
   * mismo en los dos lados es todo el punto: si no, el atajo funcionaría o no
   * según dónde hubieras hecho clic por última vez.
   *
   * La tabla de teclas es la misma que la de `zoomAction` en game-preload.js;
   * está explicada allá.
   */
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    const zoom = gameZoomAction(e);
    if (zoom) {
      e.preventDefault();
      tvm.game.zoom(zoom);
    }
    // Las pestañas de juego, con las teclas de cualquier navegador. Acá no hay
    // partido que las confunda; adentro del juego son con Alt (ver `onTabKey`).
    const key = String(e.key || '').toLowerCase();
    const tab = key === 't' ? 'new' : key === 'w' ? 'close' : key === 'tab' ? (e.shiftKey ? 'prev' : 'next') : null;
    if (tab) {
      e.preventDefault();
      onTabKey(tab);
    }
  }
  // Y las mismas que adentro del juego, para que el atajo no dependa de dónde
  // quedó el foco: Alt+T, Alt+W, Alt+1…4.
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const code = String(e.code || '');
    const tab = code === 'KeyT' ? 'new' : code === 'KeyW' ? 'close' : /^(Digit|Numpad)[1-4]$/.test(code) ? `go:${code.slice(-1)}` : null;
    if (tab) {
      e.preventDefault();
      onTabKey(tab);
    }
  }
});

function gameZoomAction(e) {
  if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd' || e.code === 'Equal') return 'in';
  if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' || e.code === 'Minus') return 'out';
  if (e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0') return 'reset';
  return null;
}


$$('[data-win]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.win;
    if (action === 'minimize') tvm.window.minimize();
    if (action === 'maximize') tvm.window.maximize();
    if (action === 'close') tvm.window.close();
  });
});

$('#btnFullscreen').addEventListener('click', () => tvm.window.toggleFullscreen());

function setTopbarCollapsed(collapsed) {
  const app = $('#app');
  const hideButton = $('#btnTopbarToggle');
  const showButton = $('#btnTopbarReveal');
  app.dataset.topbarCollapsed = String(collapsed);
  hideButton.setAttribute('aria-expanded', String(!collapsed));
  showButton.hidden = !collapsed;
  showButton.setAttribute('aria-expanded', String(!collapsed));
}

$('#btnTopbarToggle').addEventListener('click', () => setTopbarCollapsed(true));
$('#btnTopbarReveal').addEventListener('click', () => {
  setTopbarCollapsed(false);
  $('#btnTopbarToggle').focus();
});

/* Sin foco no hay nadie mirando: se frenan las animaciones decorativas. */
const setFocus = (on) => { document.documentElement.dataset.focus = on ? 'on' : 'off'; };
window.addEventListener('focus', () => setFocus(true));
window.addEventListener('blur', () => setFocus(false));
setFocus(document.hasFocus());

/* ══════════════════════════════════════════════════════════
   Arranque
   ══════════════════════════════════════════════════════════ */
/* ── Líneas y tamaños ───────────────────────────────────────────────────────
 * Multiplicadores sobre lo que dibuja HaxBall (100% = como viene). Se aplican
 * en la pantalla de cada uno, así que no afectan a nadie más.
 */
const VISUAL_LINES = [
  { key: 'pitchLine', label: 'visual.pitchLine', min: 0.3, max: 4 },
  { key: 'discLine', label: 'visual.discLine', min: 0.3, max: 4 },
  { key: 'ballLine', label: 'visual.ballLine', min: 0.3, max: 4 }
];
const VISUAL_SIZES = [
  { key: 'discSize', label: 'visual.discSize', min: 0.6, max: 1.6 },
  { key: 'ballSize', label: 'visual.ballSize', min: 0.6, max: 1.6 }
];

function renderVisual() {
  const cfg = state.config.visual || {};
  const build = (host, items) => {
    host.replaceChildren();
    for (const item of items) {
      const value = Number(cfg[item.key]) || 1;
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<div class="row__text"><span class="row__label"></span></div>' +
        '<div class="row__ctl"><input type="range" step="0.05" /><b class="row__val"></b></div>';
      row.querySelector('.row__label').textContent = t(item.label);
      const input = row.querySelector('input');
      const out = row.querySelector('.row__val');
      input.min = item.min;
      input.max = item.max;
      input.value = value;
      out.textContent = `${Math.round(value * 100)}%`;
      syncRangeFill(input);
      input.addEventListener('input', () => {
        syncRangeFill(input);
        out.textContent = `${Math.round(Number(input.value) * 100)}%`;
      });
      input.addEventListener('change', () => patchConfig({ visual: { [item.key]: Number(input.value) } }));
      host.append(row);
    }
  };
  build($('#visualLines'), VISUAL_LINES);
  build($('#visualSizes'), VISUAL_SIZES);
  $('#visualFlatNote').hidden = !(state.config.perf && state.config.perf.flatGraphics);
}

$('#visualReset').addEventListener('click', async () => {
  await patchConfig({ visual: { pitchLine: 1, discLine: 1, ballLine: 1, ballSize: 1, discSize: 1 } });
  renderVisual();
});

/* ── Personalización visual ─────────────────────────────────────────────────
 * Todo vive en `config.visual` y sólo se ve en esta pantalla. Cada fila se arma
 * desde una tabla: agregar un ajuste es agregar una línea.
 */
/** Guarda y vuelve a pintar: estas filas dependen unas de otras. */
async function lookPatch(patch) {
  const next = await patchConfig(patch);
  renderLook();
  return next;
}

const FONT_OPTIONS = [
  ['default', 'look.font.default'], ['outfit', 'look.font.outfit'], ['mono', 'look.font.mono'],
  ['serif', 'look.font.serif'], ['round', 'look.font.round'], ['impact', 'look.font.impact']
];

const LOOK_SECTIONS = {
  lookPitch: [
    { key: 'texture', type: 'select', label: 'look.texture', options: [['none', 'look.opt.none'], ['wood', 'look.tex.wood'], ['ice', 'look.tex.ice'], ['sand', 'look.tex.sand'], ['concrete', 'look.tex.concrete'], ['night', 'look.tex.night'], ['clay', 'look.tex.clay'], ['checker', 'look.tex.checker'], ['carbon', 'look.tex.carbon'], ['marble', 'look.tex.marble'], ['hex', 'look.tex.hex'], ['stars', 'look.tex.stars'], ['brick', 'look.tex.brick'], ['snow', 'look.tex.snow'], ['neon', 'look.tex.neon'], ['lava', 'look.tex.lava'], ['waves', 'look.tex.waves']] },
    { key: 'pitchLight', type: 'select', label: 'look.pitchLight', desc: 'look.pitchLightHelp', options: [['none', 'look.opt.none'], ['vignette', 'look.light.vignette'], ['spot', 'look.light.spot'], ['corners', 'look.light.corners']] },
    { key: 'crest', type: 'switch', label: 'look.crest', desc: 'look.crestHelp' },
    { key: 'crestOpacity', type: 'range', label: 'look.crestOpacity', min: 0.05, max: 0.6, step: 0.01, showIf: (v) => v.crest },
    { key: 'crestSize', type: 'range', label: 'look.crestSize', min: 0.2, max: 1, step: 0.01, showIf: (v) => v.crest },
    { key: 'lineColor', type: 'color', label: 'look.lineColor', desc: 'look.lineColorHelp' },
    { key: 'lineGlow', type: 'switch', label: 'look.lineGlow', desc: 'look.lineGlowHelp' },
    { key: 'postColor', type: 'color', label: 'look.postColor' }
  ],
  lookDiscs: [
    { key: 'discStyle', type: 'select', label: 'look.discStyle', options: [['default', 'look.opt.none'], ['sphere', 'look.ds.sphere'], ['glass', 'look.ds.glass'], ['neon', 'look.ds.neon'], ['metal', 'look.ds.metal'], ['bubble', 'look.ds.bubble'], ['target', 'look.ds.target'], ['stripes', 'look.ds.stripes'], ['gem', 'look.ds.gem'], ['cartoon', 'look.ds.cartoon'], ['dots', 'look.ds.dots']] },
    { key: 'softShadows', type: 'switch', label: 'look.softShadows', desc: 'look.softShadowsHelp' },
    { key: 'discOutline', type: 'color', label: 'look.discOutline' },
    { key: 'ballStyle', type: 'select', label: 'look.ballStyle', options: [['default', 'look.opt.none'], ['soccer', 'look.bs.soccer'], ['neon', 'look.bs.neon'], ['gold', 'look.bs.gold'], ['beach', 'look.bs.beach'], ['eight', 'look.bs.eight'], ['star', 'look.bs.star']] },
    { key: 'ballColor', type: 'color', label: 'look.ballColor' },
    { key: 'ballOutline', type: 'color', label: 'look.ballOutline' },
    { key: 'ringStyle', type: 'select', label: 'look.ringStyle', desc: 'look.ringHelp', options: [['default', 'look.opt.simple'], ['double', 'look.ring.double'], ['dashed', 'look.ring.dashed'], ['crown', 'look.ring.crown'], ['glow', 'look.ring.glow'], ['dots', 'look.ring.dots'], ['arrow', 'look.ring.arrow']] },
    { key: 'ringColor', type: 'color', label: 'look.ringColor' },
    { key: 'selfTrail', type: 'switch', label: 'look.selfTrail', desc: 'look.selfTrailHelp' },
    { key: 'selfTrailColor', type: 'color', label: 'look.selfTrailColor', showIf: (v) => v.selfTrail }
  ],
  lookNames: [
    { key: 'nameScale', type: 'range', label: 'look.nameScale', min: 0.6, max: 2, step: 0.05 },
    { key: 'nameColor', type: 'color', label: 'look.nameColor' },
    { key: 'nameOutline', type: 'switch', label: 'look.nameOutline' },
    { key: 'nameFont', type: 'select', label: 'look.nameFont', options: FONT_OPTIONS }
  ],
  lookChat: [
    { key: 'chatScale', type: 'range', label: 'look.chatScale', min: 0.7, max: 1.8, step: 0.05 },
    { key: 'chatBg', type: 'range', label: 'look.chatBg', min: 0, max: 0.9, step: 0.05, original: -1 },
    { key: 'chatOpacity', type: 'range', label: 'look.chatOpacity', min: 0.15, max: 1, step: 0.05 },
    { key: 'chatFont', type: 'select', label: 'look.chatFont', options: FONT_OPTIONS }
  ],
  lookSound: [
  ],
  lookStats: [
    { key: 'statsStyle', type: 'select', label: 'look.statsStyle', options: [['default', 'look.opt.none'], ['minimal', 'look.stats.minimal'], ['glass', 'look.stats.glass'], ['solid', 'look.stats.solid'], ['pill', 'look.stats.pill']] },
    { key: 'statsOpacity', type: 'range', label: 'look.statsOpacity', min: 0.1, max: 1, step: 0.05 }
  ],
  lookMenu: [
    { key: 'menuBg', type: 'select', label: 'look.menuBg', options: [['none', 'look.opt.none'], ['club', 'look.menu.club'], ['aurora', 'look.menu.aurora'], ['grid', 'look.menu.grid'], ['sunset', 'look.menu.sunset'], ['stripes', 'look.menu.stripes'], ['noir', 'look.menu.noir'], ['field', 'look.menu.field'], ['dots', 'look.menu.dots'], ['neon', 'look.menu.neon'], ['waves', 'look.menu.waves']] }
  ]
};

const LOOK_DEFAULTS = {
  texture: 'none', pitchLight: 'none', softShadows: false, crest: false, crestOpacity: 0.18, crestSize: 0.45, lineColor: '', postColor: '',
  discStyle: 'default', ballStyle: 'default', ballColor: '', lineGlow: false, discOutline: '', ballOutline: '', ringStyle: 'default', ringColor: '',
  selfTrail: false, selfTrailColor: '', nameScale: 1, nameColor: '', nameOutline: false, nameFont: 'default',
  chatScale: 1, chatBg: -1, chatFont: 'default', chatOpacity: 1, statsOpacity: 1, statsStyle: 'default', menuBg: 'none'
};

function lookValue(key) {
  const v = state.config.visual || {};
  return v[key] === undefined ? LOOK_DEFAULTS[key] : v[key];
}

function lookRow(item) {
  const value = lookValue(item.key);
  let control;
  if (item.type === 'switch') {
    const toggle = document.createElement('button');
    toggle.className = 'switch' + (value ? ' is-on' : '');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(!!value));
    toggle.addEventListener('click', () => lookPatch({ visual: { [item.key]: !lookValue(item.key) } }));
    return settingRow({ label: t(item.label), description: item.desc ? t(item.desc) : '', control: toggle });
  }
  if (item.type === 'select') {
    control = document.createElement('select');
    for (const [val, label] of item.options) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = t(label);
      control.append(o);
    }
    control.value = value;
    control.addEventListener('change', () => lookPatch({ visual: { [item.key]: control.value } }));
    return settingRow({ label: t(item.label), description: item.desc ? t(item.desc) : '', control });
  }
  if (item.type === 'color') {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = value || '#888888';
    input.classList.toggle('is-unset', !value);
    input.addEventListener('change', () => lookPatch({ visual: { [item.key]: input.value } }));
    const clear = document.createElement('button');
    clear.className = 'btn btn--ghost btn--sm';
    clear.type = 'button';
    clear.textContent = value ? t('look.remove') : t('look.original');
    clear.disabled = !value;
    clear.addEventListener('click', () => lookPatch({ visual: { [item.key]: '' } }));
    return settingRow({ label: t(item.label), description: item.desc ? t(item.desc) : '', control: [input, clear] });
  }
  // range
  const input = document.createElement('input');
  input.type = 'range';
  input.min = item.min;
  input.max = item.max;
  input.step = item.step;
  const unset = item.original !== undefined && value === item.original;
  input.value = unset ? item.min : value;
  const out = document.createElement('b');
  out.className = 'row__val';
  out.textContent = unset ? t('look.original') : `${Math.round(Number(value) * 100)}%`;
  syncRangeFill(input);
  input.addEventListener('input', () => {
    syncRangeFill(input);
    out.textContent = `${Math.round(Number(input.value) * 100)}%`;
  });
  input.addEventListener('change', () => lookPatch({ visual: { [item.key]: Number(input.value) } }));
  const nodes = [input, out];
  if (item.original !== undefined) {
    const reset = document.createElement('button');
    reset.className = 'btn btn--ghost btn--sm';
    reset.type = 'button';
    reset.textContent = t('look.original');
    reset.disabled = unset;
    reset.addEventListener('click', () => lookPatch({ visual: { [item.key]: item.original } }));
    nodes.push(reset);
  }
  return settingRow({ label: t(item.label), description: item.desc ? t(item.desc) : '', control: nodes });
}

function renderLookSections() {
  const values = state.config.visual || {};
  for (const [hostId, items] of Object.entries(LOOK_SECTIONS)) {
    const host = $(`#${hostId}`);
    if (!host) continue;
    host.replaceChildren();
    for (const item of items) {
      if (item.showIf && !item.showIf({ ...LOOK_DEFAULTS, ...values })) continue;
      host.append(lookRow(item));
    }
  }
  const app = $('#app');
  if (app) app.dataset.menubg = lookValue('menuBg') || 'none';
}

/* Looks guardados: una foto de los ajustes visuales, con nombre. */
const LOOK_PITCH_KEYS = ['ball3d', 'selfRing', 'teamRings', 'goalFlash', 'goalShake', 'goalClub', 'skin'];
const LOOK_MAX = 12;

function currentLookData() {
  const cfg = state.config;
  const pitch = {};
  for (const key of LOOK_PITCH_KEYS) if (cfg.pitch && cfg.pitch[key] !== undefined) pitch[key] = JSON.parse(JSON.stringify(cfg.pitch[key]));
  return { visual: { ...(cfg.visual || {}) }, pitch };
}

function renderLooks() {
  const host = $('#lookList');
  if (!host) return;
  host.replaceChildren();
  const saved = ((state.config.looks || {}).saved) || [];
  if (!saved.length) {
    const empty = document.createElement('p');
    empty.className = 'sec__desc';
    empty.textContent = t('looks.empty');
    host.append(empty);
    return;
  }
  for (const entry of saved) {
    const apply = document.createElement('button');
    apply.className = 'btn btn--ghost btn--sm';
    apply.type = 'button';
    apply.textContent = t('looks.apply');
    apply.addEventListener('click', async () => {
      await lookPatch(JSON.parse(JSON.stringify(entry.data || {})));
      toast(t('looks.applied', { name: entry.name }));
    });
    const del = document.createElement('button');
    del.className = 'btn btn--ghost btn--sm';
    del.type = 'button';
    del.textContent = t('looks.delete');
    del.addEventListener('click', () => lookPatch({ looks: { saved: saved.filter((x) => x.name !== entry.name) } }));
    host.append(settingRow({ label: entry.name, control: [apply, del] }));
  }
}

$('#lookSave').addEventListener('click', async () => {
  const input = $('#lookName');
  const name = input.value.trim().slice(0, 24);
  if (!name) { toast(t('looks.needName'), 'err'); return; }
  const saved = (((state.config.looks || {}).saved) || []).filter((x) => x.name !== name);
  if (saved.length >= LOOK_MAX) { toast(t('looks.full', { max: LOOK_MAX }), 'err'); return; }
  saved.push({ name, data: currentLookData() });
  await lookPatch({ looks: { saved } });
  input.value = '';
  toast(t('looks.saved', { name }));
});

function renderLook() {
  renderLookSections();
  renderLooks();
}

function renderAll() {
  window.i18n.applyStatic();
  renderPerf();
  renderVisual();
  renderLook();
  renderAspect();
  renderSettings();
  renderDiscord();
  renderUpdates();
  renderVip();
  renderNickCard();
  renderAuth();
}

async function boot() {
  const [config, schema, info, vars] = await Promise.all([
    tvm.config.get(), tvm.config.schema(), tvm.app.info(), tvm.theme.vars()
  ]);
  state.schema = schema;
  state.info = info;
  // El acento que cambia solo es de una sola sesión: la app siempre abre con el color del club.
  if (config.appearance && config.appearance.accentDrift) {
    config.appearance.accentDrift = false;
    tvm.config.set({ appearance: { accentDrift: false } }).catch(() => {});
  }
  applyConfig(config);
  applyThemeVars(vars);
  try {
    tvm.access.onChange(onAccess);
    onAccess(await tvm.access.status());
  } catch (e) { /* sin lista de acceso: la app abre normal */ }

  // Recién acá se sabe el idioma y la versión: hasta este punto la pantalla de
  // carga muestra el texto que trae el HTML.
  splashStep('splash.config');
  splashTip();
  $('#splashVersion').textContent = `v${info.version}`;

  $('#roomSort').value = state.sort;
  tvm.rooms.flags().then(applyFlags).catch(() => {});

  splashStep('splash.ui');
  renderAll();
  setView('play');
  mountGame();
  loadRooms();
  loadAuth();

  // Se deja para cuando el motor esté libre: no tiene que demorar el primer
  // dibujo, sólo llegar antes de que el usuario toque una pestaña.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warmPanel, { timeout: 2500 });
  else setTimeout(warmPanel, 600);

  // Pantalla de inicio al abrir la app. Queda armada detrás de la de carga, así
  // que cuando ésta se funde el apodo ya está pedido y no hay un paso vacío.
  showStart(null);
  applyDiscord();
  splashStep('splash.ready');

  tvm.config.onChange((next) => {
    applyConfig(next);
  });
  tvm.game.onSettingsChanged((patch) => {
    const groups = new Set(state.schema.game.filter(s => Object.hasOwnProperty.call(patch, s.id)).map(s => s.group));
    if (groups.has('chat')) renderAspect();
    for (const group of groups) {
      if (group === 'chat') continue;
      const selector = { sound: '#gameSound', video: '#gameVideo', net: '#gameNet' }[group];
      const host = selector && $(selector);
      if (host) renderGameSettings(host, group);
    }
  });
  tvm.theme.onVars(applyThemeVars);

  /* ── Resolución ────────────────────────────────────────────────────────
   *
   * La resolución que elige el jugador es la de LA CANCHA, no la de la ventana,
   * y se aplica siempre igual, en ventana o en pantalla completa: el iframe del
   * juego se dibuja a ese tamaño y se ESTIRA hasta llenar el escenario. Si la
   * proporción no coincide, se deforma — es lo que se pide con «1080x1080»: una
   * cancha cuadrada estirada a lo ancho, como el «stretched» de cualquier
   * shooter. Sólo cambia el iframe: los HUD del cliente no se deforman.
   *
   * La ventana no se toca. Antes en modo ventana se la redimensionaba para que
   * el escenario midiera exactamente eso, y no era lo que se quería: elegir
   * 1080x1080 daba una ventana cuadrada, no un juego estirado. El tamaño de la
   * ventana es del jugador (se recuerda entre sesiones, ver `window` en
   * main.js) y la resolución es del juego.
   *
   * El estirado lo hace el preload dentro del webview (`applyGameViewport` en
   * game-preload.js), contra el tamaño real del documento del juego: acá sólo
   * se le dice qué resolución. Si la pedida no entra en el escenario se baja en
   * bloque, conservando la proporción, para no pedirle a Chromium una
   * superficie más grande que lo que se ve.                                  */

  function wantedResolution() {
    const [w, h] = String(state.config.general.resolution || '').split('x').map(Number);
    if (!(w > 0 && h > 0)) return null;
    const limit = displayResolutionLimit();
    // Una superficie más grande que el monitor no aporta detalle: sólo hace que
    // Chromium componga más píxeles y luego los reduzca. En drivers viejos era
    // además el camino al cuadro negro/duplicado de las transiciones.
    if (!limit || (w <= limit.w && h <= limit.h)) return { w, h };
    const scale = Math.min(limit.w / w, limit.h / h);
    return {
      w: Math.max(1, Math.round(w * scale)),
      h: Math.max(1, Math.round(h * scale))
    };
  }

  /*
   * ── Quién manda sobre «estoy en pantalla completa» ─────────────────────
   *
   * Uno solo, y son los eventos de la ventana.
   *
   * Antes cada `resize` volvía a preguntar (`tvm.window.state()`), y ahí hay una
   * trampa que el main ya documenta del otro lado (ver `emitState`): en Windows,
   * con la ventana sin marco, `isFullScreen()` sigue contestando `true` mientras
   * se está SALIENDO de pantalla completa. Salir dispara un puñado de `resize`,
   * así que la última respuesta en llegar era la vieja y ganaba.
   *
   * De ahí salía el cuelgue: salías de pantalla completa y la app se quedaba
   * creyendo que seguías adentro. La barra de arriba no volvía —ahí se esconde
   * sola—, el juego se quedaba escalado contra un escenario que ya no medía eso
   * (estirado y cortado contra el borde) y encima sin el foco, así que no
   * respondía a ninguna tecla. Se veía exactamente como un juego congelado.
   *
   * `enter-full-screen` / `leave-full-screen` sí dicen a qué estado se pasó. Se
   * guarda ESO, y el `resize` reacomoda con lo último que se sabe en vez de
   * volver a preguntar.
   */
  let fullscreenNow = false;
  let lastViewportRequest = '';

  /**
   * Nunca se transforma el `<webview>` entero desde acá: el cartel de música,
   * las teclas y otros overlays viven dentro de él y una escala no uniforme los
   * estiraría. El webview mide siempre el escenario (CSS) y el estirado pasa
   * adentro, sobre el iframe del juego. Va a TODAS las pestañas: el proceso
   * principal lo reparte y lo repite en cada carga del juego.
   */
  function applyViewportLayout(fullscreen) {
    $('#app').dataset.fullscreen = String(fullscreen);
    const res = wantedResolution();
    const layout = {
      enabled: !!res,
      width: res ? res.w : 16,
      height: res ? res.h : 9
    };
    const requestKey = `${layout.enabled}|${layout.width}|${layout.height}`;
    // El iframe recibe su propio `resize`; no hace falta bombardear el proceso
    // principal durante cada cuadro de la animación de pantalla completa.
    if (requestKey !== lastViewportRequest) {
      lastViewportRequest = requestKey;
      tvm.game.viewport(layout);
    }
  }

  /** Se cambió la resolución en Ajustes: se reestira la cancha, y nada más. */
  async function applyResolution() {
    applyViewportLayout(fullscreenNow);
  }

  /**
   * El único lugar donde `fullscreenNow` cambia de valor.
   *
   * @param {boolean} fullscreen  lo que dice el evento, no lo que contesta la ventana
   */
  function onWindowState(next) {
    const fullscreen = !!(next && next.fullscreen);
    if (next && next.display) {
      const antes = state.display && state.display.id;
      const distinta = antes !== next.display.id
        || !state.display
        || state.display.size.width !== next.display.size.width
        || state.display.size.height !== next.display.size.height;
      state.display = next.display;
      syncResolutionOptions();
      /*
       * Cambiar de monitor o cambiar la resolución de Windows con el cliente
       * abierto puede dejar guardado un tamaño que ya no existe. Se corrige una
       * sola vez, cuando la pantalla de verdad cambió — no en cada `win:state`,
       * que llega también al mover la ventana.
       */
      if (distinta) reconcileResolution();
    }
    const changed = fullscreenNow !== fullscreen;
    fullscreenNow = fullscreen;
    applyViewportLayout(fullscreen);
    if (!changed) return;

    /*
     * El aviso llega ANTES de que la ventana cambie de tamaño, así que la
     * medida de `.stage` que acaba de usarse todavía es la de antes y la escala
     * sale contra el escenario viejo. Se reacomoda en el cuadro siguiente, ya
     * con la maqueta nueva. Son dos rAF y no uno: el primero es el cuadro en el
     * que Chromium aplica el cambio de tamaño, el segundo es el primero que se
     * puede medir de verdad.
     */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => applyViewportLayout(fullscreenNow));
    });

    // F11 se aprieta jugando: sin esto las teclas se quedan en el documento de
    // la app y la cancha no responde. Ver `focusGame`.
    focusGame();
  }

  tvm.window.onState(onWindowState);
  tvm.window.state().then(onWindowState);
  // El `resize` no vuelve a preguntar: reacomoda con lo último que se sabe.
  window.addEventListener('resize', () => applyViewportLayout(fullscreenNow));

  // La resolución se aplica de entrada: el estirado es del juego, no de la
  // ventana, así que da lo mismo cómo haya quedado ésta.
  applyResolution();
  state.applyResolution = applyResolution;

  tvm.game.onView((kind, meta) => handleViewEvent(kind, meta));

  tvm.game.onRoomName((name, meta) => {
    const { s, active } = tabBucket(meta);
    s.gameRoomName = name || null;
    if (active) {
      pushPresence();
      // Si la sala ya tiene nombre, ya estamos adentro: el velo sobra.
      if (name && state.stage === 'game') { hideLoading(); dismissToast(state.joiningToast); }
    }
    renderTabs();
  });
  tvm.game.onThemed(() => {
    state.themed = true;
    // El tema confirma que el juego ya tiene un documento visible. No esperes
    // el evento de vista: puede perderse y dejar tapada una sala ya conectada.
    if (state.stage === 'game') hideLoading();
  });
  
  /* ── Resumen del partido y cartel de gol ───────────────────────────────
   *
   * Los goles llegan del preload del juego, que es el que ve la cancha, ya con
   * el autor y la asistencia resueltos (ver `game-preload.js`). Acá sólo se
   * guardan y se dibujan.
   *
   * Hay dos resúmenes, y no es lo mismo uno que otro:
   *
   *   · En vivo se arma con lo que va pasando, gol por gol. Es lo único que se
   *     puede hacer: el partido todavía no terminó.
   *   · En un replay se analiza la GRABACIÓN ENTERA de una sola vez, sin
   *     reproducirla. El preload la simula sin dibujarla (ver `analyzeReplay`),
   *     así que el resumen está completo apenas se abre el panel, no importa
   *     hasta dónde se haya mirado. Encima trae los toques de cada uno, que es
   *     lo que permite desempatar el MVP.                                    */

  /** Los goles del partido que se está viendo, en orden. */
  state.liveGoals = [];
  /** El análisis de la grabación abierta, si ya se hizo. */
  state.summary = null;
  state.summaryError = null;
  state.analyzing = false;
  // Para el cambio de pestaña, que vive afuera de `boot()` y repone el resumen
  // de la que entra.
  state.repaintStats = repaintStats;

  tvm.game.onMatchStart((_p, meta) => {
    const { s, active } = tabBucket(meta);
    s.liveGoals = [];
    // El mapa era del partido anterior: al arrancar otro deja de tener sentido.
    s.heatmap = null;
    s.matchCard = null;
    if (active) repaintStats();
  });

  /*
   * Las estadísticas se cierran cuando el partido TERMINA, no gol por gol.
   *
   * Así lo que queda contado es un partido jugado hasta el final: si te vas a la
   * mitad, si te echan o si se cae la sala, no suma nada — y no queda un partido
   * a medias con tres goles tuyos adentro. El precio es que un cierre a lo bruto
   * (cerrar la app en medio de un partido) también se pierde, que es exactamente
   * lo que se quiere.
   */
  tvm.game.onMatchEnd((_score, meta) => {
    // Sólo lo que jugaste: una grabación no cuenta ni cuando termina, y un
    // partido que terminó en una pestaña de atrás tampoco — no estabas ahí.
    const { s, active } = tabBucket(meta);
    if (!active || s.gameView !== 'game') return;
    addStats({ matches: 1, ...myShare(state.liveGoals) });
  });

  /*
   * El mapa de calor del partido.
   *
   * Llega una sola vez, al terminar, y se guarda hasta que arranque el
   * siguiente: el resumen se mira DESPUÉS del pitazo, así que borrarlo en el
   * momento en que llega sería borrarlo justo antes de que alguien lo abra.
   */
  tvm.game.onHeatmap((payload, meta) => {
    const { s, active } = tabBucket(meta);
    const p = payload || {};
    s.heatmap = p.heat && p.heat.url ? p.heat : null;
    s.matchCard = p.card && p.card.players && p.card.players.length ? p.card : null;
    if (active) repaintStats();
  });

  /**
   * Lo tuyo de este partido: goles, asistencias y goles en contra.
   *
   * El único hilo entre "el que hizo el gol" y "vos" es el nombre: HaxBall no
   * tiene identidad en la cancha. Si dos jugadores usan el mismo nick en la
   * misma sala, el cliente no los puede distinguir — y ellos tampoco.
   */
  function myShare(goals) {
    const me = (state.config.general.nickname || '').trim();
    const share = { goals: 0, assists: 0, ownGoals: 0 };
    if (!me) return share;

    for (const goal of goals) {
      if (goal.scorer === me) share[goal.own ? 'ownGoals' : 'goals']++;
      if (goal.assist === me) share.assists++;
    }
    return share;
  }

  tvm.game.onGoal((goal, meta) => {
    const team = goal.team === 'Red' ? 'Red' : 'Blue';
    const { s, active } = tabBucket(meta);
    s.liveGoals.push({ ...goal, team });
    // El gol de una pestaña de atrás se anota para su resumen. El cartel ya no
    // existe: el efecto del gol (con goleador y asistidor) vive dentro del juego.
    if (!active) return;
    repaintStats();
  });

  /**
   * Analiza la grabación abierta de punta a punta. El juego se queda quieto
   * mientras dura —es una simulación de miles de cuadros de una sentada—, pero
   * este panel vive en otro proceso, así que el «Analizando…» se ve igual.
   */
  async function runAnalysis() {
    if (state.analyzing) return;
    state.analyzing = true;
    state.summaryError = null;
    repaintStats();

    try {
      const summary = await tvm.replays.analyze();
      state.summary = summary && summary.ok ? summary : null;
      state.summaryError = state.summary ? null : (summary && summary.reason) || 'No se pudo analizar.';
      // Un .hbr2 es un archivo cerrado: lo que dio hoy va a dar siempre. Se
      // guarda para no volver a simular nunca esta grabación.
      if (state.summary && state.replayPath) {
        tvm.replays.archive(state.replayPath, state.summary).catch(() => {});
      }
    } catch (err) {
      state.summary = null;
      state.summaryError = err.message;
    } finally {
      state.analyzing = false;
      repaintStats();
    }
  }

  /*
   * ── El análisis en segundo plano ───────────────────────────────────────
   *
   * Antes había que pedirlo: abrir el panel, o apretar «Resumen». Ahora se hace
   * solo apenas se abre una grabación, así que para cuando el usuario quiere
   * ver los números ya están.
   *
   * Y si esa grabación ya se analizó alguna vez, no se simula nada: el
   * resultado sale del archivo en disco (ver `replay-archive.js`). Eso importa
   * más de lo que parece — la simulación congela el juego un par de segundos, y
   * volver a pagarla cada vez que uno reabre la misma grabación es el tipo de
   * cosa que hace que una función buena se sienta pesada.
   */

  /*
   * El reproductor se publica cuando arranca su control de velocidad, no cuando
   * aparece la pantalla. Esperar un toque evita el primer intento fallido.
   */
  const ANALYZE_DELAY_MS = 1500;
  let analyzeTimer = 0;

  async function autoAnalyze() {
    if (state.gameView !== 'replay' || state.summary || state.analyzing) return;

    if (state.replayPath) {
      const saved = await tvm.replays.archived(state.replayPath).catch(() => null);
      if (saved) {
        state.summary = saved;
        state.summaryError = null;
        repaintStats();
        return;
      }
    }
    // El usuario puede haber salido de la grabación mientras se leía el archivo.
    if (state.gameView === 'replay') runAnalysis();
  }

  function scheduleAutoAnalyze() {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(() => autoAnalyze(), ANALYZE_DELAY_MS);
  }

  /**
   * La tabla de jugadores y el MVP, a partir de los goles.
   *
   * El puntaje es de los que se pueden comprobar a ojo con la lista de goles de
   * acá abajo, y por eso es tan simple: 3 por gol, 2 por asistencia, −2 en
   * contra. Los toques —que sólo existen cuando se analizó una grabación
   * entera— no suman: desempatan, para que entre dos con los mismos números
   * quede arriba el que más jugó la pelota.
   */
  function summarize(goals, roster) {
    const rows = new Map();
    const rowFor = (name, team) => {
      let row = rows.get(name);
      if (!row) {
        row = { name, team: team || '', goals: 0, assists: 0, own: 0, touches: 0, points: 0 };
        rows.set(name, row);
      } else if (team && !row.team) {
        row.team = team;
      }
      return row;
    };

    for (const goal of goals) {
      // En un gol en contra el autor es del equipo que NO sumó: el suyo es el
      // que dice el propio gol, no el del marcador.
      if (goal.scorer) {
        const row = rowFor(goal.scorer, goal.scorerTeam || goal.team);
        if (goal.own) row.own++;
        else row.goals++;
      }
      if (goal.assist) rowFor(goal.assist, goal.team).assists++;
    }
    for (const player of roster) rowFor(player.name, player.team).touches = player.touches || 0;

    const list = [...rows.values()];
    for (const row of list) row.points = row.goals * 3 + row.assists * 2 - row.own * 2;
    list.sort((a, b) =>
      b.points - a.points ||
      b.goals - a.goals ||
      b.assists - a.assists ||
      b.touches - a.touches ||
      a.name.localeCompare(b.name));

    // Un MVP que no hizo nada no es un MVP.
    return { list, mvp: list.find((row) => row.points > 0) || null };
  }

  function repaintStats() {
    const panel = $('#tvmStatsPanel');
    if (panel.hidden) return;

    const isReplay = state.gameView === 'replay';
    const summary = isReplay ? state.summary : null;
    const goals = summary ? summary.goals : state.liveGoals;
    const { list, mvp } = summarize(goals, summary ? summary.players : []);
    // Mientras se analiza no hay nada firme que mostrar: lo de antes ya no vale
    // y lo nuevo todavía no está. Si el análisis falla, en cambio, sí se muestra
    // lo que se vio en vivo: es menos que el resumen completo, pero es cierto.
    const busy = state.analyzing;

    $('#statsTitle').textContent = t(isReplay ? 'stats.titleReplay' : 'stats.title');
    $('#statsAnalyze').hidden = !isReplay || state.analyzing;
    setButtonLabel($('#statsAnalyze'), t(state.summary ? 'stats.again' : 'stats.analyze'));

    // El marcador es la cuenta de goles, no el último que llegó: así también da
    // el total de una grabación con varios partidos seguidos.
    $('#scoreRed').textContent = busy ? '—' : String(goals.filter((g) => g.team === 'Red').length);
    $('#scoreBlue').textContent = busy ? '—' : String(goals.filter((g) => g.team === 'Blue').length);

    $('#statsSub').textContent = statsSubtitle(summary, goals);
    paintStatsNote(summary, goals);

    $('#statsMvp').hidden = busy || !mvp;
    if (mvp && !busy) {
      $('#statsMvpName').textContent = mvp.name;
      // Los toques sólo existen si se analizó la grabación: en vivo no se cuentan
      // y poner «0 toques» sería mentir.
      $('#statsMvpLine').textContent = [
        t('stats.mvpLine', { goals: mvp.goals, assists: mvp.assists }),
        mvp.touches ? t('stats.mvpTouches', { touches: mvp.touches }) : ''
      ].filter(Boolean).join(' · ');
    }

    $('#statsPlayersBlock').hidden = busy || !list.length;
    if (!busy) paintStatsPlayers(list);

    $('#statsGoalsBlock').hidden = busy || !goals.length;
    if (!busy) paintStatsGoals(goals, summary ? summary.matches : null);
    // Saltar a un gol necesita saber en qué milisegundo de la GRABACIÓN entró,
    // y eso sólo lo sabe el análisis. En vivo no hay a dónde saltar.
    $('#statsReel').hidden = busy || !seekableGoals(goals).length;

    paintHeatmap(busy);
    paintMatchCard(busy);
  }

  /**
   * La ficha del partido: posesión, pases, distancia y el remate más fuerte.
   *
   * Sale del mismo mensaje que el mapa y por la misma razón: los números los
   * cuenta el proceso del juego, que es el único que ve la cancha cuadro a
   * cuadro. Acá sólo se muestran.
   */
  function paintMatchCard(busy) {
    /*
     * En una grabación la ficha sale del análisis, no del partido en vivo: son
     * los números de lo que se está mirando. Fuera de la grabación, la del
     * último partido jugado.
     */
    const card = state.gameView === 'replay'
      ? (state.summary && state.summary.card)
      : state.matchCard;
    const block = $('#statsCardBlock');
    block.hidden = busy || !card || !card.players || !card.players.length;
    if (block.hidden) return;

    const rojo = (card.teams && card.teams.Red) || 0;
    const azul = (card.teams && card.teams.Blue) || 0;
    const suma = rojo + azul;
    // Se normaliza a 100: la suma de las posesiones individuales puede quedar
    // un punto corta por los redondeos de cada jugador.
    const pRojo = suma ? Math.round((rojo / suma) * 100) : 50;
    $('#cardPossRed').style.width = `${pRojo}%`;
    $('#cardPossRedN').textContent = `${pRojo}%`;
    $('#cardPossBlueN').textContent = `${100 - pRojo}%`;

    const cuerpo = $('#cardRows');
    cuerpo.replaceChildren();
    for (const fila of card.players) {
      const tr = document.createElement('tr');
      if (fila.team === 'Red' || fila.team === 'Blue') tr.className = `is-${fila.team.toLowerCase()}`;
      for (const valor of [
        fila.name,
        `${fila.possession}%`,
        String(fila.passes),
        String(fila.turnovers),
        fila.distance ? `${(fila.distance / 1000).toFixed(2)} km` : '—',
        fila.topShot ? `${fila.topShot} km/h` : '—'
      ]) {
        const td = document.createElement('td');
        td.textContent = valor;
        tr.append(td);
      }
      cuerpo.append(tr);
    }
  }

  /**
   * El mapa de calor del partido.
   *
   * Llega como PNG chiquito —un píxel por celda— y se agranda por CSS: el
   * suavizado del navegador es justamente lo que convierte los cuadraditos en
   * manchas. La proporción sale de las medidas de CANCHA que manda el juego, no
   * del tamaño del PNG, para que no quede estirado.
   */
  function paintHeatmap(busy) {
    // Mismo criterio que la ficha: en una grabación, el del análisis.
    const img = state.gameView === 'replay'
      ? (state.summary && state.summary.heat)
      : state.heatmap;
    const block = $('#statsHeatBlock');
    block.hidden = busy || !img || !img.url;
    if (block.hidden) return;

    // La imagen se crea la primera vez y después se reusa: así el documento
    // nunca tiene un <img> sin src, y no hay forma de que se vea rota.
    const caja = $('#statsHeatBox');
    let el = caja.firstElementChild;
    if (!el) {
      el = document.createElement('img');
      el.alt = '';
      caja.append(el);
    }
    if (el.src !== img.url) el.src = img.url;
    el.style.aspectRatio = img.w && img.h ? `${img.w} / ${img.h}` : '2 / 1';
  }

  function statsSubtitle(summary, goals) {
    if (state.analyzing) return t('stats.analyzing');
    // Sin análisis —en vivo, o porque falló— lo que hay es lo que se vio pasar.
    if (!summary) return t('stats.live');
    const clock = formatDuration(summary.seconds);
    return summary.matches.length > 1
      ? t('stats.recapMatches', { goals: goals.length, matches: summary.matches.length, clock })
      : t('stats.recap', { goals: goals.length, clock });
  }

  /** El renglón que explica qué está pasando cuando el panel no es un resumen. */
  function paintStatsNote(summary, goals) {
    const note = $('#statsNote');
    let text = '';
    let kind = '';

    if (state.analyzing) text = t('stats.analyzingNote');
    else if (state.summaryError) { text = state.summaryError; kind = 'is-bad'; }
    else if (summary && summary.partial) { text = t('stats.partial'); kind = 'is-warn'; }
    else if (!goals.length) text = t(summary ? 'stats.emptyReplay' : 'stats.empty');
    // Sin el parche del bundle los goles llegan sin autor: se dice, en vez de
    // dejar una tabla vacía sin explicación.
    else if (goals.some((goal) => !goal.scorer)) { text = t('stats.noPatch'); kind = 'is-warn'; }

    note.hidden = !text;
    note.textContent = text;
    note.className = `stats-panel__note${kind ? ` ${kind}` : ''}`;
  }

  function paintStatsPlayers(list) {
    $('#statsPlayers').replaceChildren(...list.map((row) => {
      const tr = document.createElement('tr');

      const cell = document.createElement('td');
      const who = document.createElement('div');
      who.className = 'stats-table__who';
      who.append(teamDot(row.team), statsSpan('stats-table__name', row.name));
      who.title = row.name;
      if (row.own) {
        who.append(statsSpan('stats-table__own',
          row.own > 1 ? `${t('stats.own')} ×${row.own}` : t('stats.own')));
      }
      cell.append(who);
      tr.append(cell);

      for (const value of [row.goals, row.assists, row.touches || '—', row.points]) {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        tr.append(cell);
      }
      return tr;
    }));
  }

  /*
   * ── El carrete de goles ────────────────────────────────────────────────
   *
   * `goal.at` es el milisegundo de la grabación en el que entró cada uno, y lo
   * pone el análisis. Con eso un gol deja de ser un renglón de una lista y pasa
   * a ser un lugar: se puede saltar ahí, y se pueden encadenar todos.
   *
   * En vivo el campo no existe —la partida no es un archivo, no hay a dónde
   * saltar— y por eso todo esto se decide mirando el dato y no la pantalla.
   */
  function seekableGoals(goals) {
    if (state.gameView !== 'replay') return [];
    return (goals || []).filter((goal) => Number.isFinite(goal.at));
  }

  /** Salta a un gol. Cierra el panel: nadie quiere mirar la jugada tapada. */
  function jumpToGoal(goal) {
    if (!Number.isFinite(goal.at)) return;
    toggleStatsPanel(false);
    tvm.replays.seek(Math.max(0, goal.at - 6000)).catch((err) => toast(err.message, 'err'));
  }

  $('#statsReel').addEventListener('click', () => {
    const list = seekableGoals(state.summary ? state.summary.goals : []);
    if (!list.length) return;
    toggleStatsPanel(false);
    tvm.replays
      .reel(list.map((goal) => ({ at: goal.at, name: goal.scorer || '' })))
      .catch((err) => toast(err.message, 'err'));
  });

  function paintStatsGoals(goals, matches) {
    const several = matches && matches.length > 1;
    const saltables = seekableGoals(goals).length > 0;
    const nodes = [];
    let shown = -1;

    goals.forEach((goal) => {
      // Una grabación puede tener varios partidos seguidos: se separan, porque
      // si no el marcador de la lista parece que va y viene.
      if (several && goal.match !== shown) {
        shown = goal.match;
        const head = document.createElement('li');
        head.className = 'stats-goals__match';
        const match = matches[goal.match];
        head.textContent = t('stats.matchN', { n: goal.match + 1 }) +
          (match ? ` · ${match.red}–${match.blue}` : '');
        nodes.push(head);
      }

      const row = document.createElement('li');
      row.className = `stats-goal stats-goal--${goal.team === 'Red' ? 'red' : 'blue'}`;

      row.append(statsSpan('stats-goal__clock', goal.clock || '—'));

      const who = statsSpan('stats-goal__who', goal.scorer || t('stats.noScorer'));
      if (!goal.scorer) who.classList.add('is-faint');
      row.append(who);

      if (goal.own) row.append(statsSpan('stats-goal__own', t('stats.own')));
      if (goal.assist) row.append(statsSpan('stats-goal__assist', t('stats.assist', { name: goal.assist })));
      if (goal.score) row.append(statsSpan('stats-goal__score', `${goal.score.red}–${goal.score.blue}`));

      /*
       * El renglón entero salta a la jugada. Es un <li> y no un <button> porque
       * el botón traía su propia caja y rompía la grilla de la lista; lo que
       * hace falta del botón es el teclado, y eso se pide a mano.
       */
      if (saltables && Number.isFinite(goal.at)) {
        row.classList.add('is-seekable');
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.title = t('stats.jump');
        row.addEventListener('click', () => jumpToGoal(goal));
        row.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          jumpToGoal(goal);
        });
      }

      nodes.push(row);
    });

    $('#statsGoals').replaceChildren(...nodes);
  }

  function statsSpan(className, text) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  function teamDot(team) {
    const dot = document.createElement('span');
    dot.className = 'team-dot';
    if (team === 'Red' || team === 'Blue') dot.classList.add(`team-dot--${team.toLowerCase()}`);
    return dot;
  }

  function toggleStatsPanel(force) {
    const panel = $('#tvmStatsPanel');
    const show = force === undefined ? panel.hidden : force;
    panel.hidden = !show;
    if (!show) return;
    /* En un replay el resumen es de la grabación ENTERA, así que abrirlo es
       pedir el análisis. Normalmente ya está hecho —se dispara solo al abrir la
       grabación—, y va por `autoAnalyze` y no por `runAnalysis` para que también
       acá valga el archivo en disco: si esta grabación ya se analizó, se lee, no
       se vuelve a simular. */
    if (state.gameView === 'replay' && !state.summary && !state.analyzing) autoAnalyze();
    else repaintStats();
  }

  tvm.game.onToggleStats((info) => {
    // El botón «Resumen» del reproductor abre y analiza; estando abierto, cierra.
    if (info && info.analyze && $('#tvmStatsPanel').hidden) return toggleStatsPanel(true);
    toggleStatsPanel();
  });

  $('#closeStatsPanel').addEventListener('click', () => toggleStatsPanel(false));
  $('#statsAnalyze').addEventListener('click', () => runAnalysis());

  /*
   * Tab también acá, para cuando el foco está en la app y no adentro del juego
   * (recién arrancado, o después de tocar algo del cliente). El caso normal
   * —jugando, con el foco en el <webview>— lo resuelve el preload del juego:
   * las teclas de un webview nunca llegan a este documento.
   */
  window.addEventListener('keydown', (e) => {
    // La misma tecla que en el preload, y de la misma config: si acá quedaba
    // Tab fija, cambiar la opción no servía de nada con el foco en la app.
    const wanted = state.config.general.summaryKey;
    const key = typeof wanted === 'string' ? wanted : 'Tab';
    if (!key || e.key !== key || e.ctrlKey || e.altKey || e.metaKey) return;
    if (state.stage !== 'game') return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (active && active.isContentEditable)) return;
    e.preventDefault();
    toggleStatsPanel();
  });

  /*
   * Una grabación nueva en la carpeta.
   *
   * HaxBall la guarda donde van las descargas y no le avisa a nadie, así que
   * sin esto aparecía recién cuando el usuario entraba a la pestaña y
   * refrescaba a mano. El aviso llega una sola vez por grabación —el vigilante
   * ya filtró las que sólo se renombraron— y sólo se anuncia si el usuario no
   * está mirando la lista, donde la vería aparecer sola.
   */
  tvm.replays.onNew((item) => {
    loadReplays();
    if (state.view !== 'replays') toast(t('toast.newReplay', { name: item.name }), 'ok');
  });

  tvm.game.onLiveSettings(({ available }, meta) => { tabBucket(meta).s.liveGameSettings = !!available; });
  // El resumen se vacía con `game:match-start`, que llega del propio juego
  // cuando arranca un partido nuevo: entrar a una sala no es empezar a jugar.
  tvm.game.onPlaying((playing, meta) => {
    const { s, active } = tabBucket(meta);
    if (active) setPlaying(playing);
    else s.playing = !!playing;
    renderTabs();
  });
  // El engranaje del HUD del juego abre estos ajustes, no los de HaxBall.
  tvm.game.onOpenSettings(() => goToTab('ajustes', 'juego'));
  tvm.game.onToast(({ message, kind }) => toast(message, kind));
  // La ubicación llega después de que carga el juego: recién ahí hay distancias.
  tvm.rooms.onStale(() => { state.rooms.fetchedAt = 0; refreshRoomsIfStale(); });
  tvm.rooms.onLast((last) => paintLastRoom(last));
  refreshLastRoom();
  tvm.rooms.onFlags(applyFlags);
  tvm.auth.onLive(() => loadAuth());
  tvm.avatar.onLive(({ face }) => {
    state.liveAvatar = face || '';
    renderAvatar();
  });
  tvm.keys.onLive(({ keys }) => {
    state.liveKeys = keys || null;
    renderKeys();
  });
  tvm.updates.onProgress(paintUpdateProgress);

  // Una sola consulta al feed por arranque, y sólo si el usuario la dejó puesta.
  if (state.config.updates.autoCheck) checkUpdates({ silent: true });

  // Los FPS y el ping ya no se muestran acá arriba: están en el overlay, dentro
  // de la cancha. Lo único que queda es contar el tiempo jugado.
  tvm.game.onTelemetry(() => {
    if (!state.playing) return;
    state.playedSeconds++;
    if (state.playedSeconds >= 60) flushPlayTime();
  });

  // Los avisos al usuario llegan por game:toast; esto es sólo diagnóstico.
  tvm.game.onLog(({ level, message, source }) => {
    if (level === 'error') console.error(`[${source}]`, message);
  });

  window.addEventListener('beforeunload', flushPlayTime);
}

/*
 * La pantalla de carga se saca en el `finally`, no dentro de `boot()`.
 *
 * Dos razones. Una: si el arranque falla a mitad de camino, esconderla igual es
 * obligatorio — una app que se queda para siempre en «Cargando» no deja ni ver
 * el error. Dos: el resto de `boot()` engancha los listeners de IPC, y esperar
 * el mínimo de la pantalla ahí adentro los dejaría sin registrar durante más de
 * un segundo, justo mientras el juego arranca y empieza a mandar eventos.
 */
boot()
  .catch((err) => {
    console.error(err);
    toast(err.message, 'err');
  })
  .finally(hideSplash);


/* ── Club conectado ──────────────────────────────────────────────────────────
 * Quién del club tiene la app abierta y en qué sala está. Los datos ya viajan
 * (el pulso de presencia cada 30 s): acá sólo se pintan, y sólo cuando llega
 * una lista nueva. Nada corre por cuadro ni por temporizador propio.
 */
function paintClubNow(list) {
  try { updateClubRooms(list); } catch (e) { /* adorno */ }
  const host = $('#clubNowList');
  if (!host) return;
  const en = isEn();
  const members = (Array.isArray(list) ? list : []).filter((m) => m && !m.trial);
  const online = members.filter((m) => m.online);
  const off = members.filter((m) => !m.online);
  const count = $('#clubNowCount');
  if (count) count.textContent = en ? `${online.length} online` : `${online.length} conectados`;
  const k = $('#kpiOnline');
  if (k) k.textContent = String(online.length);
  state.clubOnline = online.length;
  try { paintStatusBar(); if (state.hub) paintHub(); } catch (e) { /* adorno */ }

  const nodes = [];
  for (const m of online) {
    const card = document.createElement('div');
    card.className = 'cn__card' + (m.self ? ' is-self' : '');
    const av = document.createElement('span');
    av.className = 'cn__av';
    av.textContent = (m.name || '?').trim().charAt(0).toUpperCase();
    const live = document.createElement('i');
    live.className = 'cn__live';
    av.append(live);
    const txt = document.createElement('div');
    txt.className = 'cn__txt';
    const name = document.createElement('b');
    name.textContent = m.name + (m.self ? (en ? ' (you)' : ' (vos)') : '') + (m.ext ? (en ? ' · outside' : ' · ajeno') : '');
    const where = document.createElement('span');
    where.textContent = m.room ? (en ? `in “${m.room}”` : `en «${m.room}»`) : (en ? 'in the menu' : 'en el menú');
    if (m.room) where.classList.add('is-room');
    txt.append(name, where);
    card.append(av, txt);
    nodes.push(card);
  }
  if (!online.length) {
    const none = document.createElement('p');
    none.className = 'note';
    none.textContent = en ? 'Nobody connected right now.' : 'No hay nadie conectado ahora.';
    nodes.push(none);
  }
  if (off.length) {
    const wrap = document.createElement('div');
    wrap.className = 'cn__off';
    const label = document.createElement('span');
    label.textContent = en ? 'Offline' : 'Desconectados';
    wrap.append(label);
    for (const m of off) {
      const chip = document.createElement('em');
      chip.textContent = m.name + (m.ext ? (en ? ' · outside' : ' · ajeno') : '');
      chip.title = m.lastSeen ? (en ? 'last seen ' : 'visto ') + new Date(m.lastSeen).toLocaleDateString(en ? 'en' : 'es', { day: 'numeric', month: 'short' }) : (en ? 'never seen' : 'sin conexión');
      wrap.append(chip);
    }
    nodes.push(wrap);
  }
  host.replaceChildren(...nodes);
}
if (window.tvm.presence && window.tvm.presence.onRoster) {
  window.tvm.presence.onRoster(paintClubNow);
  if (window.tvm.presence.roster) window.tvm.presence.roster().then(paintClubNow).catch(() => {});
}


/* ── Estadísticas del club ───────────────────────────────────────────────────
 * Los números que midió cada app, firmados y subidos a la base del club. Se
 * piden al abrir Cuenta o con el botón: no hay temporizador. */
let clubRank = null;

async function loadClubRank() {
  const stateEl = $('#clubRankState');
  if (!window.tvm.club) return;
  if (stateEl) stateEl.textContent = isEn() ? 'loading…' : 'cargando…';
  let list = null;
  try { list = await window.tvm.club.stats(); } catch (e) { list = null; }
  clubRank = Array.isArray(list) ? list : null;
  paintClubRank();
}

let clubRankKey = 'goals';

function paintClubRank() {
  const host = $('#clubRankList');
  const podium = $('#clubPodium');
  if (!host || !podium) return;
  const en = isEn();
  const stateEl = $('#clubRankState');
  const note = $('#clubRankNote');
  if (note) note.textContent = en
    ? 'Numbers are measured by each member’s own app and signed with their key. Only matches played to the end count.'
    : 'Cada número lo mide la app de cada jugador y viaja firmado con su clave. Sólo cuentan los partidos jugados hasta el final.';
  for (const b of $$('#clubRankSeg button')) b.classList.toggle('is-on', b.dataset.key === clubRankKey);

  if (!clubRank) {
    host.replaceChildren();
    podium.replaceChildren();
    if (stateEl) stateEl.textContent = en ? 'unavailable' : 'sin datos';
    return;
  }

  const gpm = (m) => (m.matches ? m.goals / m.matches : 0);
  const value = (m) => (clubRankKey === 'gpm' ? gpm(m) : m[clubRankKey]);
  const fmt = (v) => (clubRankKey === 'gpm' ? v.toFixed(2) : String(v));
  const rows = clubRank.slice().sort((a, b) => (value(b) - value(a)) || (b.goals - a.goals) || a.name.localeCompare(b.name, 'es'));
  if (stateEl) stateEl.textContent = en ? `${rows.length} players` : `${rows.length} jugadores`;

  const kp = (id, v) => { const e = $(id); if (e) e.textContent = String(v); };
  kp('#kpiPlayers', rows.length);
  kp('#kpiGoals', rows.reduce((n, m) => n + m.goals, 0));
  kp('#kpiMatches', rows.reduce((n, m) => n + m.matches, 0));

  const unit = { goals: en ? 'goals' : 'goles', assists: en ? 'assists' : 'asist.', matches: en ? 'matches' : 'partidos', gpm: en ? 'goals/match' : 'gol/partido' }[clubRankKey];
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const label = (m) => m.name + (m.ext ? (en ? ' · outside' : ' · ajeno') : '');

  // Podio: los tres primeros, el primero más alto.
  const top = rows.filter((m) => value(m) > 0).slice(0, 3);
  const order = top.length === 3 ? [1, 0, 2] : top.map((_, i) => i);
  podium.replaceChildren(...order.map((i) => {
    const m = top[i];
    const card = mk('div', `pod pod--${i + 1}${m.self ? ' is-self' : ''}`);
    card.append(
      mk('span', 'pod__rank', i === 0 ? '1' : String(i + 1)),
      mk('span', 'pod__av', (m.name || '?').trim().charAt(0).toUpperCase()),
      mk('b', 'pod__name', label(m)),
      mk('span', 'pod__val', fmt(value(m))),
      mk('span', 'pod__unit', unit),
      mk('span', 'pod__sub', `${m.goals} G · ${m.assists} A · ${m.matches} ${en ? 'GP' : 'PJ'}`)
    );
    return card;
  }));

  // El resto, con una barra proporcional al líder.
  const max = Math.max(1e-9, ...rows.map(value));
  const head = mk('div', 'cr__row cr__row--head');
  for (const h of ['#', en ? 'Player' : 'Jugador', '', en ? 'G' : 'G', en ? 'A' : 'A', en ? 'GP' : 'PJ', en ? 'OG' : 'GC']) head.append(mk('span', '', h));
  const start = top.length;
  const nodes = rows.slice(start).map((m, n) => {
    const row = mk('div', 'cr__row' + (m.self ? ' is-self' : ''));
    const bar = mk('span', 'cr__bar2');
    const fill = mk('i');
    fill.style.width = `${Math.max(2, Math.round((value(m) / max) * 100))}%`;
    bar.append(fill);
    row.append(mk('span', 'cr__pos', String(start + n + 1)), mk('span', 'cr__name', label(m)), bar,
      mk('span', clubRankKey === 'goals' ? 'is-key' : '', String(m.goals)),
      mk('span', clubRankKey === 'assists' ? 'is-key' : '', String(m.assists)),
      mk('span', clubRankKey === 'matches' ? 'is-key' : '', String(m.matches)),
      mk('span', '', String(m.ownGoals)));
    return row;
  });
  host.replaceChildren(...(nodes.length ? [head, ...nodes] : []));
}
for (const b of $$('#clubRankSeg button')) {
  b.addEventListener('click', () => { clubRankKey = b.dataset.key; paintClubRank(); });
}
if ($('#clubRankRefresh')) $('#clubRankRefresh').addEventListener('click', loadClubRank);

/* ── Los reyes del x7 y hostear salas ────────────────────────────────────────
 * Los partidos de los internos viajan firmados por quien hosteó; acá sólo se
 * leen y se muestran. Se piden al abrir Club o con el botón: no hay temporizador. */
let kings = null;

async function loadKings() {
  if (!window.tvm.club || !window.tvm.club.interno) return;
  const st = $('#kingsState');
  if (st) st.textContent = 'cargando…';
  try { kings = await window.tvm.club.interno(); } catch (e) { kings = null; }
  paintKings();
}

function paintKings() {
  const host = $('#kingsList');
  if (!host) return;
  const st = $('#kingsState');
  const note = $('#kingsNote');
  if (!kings) { host.replaceChildren(); if (st) st.textContent = 'sin datos'; if (note) note.textContent = ''; return; }
  if (st) st.textContent = `${kings.matches} ${kings.matches === 1 ? 'partido' : 'partidos'}`;
  if (note) note.textContent = 'Cuentan todos los que juegan los internos de x7, usen o no la TL App. Los que la usan llevan la marca TL.';
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  if (!kings.kings.length) { host.replaceChildren(mk('p', 'note', 'Todavía no hay internos registrados.')); return; }
  const head = mk('div', 'cr__row cr__row--head kings__row');
  for (const t of ['#', 'Jugador', 'Ganados', 'Goles', 'Asist.']) head.append(mk('span', '', t));
  const rows = kings.kings.map((k, i) => {
    const r = mk('div', 'cr__row kings__row' + (i === 0 ? ' is-king' : ''));
    const nm = mk('span', 'cr__name', k.name);
    if (k.app) { const tag = mk('em', 'kings__tl', 'TL'); tag.title = 'Juega con la TL App'; nm.append(' ', tag); r.classList.add('is-app'); }
    r.append(mk('span', 'cr__pos', i === 0 ? '👑' : String(i + 1)), nm,
      mk('span', 'is-key', String(k.wins)), mk('span', '', String(k.goals)), mk('span', '', String(k.assists)));
    return r;
  });
  host.replaceChildren(head, ...rows);
}
if ($('#kingsRefresh')) $('#kingsRefresh').addEventListener('click', loadKings);
if (window.tvm.club && window.tvm.club.onInterno) window.tvm.club.onInterno(() => loadKings());

let hostSt = null;
let hostMode = 'interno';
let hostScript = '';

function paintHostAccess() {
  const ok = !!(state.access && state.access.host);
  const btn = $('#hostBtn');
  if (btn) btn.hidden = !ok;
}

function paintHost() {
  const s = hostSt;
  if (!s) return;
  const live = !!(s.running || s.starting);
  const tag = $('#hostTag');
  if (tag) tag.textContent = s.running ? 'en el aire' : s.starting ? 'iniciando…' : 'apagada';
  if ($('#hostForm')) $('#hostForm').hidden = live;
  if ($('#hostLive')) $('#hostLive').hidden = !live;
  if ($('#hostGo')) $('#hostGo').hidden = live;
  if ($('#hostStop')) $('#hostStop').hidden = !live;
  if ($('#hostLiveName')) $('#hostLiveName').textContent = s.name || '';
  if ($('#hostLiveInfo')) $('#hostLiveInfo').textContent = `${s.mode === 'interno' ? 'Interno' : 'Amistoso'} · ${s.size || ''} · ${s.players || 0} adentro` + (s.custom ? ' · script propio' : '');
  if ($('#hostLink')) $('#hostLink').value = s.link || (s.starting ? 'esperando que HaxBall la publique…' : '');
  if ($('#hostCopy')) $('#hostCopy').disabled = !s.link;
  const err = $('#hostErr');
  if (err) { err.textContent = s.error || ''; err.hidden = !s.error; }
}

const HOST_MAP_KEYS = ['x1', 'x3', 'x4', 'x5', 'x7', 'train'];
let hostMapFiles = {};
try { hostMapFiles = JSON.parse(localStorage.getItem('tl_host_maps') || '{}') || {}; } catch (e) { hostMapFiles = {}; }

async function loadHostMaps() {
  const el = $('#hostMapsInfo');
  const grid = $('#hostMaps');
  if (!el || !window.tvm.host.maps) return;
  let have = [];
  try { have = (await window.tvm.host.maps(hostMapFiles)) || []; } catch (e) { have = []; }
  el.textContent = 'Con mapa: ' + (have.join(', ') || 'ninguno');
  if (!grid) return;
  grid.replaceChildren(...HOST_MAP_KEYS.map((k) => {
    const row = document.createElement('div');
    row.className = 'hostmaps__row';
    const name = document.createElement('b');
    name.textContent = k === 'train' ? '!train' : '!' + k;
    const file = document.createElement('span');
    file.className = 'note';
    const own = hostMapFiles[k];
    file.textContent = own ? own.split(/[\\/]/).pop() : (have.includes(k) ? 'de la carpeta de mapas' : 'sin mapa');
    const pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'btn btn--ghost btn--sm'; pick.textContent = 'Elegir…';
    pick.addEventListener('click', async () => {
      let f = '';
      try { f = await window.tvm.host.pickMap(k); } catch (e) { f = ''; }
      if (!f) return;
      hostMapFiles[k] = f;
      try { localStorage.setItem('tl_host_maps', JSON.stringify(hostMapFiles)); } catch (e) { /* sin guardar */ }
      loadHostMaps();
    });
    row.append(name, file, pick);
    if (own) {
      const clr = document.createElement('button');
      clr.type = 'button'; clr.className = 'btn btn--ghost btn--sm'; clr.textContent = 'Quitar';
      clr.addEventListener('click', () => { delete hostMapFiles[k]; try { localStorage.setItem('tl_host_maps', JSON.stringify(hostMapFiles)); } catch (e) { /* nada */ } loadHostMaps(); });
      row.append(clr);
    }
    return row;
  }));
}

async function loadHostState() {
  if (!window.tvm.host) return;
  loadHostMaps();
  try { hostSt = await window.tvm.host.state(); } catch (e) { return; }
  paintHost();
}

function paintHostMode() {
  for (const b of $$('#hostMode button')) b.classList.toggle('is-on', b.dataset.mode === hostMode);
  if ($('#hostRecordRow')) $('#hostRecordRow').hidden = hostMode !== 'interno';
  if ($('#hostScriptRow')) $('#hostScriptRow').hidden = hostMode === 'interno';
  const nameEl = $('#hostName');
  if (nameEl && (!nameEl.value || nameEl.dataset.auto === '1')) { nameEl.value = hostMode === 'interno' ? 'Interno TL' : 'Amistoso TL'; nameEl.dataset.auto = '1'; }
  const size = $('#hostSize');
  if (size && size.dataset.touched !== '1') size.value = hostMode === 'interno' ? '7' : '3';
  const tr = $('#hostTrainOpt');
  if (tr) { tr.hidden = hostMode === 'interno'; tr.disabled = hostMode === 'interno'; if (hostMode === 'interno' && size && size.value === 'train') size.value = '7'; }
}

function bindHost() {
  if (!window.tvm.host || !$('#hostSec')) return;
  for (const b of $$('#hostMode button')) b.addEventListener('click', () => { hostMode = b.dataset.mode; paintHostMode(); });
  if ($('#hostName')) $('#hostName').addEventListener('input', (e) => { e.target.dataset.auto = '0'; });
  if ($('#hostSize')) $('#hostSize').addEventListener('change', (e) => { e.target.dataset.touched = '1'; });
  if ($('#hostScriptPick')) $('#hostScriptPick').addEventListener('click', async () => {
    try { hostScript = (await window.tvm.host.pickScript()) || hostScript; } catch (e) { /* cancelado */ }
    if ($('#hostScriptName')) $('#hostScriptName').textContent = hostScript ? hostScript.split(/[\\/]/).pop() : 'Usa el script de TL App';
    if ($('#hostScriptClear')) $('#hostScriptClear').hidden = !hostScript;
  });
  if ($('#hostScriptClear')) $('#hostScriptClear').addEventListener('click', () => {
    hostScript = '';
    $('#hostScriptName').textContent = 'Usa el script de TL App';
    $('#hostScriptClear').hidden = true;
  });
  $('#hostGo').addEventListener('click', async () => {
    const g = $('#hostGo');
    g.disabled = true;
    try {
      hostSt = await window.tvm.host.start({
        mode: hostMode, name: $('#hostName').value, size: ($('#hostSize').value === 'train' ? 'train' : Number($('#hostSize').value)), maxPlayers: Number($('#hostMax').value),
        password: $('#hostPass').value, adminKey: $('#hostAdminKey').value, hostNick: $('#hostNick').value,
        record: $('#hostRecord').checked, listed: $('#hostListed').checked, mapFiles: hostMapFiles, customPath: hostMode === 'amistoso' ? hostScript : ''
      });
      try { localStorage.setItem('tl_host_prefs', JSON.stringify({ nick: $('#hostNick').value, adminKey: $('#hostAdminKey').value })); } catch (e) { /* sin guardar */ }
    } catch (e) {
      hostSt = { ...(hostSt || {}), error: String((e && e.message) || e).replace(/^Error:\s*/, '') };
    }
    g.disabled = false;
    paintHost();
  });
  if ($('#hostMapsOpen')) $('#hostMapsOpen').addEventListener('click', () => { window.tvm.host.openMaps().then(loadHostMaps).catch(() => {}); });
  $('#hostStop').addEventListener('click', async () => { try { hostSt = await window.tvm.host.stop(); } catch (e) { /* ya cerrada */ } paintHost(); });
  $('#hostShow').addEventListener('click', () => { window.tvm.host.show().catch(() => {}); });
  $('#hostCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#hostLink').value); toast('Link copiado'); } catch (e) { /* sin portapapeles */ }
  });
  if (window.tvm.host.onState) window.tvm.host.onState((s) => { hostSt = { ...(hostSt || {}), ...s }; paintHost(); });
  try {
    const p = JSON.parse(localStorage.getItem('tl_host_prefs') || '{}');
    if (p.nick) $('#hostNick').value = p.nick;
    if (p.adminKey) $('#hostAdminKey').value = p.adminKey;
  } catch (e) { /* sin preferencias */ }
  paintHostMode();
  if ($('#hostBtn')) $('#hostBtn').addEventListener('click', () => goView('hostear'));
}
bindHost();



/* ── Informes de partido ─────────────────────────────────────────────────────
 * Se arman a partir de una replay que se elige acá: la app la recorre una vez
 * (la misma simulación del resumen) y saca quiénes jugaron, los cambios, los
 * goles con su asistencia, los goles en contra y hasta cuándo cada arquero
 * mantuvo la valla invicta. Nada se guarda: el informe vive mientras lo mirás. */
let reportBusy = false;

function reportStatus(text, kind) {
  const el = $('#reportsStatus');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
  el.classList.toggle('is-err', kind === 'err');
}

function loadReports() { paintReports(); }

function paintReports() {
  const en = isEn();
  $('#reportsHelp').textContent = en
    ? 'Load a replay from your computer and its match report is built from it: who played, substitutions, goals and assists, own goals and the moment each team conceded its first goal. Nothing is saved. Only the captain and whoever he delegates can see this section.'
    : 'Cargá una replay desde tu PC y se arma el informe a partir de ella: quiénes jugaron, los cambios, goles y asistencias, goles en contra y el momento en que a cada equipo le hicieron el primer gol. No se guarda nada. Esta sección sólo la ven el capitán y quien él habilite.';
  const btn = $('#reportsLoad');
  if (btn) { btn.disabled = reportBusy; btn.textContent = en ? 'Load replay…' : 'Cargar replay…'; }
}
if ($('#reportsLoad')) $('#reportsLoad').addEventListener('click', () => makeReportFromFile());

/** Elige una replay de la PC, la recorre pidiendo el informe y lo muestra. */
async function makeReportFromFile() {
  if (reportBusy) return;
  const en = isEn();
  if (state.stage === 'game' && (state.gameView === 'room' || state.gameView === 'game')) {
    reportStatus(en ? 'Leave your room first: the replay needs the game screen.' : 'Salí de la sala primero: la replay necesita la pantalla del juego.', 'err');
    return;
  }
  reportBusy = true;
  paintReports();
  const prev = { path: state.replayPath, name: state.replayName, summary: state.summary };
  try {
    const res = await guard(tvm.replays.pickAndPlay(), 'Error');
    if (!res) { reportStatus(''); return; } // canceló el selector
    reportStatus(en ? 'Opening the replay…' : 'Abriendo la replay…');
    state.summary = null;
    state.replayName = res.name.replace(/\.hbr2?$/i, '');
    state.replayPath = null;
    // El reproductor tarda un momento en estar listo.
    for (let i = 0; i < 40 && state.gameView !== 'replay'; i++) await new Promise((r) => setTimeout(r, 250));
    await new Promise((r) => setTimeout(r, 1500));
    reportStatus(en ? 'Analysing the match…' : 'Analizando el partido…');
    const out = await tvm.replays.analyze({ report: true });
    if (!out || !out.ok) throw new Error((out && out.reason) || (en ? 'The replay could not be analysed.' : 'No se pudo analizar la replay.'));
    const reports = Array.isArray(out.reports) ? out.reports : [];
    if (!reports.length) throw new Error(en ? 'No match long enough to report was found in that replay.' : 'No hay ningún partido en esa replay con la duración suficiente para informar.');
    const base = { at: res.updatedAt || Date.now(), room: state.replayName || res.name };
    const list = reports.map((r) => ({ ...base, ...r }));
    reportStatus('');
    $('#reportsCount').textContent = res.name;
    if (list.length === 1) openReport(list[0]);
    else pickReportMatch(list);
  } catch (err) {
    reportStatus(String((err && err.message) || err), 'err');
  } finally {
    reportBusy = false;
    state.summary = prev.summary;
    state.replayPath = prev.path;
    state.replayName = prev.name;
    paintReports();
  }
}

/** Una replay puede traer varios partidos: se elige de cuál se quiere el informe. */
function pickReportMatch(list) {
  const en = isEn();
  const host = $('#reportsPick');
  if (!host) { openReport(list[0]); return; }
  host.hidden = false;
  const title = document.createElement('p');
  title.className = 'note';
  title.textContent = en ? 'This replay has several matches. Pick one:' : 'Esta replay tiene varios partidos. Elegí uno:';
  const rows = list.map((r, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--ghost btn--sm';
    b.textContent = `${en ? 'Match' : 'Partido'} ${i + 1}: ${en ? 'Red' : 'Rojo'} ${r.score.red} – ${r.score.blue} ${en ? 'Blue' : 'Azul'} · ${r.end}`;
    b.addEventListener('click', () => openReport(r));
    return b;
  });
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'btn btn--ghost btn--sm'; close.textContent = '✕';
  close.addEventListener('click', () => { host.hidden = true; host.replaceChildren(); });
  host.replaceChildren(title, ...rows, close);
}

/** El informe como lista de líneas [{ text, kind }], para texto e imagen por igual. */
function reportLines(r, names) {
  const en = isEn();
  const L = [];
  const add = (text, kind) => L.push({ text, kind: kind || '' });
  const who = (n) => n || '?';
  const when = new Date(r.at).toLocaleDateString(en ? 'en' : 'es', { day: 'numeric', month: 'long', year: 'numeric' });
  add(en ? 'MATCH REPORT' : 'INFORME DE PARTIDO', 'title');
  add(`${names.Red} ${r.score.red} – ${r.score.blue} ${names.Blue}`, 'score');
  add(`${when}${r.room ? ' · ' + r.room : ''} · ${en ? 'duration' : 'duración'} ${r.end}`, 'meta');
  for (const t of ['Red', 'Blue']) {
    const side = r[t];
    add('', 'gap');
    add(names[t].toUpperCase(), 'head');
    add((en ? 'Played: ' : 'Jugaron: ') + (side.starters.length ? side.starters.join(', ') : '—'));
    const changes = side.changes || [];
    add((en ? 'Substitutions: ' : 'Cambios: ') + (changes.length
      ? changes.map((c) => (c.out ? `${c.in} ${en ? 'for' : 'por'} ${c.out}` : `${en ? 'in' : 'entró'} ${c.in}`)).join(', ')
      : (en ? 'none' : 'ninguno')));
    if (side.goals.length) {
      add(en ? 'Goals:' : 'Goles:', 'sub');
      for (const g of side.goals) add(`  ${g.clock}  ${who(g.scorer)}${g.assist ? (en ? ' (assist ' : ' (asist. ') + g.assist + ')' : ''}`);
    } else add(en ? 'Goals: none' : 'Goles: ninguno');
    if (side.ownGoals.length) {
      add(en ? 'Own goals:' : 'Goles en contra:', 'sub');
      for (const g of side.ownGoals) add(`  ${g.clock}  ${who(g.scorer)}`);
    }
    add(`${en ? 'Clean sheet' : 'Valla invicta'}: ${side.conceded || (en ? 'no goals conceded' : 'no recibió goles')}`);
  }
  return L;
}

function reportText(r, names) {
  return reportLines(r, names).map((l) => l.text).join('\n');
}

/** Dibuja el informe en un canvas, sólo cuando se pide. */
function reportCanvas(r, names) {
  const lines = reportLines(r, names);
  const W = 860, pad = 36;
  const style = {
    title: ['700 26px system-ui, sans-serif', '#e8c15a', 40],
    score: ['700 34px system-ui, sans-serif', '#ffffff', 50],
    meta: ['400 15px system-ui, sans-serif', '#9aa6bd', 26],
    head: ['700 20px system-ui, sans-serif', '#e8c15a', 32],
    sub: ['600 16px system-ui, sans-serif', '#cfd8ea', 24],
    gap: ['400 8px system-ui, sans-serif', '#fff', 10],
    '': ['400 16px system-ui, sans-serif', '#dbe3f3', 24]
  };
  const H = pad * 2 + lines.reduce((n, l) => n + style[l.kind][2], 0);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0f1626'); bg.addColorStop(1, '#0a0f1b');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8c15a'; g.fillRect(0, 0, 6, H);
  let y = pad;
  g.textBaseline = 'top';
  for (const l of lines) {
    const [font, color, h] = style[l.kind];
    g.font = font; g.fillStyle = color;
    g.fillText(l.text, pad, y + (h > 20 ? 2 : 0), W - pad * 2);
    y += h;
  }
  return c;
}

function openReport(r) {
  const en = isEn();
  document.getElementById('repModal')?.remove();
  const names = { Red: en ? 'Red' : 'Rojo', Blue: en ? 'Blue' : 'Azul' };
  const wrap = document.createElement('div');
  wrap.id = 'repModal';
  wrap.className = 'rep__modal';
  const card = document.createElement('div');
  card.className = 'rep__card';

  const bar = document.createElement('div');
  bar.className = 'rep__names';
  const inputs = {};
  for (const t of ['Red', 'Blue']) {
    const label = document.createElement('label');
    label.textContent = (t === 'Red' ? (en ? 'Red team name' : 'Nombre del equipo rojo') : (en ? 'Blue team name' : 'Nombre del equipo azul'));
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = 30; input.value = names[t];
    input.addEventListener('input', () => { names[t] = input.value.trim() || (t === 'Red' ? 'Rojo' : 'Azul'); area.value = reportText(r, names); });
    inputs[t] = input;
    label.append(input);
    bar.append(label);
  }
  const area = document.createElement('textarea');
  area.className = 'rep__text';
  area.readOnly = true;
  area.value = reportText(r, names);

  const actions = document.createElement('div');
  actions.className = 'rep__actions';
  const mk = (txt, fn, ghost) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn--sm' + (ghost ? ' btn--ghost' : ''); b.textContent = txt;
    b.addEventListener('click', fn);
    actions.append(b);
    return b;
  };
  const flash = (b, txt) => { const old = b.textContent; b.textContent = txt; setTimeout(() => { b.textContent = old; }, 1400); };
  const copyBtn = mk(en ? 'Copy text' : 'Copiar texto', async () => {
    try { await navigator.clipboard.writeText(area.value); flash(copyBtn, en ? 'Copied' : 'Copiado'); } catch (e) { area.select(); }
  });
  const imgBtn = mk(en ? 'Copy image' : 'Copiar imagen', () => {
    reportCanvas(r, names).toBlob(async (blob) => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); flash(imgBtn, en ? 'Copied' : 'Copiada'); } catch (e) { flash(imgBtn, en ? 'Not possible' : 'No se pudo'); }
    });
  });
  mk(en ? 'Save image' : 'Guardar imagen', () => {
    reportCanvas(r, names).toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `informe-${names.Red}-${r.score.red}-${r.score.blue}-${names.Blue}.png`.replace(/[^\w.-]+/g, '_');
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  }, true);
  mk(en ? 'Close' : 'Cerrar', () => wrap.remove(), true);

  card.append(bar, area, actions);
  wrap.append(card);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) wrap.remove(); });
  document.body.append(wrap);
}

/* ── Secciones plegables y barra de la solapa ────────────────────────────────
 * Cada sección se puede cerrar tocando su título (se recuerda), y arriba de la
 * solapa hay una fila de atajos para saltar a cualquiera sin scrollear. Sólo
 * clases y CSS estático: no suma trabajo al juego. */
function secOpenMap() {
  if (!window.__secOpen) {
    try { window.__secOpen = JSON.parse(localStorage.getItem('tl_sec_open') || '{}') || {}; } catch (e) { window.__secOpen = {}; }
  }
  return window.__secOpen;
}

function saveSecOpen() {
  try { localStorage.setItem('tl_sec_open', JSON.stringify(secOpenMap())); } catch (e) { /* nada */ }
}

/** Por defecto: la primera sección de cada solapa abierta, el resto cerradas. */
function secDefaultOpen(sec) {
  if (sec.classList.contains('sec--feature') || sec.dataset.sec === 'mezclador') return true;
  const mates = $$(`.page__inner > .sec[data-tab="${sec.dataset.tab}"]`, sec.closest('.page'));
  return mates.length <= 2 || mates[0] === sec;
}

function setSecOpen(sec, open, remember) {
  sec.classList.toggle('is-collapsed', !open);
  if (remember) { secOpenMap()[sec.dataset.sec] = open; saveSecOpen(); }
}

function initCollapsibles() {
  const map = secOpenMap();
  for (const name of NAV_PAGES) {
    const page = navPage(name);
    if (!page || !PANEL_TABS[name]) continue;
    for (const sec of $$('.page__inner > .sec[data-tab]', page)) {
      if (sec.dataset.modal) continue;
      const head = $('.sec__head', sec);
      if (!head || head.dataset.fold) continue;
      head.dataset.fold = '1';
      const chev = document.createElement('span');
      chev.className = 'sec__chev';
      chev.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>';
      head.append(chev);
      const open = sec.dataset.sec in map ? map[sec.dataset.sec] !== false : secDefaultOpen(sec);
      setSecOpen(sec, open);
      head.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, a, label, .toggle, .hint')) return;
        setSecOpen(sec, sec.classList.contains('is-collapsed'), true);
      });
    }
  }
}

function renderTabBar(page) {
  const el = navPage(page);
  if (!el || !PANEL_TABS[page]) return;
  const inner = $('.page__inner', el);
  let bar = $('.tabbar', inner);
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'tabbar';
    const head = $('.pagehead', inner);
    if (head) head.after(bar); else inner.prepend(bar);
  }
  const cur = currentTab(page);
  const secs = $$('.page__inner > .sec[data-tab]', el).filter((sec) => sec.dataset.tab === cur && !sec.dataset.modal && !sec.hidden);
  const chips = secs.map((sec) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tabbar__chip';
    b.textContent = secTitle(sec);
    b.addEventListener('click', () => { setSecOpen(sec, true, true); sec.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
    return b;
  });
  const all = document.createElement('div');
  all.className = 'tabbar__all';
  const mk = (txt, open) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tabbar__fold';
    b.textContent = txt;
    b.addEventListener('click', () => { for (const sec of secs) setSecOpen(sec, open, true); });
    return b;
  };
  all.append(mk(isEn() ? 'Open all' : 'Abrir todo', true), mk(isEn() ? 'Close all' : 'Cerrar todo', false));
  bar.replaceChildren(...(secs.length > 1 ? [...chips, all] : []));
  bar.hidden = secs.length < 2;

  /* Migas de pan: «Personalización › Estilo». Dicen dónde estás y la primera
     te lleva arriba de todo sin scrollear a mano. */
  const head = $('.pagehead', inner);
  const h1 = head && $('h1', head);
  const tab = PANEL_TABS[page].find((x) => x.id === cur);
  if (h1 && tab) {
    let crumbs = $('.crumbs', inner);
    if (!crumbs) {
      crumbs = document.createElement('nav');
      crumbs.className = 'crumbs';
      crumbs.setAttribute('aria-label', 'breadcrumb');
      head.prepend(crumbs);
    }
    const first = document.createElement('button');
    first.type = 'button';
    first.className = 'crumbs__a';
    first.textContent = h1.textContent.trim();
    first.addEventListener('click', () => inner.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    const sep = document.createElement('span');
    sep.className = 'crumbs__sep';
    sep.textContent = '›';
    const last = document.createElement('span');
    last.className = 'crumbs__now';
    last.textContent = t(tab.label);
    crumbs.replaceChildren(first, sep, last);
  }
}

initCollapsibles();


/* ── Interfaz: la estructura de todo el cliente ──────────────────────────────
 * Tres maneras de armar el mismo cliente. Es un atributo en la raíz
 * (`data-layout`) y reglas de CSS: no hay JS corriendo ni nada que repintar
 * por cuadro. «Clásico» es la de siempre y la que arranca por defecto. */
const LAYOUTS = [
  { id: 'classic', es: 'Clásica', en: 'Classic',
    desD: 'Menú lateral a la izquierda. La de siempre.', desE: 'Side menu on the left. The usual one.' },
  { id: 'top', es: 'Barra superior', en: 'Top bar',
    desD: 'Pestañas arriba y todo el ancho para el contenido.', desE: 'Tabs on top and the full width for content.' },
  { id: 'dock', es: 'Dock flotante', en: 'Floating dock',
    desD: 'Una píldora abajo al centro, con los íconos.', desE: 'A pill at the bottom centre, icons only.' },
  { id: 'island', es: 'Isla', en: 'Island',
    desD: 'Una píldora vertical flotando a la izquierda.', desE: 'A vertical pill floating on the left.' },
  { id: 'bottom', es: 'Barra inferior', en: 'Bottom bar',
    desD: 'Pestañas con nombre abajo, como en el celular.', desE: 'Labelled tabs at the bottom, phone style.' },
  { id: 'mini', es: 'Íconos', en: 'Icons only',
    desD: 'El menú de siempre pero angosto, sólo íconos.', desE: 'The usual side menu, narrow, icons only.' },
  { id: 'right', es: 'Lateral derecho', en: 'Right side',
    desD: 'La clásica, pero con el menú a la derecha.', desE: 'The classic, with the menu on the right.' },
  { id: 'consola', es: 'Consola', en: 'Console',
    desD: 'Sin menú: un Inicio con mosaicos grandes, como una consola.', desE: 'No menu: a Home with big tiles, like a console.' },
  { id: 'comando', es: 'Comando', en: 'Command',
    desD: 'Sin menú: una paleta (Ctrl+K) para ir a cualquier lado.', desE: 'No menu: a palette (Ctrl+K) to go anywhere.' },
  { id: 'radial', es: 'Radial', en: 'Radial',
    desD: 'Un botón en la esquina que abre los destinos en abanico.', desE: 'A corner button that fans the destinations out.' }
];
const LAYOUT_IDS = ['top', 'dock', 'mini', 'right', 'island', 'bottom', 'consola', 'comando', 'radial'];
function paintLayout() {
  const host = $('#layoutCards');
  if (!host || !state.config) return;
  const en = isEn();
  $('#layTitle').textContent = en ? 'Interface layout' : 'Interfaz';
  $('#layDesc').textContent = en
    ? 'Changes how the whole client is laid out. It starts on Classic and you can come back any time.'
    : 'Cambia cómo se arma todo el cliente. Arranca en Clásica y podés volver cuando quieras.';
  const cur = state.config.appearance.layout || 'classic';
  const sig = `${cur}|${en}`;
  if (host.dataset.sig !== sig) {
    host.dataset.sig = sig;
    host.replaceChildren(...LAYOUTS.map((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'laycard' + (l.id === cur ? ' is-active' : '');
      b.dataset.lay = l.id;
      b.innerHTML = `<span class="laycard__prev laycard__prev--${l.id}" aria-hidden="true"><i class="lp-bar"></i><i class="lp-main"></i><i class="lp-side"></i></span>`;
      const t = document.createElement('b');
      t.textContent = en ? l.en : l.es;
      const d = document.createElement('small');
      d.textContent = en ? l.desE : l.desD;
      b.append(t, d);
      return b;
    }));
  }
  const rr = state.config.appearance.roomRows || 'normal';
  $('#rowsLabel').textContent = en ? 'Room list rows' : 'Filas de la lista de salas';
  const rhost = $('#rowsChips');
  if (rhost.dataset.sig !== `${rr}|${en}`) {
    rhost.dataset.sig = `${rr}|${en}`;
    rhost.replaceChildren(...[['dense', 'Densa', 'Dense'], ['normal', 'Normal', 'Normal'], ['large', 'Amplia', 'Roomy']].map((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (d[0] === rr ? ' is-active' : '');
      b.dataset.rows = d[0];
      b.textContent = en ? d[2] : d[1];
      return b;
    }));
  }
  $('#statusLabel').textContent = en ? 'Status bar (bottom)' : 'Barra de estado (abajo)';
  const sb = state.config.appearance.statusBar === true;
  const shost = $('#statusChips');
  if (shost.dataset.sig !== `${sb}|${en}`) {
    shost.dataset.sig = `${sb}|${en}`;
    shost.replaceChildren(...[[false, 'Apagada', 'Off'], [true, 'Prendida', 'On']].map((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (d[0] === sb ? ' is-active' : '');
      b.dataset.sb = String(d[0]);
      b.textContent = en ? d[2] : d[1];
      return b;
    }));
  }
  /* Los íconos del menú no dicen nada sin la etiqueta: se las damos de tooltip. */
  for (const b of $$('#rail .railitem')) { const sp = b.querySelector('span'); if (sp && sp.textContent.trim()) b.title = sp.textContent.trim(); }
  const back = $('#layReset');
  back.textContent = en ? 'Back to Classic' : 'Volver a la clásica';
  back.hidden = cur === 'classic';
}
$('#layoutCards').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lay]');
  if (b) patchConfig({ appearance: { layout: b.dataset.lay } });
});
$('#rowsChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rows]');
  if (b) patchConfig({ appearance: { roomRows: b.dataset.rows } });
});
$('#statusChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sb]');
  if (b) patchConfig({ appearance: { statusBar: b.dataset.sb === 'true' } });
});
$('#layReset').addEventListener('click', () => patchConfig({ appearance: { layout: 'classic' } }));


/* ── Barra de estado ─────────────────────────────────────────────────────────
 * Una línea abajo con lo que ya sabe el cliente: cuántos del club están
 * conectados, cuánta gente hay en HaxBall y la hora. Apagada no existe (ni el
 * nodo ni el temporizador); prendida se repinta cuando llega un dato nuevo y
 * cada 30 s por la hora. Dentro de una sala se esconde: ahí abajo hay cancha. */
let statusTimer = 0;
function paintStatusBar() {
  const on = !!(state.config && state.config.appearance.statusBar === true);
  let bar = $('#statusbar');
  if (!on) {
    if (bar) bar.hidden = true;
    clearInterval(statusTimer);
    statusTimer = 0;
    return;
  }
  if (!bar) {
    bar = document.createElement('footer');
    bar.id = 'statusbar';
    bar.className = 'statusbar';
    bar.innerHTML = '<span class="statusbar__club"></span><span class="statusbar__rooms"></span><span class="statusbar__sp"></span><span class="statusbar__clock"></span>';
    $('#app').append(bar);
  }
  bar.hidden = false;
  const en = isEn();
  const n = state.clubOnline;
  const club = bar.querySelector('.statusbar__club');
  club.textContent = typeof n === 'number' ? `● ${n} ${en ? 'of the club online' : 'del club conectados'}` : '';
  club.classList.toggle('is-live', typeof n === 'number' && n > 0);
  const r = state.rooms;
  bar.querySelector('.statusbar__rooms').textContent = r && r.totalRooms
    ? `${Number(r.totalPlayers).toLocaleString('es-AR')} ${en ? 'players' : 'jugadores'} · ${Number(r.totalRooms).toLocaleString('es-AR')} ${en ? 'rooms' : 'salas'}`
    : '';
  bar.querySelector('.statusbar__clock').textContent = new Date().toLocaleTimeString(en ? 'en-GB' : 'es-AR', { hour: '2-digit', minute: '2-digit' });
  if (!statusTimer) statusTimer = setInterval(paintStatusBar, 30000);
}

/* ── Navegación alternativa: Inicio (Consola) y paleta (Comando) ─────────────
 * Dos interfaces sin menú lateral. Las dos hacen lo mismo que el menú de
 * siempre —llaman al clic del botón del riel, que es quien sabe cambiar de
 * pantalla— así que no hay una segunda lógica de navegación que mantener. */
const NAV_DESTS = [
  { view: 'play', es: 'Salas', en: 'Rooms' },
  { view: 'replays', es: 'Replays', en: 'Replays' },
  { view: 'club', es: 'Club', en: 'Club' },
  { view: 'aspecto', es: 'Personalización', en: 'Personalization' },
  { view: 'ajustes', es: 'Configuración', en: 'Settings' },
  { view: 'informes', es: 'Informes', en: 'Reports', only: 'reports' },
  { view: 'hostear', es: 'Hostear', en: 'Host', only: 'host' }
];
/** Los destinos que esta persona puede ver (Informes sólo con permiso). */
const navDests = () => NAV_DESTS.filter((d) => !d.only || (state.access && state.access[d.only]));
function layoutIs(id) { return document.documentElement.dataset.layout === id; }
function navIcon(view) {
  const src = document.querySelector(`#rail [data-view="${view}"] svg`);
  return src ? src.cloneNode(true) : document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}
function goView(view) {
  const b = document.querySelector(`#rail [data-view="${view}"]`);
  if (b) b.click();
}
state.hub = false;
state.clubOnline = null;

function hubSub(view, en) {
  if (view === 'play') {
    const r = state.rooms;
    return r && r.totalRooms ? `${Number(r.totalPlayers).toLocaleString('es-AR')} ${en ? 'players' : 'jugadores'} · ${Number(r.totalRooms).toLocaleString('es-AR')} ${en ? 'rooms' : 'salas'}` : (en ? 'Find a room' : 'Buscá una sala');
  }
  if (view === 'replays') {
    const n = state.replays && Array.isArray(state.replays.items) ? state.replays.items.length : null;
    return n === null ? (en ? 'Your library' : 'Tu biblioteca') : `${n} replays`;
  }
  if (view === 'club') return typeof state.clubOnline === 'number' ? `${state.clubOnline} ${en ? 'online' : 'conectados'}` : (en ? 'Stats and roster' : 'Estadísticas y plantel');
  if (view === 'hostear') return hostSt && hostSt.running ? (en ? 'Room live' : 'Sala en el aire') : (en ? 'Interno and friendly rooms' : 'Salas de interno y amistoso');
  if (view === 'informes') return en ? 'From any replay' : 'Desde cualquier replay';
  if (view === 'aspecto') return en ? 'Theme, colours and layout' : 'Tema, colores e interfaz';
  return en ? 'Client, network and controls' : 'Cliente, red y controles';
}

function paintHub() {
  const grid = $('#hubGrid');
  if (!grid || !state.config) return;
  const en = isEn();
  $('#hubTitle').textContent = en ? 'Home' : 'Inicio';
  const nick = state.config.general && state.config.general.nickname;
  $('#hubSub').textContent = nick ? (en ? `Welcome, ${nick}` : `Bienvenido, ${nick}`) : (en ? 'Pick where to go' : 'Elegí a dónde ir');
  const nTiles = navDests().length;
  $('#hubHint').textContent = en ? `Arrow keys + Enter, or numbers 1–${nTiles}. Esc to go back.` : `Flechas y Enter, o los números 1 a ${nTiles}. Esc para volver.`;
  const tiles = [];
  const last = $('#lastRoom');
  if (last && !last.hidden) {
    tiles.push({ wide: true, title: en ? 'Back to your last room' : 'Volver a tu última sala', sub: ($('#lastRoomName').textContent || '').trim(), icon: last.querySelector('svg') && last.querySelector('svg').cloneNode(true), run: () => last.click() });
  }
  navDests().forEach((d, i) => tiles.push({ title: en ? d.en : d.es, sub: hubSub(d.view, en), icon: navIcon(d.view), key: String(i + 1), run: () => goView(d.view) }));
  const cap = $('#captainBtn');
  if (cap && !cap.hidden) tiles.push({ title: en ? 'Captain' : 'Capitán', sub: en ? 'Club admin' : 'Administración del club', icon: cap.querySelector('svg') && cap.querySelector('svg').cloneNode(true), run: () => cap.click() });
  grid.replaceChildren(...tiles.map((tile, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile' + (tile.wide ? ' tile--wide' : '');
    b.style.setProperty('--i', String(i));
    const ico = document.createElement('span');
    ico.className = 'tile__ico';
    if (tile.icon) ico.append(tile.icon);
    const txt = document.createElement('span');
    txt.className = 'tile__txt';
    const t1 = document.createElement('b');
    t1.textContent = tile.title;
    const t2 = document.createElement('small');
    t2.textContent = tile.sub || '';
    txt.append(t1, t2);
    b.append(ico, txt);
    if (tile.key) { const k = document.createElement('kbd'); k.textContent = tile.key; b.append(k); b.dataset.key = tile.key; }
    b.addEventListener('click', () => { tile.run(); });
    return b;
  }));
}

function openHub(on) {
  const hub = $('#hub');
  if (!hub) return;
  state.hub = !!on && layoutIs('consola') && state.stage !== 'game';
  hub.hidden = !state.hub;
  document.documentElement.dataset.hub = state.hub ? 'on' : 'off';
  if (state.hub) {
    paintHub();
    if (!(state.replays && Array.isArray(state.replays.items))) { try { loadReplays(); } catch (e) { /* sin lista */ } }
    const first = $('#hubGrid button');
    if (first) first.focus({ preventScroll: true });
  }
  paintNavExtras();
}

/** El botón «Inicio» (Consola) y la pastilla de la paleta (Comando). */
function paintNavExtras() {
  const en = isEn();
  const outside = state.stage !== 'game';
  const hb = $('#hubBtn');
  if (hb) {
    hb.hidden = !(layoutIs('consola') && !state.hub && outside);
    hb.textContent = en ? '⌂  Home' : '⌂  Inicio';
  }
  const cp = $('#cmdPill');
  if (cp) {
    cp.hidden = !(layoutIs('comando') && outside);
    $('#cmdPillText').textContent = en ? 'Go to…' : 'Ir a…';
  }
}
$('#hubBtn').addEventListener('click', () => openHub(true));
$('#cmdPill').addEventListener('click', () => openCmd(true));

/* La paleta. Filtra por lo que escribas (sin tildes ni mayúsculas). */
const cmdState = { open: false, items: [], idx: 0 };
const fold = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function cmdEntries() {
  const en = isEn();
  const out = navDests().map((d) => ({ label: en ? d.en : d.es, hint: en ? 'Go to' : 'Ir a', icon: navIcon(d.view), run: () => goView(d.view) }));
  const last = $('#lastRoom');
  if (last && !last.hidden) out.unshift({ label: en ? 'Back to your last room' : 'Volver a tu última sala', hint: ($('#lastRoomName').textContent || '').trim(), icon: last.querySelector('svg') && last.querySelector('svg').cloneNode(true), run: () => last.click() });
  out.push({ label: en ? 'Create a room' : 'Crear sala', hint: en ? 'Action' : 'Acción', run: () => { goView('play'); const c = $('#actCreate'); if (c) c.click(); } });
  out.push({ label: en ? 'Open replays folder' : 'Abrir carpeta de replays', hint: en ? 'Action' : 'Acción', run: () => { tvm.replays.openFolder(); } });
  out.push({ label: en ? 'Toggle full screen' : 'Pantalla completa', hint: 'F11', run: () => { tvm.window.toggleFullscreen(); } });
  const cur = (state.config && state.config.appearance.layout) || 'classic';
  for (const l of LAYOUTS) {
    if (l.id === cur) continue;
    out.push({ label: `${en ? 'Interface' : 'Interfaz'}: ${en ? l.en : l.es}`, hint: en ? 'Change layout' : 'Cambiar interfaz', run: () => patchConfig({ appearance: { layout: l.id } }) });
  }
  return out;
}

function paintCmd() {
  const q = fold($('#cmdkInput').value.trim());
  cmdState.items = cmdEntries().filter((e) => !q || fold(`${e.label} ${e.hint}`).includes(q));
  cmdState.idx = Math.min(cmdState.idx, Math.max(0, cmdState.items.length - 1));
  const list = $('#cmdkList');
  if (!cmdState.items.length) {
    const li = document.createElement('li');
    li.className = 'cmdk__empty';
    li.textContent = isEn() ? 'Nothing found' : 'No hay nada con eso';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...cmdState.items.map((e, i) => {
    const li = document.createElement('li');
    li.className = 'cmdk__item' + (i === cmdState.idx ? ' is-on' : '');
    li.dataset.i = String(i);
    const ico = document.createElement('span');
    ico.className = 'cmdk__ico';
    if (e.icon) ico.append(e.icon);
    const lab = document.createElement('b');
    lab.textContent = e.label;
    const hint = document.createElement('small');
    hint.textContent = e.hint || '';
    li.append(ico, lab, hint);
    return li;
  }));
  const on = list.querySelector('.is-on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}

function openCmd(on) {
  cmdState.open = !!on;
  $('#cmdk').hidden = !on;
  if (on) {
    $('#cmdkInput').value = '';
    $('#cmdkInput').placeholder = isEn() ? 'Where to? Type a destination or an action…' : '¿A dónde? Escribí un destino o una acción…';
    cmdState.idx = 0;
    paintCmd();
    $('#cmdkInput').focus();
  }
}
function runCmd(i) {
  const e = cmdState.items[i];
  if (!e) return;
  openCmd(false);
  e.run();
}
$('#cmdkInput').addEventListener('input', () => { cmdState.idx = 0; paintCmd(); });
$('#cmdkScrim').addEventListener('mousedown', () => openCmd(false));
$('#cmdkList').addEventListener('click', (e) => {
  const li = e.target.closest('[data-i]');
  if (li) runCmd(Number(li.dataset.i));
});
$('#cmdkInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdState.idx = Math.min(cmdState.items.length - 1, cmdState.idx + 1); paintCmd(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdState.idx = Math.max(0, cmdState.idx - 1); paintCmd(); }
  else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdState.idx); }
});

window.addEventListener('keydown', (e) => {
  if (cmdState.open && e.key === 'Escape') { e.preventDefault(); openCmd(false); return; }
  if (layoutIs('comando') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCmd(!cmdState.open);
    return;
  }
  if (!state.hub) return;
  if (e.key === 'Escape') { e.preventDefault(); openHub(false); return; }
  const tiles = $$('#hubGrid .tile');
  if (!tiles.length) return;
  const at = tiles.indexOf(document.activeElement);
  const cols = tiles.length > 1 && getComputedStyle($('#hubGrid')).gridTemplateColumns.split(' ').length || 1;
  let next = -1;
  if (e.key === 'ArrowRight') next = at + 1;
  else if (e.key === 'ArrowLeft') next = at - 1;
  else if (e.key === 'ArrowDown') next = at + cols;
  else if (e.key === 'ArrowUp') next = at - cols;
  else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const t = tiles.find((x) => x.dataset.key === e.key);
    if (t) { e.preventDefault(); t.click(); }
    return;
  }
  if (next >= 0) { e.preventDefault(); tiles[Math.max(0, Math.min(tiles.length - 1, next))].focus(); }
}, true);


/* Densidad de la interfaz: sólo espaciado de menús (CSS por `data-density`). */
const DENSITIES = [['compact', 'Compacta', 'Compact'], ['normal', 'Normal', 'Normal'], ['comfy', 'Cómoda', 'Comfortable']];
function paintDensity() {
  const host = $('#denChips');
  if (!host || !state.config) return;
  const en = isEn();
  $('#denTitle').textContent = en ? 'Interface density' : 'Densidad de la interfaz';
  $('#denDesc').textContent = en
    ? 'Tighter or roomier menus. Compact fits more settings on screen. The game is not affected.'
    : 'Menús más apretados o más aireados. Compacta muestra más ajustes por pantalla. No afecta al juego.';
  $('#denLabel').textContent = en ? 'Menu spacing' : 'Espaciado de los menús';
  const cur = state.config.appearance.density || 'normal';
  host.replaceChildren(...DENSITIES.map((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (d[0] === cur ? ' is-active' : '');
    b.dataset.den = d[0];
    b.textContent = en ? d[2] : d[1];
    return b;
  }));
}
$('#denChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-den]');
  if (b) patchConfig({ appearance: { density: b.dataset.den } });
});


/* ── Mezclador de volúmenes ──────────────────────────────────────────────────
 * Todos los volúmenes en un solo lugar. No hay lógica nueva: cada deslizador
 * escribe en la misma clave de config que ya usaba su control de siempre. */
const MIX_CHANNELS = [
  { id: 'menu', es: 'Música del menú', en: 'Menu music', def: 0.35,
    get: (c) => c.appearance.musicVolume,
    live: (v) => { const c = state.config.appearance; if (window.TLMusic) window.TLMusic.configure(c.music !== false, v, c.musicClub !== false); },
    set: (v) => ({ appearance: { musicVolume: v, music: true } }) },
  { id: 'goalsfx', es: 'Sonido de gol incluido', en: 'Built-in goal sound', def: 0.7,
    get: (c) => c.appearance.goalSfxVolume, set: (v) => ({ appearance: { goalSfxVolume: v } }) },
  { id: 'goalown', es: 'Tu sonido de gol', en: 'Your goal sound', def: 0.7,
    get: (c) => c.vip && c.vip.goalVolume, set: (v) => ({ vip: { goalVolume: v } }) },
  { id: 'hit', es: 'Sonido de golpe', en: 'Kick sound', def: 0.7,
    get: (c) => c.vip && c.vip.hitVolume, set: (v) => ({ vip: { hitVolume: v } }) }
];

function paintMixer() {
  const host = $('#mixList');
  if (!host || !state.config) return;
  const en = isEn();
  $('#mixTitle').textContent = en ? 'Volume mixer' : 'Mezclador de volúmenes';
  $('#mixDesc').textContent = en
    ? 'Every volume in one place. They are the same values as in each section.'
    : 'Todos los volúmenes en un solo lugar. Son los mismos valores que en cada sección.';
  if (!host.children.length) {
    for (const ch of MIX_CHANNELS) {
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.mix = ch.id;
      row.innerHTML = '<div class="row__text"><span class="row__label"></span></div><div class="row__ctl"><input type="range" min="0" max="1" step="0.01" /><b class="row__val"></b></div>';
      const input = row.querySelector('input');
      const val = row.querySelector('.row__val');
      input.addEventListener('input', () => {
        syncRangeFill(input);
        val.textContent = `${Math.round(Number(input.value) * 100)}%`;
        if (ch.live) ch.live(Number(input.value));
      });
      input.addEventListener('change', () => { if (ch.set) patchConfig(ch.set(Number(input.value))); });
      if (ch.preview) {
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'btn btn--ghost btn--sm';
        play.textContent = '▶';
        play.title = 'Probar';
        play.addEventListener('click', () => ch.preview());
        row.querySelector('.row__ctl').prepend(play);
      }
      host.append(row);
    }
  }
  for (const ch of MIX_CHANNELS) {
    const row = host.querySelector(`[data-mix="${ch.id}"]`);
    const input = row.querySelector('input');
    row.querySelector('.row__label').textContent = en ? ch.en : ch.es;
    // Sin tocar el que se está arrastrando.
    if (document.activeElement === input) continue;
    const raw = Number(ch.get(state.config));
    const v = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : ch.def;
    input.value = String(v);
    syncRangeFill(input);
    row.querySelector('.row__val').textContent = `${Math.round(v * 100)}%`;
  }
}
