'use strict';

/* ------------------------------------------------------------------ *
 * HaxBall en español
 * ------------------------------------------------------------------ *
 * Traduce lo que dice el JUEGO: sus diálogos, sus mensajes de sistema en el
 * chat y los carteles que dibuja sobre la cancha. Se aplica sobre el bundle,
 * como el resto de los parches, y por las mismas razones — pero acá hay una
 * que pesa más que ninguna:
 *
 *   **Los carteles de gol no son DOM.** «Red Scores!», «Blue is Victorious!» y
 *   «Time is Up!» se dibujan en el canvas desde un arreglo que el renderer arma
 *   UNA vez en su constructor:
 *
 *       this.qr = new da(["Red","Scores!"], 15035990)
 *
 *   No hay elemento que buscar ni texto que reemplazar después: o se cambia el
 *   arreglo antes de que el juego arranque, o no se traduce nunca. Eso descarta
 *   de entrada el enfoque de traducir el DOM con un observador (que es lo que
 *   hace el cliente Zero), y de paso lo hace gratis: el trabajo se hace una vez
 *   al parchear y en partida no cuesta un solo cuadro.
 *
 * ── Lo que NO se traduce ────────────────────────────────────────────────
 *
 * Lo que escriben los BOTS DE LOS HOSTS. En una sala de Thrivium eso es la
 * mayor parte de lo que se lee en el chat —«¡Comenzó el 1v1!», «GK Rojo»— y no
 * pasa por acá: lo manda el servidor de la sala ya escrito. Traducirlo sería
 * adivinar sobre texto ajeno, y un host que escribe en inglés a propósito
 * tiene derecho a que se lea en inglés.
 *
 * Tampoco los nombres de los jugadores, obviamente, ni lo que tipean.
 *
 * ── Cómo son las agujas ─────────────────────────────────────────────────
 *
 * Cada entrada es un pedazo de CÓDIGO FUENTE, comillas incluidas:
 *
 *     ['" has joined"', '" se unió"']
 *
 * Las comillas no son decoración: son lo que hace que la aguja sea inequívoca.
 * Sin ellas, `has joined` podría aparecer en un comentario, en un identificador
 * o en medio de otra cadena, y estaríamos reemplazando a ciegas dentro de un
 * archivo minificado de 170 KB.
 *
 * La otra regla, y es dura: **una aguja nunca cruza el borde de un literal.**
 * El minificador de HaxBall corta líneas cada ~80 caracteres en medio de
 * cualquier expresión, así que `""+d.D+" has joined"` puede venir partido en
 * dos. Adentro de un literal no puede haber un salto de línea crudo —sería un
 * error de sintaxis— así que buscar dentro de uno solo es seguro y buscar a
 * través de dos es una bomba de tiempo. Por eso se traduce `" has joined"` y no
 * `d.D+" has joined"`.
 *
 * Que una aguja aparezca varias veces está bien y en varios casos es a
 * propósito: `" msec"` sale en tres mensajes distintos y los tres quieren decir
 * lo mismo. Lo que se reporta es la aguja que aparece CERO veces, que es la
 * señal de que HaxBall cambió ese texto.
 *
 * ── Si algo no entra, no pasa nada ──────────────────────────────────────
 *
 * Cada aguja falla por separado: la que no aparece se saltea y esa frase queda
 * en inglés. El juego no se rompe ni se queda a medias, y el log dice cuántas
 * fueron para que se note que hay que revisar la tabla.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Los nombres de los equipos, aparte
 * ------------------------------------------------------------------ *
 * Están acá arriba y no perdidos en la tabla porque el cliente los usa para
 * algo más que mostrarlos: el motor que decide quién hizo el gol pregunta de
 * qué equipo era el que tocó la pelota último, y esa respuesta sale del NOMBRE
 * que el juego tiene guardado (`fa.D`).
 *
 * Traducir «Red» a «Rojo» sin avisarle a nadie hizo exactamente lo que tenía
 * que hacer y rompió el motor: comparaba ese nombre contra el literal 'Red', la
 * comparación pasó a fallar siempre y TODOS los goles quedaron marcados como en
 * contra. Por eso el mapa vive acá, se genera solo hacia la tabla, y el preload
 * lo usa al revés con `canonicalTeam()` para volver de cualquier idioma al
 * identificador interno. Un idioma nuevo se agrega en un solo lugar.
 *
 * Ver `whoIs()` en game-preload.js.
 * ------------------------------------------------------------------ */
