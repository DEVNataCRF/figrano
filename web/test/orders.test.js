import test from 'node:test';
import assert from 'node:assert/strict';

import { validateOrder, storeAvailability } from '../lib/orders.js';
import { isOpen, localTime } from '../lib/hours.js';
import { validSlug, hashToken } from '../lib/auth.js';

// Quarta, 18/11/2026, 20:00 em Brasília = 23:00 UTC.
const WED_8PM_BRT = new Date('2026-11-18T23:00:00Z');
const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { closed: d === 1, open: '18:00', close: '23:00' }]));

function store(overrides = {}) {
  return {
    last_seen_at: new Date(WED_8PM_BRT.getTime() - 10_000),
    info: { hours, deliveryFee: 6, minOrder: 20, payments: ['Pix', 'Dinheiro'], delivery: true, pickup: true },
    menu: [{ id: 'c1', name: 'Pizzas', items: [
      { id: 'i1', name: 'Calabresa', price: 44.9, available: true },
      { id: 'i2', name: 'Camarão', price: 69.9, available: false },
    ] }],
    ...overrides,
  };
}

const good = {
  customer: { name: 'Rui', phone: '(28) 99882-6841' },
  items: [{ itemId: 'i1', qty: 2, notes: 'sem cebola' }],
  mode: 'delivery', address: 'Rua São José, 120, Centro', payment: 'pix',
};

test('horário é calculado no fuso de Brasília, não no do servidor', () => {
  assert.deepEqual(localTime(WED_8PM_BRT), { day: 3, minutes: 20 * 60 });
  assert.equal(isOpen(hours, WED_8PM_BRT), true);
  assert.equal(isOpen(hours, new Date('2026-11-18T12:00:00Z')), false); // 9h em Brasília
  assert.equal(isOpen(hours, new Date('2026-11-17T00:30:00Z')), false); // segunda 21:30, dia fechado
});

test('pedido válido: preços vêm do cardápio da loja, não do navegador', () => {
  const result = validateOrder(store(), { ...good, items: [{ itemId: 'i1', qty: 2, price: 0.01 }] }, WED_8PM_BRT);
  assert.equal(result.ok, true);
  assert.equal(result.order.subtotal, 89.8);
  assert.equal(result.order.fee, 6);
  assert.equal(result.order.total, 95.8);
  assert.equal(result.order.payment, 'Pix');
  assert.equal(result.order.customer.phone, '28998826841');
});

test('recusa item esgotado, loja fechada, loja offline e pedido abaixo do mínimo', () => {
  assert.equal(validateOrder(store(), { ...good, items: [{ itemId: 'i2', qty: 1 }] }, WED_8PM_BRT).ok, false);
  assert.match(validateOrder(store(), good, new Date('2026-11-18T12:00:00Z')).error, /fechada/);
  const offline = store({ last_seen_at: new Date(WED_8PM_BRT.getTime() - 5 * 60_000) });
  assert.match(validateOrder(offline, good, WED_8PM_BRT).error, /sem conexão/);
  assert.equal(storeAvailability(offline, WED_8PM_BRT).reason, 'offline');
  const cheap = store({ info: { ...store().info, minOrder: 100 } });
  assert.match(validateOrder(cheap, good, WED_8PM_BRT).error, /mínimo/);
});

test('entrega exige endereço; retirada não cobra taxa', () => {
  assert.match(validateOrder(store(), { ...good, address: 'rua' }, WED_8PM_BRT).error, /endereço/);
  const pickup = validateOrder(store(), { ...good, mode: 'pickup', address: '' }, WED_8PM_BRT);
  assert.equal(pickup.ok, true);
  assert.equal(pickup.order.fee, 0);
});

test('troco só em dinheiro e maior que o total', () => {
  const cash = { ...good, payment: 'Dinheiro' };
  assert.equal(validateOrder(store(), { ...cash, changeFor: '100' }, WED_8PM_BRT).order.changeFor, 100);
  assert.match(validateOrder(store(), { ...cash, changeFor: '50' }, WED_8PM_BRT).error, /troco/i);
  assert.equal(validateOrder(store(), { ...good, changeFor: '100' }, WED_8PM_BRT).order.changeFor, null);
});

test('ref do WhatsApp só passa se tiver formato seguro', () => {
  assert.equal(validateOrder(store(), { ...good, ref: 'abc123xy' }, WED_8PM_BRT).order.ref, 'abc123xy');
  assert.equal(validateOrder(store(), { ...good, ref: "x'; drop" }, WED_8PM_BRT).order.ref, '');
});

test('endereço da loja e hash do token', () => {
  assert.equal(validSlug('cantina-figrano'), true);
  for (const bad of ['ab', 'Cantina', 'api', 'a--b', '-abc', 'cantína']) assert.equal(validSlug(bad), false, bad);
  assert.equal(hashToken('x').length, 64);
});
