'use strict';

/* ------------------------------------------------------------------ *
 * Cliente de Discord RPC, propio
 * ------------------------------------------------------------------ *
 * Reemplaza a `@xhayper/discord-rpc`, que pide Node ≥ 20 y no carga en el Node
 * que trae Electron 13 (falla con `node:crypto`); en Electron 20 falla con
 * `ReadableStream is not defined`. Como el cliente bajó de versión de Electron
 * para poder entregar cuadros por encima del refresco, la librería quedó fuera.
 *
 * No es una pérdida: de toda la librería usábamos cinco cosas —conectar,
 * avisar cuando está lista, publicar actividad, y cerrar—, y el protocolo es
 * simple y estable desde hace años.
 *
 * ── El protocolo ────────────────────────────────────────────────────────
 *
 * Discord escucha en un named pipe local. En Windows es
 * `\\.\pipe\discord-ipc-N`, con N de 0 a 9 (hay varios por si corren varias
 * instancias); en Linux y macOS es un socket unix en el directorio temporal.
 *
 * Cada mensaje es: opcode (uint32 LE) · largo (uint32 LE) · JSON utf8.
 *
 *   0 HANDSHAKE   { v: 1, client_id }
 *   1 FRAME       comandos y respuestas
 *   2 CLOSE
 *   3 PING        hay que contestar con PONG o Discord corta
 *   4 PONG
 *
 * El saludo se contesta con un FRAME `evt: "READY"`. A partir de ahí se manda
 * `SET_ACTIVITY` con el pid del proceso.
 * ------------------------------------------------------------------ */

const net = require('net');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

/** Los caminos posibles del pipe, en orden. Discord usa el primero libre. */
function socketPaths() {
  if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\.\\pipe\\discord-ipc-${i}`);
  }
  const base =
    process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || os.tmpdir();
  const out = [];
  // Discord también se instala por Flatpak y por Snap, cada uno con su subcarpeta.
  for (const sub of ['', 'app/com.discordapp.Discord/', 'snap.discord/']) {
    for (let i = 0; i < 10; i++) out.push(path.join(base, sub, `discord-ipc-${i}`));
  }
  return out;
}

function encode(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

class DiscordIpc extends EventEmitter {
  constructor(clientId) {
    super();
    this.clientId = String(clientId);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.ready = false;
    this.nonce = 0;
  }

  /** Prueba los pipes uno por uno; resuelve con el primero que salude de vuelta. */
  connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const paths = socketPaths();
      let i = 0;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.destroy();
        reject(new Error('Discord no respondió a tiempo'));
      }, timeoutMs);

      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) { this.destroy(); reject(err); } else resolve();
      };

      const tryNext = () => {
        if (i >= paths.length) {
          return done(new Error('no se encontró Discord abierto'));
        }
        const target = paths[i++];
        const sock = net.createConnection(target);

        sock.once('error', () => {
          sock.destroy();
          tryNext(); // ese pipe no existe o está ocupado: se prueba el próximo
        });

        sock.once('connect', () => {
          this.socket = sock;
          sock.removeAllListeners('error');
          /*
           * `emit('error')` sin oyentes NO es un aviso: Node lo convierte en una
           * excepción, y una excepción suelta en el proceso principal se lleva
           * puesta la aplicación entera, sin ventana de error ni nada.
           *
           * Y pasaba de verdad: `disconnect()` hace `removeAllListeners()` sobre
           * este objeto y después `destroy()` sobre el socket. Ese destroy puede
           * emitir un error —Discord cerrándose, el pipe cortado a mitad de una
           * escritura— y para ese momento ya no queda ningún oyente. El cliente
           * desaparecía de golpe y quedaba como "se crashea sola después de un
           * rato".
           */
          sock.on('error', (e) => this._fail(e));
          sock.on('close', () => {
            this.ready = false;
            this.emit('close');
          });
          sock.on('data', (chunk) => this._onData(chunk, done));
          sock.write(encode(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));
        });
      };

      tryNext();
    });
  }

  _onData(chunk, done) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // Puede venir más de un mensaje por lectura, o uno partido al medio.
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) break;
      const body = this.buffer.slice(8, 8 + len).toString('utf8');
      this.buffer = this.buffer.slice(8 + len);

      let msg = null;
      try { msg = JSON.parse(body); } catch { /* basura: se ignora */ }

      if (op === OP_PING) {
        this._write(OP_PONG, msg || {});
        continue;
      }
      if (op === OP_CLOSE) {
        this.destroy();
        if (done) done(new Error((msg && msg.message) || 'Discord cerró la conexión'));
        continue;
      }
      if (op === OP_FRAME && msg && msg.evt === 'READY') {
        this.ready = true;
        this.emit('ready');
        if (done) done(null);
      }
    }
  }

  /** Un error del socket: se avisa si hay quien escuche, y si no se traga. */
  _fail(err) {
    if (this.listenerCount('error') > 0) this.emit('error', err);
  }

  _write(op, payload) {
    if (!this.socket || this.socket.destroyed) return false;
    try {
      this.socket.write(encode(op, payload));
      return true;
    } catch {
      return false;
    }
  }

  setActivity(activity) {
    if (!this.ready) return false;
    return this._write(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      nonce: `${Date.now()}-${++this.nonce}`,
      args: { pid: process.pid, activity }
    });
  }

  destroy() {
    this.ready = false;
    if (this.socket) {
      try { this.socket.destroy(); } catch { /* ya estaba cerrado */ }
      this.socket = null;
    }
    this.buffer = Buffer.alloc(0);
  }
}

module.exports = { DiscordIpc };
