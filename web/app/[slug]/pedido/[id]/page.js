import { notFound } from 'next/navigation';
import { sql, orderRow } from '../../../../lib/db.js';
import { storeBySlug } from '../../../../lib/stores.js';
import Tracker from './Tracker.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Acompanhe seu pedido', robots: { index: false } };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function OrderPage({ params }) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const store = await storeBySlug(slug);
  if (!store) notFound();
  const [row] = await sql()`select * from orders where id = ${id} and store_id = ${store.id}`;
  if (!row) notFound();
  const order = orderRow(row);
  const info = store.info || {};
  return (
    <Tracker
      slug={slug}
      storeName={store.name || slug}
      whatsapp={info.whatsapp || info.phone || ''}
      prepMinutes={Number(info.prepMinutes) || 0}
      order={{
        id: order.id, status: order.status, number: order.number, mode: order.mode,
        items: order.items, address: order.address, payment: order.payment, changeFor: order.changeFor,
        subtotal: order.subtotal, fee: order.fee, total: order.total,
      }}
    />
  );
}
