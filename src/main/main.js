'use strict';

const {
  app, BrowserWindow, ipcMain, Menu, Tray, Notification, nativeImage, safeStorage, shell, protocol,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { Store } = require('./store');
const { BotEngine } = require('./robo/engine');
const { AiResponder } = require('./ia/ai');
const { menuText, money } = require('./robo/format');
const { statusAviso, reviewRequest } = require('./robo/avisos');
const { SerialQueue, SendQueue } = require('./queues');
const { WhatsApp } = require('./whatsapp');
const { iconPng } = require('./icon');
const { startUpdater } = require('./updater');
const { Platform } = require('./platform');
const { ImageStore } = require('./images');
const { transcribeAudio, fixAudioText, buildAudioHint } = require('./transcricao');

const PROBE = process.argv.includes('--probe');
// Os dois modos de teste usam uma pasta de dados temporária e não tocam nos dados reais.
const SMOKE = process.argv.includes('--smoke') || PROBE;
// --send-test=<telefone>: roda o app normal com os dados reais e, ao conectar,
// envia uma mensagem de teste ao número e registra no console o que chegar.
const SEND_TEST = (process.argv.find((arg) => arg.startsWith('--send-test=')) || '').slice('--send-test='.length);
// --test-log: só registra no console o que chega, sem enviar nada.
const TEST_LOG = Boolean(SEND_TEST) || process.argv.includes('--test-log');
const TOP_BAR_COLOR = '#FFFFFF';
const TOP_BAR_HEIGHT = 56;
const MESSAGE_TYPES = new Set(['chat', 'image', 'ptt', 'audio', 'location']);
const STALE_MESSAGE_SECONDS = 120; // ignora histórico que o WhatsApp sincroniza ao conectar
const MENU_RESEND_MS = 30e3; // "Enviar cardápio" de novo para a mesma conversa só depois de 30 s
const menuSentAt = new Map();

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
let platform = null;
let botStore = null;
let images = null;

// Fotos do cardápio aparecem no painel por figrano-img://<hash>.
protocol.registerSchemesAsPrivileged([
  { scheme: 'figrano-img', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  // Painel embutido no instalador: app://panel/index.html (origem própria, liberada no CORS da API)
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

/** Pasta do painel embutido: no instalador fica em resources/panel; no código, em Figrano/panel. */
function panelDir() {
  const packaged = path.join(process.resourcesPath || '', 'panel');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  const local = path.join(__dirname, '..', '..', 'panel');
  return fs.existsSync(path.join(local, 'index.html')) ? local : null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2',
};
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
const readPlatformToken = () => decryptSecret(store.settings.platform.tokenEncrypted);
const writePlatformToken = (token) => store.updateSettings('platform', { tokenEncrypted: encryptSecret(token) });

/**
 * O robô continua falando com um "store", mas cardápio, regras da loja e pedidos vêm da
 * API do Sabores. Conversas, pausas e chamados continuam locais (são do WhatsApp deste PC).
 */
function connectedStore(local, plat) {
  return new Proxy(local, {
    get(target, prop) {
      if (prop === 'settings') return { ...target.settings, store: plat.storeSettings(target.settings.store) };
      if (prop === 'numberedItems') return () => plat.numberedItems();
      if (prop === 'createOrder') return (input) => plat.createOrder(input);
      if (prop === 'lastOrderOf') return (chatId, phone) => plat.lastOrderOf(chatId, phone);
      if (prop === 'orders') return plat.localOrders();
      if (prop === 'menu') return { categories: plat.menu?.categories || [] };
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// ----------------------------------------------------------------- utilidades

/** Som no painel: 'pedido' (chegou pedido) ou 'sil' (cliente chamou a Sil). Desliga em Ajustes → Robô. */
function alertSound(kind) {
  if (store?.settings.bot.soundAlerts === false) return;
  win?.webContents.send('alert', kind);
}

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

  if (TEST_LOG) console.log(`[teste] recebida chat=${chatId} telefone=${msg.phone || '?'} tipo=${msg.type} texto=${JSON.stringify(msg.text || '')}`);

  // Falou do comprovante mas mandou só texto (ex.: a mensagem pronta do site): pede a imagem
  if (msg.type === 'chat' && platform && /comprovante|paguei|pix (feito|pago|enviado)|ja fiz o pix|fiz o pix/i.test(msg.text || '')
    && !store.isPaused(chatId)) {
    const pending = platform.pendingPixOrderFor(chatId, msg.phone);
    if (pending) {
      sendToChat(chatId, [
        `Pode mandar aqui a foto ou o print do comprovante do Pix do pedido #${pending.number} (${money(pending.total)}) que a Sil confere e já libera.`,
      ], { respectsPause: false }).catch(() => {});
      return;
    }
  }

  // Imagem de quem tem pedido Pix pendente = comprovante. Avisa a Sil; quem confere é ela.
  if (msg.type === 'image' && platform) {
    const pending = platform.pendingPixOrderFor(chatId, msg.phone);
    if (pending) {
      receiveQueue.push(async () => {
        try {
          await platform.reportPixProof(pending.id);
          alertSound('sil'); // comprovante para conferir
          notify(`Comprovante do Pix: pedido #${pending.number}`, `${pending.customer.name} · ${money(pending.total)}. Confira e libere no painel.`, 'orders');
          await sendToChat(chatId, [
            `Recebemos o comprovante do pedido #${pending.number}. A Sil vai conferir e já confirma por aqui.`,
          ], { respectsPause: false });
        } catch (error) {
          console.error('[sabores] comprovante não registrado:', error?.message || error);
        }
      }).catch(() => {});
      return;
    }
  }

  // Mensagem de voz: transcreve no próprio PC (serviço local) e o robô trata como texto.
  // Sem o serviço, segue como áudio e o robô pede para escrever.
  if (msg.type === 'ptt' || msg.type === 'audio') {
    receiveQueue.push(async () => {
      let heard = null;
      try {
        const media = await whatsapp.call('audioBase64', msg.id);
        const names = platform ? platform.numberedItems().map((i) => i.name) : [];
        const hint = buildAudioHint({
          streets: store.settings.bot.knownStreets,
          addresses: store.recentAddresses(),
          neighborhoods: (platform?.storeSettings(store.settings.store).neighborhoods || []).map((n) => n.name),
          items: names,
        });
        if (TEST_LOG && media?.base64) saveTestAudio(msg.id, media.base64);
        heard = await transcribeAudio({ base64: media?.base64, url: store.settings.platform.transcribeUrl, hint });
        if (heard) heard.text = fixAudioText(heard.text, names);
        if (TEST_LOG) console.log(`[teste] áudio transcrito em ${heard?.seconds ?? '-'}s: ${heard?.text ?? '(nada)'}`);
      } catch (error) {
        console.error('[áudio] não transcrito:', error?.message || error);
      }
      await respond(chatId, { ...msg, type: heard ? 'chat' : 'ptt', text: heard?.text || '', fromAudio: Boolean(heard) });
    }).catch((error) => console.error('[robô] falha ao processar áudio:', error));
    return;
  }

  receiveQueue.push(() => respond(chatId, msg)).catch((error) => console.error('[robô] falha ao processar mensagem:', error));
}

/** Modo de teste: guarda o áudio recebido para comparar modelos de transcrição com voz real. */
function saveTestAudio(id, base64) {
  try {
    const dir = path.join(app.getPath('userData'), 'audios-teste');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${String(id).replace(/[^a-z0-9]/gi, '').slice(-12)}.ogg`);
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    console.log(`[teste] áudio guardado em ${file}`);
  } catch (error) {
    console.error('[áudio] não guardei o teste:', error?.message || error);
  }
}

/** Passa a mensagem ao robô, trata os efeitos (avisos para a Sil) e envia as respostas. */
async function respond(chatId, msg) {
  const out = await engine.handle({
    chatId, phone: msg.phone, name: msg.name, type: msg.type, text: msg.text, location: msg.location, fromAudio: msg.fromAudio,
  });
  if (TEST_LOG) console.log(`[teste] robô respondeu ${out.replies.length} mensagem(ns); efeitos=${out.effects.map((e) => e.type).join(',') || 'nenhum'}`);
  if (TEST_LOG) out.replies.forEach((reply, i) => console.log(`[teste] resposta ${i + 1}: ${JSON.stringify(reply)}`));
  for (const effect of out.effects) {
    if (effect.type === 'order_created') {
      alertSound('pedido');
      if (effect.order.address) store.rememberAddress(effect.order.address);
      notify(`Novo pedido #${effect.order.number}`, `${effect.order.customer.name} · ${money(effect.order.total)}`, 'orders');
    } else if (effect.type === 'handoff') {
      alertSound('sil');
      notify('Cliente pediu atendente', `${effect.handoff.name}: ${effect.handoff.motive}`.slice(0, 120), 'handoffs');
    } else if (effect.type === 'order_failed') {
      console.error('[sabores] pedido do robô não gravou:', effect.message);
      notify('Pedido do WhatsApp não foi gravado', `${effect.message}`.slice(0, 120), 'whatsapp');
    } else if (effect.type === 'review') {
      if (effect.rating <= 3) alertSound('sil');
      notify(`Avaliação ${effect.rating}/5 do pedido #${effect.number}`, effect.comment || (effect.rating <= 3 ? 'Nota baixa: veja em Atender.' : 'Cliente avaliou o pedido.'), effect.rating <= 3 ? 'handoffs' : 'orders');
    } else if (effect.type === 'question_for_sil') {
      alertSound('sil');
      // Fica na fila de "Atender" do painel (a notificação do Windows é só um extra:
      // não aparece com o app em desenvolvimento e some se ninguém estiver olhando)
      store.addHandoff({
        chatId, name: msg.name || effect.name, phone: msg.phone,
        motive: `Pergunta para você: "${effect.text}"`, priority: 'medium',
      });
      notify(`Pergunta para você: ${effect.name || 'cliente'}`, effect.text, 'handoffs');
    } else if (effect.type === 'festa_lead') {
      if (effect.first) alertSound('sil');
      store.addHandoff({
        chatId, name: msg.name || effect.name, phone: msg.phone,
        motive: effect.first ? `Cliente de festa: "${effect.text}"` : `Festa (mais detalhes): "${effect.text}"`,
        priority: 'medium',
        area: 'buffet', // festa vai para o módulo Buffet, não mistura com o delivery
      });
      notify(
        effect.first ? `Cliente de festa: ${effect.name || 'novo contato'}` : `Festa: ${effect.name || 'cliente'} mandou mais detalhes`,
        effect.text,
        'buffet',
      );
    } else if (effect.type === 'livia_error') {
      console.error('[lívia]', effect.message);
    } else if (effect.type === 'ai_error') {
      lastAiError = AiResponder.describeError({ message: effect.message });
      console.error('[ia]', effect.message);
      win?.webContents.send('state:changed', 'ai');
    }
  }
  // A resposta ao pedido de atendente precisa sair mesmo com a conversa recém-pausada.
  const isHandoff = out.effects.some((effect) => effect.type === 'handoff');
  if (out.replies.length) await sendToChat(chatId, out.replies, { respectsPause: !isHandoff });
}

// ------------------------------------------------------ pedidos (API do Sabores)

/** Conversa do cliente: pelo código do link (site/robô) ou pelo telefone do pedido. */
async function chatOf(order) {
  return order.customer.chatId || await chatIdFromPhone(order.customer.phone);
}

/**
 * Eventos da plataforma: pedido novo (site ou balcão) e mudança de status feita no painel.
 * O cliente é avisado no WhatsApp; a Sil, por notificação do Windows.
 */
async function onPlatformEvent(event) {
  const push = (topic) => { if (win && !win.isDestroyed()) win.webContents.send('state:changed', topic); };
  if (event.type === 'orders' || event.type === 'menu' || event.type === 'session' || event.type === 'connection') {
    push(event.type);
    return;
  }
  const order = event.order;
  if (!order) return;
  const canMessage = store.settings.bot.status !== 'inactive';

  if (event.type === 'order_new' && order.status === 'awaiting_pix') {
    alertSound('pedido');
    // Pix pelo site: sem comprovante, o pedido não vai para a cozinha
    notify(`Pedido #${order.number} esperando o comprovante do Pix`, `${order.customer.name} · ${money(order.total)}`, 'orders');
    if (canMessage) {
      const chatId = await chatOf(order);
      if (chatId) {
        sendToChat(chatId, [
          `Recebemos seu pedido #${order.number} pelo site (${money(order.total)}). Para confirmar, mande aqui o comprovante do Pix. Sem ele, o pedido não vai para a cozinha.`,
        ], { respectsPause: false });
      }
    }
    push('orders');
    return;
  }

  if (event.type === 'order_new') {
    alertSound('pedido');
    const origin = order.source === 'online' ? 'pelo site' : order.source === 'manual' ? 'no balcão' : 'pelo WhatsApp';
    notify(`Novo pedido #${order.number} ${origin}`, `${order.customer.name} · ${money(order.total)}`, 'orders');
    if (order.source === 'online' && canMessage) {
      const chatId = await chatOf(order);
      if (chatId) {
        sendToChat(chatId, [
          `Recebemos seu pedido #${order.number} feito pelo site, no total de ${money(order.total)}. Vamos avisando cada etapa por aqui.`,
        ], { respectsPause: false });
      }
    }
    push('orders');
    return;
  }

  if (event.type === 'order_status') {
    const link = platform.trackingLinkFor(order);
    const text = event.previous === 'AWAITING_PIX' && order.status === 'new'
      ? `Comprovante conferido! Seu pedido #${order.number} está confirmado.${link ? `\n\nAcompanhe aqui: ${link}` : ''}`
      : statusAviso(order, { storeName: platform.storeSettings(store.settings.store).name, link });
    if (text && canMessage) {
      const chatId = await chatOf(order);
      // Avisos de pedido saem em "ativo" e "só avisos", mesmo com a conversa pausada.
      if (chatId) {
        const texts = [text];
        // Avaliação (opcional): só depois da entrega
        if (order.status === 'done' && store.settings.bot.askReview) {
          texts.push(reviewRequest(order));
          store.setPendingReview(chatId, { orderId: order.id, number: order.number });
        }
        sendToChat(chatId, texts, { respectsPause: false });
      }
    }
    push('orders');
  }
}

// ------------------------------------------------------------------------ API

function publicState() {
  const { ai: aiSettings, online: _legacyOnline, platform: platformSettings, ...settings } = store.settings;
  const wa = whatsapp ? whatsapp.snapshot() : { state: 'loading', detail: '', me: null, activeChat: null };
  if (wa.activeChat) {
    wa.activeChat = { ...wa.activeChat, pausedUntil: store.pauseUntil(wa.activeChat.chatId) };
  }
  // Conversas em silêncio (pausadas): nome do chamado ou da conversa do robô
  const pausedChats = store.activePauses().map(({ chatId, until }) => {
    const handoff = store.handoffs.find((h) => h.chatId === chatId);
    const session = engine?.sessions?.get(chatId);
    const name = handoff?.name || session?.name || '';
    const phone = handoff?.phone || session?.phone || (chatId.endsWith('@c.us') ? chatId.split('@')[0] : '');
    return { chatId, name, phone, until };
  });
  return {
    pausedChats,
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
      platform: {
        apiUrl: platformSettings.apiUrl,
        siteUrl: platformSettings.siteUrl,
        buffetUrl: platformSettings.buffetUrl,
      },
    },
    platform: {
      connected: Boolean(platform?.connected()),
      user: platform?.user ? { name: platform.user.name, role: platform.user.role } : null,
      lastError: platform?.lastError || '',
    },
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

  // Login: o mesmo do painel (o painel faz login e passa o token para o app)
  'session:adopt': (token) => platform.adoptSession(String(token || '')),
  'session:logout': () => platform.logout(),
  'platform:configure': ({ apiUrl, siteUrl, buffetUrl }) => {
    const clean = (value, label) => {
      const url = String(value || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error(`Endereço inválido: ${label}.`);
      return url;
    };
    store.updateSettings('platform', {
      apiUrl: clean(apiUrl, 'servidor'), siteUrl: clean(siteUrl, 'site de delivery'), buffetUrl: clean(buffetUrl, 'site do buffet'),
    });
    platform.start();
  },
  // Comanda do pedido (o painel manda o pedido como veio da API)
  'orders:print': (apiOrder) => printOrder(platform.toLocal(apiOrder)),

  'handoffs:open': async (id) => {
    const handoff = store.handoffs.find((h) => h.id === id);
    if (!handoff) throw new Error('Chamado não encontrado.');
    if (!whatsapp?.ready) throw new Error('O WhatsApp não está conectado.');
    // Buffet: o robô já ficou quieto por 24 h quando a festa chegou; atender não encurta isso
    store.pauseChat(handoff.chatId, handoff.area === 'buffet' ? '24h' : '2h');
    await whatsapp.call('openChat', handoff.chatId);
    const greeting = store.settings.bot.handoffMessage.trim();
    if (greeting) sendToChat(handoff.chatId, [greeting], { respectsPause: false });
    store.resolveHandoff(id);
  },
  'handoffs:resolve': (id) => store.resolveHandoff(id),

  'wa:layout': (bounds) => whatsapp?.layout(bounds),
  'wa:reload': () => whatsapp?.reload(),
  'wa:pause': (chatId, duration) => store.pauseChat(chatId, duration),
  'wa:resume': (chatId) => { store.resumeChat(chatId); store.resolveHandoffsOf(chatId); engine?.forgetTopic(chatId); },
  'wa:sendMenu': async (chatId) => {
    if (!whatsapp?.ready) throw new Error('O WhatsApp não está conectado.');
    // Vários cliques seguidos não mandam o cardápio repetido para o cliente
    const last = menuSentAt.get(chatId) || 0;
    if (Date.now() - last < MENU_RESEND_MS) return 'duplicado';
    menuSentAt.set(chatId, Date.now());
    const link = platform.linkFor(chatId);
    const text = link
      ? `Veja o cardápio e faça seu pedido por aqui:\n${link}\n\nSe preferir, pode pedir por esta conversa mesmo.`
      : menuText(botStore.numberedItems());
    const result = await sendToChat(chatId, [text], { respectsPause: false });
    if (result.failed) {
      menuSentAt.delete(chatId); // falhou: pode tentar de novo na hora
      throw new Error(`Não foi possível enviar: ${result.error}`);
    }
    return 'enviado';
  },
  /** Abre a conversa. `{ pause: '24h' }` deixa o robô quieto nela (chamado de buffet do site). */
  'wa:openChat': async (phoneOrChatId, options) => {
    if (!whatsapp?.ready) throw new Error('O WhatsApp não está conectado.');
    const chatId = String(phoneOrChatId).includes('@') ? phoneOrChatId : await chatIdFromPhone(phoneOrChatId);
    if (!chatId) throw new Error('Telefone inválido ou sem WhatsApp.');
    if (options?.pause) store.pauseChat(chatId, options.pause);
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
  const s = platform.storeSettings(store.settings.store);
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

function printOrder(order) {
  if (!order) throw new Error('Pedido não encontrado.');
  const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml(order))}`);
  printer.webContents.once('did-finish-load', () => {
    printer.webContents.print({ silent: false, printBackground: false }, () => printer.destroy());
  });
}

// --------------------------------------------------------------------- janela

/**
 * O painel é o do Sabores da Sil (apps/desktop). Instalado, vem junto do app (pasta panel);
 * em desenvolvimento, abre o servidor do Vite (FIGRANO_PANEL_URL ou Ajustes).
 */
function loadPanel() {
  // Instalado (ou com o painel compilado em Figrano/panel): painel embutido
  if (panelDir() && !process.env.FIGRANO_PANEL_URL) {
    win.loadURL('app://panel/index.html');
    return;
  }
  const url = process.env.FIGRANO_PANEL_URL || store.settings.platform.panelUrl;
  win.loadURL(url).catch(() => {
    const html = `<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;background:#FFF8EC;color:#2B1608;padding:64px">
      <h1 style="font-size:24px">O painel não abriu</h1>
      <p>Não encontrei o painel em <b>${escapeHtml(url)}</b>. Em desenvolvimento, rode <code>pnpm --filter @sabores/desktop dev</code> e reabra o app.</p>`;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'Sabores da Sil',
    icon: nativeImage.createFromBuffer(iconPng(256)),
    backgroundColor: '#FFF8EC',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: TOP_BAR_COLOR, symbolColor: '#2B1608', height: TOP_BAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'shell.preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // PDF da nota fiscal gerado pelo próprio painel: abre numa janela do app
    if (url.startsWith('blob:')) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, title: 'Nota fiscal', webPreferences: { sandbox: true } } };
    }
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  loadPanel();
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

/** Teste de fumaça: abre o painel, salva uma captura e confere se a página carregou. */
async function smokeTest() {
  try {
    win.setSize(1280, 800);
    win.showInactive();
    await wait(2500);
    fs.writeFileSync(path.join(process.cwd(), 'smoke-painel.png'), (await win.webContents.capturePage()).toPNG());
    const title = await win.webContents.executeJavaScript('document.title');
    console.log(`SMOKE painel="${title}"`);
    app.exit(title ? 0 : 1);
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

  // Alertas sonoros do painel tocam sem esperar um clique (política de autoplay)
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.whenReady().then(() => {
    app.setAppUserModelId('br.figrano.app');
    Menu.setApplicationMenu(null);

    store = new Store(path.join(app.getPath('userData'), 'figrano-dados.json'));
    images = new ImageStore(path.join(app.getPath('userData'), 'fotos'), nativeImage);
    protocol.handle('app', (request) => {
      const dir = panelDir();
      const { host, pathname } = new URL(request.url);
      if (!dir || host !== 'panel') return new Response('', { status: 404 });
      // Só arquivos dentro da pasta do painel
      const file = path.normalize(path.join(dir, decodeURIComponent(pathname)));
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('', { status: 404 });
      return new Response(fs.readFileSync(file), { headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    });
    protocol.handle('figrano-img', (request) => {
      const bytes = images.read(new URL(request.url).hostname);
      return bytes
        ? new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000, immutable' } })
        : new Response('', { status: 404 });
    });
    platform = new Platform({
      store,
      getToken: readPlatformToken,
      saveToken: writePlatformToken,
      onEvent: (event) => { onPlatformEvent(event).catch((error) => console.error('[sabores] aviso falhou:', error)); },
    });
    botStore = connectedStore(store, platform);
    ai = new AiResponder({ store: botStore, getApiKey: readApiKey });
    // WhatsApp só com o ROBÔ (decisão de 18/11/2026): sem IA no delivery e sem Lívia por aqui.
    // A Lívia atende só no site do buffet; festa no WhatsApp recebe o link do orçamento e a Sil é avisada.
    // Para religar no futuro: passe `ai` e `livia: (input) => platform.askLivia(input)` de novo.
    engine = new BotEngine({
      store: botStore,
      ai: null,
      livia: null,
      buffetLink: () => platform.buffetQuoteLink(),
      onlineLink: (chatId) => platform.linkFor(chatId),
      trackingLink: (order) => platform.trackingLinkFor(order),
      onReview: (orderId, rating, comment) => platform.submitReview(orderId, rating, comment),
    });

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
    whatsapp.on('state', (state) => {
      push('whatsapp');
      if (TEST_LOG) console.log(`[teste] whatsapp=${state} ${whatsapp.detail || ''}`);
      if (state === 'ready' && SEND_TEST) runSendTest(SEND_TEST);
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
      platform.restore();
    }
  });

  app.on('before-quit', () => { quitting = true; platform?.stop(); store?.flush(); });
  app.on('window-all-closed', () => { if (SMOKE) app.quit(); });
}
