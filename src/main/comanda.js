'use strict';

/**
 * Comandas impressas (térmica 80 mm, ou 58 mm em Ajustes). Três modelos com as mesmas peças:
 *  - producao: cozinha. Número, horário, tipo, previsão, itens grandes, adicionais e observações.
 *    Sem valores, endereço, pagamento ou QR.
 *  - entrega: entregador. Bairro, endereço, telefone, itens com valor, resumo, o que cobrar e o
 *    troco, e o QR com a rota.
 *  - retirada: balcão. Cliente, previsão de retirada, itens, total e o que cobrar. Sem endereço.
 *
 * Os dados vêm prontos de comanda-dados.js; aqui é só o papel. Só preto sobre branco, linhas
 * finas, sem fundo preenchido, medidas em mm/pt. A altura acompanha o conteúdo (a impressão
 * mede a página e pede o papel exato; ver printOrder em main.js).
 */

const { receiptData, paymentInstructions, isPixConfirmed, splitAddress, mapsUrl, displayPhone, forecastOf } = require('./comanda-dados');

const KINDS = ['producao', 'entrega', 'retirada'];
const KIND_LABELS = { producao: 'Produção (cozinha)', entrega: 'Entrega (entregador)', retirada: 'Retirada (balcão)' };

/** Larguras de papel aceitas (mm), a área que a cabeça da térmica imprime de fato e a letra base (pt). */
const PAPER = { 80: { page: 80, print: 72, base: 9.5, qr: 24 }, 58: { page: 58, print: 48, base: 7.8, qr: 20 } };
const paperOf = (width) => PAPER[Number(width)] || PAPER[80];

/**
 * Altura do papel (mícrons) para o conteúdo medido em px (96 por polegada): arredonda para cima
 * e soma 1 mm de folga, para nunca sobrar uma 2ª página nem cortar a última linha.
 */
const pageHeightMicrons = (heightPx) => (Math.ceil((Number(heightPx) * 25.4) / 96) + 1) * 1000;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Qual comanda acompanha o pedido (a da cozinha sai junto, se a loja quiser). */
const customerKind = (order) => (order.mode === 'pickup' ? 'retirada' : 'entrega');

