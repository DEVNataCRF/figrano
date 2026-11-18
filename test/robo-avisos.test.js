'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/main/store');
const { BotEngine } = require('../src/main/robo/engine');
const { statusAviso, parseReview, reviewRequest } = require('../src/main/robo/avisos');

const LINK = 'http://site.test/pedido/?id=o1&t=0001';
const order = (status) => ({ id: 'o1', number: 12, status, customer: { phone: '5528999990001' } });

test('avisos de produção, saída, retirada e entrega, com o link de acompanhamento', () => {
  assert.match(statusAviso(order('preparing'), { storeName: 'Sabores da Sil', link: LINK }), /#12 entrou em produção[\s\S]*Acompanhe aqui: http:\/\/site\.test/);
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
