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
      'Nuevo: pestaña Informes (capitán y habilitados). Elegís una replay y se arma el informe del partido: quiénes jugaron, los cambios (quién por quién), goles y asistencias, goles en contra y hasta qué minuto cada arco mantuvo la valla invicta. Ya no se guarda nada solo: sólo lo que cargues ahí.',
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
