/*
 * Pruebas de lo que vive DENTRO del juego (sin HaxBall ni Electron).
 *
 * Cada prueba arma la parte real del código (se recorta de game-preload.js,
 * look.js, etc.) con lo mínimo de alrededor y compara con lo esperado. Cubre lo
 * que ya se rompió alguna vez sin que se viera en una captura:
 *
 *   · La pastilla de arriba a la derecha: exactamente sonido, Menu y TL, del
 *     mismo tamaño y con el ícono centrado, con CADA tema (el engranaje volvió
 *     a aparecer como un cuadrado blanco por una regla de un tema).
 *   · El menú de TL: cada control manda un cambio que main acepta; abre, cierra
 *     (botón, click afuera, Esc), no se queda con el teclado; Deshacer en orden
 *     y guardado entre cargas.
 *   · El mapa chico: dibuja, se hace transparente, gira como la cancha.
 *   · El sonido de patada: falseo, patadas rápidas, confirmadas.
 *   · Las pelotas 3D: los 34 estilos con modelo y sin valores rotos.
 *   · La lista blanca de main y el caché del parche.
 *
 * Si está la variable HB_BUNDLE (ruta a un game-min.js de HaxBall) también se
 * prueba el parche del juego entero. El bundle no va en el repo.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const SRC = path.resolve(__dirname, '../../src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const between = (s, a, b) => { const i = s.indexOf(a); const j = s.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error(`no se encontró «${a.slice(0, 40)}»`); return s.slice(i, j); };

/** Carga un módulo de main con Electron simulado (store, themes). */
function loadMain(file) {
  const orig = Module._load;
  Module._load = function (r) {
    if (r === 'electron') return { app: { getPath: () => require('os').tmpdir(), isPackaged: false, getVersion: () => '0' } };
    return orig.apply(this, arguments);
  };
  try { return require(path.join(SRC, 'main', file)); } finally { Module._load = orig; }
}

const GP = read('main/game-preload.js');
const QM_CODE = between(GP, 'const QM_TEXTURES', '/* ------------------------------------------------------------------ *\n * Mapa chico');
const MINI_CODE = between(GP, 'const MINI_W = 220', '/* ------------------------------------------------------------------ *\n * Reproducción de replays');
const DISC_NAMES = between(GP, 'const DISC_NAMES = ', ';\n') + ';';
const KICK_CODE = between(GP, '  const F = () => view.__tvmF || {};', '  /*\n   * La sala de verdad.');
const MAIN = read('main/main.js');
const QUICK_CODE = between(MAIN, 'const QUICK_KEYS', "listen('game:quick-set'");
const cleanQuick = new Function(QUICK_CODE + ';return cleanQuick;')();

const HB_TEMPLATE = "<div class='game-view' tabindex='-1'><div class='buttons'><div class='sound-button-container' data-hook='sound'><div class='sound-slider' data-hook='sound-slider'><div class='sound-slider-bar-bg'><div class='sound-slider-bar'></div></div></div><button data-hook='sound-btn'><i class='icon-volume-up' data-hook='sound-icon'></i></button></div><button data-hook='menu'><i class='icon-menu'></i>Menu<span class='tooltip'>Toggle room menu [Escape]</span></button><button data-hook='settings'><i class='icon-cog'></i></button></div></div><div class='room-view' style='display:none'><button data-hook='rec-btn' onclick=\"this.classList.toggle('active')\">rec</button></div>";
const HB_CSS = '.game-view{position:absolute;inset:0}.game-view>.buttons{position:absolute;right:0;top:0;display:flex;height:35px}.game-view>.buttons button{background:#244967;color:#fff;font:bold 15px sans-serif;border:0;padding:0 10px}.sound-slider{display:none}.tooltip{display:none}';

function menuPage(config, themeCss) {
  return `<!doctype html><html><head><style>${HB_CSS}</style><style id="th">${themeCss || ''}</style></head>
<body style="margin:0;width:1280px;height:900px;background:#4a5a3e">${HB_TEMPLATE}
<script>
const state={config:${JSON.stringify(config)}};
let snd=1;document.querySelector('[data-hook=sound-btn]').onclick=()=>{snd=snd?0:1};
const gameSoundLevel=()=>snd;
window.SENT=[];
const ipcRenderer={send:(c,p)=>{window.SENT.push([c,JSON.stringify(p)]);if(c==='game:quick-set'){for(const g in p)Object.assign(state.config[g],p[g]);refreshQuickMenu();}}};
const assetUrl=()=>'';const safe=(f,...a)=>{try{return f(...a)}catch(e){console.error(e.message)}};
function syncMinimap(){}
let ownDraw=0;
const lookfx={ballOverlay(g){g.fillStyle='#888';g.fill();}};
const discArt={has:(s)=>s!=='default',paint(g){g.fillStyle='#246';g.fillRect(20,20,24,24);}};
${DISC_NAMES}
${QM_CODE}
installQuickMenu(document);
</script></body></html>`;
}

