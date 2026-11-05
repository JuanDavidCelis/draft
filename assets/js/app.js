import { CHAMPIONS, ROLES, ROLE_POOLS, TEMPLATES, SYNERGIES, COUNTERS } from './catalog.js';
import { getNextSidePick, getLastSidePick, compareCompositions, scoreCandidateForDraft } from './draft-intel.js';
import { createSeriesState, normalizeSeriesState, getSeriesLockedChampions, getSeriesDisplayLocks, canAccessSeriesGame, canCompleteGame, countGamePicks, countGameBans, saveSeriesGameSnapshot, completeSeriesGame } from './series.js';

const STORAGE_KEY = 'voidkings-draft-lab-cache-v3';
const LEGACY_STORAGE_KEYS = ['vhaeldron-draft-lab-cache-v2', 'vhaeldron-draft-lab-v1'];
const EMPTY_TEAM = () => Object.fromEntries(ROLES.map(role => [role.id, null]));
const PICK_TURNS = { blue: [1, 4, 5, 8, 9], red: [2, 3, 6, 7, 10] };
const DEFAULT_SLOT_ROLES = ['baron', 'jungle', 'mid', 'adc', 'support'];
const cloneDefaultPool = () => Object.fromEntries(Object.entries(ROLE_POOLS).map(([role, entries]) => [role, entries.map(entry => ({ ...entry }))]));
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const championById = new Map(CHAMPIONS.map(champion => [champion.id, champion]));
const synergyMap = new Map(SYNERGIES.map(([a, b, weight]) => [`${a}|${b}`, weight]));
const counterMap = new Map(COUNTERS.map(([a, b, weight]) => [`${a}|${b}`, weight]));
const DDRAGON_VERSION = '16.21.1';
const DDRAGON_KEYS = {
  'aurelion-sol':'AurelionSol','cho-gath':'Chogath','dr-mundo':'DrMundo','jarvan-iv':'JarvanIV',
  'kai-sa':'Kaisa','k-sante':'KSante','kha-zix':'Khazix','kog-maw':'KogMaw','lee-sin':'LeeSin',
  'leblanc':'Leblanc','renata-glasc':'Renata','rek-sai':'RekSai','bel-veth':'Belveth',
  'maestro-yi':'MasterYi','miss-fortune':'MissFortune','nunu-y-willump':'Nunu','nunu':'Nunu',
  'twisted-fate':'TwistedFate','vel-koz':'Velkoz','xin-zhao':'XinZhao','wukong':'MonkeyKing',
  'monkey-king':'MonkeyKing','mel':'Mel','ambessa':'Ambessa','smolder':'Smolder'
};
const PATCH_73D_CONTEXT = {
  'lee-sin': { kind: 'buff', label: 'MEJORA 7.3d', weight: 0.8 },
  'akali': { kind: 'buff', label: 'MEJORA 7.3d', weight: 0.6 },
  'shyvana': { kind: 'buff', label: 'MEJORA 7.3d', weight: 0.5 },
  'camille': { kind: 'buff', label: 'MEJORA 7.3d', weight: 0.4 },
  'miss-fortune': { kind: 'buff', label: 'MEJORA 7.3d', weight: 0.4 },
  'nasus': { kind: 'buff', label: 'MEJORA 7.3d', weight: 0.3 },
  'malphite': { kind: 'nerf', label: 'AJUSTE 7.3d', weight: -0.25 },
  'ashe': { kind: 'nerf', label: 'AJUSTE 7.3d', weight: -0.25 },
  'samira': { kind: 'nerf', label: 'AJUSTE 7.3d', weight: -0.2 },
  'ekko': { kind: 'nerf', label: 'AJUSTE 7.3d', weight: -0.15 },
  'singed': { kind: 'nerf', label: 'AJUSTE 7.3d', weight: -0.2 }
};

function ddragonKey(champion) {
  if (!champion) return null;
  if (DDRAGON_KEYS[champion.id]) return DDRAGON_KEYS[champion.id];
  const key = champion.name.replace(/[^a-zA-Z0-9]/g, '');
  return key || null;
}

function championAvatar(champion, size = 'normal') {
  const key = ddragonKey(champion);
  const alt = escapeHtml(champion?.name || 'Campeón');
  const initialsText = escapeHtml(initials(champion?.name || '?'));
  const image = key ? `<img class="champion-portrait" src="https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${encodeURIComponent(key)}.png" alt="${alt}" loading="lazy" decoding="async">` : '';
  return `<span class="champion-avatar ${size}" aria-label="${alt}">${image}<span class="champion-fallback">${initialsText}</span></span>`;
}

function bindChampionImages(root = document) {
  root.querySelectorAll('img.champion-portrait:not([data-fallback-bound])').forEach(image => {
    image.dataset.fallbackBound = '1';
    image.addEventListener('error', () => image.closest('.champion-avatar')?.classList.add('image-missing'), { once: true });
  });
}


function emptyCurrentGame(side = 'blue') {
  return {
    side: side === 'red' ? 'red' : 'blue',
    picks: { blue: EMPTY_TEAM(), red: EMPTY_TEAM() },
    bans: { blue: Array(5).fill(null), red: Array(5).fill(null) },
    slotRoles: { blue: [...DEFAULT_SLOT_ROLES], red: [...DEFAULT_SLOT_ROLES] },
    completed: false,
    completedAt: null,
  };
}

function cloneCurrentGame() {
  const active = state.series?.games?.[state.series.activeGame - 1];
  return {
    side: state.side,
    picks: { blue: { ...state.picks.blue }, red: { ...state.picks.red } },
    bans: { blue: [...state.bans.blue], red: [...state.bans.red] },
    slotRoles: { blue: [...state.slotRoles.blue], red: [...state.slotRoles.red] },
    completed: Boolean(active?.completed),
    completedAt: active?.completedAt || null,
  };
}

function sanitizeSeries(raw, format, side, fallbackGame) {
  const roleIds = ROLES.map(role => role.id);
  const series = normalizeSeriesState(raw, format, roleIds, side, fallbackGame);
  const fearlessUsed = new Set();
  let previousGameCompleted = true;
  for (let index = 0; index < series.games.length; index += 1) {
    const game = series.games[index];
    if (!previousGameCompleted) {
      series.games[index] = createEmptySeriesGame(side);
      continue;
    }
    const picked = new Set();
    for (const team of ['blue', 'red']) {
      for (const role of roleIds) {
        const id = game.picks?.[team]?.[role];
        if (!id || !championById.has(id) || picked.has(id) || fearlessUsed.has(id)) game.picks[team][role] = null;
        else picked.add(id);
      }
    }
    const banned = new Set();
    for (const team of ['blue', 'red']) {
      game.bans[team] = game.bans[team].map(id => {
        if (!id || !championById.has(id) || picked.has(id) || banned.has(id) || fearlessUsed.has(id)) return null;
        banned.add(id);
        return id;
      });
    }
    if (game.completed && !canCompleteGame(game.picks, roleIds)) {
      game.completed = false;
      game.completedAt = null;
    }
    if (game.completed) {
      for (const id of picked) fearlessUsed.add(id);
    } else {
      previousGameCompleted = false;
    }
  }
  let accessibleGame = 1;
  for (let index = 1; index < series.games.length; index += 1) {
    if (!series.games[index - 1].completed) break;
    accessibleGame = index + 1;
  }
  series.activeGame = Math.min(series.activeGame, accessibleGame);
  return series;
}

function createEmptySeriesGame(side = 'blue') {
  return {
    side: side === 'red' ? 'red' : 'blue',
    picks: { blue: EMPTY_TEAM(), red: EMPTY_TEAM() },
    bans: { blue: Array(5).fill(null), red: Array(5).fill(null) },
    slotRoles: { blue: [...DEFAULT_SLOT_ROLES], red: [...DEFAULT_SLOT_ROLES] },
    completed: false,
    completedAt: null,
  };
}

function loadGameIntoState(game) {
  state.side = game.side === 'red' ? 'red' : 'blue';
  state.picks = { blue: { ...EMPTY_TEAM(), ...(game.picks?.blue || {}) }, red: { ...EMPTY_TEAM(), ...(game.picks?.red || {}) } };
  state.bans = {
    blue: Array.from({ length: 5 }, (_, index) => game.bans?.blue?.[index] || null),
    red: Array.from({ length: 5 }, (_, index) => game.bans?.red?.[index] || null),
  };
  state.slotRoles = { blue: [...DEFAULT_SLOT_ROLES], red: [...DEFAULT_SLOT_ROLES] };
  for (const team of ['blue', 'red']) {
    const roles = game.slotRoles?.[team];
    if (Array.isArray(roles) && roles.length === ROLES.length && roles.every(role => ROLES.some(item => item.id === role)) && new Set(roles).size === ROLES.length) state.slotRoles[team] = [...roles];
  }
}

function initialState() {
  const state = {
    side: 'blue', format: 'BO3',
    picks: { blue: EMPTY_TEAM(), red: EMPTY_TEAM() },
    bans: { blue: Array(5).fill(null), red: Array(5).fill(null) },
    slotRoles: { blue: [...DEFAULT_SLOT_ROLES], red: [...DEFAULT_SLOT_ROLES] },
    pool: cloneDefaultPool(),
    customTemplates: [],
  };
  state.series = createSeriesState(state.format, ROLES.map(role => role.id), state.side, emptyCurrentGame());
  return state;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return initialState();
    const base = initialState();
    base.side = saved.side === 'red' ? 'red' : 'blue';
    base.format = ['BO1', 'BO3', 'BO5'].includes(saved.format) ? saved.format : 'BO3';
    for (const team of ['blue', 'red']) {
      base.picks[team] = { ...base.picks[team], ...(saved.picks?.[team] || {}) };
      base.bans[team] = Array.from({ length: 5 }, (_, i) => saved.bans?.[team]?.[i] || null);
      const roles = saved.slotRoles?.[team];
      if (Array.isArray(roles) && roles.length === 5 && roles.every(role => ROLES.some(item => item.id === role)) && new Set(roles).size === 5) base.slotRoles[team] = [...roles];
    }
    if (saved.pool && typeof saved.pool === 'object') {
      for (const role of ROLES) {
        const entries = saved.pool[role.id];
        if (Array.isArray(entries)) {
          const valid = entries.filter(entry => entry && championById.has(entry.champion) && ['CORE','ALT 1','ALT 2','SITUACIONAL'].includes(entry.tier));
          base.pool[role.id] = valid;
        }
      }
    }
    base.customTemplates = Array.isArray(saved.customTemplates) ? saved.customTemplates.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && item.picks && ROLES.every(role => championById.has(item.picks[role.id]))).slice(0, 100) : [];

    const legacyGame = {
      side: base.side,
      picks: { blue: { ...base.picks.blue }, red: { ...base.picks.red } },
      bans: { blue: [...base.bans.blue], red: [...base.bans.red] },
      slotRoles: { blue: [...base.slotRoles.blue], red: [...base.slotRoles.red] },
      completed: false,
      completedAt: null,
    };
    base.series = sanitizeSeries(saved.series, base.format, base.side, legacyGame);
    if (saved.series?.games?.length) {
      const active = base.series.games[base.series.activeGame - 1];
      base.side = active.side;
      base.picks = { blue: { ...active.picks.blue }, red: { ...active.picks.red } };
      base.bans = { blue: [...active.bans.blue], red: [...active.bans.red] };
      base.slotRoles = { blue: [...active.slotRoles.blue], red: [...active.slotRoles.red] };
    } else {
      base.series.games[0] = legacyGame;
    }
    return base;
  } catch {
    return initialState();
  }
}

