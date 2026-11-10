/*
 * Ajustes favoritos: una estrellita en cada ajuste. Los marcados quedan listados
 * arriba del índice del panel y llevan directo a su lugar. Se guardan en esta PC.
 */
(function () {
  'use strict';
  const KEY = 'tl_favs';
  let favs = [];
  try { favs = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(favs)) favs = []; } catch (e) { favs = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(favs)); } catch (e) { /* sin almacenamiento */ } };

  const labelOf = (row) => {
    const el = row.querySelector('.row__label');
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('.hint, .favstar').forEach((n) => n.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  };
  const secTitleOf = (sec) => {
    const h = sec.querySelector('.sec__title');
    if (!h) return sec.dataset.sec || '';
    const c = h.cloneNode(true);
    c.querySelectorAll('.hint').forEach((n) => n.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  };
  const keyOf = (sec, label) => `${sec}|${label}`;

  /*
   * Si un ajuste se mudó de sección (o de página), el favorito guardado sigue
   * apuntando a la vieja. Se lo busca por nombre y, si aparece una sola vez en
   * otro lado, se corrige ahí mismo: la estrella queda prendida y el atajo lleva
   * al lugar nuevo.
   */
  let seenRows = -1;
  function relocate(root, rows) {
    // Sólo cuando aparecen filas nuevas: el panel muta a cada rato (un deslizador
    // que reescribe su valor) y esto clona la etiqueta de cada fila.
    if (!favs.length || rows.length === seenRows) return;
    seenRows = rows.length;
    let changed = false;
    for (const f of favs) {
      const here = rows.some((r) => r.closest('[data-sec]').dataset.sec === f.sec && labelOf(r) === f.label);
      if (here) continue;
      const found = rows.filter((r) => labelOf(r) === f.label);
      if (found.length !== 1) continue;
      const sec = found[0].closest('[data-sec]');
      const page = found[0].closest('[data-page]');
      f.sec = sec.dataset.sec;
      f.k = keyOf(f.sec, f.label);
      f.page = page ? page.dataset.page : f.page;
      f.secTitle = secTitleOf(sec);
      changed = true;
    }
    if (changed) { save(); paint(); }
  }

  function decorate() {
    const root = document.getElementById('panel');
    if (!root) return;
    const rows = [...root.querySelectorAll('.page .sec[data-sec] .row')];
    relocate(root, rows);
    for (const row of rows) {
      if (row.querySelector('.favstar')) continue;
      const text = row.querySelector('.row__text');
      const label = labelOf(row);
      if (!text || !label) continue;
      const sec = row.closest('[data-sec]');
      const k = keyOf(sec.dataset.sec, label);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'favstar';
      b.title = 'Favorito';
      b.setAttribute('aria-label', 'Favorito');
      b.textContent = favs.some((f) => f.k === k) ? '★' : '☆';
      b.classList.toggle('is-on', b.textContent === '★');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const page = row.closest('[data-page]');
        const i = favs.findIndex((f) => f.k === k);
        if (i >= 0) favs.splice(i, 1);
        else favs.push({ k, page: page ? page.dataset.page : '', sec: sec.dataset.sec, label, secTitle: secTitleOf(sec) });
        save();
        b.textContent = i >= 0 ? '☆' : '★';
        b.classList.toggle('is-on', i < 0);
        paint();
      });
      const lab = row.querySelector('.row__label') || text;
      lab.appendChild(b);
    }
  }

  function flash(sec, label) {
    const secEl = document.querySelector(`[data-sec="${sec}"]`);
    if (!secEl) return;
    for (const row of secEl.querySelectorAll('.row')) {
      if (labelOf(row) === label) {
        row.scrollIntoView({ block: 'center' });
        row.classList.add('is-flash');
        setTimeout(() => row.classList.remove('is-flash'), 1800);
        return;
      }
    }
  }

  function paint() {
    const host = document.getElementById('favList');
    if (!host) return;
    host.replaceChildren();
    host.hidden = !favs.length;
    if (!favs.length) return;
    const head = document.createElement('span');
    head.className = 'pnav__group';
    head.textContent = '★ Favoritos';
    host.appendChild(head);
    for (const f of favs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pnav__i';
      b.textContent = f.label;
      b.title = f.secTitle || '';
      b.addEventListener('click', () => {
        try { if (typeof goToSection === 'function') goToSection(f.page, f.sec); } catch (e) { /* sin navegación */ }
        setTimeout(() => flash(f.sec, f.label), 350);
      });
      host.appendChild(b);
    }
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; decorate(); });
  }

  function start() {
    paint();
    decorate();
    const root = document.getElementById('panel');
    if (root) new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
