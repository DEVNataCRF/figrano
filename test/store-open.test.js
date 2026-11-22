'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { storeOpen } = require('../src/main/robo/format');

const closedWeek = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { closed: true, open: '18:00', close: '23:00' }]));
const now = new Date('2026-11-21T15:00:00');

test('atalho "abrir agora" abre o robô fora do horário até a hora marcada', () => {
  const store = { hours: closedWeek, override: { mode: 'open', until: new Date(now.getTime() + 3600_000).toISOString() } };
  assert.equal(storeOpen(store, now), true);
  assert.equal(storeOpen(store, new Date(now.getTime() + 2 * 3600_000)), false); // venceu: volta ao horário
});

test('atalho "fechar agora" fecha mesmo dentro do horário', () => {
  const openAllDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { closed: false, open: '00:00', close: '00:00' }]));
  assert.equal(storeOpen({ hours: openAllDay }, now), true);
  assert.equal(storeOpen({ hours: openAllDay, override: { mode: 'closed', until: new Date(now.getTime() + 3600_000).toISOString() } }, now), false);
});

test('pausa (cozinha cheia) não deixa o robô fechar pedido', () => {
  const openAllDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { closed: false, open: '00:00', close: '00:00' }]));
  assert.equal(storeOpen({ hours: openAllDay, override: { mode: 'paused', until: new Date(now.getTime() + 900_000).toISOString() } }, now), false);
});
