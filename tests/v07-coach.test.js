import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(resolve(root, file), 'utf8');

test('el tablero usa splash art con fallback de retrato para cada pick', () => {
  const app = read('assets/js/app.js');
  const css = read('assets/css/styles.css');
  assert.match(app, /function championCardArt\(champion\)/);
  assert.match(app, /img\/champion\/splash/);
  assert.match(app, /champion-splash-art/);
  assert.match(app, /splash-missing/);
  assert.match(css, /\.pick-visual \.champion-splash-art/);
  assert.match(css, /\.pick-visual\.splash-missing/);
});

test('el Pick Coach conserva el tier CORE/ALT y explica el mejor ajuste', () => {
  const app = read('assets/js/app.js');
  const css = read('assets/css/styles.css');
  assert.match(app, /function candidateReasons\(entry, role, currentIds, enemyIds\)/);
  assert.match(app, /Counter de línea/);
  assert.match(app, /Balance de daño/);
  assert.match(app, /Sinergia registrada/);
  assert.match(app, /AJUSTE DEL DRAFT/);
  assert.match(app, /MEJOR AJUSTE/);
  assert.match(app, /tierLabel\(entry\.tier\)/);
  assert.match(css, /\.recommendation-reasons/);
  assert.match(css, /\.best-fit-badge/);
});

test('las tarjetas de composición muestran imagen y rol del campeón', () => {
  const app = read('assets/js/app.js');
  const css = read('assets/css/styles.css');
  assert.match(app, /build-pick-chip/);
  assert.match(app, /championAvatar\(champ,'tiny'\)/);
  assert.match(css, /\.build-picks \.build-pick-chip/);
});

test('el matchup de línea expone campeones, evidencia y confianza', () => {
  const app = read('assets/js/app.js');
  const intel = read('assets/js/draft-intel.js');
  const css = read('assets/css/styles.css');
  assert.match(intel, /ownChampionId: ownId/);
  assert.match(intel, /enemyChampionId: enemyId/);
  assert.match(intel, /const evidence = hasDirectEvidence/);
  assert.match(intel, /const confidence = hasDirectEvidence/);
  assert.match(app, /lane-matchup-portraits/);
  assert.match(app, /lane-evidence/);
  assert.match(css, /\.lane-side-pick/);
  assert.match(css, /\.lane-evidence/);
});

test('los resultados del análisis se califican como heurísticos y no como prioridad garantizada', () => {
  const intel = read('assets/js/draft-intel.js');
  assert.match(intel, /Tendencia VK/);
  assert.match(intel, /Tendencia rival/);
  assert.match(intel, /no en una prioridad automática/);
  assert.match(intel, /no es una prueba de prioridad de oleada|no en una prioridad automática/);
});
