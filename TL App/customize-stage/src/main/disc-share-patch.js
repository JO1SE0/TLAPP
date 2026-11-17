'use strict';

/**
 * Estilo de ficha compartido: lo poco que necesita el juego para que cada
 * ficha pueda llevar el estilo que eligió SU dueño (si usa TL App).
 *
 * Dos cosas, en el objeto con que HaxBall dibuja cada ficha:
 *
 *  · `__tvmNick`: el nick de su jugador. Así el cliente sabe de quién es cada
 *    ficha cuando el juego arma su textura, y le pinta el estilo de esa persona.
 *  · `__tvmRedo`: si el cliente lo marca, el juego vuelve a armar la textura en
 *    el próximo cuadro. Hace falta porque HaxBall la arma sólo cuando cambia la
 *    camiseta o el avatar, y el estilo del otro puede llegar después (la sala
 *    se lee cada ~25 s). Se logra olvidando la camiseta guardada: el juego ve
 *    que no coincide con la del equipo y la vuelve a pintar.
 *
 * Y, si está el caché de fichas «figurita» del cliente, las fichas con un
 * estilo de los que se dibujan encima (burbuja, vidrio, neón…) se apartan de
 * ese atajo de a una (`__tvmPeerPat`), sin apagarlo para las demás.
 *
 * Costo: por jugador y por cuadro, una comparación y (casi nunca) una
 * asignación. No toca física, red ni teclas.
 */

function loose(re) {
  let out = '';
  const src = re.source;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    out += ch;
    if (ch === '\\') { out += src[++i]; if (!/[\w]/.test(src[i])) out += '\\n?'; continue; }
    if (/[,;=&|!<>{}-]/.test(ch)) out += '\\n?';
  }
  return new RegExp(out, 'g');
}
const all = (s, re) => [...s.matchAll(loose(re))];
const one = (s, re) => { const m = all(s, re); return m.length === 1 ? m[0] : null; };

const SITES = {
  /* La clase de la ficha: el campo de la camiseta guardada y su clase. */
  klass: /class ([\w$]+)\{constructor\(\)\{this\.[\w$]+=!1;this\.[\w$]+="";this\.[\w$]+=0;this\.[\w$]+="";this\.([\w$]+)=new ([\w$]+);let a=window\.document\.createElement\("canvas"\);a\.width=64;a\.height=64;/,
  /* El nombre del jugador, que la ficha copia para dibujarlo. */
  name: /a\.([\w$]+)!=this\.\1&&\(this\.\1=a\.\1,this\.[\w$]+\(\)\)/,
  /* El armado de la ficha en cada cuadro (antes de decidir si rehace la textura). */
  update: /([\w$]+)\(a,b\)\{if\(null!=a\.[\w$]+\)\{let c=/
};
const SPRITE = '  if (!dT.ok || dT.c !== c || dT.burst || !pat || window.__tvmDiscOff) return false;';

function patchDiscShare(source) {
  const fail = (reason) => ({ source, applied: false, reason });
  if (typeof source !== 'string' || source.length < 1000) return fail('fuente vacía');
  if (source.includes('__tvmRedo')) return fail('ya estaba');
  const klass = one(source, SITES.klass);
  if (!klass) return fail('no se encontró la clase de la ficha');
  const [, , kitField, kitClass] = klass;
  const names = all(source, SITES.name);
  if (!names.length || names.some((m) => m[1] !== names[0][1])) return fail('no se encontró el nombre del jugador');
  const nameField = names[0][1];
  // El armado tiene que estar DENTRO de esa clase: el primero después de su arranque.
  const tail = source.slice(klass.index);
  const upd = loose(SITES.update).exec(tail);
  if (!upd || upd.index > 3000) return fail('no se encontró el armado de la ficha');
  const at = klass.index + upd.index + upd[0].indexOf('{') + 1;
  const ins = `this.__tvmNick!==a.${nameField}&&(this.__tvmNick=a.${nameField});` +
    `if(this.__tvmRedo){this.__tvmRedo=0;this.${kitField}=new ${kitClass}}`;
  let out = source.slice(0, at) + ins + source.slice(at);
  if (out.includes(SPRITE)) {
    out = out.replace(SPRITE, SPRITE.replace('window.__tvmDiscOff)', 'window.__tvmDiscOff || (window.__tvmPeerPat && window.__tvmPeerPat.has(pat)))'));
  }
  return { source: out, applied: true, reason: 'estilo de ficha compartido enganchado' };
}

module.exports = { patchDiscShare };
