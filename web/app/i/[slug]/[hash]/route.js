// Fotos públicas do cardápio. O endereço muda quando a foto muda, então o
// navegador pode guardar em cache para sempre.

import { sql } from '../../../../lib/db.js';

export async function GET(_request, { params }) {
  const { slug, hash } = await params;
  if (!/^[0-9a-f]{32}$/.test(hash)) return new Response('Não encontrada', { status: 404 });
  const [row] = await sql()`
    select i.bytes from images i join stores s on s.id = i.store_id
    where s.slug = ${String(slug)} and i.hash = ${hash}`;
  if (!row) return new Response('Não encontrada', { status: 404 });
  return new Response(row.bytes, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
