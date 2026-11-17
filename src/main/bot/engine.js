'use strict';

const {
  money, isOpen, hoursText, menuText, cartText, cartTotal, orderSummary, STATUS_LABELS,
} = require('./format');

const SESSION_TTL_MS = 2 * 60 * 60e3; // conversa parada por 2 h recomeça do zero
const CLOSED_NOTICE_GAP_MS = 30 * 60e3; // não repete o aviso de loja fechada a cada mensagem

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const hasAny = (text, words) => words.some((word) => text.includes(word));

const INTENTS = {
  human: ['atendente', 'humano', 'pessoa de verdade', 'falar com alguem', 'falar com uma pessoa', 'reclamacao', 'reclamar'],
  status: ['meu pedido', 'status', 'cade', 'onde esta', 'vai demorar', 'ja saiu', 'demora'],
  hours: ['horario', 'que horas', 'abre', 'fecha', 'aberto', 'funcionamento'],
  address: ['endereco', 'onde fica', 'localizacao', 'como chegar'],
  menu: ['cardapio', 'menu', 'pedido', 'pedir', 'quero', 'opcoes', 'o que tem'],
  greeting: ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'opa', 'e ai', 'eai'],
};

/**
 * Lê uma seleção de itens do cardápio numerado.
 * Aceita "3", "2x3" (duas unidades do item 3) e listas separadas por
 * vírgula, "e" ou quebra de linha. Devolve null se algo não for seleção.
 */
function parseSelection(text) {
  const parts = normalize(text).split(/\s*(?:,|;|\n| e )\s*/).filter(Boolean);
  if (parts.length === 0) return null;
  const picks = [];
  for (const part of parts) {
    let match = part.match(/^(\d{1,2})\s*x\s*(\d{1,3})$/);
    if (match) {
      picks.push({ qty: Number(match[1]), number: Number(match[2]) });
      continue;
    }
    match = part.match(/^(\d{1,3})$/);
    if (match) {
      picks.push({ qty: 1, number: Number(match[1]) });
      continue;
    }
    return null;
  }
  return picks;
}

function parseMoney(text) {
  const match = normalize(text).replace(/r\$/g, '').match(/(\d+(?:[.,]\d{1,2})?)/);
  return match ? Number(match[1].replace(',', '.')) : null;
}

class BotEngine {
  /**
   * @param {object} deps
   * @param {import('../store').Store} deps.store
   * @param {{available: () => boolean, reply: Function}|null} [deps.ai]
   * @param {() => Date} [deps.now]
   */
  constructor({ store, ai = null, now = () => new Date() }) {
    this.store = store;
    this.ai = ai;
    this.now = now;
    this.sessions = new Map();
  }

  session(chatId) {
    const nowMs = this.now().getTime();
    let session = this.sessions.get(chatId);
    if (!session || nowMs - session.touchedAt > SESSION_TTL_MS) {
      session = {
        chatId, state: 'idle', cart: [], mode: null, address: '', payment: '',
        changeFor: null, closedNoticeAt: 0, history: [], touchedAt: nowMs,
      };
      this.sessions.set(chatId, session);
    }
    session.touchedAt = nowMs;
    return session;
  }

  resetOrder(session) {
    Object.assign(session, { state: 'idle', cart: [], mode: null, address: '', payment: '', changeFor: null });
  }

  /**
   * Processa uma mensagem recebida.
   * @param {{chatId: string, name?: string, type: 'chat'|'location'|'image'|'ptt', text?: string,
   *          location?: {lat: number, lng: number}}} msg
   * @returns {Promise<{replies: string[], effects: object[]}>}
   */
  async handle(msg) {
    const out = { replies: [], effects: [] };
    const settings = this.store.settings;

    // Robô desligado ou em "só avisos" não responde ninguém.
    if (settings.bot.status !== 'active') return out;
    if (this.store.isPaused(msg.chatId, this.now().getTime())) return out;

    const session = this.session(msg.chatId);
    session.name = msg.name || session.name || '';

    let text = msg.text || '';
    if (msg.type === 'location' && msg.location) {
      text = `Localização: https://maps.google.com/?q=${msg.location.lat},${msg.location.lng}`;
    } else if (msg.type === 'ptt') {
      out.replies.push('Ainda não consigo ouvir áudios. Pode escrever sua mensagem, por favor?');
      return out;
    } else if (msg.type === 'image' && !text) {
      out.replies.push('Recebi sua imagem. Se precisar de algo, escreva por aqui.');
      return out;
    }
    if (!text.trim()) return out;

    const handled = this.rules(session, text, out);
    if (!handled) {
      const answered = await this.askAi(session, text, out);
      if (!answered) this.fallback(session, out);
    }

    session.history.push({ role: 'user', text });
    for (const reply of out.replies) session.history.push({ role: 'assistant', text: reply });
    if (session.history.length > 24) session.history.splice(0, session.history.length - 24);
    return out;
  }

