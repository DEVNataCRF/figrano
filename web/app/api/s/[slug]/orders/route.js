// O cliente envia o pedido pela página da loja.

import { sql, orderRow } from '../../../../../lib/db.js';
import { validateOrder } from '../../../../../lib/orders.js';
import { json, fail, storeBySlug } from '../../../../../lib/stores.js';

export async function POST(request, { params }) {
  const { slug } = await params;
  const store = await storeBySlug(slug);
  if (!store) return fail('Loja não encontrada.', 404);
  const body = await request.json().catch(() => null);
  const result = validateOrder(store, body);
  if (!result.ok) return fail(result.error, 422);
  const o = result.order;
  const [row] = await sql()`
    insert into orders (store_id, ref, customer, items, mode, address, payment, change_for, notes, subtotal, fee, total)
    values (${store.id}, ${o.ref}, ${sql().json(o.customer)}, ${sql().json(o.items)}, ${o.mode}, ${o.address},
      ${o.payment}, ${o.changeFor}, ${o.notes}, ${o.subtotal}, ${o.fee}, ${o.total})
    returning *`;
  return json({ order: orderRow(row) }, 201);
}
