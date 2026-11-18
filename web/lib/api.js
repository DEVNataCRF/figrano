// Site de delivery do Sabores da Sil: tudo vem da API única (a mesma do buffet e do painel).
// Em produção: NEXT_PUBLIC_API_URL=https://api.<domínio>/api/v1 no build (Cloudflare Pages).

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3333/api/v1').replace(/\/+$/, '');

export const PAYMENT_LABELS = {
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  CASH: 'Dinheiro',
};

async function call(path, init) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { cache: 'no-store', ...init });
  } catch {
    throw new Error('Sem conexão com a loja agora. Confira sua internet e tente de novo.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error?.message || 'Não foi possível concluir agora. Tente de novo.');
  }
  return data.data;
}

/** Cardápio, horário, regras e se a loja está recebendo pedidos agora. */
export const fetchMenu = () => call('/public/delivery/menu');

/** Envia o pedido. A loja confere preço, taxa e mínimo do lado dela. */
export const placeOrder = (body) =>
  call('/public/delivery/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Acompanhar: precisa dos 4 últimos dígitos do WhatsApp usado no pedido. */
export const trackOrder = (id, phoneSuffix) =>
  call(`/public/delivery/orders/${encodeURIComponent(id)}?phone=${encodeURIComponent(phoneSuffix)}`);
