// O app desktop envia os dados da loja e o cardápio sempre que mudam.

import { sql } from '../../../../lib/db.js';
import { json, fail, storeFromToken, storeUrl } from '../../../../lib/stores.js';

const INFO_FIELDS = ['name', 'address', 'phone', 'hours', 'deliveryFee', 'minOrder', 'prepMinutes', 'payments', 'delivery', 'pickup', 'whatsapp', 'logo', 'cover'];
const HASH = /^[0-9a-f]{32}$/;
const hashOrEmpty = (value) => (HASH.test(String(value || '')) ? String(value) : '');

/** Mantém só o que a página precisa e limita tamanhos. */
function cleanMenu(menu) {
  if (!Array.isArray(menu)) return [];
  return menu.slice(0, 50).map((category) => ({
    id: String(category.id),
    name: String(category.name || '').slice(0, 80),
    items: (Array.isArray(category.items) ? category.items : []).slice(0, 200).map((item) => ({
      id: String(item.id),
      name: String(item.name || '').slice(0, 120),
      description: String(item.description || '').slice(0, 400),
      price: Number(item.price) || 0,
      available: item.available !== false,
      photo: hashOrEmpty(item.photo),
    })),
  }));
}

export async function PUT(request) {
  const store = await storeFromToken(request);
  if (!store) return fail('Loja não autorizada.', 401);
  const body = await request.json().catch(() => null);
  if (!body) return fail('Dados inválidos.');
  const info = Object.fromEntries(INFO_FIELDS.filter((key) => key in (body.info || {})).map((key) => [key, body.info[key]]));
  const menu = cleanMenu(body.menu);
  info.logo = hashOrEmpty(info.logo);
  info.cover = hashOrEmpty(info.cover);
  await sql()`
    update stores set info = ${sql().json(info)}, menu = ${sql().json(menu)},
      name = ${String(info.name || store.name).slice(0, 80)}, last_seen_at = now()
    where id = ${store.id}`;
  // Fotos citadas que o servidor ainda não tem: o app envia em seguida.
  const wanted = [...new Set([info.logo, info.cover, ...menu.flatMap((c) => c.items.map((i) => i.photo))].filter(Boolean))];
  const have = wanted.length
    ? (await sql()`select hash from images where store_id = ${store.id} and hash in ${sql()(wanted)}`).map((r) => r.hash)
    : [];
  const missingImages = wanted.filter((hash) => !have.includes(hash));
  return json({ ok: true, url: storeUrl(request, store.slug), missingImages });
}