  // ------------------------------------------------------------------ regras

  /** Devolve true se as regras fixas resolveram a mensagem. */
  rules(session, rawText, out) {
    const text = normalize(rawText);
    const store = this.store.settings.store;

    if (hasAny(text, INTENTS.human)) {
      this.requestHuman(session, out, { motive: rawText.slice(0, 200) });
      return true;
    }

    switch (session.state) {
      case 'ordering': return this.stateOrdering(session, rawText, text, out);
      case 'mode': return this.stateMode(session, text, out);
      case 'address': return this.stateAddress(session, rawText, text, out);
      case 'payment': return this.statePayment(session, text, out);
      case 'change': return this.stateChange(session, text, out);
      case 'confirm': return this.stateConfirm(session, text, out);
      default: break;
    }

    // Com a IA ligada, frases livres ("quero duas pizzas de calabresa sem cebola")
    // vão para ela; as regras ficam com comandos curtos.
    if (this.ai?.available() && text.split(' ').length > 3) return false;

    // Estado ocioso: atalhos numéricos do menu de boas-vindas e intenções por palavra-chave.
    // "meu pedido" é acompanhamento, não pedido novo: status vem antes do cardápio.
    if (text === '4' || hasAny(text, INTENTS.status)) { this.orderStatus(session, out); return true; }
    if (text === '1' || hasAny(text, INTENTS.menu)) { this.startOrdering(session, out); return true; }
    if (text === '2' || hasAny(text, INTENTS.hours)) {
      const open = isOpen(store.hours, this.now());
      out.replies.push(`${open ? 'Estamos abertos agora.' : 'Estamos fechados agora.'}\n\n${hoursText(store.hours)}`);
      return true;
    }
    if (text === '3' || hasAny(text, INTENTS.address)) {
      out.replies.push(store.address ? `Nosso endereço: ${store.address}` : 'Ainda não temos o endereço cadastrado por aqui.');
      return true;
    }
    if (text === '5') { this.requestHuman(session, out, { motive: 'Pediu atendente pelo menu' }); return true; }
    if (hasAny(` ${text} `, INTENTS.greeting.map((w) => ` ${w} `)) || text.length <= 3) {
      this.welcome(session, out);
      return true;
    }
    return false;
  }

  welcome(session, out) {
    const store = this.store.settings.store;
    const hello = session.name ? `Olá, ${session.name.split(' ')[0]}!` : 'Olá!';
    out.replies.push(
      `${hello} Aqui é o atendimento do ${store.name}.\n\n`
      + 'Responda com o número do que precisa:\n'
      + '1. Ver cardápio e fazer pedido\n'
      + '2. Horário de funcionamento\n'
      + '3. Endereço\n'
      + '4. Acompanhar meu pedido\n'
      + '5. Falar com atendente',
    );
  }

  fallback(session, out) {
    if (session.state === 'idle') {
      this.welcome(session, out);
    } else {
      out.replies.push('Não entendi. Se preferir, digite *atendente* para falar com uma pessoa ou *cancelar* para recomeçar.');
    }
  }

  /** Avisa que a loja está fechada (no máximo uma vez a cada 30 min). Devolve true se fechada. */
  blockIfClosed(session, out) {
    const store = this.store.settings.store;
    if (isOpen(store.hours, this.now())) return false;
    const nowMs = this.now().getTime();
    if (nowMs - session.closedNoticeAt > CLOSED_NOTICE_GAP_MS) {
      session.closedNoticeAt = nowMs;
      out.replies.push(`Estamos fechados no momento e não conseguimos receber pedidos.\n\n${hoursText(store.hours)}`);
    }
    return true;
  }

  startOrdering(session, out) {
    if (this.blockIfClosed(session, out)) return;
    const items = this.store.numberedItems();
    out.replies.push(menuText(items));
    if (items.length === 0) return;
    session.state = 'ordering';
    out.replies.push(
      'Para pedir, envie o número do item. Para mais de uma unidade, use quantidade x número (ex.: *2x3*).\n'
      + 'Digite *carrinho* para conferir, *fechar* para finalizar ou *cancelar* para desistir.',
    );
  }

