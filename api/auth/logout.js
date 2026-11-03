import { clearSessionCookie, isSameOrigin, sendJson } from '../../lib/server/auth.js';

export default function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Método no permitido.' });
  }
  if (!isSameOrigin(request)) return sendJson(response, 403, { error: 'Origen no permitido.' });
  return sendJson(response, 200, { authenticated: false }, { 'Set-Cookie': clearSessionCookie() });
}
