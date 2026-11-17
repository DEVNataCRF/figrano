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

/** Endereço público da página da loja. */
export function storeUrl(request, slug) {
  const base = process.env.PUBLIC_URL || new URL(request.url).origin;
  return `${base.replace(/\/+$/, '')}/${slug}`;
}
