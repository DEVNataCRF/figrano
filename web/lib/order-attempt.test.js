import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySendError, clearAttempt, newAttemptKey, readAttempt, writeAttempt } from './order-attempt.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

test('tentativa guardada sobrevive a recarregar e some ao limpar (QA01)', () => {
  const storage = memoryStorage();
  const attempt = { key: newAttemptKey(), phoneSuffix: '0101', total: 3, createdAt: Date.now() };
  writeAttempt(storage, 'loja', attempt);
  assert.deepEqual(readAttempt(storage, 'loja'), attempt);
  assert.equal(readAttempt(storage, 'outra-loja'), null);
  clearAttempt(storage, 'loja');
  assert.equal(readAttempt(storage, 'loja'), null);
});

test('chave nova é longa, única e com prefixo do site', () => {
  const a = newAttemptKey();
  const b = newAttemptKey();
  assert.match(a, /^site-.{20,}$/);
  assert.notEqual(a, b);
});

test('tentativa com mais de 24 h é descartada; lixo no armazenamento não quebra', () => {
  const storage = memoryStorage();
  writeAttempt(storage, 'loja', { key: 'site-antiga-1234', phoneSuffix: '0101', total: 3, createdAt: 0 });
  assert.equal(readAttempt(storage, 'loja', 25 * 60 * 60 * 1000), null);
  storage.setItem('sabores:delivery:attempt:loja', '{quebrado');
  assert.equal(readAttempt(storage, 'loja'), null);
});

test('o que cada falha do envio quer dizer (QA01, QA02, QA15)', () => {
  // sem resposta: pode ter chegado → conferir, nunca chave nova
  assert.equal(classifySendError({ code: 'TIMEOUT', status: 0 }), 'unknown');
  assert.equal(classifySendError({ code: 'NETWORK', status: 0 }), 'unknown');
  assert.equal(classifySendError({ code: '', status: 502 }), 'unknown');
  assert.equal(classifySendError(undefined), 'unknown');
  // respostas definitivas da loja
  assert.equal(classifySendError({ code: 'IDEMPOTENCY_CONTENT_CONFLICT', status: 409 }), 'already-placed');
  assert.equal(classifySendError({ code: 'DELIVERY_PRICE_CHANGED', status: 409 }), 'price-changed');
  assert.equal(classifySendError({ code: 'DELIVERY_CLOSED', status: 409 }), 'refused');
  assert.equal(classifySendError({ code: 'DELIVERY_ITEM_UNAVAILABLE', status: 400 }), 'refused');
});
