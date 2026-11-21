import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOpening } from './hours.js';

const week = (overrides = {}) => {
  const hours = {};
  for (let d = 0; d < 7; d++) hours[String(d)] = { closed: false, open: '18:00', close: '23:00' };
  return { ...hours, ...overrides };
};
// 21/11/2026 é sábado; 15:00 em Brasília = 18:00 UTC
const sabado15h = new Date('2026-11-21T18:00:00Z');

test('ainda hoje, antes de abrir', () => {
  assert.equal(nextOpening(week(), sabado15h).text, 'hoje às 18:00');
});

test('depois de fechar vai para amanhã, e pula dias fechados', () => {
  const tarde = new Date('2026-11-22T02:30:00Z'); // sábado 23:30 em Brasília
  assert.equal(nextOpening(week(), tarde).text, 'amanhã às 18:00');
  const semDomingoNemSegunda = week({ 0: { closed: true, open: '18:00', close: '23:00' }, 1: { closed: true, open: '18:00', close: '23:00' } });
  assert.equal(nextOpening(semDomingoNemSegunda, tarde).text, 'terça às 18:00');
});

test('usa o horário de Brasília mesmo com o relógio em UTC', () => {
  // 02:00 UTC de domingo ainda é sábado 23:00 em Brasília
  assert.equal(nextOpening(week(), new Date('2026-11-22T02:00:00Z')).when, 'amanhã');
});

test('loja sem nenhum dia aberto não inventa horário', () => {
  const fechada = {};
  for (let d = 0; d < 7; d++) fechada[String(d)] = { closed: true, open: '18:00', close: '23:00' };
  assert.equal(nextOpening(fechada, sabado15h), null);
  assert.equal(nextOpening(null, sabado15h), null);
});
