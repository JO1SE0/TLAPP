'use strict';

/**
 * Hostear una sala desde el cliente (modo interno o amistoso).
 *
 * Abre una ventana con la página headless de HaxBall, le inyecta el script de
 * la sala y traduce lo que éste avisa (link, partidos, replays) en callbacks.
 * Una sola sala a la vez. Cerrar la ventana cierra la sala.
 *
 * La página pide un captcha si no hay token: por eso la ventana se muestra
 * hasta que la sala sale al aire, y después se esconde (se puede volver a abrir).
 */

const fs = require('fs');
const path = require('path');

const HEADLESS = 'https://html5.haxball.com/headless';
const BUILTIN = path.join(__dirname, 'host-scripts', 'room.js');
const MAX_SCRIPT = 512 * 1024;
const MAP_KEYS = ['x1', 'x3', 'x4', 'x5', 'x7', 'train'];
const MAP_EXT = ['.hbs', '.json'];
const MAX_MAP = 2 * 1024 * 1024;
const MAX_REPLAY = 40 * 1024 * 1024;

const MODES = new Set(['interno', 'amistoso']);
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

/**
 * La página headless define `HBInit` DESPUÉS de cargar (avisa con
 * `window.onHBLoaded`), así que al «dom-ready» todavía no existe y el script
 * fallaba con un ReferenceError. Se espera a que esté y recién ahí se corre;
 * si algo tira un error, se avisa al cliente con el mensaje real.
 */
function wrap(source) {
  return `(function () {
    var done = false;
    var report = function (e) { try { window.TLHost.emit('error', String(e && e.stack || e).slice(0, 400)); } catch (x) {} };
    var run = function () {
      if (done) return; done = true;
      try {
        (function () {\n${source}\n})();
        if (typeof window.onHBLoaded === 'function' && window.onHBLoaded !== hook) { try { window.onHBLoaded(); } catch (e) { report(e); } }
      } catch (e) { report(e); }
    };
    var prev = window.onHBLoaded;
    var hook = function () { if (typeof prev === 'function') { try { prev(); } catch (e) {} } run(); };
    if (typeof HBInit === 'function') { run(); return; }
    window.onHBLoaded = hook;
    var tries = 0;
    var t = setInterval(function () {
      if (done) { clearInterval(t); return; }
      if (typeof HBInit === 'function') { clearInterval(t); run(); }
      else if (++tries > 240) { clearInterval(t); report('HaxBall no cargó la página headless (¿sin conexión?)'); }
    }, 250);
  })();`;
}

/** Los mapas son archivos x1.hbs, x3.hbs, x4.hbs, x5.hbs, x7.hbs y train.hbs. */
function loadMaps(dirs, picked) {
  const out = {};
  for (const key of MAP_KEYS) {
    const mine = picked && typeof picked[key] === 'string' ? picked[key] : '';
    if (mine && /\.(hbs|json)$/i.test(mine)) {
      try {
        const st = fs.statSync(mine);
        if (st.isFile() && st.size <= MAX_MAP) { out[key] = fs.readFileSync(mine, 'utf8'); continue; }
      } catch { /* el archivo ya no está: se cae a las carpetas */ }
    }
    for (const dir of dirs) {
      let found = false;
      for (const ext of MAP_EXT) {
        try {
          const file = path.join(dir, key + ext);
          const st = fs.statSync(file);
          if (!st.isFile() || st.size > MAX_MAP) continue;
          out[key] = fs.readFileSync(file, 'utf8');
          found = true;
          break;
        } catch { /* no está */ }
      }
      if (found) break;
    }
  }
  return out;
}

