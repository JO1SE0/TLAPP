'use strict';

/**
 * Países para el selector de bandera.
 *
 * Cada uno lleva las coordenadas de su capital porque HaxBall guarda en
 * `geo_override` un `{lat, lon, code}` entero, no sólo el código: la latitud y
 * la longitud son las que usan las salas para ordenar por distancia. Dejarlas
 * en cero pondría a todo el mundo en medio del Atlántico.
 *
 * El código va en minúsculas, que es como lo normaliza el juego.
 */
const COUNTRIES = [
  { code: 'ar', name: 'Argentina', lat: -34.61, lon: -58.38 },
  { code: 'br', name: 'Brasil', lat: -15.79, lon: -47.88 },
  { code: 'cl', name: 'Chile', lat: -33.45, lon: -70.67 },
  { code: 'uy', name: 'Uruguay', lat: -34.90, lon: -56.16 },
  { code: 'py', name: 'Paraguay', lat: -25.28, lon: -57.64 },
  { code: 'bo', name: 'Bolivia', lat: -16.49, lon: -68.13 },
  { code: 'pe', name: 'Perú', lat: -12.05, lon: -77.04 },
  { code: 'ec', name: 'Ecuador', lat: -0.18, lon: -78.47 },
  { code: 'co', name: 'Colombia', lat: 4.71, lon: -74.07 },
  { code: 've', name: 'Venezuela', lat: 10.48, lon: -66.90 },
  { code: 'mx', name: 'México', lat: 19.43, lon: -99.13 },
  { code: 'cr', name: 'Costa Rica', lat: 9.93, lon: -84.08 },
  { code: 'pa', name: 'Panamá', lat: 8.98, lon: -79.52 },
  { code: 'do', name: 'República Dominicana', lat: 18.49, lon: -69.93 },
  { code: 'us', name: 'Estados Unidos', lat: 38.91, lon: -77.04 },
  { code: 'ca', name: 'Canadá', lat: 45.42, lon: -75.70 },

  { code: 'es', name: 'España', lat: 40.42, lon: -3.70 },
  { code: 'pt', name: 'Portugal', lat: 38.72, lon: -9.14 },
  { code: 'fr', name: 'Francia', lat: 48.86, lon: 2.35 },
  { code: 'it', name: 'Italia', lat: 41.90, lon: 12.50 },
  { code: 'de', name: 'Alemania', lat: 52.52, lon: 13.40 },
  { code: 'gb', name: 'Reino Unido', lat: 51.51, lon: -0.13 },
  { code: 'ie', name: 'Irlanda', lat: 53.35, lon: -6.26 },
  { code: 'nl', name: 'Países Bajos', lat: 52.37, lon: 4.90 },
  { code: 'be', name: 'Bélgica', lat: 50.85, lon: 4.35 },
  { code: 'ch', name: 'Suiza', lat: 46.95, lon: 7.45 },
  { code: 'at', name: 'Austria', lat: 48.21, lon: 16.37 },
  { code: 'pl', name: 'Polonia', lat: 52.23, lon: 21.01 },
  { code: 'cz', name: 'Chequia', lat: 50.08, lon: 14.44 },
  { code: 'sk', name: 'Eslovaquia', lat: 48.15, lon: 17.11 },
  { code: 'hu', name: 'Hungría', lat: 47.50, lon: 19.04 },
  { code: 'ro', name: 'Rumania', lat: 44.43, lon: 26.10 },
  { code: 'bg', name: 'Bulgaria', lat: 42.70, lon: 23.32 },
  { code: 'gr', name: 'Grecia', lat: 37.98, lon: 23.73 },
  { code: 'rs', name: 'Serbia', lat: 44.79, lon: 20.45 },
  { code: 'hr', name: 'Croacia', lat: 45.81, lon: 15.98 },
  { code: 'ba', name: 'Bosnia y Herzegovina', lat: 43.86, lon: 18.41 },
  { code: 'si', name: 'Eslovenia', lat: 46.06, lon: 14.51 },
  { code: 'mk', name: 'Macedonia del Norte', lat: 41.996, lon: 21.43 },
  { code: 'al', name: 'Albania', lat: 41.33, lon: 19.82 },
  { code: 'se', name: 'Suecia', lat: 59.33, lon: 18.07 },
  { code: 'no', name: 'Noruega', lat: 59.91, lon: 10.75 },
  { code: 'dk', name: 'Dinamarca', lat: 55.68, lon: 12.57 },
  { code: 'fi', name: 'Finlandia', lat: 60.17, lon: 24.94 },
  { code: 'ee', name: 'Estonia', lat: 59.44, lon: 24.75 },
  { code: 'lv', name: 'Letonia', lat: 56.95, lon: 24.11 },
  { code: 'lt', name: 'Lituania', lat: 54.69, lon: 25.28 },
  { code: 'ua', name: 'Ucrania', lat: 50.45, lon: 30.52 },
  { code: 'ru', name: 'Rusia', lat: 55.76, lon: 37.62 },
  { code: 'by', name: 'Bielorrusia', lat: 53.90, lon: 27.57 },
  { code: 'tr', name: 'Turquía', lat: 39.93, lon: 32.86 },

  { code: 'ma', name: 'Marruecos', lat: 34.02, lon: -6.84 },
  { code: 'dz', name: 'Argelia', lat: 36.75, lon: 3.06 },
  { code: 'tn', name: 'Túnez', lat: 36.81, lon: 10.18 },
  { code: 'eg', name: 'Egipto', lat: 30.04, lon: 31.24 },
  { code: 'sa', name: 'Arabia Saudita', lat: 24.71, lon: 46.68 },
  { code: 'ae', name: 'Emiratos Árabes Unidos', lat: 24.45, lon: 54.38 },
  { code: 'il', name: 'Israel', lat: 31.77, lon: 35.21 },
  { code: 'ir', name: 'Irán', lat: 35.69, lon: 51.39 },
  { code: 'iq', name: 'Irak', lat: 33.31, lon: 44.36 },
  { code: 'za', name: 'Sudáfrica', lat: -25.75, lon: 28.19 },
  { code: 'ng', name: 'Nigeria', lat: 9.06, lon: 7.49 },

  { code: 'in', name: 'India', lat: 28.61, lon: 77.21 },
  { code: 'id', name: 'Indonesia', lat: -6.21, lon: 106.85 },
  { code: 'ph', name: 'Filipinas', lat: 14.60, lon: 120.98 },
  { code: 'vn', name: 'Vietnam', lat: 21.03, lon: 105.85 },
  { code: 'th', name: 'Tailandia', lat: 13.76, lon: 100.50 },
  { code: 'my', name: 'Malasia', lat: 3.14, lon: 101.69 },
  { code: 'cn', name: 'China', lat: 39.90, lon: 116.41 },
  { code: 'jp', name: 'Japón', lat: 35.68, lon: 139.69 },
  { code: 'kr', name: 'Corea del Sur', lat: 37.57, lon: 126.98 },
  { code: 'au', name: 'Australia', lat: -35.28, lon: 149.13 },
  { code: 'nz', name: 'Nueva Zelanda', lat: -41.29, lon: 174.78 }
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

function find(code) {
  return BY_CODE.get(String(code || '').toLowerCase()) || null;
}

module.exports = { COUNTRIES, find };
