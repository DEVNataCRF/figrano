'use strict';

/**
 * Dados da comanda: tudo o que a impressão mostra, já decidido e formatado, sem HTML.
 * A apresentação (comanda.js) só arruma isto no papel.
 *
 * Os valores vêm prontos do sistema (subtotal de cada item, subtotal, taxa, total): aqui
 * nada é recalculado, só o troco (o que o entregador leva), que não existe pronto no pedido.
 */

/** Fuso da loja (o mesmo de BUSINESS_TIME_ZONE em packages/business-rules). */
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';
/** Caminho somado ao preparo na entrega (o mesmo de DELIVERY_TRAVEL_MINUTES em web/lib/orders.js). */
const DELIVERY_TRAVEL_MINUTES = 15;
const MIN = 60000;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v) => BRL.format(Number(v) || 0);
const plain = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
/** Texto que existe de verdade (nada de "undefined", "null" ou só espaço). */
const text = (v) => {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  return s === 'undefined' || s === 'null' ? '' : s;
};

const clock = (date) => new Intl.DateTimeFormat('pt-BR', { timeZone: BUSINESS_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(date);
const dayMonth = (date) => new Intl.DateTimeFormat('pt-BR', { timeZone: BUSINESS_TIME_ZONE, day: '2-digit', month: '2-digit' }).format(date);

function displayPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return text(raw);
}

/**
 * "Rua X, 120 - casa azul - Centro" → { street: 'Rua X, 120', reference: 'casa azul' }.
 * O site junta rua/número e o campo "complemento ou referência" com " - ". O bairro já vem
 * separado; se ele estiver no fim do endereço, sai daqui para não repetir.
 */
function splitAddress(address, neighborhood) {
  let value = text(address);
  if (neighborhood) {
    const parts = value.split(/\s+-\s+/);
    if (parts.length > 1 && plain(parts[parts.length - 1]) === plain(neighborhood)) parts.pop();
    value = parts.join(' - ');
  }
  const [street, ...rest] = value.split(/\s+-\s+/);
  return { street: street || '', reference: rest.join(' - ') };
}

/** Rota até o endereço (QR da comanda): abre o mapa do celular já traçando o caminho. */
function mapsUrl(order, store = {}) {
  const { street } = splitAddress(order.address, order.neighborhood);
  const destination = [street, text(order.neighborhood), [text(store.city), text(store.state)].filter(Boolean).join(' - ')].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/**
 * Pix pago de verdade: o comprovante chegou e a loja conferiu (o pedido saiu de
 * "Aguardando comprovante"). Escolher Pix no pedido não quer dizer que pagou.
 */
function isPixConfirmed(order) {
  return order.paymentMethod === 'PIX' && Boolean(order.pixProofAt) && !['AWAITING_PIX', 'CANCELED'].includes(order.apiStatus);
}

/**
 * O que fazer com o dinheiro, pela forma e pela situação real do pagamento.
 * `title` (forma), `main` (a ordem: COBRAR/PAGO), `lines` (o que mais precisa saber),
 * `change`/`changeNote` (troco, separado por um traço).
 */
function paymentInstructions(order) {
  const pickup = order.mode === 'pickup';
  const total = money(order.total);
  const method = order.paymentMethod;
  if (method === 'PIX') {
    if (order.apiStatus === 'AWAITING_PIX') {
      return { title: 'PAGAMENTO VIA PIX', main: 'PIX NÃO CONFERIDO', lines: [pickup ? 'NÃO ENTREGAR ANTES DE CONFERIR' : 'NÃO SAIR ANTES DE CONFERIR'] };
    }
    if (isPixConfirmed(order)) return { title: 'PAGAMENTO VIA PIX', main: 'PAGO', lines: ['NÃO COBRAR'] };
    return { title: pickup ? 'PIX NA RETIRADA' : 'PIX NA ENTREGA', main: `COBRAR ${total}`, lines: ['AGUARDAR CONFIRMAÇÃO DO PIX'] };
  }
  if (method === 'CASH') {
    const paysWith = Number(order.changeFor) || 0;
    if (paysWith > Number(order.total)) {
      return {
        title: 'PAGAMENTO EM DINHEIRO', main: `COBRAR ${total}`, lines: [],
        change: `${pickup ? 'SEPARAR' : 'LEVAR'} ${money(paysWith - Number(order.total))} DE TROCO`,
        changeNote: `Cliente paga com ${money(paysWith)}`,
      };
    }
    return { title: 'PAGAMENTO EM DINHEIRO', main: `COBRAR ${total}`, lines: ['NÃO PRECISA DE TROCO'] };
  }
  if (method === 'CREDIT_CARD' || method === 'DEBIT_CARD') {
    const kind = method === 'CREDIT_CARD' ? 'Crédito' : 'Débito';
    return { title: 'PAGAMENTO EM CARTÃO', main: `COBRAR ${total}`, lines: [pickup ? `PASSAR NO BALCÃO · ${kind}` : `LEVAR MAQUININHA · ${kind}`] };
  }
  // Forma desconhecida (pedido antigo): cobra o total, sem inventar situação
  return { title: text(order.payment).toUpperCase() || 'PAGAMENTO', main: `COBRAR ${total}`, lines: [] };
}

/**
 * Previsão (mesma regra da página do pedido, web/lib/orders.js → etaOf): de quando a loja
 * aceitou (ou do pedido) + preparo + atraso avisado; entrega soma o caminho.
 */
function forecastOf(order, prepMinutes) {
  const prep = Number(prepMinutes) || 0;
  const start = order.acceptedAt || order.createdAt;
  if (prep <= 0 || !start) return null;
  const ready = new Date(new Date(start).getTime() + (prep + (Number(order.delayMinutes) || 0)) * MIN);
  if (order.mode === 'pickup') return { ready, label: `Retirada prevista: ${clock(ready)}` };
  const arrives = new Date(ready.getTime() + DELIVERY_TRAVEL_MINUTES * MIN);
  return { ready, label: `Sair até ${clock(ready)} · chega até ${clock(arrives)}` };
}

/** Linhas do resumo: só o que existe (desconto, taxa e acréscimo zerados não aparecem). */
function summaryOf(order) {
  const lines = [{ label: 'Subtotal', value: money(order.subtotal) }];
  if (Number(order.discount) > 0) lines.push({ label: 'Desconto', value: `- ${money(order.discount)}` });
  if (Number(order.fee) > 0) lines.push({ label: 'Taxa de entrega', value: money(order.fee) });
  if (Number(order.surcharge) > 0) lines.push({ label: 'Acréscimo', value: money(order.surcharge) });
  return { lines, total: money(order.total) };
}

/**
 * Tudo da comanda num formato só. `store`: { name, city, state, prepMinutes }.
 * @returns {object} dados prontos para a apresentação
 */
function receiptData(order, store = {}) {
  const created = new Date(order.createdAt || Date.now());
  const delivery = order.mode !== 'pickup';
  const { street, reference } = splitAddress(order.address, order.neighborhood);
  const items = (order.items || []).map((line) => ({
    qty: Number(line.qty) || 0,
    name: text(line.name),
    // Valor da linha como o sistema gravou; pedido antigo sem ele usa preço × quantidade
    value: money(line.subtotal ?? (Number(line.price) || 0) * (Number(line.qty) || 0)),
    extras: (line.options || []).filter((o) => text(o?.name)).map((o) => `${Number(o.quantity) || 1}x ${text(o.name)}${line.qty > 1 ? ' em cada' : ''}`),
    note: text(line.notes),
  }));
  return {
    test: Boolean(order.test),
    storeName: text(store.name),
    number: order.number,
    date: dayMonth(created),
    time: clock(created),
    delivery,
    forecast: forecastOf(order, store.prepMinutes),
    items,
    count: items.reduce((sum, i) => sum + i.qty, 0),
    notes: text(order.notes),
    customer: { name: text(order.customer?.name), phone: displayPhone(order.customer?.phone) },
    address: delivery ? { neighborhood: text(order.neighborhood), street, reference } : null,
    summary: summaryOf(order),
    payment: paymentInstructions(order),
    mapsUrl: delivery && street ? mapsUrl(order, store) : '',
  };
}

module.exports = {
  BUSINESS_TIME_ZONE, receiptData, paymentInstructions, isPixConfirmed, forecastOf, summaryOf,
  splitAddress, mapsUrl, displayPhone, money,
};
