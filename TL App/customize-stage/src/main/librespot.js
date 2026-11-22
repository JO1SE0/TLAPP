'use strict';

/*
 * Spotify sonando en la TL App, sin abrir Spotify.
 *
 * Se usa librespot (bin/librespot.exe, lo compila el workflow «Armar
 * librespot» del repo): un programa que aparece en tu cuenta como un
 * dispositivo más de Spotify, llamado «TL App», y reproduce el audio él
 * mismo. La app lo arranca escondido cuando hace falta, la API web le pasa la
 * música (spotify-api.js, `wake`) y se cierra con la app.
 *
 * La primera vez pide entrar con la cuenta: se abre el navegador y, después,
 * la sesión queda guardada en la carpeta de datos de la app.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const NAME = 'TL App';
let app = null;
let shell = null;
let note = () => {};
let proc = null;
let lastUrl = '';
let lastErr = '';

const exe = () => path.join(__dirname, '..', '..', 'bin', process.platform === 'win32' ? 'librespot.exe' : 'librespot');
const cacheDir = () => path.join(app.getPath('userData'), 'librespot');
const credsFile = () => path.join(cacheDir(), 'credentials.json');
const logFile = () => path.join(cacheDir(), 'registro.txt');

/*
 * Todo lo que dice el reproductor queda en «librespot/registro.txt» (carpeta
 * de datos de la app): si algo no suena, ahí está el porqué. Se corta solo
 * para no crecer. Las advertencias y errores van también al registro de la app.
 */
let logBytes = 0;
function logLine(text) {
  try {
    if (logBytes === 0) { try { if (fs.statSync(logFile()).size > 400000) fs.writeFileSync(logFile(), ''); } catch { /* nuevo */ } }
    fs.appendFile(logFile(), text.endsWith('\n') ? text : `${text}\n`, () => {});
    logBytes += text.length;
  } catch { /* sin disco */ }
}

function available() {
  try { return fs.existsSync(exe()); } catch { return false; }
}
function loggedIn() {
  try { return fs.existsSync(credsFile()); } catch { return false; }
}
function running() { return !!(proc && proc.exitCode === null && !proc.killed); }

function status() {
  return { available: available(), running: running(), loggedIn: loggedIn(), name: NAME, error: lastErr };
}

/** Arranca el reproductor (si no está andando ya). */
function start() {
  if (running()) return status();
  if (!available()) { const e = new Error('Falta el reproductor de Spotify en la app'); e.code = 'missing'; throw e; }
  fs.mkdirSync(cacheDir(), { recursive: true });
  const args = [
    '--name', NAME,
    '--device-type', 'computer',
    '--bitrate', '320',
    '--cache', cacheDir(),
    '--system-cache', cacheDir(),
    '--enable-volume-normalisation',
    '--initial-volume', '70',
    '--backend', 'rodio',
    '--verbose',
    '--disable-discovery'
  ];
  // Sin sesión guardada: entrar con la cuenta en el navegador (una sola vez).
  if (!loggedIn()) args.push('--enable-oauth');
  lastErr = '';
  lastUrl = '';
  logLine(`\n=== ${new Date().toISOString()} arranca: librespot ${args.join(' ')}`);
  proc = spawn(exe(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // Prioridad baja: el audio pesa poquito y nunca le saca procesador al juego.
  try { require('os').setPriority(proc.pid, require('os').constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* sin permiso */ }
  const read = (buf) => {
    const text = String(buf);
    const m = text.match(/https:\/\/accounts\.spotify\.com\/[^\s"']+/);
    if (m && m[0] !== lastUrl) {
      lastUrl = m[0];
      try { shell.openExternal(m[0]); } catch { /* sin navegador */ }
    }
    logLine(text);
    for (const line of text.split(/\r?\n/)) {
      if (/\b(ERROR|WARN)\b/.test(line)) { lastErr = line.trim().slice(0, 200); if (/ERROR/.test(line)) note(`librespot: ${lastErr}`); }
    }
  };
  proc.stdout.on('data', read);
  proc.stderr.on('data', read);
  proc.on('exit', (code) => {
    if (code) note(`librespot terminó con código ${code}${lastErr ? `: ${lastErr}` : ''}`);
    proc = null;
  });
  proc.on('error', (e) => { lastErr = e.message; note(`librespot no arrancó: ${e.message}`); proc = null; });
  return status();
}

function stop() {
  if (proc) { try { proc.kill(); } catch { /* ya cerrado */ } }
  proc = null;
  return status();
}

/** Cerrar sesión del reproductor: se borra lo guardado y se para. */
function logout() {
  stop();
  try { fs.rmSync(cacheDir(), { recursive: true, force: true }); } catch { /* nada guardado */ }
  return status();
}

function register(handle, electronApp, electronShell, log) {
  app = electronApp;
  shell = electronShell;
  if (typeof log === 'function') note = log;
  handle('lsp:status', () => status());
  handle('lsp:start', () => start());
  handle('lsp:stop', () => stop());
  handle('lsp:logout', () => logout());
  app.on('before-quit', () => stop());
}

module.exports = { register, start, stop, status, available, running, NAME };
