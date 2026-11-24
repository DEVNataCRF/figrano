// Regras da página do pedido que não dependem da tela: previsão, linha do tempo e
// a lista de pedidos guardada neste aparelho ("Meus pedidos").

const MIN = 60000;
/** Tempo de caminho somado ao preparo na entrega (o mesmo que a página sempre usou). */
export const DELIVERY_TRAVEL_MINUTES = 15;
/** Quantos pedidos ficam em "Meus pedidos" neste aparelho. */
export const MAX_SAVED_ORDERS = 10;

/**
 * Previsão a partir de quando a loja aceitou (ou do pedido, antes disso) + preparo + atraso avisado.
 * Entrega: janela "entre X e Y" (fim do preparo até o caminho). Retirada: "pronto por volta das X".
 * `lateAfter`: passou disso, a página avisa que está demorando.
 */
export function etaOf(order, prepMinutes) {
  const prep = Number(prepMinutes) || 0;
  const start = order?.acceptedAt || order?.createdAt;
  if (prep <= 0 || !start) return null;
  const base = new Date(start).getTime() + (prep + (Number(order.delayMinutes) || 0)) * MIN;
  const delivery = order.mode === 'DELIVERY';
  const to = base + (delivery ? DELIVERY_TRAVEL_MINUTES * MIN : 0);
  return { kind: delivery ? 'window' : 'ready', from: new Date(base), to: new Date(to), lateAfter: new Date(to + 5 * MIN) };
}

/** Guarda o pedido no topo da lista do aparelho, sem repetir e sem passar do limite. */
export function rememberOrder(list, entry) {
  if (!entry?.id) return Array.isArray(list) ? list : [];
  const rest = (Array.isArray(list) ? list : []).filter((o) => o?.id && o.id !== entry.id);
  return [entry, ...rest].slice(0, MAX_SAVED_ORDERS);
}

const LABELS = {
  NEW: 'Pedido realizado',
  AWAITING_PIX: 'Pix e comprovante',
  PREPARING: 'Em preparo',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  READY_FOR_PICKUP: 'Pronto para retirar',
  DONE: 'Entregue',
};

/**
 * Etapas do pedido na ordem em que o cliente vive: realizado → (Pix) → preparo → saída/pronto → entregue.
 * Cada etapa diz se já passou, se é a de agora e a hora (do histórico da API, ou do que já se sabe).
 */
export function timelineOf(order, pixFlow) {
  const delivery = order.mode === 'DELIVERY';
  const order_ = ['NEW', ...(pixFlow ? ['AWAITING_PIX'] : []), 'PREPARING', delivery ? 'OUT_FOR_DELIVERY' : 'READY_FOR_PICKUP', 'DONE'];
  // Com Pix pelo site o pedido nasce esperando o comprovante: "realizado" já passou
  const current = order_.indexOf(order.status);
  const times = new Map();
  if (order.createdAt) times.set('NEW', new Date(order.createdAt));
  if (order.acceptedAt) times.set('PREPARING', new Date(order.acceptedAt));
  for (const h of order.history || []) if (h?.status && h.at && h.status !== 'NEW') times.set(h.status, new Date(h.at));
  return order_.map((status, index) => ({
    status,
    label: status === 'DONE' && !delivery ? 'Retirado' : LABELS[status],
    // Concluído não tem etapa "em andamento": tudo feito
    state: index < current || order.status === 'DONE' ? 'done' : index === current ? 'now' : 'next',
    at: index <= current ? times.get(status) || null : null,
  }));
}

/** Mensagem pronta do botão "Continuar no WhatsApp" (o robô responde com o andamento). */
export const continueText = (number) => `Oi! Acabei de fazer o pedido #${number} pelo site. Pode me avisar por aqui?`;
