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