  stateOrdering(session, rawText, text, out) {
    if (hasAny(text, ['cancelar', 'desistir'])) {
      this.resetOrder(session);
      out.replies.push('Pedido cancelado. Quando quiser, é só chamar.');
      return true;
    }
    if (hasAny(text, ['carrinho', 'meu pedido', 'conferir'])) {
      out.replies.push(cartText(session.cart));
      return true;
    }
    if (hasAny(text, ['limpar', 'esvaziar'])) {
      session.cart = [];
      out.replies.push('Carrinho esvaziado.');
      return true;
    }
    if (hasAny(text, ['cardapio', 'menu'])) {
      out.replies.push(menuText(this.store.numberedItems()));
      return true;
    }
    if (hasAny(text, ['fechar', 'finalizar', 'concluir', 'so isso', 'e isso'])) {
      this.beginCheckout(session, out);
      return true;
    }
    const picks = parseSelection(rawText);
    if (!picks) return false;
    const result = this.addItems(session, picks.map((p) => ({ number: p.number, quantity: p.qty, notes: '' })));
    out.replies.push(result.message);
    return true;
  }

  /** Adiciona itens pelo número do cardápio. Usado pelas regras e pela IA. */
  addItems(session, picks) {
    const items = this.store.numberedItems();
    const unknown = [];
    for (const pick of picks) {
      const item = items.find((i) => i.number === Number(pick.number));
      const qty = Math.floor(Number(pick.quantity) || 1);
      if (!item || qty < 1 || qty > 99) { unknown.push(pick.number); continue; }
      const notes = String(pick.notes || '').trim();
      const line = session.cart.find((l) => l.itemId === item.id && l.notes === notes);
      if (line) line.qty += qty;
      else session.cart.push({ itemId: item.id, name: item.name, price: item.price, qty, notes });
    }
    if (session.state === 'idle' && session.cart.length) session.state = 'ordering';
    const lines = [];
    if (unknown.length) lines.push(`Não encontrei o item ${unknown.join(', ')} no cardápio.`);
    lines.push(cartText(session.cart));
    if (session.cart.length) lines.push('Envie mais itens ou digite *fechar* para finalizar.');
    return { ok: unknown.length === 0, message: lines.join('\n') };
  }

  removeItem(session, number) {
    const item = this.store.numberedItems().find((i) => i.number === Number(number));
    const before = session.cart.length;
    if (item) session.cart = session.cart.filter((l) => l.itemId !== item.id);
    return { ok: session.cart.length !== before, message: cartText(session.cart) };
  }

  beginCheckout(session, out) {
    const store = this.store.settings.store;
    if (session.cart.length === 0) {
      out.replies.push('Seu carrinho está vazio. Envie o número de um item do cardápio.');
      return;
    }
    const subtotal = cartTotal(session.cart);
    if (subtotal < store.minOrder) {
      out.replies.push(`O pedido mínimo é ${money(store.minOrder)} e seu carrinho está em ${money(subtotal)}. Adicione mais itens.`);
      return;
    }
    if (store.delivery && store.pickup) {
      session.state = 'mode';
      out.replies.push(`Como prefere receber?\n1. Entrega (${money(store.deliveryFee)})\n2. Retirada na loja`);
    } else if (store.delivery) {
      session.mode = 'delivery';
      session.state = 'address';
      out.replies.push('Qual o endereço de entrega? Informe rua, número, bairro e complemento.');
    } else {
      session.mode = 'pickup';
      this.askPayment(session, out);
    }
  }

  stateMode(session, text, out) {
    if (text === '1' || hasAny(text, ['entrega', 'entregar', 'delivery'])) {
      session.mode = 'delivery';
      session.state = 'address';
      out.replies.push('Qual o endereço de entrega? Informe rua, número, bairro e complemento.');
      return true;
    }
    if (text === '2' || hasAny(text, ['retirada', 'retirar', 'buscar', 'balcao'])) {
      session.mode = 'pickup';
      this.askPayment(session, out);
      return true;
    }
    if (hasAny(text, ['cancelar'])) return this.cancel(session, out);
    out.replies.push('Responda *1* para entrega ou *2* para retirada.');
    return true;
  }

  stateAddress(session, rawText, text, out) {
    if (text === 'cancelar') return this.cancel(session, out);
    if (rawText.trim().length < 8) {
      out.replies.push('Preciso do endereço completo: rua, número e bairro.');
      return true;
    }
    session.address = rawText.trim().slice(0, 300);
    this.askPayment(session, out);
    return true;
  }

  askPayment(session, out) {
    const payments = this.store.settings.store.payments;
    session.state = 'payment';
    out.replies.push(`Qual a forma de pagamento?\n${payments.map((p, i) => `${i + 1}. ${p}`).join('\n')}`);
  }

  setPayment(session, method) {
    const payments = this.store.settings.store.payments;
    const wanted = normalize(method);
    const found = payments.find((p) => normalize(p) === wanted)
      || payments.find((p) => normalize(p).includes(wanted) || wanted.includes(normalize(p)));
    if (!found) return null;
    session.payment = found;
    return found;
  }

