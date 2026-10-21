/*
 * Novedades de la versión: el cartel «Qué hay de nuevo» que sale UNA vez al abrir
 * la app después de actualizar.
 *
 * Para publicar novedades nuevas: cambiá el `id` (cualquier texto distinto al
 * anterior, por ejemplo la versión) y reescribí `items`. Mientras el `id` sea el
 * mismo, nadie vuelve a ver el cartel.
 */
window.TL_NEWS = {
  id: 'v1.0.51',
  title: { es: 'Qué hay de nuevo', en: "What's new" },
  items: {
    es: [
      'Plantel en vivo: botón «Ir» junto a cada compañero que está en una sala, para entrar a la misma con un clic.',
      'Chat en «Ancho completo»: ahora el chat y el cuadro de FPS comparten el mismo fondo y la misma opacidad. Los ajustes propios de fondo y opacidad quedan para el modo «Compacto».',
      'Arreglo: el color y la fuente de tu nombre en la lista de la sala ahora los ven los demás con la app (y vos ves los de ellos). Antes cada uno veía solo el suyo.',
      'Nuevo (opcional): Rendimiento → «Simulación liviana». Con FPS muy altos evita recalcular la física en cada cuadro dibujado. Viene apagada.',
      'Música del menú: ahora arranca sola al abrir la app, con la primera canción de Free Fire (2017). Viene prendida para todos; la podés silenciar o bajar desde el ícono de música de la barra de arriba.',
      'Nuevo: la interfaz se adapta sola al monitor. En pantallas más chicas o más cuadradas (1280×1024, 1366×768…) todo se ve con las mismas proporciones que en 1920×1080, sin cosas apretadas ni carteles encima de la lista. Se puede cambiar en Personalización → Estilo → Tamaño de la interfaz (Automático o un porcentaje fijo). El juego no cambia.',
      'Lista de salas con modos: Todas, Para jugar, Favoritas, Del club y Llenas (un toque aplica los filtros y el orden), y cinco vistas: lista, tarjetas, barras, tablero por ocupación y mapa de salas. Y en el chat de la sala, escribir «/» muestra todos los comandos de HaxBall: flechas para moverte, Tab o click para completar.',
      'Pelota 3D de verdad: con un estilo, un color o una imagen propia, la pelota ahora rueda como una esfera (el dibujo se corre, se achata hacia el borde, pasa por atrás y vuelve) en vez de girar en el lugar. Y el acabado de la cancha (textura y luz) pasó a opciones en píldoras, sin miniaturas: ya se ve en la vista previa de arriba. En las replays, la barra de controles ahora es una franja abajo con la línea de tiempo, saltos de ±5 s, y la cancha (el chat de la replay queda oculto) queda arriba sin que nada la tape.',
      'Nuevo: 15 sonidos de patada lo-fi y limpios (Personalización → Sonidos propios → Sonido de patada incluido): lo-fi, vinilo, cassette, madera, bongó, burbuja, gota, tecla, cuero, pelotazo, marimba, chasquido, vidrio, cuerda y redoblante. Tocás uno para escucharlo y elegirlo; cada golpe varía apenas el tono para que no suene a copia. Con un archivo propio de patada manda el archivo.',
      'Personalización: vista previa de cada estilo antes de elegirlo. La pelota, la ficha, el aro, la textura y la luz de la cancha ahora son una galería de miniaturas dibujadas con tu config (tu color, el 3D…): tocás la que te gusta y se aplica. Además los estilos Neón de la ficha, la pelota y la textura se rehicieron para que brillen de verdad.',
      'Nuevo: 16 pelotas más en Personalización → Discos y pelota → Aspecto de la pelota: fútbol moderno, de triángulos y de cuero, tenis, básquet, vóley, béisbol, golf, bowling, planeta Tierra, luna, bola de espejos, orbe, calabaza, sandía y ojo. Arreglo: con la pelota 3D el aspecto y el color ahora giran con la pelota y se ven con volumen (antes quedaban planos).',
      'Nuevo: pestaña Informes (capitán y habilitados). Elegís una replay y se arma el informe del partido: quiénes jugaron, los cambios (quién por quién), goles y asistencias, goles en contra y hasta qué minuto cada arco mantuvo la valla invicta. Ya no se guarda nada solo: sólo lo que cargues ahí.',
      'Interno: nuevos Mutadores de gol. Al hostear en modo Interno podés activarlos: después de cada gol la sala cambia una regla al azar un rato (pelota gigante, mini, pesada o resbalosa, discos chicos o grandes, viento) para los dos equipos, y todo vuelve a la normalidad solo. Con !mutadores se prenden o apagan en pleno partido.',
      'Replays: nueva barra flotante con los botones agrupados y más aire, que se esconde sola si no movés el mouse. Las velocidades llegan hasta x8. Nuevo: Pizarra táctica (botón ✎ Pizarra o tecla P): congela la cancha y dibujás flechas, zonas y trazos encima; la guardás como imagen o la copiás para pegarla en un chat.',
      'Arreglo: la app ya no se congela al pasar a pantalla completa en algunas PCs. si la ventana no responde tras el cambio, se deshace sola.',
      'Nuevo: tarjeta de perfil con anillo de nivel, barra de XP y tus partidos / goles / asistencias, con un destello dorado en el borde. Cambia de lugar según la interfaz: tarjeta en el menú lateral, chip en la barra de arriba o de abajo, o solo tu foto con el nivel en dock, isla e íconos. Tocala para abrir tu perfil.',
      'Nuevo: Hostear salas desde el cliente (pestaña Hostear del menú, sólo capitán y habilitados). Modo Interno: guarda el replay de cada partido y cuenta victorias, goles y asistencias. Modo Amistoso: sala con comandos (!x1 !x3 !x4 !x5 !x7, !swap, !mezclar, !camis, !limite…) y podés cargar tu propio script .js. En Club aparece «Los reyes del x7» con partidos ganados, goles y asistencias de todo el club.',
      'Nuevo: Interfaz elegible (Personalización → Estilo): Clásica (la de siempre, por defecto), Barra superior, Dock flotante, Isla, Barra inferior, Íconos, Lateral derecho y tres que cambian todo: Consola (Inicio con mosaicos), Comando (paleta Ctrl+K) y Radial (botón en abanico). Podés volver a la clásica cuando quieras. También: filas de la lista de salas densa/normal/amplia.',
      'Replays rediseñadas: ★ para fijar tus mejores, marcador y una línea con los goles de cada equipo, tarjetas con fecha y resultado del análisis, agrupadas por día, con filtros (hoy, semana, con análisis) y orden (más goles, más largos). La lista de salas muestra un esqueleto mientras carga los ajustes tienen migas de pan y hay una barra de estado opcional (Personalización → Estilo → Interfaz).',
      'Nuevo: Mezclador de volúmenes (Configuración → Cliente y audio) con la música del menú, gol y golpe en un solo lugar.',
      'Lista de salas: las salas donde hay gente del club conectada se resaltan con una insignia 👥 y el número de compañeros (pasá el mouse para ver los nombres).',
      'Nuevo: densidad de la interfaz (Personalización → Estilo): compacta, normal o cómoda. Cambia el espaciado de los menús, no toca el juego.',
      'Configuración y Personalización más ordenadas: cada sección se puede plegar tocando su título (se recuerda), hay atajos arriba de cada solapa para saltar a una sección y botones «Abrir todo / Cerrar todo». Cabeceras con estilo Club.',
      'Configuración rediseñada: 7 solapas con íconos (perfil rápido, gráficos, red, controles, cliente y audio, cuentas y sistema) y cabeceras con los colores del club.',
      'Panel del capitán: ahora se pueden marcar personas como «ajenas al club» (no ven conectados ni estadísticas y nadie del club las ve).',
      'Nuevo botón «Club» en el menú de la izquierda: estadísticas del club (goles, asistencias y partidos de todos, firmadas por cada app) e informes de partido (sólo capitán y quien él habilite) listos para copiar como texto o imagen.',
      'Nuevo: botones ◀ Gol / Gol ▶ en las replays para ir al gol anterior o siguiente.',
      'Nuevo: opacidad del chat y estilo/opacidad del cuadro de FPS y ping.',
      'Nuevo: en Cuenta, «Club conectado» muestra quién del club está usando la app y en qué sala.',
      'Insignia del plantel: quien entra con su clave se ve con el escudo y el nombre dorado en las salas.',
      'Nuevo: animaciones del menú (Personalización → Estilo): transiciones, escudo que respira, cortina al entrar a una sala, interruptores con rebote y filas en cascada. Todo se puede apagar.',
      'Nuevo: partículas en 5 estilos, fondo con la música y 4 temas (Papel, Retro CRT, Cyberpunk, Mármol).',
      'En partida: destello en los bordes con el color del equipo al hacer un gol y chispas cuando entra alguien del club.',
      'Sonidos de gol incluidos, 4 estilos de cartel de marcador y festejo especial cuando mete un gol alguien del plantel.',
      'Medidor de latencia de entrada y aviso de «Teclas filtro» de Windows (agregan retardo).',
      'Ajustes favoritos: tocá la estrella ☆ de cualquier ajuste y queda arriba del índice.',
      'Música en el menú, resolución ajustable y botones para ocultar salas con clave y llenas.',
      'Cada clave se usa en una sola PC: si cambiás de computadora, pedile a miclo que te la libere.'
    ],
    en: [
      'New: selectable interface (Personalization → Style): Classic (the usual, default), Top bar, Floating dock, Island, Bottom bar, Icons only, Right side and three that change everything: Console (tile Home), Command (Ctrl+K palette) and Radial (fan button). Go back to Classic any time. Also: dense/normal/roomy room-list rows.',
      'Replays redesigned: ★ to pin your best, score and a goals timeline per team, cards with date and analysis summary, grouped by day, with filters (today, week, analysed) and sorting (most goals, longest). The room list shows a skeleton while loading settings have breadcrumbs and there is an optional status bar (Personalization → Style → Interface).',
      'New: Volume mixer (Settings → Client & audio) with menu music, goal and kick sounds in one place.',
      'Room list: rooms with connected club members are highlighted with a 👥 badge and the number of teammates (hover for their names).',
      'New: interface density (Personalization → Style): compact, normal or comfortable. Only menu spacing, the game is untouched.',
      'Settings and Personalization are easier to scan: tap a section title to fold it (remembered), shortcut chips at the top of each tab jump to a section, plus “Open all / Close all”. Club-style headers.',
      'Settings redesigned: 7 tabs with icons (quick profile, graphics, network, controls, client & audio, accounts and system) and club-coloured headers.',
      'Captain panel: people can now be marked as “outside the club” (they see no online list or stats, and nobody in the club sees them).',
      'New “Club” button in the left menu: club stats (everyone’s goals, assists and matches, signed by each app) and match reports (captain only, delegable) ready to copy as text or image.',
      'New: ◀ Goal / Goal ▶ buttons in replays to jump to the previous or next goal.',
      'New: chat opacity and FPS/ping box style and opacity.',
      'New: in Account, “Club online” shows which club members are using the app and in which room.',
      'Squad badge: members who sign in with their key show the crest and a golden name in rooms.',
      'New: menu animations (Personalization → Style): transitions, breathing crest, curtain when entering a room, bouncy switches and cascading rows. All can be turned off.',
      'New: particles in 5 styles, background with the music and 4 themes (Paper, Retro CRT, Cyberpunk, Marble).',
      'In match: edge glow in the scoring team’s colour on goals and sparkles when a club member joins.',
      'Built-in goal sounds, 4 scoreboard styles and a special celebration when a verified squad member scores.',
      'Input latency meter and a warning for Windows “Filter Keys” (they add delay).',
      'Favourite settings: tap the star ☆ on any setting and it is pinned above the index.',
      'Menu music, adjustable resolution and buttons to hide password-protected and full rooms.',
      'Each key works on a single PC: if you switch computers, ask miclo to release it.'
    ]
  }
};
