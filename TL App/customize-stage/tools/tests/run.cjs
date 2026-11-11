/*
 * Pruebas de la interfaz de TL App (sin HaxBall ni Electron).
 *
 * Abre `src/renderer/index.html` en un Chromium con el puente `tvm` simulado y
 * revisa lo que ya se rompió alguna vez:
 *
 *   1. Ninguna pantalla tira errores al abrirse.
 *   2. Auto-entrar: espera, entra cuando hay lugar, y si la sala lo rechaza
 *      vuelve a esperar en vez de rendirse.
 *   3. Las estrellitas de favoritos siguen en todos los ajustes.
 *   4. Ningún botón visible queda sin nombre (accesibilidad).
 *
 * Uso:  node tools/tests/run.cjs     (necesita `playwright` instalado)
 * No va en el instalador: es sólo para desarrollo.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const here = __dirname;
const page = 'file://' + path.resolve(here, '../../src/renderer/index.html');
const fixture = fs.readFileSync(path.join(here, 'fixture-config.js'), 'utf8').replace(/"welcome":true/g, '"welcome":false');
const mock = fs.readFileSync(path.join(here, 'mock-tvm.js'), 'utf8')
  .replace("'rooms.list': () => ({ rooms,", "'rooms.join': (t) => (window.__j=(window.__j||0)+1, { token: t }), 'rooms.list': () => (window.__n=(window.__n||0)+1, window.__free && (rooms[4].players=9), { rooms,");
const tidy = ';setInterval(()=>{for(const s of ["#news","#backcard"]){const e=document.querySelector(s);e&&e.remove()}},50);';

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ' — ' + detail : ''}`); };

async function open(browser, layout) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const cfg = layout ? fixture.replace(/"layout":"[a-z]*"/, `"layout":"${layout}"`) : fixture;
  await p.addInitScript({ content: cfg + mock + tidy });
  await p.goto(page);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const s = document.querySelector('#splash'); if (s) s.remove(); document.querySelector('#startForm').requestSubmit(); });
  await p.waitForTimeout(600);
  return { p, errs };
}

(async () => {
  const browser = await chromium.launch();

  // 1 · Todas las pantallas abren sin errores
  {
    const { p, errs } = await open(browser);
    const views = ['replays', 'club', 'musica', 'aspecto', 'ajustes'];
    for (const v of views) { await p.evaluate((x) => { const e = document.querySelector(`[data-view="${x}"]`); if (e) e.click(); }, v); await p.waitForTimeout(500); }
    check('pantallas sin errores', errs.length === 0, errs.join(' | '));

    // 3 · Favoritos
    const stars = await p.evaluate(() => document.querySelectorAll('#panel .favstar').length);
    check('estrellas de favoritos', stars > 150, `${stars} estrellas`);

    // 4 · Botones con nombre
    const unnamed = await p.evaluate(() => {
      const out = [];
      for (const e of document.querySelectorAll('button,[role=button],a[href]')) {
        if (e.offsetParent === null) continue;
        const name = (e.getAttribute('aria-label') || e.title || e.textContent || '').trim() || e.getAttribute('aria-labelledby');
        if (!name) out.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ')[0]);
      }
      return [...new Set(out)];
    });
    check('botones con nombre', unnamed.length === 0, unnamed.join(', '));
    await p.close();
  }

  // 5 · Interfaz «Vitrina»: tarjetas altas, saludo, y el riel no tapa los paneles
  {
    const { p, errs } = await open(browser, 'vitrina');
    const v = await p.evaluate(() => {
      const row = document.querySelector('#roomList .rrow');
      const hero = document.querySelector('#vHero');
      return { view: document.documentElement.dataset.roomview, h: row ? row.offsetHeight : 0, hero: !!(hero && hero.offsetParent), hi: document.querySelector('#vHeroHi').textContent };
    });
    check('vitrina: salas en tarjetas con saludo', v.view === 'cards' && v.h === 136 && v.hero && /Jefe/.test(v.hi), JSON.stringify(v));
    await p.evaluate(() => { document.querySelector('#roomList .rrow').click(); });
    await p.waitForTimeout(200);
    const sel = await p.evaluate(() => document.querySelector('#vSelName').textContent);
    check('vitrina: la barra de abajo nombra la sala elegida', sel.length > 3 && !/Eleg/.test(sel), sel);
    await p.evaluate(() => document.querySelector('#rail [data-view="ajustes"]').click());
    await p.waitForTimeout(600);
    const gap = await p.evaluate(() => document.querySelector('.panel__card').getBoundingClientRect().left - document.querySelector('.rail').getBoundingClientRect().right);
    check('vitrina: el riel no tapa el panel', gap >= 8, `separación ${Math.round(gap)} px`);
    await p.evaluate(() => { onGameView('room'); });
    await p.waitForTimeout(600);
    const hidden = await p.evaluate(() => document.querySelector('.rail').getBoundingClientRect().right);
    check('vitrina: en la sala el riel se guarda', hidden <= 0, `borde derecho ${Math.round(hidden)}`);
    check('vitrina sin errores', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  // 2 · Auto-entrar
  {
    const { p, errs } = await open(browser);
    await p.evaluate(() => { state.selected = 't4'; window.__n = 0; toggleAutoJoin(); });
    await p.waitForTimeout(7500);
    const a = await p.evaluate(() => ({ n: window.__n, auto: state.autoJoin, j: window.__j || 0 }));
    check('auto-entrar: sigue pidiendo la lista', a.n >= 3 && a.auto === 't4' && a.j === 0, JSON.stringify(a));
    await p.evaluate(() => { window.__free = true; });
    await p.waitForTimeout(3500);
    const b = await p.evaluate(() => ({ j: window.__j || 0, stage: state.stage }));
    check('auto-entrar: entra cuando hay lugar', b.j === 1 && b.stage === 'game', JSON.stringify(b));
    await p.evaluate(() => { onGameView('connecting'); onGameView('disconnected'); });
    await p.waitForTimeout(300);
    const c = await p.evaluate(() => ({ auto: state.autoJoin, stage: state.stage }));
    check('auto-entrar: si la sala rechaza, vuelve a esperar', c.auto === 't4' && c.stage === 'browser', JSON.stringify(c));
    await p.waitForTimeout(3500);
    await p.evaluate(() => { onGameView('room'); });
    await p.waitForTimeout(3500);
    const d = await p.evaluate(() => ({ j: window.__j || 0, auto: state.autoJoin }));
    check('auto-entrar: adentro, deja de insistir', d.j === 2 && d.auto === null, JSON.stringify(d));
    check('auto-entrar sin errores', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} pruebas pasaron`);
  process.exit(failed ? 1 : 0);
})();
