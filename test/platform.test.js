'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/main/store');
const { Platform, paymentCode, brazilPhone } = require('../src/main/platform');
const { BotEngine } = require('../src/main/robo/engine');

const MENU = {
  companyName: 'Sabores da Sil',
  whatsappPhone: '5528999177660',
  config: {
    enabled: true,
    hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { closed: false, open: '00:00', close: '00:00' }])),
    deliveryFee: 5,
    minOrder: 0,
    prepMinutes: 40,
    acceptsDelivery: true,
    acceptsPickup: true,
    payments: ['PIX', 'CASH'],
    pickupAddress: 'Rua da Sil, 10',
  },
  open: true,
  acceptingOrders: true,
  closedReason: null,
  categories: [{ id: 'c1', name: 'Salgados', items: [{ id: 'p1', name: 'Coxinha', description: '', price: 2, photoUrl: null }] }],
};

function apiOrder(overrides = {}) {
  return {
    id: 'o1', number: 7, status: 'NEW', source: 'SITE', customerId: 'x', customerName: 'Ana', customerPhone: '(28) 99400-0001',
    mode: 'DELIVERY', address: 'Rua A, 1', paymentMethod: 'PIX', changeFor: null, notes: null, subtotal: 20, deliveryFee: 5,
    total: 25, chatRef: null, items: [{ id: 'i1', productId: 'p1', name: 'Coxinha', unitPrice: 2, quantity: 10, subtotal: 20, notes: null }],
    createdAt: new Date().toISOString(), acceptedAt: null, completedAt: null, canceledAt: null, cancelReason: null,
    ...overrides,
  };
}

/** Servidor falso: responde como a API do Sabores e guarda o que recebeu. */
function fakeApi() {
  const calls = [];
  let orders = [];
  let loginCodes = [];
  const fetch = async (url, init = {}) => {
    const path = url.replace('http://api.test/api/v1', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, body, auth: init.headers?.Authorization });
    const ok = (data, status = 200) => ({ ok: true, status, json: async () => ({ success: true, data }) });
    if (path === '/public/delivery/menu') return ok(MENU);
    if (path === '/delivery/heartbeat') return ok({ at: new Date().toISOString() });
    if (path === '/delivery/orders' && init.method === 'GET') return ok(orders);
    if (path === '/delivery/orders' && init.method === 'POST') {
      const created = apiOrder({ id: 'o-bot', number: 8, source: 'WHATSAPP', chatRef: body.chatRef });
      return ok(created, 201);
    }
    if (path.endsWith('/status') && init.method === 'PATCH') return ok({ id: path.split('/')[3], status: body.status });
    if (path === '/delivery/login-codes/pending') return ok(loginCodes);
    if (path.startsWith('/delivery/login-codes/') && init.method === 'POST') return ok({ updated: 1 });
    if (path === '/auth/me') return ok({ user: { id: 'u', name: 'Sil', role: 'OWNER_ADMIN' } });
    return { ok: false, status: 404, json: async () => ({ success: false, error: { message: 'não achei' } }) };
  };
  return { fetch, calls, setOrders: (list) => { orders = list; }, setLoginCodes: (list) => { loginCodes = list; } };
}

function setup() {
  const store = new Store(null);
  store.updateSettings('platform', { apiUrl: 'http://api.test/api/v1', siteUrl: 'http://site.test' });
  let token = 'tok';
  const events = [];
  const api = fakeApi();
  const platform = new Platform({
    store, getToken: () => token, saveToken: (t) => { token = t; }, onEvent: (e) => events.push(e), fetch: api.fetch,
  });
  return { store, platform, events, api };
}

test('rótulos de pagamento e telefone viram o formato da API', () => {
  assert.equal(paymentCode('Pix'), 'PIX');
  assert.equal(paymentCode('dinheiro'), 'CASH');
  assert.equal(paymentCode('Cartão de débito'), 'DEBIT_CARD');
  assert.equal(paymentCode('cartão'), 'CREDIT_CARD');
  assert.equal(brazilPhone('5528999177660'), '(28) 99917-7660');
  assert.equal(brazilPhone('123'), '');
});

