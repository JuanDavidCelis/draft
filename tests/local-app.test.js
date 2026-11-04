import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(resolve(root, file), 'utf8');

test('la aplicación incluye importación y exportación de respaldos locales', () => {
  const html = read('index.html');
  const app = read('assets/js/app.js');
  assert.match(html, /id="import-btn"/);
  assert.match(html, /id="export-btn"/);
  assert.match(app, /function validImportedState/);
  assert.match(app, /async function importBackup/);
  assert.match(app, /function exportDraft/);
});

test('el orden de picks permite asignar posiciones a cada turno', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /PICK_TURNS = \{ blue: \[1, 4, 5, 8, 9\], red: \[2, 3, 6, 7, 10\] \}/);
  assert.match(app, /data-slot-role/);
  assert.match(app, /function setSlotRole/);
});

test('Champion Pool permite editar CORE y alternativas', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /function setPoolTier/);
  assert.match(app, /data-pool-tier/);
  assert.match(app, /'CORE', 'ALT 1', 'ALT 2', 'SITUACIONAL'/);
});

test('la PWA tiene manifest, service worker e iconos locales', () => {
  const html = read('index.html');
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const sw = read('sw.js');
  assert.match(html, /rel="manifest"/);
  assert.match(sw, /cache\.addAll\(APP_SHELL\.map/);
  for (const icon of manifest.icons) assert.ok(existsSync(resolve(root, icon.src)), icon.src);
});

test('no depende de fuentes remotas ni de Supabase', () => {
  const html = read('index.html');
  const app = read('assets/js/app.js');
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.doesNotMatch(app, /supabase|createClient/i);
  assert.match(app, /localStorage/);
});

test('el coach muestra el siguiente turno, las tres alternativas y reserva el último pick', () => {
  const html = read('index.html');
  const app = read('assets/js/app.js');
  assert.match(html, /id="pick-coach-panel"/);
  assert.match(app, /function renderPickCoach\(\)/);
  assert.match(app, /getNextPickSlot\(\)/);
  assert.match(app, /getLastPickSlot\(\)/);
  assert.match(app, /ÚLTIMO PICK · COUNTERPICK/);
  assert.match(app, /getRoleCandidates\(next\.role, 3\)/);
});

test('el analizador compara ambos equipos y entrega planes por fases', () => {
  const html = read('index.html');
  const app = read('assets/js/app.js');
  const engine = read('assets/js/draft-intel.js');
  assert.match(html, /id="matchup-analysis"/);
  assert.match(app, /function renderMatchupAnalysis\(\)/);
  assert.match(app, /compareCompositions\(/);
  assert.match(app, /state\.picks\[enemy\], state\.picks\[team\], SYNERGIES/);
  assert.match(engine, /earlyPlan/);
  assert.match(engine, /objectivePlan/);
  assert.match(engine, /fightPlan/);
});

test('el diseño incluye animaciones y retratos de campeones con fallback', () => {
  const html = read('index.html');
  const app = read('assets/js/app.js');
  const css = read('assets/css/styles.css');
  const sw = read('sw.js');
  const vercel = read('vercel.json');
  assert.match(css, /@keyframes vdl-fade-up/);
  assert.match(css, /@keyframes vdl-pick-pop/);
  assert.match(app, /function championAvatar\(/);
  assert.match(app, /function bindChampionImages\(/);
  assert.match(app, /ddragon\.leagueoflegends\.com/);
  assert.match(vercel, /ddragon\.leagueoflegends\.com/);
  assert.match(sw, /draft-intel\.js/);
  assert.match(sw, /series\.js/);
});

test('el lado azul cierra en B5 y el lado rojo conserva el counterpick R5', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /const isTrueCounterpick = isFinalOwnPick && team === 'red'/);
  assert.match(app, /ÚLTIMA SELECCIÓN · CIERRE DE DRAFT/);
  assert.match(app, /ÚLTIMO PICK · COUNTERPICK/);
  assert.match(app, /RESERVA DE CIERRE · B5/);
  assert.match(app, /RESERVA DE COUNTERPICK · R5/);
});

test('la comparativa muestra atributos de ambos equipos y respeta sus lados', () => {
  const app = read('assets/js/app.js');
  const engine = read('assets/js/draft-intel.js');
  const css = read('assets/css/styles.css');
  assert.match(engine, /const metrics = \[/);
  assert.match(app, /report\.metrics\.map/);
  assert.match(app, /const ownTone = team === 'blue' \? 'blue' : 'red'/);
  assert.match(css, /\.comparison-grid/);
  assert.match(css, /\.compare-meter\.enemy/);
});


test('el tablero Fearless crea games BO1/BO3/BO5 y conserva bloqueos globales de picks', () => {
  const html = read('index.html');
  const app = read('assets/js/app.js');
  const series = read('assets/js/series.js');
  assert.match(html, /id=\"series-games\"/);
  assert.match(html, /id=\"finish-game-btn\"/);
  assert.match(html, /id=\"new-series-btn\"/);
  assert.match(app, /getSeriesLockedChampions/);
  assert.match(app, /getSeriesDisplayLocks/);
  assert.match(app, /function finishCurrentGame\(\)/);
  assert.match(app, /function startNewSeries\(/);
  assert.match(series, /FORMAT_GAME_COUNTS = Object.freeze\(\{ BO1: 1, BO3: 3, BO5: 5 \}\)/);
  assert.match(series, /function canAccessSeriesGame/);
});

test('los informes del coach se muestran debajo del draft con tipografía ampliada', () => {
  const html = read('index.html');
  const css = read('assets/css/styles.css');
  assert.match(html, /LECTURA DEL COACH/);
  assert.match(html, /SCOUTING AUTOMÁTICO/);
  assert.match(html, /PLAN DE PARTIDA/);
  assert.match(html, /LECTURA Y AJUSTES/);
  assert.match(css, /report-card \.section-heading h2\{font-size:28px\}/);
  assert.match(css, /\.game-phase p\{font-size:14px/);
  assert.match(css, /@media\(max-width:700px\)\{\.reports-grid\{grid-template-columns:1fr\}/);
});


test('los cuatro informes quedan debajo del tablero en el flujo principal, no en una barra lateral', () => {
  const html = read('index.html');
  const css = read('assets/css/styles.css');
  const start = html.indexOf('<div class="draft-main-column">');
  const reports = html.indexOf('<section class="coach-reports"');
  const disclaimer = html.indexOf('report-disclaimer', reports);
  const reportsEnd = html.indexOf('</section>', disclaimer);
  const mainColumnEnd = html.indexOf('</div>', reportsEnd);
  assert.ok(start >= 0 && reports > start && reportsEnd > reports && mainColumnEnd > reportsEnd);
  assert.doesNotMatch(html, /draft-side-column/);
  assert.match(css, /#view-draft \.draft-layout\{display:block!important/);
  assert.match(css, /#view-draft \.coach-reports\{display:grid!important/);
});

test('cada game muestra su veto independiente y los picks previos como Fearless bans', () => {
  const html = read('index.html');
  const app = read('assets/js/app.js');
  const series = read('assets/js/series.js');
  assert.match(html, /id="ban-game-label"/);
  assert.match(html, /id="fearless-ban-strip"/);
  assert.match(html, /los bans manuales no se arrastran/);
  assert.match(app, /FEARLESS LOCKS · GAME/);
  assert.match(app, /const locks = seriesLockedMap\(\)/);
  assert.match(app, /countGameBans\(game\)/);
  assert.match(app, /Cerrar y abrir Game/);
  assert.match(app, /gameNumber === nextNumber && !currentGameIsCompleted\(\)/);
  assert.match(series, /export function countGameBans/);
});

test('el service worker invalida la versión anterior para que Vercel publique el nuevo layout', () => {
  const sw = read('sw.js');
  const app = read('assets/js/app.js');
  const vercel = read('vercel.json');
  assert.match(sw, /voidkings-draft-lab-v0-8-1/);
  assert.match(sw, /cache: 'reload'/);
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(app, /updateViaCache: 'none'/);
  assert.match(vercel, /no-cache, no-store, must-revalidate/);
});


test('v0.8.1 muestra el build, el contador de bans del Game actual y los bloqueos Fearless', () => {
  const html = read('index.html');
  const app = read('assets/js/app.js');
  const sw = read('sw.js');
  assert.match(html, /DRAFT LAB v0\.8\.1/);
  assert.match(html, /id="game-ban-count"/);
  assert.match(app, /FEARLESS LOCKS · GAME/);
  assert.match(app, /BANS REGISTRADOS EN GAME/);
  assert.match(sw, /voidkings-draft-lab-v0-8-1/);
});

test('los cuatro informes se apilan en ancho completo bajo el Draft Board y Pick Coach', () => {
  const html = read('index.html');
  const css = read('assets/css/styles.css');
  const draft = html.indexOf('<section class="panel picks-panel">');
  const coach = html.indexOf('<section class="panel recommendation-panel"');
  const reports = html.indexOf('<section class="coach-reports"');
  assert.ok(draft >= 0 && coach > draft && reports > coach);
  assert.match(css, /#view-draft \.reports-grid\{display:grid!important;grid-template-columns:minmax\(0,1fr\)!important\}/);
  assert.match(css, /#view-draft \.reports-grid>\.report-card\{grid-column:1\/-1!important/);
});
