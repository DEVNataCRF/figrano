// Cada loja tem um token secreto, criado no cadastro e guardado só no app
// desktop. O servidor guarda apenas o hash.

import { createHash, randomBytes } from 'node:crypto';

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

/** Token do cabeçalho "Authorization: Bearer <token>", ou ''. */
export function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : '';
}

const RESERVED = new Set(['api', 'admin', 'pedido', 'pedidos', 'www', 'app', 'figrano', 'static', 'login', 'cadastro']);

/** Endereço da loja na página: letras minúsculas, números e hífen, de 3 a 40 caracteres. */
export function validSlug(slug) {
  const value = String(slug || '');
  return /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(value) && !value.includes('--') && !RESERVED.has(value);
}