function syncActiveGameToSeries() {
  if (!state.series?.games?.length) return;
  saveSeriesGameSnapshot(state.series, state.series.activeGame, cloneCurrentGame(), ROLES.map(role => role.id));
}

function currentGameIsCompleted() {
  return Boolean(state.series?.games?.[state.series.activeGame - 1]?.completed);
}

function seriesLockedMap() {
  return getSeriesLockedChampions(state.series, state.series?.activeGame || 1);
}

function startNewSeries(format = state.format) {
  state.format = format;
  state.series = createSeriesState(format, ROLES.map(role => role.id), state.side, emptyCurrentGame(state.side));
  state.picks = { blue: EMPTY_TEAM(), red: EMPTY_TEAM() };
  state.bans = { blue: Array(5).fill(null), red: Array(5).fill(null) };
  state.slotRoles = { blue: [...DEFAULT_SLOT_ROLES], red: [...DEFAULT_SLOT_ROLES] };
}

function closeCurrentGame({ announce = false } = {}) {
  const game = state.series.games[state.series.activeGame - 1];
  if (game?.completed) return true;
  const completed = completeSeriesGame(
    state.series,
    state.series.activeGame,
    cloneCurrentGame(),
    ROLES.map(role => role.id),
  );
  if (!completed) return false;
  if (announce) notify(`Game ${state.series.activeGame} cerrado: sus 10 picks quedan bloqueados por Fearless para el resto de la serie.`);
  return true;
}

function switchSeriesGame(gameNumber) {
  const currentNumber = state.series.activeGame;
  const nextNumber = currentNumber + 1;
  // Conveniencia de torneo: si los 10 picks están cargados, entrar al siguiente
  // game cierra automáticamente el actual y activa los bloqueos Fearless.
  if (gameNumber === nextNumber && !currentGameIsCompleted()) {
    if (!closeCurrentGame()) return notify('Para pasar al siguiente game registra los 5 picks de ambos equipos (10/10).');
  } else {
    syncActiveGameToSeries();
  }
  if (!canAccessSeriesGame(state.series, gameNumber)) return notify('Finaliza el game anterior para desbloquear esta partida.');
  state.series.activeGame = gameNumber;
  loadGameIntoState(state.series.games[gameNumber - 1]);
  renderDraft();
  notify(`Game ${gameNumber} cargado. Los bans manuales son propios de este game y los picks anteriores están bloqueados.`);
}

function finishCurrentGame() {
  if (currentGameIsCompleted()) return;
  if (!closeCurrentGame()) return notify('Para finalizar el game debes registrar los cinco picks de ambos equipos (10/10).');
  renderDraft();
  const next = state.series.activeGame + 1;
  if (next <= state.series.games.length) notify(`Game ${state.series.activeGame} finalizado. Los 10 picks quedan bloqueados. Puedes abrir Game ${next}.`);
  else notify('Serie finalizada. Inicia una nueva serie para limpiar los bloqueos Fearless.');
}

let state = loadState();
let cloudReady = false;
let cloudEtag = null;
let cloudSaveTimer = null;
let cloudSaveQueue = Promise.resolve();
let cloudSaveRevision = 0;
let cloudConflict = false;
let eventsBound = false;
let pickerTarget = null;
let pickerFilter = 'role';
let currentPoolRole = 'all';
let toastTimer = null;

function setCloudStatus(label, tone = 'ok') {
  const element = $('#cloud-status');
  if (!element) return;
  element.classList.toggle('sync-error', tone === 'error');
  element.classList.toggle('sync-saving', tone === 'saving');
  element.innerHTML = `<i></i> ${escapeHtml(label)}`;
}

function saveState() {
  syncActiveGameToSeries();
  const snapshot = JSON.stringify(state);
  try {
    localStorage.setItem(STORAGE_KEY, snapshot);
  } catch (error) {
    console.warn('[VoidKings Draft Lab] No se pudo actualizar la caché local:', error);
  }
  if (!cloudReady || cloudConflict) return;

  const revision = ++cloudSaveRevision;
  clearTimeout(cloudSaveTimer);
  setCloudStatus('GUARDANDO EN VERCEL', 'saving');
  cloudSaveTimer = setTimeout(() => {
    cloudSaveQueue = cloudSaveQueue
      .then(async () => {
        if (!cloudReady || cloudConflict) return;
        const response = await fetch('/api/state', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: JSON.parse(snapshot), etag: cloudEtag }),
        });
        const result = await response.json().catch(() => ({}));
        if (response.status === 401 || result.code === 'UNAUTHENTICATED') {
          cloudReady = false;
          setAuthenticatedView(false);
          showAuthMessage('Tu sesión expiró. Inicia sesión nuevamente.', 'error');
          return;
        }
        if (response.status === 409 || result.code === 'STATE_CONFLICT') {
          cloudConflict = true;
          setCloudStatus('CONFLICTO · RECARGA', 'error');
          notify('Los datos cambiaron en otra sesión. Recarga para evitar sobrescribirlos.');
          return;
        }
        if (!response.ok) throw new Error(result.error || 'No se pudo guardar en Vercel.');
        cloudEtag = result.etag || cloudEtag;
        if (revision === cloudSaveRevision) setCloudStatus('GUARDADO EN VERCEL');
      })
      .catch(error => {
        console.error('[VoidKings Draft Lab] Error de sincronización:', error);
        setCloudStatus('ERROR DE SINCRONIZACIÓN', 'error');
      });
  }, 450);
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: { ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Error HTTP ${response.status}`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

function showAuthMessage(message, tone = 'neutral') {
  const element = $('#auth-message');
  element.textContent = message;
  element.classList.toggle('error', tone === 'error');
  element.classList.toggle('success', tone === 'success');
}

function setAuthenticatedView(isAuthenticated) {
  document.body.classList.toggle('auth-locked', !isAuthenticated);
  $('#auth-gate').hidden = isAuthenticated;
  if (isAuthenticated) $('#access-password').value = '';
}

function readCachedState() {
  try {
    const cached = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map(key => localStorage.getItem(key)).find(Boolean);
    return cached ? validImportedState(JSON.parse(cached)) : initialState();
  } catch {
    return initialState();
  }
}

async function openWorkspace() {
  setCloudStatus('CARGANDO VERCEL', 'saving');
  const remote = await apiRequest('/api/state');
  if (remote.state) {
    state = validImportedState(remote.state);
    cloudEtag = remote.etag;
  } else {
    // One-time migration: carry the previous browser draft to Vercel if it exists.
    state = readCachedState();
    const created = await apiRequest('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, etag: null }),
    });
    cloudEtag = created.etag;
  }

  cloudReady = true;
  cloudConflict = false;
  setAuthenticatedView(true);
  if (!eventsBound) { bindEvents(); eventsBound = true; }
  renderDraft();
  renderPool();
  renderTemplates();
  setCloudStatus('CONECTADO · VERCEL');
}

async function checkSession() {
  try {
    const session = await apiRequest('/api/auth/session');
    if (session.authenticated) {
      await openWorkspace();
    } else {
      setAuthenticatedView(false);
      showAuthMessage('Introduce la contraseña privada para acceder.');
    }
  } catch (error) {
    setAuthenticatedView(false);
    if (error.code === 'AUTH_NOT_CONFIGURED') {
      showAuthMessage('Falta configurar APP_PASSWORD y SESSION_SECRET en los ajustes de Vercel.', 'error');
    } else {
      showAuthMessage(error.message || 'No fue posible conectar con Vercel.', 'error');
    }
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const button = $('#login-submit');
  const password = $('#access-password').value;
  button.disabled = true;
  button.textContent = 'Verificando…';
  showAuthMessage('Comprobando acceso privado…');
  try {
    await apiRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    await openWorkspace();
  } catch (error) {
    showAuthMessage(error.message || 'No se pudo iniciar sesión.', 'error');
    $('#access-password').focus();
  } finally {
    button.disabled = false;
    button.innerHTML = 'Entrar al Draft Lab <span>→</span>';
  }
}

async function handleLogout() {
  if (!confirm('¿Cerrar la sesión privada de VOIDKINGS DRAFT LAB?')) return;
  try { await apiRequest('/api/auth/logout', { method: 'POST' }); } catch (error) { console.warn(error); }
  cloudReady = false;
  cloudConflict = false;
  setAuthenticatedView(false);
  showAuthMessage('Sesión cerrada. Tus datos permanecen guardados en Vercel.');
}


function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function getChampion(id) { return id ? championById.get(id) : null; }
function championName(id) { return getChampion(id)?.name || 'Sin seleccionar'; }
function teamIds(team) { return Object.values(state.picks[team]).filter(Boolean); }
function allPickIds() { return [...teamIds('blue'), ...teamIds('red')]; }
function allBanIds() { return [...state.bans.blue, ...state.bans.red].filter(Boolean); }
function ownTeam() { return state.side; }
function enemyTeam() { return state.side === 'blue' ? 'red' : 'blue'; }
function roleLabel(roleId) { return ROLES.find(role => role.id === roleId)?.label || roleId.toUpperCase(); }
function initials(name) { return name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(); }
function tierClass(tier) { return tier === 'CORE' ? 'core' : tier.startsWith('ALT') ? 'alt' : 'situational'; }
function tierLabel(tier) { return tier === 'CORE' ? 'CORE' : tier; }
function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function setView(view) {
  $$('.view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#view-breadcrumb').textContent = ({ draft: 'SALA DE DRAFT', pool: 'CHAMPION POOL', library: 'COMPOSICIONES' })[view] || 'WORKSPACE';
  if (view === 'pool') renderPool();
  if (view === 'library') renderTemplates();
}

function renderSeriesControls() {
  const gameNumber = state.series.activeGame;
  const gameCount = state.series.games.length;
  const current = state.series.games[gameNumber - 1];
  const roleIds = ROLES.map(role => role.id);
  const currentPicks = countGamePicks(state.picks, roleIds);
  const readyToClose = currentPicks === 10 && !current.completed;
  const displayLocks = getSeriesDisplayLocks(state.series, gameNumber);
  $('#series-title').textContent = `${state.format} · GAME ${gameNumber} DE ${gameCount}`;
  $('#series-lock-count').textContent = `${displayLocks.size} CAMPEONES BLOQUEADOS`;
  $('#series-games').innerHTML = state.series.games.map((game, index) => {
    const number = index + 1;
    const nextCanAutoClose = number === gameNumber + 1 && readyToClose;
    const accessible = canAccessSeriesGame(state.series, number) || nextCanAutoClose;
    const picks = countGamePicks(game.picks, roleIds);
    const bans = countGameBans(game);
    const status = game.completed ? `CERRADO · ${picks}/10 PICKS · ${bans}/10 BANS` : number === gameNumber ? `${picks}/10 PICKS · ${bans}/10 BANS` : nextCanAutoClose ? 'LISTO · CERRAR AL ENTRAR' : accessible ? `${picks}/10 PICKS · ${bans}/10 BANS` : 'ESPERANDO GAME ANTERIOR';
    return `<button class="series-game-tab ${number === gameNumber ? 'active' : ''} ${game.completed ? 'completed' : ''}" type="button" role="tab" aria-selected="${number === gameNumber}" data-series-game="${number}" ${accessible ? '' : 'disabled'}><strong>GAME ${number}</strong><small>${status}</small></button>`;
  }).join('');
  const finishButton = $('#finish-game-btn');
  finishButton.disabled = current.completed || !readyToClose;
  finishButton.textContent = current.completed ? '✓ GAME CERRADO' : 'Finalizar y bloquear picks';
  finishButton.title = current.completed ? 'Este game ya bloqueó sus picks para el resto de la serie.' : 'Al finalizar, los 10 campeones seleccionados no podrán repetirse en los siguientes games.';
  $('#next-game-btn').hidden = !(gameNumber < gameCount && (current.completed || readyToClose));
  $('#next-game-btn').disabled = false;
  $('#next-game-btn').textContent = current.completed ? `Ir a Game ${gameNumber + 1} →` : `Cerrar y abrir Game ${gameNumber + 1} →`;
  $('#series-locks').innerHTML = displayLocks.size
    ? `<div class="series-lock-copy"><strong>${current.completed ? 'FEARLESS · BLOQUEADOS PARA EL RESTO DE LA SERIE' : 'FEARLESS · PICKS DE GAMES ANTERIORES'}</strong><small>Estos campeones no pueden seleccionarse ni banearse de nuevo en la fase manual durante los games restantes.</small></div><div class="series-lock-chips">${[...displayLocks.entries()].map(([id, game]) => `<span class="series-lock-chip">${championAvatar(getChampion(id),'tiny')}<b>${escapeHtml(championName(id))}</b><small>G${game}</small></span>`).join('')}</div>`
    : `<div class="series-lock-copy"><strong>${current.completed ? 'GAME CERRADO · BLOQUEOS ACTIVOS PARA EL SIGUIENTE' : 'SIN BLOQUEOS FEARLESS TODAVÍA'}</strong><small>${current.completed ? 'Los diez picks de este game se bloquearán al abrir el siguiente.' : `Registra 10/10 picks y finaliza el Game ${gameNumber}. Si abres el siguiente game con los diez picks completos, el cierre será automático.`}</small></div>`;
  bindChampionImages($('#series-locks'));
}

function renderSetup() {
  $$('#side-switch button').forEach(button => {
    button.classList.toggle('selected', button.dataset.side === state.side);
    button.classList.toggle('blue-select', button.dataset.side === 'blue' && state.side === 'blue');
  });
  $('#format-select').value = state.format;
  $('#pick-count').textContent = `${allPickIds().length}/10`;
  renderSeriesControls();
}

function renderBans() {
  const gameNumber = state.series.activeGame;
  const gameLabel = $('#ban-game-label');
  if (gameLabel) gameLabel.textContent = `GAME ${gameNumber}`;
  const currentBanCount = $('#game-ban-count');
  if (currentBanCount) currentBanCount.textContent = `${allBanIds().length}/10 BANS REGISTRADOS EN GAME ${gameNumber}`;
  const fearlessStrip = $('#fearless-ban-strip');
  if (fearlessStrip) {
    // En la fase de bans solo mostramos picks bloqueados de games anteriores;
    // los picks del game actual se bloquean a partir del siguiente game.
    const locks = seriesLockedMap();
    fearlessStrip.hidden = locks.size === 0;
    fearlessStrip.innerHTML = locks.size
      ? `<div class="fearless-strip-heading"><strong>FEARLESS LOCKS · GAME ${gameNumber}</strong><span>${locks.size} campeones retirados por picks de games anteriores</span></div><div class="fearless-strip-chips">${[...locks.entries()].map(([id, game]) => `<span class="fearless-ban-chip">${championAvatar(getChampion(id),'tiny')}<b>${escapeHtml(championName(id))}</b><small>G${game}</small></span>`).join('')}</div>`
      : '';
    bindChampionImages(fearlessStrip);
  }
  for (const team of ['blue', 'red']) {
    const isOurSide = team === ownTeam();
    $(`#${team}-ban-name`).textContent = isOurSide ? 'VK SinADC' : 'RIVAL';
    $(`#${team}-ban-label`).textContent = `${team.toUpperCase()} SIDE`;
    const banSide = $(`#${team}-bans`).closest('.ban-side');
    banSide.querySelector('.side-title .side-symbol').textContent = '◆';
    const container = $(`#${team}-bans`);
    container.innerHTML = state.bans[team].map((id, index) => {
      const champion = getChampion(id);
      return `<button class="ban-slot ${champion ? 'filled' : ''}" data-ban-slot="${team}" data-index="${index}" ${currentGameIsCompleted() ? 'disabled' : ''} title="${champion ? `Quitar veto: ${escapeHtml(champion.name)}` : 'Añadir veto'}">${champion ? `${championAvatar(champion,'ban')}<span class="ban-x">×</span>` : '＋'}</button>`;
    }).join('');
    bindChampionImages(container);
  }
}

