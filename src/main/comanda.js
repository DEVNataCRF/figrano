'use strict';

/**
 * Comanda impressa (térmica 80 mm). Feita para quem tem pressa:
 *  - cozinha: número grande, ENTREGA/RETIRADA, itens com a quantidade em destaque;
 *  - entregador: BAIRRO grande, rua e número, referência, cliente, QR que abre o mapa e,
 *    principalmente, QUANTO COBRAR e QUANTO LEVAR DE TROCO, sem conta de cabeça.
 * Só preto e branco, sem fundo (a impressão sai sem cor de fundo).
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v) => BRL.format(Number(v) || 0);
const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function displayPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(raw || '');
}

/**
 * "Rua X, 120 - casa azul - Centro" → { street: 'Rua X, 120', reference: 'casa azul' }.
 * O bairro já vem separado; se ele estiver no fim do endereço, sai daqui para não repetir.
 */
function splitAddress(address, neighborhood) {
  let text = String(address || '').trim();
  if (neighborhood) {
    const parts = text.split(/\s+-\s+/);
    if (parts.length > 1 && plain(parts[parts.length - 1]) === plain(neighborhood)) parts.pop();
    text = parts.join(' - ');
  }
  const [street, ...rest] = text.split(/\s+-\s+/);
  return { street: street || '', reference: rest.join(' - ') };
}

/** O que o entregador faz com o dinheiro: a linha grande e a explicação embaixo. */
function chargeLines(order, { pixOnline = false } = {}) {
  const total = money(order.total);
  const method = order.paymentMethod;
  if (method === 'PIX') {
    if (order.apiStatus === 'AWAITING_PIX') return { big: 'PIX NÃO CONFERIDO', small: 'Não sair antes de a loja conferir o pagamento.' };
    if (order.pixProofAt || pixOnline) return { big: 'PAGO NO PIX', small: 'NÃO COBRAR NADA.' };
    return { big: `COBRAR ${total}`, small: 'No Pix, na entrega.' };
  }
  if (method === 'CASH') {
    const change = Number(order.changeFor) || 0;
    if (change > Number(order.total)) {
      return { big: `COBRAR ${total}`, small: 'EM DINHEIRO', change: `LEVAR ${money(change - Number(order.total))} DE TROCO`, note: `Cliente paga com ${money(change)}` };
    }
    return { big: `COBRAR ${total}`, small: 'EM DINHEIRO · sem troco' };
  }
  const card = method === 'CREDIT_CARD' ? 'CRÉDITO' : method === 'DEBIT_CARD' ? 'DÉBITO' : String(order.payment || '').toUpperCase();
  return { big: `COBRAR ${total}`, small: order.mode === 'pickup' ? `CARTÃO DE ${card} · no balcão` : `CARTÃO DE ${card} · levar a maquininha` };
}

