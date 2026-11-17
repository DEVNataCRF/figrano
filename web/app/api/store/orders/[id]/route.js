// O app desktop confirma que recebeu o pedido (com o número local) e depois
// avisa cada mudança de status, que a página de acompanhamento mostra.

import { sql, orderRow } from '../../../../../lib/db.js';
import { json, fail, storeFromToken } from '../../../../../lib/stores.js';

const STATUSES = new Set(['new', 'preparing', 'out', 'ready', 'done', 'canceled']);
const UUID = /^[0-9a-f-]{36}$/i;

export async function PATCH(request, { params }) {
  const store = await storeFromToken(request);
  if (!store) return fail('Loja não autorizada.', 401);
  const { id } = await params;
  if (!UUID.test(id)) return fail('Pedido não encontrado.', 404);
  const body = await request.json().catch(() => ({}));
  const status = String(body.status || '');
  if (!STATUSES.has(status)) return fail('Status inválido.');
  const number = Number.isInteger(body.number) ? body.number : null;
  const rows = await sql()`
    update orders set status = ${status}, local_number = coalesce(${number}, local_number), updated_at = now()
    where id = ${id} and store_id = ${store.id}
    returning *`;
  if (rows.length === 0) return fail('Pedido não encontrado.', 404);
  return json({ order: orderRow(rows[0]) });
}