function renderPicks() {
  for (const team of ['blue', 'red']) {
    const isOurSide = team === ownTeam();
    $(`#${team}-team-name`).textContent = isOurSide ? 'VK SinADC' : 'OPPONENT';
    $(`#${team}-team-label`).textContent = `${team.toUpperCase()} SIDE`;
    const container = $(`#${team}-picks`);
    container.innerHTML = state.slotRoles[team].map((roleId, index) => {
      const id = state.picks[team][roleId];
      const champion = getChampion(id);
      const turn = PICK_TURNS[team][index];
      const roleOptions = ROLES.map(role => `<option value="${role.id}" ${role.id === roleId ? 'selected' : ''}>${role.label}</option>`).join('');
      const avatarMarkup = champion ? championAvatar(champion, 'board') : '<span class="champion-avatar board empty-avatar">＋</span>';
      const copyMarkup = `<span class="pick-copy"><strong>${champion ? escapeHtml(champion.name) : '＋ Añadir campeón'}</strong><small>${champion ? `${escapeHtml(champion.tags.slice(0, 2).join(' · ') || roleLabel(roleId))}` : `PICK ${turn} · ${roleLabel(roleId)}`}</small></span>`;
      const actionMarkup = champion ? '<span class="remove-pick" title="Quitar selección">×</span>' : '<span class="pick-add-mark">＋</span>';
      // Mirror the two teams around VS: blue portrait faces inward from the left;
      // red portrait sits on the outer right edge, with the champion name centered.
      const slotContent = team === 'red'
        ? `${actionMarkup}${copyMarkup}${avatarMarkup}`
        : `${avatarMarkup}${copyMarkup}${actionMarkup}`;
      return `<div class="pick-entry">
        <span class="pick-order-badge">${turn}</span>
        <select class="pick-role-select" data-slot-role="${team}" data-index="${index}" aria-label="Posición del pick ${turn}" ${currentGameIsCompleted() ? 'disabled' : ''}>${roleOptions}</select>
        <button class="pick-slot ${champion ? 'filled' : ''}" data-pick-slot="${team}" data-role="${roleId}" data-slot-index="${index}" aria-label="Seleccionar campeón para ${roleLabel(roleId)}" ${currentGameIsCompleted() ? 'disabled' : ''}>${slotContent}</button>
      </div>`;
    }).join('');
  }
  bindChampionImages($('#blue-picks'));
  bindChampionImages($('#red-picks'));
}

function setSlotRole(team, index, nextRole) {
  if (currentGameIsCompleted()) return notify('Este game ya está finalizado y sus selecciones están bloqueadas.');
  const currentRole = state.slotRoles[team][index];
  if (!currentRole || currentRole === nextRole) return;
  const otherIndex = state.slotRoles[team].indexOf(nextRole);
  if (otherIndex < 0) return;
  const currentChampion = state.picks[team][currentRole];
  const otherChampion = state.picks[team][nextRole];
  const currentCompatible = !currentChampion || getChampion(currentChampion)?.roles.includes(nextRole);
  const otherCompatible = !otherChampion || getChampion(otherChampion)?.roles.includes(currentRole);
  if ((!currentCompatible || !otherCompatible) && !confirm('Uno de los campeones no está marcado para la nueva posición. ¿Mantener el flex pick?')) {
    renderPicks();
    return;
  }
  state.slotRoles[team][index] = nextRole;
  state.slotRoles[team][otherIndex] = currentRole;
  state.picks[team][currentRole] = otherChampion;
  state.picks[team][nextRole] = currentChampion;
  renderDraft();
}

function getRoleEntries(role) {
  const base = state.pool[role] || [];
  const known = new Set(base.map(entry => entry.champion));
  const extras = CHAMPIONS.filter(champion => champion.roles.includes(role) && !known.has(champion.id))
    .map(champion => ({ champion: champion.id, tier: 'SITUACIONAL' }));
  return [...base, ...extras];
}

function ownStats(ids) {
  const champs = ids.map(getChampion).filter(Boolean);
  return {
    champs,
    physical: champs.filter(c => c.damage === 'physical').length,
    magic: champs.filter(c => c.damage === 'magic').length,
    mixed: champs.filter(c => c.damage === 'mixed').length,
    trueDamage: champs.filter(c => c.damage === 'true').length,
    frontline: champs.reduce((sum, c) => sum + c.frontline, 0),
    engage: champs.reduce((sum, c) => sum + c.engage, 0),
    cc: champs.reduce((sum, c) => sum + c.cc, 0),
    peel: champs.reduce((sum, c) => sum + c.peel, 0),
    poke: champs.reduce((sum, c) => sum + c.poke, 0),
    antiTank: champs.reduce((sum, c) => sum + c.antiTank, 0),
    scaling: champs.reduce((sum, c) => sum + c.scaling, 0),
    dive: champs.reduce((sum, c) => sum + c.dive, 0),
    waveclear: champs.reduce((sum, c) => sum + c.waveclear, 0),
  };
}

function pairSynergy(ids) {
  let score = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      score += synergyMap.get(`${ids[i]}|${ids[j]}`) || synergyMap.get(`${ids[j]}|${ids[i]}`) || 0;
    }
  }
  return score;
}

function counterScore(ids, enemyIds) {
  let score = 0;
  for (const ownId of ids) {
    for (const enemyId of enemyIds) score += counterMap.get(`${ownId}|${enemyId}`) || 0;
  }
  return score;
}

function tierBonus(tier) {
  if (tier === 'CORE') return 3.2;
  if (tier === 'ALT 1') return 2.4;
  if (tier === 'ALT 2') return 1.8;
  return 0.5;
}

function scoreCandidate(champion, role, currentIds, enemyIds, tier = 'SITUACIONAL') {
  const current = ownStats(currentIds);
  const enemy = ownStats(enemyIds);
  const opposingTeam = ownTeam() === 'blue' ? 'red' : 'blue';
  const opposingLaneId = state.picks[opposingTeam][role];
  return scoreCandidateForDraft({
    champion, role, current, enemy, currentIds, enemyIds,
    opposingLaneChampion: opposingLaneId ? getChampion(opposingLaneId) : null,
    synergies: SYNERGIES, counters: COUNTERS, tier,
    patchWeight: PATCH_73D_CONTEXT[champion.id]?.weight || 0,
  });
}

