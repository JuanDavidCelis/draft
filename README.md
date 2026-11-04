# VoidKings Draft Lab v0.8.1

## Ajustes visuales v0.8.1

- El Draft Board refleja la simetría de ambos lados: el retrato azul queda al borde izquierdo y el retrato rojo al borde derecho; los nombres quedan hacia el centro.
- La sección **Prioridad potencial por línea** muestra el retrato y el nombre de cada campeón, con la misma alineación espejada alrededor de VS.
- Se mantiene intacta la lógica de draft, Fearless, la autenticación y Vercel Blob.

# VOIDKINGS DRAFT LAB

Aplicación privada de draft competitivo para **VoidKings · VK SinADC**. Versión **0.8.1**.

La identidad visual y los textos de la aplicación corresponden a **VoidKings** y al equipo **VK SinADC**. Esta actualización conserva los identificadores internos del Blob y de la sesión de la versión anterior para no perder los drafts, configuraciones ni la sesión ya existentes. Esos identificadores son detalles técnicos de compatibilidad y no aparecen en la interfaz.

## Arquitectura Vercel-only

La aplicación se ejecuta en Vercel. No utiliza Supabase, Firebase, servicios externos de base de datos ni un servidor que deba permanecer encendido en tu Mac.

- **Frontend:** HTML, CSS y JavaScript estático servido por Vercel.
- **API:** Vercel Functions bajo `/api`.
- **Persistencia:** un documento JSON en **Vercel Blob Private Storage**.
- **Autenticación:** contraseña privada configurada como variable de entorno; cookie de sesión firmada, `HttpOnly`, `Secure` en producción y `SameSite=Strict`.
- **Caché de navegador:** `localStorage` conserva una copia de trabajo y permite migrar datos de la versión 0.2. La fuente principal de verdad es Vercel Blob.

El estado persistido incluye picks, bans, orden de slots, lado, formato, Champion Pool y composiciones personalizadas. El documento se limita a 2 MB.

## Funciones de la versión 0.8.1

- First Pick / Last Pick y formato BO1, BO3 o BO5.
- Gestión de series Fearless Draft: BO1 crea Game 1; BO3 crea Game 1–3; BO5 crea Game 1–5.
- Al finalizar un game con los diez picks registrados, los cinco campeones de ambos equipos quedan globalmente bloqueados para los games siguientes de esa serie. Los diez bans manuales quedan guardados dentro de su Game y cada nueva partida empieza con sus propios espacios de veto vacíos.
- Los games avanzan secuencialmente; un game solo se puede finalizar tras registrar los cinco picks de cada equipo. Al entrar al siguiente Game con 10/10 picks, el actual se cierra automáticamente. Los games completados quedan en modo lectura.
- El botón **Nueva serie** elimina el bloqueo temporal y crea una serie limpia, conservando Champion Pool y biblioteca. Cambiar BO1/BO3/BO5 con progreso pide confirmación y también reinicia la serie.
- Bans de ambos equipos.
- Orden competitivo B1 → R1 → R2 → B2 → B3 → R3 → R4 → B4 → B5 → R5.
- Asignación flexible de posición a cada turno, incluyendo flex picks como Malphite u Ornn Support.
- Champion Pool con CORE + ALT 1 + ALT 2 y situacionales editables.
- Recomendaciones dinámicas para el siguiente turno propio: identifica B1/B2/B3/B4/B5 o R1/R2/R3/R4/R5 según el lado y los picks ya registrados.
- Último pick diferenciado correctamente: R5 es el counterpick real del lado rojo; B5 cierra la composición antes de que el rival tenga su R5.
- Cada línea sugiere tres candidatos a partir del CORE + ALT 1 + ALT 2 configurados, descartando campeones baneados o ya seleccionados.
- El motor puntúa prioridad de Champion Pool, equilibrio de daño, frontline, engage, CC, peel, sinergias conocidas, counters por línea, perfil de la composición rival y ajustes conocidos del parche 7.3d.
- Panel de scouting de matchup: compara arquetipos de ambos equipos, siete atributos estratégicos, matchups directos, prioridad potencial por línea y recomendaciones de ejecución.
- Índice comparativo de draft (0–100 repartido entre ambos equipos) solo cuando ambas composiciones están completas. Es una heurística de herramientas/sinergias/counters, no representa win rate ni probabilidad real de victoria.
- Plan de partida por fases: early game, preparación de objetivos y teamfights.
- Retratos de campeones, fallbacks visuales si no carga una imagen y animaciones de entrada/transición respetando `prefers-reduced-motion`.
- Tres propuestas de composición y biblioteca de plantillas editables.
- Analizador heurístico de la composición.
- Siete plantillas iniciales y composiciones personales.
- Exportación/importación JSON.
- Guardado automático en Vercel con debounce.
- Control de concurrencia por ETag: si otra pestaña o dispositivo modifica el documento antes que esta sesión, el servidor rechaza el guardado obsoleto para evitar sobrescribir cambios.
- Inicio y cierre de sesión.
- Service worker que almacena archivos estáticos; excluye expresamente todas las rutas `/api` para no cachear respuestas privadas.
- Identidad visual **VoidKings · VK SinADC**, monograma VK y paleta violeta/oro.
- Iconos PWA y favicon personalizados para VoidKings.
- Encabezados de seguridad en `vercel.json`.