module.exports = async function runGameChecks(check, browser) {
  const store = loadMain('store.js');
  const themes = loadMain('themes.js');
  const D = JSON.parse(JSON.stringify(store.DEFAULTS));
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tl-game-'));
  const write = (name, html) => { const f = path.join(tmp, name); fs.writeFileSync(f, html); return 'file://' + f; };

  /* ── La pastilla con cada tema ─────────────────────────────────── */
  {
    const p = await browser.newPage({ viewport: { width: 1280, height: 600 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(write('pill.html', menuPage(D, '')));
    const bad = [];
    for (const id of Object.keys(themes.BUILT_IN)) {
      let css = '';
      try { css = themes.gameCss(themes.palette(id), { hudScale: 1.3 }); } catch (e) { bad.push(`${id}: ${e.message}`); continue; }
      await p.evaluate((c) => { document.getElementById('th').textContent = c; }, css);
      const r = await p.evaluate(() => {
        const btns = [...document.querySelectorAll('.game-view>.buttons button')].filter((b) => getComputedStyle(b).display !== 'none');
        return {
          names: btns.map((b) => b.dataset.hook || (b.classList.contains('tvm-qm-btn') ? 'tl' : '?')).join(','),
          sizes: [...new Set(btns.map((b) => Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)))].join('|'),
          off: Math.max(...btns.map((b) => { const i = b.querySelector('i,svg'); const a = b.getBoundingClientRect(); const c = i.getBoundingClientRect(); return Math.abs(c.left + c.width / 2 - a.left - a.width / 2) + Math.abs(c.top + c.height / 2 - a.top - a.height / 2); })),
          mask: btns.filter((b) => b.querySelector('i')).every((b) => getComputedStyle(b.querySelector('i')).webkitMaskImage.startsWith('url('))
        };
      });
      if (r.names !== 'sound-btn,menu,tl' || r.sizes !== '32x28' || r.off > 0.6 || !r.mask) bad.push(`${id}: ${JSON.stringify(r)}`);
    }
    check('pastilla: sonido, Menu y TL iguales y centrados con los 17 temas', bad.length === 0 && errs.length === 0, bad.concat(errs).join(' | '));
    // Los tres íconos de sonido de HaxBall.
    const icons = await p.evaluate(() => ['icon-volume-up', 'icon-volume-down', 'icon-volume-off'].map((c) => {
      const i = document.querySelector('[data-hook=sound-btn] i'); i.className = c; return getComputedStyle(i).webkitMaskImage.length > 30;
    }));
    check('pastilla: ícono para los tres volúmenes', icons.every(Boolean), JSON.stringify(icons));
    await p.close();
  }

  /* ── El menú de TL ─────────────────────────────────────────────── */
  {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const url = write('menu.html', menuPage(JSON.parse(JSON.stringify(D)), ''));
    await p.goto(url);
    await p.evaluate(() => localStorage.removeItem('tvm_qm_undo'));
    await p.reload();
    await p.click('.tvm-qm-btn');
    const open1 = await p.evaluate(() => !document.querySelector('#tvm-qm .qm-panel').hidden);
    await p.mouse.click(300, 500);
    const closedOut = await p.evaluate(() => document.querySelector('#tvm-qm .qm-panel').hidden);
    await p.click('.tvm-qm-btn');
    await p.keyboard.press('Escape');
    const closedEsc = await p.evaluate(() => document.querySelector('#tvm-qm .qm-panel').hidden);
    await p.click('.tvm-qm-btn');
    await p.click('.tvm-qm-btn');
    const closedBtn = await p.evaluate(() => document.querySelector('#tvm-qm .qm-panel').hidden);
    check('menú: abre y cierra (botón, click afuera, Esc)', open1 && closedOut && closedEsc && closedBtn, JSON.stringify({ open1, closedOut, closedEsc, closedBtn }));

    // Cada pestaña y, en cada una, cada control (en las tiras, el segundo y el
    // primero de la lista); nada se queda con el foco del teclado.
    await p.click('.tvm-qm-btn');
    const tabNames = await p.$$eval('#tvm-qm .qm-tab', (b) => b.map((x) => x.textContent));
    const tabsOk = tabNames.join(',') === 'Vista,Fichas,Pelota,Sonido,Partido';
    let clicked = 0;
    let oneVisible = true;
    for (let ti = 0; ti < tabNames.length; ti++) {
      await (await p.$$('#tvm-qm .qm-tab'))[ti].click();
      const vis = await p.$$eval('#tvm-qm .qm-pane', (ps) => ps.filter((x) => !x.hidden).length);
      if (vis !== 1) oneVisible = false;
      const sel = '#tvm-qm .qm-pane:not([hidden]) :is(.qm-tg, .qm-seg b, .qm-sw i)';
      const n = await p.evaluate((s) => document.querySelectorAll(s).length, sel);
      for (let k = 0; k < n; k++) {
        const els = await p.$$(sel);
        if (k >= els.length || !(await els[k].isVisible())) continue;
        await els[k].scrollIntoViewIfNeeded();
        await els[k].click();
        clicked++;
      }
      for (const st of await p.$$('#tvm-qm .qm-pane:not([hidden]) .qm-strip')) {
        const its = await st.$$('.qm-it');
        for (const it of [its[1], its[0]]) { if (!it) continue; await it.scrollIntoViewIfNeeded(); await it.click(); clicked++; }
      }
      for (const sl of await p.$$('#tvm-qm .qm-pane:not([hidden]) .qm-sl')) {
        if (!(await sl.isVisible())) continue;
        await sl.scrollIntoViewIfNeeded();
        const bb = await sl.boundingBox();
        await p.mouse.move(bb.x + 4, bb.y + 9); await p.mouse.down(); await p.mouse.move(bb.x + bb.width * 0.9, bb.y + 9, { steps: 4 }); await p.mouse.up();
        clicked++;
      }
    }
    check('menú: cinco pestañas y un grupo a la vista por vez', tabsOk && oneVisible, `${tabNames.join(',')} · uno por vez: ${oneVisible}`);
    const sent = await p.evaluate(() => window.SENT.filter((x) => x[0] === 'game:quick-set').map((x) => x[1]));
    const rejected = sent.map(JSON.parse).filter((pt) => JSON.stringify(cleanQuickWrap(pt)) !== JSON.stringify(pt));
    function cleanQuickWrap(pt) { return cleanQuick(pt); }
    // Lo que importa: que el foco nunca quede DENTRO del menú (las flechas son del juego).
    const focus = await p.evaluate(() => { const a = document.activeElement; return a && document.getElementById('tvm-qm').contains(a) ? 'menú: ' + a.tagName + '.' + a.className : 'fuera'; });
    check('menú: cada control manda un cambio que main acepta', clicked > 40 && sent.length >= clicked - 2 && rejected.length === 0, `${clicked} tocados, ${sent.length} enviados${rejected.length ? ', rechazados: ' + rejected.map((x) => JSON.stringify(x)).join(' ') : ''}`);
    check('menú: no se queda con el teclado', focus === 'fuera', `foco ${focus}`);

    // Deshacer: en orden y guardado.
    const stack = await p.evaluate(() => JSON.parse(localStorage.getItem('tvm_qm_undo') || '[]').length);
    await p.reload();
    await p.click('.tvm-qm-btn');
    const after = await p.evaluate(() => ({ label: document.querySelector('#tvm-qm .qm-undo').title, dis: document.querySelector('#tvm-qm .qm-undo').disabled }));
    check('menú: Deshacer queda guardado al recargar', stack === 30 && !after.dis && /Deshacer «/.test(after.label), `${stack} guardados, botón «${after.label}»`);
    let undone = 0;
    while (!(await p.evaluate(() => document.querySelector('#tvm-qm .qm-undo').disabled)) && undone < 40) { await p.click('#tvm-qm .qm-undo'); undone++; }
    const left = await p.evaluate(() => JSON.parse(localStorage.getItem('tvm_qm_undo') || '[]').length);
    check('menú: Deshacer se vacía de a uno', undone === 30 && left === 0, `${undone} deshechos, quedan ${left}`);
    check('menú: sin errores', errs.length === 0, errs.slice(0, 3).join(' | '));
    await p.close();
  }

  /* ── El mapa chico ─────────────────────────────────────────────── */
  {
    const html = `<!doctype html><html><body style="margin:0;width:1280px;height:720px;background:#3d6e36">
<canvas id="g" width="1280" height="720" style="width:1280px;height:720px;position:absolute;left:0;top:0"></canvas>
<script>
const state={config:{pitch:{minimap:true}}};const safe=(f,...a)=>{try{return f(...a)}catch(e){console.error(e.message)}};
const gameDocument=()=>document;const gameWindow=()=>window;const myNick=()=>'Yo';const canonicalTeam=(s)=>s;
const currentStadium={};const pitchBounds=()=>({halfW:370,halfH:170});const matchGeom=()=>null;const tracker={};const peers=new Map([['Club',{name:'Club'}]]);
${MINI_CODE}
const f={world:'w',discs:'d',pos:'p',players:'pl',disc:'di',team:'t',name:'n'};
const mk=(n,team,x,y)=>({n,t:{n:team},di:{p:{x,y}}});
window.players=[mk('Yo','Red',-100,20),mk('Club','Red',-200,-80),mk('Ri','Blue',150,40),mk('Va','Blue',260,-60)];
window.room={pl:players};window.match={w:{d:[{p:{x:-30,y:10}}]}};
const g=document.getElementById('g').getContext('2d');g.setTransform(1.4,0,0,1.4,640,360);
window.__tvmView=g.getTransform();window.__tvmViewCv=document.getElementById('g');
window.tick=()=>{minimap.at=0;minimapTick(f,room,match);};
window.topColor=()=>{const c=minimap.cv,x=c.getContext('2d');const d=x.getImageData(0,0,c.width,c.height/2).data;let b=0,r=0;for(let i=0;i<d.length;i+=4){if(d[i+2]>200&&d[i]<120)b++;if(d[i]>200&&d[i+2]<140&&d[i+1]<140)r++}return b>r?'azul':'rojo'};
syncMinimap();
</script></body></html>`;
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(write('mini.html', html));
    const r = await p.evaluate(() => {
      const out = {};
      tick(); tick();
      out.visible = !minimap.el.hidden && minimap.cv.width > 0;
      players[3].di.p = { x: 400, y: 200 }; window.__tvmView = document.getElementById('g').getContext('2d').getTransform(); tick();
      out.fade = minimap.el.classList.contains('fade');
      players[3].di.p = { x: 260, y: -60 }; tick(); tick();
      out.unfade = !minimap.el.classList.contains('fade');
      window.__tvmVertOn = true; window.__tvmRot = -Math.PI / 2; tick(); out.red = topColor();
      window.__tvmRot = Math.PI / 2; tick(); out.blue = topColor();
      window.__tvmVertOn = false; window.__tvmRot = 0;
      for (const st of ['grass', 'dark', 'lines']) { state.config.pitch.miniStyle = st; syncMinimap(); tick(); }
      for (const c of ['br', 'bl', 'tl']) { state.config.pitch.miniCorner = c; syncMinimap(); tick(); out[c] = Math.round(minimap.el.getBoundingClientRect().left) < 640 ? 'izq' : 'der'; }
      state.config.pitch.minimap = false; syncMinimap(); out.off = !document.getElementById('tvm-mini');
      return out;
    });
    check('mapa chico: dibuja, se hace transparente y vuelve', r.visible && r.fade && r.unfade, JSON.stringify(r));
    check('mapa chico: en la vertical gira como la cancha (rojo y azul)', r.red === 'azul' && r.blue === 'rojo', `rojo ve arriba al ${r.red}, azul ve arriba al ${r.blue}`);
    check('mapa chico: esquinas, estilos y apagado', r.br === 'der' && r.bl === 'izq' && r.tl === 'izq' && r.off && errs.length === 0, JSON.stringify(r) + errs.join(' | '));
    await p.close();
  }

  /* ── El sonido de patada (simulado en Node) ────────────────────── */
  {
    const run = (scenario) => {
      let t = 0; const timers = []; const sounds = [];
      const env = {
        view: { __tvmF: { playerId: 'Z', disc: 'I', pos: 'a', radius: 'V', world: 'va', discs: 'H', game: 'M', matchRoom: 'Sa', clock: 'Nc', kickKey: 1 }, __tvmKickDefault: () => sounds.push(t), localStorage: { getItem: () => '0' }, document: {} },
        lastRenderer: { __tvmMe: { Z: 7 } }, real: { room: { id: 'real' } },
        replaySeeking: () => false, playHitSound: () => { sounds.push(t); return true; },
        liveSettings: () => null, realKick: () => {}, realActive: () => false, soundHookSeen: false, log: () => {},
        performance: { now: () => t },
        setTimeout: (fn, ms) => { timers.push({ at: t + ms, fn }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; }
      };
      const view = new Function(...Object.keys(env), KICK_CODE + '; return view;')(...Object.values(env));
      view.__tvmRoom = () => {};
      const tick = (ms) => { t += ms; for (const x of timers) if (x.fn && x.at <= t) { const f = x.fn; x.fn = null; f(); } };
      const mk = (ballX, clock, copy = true) => ({ player: { Z: 7, I: { a: { x: 0, y: 0 }, V: 15 } }, match: { Sa: copy ? { id: 'copy' } : env.real.room, Nc: clock, va: { H: [{ a: { x: ballX, y: 0 }, V: 10 }] } } });
      const key = (d) => view.__tvmKickKey(d ? 16 : 0);
      t = 500; scenario({ view, tick, mk, key });
      return sounds.map((x) => Math.round(x - 500));
    };
    const F = 1 / 60;
    const normal = run(({ view, tick, mk, key }) => { key(true); tick(16); for (let i = 0; i < 5; i++) { const k = mk(25, 10); view.__tvmKickAt(k.player, k.match); tick(16); } key(false); tick(80); const c = mk(25, 10, false); view.__tvmKick(c.player, { M: c.match }); });
    const falseo = run(({ view, tick, mk, key }) => { key(true); tick(16); for (let i = 0; i < 4; i++) { const k = mk(28.5, 20); view.__tvmKickAt(k.player, k.match); tick(16); } key(false); tick(300); });
    const borde = run(({ view, tick, mk, key }) => { key(true); tick(16); const k = mk(28.5, 30); view.__tvmKickAt(k.player, k.match); tick(16); key(false); tick(70); const c = mk(28.5, 30, false); view.__tvmKick(c.player, { M: c.match }); });
    const rapidas = run(({ view, tick, mk, key }) => { for (let n = 0; n < 5; n++) { key(true); for (let i = 0; i < 2; i++) { const k = mk(25, 50 + n * 6 * F); view.__tvmKickAt(k.player, k.match); tick(16); } key(false); tick(68); } for (let n = 0; n < 5; n++) { const c = mk(25, 50 + n * 6 * F, false); view.__tvmKick(c.player, { M: c.match }); } });
    const host = run(({ view, mk }) => { const c = mk(25, 90, false); view.__tvmKick(c.player, { M: c.match }); });
    check('patada: suena al instante y una sola vez', normal.length === 1 && normal[0] <= 16, JSON.stringify(normal));
    check('patada: el falseo no suena', falseo.length === 0, JSON.stringify(falseo));
    check('patada: la del borde suena al confirmarse', borde.length === 1, JSON.stringify(borde));
    check('patada: cinco rápidas suenan cada una a tiempo', rapidas.length === 5 && rapidas.every((x, i) => x === i * 100), JSON.stringify(rapidas));
    check('patada: siendo host suena la confirmada', host.length === 1, JSON.stringify(host));
  }

  /* ── Las pelotas 3D ───────────────────────────────────────────── */
  {
    const M = require(path.join(SRC, 'main', 'ball-models.js'));
    const styles = Object.keys(JSON.parse(between(GP, 'const QM_BALLS', '\n').match(/Object\.entries\((\{.*\})\)/)[1]));
    const bad = [];
    for (const st of styles) {
      if (!M.has(st)) { bad.push(`${st}: sin modelo`); continue; }
      // Los de calcomanía reciben la miniatura; acá, un dibujo de prueba (un círculo blanco).
      let deco = null;
      if (M.usesDecal(st)) {
        const S = 64, data = new Uint8ClampedArray(S * S * 4);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = (y * S + x) * 4; const on = Math.hypot(x - 32, y - 32) < 14; data[k] = data[k + 1] = data[k + 2] = on ? 255 : 30; data[k + 3] = 255; }
        deco = { size: S, data };
      }
      const tex = M.bake(st, deco, '#e56b6b');
      if (!tex || tex.data.length !== 6 * M.N * M.N * 3) { bad.push(`${st}: tamaño`); continue; }
      let flat = true; const d = tex.data;
      for (let i = 3; i < d.length; i += 3) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) { flat = false; break; }
      if (flat) bad.push(`${st}: color único`);
    }
    check(`pelotas 3D: los ${styles.length} estilos con modelo y dibujo`, styles.length >= 30 && bad.length === 0, bad.join(', '));
    let worst = 0;
    for (let k = 0; k < 20000; k++) {
      let q = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]; const l = Math.hypot(...q); q = q.map((x) => x / l);
      const [qx, qy, qz] = q; const ax = Math.abs(qx), ay = Math.abs(qy), az = Math.abs(qz); let face, s, t;
      if (ax >= ay && ax >= az) { if (qx > 0) { face = 0; s = -qz / ax; } else { face = 1; s = qz / ax; } t = -qy / ax; } else if (ay >= az) { if (qy > 0) { face = 2; s = qx / ay; t = qz / ay; } else { face = 3; s = qx / ay; t = -qz / ay; } } else if (qz > 0) { face = 4; s = qx / az; t = -qy / az; } else { face = 5; s = -qx / az; t = -qy / az; }
      const dd = M.texelDir(face, s, t); worst = Math.max(worst, Math.hypot(dd[0] - qx, dd[1] - qy, dd[2] - qz));
    }
    const b3 = read('main/ball-3d.js');
    check('pelotas 3D: el mapa se lee igual que se pinta', worst < 1e-9 && b3.includes('function sphereCube'), `error ${worst}`);
  }

  /* ── Lista blanca de main ─────────────────────────────────────── */
  {
    const ok = [{ visual: { pitchLight: 'vignette' } }, { pitch: { minimap: true, miniSize: 1.2 } }, { visual: { ballColor: '#ecd593' } }, { perf: { vertical: true } }];
    const no = [{ visual: { pitchLight: 'disco' } }, { visual: { ballColor: 'red;x' } }, { pitch: { matchSummary: 'si' } }, { perf: { view3d: true } }, { voice: { mode: 'open' } }, { pitch: { miniSize: 9 } }];
    const okR = ok.every((pt) => JSON.stringify(cleanQuick(pt)) === JSON.stringify(pt));
    const noR = no.every((pt) => cleanQuick(pt) === null);
    check('main: acepta lo válido y rechaza lo raro', okR && noR, JSON.stringify({ okR, noR }));
    const missing = [];
    const K = new Function(QUICK_CODE + ';return QUICK_KEYS;')();
    for (const g of Object.keys(K)) for (const k of Object.keys(K[g])) if (!(store.DEFAULTS[g] && k in store.DEFAULTS[g])) missing.push(`${g}.${k}`);
    check('main: cada opción del menú tiene valor de fábrica', missing.length === 0, missing.join(', '));
    {
      const pal = themes.palette('toda');
      const up = themes.gameCss(pal, { scoreboard: 'default', scoreboardScale: 1.3 });
      const down = themes.gameCss(pal, { scoreboard: 'default', scoreboardScale: 1.3, scoreboardPos: 'bottom' });
      const ok = !/order: 9/.test(up) && /transform-origin: top center/.test(up)
        && /order: 9/.test(down) && /bottom: 0 !important/.test(down) && /transform-origin: bottom center/.test(down)
        && D.appearance.scoreboardPos === 'top' && D.visual.pitchBright === 1 && D.visual.pitchContrast === 1
        && /tvm-sb-fixed/.test(GP) && /contrast\(\$\{visual\.contrast/.test(GP);
      check('marcador abajo y brillo/contraste: CSS, valores de fábrica y respaldo', ok);
    }

  /* ── Alrededores de la cancha ─────────────────────────────────── */
  {
    const ENV_SRC = read('main/pitch-env.js');
    const pe = require(path.join(SRC, 'main', 'pitch-env.js'));
    const qm = GP.match(/const QM_ENVS = (\[.*?\]);/);
    const qmIds = qm ? JSON.parse(qm[1].replace(/'/g, '"')).map((x) => x[0]).join(',') : '';
    const okLists = qmIds === pe.ENVS.map((x) => x[0]).join(',')
      && (cleanQuick({ visual: { pitchEnv: 'led' } }) || {}).visual && !(cleanQuick({ visual: { pitchEnv: 'nope' } }) || {}).visual
      && D.visual.pitchEnv === 'none'
      && /ownDraw\+\+;\s*try \{\s*skinPitch\(/.test(GP);
    check('alrededores: misma lista en menú, panel y main; vienen apagados; se dibujan con ownDraw', okLists, `${qmIds} · fábrica ${D.visual.pitchEnv}`);

    const p = await browser.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(write('env.html', `<!doctype html><meta charset="utf-8"><canvas id="c" width="1000" height="600"></canvas><script>const module={exports:{}};${ENV_SRC}</script>`));
    const r = await p.evaluate(() => {
      const E = module.exports;
      const c = document.getElementById('c'), g = c.getContext('2d');
      const out = {};
      for (const [id] of E.ENVS) {
        if (id === 'none') continue;
        for (const flat of [false, true]) {
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.fillStyle = '#718c5a'; g.fillRect(0, 0, 1000, 600);
          g.setTransform(1, 0, 0, 1, 500, 300);
          g.fillStyle = '#3a743a'; g.fillRect(-370, -170, 740, 340);
          const before = g.getImageData(130 + 2, 130 + 2, 736, 336).data.slice();
          const ok = E.paintEnv(g, id, { halfW: 370, halfH: 170 }, { hot: flat, cheer: flat ? 'Red' : null, mirror: flat });
          const after = g.getImageData(130 + 2, 130 + 2, 736, 336).data;
          let changed = 0; for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) { changed++; break; }
          const around = g.getImageData(0, 0, 1000, 120).data; let ink = 0; for (let i = 0; i < around.length; i += 4) if (around[i] !== 0x71) ink++;
          out[id + (flat ? '+' : '')] = { ok, inside: changed, ink: ink > 500 };
        }
      }
      // Desconocido: no dibuja nada.
      out.none = E.paintEnv(g, 'nope', { halfW: 370, halfH: 170 }, {});
      return out;
    });
    const bad = Object.entries(r).filter(([k, v]) => k !== 'none' && !(v.ok && v.inside === 0 && v.ink));
    check('alrededores: las cuatro dibujan afuera y NADA adentro de la cancha (también en gol y espejo)', bad.length === 0 && r.none === false && errs.length === 0, JSON.stringify(bad) + errs.join('|'));
    await p.close();
  }

  /* ── La posesión en el marcador ───────────────────────────────── */
  {
    const CARD = between(GP, 'function newCard()', '/** La distancia recorrida y la posesión');
    const TICK = between(GP, 'function cardTick(card, f, room, advanced)', '/** El identificador de equipo');
    const POSS = between(GP, 'let possAt = 0;', 'function onRealStep(view, room) {');
    const html = `<!doctype html><html><body><div class="game-state-view"><div class="bar">2-1</div></div><script>
      const state = { config: { pitch: {}, appearance: {} } };
      const cardNames = new WeakMap();
      const canonicalTeam = (t) => t;
      const tracker = { card: null };
      ${CARD}
      ${TICK}
      ${POSS}
      tracker.card = newCard();
    </script></body></html>`;
    const p = await browser.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(write('poss.html', html));
    const r = await p.evaluate(() => {
      const c = tracker.card;
      cardTouch(c, 'a', 'Red');
      cardTick(c, { players: 'pl' }, { pl: [] }, 6000);
      cardTouch(c, 'z', 'Blue');
      cardTick(c, { players: 'pl' }, { pl: [] }, 4000);
      paintPossession(document, c);
      const line = document.getElementById('tvm-poss');
      const grow = line ? [line.firstChild.style.flexGrow, line.lastChild.style.flexGrow].join('/') : '';
      state.config.pitch.possessionBar = false; paintPossession(document, c);
      return { grow, inBar: line && line.parentNode.className, off: line && line.hidden };
    });
    check('posesión: cuenta por equipo, línea 60/40 adentro del marcador y se apaga', r.grow === '60/40' && r.inBar === 'bar' && r.off && errs.length === 0, JSON.stringify(r) + errs.join('|'));
    await p.close();
  }
  }

  /* ── Resumen del partido ───────────────────────────────────── */
  {
    // Los dos finales (la sala queda sin partido, o arranca otro en el mismo
    // instante) tienen que pasar por closeMatch, que es la que muestra el resumen.
    const tick = between(GP, '  const match = room[f.game];', '  // El reloj de partido.');
    const calls = (tick.match(/closeMatch\(f, room/g) || []).length;
    check('resumen: los dos finales de partido lo muestran', calls === 2, `${calls} llamadas en el cuadro`);
    const SUM = between(GP, 'const msum', '/** «MM:SS» a partir');
    const html = `<!doctype html><html><body style="margin:0;width:1280px;height:720px;background:#3d6e36">
<script>
const state={config:{pitch:{matchSummary:true},appearance:{}},view:'game'};
const gameDocument=()=>document;const lastScore={red:2,blue:1};const assetUrl=()=>'';const peers=new Map();
const safe=(f,...a)=>{try{return f(...a)}catch(e){console.error(e.message)}};
const matchClock=()=>null;function sendHeatmap(){}const myNick=()=>"Ana";let sharedAvatar="";
window.SENT=[];const ipcRenderer={send:(c,p)=>window.SENT.push(c)};
${SUM}
</script></body></html>`;
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(write('summary.html', html));
    const r = await p.evaluate(async () => {
      const out = {};
      // Sin goles, 95 s jugados (el reloj del HUD ya no está): sale igual.
      summaryReset(); msum.sec = 95; lastScore.red = 0; lastScore.blue = 0;
      closeMatch({}, {}, false);
      out.noGoals = !!document.getElementById('tvm-summary');
      out.sent = window.SENT.join(',');
      document.getElementById('tvm-summary').remove();
      // Con goles y el siguiente ya arrancado: sale y se va antes (6 s).
      summaryReset(); msum.sec = 180; lastScore.red = 2; lastScore.blue = 1;
      summaryGoal({ team: 'Red', scorer: 'Ana', clock: 30, key: 'a' });
      summaryGoal({ team: 'Red', scorer: 'Ana', clock: 90, key: 'b' });
      summaryGoal({ team: 'Blue', scorer: 'Beto', clock: 150, key: 'c' });
      closeMatch({}, {}, true);
      const box = document.getElementById('tvm-summary');
      out.goals = box ? box.querySelectorAll('.ev').length : -1;
      out.score = box ? [...box.querySelectorAll('.mid b')].map((b) => b.textContent).join('-') : '';
      out.mvp = box && box.querySelector('.mv b') ? box.querySelector('.mv b').textContent : '';
      await new Promise((res) => setTimeout(res, 6500));
      out.goneQuick = !document.getElementById('tvm-summary');
      // Apagado en el menú: no sale.
      state.config.pitch.matchSummary = false; summaryReset(); msum.sec = 120; closeMatch({}, {}, false);
      out.off = !document.getElementById('tvm-summary');
      // Partido parado de una (sin goles y < 30 s): no sale.
      state.config.pitch.matchSummary = true; summaryReset(); msum.sec = 8; closeMatch({}, {}, false);
      out.short = !document.getElementById('tvm-summary');
      return out;
    });
    check('resumen: sale también sin goles (con el reloj del motor)', r.noGoals && /game:match-end/.test(r.sent), JSON.stringify(r));
    check('resumen: goles, resultado y figura', r.goals === 3 && r.score === '2-1' && r.mvp === 'Ana', JSON.stringify(r));
    check('resumen: con el partido siguiente ya arrancado se va a los 6 s', r.goals === 3 && r.goneQuick, JSON.stringify(r));
    check('resumen: respeta el apagado y no sale en un partido parado de una', r.off && r.short && errs.length === 0, JSON.stringify(r) + errs.join(' | '));
    await p.close();
  }

  /* ── Panel: el cartel de marcador con vistas previas ─────────── */
  {
    const look = store.DEFAULTS.appearance;
    const pal = themes.palette(look.theme, look.accent, look.customThemes);
    const sbIds = ['default', 'club', 'neon', 'minimal', 'tv', 'match', 'cream', 'split', 'led', 'float', 'outline'];
    const sbcss = {};
    for (const id of sbIds) sbcss[id] = themes.gameCss(pal, { scoreboard: id, hudScale: 1, scoreboardScale: 1 });
    const here = __dirname;
    const fixture = fs.readFileSync(path.join(here, 'fixture-config.js'), 'utf8').replace(/"welcome":true/g, '"welcome":false');
    const mock = fs.readFileSync(path.join(here, 'mock-tvm.js'), 'utf8');
    const tidy = ';setInterval(()=>{for(const s of ["#news","#backcard"]){const e=document.querySelector(s);e&&e.remove()}},50);';
    for (const width of [1400, 980]) {
      const p = await browser.newPage({ viewport: { width, height: 900 } });
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.addInitScript({ content: `window.__SBCSS=${JSON.stringify(sbcss)};` + fixture + mock + tidy });
      await p.goto('file://' + path.resolve(here, '../../src/renderer/index.html'));
      await p.waitForTimeout(1500);
      await p.evaluate(() => { const s = document.querySelector('#splash'); if (s) s.remove(); document.querySelector('#startForm').requestSubmit(); });
      await p.waitForTimeout(600);
      await p.evaluate(() => { const pg = document.querySelector('#scoreboardChips').closest('.page').dataset.page; goToSection(pg, 'hudpartida'); });
      await p.waitForTimeout(1200);
      const r = await p.evaluate(() => {
        const card = document.querySelector('[data-sec="hudpartida"]').getBoundingClientRect();
        const lab = document.querySelector('#scoreboardLabel').getBoundingClientRect();
        const items = [...document.querySelectorAll('#scoreboardChips .sbprev')];
        const rects = items.map((e) => e.getBoundingClientRect());
        const styled = items.filter((e) => /\.bar/.test(e.querySelector('iframe').srcdoc)).length;
        return {
          n: items.length, styled,
          out: rects.filter((i) => i.right > card.right + 0.5 || i.left < card.left - 0.5).length,
          overlap: rects.filter((i) => !(i.top >= lab.bottom || i.bottom <= lab.top || i.left >= lab.right || i.right <= lab.left)).length
        };
      });
      check(`panel: marcador con ${r.n} vistas previas, sin salirse ni pisar el título (${width} px)`, r.n === 11 && r.styled === 11 && r.out === 0 && r.overlap === 0 && errs.length === 0, JSON.stringify(r) + errs.join(' | '));
      if (width === 1400) {
        await p.click('#scoreboardChips .sbprev[data-sb="neon"]');
        await p.waitForTimeout(400);
        const sel = await p.evaluate(() => [state.config.appearance.scoreboard, (document.querySelector('#scoreboardChips .is-active') || {}).dataset]);
        check('panel: tocar una vista previa elige ese marcador', sel[0] === 'neon' && sel[1] && sel[1].sb === 'neon', JSON.stringify(sel));
        await p.$eval('[data-sec="hudpartida"]', (e) => e.scrollIntoView());
        await p.waitForTimeout(300);
        await (await p.$('[data-sec="hudpartida"]')).screenshot({ path: path.join(tmp, 'marcadores.png') });
        process.env.TL_SB_SHOT = path.join(tmp, 'marcadores.png');
      }
      await p.close();
    }
  }

  /* ── El parche del juego (si hay un bundle a mano) ───────────── */
  const bundle = process.env.HB_BUNDLE;
  if (bundle && fs.existsSync(bundle)) {
    const gp = require(path.join(SRC, 'main', 'game-patch.js'));
    const src = fs.readFileSync(bundle, 'utf8');
    const r = gp.patch(src, { lang: 'es' });
    let out = require(path.join(SRC, 'main', 'disc-share-patch.js')).patchDiscShare(r.source).source;
    const v = require(path.join(SRC, 'main', 'vertical-patch.js')).patchVertical(out);
    let compiles = true; try { new Function(v.source); } catch (e) { compiles = false; }
    const fields = (v.source.match(/__tvmF=(\{[^;]*\});/) || [])[1];
    const F2 = fields ? JSON.parse(fields) : {};
    const missingP = /sin aplicar: (.*)\)$/.exec(r.reason);
    check('parche: todo aplicado, vertical enganchada y compila', r.applied && !missingP && v.applied && compiles, missingP ? missingP[1] : `vertical ${v.applied}, compila ${compiles}`);
    check('parche: reloj y tecla de patear publicados', F2.clock && F2.kickKey === 1 && F2.playerId, JSON.stringify({ clock: F2.clock, kickKey: F2.kickKey }));
    // Caché vieja: se rearma al arrancar.
    const dir = path.join(tmp, 'cache');
    gp.saveCache(dir, 'https://x/game-min.js', r.source, 'es', src);
    for (const name of fs.readdirSync(dir)) { const f = path.join(dir, name); const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.v = 1; fs.writeFileSync(f, JSON.stringify(j)); }
    const made = gp.repatchStale(dir, 'es');
    check('parche: la caché de una versión vieja se rearma', made === 1 && gp.loadCache(dir, 'es').size === 1, `rearmadas ${made}`);
  } else {
    console.log('(sin HB_BUNDLE: no se prueba el parche del juego entero)');
  }
};
