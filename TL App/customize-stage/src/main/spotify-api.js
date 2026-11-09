'use strict';

/**
 * Spotify con cuenta: la API web oficial.
 *
 * Con la cuenta conectada la app puede buscar temas, poner playlists, sumar a la
 * cola, cambiar el volumen y elegir en qué dispositivo suena. Los controles de
 * reproducción de la API son sólo para Premium (lo decide Spotify).
 *
 * Inicio de sesión: «Authorization Code con PKCE», el que Spotify recomienda
 * para apps de escritorio. No hay secreto guardado en la app: cada club (o cada
 * jugador) usa su propio Client ID del panel de desarrolladores de Spotify, con
 * esta dirección de vuelta cargada tal cual:
 *
 *     http://127.0.0.1:43827/callback
 *
 * Se abre el navegador de la PC, el jugador acepta, Spotify vuelve a esa
 * dirección (un servidor que la app levanta sólo durante el inicio de sesión) y
 * la app cambia el código por las llaves. Las llaves quedan en la carpeta de
 * datos de la app, en esta PC, y se renuevan solas.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');

const PORT = 43827;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-library-modify'
].join(' ');

let file = '';
let auth = { clientId: '', access: '', refresh: '', expires: 0, user: '' };

function authFile() {
  if (file) return file;
  const { app } = require('electron');
  file = path.join(app.getPath('userData'), 'spotify-auth.json');
  return file;
}
function load() {
  try { auth = { ...auth, ...JSON.parse(fs.readFileSync(authFile(), 'utf8')) }; } catch { /* sin archivo */ }
}
function save() {
  try { fs.writeFileSync(authFile(), JSON.stringify(auth), 'utf8'); } catch { /* sin disco */ }
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Un pedido HTTPS. Devuelve { status, headers, body } (body ya parseado si es JSON). */
function request(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, headers, timeout: 12000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = raw;
        if (raw && /json/.test(String(res.headers['content-type'] || ''))) { try { parsed = JSON.parse(raw); } catch { /* texto */ } }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Spotify no respondió')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function token(params) {
  const body = new URLSearchParams({ client_id: auth.clientId, ...params }).toString();
  const r = await request('POST', 'https://accounts.spotify.com/api/token', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    body
  });
  if (r.status !== 200 || !r.body || !r.body.access_token) {
    const why = (r.body && (r.body.error_description || r.body.error)) || `HTTP ${r.status}`;
    throw new Error(`Spotify rechazó el inicio de sesión: ${why}`);
  }
  auth.access = r.body.access_token;
  if (r.body.refresh_token) auth.refresh = r.body.refresh_token;
  auth.expires = Date.now() + (Number(r.body.expires_in) || 3600) * 1000 - 60000;
  save();
}

let refreshing = null;
async function fresh() {
  if (!auth.refresh || !auth.clientId) throw new Error('not connected');
  if (auth.access && Date.now() < auth.expires) return auth.access;
  if (!refreshing) {
    refreshing = token({ grant_type: 'refresh_token', refresh_token: auth.refresh })
      .catch((e) => {
        // Llave revocada (sacaron el permiso o cambió el Client ID): hay que volver a entrar.
        if (/invalid_grant|revoked|invalid_client/i.test(e.message)) { auth.access = ''; auth.refresh = ''; save(); }
        throw e;
      })
      .finally(() => { refreshing = null; });
  }
  await refreshing;
  return auth.access;
}

/** Llamada a la API. 204 → null. Errores con `code` legible para la interfaz. */
async function api(method, p, { query, json } = {}) {
  let tries = 0;
  for (;;) {
    const at = await fresh();
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    const body = json ? JSON.stringify(json) : null;
    const headers = { Authorization: `Bearer ${at}` };
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    else if (method !== 'GET') headers['Content-Length'] = 0;
    const r = await request(method, `https://api.spotify.com/v1${p}${qs}`, { headers, body });
    if (r.status === 401 && tries++ < 1) { auth.expires = 0; continue; }
    if (r.status === 429 && tries++ < 1) {
      const wait = Math.min(5, Number(r.headers['retry-after']) || 1);
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      continue;
    }
    if (r.status === 204 || r.status === 202) return null;
    if (r.status >= 200 && r.status < 300) return r.body || null;
    const e = new Error((r.body && r.body.error && r.body.error.message) || `HTTP ${r.status}`);
    e.status = r.status;
    e.reason = r.body && r.body.error && r.body.error.reason;
    throw e;
  }
}

