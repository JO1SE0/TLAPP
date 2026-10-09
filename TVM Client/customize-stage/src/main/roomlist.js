'use strict';

/**
 * Lista de salas de HaxBall.
 *
 * El juego la pide a https://www.haxball.com/rs/api/list, que responde un
 * binario propio (no JSON). Lo decodificamos acá para poder dibujar la lista
 * con la interfaz del cliente en vez de usar la del sitio.
 *
 * Formato de cada registro, medido contra la lista que dibuja el propio juego:
 *
 *   u8      largo del token (siempre 11)
 *   bytes   token                        → el ?c= del link de la sala
 *   u16be   largo del resto del registro → sirve para saltar al siguiente
 *   u8      versión del formato (9)
 *   u16be   largo del nombre
 *   bytes   nombre (utf-8)
 *   u8      largo del país
 *   bytes   país (iso-2)
 *   f32le   latitud
 *   f32le   longitud
 *   u8      contraseña (0/1)
 *   u8      cupo máximo
 *   u8      jugadores conectados
 *   u8      reservado (siempre 0)
 *
 * Los largos son big-endian y los flotantes little-endian: es así en el
 * original, no es un error de lectura.
 */

const LIST_URL = 'https://www.haxball.com/rs/api/list';
const TOKEN_RE = /^[A-Za-z0-9_-]{11}$/;
const HEADER_BYTES = 2;

/**
 * Decodifica el nombre de una sala.
 *
 * No alcanza con Buffer.toString('utf8'): ~8% de las salas traen los emoji
 * como CESU-8, o sea cada mitad del par surrogado codificada por separado en
 * 3 bytes en vez del carácter completo en 4. UTF-8 estricto los rechaza y
 * quedan como "������".
 *
 * Al emitir cada secuencia de 3 bytes con fromCharCode, las mitades quedan
 * contiguas en la cadena y JavaScript (que trabaja en UTF-16) las junta sola.
 */
function decodeText(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if ((b & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if ((b & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      // Puede ser un carácter normal o media pareja surrogada: en ambos casos
      // se emite el code unit tal cual.
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else if ((b & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) |
                 ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(cp);
      i += 4;
    } else {
      i += 1; // byte suelto: se descarta
    }
  }
  // HaxBall corta los nombres por bytes, así que a veces un emoji queda partido
  // al medio. Esa mitad suelta se ve como un rombo con signo de pregunta: se
  // borran todas las que no formen pareja, estén donde estén.
  return out
    .replace(/([\uD800-\uDBFF])(?![\uDC00-\uDFFF])/g, '')
    .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, '$1')
    .trimEnd();
}

/** Decodifica el binario. Los registros ilegibles se saltean, no rompen. */
function parse(buf) {
  const rooms = [];
  let o = HEADER_BYTES;

  while (o < buf.length - 4) {
    if (buf.readUInt8(o) !== 11) { o++; continue; }
    const token = buf.subarray(o + 1, o + 12).toString('latin1');
    if (!TOKEN_RE.test(token)) { o++; continue; }

    let p = o + 12;
    const payloadLen = buf.readUInt16BE(p); p += 2;
    const version = buf.readUInt8(p); p += 1;
    const end = p + payloadLen;
    if (version !== 9 || end > buf.length) { o++; continue; }

    try {
      const nameLen = buf.readUInt16BE(p); p += 2;
      const name = decodeText(buf.subarray(p, p + nameLen)); p += nameLen;
      const countryLen = buf.readUInt8(p); p += 1;
      const country = buf.subarray(p, p + countryLen).toString('latin1'); p += countryLen;
      const lat = buf.readFloatLE(p); p += 4;
      const lon = buf.readFloatLE(p); p += 4;
      const password = buf.readUInt8(p) === 1; p += 1;
      const maxPlayers = buf.readUInt8(p); p += 1;
      const players = buf.readUInt8(p); p += 1;

      // Ojo: hay salas con jugadores > cupo (ej. "30/1"). No es un error de
      // parseo: son salas headless con el cupo modificado. Van tal cual.
      rooms.push({ token, name, country: country.toUpperCase(), lat, lon, players, maxPlayers, password });
    } catch {
      // registro cortado: lo dejamos pasar
    }
    o = end;
  }

  return rooms;
}

/**
 * Kilómetros entre dos puntos (haversine), sin redondear.
 *
 * El valor exacto importa para ordenar: varias salas del mismo host caen a la
 * misma distancia una vez redondeadas, y ahí el orden lo terminaba decidiendo
 * el desempate en vez de la geografía.
 */
function distanceKmExact(a, b) {
  if (!a || !b) return null;
  const lat1 = Number(a.lat), lon1 = Number(a.lon);
  const lat2 = Number(b.lat), lon2 = Number(b.lon);
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) return null;

  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(h));
  return Number.isFinite(dist) ? dist : null;
}

/** La misma distancia, redondeada: es la que se muestra en la lista. */
function distanceKm(a, b) {
  const exact = distanceKmExact(a, b);
  return exact == null ? null : Math.round(exact);
}

/**
 * @param {{lat:number, lon:number}|null} origin Ubicación del jugador, para la distancia.
 */
async function fetchRooms(origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(LIST_URL, {
      signal: controller.signal,
      headers: { 
        Referer: 'https://www.haxball.com/', 
        'cache-control': 'no-cache',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) throw new Error(`HaxBall respondió ${res.status}`);
    const rooms = parse(Buffer.from(await res.arrayBuffer()));

    rooms.forEach((room, i) => {
      // Orden en el que vino la sala. Es el desempate de la lista: muchos hosts
      // publican salas "separador" (═══ NOMBRE ═══) creadas antes y después de
      // las de verdad para que queden encerrando al grupo. Todas comparten
      // ubicación, así que si el desempate fuera por jugadores o por nombre los
      // separadores se juntarían y el bloque perdería sentido.
      room.index = i;
      room.distanceExact = distanceKmExact(origin, room);
      room.distance = room.distanceExact == null ? null : Math.round(room.distanceExact);
    });

    return {
      rooms,
      totalRooms: rooms.length,
      totalPlayers: rooms.reduce((sum, r) => sum + r.players, 0),
      fetchedAt: Date.now()
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Acepta un link completo de sala o el token pelado. */
function parseRoomLink(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (TOKEN_RE.test(text)) return text;

  const match = text.match(/[?&]c=([A-Za-z0-9_-]{11})/);
  if (match) return match[1];

  // Algunos links vienen como haxball.com/play?c=... sin protocolo
  try {
    const url = new URL(text.startsWith('http') ? text : `https://${text}`);
    const c = url.searchParams.get('c');
    if (c && TOKEN_RE.test(c)) return c;
  } catch {
    /* no era una URL */
  }
  return null;
}

function roomUrl(token) {
  return `https://www.haxball.com/play?c=${encodeURIComponent(token)}`;
}

module.exports = { fetchRooms, parse, parseRoomLink, roomUrl, distanceKm, distanceKmExact };
