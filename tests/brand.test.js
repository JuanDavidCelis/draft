import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(resolve(root, file), 'utf8');

test('la identidad visible es VoidKings y VK SinADC', () => {
  const html = read('index.html');
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const app = read('assets/js/app.js');
  const catalog = read('assets/js/catalog.js');
  assert.match(html, /VOIDKINGS/);
  assert.match(html, /VK SinADC/i);
  assert.doesNotMatch(html, /VHAELDRON/i);
  assert.equal(manifest.name, 'VoidKings Draft Lab');
  assert.ok(read('assets/icons/voidkings-logo.svg').includes('VK'));
  assert.ok(read('assets/icons/icon-512.png').length > 1000);
  assert.match(manifest.description, /VK SinADC/);
  assert.match(app, /VOIDKINGS DRAFT LAB · VK SINADC/i);
  assert.match(app, /VK SINADC/i);
  assert.match(app, /voidkings-draft-lab-cache-v3/);
  assert.match(app, /LEGACY_STORAGE_KEYS = \['vhaeldron-draft-lab-cache-v2'/);
  assert.match(catalog, /VOIDKINGS DRAFT LAB/);
});

test('el cambio de marca conserva compatibilidad con respaldos anteriores', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /'VHAELDRON DRAFT LAB', 'VOIDKINGS DRAFT LAB'/);
  assert.match(app, /voidkings-vk-sinadc-backup-/);
});

test('la nueva PWA usa caché VoidKings y limpia la caché previa sin afectar datos privados', () => {
  const sw = read('sw.js');
  assert.match(sw, /voidkings-draft-lab-v0-5-0/);
  assert.match(sw, /vhaeldron-draft-lab-/); // cache name migration only
  assert.match(sw, /requestUrl\.pathname\.startsWith\('\/api\/'\)/);
});