### Recomendaciones, imágenes y análisis competitivo

El panel **Pick Coach** calcula el siguiente turno de VK SinADC usando el orden competitivo del lado seleccionado. En rojo, R5 se trata como counterpick real porque llega después de los cinco picks azules. En azul, B5 se presenta como cierre de composición, ya que el rival todavía conserva R5.

Las sugerencias se ordenan por puntuación heurística: no son porcentajes de victoria, predicciones de resultado ni una tier list oficial. El motor usa los perfiles editables del catálogo, relaciones de sinergia/counter mantenidas en `assets/js/catalog.js`, picks enemigos y el contexto de ajustes del parche indicado en el código. Los perfiles con etiquetas estratégicas pendientes aportan métricas neutrales hasta que se completen.

El panel **Matchup Analysis** compara las herramientas de los dos equipos y propone ajustes por fase. Su lectura se marca como parcial mientras falten selecciones. La prioridad por línea se estima con counters registrados y perfiles del catálogo, y no garantiza prioridad de oleada. El índice de draft aparece únicamente cuando ambos equipos tienen cinco picks; es una distribución heurística de ventaja composicional, nunca un porcentaje real de win rate ni una predicción del resultado. Las sugerencias sirven como apoyo al coach y deben validarse con scrims y el conocimiento de los jugadores.

Los retratos se cargan desde Riot Data Dragon `16.21.1`. Por tanto, la aplicación, la API, el estado privado y las recomendaciones se ejecutan/alojan en Vercel; únicamente las imágenes de campeón se solicitan a la CDN oficial de Riot. Si una imagen no existe o la CDN no responde, se muestran iniciales como alternativa.

Los informes **Lectura del coach**, **Scouting automático**, **Plan de partida** y **Lectura y ajustes** aparecen apilados, a ancho completo y debajo del tablero y del asistente de recomendaciones, con tipografía ampliada y comparativa de ambos equipos.

La capa visual incorpora animaciones de paneles, selección, sugerencias y modales. Se desactivan/reducen mediante `prefers-reduced-motion` cuando el sistema operativo del usuario solicita movimiento reducido.

## Cambios de la versión 0.8.1

- La aplicación muestra el número de versión en la sala de torneo para confirmar que el despliegue nuevo está activo.
- Cada pestaña Game muestra por separado el progreso de picks y bans (por ejemplo, `10/10 PICKS · 5/10 BANS`).
- El contador `BANS REGISTRADOS EN GAME N` refleja inmediatamente los vetos del Game seleccionado.
- Los picks de games finalizados aparecen como `FEARLESS LOCKS` con el retrato y el game de origen. Los bans manuales no se mezclan con esos bloqueos.
- El snapshot del Game activo se guarda antes de renderizar contadores y pestañas, evitando que el progreso de bans aparezca desfasado.
- El guardado por Game y el cierre Fearless se realizan mediante funciones de serie testeables; cada Game conserva sus propios bans, mientras los diez picks quedan retirados para los siguientes games.
- Los cuatro informes del coach se muestran en una sola columna de ancho completo, siempre debajo del Draft Board y Pick Coach.
- Se actualizó el service worker a `v0.8.1` para eliminar la caché estática anterior y se reforzó la presentación de informes.

### Actualizar una instalación existente