test('regras da loja e cardápio chegam ao robô no formato dele', async () => {
  const { store, platform } = setup();
  await platform.refreshMenu();
  const s = platform.storeSettings(store.settings.store);
  assert.equal(s.name, 'Sabores da Sil');
  assert.equal(s.deliveryFee, 5);
  assert.deepEqual(s.payments, ['Pix', 'Dinheiro']);
  assert.equal(platform.numberedItems()[0].number, 1);
  assert.equal(platform.numberedItems()[0].id, 'p1');
});

test('pedido do robô vai para a API com produto, telefone, pagamento e o código da conversa', async () => {
  const { platform, api } = setup();
  await platform.refreshMenu();
  const order = await platform.createOrder({
    customer: { chatId: '5528999990000@c.us', name: 'Bia', phone: '5528999990000' },
    items: [{ itemId: 'p1', name: 'Coxinha', qty: 10, price: 2, notes: 'bem quente' }],
    mode: 'delivery', address: 'Rua B, 20', payment: 'Pix', changeFor: null,
  });
  const sent = api.calls.find((c) => c.method === 'POST' && c.path === '/delivery/orders').body;
  assert.equal(sent.source, 'WHATSAPP');
  assert.equal(sent.customer.phoneWhatsapp, '(28) 99999-0000');
  assert.equal(sent.paymentMethod, 'PIX');
  assert.deepEqual(sent.items, [{ productId: 'p1', quantity: 10, notes: 'bem quente' }]);
  assert.ok(sent.chatRef && sent.idempotencyKey);
  assert.equal(order.number, 8);
  assert.equal(platform.chatIdForRef(sent.chatRef), '5528999990000@c.us');
});

test('sem telefone, o robô não grava pedido (avisa o cliente)', async () => {
  const { platform } = setup();
  await assert.rejects(
    platform.createOrder({ customer: { chatId: 'x@lid', name: 'Sem fone', phone: '' }, items: [{ itemId: 'p1', qty: 1 }], mode: 'pickup', payment: 'Pix' }),
    /telefone/,
  );
});

test('só avisa pedido novo e mudança de status depois da primeira leitura', async () => {
  const { platform, events, api } = setup();
  api.setOrders([apiOrder()]);
  await platform.pollOrders();
  assert.equal(events.filter((e) => e.type.startsWith('order_')).length, 0, 'pedido antigo não dispara aviso');

  api.setOrders([apiOrder({ status: 'PREPARING' }), apiOrder({ id: 'o2', number: 9 })]);
  await platform.pollOrders();
  const status = events.find((e) => e.type === 'order_status');
  const fresh = events.find((e) => e.type === 'order_new');
  assert.equal(status.order.status, 'preparing');
  assert.equal(status.previous, 'NEW');
  assert.equal(fresh.order.number, 9);
  assert.equal(fresh.order.source, 'online');
});

