'use strict';

/**
 * ROBÔ (sem IA): avisos automáticos do pedido de delivery no WhatsApp.
 * Textos fixos e previsíveis, sempre com o link de acompanhamento do site.
 */

const { money } = require('./format');
const { splitAddress } = require('../comanda-dados');

/** Forma de pagamento como o cliente lê, com o detalhe que importa (Pix já pago, troco). */
function paymentLine(order) {
  const label = order.payment || ({ PIX: 'Pix', CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito', CASH: 'Dinheiro' })[order.paymentMethod] || 'A combinar';
  if (order.paymentMethod === 'PIX' && order.pixProofAt) return `${label} (pago ✅)`;
  const change = Number(order.changeFor) || 0;
  if (order.paymentMethod === 'CASH' && change > Number(order.total)) return `${label} (troco para ${money(change)})`;
  return label;
}

/**
 * Mensagem de pedido confirmado (a loja aceitou e começou a preparar): itens com valor,
 * taxa, total, pagamento, onde entrega ou retira e o link de acompanhamento.
 */
function confirmedMessage(order, { storeName, link, pickupAddress }) {
  const name = String(order.customer?.name || '').trim();
  const pickup = order.mode === 'pickup';
  const lines = (order.items || []).map((item) => {
    const value = item.subtotal ?? (Number(item.price) || 0) * (Number(item.qty) || 0);
    const extras = (item.options || []).map((o) => `\n      + ${o.quantity}x ${o.name}`).join('');
    const note = item.notes ? `\n      _${item.notes}_` : '';
    return `   • ${item.qty}x ${item.name} — ${money(value)}${extras}${note}`;
  });
  const fee = Number(order.fee) || 0;
  let where;
  if (pickup) {
    where = `🏪 Retirada: ${pickupAddress || 'na loja'}`;
  } else {
    const { street, reference } = splitAddress(order.address, order.neighborhood);
    const place = [street, reference].filter(Boolean).join(', ');
    where = `📍 Entrega: ${place}${order.neighborhood ? ` — ${order.neighborhood}` : ''}`;
  }
  return [
    `Olá${name ? `, ${name}` : ''}! 👋`,
    '',
    `Recebemos seu pedido #${order.number} e ele já está sendo preparado. 😋`,
    '',
    '📦 Itens:',
    ...lines,
    '',
    ...(pickup ? [] : [fee > 0 ? `🚚 Taxa de entrega: ${money(fee)}` : '🚚 Entrega grátis']),
    `💰 Total: ${money(order.total)}`,
    '',
    '',
    `💳 Pagamento: ${paymentLine(order)}`,
    where,
    ...(storeName ? [storeName] : []),
    pickup ? 'Avisamos por aqui quando estiver pronto para retirar.' : 'Avisamos por aqui quando sair para entrega.',
    ...(link ? ['', `Acompanhe aqui: ${link}`] : []),
    '',
    'Obrigado! ❤️',
  ].join('\n');
}

/** Mensagem para cada mudança de status. `link` = página de acompanhamento no site. */
function statusAviso(order, { storeName, link, pickupAddress = '' }) {
  const n = `#${order.number}`;
  const track = link ? `\n\nAcompanhe aqui: ${link}` : '';
  switch (order.status) {
    case 'preparing':
      return confirmedMessage(order, { storeName, link, pickupAddress });
    case 'out':
      return `Seu pedido ${n} saiu para entrega! Daqui a pouco chega aí.${track}`;
    case 'ready':
      return `Seu pedido ${n} está pronto para retirada!${track}`;
    case 'done':
      return `Pedido ${n} entregue. Obrigada por pedir no ${storeName}!`;
    case 'canceled':
      return `Seu pedido ${n} foi cancelado. Se precisar, é só chamar por aqui.`;
    default:
      return null;
  }
}

/** Pedido de avaliação depois da entrega (opcional, ligado em Ajustes). */
function reviewRequest(order) {
  return `Como foi seu pedido #${order.number}? Responda com uma nota de *1 a 5* (5 = adorei). Se quiser, escreva junto o que achou.`;
}

const NUMBER_WORDS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5 };

/**
 * Lê a nota da resposta do cliente: "5", "nota 4", "4 estrelas", "⭐⭐⭐⭐⭐", "5, chegou quentinho".
 * Devolve null se a mensagem não for uma nota (o robô segue a conversa normal).
 */
function parseReview(text) {
  const raw = String(text || '').trim();
  const stars = (raw.match(/⭐|🌟|★/g) || []).length;
  if (stars >= 1 && stars <= 5 && raw.replace(/⭐|🌟|★|\s/g, '').length === 0) return { rating: stars, comment: null };
  const t = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = t.match(/^(?:nota\s*)?([1-5]|um|uma|dois|duas|tres|quatro|cinco)\b(?:\s*(?:estrelas?|de\s*5|\/\s*5))?\s*[,.!:;-]?\s*(.*)$/);
  if (!m) return null;
  const rating = /^\d$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  const rest = raw.slice(raw.length - m[2].length).trim();
  return { rating, comment: rest ? rest.slice(0, 500) : null };
}

/** Resposta ao cliente depois da nota. */
function reviewThanks(rating) {
  return rating >= 4
    ? `Obrigada pela nota ${rating}! Ficamos muito felizes. Quando quiser pedir de novo, é só chamar.`
    : `Poxa, sinto muito que não foi como esperado. Já avisei a Sil para ela entender o que aconteceu e falar com você.`;
}

module.exports = { statusAviso, confirmedMessage, reviewRequest, parseReview, reviewThanks, money };
