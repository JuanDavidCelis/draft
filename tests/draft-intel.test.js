import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAMPIONS, COUNTERS } from '../assets/js/catalog.js';
import { compareCompositions, getLastSidePick, getNextSidePick, getSidePickSlots } from '../assets/js/draft-intel.js';

const map = new Map(CHAMPIONS.map(champion => [champion.id, champion]));
const makeSlots = () => ({
  blue: ['baron', 'jungle', 'mid', 'adc', 'support'],
  red: ['baron', 'jungle', 'mid', 'adc', 'support'],
});
const emptyPicks = () => ({
  blue: { baron: null, jungle: null, mid: null, adc: null, support: null },
  red: { baron: null, jungle: null, mid: null, adc: null, support: null },
});

test('el orden de picks de cada lado conserva sus cinco turnos competitivos', () => {
  const picks = emptyPicks();
  assert.deepEqual(getSidePickSlots('blue', makeSlots(), picks).map(slot => slot.turn), [1, 4, 5, 8, 9]);
  assert.deepEqual(getSidePickSlots('red', makeSlots(), picks).map(slot => slot.turn), [2, 3, 6, 7, 10]);
});

test('el último pick rojo respeta los flex picks y la línea asignada a R5', () => {
  const picks = emptyPicks();
  const slotRoles = makeSlots();
  slotRoles.red = ['support', 'jungle', 'mid', 'adc', 'baron'];
  const last = getLastSidePick('red', slotRoles, picks);
  assert.equal(last.turn, 10);
  assert.equal(last.role, 'baron');
  assert.equal(last.champion, null);
});

test('el siguiente pick del lado rojo identifica el primer slot propio libre', () => {
  const picks = emptyPicks();
  picks.red.baron = 'malphite';
  const next = getNextSidePick('red', makeSlots(), picks);
  assert.equal(next.turn, 3);
  assert.equal(next.role, 'jungle');
});

test('el informe detecta respuesta anti-tanque y genera plan por fases', () => {
  const report = compareCompositions(
    ['fiora', 'lillia', 'brand', 'vayne', 'braum'],
    ['sion', 'rammus', 'galio', 'kog-maw', 'ornn'],
    map,
    COUNTERS,
    { adc: 'kog-maw', mid: 'galio' },
  );
  assert.equal(report.ownStyle, 'Anti-tank / DPS sostenido');
  assert.equal(report.enemyStyle, 'Protect the carry');
  assert.ok(report.edges.some(edge => edge.counter === 'vayne' && edge.target === 'sion'));
  assert.match(report.fightPlan, /frontline|tanque/i);
  assert.equal(report.focus[0], "Kog'Maw");
});

test('el informe recomienda protección cuando el rival tiene dive y nuestro peel es bajo', () => {
  const report = compareCompositions(
    ['jayce', 'lee-sin', 'akali', 'caitlyn', 'karma'],
    ['camille', 'nocturne', 'zed', 'kai-sa', 'nautilus'],
    map,
    COUNTERS,
    { adc: 'kai-sa', mid: 'zed' },
  );
  assert.ok(report.actions.some(action => /línea trasera|peel/i.test(action.title)));
  assert.ok(report.earlyPlan.length > 30);
  assert.ok(report.objectivePlan.length > 30);
  assert.ok(report.fightPlan.length > 30);
});

test('el recomendador aumenta la prioridad del counterpick directo de línea', async () => {
  const { scoreCandidateForDraft, summarizeTeam } = await import('../assets/js/draft-intel.js');
  const currentIds = ['lee-sin', 'orianna', 'braum'];
  const enemyIds = ['sion', 'rammus', 'galio', 'kog-maw'];
  const current = summarizeTeam(currentIds, map);
  const enemy = summarizeTeam(enemyIds, map);
  const score = champion => scoreCandidateForDraft({
    champion: map.get(champion), role: 'baron', current, enemy, currentIds, enemyIds,
    opposingLaneChampion: map.get('sion'), synergies: [], counters: COUNTERS, tier: 'CORE',
  });
  assert.ok(score('fiora') > score('shen'), 'Fiora debe ganar prioridad contra Sion y frontline');
});

test('el recomendador valora sinergia de protección para Kog\'Maw', async () => {
  const { scoreCandidateForDraft, summarizeTeam } = await import('../assets/js/draft-intel.js');
  const currentIds = ['kog-maw', 'orianna'];
  const enemyIds = ['camille', 'nocturne', 'akali'];
  const current = summarizeTeam(currentIds, map);
  const enemy = summarizeTeam(enemyIds, map);
  const score = champion => scoreCandidateForDraft({
    champion: map.get(champion), role: 'support', current, enemy, currentIds, enemyIds,
    synergies: [['kog-maw', 'braum', 5]], counters: COUNTERS, tier: 'CORE',
  });
  assert.ok(score('braum') > score('leona'));
});

test('el scouting marca prioridad por línea y reconoce el counterpick favorable', () => {
  const ownRolePicks = { baron: 'fiora', jungle: 'lillia', mid: 'brand', adc: 'vayne', support: 'braum' };
  const enemyRolePicks = { baron: 'sion', jungle: 'rammus', mid: 'galio', adc: 'kog-maw', support: 'ornn' };
  const report = compareCompositions(
    Object.values(ownRolePicks),
    Object.values(enemyRolePicks),
    map,
    COUNTERS,
    enemyRolePicks,
    ownRolePicks,
    [],
  );
  const baron = report.lanePriority.find(lane => lane.role === 'baron');
  assert.equal(baron.priority, 'Prioridad VK');
  assert.match(baron.explanation, /Fiora.*Sion/);
});

test('el índice comparativo solo aparece con dos composiciones completas y no se presenta como win rate', () => {
  const fullOwn = ['fiora', 'lillia', 'brand', 'vayne', 'braum'];
  const fullEnemy = ['sion', 'rammus', 'galio', 'kog-maw', 'ornn'];
  const complete = compareCompositions(fullOwn, fullEnemy, map, COUNTERS);
  assert.ok(complete.draftAdvantage);
  assert.equal(complete.draftAdvantage.own + complete.draftAdvantage.enemy, 100);
  assert.match(complete.draftAdvantage.label, /no representa win rate histórico/);

  const partial = compareCompositions(fullOwn.slice(0, 4), fullEnemy, map, COUNTERS);
  assert.equal(partial.draftAdvantage, null);
});