test('robô conectado: pedido confirmado vai para a API e o cliente recebe o número', async () => {
  const { store, platform } = setup();
  await platform.refreshMenu();
  const botStore = new Proxy(store, {
    get(target, prop) {
      if (prop === 'settings') return { ...target.settings, store: platform.storeSettings(target.settings.store) };
      if (prop === 'numberedItems') return () => platform.numberedItems();
      if (prop === 'createOrder') return (input) => platform.createOrder(input);
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const engine = new BotEngine({ store: botStore });
  const chat = { chatId: '5528999990000@c.us', phone: '5528999990000', name: 'Bia', type: 'chat' };
  for (const text of ['oi', '1', '2x1', 'fechar', '2', 'pix']) await engine.handle({ ...chat, text });
  const out = await engine.handle({ ...chat, text: '1' });
  assert.ok(out.replies.some((r) => r.includes('#8')), out.replies.join(' | '));
});

test('assunto de festa vai para a Canela', async () => {
  const { store } = setup();
  const asked = [];
  const engine = new BotEngine({
    store,
    livia: async (input) => { asked.push(input.message); return { reply: 'Oi! Sou a Canela, do buffet.', link: 'http://buffet.test/#orcamento' }; },
  });
  const out = await engine.handle({ chatId: 'a@c.us', phone: '5528999990000', type: 'chat', text: 'quero orçamento para festa de 80 convidados' });
  assert.equal(asked.length, 1);
  assert.ok(out.replies[0].includes('Canela'));
  assert.ok(out.replies.some((r) => r.includes('#orcamento')));
  // A conversa segue com a Canela até o cliente pedir o delivery
  await engine.handle({ chatId: 'a@c.us', type: 'chat', text: 'e para dia 12 de dezembro?' });
  assert.equal(asked.length, 2);
});

test('cardápio pedido em frase longa recebe o link mesmo com a IA ligada', async () => {
  const { store } = setup();
  const ai = { available: () => true, reply: async () => ['(a IA não deveria responder isto)'] };
  const engine = new BotEngine({ store, ai, onlineLink: () => 'http://site.test/?r=abc123' });
  const out = await engine.handle({ chatId: 'q@c.us', phone: '5528999990000', type: 'chat', text: 'boa noite, me manda o cardápio por favor' });
  assert.ok(out.replies.join('\n').includes('http://site.test/?r=abc123'), out.replies.join(' | '));
});

test('loja fechada: avisa o horário e manda o link mesmo assim', async () => {
  const { store } = setup();
  store.updateSettings('store', { hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { closed: true, open: '18:00', close: '23:00' }])) });
  const engine = new BotEngine({ store, onlineLink: () => 'http://site.test/?r=abc123' });
  const out = await engine.handle({ chatId: 'w@c.us', phone: '5528999990000', type: 'chat', text: 'cardapio' });
  const text = out.replies.join('\n');
  assert.match(text, /fechados/);
  assert.ok(text.includes('http://site.test/?r=abc123'));
});

test('Pix pelo site: acha o pedido pendente da conversa e registra o comprovante', async () => {
  const { platform, api } = setup();
  const ref = platform.refFor('5528911112222@c.us');
  api.setOrders([apiOrder({ id: 'pix-1', number: 30, status: 'AWAITING_PIX', chatRef: ref })]);
  await platform.pollOrders();
  assert.equal(platform.pendingPixOrderFor('5528911112222@c.us', '').number, 30);
  // sem o código do link, acha pelo telefone do pedido
  assert.equal(platform.pendingPixOrderFor('outro@lid', '5528994000001').number, 30);
  assert.equal(platform.pendingPixOrderFor('ninguem@c.us', '5528900000000'), null);
});

test('status mudado com o app fechado: ao abrir, avisa (só se a mudança for recente)', async () => {
  const { store, platform, api } = setup();
  api.setOrders([apiOrder({ id: 'r1', status: 'NEW' }), apiOrder({ id: 'r2', number: 9, status: 'NEW' })]);
  await platform.pollOrders(); // app aberto viu os dois como novos

  // App fecha; no painel, r1 vai para produção agora e r2 mudou há 3 horas
  const old = new Date(Date.now() - 3 * 60 * 60e3).toISOString();
  api.setOrders([
    apiOrder({ id: 'r1', status: 'PREPARING', updatedAt: new Date().toISOString() }),
    apiOrder({ id: 'r2', number: 9, status: 'PREPARING', updatedAt: old }),
  ]);
  const events = [];
  const reopened = new Platform({ store, getToken: () => 'tok', saveToken: () => {}, onEvent: (e) => events.push(e), fetch: api.fetch });
  await reopened.pollOrders();
  const statusEvents = events.filter((e) => e.type === 'order_status');
  assert.equal(statusEvents.length, 1);
  assert.equal(statusEvents[0].order.id, 'r1');
  assert.equal(statusEvents[0].previous, 'NEW');

  // Sem mudança nova: não repete o aviso
  events.length = 0;
  await reopened.pollOrders();
  assert.equal(events.filter((e) => e.type === 'order_status').length, 0);
});

