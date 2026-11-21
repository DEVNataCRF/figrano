'use strict';

const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function money(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * A loja está aberta em `date`? Trata horário que passa da meia-noite
 * (ex.: 18:00 às 02:00) olhando também o turno do dia anterior.
 */
function isOpen(hours, date = new Date()) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const today = hours?.[date.getDay()];
  const yesterday = hours?.[(date.getDay() + 6) % 7];

  if (today && !today.closed) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    if (close > open ? minutes >= open && minutes < close : minutes >= open) return true;
  }
  if (yesterday && !yesterday.closed) {
    const open = toMinutes(yesterday.open);
    const close = toMinutes(yesterday.close);
    if (close <= open && minutes < close) return true;
  }
  return false;
}

/**
 * Aberta agora, contando o atalho "abrir/fechar agora" do painel (store.override, até uma hora).
 * Sem atalho valendo, segue o horário da semana.
 */
function storeOpen(store, date = new Date()) {
  const o = store?.override;
  if (o && (o.mode === 'open' || o.mode === 'closed') && Date.parse(o.until) > date.getTime()) return o.mode === 'open';
  return isOpen(store?.hours, date);
}

/** Todos os dias marcados como fechados (delivery pausado). */
function allClosed(hours) {
  return [0, 1, 2, 3, 4, 5, 6].every((day) => !hours?.[day] || hours[day].closed);
}

function hoursText(hours) {
  if (allClosed(hours)) return 'No momento o delivery está pausado.';
  const lines = [];
  for (let day = 0; day < 7; day++) {
    const slot = hours?.[day];
    const label = DAY_NAMES[day][0].toUpperCase() + DAY_NAMES[day].slice(1);
    lines.push(!slot || slot.closed ? `${label}: fechado` : slot.open === slot.close ? `${label}: 24 horas` : `${label}: ${slot.open} às ${slot.close}`);
  }
  return lines.join('\n');
}

/** Cardápio numerado, como o cliente recebe. `items` vem de Store.numberedItems(). */
function menuText(items) {
  if (items.length === 0) return 'Nosso cardápio ainda não está disponível por aqui.';
  const lines = [];
  let category = null;
  for (const item of items) {
    if (item.category !== category) {
      category = item.category;
      if (lines.length) lines.push('');
      lines.push(`*${category}*`);
    }
    lines.push(`${item.number}. ${item.name} - ${money(item.price)}`);
    if (item.description) lines.push(`   _${item.description}_`);
  }
  return lines.join('\n');
}

function cartTotal(cart) {
  return cart.reduce((sum, line) => sum + line.qty * line.price, 0);
}

function cartText(cart) {
  if (cart.length === 0) return 'Seu carrinho está vazio.';
  const lines = cart.map((line) => {
    const note = line.notes ? ` (${line.notes})` : '';
    return `${line.qty}x ${line.name}${note} - ${money(line.qty * line.price)}`;
  });
  lines.push(`Subtotal: ${money(cartTotal(cart))}`);
  return lines.join('\n');
}

function orderSummary({ cart, mode, address, payment, changeFor, fee }) {
  const subtotal = cartTotal(cart);
  const appliedFee = mode === 'delivery' ? Number(fee) || 0 : 0;
  const lines = [cartText(cart)];
  if (mode === 'delivery') {
    lines.push(`Entrega: ${money(appliedFee)}`);
    lines.push(`Endereço: ${address}`);
  } else {
    lines.push('Retirada na loja');
  }
  lines.push(`Pagamento: ${payment}${changeFor ? ` (troco para ${money(changeFor)})` : ''}`);
  lines.push(`*Total: ${money(subtotal + appliedFee)}*`);
  return lines.join('\n');
}

const STATUS_LABELS = {
  awaiting_pix: 'aguardando o comprovante do Pix',
  new: 'recebido, aguardando a loja confirmar',
  preparing: 'em produção',
  out: 'saiu para entrega',
  ready: 'pronto para retirada',
  done: 'entregue',
  canceled: 'cancelado',
};

/** Mensagem enviada ao cliente quando a loja muda o status do pedido. */
function statusNotification(order, storeName) {
  const number = `#${order.number}`;
  switch (order.status) {
    case 'preparing':
      return `Pedido ${number} confirmado e já em preparo. Obrigado por pedir no ${storeName}!`;
    case 'out':
      return `Seu pedido ${number} saiu para entrega.`;
    case 'ready':
      return `Seu pedido ${number} está pronto para retirada.`;
    case 'done':
      return `Pedido ${number} concluído. Bom apetite!`;
    case 'canceled':
      return `Seu pedido ${number} foi cancelado. Se precisar, é só chamar por aqui.`;
    default:
      return null;
  }
}

module.exports = {
  allClosed,
  money, isOpen, storeOpen, hoursText, menuText, cartText, cartTotal, orderSummary,
  statusNotification, STATUS_LABELS,
};
