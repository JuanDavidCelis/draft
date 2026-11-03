/** Pure draft-intelligence helpers. Scores are heuristics, not win-probability estimates. */
export const PICK_SEQUENCE = [
  ['blue', 0, 1], ['red', 0, 2], ['red', 1, 3], ['blue', 1, 4], ['blue', 2, 5],
  ['red', 2, 6], ['red', 3, 7], ['blue', 3, 8], ['blue', 4, 9], ['red', 4, 10],
];

export function getSidePickSlots(side, slotRoles, picks) {
  return PICK_SEQUENCE
    .filter(([team]) => team === side)
    .map(([team, index, turn]) => {
      const role = slotRoles[team][index];
      return { team, index, turn, role, champion: picks[team]?.[role] || null };
    });
}

export function getNextSidePick(side, slotRoles, picks) {
  return getSidePickSlots(side, slotRoles, picks).find(slot => !slot.champion) || null;
}

export function getLastSidePick(side, slotRoles, picks) {
  const slots = getSidePickSlots(side, slotRoles, picks);
  return slots[slots.length - 1] || null;
}


function pairWeight(pairs, sourceId, targetId) {
  return pairs.find(([source, target]) => source === sourceId && target === targetId)?.[2] || 0;
}

function priorityWeight(tier) {
  if (tier === 'CORE') return 3.2;
  if (tier === 'ALT 1') return 2.4;
  if (tier === 'ALT 2') return 1.8;
  return 0.5;
}

/**
 * Contextual pick score. This is an explainable heuristic, not a win-rate or
 * champion-strength prediction. All inputs are supplied by the caller.
 */
export function scoreCandidateForDraft({
  champion, role, current, enemy, currentIds = [], enemyIds = [],
  opposingLaneChampion = null, synergies = [], counters = [], tier = 'SITUACIONAL', patchWeight = 0,
}) {
  if (!champion || !current || !enemy) return Number.NEGATIVE_INFINITY;
  let score = priorityWeight(tier);
  if (champion.damage === 'magic' && current.physical >= 2 && current.magic === 0) score += 2.5;
  if (champion.damage === 'physical' && current.magic >= 2 && current.physical === 0) score += 2.2;
  if ((champion.damage === 'mixed' || champion.damage === 'true') && current.physical >= 3) score += 0.7;
  if (current.frontline < 2 && champion.frontline > 0) score += 2.0;
  if (current.engage < 2 && champion.engage > 0) score += 1.4;
  if (current.cc < 2 && champion.cc > 0) score += 1.0;
  if (enemy.frontline >= 5) score += champion.antiTank * 2.4;
  else if (enemy.frontline >= 2) score += champion.antiTank * 1.35;
  if (enemy.dive >= 4) score += champion.peel * 1.0;
  if (enemy.poke >= 4) score += champion.engage * 0.8 + champion.dive * 0.35;
  if (enemy.engage >= 5) score += champion.peel * 0.75;
  if (opposingLaneChampion) {
    score += pairWeight(counters, champion.id, opposingLaneChampion.id) * 1.8;
    score -= pairWeight(counters, opposingLaneChampion.id, champion.id) * 1.1;
  }
  if (role === 'support') {
    const adc = current.champs?.find(c => c.roles.includes('adc'));
    if (adc?.tags?.includes('protect-carry') || adc?.id === 'kog-maw') score += champion.peel * 1.15;
    if (current.frontline < 2) score += champion.frontline * 0.55;
    if (enemy.engage >= 4) score += champion.peel * 0.7;
  }
  if (role === 'mid' && current.magic === 0 && champion.damage === 'magic') score += 2;
  for (const ownId of currentIds) {
    score += (pairWeight(synergies, champion.id, ownId) || pairWeight(synergies, ownId, champion.id)) * 0.55;
  }
  for (const enemyId of enemyIds) score += pairWeight(counters, champion.id, enemyId) * 0.9;
  score += patchWeight;
  return score;
}

