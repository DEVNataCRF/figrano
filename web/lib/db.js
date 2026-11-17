// Conexão com o Postgres (Neon em produção, Docker no desenvolvimento).

import postgres from 'postgres';

let client = null;

export function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não configurada.');
    client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 });
  }
  return client;
}

const num = (value) => (value === null || value === undefined ? null : Number(value));

/** Pedido no formato que a página e o app desktop usam. */
export function orderRow(row) {
  return {
    id: row.id,
    ref: row.ref,
    customer: row.customer,
    items: row.items,
    mode: row.mode,
    address: row.address,
    payment: row.payment,
    changeFor: num(row.change_for),
    notes: row.notes,
    subtotal: num(row.subtotal),
    fee: num(row.fee),
    total: num(row.total),
    status: row.status,
    number: row.local_number,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
