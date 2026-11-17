'use strict';

const {
  app, BrowserWindow, ipcMain, Menu, Tray, Notification, nativeImage, safeStorage, shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { Store } = require('./store');
const { BotEngine } = require('./bot/engine');
const { AiResponder } = require('./bot/ai');
const { menuText, statusNotification, money } = require('./bot/format');
const { SerialQueue, SendQueue } = require('./queues');
const { WhatsApp } = require('./whatsapp');
const { iconPng } = require('./icon');
const { startUpdater } = require('./updater');
const { OnlineSync } = require('./online');

const PROBE = process.argv.includes('--probe');
// Os dois modos de teste usam uma pasta de dados temporária e não tocam nos dados reais.
const SMOKE = process.argv.includes('--smoke') || PROBE;
// --send-test=<telefone>: roda o app normal com os dados reais e, ao conectar,
// envia uma mensagem de teste ao número e registra no console o que chegar.
const SEND_TEST = (process.argv.find((arg) => arg.startsWith('--send-test=')) || '').slice('--send-test='.length);
// --test-log: só registra no console o que chega, sem enviar nada.
const TEST_LOG = Boolean(SEND_TEST) || process.argv.includes('--test-log');
const TOP_BAR_COLOR = '#EFECE6';
const MESSAGE_TYPES = new Set(['chat', 'image', 'ptt', 'location']);
const STALE_MESSAGE_SECONDS = 120; // ignora histórico que o WhatsApp sincroniza ao conectar

if (SMOKE) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'figrano-smoke-')));

let win = null;
let tray = null;
let store = null;
let engine = null;
let ai = null;
let whatsapp = null;
let sendQueue = null;
let quitting = false;
let lastAiError = '';
let updater = null;
let online = null;
// Servidor padrão da página de pedidos; dá para trocar em Ajustes.
const DEFAULT_ONLINE_API = process.env.FIGRANO_ONLINE_API || 'https://figrano.vercel.app';
let updateReady = ''; // versão já baixada, esperando o app fechar
const receiveQueue = new SerialQueue();

// ------------------------------------------------------------- chave de API

/** Segredos (chave de API, token da loja) ficam criptografados pelo Windows. */
function decryptSecret(stored) {
  if (!stored) return '';
  try {
    if (stored.startsWith('plain:')) return stored.slice(6);
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    return '';
  }
}

function encryptSecret(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(clean).toString('base64')
    : `plain:${clean}`;
}

const readApiKey = () => decryptSecret(store.settings.ai.apiKeyEncrypted);
const writeApiKey = (key) => store.updateSettings('ai', { apiKeyEncrypted: encryptSecret(key) });
const readOnlineToken = () => decryptSecret(store.settings.online.tokenEncrypted);

// ----------------------------------------------------------------- utilidades

function notify(title, body, target) {
  if (SMOKE || !Notification.isSupported()) return;
  const notification = new Notification({ title, body, icon: nativeImage.createFromBuffer(iconPng(128)) });
  notification.on('click', () => {
    showWindow();
    if (target) win?.webContents.send('navigate', target);
  });
  notification.show();
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * ID de conversa de um telefone digitado (com ou sem DDI). Com o WhatsApp
 * conectado, pergunta ao servidor qual é o ID real; devolve '' se o número
 * não tem WhatsApp.
 */
async function chatIdFromPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  const full = digits.length <= 11 ? `55${digits}` : digits;
  if (!whatsapp?.ready) return `${full}@c.us`;
  try {
    return (await whatsapp.call('resolvePhone', full)) || '';
  } catch (error) {
    console.error('[whatsapp] falha ao consultar número:', error?.message || error);
    return `${full}@c.us`;
  }
}

function sendToChat(chatId, texts, options) {
  if (!whatsapp?.ready) return Promise.resolve({ sent: 0, skipped: texts.length, failed: 0, error: 'WhatsApp desconectado' });
  return sendQueue.enqueue(chatId, texts, options);
}

// ------------------------------------------------------- mensagens recebidas