function getAvailableEntries(role, team = ownTeam(), currentIds = teamIds(team), enemyIds = teamIds(team === 'blue' ? 'red' : 'blue')) {
  const taken = new Set(allPickIds());
  const banned = new Set(allBanIds());
  const seriesLocked = seriesLockedMap();
  return getRoleEntries(role)
    .filter(entry => !taken.has(entry.champion) && !banned.has(entry.champion) && !seriesLocked.has(entry.champion))
    .map(entry => ({ ...entry, champ: getChampion(entry.champion) }))
    .filter(entry => entry.champ)
    .map(entry => ({ ...entry, score: scoreCandidate(entry.champ, role, currentIds, enemyIds, entry.tier) }))
    .sort((a, b) => b.score - a.score || (tierBonus(b.tier) - tierBonus(a.tier)));
}

function damageLabel(champion) {
  return ({ physical: 'Físico', magic: 'Mágico', mixed: 'Mixto', true: 'Verdadero' })[champion.damage] || '—';
}

function candidateReasons(entry, role, currentIds, enemyIds) {
  const reasons = [];
  const champ = entry.champ;
  const directCounters = enemyIds.map(id => ({ id, weight: counterMap.get(`${champ.id}|${id}`) || 0 })).filter(item => item.weight > 0).sort((a,b) => b.weight-a.weight);
  if (directCounters[0]) reasons.push(`Matchup favorable vs ${championName(directCounters[0].id)}`);
  const enemy = ownStats(enemyIds);
  const current = ownStats(currentIds);
  if (enemy.frontline >= 5 && champ.antiTank > 0) reasons.push('Aporta daño contra frontline');
  if (enemy.dive >= 4 && champ.peel > 0) reasons.push('Ayuda a proteger la línea trasera');
  if (enemy.poke >= 4 && champ.engage > 0) reasons.push('Puede castigar el poke con engage');
  if (current.physical >= 3 && champ.damage === 'magic') reasons.push('Equilibra el daño con AP');
  if (current.magic >= 3 && champ.damage === 'physical') reasons.push('Equilibra el daño con AD');
  const synergy = currentIds.map(id => ({ id, weight: synergyMap.get(`${champ.id}|${id}`) || synergyMap.get(`${id}|${champ.id}`) || 0 })).filter(item => item.weight >= 3).sort((a,b)=>b.weight-a.weight);
  if (synergy[0]) reasons.push(`Sinergia con ${championName(synergy[0].id)}`);
  const patch = PATCH_73D_CONTEXT[champ.id];
  if (patch?.kind === 'buff') reasons.push('Recibió mejora en 7.3d');
  if (patch?.kind === 'nerf') reasons.push('Recibió ajuste negativo en 7.3d');
  if (!reasons.length) reasons.push(entry.tier === 'CORE' ? 'Prioridad principal del Champion Pool' : `${roleLabel(role)} disponible en el pool`);
  return reasons.slice(0, 2);
}

function getNextPickSlot() {
  return getNextSidePick(ownTeam(), state.slotRoles, state.picks);
}

function getLastPickSlot() {
  return getLastSidePick(ownTeam(), state.slotRoles, state.picks);
}

function renderPickCandidate(entry, role, currentIds, enemyIds, label = '') {
  const champ = entry.champ;
  const reasons = candidateReasons(entry, role, currentIds, enemyIds);
  const patch = PATCH_73D_CONTEXT[champ.id];
  return `<article class="pick-suggestion ${entry.tier === 'CORE' ? 'is-core' : ''}">
    ${championAvatar(champ, 'recommendation')}
    <div class="pick-suggestion-copy"><div class="pick-suggestion-top"><strong>${escapeHtml(champ.name)}</strong><span class="rec-tier ${tierClass(entry.tier)}">${escapeHtml(label || tierLabel(entry.tier))}</span></div>
      <small>${escapeHtml(reasons.join(' · '))}</small>${patch ? `<em class="patch-context ${patch.kind}">${patch.label}</em>` : ''}</div>
    <button class="rec-add" data-select-rec="${champ.id}" data-role="${role}" aria-label="Elegir ${escapeHtml(champ.name)}">＋</button>
  </article>`;
}

function getRoleCandidates(role, count = 3) {
  const team = ownTeam();
  const available = getAvailableEntries(role, team, teamIds(team), teamIds(enemyTeam()));
  const availableById = new Map(available.map(entry => [entry.champion, entry]));
  const prepared = (state.pool[role] || []).filter(entry => ['CORE', 'ALT 1', 'ALT 2'].includes(entry.tier))
    .map(entry => availableById.get(entry.champion)).filter(Boolean);
  const chosen = [...prepared];
  for (const entry of available) {
    if (chosen.length >= count) break;
    if (!chosen.some(item => item.champion === entry.champion)) chosen.push(entry);
  }
  return chosen.sort((a, b) => b.score - a.score).slice(0, count);
}

function renderPickCoach() {
  const container = $('#pick-coach-panel');
  const team = ownTeam();
  const current = teamIds(team);
  const enemy = teamIds(enemyTeam());
  const next = getNextPickSlot();
  const finalSlot = getLastPickSlot();
  if (!next) {
    container.innerHTML = `<div class="pick-coach-header"><div><span class="section-kicker">PICK COACH · DRAFT COMPLETO</span><h3>Las cinco selecciones están registradas</h3></div><span class="coach-turn complete">✓ COMPLETO</span></div><p>Revisa el informe de matchup para definir ejecución, foco de pelea y condición de victoria.</p>`;
    return;
  }
  const isFinalOwnPick = next.index === 4;
  const isTrueCounterpick = isFinalOwnPick && team === 'red';
  const candidates = getRoleCandidates(next.role, 3);
  const enemyPicked = enemy.length;
  const currentTurnCode = `${team === 'blue' ? 'B' : 'R'}${next.index + 1}`;
  const headline = isTrueCounterpick
    ? 'ÚLTIMO PICK · COUNTERPICK'
    : isFinalOwnPick ? 'ÚLTIMA SELECCIÓN · CIERRE DE DRAFT' : 'PRÓXIMA SELECCIÓN';
  const subline = isTrueCounterpick
    ? `R5 · ${roleLabel(next.role)}. El rival ya reveló sus cinco picks: prioriza el counterpick más seguro.`
    : isFinalOwnPick
      ? `B5 · ${roleLabel(next.role)}. Cierras antes del R5 rival: completa la composición y evita un pick demasiado vulnerable.`
      : `${currentTurnCode} · ${roleLabel(next.role)}. Recomendaciones según tu pool, tus picks y las respuestas al rival.`;
  const candidatesHtml = candidates.length ? candidates.map((entry, index) => renderPickCandidate(entry, next.role, current, enemy, index === 0 ? 'RECOMENDADO' : tierLabel(entry.tier))).join('') : '<div class="rec-empty">No hay candidatos disponibles para este rol.</div>';
  let reserveHtml = '';
  if (!isFinalOwnPick && finalSlot && !finalSlot.champion) {
    const reserveCandidates = getAvailableEntries(finalSlot.role, team, current, enemy).slice(0, 2);
    reserveHtml = `<div class="last-pick-reserve"><div class="reserve-copy"><span class="section-kicker">${team === 'red' ? 'RESERVA DE COUNTERPICK · R5' : 'RESERVA DE CIERRE · B5'}</span><strong>${roleLabel(finalSlot.role)}</strong><small>${team === 'red' ? 'El rival ya habrá mostrado sus cinco picks: guarda esta línea para responder.' : 'El rival aún tendrá R5 después de tu pick: busca una opción flexible y difícil de castigar.'}</small></div><div class="reserve-candidates">${reserveCandidates.map(entry => `${championAvatar(entry.champ,'tiny')}<span>${escapeHtml(entry.champ.name)}</span>`).join('')}</div></div>`;
  }
  container.innerHTML = `<div class="pick-coach-header"><div><span class="section-kicker">${headline}</span><h3>${roleLabel(next.role)} <span>· ${currentTurnCode}</span></h3><p>${subline}</p></div><span class="coach-turn ${isTrueCounterpick ? 'last' : isFinalOwnPick ? 'closing' : ''}">${isTrueCounterpick ? 'COUNTERPICK' : isFinalOwnPick ? 'B5 · CIERRE' : `${current.length}/5 PICKS`}</span></div>
    <div class="pick-suggestions">${candidatesHtml}</div>${reserveHtml}<div class="pick-coach-foot">${enemyPicked ? `${enemyPicked}/5 picks rivales revelados · las recomendaciones ya consideran counters y sinergias.` : 'Aún no hay picks rivales: las sugerencias priorizan Champion Pool y equilibrio de composición.'}</div>`;
  bindChampionImages(container);
}

function renderRoleRecommendations() {
  const container = $('#role-recommendations');
  if (currentGameIsCompleted()) {
    container.innerHTML = '<div class="rec-empty">Game finalizado. Las selecciones de este game están bloqueadas; continúa al siguiente game o inicia una nueva serie.</div>';
    return;
  }
  const team = ownTeam();
  const current = teamIds(team);
  const enemy = teamIds(enemyTeam());
  container.innerHTML = ROLES.map(role => {
    if (state.picks[team][role.id]) {
      const champion = getChampion(state.picks[team][role.id]);
      return `<div class="role-rec"><div class="role-rec-head"><strong>${role.label}</strong><span>LOCKED</span></div><div class="rec-choice">${championAvatar(champion,'tiny')}<span>${escapeHtml(champion.name)}</span><span class="rec-add" style="opacity:.4">✓</span></div><div class="rec-empty">Posición seleccionada</div></div>`;
    }
    const candidates = getRoleCandidates(role.id, 3);
    return `<div class="role-rec"><div class="role-rec-head"><strong>${role.label}</strong><span>${candidates.length} OPC.</span></div>${candidates.length ? candidates.map((entry, index) => `<div class="rec-choice">${championAvatar(entry.champ,'tiny')}<button data-select-rec="${entry.champion}" data-role="${role.id}" title="${escapeHtml(entry.tier)} · ${entry.score.toFixed(1)} puntos">${escapeHtml(entry.champ.name)}</button><span class="rec-tier ${tierClass(entry.tier)}">${index === 0 ? 'TOP' : escapeHtml(tierLabel(entry.tier))}</span><button class="rec-add" data-select-rec="${entry.champion}" data-role="${role.id}" aria-label="Elegir ${escapeHtml(entry.champ.name)}">+</button></div>`).join('') : '<div class="rec-empty">Sin opciones disponibles</div>'}</div>`;
  }).join('');
  bindChampionImages(container);
}

