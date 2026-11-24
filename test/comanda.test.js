'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { receiptHtml, chargeLines, splitAddress, mapsUrl } = require('../src/main/comanda');

const base = {
  number: 77, mode: 'delivery', createdAt: Date.parse('2026-11-21T22:40:00Z'),
  customer: { name: 'Maria', phone: '5528999990000' },
  items: [{ name: 'Coxinha', qty: 7, price: 3.5, notes: 'bem sequinha' }],
  address: 'Rua Doutor Antônio Pinto, 120 - casa azul - Centro', neighborhood: 'Centro',
  paymentMethod: 'CASH', payment: 'Dinheiro', changeFor: 50, subtotal: 24.5, fee: 5, total: 29.5, notes: '',
};

test('separa rua, referência e bairro sem repetir o bairro', () => {
  assert.deepEqual(splitAddress(base.address, 'Centro'), { street: 'Rua Doutor Antônio Pinto, 120', reference: 'casa azul' });
  assert.deepEqual(splitAddress('Rua A, 10', 'centro'), { street: 'Rua A, 10', reference: '' });
});

test('diz quanto cobrar e quanto levar de troco, sem conta de cabeça', () => {
  assert.deepEqual(chargeLines(base), { big: 'COBRAR R$ 29,50', small: 'EM DINHEIRO', change: 'LEVAR R$ 20,50 DE TROCO', note: 'Cliente paga com R$ 50,00' });
  assert.equal(chargeLines({ ...base, changeFor: null }).small, 'EM DINHEIRO · sem troco');
  assert.equal(chargeLines({ ...base, mode: 'pickup', paymentMethod: 'CREDIT_CARD' }).small, 'CARTÃO DE CRÉDITO · no balcão');
  assert.equal(chargeLines({ ...base, paymentMethod: 'DEBIT_CARD' }).small, 'CARTÃO DE DÉBITO · levar a maquininha');
  assert.equal(chargeLines({ ...base, paymentMethod: 'PIX', pixProofAt: '2026-11-21T22:41:00Z' }).big, 'PAGO NO PIX');
  assert.equal(chargeLines({ ...base, paymentMethod: 'PIX', apiStatus: 'AWAITING_PIX' }).big, 'PIX NÃO CONFERIDO');
  assert.equal(chargeLines({ ...base, paymentMethod: 'PIX' }, { pixOnline: false }).small, 'No Pix, na entrega.');
});

test('comanda de entrega traz bairro, mapa e cobrança; retirada não mostra endereço', () => {
  const html = receiptHtml(base, { name: 'Sabores da Sil', city: 'Guaçuí', state: 'ES' }, 'data:image/png;base64,AAA');
  for (const text of ['#77', 'ENTREGA', '7x', 'Coxinha', 'bem sequinha', '>Centro<', 'Rua Doutor Antônio Pinto, 120', 'Ref.: casa azul', '(28) 99999-0000', 'abre o endereço no mapa', 'LEVAR R$']) {
    assert.ok(html.includes(text), `faltou "${text}"`);
  }
  const pickup = receiptHtml({ ...base, mode: 'pickup', address: '', neighborhood: '' }, { name: 'Loja' });
  assert.ok(pickup.includes('RETIRADA NA LOJA'));
  assert.ok(!pickup.includes('BAIRRO'));
  assert.ok(mapsUrl(base, { city: 'Guaçuí', state: 'ES' }).includes(encodeURIComponent('Rua Doutor Antônio Pinto, 120, Centro, Guaçuí - ES')));
});

test('escapa texto do cliente (nada de HTML vindo de fora)', () => {
  const html = receiptHtml({ ...base, notes: '<b>oi</b>' }, {});
  assert.ok(html.includes('&lt;b&gt;oi&lt;/b&gt;'));
});

test('comanda mostra os adicionais embaixo do item (por unidade quando o item tem mais de 1)', () => {
  const html = receiptHtml({
    ...base,
    items: [
      { name: 'Combo 50 salgados', qty: 1, price: 51, notes: '', options: [{ group: 'Molhos', name: 'Maionese', quantity: 2, price: 2 }] },
      { name: 'Churros', qty: 2, price: 3, notes: '', options: [{ group: 'Recheio', name: 'Ninho', quantity: 1, price: 0.5 }] },
    ],
  }, { name: 'Sabores da Sil' }, '');
  assert.match(html, /\+ 2x Maionese</);
  assert.match(html, /\+ 1x Ninho em cada</);
});
