'use strict';

/**
 * ROBÔ (sem IA): avisos automáticos do pedido de delivery no WhatsApp.
 * Textos fixos e previsíveis, sempre com o link de acompanhamento do site.
 */

const { money } = require('./format');

/** Mensagem para cada mudança de status. `link` = página de acompanhamento no site. */
function statusAviso(order, { storeName, link }) {
  const n = `#${order.number}`;
  const track = link ? `\n\nAcompanhe aqui: ${link}` : '';
  switch (order.status) {
    case 'preparing':
      return `Seu pedido ${n} entrou em produção! Já estamos preparando tudo com carinho.${track}`;
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

module.exports = { statusAviso, reviewRequest, parseReview, reviewThanks, money };
