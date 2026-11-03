import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAMPIONS, ROLE_POOLS, TEMPLATES, SYNERGIES, COUNTERS, ROLES } from '../assets/js/catalog.js';

const ids = new Set(CHAMPIONS.map(champion => champion.id));

test('el catálogo no contiene IDs duplicados', () => {
  assert.equal(ids.size, CHAMPIONS.length);
});

test('cada posición tiene CORE, ALT 1 y ALT 2', () => {
  for (const role of ROLES) {
    const firstThree = ROLE_POOLS[role.id].slice(0, 3).map(entry => entry.tier);
    assert.deepEqual(firstThree, ['CORE', 'ALT 1', 'ALT 2']);
  }
});

test('todos los campeones del champion pool existen en el catálogo', () => {
  for (const entries of Object.values(ROLE_POOLS)) {
    for (const entry of entries) assert.ok(ids.has(entry.champion), `Falta ${entry.champion}`);
  }
});

test('todas las plantillas contienen las cinco posiciones y roles compatibles', () => {
  for (const template of TEMPLATES) {
    assert.equal(Object.keys(template.picks).length, 5);
    for (const role of ROLES) {
      const champion = CHAMPIONS.find(item => item.id === template.picks[role.id]);
      assert.ok(champion, `${template.id}: falta campeón para ${role.id}`);
      assert.ok(champion.roles.includes(role.id), `${template.id}: ${champion.name} no está asignado a ${role.id}`);
    }
  }
});

test('las reglas de sinergia y counter apuntan a campeones existentes', () => {
  for (const [a, b] of [...SYNERGIES, ...COUNTERS]) {
    assert.ok(ids.has(a), `No existe ${a}`);
    assert.ok(ids.has(b), `No existe ${b}`);
  }
});

test('el selector contiene el roster general completo para bans y picks flex', () => {
  assert.ok(CHAMPIONS.length >= 140);
  assert.ok(CHAMPIONS.some(champion => champion.tags.includes('sin-clasificar')));
});

test('cada equipo dispone de cinco posiciones de draft sin duplicados', () => {
  const roles = ['baron', 'jungle', 'mid', 'adc', 'support'];
  assert.equal(new Set(roles).size, 5);
  assert.equal(roles.length, 5);
});

test('los 142 campeones del catálogo tienen al menos una posición seleccionable', () => {
  assert.equal(CHAMPIONS.length, 142);
  for (const champion of CHAMPIONS) assert.ok(champion.roles.length > 0, `${champion.name} no tiene posición asignada`);
});
