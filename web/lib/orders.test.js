import test from 'node:test';
import assert from 'node:assert/strict';
import { etaOf, rememberOrder, timelineOf, continueText } from './orders.js';

const at = (iso) => new Date(iso);
const hhmm = (d) => d.toISOString().slice(11, 16);

test('entrega: janela entre o fim do preparo e mais 15 min de caminho, com o atraso avisado', () => {
  const eta = etaOf({ mode: 'DELIVERY', createdAt: '2026-11-23T22:00:00Z', acceptedAt: '2026-11-23T22:05:00Z', delayMinutes: 10 }, 30);
  assert.equal(eta.kind, 'window');
  assert.equal(hhmm(eta.from), '22:45');
  assert.equal(hhmm(eta.to), '23:00');
  assert.equal(eta.lateAfter.getTime(), at('2026-11-23T23:05:00Z').getTime());
});

test('retirada: só o horário em que fica pronto', () => {
  const eta = etaOf({ mode: 'PICKUP', createdAt: '2026-11-23T22:00:00Z', acceptedAt: null, delayMinutes: 0 }, 20);
  assert.equal(eta.kind, 'ready');
  assert.equal(hhmm(eta.from), '22:20');
  assert.equal(hhmm(eta.to), '22:20');
});

test('sem tempo de preparo cadastrado não inventa previsão', () => {
  assert.equal(etaOf({ mode: 'DELIVERY', createdAt: '2026-11-23T22:00:00Z' }, 0), null);
});

test('histórico do aparelho: mais novo primeiro, sem repetir, no máximo 10', () => {
  let list = [];
  for (let n = 1; n <= 12; n++) list = rememberOrder(list, { id: `p${n}`, number: n });
  assert.equal(list.length, 10);
  assert.equal(list[0].number, 12);
  list = rememberOrder(list, { id: 'p5', number: 5, extra: true });
  assert.equal(list[0].id, 'p5');
  assert.equal(list.filter((o) => o.id === 'p5').length, 1);
  assert.equal(rememberOrder(null, { id: 'x' }).length, 1);
  assert.deepEqual(rememberOrder([], { number: 3 }), [], 'sem id não guarda');
});

test('linha do tempo: etapas da entrega com hora quando se sabe', () => {
  const steps = timelineOf({ mode: 'DELIVERY', status: 'PREPARING', createdAt: '2026-11-23T22:46:00Z', acceptedAt: '2026-11-23T22:47:00Z' }, false);
  assert.deepEqual(steps.map((s) => [s.status, s.state]), [
    ['NEW', 'done'], ['PREPARING', 'now'], ['OUT_FOR_DELIVERY', 'next'], ['DONE', 'next'],
  ]);
  assert.equal(steps[0].label, 'Pedido realizado');
  assert.equal(steps[0].at.toISOString(), '2026-11-23T22:46:00.000Z');
  assert.equal(steps[1].at.toISOString(), '2026-11-23T22:47:00.000Z');
  assert.equal(steps[2].at, null);
});

test('linha do tempo: retirada troca a saída por "pronto para retirar"; Pix pelo site ganha a etapa do comprovante', () => {
  const steps = timelineOf({ mode: 'PICKUP', status: 'AWAITING_PIX', createdAt: '2026-11-23T22:46:00Z' }, true);
  assert.deepEqual(steps.map((s) => s.status), ['NEW', 'AWAITING_PIX', 'PREPARING', 'READY_FOR_PICKUP', 'DONE']);
  assert.equal(steps[0].state, 'done');
  assert.equal(steps[1].state, 'now');
});

test('linha do tempo: o histórico da API dá a hora de cada etapa', () => {
  const steps = timelineOf({
    mode: 'DELIVERY', status: 'OUT_FOR_DELIVERY', createdAt: '2026-11-23T22:46:00Z',
    history: [{ status: 'PREPARING', at: '2026-11-23T22:50:00Z' }, { status: 'OUT_FOR_DELIVERY', at: '2026-11-23T23:20:00Z' }],
  }, false);
  assert.equal(steps.find((s) => s.status === 'OUT_FOR_DELIVERY').at.toISOString(), '2026-11-23T23:20:00.000Z');
  assert.equal(steps.find((s) => s.status === 'PREPARING').at.toISOString(), '2026-11-23T22:50:00.000Z');
});

test('texto do "Continuar no WhatsApp" cita o pedido e o site (o robô reconhece)', () => {
  const text = continueText(214);
  assert.match(text, /pedido #214/);
  assert.match(text, /pelo site/);
});

test('pedido concluído: todas as etapas marcadas como feitas, nenhuma "em andamento"', () => {
  const steps = timelineOf({ mode: 'DELIVERY', status: 'DONE', createdAt: '2026-11-23T22:46:00Z' }, false);
  assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'done', 'done']);
});