export function summarizeTeam(ids, championMap) {
  const champs = ids.map(id => championMap.get(id)).filter(Boolean);
  return {
    champs,
    physical: champs.filter(champ => champ.damage === 'physical').length,
    magic: champs.filter(champ => champ.damage === 'magic').length,
    mixed: champs.filter(champ => champ.damage === 'mixed').length,
    trueDamage: champs.filter(champ => champ.damage === 'true').length,
    frontline: champs.reduce((sum, champ) => sum + (champ.frontline || 0), 0),
    engage: champs.reduce((sum, champ) => sum + (champ.engage || 0), 0),
    cc: champs.reduce((sum, champ) => sum + (champ.cc || 0), 0),
    peel: champs.reduce((sum, champ) => sum + (champ.peel || 0), 0),
    poke: champs.reduce((sum, champ) => sum + (champ.poke || 0), 0),
    antiTank: champs.reduce((sum, champ) => sum + (champ.antiTank || 0), 0),
    scaling: champs.reduce((sum, champ) => sum + (champ.scaling || 0), 0),
    dive: champs.reduce((sum, champ) => sum + (champ.dive || 0), 0),
    waveclear: champs.reduce((sum, champ) => sum + (champ.waveclear || 0), 0),
  };
}

export function classifyComposition(stats, ids = [], championMap = new Map()) {
  const champions = ids.map(id => championMap.get(id)).filter(Boolean);
  if ((ids.includes('kog-maw') || ids.includes('jinx') || ids.includes('smolder')) && stats.peel >= 2 && stats.scaling >= 4) return 'Protect the carry';
  if (stats.antiTank >= 4) return 'Anti-tank / DPS sostenido';
  if (stats.poke >= 5 && stats.waveclear >= 2) return 'Poke / siege';
  if (stats.dive >= 5) return 'Dive / pick';
  if (stats.engage >= 5 && stats.cc >= 4) return 'Engage / teamfight';
  if (stats.frontline >= 5 && stats.peel >= 3) return 'Frontline / contraengage';
  if (stats.scaling >= 6) return 'Escalado';
  if (champions.some(champ => champ.tags?.includes('split'))) return 'Side lane / split push';
  return 'Flexible / control de mapa';
}


const ROLE_PRIORITY_LABELS = {
  baron: 'Barón', jungle: 'Jungla · tempo', mid: 'Mid', adc: 'ADC', support: 'Soporte',
};

function pairValue(pairs, sourceId, targetId) {
  return pairs.find(([source, target]) => source === sourceId && target === targetId)?.[2] || 0;
}

function laneProfileValue(champion, role) {
  if (!champion) return 0;
  const tags = champion.tags || [];
  const has = tag => tags.includes(tag);
  if (role === 'baron') return (has('lane-pressure') ? 1.1 : 0) + (champion.poke || 0) * 0.16 + (champion.waveclear || 0) * 0.12 + (champion.antiTank || 0) * 0.12;
  if (role === 'jungle') return (has('early') ? 1.0 : 0) + (champion.dive || 0) * 0.22 + (champion.engage || 0) * 0.14 + (champion.cc || 0) * 0.1;
  if (role === 'mid') return (champion.waveclear || 0) * 0.28 + (champion.poke || 0) * 0.2 + (champion.cc || 0) * 0.12;
  if (role === 'adc') return (has('lane-pressure') ? 0.8 : 0) + (champion.poke || 0) * 0.2 + (champion.waveclear || 0) * 0.12;
  if (role === 'support') return (champion.engage || 0) * 0.18 + (champion.cc || 0) * 0.16 + (champion.peel || 0) * 0.12 + (champion.poke || 0) * 0.1;
  return 0;
}

