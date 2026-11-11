'use strict';
/**
 * Voz entre los que usan TL App: la parte de «encontrarse».
 *
 * La voz en sí va directo de PC a PC (WebRTC, en la ventana de la interfaz).
 * Para arrancar una llamada, cada PC tiene que pasarle a la otra un par de
 * textos (la «oferta» y la «respuesta», con las direcciones por donde se la
 * puede alcanzar). Esos textos viajan por la misma base de Firebase que usa la
 * presencia del club, en una carpeta aparte:
 *
 *     voice/<canal>/m/<pid>          = { n, t, i, u, s }   quién está en el canal
 *     voice/<canal>/q/<pid>/<msg>    = { f, i, d, t, s }   mensajes PARA <pid>
 *
 * Todo va firmado con la identidad de cada uno (la misma de la presencia). Lo
 * que no tenga firma válida de alguien del plantel se descarta: nadie de afuera
 * puede meterse en un canal ni hacerse pasar por otro.
 *
 * Canales: «club» (uno para todo el plantel) y «r<huella>» (la sala de HaxBall
 * donde estás; la huella es la misma anónima de la presencia).
 *
 * Por la base no pasa audio: sólo esos textos, unos pocos KB por llamada.
 */

const identity = require('./identity');

const BEAT_MS = 6000;            // cada cuánto se renueva el casillero propio
const MEMBERS_MS = 3000;         // cada cuánto se lee quién está
const INBOX_FAST_MS = 700;       // buzón mientras se arma una llamada
const INBOX_SLOW_MS = 2500;      // buzón en calma
const FAST_WINDOW_MS = 20000;    // cuánto dura el ritmo rápido después de un cambio
const ALIVE_MS = 20000;          // sin renovar en este tiempo = se fue
const PRUNE_MS = 10 * 60000;     // casilleros abandonados: se barren
const MSG_MAX_AGE_MS = 90000;    // mensajes más viejos que esto se tiran
const TIMEOUT_MS = 8000;
const ALLOWED_HOST = /(^|\.)(firebaseio\.com|firebasedatabase\.app)$/i;
const CHANNEL_RE = /^(club|r[0-9a-f]{16})$/;
const PID_RE = /^[0-9a-f]{16}$/;
const MAX_DATA = 12000;          // una oferta con todas sus direcciones anda por los 2-4 KB

function cleanUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'https:' && !(process.env.TL_VOICE_TEST && u.protocol === 'http:')) return null;
    if (!ALLOWED_HOST.test(u.hostname) && !(process.env.TL_VOICE_TEST && u.hostname === '127.0.0.1')) return null;
    return `${u.protocol}//${u.host}`;
  } catch { return null; }
}

async function call(url, method, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return method === 'GET' ? await res.json() : null;
  } finally { clearTimeout(timer); }
}

const memberText = (ch, n, t, i, u) => `voice|${ch}|${n}|${t}|${i}|${u}`;
const msgText = (ch, to, f, i, t, d) => `vmsg|${ch}|${to}|${f}|${i}|${t}|${d}`;
const cleanName = (v) => String(v || '').replace(/[\r\n|]/g, ' ').trim().slice(0, 40);
const rnd = () => Math.random().toString(36).slice(2, 10);

/**
 * Una sesión de voz. `opts`:
 *   getCtx()   → { url, key, roster, name }  (se lee en cada vuelta: puede cambiar)
 *   onMembers(list)  → [{ pid, name, sid, muted, self }]
 *   onSignal({ from, sid, data })
 *   onStatus({ state, error })   state: 'off' | 'joining' | 'on' | 'error'
 */
