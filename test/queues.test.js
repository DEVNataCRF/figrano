'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SerialQueue, SendQueue } = require('../src/main/queues');

function fakeTransport(log) {
  return {
    typing: async (chatId) => { log.push(`typing:${chatId}`); },
    send: async (chatId, text) => { log.push(`send:${chatId}:${text}`); },
  };
}

test('SerialQueue roda uma tarefa por vez, em ordem, mesmo com falha', async () => {
  const queue = new SerialQueue();
  const log = [];
  const slow = queue.push(async () => { await new Promise((r) => setTimeout(r, 20)); log.push('a'); });
  const failing = queue.push(async () => { log.push('b'); throw new Error('x'); });
  const last = queue.push(async () => { log.push('c'); });
  await slow;
  await assert.rejects(failing);
  await last;
  assert.deepEqual(log, ['a', 'b', 'c']);
});

test('SendQueue mantém a ordem dentro da conversa e mostra digitando antes', async () => {
  const log = [];
  const queue = new SendQueue({ transport: fakeTransport(log), sleep: async () => {}, random: () => 0 });
  const first = queue.enqueue('a@c.us', ['um', 'dois']);
  const second = queue.enqueue('a@c.us', ['três']);
  assert.deepEqual(await first, { sent: 2, skipped: 0, failed: 0 });
  await second;
  assert.deepEqual(log, [
    'typing:a@c.us', 'send:a@c.us:um',
    'typing:a@c.us', 'send:a@c.us:dois',
    'typing:a@c.us', 'send:a@c.us:três',
  ]);
});

test('SendQueue respeita a pausa, mas avisos passam', async () => {
  const log = [];
  const queue = new SendQueue({
    transport: fakeTransport(log), sleep: async () => {}, random: () => 0, isPaused: () => true,
  });
  assert.deepEqual(await queue.enqueue('a@c.us', ['resposta do robô']), { sent: 0, skipped: 1, failed: 0 });
  assert.deepEqual(await queue.enqueue('a@c.us', ['pedido saiu'], { respectsPause: false }), { sent: 1, skipped: 0, failed: 0 });
  assert.deepEqual(log, ['typing:a@c.us', 'send:a@c.us:pedido saiu']);
});

test('SendQueue para se a conversa for pausada durante a digitação', async () => {
  const log = [];
  let paused = false;
  const queue = new SendQueue({
    transport: fakeTransport(log),
    sleep: async () => { paused = true; },
    random: () => 0,
    isPaused: () => paused,
  });
  const result = await queue.enqueue('a@c.us', ['um', 'dois']);
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 2);
  assert.deepEqual(log, ['typing:a@c.us']);
});

test('SendQueue conta falha de envio e segue para a próxima', async () => {
  let calls = 0;
  const queue = new SendQueue({
    transport: {
      typing: async () => {},
      send: async () => { calls += 1; if (calls === 1) throw new Error('falhou'); },
    },
    sleep: async () => {},
    random: () => 0,
  });
  const result = await queue.enqueue('a@c.us', ['um', 'dois']);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.error, 'falhou');
});

test('delayFor cresce com o tamanho do texto e tem teto', () => {
  const queue = new SendQueue({ transport: fakeTransport([]), random: () => 0 });
  assert.equal(queue.delayFor(''), 600);
  assert.equal(queue.delayFor('x'.repeat(40)), 920);
  assert.equal(queue.delayFor('x'.repeat(5000)), 2500);
});

test('SendQueue envia mesmo se o "digitando" falhar', async () => {
  const sent = [];
  const queue = new SendQueue({
    transport: {
      typing: async () => { throw new Error('Chat not found'); },
      send: async (chatId, text) => { sent.push(text); },
    },
    sleep: async () => {},
  });
  const result = await queue.enqueue('1@c.us', ['oi']);
  assert.deepEqual(result, { sent: 1, skipped: 0, failed: 0 });
  assert.deepEqual(sent, ['oi']);
});

test('o "digitando" não segura o envio (antes somava o tempo duas vezes)', async () => {
  const sleeps = [];
  const sent = [];
  const queue = new SendQueue({
    transport: {
      typing: () => new Promise(() => {}), // como o WhatsApp: só "volta" depois do tempo pedido
      send: async (chatId, text) => { sent.push(text); },
    },
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0,
  });
  await queue.enqueue('a@c.us', ['oi', 'tudo bem?']);
  assert.deepEqual(sent, ['oi', 'tudo bem?']);
  const total = sleeps.reduce((a, b) => a + b, 0);
  assert.ok(total < 3000, `esperou ${total} ms`);
});
