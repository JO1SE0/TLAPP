/*
 * Panel del capitán: plantel (quién usó la app, con qué versión), avisos
 * programados y urgentes, alta y baja de gente, pausa de la lista y versión mínima.
 * Todo se firma en el proceso principal (main/admin.js); acá sólo se pide y se muestra.
 */
(function () {
  'use strict';

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const cmp = (a, b) => {
    const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
    return 0;
  };
  const ago = (ms) => {
    if (!ms) return 'nunca';
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 90) return 'recién';
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return `hace ${Math.round(s / 86400)} d`;
  };
  const when = (ms) => new Date(ms).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  /** «90 min» → «1 h 30 min», «1440» → «1 día». */
  const fmtDur = (mins) => {
    const m = Math.max(0, Math.round(mins));
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    const mm = m % 60;
    const parts = [];
    if (d) parts.push(`${d} ${d === 1 ? 'día' : 'días'}`);
    if (h) parts.push(`${h} h`);
    if (mm && !d) parts.push(`${mm} min`);
    return parts.join(' ') || '0 min';
  };
  const UNITS = [['minutos', 1], ['horas', 60], ['días', 1440]];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
  };
  const readKnown = () => { try { return new Set(JSON.parse(store.get('tl_cap_known', '[]'))); } catch (e) { return new Set(); } };
  const THEMES = [['club', 'Azul y dorado (club)'], ['claro', 'Claro'], ['cancha', 'Verde cancha'], ['carmesi', 'Carmesí']];

  /** Confirmación escrita para lo importante: hay que tipear la palabra para poder seguir. */
  function typedConfirm(message, word) {
    return new Promise((resolve) => {
      const back = el('div', 'cap__modal');
      const card = el('div', 'cap__mcard');
      card.append(el('p', null, message), el('p', 'cap__muted', `Para confirmar escribí: ${word}`));
      const input = el('input', 'cap__input'); input.autocomplete = 'off'; input.spellcheck = false;
      const row = el('div', 'cap__form');
      const ok = el('button', 'cap__btn', 'Confirmar'); ok.type = 'button'; ok.disabled = true;
      const no = el('button', 'cap__btn cap__btn--ghost', 'Cancelar'); no.type = 'button';
      const done = (v) => { back.remove(); resolve(v); };
      input.addEventListener('input', () => { ok.disabled = input.value.trim().toUpperCase() !== word.toUpperCase(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ok.disabled) done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
      ok.addEventListener('click', () => done(true));
      no.addEventListener('click', () => done(false));
      row.append(ok, no);
      card.append(input, row);
      back.append(card);
      box.append(back);
      setTimeout(() => input.focus(), 30);
    });
  }

  const flat = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  function dist(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }
  /** Nombres ya existentes (activos o quitados) que se parecen al que se quiere agregar. */
  function similarNames(name) {
    const f = flat(name);
    const all = [...(data.doc.users || []), ...(data.doc.removed || [])].map((u) => u.name);
    return all.filter((n) => { const g = flat(n); return g === f || dist(f, g) <= 1 || (f.length >= 3 && g.length >= 3 && (g.startsWith(f) || f.startsWith(g))); });
  }

  let box = null;
  let data = null;
  let person = null;
  let brief = null;
  let briefShown = false;
  let tab = 'plantel';
  let theme = store.get('tl_cap_theme', 'club');
  let busy = false;
  let lastKey = null; // { name, key }
  let msg = null;
  let timer = null;

  function flash(text, bad) { msg = { text, bad: !!bad }; paint(); setTimeout(() => { if (msg && msg.text === text) { msg = null; paint(); } }, 6000); }

  function makeBrief() {
    const lastSeen = Number(store.get('tl_cap_seen', '0')) || 0;
    const known = readKnown();
    const members = data.members || [];
    const entered = members.filter((m) => m.lastSeen > 0).map((m) => m.name);
    const fresh = known.size ? entered.filter((n) => !known.has(n)) : [];
    const att = (data.attempts || []).filter((a) => a.at > lastSeen);
    const latest = latestVersion();
    brief = {
      since: lastSeen,
      fresh,
      alerts: (data.alerts || []).length,
      attempts: att.reduce((s, a) => s + a.n, 0),
      never: members.filter((m) => !m.lastSeen).length,
      old: members.filter((m) => m.version && latest && cmp(m.version, latest) < 0).length
    };
    store.set('tl_cap_seen', String(Date.now()));
    store.set('tl_cap_known', JSON.stringify(entered));
  }

  async function load() {
    try { data = await window.tvm.admin.get(); } catch (e) { data = null; flash(e.message || String(e), true); }
    if (data && !briefShown) { briefShown = true; makeBrief(); }
    paint();
  }

  async function act(action) {
    if (busy) return null;
    busy = true;
    paint();
    try {
      const r = await window.tvm.admin.do(action);
      data = { doc: r.doc, members: r.members, alerts: r.alerts || [], attempts: r.attempts || [], trials: r.trials || [], undo: r.undo || null, version: data ? data.version : '' };
      return r;
    } catch (e) { flash(e.message || String(e), true); return null; } finally { busy = false; paint(); }
  }

  async function newKey(name) {
    if (!await typedConfirm(`¿Cambiar la clave de ${name}? La actual deja de funcionar y tenés que pasarle la nueva.`, 'CLAVE')) return;
    const r = await act({ type: 'changeKey', name });
    if (r && r.extra) { lastKey = r.extra; tab = 'plantel'; paint(); }
  }

  function latestVersion() {
    let best = '';
    for (const m of (data && data.members) || []) if (m.version && cmp(m.version, best) > 0) best = m.version;
    return best;
  }

  /* ── pestañas ─────────────────────────────────────────── */
  function tabPlantel(root) {
    const members = data.members || [];
    const latest = latestVersion();
    const online = members.filter((m) => m.online).length;
    const old = members.filter((m) => m.version && latest && cmp(m.version, latest) < 0).length;
    if (brief && !brief.hidden) {
      const lines = [];
      if (brief.fresh.length) lines.push(`🆕 Entraron por primera vez: ${brief.fresh.join(', ')}.`);
      if (brief.alerts) lines.push(`⚠ ${brief.alerts} alerta${brief.alerts > 1 ? 's' : ''} de clave compartida sin resolver.`);
      if (brief.attempts) lines.push(`🔑 ${brief.attempts} intento${brief.attempts > 1 ? 's' : ''} con clave incorrecta desde tu última visita.`);
      if (brief.old) lines.push(`⬇ ${brief.old} persona${brief.old > 1 ? 's' : ''} con versión vieja.`);
      if (brief.never) lines.push(`💤 ${brief.never} nunca entr${brief.never > 1 ? 'aron' : 'ó'} a la app.`);
      const card = el('div', 'cap__brief');
      card.append(el('b', null, brief.since ? `Desde tu última visita (${ago(brief.since)})` : 'Primera vez que abrís el panel'));
      if (!lines.length) lines.push('Todo tranquilo: no hay novedades.');
      for (const l of lines) card.append(el('div', null, l));
      const okb = el('button', 'cap__btn cap__btn--ghost cap__btn--sm', 'Entendido'); okb.type = 'button';
      okb.addEventListener('click', () => { brief.hidden = true; paint(); });
      card.append(okb);
      root.append(card);
    }
    for (const al of data.alerts || []) {
      const box = el('div', 'cap__alert');
      box.append(el('b', null, '⚠'), el('span', null, `La clave de ${al.name} se usó desde otra PC (${ago(al.at)}). Quedó bloqueada en las dos.`));
      const keep = el('button', 'cap__btn cap__btn--sm', 'Perdonar al dueño'); keep.type = 'button'; keep.disabled = busy;
      keep.title = 'Libera la clave y deja VETADA la PC que la usó sin permiso: el dueño la recupera, el otro queda afuera.';
      keep.addEventListener('click', async () => { if (await act({ type: 'resetDevice', name: al.name, banDevice: al.device })) flash(`${al.name} liberado; la otra PC quedó vetada.`); });
      const free = el('button', 'cap__btn cap__btn--sm cap__btn--ghost', 'Solo liberar'); free.type = 'button'; free.disabled = busy;
      free.title = 'Por si es la misma persona cambiando de PC: la primera que entre se queda con la clave.';
      free.addEventListener('click', async () => { if (await act({ type: 'resetDevice', name: al.name })) flash(`PC de ${al.name} liberada.`); });
      const nk = el('button', 'cap__btn cap__btn--sm', 'Clave nueva'); nk.type = 'button'; nk.disabled = busy;
      nk.title = 'Anula la clave actual y genera otra (por si la compartió).';
      nk.addEventListener('click', () => newKey(al.name));
      const no = el('button', 'cap__btn cap__btn--sm cap__btn--ghost', 'Descartar'); no.type = 'button'; no.disabled = busy;
      no.addEventListener('click', () => act({ type: 'dismissAlert', name: al.name }));
      box.append(keep, free, nk, no);
      root.append(box);
    }
    if ((data.attempts || []).length) {
      const att = el('div', 'cap__alert');
      const total = data.attempts.reduce((s, a) => s + a.n, 0);
      att.append(el('b', null, '🔑'), el('span', null, `${data.attempts.length} PC${data.attempts.length > 1 ? 's' : ''} probaron claves incorrectas (${total} intento${total > 1 ? 's' : ''}; la última ${ago(data.attempts[0].at)}). Es orientativo: puede ser alguien equivocándose al escribir.`));
      const clr = el('button', 'cap__btn cap__btn--sm cap__btn--ghost', 'Limpiar'); clr.type = 'button'; clr.disabled = busy;
      clr.addEventListener('click', async () => { try { await window.tvm.admin.clearAttempts(); data.attempts = []; paint(); } catch (e) { flash(e.message || String(e), true); } });
      att.append(clr);
      root.append(att);
    }
    root.append(el('p', 'cap__sum', `${members.length} personas · ${online} conectadas · ${old} con versión vieja${latest ? ` (última vista: v${latest})` : ''}`));

    const table = el('div', 'cap__table');
    const head = el('div', 'cap__row cap__row--head');
    for (const t of ['Nombre', 'Estado', 'Versión', '']) head.append(el('span', null, t));
    table.append(head);
    for (const m of members) {
      const row = el('div', 'cap__row');
      const name = el('span', 'cap__name');
      name.append(el('i', `cap__dot${m.online ? ' is-on' : ''}`), document.createTextNode(m.name + (m.self ? ' (vos)' : '') + (m.trial ? ' · PRUEBA' : '')));
      name.classList.add('is-link');
      name.title = 'Ver la ficha';
      name.addEventListener('click', () => { person = m.name; personData = null; paint(); loadPerson(m.name); });
      const state = el('span', 'cap__state', m.online ? (m.room ? `En línea · ${m.room}` : 'En línea') : (m.lastSeen ? `Último acceso ${ago(m.lastSeen)}${m.lastRoom ? ` · ${m.lastRoom}` : ''}` : 'Nunca entró'));
      state.title = m.lastSeen ? new Date(m.lastSeen).toLocaleString('es-AR') : '';
      const outdated = m.version && latest && cmp(m.version, latest) < 0;
      const ver = el('span', `cap__ver${outdated ? ' is-old' : ''}`, m.version ? `v${m.version}${outdated ? ' ⚠' : ''}` : '—');
      const acts = el('span', 'cap__acts');
      const free = el('button', 'cap__btn cap__btn--ghost cap__btn--sm', 'Liberar PC');
      free.type = 'button'; free.disabled = m.self || busy;
      free.title = 'Que pueda usar su clave en otra PC.';
      free.addEventListener('click', async () => { if (await act({ type: 'resetDevice', name: m.name })) flash(`PC de ${m.name} liberada.`); });
      const nk = el('button', 'cap__btn cap__btn--ghost cap__btn--sm', 'Clave nueva');
      nk.type = 'button'; nk.disabled = m.self || busy;
      nk.addEventListener('click', () => newKey(m.name));
      const del = el('button', 'cap__btn cap__btn--ghost cap__btn--sm', 'Quitar');
      del.type = 'button';
      del.disabled = m.self || busy;
      del.addEventListener('click', async () => {
        if (!await typedConfirm(`¿Quitarle el acceso a ${m.name}? Dejará de poder usar la app.`, 'QUITAR')) return;
        await act({ type: 'removeUser', name: m.name });
      });
      const rep = el('button', 'cap__btn cap__btn--ghost cap__btn--sm', m.rep ? 'Informes: sí' : 'Informes: no');
      rep.type = 'button'; rep.disabled = m.self || busy;
      rep.title = 'Que pueda ver los informes de partido.';
      rep.addEventListener('click', async () => { if (await act({ type: 'setReports', name: m.name, value: !m.rep })) flash(m.rep ? `${m.name} ya no ve los informes.` : `${m.name} ahora ve los informes.`); });
      const ext = el('button', 'cap__btn cap__btn--ghost cap__btn--sm', m.ext ? 'Ajeno: sí' : 'Ajeno: no');
      ext.type = 'button'; ext.disabled = m.self || busy;
      ext.title = 'Ajeno al club: no ve quién está conectado ni las estadísticas, y nadie del club lo ve a él. Sólo lo ves vos.';
      ext.addEventListener('click', async () => { if (await act({ type: 'setExternal', name: m.name, value: !m.ext })) flash(m.ext ? `${m.name} vuelve a ser del club.` : `${m.name} quedó como ajeno al club.`); });
      acts.append(ext, rep, free, nk, del);
      row.append(name, state, ver, acts);
      table.append(row);
    }
    root.append(table);

    const never = members.filter((m) => !m.lastSeen && !m.self);
    if (never.length) {
      root.append(el('h3', 'cap__h', 'Todavía no entraron'));
      root.append(el('p', 'cap__muted', `${never.map((m) => m.name).join(', ')}. ¿Les llegó la clave?`));
    }

    const form = el('form', 'cap__form');
    const input = el('input', 'cap__input');
    input.placeholder = 'Nombre de la persona nueva';
    input.maxLength = 30;
    const add = el('button', 'cap__btn', 'Agregar y generar clave');
    add.type = 'submit';
    add.disabled = busy;
    form.append(input, add);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      const like = similarNames(input.value);
      if (like.length && !window.confirm(`Se parece a: ${like.join(', ')}. ¿Agregar a "${input.value.trim()}" igual?`)) return;
      const r = await act({ type: 'addUser', name: input.value });
      if (r && r.extra) lastKey = r.extra;
      paint();
    });
    root.append(form);

    // ── Claves de prueba ──
    root.append(el('h3', 'cap__h', 'Claves de prueba'));
    root.append(el('p', 'cap__muted', 'Para que alguien pruebe la app un rato: la clave vence sola. El tiempo empieza a contar la primera vez que la use, no se muestra con la insignia del club y no cuenta como plantel.'));
    const tform = el('form', 'cap__form');
    const tname = el('input', 'cap__input');
    tname.placeholder = 'Nombre (ej: Prueba Juan)';
    tname.maxLength = 30;
    const tnum = el('input', 'cap__input');
    tnum.type = 'number'; tnum.min = '1'; tnum.step = '1'; tnum.value = '2';
    tnum.style.maxWidth = '84px';
    const tunit = el('select', 'cap__input');
    for (const [label, mult] of UNITS) { const o = el('option', null, label); o.value = String(mult); tunit.append(o); }
    tunit.value = '60';
    tunit.style.maxWidth = '110px';
    const presets = el('div', 'cap__presets');
    for (const [label, mins] of [['30 min', 30], ['2 h', 120], ['1 día', 1440], ['3 días', 4320], ['7 días', 10080]]) {
      const b = el('button', 'cap__btn cap__btn--ghost cap__btn--sm', label); b.type = 'button';
      b.addEventListener('click', () => {
        const unit = mins % 1440 === 0 ? 1440 : mins % 60 === 0 ? 60 : 1;
        tunit.value = String(unit); tnum.value = String(mins / unit);
      });
      presets.append(b);
    }
    const tadd = el('button', 'cap__btn', 'Generar clave de prueba');
    tadd.type = 'submit'; tadd.disabled = busy;
    tform.append(tname, tnum, tunit, tadd);
    tform.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!tname.value.trim()) return;
      const minutes = Math.round(Number(tnum.value) * Number(tunit.value));
      const r = await act({ type: 'addTrial', name: tname.value, minutes });
      if (r && r.extra) lastKey = r.extra;
      paint();
    });
    root.append(tform, presets);

    const trials = data.trials || [];
    if (trials.length) {
      root.append(el('h3', 'cap__h', 'Pruebas en curso'));
      for (const t of trials) {
        const row = el('div', 'cap__notice');
        let status;
        if (!t.start) status = `todavía no la usó · dura ${fmtDur(t.minutes)}`;
        else if (Date.now() >= t.end) status = `venció ${ago(t.end)} (duraba ${fmtDur(t.minutes)})`;
        else status = `quedan ${fmtDur((t.end - Date.now()) / 60000)} de ${fmtDur(t.minutes)}`;
        row.append(el('span', null, `${t.name} · ${status}`));
        const n = el('input', 'cap__input'); n.type = 'number'; n.min = '1'; n.step = '1'; n.style.maxWidth = '70px';
        const u = el('select', 'cap__input'); for (const [label, mult] of UNITS) { const o = el('option', null, label); o.value = String(mult); u.append(o); }
        const best = t.minutes % 1440 === 0 ? 1440 : t.minutes % 60 === 0 ? 60 : 1;
        u.value = String(best); n.value = String(t.minutes / best);
        const save = el('button', 'cap__btn cap__btn--sm', 'Cambiar tiempo'); save.type = 'button'; save.disabled = busy;
        save.title = 'Cuenta desde el primer uso: si la ya venció, alargarla la reactiva.';
        save.addEventListener('click', async () => {
          if (await act({ type: 'setTrial', name: t.name, minutes: Math.round(Number(n.value) * Number(u.value)) })) flash(`Prueba de ${t.name} actualizada.`);
        });
        const perm = el('button', 'cap__btn cap__btn--ghost cap__btn--sm', 'Hacer permanente'); perm.type = 'button'; perm.disabled = busy;
        perm.addEventListener('click', async () => {
          if (!await typedConfirm(`¿Pasar a ${t.name} a acceso común sin vencimiento? Pasa a contar como plantel (con la insignia).`, 'PERMANENTE')) return;
          if (await act({ type: 'setTrial', name: t.name, minutes: 0 })) flash(`${t.name} ya no es de prueba.`);
        });
        const del = el('button', 'cap__btn cap__btn--ghost cap__btn--sm', 'Quitar'); del.type = 'button'; del.disabled = busy;
        del.addEventListener('click', async () => {
          if (!await typedConfirm(`¿Quitar la prueba de ${t.name}?`, 'QUITAR')) return;
          await act({ type: 'removeUser', name: t.name });
        });
        row.append(n, u, save, perm, del);
        root.append(row);
      }
    }

    const gone = (data.doc.removed || []);
    if (gone.length) {
      root.append(el('h3', 'cap__h', 'Quitados'));
      for (const u of gone) {
        const row = el('div', 'cap__notice');
        row.append(el('span', null, `${u.name} · quitado ${ago(u.at)}`));
        const back = el('button', 'cap__btn cap__btn--sm', 'Reactivar'); back.type = 'button'; back.disabled = busy;
        back.title = 'Vuelve a tener acceso con la misma clave de antes, en una PC libre.';
        back.addEventListener('click', async () => { if (await act({ type: 'restoreUser', name: u.name })) flash(`${u.name} reactivado.`); });
        row.append(back);
        root.append(row);
      }
    }

    if (lastKey) {
      const k = el('div', 'cap__key');
      k.append(el('div', null, lastKey.minutes ? `Clave de prueba de ${lastKey.name} (dura ${fmtDur(lastKey.minutes)} desde que la use) — se muestra una sola vez, pasásela por privado:` : `Clave de ${lastKey.name} — se muestra una sola vez, pasásela por privado:`));
      const code = el('code', null, lastKey.key);
      const copy = el('button', 'cap__btn', 'Copiar');
      copy.type = 'button';
      copy.addEventListener('click', () => { try { navigator.clipboard.writeText(lastKey.key); copy.textContent = 'Copiada'; } catch (e) { /* se copia a mano */ } });
      const close = el('button', 'cap__btn cap__btn--ghost', 'Listo');
      close.type = 'button';
      close.addEventListener('click', () => { lastKey = null; paint(); });
      k.append(code, copy, close);
      root.append(k);
    }
  }

  let personData = null;
  async function loadPerson(name) {
    try { personData = await window.tvm.admin.person(name); } catch (e) { personData = { error: e.message || String(e) }; }
    paint();
  }

  function tabPerson(root) {
    const m = (data.members || []).find((x) => x.name === person);
    const back = el('button', 'cap__btn cap__btn--ghost cap__btn--sm', '← Volver al plantel'); back.type = 'button';
    back.addEventListener('click', () => { person = null; paint(); });
    root.append(back);
    if (!m) { root.append(el('p', 'cap__muted', 'Esa persona ya no está en la lista.')); return; }
    root.append(el('h3', 'cap__h', m.name + (m.self ? ' (vos)' : '')));
    const latest = latestVersion();
    const rows = [
      ['Estado', m.online ? `En línea${m.room ? ` · ${m.room}` : ''}` : (m.lastSeen ? `Último acceso ${ago(m.lastSeen)} (${new Date(m.lastSeen).toLocaleString('es-AR')})` : 'Nunca entró')],
      ['Última sala conocida', m.lastRoom || '—'],
      ['Versión', m.version ? `v${m.version}${latest && cmp(m.version, latest) < 0 ? ' (desactualizada)' : ''}` : '—']
    ];
    if (personData && !personData.error) {
      rows.push(['PC registrada desde', personData.deviceSince ? new Date(personData.deviceSince).toLocaleString('es-AR') : (m.self ? 'No aplica (capitán)' : 'Todavía ninguna')]);
      rows.push(['Veces que le liberaste la PC / cambiaste la clave', String(personData.releases)]);
      rows.push(['PCs vetadas', String(personData.banned)]);
    } else if (personData && personData.error) rows.push(['Datos de su PC', personData.error]);
    else rows.push(['Datos de su PC', 'Cargando…']);
    const table = el('div', 'cap__table');
    for (const [k, v] of rows) { const r = el('div', 'cap__row cap__row--kv'); r.append(el('span', 'cap__muted', k), el('span', null, v)); table.append(r); }
    root.append(table);

    root.append(el('h3', 'cap__h', 'Movimientos de esta persona'));
    const mine = (data.doc.history || []).filter((h) => h.who === m.name).slice().reverse().slice(0, 15);
    if (!mine.length) root.append(el('p', 'cap__muted', 'Sin movimientos registrados.'));
    for (const h of mine) root.append(el('div', 'cap__hist', `${when(h.t)} — ${h.text}`));
  }

  function tabHistorial(root) {
    const list = (data.doc.history || []).slice().reverse();
    root.append(el('p', 'cap__sum', `${list.length} acción${list.length === 1 ? '' : 'es'} registrada${list.length === 1 ? '' : 's'} (se guardan las últimas 200).`));
    if (!list.length) root.append(el('p', 'cap__muted', 'Todavía no hiciste nada desde el panel.'));
    for (const h of list) {
      const r = el('div', 'cap__hist');
      r.append(el('span', 'cap__muted', when(h.t)), document.createTextNode(` — ${h.text}`));
      root.append(r);
    }
  }

  function tabAvisos(root) {
    const form = el('form', 'cap__form cap__form--col');
    const title = el('input', 'cap__input'); title.placeholder = 'Título (opcional)'; title.maxLength = 80;
    const text = el('textarea', 'cap__input cap__text'); text.placeholder = 'Texto del aviso'; text.maxLength = 600; text.rows = 3;
    const line = el('div', 'cap__line');
    const at = el('input', 'cap__input'); at.type = 'datetime-local';
    const atLabel = el('label', 'cap__lbl', 'Cuándo (vacío = ahora)'); atLabel.append(at);
    const rep = el('select', 'cap__input');
    for (const [v, t] of [['', 'No se repite'], ['daily', 'Todos los días'], ['weekly', 'Todas las semanas']]) { const o = el('option', null, t); o.value = v; rep.append(o); }
    const repLabel = el('label', 'cap__lbl', 'Repetir'); repLabel.append(rep);
    const toSel = el('select', 'cap__input');
    { const o0 = el('option', null, 'Todos'); o0.value = ''; toSel.append(o0);
      for (const u of ((data.doc && data.doc.users) || [])) { if (!u || !u.name || u.banned) continue; const o = el('option', null, u.name); o.value = u.name; toSel.append(o); } }
    const toLabel = el('label', 'cap__lbl', 'Para'); toLabel.append(toSel);
    const urg = el('input'); urg.type = 'checkbox';
    const urgLabel = el('label', 'cap__chk'); urgLabel.append(urg, document.createTextNode(' Urgente (aparece enseguida en todas las apps abiertas)'));
    line.append(toLabel, atLabel, repLabel);
    const go = el('button', 'cap__btn', 'Publicar aviso'); go.type = 'submit'; go.disabled = busy;
    form.append(title, text, line, urgLabel, go);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!text.value.trim()) { flash('Escribí el texto del aviso.', true); return; }
      const when = at.value ? Date.parse(at.value) : 0;
      const r = await act({ type: 'addNotice', title: title.value, text: text.value, at: when || 0, repeat: rep.value || null, urgent: urg.checked, to: toSel.value || '' });
      if (r) { flash(when && when > Date.now() ? 'Aviso programado.' : 'Aviso publicado.'); title.value = ''; text.value = ''; at.value = ''; urg.checked = false; toSel.value = ''; }
    });
    root.append(form);

    root.append(el('h3', 'cap__h', 'Avisos publicados'));
    const notices = (data.doc.notices || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    if (!notices.length) root.append(el('p', 'cap__muted', 'No hay avisos.'));
    for (const n of notices) {
      const row = el('div', 'cap__notice');
      const info = el('div', 'cap__ninfo');
      const future = n.at > Date.now();
      const tags = [n.to ? `solo para ${n.to}` : '', n.urgent ? 'URGENTE' : '', n.repeat === 'daily' ? 'cada día' : n.repeat === 'weekly' ? 'cada semana' : '', future ? 'programado' : (!n.repeat && Date.now() - n.at > 7 * 86400000 ? 'vencido' : '')].filter(Boolean).join(' · ');
      info.append(el('b', null, n.title || '(sin título)'), el('span', 'cap__muted', ` — ${when(n.at)}${tags ? ` · ${tags}` : ''}`), el('div', 'cap__ntext', n.text));
      const del = el('button', 'cap__btn cap__btn--ghost', 'Borrar'); del.type = 'button'; del.disabled = busy;
      del.addEventListener('click', () => act({ type: 'removeNotice', id: n.id }));
      row.append(info, del);
      root.append(row);
    }
  }

  function tabAcceso(root) {
    const doc = data.doc;
    root.append(el('h3', 'cap__h', 'Lista de acceso'));
    root.append(el('p', 'cap__muted', doc.enabled ? 'ACTIVA: hace falta clave para usar la app.' : 'PAUSADA: entra cualquiera, sin clave.'));
    const tog = el('button', 'cap__btn', doc.enabled ? 'Pausar la lista (abrir a todos)' : 'Activar la lista (exigir clave)');
    tog.type = 'button'; tog.disabled = busy;
    tog.addEventListener('click', async () => {
      if (doc.enabled && !await typedConfirm('¿Pausar la lista? Cualquiera podrá usar la app sin clave hasta que la actives de nuevo.', 'PAUSAR')) return;
      await act({ type: 'setEnabled', value: !doc.enabled });
    });
    root.append(tog);

    root.append(el('h3', 'cap__h', 'Actualización obligatoria'));
    root.append(el('p', 'cap__muted', doc.forceUpdate === true
      ? 'ACTIVA: cuando publicás una versión nueva, a todos (menos a vos) les sale un cartel al abrir la app y no pueden usarla hasta actualizar.'
      : 'APAGADA: nadie queda obligado a actualizar (salvo que pongas una versión mínima). Cuando esté activa, el cartel solo sale al abrir la app.'));
    const force = el('button', 'cap__btn', doc.forceUpdate === true ? 'Apagar la actualización obligatoria' : 'Activar la actualización obligatoria');
    force.type = 'button'; force.disabled = busy;
    force.addEventListener('click', async () => {
      if (doc.forceUpdate !== true && !await typedConfirm('¿Activar la actualización obligatoria? Desde ahora, quien abra la app con una versión vieja no va a poder usarla hasta actualizar.', 'ACTIVAR')) return;
      await act({ type: 'setForceUpdate', value: doc.forceUpdate !== true });
    });
    root.append(force);

    root.append(el('h3', 'cap__h', 'Versión mínima'));
    const latest = latestVersion();
    root.append(el('p', 'cap__muted', `Quien tenga una versión más vieja queda bloqueado hasta actualizar (vos no). Tu versión: v${data.version}${latest ? ` · la más nueva en el plantel: v${latest}` : ''}. ${doc.minVersion ? `Ahora exige: v${doc.minVersion}.` : 'Ahora no se exige ninguna.'}`));
    const form = el('form', 'cap__form');
    const v = el('input', 'cap__input'); v.placeholder = 'Ej: 1.0.49 (vacío = sin mínimo)'; v.value = doc.minVersion || ''; v.maxLength = 20;
    const m = el('input', 'cap__input'); m.placeholder = 'Mensaje (opcional)'; m.value = doc.minMessage || ''; m.maxLength = 200;
    const go = el('button', 'cap__btn', 'Guardar'); go.type = 'submit'; go.disabled = busy;
    form.append(v, m, go);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ver = v.value.trim();
      if (ver) {
        const out = ((data.members || []).filter((x) => x.version && cmp(x.version, ver) < 0)).map((x) => x.name);
        const warn = [];
        if (cmp(ver, latest || data.version) > 0) warn.push(`Ninguna versión que yo vea llega a v${ver}: si todavía no la publicaste, TODOS quedarían bloqueados.`);
        if (out.length) warn.push(`Quedarían bloqueados hasta actualizar: ${out.join(', ')}.`);
        if (!await typedConfirm(`${warn.join(' ')} ¿Poner v${ver} como versión mínima?`, 'MINIMA')) return;
      }
      const r = await act({ type: 'setMinVersion', version: ver, message: m.value });
      if (r) flash(ver ? `Versión mínima: v${ver}` : 'Sin versión mínima.');
    });
    root.append(form);
  }

  /* ── armado ───────────────────────────────────────────── */
  function paint() {
    if (!box) return;
    const body = box.querySelector('.cap__body');
    body.textContent = '';
    box.querySelectorAll('.cap__tab').forEach((t) => t.classList.toggle('is-on', t.dataset.tab === tab));
    if (msg) { const m = el('div', `cap__msg${msg.bad ? ' is-bad' : ''}`, msg.text); body.append(m); }
    if (!data) { body.append(el('p', 'cap__muted', 'Cargando…')); return; }
    const undoBtn = box.querySelector('.cap__undo');
    if (undoBtn) {
      const u = data.undo;
      undoBtn.hidden = !u;
      if (u) { undoBtn.textContent = '↩ Deshacer'; undoBtn.title = `Deshacer: ${u.label}`; undoBtn.disabled = busy; }
    }
    if (tab === 'plantel' && person) tabPerson(body);
    else if (tab === 'plantel') tabPlantel(body);
    else if (tab === 'avisos') tabAvisos(body);
    else if (tab === 'historial') tabHistorial(body);
    else tabAcceso(body);
  }

  function close() {
    if (!box) return;
    clearInterval(timer);
    document.removeEventListener('keydown', onKey, true);
    box.remove();
    box = null;
  }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

  function open() {
    if (box) return;
    box = el('div', 'cap');
    box.dataset.theme = theme;
    const card = el('div', 'cap__card');
    const head = el('div', 'cap__head');
    head.append(el('h2', null, 'Panel del capitán'));
    const tools = el('div', 'cap__tools');
    const undo = el('button', 'cap__btn cap__btn--ghost cap__btn--sm cap__undo', '↩ Deshacer'); undo.type = 'button'; undo.hidden = true;
    undo.addEventListener('click', async () => {
      const u = data && data.undo;
      if (!u || !await typedConfirm(`¿Deshacer "${u.label}"?`, 'DESHACER')) return;
      if (await act({ type: 'undo' })) flash('Listo, deshecho.');
    });
    const sel = el('select', 'cap__input cap__theme'); sel.title = 'Tema del panel';
    for (const [v, t] of THEMES) { const o = el('option', null, `Tema: ${t}`); o.value = v; if (v === theme) o.selected = true; sel.append(o); }
    sel.addEventListener('change', () => { theme = sel.value; store.set('tl_cap_theme', theme); box.dataset.theme = theme; });
    const x = el('button', 'cap__x', '×'); x.type = 'button'; x.addEventListener('click', close);
    tools.append(undo, sel, x);
    head.append(tools);
    const tabs = el('div', 'cap__tabs');
    for (const [id, label] of [['plantel', 'Plantel'], ['avisos', 'Avisos'], ['acceso', 'Acceso y versión'], ['historial', 'Historial']]) {
      const b = el('button', 'cap__tab', label); b.type = 'button'; b.dataset.tab = id;
      b.addEventListener('click', () => { tab = id; paint(); });
      tabs.append(b);
    }
    card.append(head, tabs, el('div', 'cap__body'));
    box.append(card);
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
    document.body.append(box);
    document.addEventListener('keydown', onKey, true);
    data = null;
    person = null;
    briefShown = false;
    paint();
    load();
    timer = setInterval(() => { if (!busy && tab === 'plantel' && !box.querySelector('input:focus, textarea:focus, select:focus')) load(); }, 30000);
  }

  /** Cuántas cosas hay sin ver (para el punto rojo del botón): alertas, intentos nuevos y entradas nuevas. */
  function pendingCount(p) {
    if (!p) return 0;
    const lastSeen = Number(store.get('tl_cap_seen', '0')) || 0;
    const known = readKnown();
    const fresh = known.size ? (p.members || []).filter((m) => m.lastSeen > 0 && !known.has(m.name)).length : 0;
    return (p.alerts || []).length + (p.attempts || []).filter((a) => a.at > lastSeen).length + fresh;
  }

  window.TLCaptain = { open, close, pendingCount };
})();
