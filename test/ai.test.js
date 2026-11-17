'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Store } = require('../src/main/store');
const { BotEngine } = require('../src/main/bot/engine');
const { AiResponder, systemPrompt } = require('../src/main/bot/ai');

// Quarta-feira, 20:00: loja aberta no horário padrão.
const OPEN_TIME = new Date(2026, 10, 18, 20, 0);

function setup(replies) {
  const store = new Store(null);
  store.updateSettings('store', { name: 'Cantina Teste' });
  const pizzas = store.saveCategory({ name: 'Pizzas' });
  store.saveItem(pizzas.id, { name: 'Calabresa', price: 40 });
  store.updateSettings('ai', { enabled: true, provider: 'ollama', ollamaModel: 'qwen3.5:9b' });
  const requests = [];
  const fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, body });
    const message = replies.shift();
    return { ok: true, json: async () => ({ message }) };
  };
  const ai = new AiResponder({ store, getApiKey: () => '', fetch });
  const engine = new BotEngine({ store, ai, now: () => OPEN_TIME });
  return { store, engine, requests };
}

test('o prompt apresenta a atendente virtual de delivery da loja', () => {
  const store = new Store(null);
  store.updateSettings('store', { name: 'Cantina Teste' });
  assert.match(systemPrompt(store), /atendente virtual de delivery do Cantina Teste/);
});

test('Ollama: fica disponível sem chave de API', () => {
  const { engine } = setup([]);
  assert.equal(engine.ai.available(), true);
});

test('Ollama: executa ferramentas e devolve o texto final', async () => {
  const { engine, requests } = setup([
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'add_items', arguments: { items: [{ number: 1, quantity: 2, notes: 'sem cebola' }] } } }] },
    { role: 'assistant', content: '<think>ok</think>Anotei 2 calabresas sem cebola! Algo mais?' },
  ]);
  const out = await engine.handle({ chatId: '1@lid', phone: '5511999990000', type: 'chat', text: 'quero duas calabresas sem cebola por favor' });

  assert.deepEqual(out.replies, ['Anotei 2 calabresas sem cebola! Algo mais?']);
  const session = engine.sessions.get('1@lid');
  assert.equal(session.cart[0].qty, 2);
  assert.equal(session.cart[0].notes, 'sem cebola');

  assert.equal(requests[0].url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(requests[0].body.model, 'qwen3.5:9b');
  assert.equal(requests[0].body.think, true);
  assert.equal(requests[0].body.messages[0].role, 'system');
  const toolMessage = requests[1].body.messages.at(-1);
  assert.equal(toolMessage.role, 'tool');
  assert.equal(toolMessage.tool_name, 'add_items');
});

test('Ollama fora do ar: as regras assumem e o erro é registrado', async () => {
  const store = new Store(null);
  store.updateSettings('ai', { enabled: true, provider: 'ollama', ollamaModel: 'qwen3.5:9b' });
  const fetch = async () => { throw new TypeError('fetch failed'); };
  const ai = new AiResponder({ store, getApiKey: () => '', fetch });
  const engine = new BotEngine({ store, ai, now: () => OPEN_TIME });
  const out = await engine.handle({ chatId: '1@lid', type: 'chat', text: 'vocês fazem entrega no centro hoje' });
  assert.ok(out.replies.length > 0);
  const error = out.effects.find((e) => e.type === 'ai_error');
  assert.match(error.message, /Ollama não está rodando/);
});

test('Ollama: a saudação vem antes do cardápio', async () => {
  const { engine } = setup([
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'send_menu', arguments: {} } }] },
    { role: 'assistant', content: 'Boa noite! Segue nosso cardápio:' },
  ]);
  const out = await engine.handle({ chatId: '1@lid', type: 'chat', text: 'boa noite, o que vocês têm hoje' });
  assert.equal(out.replies.length, 2);
  assert.equal(out.replies[0], 'Boa noite! Segue nosso cardápio:');
  assert.match(out.replies[1], /Calabresa/);
});
