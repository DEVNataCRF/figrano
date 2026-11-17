import { notFound } from 'next/navigation';
import { storeBySlug } from '../../lib/stores.js';
import { storeAvailability } from '../../lib/orders.js';
import { hoursLines } from '../../lib/hours.js';
import OrderApp from './OrderApp.js';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const store = await storeBySlug(slug);
  if (!store) return { title: 'Loja não encontrada' };
  const name = store.name || slug;
  return { title: `${name}: cardápio e pedidos`, description: `Veja o cardápio e peça direto do ${name}.` };
}

export default async function StorePage({ params, searchParams }) {
  const { slug } = await params;
  const { r } = await searchParams;
  const store = await storeBySlug(slug);
  if (!store) notFound();

  const info = store.info || {};
  const image = (hash) => (hash ? `/i/${slug}/${hash}` : '');
  const { canOrder, reason } = storeAvailability(store);
  const menu = (store.menu || [])
    .filter((category) => (category.items || []).length > 0)
    .map((category) => ({ ...category, items: category.items.map((item) => ({ ...item, photo: image(item.photo) })) }));

  return (
    <OrderApp
      slug={slug}
      refCode={typeof r === 'string' ? r : ''}
      store={{
        name: store.name || info.name || slug,
        logo: image(info.logo),
        cover: image(info.cover),
        address: info.address || '',
        whatsapp: info.whatsapp || info.phone || '',
        deliveryFee: Number(info.deliveryFee) || 0,
        minOrder: Number(info.minOrder) || 0,
        prepMinutes: Number(info.prepMinutes) || 0,
        payments: Array.isArray(info.payments) ? info.payments : [],
        delivery: info.delivery !== false,
        pickup: info.pickup !== false,
        hours: hoursLines(info.hours),
      }}
      menu={menu}
      canOrder={canOrder}
      reason={reason}
    />
  );
}
