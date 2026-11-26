// Tentativa de envio do pedido, guardada no aparelho ANTES de mandar para a loja.
//
// Se a resposta se perde (internet caiu, tempo esgotado, página recarregada), o site não sabe se
// o pedido chegou. Com a tentativa guardada, ao voltar ele pergunta à loja pela mesma chave
// ("meu envio chegou?") em vez de mandar outro pedido. A chave só muda depois de uma resposta
// definitiva: pedido confirmado, recusa da loja ou o cliente decidir pedir outra coisa.

const storageKey = (slug) => `sabores:delivery:attempt:${slug}`;

/** Chave nova, longa e aleatória (a loja usa para não gravar o mesmo pedido duas vezes). */
export function newAttemptKey() {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `site-${random}`;
}

/**
 * { key, phoneSuffix, total, createdAt } ou null. Tentativa com mais de 24 h não vale mais
 * (o pedido, se chegou, já aparece em "Meus pedidos").
 */
export function readAttempt(storage, slug, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(storageKey(slug)) || 'null');
    if (!value || typeof value.key !== 'string' || value.key.length < 8) return null;
    if (now - (Number(value.createdAt) || 0) > 24 * 60 * 60 * 1000) {
      storage.removeItem(storageKey(slug));
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function writeAttempt(storage, slug, attempt) {
  try {
    storage.setItem(storageKey(slug), JSON.stringify(attempt));
  } catch { /* sem armazenamento: vale só a proteção de clique duplo */ }
}

export function clearAttempt(storage, slug) {
  try { storage.removeItem(storageKey(slug)); } catch { /* nada a limpar */ }
}

/**
 * O que a falha do envio quer dizer:
 *  - 'unknown': sem resposta (tempo esgotado ou sem internet). O pedido PODE ter chegado: guardar
 *    a tentativa e conferir antes de enviar de novo.
 *  - 'already-placed': a mesma chave já virou um pedido com outros itens.
 *  - 'price-changed': os valores mudaram; recarregar o cardápio e confirmar de novo.
 *  - 'refused': a loja recusou com motivo (fechada, item indisponível…). Nada foi gravado.
 */
export function classifySendError(error) {
  if (!error || error.code === 'TIMEOUT' || error.code === 'NETWORK' || !error.status) return 'unknown';
  if (error.code === 'IDEMPOTENCY_CONTENT_CONFLICT') return 'already-placed';
  if (error.code === 'DELIVERY_PRICE_CHANGED') return 'price-changed';
  if (error.status >= 500) return 'unknown';
  return 'refused';
}
