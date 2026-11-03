export const FORMAT_GAME_COUNTS = Object.freeze({ BO1: 1, BO3: 3, BO5: 5 });

export function gameCountForFormat(format) {
  return FORMAT_GAME_COUNTS[format] || FORMAT_GAME_COUNTS.BO3;
}

export function createEmptyGame(roleIds, side = 'blue') {
  const emptyTeam = () => Object.fromEntries(roleIds.map(role => [role, null]));
  return {
    side: side === 'red' ? 'red' : 'blue',
    picks: { blue: emptyTeam(), red: emptyTeam() },
    bans: { blue: Array(5).fill(null), red: Array(5).fill(null) },
    slotRoles: { blue: [...roleIds], red: [...roleIds] },
    completed: false,
    completedAt: null,
  };
}

export function createSeriesState(format, roleIds, side = 'blue', firstGame = null) {
  const count = gameCountForFormat(format);
  const games = Array.from({ length: count }, () => createEmptyGame(roleIds, side));
  if (firstGame) games[0] = cloneGame(firstGame, roleIds, side);
  return { format: FORMAT_GAME_COUNTS[format] ? format : 'BO3', activeGame: 1, games, startedAt: new Date().toISOString() };
}

export function cloneGame(game, roleIds, fallbackSide = 'blue') {
  const blank = createEmptyGame(roleIds, fallbackSide);
  const next = { ...blank, ...(game || {}) };
  next.side = next.side === 'red' ? 'red' : 'blue';
  next.picks = { blue: { ...blank.picks.blue, ...(game?.picks?.blue || {}) }, red: { ...blank.picks.red, ...(game?.picks?.red || {}) } };
  next.bans = {
    blue: Array.from({ length: 5 }, (_, index) => game?.bans?.blue?.[index] || null),
    red: Array.from({ length: 5 }, (_, index) => game?.bans?.red?.[index] || null),
  };
  for (const team of ['blue', 'red']) {
    const roles = game?.slotRoles?.[team];
    if (Array.isArray(roles) && roles.length === roleIds.length && roles.every(role => roleIds.includes(role)) && new Set(roles).size === roleIds.length) {
      next.slotRoles[team] = [...roles];
    }
  }
  next.completed = Boolean(game?.completed);
  next.completedAt = typeof game?.completedAt === 'string' ? game.completedAt : null;
  return next;
}

export function normalizeSeriesState(raw, format, roleIds, side = 'blue', fallbackGame = null) {
  const normalizedFormat = FORMAT_GAME_COUNTS[format] ? format : 'BO3';
  const count = gameCountForFormat(normalizedFormat);
  if (!raw || !Array.isArray(raw.games)) return createSeriesState(normalizedFormat, roleIds, side, fallbackGame);
  const games = Array.from({ length: count }, (_, index) => cloneGame(raw.games[index], roleIds, side));
  // Enforce Fearless integrity even when restoring a backup or loading malformed cloud state.
  const fearlessUsed = new Set();
  let previousGameCompleted = true;
  for (let index = 0; index < games.length; index += 1) {
    const game = games[index];
    if (!previousGameCompleted) {
      games[index] = createEmptyGame(roleIds, side);
      continue;
    }
    const pickedThisGame = new Set();
    for (const team of ['blue', 'red']) {
      for (const role of roleIds) {
        const championId = game.picks?.[team]?.[role];
        if (!championId || fearlessUsed.has(championId) || pickedThisGame.has(championId)) game.picks[team][role] = null;
        else pickedThisGame.add(championId);
      }
    }
    const bannedThisGame = new Set();
    for (const team of ['blue', 'red']) {
      game.bans[team] = game.bans[team].map(championId => {
        if (!championId || fearlessUsed.has(championId) || pickedThisGame.has(championId) || bannedThisGame.has(championId)) return null;
        bannedThisGame.add(championId);
        return championId;
      });
    }
    if (game.completed && !canCompleteGame(game.picks, roleIds)) {
      game.completed = false;
      game.completedAt = null;
    }
    if (game.completed) {
      for (const championId of pickedThisGame) fearlessUsed.add(championId);
    } else {
      previousGameCompleted = false;
    }
  }
  const requestedActive = Number.isInteger(raw.activeGame) ? raw.activeGame : 1;
  const activeGame = Math.max(1, Math.min(count, requestedActive));
  // A later game cannot be opened until every preceding game is completed.
  let accessibleGame = 1;
  for (let index = 1; index < count; index += 1) {
    if (!games[index - 1].completed) break;
    accessibleGame = index + 1;
  }
  return {
    format: normalizedFormat,
    activeGame: Math.min(activeGame, accessibleGame),
    games,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : new Date().toISOString(),
  };
}

export function getSeriesLockedChampions(series, activeGame = series?.activeGame || 1) {
  const locked = new Map();
  const games = Array.isArray(series?.games) ? series.games : [];
  for (let index = 0; index < Math.max(0, activeGame - 1); index += 1) {
    const game = games[index];
    if (!game?.completed) continue;
    for (const team of ['blue', 'red']) {
      for (const championId of Object.values(game.picks?.[team] || {})) {
        if (championId && !locked.has(championId)) locked.set(championId, index + 1);
      }
    }
  }
  return locked;
}

export function getSeriesDisplayLocks(series, activeGame = series?.activeGame || 1) {
  const locked = new Map();
  const games = Array.isArray(series?.games) ? series.games : [];
  const current = games[activeGame - 1];
  const end = current?.completed ? activeGame : activeGame - 1;
  for (let index = 0; index < end; index += 1) {
    const game = games[index];
    if (!game?.completed) continue;
    for (const team of ['blue', 'red']) {
      for (const championId of Object.values(game.picks?.[team] || {})) {
        if (championId && !locked.has(championId)) locked.set(championId, index + 1);
      }
    }
  }
  return locked;
}

export function canAccessSeriesGame(series, gameNumber) {
  if (!series || gameNumber < 1 || gameNumber > series.games.length) return false;
  for (let index = 0; index < gameNumber - 1; index += 1) {
    if (!series.games[index]?.completed) return false;
  }
  return true;
}

export function isGameComplete(game) {
  return Boolean(game?.completed);
}

export function canCompleteGame(picks, roleIds) {
  return ['blue', 'red'].every(team => roleIds.every(role => Boolean(picks?.[team]?.[role])));
}

export function countGamePicks(picks, roleIds) {
  return ['blue', 'red'].reduce((sum, team) => sum + roleIds.filter(role => Boolean(picks?.[team]?.[role])).length, 0);
}
