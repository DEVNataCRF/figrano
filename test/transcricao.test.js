'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { transcribeAudio, fixAudioText } = require('../src/main/transcricao');
const { Store } = require('../src/main/store');
const { BotEngine } = require('../src/main/robo/engine');

test('"centro de coxinha" vira "cento de coxinha"; "no centro" continua', () => {
  const items = ['Coxinha', 'Kibe', 'Porção mista'];
  assert.equal(fixAudioText('quanto tá o centro de coxinha?', items), 'quanto tá o cento de coxinha?');
  assert.equal(fixAudioText('dois centros de kibe', items), 'dois centos de kibe');
  assert.equal(fixAudioText('meio centro de salgado', items), 'meio cento de salgado');
  assert.equal(fixAudioText('entrega no centro de Guaçuí', items), 'entrega no centro de Guaçuí');
});

test('número falado composto vira algarismo (endereço); palavra solta continua', () => {
  const { spokenNumbersToDigits: f } = require('../src/main/transcricao');
  assert.equal(f('rua das Flores cento e vinte, no centro'), 'rua das Flores 120, no centro');
  assert.equal(f('casa trinta e três'), 'casa 33');
  assert.equal(f('mil e duzentos'), '1200');
  assert.equal(f('cento e cinquenta e cinco coxinhas'), '155 coxinhas');
  assert.equal(f('dez coxinhas'), 'dez coxinhas');
  assert.equal(f('um cento de coxinha'), 'um cento de coxinha');
});

test('serviço fora do ar ou resposta vazia: devolve null (robô pede para escrever)', async () => {
  const down = async () => { throw new TypeError('fetch failed'); };
  assert.equal(await transcribeAudio({ base64: 'AAAA', fetch: down }), null);
  const empty = async () => ({ ok: true, json: async () => ({ texto: '  ' }) });
  assert.equal(await transcribeAudio({ base64: 'AAAA', fetch: empty }), null);
  const ok = async (url, init) => {
    assert.match(url, /\/transcrever\?dica=Coxinha/);
    assert.ok(Buffer.isBuffer(init.body));
    return { ok: true, json: async () => ({ texto: 'quero dez coxinhas', segundos: 2.1 }) };
  };
  assert.deepEqual(await transcribeAudio({ base64: 'AAAA', hint: 'Coxinha', fetch: ok }), { text: 'quero dez coxinhas', seconds: 2.1 });
});

test('áudio transcrito: robô responde direto, como texto; sem transcrição pede para escrever', async () => {
  const store = new Store(null);
  const cat = store.saveCategory({ name: 'Salgados' });
  store.saveItem(cat.id, { name: 'Coxinha', price: 3.5 });
  const engine = new BotEngine({ store, now: () => new Date(2026, 10, 18, 20, 0) });
  const heard = await engine.handle({ chatId: 'a@c.us', type: 'chat', text: 'quanto tá a coxinha?', fromAudio: true });
  assert.equal(heard.replies.length, 1);
  assert.match(heard.replies[0], /^Coxinha: R\$ 3,50/);
  const failed = await engine.handle({ chatId: 'b@c.us', type: 'ptt', text: '' });
  assert.match(failed.replies[0], /Não consegui ouvir seu áudio/);
});
