'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Store } = require('../src/main/store');
const { BotEngine, parseSelection, parseMoney, phoneFromChatId } = require('../src/main/robo/engine');
const { isOpen } = require('../src/main/robo/format');

const CHAT = '5511999990000@c.us';
// Quarta-feira, 20:00: dentro do horário padrão (18:00 às 23:00).
const OPEN_TIME = new Date(2026, 10, 18, 20, 0);
// Segunda-feira: dia fechado no padrão.
const CLOSED_TIME = new Date(2026, 10, 16, 20, 0);

function setup({ now = OPEN_TIME, ai = null } = {}) {
  const store = new Store(null);
  store.updateSettings('store', { name: 'Cantina Teste', deliveryFee: 5, address: 'Rua A, 10' });
  const pizzas = store.saveCategory({ name: 'Pizzas' });
  store.saveItem(pizzas.id, { name: 'Calabresa', price: 40 });
  store.saveItem(pizzas.id, { name: 'Marguerita', price: 42, description: 'Molho, muçarela e manjericão' });
  const drinks = store.saveCategory({ name: 'Bebidas' });
  store.saveItem(drinks.id, { name: 'Refrigerante lata', price: 6 });
  store.saveItem(drinks.id, { name: 'Suco esgotado', price: 9, available: false });
  let current = now;
  const engine = new BotEngine({ store, ai, now: () => current });
  const say = (text, extra = {}) => engine.handle({ chatId: CHAT, name: 'Ana Souza', type: 'chat', text, ...extra });
  return { store, engine, say, setNow: (d) => { current = d; } };
}

test('parseSelection entende números, quantidades e listas', () => {
  assert.deepEqual(parseSelection('3'), [{ qty: 1, number: 3 }]);
  assert.deepEqual(parseSelection('2x3'), [{ qty: 2, number: 3 }]);
  assert.deepEqual(parseSelection('2 x 1, 3 e 1x2'), [
    { qty: 2, number: 1 }, { qty: 1, number: 3 }, { qty: 1, number: 2 },
  ]);
  assert.equal(parseSelection('quero uma pizza'), null);
  assert.equal(parseSelection(''), null);
});

test('parseMoney lê valores com vírgula e R$', () => {
  assert.equal(parseMoney('R$ 50,00'), 50);
  assert.equal(parseMoney('troco pra 100'), 100);
  assert.equal(parseMoney('não'), null);
});

test('isOpen trata horário que passa da meia-noite', () => {
  const hours = { 5: { closed: false, open: '18:00', close: '02:00' }, 6: { closed: true } };
  assert.equal(isOpen(hours, new Date(2026, 10, 20, 23, 30)), true); // sexta 23:30
  assert.equal(isOpen(hours, new Date(2026, 10, 21, 1, 0)), true); // sábado 01:00, turno de sexta
  assert.equal(isOpen(hours, new Date(2026, 10, 21, 3, 0)), false);
  assert.equal(isOpen(hours, new Date(2026, 10, 20, 12, 0)), false);
});

test('saudação mostra o menu de opções com o primeiro nome', async () => {
  const { say } = setup();
  const { replies } = await say('oi');
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Olá, Ana!/);
  assert.match(replies[0], /Cantina Teste/);
  assert.match(replies[0], /5\. Falar com atendente/);
});

test('cardápio numera só itens disponíveis', async () => {
  const { say } = setup();
  const { replies } = await say('cardápio');
  assert.match(replies[0], /1\. Calabresa - R\$ 40,00/);
  assert.match(replies[0], /3\. Refrigerante lata/);
  assert.doesNotMatch(replies[0], /Suco esgotado/);
});

