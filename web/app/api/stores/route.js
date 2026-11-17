// Cadastro de loja, feito pelo app desktop em Ajustes > Pedido online.

import { sql } from '../../../lib/db.js';
import { newToken, hashToken, validSlug } from '../../../lib/auth.js';
import { json, fail, storeUrl } from '../../../lib/stores.js';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const slug = String(body.slug || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 80);
  if (!validSlug(slug)) {
    return fail('Endereço inválido. Use de 3 a 40 letras minúsculas, números ou hífen, sem acento.');
  }
  const token = newToken();
  const rows = await sql()`
    insert into stores (slug, token_hash, name) values (${slug}, ${hashToken(token)}, ${name})
    on conflict (slug) do nothing
    returning id`;
  if (rows.length === 0) return fail('Esse endereço já está em uso. Escolha outro.', 409);
  return json({ storeId: rows[0].id, slug, token, url: storeUrl(request, slug) }, 201);
}
