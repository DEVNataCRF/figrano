'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/main/store');
const { BotEngine } = require('../src/main/robo/engine');
const { statusAviso, confirmedMessage, parseReview, reviewRequest } = require('../src/main/robo/avisos');

const LINK = 'http://site.test/pedido/?id=o1&t=0001';
const order = (status) => ({ id: 'o1', number: 12, status, customer: { phone: '5528999990001' } });

test('avisos de produção, saída, retirada e entrega, com o link de acompanhamento', () => {
  assert.match(statusAviso(order('preparing'), { storeName: 'Sabores da Sil', link: LINK }), /Recebemos seu pedido #12 e ele já está sendo preparado[\s\S]*Acompanhe aqui: http:\/\/site\.test/);
  assert.match(statusAviso(order('out'), { storeName: 'Sabores da Sil', link: LINK }), /saiu para entrega/);
  assert.match(statusAviso(order('ready'), { storeName: 'Sabores da Sil', link: LINK }), /pronto para retirada/);
  assert.match(statusAviso(order('done'), { storeName: 'Sabores da Sil', link: LINK }), /#12 entregue/);
  assert.match(reviewRequest(order('done')), /nota de \*1 a 5\*/);
});

test('lê a nota do cliente em vários jeitos; outra mensagem não é nota', () => {
  assert.deepEqual(parseReview('5'), { rating: 5, comment: null });
  assert.deepEqual(parseReview('nota 4, chegou quentinho'), { rating: 4, comment: 'chegou quentinho' });
  assert.deepEqual(parseReview('3 estrelas'), { rating: 3, comment: null });
  assert.deepEqual(parseReview('⭐⭐⭐⭐⭐'), { rating: 5, comment: null });
  assert.deepEqual(parseReview('cinco'), { rating: 5, comment: null });
  assert.equal(parseReview('quero 10 coxinhas'), null);
  assert.equal(parseReview('8'), null);
});

test('nota respondida: grava, agradece; nota baixa avisa a Sil', async () => {
  const store = new Store(null);
  const saved = [];
  const engine = new BotEngine({ store, onReview: async (id, rating, comment) => saved.push({ id, rating, comment }) });
  store.setPendingReview('a@c.us', { orderId: 'o1', number: 12 });
  const good = await engine.handle({ chatId: 'a@c.us', type: 'chat', text: '5' });
  assert.match(good.replies[0], /Obrigada pela nota 5/);
  assert.deepEqual(saved[0], { id: 'o1', rating: 5, comment: null });
  assert.equal(store.pendingReview('a@c.us'), null, 'não pergunta de novo');

  store.setPendingReview('b@c.us', { orderId: 'o2', number: 13 });
  const bad = await engine.handle({ chatId: 'b@c.us', name: 'Rui', type: 'chat', text: '2 demorou demais' });
  assert.match(bad.replies[0], /avisei a Sil/);
  assert.ok(store.handoffs.some((h) => h.chatId === 'b@c.us' && /2\/5/.test(h.motive)));
});

test('"quero acompanhar meu pedido" responde o status e o link', async () => {
  const store = new Store(null);
  const engine = new BotEngine({ store, trackingLink: () => LINK });
  store.createOrder({ customer: { chatId: 'c@c.us', name: 'Ana', phone: '5528999990001' }, items: [{ name: 'Coxinha', qty: 10, price: 3.5 }], mode: 'pickup', payment: 'Pix' });
  store.setOrderStatus(store.orders[0].id, 'out');
  const out = await engine.handle({ chatId: 'c@c.us', type: 'chat', text: 'quero acompanhar meu pedido' });
  assert.match(out.replies[0], /saiu para entrega[\s\S]*Acompanhe aqui: http:\/\/site\.test/);
});

test('pedido confirmado: modelo com itens, taxa, total, pagamento e onde entrega', () => {
  const pedido = {
    number: 430, status: 'preparing', customer: { name: 'Nata Correa Figueiredo' }, mode: 'delivery',
    address: 'Av Francisco Lacerda de Aguiar, 120 - Centro', neighborhood: 'Centro', fee: 2, total: 38,
    payment: 'Cartão de crédito', paymentMethod: 'CREDIT_CARD',
    items: [
      { name: 'Refrigerante 600ml', qty: 1, price: 9, subtotal: 9, options: [] },
      { name: 'Big Manos', qty: 1, price: 27, subtotal: 27, options: [{ name: 'Maionese', quantity: 2 }] },
    ],
  };
  const text = confirmedMessage(pedido, { storeName: 'Sabores da Sil', link: LINK });
  assert.equal(text.split('\n')[0], 'Olá, Nata Correa Figueiredo! 👋');
  for (const line of [
    'Recebemos seu pedido #430 e ele já está sendo preparado. 😋',
    '📦 Itens:',
    '   • 1x Refrigerante 600ml — R$ 9,00',
    '   • 1x Big Manos — R$ 27,00',
    '      + 2x Maionese',
    '🚚 Taxa de entrega: R$ 2,00',
    '💰 Total: R$ 38,00',
    '💳 Pagamento: Cartão de crédito',
    '📍 Entrega: Av Francisco Lacerda de Aguiar, 120 — Centro',
    'Sabores da Sil',
    'Avisamos por aqui quando sair para entrega.',
    `Acompanhe aqui: ${LINK}`,
    'Obrigado! ❤️',
  ]) assert.ok(text.split('\n').includes(line), `faltou: ${line}`);
});

test('pedido confirmado: retirada, Pix já pago, troco e entrega grátis', () => {
  const base = { number: 7, customer: { name: 'Ana' }, items: [{ name: 'Coxinha', qty: 10, price: 1.5, options: [] }], total: 15 };
  const retirada = confirmedMessage({ ...base, mode: 'pickup', fee: 0, paymentMethod: 'PIX', payment: 'Pix', pixProofAt: '2026-11-25T20:00:00Z' }, { storeName: 'Sabores da Sil', pickupAddress: 'Rua da Sil, 10' });
  assert.match(retirada, /💳 Pagamento: Pix \(pago ✅\)/);
  assert.match(retirada, /🏪 Retirada: Rua da Sil, 10/);
  assert.match(retirada, /quando estiver pronto para retirar/);
  assert.doesNotMatch(retirada, /Taxa de entrega|Entrega grátis/);
  assert.match(retirada, /• 10x Coxinha — R\$ 15,00/); // sem subtotal gravado: preço × quantidade
  const dinheiro = confirmedMessage({ ...base, mode: 'delivery', address: 'Rua A, 1', neighborhood: '', fee: 0, paymentMethod: 'CASH', payment: 'Dinheiro', changeFor: 50 }, { storeName: 'Sabores da Sil' });
  assert.match(dinheiro, /Dinheiro \(troco para R\$ 50,00\)/);
  assert.match(dinheiro, /🚚 Entrega grátis/);
  assert.match(dinheiro, /📍 Entrega: Rua A, 1\n/);
});