  statePayment(session, text, out) {
    if (text === 'cancelar') return this.cancel(session, out);
    const payments = this.store.settings.store.payments;
    const index = Number(text);
    const chosen = Number.isInteger(index) && payments[index - 1] ? payments[index - 1] : this.setPayment(session, text);
    if (!chosen) {
      out.replies.push(`Não reconheci essa forma de pagamento. Responda com o número:\n${payments.map((p, i) => `${i + 1}. ${p}`).join('\n')}`);
      return true;
    }
    session.payment = chosen;
    if (normalize(chosen).includes('dinheiro')) {
      session.state = 'change';
      out.replies.push('Precisa de troco? Informe para quanto (ex.: *50*) ou responda *não*.');
      return true;
    }
    this.askConfirm(session, out);
    return true;
  }

  stateChange(session, text, out) {
    if (text === 'cancelar') return this.cancel(session, out);
    const value = parseMoney(text);
    session.changeFor = value && !hasAny(text, ['nao', 'sem troco']) ? value : null;
    this.askConfirm(session, out);
    return true;
  }

  askConfirm(session, out) {
    session.state = 'confirm';
    const fee = this.store.settings.store.deliveryFee;
    out.replies.push(`Confira seu pedido:\n\n${orderSummary({ ...session, fee })}\n\nResponda *1* para confirmar ou *2* para cancelar.`);
  }

  stateConfirm(session, text, out) {
    if (text === '1' || hasAny(text, ['sim', 'confirmar', 'confirmo', 'pode', 'isso'])) {
      const result = this.placeOrder(session, out);
      if (!result.ok) out.replies.push(result.message);
      return true;
    }
    if (text === '2' || hasAny(text, ['nao', 'cancelar'])) return this.cancel(session, out);
    out.replies.push('Responda *1* para confirmar ou *2* para cancelar.');
    return true;
  }

  cancel(session, out) {
    this.resetOrder(session);
    out.replies.push('Pedido cancelado. Quando quiser, é só chamar.');
    return true;
  }

  /** Cria o pedido se estiver completo. Usado pelas regras e pela IA. */
  placeOrder(session, out) {
    const store = this.store.settings.store;
    const missing = [];
    if (session.cart.length === 0) missing.push('itens no carrinho');
    if (!session.mode) missing.push('entrega ou retirada');
    if (session.mode === 'delivery' && !session.address) missing.push('endereço de entrega');
    if (!session.payment) missing.push('forma de pagamento');
    if (missing.length) return { ok: false, message: `Ainda falta: ${missing.join(', ')}.` };
    if (!isOpen(store.hours, this.now())) return { ok: false, message: 'A loja está fechada no momento.' };
    if (cartTotal(session.cart) < store.minOrder) return { ok: false, message: `O pedido mínimo é ${money(store.minOrder)}.` };

    const order = this.store.createOrder({
      customer: { chatId: session.chatId, name: session.name, phone: session.chatId.split('@')[0] },
      items: session.cart,
      mode: session.mode,
      address: session.address,
      payment: session.payment,
      changeFor: session.changeFor,
      source: 'bot',
    });
    this.resetOrder(session);
    out.effects.push({ type: 'order_created', order });
    const eta = store.prepMinutes ? ` Previsão: cerca de ${store.prepMinutes} minutos.` : '';
    const message = `Pedido #${order.number} recebido! Assim que a loja confirmar, aviso por aqui.${eta}`;
    out.replies.push(message);
    return { ok: true, message, order };
  }

  orderStatus(session, out) {
    const order = this.store.lastOrderOf(session.chatId);
    const message = order
      ? `Seu pedido #${order.number} está ${STATUS_LABELS[order.status]}.`
      : 'Não encontrei pedidos seus por aqui.';
    out.replies.push(message);
    return message;
  }

  requestHuman(session, out, { motive = '', priority = 'medium', mood = 'calm' } = {}) {
    const handoff = this.store.addHandoff({ chatId: session.chatId, name: session.name, motive, priority, mood });
    this.store.pauseChat(session.chatId, '24h', this.now().getTime());
    out.effects.push({ type: 'handoff', handoff });
    const message = 'Certo, vou chamar uma pessoa da equipe para continuar com você. Aguarde um instante.';
    out.replies.push(message);
    return message;
  }

  // ---------------------------------------------------------------------- IA

  async askAi(session, text, out) {
    if (!this.ai || !this.ai.available()) return false;
    try {
      const texts = await this.ai.reply({ engine: this, session, text, out });
      if (!texts || texts.length === 0) return out.replies.length > 0;
      out.replies.push(...texts);
      return true;
    } catch (error) {
      out.effects.push({ type: 'ai_error', message: error?.message || String(error) });
      return false;
    }
  }
}

module.exports = { BotEngine, normalize, parseSelection, parseMoney };
