import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SESSION_COOKIE,
  createSessionCookie,
  createSessionToken,
  isSameOrigin,
  verifySessionRequest,
} from '../lib/server/auth.js';

const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(resolve(root, file), 'utf8');

 test('la sesión está firmada, expira y no acepta tokens alterados', () => {
  const previousPassword = process.env.APP_PASSWORD;
  const previousSecret = process.env.SESSION_SECRET;
  process.env.APP_PASSWORD = 'a-private-test-passphrase';
  process.env.SESSION_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  try {
    const now = Date.now();
    const token = createSessionToken(now);
    const request = { headers: { cookie: `${SESSION_COOKIE}=${token}` } };
    assert.equal(verifySessionRequest(request, now + 1000), true);
    assert.equal(verifySessionRequest(request, now + 8 * 24 * 60 * 60 * 1000), false);
    const tampered = { headers: { cookie: `${SESSION_COOKIE}=${token.slice(0, -1)}x` } };
    assert.equal(verifySessionRequest(tampered, now + 1000), false);
    assert.match(createSessionCookie(token), /HttpOnly/);
    assert.match(createSessionCookie(token), /SameSite=Strict/);
  } finally {
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test('las mutaciones solo admiten el mismo origen', () => {
  assert.equal(isSameOrigin({ headers: { origin: 'https://draft.example.com', host: 'draft.example.com' } }), true);
  assert.equal(isSameOrigin({ headers: { origin: 'https://evil.example', host: 'draft.example.com' } }), false);
  assert.equal(isSameOrigin({ headers: { host: 'draft.example.com' } }), false);
});

test('la persistencia usa Vercel Blob privado y escrituras condicionales', () => {
  const api = read('api/state.js');
  assert.match(api, /from '@vercel\/blob'/);
  assert.match(api, /access: 'private'/);
  assert.match(api, /useCache: false/);
  assert.match(api, /options\.ifMatch = expectedEtag/);
  assert.match(api, /STATE_CONFLICT/);
  assert.match(api, /verifySessionRequest/);
});

test('las rutas de autenticación y el frontend tienen control de sesión', () => {
  const login = read('api/auth/login.js');
  const session = read('api/auth/session.js');
  const logout = read('api/auth/logout.js');
  const html = read('index.html');
  const app = read('assets/js/app.js');
  assert.match(login, /APP_PASSWORD/);
  assert.match(login, /isSameOrigin/);
  assert.match(session, /verifySessionRequest/);
  assert.match(logout, /clearSessionCookie/);
  assert.match(html, /id="auth-gate"/);
  assert.match(app, /\/api\/auth\/login/);
  assert.match(app, /\/api\/state/);
  assert.match(app, /GUARDADO EN VERCEL/);
});

test('el service worker nunca cachea endpoints privados', () => {
  const sw = read('sw.js');
  assert.match(sw, /requestUrl\.pathname\.startsWith\('\/api\/'\)/);
});

test('la app mantiene una única fuente remota y no usa Supabase', () => {
  const app = read('assets/js/app.js');
  const pkg = JSON.parse(read('package.json'));
  assert.doesNotMatch(app, /supabase|createClient/i);
  assert.equal(pkg.dependencies['@vercel/blob'], '^2.3.1');
  assert.equal(pkg.version, '0.8.1');
});
