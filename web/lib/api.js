// Site de delivery do Sabores da Sil: tudo vem da API única (a mesma do buffet e do painel).
// Em produção: NEXT_PUBLIC_API_URL=https://api.<domínio>/api/v1 no build (Cloudflare Pages).

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3333/api/v1').replace(/\/+$/, '');

export const PAYMENT_LABELS = {
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  CASH: 'Dinheiro',
};

/** Prazo padrão de cada chamada (o envio do pedido tem prazo próprio, maior). */
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Chamada à loja com prazo: nunca fica "carregando" para sempre. Erros têm `code`:
 * TIMEOUT (sem resposta no prazo), NETWORK (sem conexão) ou o código devolvido pela loja,
 * além de `status` e `details` quando a loja respondeu.
 */
async function call(path, init = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { cache: 'no-store', ...init, signal: controller.signal });
  } catch {
    const timedOut = controller.signal.aborted;
    const error = new Error(timedOut
      ? 'A loja demorou para responder. Confira sua internet e tente de novo.'
      : 'Sem conexão com a loja agora. Confira sua internet e tente de novo.');
    error.code = timedOut ? 'TIMEOUT' : 'NETWORK';
    error.status = 0;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const error = new Error(data.error?.message || 'Não foi possível concluir agora. Tente de novo.');
    error.status = response.status;
    error.code = data.error?.code || '';
    error.details = data.error?.details;
    throw error;
  }
  return data.data;
}

/** Cardápio, horário, regras e se a loja está recebendo pedidos agora. */
export const fetchMenu = () => call('/public/delivery/menu');

/** Encomendas de Natal do buffet (aberta ou não). Falhou = sem aviso. */
export const fetchNatal = () => call('/public/natal').catch(() => null);

/** Envia o pedido. A loja confere preço, taxa e mínimo do lado dela. */
export const placeOrder = (body) =>
  call('/public/delivery/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { timeoutMs: 25000 });

/** "Meu envio chegou?": o pedido feito com esta chave (404 = não chegou à loja). */
export const findOrderAttempt = (key, phoneSuffix) =>
  call(`/public/delivery/orders/by-key/${encodeURIComponent(key)}?phone=${encodeURIComponent(phoneSuffix)}`);

/** Acompanhar: precisa dos 4 últimos dígitos do WhatsApp usado no pedido. */
export const trackOrder = (id, phoneSuffix) =>
  call(`/public/delivery/orders/${encodeURIComponent(id)}?phone=${encodeURIComponent(phoneSuffix)}`);

const postJson = (path, body) =>
  call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Entrar com o celular, passo 1: o código chega no WhatsApp (só para quem já pediu). */
export const requestLoginCode = (phone) => postJson('/public/delivery/login/code', { phone });

/** Passo 2: confere o código e devolve { token, name, phone, expiresInSeconds }. */
export const verifyLoginCode = (phone, code) => postJson('/public/delivery/login/verify', { phone, code });

/** Histórico de quem entrou: { customer, orders }. Token vencido → erro com status 401. */
export const fetchMyOrders = (token) =>
  call('/public/delivery/me/orders', { headers: { Authorization: `Bearer ${token}` } });