export function analyzeLanePriority(ownRolePicks, enemyRolePicks, championMap, counterPairs = [], synergyPairs = []) {
  const roles = ['baron', 'jungle', 'mid', 'adc', 'support'];
  return roles.map(role => {
    const ownId = ownRolePicks?.[role];
    const enemyId = enemyRolePicks?.[role];
    const ownChampion = championMap.get(ownId);
    const enemyChampion = championMap.get(enemyId);
    if (!ownChampion || !enemyChampion) {
      return { role, label: ROLE_PRIORITY_LABELS[role], ownChampion: ownChampion?.name || null, enemyChampion: enemyChampion?.name || null, priority: 'Pendiente', score: 0, explanation: 'Falta uno de los dos picks para comparar este emparejamiento.' };
    }
    const ownCounter = pairValue(counterPairs, ownId, enemyId);
    const enemyCounter = pairValue(counterPairs, enemyId, ownId);
    let score = (ownCounter - enemyCounter) * 1.25;
    score += laneProfileValue(ownChampion, role) - laneProfileValue(enemyChampion, role);
    if (role === 'adc' || role === 'support') {
      const ownAdc = ownRolePicks?.adc;
      const ownSupport = ownRolePicks?.support;
      const enemyAdc = enemyRolePicks?.adc;
      const enemySupport = enemyRolePicks?.support;
      if (ownAdc && ownSupport && ownId === ownAdc) score += pairValue(synergyPairs, ownAdc, ownSupport) * 0.18;
      if (ownAdc && ownSupport && ownId === ownSupport) score += pairValue(synergyPairs, ownAdc, ownSupport) * 0.18;
      if (enemyAdc && enemySupport && enemyId === enemyAdc) score -= pairValue(synergyPairs, enemyAdc, enemySupport) * 0.18;
      if (enemyAdc && enemySupport && enemyId === enemySupport) score -= pairValue(synergyPairs, enemyAdc, enemySupport) * 0.18;
    }
    const priority = score >= 1.8 ? 'Prioridad VK' : score <= -1.8 ? 'Prioridad rival' : 'Emparejamiento disputado';
    let explanation = 'No hay un counter directo suficientemente fuerte en los datos; la prioridad dependerá de oleadas, ejecución, visión y apoyo del jungla.';
    if (ownCounter > enemyCounter) explanation = `${ownChampion.name} tiene una respuesta favorable registrada contra ${enemyChampion.name}. Debe convertirla en control de oleada y rotación.`;
    else if (enemyCounter > ownCounter) explanation = `${enemyChampion.name} tiene una respuesta favorable registrada contra ${ownChampion.name}. Evita intercambios repetidos sin apoyo.`;
    else if (score > 0.7) explanation = `El perfil de ${ownChampion.name} aporta más presión potencial en esta posición; confirma la prioridad controlando la oleada.`;
    else if (score < -0.7) explanation = `El perfil de ${enemyChampion.name} aporta más presión potencial; evita ceder tempo y pide cobertura si la oleada queda expuesta.`;
    return { role, label: ROLE_PRIORITY_LABELS[role], ownChampion: ownChampion.name, enemyChampion: enemyChampion.name, priority, score: Number(score.toFixed(2)), ownCounter, enemyCounter, explanation };
  });
}

function weightedCompositionProfile(stats) {
  return (stats.frontline * 0.62) + (stats.engage * 0.72) + (stats.cc * 0.58) +
    (stats.peel * 0.66) + (stats.poke * 0.52) + (stats.antiTank * 0.62) +
    (stats.scaling * 0.48) + (stats.dive * 0.48) + (stats.waveclear * 0.42);
}

export function estimateDraftAdvantage(ownStats, enemyStats, ownIds, enemyIds, championMap, counterPairs = [], synergyPairs = [], lanePriority = []) {
  const ownSynergy = ownIds.reduce((sum, id, index) => sum + ownIds.slice(index + 1).reduce((pairSum, other) => pairSum + Math.max(pairValue(synergyPairs, id, other), pairValue(synergyPairs, other, id)), 0), 0);
  const enemySynergy = enemyIds.reduce((sum, id, index) => sum + enemyIds.slice(index + 1).reduce((pairSum, other) => pairSum + Math.max(pairValue(synergyPairs, id, other), pairValue(synergyPairs, other, id)), 0), 0);
  const ownCounters = ownIds.reduce((sum, ownId) => sum + enemyIds.reduce((inner, enemyId) => inner + pairValue(counterPairs, ownId, enemyId), 0), 0);
  const enemyCounters = enemyIds.reduce((sum, enemyId) => sum + ownIds.reduce((inner, ownId) => inner + pairValue(counterPairs, enemyId, ownId), 0), 0);
  const laneEdge = lanePriority.reduce((sum, lane) => sum + lane.score, 0);
  const rawDifference = weightedCompositionProfile(ownStats) - weightedCompositionProfile(enemyStats) +
    (ownSynergy - enemySynergy) * 0.42 + (ownCounters - enemyCounters) * 0.48 + laneEdge * 0.35;
  const ownEstimate = Math.max(38, Math.min(62, Math.round(50 + rawDifference * 0.32)));
  return {
    own: ownEstimate,
    enemy: 100 - ownEstimate,
    rawDifference: Number(rawDifference.toFixed(2)),
    favored: ownEstimate >= 53 ? 'VK SinADC' : ownEstimate <= 47 ? 'Rival' : 'Draft parejo',
    confidence: Math.abs(rawDifference) >= 12 ? 'moderada' : 'baja',
    label: 'Estimación heurística de draft; no representa win rate histórico ni una predicción del resultado.',
  };
}

function ownCountComplete(ownIds, enemyIds) { return ownIds.length === 5 && enemyIds.length === 5; }