test('sessão própria do robô: token vencido é renovado sozinho e a chamada é repetida', async () => {
  const store = new Store(null);
  store.updateSettings('platform', { apiUrl: 'http://api.test/api/v1', siteUrl: 'http://site.test' });
  let token = '';
  let refresh = '';
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = url.replace('http://api.test/api/v1', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, auth: init.headers?.Authorization, body });
    const json = (status, payload) => ({ ok: status < 400, status, json: async () => payload });
    if (path === '/auth/refresh') {
      if (body.refreshToken !== 'r1') return json(401, { success: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } });
      return json(200, { success: true, data: { accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 } });
    }
    if (path === '/auth/me') {
      if (init.headers?.Authorization === 'Bearer a1') return json(401, { success: false, error: { code: 'TOKEN_EXPIRED', message: 'venceu' } });
      return json(200, { success: true, data: { user: { id: 'u', name: 'Sil', role: 'OWNER_ADMIN' } } });
    }
    return json(200, { success: true, data: [] });
  };
  const platform = new Platform({
    store,
    getToken: () => token,
    saveToken: (t) => { token = t; },
    getRefreshToken: () => refresh,
    saveRefreshToken: (t) => { refresh = t; },
    fetch,
  });
  const user = await platform.adoptSession({ accessToken: 'a1', refreshToken: 'r1', expiresIn: 900 });
  platform.stop();
  assert.equal(user.name, 'Sil');
  assert.equal(token, 'a2');
  assert.equal(refresh, 'r2');
  assert.ok(calls.some((c) => c.path === '/auth/refresh'));

  // Renovação recusada: sessão acaba (sem ficar insistindo com token morto)
  token = 'a1';
  refresh = 'r-morto';
  await assert.rejects(() => platform.request('GET', '/auth/me'));
  assert.equal(token, '');
  assert.equal(refresh, '');
  assert.ok(calls.some((c) => c.path === '/auth/logout'));
});

test('adoptSession aceita o formato antigo (só o token)', async () => {
  const { platform, api } = setup();
  await platform.adoptSession('tok-velho');
  platform.stop();
  assert.ok(api.calls.some((c) => c.path === '/auth/me' && c.auth === 'Bearer tok-velho'));
});

test('código para entrar no site: cada um vira um envio só, e a API fica sabendo se saiu', async () => {
  const { platform, events, api } = setup();
  const job = { id: 'c1', phone: '(28) 99400-0077', message: 'Seu código para entrar no site do Sabores da Sil: *123456*' };
  api.setLoginCodes([job]);
  await platform.pollLoginCodes();
  await platform.pollLoginCodes(); // a API ainda lista o mesmo código: não manda de novo
  const sends = events.filter((e) => e.type === 'login_code');
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].job, job);

  await platform.reportLoginCode('c1', true);
  const report = api.calls.find((c) => c.method === 'POST' && c.path === '/delivery/login-codes/c1/sent');
  assert.deepEqual(report.body, { sent: true });
});

test('aceitar pedido: manda "Em preparo" para a API e devolve o pedido atualizado', async () => {
  const { platform, api } = setup();
  const order = await platform.acceptOrder('o9');
  const call = api.calls.find((c) => c.method === 'PATCH');
  assert.equal(call.path, '/delivery/orders/o9/status');
  assert.deepEqual(call.body, { status: 'PREPARING' });
  assert.equal(order.status, 'PREPARING');
});