/* ── Inicio de sesión ─────────────────────────────────────────────────── */
let loginServer = null;
function login(clientId, openExternal) {
  const id = String(clientId || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) return Promise.reject(new Error('El Client ID son 32 letras y números (lo copiás del panel de Spotify).'));
  if (loginServer) { try { loginServer.close(); } catch { /* ya cerrado */ } loginServer = null; }
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setTimeout(() => { try { server.close(); } catch { /* ya cerrado */ } if (loginServer === server) loginServer = null; }, 500);
      if (err) reject(err); else resolve(status());
    };
    const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>TL App</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0c1834;color:#f4f0df;font-family:Segoe UI,sans-serif;text-align:center"><div><h1 style="color:#d0b878;margin:0 0 8px">${title}</h1><p style="opacity:.8">${text}</p></div></body>`;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const send = (code, title, text) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page(title, text)); };
      if (u.searchParams.get('state') !== state) { send(400, 'Algo no coincide', 'Volvé a TL App y probá de nuevo.'); return; }
      const err = u.searchParams.get('error');
      if (err) { send(200, 'No se conectó', 'Volvé a TL App.'); finish(new Error(err === 'access_denied' ? 'Cancelaste el permiso en Spotify.' : `Spotify: ${err}`)); return; }
      try {
        auth = { clientId: id, access: '', refresh: '', expires: 0, user: '' };
        await token({ grant_type: 'authorization_code', code: u.searchParams.get('code') || '', redirect_uri: REDIRECT, code_verifier: verifier });
        try { const me = await api('GET', '/me'); auth.user = (me && (me.display_name || me.id)) || ''; save(); } catch { /* el nombre es adorno */ }
        send(200, '¡Listo!', 'Spotify quedó conectado. Ya podés volver a TL App.');
        finish(null);
      } catch (e) {
        send(200, 'No se conectó', e.message);
        finish(e);
      }
    });
    loginServer = server;
    server.on('error', (e) => finish(new Error(e.code === 'EADDRINUSE' ? `El puerto ${PORT} está ocupado por otro programa.` : e.message)));
    const timer = setTimeout(() => finish(new Error('Pasaron 3 minutos sin respuesta de Spotify.')), 180000);
    server.listen(PORT, '127.0.0.1', () => {
      const q = new URLSearchParams({
        client_id: id, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES,
        code_challenge_method: 'S256', code_challenge: challenge, state
      });
      openExternal(`https://accounts.spotify.com/authorize?${q.toString()}`);
    });
  });
}

function status() {
  return { connected: !!auth.refresh, clientId: auth.clientId, user: auth.user, redirect: REDIRECT };
}

/* ── Reproductor ──────────────────────────────────────────────────────── */
const img = (images, want) => {
  if (!Array.isArray(images) || !images.length) return '';
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= want) || sorted[sorted.length - 1]).url || '';
};
const trackOut = (t) => t && ({
  uri: t.uri, id: t.id, title: t.name || '',
  artist: (t.artists || []).map((a) => a.name).join(', ') || (t.show && t.show.name) || '',
  album: (t.album && t.album.name) || '',
  cover: img((t.album && t.album.images) || t.images, 64),
  coverBig: img((t.album && t.album.images) || t.images, 300),
  dur: (t.duration_ms || 0) / 1000
});

async function player() {
  const p = await api('GET', '/me/player', { query: { additional_types: 'episode' } });
  if (!p) return { active: false };
  return {
    active: true,
    playing: !!p.is_playing,
    pos: (p.progress_ms || 0) / 1000,
    shuffle: !!p.shuffle_state,
    repeat: p.repeat_state || 'off',
    device: p.device ? { id: p.device.id, name: p.device.name, type: p.device.type, vol: typeof p.device.volume_percent === 'number' ? p.device.volume_percent / 100 : -1, canVol: p.device.supports_volume !== false } : null,
    context: p.context ? p.context.uri : '',
    item: trackOut(p.item)
  };
}

