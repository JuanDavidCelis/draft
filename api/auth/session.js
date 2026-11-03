import { authIsConfigured, verifySessionRequest, sendJson } from '../../lib/server/auth.js';

export default function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { error: 'Método no permitido.' });
  }
  if (!authIsConfigured()) {
    return sendJson(response, 503, {
      authenticated: false,
      code: 'AUTH_NOT_CONFIGURED',
      error: 'Falta configurar APP_PASSWORD y SESSION_SECRET en Vercel.',
    });
  }
  return sendJson(response, 200, { authenticated: verifySessionRequest(request) });
}