function onWhatsappMessage(msg) {
  const chatId = msg.chatId || '';
  if (!chatId || chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.endsWith('@newsletter')) return;
  const bot = store.settings.bot;

  if (msg.fromMe) {
    // O atendente respondeu por conta própria: o robô sai da conversa por um tempo.
    // O eco do envio pode vir com outro ID da mesma pessoa (enviado para
    // "<telefone>@c.us", ecoado como "<id>@lid"): compara também pelo telefone.
    const phoneChat = msg.phone ? `${msg.phone}@c.us` : '';
    const manual = !sendQueue.sentRecently(chatId) && !(phoneChat && sendQueue.sentRecently(phoneChat));
    if (TEST_LOG) console.log(`[teste] eco chat=${chatId} telefone=${msg.phone || '?'} manual=${manual}`);
    if (manual && bot.autoPauseOnManualReply && bot.status === 'active' && !store.isPaused(chatId)) {
      store.pauseChat(chatId, '15m');
    }
    return;
  }

  if (!MESSAGE_TYPES.has(msg.type) || msg.isNew === false) return;
  if (msg.timestamp && Date.now() / 1000 - msg.timestamp > STALE_MESSAGE_SECONDS) return;

  if (TEST_LOG) console.log(`[teste] recebida chat=${chatId} telefone=${msg.phone || '?'} tipo=${msg.type}`);

  receiveQueue.push(async () => {
    const out = await engine.handle({
      chatId, phone: msg.phone, name: msg.name, type: msg.type, text: msg.text, location: msg.location,
    });
    if (TEST_LOG) console.log(`[teste] robô respondeu ${out.replies.length} mensagem(ns); efeitos=${out.effects.map((e) => e.type).join(',') || 'nenhum'}`);
    for (const effect of out.effects) {
      if (effect.type === 'order_created') {
        notify(`Novo pedido #${effect.order.number}`, `${effect.order.customer.name} · ${money(effect.order.total)}`, 'orders');
      } else if (effect.type === 'handoff') {
        notify('Cliente pediu atendente', `${effect.handoff.name}: ${effect.handoff.motive}`.slice(0, 120), 'handoffs');
      } else if (effect.type === 'ai_error') {
        lastAiError = AiResponder.describeError({ message: effect.message });
        console.error('[ia]', effect.message);
        win?.webContents.send('state:changed', 'ai');
      }
    }
    // A resposta ao pedido de atendente precisa sair mesmo com a conversa recém-pausada.
    const isHandoff = out.effects.some((effect) => effect.type === 'handoff');
    if (out.replies.length) await sendToChat(chatId, out.replies, { respectsPause: !isHandoff });
  }).catch((error) => console.error('[robô] falha ao processar mensagem:', error));
}

// ------------------------------------------------------------ pedido online

/** Traz para o painel um pedido feito na página e avisa o cliente no WhatsApp. */
async function importOnlineOrder(remote) {
  // O código do link aponta a conversa certa; sem ele, procura pelo telefone digitado.
  const chatId = online.chatIdForRef(remote.ref) || await chatIdFromPhone(remote.customer?.phone);
  const order = store.createOrder({
    customer: { chatId, name: remote.customer?.name, phone: remote.customer?.phone },
    items: remote.items,
    mode: remote.mode,
    address: remote.address,
    payment: remote.payment,
    changeFor: remote.changeFor,
    notes: remote.notes,
    source: 'online',
    onlineId: remote.id,
  });
  notify(`Novo pedido #${order.number} pelo site`, `${order.customer.name} · ${money(order.total)}`, 'orders');
  if (chatId && store.settings.bot.status !== 'inactive') {
    sendToChat(chatId, [
      `Recebemos seu pedido #${order.number} feito pelo site, no total de ${money(order.total)}. Vamos avisando cada etapa por aqui.`,
    ], { respectsPause: false });
  }
  return order;
}

// ------------------------------------------------------------------------ API

function publicState() {
  const { ai: aiSettings, online: onlineSettings, ...settings } = store.settings;
  const wa = whatsapp ? whatsapp.snapshot() : { state: 'loading', detail: '', me: null, activeChat: null };
  if (wa.activeChat) {
    wa.activeChat = { ...wa.activeChat, pausedUntil: store.pauseUntil(wa.activeChat.chatId) };
  }
  return {
    version: app.getVersion(),
    settings: {
      ...settings,
      ai: {
        enabled: aiSettings.enabled,
        provider: aiSettings.provider,
        hasKey: Boolean(aiSettings.apiKeyEncrypted),
        ollamaUrl: aiSettings.ollamaUrl,
        ollamaModel: aiSettings.ollamaModel,
        lastError: lastAiError,
      },
      online: {
        enabled: onlineSettings.enabled,
        apiUrl: onlineSettings.apiUrl || DEFAULT_ONLINE_API,
        slug: onlineSettings.slug,
        url: onlineSettings.url,
        connected: Boolean(online?.active() && online.lastOkAt && !online.lastError),
        lastError: online?.lastError || '',
      },
    },
    menu: store.menu,
    orders: store.orders,
    handoffs: store.handoffs,
    whatsapp: wa,
  };
}

