'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutoAccept } = require('../src/main/auto-accept');

function setup({ autoAccept = true, printerName = 'Elgin i9', acceptFails = false, printFails = false } = {}) {
  const calls = { accept: [], print: [], notify: [], refresh: 0 };
  const settings = { autoAccept, printerName };
  const auto = createAutoAccept({
    settings: () => settings,
    accept: async (id) => { calls.accept.push(id); if (acceptFails) throw new Error('Sem conexão com o sistema'); return { id, status: 'PREPARING' }; },
    print: async (order) => { calls.print.push(order.id); if (printFails) throw new Error('Impressora desligada.'); },
    notify: (title, body) => calls.notify.push(`${title} | ${body}`),
    refresh: () => { calls.refresh += 1; },
  });
  return { auto, calls, settings };
}

test('ligado: aceita e imprime o pedido novo uma vez só', async () => {
  const { auto, calls } = setup();
  assert.equal(await auto.handle({ id: 'o1', number: 12 }), 'aceito');
  assert.equal(await auto.handle({ id: 'o1', number: 12 }), 'repetido');
  assert.deepEqual(calls.accept, ['o1']);
  assert.deepEqual(calls.print, ['o1']);
  assert.equal(calls.notify.length, 0);
  assert.equal(calls.refresh, 1);
});

test('desligado ou sem impressora escolhida: não faz nada', async () => {
  assert.equal(await setup({ autoAccept: false }).auto.handle({ id: 'o1', number: 1 }), 'desligado');
  const semImpressora = setup({ printerName: '' });
  assert.equal(await semImpressora.auto.handle({ id: 'o1', number: 1 }), 'desligado');
  assert.deepEqual(semImpressora.calls.accept, []);
});

test('aceite falhou: avisa a Sil e deixa tentar de novo', async () => {
  const s = setup({ acceptFails: true });
  assert.equal(await s.auto.handle({ id: 'o2', number: 13 }), 'falhou');
  assert.match(s.calls.notify[0], /#13 não foi aceito sozinho/);
  assert.deepEqual(s.calls.print, []);
  assert.equal(await s.auto.handle({ id: 'o2', number: 13 }), 'falhou'); // tentou de novo
  assert.equal(s.calls.accept.length, 2);
});

test('aceitou mas não imprimiu: pedido segue aceito e a Sil é avisada', async () => {
  const s = setup({ printFails: true });
  assert.equal(await s.auto.handle({ id: 'o3', number: 14 }), 'aceito-sem-imprimir');
  assert.match(s.calls.notify[0], /#14 aceito, mas a comanda não imprimiu/);
  assert.equal(await s.auto.handle({ id: 'o3', number: 14 }), 'repetido'); // não aceita nem imprime de novo
});
