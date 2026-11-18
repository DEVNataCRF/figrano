'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFreeOrder } = require('../src/main/robo/free-order');

const MENU = [
  { number: 1, name: 'Coxinha' },
  { number: 2, name: 'Bolinho de bacalhau' },
  { number: 3, name: 'Mini churros recheados' },
  { number: 4, name: 'Porção mista' },
  { number: 5, name: 'Salgadinhos fritos sortidos' },
  { number: 6, name: 'Salgadinhos assados sortidos' },
];

test('pedido completo numa frase: itens, entrega, endereço e Pix', () => {
  const p = parseFreeOrder('boa noite! quero 10 coxinhas e 2 porção mista pra entregar na Rua das Flores 120, Centro. Vou pagar no pix', MENU);
  assert.deepEqual(p.lines, [{ number: 1, quantity: 10, set: false }, { number: 4, quantity: 2, set: false }]);
  assert.equal(p.mode, 'delivery');
  assert.equal(p.address, 'Rua das Flores 120, Centro');
  assert.equal(p.payment, 'pix');
});

test('retirada, plural, número por extenso e troco', () => {
  const p = parseFreeOrder('6 mini churros e quatro bolinhos de bacalhau pra retirar, pago em dinheiro, troco pra 50', MENU);
  assert.deepEqual(p.lines, [{ number: 3, quantity: 6, set: false }, { number: 2, quantity: 4, set: false }]);
  assert.equal(p.mode, 'pickup');
  assert.equal(p.payment, 'dinheiro');
  assert.equal(p.changeFor, 50);
});

test('correção vira troca de quantidade', () => {
  const p = parseFreeOrder('na verdade quero 10 mini churros', MENU);
  assert.deepEqual(p.lines, [{ number: 3, quantity: 10, set: true }]);
});

test('nome ambíguo não chuta; item fora do cardápio é ignorado', () => {
  assert.deepEqual(parseFreeOrder('quero 50 salgadinhos sortidos', MENU).lines, []);
  assert.deepEqual(parseFreeOrder('quero 50 salgadinhos fritos', MENU).lines, [{ number: 5, quantity: 50, set: false }]);
  assert.deepEqual(parseFreeOrder('quero 2 pizzas de calabresa', MENU).lines, []);
});

test('frase sem pedido não é lida como pedido', () => {
  const p = parseFreeOrder('qual o horário de vocês? abre às 18?', MENU);
  assert.deepEqual(p.lines, []);
  assert.equal(p.mode, null);
});

test('guarda a observação do item', () => {
  const p = parseFreeOrder('quero 10 coxinhas bem sequinhas pra entregar na rua A, 10', MENU);
  assert.equal(p.lines[0].notes, 'bem sequinhas');
});

