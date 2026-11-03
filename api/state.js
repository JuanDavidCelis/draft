import { get, put } from '@vercel/blob';
import {
  isSameOrigin,
  readJsonBody,
  sendJson,
  verifySessionRequest,
} from '../lib/server/auth.js';

const STATE_PATH = 'vhaeldron-draft-lab/private/state-v1.json';
const MAX_STATE_BYTES = 2 * 1024 * 1024;

function validStateShape(state) {
  return Boolean(
    state && typeof state === 'object' && !Array.isArray(state) &&
    state.picks && typeof state.picks === 'object' &&
    state.bans && typeof state.bans === 'object' &&
    state.pool && typeof state.pool === 'object' &&
    Array.isArray(state.customTemplates)
  );
}

async function currentDocument() {
  const result = await get(STATE_PATH, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const text = await new Response(result.stream).text();
  let document;
  try { document = JSON.parse(text); }
  catch { throw new Error('El archivo persistido no contiene JSON válido.'); }
  return { document, etag: result.blob.etag };
}

export default async function handler(request, response) {
  response.setHeader('Vary', 'Cookie');
  if (!['GET', 'PUT'].includes(request.method)) {
    response.setHeader('Allow', 'GET, PUT');
    return sendJson(response, 405, { error: 'Método no permitido.' });
  }
  if (request.method === 'PUT' && !isSameOrigin(request)) {
    return sendJson(response, 403, { error: 'Origen no permitido.' });
  }
  if (!verifySessionRequest(request)) {
    return sendJson(response, 401, { error: 'La sesión expiró. Inicia sesión nuevamente.', code: 'UNAUTHENTICATED' });
  }

  try {
    if (request.method === 'GET') {
      const current = await currentDocument();
      if (!current) return sendJson(response, 200, { state: null, etag: null, updatedAt: null });
      return sendJson(response, 200, {
        state: current.document.state,
        updatedAt: current.document.updatedAt || null,
        etag: current.etag,
      });
    }

    let body;
    try { body = readJsonBody(request); }
    catch { return sendJson(response, 400, { error: 'El cuerpo JSON no es válido.' }); }

    if (!validStateShape(body.state)) {
      return sendJson(response, 400, { error: 'La estructura del estado no es válida.' });
    }

    const serializedState = JSON.stringify(body.state);
    const byteLength = Buffer.byteLength(serializedState, 'utf8');
    if (byteLength > MAX_STATE_BYTES) {
      return sendJson(response, 413, { error: 'El respaldo supera el límite de 2 MB.' });
    }

    const expectedEtag = typeof body.etag === 'string' && body.etag.length < 200 ? body.etag : null;
    const current = await currentDocument();

    if (current && (!expectedEtag || current.etag !== expectedEtag)) {
      return sendJson(response, 409, {
        error: 'Los datos cambiaron en otra pestaña o dispositivo. Recarga para evitar sobrescribir cambios.',
        code: 'STATE_CONFLICT',
        etag: current.etag,
      });
    }
    if (!current && expectedEtag) {
      return sendJson(response, 409, {
        error: 'El respaldo remoto ya no existe. Recarga antes de guardar.',
        code: 'STATE_CONFLICT',
        etag: null,
      });
    }

    const document = JSON.stringify({
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      state: body.state,
    });
    const options = {
      access: 'private',
      contentType: 'application/json; charset=utf-8',
      cacheControlMaxAge: 60,
    };
    if (current) {
      options.allowOverwrite = true;
      options.ifMatch = expectedEtag;
    }

    let saved;
    try {
      saved = await put(STATE_PATH, document, options);
    } catch (error) {
      // If the ETag changed between the read and write, return a clean conflict.
      const latest = await currentDocument().catch(() => null);
      if (latest && latest.etag !== expectedEtag) {
        return sendJson(response, 409, {
          error: 'Otro guardado se adelantó. Recarga para conservar la versión más reciente.',
          code: 'STATE_CONFLICT',
          etag: latest.etag,
        });
      }
      throw error;
    }

    return sendJson(response, 200, {
      saved: true,
      etag: saved.etag,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[VoidKings/state]', error);
    const message = String(error?.message || 'Error inesperado');
    const storageNotConfigured = /BLOB_STORE_ID|VERCEL_OIDC_TOKEN|BLOB_READ_WRITE_TOKEN|store.*not found|not connected/i.test(message);
    return sendJson(response, storageNotConfigured ? 503 : 500, {
      code: storageNotConfigured ? 'BLOB_NOT_CONFIGURED' : 'STATE_STORAGE_ERROR',
      error: storageNotConfigured
        ? 'Vercel Blob no está conectado al proyecto. Crea un Blob privado y conéctalo en Storage.'
        : 'No se pudo leer o guardar la información en Vercel Blob.',
    });
  }
}
