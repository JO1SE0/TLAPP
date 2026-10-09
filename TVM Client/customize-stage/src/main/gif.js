'use strict';

/* ------------------------------------------------------------------ *
 * Decodificador de GIF
 * ------------------------------------------------------------------ *
 * Existe porque no hay otra forma de sacar los cuadros de un GIF en este
 * Chromium, y las dos que parecen obvias no son:
 *
 *   · Poner el GIF en un <img> y dibujarlo con `drawImage` devuelve SIEMPRE el
 *     mismo cuadro. Medido en Chromium 91 (el de Electron 13) y en uno
 *     moderno, con el elemento visible en pantalla, con opacidad cero, con
 *     display:none y suelto sin insertar: cero cambios en 1,5 s. `drawImage`
 *     no sigue la animación.
 *   · `ImageDecoder` (WebCodecs), que haría esto en tres líneas, aparece
 *     recién en Chromium 94. Acá no existe. Si algún día se sube el Electron,
 *     este archivo se puede tirar.
 *
 * Ojo también con `img.decode()`: con un GIF animado la promesa no se resuelve
 * NUNCA en este Chromium. Hay que esperar el evento `load`.
 *
 * ── Qué devuelve ────────────────────────────────────────────────────────
 *
 * Cuadros COMPUESTOS, o sea imágenes enteras y no los parches que trae el
 * archivo. Un GIF guarda cada cuadro como el rectángulo que cambió respecto
 * del anterior, y qué hacer con lo que había abajo lo dice el campo de
 * disposición. Componer acá es lo que hace que después pintar sea gratis.
 *
 * Los cuadros se entregan de a uno, por callback, sobre el MISMO buffer: quien
 * lo recibe tiene que consumirlo ahí mismo (pasarlo a un canvas). Así un GIF de
 * 60 cuadros no pide 60 buffers de golpe.
 * ------------------------------------------------------------------ */

/** Firmas válidas. Es lo único que se mira antes de empezar a leer. */
const FIRMAS = ['GIF87a', 'GIF89a'];

/**
 * Topes de sensatez. No son de rendimiento —animar sale gratis— sino de
 * memoria: cada cuadro compuesto ocupa ancho×alto×4 bytes mientras se lo pasa
 * a su textura.
 *
 * El lado era 512 y quedaba corto: un GIF de Tenor o de Giphy sale en 640×640,
 * o sea que el tope rechazaba lo que la gente elige de verdad y el avatar
 * quedaba quieto sin más explicación que un renglón en el registro. Medido con
 * uno de esos (640×640, 57 cuadros), decodificarlo entero son ~0,42 s: el costo
 * va con la cantidad de píxeles, así que a 1024 el peor caso imaginable —60
 * cuadros del lado entero— ronda los 2 s. Se paga UNA vez, al cargar el avatar,
 * y no vuelve a aparecer mientras se juega.
 */
const MAX_CUADROS = 60;
const MAX_LADO = 1024;

function esGif(bytes) {
  if (!bytes || bytes.length < 6) return false;
  const firma = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  return FIRMAS.includes(firma);
}

/**
 * Lee un GIF y llama a `onCuadro` por cada cuadro ya compuesto.
 *
 * @param {Uint8Array} bytes
 * @param {(rgba: Uint8ClampedArray, retardo: number, indice: number,
 *          ancho: number, alto: number) => void} onCuadro
 *        `rgba` es un buffer REUSADO de ancho×alto×4; hay que consumirlo en el
 *        momento. `retardo` va en milisegundos. El tamaño va por parámetro
 *        porque el que recibe los cuadros lo necesita en el PRIMERO, y el valor
 *        de retorno llega recién al final.
 * @param {{maxCuadros?: number, maxLado?: number}} [opts]
 * @returns {{ancho: number, alto: number, cuadros: number, recortado: boolean}}
 */
