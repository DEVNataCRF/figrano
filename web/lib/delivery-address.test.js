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