function styles(paper) {
  const side = (paper.page - paper.print) / 2;
  return `
  @page { margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: ${paper.base}pt; background: #fff; }
  body { width: ${paper.page}mm; padding: 2mm ${side}mm 1mm; font-family: Arial, Helvetica, sans-serif; line-height: 1.22; color: #000; background: #fff; overflow: hidden; }
  @media print { html, body { height: auto; } }
  .store { text-align: center; font-size: 1.15rem; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; }
  .kind { text-align: center; font-size: .78rem; font-weight: 700; letter-spacing: .12em; margin-top: .4mm; }
  .test { border: .25mm dashed #000; text-align: center; font-size: .8rem; font-weight: 700; padding: .8mm; margin-top: 1.2mm; }
  .id { display: flex; justify-content: space-between; align-items: flex-end; gap: 2mm; margin-top: 1.6mm; }
  .num { font-size: 2.5rem; font-weight: 700; line-height: .95; letter-spacing: -.02em; }
  .when { text-align: right; font-size: .9rem; font-weight: 700; line-height: 1.15; white-space: nowrap; }
  .rule { border-top: .3mm solid #000; margin: 1.8mm 0; }
  .dash { border-top: .25mm dashed #000; margin: 1.8mm 0; }
  .label { font-size: .72rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; margin-bottom: .6mm; }
  .wrap { overflow-wrap: anywhere; word-break: normal; }

  .mode { display: flex; justify-content: space-between; align-items: center; gap: 2mm; border: .3mm solid #000; padding: 1mm 2mm; margin-top: 1.8mm; }
  .mode b { font-size: 1.25rem; }
  .mode span { font-size: .95rem; font-weight: 700; text-align: right; }

  .bairro { font-size: 1.85rem; font-weight: 700; line-height: 1.02; text-transform: uppercase; }
  .street { font-size: 1.15rem; font-weight: 700; margin-top: .8mm; }
  .ref { font-size: .95rem; margin-top: .4mm; }
  .client { font-size: .95rem; margin-top: 1.2mm; }
  .client-big { font-size: 1.45rem; font-weight: 700; line-height: 1.1; }
  .phone { font-size: 1.1rem; font-weight: 700; }
  .forecast { font-size: 1rem; font-weight: 700; margin-top: 1mm; }

  .cols { display: grid; grid-template-columns: 8mm 1fr auto; column-gap: 1.5mm; font-size: .68rem; font-weight: 700; letter-spacing: .08em; padding-bottom: .6mm; border-bottom: .25mm solid #000; }
  .row { display: grid; grid-template-columns: 8mm 1fr auto; column-gap: 1.5mm; padding: 1mm 0; }
  .row + .row { border-top: .2mm dashed #000; }
  .row .q { font-size: 1.05rem; font-weight: 700; }
  .row .n { font-size: 1.05rem; font-weight: 700; min-width: 0; }
  .row .v { font-size: .95rem; text-align: right; white-space: nowrap; padding-top: .2mm; }
  .extra { font-size: .9rem; font-weight: 400; margin-top: .3mm; }
  .note { font-size: .9rem; font-weight: 700; margin-top: .3mm; }

  .prod { display: grid; grid-template-columns: 11mm 1fr; column-gap: 1.5mm; padding: 1.4mm 0; }
  .prod + .prod { border-top: .25mm dashed #000; }
  .prod .q { font-size: 1.6rem; font-weight: 700; line-height: 1; }
  .prod .n { font-size: 1.4rem; font-weight: 700; line-height: 1.08; min-width: 0; }
  .prod .extra { font-size: 1.1rem; margin-top: .5mm; }
  .prod .note { font-size: 1.1rem; margin-top: .5mm; }

  .obs { border: .3mm solid #000; padding: 1.2mm 1.6mm; margin-top: 1.8mm; font-size: 1rem; font-weight: 700; }
  .obs .label { margin-bottom: .3mm; }

  .sum div { display: flex; justify-content: space-between; gap: 2mm; font-size: .95rem; padding: .25mm 0; }
  .sum .total { font-size: 1.35rem; font-weight: 700; border-top: .3mm solid #000; margin-top: .8mm; padding-top: .8mm; }

  .pay { border: .3mm solid #000; padding: 1.6mm 2mm; margin-top: 2mm; text-align: center; break-inside: avoid; }
  .pay .t { font-size: .78rem; font-weight: 700; letter-spacing: .1em; }
  .pay .m { font-size: 1.5rem; font-weight: 700; line-height: 1.1; margin-top: .6mm; }
  .pay .l { font-size: .95rem; font-weight: 700; margin-top: .5mm; }
  .pay .sep { border-top: .25mm dashed #000; margin: 1.4mm 4mm; }
  .pay .c { font-size: 1.2rem; font-weight: 700; }
  .pay .cn { font-size: .85rem; margin-top: .3mm; }

  .qr { display: grid; grid-template-columns: ${paper.qr}mm 1fr; column-gap: 3mm; align-items: center; margin-top: 2.2mm; break-inside: avoid; }
  .qr svg { display: block; width: ${paper.qr}mm; height: ${paper.qr}mm; shape-rendering: crispEdges; }
  .qr b { display: block; font-size: .9rem; letter-spacing: .06em; }
  .qr p { font-size: .85rem; margin-top: .5mm; }

  .foot { text-align: center; font-size: .72rem; margin-top: 2.2mm; padding-top: 1.2mm; border-top: .2mm dashed #000; }
`;
}

// ------------------------------------------------------------------- peças comuns

function header(data, kindTitle) {
  return `
${data.storeName ? `<div class="store">${escapeHtml(data.storeName)}</div>` : ''}
<div class="kind">${escapeHtml(kindTitle)}</div>
${data.test ? '<div class="test">COMANDA DE TESTE · NÃO É UM PEDIDO</div>' : ''}
<div class="id"><span class="num">#${escapeHtml(data.number)}</span><span class="when">${escapeHtml(data.date)}<br>${escapeHtml(data.time)}</span></div>
<div class="rule"></div>`;
}

function itemsWithValues(data) {
  const rows = data.items.map((i) => `
<div class="row"><span class="q">${i.qty}x</span><div class="n wrap">${escapeHtml(i.name)}${i.extras.map((e) => `<div class="extra">+ ${escapeHtml(e)}</div>`).join('')}${i.note ? `<div class="note">Obs.: ${escapeHtml(i.note)}</div>` : ''}</div><span class="v">${escapeHtml(i.value)}</span></div>`).join('');
  return `
<div class="label">Produtos · ${data.count} ${data.count === 1 ? 'item' : 'itens'}</div>
<div class="cols"><span>QTD</span><span>PRODUTO</span><span>VALOR</span></div>
${rows}`;
}

function orderNotes(data) {
  return data.notes ? `<div class="obs"><div class="label">Observações do pedido</div><div class="wrap">${escapeHtml(data.notes)}</div></div>` : '';
}

function summary(data) {
  return `
<div class="rule"></div>
<div class="sum">
  ${data.summary.lines.map((l) => `<div><span>${escapeHtml(l.label)}</span><span>${escapeHtml(l.value)}</span></div>`).join('')}
  <div class="total"><span>Total</span><span>${escapeHtml(data.summary.total)}</span></div>
</div>`;
}

