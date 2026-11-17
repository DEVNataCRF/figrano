import { sql } from './db.js';
import { bearerToken, hashToken } from './auth.js';

export const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export const fail = (message, status = 400) => json({ error: message }, status);

/** Loja dona do token enviado pelo app desktop, ou null. */
export async function storeFromToken(request) {
  const token = bearerToken(request);
  if (!token) return null;
  const [store] = await sql()`select * from stores where token_hash = ${hashToken(token)}`;
  return store || null;
}

export async function storeBySlug(slug) {
  const [store] = await sql()`select * from stores where slug = ${String(slug)}`;
  return store || null;
}

/** O app desktop deu sinal de vida. */
export async function touch(storeId) {
  await sql()`update stores set last_seen_at = now() where id = ${storeId}`;
}

/**
 * Endereço público da página da loja. Em produção vem de PUBLIC_URL; sem
 * ela, usa o endereço que o app desktop usou para chegar aqui (cabeçalho
 * Host), e não o endereço em que o servidor escuta, que pode ser 0.0.0.0.
 */
export function storeUrl(request, slug) {
  let base = process.env.PUBLIC_URL;
  if (!base) {
    const url = new URL(request.url);
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
    const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
    base = `${proto}://${host}`;
  }
  return `${base.replace(/\/+$/, '')}/${slug}`;
}
