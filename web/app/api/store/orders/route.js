// O app desktop busca aqui os pedidos novos (a cada 5 s). Cada consulta
// também conta como sinal de que a loja está conectada.

import { sql, orderRow } from '../../../../lib/db.js';
import { json, fail, storeFromToken, touch } from '../../../../lib/stores.js';

export async function GET(request) {
  const store = await storeFromToken(request);
  if (!store) return fail('Loja não autorizada.', 401);
  await touch(store.id);
  const rows = await sql()`
    select * from orders where store_id = ${store.id} and status = 'pending'
    order by created_at limit 20`;
  return json({ orders: rows.map(orderRow) });
}
