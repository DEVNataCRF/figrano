// A página de acompanhamento consulta o status do pedido. O id é um UUID
// aleatório, então só quem fez o pedido conhece o link.

import { sql } from '../../../../../../lib/db.js';
import { json, fail } from '../../../../../../lib/stores.js';

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_request, { params }) {
  const { slug, id } = await params;
  if (!UUID.test(id)) return fail('Pedido não encontrado.', 404);
  const [row] = await sql()`
    select o.status, o.local_number, o.updated_at from orders o join stores s on s.id = o.store_id
    where o.id = ${id} and s.slug = ${String(slug)}`;
  if (!row) return fail('Pedido não encontrado.', 404);
  return json({ status: row.status, number: row.local_number, updatedAt: new Date(row.updated_at).toISOString() });
}
