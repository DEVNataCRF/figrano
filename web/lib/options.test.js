import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPicks, groupRule, lineUnitPrice, missingRequired, optionLines, sameOptions } from './options.js';

const item = {
  id: 'p1', price: 47,
  optionGroups: [
    { id: 'g1', name: 'Molhos', min: 0, max: 3, options: [{ id: 'rose', name: 'Molho rosê', price: 2 }, { id: 'maio', name: 'Maionese', price: 2 }] },
    { id: 'g2', name: 'Sabor', min: 1, max: 1, options: [{ id: 'brig', name: 'Brigadeiro', price: 0 }, { id: 'ninho', name: 'Ninho', price: 1.5 }] },
  ],
};

test('preço da unidade soma os adicionais pelo cardápio de hoje', () => {
  assert.equal(lineUnitPrice(item, [{ optionId: 'rose', quantity: 2 }, { optionId: 'ninho', quantity: 1 }]), 52.5);
  assert.equal(lineUnitPrice(item, []), 47);
  assert.equal(lineUnitPrice(item, [{ optionId: 'sumiu', quantity: 3 }]), 47, 'opção que saiu não soma');
});

test('texto da regra do grupo', () => {
  assert.equal(groupRule(item.optionGroups[0]), 'Escolha até 3 itens');
  assert.equal(groupRule(item.optionGroups[1]), 'Obrigatório · escolha 1');
  assert.equal(groupRule({ min: 1, max: 3 }), 'Obrigatório · escolha de 1 a 3');
  assert.equal(groupRule({ min: 0, max: 1 }), 'Escolha até 1 item');
});

test('aponta o grupo obrigatório que falta', () => {
  assert.deepEqual(missingRequired(item, []).map((g) => g.name), ['Sabor']);
  assert.deepEqual(missingRequired(item, [{ optionId: 'brig', quantity: 1 }]), []);
});

test('mesma escolha em outra ordem é a mesma linha da sacola', () => {
  assert.equal(sameOptions([{ optionId: 'a', quantity: 1 }, { optionId: 'b', quantity: 2 }], [{ optionId: 'b', quantity: 2 }, { optionId: 'a', quantity: 1 }]), true);
  assert.equal(sameOptions([{ optionId: 'a', quantity: 1 }], [{ optionId: 'a', quantity: 2 }]), false);
  assert.equal(sameOptions(undefined, []), true);
});

test('sacola antiga: tira adicional que saiu do cardápio e diz se ainda serve', () => {
  assert.deepEqual(cleanPicks(item, [{ optionId: 'rose', quantity: 1 }, { optionId: 'x', quantity: 1 }, { optionId: 'brig', quantity: 1 }]), { picks: [{ optionId: 'rose', quantity: 1 }, { optionId: 'brig', quantity: 1 }], ok: true });
  assert.equal(cleanPicks(item, [{ optionId: 'rose', quantity: 1 }]).ok, false, 'falta o obrigatório');
  assert.equal(cleanPicks(item, [{ optionId: 'rose', quantity: 9 }, { optionId: 'brig', quantity: 1 }]).ok, false, 'passou do máximo');
});

test('linhas para mostrar na sacola e no pedido', () => {
  assert.deepEqual(optionLines(item, [{ optionId: 'maio', quantity: 2 }, { optionId: 'brig', quantity: 1 }]), ['2x Maionese', '1x Brigadeiro']);
});