Si el proyecto ya está conectado a GitHub y Vercel, **no crees otro proyecto ni otro Blob**. Reemplaza el contenido del repositorio existente con los archivos de esta versión, conserva el mismo proyecto de Vercel y realiza un commit/push a la rama conectada (normalmente `main`). No cambian `APP_PASSWORD`, `SESSION_SECRET`, el nombre/ruta del documento Blob ni las API de persistencia. Después del despliegue, recarga la página con `Cmd + Shift + R`. En la sala debe aparecer la etiqueta `DRAFT LAB v0.8.1`.

## Despliegue en Vercel

### 1. Subir el proyecto a Git

Sube el contenido de esta carpeta a un repositorio privado de GitHub. No subas `.env` ni tokens. El archivo `.env.example` solo contiene nombres y ejemplos.

### 2. Importar el repositorio en Vercel

1. En Vercel, crea un proyecto nuevo e importa el repositorio.
2. Selecciona **Other** como framework si Vercel no detecta uno automáticamente.
3. Deja el directorio raíz en `.`.
4. No configures build command ni output directory adicional: los archivos estáticos están en la raíz y las funciones están en `/api`.
5. Despliega el proyecto.

### 3. Crear el almacenamiento privado de Vercel

1. Abre el proyecto en Vercel y entra en **Storage**.
2. Selecciona **Create Storage** y elige **Blob**.
3. Selecciona acceso **Private**. No crees un almacén público: contiene la configuración y los drafts privados del equipo.
4. Conecta el Blob store a este proyecto y a los entornos donde se vaya a ejecutar.

Cuando se conecta el Blob privado al proyecto, Vercel configura el contexto de almacenamiento para las Functions. El SDK `@vercel/blob` utiliza Vercel OIDC automáticamente cuando están disponibles `VERCEL_OIDC_TOKEN` y `BLOB_STORE_ID`; no expongas credenciales Blob en el navegador.

> Private Storage se documenta actualmente como una función Beta. La disponibilidad y los controles visibles pueden depender de la cuenta/rol de Vercel. Consulta la documentación oficial enlazada al final.

### 4. Configurar las variables de entorno

En **Project → Settings → Environment Variables**, crea:

| Variable | Valor |
|---|---|
| `APP_PASSWORD` | Una contraseña/frase larga, única y privada para acceder a Draft Lab. |
| `SESSION_SECRET` | Secreto aleatorio de al menos 32 caracteres. |

Puedes generar `SESSION_SECRET` con:

```bash
openssl rand -hex 48
```

Configura ambas variables para **Production**. Añade Preview solo si quieres proteger y probar previews con las mismas credenciales. No las pongas en JavaScript, HTML, Git ni en variables `NEXT_PUBLIC_`.

No es necesario crear `BLOB_READ_WRITE_TOKEN` manualmente cuando el Blob privado está correctamente conectado al proyecto y Vercel OIDC está disponible. Si el panel no configura `BLOB_STORE_ID` / OIDC, revisa la conexión del store antes de generar o copiar credenciales manualmente.

### 5. Volver a desplegar

Después de crear o modificar las variables de entorno, crea un nuevo deployment. Las variables nuevas no se aplican a los deployments que ya estaban construidos.

### 6. Iniciar sesión y comprobar el guardado

1. Abre la URL de producción.
2. Introduce `APP_PASSWORD`.
3. El primer inicio consulta el documento privado existente en Vercel Blob. El identificador técnico del archivo y las claves internas de sesión/caché se mantienen estables para conservar los drafts y la sesión de la versión anterior.
4. Cambia un pick o una prioridad del Champion Pool y espera a que el indicador superior muestre **GUARDADO EN VERCEL**.
5. Cierra la sesión, vuelve a entrar o abre la web en otro dispositivo y comprueba que el estado se recupera.

## Comandos del proyecto

```bash
npm install
npm test
```

Para desarrollo local con Vercel CLI, vincula primero el proyecto con `vercel link` y utiliza `vercel dev`. El Blob privado requiere las credenciales/entorno de Vercel correspondiente; el uso normal de producción se ejecuta en Vercel.

## Persistencia, seguridad y límites

