'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/main/store');
const { BotEngine } = require('../src/main/robo/engine');
const { answerFaq } = require('../src/main/robo/respostas');

const OPEN_TIME = new Date(2026, 10, 18, 20, 0);
const BAIRROS = [{ name: 'Centro', fee: 5 }, { name: 'São Miguel', fee: 7.5 }];

function setup() {
  const store = new Store(null);
  store.updateSettings('store', { name: 'Sabores', deliveryFee: 9, neighborhoods: BAIRROS, payments: ['Pix', 'Dinheiro'] });
  const cat = store.saveCategory({ name: 'Salgados' });
  store.saveItem(cat.id, { name: 'Coxinha', price: 3.5 });
  const engine = new BotEngine({ store, now: () => OPEN_TIME });
  let n = 0;
  const cliente = () => {
    const chatId = `55289990000${++n}@c.us`;
    return (text) => engine.handle({ chatId, name: 'Ana', type: 'chat', text });
  };
  return { store, engine, cliente };
}

test('bairro achado no endereço: resumo já sai com a taxa daquele bairro', async () => {
  const { cliente } = setup();
  const out = await cliente()('quero 10 coxinhas pra entregar na rua das flores 120, são miguel, pago no pix');
  const text = out.replies.join('\n');
  assert.match(text, /Entrega: R\$ 7,50/);
  assert.match(text, /Total: R\$ 42,50/);
});

test('sem bairro no endereço: robô pergunta; bairro fora da lista é recusado; depois segue', async () => {
  const { cliente } = setup();
  const say = cliente();
  let out = await say('quero 10 coxinhas pra entregar na rua das flores 120, pago no pix');
  assert.match(out.replies.join('\n'), /Qual é o bairro\? Entregamos em: Centro \(R\$ 5,00\), São Miguel \(R\$ 7,50\)/);
  out = await say('alegre');
  assert.match(out.replies[0], /Ainda não entregamos nesse bairro/);
  out = await say('centro');
  assert.match(out.replies.join('\n'), /Entrega: R\$ 5,00[\s\S]*Total: R\$ 40,00/);
});

test('fora da lista, cliente pode escolher retirar', async () => {
  const { cliente, store } = setup();
  store.updateSettings('store', { pickup: true });
  const say = cliente();
  await say('quero 10 coxinhas pra entregar na rua x 10, pago no pix');
  const out = await say('retirar');
  assert.doesNotMatch(out.replies.join('\n'), /Entrega: R\$/);
  assert.match(out.replies.join('\n'), /Total: R\$ 35,00/);
});

test('perguntas de taxa respondem pelo bairro', () => {
  const store = { delivery: true, deliveryFee: 9, neighborhoods: BAIRROS, payments: [] };
  assert.match(answerFaq('qual a taxa pro são miguel?', { store, items: [], link: null }), /São Miguel, a taxa de entrega é R\$ 7,50/);
  assert.match(answerFaq('qual a taxa de entrega?', { store, items: [], link: null }), /depende do bairro: Centro \(R\$ 5,00\)/);
  assert.match(answerFaq('vcs entregam no centro?', { store, items: [], link: null }), /Entregamos sim! Para o Centro/);
  assert.match(answerFaq('vcs entregam em alegre?', { store, items: [], link: null }), /Entregamos nestes bairros/);
});