const api = {
  'state:get': () => publicState(),

  'settings:update': (section, patch) => {
    if (!['store', 'bot', 'app'].includes(section)) throw new Error('Seção inválida.');
    store.updateSettings(section, patch);
    if (section === 'app' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: Boolean(patch.autoStart) });
  },
  'ai:configure': ({ enabled, apiKey, provider, ollamaUrl, ollamaModel }) => {
    if (apiKey !== undefined) writeApiKey(apiKey);
    const patch = {};
    if (enabled !== undefined) patch.enabled = Boolean(enabled);
    if (provider !== undefined) {
      if (!['anthropic', 'ollama'].includes(provider)) throw new Error('Provedor de IA inválido.');
      patch.provider = provider;
    }
    if (ollamaUrl !== undefined) {
      const url = String(ollamaUrl).trim();
      if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error('Endereço do Ollama inválido.');
      patch.ollamaUrl = url;
    }
    if (ollamaModel !== undefined) {
      const model = String(ollamaModel).trim();
      if (!model) throw new Error('Informe o modelo do Ollama.');
      patch.ollamaModel = model;
    }
    if (Object.keys(patch).length) store.updateSettings('ai', patch);
    lastAiError = '';
  },
  'ai:models': async () => {
    try {
      return await ai.ollamaModels();
    } catch {
      return [];
    }
  },
  'ai:test': async () => {
    const usingOllama = ai.provider === 'ollama';
    if (!usingOllama && !readApiKey()) throw new Error('Informe a chave de API antes de testar.');
    try {
      await ai.test();
      lastAiError = '';
      return usingOllama ? 'Ollama respondeu. A atendente virtual está pronta.' : 'Chave válida. A IA está pronta.';
    } catch (error) {
      throw new Error(AiResponder.describeError(error));
    }
  },

  'menu:saveCategory': (category) => store.saveCategory(category),
  'menu:deleteCategory': (id) => store.deleteCategory(id),
  'menu:saveItem': (categoryId, item) => store.saveItem(categoryId, item),
  'menu:deleteItem': (categoryId, itemId) => store.deleteItem(categoryId, itemId),

  'orders:create': async (input) => {
    const chatId = input.customer?.chatId || await chatIdFromPhone(input.customer?.phone);
    return store.createOrder({ ...input, customer: { ...input.customer, chatId }, source: 'manual' });
  },
  'orders:setStatus': async (id, status) => {
    const order = store.setOrderStatus(id, status);
    const text = statusNotification(order, store.settings.store.name);
    // Avisos de pedido saem em "ativo" e "só avisos", mesmo com a conversa pausada.
    if (text && order.customer.chatId && store.settings.bot.status !== 'inactive') {
      sendToChat(order.customer.chatId, [text], { respectsPause: false });
    }
    online?.pushStatus(order);
    return order;
  },
  'orders:print': (id) => printOrder(id),

  'online:activate': async ({ apiUrl, slug }) => {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    const data = await online.register(apiUrl || DEFAULT_ONLINE_API, cleanSlug);
    store.updateSettings('online', {
      enabled: true, slug: data.slug, url: data.url, tokenEncrypted: encryptSecret(data.token),
    });
    online.start();
    return data.url;
  },
  'online:openPage': () => {
    const { url } = store.settings.online;
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  },
  'online:setEnabled': (enabled) => {
    if (enabled && !readOnlineToken()) throw new Error('Ative o pedido online primeiro.');
    store.updateSettings('online', { enabled: Boolean(enabled) });
    if (enabled) online.start(); else online.stop();
  },

  'handoffs:open': async (id) => {
    const handoff = store.handoffs.find((h) => h.id === id);
    if (!handoff) throw new Error('Chamado não encontrado.');
    if (!whatsapp?.ready) throw new Error('O WhatsApp não está conectado.');
    store.pauseChat(handoff.chatId, '24h');
    await whatsapp.call('openChat', handoff.chatId);
    const greeting = store.settings.bot.handoffMessage.trim();
    if (greeting) sendToChat(handoff.chatId, [greeting], { respectsPause: false });
    store.resolveHandoff(id);
  },
  'handoffs:resolve': (id) => store.resolveHandoff(id),

  'wa:layout': (bounds) => whatsapp?.layout(bounds),
  'wa:reload': () => whatsapp?.reload(),
  'wa:pause': (chatId, duration) => store.pauseChat(chatId, duration),
  'wa:resume': (chatId) => { store.resumeChat(chatId); store.resolveHandoffsOf(chatId); },
  'wa:sendMenu': async (chatId) => {
    if (!whatsapp?.ready) throw new Error('O WhatsApp não está conectado.');
    const result = await sendToChat(chatId, [menuText(store.numberedItems())], { respectsPause: false });
    if (result.failed) throw new Error(`Não foi possível enviar: ${result.error}`);
  },
  'wa:openChat': async (phoneOrChatId) => {
    if (!whatsapp?.ready) throw new Error('O WhatsApp não está conectado.');
    const chatId = String(phoneOrChatId).includes('@') ? phoneOrChatId : await chatIdFromPhone(phoneOrChatId);
    if (!chatId) throw new Error('Telefone inválido ou sem WhatsApp.');
    await whatsapp.call('openChat', chatId);
  },
  'wa:archiveOld': async () => {
    if (!whatsapp?.ready) throw new Error('O WhatsApp não está conectado.');
    return whatsapp.call('archiveOld', Number(store.settings.bot.archiveDays) || 60);
  },
};