function evaluateTeam(ids, enemyIds, style = 'balanced', tierMap = {}) {
  const stats = ownStats(ids);
  const enemy = ownStats(enemyIds);
  const damageBalance = (stats.physical > 0 && stats.magic > 0) ? 10 : (stats.mixed + stats.trueDamage > 0 ? 5 : -7);
  const frontlineScore = Math.min(stats.frontline, 5) * 2.5;
  const engageScore = Math.min(stats.engage, 5) * 1.5;
  const ccScore = Math.min(stats.cc, 6) * 1.15;
  const peelScore = Math.min(stats.peel, 4) * 1.3;
  const synergy = pairSynergy(ids) * 1.1;
  const counter = counterScore(ids, enemyIds) * 1.25;
  const antiTankScore = stats.antiTank * (enemy.frontline >= 4 ? 2.8 : enemy.frontline >= 2 ? 1.8 : 0.75);
  const pokeScore = Math.min(stats.poke, 5) * 1.1;
  const scalingScore = Math.min(stats.scaling, 6) * 0.75;
  let styleScore = 0;
  if (style === 'teamfight') styleScore = stats.engage * 1.0 + stats.cc * 0.9 + synergy * 0.55;
  if (style === 'anti') styleScore = stats.antiTank * 2.0 + (enemy.frontline >= 4 ? 8 : enemy.frontline >= 2 ? 4 : 0);
  if (style === 'poke') styleScore = stats.poke * 2.0 + stats.waveclear * 0.8;
  if (style === 'balanced') styleScore = damageBalance + frontlineScore + peelScore;
  const total = 43 + damageBalance + frontlineScore + engageScore + ccScore + peelScore + synergy + counter + antiTankScore + pokeScore + scalingScore + styleScore;
  const score = Math.max(8, Math.min(99, Math.round(total / 2.0)));
  return { ...stats, score, synergy, counter, enemy, styleScore };
}

function buildCandidatesForStyle(style) {
  const team = ownTeam();
  const enemy = enemyTeam();
  const fixed = { ...state.picks[team] };
  const enemyIds = teamIds(enemy);
  const used = new Set(allPickIds());
  const banned = new Set(allBanIds());
  const missing = ROLES.filter(role => !fixed[role.id]);
  const options = {};
  for (const role of missing) {
    options[role.id] = getRoleEntries(role.id)
      .filter(entry => !used.has(entry.champion) && !banned.has(entry.champion))
      .map(entry => ({ ...entry, champ: getChampion(entry.champion) }))
      .filter(entry => entry.champ)
      .map(entry => ({ ...entry, score: scoreCandidate(entry.champ, role.id, Object.values(fixed).filter(Boolean), enemyIds, entry.tier) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 7);
  }
  if (missing.some(role => options[role.id].length === 0)) return null;
  const results = [];
  const current = { ...fixed };
  function walk(index) {
    if (index >= missing.length) {
      const ids = ROLES.map(role => current[role.id]).filter(Boolean);
      const evaluation = evaluateTeam(ids, enemyIds, style);
      const tierBonusTotal = missing.reduce((sum, role) => {
        const entry = options[role.id].find(item => item.champion === current[role.id]);
        return sum + (entry ? tierBonus(entry.tier) : 0);
      }, 0);
      results.push({ picks: { ...current }, evaluation, rank: evaluation.score + tierBonusTotal * 0.28 });
      return;
    }
    const role = missing[index];
    for (const candidate of options[role.id]) {
      if (Object.values(current).includes(candidate.champion)) continue;
      current[role.id] = candidate.champion;
      walk(index + 1);
      current[role.id] = null;
    }
  }
  walk(0);
  results.sort((a, b) => b.rank - a.rank);
  return results[0] || null;
}

function getBuildSpecs() {
  const enemyIds = teamIds(enemyTeam());
  const enemyStats = ownStats(enemyIds);
  const antiStyle = enemyStats.frontline >= 4 ? 'anti' : 'poke';
  return [
    { key: 'balanced', label: 'BALANCEADA', title: 'Composición equilibrada', copy: 'Daño mixto, frontline y herramientas para responder a distintas situaciones.' },
    { key: 'teamfight', label: 'TEAMFIGHT', title: 'Iniciación y pelea grupal', copy: 'Prioriza control de masas, engage y combinaciones entre definitivas.' },
    { key: antiStyle, label: antiStyle === 'anti' ? 'ANTI-TANK' : 'POKE / SIEGE', title: antiStyle === 'anti' ? 'Rompe-frontline' : 'Poke y control de mapa', copy: antiStyle === 'anti' ? 'Aumenta el daño contra enemigos resistentes y peleas prolongadas.' : 'Busca alcance, desgaste y control antes de disputar objetivos.' },
  ];
}

function renderBuildRecommendations() {
  const container = $('#build-recommendations');
  const specs = getBuildSpecs();
  const team = ownTeam();
  const ownFull = ROLES.every(role => state.picks[team][role.id]);
  const builds = specs.map(spec => ({ ...spec, result: buildCandidatesForStyle(spec.key) }));
  container.innerHTML = builds.map((build, index) => {
    const result = build.result;
    if (!result) return `<article class="build-card"><div class="build-top"><span class="build-type">${build.label}</span></div><h3>${build.title}</h3><p>No hay suficientes campeones disponibles. Revisa los bans y picks.</p></article>`;
    const pickMarkup = ROLES.map(role => {
      const locked = Boolean(state.picks[team][role.id]);
      return `<span class="${locked ? 'locked' : ''}">${role.short}: ${escapeHtml(championName(result.picks[role.id]))}</span>`;
    }).join('');
    return `<article class="build-card"><div class="build-top"><span class="build-type">${build.label}</span><span class="build-score">${result.evaluation.score}<small style="font:700 8px Inter;color:#7f93aa">/100*</small></span></div><h3>${build.title}</h3><p>${build.copy}</p><div class="build-picks">${pickMarkup}</div><div class="build-actions"><small>${ownFull ? 'Evaluación de tu draft' : 'Completa posiciones libres'}</small><button class="apply-build" data-apply-build="${index}">Aplicar draft →</button></div></article>`;
  }).join('');
  container.dataset.buildKeys = JSON.stringify(specs.map(spec => spec.key));
  container._buildResults = builds;
}

function getWinCondition(ids, enemyIds) {
  const stats = ownStats(ids);
  const champs = stats.champs;
  const enemy = ownStats(enemyIds);
  if (!ids.length) return { title: 'Esperando selecciones', copy: 'Registra tus campeones para identificar la identidad y las necesidades de tu composición.' };
  if (champs.some(c => c.id === 'kog-maw') || champs.some(c => c.id === 'jinx') || (stats.scaling >= 9 && stats.peel >= 3)) {
    return { title: 'Proteger al carry y escalar', copy: 'Mantén la formación alrededor del ADC, evita picks aislados y busca peleas cuando el carry tenga sus picos de poder.' };
  }
  if (enemy.frontline >= 4 && stats.antiTank >= 5) return { title: 'Desgastar y romper la frontline', copy: 'Alarga las peleas, reserva recursos para los tanques y aprovecha el daño porcentual o verdadero.' };
  if (stats.poke >= 7) return { title: 'Poke y control de objetivos', copy: 'Desgasta antes de entrar al río, controla oleadas y obliga al rival a disputar objetivos con menos vida.' };
  if (stats.dive >= 6) return { title: 'Aislar y eliminar carries', copy: 'Coordina las entradas sobre la línea trasera, busca superioridad numérica y convierte picks en objetivos.' };
  if (stats.engage >= 6 && stats.cc >= 5) return { title: 'Iniciación y wombo combo', copy: 'Encadena control de masas y definitivas. Guarda las herramientas de engage para una misma ventana de pelea.' };
  if (stats.frontline >= 5 && stats.peel >= 3) return { title: 'Frontline y contraataque', copy: 'Controla el espacio, protege a tus fuentes de daño y castiga las entradas del rival.' };
  return { title: 'Jugar por tempo y objetivos', copy: 'Usa las fortalezas de línea para preparar visión, sincronizar rotaciones y elegir peleas con ventaja.' };
}

function metric(label, value, max, text = null) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return `<div class="metric-row"><div class="metric-label"><span>${label}</span><b>${text ?? `${value}`}</b></div><div class="metric-track"><div class="metric-fill" style="width:${pct}%"></div></div></div>`;
}

function renderAnalysis() {
  const ids = teamIds(ownTeam());
  const enemyIds = teamIds(enemyTeam());
  const stats = ownStats(ids);
  const evaluation = evaluateTeam(ids, enemyIds, 'balanced');
  const container = $('#analysis-content');
  if (!ids.length) {
    container.innerHTML = '<div class="empty-state">Aún no hay picks de VK SinADC.<br>El análisis aparecerá aquí cuando registres la composición propia.</div>';
    $('#wincon-title').textContent = 'Esperando selecciones';
    $('#wincon-copy').textContent = 'Registra tus campeones para identificar la identidad y las necesidades de tu composición.';
    return;
  }
  const grade = evaluation.score >= 82 ? 'A' : evaluation.score >= 68 ? 'B' : evaluation.score >= 52 ? 'C' : 'D';
  const title = ({ A: 'Estructura sólida', B: 'Buena base de draft', C: 'Necesita ajustes', D: 'Composición incompleta' })[grade];
  const warnings = [];
  if (stats.physical >= 4 && stats.magic === 0) warnings.push(['⚠', 'Mucho daño físico: el rival puede priorizar armadura.']);
  if (stats.magic >= 4 && stats.physical === 0) warnings.push(['⚠', 'Mucho daño mágico: considera añadir una fuente física.']);
  if (ids.length >= 3 && stats.frontline < 2) warnings.push(['⚠', 'Falta frontline para controlar peleas largas.']);
  if (ids.length >= 3 && stats.engage === 0) warnings.push(['⚠', 'No hay iniciación clara: define cómo comenzar las peleas.']);
  if (enemyIds.length >= 2 && ownStats(enemyIds).frontline >= 4 && stats.antiTank < 3) warnings.push(['⚠', 'El rival acumula frontline: necesitas más daño sostenido o anti-tanque.']);
  if (ids.length >= 3 && stats.peel === 0 && (ids.some(id => ['kog-maw','jinx','smolder'].includes(id)))) warnings.push(['⚠', 'Tu carry necesita más protección o herramientas de desenganche.']);
  if (stats.champs.some(champion => champion.tags.includes('sin-clasificar'))) warnings.push(['⚠', 'Hay picks del catálogo general sin etiquetas estratégicas: sus métricas son neutrales hasta configurarlos en Champion Pool.']);
  if (!warnings.length) warnings.push(['✓', 'No se detectan desequilibrios críticos con los picks actuales.']);
  container.innerHTML = `<div class="analysis-grade"><div class="grade-letter">${grade}</div><div><strong>${title}</strong><small>${ids.length}/5 campeones seleccionados · índice heurístico ${evaluation.score}/100</small></div></div>
    <div class="metric-list">${metric('Daño físico', stats.physical, 5, `${stats.physical}/5`)}${metric('Daño mágico', stats.magic, 5, `${stats.magic}/5`)}${metric('Frontline', stats.frontline, 8)}${metric('Engage y CC', stats.engage + stats.cc, 12)}${metric('Protección', stats.peel, 7)}${metric('Daño anti-tanque', stats.antiTank, 9)}</div>
    <div class="analysis-warnings">${warnings.map(([icon, text]) => `<div class="warning ${icon === '✓' ? 'good' : ''}"><b>${icon}</b><span>${text}</span></div>`).join('')}</div>`;
  const wincon = getWinCondition(ids, enemyIds);
  $('#wincon-title').textContent = wincon.title;
  $('#wincon-copy').textContent = wincon.copy;
}

function renderMatchupAnalysis() {
  const container = $('#matchup-analysis');
  const planContainer = $('#game-plan-analysis');
  const adjustmentsContainer = $('#adjustments-analysis');
  const team = ownTeam();
  const enemy = enemyTeam();
  const ownIds = teamIds(team);
  const enemyIds = teamIds(enemy);
  const report = compareCompositions(
    ownIds, enemyIds, championById, COUNTERS,
    state.picks[enemy], state.picks[team], SYNERGIES,
  );
  const ownTone = team === 'blue' ? 'blue' : 'red';
  const enemyTone = enemy === 'blue' ? 'blue' : 'red';
  const ownPct = Math.round(ownIds.length / 5 * 100);
  const enemyPct = Math.round(enemyIds.length / 5 * 100);
  const comparativeMetrics = report.metrics.map(item => {
    const max = Math.max(item.own, item.enemy, 1);
    return `<div class="compare-metric"><div class="compare-metric-head"><span>${escapeHtml(item.label)}</span><small>${item.own} · ${item.enemy}</small></div><div class="compare-meter"><i class="ours" style="width:${Math.round(item.own / max * 100)}%"></i></div><div class="compare-meter enemy"><i style="width:${Math.round(item.enemy / max * 100)}%"></i></div></div>`;
  }).join('');
  const lanes = report.lanePriority.map(lane => {
    const tone = lane.priority === 'Prioridad VK' ? 'vk-edge' : lane.priority === 'Prioridad rival' ? 'enemy-edge' : lane.priority === 'Pendiente' ? 'pending-edge' : 'even-edge';
    const ownLaneChampion = getChampion(state.picks[team]?.[lane.role]);
    const enemyLaneChampion = getChampion(state.picks[enemy]?.[lane.role]);
    const ownAvatar = ownLaneChampion ? championAvatar(ownLaneChampion, 'tiny') : '<span class="lane-champion-placeholder">?</span>';
    const enemyAvatar = enemyLaneChampion ? championAvatar(enemyLaneChampion, 'tiny') : '<span class="lane-champion-placeholder">?</span>';
    return `<article class="lane-priority-card ${tone}"><div class="lane-card-head"><span>${escapeHtml(lane.label)}</span><b>${escapeHtml(lane.priority)}</b></div><div class="lane-matchup"><div class="lane-team-chip own">${ownAvatar}<strong>${escapeHtml(lane.ownChampion || 'Pendiente')}</strong></div><span class="lane-versus">VS</span><div class="lane-team-chip enemy"><strong>${escapeHtml(lane.enemyChampion || 'Pendiente')}</strong>${enemyAvatar}</div></div><p class="lane-matchup-explanation">${escapeHtml(lane.explanation)}</p><div class="lane-advice"><span>CONSEJO DE JUEGO</span><p>${escapeHtml(lane.advice || 'Completa ambos picks para recibir un consejo específico.')}</p></div></article>`;
  }).join('');
  const direct = report.edges.map(edge => `<div class="matchup-edge">${championAvatar(getChampion(edge.counter),'tiny')}<strong>${escapeHtml(championName(edge.counter))}</strong><span>presiona a</span>${championAvatar(getChampion(edge.target),'tiny')}<strong>${escapeHtml(championName(edge.target))}</strong><b>+</b></div>`).join('');
  const focus = report.focus.length ? `<div class="focus-line"><span>FOCO RIVAL</span><strong>${report.focus.map(escapeHtml).join(' → ')}</strong></div>` : '';
  const status = report.ownCount < 5 || report.enemyCount < 5 ? `Lectura parcial · VK ${report.ownCount}/5 · Rival ${report.enemyCount}/5. La comparativa se completa cuando ambos equipos revelen sus cinco picks.` : 'Composiciones completas · comparativa de draft disponible.';
  const advantage = report.draftAdvantage
    ? `<section class="draft-advantage"><div class="advantage-heading"><div><span class="section-kicker">ÍNDICE COMPARATIVO DE DRAFT · NO WIN RATE</span><h3>${escapeHtml(report.draftAdvantage.favored)} <small>con ventaja de composición</small></h3></div><span class="advantage-confidence">Confianza ${escapeHtml(report.draftAdvantage.confidence)}</span></div><div class="advantage-scores"><div class="advantage-team vk"><span>VK SinADC · índice</span><strong>${report.draftAdvantage.own}/100</strong></div><div class="advantage-team enemy"><span>Rival · índice</span><strong>${report.draftAdvantage.enemy}/100</strong></div></div><div class="advantage-track"><i class="vk-fill" style="width:${report.draftAdvantage.own}%"></i><i class="enemy-fill" style="width:${report.draftAdvantage.enemy}%"></i></div><p>${escapeHtml(report.draftAdvantage.label)} Los puntos distribuyen una ventaja relativa de draft (0–100) entre ambos lados; no son porcentajes de probabilidad ni win rate real.</p></section>`
    : `<section class="draft-advantage draft-advantage-pending"><span class="section-kicker">ÍNDICE COMPARATIVO DE DRAFT · NO WIN RATE</span><strong>Esperando las dos composiciones completas</strong><p>Se necesita registrar los cinco picks de VK SinADC y los cinco del rival. Antes de eso, cualquier porcentaje sería demasiado especulativo.</p></section>`;
  container.innerHTML = `<div class="matchup-status">${escapeHtml(status)}</div>
    <div class="versus-styles"><div class="style-side ${ownTone}"><small>VK SinADC · ${team.toUpperCase()} · ${ownIds.length}/5</small><strong>${escapeHtml(report.ownStyle)}</strong><div class="style-meter"><i style="width:${ownPct}%"></i></div></div><div class="versus-mark">VS</div><div class="style-side ${enemyTone}"><small>RIVAL · ${enemy.toUpperCase()} · ${enemyIds.length}/5</small><strong>${escapeHtml(report.enemyStyle)}</strong><div class="style-meter"><i style="width:${enemyPct}%"></i></div></div></div>
    ${advantage}
    <div class="matchup-subsection"><span class="section-kicker">COMPARATIVA DE HERRAMIENTAS · VK / RIVAL</span><div class="comparison-grid">${comparativeMetrics}</div><div class="comparison-legend"><span><i class="legend-our"></i>VK SinADC</span><span><i class="legend-enemy"></i>RIVAL</span></div></div>
    <div class="matchup-subsection"><span class="section-kicker">PRIORIDAD POTENCIAL POR LÍNEA</span><p class="report-explainer">La prioridad se estima por counters registrados y perfil del campeón. No garantiza prioridad real de oleada: también depende de matchup, ejecución, visión y cobertura del jungla.</p><div class="lane-priority-grid">${lanes}</div></div>
    ${direct ? `<div class="matchup-subsection"><span class="section-kicker">COUNTERS DIRECTOS DETECTADOS</span>${direct}</div>` : ''}${focus}`;

  planContainer.innerHTML = `<div class="game-plan-grid"><article class="game-phase"><span>01 · EARLY GAME</span><p>${escapeHtml(report.earlyPlan)}</p></article><article class="game-phase"><span>02 · DRAGÓN / HERALDO / BARÓN</span><p>${escapeHtml(report.objectivePlan)}</p></article><article class="game-phase"><span>03 · TEAMFIGHT Y CIERRE</span><p>${escapeHtml(report.fightPlan)}</p></article></div>`;
  const actions = report.actions.map(action => `<article class="matchup-action ${action.type}"><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(action.text)}</p></article>`).join('');
  const prioritySummary = report.lanePriority.filter(lane => lane.priority !== 'Pendiente').sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3);
  const laneSummary = prioritySummary.length ? `<div class="priority-summary"><span class="section-kicker">LÍNEAS QUE DEBEMOS JUGAR</span>${prioritySummary.map(lane => `<div><b>${escapeHtml(lane.label)}</b><span>${escapeHtml(lane.priority)}</span></div>`).join('')}</div>` : '';
  adjustmentsContainer.innerHTML = `${laneSummary}<div class="adjustments-grid">${actions}</div>`;
  bindChampionImages(container);
}

