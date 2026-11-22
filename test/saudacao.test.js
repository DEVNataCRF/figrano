'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { HANDOFF_MESSAGE_DEFAULT, handoffGreeting, primeiroNome } = require('../src/main/robo/saudacao');

const at = (h) => new Date(2026, 10, 22, h, 0, 0);

test('Sil assume: saudação da hora, primeiro nome do cliente e o nome dela', () => {
  assert.equal(
    handoffGreeting(HANDOFF_MESSAGE_DEFAULT, { customerName: '🌸 maria clara', ownerName: 'Sil', now: at(15) }),
    'Boa tarde, Maria! Sil aqui 😊 A partir de agora eu continuo seu atendimento por aqui.',
  );
  assert.match(handoffGreeting(HANDOFF_MESSAGE_DEFAULT, { ownerName: 'Sil', now: at(8) }), /^Bom dia! Sil aqui/);
  assert.match(handoffGreeting(HANDOFF_MESSAGE_DEFAULT, { ownerName: 'Sil', now: at(21) }), /^Boa noite! Sil aqui/);
  assert.match(handoffGreeting(HANDOFF_MESSAGE_DEFAULT, { ownerName: 'Sil', now: at(2) }), /^Boa noite!/);
});

test('sem nome de quem atende: usa a equipe da loja', () => {
  assert.match(handoffGreeting(HANDOFF_MESSAGE_DEFAULT, { companyName: 'Sabores da Sil', now: at(10) }), /Equipe da Sabores da Sil aqui/);
});

test('texto próprio sem variáveis vai como está; vazio não manda nada', () => {
  assert.equal(handoffGreeting('Oi! Já te atendo.', { ownerName: 'Sil' }), 'Oi! Já te atendo.');
  assert.equal(handoffGreeting('   '), '');
});

test('primeiro nome: telefone e lixo viram vazio', () => {
  assert.equal(primeiroNome('5528999990000'), '');
  assert.equal(primeiroNome('JOÃO PEDRO'), 'João');
  assert.equal(primeiroNome(''), '');
});