function paymentBox(data) {
  const p = data.payment;
  return `
<div class="pay">
  <div class="t">${escapeHtml(p.title)}</div>
  <div class="m">${escapeHtml(p.main)}</div>
  ${p.lines.map((l) => `<div class="l">${escapeHtml(l)}</div>`).join('')}
  ${p.change ? `<div class="sep"></div><div class="c">${escapeHtml(p.change)}</div><div class="cn">${escapeHtml(p.changeNote)}</div>` : ''}
</div>`;
}

function footer(data) {
  return `<div class="foot">${data.storeName ? `${escapeHtml(data.storeName)} • ` : ''}Buffet Control</div>`;
}

function page(paper, title, body) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<style>${styles(paper)}</style></head><body>${body}
</body></html>`;
}

// ------------------------------------------------------------------- os três modelos

function productionBody(data) {
  const items = data.items.map((i) => `
<div class="prod"><span class="q">${i.qty}x</span><div class="n wrap">${escapeHtml(i.name)}${i.extras.map((e) => `<div class="extra">+ ${escapeHtml(e)}</div>`).join('')}${i.note ? `<div class="note">» ${escapeHtml(i.note)}</div>` : ''}</div></div>`).join('');
  return `
${header(data, 'COMANDA DE PRODUÇÃO')}
<div class="mode"><b>${data.delivery ? 'ENTREGA' : 'RETIRADA'}</b>${data.forecast ? `<span>Pronto até ${escapeHtml(timeOf(data.forecast.ready))}</span>` : ''}</div>
<div class="label" style="margin-top:2mm">${data.count} ${data.count === 1 ? 'item' : 'itens'}</div>
${items}
${orderNotes(data)}
${footer(data)}`;
}

function deliveryBody(data, qrSvg) {
  const a = data.address || { neighborhood: '', street: '', reference: '' };
  const { name, phone } = data.customer;
  // Sem nenhum dado, nem o título aparece
  const hasWhere = Boolean(a.neighborhood || a.street || a.reference || name || phone);
  return `
${header(data, 'COMANDA DE ENTREGA')}
${hasWhere ? '<div class="label">Dados da entrega</div>' : ''}
${a.neighborhood ? `<div class="bairro wrap">${escapeHtml(a.neighborhood)}</div>` : ''}
${a.street ? `<div class="street wrap">${escapeHtml(a.street)}</div>` : ''}
${a.reference ? `<div class="ref wrap">Compl./ref.: ${escapeHtml(a.reference)}</div>` : ''}
${name || phone ? `<div class="client wrap">${escapeHtml(name)}${name && phone ? '<br>' : ''}${phone ? `<span class="phone">${escapeHtml(phone)}</span>` : ''}</div>` : ''}
${hasWhere ? '<div class="rule"></div>' : ''}
${itemsWithValues(data)}
${orderNotes(data)}
${summary(data)}
${paymentBox(data)}
${qrSvg ? `<div class="qr">${qrSvg}<div><b>ROTA DE ENTREGA</b><p>Escaneie para abrir o endereço no mapa.</p></div></div>` : ''}
${footer(data)}`;
}

function pickupBody(data) {
  return `
${header(data, 'COMANDA DE RETIRADA')}
${data.customer.name || data.customer.phone ? '<div class="label">Cliente</div>' : ''}
${data.customer.name ? `<div class="client-big wrap">${escapeHtml(data.customer.name)}</div>` : ''}
${data.customer.phone ? `<div class="phone">${escapeHtml(data.customer.phone)}</div>` : ''}
${data.forecast ? `<div class="forecast">${escapeHtml(data.forecast.label)}</div>` : ''}
<div class="rule"></div>
${itemsWithValues(data)}
${orderNotes(data)}
${summary(data)}
${paymentBox(data)}
${footer(data)}`;
}

const timeOf = (date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(date);

/**
 * HTML de uma comanda.
 * @param {'producao'|'entrega'|'retirada'} kind modelo
 * @param {object} order pedido no formato do app (platform.toLocal)
 * @param {{name?: string, city?: string, state?: string, prepMinutes?: number, paperWidth?: number}} store
 * @param {string} [qrSvg] QR da rota já gerado (SVG), só para a comanda de entrega
 */
function renderReceipt(kind, order, store = {}, qrSvg = '') {
  if (!KINDS.includes(kind)) throw new Error(`Modelo de comanda desconhecido: ${kind}`);
  const paper = paperOf(store.paperWidth);
  const data = receiptData(order, store);
  const body = kind === 'producao' ? productionBody(data) : kind === 'entrega' ? deliveryBody(data, qrSvg) : pickupBody(data);
  return page(paper, `Pedido ${order.number} · ${KIND_LABELS[kind]}`, body);
}

module.exports = {
  KINDS, KIND_LABELS, renderReceipt, customerKind, paperOf, pageHeightMicrons,
  // dados (reexportados para quem já usava daqui)
  paymentInstructions, isPixConfirmed, splitAddress, mapsUrl, displayPhone, forecastOf,
};