export function compareCompositions(ownIds, enemyIds, championMap, counterPairs = [], enemyRolePicks = {}, ownRolePicks = {}, synergyPairs = []) {
  const own = summarizeTeam(ownIds, championMap);
  const enemy = summarizeTeam(enemyIds, championMap);
  const ownStyle = classifyComposition(own, ownIds, championMap);
  const enemyStyle = classifyComposition(enemy, enemyIds, championMap);
  const counterMap = new Map(counterPairs.map(([counter, target, weight]) => [`${counter}|${target}`, weight]));
  const edges = [];
  for (const ownId of ownIds) {
    for (const enemyId of enemyIds) {
      const weight = counterMap.get(`${ownId}|${enemyId}`) || 0;
      if (weight > 0) edges.push({ counter: ownId, target: enemyId, weight });
    }
  }
  edges.sort((a, b) => b.weight - a.weight);

  const actions = [];
  if (enemy.frontline >= 5) {
    if (own.antiTank >= 4) actions.push({ type: 'good', title: 'Tenemos herramientas contra la frontline', text: 'No gastes todo el daño sobre la línea trasera: pega al objetivo más cercano y seguro. Extiende la pelea para aprovechar el daño porcentual o verdadero.' });
    else actions.push({ type: 'warning', title: 'Nos falta daño sostenido contra tanques', text: 'Considera una fuente anti-tanque en la última selección o en el rol aún abierto: Fiora, Gwen, Lillia, Brand, Vayne, Kog’Maw o Varus. No basta con acumular burst.' });
  }
  if (enemy.dive >= 4) {
    if (own.peel >= 3) actions.push({ type: 'good', title: 'Podemos responder al dive', text: 'Reserva el desplazamiento, aturdimiento o definitiva defensiva para cuando entren sobre el carry. No gastes todo el peel para iniciar.' });
    else actions.push({ type: 'warning', title: 'La línea trasera es vulnerable', text: 'Prioriza un soporte o campeón con peel: Braum, Janna, Lulu, Thresh o Galio. Juega agrupado y evita que el ADC rote solo.' });
  }
  if (enemy.poke >= 4 && own.engage >= 4) actions.push({ type: 'good', title: 'Respuesta al poke: iniciar desde un ángulo', text: 'No camines de frente por el río recibiendo desgaste. Limpia la oleada, busca flanco o usa niebla de guerra para iniciar antes de perder vida.' });
  else if (enemy.poke >= 4 && own.engage < 4) actions.push({ type: 'warning', title: 'El rival puede desgastarnos antes de objetivos', text: 'Evita entrar a zonas abiertas con poca vida. Necesitamos despejar oleadas, controlar visión con apoyo y disputar solo cuando tengamos prioridad o una ventana clara.' });
  if (own.poke >= 4 && enemy.engage >= 4) actions.push({ type: 'good', title: 'No regalar una iniciación al rival', text: 'Mantén distancia y desgasta antes de que el rival alcance rango de engage. No agrupes a los cinco en una zona estrecha si sus definitivas están disponibles.' });
  if (own.engage >= 5 && own.cc >= 4) actions.push({ type: 'good', title: 'Nuestra ventana es el control encadenado', text: 'Coordina la primera iniciación con el follow-up. Evita gastar todas las definitivas sobre un tanque aislado si no puedes convertirlo en objetivo.' });
  if (own.dive >= 4) actions.push({ type: 'info', title: 'Jugar hacia la línea trasera', text: 'Busca entradas sincronizadas sobre el ADC o Mid rival. Si no puedes llegar a ellos, cambia a un pick previo o fuerza superioridad numérica antes del objetivo.' });
  if (own.scaling >= 6 && enemy.scaling < 4) actions.push({ type: 'info', title: 'Tenemos ventaja si la partida se alarga', text: 'Protege las oleadas, evita peleas sin objetivo y alcanza los picos de objetos. Si el enemigo tiene presión temprana, intercambia objetivos en vez de aceptar una pelea desventajosa.' });
  if (enemy.scaling >= 6 && ownIds.some(id => ['lee-sin', 'renekton', 'draven', 'pantheon', 'early'].includes(id))) actions.push({ type: 'info', title: 'Debemos acelerar el tempo', text: 'Convierte la prioridad de líneas en invasiones, placas y primeros objetivos. No dejes que el rival farmee sin presión hasta sus picos de escalado.' });
  if (!actions.length) actions.push({ type: 'info', title: 'Jugar por la información y los tiempos', text: 'Sin una ventaja de composición evidente, prepara las oleadas antes de objetivos, protege la visión y pelea cuando estén disponibles tus herramientas principales.' });

  const enemyCarry = championMap.get(enemyRolePicks.adc);
  const enemyMid = championMap.get(enemyRolePicks.mid);
  const focus = [enemyCarry, enemyMid].filter(Boolean).map(champ => champ.name);
  const metrics = [
    ['Frontline', 'frontline'], ['Iniciación', 'engage'], ['Control', 'cc'],
    ['Protección', 'peel'], ['Poke', 'poke'], ['Anti-tanque', 'antiTank'], ['Escalado', 'scaling'],
  ].map(([label, key]) => ({ label, key, own: own[key], enemy: enemy[key] }));
  const lanePriority = analyzeLanePriority(ownRolePicks, enemyRolePicks, championMap, counterPairs, synergyPairs);
  const draftAdvantage = ownCountComplete(ownIds, enemyIds)
    ? estimateDraftAdvantage(own, enemy, ownIds, enemyIds, championMap, counterPairs, synergyPairs, lanePriority)
    : null;
  const earlyPlan = own.scaling >= 6 && enemy.scaling < 5
    ? 'Juega los primeros minutos sin regalar eliminaciones. Asegura oleadas y experiencia; acepta intercambiar un objetivo menor si el rival fuerza una pelea antes de tus picos.'
    : own.dive >= 4 || own.engage >= 5
      ? 'Busca prioridad de mid y jungla para mover primero. Coordina la primera rotación con el jungla y castiga líneas sin destello o sin movilidad.'
      : own.poke >= 4
        ? 'Mantén prioridad de oleadas y desgaste desde rango. No persigas kills: usa la vida que quitas para ganar placas, visión y espacio.'
        : 'Estabiliza las tres líneas, identifica qué carril tiene prioridad y acompaña al jungla cuando el objetivo sea disputable. Evita rotaciones sin oleada preparada.';
  const objectivePlan = own.poke >= 4
    ? 'Llega temprano, controla entradas y golpea desde fuera antes de iniciar. Si el rival conserva toda su vida, no fuerces el 50/50.'
    : own.engage >= 5 && own.cc >= 4
      ? 'Prepara las oleadas antes del objetivo y ocupa una entrada con niebla de guerra. Guarda al menos una definitiva de seguimiento para la iniciación.'
      : own.peel >= 3
        ? 'Coloca visión defensiva y deja que el rival entre en tu zona. Mantén al ADC cerca de la frontline y gana la pelea por contraataque.'
        : 'Prioriza control de visión y superioridad numérica. Si el rival llega primero y tiene mejor posición, intercambia el objetivo por oleadas o estructura.';
  const fightPlan = ownStyle.includes('Protect')
    ? 'Pelea front-to-back: golpea al enemigo más cercano, reserva el peel para quien salte sobre el carry y no persigas al tanque hacia la retaguardia.'
    : ownStyle.includes('Anti-tank')
      ? 'Alarga los intercambios y destruye la frontline desde una posición segura. No gastes todo el daño de Fiora, Vayne o Brand intentando saltar directamente al ADC.'
      : ownStyle.includes('Poke')
        ? 'Desgasta antes de entrar, separa al rival y evita que os fuerce una pelea cuando aún estáis agrupados o con habilidades clave en enfriamiento.'
        : ownStyle.includes('Dive')
          ? 'Sincroniza la entrada de jungla, Barón y Mid sobre el carry. Si la backline está protegida, cambia a pick sobre el enemigo que se separe.'
          : own.engage >= 5
            ? 'Encadena iniciación y seguimiento; el equipo debe entrar en la misma ventana. No uses todas las definitivas sobre un objetivo aislado.'
            : 'Define una señal única de entrada. Mantén la formación, respeta los cooldowns de control enemigos y pelea alrededor de la condición de victoria seleccionada.';
  return {
    own, enemy, ownStyle, enemyStyle, edges: edges.slice(0, 4), actions: actions.slice(0, 5),
    focus, metrics, earlyPlan, objectivePlan, fightPlan, lanePriority, draftAdvantage, ownCount: ownIds.length, enemyCount: enemyIds.length,
    draftStatus: enemyIds.length < 5 ? 'Lectura provisional: faltan picks del rival.' : 'Composición rival completa: lectura de matchup disponible.',
  };
}
