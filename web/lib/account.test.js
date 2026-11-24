import test from 'node:test';
import assert from 'node:assert/strict';
import { orderWhen, phoneDigits, picksFromNames, repeatLinesOf, sessionFrom, validPhone, validSession } from './account.js';

const COMBO = {
  id: 'p1',
  name: 'Combo 25 salgados',
  optionGroups: [
    { id: 'g1', name: 'Molhos', min: 0, max: 3, options: [{ id: 'o1', name: 'Maionese verde', price: 0 }, { id: 'o2', name: 'Barbecue', price: 1 }] },
  ],
};

test('sessão vale até vencer; formato estranho é ignorado', () => {
  const s = sessionFrom({ token: 'abc', name: 'Bruna', phone: '(28) 9••••-0077', expiresInSeconds: 60 }, 1000);
  assert.equal(s.expiresAt, 61000);
  assert.equal(validSession(s, 2000), s);
  assert.equal(validSession(s, 61000), null);
  assert.equal(validSession({ expiresAt: 99999 }, 0), null);
  assert.equal(validSession(null), null);
});

test('celular: aceita com DDD, com 55 e com máscara', () => {
  assert.equal(phoneDigits('+55 (28) 99400-0077'), '28994000077');
  assert.ok(validPhone('(28) 99400-0077'));
  assert.ok(validPhone('2835531234'));
  assert.ok(!validPhone('99400-0077'));
});

test('pedir de novo: adicionais voltam pelo nome (sem acento/maiúscula), o que sumiu fica de fora', () => {
  const picks = picksFromNames(COMBO, [
    { group: 'molhos', name: 'MAIONESE VERDE', quantity: 2 },
    { group: 'Molhos', name: 'Ketchup', quantity: 1 },
  ]);
  assert.deepEqual(picks, [{ optionId: 'o1', quantity: 2 }]);
  // Grupo renomeado: acha a opção mesmo assim
  assert.deepEqual(picksFromNames(COMBO, [{ group: 'Molhos da casa', name: 'Barbecue', quantity: 1 }]), [{ optionId: 'o2', quantity: 1 }]);
});

test('itens do histórico viram linhas da sacola', () => {
  const items = new Map([['p1', COMBO]]);
  const lines = repeatLinesOf({
    items: [
      { productId: 'p1', name: 'Combo 25 salgados', quantity: 2, notes: 'bem quente', options: [{ group: 'Molhos', name: 'Barbecue', quantity: 1 }] },
      { productId: null, name: 'Item apagado', quantity: 1, notes: null, options: [] },
    ],
  }, items);
  assert.deepEqual(lines, [
    { itemId: 'p1', name: 'Combo 25 salgados', qty: 2, notes: 'bem quente', options: [{ optionId: 'o2', quantity: 1 }] },
    { itemId: '', name: 'Item apagado', qty: 1, notes: '', options: [] },
  ]);
});

test('quando foi o pedido', () => {
  const now = new Date(2026, 10, 24, 20, 0);
  assert.match(orderWhen(new Date(2026, 10, 24, 19, 40).toISOString(), now), /^Hoje às 19:40$/);
  assert.match(orderWhen(new Date(2026, 10, 23, 12, 5).toISOString(), now), /^Ontem às 12:05$/);
  assert.match(orderWhen(new Date(2026, 9, 2, 12, 5).toISOString(), now), /^02\/10 às 12:05$/);
  assert.equal(orderWhen('x', now), '');
});
