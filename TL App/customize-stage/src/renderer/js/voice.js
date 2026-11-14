/* ═══ Voz: el motor (WebRTC) ═══════════════════════════════════════════
 *
 * Una llamada por cada otra persona del canal (malla): el audio va directo de
 * PC a PC. Quién está y los textos para armar cada llamada los trae el proceso
 * principal desde la base del club (ver main/voice.js); acá llegan por un
 * «transporte» con la misma forma en la app y en las pruebas.
 *
 * Costo: el audio de WebRTC corre en hilos propios de Chromium, fuera del
 * dibujo. Lo único que corre acá es un tic cada 150 ms mientras estás en un
 * canal (nivel del micrófono y quién habla), y avisa a la interfaz SÓLO cuando
 * algo cambió. Fuera de un canal no corre nada y el micrófono queda cerrado.
 *
 * Quién llama a quién: el de pid menor manda la oferta. Así nunca se cruzan
 * dos ofertas entre las mismas dos PCs.
 */
(function () {
  'use strict';

  const DEFAULT_ICE = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: ['stun:stun.cloudflare.com:3478'] }
  ];
  const ICE_WAIT_MS = 2500;      // cuánto se espera a juntar direcciones antes de mandar la oferta
  const TICK_MS = 150;
  const OPEN_HOLD_MS = 700;      // voz abierta: el micrófono queda abierto este rato después de la última palabra
  const PTT_TAIL_MS = 200;       // apretar para hablar: al soltar se sigue mandando un toque para no cortar la última sílaba
  const REMOTE_TALK = 0.012;     // nivel (0-1) desde el que alguien «está hablando»
  const BITRATE = 40000;         // Opus de voz clara; sigue siendo muy poco (5 KB/s) y con DTX casi nada en silencio

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** Opus con DTX (no manda casi nada en silencio) y un techo de bitrate. */
  function tuneSdp(sdp) {
    const m = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp);
    if (!m) return sdp;
    const pt = m[1];
    const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
    if (re.test(sdp)) {
      return sdp.replace(re, (all, params) => {
        let p = params;
        if (!/usedtx=/.test(p)) p += ';usedtx=1';
        if (!/maxaveragebitrate=/.test(p)) p += `;maxaveragebitrate=${BITRATE}`;
        if (!/useinbandfec=/.test(p)) p += ';useinbandfec=1';
        return `a=fmtp:${pt} ${p}`;
      });
    }
    return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} usedtx=1;useinbandfec=1;maxaveragebitrate=${BITRATE}`);
  }

  function waitIce(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      const t = setTimeout(done, ICE_WAIT_MS);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  /**
   * transport: { join(which), leave(), signal(to, data), mute(on),
   *              onMembers(cb), onSignal(cb), onStatus(cb) }
   * opts: { iceServers, settings, onState(state), media? (para pruebas) }
   */
  function createEngine(transport, opts = {}) {
    const S = {
      settings: Object.assign({ mode: 'ptt', device: '', sensitivity: 0.5, volume: 1, noise: true, peers: {} }, opts.settings || {}),
      iceServers: (opts.iceServers && opts.iceServers.length ? opts.iceServers : []).concat(DEFAULT_ICE),
      joined: false,
      joining: false,
      channel: null,
      want: null,
      myPid: null,
      mySid: null,
      members: [],
      peers: new Map(),     // pid → peer
      muted: false,
      deafened: false,
      ptt: false,
      pttUntil: 0,
      openUntil: 0,
      sending: false,
      localLevel: 0,
      micError: '',
      error: '',
      stream: null,
      track: null,
      ctx: null,
      analyser: null,
      buf: null,
      tick: null,
      lastSig: ''
    };

    /* ── estado hacia la interfaz: sólo cuando cambia algo ── */
    function snapshot() {
      return {
        joined: S.joined,
        joining: S.joining,
        channel: S.channel,
        want: S.want,
        muted: S.muted,
        deafened: S.deafened,
        mode: S.settings.mode,
        sending: S.sending,
        speaking: S.sending && S.localLevel > 0.02,
        micError: S.micError,
        error: S.error,
        members: S.members.map((m) => {
          const p = S.peers.get(m.pid);
          return {
            pid: m.pid,
            name: m.name,
            self: !!m.self,
            muted: m.self ? S.muted : !!m.muted,
            speaking: m.self ? (S.sending && S.localLevel > 0.02) : !!(p && p.speaking),
            state: m.self ? 'self' : (p ? p.state : 'waiting'),
            volume: m.self ? 1 : clamp(Number(S.settings.peers[m.pid] ?? 1), 0, 1)
          };
        })
      };
    }
    function emit(force) {
      const snap = snapshot();
      const sig = JSON.stringify(snap);
      if (!force && sig === S.lastSig) return;
      S.lastSig = sig;
      try { opts.onState && opts.onState(snap); } catch (e) { /* la interfaz no frena al motor */ }
    }

    /* ── micrófono ── */
    async function openMic() {
      S.micError = '';
      let stream = null;
      try {
        const getMedia = opts.media || ((c) => navigator.mediaDevices.getUserMedia(c));
        stream = await getMedia({
          audio: {
            deviceId: S.settings.device ? { exact: S.settings.device } : undefined,
            echoCancellation: true,
            noiseSuppression: S.settings.noise !== false,
            autoGainControl: true,
            channelCount: 1
          },
          video: false
        });
      } catch (e) {
        // Con el micrófono elegido desenchufado se prueba el de Windows.
        if (S.settings.device) {
          try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: S.settings.noise !== false, autoGainControl: true }, video: false }); } catch (e2) { stream = null; }
        }
        if (!stream) S.micError = (e && e.name === 'NotAllowedError') ? 'permiso' : 'sin-mic';
      }
      if (!S.ctx) {
        try { S.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { S.ctx = null; }
      }
      if (S.ctx && S.ctx.state === 'suspended') S.ctx.resume().catch(() => {});
      if (!stream && S.ctx) {
        // Sin micrófono igual se entra a escuchar: se manda una pista muda.
        stream = S.ctx.createMediaStreamDestination().stream;
      }
      S.stream = stream;
      S.track = stream ? stream.getAudioTracks()[0] || null : null;
      if (S.track) S.track.enabled = false;
      if (S.ctx && stream && !S.micError) {
        try {
          // Se mide sobre una copia: la pista que viaja está apagada mientras no hablás
          // y daría silencio, y la voz abierta necesita oír para saber cuándo abrirse.
          S.meterTrack = S.track.clone();
          S.meterTrack.enabled = true;
          const src = S.ctx.createMediaStreamSource(new MediaStream([S.meterTrack]));
          S.analyser = S.ctx.createAnalyser();
          S.analyser.fftSize = 1024;
          S.buf = new Float32Array(S.analyser.fftSize);
          src.connect(S.analyser); // no va a los parlantes: sólo se mide
        } catch (e) { S.analyser = null; }
      } else S.analyser = null;
    }
    function closeMic() {
      if (S.stream) S.stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* ya parado */ } });
      if (S.meterTrack) { try { S.meterTrack.stop(); } catch (e) { /* ya parado */ } }
      S.stream = null; S.track = null; S.meterTrack = null; S.analyser = null; S.buf = null; S.localLevel = 0;
      if (S.ctx && S.ctx.state === 'running') S.ctx.suspend().catch(() => {});
    }

    function wantsSend() {
      if (!S.joined || S.muted || !S.track || S.micError) return false;
      if (S.settings.mode === 'open') return performance.now() < S.openUntil;
      return S.ptt || performance.now() < S.pttUntil;
    }
    function applySend() {
      const on = wantsSend();
      if (S.track && S.track.enabled !== on) S.track.enabled = on;
      if (S.sending !== on) { S.sending = on; emit(); }
    }

    /* ── el tic: nivel propio y quién habla ── */
    function tick() {
      if (S.analyser && S.buf) {
        S.analyser.getFloatTimeDomainData(S.buf);
        let sum = 0;
        for (let i = 0; i < S.buf.length; i += 2) sum += S.buf[i] * S.buf[i];
        S.localLevel = Math.sqrt(sum / (S.buf.length / 2));
        if (S.settings.mode === 'open') {
          // Sensibilidad 0..1 → umbral de 0.06 (poco sensible) a 0.006 (muy sensible).
          const thr = 0.06 * Math.pow(0.1, clamp(Number(S.settings.sensitivity) || 0.5, 0, 1));
          if (S.localLevel > thr) S.openUntil = performance.now() + OPEN_HOLD_MS;
        }
      }
      applySend();
      for (const p of S.peers.values()) {
        let level = 0;
        try {
          const r = p.pc.getReceivers()[0];
          const src = r && r.getSynchronizationSources ? r.getSynchronizationSources()[0] : null;
          if (src && typeof src.audioLevel === 'number') level = src.audioLevel;
        } catch (e) { level = 0; }
        const talking = level > REMOTE_TALK;
        if (talking) p.lastTalk = performance.now();
        // Se sostiene un poquito para que el aro no titile entre sílabas.
        p.speaking = performance.now() - (p.lastTalk || 0) < 450;
      }
      emit();
    }
    function startTick() { if (!S.tick) S.tick = setInterval(tick, TICK_MS); }
    function stopTick() { clearInterval(S.tick); S.tick = null; }

    /* ── cada llamada ── */
    function peerVolume(pid) {
      if (S.deafened) return 0;
      return clamp((Number(S.settings.volume) || 0) * clamp(Number(S.settings.peers[pid] ?? 1), 0, 1), 0, 1);
    }
    function closePeer(pid) {
      const p = S.peers.get(pid);
      if (!p) return;
      S.peers.delete(pid);
      clearTimeout(p.retryTimer); clearTimeout(p.dcTimer); clearTimeout(p.waitTimer);
      try { p.pc.close(); } catch (e) { /* ya cerrada */ }
      if (p.audio) { try { p.audio.pause(); p.audio.srcObject = null; p.audio.remove(); } catch (e) { /* nada */ } }
    }
    function newPeer(pid, sid, role) {
      closePeer(pid);
      const pc = new RTCPeerConnection({ iceServers: S.iceServers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
      const p = { pid, sid, role, pc, state: 'connecting', speaking: false, lastTalk: 0, retries: 0, audio: null, born: Date.now() };
      S.peers.set(pid, p);
      pc.addEventListener('track', (e) => {
        const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
        if (!p.audio) {
          p.audio = document.createElement('audio');
          p.audio.autoplay = true;
          p.audio.style.display = 'none';
          document.body.appendChild(p.audio); // fuera del DOM Chromium a veces no la reproduce
        }
        p.audio.srcObject = stream;
        p.audio.volume = peerVolume(pid);
        p.audio.play().catch(() => {});
      });
      pc.addEventListener('connectionstatechange', () => onConn(p));
      pc.addEventListener('iceconnectionstatechange', () => onConn(p));
      if (S.track && S.stream) pc.addTrack(S.track, S.stream);
      else pc.addTransceiver('audio', { direction: 'recvonly' });
      return p;
    }
    function onConn(p) {
      if (S.peers.get(p.pid) !== p) return;
      const st = p.pc.connectionState || p.pc.iceConnectionState;
      if (st === 'connected' || st === 'completed') {
        clearTimeout(p.dcTimer); clearTimeout(p.retryTimer);
        p.retries = 0;
        if (p.state !== 'connected') { p.state = 'connected'; limitBitrate(p); emit(); }
      } else if (st === 'disconnected') {
        // Un corte corto se arregla solo; si dura, se rearma.
        clearTimeout(p.dcTimer);
        p.dcTimer = setTimeout(() => { if (S.peers.get(p.pid) === p && p.pc.connectionState !== 'connected') retry(p); }, 6000);
        if (p.state !== 'reconnecting') { p.state = 'reconnecting'; emit(); }
      } else if (st === 'failed') {
        retry(p);
      }
    }
    function limitBitrate(p) {
      try {
        const s = p.pc.getSenders().find((x) => x.track && x.track.kind === 'audio');
        if (!s || !s.getParameters) return;
        const prm = s.getParameters();
        if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
        prm.encodings[0].maxBitrate = BITRATE;
        // La voz primero: si la red se aprieta, Chromium le da lugar al audio antes que al resto.
        prm.encodings[0].priority = 'high';
        prm.encodings[0].networkPriority = 'high';
        s.setParameters(prm).catch(() => {
          // Si esta versión no acepta la prioridad, al menos el techo de bitrate.
          try { delete prm.encodings[0].priority; delete prm.encodings[0].networkPriority; s.setParameters(prm).catch(() => {}); } catch (e) { /* nada */ }
        });
      } catch (e) { /* no es esencial */ }
    }
    function retry(p) {
      if (S.peers.get(p.pid) !== p || !S.joined) return;
      p.state = 'failed';
      emit();
      clearTimeout(p.retryTimer);
      p.retries = (p.retries || 0) + 1;
      if (p.retries > 6) return; // ya no: queda marcado como sin conexión
      const wait = Math.min(15000, 1500 * p.retries);
      p.retryTimer = setTimeout(() => {
        if (S.peers.get(p.pid) !== p || !S.joined) return;
        const m = S.members.find((x) => x.pid === p.pid);
        if (!m) return;
        if (S.myPid < p.pid) offer(m, p.retries);
        else transport.signal(p.pid, { type: 'ping', to: m.sid });
      }, wait);
    }

    async function offer(m, retries = 0) {
      const p = newPeer(m.pid, m.sid, 'offer');
      p.retries = retries;
      try {
        const o = await p.pc.createOffer({ offerToReceiveAudio: true });
        await p.pc.setLocalDescription({ type: 'offer', sdp: tuneSdp(o.sdp) });
        await waitIce(p.pc);
        if (S.peers.get(m.pid) !== p) return;
        const sent = await transport.signal(m.pid, { type: 'offer', sdp: p.pc.localDescription.sdp, to: m.sid });
        if (sent === false) retry(p); // no llegó a la base: se vuelve a mandar enseguida
      } catch (e) { retry(p); }
    }

    async function onOffer(from, sid, data) {
      const m = S.members.find((x) => x.pid === from);
      const p = newPeer(from, sid, 'answer');
      if (m && m.sid !== sid) m.sid = sid;
      try {
        await p.pc.setRemoteDescription({ type: 'offer', sdp: String(data.sdp || '') });
        // Si la llamada se armó antes de tener micrófono (recvonly), igual se manda la pista.
        const a = await p.pc.createAnswer();
        await p.pc.setLocalDescription({ type: 'answer', sdp: tuneSdp(a.sdp) });
        await waitIce(p.pc);
        if (S.peers.get(from) !== p) return;
        const sent = await transport.signal(from, { type: 'answer', sdp: p.pc.localDescription.sdp, to: sid });
        if (sent === false) retry(p);
      } catch (e) { retry(p); }
    }

    async function onSignal(msg) {
      if (!S.joined || !msg || !msg.data) return;
      const { from, sid, data } = msg;
      if (data.to && data.to !== S.mySid) return; // era para una sesión mía anterior
      if (data.type === 'offer') return onOffer(from, sid, data);
      const p = S.peers.get(from);
      if (data.type === 'answer') {
        if (!p || p.role !== 'offer' || p.pc.signalingState !== 'have-local-offer') return;
        try { await p.pc.setRemoteDescription({ type: 'answer', sdp: String(data.sdp || '') }); } catch (e) { retry(p); }
        return;
      }
      if (data.type === 'ping') {
        // El otro no recibió nuestra oferta (o se cayó): se la mandamos de nuevo.
        if (S.myPid < from && (!p || p.state !== 'connected')) {
          const m = S.members.find((x) => x.pid === from);
          if (m) offer(m, p ? p.retries : 0);
        }
      }
    }

    function onMembers(list) {
      if (!S.joined) return;
      const me = list.find((m) => m.self);
      if (me) { S.myPid = me.pid; S.mySid = me.sid || S.mySid; }
      S.members = list.slice();
      const ids = new Set(list.filter((m) => !m.self).map((m) => m.pid));
      // La lista llega cada 3 s: alguien que acaba de mandar su oferta puede no figurar todavía.
      for (const [pid, p] of [...S.peers]) if (!ids.has(pid) && Date.now() - p.born > 12000) closePeer(pid);
      for (const m of list) {
        if (m.self) continue;
        const p = S.peers.get(m.pid);
        if (p && p.sid !== m.sid && p.role === 'offer') closePeer(m.pid); // volvió a entrar: llamada nueva
        if (p && p.sid !== m.sid && p.role === 'answer' && p.state !== 'connecting') closePeer(m.pid);
        if (S.peers.has(m.pid)) continue;
        if (S.myPid && S.myPid < m.pid) offer(m);
        else {
          // Nos toca esperar su oferta. Si no llega, se la pedimos.
          const w = { pid: m.pid, sid: m.sid };
          clearTimeout(S['wait_' + m.pid]);
          S['wait_' + m.pid] = setTimeout(() => {
            if (S.joined && !S.peers.has(w.pid) && S.members.some((x) => x.pid === w.pid)) transport.signal(w.pid, { type: 'ping', to: w.sid });
          }, 8000);
        }
      }
      emit();
    }

    function onStatus(st) {
      if (!st) return;
      if (st.state === 'error') S.error = st.error || 'error';
      else if (st.state === 'on') S.error = '';
      if (st.state === 'off' && S.joined) { teardown(); }
      if (st.channel !== undefined && st.state !== 'off') S.channel = st.channel;
      emit();
    }

    function teardown() {
      for (const pid of [...S.peers.keys()]) closePeer(pid);
      for (const k of Object.keys(S)) if (k.startsWith('wait_')) { clearTimeout(S[k]); delete S[k]; }
      S.joined = false; S.joining = false; S.channel = null; S.want = null;
      S.members = []; S.sending = false; S.ptt = false; S.pttUntil = 0;
      stopTick();
      closeMic();
    }

    const offs = [
      transport.onMembers((l) => onMembers(Array.isArray(l) ? l : [])),
      transport.onSignal((m) => { onSignal(m); }),
      transport.onStatus((s) => onStatus(s))
    ];

    return {
      async join(which) {
        if (S.joining) return;
        if (S.joined && S.want === which) return;
        if (S.joined) await this.leave();
        S.joining = true; S.error = ''; S.want = which;
        emit();
        await openMic();
        try {
          const r = await transport.join(which);
          S.channel = r && r.channel || null;
          S.mySid = r && r.sid || null;
          S.myPid = r && r.pid || S.myPid;
          S.joined = true;
          startTick();
        } catch (e) {
          S.error = String((e && e.message) || 'error').replace(/^Error:\s*/, '');
          closeMic();
          S.want = null;
        }
        S.joining = false;
        transport.mute(S.muted);
        emit(true);
      },
      async leave() {
        const was = S.joined;
        teardown();
        emit(true);
        if (was) { try { await transport.leave(); } catch (e) { /* nada */ } }
      },
      setPtt(down) {
        const d = !!down;
        if (S.ptt === d) return;
        S.ptt = d;
        S.pttUntil = d ? 0 : performance.now() + PTT_TAIL_MS; // el tic lo corta cuando vence
        applySend();
      },
      setMuted(on) { S.muted = !!on; if (S.muted) { S.ptt = false; S.pttUntil = 0; } applySend(); transport.mute(S.muted); emit(); },
      setDeafened(on) {
        S.deafened = !!on;
        if (S.deafened && !S.muted) { S.muted = true; S.deafenMuted = true; transport.mute(true); }
        else if (!S.deafened && S.deafenMuted) { S.muted = false; S.deafenMuted = false; transport.mute(false); }
        for (const p of S.peers.values()) if (p.audio) p.audio.volume = peerVolume(p.pid);
        applySend(); emit();
      },
      async setSettings(next) {
        const prev = S.settings;
        S.settings = Object.assign({}, prev, next || {});
        for (const p of S.peers.values()) if (p.audio) p.audio.volume = peerVolume(p.pid);
        // Otro micrófono o el filtro de ruido: se cambia la pista en todas las llamadas sin cortarlas.
        if (S.joined && (prev.device !== S.settings.device || prev.noise !== S.settings.noise)) {
          const old = S.stream;
          const oldMeter = S.meterTrack;
          S.stream = null;
          await openMic();
          for (const p of S.peers.values()) {
            const s = p.pc.getSenders().find((x) => x.track === null || (x.track && x.track.kind === 'audio'));
            if (s && S.track) s.replaceTrack(S.track).catch(() => {});
          }
          if (old && old !== S.stream) old.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* nada */ } });
          if (oldMeter && oldMeter !== S.meterTrack) { try { oldMeter.stop(); } catch (e) { /* nada */ } }
        }
        applySend(); emit();
      },
      setIce(list) { S.iceServers = (Array.isArray(list) ? list : []).concat(DEFAULT_ICE); },
      state: snapshot,
      level: () => S.localLevel,
      destroy() { offs.forEach((f) => { try { f && f(); } catch (e) { /* nada */ } }); teardown(); },
      _peers: S.peers
    };
  }

  window.TLVoiceEngine = { createEngine, tuneSdp };
})();