/** Endereço completo para o mapa do celular (QR code). */
function mapsUrl(order, store) {
  const { street } = splitAddress(order.address, order.neighborhood);
  const query = [street, order.neighborhood, [store.city, store.state].filter(Boolean).join(' - ')].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * HTML da comanda. `qrDataUrl` (opcional) é a imagem do QR do mapa já gerada.
 * `store`: { name, city, state, pixOnline }.
 */
function receiptHtml(order, store = {}, qrDataUrl = '') {
  const delivery = order.mode === 'delivery';
  const { street, reference } = splitAddress(order.address, order.neighborhood);
  const charge = chargeLines(order, store);
  const time = new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const date = new Date(order.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const items = order.items.map((line) => `
    <div class="item"><b class="qty">${line.qty}x</b><div><b>${escapeHtml(line.name)}</b>${line.notes ? `<div class="note">» ${escapeHtml(line.notes)}</div>` : ''}</div></div>`).join('');

  return `<!doctype html><meta charset="utf-8"><title>Pedido ${order.number}</title>
<style>
  @page { margin: 0; }
  body { font: 13px/1.35 Arial, Helvetica, sans-serif; width: 72mm; margin: 0; padding: 3mm 4mm 8mm; color: #000; }
  .store { font-size: 12px; text-align: center; margin-bottom: 1mm; }
  .head { display: flex; justify-content: space-between; align-items: baseline; }
  .num { font-size: 34px; font-weight: 900; letter-spacing: -1px; }
  .when { font-size: 13px; font-weight: 700; text-align: right; }
  .mode { border: 3px solid #000; text-align: center; font-size: 20px; font-weight: 900; padding: 1mm; margin: 1mm 0 2mm; letter-spacing: 1px; }
  .sec { font-size: 11px; font-weight: 900; letter-spacing: 2px; text-align: center; margin: 2mm 0 1mm; }
  .item { display: grid; grid-template-columns: 11mm 1fr; gap: 1mm; padding: 1mm 0; border-bottom: 1px dotted #000; font-size: 15px; }
  .qty { font-size: 18px; }
  .note { font-size: 13px; font-weight: 700; }
  .obs { border: 2px solid #000; padding: 1.5mm; margin-top: 2mm; font-weight: 700; }
  .cut { text-align: center; margin: 3mm 0 2mm; font-size: 11px; border-top: 2px dashed #000; padding-top: 1mm; }
  .bairro-label { font-size: 11px; font-weight: 900; letter-spacing: 2px; }
  .bairro { font-size: 26px; font-weight: 900; line-height: 1.05; text-transform: uppercase; margin-bottom: 1mm; }
  .street { font-size: 17px; font-weight: 800; }
  .ref { font-size: 14px; margin-top: .5mm; }
  .client { margin-top: 1.5mm; font-size: 14px; }
  .map { display: flex; gap: 2mm; align-items: center; margin-top: 2mm; }
  .map img { width: 26mm; height: 26mm; }
  .map p { margin: 0; font-size: 12px; font-weight: 700; }
  .charge { border: 3px solid #000; padding: 2mm; margin-top: 3mm; text-align: center; }
  .charge .big { font-size: 22px; font-weight: 900; }
  .charge .small { font-size: 14px; font-weight: 800; margin-top: .5mm; }
  .charge .change { font-size: 18px; font-weight: 900; margin-top: 1.5mm; padding-top: 1.5mm; border-top: 2px solid #000; }
  .charge .note { font-size: 12px; margin-top: .5mm; }
  .totals { margin-top: 2mm; font-size: 12px; }
  .totals div { display: flex; justify-content: space-between; }
</style>
<div class="store">${escapeHtml(store.name || '')}</div>
<div class="head"><span class="num">#${order.number}</span><span class="when">${date}<br>${time}</span></div>
<div class="mode">${delivery ? 'ENTREGA' : 'RETIRADA NA LOJA'}</div>

<div class="sec">— COZINHA —</div>
${items}
${order.notes ? `<div class="obs">OBS.: ${escapeHtml(order.notes)}</div>` : ''}

<div class="cut">✂ - - - ${delivery ? 'ENTREGADOR' : 'BALCÃO'} - - -</div>
${delivery ? `
<div class="bairro-label">BAIRRO</div>
<div class="bairro">${escapeHtml(order.neighborhood || 'não informado')}</div>
<div class="street">${escapeHtml(street)}</div>
${reference ? `<div class="ref">Ref.: ${escapeHtml(reference)}</div>` : ''}` : ''}
<div class="client">${escapeHtml(order.customer.name)} · <b>${escapeHtml(displayPhone(order.customer.phone))}</b></div>
${delivery && qrDataUrl ? `<div class="map"><img src="${qrDataUrl}" alt=""><p>Aponte a câmera do celular:<br>abre o endereço no mapa.</p></div>` : ''}
<div class="charge"><div class="big">${escapeHtml(charge.big)}</div><div class="small">${escapeHtml(charge.small)}</div>${charge.change ? `<div class="change">${escapeHtml(charge.change)}</div><div class="note">${escapeHtml(charge.note)}</div>` : ''}</div>
<div class="totals">
  <div><span>Itens</span><span>${money(order.subtotal)}</span></div>
  ${order.fee ? `<div><span>Entrega</span><span>${money(order.fee)}</span></div>` : ''}
  <div><b>Total</b><b>${money(order.total)}</b></div>
</div>`;
}

module.exports = { receiptHtml, chargeLines, splitAddress, mapsUrl, displayPhone };
