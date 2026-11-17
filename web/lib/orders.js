// Validação de pedidos feitos pela página. O navegador do cliente não é
// confiável: preços, taxa e disponibilidade vêm sempre do cardápio que o app
// desktop sincronizou, nunca do que o navegador mandou.

import { isOpen } from './hours.js';

/** O app desktop consulta a cada 5 s; sem notícia há mais que isso, a loja está offline. */
export const ONLINE_WINDOW_MS = 90 * 1000;

const round2 = (value) => Math.round(value * 100) / 100;
const text = (value, max) => String(value ?? '').trim().slice(0, max);
const normalize = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function storeIsOnline(store, now = new Date()) {
  return Boolean(store.last_seen_at) && now - new Date(store.last_seen_at) < ONLINE_WINDOW_MS;
}

/** Itens do cardápio por id, só os disponíveis. */
export function availableItems(menu) {
  const map = new Map();
  for (const category of menu || []) {
    for (const item of category.items || []) {
      if (item.available !== false) map.set(item.id, { ...item, category: category.name });
    }
  }
  return map;
}

/** Situação da loja para a página: aberta, fechada pelo horário ou sem conexão. */
export function storeAvailability(store, now = new Date()) {
  if (!storeIsOnline(store, now)) return { canOrder: false, reason: 'offline' };
  if (!isOpen(store.info?.hours, now)) return { canOrder: false, reason: 'closed' };
  return { canOrder: true, reason: '' };
}

/**
 * Confere um pedido vindo da página e calcula os valores.
 * @returns {{ok: true, order: object} | {ok: false, error: string}}
 */
export function validateOrder(store, input, now = new Date()) {
  const info = store.info || {};
  const availability = storeAvailability(store, now);
  if (availability.reason === 'offline') return { ok: false, error: 'A loja está sem conexão agora. Tente de novo em instantes ou chame no WhatsApp.' };
  if (availability.reason === 'closed') return { ok: false, error: 'A loja está fechada agora.' };

  const menu = availableItems(store.menu);
  const raw = Array.isArray(input?.items) ? input.items : [];
  if (raw.length === 0) return { ok: false, error: 'Seu carrinho está vazio.' };
  if (raw.length > 50) return { ok: false, error: 'Pedido grande demais. Fale com a loja pelo WhatsApp.' };
  const items = [];
  for (const line of raw) {
    const item = menu.get(String(line?.itemId));
    if (!item) return { ok: false, error: 'Um dos itens não está mais disponível. Atualize a página.' };
    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) return { ok: false, error: 'Quantidade inválida.' };
    items.push({ itemId: item.id, name: item.name, price: Number(item.price) || 0, qty, notes: text(line.notes, 140) });
  }

  const name = text(input?.customer?.name, 60);
  if (name.length < 2) return { ok: false, error: 'Informe seu nome.' };
  const phone = String(input?.customer?.phone || '').replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 13) return { ok: false, error: 'Informe um WhatsApp com DDD.' };

  const mode = input?.mode === 'pickup' ? 'pickup' : 'delivery';
  if (mode === 'delivery' && info.delivery === false) return { ok: false, error: 'Esta loja não faz entrega.' };
  if (mode === 'pickup' && info.pickup === false) return { ok: false, error: 'Esta loja não tem retirada.' };
  const address = mode === 'delivery' ? text(input?.address, 300) : '';
  if (mode === 'delivery' && address.length < 8) return { ok: false, error: 'Informe o endereço completo: rua, número e bairro.' };

  const payments = Array.isArray(info.payments) ? info.payments : [];
  const payment = payments.find((p) => normalize(p) === normalize(input?.payment));
  if (!payment) return { ok: false, error: 'Escolha uma forma de pagamento.' };
  const changeValue = Number(input?.changeFor);
  const changeFor = normalize(payment).includes('dinheiro') && changeValue > 0 ? round2(changeValue) : null;

  const subtotal = round2(items.reduce((sum, line) => sum + line.qty * line.price, 0));
  const minOrder = Number(info.minOrder) || 0;
  if (subtotal < minOrder) {
    return { ok: false, error: `O pedido mínimo é R$ ${minOrder.toFixed(2).replace('.', ',')}.` };
  }
  const fee = mode === 'delivery' ? round2(Number(info.deliveryFee) || 0) : 0;
  const total = round2(subtotal + fee);
  if (changeFor !== null && changeFor < total) return { ok: false, error: 'O troco precisa ser para um valor maior que o total.' };

  const ref = /^[a-z0-9]{6,24}$/.test(String(input?.ref || '')) ? String(input.ref) : '';

  return {
    ok: true,
    order: {
      ref, customer: { name, phone }, items, mode, address, payment, changeFor,
      notes: text(input?.notes, 300), subtotal, fee, total,
    },
  };
}