function createVoice(opts) {
  let channel = null;
  let sid = '';
  let muted = false;
  let timers = [];
  let fastUntil = 0;
  let inboxBusy = false;
  let membersBusy = false;
  let lastMembersSig = '';
  let lastWho = '';
  const seen = new Map();           // pid → { t, at } para saber quién sigue vivo con NUESTRO reloj
  const handled = new Set();        // ids de mensajes ya procesados (por si el borrado no llegó)
  let me = null;
  let status = { state: 'off', error: '' };

  const setStatus = (state, error = '') => {
    if (status.state === state && status.error === error) return;
    status = { state, error };
    try { opts.onStatus && opts.onStatus({ ...status, channel }); } catch { /* nada */ }
  };

  function ctx() {
    const c = opts.getCtx ? opts.getCtx() : {};
    const base = cleanUrl(c && c.url);
    if (!base) return { err: 'sin-base' };
    if (!c.key) return { err: 'sin-clave' };
    if (!me || me.key !== c.key) {
      try { me = { key: c.key, id: identity.fromKey(c.key) }; } catch { return { err: 'clave' }; }
    }
    const byPid = new Map();
    for (const u of c.roster || []) {
      // Sólo quien tiene la voz habilitada (el admin la maneja por persona; ver `voz` en access.js).
      if (!u || !/^[0-9a-f]{64}$/i.test(u.pub || '') || u.trial || (u.ext && !u.soc) || u.voz === false) continue;
      byPid.set(identity.pidOf(u.pub), u);
    }
    if (!byPid.has(me.id.pid)) return { err: 'sin-permiso' };
    return { base, id: me.id, byPid, name: cleanName(c.name || (byPid.get(me.id.pid) || {}).name) || 'Jugador' };
  }

  async function putMember() {
    if (!channel) return;
    const c = ctx();
    if (c.err) { setStatus('error', c.err); return; }
    const t = Date.now();
    const u = muted ? 1 : 0;
    const body = { n: c.name, t, i: sid, u, s: c.id.sign(memberText(channel, c.name, t, sid, u)) };
    try {
      await call(`${c.base}/voice/${channel}/m/${c.id.pid}.json`, 'PUT', body);
      if (status.state !== 'on') setStatus('on');
    } catch (err) {
      setStatus('error', err && (err.status === 401 || err.status === 403) ? 'reglas' : 'red');
    }
  }

  async function readMembers() {
    if (!channel || membersBusy) return;
    const c = ctx();
    if (c.err) return;
    membersBusy = true;
    const ch = channel;
    try {
      const data = (await call(`${c.base}/voice/${ch}/m.json`, 'GET')) || {};
      if (ch !== channel) return;
      const now = Date.now();
      const out = [];
      for (const [pid, e] of Object.entries(data)) {
        if (!PID_RE.test(pid) || !e || typeof e !== 'object') continue;
        if (pid !== c.id.pid && typeof e.t === 'number' && Math.abs(now - e.t) > PRUNE_MS) {
          call(`${c.base}/voice/${ch}/m/${pid}.json`, 'DELETE').catch(() => {});
          continue;
        }
        const member = c.byPid.get(pid);
        if (!member) continue;
        if (typeof e.n !== 'string' || typeof e.t !== 'number' || typeof e.i !== 'string' || typeof e.s !== 'string') continue;
        const u = e.u === 1 ? 1 : 0;
        if (!identity.verify(member.pub, memberText(ch, e.n, e.t, e.i, u), e.s)) continue;
        if (pid === c.id.pid) {
          if (e.i === sid) out.push({ pid, name: c.name, sid, muted, self: true });
          continue;
        }
        const prev = seen.get(pid);
        if (!prev || prev.t !== e.t) seen.set(pid, { t: e.t, at: now });
        if (now - seen.get(pid).at > ALIVE_MS) continue;
        out.push({ pid, name: cleanName(member.name || e.n) || e.n, sid: e.i.slice(0, 24), muted: !!u, self: false });
      }
      // Uno mismo siempre está, aunque la base todavía no lo devuelva.
      if (!out.some((m) => m.self)) out.push({ pid: c.id.pid, name: c.name, sid, muted, self: true });
      out.sort((a, b) => (b.self - a.self) || a.name.localeCompare(b.name, 'es'));
      const sig = out.map((m) => `${m.pid}:${m.sid}:${m.muted ? 1 : 0}`).join(',');
      if (sig !== lastMembersSig) {
        // Alguien entró o salió: el buzón se mira seguido un rato, que es cuando llegan las ofertas.
        const who = out.map((m) => `${m.pid}:${m.sid}`).join(',');
        if (who !== lastWho) fastUntil = Date.now() + FAST_WINDOW_MS;
        lastWho = who;
        lastMembersSig = sig;
        try { opts.onMembers && opts.onMembers(out); } catch { /* nada */ }
      }
    } catch { /* sin red: queda lo último */ }
    finally { membersBusy = false; }
  }

  async function readInbox() {
    if (!channel || inboxBusy) return;
    const c = ctx();
    if (c.err) return;
    inboxBusy = true;
    const ch = channel;
    try {
      const data = await call(`${c.base}/voice/${ch}/q/${c.id.pid}.json`, 'GET');
      if (!data || typeof data !== 'object' || ch !== channel) return;
      const now = Date.now();
      const drop = {};
      const msgs = [];
      for (const [mid, m] of Object.entries(data)) {
        drop[mid] = null;
        if (handled.has(mid)) continue;
        handled.add(mid);
        if (!m || typeof m !== 'object' || !PID_RE.test(m.f || '')) continue;
        if (typeof m.d !== 'string' || m.d.length > MAX_DATA || typeof m.t !== 'number' || typeof m.i !== 'string' || typeof m.s !== 'string') continue;
        if (Math.abs(now - m.t) > MSG_MAX_AGE_MS) continue;
        const member = c.byPid.get(m.f);
        if (!member) continue;
        if (!identity.verify(member.pub, msgText(ch, c.id.pid, m.f, m.i, m.t, m.d), m.s)) continue;
        let parsed;
        try { parsed = JSON.parse(m.d); } catch { continue; }
        msgs.push({ from: m.f, sid: m.i.slice(0, 24), data: parsed, t: m.t });
      }
      if (Object.keys(drop).length) call(`${c.base}/voice/${ch}/q/${c.id.pid}.json`, 'PATCH', drop).catch(() => {});
      if (handled.size > 500) { const keep = [...handled].slice(-200); handled.clear(); keep.forEach((k) => handled.add(k)); }
      msgs.sort((a, b) => a.t - b.t);
      if (msgs.length) fastUntil = Date.now() + FAST_WINDOW_MS;
      for (const m of msgs) { try { opts.onSignal && opts.onSignal(m); } catch { /* nada */ } }
    } catch { /* sin red */ }
    finally { inboxBusy = false; }
  }

  function schedule() {
    stopTimers();
    const loop = (fn, msFn) => {
      let h;
      const tick = async () => { await fn(); if (channel) { h = setTimeout(tick, msFn()); timers.push(h); } };
      h = setTimeout(tick, 0);
      timers.push(h);
    };
    loop(putMember, () => BEAT_MS);
    loop(readMembers, () => MEMBERS_MS);
    loop(readInbox, () => (Date.now() < fastUntil ? INBOX_FAST_MS : INBOX_SLOW_MS));
  }
  function stopTimers() { for (const h of timers) clearTimeout(h); timers = []; }

  async function join(next) {
    if (!CHANNEL_RE.test(String(next || ''))) throw new Error('Canal no válido');
    if (channel === next) return { channel, sid };
    // Cambio de canal (por ejemplo, de una sala a otra): se sale del anterior sin avisar «apagado»,
    // para que la ventana no desarme la voz entre un canal y el otro.
    if (channel) await leave(true);
    const c = ctx();
    if (c.err) { setStatus('error', c.err); throw new Error(c.err); }
    channel = next;
    sid = `${Date.now().toString(36)}${rnd()}`.slice(0, 20);
    seen.clear();
    handled.clear();
    lastMembersSig = '';
    lastWho = '';
    fastUntil = Date.now() + FAST_WINDOW_MS;
    setStatus('joining');
    // Lo que haya quedado en el buzón de una sesión anterior no sirve.
    call(`${c.base}/voice/${channel}/q/${c.id.pid}.json`, 'DELETE').catch(() => {});
    schedule();
    return { channel, sid, pid: c.id.pid };
  }

  async function leave(switching) {
    const ch = channel;
    channel = null;
    stopTimers();
    lastMembersSig = '';
    seen.clear();
    if (!switching) {
      setStatus('off');
      try { opts.onMembers && opts.onMembers([]); } catch { /* nada */ }
    }
    if (!ch) return;
    const c = ctx();
    if (c.err) return;
    await Promise.all([
      call(`${c.base}/voice/${ch}/m/${c.id.pid}.json`, 'DELETE').catch(() => {}),
      call(`${c.base}/voice/${ch}/q/${c.id.pid}.json`, 'DELETE').catch(() => {})
    ]);
  }

  async function signal(to, data) {
    if (!channel || !PID_RE.test(String(to || ''))) return false;
    const c = ctx();
    if (c.err) return false;
    const d = JSON.stringify(data);
    if (d.length > MAX_DATA) return false;
    const t = Date.now();
    const mid = `${t.toString(36)}${rnd()}`;
    const body = { f: c.id.pid, i: sid, d, t, s: c.id.sign(msgText(channel, to, c.id.pid, sid, t, d)) };
    fastUntil = Date.now() + FAST_WINDOW_MS;
    try { await call(`${c.base}/voice/${channel}/q/${to}/${mid}.json`, 'PUT', body); return true; }
    catch { return false; }
  }

  function setMuted(on) {
    const next = !!on;
    if (next === muted) return;
    muted = next;
    putMember();
  }

  /** Quién está en un canal, sin entrar (para mostrarlo antes de unirse). */
  async function peek(ch) {
    if (!CHANNEL_RE.test(String(ch || ''))) return [];
    const c = ctx();
    if (c.err) return [];
    const data = (await call(`${c.base}/voice/${ch}/m.json`, 'GET').catch(() => null)) || {};
    const now = Date.now();
    const out = [];
    for (const [pid, e] of Object.entries(data)) {
      const member = c.byPid.get(pid);
      if (!member || !e || typeof e.t !== 'number' || typeof e.n !== 'string' || typeof e.i !== 'string' || typeof e.s !== 'string') continue;
      if (Math.abs(now - e.t) > ALIVE_MS * 2) continue; // sin historial: se usa la hora de la base, con margen
      const u = e.u === 1 ? 1 : 0;
      if (!identity.verify(member.pub, memberText(ch, e.n, e.t, e.i, u), e.s)) continue;
      out.push({ pid, name: cleanName(member.name || e.n), self: pid === c.id.pid });
    }
    return out;
  }

  return {
    join, leave, signal, setMuted, peek,
    channel: () => channel,
    status: () => ({ ...status, channel }),
    myPid: () => { const c = ctx(); return c.err ? null : c.id.pid; }
  };
}

module.exports = { createVoice, CHANNEL_RE, memberText, msgText };
