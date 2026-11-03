import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'vhaeldron_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function authIsConfigured() {
  return Boolean(
    process.env.APP_PASSWORD &&
    process.env.SESSION_SECRET &&
    process.env.SESSION_SECRET.length >= 32,
  );
}

export function safeEqual(left, right) {
  const a = createHash('sha256').update(String(left ?? '')).digest();
  const b = createHash('sha256').update(String(right ?? '')).digest();
  return timingSafeEqual(a, b);
}

function signature(value) {
  return createHmac('sha256', process.env.SESSION_SECRET)
    .update(value)
    .digest('base64url');
}

export function createSessionToken(now = Date.now()) {
  if (!authIsConfigured()) throw new Error('Authentication is not configured.');
  const payload = Buffer.from(JSON.stringify({
    sub: 'vhaeldron-owner',
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function parseCookieHeader(cookieHeader = '') {
  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies[name] = value;
  }
  return cookies;
}

export function verifySessionRequest(request, now = Date.now()) {
  if (!authIsConfigured()) return false;
  const token = parseCookieHeader(request.headers.cookie || '')[SESSION_COOKIE];
  if (!token) return false;
  const [payload, providedSignature, extra] = token.split('.');
  if (!payload || !providedSignature || extra) return false;
  if (!safeEqual(providedSignature, signature(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const current = Math.floor(now / 1000);
    return data.sub === 'vhaeldron-owner' && Number.isInteger(data.exp) && data.exp > current;
  } catch {
    return false;
  }
}

export function createSessionCookie(token) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function isSameOrigin(request) {
  const origin = request.headers.origin;
  const hostHeader = request.headers['x-forwarded-host'] || request.headers.host;
  if (!origin || !hostHeader) return false;
  try {
    const originUrl = new URL(origin);
    const expectedHost = String(hostHeader).split(',')[0].trim().toLowerCase();
    return ['https:', 'http:'].includes(originUrl.protocol) && originUrl.host.toLowerCase() === expectedHost;
  } catch {
    return false;
  }
}

export function readJsonBody(request) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  if (typeof request.body === 'string') return JSON.parse(request.body);
  if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString('utf8'));
  return {};
}

export function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  response.end(JSON.stringify(payload));
}
