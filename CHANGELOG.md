## 0.8.2 — consejos tácticos por línea

- Añadida la función pura `laneAdvice` en `assets/js/draft-intel.js`.
- `analyzeLanePriority` incorpora un campo `advice` para cada línea, también cuando falta algún pick.
- El consejo clasifica el contexto por counter directo (`ownCounter` vs `enemyCounter`) y score del matchup cuando no existe un counter directo.
- Se agregan recomendaciones situacionales para Barón, Jungla, Mid, ADC y Soporte, considerando tags y estadísticas de ambos campeones.
- Cada `lane-priority-card` muestra «CONSEJO DE JUEGO» debajo de la explicación del matchup.
- Se actualiza la caché PWA a v0.8.2 para invalidar los recursos estáticos anteriores.
- Se elimina un bloque duplicado fuera de `selectChampion` que impedía analizar `app.js` con el parser de Node.

## 0.8.1 — alineación espejada del Draft Board y prioridad por línea
- El retrato de cada pick del lado rojo se coloca en el borde exterior derecho; nombre centrado hacia VS, como espejo del lado azul.
- Prioridad potencial por línea ahora muestra retrato y nombre en ambos lados, con VS al centro.
- Se versiona la caché PWA para refrescar los recursos estáticos tras el despliegue.

## v0.8.1
- Espejado del contenido de picks en Draft Board: azul (avatar a la izquierda), rojo (avatar a la derecha).
- Añadidos retratos y nombres alineados en Prioridad potencial por línea.
- Sin cambios al modelo de datos ni a la persistencia de Vercel Blob.

# Changelog — VoidKings Draft Lab

## 0.6.0 — Series Fearless & Coach Reports

- Añadida gestión de series BO1, BO3 y BO5 con tabs por game.
- Al finalizar un game completo, sus diez picks (cinco de cada lado) quedan bloqueados para el resto de la serie.
- Los bans permanecen separados por game y no se heredan.
- Los games siguientes se desbloquean secuencialmente.
- Añadido el control **Nueva serie** para limpiar picks históricos y bloqueos Fearless sin borrar Champion Pool ni biblioteca.
- Los informes del coach quedan debajo del tablero y de las recomendaciones.
- Ampliada la tipografía y el espacio de los informes para lectura durante la preparación competitiva.
- Incorporada comparativa entre ambos equipos, lectura de prioridad potencial por línea, counters directos y planes de early game, objetivos y teamfights.
- El índice de ventaja es heurístico y no se presenta como win rate real.
- Se conserva la persistencia privada en Vercel Blob y la compatibilidad con los datos anteriores.


## 0.7.0 — coach reports en ancho completo y Fearless por game

- Reubicados los cuatro informes del coach dentro del flujo principal, debajo de la sala de draft y las recomendaciones; no se renderizan en una barra lateral.
- Aumentada la jerarquía tipográfica de analizador, scouting, plan de partida y ajustes.
- Añadida una franja visible de bloqueos Fearless en el panel de bans, con retrato y game de origen de cada campeón.
- El panel de bans identifica el Game actual y aclara que los cinco bans manuales de cada equipo son independientes por partida.
- Las pestañas de Game muestran el progreso de picks y bans.
- Al abrir el siguiente Game con 10/10 picks, el Game anterior se cierra automáticamente y se aplican los bloqueos Fearless.
- Los campeones seleccionados o baneados/bloqueados no pueden añadirse mediante recomendaciones o plantillas que intenten saltarse las validaciones.
- Actualizado el service worker a una caché nueva y deshabilitada la caché HTTP para HTML y service worker, evitando que el navegador siga mostrando el layout antiguo.


## 0.8.0 — layout completo y persistencia de bans por game

- Los cuatro informes se apilan en una sola columna a ancho completo debajo del Draft Board y del Pick Coach; se elimina la distribución tipo rail lateral.
- Se añade el identificador visible `DRAFT LAB v0.8.0` para verificar qué build está publicado.
- Cada pestaña Game presenta su propio progreso de picks y bans.
- Se añade un contador explícito de bans manuales del Game activo.
- Los campeones elegidos en games anteriores se muestran como `FEARLESS LOCKS`, diferenciados de los bans manuales de la partida.
- El estado actual se sincroniza al slot de la serie antes de renderizar contadores y pestañas para evitar desfases visuales.
- Se encapsula y prueba el guardado del snapshot y el cierre de cada Game; los bans permanecen aislados por Game y los diez picks quedan bloqueados en el resto de la serie.
- Se incrementa el service worker a v0.8.0 para invalidar recursos cacheados de builds anteriores.