const TEAMS = {
  es: { Red: 'Rojo', Blue: 'Azul', Spectators: 'Espectadores' }
};

/**
 * De cualquier grafía conocida al identificador interno.
 *
 * Acepta el inglés siempre: si el parche del bundle no entró, el juego sigue
 * diciendo «Red» y el motor de goles tiene que andar igual.
 *
 * @returns {'Red'|'Blue'|'Spectators'|''}
 */
function canonicalTeam(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const low = raw.toLowerCase();

  for (const id of ['Red', 'Blue', 'Spectators']) {
    if (low === id.toLowerCase()) return id;
    for (const table of Object.values(TEAMS)) {
      if (table[id] && low === table[id].toLowerCase()) return id;
    }
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * Los avisos del avatar, en cualquier idioma
 * ------------------------------------------------------------------ *
 * HaxBall se escribe a sí mismo «Avatar set» cada vez que alguien manda
 * `/avatar`. Sólo lo ve el jugador —no viaja a la sala—, pero el avatar animado
 * manda uno por cuadro, así que el chat se llena y no se lee nada más.
 *
 * El preload los borra del chat mientras la animación corre... y los buscaba por
 * su texto EN INGLÉS, con el juego traducido al español por este mismo módulo.
 * O sea que el filtro no encajaba nunca y el spam era, en la configuración de
 * fábrica, garantizado.
 *
 * Es el mismo error que `canonicalTeam` de acá arriba: anclar en el texto que se
 * ve, sin acordarse de que lo traducimos nosotros. Y la solución es la misma —
 * la lista se GENERA de la tabla, así un idioma nuevo queda cubierto solo, sin
 * que haya que acordarse de venir a tocar esto.
 * ------------------------------------------------------------------ */
const AVATAR_NOTICES = ['Avatar set', 'Avatar cleared'];

/** Saca las comillas con las que viven las agujas de la tabla. */
function unquote(needle) {
  return String(needle).replace(/^"|"$/g, '');
}

let avatarNoticeCache = null;

function avatarNotices() {
  if (avatarNoticeCache) return avatarNoticeCache;
  // El inglés entra siempre: si el parche del bundle no aplicó, el juego sigue
  // hablando en inglés y el filtro tiene que andar igual.
  const out = new Set(AVATAR_NOTICES.map((t) => t.toLowerCase()));
  for (const table of Object.values(TABLES)) {
    for (const [from, to] of table) {
      if (AVATAR_NOTICES.includes(unquote(from))) out.add(unquote(to).toLowerCase());
    }
  }
  avatarNoticeCache = out;
  return out;
}

/** ¿Esta línea del chat es uno de esos avisos, en el idioma que sea? */
function isAvatarNotice(text) {
  return avatarNotices().has(String(text || '').trim().toLowerCase());
}

/**
 * Español. El orden importa sólo cuando una aguja es prefijo de otra; en esos
 * casos va primero la más larga.
 */
const ES = [
  /* ── Mensajes de sistema en el chat ──────────────────────────────── *
   * Todos salen del mismo sitio (`Ka.Hb`) y se arman concatenando el nombre
   * del jugador con estos pedazos. El orden de la frase en español tiene que
   * seguir siendo «<nombre> <lo que pasó>», porque el nombre va adelante en el
   * código y eso no se toca desde acá. */
  ['" has joined"', '" se unió"'],
  ['" has left"', '" se fue"'],
  ['" was "', '" fue "'],                    // <nombre> fue baneado/echado
  ['"banned"', '"baneado"'],
  ['"kicked"', '"echado"'],
  ['" by "', '" por "'],                     // …por <admin>. También en «Te echaron por X»
  ['" was moved to "', '" pasó a "'],
  ['" was given admin rights"', '" ahora es admin"'],
  ["\"'s admin rights were taken away\"", '" dejó de ser admin"'],
  ['" team won the match"', '" ganó el partido"'],
  ['"has desynchronized"', '"se desincronizó"'],
  ['"is back in sync"', '"volvió a sincronizarse"'],
  ['"Game paused"', '"Partido pausado"'],
  ['"Game started"', '"Partido iniciado"'],
  ['"Game stopped"', '"Partido detenido"'],
  ['") loaded"', '") cargado"'],
  ['"Kick Rate Limit set to (min: "', '"Límite de expulsiones (mín: "'],
  ['", rate: "', '", ritmo: "'],
  ['", burst: "', '", ráfaga: "'],

  /* ── Respuestas a los comandos del chat ──────────────────────────── *
   * Los nombres de los comandos (/avatar, /clear_bans…) NO se traducen: son
   * lo que el jugador tipea, y cambiarlos rompería lo que ya sabe escribir. */
  ['"Avatar set"', '"Avatar puesto"'],
  ['"Avatar cleared"', '"Avatar borrado"'],
  ['"All bans have been cleared"', '"Se limpiaron todos los baneos"'],
  ['"Only the host can clear bans"', '"Sólo el host puede limpiar los baneos"'],
  ['"Only the host can change the password"', '"Sólo el host puede cambiar la contraseña"'],
  ['"Password cleared"', '"Contraseña borrada"'],
  ['"Password set"', '"Contraseña puesta"'],
  ['"Can\'t store default stadium."', '"No se puede guardar un estadio de fábrica."'],
  ['"Stadium stored"', '"Estadio guardado"'],
  ['"Couldn\'t store stadium"', '"No se pudo guardar el estadio"'],
  ['"Invalid arguments"', '"Argumentos inválidos"'],
  ['"Only the host can set recaptcha mode"', '"Sólo el host puede cambiar el recaptcha"'],
  ['"Room join Recaptcha "', '"Recaptcha al entrar "'],
  ['"enabled"', '"activado"'],
  ['"disabled"', '"desactivado"'],
  ['"Extrapolation set to "', '"Extrapolación en "'],
  ['"Extrapolation must be a value between -200 and 1000 milliseconds"', '"La extrapolación va de -200 a 1000 milisegundos"'],
  ['"Extrapolation requires a value in milliseconds."', '"La extrapolación necesita un valor en milisegundos."'],
  ['"Ping handicap set to "', '"Handicap de ping en "'],
  ['"Ping handicap must be a value between 0 and 300 milliseconds"', '"El handicap de ping va de 0 a 300 milisegundos"'],
  ['"Ping handicap requires a value in milliseconds."', '"El handicap de ping necesita un valor en milisegundos."'],
  ['" msec"', '" ms"'],
  ['"Usage: /kick_ratelimit <min> <rate> <burst>"', '"Se usa: /kick_ratelimit <mín> <ritmo> <ráfaga>"'],
  ['"Usage: /recaptcha <on|off>"', '"Se usa: /recaptcha <on|off>"'],
  ['\'Unrecognized command: "\'', '\'Comando desconocido: "\''],
  ['\'Current stadium is original: "\'', '\'El estadio es de fábrica: "\''],
  ['\'Stadium: "\'', '\'Estadio: "\''],

  /* ── Carteles sobre la cancha ────────────────────────────────────── *
   * Dos renglones: el de arriba grande y el de abajo más chico. El equipo va
   * arriba porque «Victorious!» y «Scores!» son un literal COMPARTIDO entre
   * rojo y azul — se reemplazan una vez para los dos, así que la única forma
   * de no perder de quién se habla es dejarlo en el primer renglón. */
  ['"Red is"', '"Rojo"'],
  ['"Blue is"', '"Azul"'],
  ['"Victorious!"', '"¡GANA!"'],
  ['"Scores!"', '"¡GOL!"'],
  ['"Time is"', '"Se acabó"'],
  ['"Up!"', '"¡el tiempo!"'],
  ['"Game"', '"Partido"'],
  ['"Paused"', '"En pausa"'],
  ['"OVERTIME!"', '"¡ALARGUE!"'],

  /* Los nombres de equipo se agregan más abajo, generados desde `TEAMS`. */

  /* ── Conexión y desconexión ──────────────────────────────────────── */
  ['"Connecting to master..."', '"Conectando con el servidor…"'],
  ['"Connecting to peer..."', '"Conectando con el host…"'],
  ['"Awaiting state..."', '"Esperando el estado…"'],
  ['"Trying reverse connection..."', '"Probando conexión inversa…"'],
  ['"Connecting..."', '"Conectando…"'],
  ['"You were banned"', '"Te banearon"'],
  ['"You were kicked"', '"Te echaron"'],
  // `return"Cancelled"` y no `"Cancelled"` a secas: las otras dos apariciones
  // son etiquetas internas de un enum, no texto que se muestre.
  ['return"Cancelled"', 'return"Cancelado"'],
  ['"Failed to connect to peer."', '"No se pudo conectar con el host."'],
  ['"Master connection error"', '"Error de conexión con el servidor"'],
  ['"The room was closed."', '"La sala se cerró."'],
  ['"The room is full."', '"La sala está llena."'],
  ['"Wrong password."', '"Contraseña incorrecta."'],
  ['"You are banned from this room."', '"Estás baneado de esta sala."'],
  ['"Incompatible game version."', '"La versión del juego no coincide."'],
  ['"Connection closed ("', '"Conexión cerrada ("'],

  /* ── Diálogos de error ───────────────────────────────────────────── */
  ['"Connection Failed"', '"Falló la conexión"'],
  ['"Unexpected Error"', '"Error inesperado"'],
  ['"Incompatible version"', '"Versión incompatible"'],
  ['"The room is running a different version."', '"La sala corre otra versión del juego."'],
  ['"Creating room"', '"Creando la sala"'],
  ['"Incompatible replay version"', '"Versión de replay incompatible"'],
  ['"The replay file is of a different version"', '"El archivo es de otra versión"'],
  ['"Open player"', '"Abrir igual"'],
  ['"Replay error"', '"Error del replay"'],
  ['"Couldn\'t load the file."', '"No se pudo abrir el archivo."'],
  ['"Error loading stadium"', '"Error al cargar el estadio"'],
  ['"Only humans"', '"Sólo humanos"'],
  [
    '"<p>Failed to connect to room host.</p><p>If this problem persists please see the ',
    '"<p>No se pudo conectar con el host de la sala.</p><p>Si sigue pasando, mirá la '
  ],
  ['>troubleshooting guide</a>.</p>"', '>guía de problemas de conexión</a>.</p>"'],
  [
    '"An error ocurred while attempting to join the room.<br><br>This might be caused by a browser extension, try disabling all extensions and refreshing the site.<br><br>The error has been printed to the inspector console."',
    '"Hubo un error al intentar entrar a la sala.<br><br>Puede ser culpa de una extensión del navegador: probá desactivarlas y recargar.<br><br>El detalle quedó en la consola."'
  ],

  /* ── Diálogos (plantillas HTML del bundle) ───────────────────────── *
   * Se ancla al marcado y no al texto pelado: `>Pick</button>` no puede
   * confundirse con el `data-hook='pick'` de al lado, que NO hay que tocar
   * porque es con lo que el propio juego encuentra el botón. */

  // Elegir estadio
  ['<h1>Pick a stadium</h1>', '<h1>Elegir estadio</h1>'],
  ['>Pick</button>', '>Elegir</button>'],
  ['>Delete</button>', '>Borrar</button>'],
  ['>Load</label>', '>Cargar</label>'],
  ['>Export</button>', '>Exportar</button>'],

  // Sala
  ['<i class=\'icon-circle\'></i>Rec', '<i class=\'icon-circle\'></i>Grabar'],
  ['<i class=\'icon-link\'></i>Link', '<i class=\'icon-link\'></i>Link'],
  ['>Auto</button>', '>Auto</button>'],
  ['>Rand</button>', '>Azar</button>'],
  ['>Lock</button>', '>Trabar</button>'],
  ['>Reset</button>', '>Reiniciar</button>'],
  ['<label class=\'lbl\'>Time limit</label>', '<label class=\'lbl\'>Tiempo</label>'],
  ['<label class=\'lbl\'>Score limit</label>', '<label class=\'lbl\'>Goles</label>'],
  ['<label class=\'lbl\'>Stadium</label>', '<label class=\'lbl\'>Estadio</label>'],
  ['<i class=\'icon-play\'></i>Start game', '<i class=\'icon-play\'></i>Empezar'],
  ['<i class=\'icon-stop\'></i>Stop game', '<i class=\'icon-stop\'></i>Parar'],
  ['<i class=\'icon-pause\'></i>Pause', '<i class=\'icon-pause\'></i>Pausar'],
  ['"<i class=\'icon-lock\'></i>Unlock"', '"<i class=\'icon-lock\'></i>Destrabar"'],
  ['"<i class=\'icon-lock-open\'></i>Lock"', '"<i class=\'icon-lock-open\'></i>Trabar"'],
  ['>Join</button>', '>Entrar</button>'],

  // Salir de la sala
  ['<h1>Leave room?</h1>', '<h1>¿Salir de la sala?</h1>'],
  ['<p>Are you sure you want to leave the room?</p>', '<p>¿Seguro que querés salir?</p>'],
  ['>Leave</button>', '>Salir</button>'],

  // Crear sala
  ['<h1>Create room</h1>', '<h1>Crear sala</h1>'],
  ['<label>Room name:</label>', '<label>Nombre:</label>'],
  ['<label>Max players:</label>', '<label>Máx. jugadores:</label>'],
  ['>Create</button>', '>Crear</button>'],

  // Apodo, contraseña, ubicación
  ['<h1>Choose nickname</h1>', '<h1>Elegí tu apodo</h1>'],
  ['<label>Nick:</label>', '<label>Apodo:</label>'],
  ['<h1>Password required</h1>', '<h1>Hace falta contraseña</h1>'],
  ['<label>Password:</label>', '<label>Contraseña:</label>'],
  ['<h1>Change Location</h1>', '<h1>Cambiar ubicación</h1>'],
  ['>Change</button>', '>Cambiar</button>'],

  // Echar a alguien
  ['<label>Reason: </label>', '<label>Motivo: </label>'],
  ['<i class=\'icon-block\'></i>Ban from rejoining: ', '<i class=\'icon-block\'></i>Que no pueda volver: '],
  ['>Kick</button>', '>Echar</button>'],

  // Desconexión / link / varios
  ['<h1>Disconnected</h1>', '<h1>Te desconectaste</h1>'],
  ['>Save replay</button>', '>Guardar replay</button>'],
  ['<h1>Connecting</h1>', '<h1>Conectando</h1>'],
  ['<h1>Room link</h1>', '<h1>Link de la sala</h1>'],
  ['<p>Use this url to link others directly into this room.</p>', '<p>Con este link entran directo a la sala.</p>'],
  ['>Copy to clipboard</button>', '>Copiar</button>'],
  ['>Cancel</button>', '>Cancelar</button>'],
  ['>Close</button>', '>Cerrar</button>'],

  /* ── Lista de salas ──────────────────────────────────────────────── *
   * Es la pantalla propia de HaxBall, la que queda DETRÁS del navegador de
   * salas del cliente. Se traduce igual porque no está tapada del todo: el
   * cliente usa sus botones para crear salas y para abrir replays, y sus
   * diálogos aparecen tal cual. */
  ['<h1>Room list</h1>', '<h1>Lista de salas</h1>'],
  ['<p>Tip: Join rooms near you to reduce lag.</p>', '<p>Entrá a salas cerca tuyo para tener menos lag.</p>'],
  ['<td>Name</td>', '<td>Nombre</td>'],
  ['<td>Players</td>', '<td>Jugadores</td>'],
  ['<td>Pass</td>', '<td>Clave</td>'],
  ['<td>Distance</td>', '<td>Distancia</td>'],
  ['>Show locked <i>', '>Con clave <i>'],
  ['>Show full <i>', '>Llenas <i>'],
  ['>Show empty <i>', '>Vacías <i>'],
  ['<div>Refresh</div>', '<div>Actualizar</div>'],
  ['<div>Join Room</div>', '<div>Entrar</div>'],
  ['<div>Create Room</div>', '<div>Crear sala</div>'],
  ['<div>Settings</div>', '<div>Ajustes</div>'],
  ['<div>Change Nick</div>', '<div>Cambiar apodo</div>'],
  ['" players in "', '" jugadores en "'],
  ['" rooms"', '" salas"'],

  /* ── Ajustes propios de HaxBall ──────────────────────────────────── *
   * El engranaje de la partida lo intercepta el cliente y abre los suyos, pero
   * a estos se llega igual desde el botón «Ajustes» de la lista de salas.
   *
   * OJO con lo que NO está acá: «Up», «Down», «Left», «Right», «Kick» y
   * «ToggleChat» parecen etiquetas y son IDENTIFICADORES — el juego pregunta
   * `this.Qc.has("Up")` para saber si estás yendo para arriba. Traducirlos deja
   * al jugador sin poder moverse. */
  ['<h1>Settings</h1>', '<h1>Ajustes</h1>'],
  ['>Sound</button>', '>Sonido</button>'],
  ['>Input</button>', '>Teclas</button>'],
  ['>Misc</button>', '>Otros</button>'],
  ['<div>Press a key</div>', '<div>Tocá una tecla</div>'],
  ['>Sounds enabled</div>', '>Sonidos</div>'],
  ['>Chat sound enabled</div>', '>Sonido del chat</div>'],
  ['>Nick highlight sound enabled</div>', '>Aviso cuando te nombran</div>'],
  ['>Crowd sound enabled</div>', '>Sonido de la hinchada</div>'],
  ['<div>Viewport Mode:', '<div>Cámara:'],
  ['<option>Dynamic</option>', '<option>Dinámica</option>'],
  ['<option>Restricted 840x410</option>', '<option>Limitada 840x410</option>'],
  ['<option>Full 1x Zoom</option>', '<option>Completa 1x</option>'],
  ['<option>Full 1.25x Zoom</option>', '<option>Completa 1.25x</option>'],
  ['<option>Full 1.5x Zoom</option>', '<option>Completa 1.5x</option>'],
  ['<option>Full 1.75x Zoom</option>', '<option>Completa 1.75x</option>'],
  ['<option>Full 2x Zoom</option>', '<option>Completa 2x</option>'],
  ['<option>Full 2.25x Zoom</option>', '<option>Completa 2.25x</option>'],
  ['<option>Full 2.5x Zoom</option>', '<option>Completa 2.5x</option>'],
  ['<div>FPS Limit:', '<div>Límite de FPS:'],
  ['<option>None (Recommended)</option>', '<option>Sin límite (recomendado)</option>'],
  ['<div>Resolution Scaling:', '<div>Escala de resolución:'],
  ['>Use low latency canvas</div>', '>Canvas de baja latencia</div>'],
  ['>Custom team colors enabled</div>', '>Colores de equipo personalizados</div>'],
  ['>Show chat indicators</div>', '>Indicadores de chat</div>'],
  ['>Show player avatars</div>', '>Avatares de los jugadores</div>'],
  ['>Chat opacity </div>', '>Opacidad del chat </div>'],
  ['>Chat focus height </div>', '>Alto del chat al escribir </div>'],
  ['<div>Chat background width:', '<div>Fondo del chat:'],
  ['<option>Full</option>', '<option>Completo</option>'],
  ['<option>Compact</option>', '<option>Compacto</option>'],
  ['"Detected location"', '"Ubicación detectada"'],
  ['"Location override"', '"Ubicación forzada"'],

  // Botonera de la partida
  ['<i class=\'icon-menu\'></i>Menu', '<i class=\'icon-menu\'></i>Menú'],
  ['<span class=\'tooltip\'>Toggle room menu [Escape]</span>', '<span class=\'tooltip\'>Mostrar u ocultar el menú [Escape]</span>'],

  // Ayuda del chat (lo primero que se lee al entrar)
  [
    '<p>Controls:<br/>Move: WASD or Arrows<br/>Kick: X, Space, Ctrl, Shift, Numpad 0<br/>View: Numbers 1 to 4</p>',
    '<p>Controles:<br/>Moverse: WASD o flechas<br/>Patear: X, Espacio, Ctrl, Shift, 0 del teclado numérico<br/>Cámara: números 1 al 4</p>'
  ],

  /* ── Textos que el juego escribe a mano en el DOM ────────────────── */
  ['"Remove Admin"', '"Sacar admin"'],
  ['"Give Admin"', '"Dar admin"'],
  ['"Resume (P)"', '"Reanudar (P)"'],
  ['"Pause (P)"', '"Pausar (P)"'],
  ['"Show in room list: "', '"Aparecer en la lista: "'],
  ['"Override location"', '"Cambiar ubicación"'],
  ['"Remove override"', '"Volver a la real"'],
  ['"Kick "', '"Echar a "'],
  ['"Yes"', '"Sí"']
];

/*
 * Los nombres de equipo, al final y generados: así el mapa de `TEAMS` es la
 * única fuente y no puede quedar desfasado de lo que se le mete al bundle.
 *
 * `"Red"` aparece dos veces —el nombre del equipo y el primer renglón del
 * cartel de gol— y las dos quieren decir «Rojo», así que el reemplazo de todas
 * las apariciones es justo lo que corresponde.
 */
for (const [id, translated] of Object.entries(TEAMS.es)) {
  ES.push([`"${id}"`, `"${translated}"`]);
}

const TABLES = { es: ES };

/** ¿Hay traducción para este idioma? `en` no cuenta: es el original. */
function has(lang) {
  return Object.prototype.hasOwnProperty.call(TABLES, String(lang || ''));
}

/**
 * Traduce el bundle. Devuelve siempre algo servible: si el idioma no tiene
 * tabla, el original intacto.
 */
function translate(source, lang) {
  const table = TABLES[String(lang || '')];
  if (!table) return { source, applied: false, reason: `sin tabla para "${lang}"` };

  let out = source;
  let hits = 0;
  const missing = [];

  for (const [needle, replacement] of table) {
    if (!out.includes(needle)) {
      missing.push(needle);
      continue;
    }
    out = out.split(needle).join(replacement);
    hits++;
  }

  if (!hits) return { source, applied: false, reason: 'ninguna cadena coincidió' };

  const reason = `idioma ${lang}: ${hits}/${table.length} cadenas` +
    (missing.length ? ` (${missing.length} sin encontrar, quedan en inglés)` : '');
  return { source: out, applied: true, reason, missing };
}

module.exports = { translate, has, canonicalTeam, isAvatarNotice, TABLES, TEAMS };