function decode(bytes, onCuadro, opts) {
  const maxCuadros = (opts && opts.maxCuadros) || MAX_CUADROS;
  const maxLado = (opts && opts.maxLado) || MAX_LADO;

  if (!esGif(bytes)) throw new Error('no es un GIF');

  let p = 6;
  const u8 = () => bytes[p++];
  const u16 = () => bytes[p++] | (bytes[p++] << 8);

  const ancho = u16();
  const alto = u16();
  const packed = u8();
  p += 2; // color de fondo y relación de aspecto: no se usan

  if (!ancho || !alto) throw new Error('el GIF no tiene tamaño');
  if (ancho > maxLado || alto > maxLado) {
    throw new Error(`el GIF es de ${ancho}×${alto} y el máximo es ${maxLado}×${maxLado}`);
  }

  const leerPaleta = (n) => {
    const paleta = bytes.subarray(p, p + n * 3);
    p += n * 3;
    return paleta;
  };

  const paletaGlobal = (packed & 0x80) ? leerPaleta(2 << (packed & 7)) : null;

  /** Los datos vienen troceados en sub-bloques de 255 bytes como mucho. */
  const leerBloques = () => {
    const trozos = [];
    let total = 0;
    for (;;) {
      const largo = bytes[p++];
      if (!largo) break;
      trozos.push(bytes.subarray(p, p + largo));
      total += largo;
      p += largo;
    }
    const salida = new Uint8Array(total);
    let at = 0;
    for (const t of trozos) { salida.set(t, at); at += t.length; }
    return salida;
  };

  /*
   * LZW. El diccionario arranca con un código por color más CLEAR y FIN, y
   * crece con cada código leído; el ancho en bits sube cuando se llena. Las
   * tablas se reservan una vez para todo el archivo.
   */
  const prefijo = new Int32Array(4096);
  const sufijo = new Uint8Array(4096);
  const primero = new Uint8Array(4096);
  const pila = new Uint8Array(4096);

  const lzw = (minCodeSize, datos, pixeles) => {
    const CLEAR = 1 << minCodeSize;
    const FIN = CLEAR + 1;
    for (let i = 0; i < CLEAR; i++) { prefijo[i] = -1; sufijo[i] = i; primero[i] = i; }

    let ancho2 = minCodeSize + 1;
    let siguiente = CLEAR + 2;
    let anterior = -1;
    let acc = 0, bits = 0, at = 0, salida = 0, tope = 0;

    while (salida < pixeles.length) {
      if (tope > 0) { pixeles[salida++] = pila[--tope]; continue; }

      while (bits < ancho2) {
        // Archivo cortado: se deja lo que se pudo leer en vez de tirar.
        if (at >= datos.length) return;
        acc |= datos[at++] << bits;
        bits += 8;
      }
      const codigo = acc & ((1 << ancho2) - 1);
      acc >>= ancho2;
      bits -= ancho2;

      if (codigo === CLEAR) {
        ancho2 = minCodeSize + 1;
        siguiente = CLEAR + 2;
        anterior = -1;
        continue;
      }
      if (codigo === FIN) return;

      let actual = codigo;
      if (codigo >= siguiente) {
        // El código todavía no existe: se arma con el anterior más su primera
        // letra. Es válido y los codificadores lo usan.
        if (anterior < 0) return;
        pila[tope++] = primero[anterior];
        actual = anterior;
      }
      while (actual >= CLEAR) { pila[tope++] = sufijo[actual]; actual = prefijo[actual]; }
      pila[tope++] = sufijo[actual];

      if (anterior >= 0 && siguiente < 4096) {
        prefijo[siguiente] = anterior;
        sufijo[siguiente] = sufijo[actual];
        primero[siguiente] = primero[anterior];
        siguiente++;
        if ((siguiente & (siguiente - 1)) === 0 && ancho2 < 12) ancho2++;
      }
      anterior = codigo;
    }
  };

  /** Las filas de un GIF entrelazado no vienen en orden. */
  const ordenEntrelazado = (h) => {
    const orden = new Int32Array(h);
    let n = 0;
    for (const [inicio, paso] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
      for (let y = inicio; y < h; y += paso) orden[n++] = y;
    }
    return orden;
  };

  const lienzo = new Uint8ClampedArray(ancho * alto * 4);
  let previo = null;
  let indices = null;

  // Valores del último bloque de control gráfico leído.
  let retardo = 100;
  let transparente = -1;
  let disposicion = 0;

  let cuadros = 0;
  let recortado = false;

  for (;;) {
    const bloque = bytes[p++];
    if (bloque === 0x3B || bloque === undefined) break;

    if (bloque === 0x21) {
      const tipo = bytes[p++];
      if (tipo === 0xF9) {
        p++; // largo del bloque, siempre 4
        const flags = u8();
        const centesimas = u16();
        const indice = u8();
        p++; // fin del bloque
        // Un GIF sin duración lo muestran los navegadores a 100 ms; y por
        // debajo de 20 no hay nada que ganar, sólo trabajo.
        retardo = Math.max(20, centesimas * 10 || 100);
        transparente = (flags & 1) ? indice : -1;
        disposicion = (flags >> 2) & 7;
      } else {
        leerBloques(); // comentarios, texto, NETSCAPE: nada que hacer
      }
      continue;
    }

    if (bloque !== 0x2C) break; // no es un GIF que sepamos seguir

    const x = u16(), y = u16(), w = u16(), h = u16();
    const flags = u8();
    const paletaLocal = (flags & 0x80) ? leerPaleta(2 << (flags & 7)) : null;
    const entrelazado = !!(flags & 0x40);
    const paleta = paletaLocal || paletaGlobal;

    const minCodeSize = u8();
    const datos = leerBloques();
    if (!paleta || !w || !h) continue;

    if (!indices || indices.length < w * h) indices = new Uint8Array(w * h);
    indices.fill(0, 0, w * h);
    lzw(minCodeSize, datos, indices.subarray(0, w * h));

    if (disposicion === 3) {
      if (!previo) previo = new Uint8ClampedArray(lienzo.length);
      previo.set(lienzo);
    }

    const orden = entrelazado ? ordenEntrelazado(h) : null;
    for (let fila = 0; fila < h; fila++) {
      const py = (orden ? orden[fila] : fila) + y;
      if (py < 0 || py >= alto) continue;
      for (let col = 0; col < w; col++) {
        const px = col + x;
        if (px < 0 || px >= ancho) continue;
        const indice = indices[fila * w + col];
        if (indice === transparente) continue; // se deja ver lo de abajo
        const from = indice * 3;
        const to = (py * ancho + px) * 4;
        lienzo[to] = paleta[from];
        lienzo[to + 1] = paleta[from + 1];
        lienzo[to + 2] = paleta[from + 2];
        lienzo[to + 3] = 255;
      }
    }

    onCuadro(lienzo, retardo, cuadros, ancho, alto);
    cuadros++;
    if (cuadros >= maxCuadros) { recortado = true; break; }

    // Qué queda debajo del cuadro siguiente.
    if (disposicion === 2) {
      for (let fila = 0; fila < h; fila++) {
        const py = fila + y;
        if (py < 0 || py >= alto) continue;
        const desde = (py * ancho + x) * 4;
        const hasta = desde + Math.min(w, ancho - x) * 4;
        lienzo.fill(0, Math.max(0, desde), Math.max(0, hasta));
      }
    } else if (disposicion === 3 && previo) {
      lienzo.set(previo);
    }
  }

  if (!cuadros) throw new Error('el GIF no tiene ningún cuadro');
  return { ancho, alto, cuadros, recortado };
}

module.exports = { esGif, decode, MAX_CUADROS, MAX_LADO };