- **Vercel Blob es la fuente principal de verdad.** La caché local no sustituye el guardado remoto.
- `localStorage` se mantiene para migración y tolerancia a fallos, pero no se necesita para consultar el documento remoto cuando se accede desde otro navegador o dispositivo.
- Las rutas `/api/state` requieren cookie de sesión válida. Las escrituras también validan el encabezado `Origin`.
- Las contraseñas y secretos se verifican en Functions y no se envían a Blob.
- La cookie expira en siete días. Al expirar, hay que iniciar sesión otra vez.
- Este MVP utiliza un único acceso de propietario compartido. No hay usuarios, equipos, roles ni gestión multiusuario.
- Los guardados tienen control de concurrencia ETag. Si hay dos pestañas abiertas y una queda desactualizada, se mostrará un conflicto y será necesario recargar antes de seguir guardando.
- El service worker cachea únicamente recursos estáticos; nunca cachea `/api/auth/*` ni `/api/state`.
- La aplicación requiere conexión a Internet y una sesión válida para cargar/guardar en Vercel. La caché de interfaz no equivale a modo offline completo.
- Private Blob Storage y Vercel Functions están sujetos a cuotas, límites y precios de la cuenta. Comprueba el panel de uso y la página de precios antes de habilitar tráfico significativo.
- La autenticación por contraseña es apropiada para una herramienta personal; utiliza una frase larga y única y mantén el proyecto de Vercel y su repositorio privados. Para exposición pública se debe añadir rate limiting de inicio de sesión en Vercel Firewall o una capa de identidad más completa.

## Compatibilidad con la versión anterior

El cambio de identidad conserva la ruta técnica del documento privado de Blob y la cookie de sesión para no romper la conexión ya configurada. El nombre de la aplicación, la interfaz, el manifiesto PWA, los iconos y los archivos de respaldo nuevos ya usan VoidKings · VK SinADC. La caché local principal ahora usa el prefijo VoidKings y mantiene las claves anteriores únicamente como rutas de migración. Por ello, el despliegue de esta versión conserva los drafts, el Champion Pool, las plantillas personalizadas y la sesión existente. Los respaldos JSON exportados con el nombre anterior también se pueden importar; los nuevos respaldos se identifican como VoidKings · VK SinADC.

## Pruebas

Ejecuta `npm test` con Node.js 20 o superior. La suite cubre catálogo, picks, counters, análisis, flujo BO1/BO3/BO5, bloqueos Fearless entre ambos equipos, reinicio de serie, bans por game, autenticación y persistencia en Vercel Blob.

## Documentación oficial de Vercel

- [Vercel Blob — Private Storage](https://vercel.com/docs/vercel-blob/private-storage)
- [Vercel Blob — JS SDK Reference](https://vercel.com/docs/vercel-blob/using-blob-sdk)
- [Vercel Functions](https://vercel.com/docs/functions)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)

## Estructura

```text
voidkings-draft-lab/
├── api/
│   ├── auth/
│   │   ├── login.js
│   │   ├── logout.js
│   │   └── session.js
│   └── state.js
├── lib/server/auth.js
├── assets/
│   ├── css/styles.css
│   ├── icons/
│   └── js/
│       ├── app.js
│       ├── catalog.js
│       ├── draft-intel.js
│       └── series.js
├── tests/
├── index.html
├── manifest.webmanifest
├── sw.js
├── vercel.json
├── package.json
└── README.md
```


## Novedades v0.7.0 (incluidas en v0.8.1)

- Los informes del coach se muestran debajo del tablero y del asistente en ancho completo.
- Cada game tiene cinco bans manuales por equipo, independientes de los demás games.
- Los picks de games cerrados aparecen como bloqueos Fearless visibles y no pueden volver a seleccionarse durante la serie.
- Cuando un draft llega a 10/10 picks, se puede cerrar manualmente o al entrar al siguiente game.
- El service worker y las cabeceras de Vercel fuerzan la actualización del HTML y del bundle tras cada despliegue.


## Ajustes visuales de la versión 0.8.1

- El Draft Board ahora refleja visualmente ambos lados alrededor del separador VS: el retrato de VK permanece en el borde exterior izquierdo y el del rival pasa al borde exterior derecho; los nombres quedan orientados hacia el centro.
- La sección **Prioridad potencial por línea** incorpora los retratos de ambos campeones y mantiene la misma alineación espejada.
- Se conservan el orden de picks, los datos Fearless, autenticación, Vercel Functions y Vercel Blob.
