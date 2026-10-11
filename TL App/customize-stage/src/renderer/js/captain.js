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

  let box = null;
  let data = null;
  let tab = 'plantel';
  let busy = false;
  let lastKey = null; // { name, key }
  let msg = null;
  let timer = null;

  function flash(text, bad) { msg = { text, bad: !!bad }; paint(); setTimeout(() => { if (msg && msg.text === text) { msg = null; paint(); } }, 6000); }

  async function load() {
    try { data = await window.tvm.admin.get(); } catch (e) { data = null; flash(e.message || String(e), true); }
    paint();
  }

  async function act(action) {
    if (busy) return null;
    busy = true;
    paint();
    try {
      const r = await window.tvm.admin.do(action);
      data = { doc: r.doc, members: r.members, alerts: r.alerts || [], version: data ? data.version : '' };
      return r;
    } catch (e) { flash(e.message || String(e), true); return null; } finally { busy = false; paint(); }
  }

  async function newKey(name) {
    if (!window.confirm(`¿Cambiar la clave de ${name}? La actual deja de funcionar y tenés que pasarle la nueva.`)) return;
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
    root.append(el('p', 'cap__sum', `${members.length} personas · ${online} conectadas · ${old} con versión vieja${latest ? ` (última vista: v${latest})` : ''}`));

    const table = el('div', 'cap__table');
    const head = el('div', 'cap__row cap__row--head');
    for (const t of ['Nombre', 'Estado', 'Versión', '']) head.append(el('span', null, t));
    table.append(head);
    for (const m of members) {
      const row = el('div', 'cap__row');
      const name = el('span', 'cap__name');
      name.append(el('i', `cap__dot${m.online ? ' is-on' : ''}`), document.createTextNode(m.name + (m.self ? ' (vos)' : '')));
      const state = el('span', 'cap__state', m.online ? (m.room ? `En línea · ${m.room}` : 'En línea') : (m.lastSeen ? `Último acceso ${ago(m.lastSeen)}` : 'Nunca entró'));
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
        if (!window.confirm(`¿Quitarle el acceso a ${m.name}? Dejará de poder usar la app.`)) return;
        await act({ type: 'removeUser', name: m.name });
      });
      acts.append(free, nk, del);
      row.append(name, state, ver, acts);
      table.append(row);
    }
    root.append(table);

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
      const r = await act({ type: 'addUser', name: input.value });
      if (r && r.extra) lastKey = r.extra;
      paint();
    });
    root.append(form);

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
      k.append(el('div', null, `Clave de ${lastKey.name} — se muestra una sola vez, pasásela por privado:`));
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
    const urg = el('input'); urg.type = 'checkbox';
    const urgLabel = el('label', 'cap__chk'); urgLabel.append(urg, document.createTextNode(' Urgente (aparece enseguida en todas las apps abiertas)'));
    line.append(atLabel, repLabel);
    const go = el('button', 'cap__btn', 'Publicar aviso'); go.type = 'submit'; go.disabled = busy;
    form.append(title, text, line, urgLabel, go);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!text.value.trim()) { flash('Escribí el texto del aviso.', true); return; }
      const when = at.value ? Date.parse(at.value) : 0;
      const r = await act({ type: 'addNotice', title: title.value, text: text.value, at: when || 0, repeat: rep.value || null, urgent: urg.checked });
      if (r) { flash(when && when > Date.now() ? 'Aviso programado.' : 'Aviso publicado.'); title.value = ''; text.value = ''; at.value = ''; urg.checked = false; }
    });
    root.append(form);

    root.append(el('h3', 'cap__h', 'Avisos publicados'));
    const notices = (data.doc.notices || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    if (!notices.length) root.append(el('p', 'cap__muted', 'No hay avisos.'));
    for (const n of notices) {
      const row = el('div', 'cap__notice');
      const info = el('div', 'cap__ninfo');
      const future = n.at > Date.now();
      const tags = [n.urgent ? 'URGENTE' : '', n.repeat === 'daily' ? 'cada día' : n.repeat === 'weekly' ? 'cada semana' : '', future ? 'programado' : (!n.repeat && Date.now() - n.at > 7 * 86400000 ? 'vencido' : '')].filter(Boolean).join(' · ');
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
      if (doc.enabled && !window.confirm('¿Pausar la lista? Cualquiera podrá usar la app sin clave hasta que la actives de nuevo.')) return;
      await act({ type: 'setEnabled', value: !doc.enabled });
    });
    root.append(tog);

    root.append(el('h3', 'cap__h', 'Actualización obligatoria'));
    root.append(el('p', 'cap__muted', doc.forceUpdate === true
      ? 'ACTIVA: cuando publicás una versión nueva, a todos (menos a vos) les sale un cartel al abrir la app y no pueden usarla hasta actualizar.'
      : 'APAGADA: nadie queda obligado a actualizar (salvo que pongas una versión mínima). Cuando esté activa, el cartel solo sale al abrir la app.'));
    const force = el('button', 'cap__btn', doc.forceUpdate === true ? 'Apagar la actualización obligatoria' : 'Activar la actualización obligatoria');
    force.type = 'button'; force.disabled = busy;
    force.addEventListener('click', () => act({ type: 'setForceUpdate', value: doc.forceUpdate !== true }));
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
        if (cmp(ver, latest || data.version) > 0 && !window.confirm(`Ninguna versión publicada que yo vea llega a v${ver}. Si todavía no la publicaste, TODOS quedarían bloqueados. ¿Seguro?`)) return;
        if (out.length && !window.confirm(`Quedarían bloqueados hasta actualizar: ${out.join(', ')}. ¿Seguro?`)) return;
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
    if (tab === 'plantel') tabPlantel(body);
    else if (tab === 'avisos') tabAvisos(body);
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
    const card = el('div', 'cap__card');
    const head = el('div', 'cap__head');
    head.append(el('h2', null, 'Panel del capitán'));
    const x = el('button', 'cap__x', '×'); x.type = 'button'; x.addEventListener('click', close);
    head.append(x);
    const tabs = el('div', 'cap__tabs');
    for (const [id, label] of [['plantel', 'Plantel'], ['avisos', 'Avisos'], ['acceso', 'Acceso y versión']]) {
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
    paint();
    load();
    timer = setInterval(() => { if (!busy && tab === 'plantel' && !box.querySelector('input:focus, textarea:focus, select:focus')) load(); }, 30000);
  }

  window.TLCaptain = { open, close };
})();
