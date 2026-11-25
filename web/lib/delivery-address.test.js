import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreDeliveryContact, formatDeliveryAddress } from './delivery-address.js';

test('separa um endereço antigo sem repetir o número e conserva o complemento', () => {
  const value = restoreDeliveryContact({ address: 'Rua das Flores, 120A, Centro', complement: 'Casa azul', name: 'Ana' });
  assert.equal(value.address, 'Rua das Flores');
  assert.equal(value.number, '120A');
  assert.equal(formatDeliveryAddress(value), 'Rua das Flores, 120A - Centro - Casa azul');
});
test('preserva o texto e pede conferência quando o número antigo é ambíguo', () => {
  const value = restoreDeliveryContact({ address: 'Estrada do Campo km 12 perto do portão' });
  assert.equal(value.address, 'Estrada do Campo km 12 perto do portão');
  assert.equal(value.number, '');
  assert.equal(value.legacyAddress, true);
});
test('usa sem número e não altera os campos do formato novo', () => {
  const value = restoreDeliveryContact({ addressVersion: 2, address: 'Rua das Flores', number: '120', noNumber: true, complement: 'Portão verde' });
  assert.equal(formatDeliveryAddress(value), 'Rua das Flores, s/n - Portão verde');
  assert.equal(formatDeliveryAddress({ ...value, noNumber: false }), 'Rua das Flores, 120 - Portão verde');
});
test('reconhece sem número no formato antigo e ignora dados salvos inválidos', () => {
  assert.equal(formatDeliveryAddress(restoreDeliveryContact({ address: 'Rua das Flores, s/n' })), 'Rua das Flores, s/n');
  assert.equal(restoreDeliveryContact(null).address, '');
  assert.equal(restoreDeliveryContact({ address: 123 }).address, '');
});

test('fechamento: aponta o que falta antes de enviar', async () => {
  const { checkoutProblem } = await import('./delivery-address.js');
  const ok = { name: 'Ana', phone: '(28) 99917-7660', address: 'Rua das Flores', number: '120', complement: '', neighborhood: 'Centro', noNumber: false };
  assert.equal(checkoutProblem({ mode: 'delivery', form: ok }), '');
  assert.equal(checkoutProblem({ mode: 'pickup', form: { ...ok, address: '', number: '', neighborhood: '' } }), '');
  assert.match(checkoutProblem({ mode: 'delivery', form: { ...ok, phone: '99917-7660' } }), /DDD/);
  assert.match(checkoutProblem({ mode: 'delivery', form: { ...ok, phone: '+55 28 99917-7660' } }), /^$/);
  assert.match(checkoutProblem({ mode: 'delivery', form: { ...ok, number: '' } }), /número/);
  assert.equal(checkoutProblem({ mode: 'delivery', form: { ...ok, number: '', noNumber: true } }), '');
  assert.match(checkoutProblem({ mode: 'delivery', form: { ...ok, address: 'R', number: '1' } }), /rua completo/);
  assert.match(checkoutProblem({ mode: 'delivery', form: { ...ok, neighborhood: ' ' } }), /bairro/);
  assert.match(checkoutProblem({ mode: 'delivery', form: { ...ok, name: ' ' } }), /nome/);
});