test('pedido completo com entrega e troco cria o pedido', async () => {
  const { say, store } = setup();
  await say('1');
  let out = await say('2x1, 3');
  assert.match(out.replies[0], /2x Calabresa - R\$ 80,00/);
  assert.match(out.replies[0], /Subtotal: R\$ 86,00/);

  out = await say('fechar');
  assert.match(out.replies[0], /1\. Entrega/);
  out = await say('1');
  assert.match(out.replies[0], /endereço/i);
  out = await say('Rua das Flores, 123, Centro');
  assert.match(out.replies[0], /forma de pagamento/i);
  out = await say('3'); // Dinheiro
  assert.match(out.replies[0], /troco/i);
  out = await say('100');
  assert.match(out.replies[0], /troco para R\$ 100,00/);
  assert.match(out.replies[0], /\*Total: R\$ 91,00\*/);

  out = await say('1');
  assert.match(out.replies[0], /Pedido #1 recebido/);
  assert.equal(out.effects[0].type, 'order_created');

  const order = store.orders[0];
  assert.equal(order.total, 91);
  assert.equal(order.fee, 5);
  assert.equal(order.mode, 'delivery');
  assert.equal(order.address, 'Rua das Flores, 123, Centro');
  assert.equal(order.payment, 'Dinheiro');
  assert.equal(order.changeFor, 100);
  assert.equal(order.customer.phone, '5511999990000');
  assert.equal(order.items.length, 2);
});

test('retirada não cobra taxa nem pede endereço', async () => {
  const { say, store } = setup();
  await say('cardapio');
  await say('2');
  await say('fechar');
  let out = await say('retirada');
  assert.match(out.replies[0], /forma de pagamento/i);
  out = await say('pix');
  assert.match(out.replies[0], /Retirada na loja/);
  await say('sim');
  assert.equal(store.orders[0].fee, 0);
  assert.equal(store.orders[0].total, 42);
  assert.equal(store.orders[0].payment, 'Pix');
});

test('item inexistente é avisado sem quebrar o carrinho', async () => {
  const { say } = setup();
  await say('1');
  const out = await say('9');
  assert.match(out.replies[0], /Não encontrei o item 9/);
  assert.match(out.replies[0], /carrinho está vazio/i);
});

test('pedido mínimo bloqueia o fechamento', async () => {
  const { say, store } = setup();
  store.updateSettings('store', { minOrder: 50 });
  await say('1');
  await say('3');
  const out = await say('fechar');
  assert.match(out.replies[0], /pedido mínimo é R\$ 50,00/);
});

test('loja fechada avisa uma vez e não abre pedido', async () => {
  const { say, store } = setup({ now: CLOSED_TIME });
  let out = await say('cardapio');
  assert.match(out.replies[0], /Estamos fechados/);
  out = await say('pedido');
  assert.equal(out.replies.length, 0, 'não repete o aviso logo em seguida');
  assert.equal(store.orders.length, 0);
});

test('cancelar no meio zera o pedido', async () => {
  const { say, engine } = setup();
  await say('1');
  await say('1');
  await say('fechar');
  const out = await say('cancelar');
  assert.match(out.replies[0], /cancelado/);
  assert.equal(engine.session(CHAT).state, 'idle');
  assert.equal(engine.session(CHAT).cart.length, 0);
});

test('pedir atendente registra o chamado e pausa a conversa', async () => {
  const { say, store } = setup();
  const out = await say('quero falar com um atendente');
  assert.match(out.replies[0], /pessoa da equipe/);
  assert.equal(out.effects[0].type, 'handoff');
  assert.equal(store.handoffs.length, 1);
  assert.equal(store.isPaused(CHAT, OPEN_TIME.getTime()), true);

  const silent = await say('oi');
  assert.equal(silent.replies.length, 0, 'conversa pausada não recebe resposta do robô');
});

test('robô em "só avisos" ou desligado não responde', async () => {
  const { say, store } = setup();
  store.updateSettings('bot', { status: 'alerts' });
  assert.equal((await say('oi')).replies.length, 0);
  store.updateSettings('bot', { status: 'inactive' });
  assert.equal((await say('oi')).replies.length, 0);
});

test('status do pedido informa o último pedido do cliente', async () => {
  const { say, store } = setup();
  assert.match((await say('status')).replies[0], /Não encontrei pedido seu/);
  const order = store.createOrder({
    customer: { chatId: CHAT, name: 'Ana' }, items: [{ name: 'Calabresa', qty: 1, price: 40 }], mode: 'pickup', payment: 'Pix',
  });
  store.setOrderStatus(order.id, 'preparing');
  assert.match((await say('cadê meu pedido')).replies[0], /#1 está \*em produção\*/);
});

test('mensagem do botão "Continuar no WhatsApp" do site responde o status, mesmo com IA ligada', async () => {
  const ai = { available: () => true, reply: async () => { throw new Error('não devia chamar a IA'); } };
  const { say, store } = setup({ ai });
  const order = store.createOrder({
    customer: { chatId: CHAT, name: 'Ana' }, items: [{ name: 'Calabresa', qty: 1, price: 40 }], mode: 'pickup', payment: 'Pix',
  });
  store.setOrderStatus(order.id, 'preparing');
  const { replies } = await say(`Oi! Acabei de fazer o pedido #${order.number} pelo site. Pode me avisar por aqui?`);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /#1 está \*em produção\*/);
});

test('pausa expira sozinha', () => {
  const { store } = setup();
  const t0 = 1_000_000;
  store.pauseChat(CHAT, '15m', t0);
  assert.equal(store.isPaused(CHAT, t0 + 14 * 60e3), true);
  assert.equal(store.isPaused(CHAT, t0 + 16 * 60e3), false);
  store.pauseChat(CHAT, 'indefinite', t0);
  assert.equal(store.isPaused(CHAT, t0 + 10 * 365 * 24 * 60 * 60e3), true);
  assert.equal(store.resumeChat(CHAT), true);
  assert.equal(store.isPaused(CHAT, t0), false);
});

test('áudio recebe pedido para escrever', async () => {
  const { say } = setup();
  const out = await say('', { type: 'ptt' });
  assert.match(out.replies[0], /Não consegui ouvir seu áudio/);
});

test('localização vira endereço na etapa de entrega', async () => {
  const { say, engine } = setup();
  await say('1');
  await say('1');
  await say('fechar');
  await say('entrega');
  await say('', { type: 'location', location: { lat: -23.5, lng: -46.6 } });
  assert.match(engine.session(CHAT).address, /maps\.google\.com\/\?q=-23\.5,-46\.6/);
});

test('mensagem livre vai para a IA quando disponível e cai nas regras se ela falhar', async () => {
  const calls = [];
  const ai = {
    available: () => true,
    reply: async ({ text }) => { calls.push(text); return ['Temos sim!']; },
  };
  const { say } = setup({ ai });
  let out = await say('me indica alguma coisa boa pra um lanche da tarde');
  assert.deepEqual(out.replies, ['Temos sim!']);
  assert.equal(calls.length, 1);

  ai.reply = async () => { throw new Error('sem rede'); };
  out = await say('e pra criança, o que você indica por aí?');
  assert.equal(out.effects[0].type, 'ai_error');
  assert.match(out.replies[0], /Responda com o número/);
});

test('conversa @lid usa o telefone informado pelo WhatsApp, não o número interno', async () => {
  const { store, engine } = setup();
  const LID = '266318204903671@lid';
  const say = (text) => engine.handle({ chatId: LID, phone: '5528998826841', name: 'Rui', type: 'chat', text });
  for (const text of ['1', '1', 'fechar', '2', '1', '1']) await say(text);
  assert.equal(store.orders.length, 1);
  assert.equal(store.orders[0].customer.chatId, LID);
  assert.equal(store.orders[0].customer.phone, '5528998826841');

  await say('quero falar com atendente');
  assert.equal(store.handoffs[0].phone, '5528998826841');
});

test('conversa @lid sem telefone conhecido fica sem telefone em vez de um número errado', async () => {
  const { store, engine } = setup();
  await engine.handle({ chatId: '999@lid', name: 'Sem número', type: 'chat', text: 'atendente' });
  assert.equal(store.handoffs[0].phone, '');
  assert.equal(phoneFromChatId('5511999990000@c.us'), '5511999990000');
  assert.equal(phoneFromChatId('266318204903671@lid'), '');
});