function registerApi() {
  ipcMain.handle('api', async (event, request) => {
    if (!win || event.sender !== win.webContents) throw new Error('Origem não autorizada.');
    const handler = api[request?.method];
    if (!handler) throw new Error(`Método desconhecido: ${request?.method}`);
    return handler(...(Array.isArray(request.args) ? request.args : []));
  });
}

// ------------------------------------------------------------------ impressão

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function receiptHtml(order) {
  const s = store.settings.store;
  const lines = order.items.map((line) => `
    <tr><td>${line.qty}x ${escapeHtml(line.name)}${line.notes ? `<br><small>${escapeHtml(line.notes)}</small>` : ''}</td>
    <td class="r">${money(line.qty * line.price)}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Pedido ${order.number}</title>
  <style>
    body{font:13px/1.4 Consolas,monospace;width:72mm;margin:0;padding:4mm;color:#000}
    h1{font-size:16px;margin:0 0 2mm} table{width:100%;border-collapse:collapse}
    td{padding:1mm 0;vertical-align:top} .r{text-align:right;white-space:nowrap}
    hr{border:0;border-top:1px dashed #000;margin:2mm 0} small{font-size:11px}
  </style>
  <h1>${escapeHtml(s.name)}</h1>
  <div>Pedido #${order.number} · ${new Date(order.createdAt).toLocaleString('pt-BR')}</div><hr>
  <div>${escapeHtml(order.customer.name)} · ${escapeHtml(order.customer.phone)}</div>
  <div>${order.mode === 'delivery' ? `Entrega: ${escapeHtml(order.address)}` : 'Retirada na loja'}</div><hr>
  <table>${lines}</table><hr>
  <table>
    <tr><td>Subtotal</td><td class="r">${money(order.subtotal)}</td></tr>
    ${order.fee ? `<tr><td>Entrega</td><td class="r">${money(order.fee)}</td></tr>` : ''}
    <tr><td><b>Total</b></td><td class="r"><b>${money(order.total)}</b></td></tr>
  </table>
  <div>Pagamento: ${escapeHtml(order.payment)}${order.changeFor ? ` (troco para ${money(order.changeFor)})` : ''}</div>
  ${order.notes ? `<hr><div>Obs.: ${escapeHtml(order.notes)}</div>` : ''}`;
}

function printOrder(id) {
  const order = store.orders.find((o) => o.id === id);
  if (!order) throw new Error('Pedido não encontrado.');
  const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml(order))}`);
  printer.webContents.once('did-finish-load', () => {
    printer.webContents.print({ silent: false, printBackground: false }, () => printer.destroy());
  });
}

// --------------------------------------------------------------------- janela

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'Figrano',
    icon: nativeImage.createFromBuffer(iconPng(256)),
    backgroundColor: '#F6F4F0',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: TOP_BAR_COLOR, symbolColor: '#1F1D1A', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'shell.preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!SMOKE) { win.maximize(); win.show(); } });

  // Fechar esconde na bandeja: o robô continua respondendo.
  win.on('close', (event) => {
    if (quitting || SMOKE) return;
    event.preventDefault();
    win.hide();
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromBuffer(iconPng(32)));
  tray.setToolTip('Figrano');
  refreshTrayMenu();
  tray.on('click', showWindow);
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir o Figrano', click: showWindow },
    ...(updateReady ? [{
      label: `Reiniciar e atualizar para a versão ${updateReady}`,
      click: () => { quitting = true; store?.flush(); updater.install(); },
    }] : []),
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
}

function startAutoUpdate() {
  if (!app.isPackaged) return;
  updater = startUpdater({
    onReady: (version) => {
      updateReady = version;
      refreshTrayMenu();
      notify('Atualização pronta', `A versão ${version} será instalada quando o Figrano for fechado.`);
    },
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Dados de exemplo usados só no teste de fumaça, em pasta temporária. */
function seedDemoData() {
  store.updateSettings('store', { name: 'Cantina Exemplo', address: 'Rua das Laranjeiras, 80', deliveryFee: 6 });
  const pizzas = store.saveCategory({ name: 'Pizzas' });
  const calabresa = store.saveItem(pizzas.id, { name: 'Calabresa', description: 'Calabresa, cebola e azeitona', price: 42 });
  store.saveItem(pizzas.id, { name: 'Quatro queijos', price: 48, available: false });
  const drinks = store.saveCategory({ name: 'Bebidas' });
  const soda = store.saveItem(drinks.id, { name: 'Refrigerante 2 L', price: 12 });
  const first = store.createOrder({
    customer: { chatId: '5511988887777@c.us', name: 'Marina Lopes', phone: '5511988887777' },
    items: [{ ...calabresa, qty: 2, notes: 'sem cebola' }, { ...soda, qty: 1 }],
    mode: 'delivery', address: 'Av. Central, 1200, ap. 34', payment: 'Dinheiro', changeFor: 150,
  });
  const second = store.createOrder({
    customer: { name: 'Balcão', phone: '' }, items: [{ ...calabresa, qty: 1 }], mode: 'pickup', payment: 'Pix', source: 'manual',
  });
  store.setOrderStatus(second.id, 'preparing');
  store.addHandoff({ chatId: '5511977776666@c.us', name: 'Paulo Reis', motive: 'Pedido chegou sem a bebida', priority: 'high', mood: 'frustrated' });
  return first;
}

/** Abre cada seção com dados de exemplo, salva uma captura de tela e confere erros de script. */
async function smokeTest() {
  try {
    seedDemoData();
    win.setSize(1280, 800);
    win.showInactive();
    await wait(1200);
    let ok = true;
    for (const target of ['orders', 'menu', 'handoffs', 'settings']) {
      win.webContents.send('navigate', target);
      await wait(500);
      const file = path.join(process.cwd(), `smoke-${target}.png`);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    }
    win.webContents.send('navigate', 'orders');
    await wait(300);
    const report = await win.webContents.executeJavaScript('window.__smoke()');
    ok = Boolean(report && report.ok);
    console.log(`SMOKE ${JSON.stringify(report)}`);
    app.exit(ok ? 0 : 1);
  } catch (error) {
    console.error('SMOKE falhou:', error);
    app.exit(1);
  }
}

/**
 * Sonda do WhatsApp: abre o WhatsApp Web de verdade em um perfil temporário,
 * injeta a biblioteca e informa o estado alcançado. Não faz login.
 */
async function probeWhatsapp() {
  const started = Date.now();
  whatsapp.on('state', (state) => console.log(`PROBE estado=${state} ${whatsapp.detail || ''} (${Date.now() - started} ms)`));
  win.setSize(1280, 800);
  win.showInactive();
  await wait(800);
  win.webContents.send('navigate', 'whatsapp');
  whatsapp.create();
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && (whatsapp.state === 'loading' || whatsapp.state === 'syncing')) await wait(500);
  await wait(2500);
  let page = null;
  try {
    page = await whatsapp.view.webContents.executeJavaScript(
      '({ wpp: typeof WPP, version: typeof WPP === "object" ? WPP.version : null, ready: typeof WPP === "object" ? WPP.isFullReady : null, bridge: typeof window.__figrano, state: window.__figrano ? window.__figrano.state() : null, title: document.title })',
    );
  } catch (error) {
    page = { error: error.message };
  }
  fs.writeFileSync(path.join(process.cwd(), 'probe.png'), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(process.cwd(), 'probe-wa.png'), (await whatsapp.view.webContents.capturePage()).toPNG());
  console.log(`PROBE final=${whatsapp.state} pagina=${JSON.stringify(page)} limites=${JSON.stringify(whatsapp.bounds)}`);
  app.exit(whatsapp.state === 'qr' || whatsapp.state === 'ready' ? 0 : 1);
}

let sendTestDone = false;

/** Envia uma mensagem de teste pelo caminho real (fila com "digitando"). */
async function runSendTest(phone) {
  if (sendTestDone) return;
  sendTestDone = true;
  const me = whatsapp.me;
  console.log(`[teste] conectado como ${me?.chatId || '?'}`);
  const chatId = await chatIdFromPhone(phone);
  console.log(`[teste] ${phone} -> ${chatId || 'sem WhatsApp'}`);
  if (!chatId) return;
  const phoneBack = await whatsapp.call('phoneOf', chatId).catch(() => '');
  console.log(`[teste] telefone de volta: ${phoneBack || '?'}`);
  const result = await sendToChat(chatId, [
    `Teste do Figrano: envio automático (${new Date().toLocaleString('pt-BR')}). Responda "oi" para testar o robô.`,
  ], { respectsPause: false });
  console.log(`[teste] envio ${JSON.stringify(result)}`);
}

// ------------------------------------------------------------------ arranque

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    app.setAppUserModelId('br.figrano.app');
    Menu.setApplicationMenu(null);

    store = new Store(path.join(app.getPath('userData'), 'figrano-dados.json'));
    ai = new AiResponder({ store, getApiKey: readApiKey });
    online = new OnlineSync({
      store,
      getToken: readOnlineToken,
      importOrder: importOnlineOrder,
      getWhatsapp: () => whatsapp?.me?.phone || '',
    });
    engine = new BotEngine({ store, ai, onlineLink: (chatId) => online.linkFor(chatId) });

    registerApi();
    createWindow();

    whatsapp = new WhatsApp(win);
    sendQueue = new SendQueue({
      transport: {
        typing: (chatId, ms) => whatsapp.call('typing', chatId, ms),
        send: (chatId, text) => whatsapp.call('sendText', chatId, text),
      },
      isPaused: (chatId) => store.isPaused(chatId),
    });

    const push = (topic) => { if (win && !win.isDestroyed()) win.webContents.send('state:changed', topic); };
    store.onChange(push);
    // Cardápio e dados da loja vão para a página sempre que mudam.
    store.onChange((topic) => { if (topic === 'menu' || topic === 'settings') online.scheduleSync(); });
    whatsapp.on('state', (state) => {
      push('whatsapp');
      if (TEST_LOG) console.log(`[teste] whatsapp=${state} ${whatsapp.detail || ''}`);
      if (state === 'ready' && SEND_TEST) runSendTest(SEND_TEST);
      if (state === 'ready') online.scheduleSync(); // envia o número do WhatsApp da loja
      if (state === 'ready' && store.settings.bot.autoArchive) {
        whatsapp.call('archiveOld', Number(store.settings.bot.archiveDays) || 60).catch(() => {});
      }
    });
    whatsapp.on('active_chat', () => push('whatsapp'));
    whatsapp.on('message', onWhatsappMessage);

    if (PROBE) {
      win.webContents.once('did-finish-load', probeWhatsapp);
    } else if (SMOKE) {
      win.webContents.once('did-finish-load', smokeTest);
    } else {
      whatsapp.create();
      createTray();
      startAutoUpdate();
      online.start();
    }
  });

  app.on('before-quit', () => { quitting = true; online?.stop(); store?.flush(); });
  app.on('window-all-closed', () => { if (SMOKE) app.quit(); });
}
