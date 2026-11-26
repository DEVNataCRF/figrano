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

/** "Olá, Nome! 👋" (sem nome: "Olá! 👋"). */
function greeting(order, emoji = '👋') {
  const name = String(order.customer?.name || '').trim();
  return `Olá${name ? `, ${name}` : ''}!${emoji ? ` ${emoji}` : ''}`;
}

/** Onde o pedido vai: endereço da entrega (rua, referência — bairro) ou da retirada. */
function placeLine(order, pickupAddress) {
  if (order.mode === 'pickup') return `🏪 Retirada: ${pickupAddress || 'na loja'}`;
  const { street, reference } = splitAddress(order.address, order.neighborhood);
  const place = [street, reference].filter(Boolean).join(', ');
  return `📍 Entrega: ${place}${order.neighborhood ? ` — ${order.neighborhood}` : ''}`;
}

/** Fecho de todas as mensagens: link de acompanhamento (se houver), nome da loja e o agradecimento. */
function closing({ storeName, link, thanks = true }) {
  return [
    ...(link ? ['', `Acompanhe aqui: ${link}`] : []),
    ...(storeName || thanks ? [''] : []),
    ...(storeName ? [storeName] : []),
    ...(thanks ? ['Obrigado! ❤️'] : []),
  ];
}

/**
 * Mensagem de pedido confirmado (a loja aceitou e começou a preparar): itens com valor,
 * taxa, total, pagamento, onde entrega ou retira e o link de acompanhamento.
 */
function confirmedMessage(order, { storeName, link, pickupAddress }) {
  const pickup = order.mode === 'pickup';
  const lines = (order.items || []).map((item) => {
    const value = item.subtotal ?? (Number(item.price) || 0) * (Number(item.qty) || 0);
    const extras = (item.options || []).map((o) => `\n      + ${o.quantity}x ${o.name}`).join('');
    const note = item.notes ? `\n      _${item.notes}_` : '';
    return `   • ${item.qty}x ${item.name} — ${money(value)}${extras}${note}`;
  });
  const fee = Number(order.fee) || 0;
  return [
    greeting(order),
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
    placeLine(order, pickupAddress),
    ...(storeName ? [storeName] : []),
    pickup ? 'Avisamos por aqui quando estiver pronto para retirar.' : 'Avisamos por aqui quando sair para entrega.',
    ...(link ? ['', `Acompanhe aqui: ${link}`] : []),
    '',
    'Obrigado! ❤️',
  ].join('\n');
}

/** Pedido feito pelo site, antes de a loja aceitar (sem aceite automático). */
function receivedMessage(order, { storeName, link }) {
  return [
    greeting(order),
    '',
    `Recebemos seu pedido #${order.number} pelo site. 📝`,
    '',
    `💰 Total: ${money(order.total)}`,
    `💳 Pagamento: ${paymentLine(order)}`,
    '',
    'Assim que a loja confirmar, mandamos o resumo completo por aqui.',
    ...closing({ storeName, link }),
  ].join('\n');
}

/** Pix pelo site: o pedido espera o comprovante para ir para a cozinha. */
function awaitingPixMessage(order, { storeName, link }) {
  return [
    greeting(order),
    '',
    `Recebemos seu pedido #${order.number} pelo site. 🧾`,
    '',
    `💰 Total: ${money(order.total)}`,
    '💳 Pagamento: Pix',
    '',
    '👉 Para confirmar, mande aqui o comprovante do Pix. Sem ele, o pedido não vai para a cozinha.',
    ...closing({ storeName, link }),
  ].join('\n');
}

/** Comprovante do Pix conferido pela loja (sem aceite automático; com ele, vai o resumo). */
function pixConfirmedMessage(order, { storeName, link }) {
  return [
    greeting(order, '✅'),
    '',
    `Comprovante conferido! Seu pedido #${order.number} está confirmado.`,
    '',
    `💰 Total: ${money(order.total)}`,
    '💳 Pagamento: Pix (pago ✅)',
    '',
    'Assim que começarmos a preparar, mandamos o resumo por aqui.',
    ...closing({ storeName, link }),
  ].join('\n');
}

/** A loja avisou atraso no painel. */
function delayMessage(order, minutes, { storeName, link }) {
  return [
    greeting(order, '⏳'),
    '',
    `Seu pedido #${order.number} vai atrasar um pouquinho: mais uns ${minutes} minutos.`,
    'Desculpe pela espera! 🙏',
    ...closing({ storeName, link, thanks: false }),
  ].join('\n');
}

/** Mensagem para cada mudança de status. `link` = página de acompanhamento no site. */
function statusAviso(order, { storeName, link, pickupAddress = '' }) {
  const n = `#${order.number}`;
  switch (order.status) {
    case 'preparing':
      return confirmedMessage(order, { storeName, link, pickupAddress });
    case 'out':
      return [
        greeting(order, '🛵'),
        '',
        `Seu pedido ${n} saiu para entrega e já está a caminho!`,
        '',
        `💰 Total: ${money(order.total)}`,
        `💳 Pagamento: ${paymentLine(order)}`,
        placeLine(order, pickupAddress),
        ...closing({ storeName, link }),
      ].join('\n');
    case 'ready':
      return [
        greeting(order, '🛍️'),
        '',
        `Seu pedido ${n} está pronto para retirada!`,
        '',
        `💰 Total: ${money(order.total)}`,
        `💳 Pagamento: ${paymentLine(order)}`,
        placeLine({ ...order, mode: 'pickup' }, pickupAddress),
        '',
        'Te esperamos! 😉',
        ...closing({ storeName, link }),
      ].join('\n');
    case 'done':
      return [
        greeting(order, '🎉'),
        '',
        order.mode === 'pickup' ? `Pedido ${n} retirado.` : `Pedido ${n} entregue.`,
        `Obrigado por pedir no ${storeName || 'nosso delivery'}! ❤️`,
      ].join('\n');
    case 'canceled':
      return [
        greeting(order, ''),
        '',
        `Seu pedido ${n} foi cancelado.`,
        'Se precisar, é só chamar por aqui. 🙏',
        ...closing({ storeName, thanks: false }),
      ].join('\n');
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

module.exports = { statusAviso, confirmedMessage, receivedMessage, awaitingPixMessage, pixConfirmedMessage, delayMessage, reviewRequest, parseReview, reviewThanks, money };
