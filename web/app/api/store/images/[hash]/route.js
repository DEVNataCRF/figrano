// O app desktop envia uma foto (JPEG já reduzido). O nome tem que bater com
// o hash do conteúdo, então uma foto nunca é trocada no lugar de outra.

import { createHash } from 'node:crypto';
import { sql } from '../../../../../lib/db.js';
import { json, fail, storeFromToken } from '../../../../../lib/stores.js';

const MAX_BYTES = 1.5 * 1024 * 1024;

export async function PUT(request, { params }) {
  const store = await storeFromToken(request);
  if (!store) return fail('Loja não autorizada.', 401);
  const { hash } = await params;
  if (!/^[0-9a-f]{32}$/.test(hash)) return fail('Imagem inválida.');
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return fail('Imagem grande demais.', 413);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail('A imagem precisa ser JPEG.', 415);
  if (createHash('sha256').update(bytes).digest('hex').slice(0, 32) !== hash) return fail('Conteúdo não confere com o nome.');
  await sql()`
    insert into images (store_id, hash, bytes) values (${store.id}, ${hash}, ${bytes})
    on conflict (store_id, hash) do nothing`;
  return json({ ok: true }, 201);
}