function create(deps) {
  const { BrowserWindow, ipcMain, onMatch, onReplay, onState, mapDirs } = deps;
  let win = null;
  let cfg = null;
  let state = { running: false, starting: false, mode: '', size: '', link: '', players: 0, name: '', error: '', custom: false };

  const set = (patch) => { state = { ...state, ...patch }; try { onState && onState({ ...state }); } catch { /* sin panel */ } };

  function sanitize(raw) {
    const r = raw || {};
    const mode = MODES.has(r.mode) ? r.mode : 'amistoso';
    const size = r.size === 'train' && mode !== 'interno' ? 'train' : [1, 3, 4, 5, 7].includes(Number(r.size)) ? Number(r.size) : (mode === 'interno' ? 7 : 3);
    return {
      mode, size,
      name: clean(r.name, 40) || (mode === 'interno' ? 'Interno TL' : 'Amistoso TL'),
      maxPlayers: Math.max(2, Math.min(30, Math.round(Number(r.maxPlayers)) || (typeof size === 'number' ? size * 2 + 4 : 16))),
      password: clean(r.password, 30),
      listed: r.listed !== false,
      adminKey: clean(r.adminKey, 30),
      hostNick: clean(r.hostNick, 25),
      token: clean(r.token, 200),
      record: mode === 'interno' && r.record !== false,
      customPath: clean(r.customPath, 500),
      mapFiles: MAP_KEYS.reduce((o, k) => { const v = r.mapFiles && clean(r.mapFiles[k], 500); if (v) o[k] = v; return o; }, {})
    };
  }

  function readScript(c) {
    if (!c.customPath) return fs.readFileSync(BUILTIN, 'utf8');
    if (!/\.js$/i.test(c.customPath)) throw new Error('El script tiene que ser un archivo .js');
    const st = fs.statSync(c.customPath);
    if (!st.isFile() || st.size > MAX_SCRIPT) throw new Error('El script es demasiado grande o no es un archivo');
    return fs.readFileSync(c.customPath, 'utf8');
  }

  function ours(event) { return !!(win && !win.isDestroyed() && event.sender === win.webContents); }

  ipcMain.on('host:config', (event) => { event.returnValue = ours(event) ? cfg : null; });
  ipcMain.on('host:event', (event, type, data) => {
    if (!ours(event)) return;
    if (type === 'link' && typeof data === 'string') {
      set({ link: data.slice(0, 200), starting: false, running: true, error: '' });
      if (!cfg.token && win) { try { win.hide(); } catch { /* ya cerrada */ } }
    } else if (type === 'error' && typeof data === 'string') {
      set({ error: 'El script falló: ' + data.slice(0, 300), starting: false });
    } else if (type === 'players' && data) {
      set({ players: Math.max(0, Math.min(99, Number(data.count) || 0)) });
    } else if (type === 'mode' && data && typeof data.mode === 'string') {
      set({ size: data.mode.slice(0, 4) });
    } else if (type === 'match' && data && cfg.mode === 'interno' && onMatch) {
      Promise.resolve(onMatch(data)).catch(() => { /* queda en la cola */ });
    } else if (type === 'replay' && data && typeof data.data === 'string' && data.data.length < MAX_REPLAY * 1.4 && onReplay) {
      Promise.resolve(onReplay(clean(data.name, 80), Buffer.from(data.data, 'base64'))).catch(() => { /* sin carpeta */ });
    }
  });

  async function start(raw) {
    if (win && !win.isDestroyed()) throw new Error('Ya hay una sala hosteada. Cerrala primero.');
    const c = sanitize(raw);
    const source = readScript(c);
    cfg = { ...c, maps: loadMaps(mapDirs || [], c.mapFiles) };
    set({ running: false, starting: true, mode: c.mode, size: 'x' + c.size, link: '', players: 0, name: c.name, error: '', custom: !!c.customPath });
    win = new BrowserWindow({
      width: 520, height: 640, show: true, autoHideMenuBar: true, title: 'Sala TL — ' + c.name,
      webPreferences: {
        preload: path.join(__dirname, 'host-preload.js'),
        partition: 'persist:tl-host',
        nodeIntegration: false, contextIsolation: false, sandbox: false,
        backgroundThrottling: false, enableRemoteModule: false
      }
    });
    const mine = win;
    mine.webContents.setWindowOpenHandler && mine.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mine.webContents.on('will-navigate', (e, url) => { if (!/^https:\/\/(www\.)?(html5\.)?haxball\.com\//i.test(url)) e.preventDefault(); });
    mine.webContents.once('dom-ready', () => {
      mine.webContents.executeJavaScript(wrap(source)).catch((err) => set({ error: 'No se pudo iniciar el script: ' + (err && err.message || err), starting: false }));
    });
    mine.on('closed', () => {
      if (win === mine) win = null;
      set({ running: false, starting: false, link: '', players: 0 });
    });
    await mine.loadURL(HEADLESS);
    return { ...state };
  }

  function stop() {
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    set({ running: false, starting: false, link: '', players: 0 });
    return { ...state };
  }

  function show() { if (win && !win.isDestroyed()) { win.show(); win.focus(); } return { ...state }; }

  return { start, stop, show, maps: (picked) => Object.keys(loadMaps(mapDirs || [], picked)), state: () => ({ ...state }), isRunning: () => !!(win && !win.isDestroyed()) };
}

module.exports = { create };