test('pagamento em frase: "2 e não precisa de troco", "pix", "dinheiro, troco pra 50"', async () => {
  const { cliente, store } = setup();
  store.updateSettings('store', { payments: ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito'], neighborhoods: [] });
  const caminho = async (pagamento) => {
    const say = cliente();
    await say('1');
    await say('10x1');
    await say('fechar');
    await say('1');
    await say('rua das flores 120 centro');
    return say(pagamento);
  };
  let out = await caminho('2 e não precisa de troco');
  assert.match(out.replies[0], /Confira seu pedido[\s\S]*Dinheiro/);
  out = await caminho('vou pagar no pix');
  assert.match(out.replies[0], /Confira seu pedido[\s\S]*Pix/);
  out = await caminho('dinheiro, troco pra 50');
  assert.match(out.replies[0], /Troco para R\$ 50,00|troco/i);
  out = await caminho('cartão');
  assert.match(out.replies[0], /No débito ou no crédito?/);
  out = await caminho('2');
  assert.match(out.replies[0], /Precisa de troco/);
});

test('pedido no meio da frase: "vou querer 1x100 e vocês tem pastel hoje?"', async () => {
  const { cliente } = setup();
  const say = cliente();
  await say('lista');
  const out = await say('olha eu to com uma turma grande aqui vou querer 1x100 e voces tem pastel hoje?');
  const text = out.replies.join('\n');
  assert.match(text, /100x Coxinha - R\$ 350,00/); // ordem trocada corrigida; 100 unidades aceitas
  assert.match(text, /Pastel não tem no cardápio de hoje/); // respondeu o pastel
});

test('pergunta no meio do pedido responde e lembra o carrinho; frase sem nada vira instrução', async () => {
  const { cliente } = setup();
  const say = cliente();
  await say('lista');
  await say('10x1');
  let out = await say('quanto tá a coxinha?');
  assert.match(out.replies[0], /Coxinha: R\$ 3,50[\s\S]*Seu carrinho continua: 10 itens, R\$ 35,00/);
  out = await say('hmm deixa eu ver aqui');
  assert.match(out.replies[0], /10x1/);
});

test('saudação usa o primeiro nome com maiúscula', async () => {
  const { store } = setup();
  const engine = new BotEngine({ store, now: () => OPEN_TIME });
  const out = await engine.handle({ chatId: 'n@c.us', name: 'natã corrêa', type: 'chat', text: 'oi' });
  assert.match(out.replies[0], /^Olá, Natã!/);
  const emoji = await engine.handle({ chatId: 'm@c.us', name: '🍕🍕', type: 'chat', text: 'oi' });
  assert.match(emoji.replies[0], /^Olá! /);
});

test('"100x1 e vocês tem pastel hoje?" (sem texto antes)', async () => {
  const { cliente } = setup();
  const say = cliente();
  await say('lista');
  const out = await say('100x1 e voces tem pastel hoje?');
  const text = out.replies.join('\n');
  assert.match(text, /100x Coxinha - R\$ 350,00/);
  assert.match(text, /Pastel não tem no cardápio de hoje/);
});

test('pergunta no meio do pedido não vira informação do pedido ("qual a taxa pro centro?")', async () => {
  const { cliente } = setup();
  const say = cliente();
  await say('lista');
  await say('100x1');
  const out = await say('qual a taxa de entrega para o centro?');
  assert.match(out.replies[0], /Para o Centro, a taxa de entrega é R\$ 5,00[\s\S]*Seu carrinho continua: 100 itens/);
  // pedido de verdade com "entrega" continua funcionando
  const out2 = await say('pra entregar na rua das flores 120, centro, pago no pix');
  assert.match(out2.replies.join('\n'), /Confira seu pedido/);
});

test('"50x4 quero experimentar esse churros" = 50 do item 4 (não 4 churros)', async () => {
  const { cliente, store } = setup();
  const cat2 = store.saveCategory({ name: 'Doces' });
  store.saveItem(cat2.id, { name: 'Bolo', price: 10 });
  store.saveItem(cat2.id, { name: 'Pudim', price: 8 });
  store.saveItem(cat2.id, { name: 'Mini churros recheados', price: 2.5 });
  const say = cliente();
  await say('lista');
  await say('100x1');
  const out = await say('50x4 quero experimentar esse churros');
  assert.match(out.replies.join('\n'), /50x Mini churros recheados - R\$ 125,00/);
  // sem a lista aberta também
  const out2 = await cliente()('50x4 quero experimentar esse churros');
  assert.match(out2.replies.join('\n'), /50x Mini churros recheados/);
});

test('app reiniciado no meio do pedido: o carrinho continua', async () => {
  const { store, engine } = setup();
  const say = (e, text) => e.handle({ chatId: 'r@c.us', name: 'Ana', type: 'chat', text });
  await say(engine, 'lista');
  await say(engine, '100x1');
  // "reinicia": um robô novo lendo o mesmo armazenamento
  const reopened = new BotEngine({ store, now: () => OPEN_TIME });
  const out = await say(reopened, 'carrinho');
  assert.match(out.replies[0], /100x Coxinha - R\$ 350,00/);
});

test('endereço falado vira endereço de comanda', async () => {
  const { cliente, store } = setup();
  store.updateSettings('store', { neighborhoods: [] });
  const say = cliente();
  await say('lista');
  await say('10x1');
  await say('fechar');
  await say('1');
  await say('Eu moro na Rua Venida, na Físcula Cerda de Aguiar, 423, no centro e o complemento é Rua do Teatro.');
  const out = await say('1');
  // fala limpa e nome da rua corrigido pela base da cidade
  assert.match(out.replies[0], /Endereço: Avenida Governador (Francisco )?Lacerda de Aguiar, 423, centro, complemento: Rua do Teatro\n/);
  assert.match(out.replies[0], /\*3\* para corrigir o endereço/);
});

test('no resumo: "3" corrige o endereço e volta ao resumo; endereço novo direto também', async () => {
  const { cliente, store } = setup();
  store.updateSettings('store', { neighborhoods: [] });
  const say = cliente();
  for (const m of ['lista', '10x1', 'fechar', '1', 'rua errada 1 centro', '1']) await say(m);
  let out = await say('3');
  assert.match(out.replies[0], /endereço certo/);
  out = await say('Avenida Francisco Lacerda de Aguiar, 423, centro');
  assert.match(out.replies[0], /Confira seu pedido[\s\S]*Endereço: Avenida Francisco Lacerda de Aguiar, 423, centro\n[\s\S]*Pagamento: Pix/);
  out = await say('rua das flores 120, centro');
  assert.match(out.replies[0], /Endereço: rua das flores 120, centro\n/);
});

test('comando com erro de digitação: "frchar", "fexar", "carrnho", "cancelr"', async () => {
  const { cliente } = setup();
  const say = cliente();
  await say('lista');
  await say('10x1');
  let out = await say('carrnho');
  assert.match(out.replies[0], /10x Coxinha/);
  out = await say('frchar');
  assert.match(out.replies[0], /Como prefere receber|endereço|pagamento/i);
  const say2 = cliente();
  await say2('lista');
  await say2('10x1');
  out = await say2('fexar');
  assert.match(out.replies[0], /Como prefere receber|endereço|pagamento/i);
  const say3 = cliente();
  await say3('lista');
  await say3('10x1');
  out = await say3('cancelr');
  assert.match(out.replies[0], /Pedido cancelado/);
  // palavra comum não vira comando por engano
  const say4 = cliente();
  await say4('lista');
  out = await say4('pera');
  assert.doesNotMatch(out.replies[0] || '', /Pedido cancelado|Como prefere/);
});

test('erro de digitação nas perguntas: "ces acwita cartao?", "tem coxinah?", "taxa de entega"', () => {
  const store = { delivery: true, deliveryFee: 5, minOrder: 20, payments: ['Pix', 'Cartão de débito'], neighborhoods: [] };
  const items = [{ name: 'Coxinha', price: 3.5 }, { name: 'Mini churros recheados', price: 2.5 }];
  const ask = (t) => answerFaq(t, { store, items, link: null });
  assert.match(ask('ces acwita cartao?'), /Aceitamos: Pix, Cartão de débito/);
  assert.match(ask('tem coxinah?'), /Tem sim! Coxinha: R\$ 3,50/);
  assert.match(ask('quanto ta o churos?'), /Mini churros recheados: R\$ 2,50/);
  assert.match(ask('qual a taxa de entega?'), /taxa de entrega é R\$ 5,00/);
  assert.match(ask('tem pastel?'), /Pastel não tem/);
});

test('conversa de festa é da Sil: o robô avisa, fica quieto 24 h e volta quando ela devolve', async () => {
  // Decisão de 18/11/2026: o robô vai pausado para conversas de buffet.
  const { cliente, engine, store } = setup();
  const chatId = '55289990000' + '1@c.us';
  const say = cliente();
  let out = await say('quero orçamento de festa');
  assert.ok(out.effects.some((e) => e.type === 'festa_lead'));
  assert.match(out.replies.join('\n'), /A Sil já foi avisada e vai te responder pessoalmente/);
  // "escreva delivery" não funcionaria com o robô quieto
  assert.doesNotMatch(out.replies.join('\n'), /é só escrever \*delivery\*/);
  // Pausa de 24 h, não para sempre (lido direto: consultar uma hora vencida apagaria a pausa)
  assert.equal(store.data.pauses[chatId], OPEN_TIME.getTime() + 24 * 60 * 60e3);

  // Enquanto isso, o robô não responde nada (nem detalhes da festa, nem delivery)
  for (const text of ['oi', 'quanto tá a coxinha?', 'vai ser dia 20 de dezembro, umas 60 pessoas']) {
    out = await say(text);
    assert.deepEqual(out.replies, [], text);
  }

  // A Sil devolve ao robô (Atender → "Devolver ao robô"): ele volta a atender o delivery
  store.resumeChat(chatId);
  engine.forgetTopic(chatId);
  out = await say('quanto tá a coxinha?');
  assert.match(out.replies[0], /Coxinha: R\$ 3,50/);
});

test('saudação com a loja fechada avisa logo e mostra o horário', async () => {
  const store = new Store(null);
  // Fechado só na quarta (OPEN_TIME é uma quarta)
  store.updateSettings('store', { name: 'Sabores', hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { closed: d === 3, open: '18:00', close: '23:00' }])) });
  const engine = new BotEngine({ store, now: () => OPEN_TIME });
  const out = await engine.handle({ chatId: 'f@c.us', name: 'Ana', type: 'chat', text: 'oi' });
  assert.match(out.replies[0], /No momento estamos fechados[\s\S]*Quarta: fechado/);
  assert.doesNotMatch(out.replies[0], /1\. Ver cardápio e fazer pedido/);
});

test('todos os dias fechados: "delivery pausado", sem lista de sete "fechado"', async () => {
  const store = new Store(null);
  store.updateSettings('store', { name: 'Sabores', hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { closed: true, open: '18:00', close: '23:00' }])) });
  const engine = new BotEngine({ store, now: () => OPEN_TIME });
  const out = await engine.handle({ chatId: 'p@c.us', name: 'Ana', type: 'chat', text: 'oi' });
  assert.match(out.replies[0], /No momento o delivery está pausado/);
  assert.doesNotMatch(out.replies[0], /Domingo: fechado/);
});