function renderDraft() {
  // Keep the active Game's bans/picks in its own series slot before rendering tabs and counters.
  syncActiveGameToSeries();
  renderSetup();
  renderBans();
  renderPicks();
  renderPickCoach();
  renderRoleRecommendations();
  renderBuildRecommendations();
  renderAnalysis();
  renderMatchupAnalysis();
  saveState();
}

function openPicker(target) {
  if (currentGameIsCompleted()) return notify('Este game ya está finalizado. Inicia el siguiente game para continuar.');
  pickerTarget = target;
  pickerFilter = target.type === 'pick' ? 'role' : 'all';
  $('#picker-title').textContent = target.type === 'ban' ? 'Seleccionar campeón para banear' : `Seleccionar ${roleLabel(target.role).toLowerCase()}`;
  $('#picker-subtitle').textContent = target.type === 'ban'
    ? 'Elige un campeón que quieras retirar de la partida.'
    : `Elige un campeón compatible con ${roleLabel(target.role)}. Los campeones baneados o seleccionados no están disponibles.`;
  $('#champion-search').value = '';
  $('#picker-filters').classList.toggle('hidden', target.type === 'ban');
  $$('#picker-filters button').forEach(button => button.classList.toggle('selected', button.dataset.pickerFilter === pickerFilter));
  $('#picker-modal').classList.remove('hidden');
  renderChampionOptions();
  setTimeout(() => $('#champion-search').focus(), 40);
}

function closePicker() {
  $('#picker-modal').classList.add('hidden');
  pickerTarget = null;
}

function renderChampionOptions() {
  if (!pickerTarget) return;
  const search = $('#champion-search').value.trim().toLowerCase();
  const team = pickerTarget.team;
  const taken = new Set(allPickIds());
  const banned = new Set(allBanIds());
  const seriesLocked = seriesLockedMap();
  let champions = [...CHAMPIONS];
  if (pickerTarget.type === 'pick' && pickerFilter === 'role') champions = champions.filter(champion => champion.roles.includes(pickerTarget.role));
  if (search) champions = champions.filter(champion => champion.name.toLowerCase().includes(search));
  champions.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const targetTeamExisting = state.picks[team][pickerTarget.role];
  $('#champion-grid').innerHTML = champions.length ? champions.map(champion => {
    const isSameSlot = pickerTarget.type === 'pick' && targetTeamExisting === champion.id;
    const fearlessGame = seriesLocked.get(champion.id);
    const unavailable = (taken.has(champion.id) && !isSameSlot) || banned.has(champion.id) || Boolean(fearlessGame);
    const reason = fearlessGame ? `FEARLESS · G${fearlessGame}` : banned.has(champion.id) ? 'BANEADO' : taken.has(champion.id) && !isSameSlot ? 'SELECCIONADO' : (champion.roles.map(roleLabel).join(' · ') || 'CATÁLOGO GENERAL');
    return `<button class="champion-option" data-select-champion="${champion.id}" ${unavailable ? 'disabled' : ''}>${championAvatar(champion,'picker')}<span style="min-width:0"><strong>${escapeHtml(champion.name)}</strong><small>${escapeHtml(reason)}</small></span></button>`;
  }).join('') : '<div class="no-results">No se encontraron campeones.</div>';
  bindChampionImages($('#champion-grid'));
}

