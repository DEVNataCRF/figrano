'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Store } = require('../src/main/store');
const { OnlineSync } = require('../src/main/online');
const { BotEngine } = require('../src/main/bot/engine');

function fakeServer(pending = []) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const path = new URL(url).pathname;
    calls.push({ method: init.method, path, body, auth: init.headers?.Authorization || '' });
    let data = { ok: true };
    if (path === '/api/stores') data = { storeId: 's1', slug: body.slug, token: 'tok', url: `https://pedidos.test/${body.slug}` };
    if (path === '/api/store/orders' && init.method === 'GET') data = { orders: pending.splice(0) };
    if (path === '/api/store/sync') data = { ok: true, url: 'https://pedidos.test/cantina' };
    return { ok: true, status: 200, json: async () => data };
  };
  return { fetch, calls };
}

function setup(pending) {
  const store = new Store(null);
  store.updateSettings('store', { name: 'Cantina', deliveryFee: 6 });
  const pizzas = store.saveCategory({ name: 'Pizzas' });
  store.saveItem(pizzas.id, { name: 'Calabresa', price: 44.9 });
  store.updateSettings('online', { enabled: true, apiUrl: 'https://pedidos.test', url: 'https://pedidos.test/cantina' });
  const server = fakeServer(pending);
  const imported = [];
  const online = new OnlineSync({
    store,
    getToken: () => 'tok',
    fetch: server.fetch,
    importOrder: async (remote) => {
      imported.push(remote.id);
      return store.createOrder({ ...remote, source: 'online', onlineId: remote.id });
    },
  });
  return { store, online, server, imported };
}

const remoteOrder = {
  id: '11111111-1111-1111-1111-111111111111', ref: '', customer: { name: 'Rui', phone: '28998826841' },
  items: [{ name: 'Calabresa', price: 44.9, qty: 2, notes: '' }], mode: 'delivery',
  address: 'Rua São José, 120', payment: 'Pix', changeFor: null, notes: '',
};

test('sync envia dados da loja e cardápio com o token', async () => {
  const { online, server } = setup();
  await online.sync();
  const call = server.calls.find((c) => c.path === '/api/store/sync');
  assert.equal(call.method, 'PUT');
  assert.equal(call.auth, 'Bearer tok');
  assert.equal(call.body.info.name, 'Cantina');
  assert.equal(call.body.menu[0].items[0].name, 'Calabresa');
});

test('poll traz o pedido para o painel e confirma com o número local', async () => {
  const { store, online, server } = setup([{ ...remoteOrder }]);
  await online.poll();
  assert.equal(store.orders.length, 1);
  assert.equal(store.orders[0].onlineId, remoteOrder.id);
  const ack = server.calls.find((c) => c.method === 'PATCH');
  assert.equal(ack.path, `/api/store/orders/${remoteOrder.id}`);
  assert.deepEqual(ack.body, { status: 'new', number: 1 });
});

test('pedido que volta na fila (confirmação falhou) não é duplicado', async () => {
  const { store, online, imported } = setup([{ ...remoteOrder }]);
  await online.poll();
  online.fetch = fakeServer([{ ...remoteOrder }]).fetch;
  await online.poll();
  assert.equal(store.orders.length, 1);
  assert.equal(imported.length, 1);
});

test('mudança de status de pedido do site vai para o servidor', async () => {
  const { store, online, server } = setup([{ ...remoteOrder }]);
  await online.poll();
  const order = store.setOrderStatus(store.orders[0].id, 'preparing');
  await online.pushStatus(order);
  const last = server.calls.at(-1);
  assert.deepEqual(last.body, { status: 'preparing', number: 1 });
});

test('sem conexão: registra o erro e não derruba nada', async () => {
  const { online } = setup();
  online.fetch = async () => { throw new TypeError('fetch failed'); };
  await online.poll();
  assert.match(online.lastError, /Sem conexão/);
});

test('link por conversa reaproveita o código e leva de volta ao chat', () => {
  const { online } = setup();
  const first = online.linkFor('266318204903671@lid');
  const again = online.linkFor('266318204903671@lid');
  assert.equal(first, again);
  const ref = new URL(first).searchParams.get('r');
  assert.equal(online.chatIdForRef(ref), '266318204903671@lid');
  assert.equal(online.chatIdForRef('naoexiste'), '');
});

test('robô manda o link da página em vez do cardápio quando o pedido online está ligado', async () => {
  const { store, online } = setup();
  store.updateSettings('store', { hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { closed: false, open: '00:00', close: '23:59' }])) });
  const engine = new BotEngine({ store, onlineLink: (chatId) => online.linkFor(chatId) });
  const out = await engine.handle({ chatId: '1@lid', type: 'chat', text: '1' });
  assert.equal(out.replies.length, 1);
  assert.match(out.replies[0], /https:\/\/pedidos\.test\/cantina\?r=[0-9a-f]{12}/);
});
