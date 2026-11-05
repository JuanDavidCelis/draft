import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CHAMPIONS, COUNTERS } from '../assets/js/catalog.js';
import { analyzeLanePriority, laneAdvice } from '../assets/js/draft-intel.js';

const championMap = new Map(CHAMPIONS.map(champion => [champion.id, champion]));
const champ = id => championMap.get(id);

test('laneAdvice is pure and returns the favorable direct-counter context', () => {
  const advice = laneAdvice('baron', 4, 0, champ('fiora'), champ('sion'), 2.5);
  assert.match(advice, /Counter favorable/);
  assert.match(advice, /presionar/);
  assert.match(advice, /intercambios cortos/);
  assert.match(advice, /solo kill/);
});

test('laneAdvice returns defensive context for a losing direct counter', () => {
  const advice = laneAdvice('baron', 0, 4, champ('shen'), champ('camille'), -2.5);
  assert.match(advice, /Counter desfavorable/);
  assert.match(advice, /farmea safe/);
  assert.match(advice, /cobertura del jungla/);
  assert.match(advice, /amenaza de dive.*conserva HP/i);
});

test('laneAdvice uses the full matchup score when no direct counter is registered', () => {
  const favorable = laneAdvice('mid', 0, 0, champ('hwei'), champ('galio'), 2.1);
  const unfavorable = laneAdvice('mid', 0, 0, champ('galio'), champ('hwei'), -2.1);
  const disputed = laneAdvice('mid', 0, 0, champ('orianna'), champ('syndra'), 0.4);
  assert.match(favorable, /Counter favorable/);
  assert.match(unfavorable, /Counter desfavorable/);
  assert.match(disputed, /Emparejamiento disputado/);
});

test('laneAdvice reconciles direct counters with the overall matchup score', () => {
  const conflictingSignals = laneAdvice('baron', 4, 0, champ('shen'), champ('jayce'), -0.8);
  assert.match(conflictingSignals, /Emparejamiento disputado/);
});

test('Barón advice reacts to enemy poke and uses own waveclear when available', () => {
  const advice = laneAdvice('baron', 0, 0, champ('jayce'), champ('zyra'), 0);
  assert.match(advice, /limpia la oleada con waveclear.*ganar tempo/i);
  assert.match(advice, /poke/i);
});

test('Jungla advice detects own early, enemy scaling, enemy engage and own dive', () => {
  const scalingEngageEnemy = { ...champ('amumu'), tags: [...champ('amumu').tags, 'scaling'], scaling: 3 };
  const advice = laneAdvice('jungle', 0, 0, champ('lee-sin'), scalingEngageEnemy, 0);
  assert.match(advice, /invadir/i);
  assert.match(advice, /escala.*presiona temprano/i);
  assert.match(advice, /espera a que gaste su iniciación/i);
  assert.match(advice, /prioriza carries/i);
});

test('Mid advice uses waveclear, respects enemy engage and applies own poke before objectives', () => {
  const advice = laneAdvice('mid', 0, 0, champ('hwei'), champ('galio'), 0);
  assert.match(advice, /rota rápido/i);
  assert.match(advice, /juega defensivo/i);
  assert.match(advice, /desgastar antes de Dragón o Barón/i);
});

test('ADC advice uses own peel, responds to enemy dive and respects enemy scaling', () => {
  const advice = laneAdvice('adc', 0, 0, champ('kog-maw'), champ('camille'), 0);
  assert.match(advice, /peel\/protección/i);
  assert.match(advice, /ruta de escape junto a una pared/i);
  assert.match(advice, /ADC rival escala.*farmeo seguro/i);
});

test('Support advice protects the carry against engage, clears vision against poke and saves peel', () => {
  const engageAdvice = laneAdvice('support', 0, 0, champ('braum'), champ('leona'), 0);
  const pokeAdvice = laneAdvice('support', 0, 0, champ('thresh'), champ('zyra'), 0);
  assert.match(engageAdvice, /protege al carry/i);
  assert.match(engageAdvice, /no lo gastes para iniciar/i);
  assert.match(pokeAdvice, /despeja visión con tu equipo/i);
});

test('analyzeLanePriority includes advice for complete and pending lanes', () => {
  const complete = analyzeLanePriority(
    { baron: 'fiora', jungle: 'lee-sin', mid: 'hwei', adc: 'kog-maw', support: 'braum' },
    { baron: 'sion', jungle: 'amumu', mid: 'galio', adc: 'camille', support: 'leona' },
    championMap,
    COUNTERS,
  );
  assert.equal(complete.length, 5);
  for (const lane of complete) {
    assert.equal(typeof lane.advice, 'string');
    assert.ok(lane.advice.length > 20);
  }

  const pending = analyzeLanePriority({ baron: 'fiora' }, {}, championMap);
  assert.equal(typeof pending[0].advice, 'string');
  assert.match(pending[0].advice, /Selecciona ambos campeones/i);
  assert.match(pending[1].advice, /Selecciona ambos campeones/i);
});

test('renderMatchupAnalysis renders the lane advice below the matchup explanation', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const app = await readFile(resolve(root, 'assets/js/app.js'), 'utf8');
  const css = await readFile(resolve(root, 'assets/css/styles.css'), 'utf8');
  assert.match(app, /lane\.advice/);
  assert.match(app, /class=\"lane-advice\"/);
  assert.match(css, /\.lane-advice/);
});

test('laneAdvice no modifica los perfiles de campeones recibidos', () => {
  const own = Object.freeze({ ...champ('fiora'), tags: Object.freeze([...champ('fiora').tags]) });
  const enemy = Object.freeze({ ...champ('sion'), tags: Object.freeze([...champ('sion').tags]) });
  const beforeOwn = JSON.stringify(own);
  const beforeEnemy = JSON.stringify(enemy);
  laneAdvice('baron', 4, 0, own, enemy, 2.5);
  assert.equal(JSON.stringify(own), beforeOwn);
  assert.equal(JSON.stringify(enemy), beforeEnemy);
});

test('los módulos de inteligencia y renderizado conservan sintaxis JavaScript válida', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of ['assets/js/draft-intel.js', 'assets/js/app.js']) {
    const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});