function selectChampion(championId) {
  if (!pickerTarget) return;
  const { type, team, role, index } = pickerTarget;
  if (currentGameIsCompleted()) return notify('Este game ya está finalizado.');
  const lockedInSeries = seriesLockedMap();
  if (lockedInSeries.has(championId)) {
    const game = lockedInSeries.get(championId);
    if (type === 'pick') return notify(`${championName(championId)} está bloqueado por Fearless Draft desde Game ${game}.`);
    return notify(`${championName(championId)} ya está retirado por Fearless y no puede volver a banearse.`);
  }
  if (allBanIds().includes(championId) && type === 'pick') return notify('Ese campeón está baneado en este game.');
  if (allPickIds().includes(championId) && type === 'ban') return notify('No puedes banear un campeón que ya fue seleccionado.');
  if (type === 'pick') {
    const alreadyUsed = allPickIds().includes(championId) && state.picks[team][role] !== championId;
    if (alreadyUsed) return notify('Ese campeón ya fue seleccionado.');
    if (pickerFilter === 'role' && !getChampion(championId)?.roles.includes(role)) return notify('El campeón no está asignado a esa posición en el catálogo. Usa "Todo el pool" para un flex pick.');
    state.picks[team][role] = championId;
  } else {
    if (allBanIds().includes(championId)) return notify('Ese campeón ya está baneado.');
    state.bans[team][index] = championId;
  }
  closePicker();
  renderDraft();
  notify(`${championName(championId)} ${type === 'pick' ? 'seleccionado' : 'baneado'}.`);
}

function removePick(team, role) {
  if (currentGameIsCompleted()) return notify('Este game ya está finalizado.');
  state.picks[team][role] = null;
  renderDraft();
}
function removeBan(team, index) {
  if (currentGameIsCompleted()) return notify('Este game ya está finalizado.');
  state.bans[team][index] = null;
  renderDraft();
}

function applyBuild(index) {
  if (currentGameIsCompleted()) return notify('Este game ya está finalizado.');
  const builds = $('#build-recommendations')._buildResults || [];
  const build = builds[index];
  if (!build?.result) return notify('No se pudo aplicar esta composición.');
  const team = ownTeam();
  const blocked = new Set([...allBanIds(), ...teamIds(enemyTeam()), ...seriesLockedMap().keys()]);
  const used = new Set(allPickIds());
  const missing = ROLES.filter(role => !state.picks[team][role.id]);
  for (const role of missing) {
    const candidate = build.result.picks[role.id];
    if (!candidate || blocked.has(candidate) || (used.has(candidate) && state.picks[team][role.id] !== candidate)) {
      return notify(`No se puede aplicar: ${championName(candidate)} está baneado, seleccionado o bloqueado por Fearless.`);
    }
    used.add(candidate);
  }
  for (const role of missing) state.picks[team][role.id] = build.result.picks[role.id];
  renderDraft();
  notify('Se completaron las posiciones libres con la composición elegida.');
}

function applyTemplate(templateId) {
  if (currentGameIsCompleted()) return notify('Este game ya está finalizado.');
  const template = allTemplates().find(item => item.id === templateId);
  if (!template) return;
  const team = ownTeam();
  const existing = teamIds(team).length > 0;
  if (existing && !confirm('Esta acción reemplazará los picks actuales de tu equipo. ¿Continuar?')) return;
  const pickedByEnemy = new Set(teamIds(enemyTeam()));
  const bannedByEnemy = new Set(state.bans[enemyTeam()].filter(Boolean));
  const locked = seriesLockedMap();
  const lockedTemplatePick = ROLES.map(role => template.picks[role.id]).find(id => locked.has(id));
  if (lockedTemplatePick) return notify(`${championName(lockedTemplatePick)} está bloqueado por Fearless Draft desde Game ${locked.get(lockedTemplatePick)}.`);
  const templateIds = ROLES.map(role => template.picks[role.id]).filter(Boolean);
  if (new Set(templateIds).size !== templateIds.length) return notify('La plantilla contiene campeones repetidos.');
  for (const [role, champion] of Object.entries(template.picks)) {
    if (pickedByEnemy.has(champion) || bannedByEnemy.has(champion)) {
      notify(`No se puede cargar: ${championName(champion)} ya está ocupado o baneado.`);
      return;
    }
  }
  const templateBans = (template.bans || []).filter(Boolean);
  const currentPicks = new Set([...teamIds('blue'), ...teamIds('red')]);
  const futurePicks = new Set([...teamIds(enemyTeam()), ...templateIds]);
  if (templateBans.some(id => futurePicks.has(id))) return notify('La plantilla intenta banear un campeón que ya está seleccionado o incluido en ella.');
  state.picks[team] = { ...EMPTY_TEAM(), ...template.picks };
  if (Array.isArray(template.slotRoles) && template.slotRoles.length === 5 && new Set(template.slotRoles).size === 5 && template.slotRoles.every(role => ROLES.some(item => item.id === role))) state.slotRoles[team] = [...template.slotRoles];
  state.bans[team] = [...templateBans, null, null].slice(0, 5);
  setView('draft');
  renderDraft();
  notify(`Plantilla “${template.name}” cargada.`);
}

function setPoolTier(role, championId, tier) {
  if (!ROLES.some(item => item.id === role) || !championById.has(championId)) return;
  const allowed = ['CORE', 'ALT 1', 'ALT 2', 'SITUACIONAL'];
  if (!allowed.includes(tier)) return;
  const entries = state.pool[role] || (state.pool[role] = []);
  let entry = entries.find(item => item.champion === championId);
  if (!entry) {
    entry = { champion: championId, tier: 'SITUACIONAL' };
    entries.push(entry);
  }
  if (tier !== 'SITUACIONAL') {
    for (const item of entries) {
      if (item !== entry && item.tier === tier) item.tier = 'SITUACIONAL';
    }
  }
  entry.tier = tier;
  saveState();
  renderPool();
  renderDraft();
  notify(`${championName(championId)} actualizado a ${tier} en ${roleLabel(role)}.`);
}

function allTemplates() {
  return [...TEMPLATES, ...(state.customTemplates || [])];
}

function saveCurrentTemplate() {
  const team = ownTeam();
  if (!ROLES.every(role => state.picks[team][role.id])) return notify('Completa las cinco posiciones antes de guardar la composición.');
  const suggestedName = `Mi composición ${state.customTemplates.length + 1}`;
  const name = prompt('Nombre para esta composición:', suggestedName)?.trim();
  if (!name) return;
  const id = `custom-${crypto.randomUUID()}`;
  state.customTemplates.push({
    id,
    name: name.slice(0, 48),
    style: 'PERSONALIZADA',
    description: 'Composición guardada desde la sala de draft.',
    picks: { ...state.picks[team] },
    slotRoles: [...state.slotRoles[team]],
    bans: state.bans[team].filter(Boolean),
  });
  saveState();
  renderTemplates();
  setView('library');
  notify('Composición guardada en Vercel.');
}

function renderPool() {
  const search = ($('#pool-search')?.value || '').trim().toLowerCase();
  const roles = currentPoolRole === 'all' ? ROLES : ROLES.filter(role => role.id === currentPoolRole);
  let total = 0;
  const markup = roles.map(role => {
    const tierOrder = { CORE: 0, 'ALT 1': 1, 'ALT 2': 2, SITUACIONAL: 3 };
    const entries = getRoleEntries(role.id).filter(entry => {
      const champ = getChampion(entry.champion);
      return champ && (!search || champ.name.toLowerCase().includes(search) || champ.tags.some(tag => tag.includes(search)));
    });
    entries.sort((a,b) => (tierOrder[a.tier] ?? 9) - (tierOrder[b.tier] ?? 9) || getChampion(a.champion).name.localeCompare(getChampion(b.champion).name, 'es'));
    if (!entries.length) return '';
    total += entries.length;
    return `<section class="pool-role-section"><div class="pool-role-head"><h2>${role.label}</h2><span>${entries.length} CAMPEONES DISPONIBLES</span></div><div class="pool-champs">${entries.map(entry => {
      const champion = getChampion(entry.champion);
      const tags = champion.tags.slice(0, 3).map(tag => `<span>${escapeHtml(tag.toUpperCase())}</span>`).join('');
      const tierOptions = ['CORE','ALT 1','ALT 2','SITUACIONAL'].map(tier => `<option value="${tier}" ${tier === entry.tier ? 'selected' : ''}>${tier}</option>`).join('');
      return `<article class="champ-card ${tierClass(entry.tier)}"><div class="champ-card-head">${championAvatar(champion,'pool')}<span class="tier-badge ${tierClass(entry.tier)}">${entry.tier}</span></div><h3>${escapeHtml(champion.name)}</h3><div class="champ-role">${damageLabel(champion)} · ${role.label}</div><div class="tag-list">${tags}</div><label class="tier-editor"><span>PRIORIDAD DEL EQUIPO</span><select data-pool-tier="${role.id}" data-champion="${champion.id}" aria-label="Prioridad de ${escapeHtml(champion.name)}">${tierOptions}</select></label></article>`;
    }).join('')}</div></section>`;
  }).join('');
  $('#pool-content').innerHTML = markup || '<div class="empty-state">No hay campeones que coincidan con la búsqueda.</div>';
  $('#pool-count').textContent = `${total} ENTRADAS DE POOL`;
  bindChampionImages($('#pool-content'));
}

function renderTemplates() {
  const templates = allTemplates();
  $('#template-count').textContent = `${templates.length} PLANTILLAS`;
  $('#template-content').innerHTML = templates.map((template, index) => `
    <article class="template-card"><span class="template-index">${String(index + 1).padStart(2,'0')}</span><span class="style-label">${escapeHtml(template.style || 'PERSONALIZADA')}</span><h2>${escapeHtml(template.name)}</h2><p>${escapeHtml(template.description || '')}</p>
      <div class="template-picks">${ROLES.map(role => `<div class="template-pick"><small>${role.short}</small>${championAvatar(getChampion(template.picks[role.id]),'tiny')}<strong>${escapeHtml(championName(template.picks[role.id]))}</strong></div>`).join('')}</div>
      <button class="button button-primary" data-load-template="${template.id}">Cargar al draft <span>→</span></button>
      ${String(template.id).startsWith('custom-') ? `<button class="delete-template" data-delete-template="${template.id}">Eliminar plantilla</button>` : ''}
    </article>`).join('');
  bindChampionImages($('#template-content'));
}

function deleteCustomTemplate(templateId) {
  if (!confirm('¿Eliminar esta composición guardada?')) return;
  state.customTemplates = state.customTemplates.filter(item => item.id !== templateId);
  saveState();
  renderTemplates();
  notify('Plantilla eliminada.');
}

