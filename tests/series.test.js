import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMAT_GAME_COUNTS,
  createEmptyGame,
  createSeriesState,
  gameCountForFormat,
  getSeriesLockedChampions,
  getSeriesDisplayLocks,
  canAccessSeriesGame,
  canCompleteGame,
  countGamePicks,
  countGameBans,
  saveSeriesGameSnapshot,
  completeSeriesGame,
  normalizeSeriesState,
} from '../assets/js/series.js';

const roles = ['baron', 'jungle', 'mid', 'adc', 'support'];
const fullPicks = (blue, red) => ({
  blue: Object.fromEntries(roles.map((role, index) => [role, blue[index]])),
  red: Object.fromEntries(roles.map((role, index) => [role, red[index]])),
});

function completeGame(series, gameNumber, blue, red) {
  const game = series.games[gameNumber - 1];
  game.picks = fullPicks(blue, red);
  game.completed = true;
  game.completedAt = '2026-11-03T12:00:00.000Z';
}

test('BO1, BO3 y BO5 crean el número correcto de games', () => {
  assert.deepEqual(FORMAT_GAME_COUNTS, { BO1: 1, BO3: 3, BO5: 5 });
  assert.equal(gameCountForFormat('BO1'), 1);
  assert.equal(gameCountForFormat('BO3'), 3);
  assert.equal(gameCountForFormat('BO5'), 5);
  assert.equal(createSeriesState('BO5', roles).games.length, 5);
});

test('los picks de ambos equipos quedan bloqueados globalmente para los siguientes games', () => {
  const series = createSeriesState('BO3', roles);
  completeGame(series, 1,
    ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum'],
    ['ornn', 'amumu', 'orianna', 'vayne', 'malphite']);

  const locksForGame2 = getSeriesLockedChampions(series, 2);
  assert.equal(locksForGame2.size, 10);
  for (const id of ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum', 'ornn', 'amumu', 'orianna', 'vayne', 'malphite']) {
    assert.ok(locksForGame2.has(id), `${id} debe quedar bloqueado`);
  }
  assert.equal(locksForGame2.get('kog-maw'), 1);
});

test('los campeones del Game 2 también se bloquean para Game 3', () => {
  const series = createSeriesState('BO3', roles);
  completeGame(series, 1,
    ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum'],
    ['ornn', 'amumu', 'orianna', 'vayne', 'malphite']);
  completeGame(series, 2,
    ['fiora', 'jarvan-iv', 'brand', 'jinx', 'nautilus'],
    ['camille', 'wukong', 'galio', 'xayah', 'rell']);

  const locksForGame3 = getSeriesLockedChampions(series, 3);
  assert.equal(locksForGame3.size, 20);
  assert.equal(locksForGame3.get('fiora'), 2);
  assert.equal(locksForGame3.get('shen'), 1);
});

test('el contador visual incluye el game actual cuando ya fue finalizado', () => {
  const series = createSeriesState('BO3', roles);
  completeGame(series, 1,
    ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum'],
    ['ornn', 'amumu', 'orianna', 'vayne', 'malphite']);
  assert.equal(getSeriesDisplayLocks(series, 1).size, 10);
  assert.equal(getSeriesDisplayLocks(series, 2).size, 10);
});

test('un game no se puede completar hasta registrar los diez picks', () => {
  const game = createEmptyGame(roles);
  assert.equal(canCompleteGame(game.picks, roles), false);
  game.picks = fullPicks(
    ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum'],
    ['ornn', 'amumu', 'orianna', 'vayne', 'malphite'],
  );
  assert.equal(countGamePicks(game.picks, roles), 10);
  assert.equal(canCompleteGame(game.picks, roles), true);
});

test('los games se desbloquean de forma secuencial tras finalizar el anterior', () => {
  const series = createSeriesState('BO5', roles);
  assert.equal(canAccessSeriesGame(series, 1), true);
  assert.equal(canAccessSeriesGame(series, 2), false);
  assert.equal(canAccessSeriesGame(series, 3), false);

  completeGame(series, 1,
    ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum'],
    ['ornn', 'amumu', 'orianna', 'vayne', 'malphite']);
  assert.equal(canAccessSeriesGame(series, 2), true);
  assert.equal(canAccessSeriesGame(series, 3), false);

  completeGame(series, 2,
    ['fiora', 'jarvan-iv', 'brand', 'jinx', 'nautilus'],
    ['camille', 'wukong', 'galio', 'xayah', 'rell']);
  assert.equal(canAccessSeriesGame(series, 3), true);
});

test('una nueva serie inicia limpia y libera todos los campeones usados anteriormente', () => {
  const oldSeries = createSeriesState('BO3', roles);
  completeGame(oldSeries, 1,
    ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum'],
    ['ornn', 'amumu', 'orianna', 'vayne', 'malphite']);
  const nextSeries = createSeriesState('BO3', roles);
  assert.equal(getSeriesLockedChampions(nextSeries, 1).size, 0);
  assert.equal(nextSeries.games.every(game => !game.completed), true);
});

test('normalizar una serie impide que un campeón se repita después de un game completado', () => {
  const rolesState = createSeriesState('BO3', roles);
  completeGame(rolesState, 1,
    ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum'],
    ['ornn', 'amumu', 'orianna', 'vayne', 'malphite']);
  rolesState.games[1].picks = fullPicks(
    ['shen', 'fiora', 'brand', 'jinx', 'nautilus'],
    ['camille', 'wukong', 'galio', 'xayah', 'rell'],
  );
  rolesState.activeGame = 2;
  const normalized = normalizeSeriesState(rolesState, 'BO3', roles, 'blue');
  assert.equal(normalized.games[1].picks.blue.baron, null);
  assert.equal(normalized.games[1].picks.blue.jungle, 'fiora');
  assert.equal(normalized.games[1].completed, false);
  assert.equal(normalized.activeGame, 2);
});

