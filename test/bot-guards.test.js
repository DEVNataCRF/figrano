'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/main/store');
const { BotEngine } = require('../src/main/robo/engine');

/** IA falsa que devolve um texto fixo (e opcionalmente mexe no carrinho). */
function setup(reply, tool) {
  const store = new Store(null);
  store.updateSettings('store', {
    deliveryFee: 5,
    hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { closed: false, open: '00:00', close: '00:00' }])),
  });
  const cat = store.saveCategory({ name: 'Salgados' });
  store.saveItem(cat.id, { name: 'Coxinha', price: 3.5 });
  const ai = { available: () => true, reply: async ({ engine, session }) => { if (tool) tool(engine, session); return [reply]; } };
  return { store, engine: new BotEngine({ store, ai }) };
}
const chat = { chatId: 'g@c.us', phone: '5528999990000', type: 'chat' };

test('IA diz "pedido enviado" sem enviar: troca pela verdade', async () => {
  const { engine } = setup('Pronto! Seu pedido foi enviado com sucesso.');
  const out = await engine.handle({ ...chat, text: 'me ajuda a escolher alguma coisa gostosa pra hoje' });
  assert.ok(!out.replies.join(' ').includes('enviado com sucesso'), out.replies.join(' | '));
  assert.ok(out.effects.some((e) => e.type === 'ai_guard'));
});

test('IA cita número de pedido que não existe: bloqueado', async () => {
  const { engine } = setup('Seu pedido #57 já está sendo preparado!');
  const out = await engine.handle({ ...chat, text: 'como está aquele meu pedido de ontem à noite?' });
  assert.ok(!out.replies.join(' ').includes('#57'));
});

test('IA erra a conta: o resumo sai do sistema com o total certo', async () => {
  const { engine } = setup('Seu total ficou R$ 99,00!', (engine, session) => {
    engine.addItems(session, [{ number: 1, quantity: 10, notes: '' }]);
  });
  const out = await engine.handle({ ...chat, text: 'me vê aquelas de sempre por favor' });
  const text = out.replies.join(' ');
  assert.ok(!text.includes('99,00'));
  assert.ok(text.includes('R$ 35,00'), text);
});

test('IA diz que anotou mas o carrinho não mudou: pede de novo, sem mentir', async () => {
  const { engine } = setup('Anotei tudo certinho!');
  const out = await engine.handle({ ...chat, text: 'me vê aquelas de sempre por favor' });
  assert.match(out.replies.join(' '), /Não consegui anotar/);
});

test('pedido completo em frase livre + "sim" = pedido gravado pelo sistema', async () => {
  const { store, engine } = setup('(a IA não deveria falar aqui)');
  const first = await engine.handle({ ...chat, text: 'quero 10 coxinhas pra retirar, pago no pix' });
  assert.match(first.replies.join(' '), /Total: R\$ 35,00/);
  const second = await engine.handle({ ...chat, text: 'sim, pode mandar' });
  assert.match(second.replies.join(' '), /Pedido #1 recebido/);
  assert.equal(store.orders.length, 1);
  assert.equal(store.orders[0].total, 35);
});
