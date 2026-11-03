import {
  authIsConfigured,
  createSessionCookie,
  createSessionToken,
  isSameOrigin,
  readJsonBody,
  safeEqual,
  sendJson,
} from '../../lib/server/auth.js';

export default function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Método no permitido.' });
  }
  if (!isSameOrigin(request)) return sendJson(response, 403, { error: 'Origen no permitido.' });
  if (!authIsConfigured()) {
    return sendJson(response, 503, {
      code: 'AUTH_NOT_CONFIGURED',
      error: 'Configura APP_PASSWORD y SESSION_SECRET en Vercel antes de iniciar sesión.',
    });
  }

  let body;
  try { body = readJsonBody(request); }
  catch { return sendJson(response, 400, { error: 'Solicitud no válida.' }); }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!safeEqual(password, process.env.APP_PASSWORD)) {
    return sendJson(response, 401, { error: 'Contraseña incorrecta.' });
  }

  const token = createSessionToken();
  return sendJson(response, 200, { authenticated: true }, { 'Set-Cookie': createSessionCookie(token) });
}