test('los bans son independientes por game y no forman parte del bloqueo Fearless', () => {
  const series = createSeriesState('BO3', roles);
  series.games[0].bans.blue[0] = 'teemo';
  completeGame(series, 1,
    ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum'],
    ['ornn', 'amumu', 'orianna', 'vayne', 'malphite']);
  const locksForGame2 = getSeriesLockedChampions(series, 2);
  assert.equal(locksForGame2.has('teemo'), false);
  assert.equal(series.games[1].bans.blue.every(id => id === null), true);
});


test('cada game conserva sus propios bans manuales y no hereda los del game anterior', () => {
  const series = createSeriesState('BO3', roles);
  series.games[0].bans.blue[0] = 'teemo';
  series.games[0].bans.red[0] = 'lux';
  completeGame(series, 1,
    ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum'],
    ['ornn', 'amumu', 'orianna', 'vayne', 'malphite']);

  // El Game 2 empieza con sus 10 huecos manuales vacíos; puede reutilizar
  // como ban un campeón vetado en G1, siempre que no haya sido elegido.
  assert.equal(countGameBans(series.games[1]), 0);
  series.games[1].bans.blue[1] = 'teemo';
  series.games[1].bans.red[2] = 'lux';
  series.activeGame = 2;

  const restored = normalizeSeriesState(series, 'BO3', roles, 'blue');
  assert.deepEqual(restored.games[0].bans.blue[0], 'teemo');
  assert.deepEqual(restored.games[0].bans.red[0], 'lux');
  assert.deepEqual(restored.games[1].bans.blue, [null, 'teemo', null, null, null]);
  assert.deepEqual(restored.games[1].bans.red, [null, null, 'lux', null, null]);
  assert.equal(countGameBans(restored.games[1]), 2);
  assert.equal(getSeriesLockedChampions(restored, 2).has('teemo'), false);
  assert.equal(getSeriesLockedChampions(restored, 2).has('lux'), false);
});


test('los picks previos aparecen como bloqueos Fearless, pero los bans manuales no se comparten', () => {
  const series = createSeriesState('BO5', roles);
  series.games[0].bans.blue[0] = 'teemo';
  completeGame(series, 1,
    ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum'],
    ['ornn', 'amumu', 'orianna', 'vayne', 'malphite']);
  const locks = getSeriesDisplayLocks(series, 2);
  assert.equal(locks.size, 10);
  assert.equal(locks.has('shen'), true);
  assert.equal(locks.has('teemo'), false);
  assert.equal(countGameBans(series.games[1]), 0);
});


test('guardar y cerrar un game conserva sus bans únicamente en esa partida y bloquea sus diez picks', () => {
  const series = createSeriesState('BO3', roles);
  const game1 = {
    side: 'blue',
    picks: fullPicks(
      ['shen', 'lee-sin', 'hwei', 'kog-maw', 'braum'],
      ['ornn', 'amumu', 'orianna', 'vayne', 'malphite'],
    ),
    bans: { blue: ['teemo', 'lux', null, null, null], red: ['akali', null, null, null, null] },
    slotRoles: { blue: roles, red: roles },
  };
  assert.equal(saveSeriesGameSnapshot(series, 1, game1, roles), true);
  assert.equal(countGameBans(series.games[0]), 3);
  assert.equal(countGameBans(series.games[1]), 0);
  assert.equal(completeSeriesGame(series, 1, game1, roles, '2026-11-03T18:00:00.000Z'), true);
  assert.equal(series.games[0].completed, true);
  assert.equal(series.games[1].bans.blue.every(id => id === null), true);
  assert.equal(getSeriesLockedChampions(series, 2).size, 10);

  // Teemo/Lux/Akali were only manual bans in G1, not Fearless picks: G2 may ban them again.
  const game2 = {
    side: 'blue', picks: fullPicks(
      ['fiora', 'jarvan-iv', 'brand', 'jinx', 'nautilus'],
      ['camille', 'wukong', 'galio', 'xayah', 'rell'],
    ),
    bans: { blue: ['teemo', null, null, null, null], red: ['lux', 'akali', null, null, null] },
    slotRoles: { blue: roles, red: roles },
  };
  assert.equal(saveSeriesGameSnapshot(series, 2, game2, roles), true);
  assert.equal(countGameBans(series.games[0]), 3);
  assert.equal(countGameBans(series.games[1]), 3);
  assert.equal(series.games[1].bans.blue[0], 'teemo');
  assert.equal(getSeriesLockedChampions(series, 2).has('teemo'), false);
  assert.equal(getSeriesLockedChampions(series, 3).size, 10);
});

test('no se puede cerrar un game si faltan picks y no se modifica su estado', () => {
  const series = createSeriesState('BO3', roles);
  const partial = { side: 'blue', picks: fullPicks(['shen', 'lee-sin', 'hwei', 'kog-maw', null], ['ornn', 'amumu', 'orianna', 'vayne', 'malphite']), bans: { blue: ['teemo'], red: [] }, slotRoles: { blue: roles, red: roles } };
  assert.equal(completeSeriesGame(series, 1, partial, roles), false);
  assert.equal(series.games[0].completed, false);
  assert.equal(countGameBans(series.games[0]), 0);
});
