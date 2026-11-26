import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { requestJson } from './api.js';
import { classifySendError } from './order-attempt.js';

/** Servidor de prova local: cada rota simula um jeito de a loja responder mal (revalidação R04). */
function server() {
  const open = new Set();
  const srv = http.createServer((req, res) => {
    open.add(res);
    if (req.url === '/ok') return res.end(JSON.stringify({ success: true, data: { ok: 1 } }));
    if (req.url === '/sem-cabecalho') return; // nunca responde
    if (req.url === '/corpo-travado') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"success":true,"da'); return; }
    if (req.url === '/corpo-cortado') { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"success":true,"data":{"id":"x"'); return; }
    if (req.url === '/erro') { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: { code: 'DELIVERY_CLOSED', message: 'Fechado' } })); }
    res.end();
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${srv.address().port}`,
    close: () => { for (const r of open) r.destroy(); srv.closeAllConnections?.(); srv.close(); },
  })));
}

test('prazo vale até o fim do corpo: cabeçalho chegou e o JSON travou = TIMEOUT no prazo', async () => {
  const s = await server();
  try {
    const started = Date.now();
    await assert.rejects(requestJson('/corpo-travado', {}, { timeoutMs: 300, baseUrl: s.base }), (e) => e.code === 'TIMEOUT' && e.status === 0);
    assert.ok(Date.now() - started < 2000, 'saiu no prazo');
  } finally { s.close(); }
});

test('sem cabeçalho nenhum também é TIMEOUT', async () => {
  const s = await server();
  try {
    await assert.rejects(requestJson('/sem-cabecalho', {}, { timeoutMs: 300, baseUrl: s.base }), (e) => e.code === 'TIMEOUT');
  } finally { s.close(); }
});

test('corpo cortado depois de gravar não vira sucesso: BAD_RESPONSE = resultado desconhecido no envio', async () => {
  const s = await server();
  try {
    let error;
    try { await requestJson('/corpo-cortado', { method: 'POST' }, { timeoutMs: 2000, baseUrl: s.base }); } catch (e) { error = e; }
    assert.equal(error?.code, 'BAD_RESPONSE');
    assert.equal(classifySendError(error), 'unknown');
  } finally { s.close(); }
});

test('resposta normal e recusa da loja continuam iguais', async () => {
  const s = await server();
  try {
    assert.deepEqual(await requestJson('/ok', {}, { baseUrl: s.base }), { ok: 1 });
    await assert.rejects(requestJson('/erro', {}, { baseUrl: s.base }), (e) => e.code === 'DELIVERY_CLOSED' && e.status === 409);
  } finally { s.close(); }
});