function validImportedState(payload) {
  const imported = payload?.state || payload;
  if (!imported || typeof imported !== 'object' || !imported.picks || !imported.bans) throw new Error('El archivo no contiene un respaldo válido de VoidKings Draft Lab.');
  const next = initialState();
  next.side = imported.side === 'red' ? 'red' : 'blue';
  next.format = ['BO1','BO3','BO5'].includes(imported.format) ? imported.format : 'BO3';
  const used = new Set();
  const banned = new Set();
  for (const team of ['blue','red']) {
    for (const role of ROLES) {
      const id = imported.picks?.[team]?.[role.id];
      if (id && championById.has(id) && !used.has(id)) { next.picks[team][role.id] = id; used.add(id); }
    }
    const roles = imported.slotRoles?.[team];
    if (Array.isArray(roles) && roles.length === 5 && roles.every(role => ROLES.some(item => item.id === role)) && new Set(roles).size === 5) next.slotRoles[team] = [...roles];
  }
  for (const team of ['blue','red']) {
    next.bans[team] = Array.from({length:5}, (_,i) => {
      const id = imported.bans?.[team]?.[i];
      if (!id || !championById.has(id) || used.has(id) || banned.has(id)) return null;
      banned.add(id);
      return id;
    });
  }
  if (imported.pool && typeof imported.pool === 'object') {
    for (const role of ROLES) {
      const entries = imported.pool[role.id];
      if (!Array.isArray(entries)) continue;
      next.pool[role.id] = entries.filter(entry => entry && championById.has(entry.champion) && ['CORE','ALT 1','ALT 2','SITUACIONAL'].includes(entry.tier)).map(entry => ({champion:entry.champion,tier:entry.tier}));
      for (const tier of ['CORE','ALT 1','ALT 2']) {
        let found = false;
        for (const entry of next.pool[role.id]) {
          if (entry.tier !== tier) continue;
          if (!found) found = true; else entry.tier = 'SITUACIONAL';
        }
      }
    }
  }
  next.customTemplates = Array.isArray(imported.customTemplates) ? imported.customTemplates.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && item.picks && ROLES.every(role => championById.has(item.picks[role.id]))).slice(0,100) : [];
  const fallbackGame = { side: next.side, picks: { blue: { ...next.picks.blue }, red: { ...next.picks.red } }, bans: { blue: [...next.bans.blue], red: [...next.bans.red] }, slotRoles: { blue: [...next.slotRoles.blue], red: [...next.slotRoles.red] }, completed: false, completedAt: null };
  next.series = sanitizeSeries(imported.series, next.format, next.side, fallbackGame);
  if (imported.series?.games?.length) {
    const active = next.series.games[next.series.activeGame - 1];
    next.side = active.side;
    next.picks = { blue: { ...active.picks.blue }, red: { ...active.picks.red } };
    next.bans = { blue: [...active.bans.blue], red: [...active.bans.red] };
    next.slotRoles = { blue: [...active.slotRoles.blue], red: [...active.slotRoles.red] };
  } else {
    next.series.games[0] = fallbackGame;
  }
  return next;
}

async function importBackup(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload.product && !['VHAELDRON DRAFT LAB', 'VOIDKINGS DRAFT LAB', 'VOIDKINGS DRAFT LAB · VK SinADC'].includes(payload.product)) throw new Error('Este JSON pertenece a otra aplicación.');
    const imported = validImportedState(payload);
    if (!confirm('Importar este respaldo reemplazará la sala, el Champion Pool y las composiciones personalizadas actuales. ¿Continuar?')) return;
    state = imported;
    renderDraft();
    renderPool();
    renderTemplates();
    notify('Respaldo importado correctamente.');
  } catch (error) {
    notify(error.message || 'No se pudo importar el archivo.');
  } finally {
    $('#import-file').value = '';
  }
}

function exportDraft() {
  const payload = {
    product: 'VOIDKINGS DRAFT LAB · VK SinADC', version: 2, patch: '7.3d', exportedAt: new Date().toISOString(),
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `voidkings-vk-sinadc-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  notify('Draft exportado en JSON.');
}

function resetDraft() {
  if (currentGameIsCompleted()) return notify('El game está finalizado. Usa Nueva serie para comenzar otra serie.');
  if (!confirm('¿Reiniciar los picks y bans de esta partida? Tus prioridades CORE, alternativas y composiciones guardadas se conservarán.')) return;
  state.picks = { blue: EMPTY_TEAM(), red: EMPTY_TEAM() };
  state.bans = { blue: Array(5).fill(null), red: Array(5).fill(null) };
  state.slotRoles = { blue: [...DEFAULT_SLOT_ROLES], red: [...DEFAULT_SLOT_ROLES] };
  renderDraft();
  notify('Partida reiniciada. Champion Pool y biblioteca conservados.');
}

function clearOwnPicks() {
  if (currentGameIsCompleted()) return notify('El game está finalizado.');
  if (!confirm('¿Quitar los cinco picks de tu equipo? Los bans y el rival se conservarán.')) return;
  state.picks[ownTeam()] = EMPTY_TEAM();
  renderDraft();
  notify('Tus picks fueron limpiados.');
}

function bindEvents() {
  $$('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('#side-switch').addEventListener('click', event => {
    const button = event.target.closest('[data-side]');
    if (!button) return;
    if (currentGameIsCompleted()) return notify('Este game ya está finalizado; el lado de selección queda fijado.');
    state.side = button.dataset.side;
    renderDraft();
  });
  $('#format-select').addEventListener('change', event => {
    const nextFormat = event.target.value;
    const hasProgress = state.series.games.some(game => game.completed || [...Object.values(game.picks.blue), ...Object.values(game.picks.red), ...game.bans.blue, ...game.bans.red].some(Boolean));
    if (hasProgress && !confirm('Cambiar el formato reiniciará los games y los bloqueos Fearless de la serie actual. ¿Continuar?')) { renderSetup(); return; }
    startNewSeries(nextFormat);
    renderDraft();
    notify(`Nueva serie ${nextFormat} creada.`);
  });
  $('#finish-game-btn').addEventListener('click', finishCurrentGame);
  $('#next-game-btn').addEventListener('click', () => switchSeriesGame(state.series.activeGame + 1));
  $('#new-series-btn').addEventListener('click', () => {
    const hasProgress = state.series.games.some(game => game.completed || [...Object.values(game.picks.blue), ...Object.values(game.picks.red), ...game.bans.blue, ...game.bans.red].some(Boolean));
    if (hasProgress && !confirm('Se borrará el registro temporal de la serie y se liberarán todos los campeones Fearless. ¿Iniciar una nueva serie?')) return;
    startNewSeries(state.format);
    renderDraft();
    notify('Nueva serie iniciada. Los bloqueos Fearless anteriores se han limpiado.');
  });
  $('#export-btn').addEventListener('click', exportDraft);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', event => importBackup(event.target.files?.[0]));
  $('#save-template-btn').addEventListener('click', saveCurrentTemplate);
  $('#reset-btn').addEventListener('click', resetDraft);
  $('#recommend-btn').addEventListener('click', () => { renderDraft(); $('#recommendations-section').scrollIntoView({ behavior: 'smooth', block: 'center' }); notify('Recomendaciones actualizadas.'); });
  $('#fill-template-btn').addEventListener('click', () => setView('library'));
  $('#clear-own-btn').addEventListener('click', clearOwnPicks);

  document.addEventListener('change', event => {
    const slotRole = event.target.closest('[data-slot-role]');
    if (slotRole) setSlotRole(slotRole.dataset.slotRole, Number(slotRole.dataset.index), slotRole.value);
    const poolTier = event.target.closest('[data-pool-tier]');
    if (poolTier) setPoolTier(poolTier.dataset.role, poolTier.dataset.champion, poolTier.value);
  });
  document.addEventListener('click', event => {
    const seriesTab = event.target.closest('[data-series-game]');
    if (seriesTab) return switchSeriesGame(Number(seriesTab.dataset.seriesGame));
    const pickSlot = event.target.closest('[data-pick-slot]');
    if (pickSlot) {
      const { pickSlot: team, role } = pickSlot.dataset;
      if (event.target.closest('.remove-pick')) return removePick(team, role);
      return openPicker({ type: 'pick', team, role });
    }
    const banSlot = event.target.closest('[data-ban-slot]');
    if (banSlot) {
      const { banSlot: team, index } = banSlot.dataset;
      if (state.bans[team][Number(index)]) return removeBan(team, Number(index));
      return openPicker({ type: 'ban', team, index: Number(index) });
    }
    const selected = event.target.closest('[data-select-champion]');
    if (selected && !selected.disabled) return selectChampion(selected.dataset.selectChampion);
    const rec = event.target.closest('[data-select-rec]');
    if (rec) {
      if (currentGameIsCompleted()) return notify('Este game ya está finalizado.');
      const locked = seriesLockedMap();
      if (locked.has(rec.dataset.selectRec)) return notify(`${championName(rec.dataset.selectRec)} está bloqueado por Fearless Draft desde Game ${locked.get(rec.dataset.selectRec)}.`);
      if (allBanIds().includes(rec.dataset.selectRec)) return notify(`${championName(rec.dataset.selectRec)} está baneado en este game.`);
      if (allPickIds().includes(rec.dataset.selectRec)) return notify(`${championName(rec.dataset.selectRec)} ya está seleccionado en este game.`);
      const team = ownTeam();
      state.picks[team][rec.dataset.role] = rec.dataset.selectRec;
      renderDraft();
      return notify(`${championName(rec.dataset.selectRec)} añadido al draft.`);
    }
    const apply = event.target.closest('[data-apply-build]');
    if (apply) return applyBuild(Number(apply.dataset.applyBuild));
    const load = event.target.closest('[data-load-template]');
    if (load) return applyTemplate(load.dataset.loadTemplate);
    const removeTemplate = event.target.closest('[data-delete-template]');
    if (removeTemplate) return deleteCustomTemplate(removeTemplate.dataset.deleteTemplate);
    const close = event.target.closest('[data-close-modal]');
    if (close) closePicker();
    const filter = event.target.closest('[data-picker-filter]');
    if (filter) {
      pickerFilter = filter.dataset.pickerFilter;
      $$('#picker-filters button').forEach(button => button.classList.toggle('selected', button === filter));
      renderChampionOptions();
    }
  });

  $('#champion-search').addEventListener('input', renderChampionOptions);
  $('#pool-search').addEventListener('input', renderPool);
  $('#pool-role-filter').addEventListener('click', event => {
    const button = event.target.closest('[data-role]');
    if (!button) return;
    currentPoolRole = button.dataset.role;
    $$('#pool-role-filter button').forEach(item => item.classList.toggle('selected', item === button));
    renderPool();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePicker(); });
}

$('#login-form').addEventListener('submit', handleLogin);
$('#logout-btn').addEventListener('click', handleLogout);
window.addEventListener('online', () => {
  if (cloudReady && !cloudConflict) saveState();
});

checkSession().catch(error => {
  console.error('[VoidKings Draft Lab] No se pudo iniciar el workspace:', error);
  setAuthenticatedView(false);
  showAuthMessage(error.message || 'No fue posible cargar el workspace.', 'error');
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(registration => registration.update())
      .catch(error => console.warn('[VoidKings Draft Lab] No se pudo actualizar el service worker:', error));
  });
}