async function cmd(name, arg) {
  switch (name) {
    case 'play': return api('PUT', '/me/player/play');
    case 'pause': return api('PUT', '/me/player/pause');
    case 'next': return api('POST', '/me/player/next');
    case 'prev': return api('POST', '/me/player/previous');
    case 'seek': return api('PUT', '/me/player/seek', { query: { position_ms: String(Math.max(0, Math.round(Number(arg) * 1000) || 0)) } });
    case 'volume': return api('PUT', '/me/player/volume', { query: { volume_percent: String(Math.min(100, Math.max(0, Math.round(Number(arg) * 100) || 0))) } });
    case 'shuffle': return api('PUT', '/me/player/shuffle', { query: { state: arg ? 'true' : 'false' } });
    case 'repeat': return api('PUT', '/me/player/repeat', { query: { state: ['off', 'context', 'track'].includes(arg) ? arg : 'off' } });
    case 'queue': return api('POST', '/me/player/queue', { query: { uri: String(arg || '') } });
    case 'playUri': {
      const a = arg || {};
      const json = a.context ? { context_uri: a.context, ...(a.offset ? { offset: { uri: a.offset } } : {}) } : { uris: [a.uri] };
      return api('PUT', '/me/player/play', { query: a.device ? { device_id: a.device } : undefined, json });
    }
    case 'transfer': return api('PUT', '/me/player', { json: { device_ids: [String(arg || '')], play: true } });
    case 'like': return api(arg && arg.on ? 'PUT' : 'DELETE', '/me/library', { query: { uris: String((arg && arg.uri) || '') } });
    default: throw new Error('bad cmd');
  }
}

async function search(q) {
  const text = String(q || '').trim().slice(0, 100);
  if (!text) return [];
  const r = await api('GET', '/search', { query: { q: text, type: 'track', limit: '10' } });
  return ((r && r.tracks && r.tracks.items) || []).map(trackOut);
}

async function playlists() {
  const r = await api('GET', '/me/playlists', { query: { limit: '30' } });
  return ((r && r.items) || []).filter(Boolean).map((p) => ({
    uri: p.uri, name: p.name || '', owner: (p.owner && p.owner.display_name) || '', cover: img(p.images, 120),
    // Spotify renombró `tracks` a `items` en las playlists (febrero 2026): se aceptan las dos.
    total: (p.items && p.items.total) || (p.tracks && p.tracks.total) || 0
  }));
}

async function queueList() {
  const r = await api('GET', '/me/player/queue');
  return ((r && r.queue) || []).slice(0, 20).map(trackOut).filter(Boolean);
}

async function devices() {
  const r = await api('GET', '/me/player/devices');
  return ((r && r.devices) || []).map((d) => ({ id: d.id, name: d.name, type: d.type, active: !!d.is_active }));
}

async function liked(uri) {
  const r = await api('GET', '/me/library/contains', { query: { uris: String(uri || '') } });
  return Array.isArray(r) ? !!r[0] : false;
}

/** Errores de la API, a algo que la interfaz pueda decir. */
function wrap(fn) {
  return async (...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) {
      let code = 'error';
      if (e.message === 'not connected') code = 'login';
      else if (e.status === 404) code = 'nodevice';
      else if (e.status === 403) code = e.reason === 'PREMIUM_REQUIRED' ? 'premium' : 'forbidden';
      else if (e.status === 401) code = 'login';
      else if (e.status === 429) code = 'rate';
      return { ok: false, code, error: e.message };
    }
  };
}

function register(handle, shell) {
  load();
  const open = (url) => shell.openExternal(url);
  handle('spapi:status', () => status());
  handle('spapi:login', (_e, clientId) => login(clientId, open));
  handle('spapi:logout', () => { auth = { clientId: auth.clientId, access: '', refresh: '', expires: 0, user: '' }; save(); return status(); });
  handle('spapi:player', wrap(() => player()));
  handle('spapi:cmd', wrap((_e, name, arg) => cmd(String(name || ''), arg)));
  handle('spapi:search', wrap((_e, q) => search(q)));
  handle('spapi:playlists', wrap(() => playlists()));
  handle('spapi:devices', wrap(() => devices()));
  handle('spapi:queue', wrap(() => queueList()));
  handle('spapi:liked', wrap((_e, uri) => liked(uri)));
}

module.exports = { register, REDIRECT };
