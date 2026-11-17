'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ORDER_STATUSES = ['new', 'preparing', 'out', 'ready', 'done', 'canceled'];
const BOT_STATUSES = ['active', 'alerts', 'inactive'];
const FAR_FUTURE = 8640000000000000; // maior timestamp válido de Date: pausa sem prazo

function defaultHours() {
  const hours = {};
  for (let day = 0; day < 7; day++) {
    hours[day] = { closed: day === 1, open: '18:00', close: '23:00' };
  }
  return hours;
}

function defaultData() {
  return {
    version: 1,
    settings: {
      store: {
        name: 'Minha loja',
        address: '',
        phone: '',
        hours: defaultHours(),
        deliveryFee: 0,
        minOrder: 0,
        prepMinutes: 40,
        payments: ['Pix', 'Cartão na entrega', 'Dinheiro'],
        delivery: true,
        pickup: true,
      },
      bot: {
        status: 'active',
        handoffMessage: 'Olá! Sou da equipe e vou continuar seu atendimento por aqui.',
        autoPauseOnManualReply: true,
        autoArchive: false,
        archiveDays: 60,
      },
      ai: {
        enabled: false,
        provider: 'anthropic', // 'anthropic' (nuvem, com chave) ou 'ollama' (modelo local)
        apiKeyEncrypted: '',
        ollamaUrl: 'http://127.0.0.1:11434',
        ollamaModel: 'qwen3.5:9b',
        ollamaThink: true, // o modelo pensa antes de responder: mais lento, mas usa as ferramentas direito
      },
      app: { autoStart: false },
    },
    menu: { categories: [] },
    orders: [],
    orderSeq: 0,
    handoffs: [],
    pauses: {},
  };
}

function mergeDefaults(target, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) {
      target[key] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)
      && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      mergeDefaults(target[key], value);
    }
  }
  return target;
}

class Store {
  /**
   * @param {string|null} filePath arquivo JSON; null mantém tudo só em memória (testes)
   */
  constructor(filePath = null) {
    this.filePath = filePath;
    this.listeners = new Set();
    this.data = defaultData();
    this.saveTimer = null;
    if (filePath && fs.existsSync(filePath)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        this.data = mergeDefaults(loaded, defaultData());
      } catch (error) {
        // Arquivo corrompido: guarda uma cópia e segue com dados novos.
        fs.copyFileSync(filePath, `${filePath}.corrompido-${Date.now()}`);
      }
    }
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed(topic) {
    for (const listener of this.listeners) listener(topic);
    if (!this.filePath) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    if (!this.filePath) return;
    clearTimeout(this.saveTimer);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  // ---------------------------------------------------------------- settings

  get settings() { return this.data.settings; }

  updateSettings(section, patch) {
    if (!this.data.settings[section]) throw new Error(`Seção desconhecida: ${section}`);
    if (section === 'bot' && patch.status !== undefined && !BOT_STATUSES.includes(patch.status)) {
      throw new Error(`Status do robô inválido: ${patch.status}`);
    }
    Object.assign(this.data.settings[section], patch);
    this.changed('settings');
    return this.data.settings[section];
  }

  // -------------------------------------------------------------------- menu

  get menu() { return this.data.menu; }

  /** Itens disponíveis, numerados em sequência como aparecem para o cliente. */
  numberedItems() {
    const list = [];
    for (const category of this.data.menu.categories) {
      for (const item of category.items) {
        if (item.available === false) continue;
        list.push({ number: list.length + 1, category: category.name, ...item });
      }
    }
    return list;
  }

  saveCategory({ id, name }) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Informe o nome da categoria.');
    let category = this.data.menu.categories.find((c) => c.id === id);
    if (category) {
      category.name = clean;
    } else {
      category = { id: randomUUID(), name: clean, items: [] };
      this.data.menu.categories.push(category);
    }
    this.changed('menu');
    return category;
  }

  deleteCategory(id) {
    this.data.menu.categories = this.data.menu.categories.filter((c) => c.id !== id);
    this.changed('menu');
  }

  saveItem(categoryId, { id, name, description = '', price, available = true }) {
    const category = this.data.menu.categories.find((c) => c.id === categoryId);
    if (!category) throw new Error('Categoria não encontrada.');
    const clean = String(name || '').trim();
    const value = Number(price);
    if (!clean) throw new Error('Informe o nome do item.');
    if (!Number.isFinite(value) || value < 0) throw new Error('Informe um preço válido.');
    let item = category.items.find((i) => i.id === id);
    const fields = { name: clean, description: String(description).trim(), price: value, available: available !== false };
    if (item) {
      Object.assign(item, fields);
    } else {
      item = { id: randomUUID(), ...fields };
      category.items.push(item);
    }
    this.changed('menu');
    return item;
  }

  deleteItem(categoryId, itemId) {
    const category = this.data.menu.categories.find((c) => c.id === categoryId);
    if (!category) return;
    category.items = category.items.filter((i) => i.id !== itemId);
    this.changed('menu');
  }

  // ------------------------------------------------------------------ orders

  get orders() { return this.data.orders; }

  createOrder({ customer, items, mode, address = '', payment = '', changeFor = null, notes = '', source = 'bot' }) {
    if (!Array.isArray(items) || items.length === 0) throw new Error('O pedido precisa de ao menos um item.');
    const lines = items.map((line) => ({
      name: String(line.name),
      qty: Math.max(1, Math.floor(Number(line.qty) || 1)),
      price: Number(line.price) || 0,
      notes: String(line.notes || ''),
    }));
    const subtotal = lines.reduce((sum, line) => sum + line.qty * line.price, 0);
    const fee = mode === 'delivery' ? Number(this.data.settings.store.deliveryFee) || 0 : 0;
    this.data.orderSeq += 1;
    const now = Date.now();
    const order = {
      id: randomUUID(),
      number: this.data.orderSeq,
      customer: {
        chatId: customer?.chatId || '',
        name: String(customer?.name || '').trim() || 'Cliente',
        phone: String(customer?.phone || '').replace(/\D/g, ''),
      },
      items: lines,
      mode: mode === 'pickup' ? 'pickup' : 'delivery',
      address: String(address || ''),
      payment: String(payment || ''),
      changeFor: changeFor === null || changeFor === '' ? null : Number(changeFor),
      notes: String(notes || ''),
      subtotal,
      fee,
      total: subtotal + fee,
      status: 'new',
      source,
      createdAt: now,
      updatedAt: now,
    };
    this.data.orders.push(order);
    this.changed('orders');
    return order;
  }

  setOrderStatus(id, status) {
    if (!ORDER_STATUSES.includes(status)) throw new Error(`Status de pedido inválido: ${status}`);
    const order = this.data.orders.find((o) => o.id === id);
    if (!order) throw new Error('Pedido não encontrado.');
    order.status = status;
    order.updatedAt = Date.now();
    this.changed('orders');
    return order;
  }

  lastOrderOf(chatId) {
    for (let i = this.data.orders.length - 1; i >= 0; i--) {
      if (this.data.orders[i].customer.chatId === chatId) return this.data.orders[i];
    }
    return null;
  }

  // ---------------------------------------------------------------- handoffs

  get handoffs() { return this.data.handoffs; }

  addHandoff({ chatId, name, phone = '', motive = '', priority = 'medium', mood = 'calm' }) {
    // Sem telefone informado, só IDs "@c.us" servem: "@lid" não é telefone.
    const digits = String(phone || (String(chatId).endsWith('@c.us') ? String(chatId).split('@')[0] : '')).replace(/\D/g, '');
    const existing = this.data.handoffs.find((h) => h.chatId === chatId);
    if (existing) {
      Object.assign(existing, {
        motive: motive || existing.motive, priority, mood, phone: digits || existing.phone, updatedAt: Date.now(),
      });
      this.changed('handoffs');
      return existing;
    }
    const handoff = {
      id: randomUUID(),
      chatId,
      name: String(name || '').trim() || 'Cliente',
      phone: digits,
      motive: String(motive),
      priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
      mood: ['calm', 'frustrated', 'hostile'].includes(mood) ? mood : 'calm',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.handoffs.push(handoff);
    this.changed('handoffs');
    return handoff;
  }

  resolveHandoff(id) {
    this.data.handoffs = this.data.handoffs.filter((h) => h.id !== id);
    this.changed('handoffs');
  }

  resolveHandoffsOf(chatId) {
    const before = this.data.handoffs.length;
    this.data.handoffs = this.data.handoffs.filter((h) => h.chatId !== chatId);
    if (this.data.handoffs.length !== before) this.changed('handoffs');
  }

  // ------------------------------------------------------------------ pauses

  /**
   * @param {string} chatId
   * @param {'15m'|'1h'|'24h'|'indefinite'} duration
   */
  pauseChat(chatId, duration, now = Date.now()) {
    const spans = { '15m': 15 * 60e3, '1h': 60 * 60e3, '24h': 24 * 60 * 60e3 };
    const until = duration === 'indefinite' ? FAR_FUTURE : now + (spans[duration] ?? spans['24h']);
    this.data.pauses[chatId] = until;
    this.changed('pauses');
    return until;
  }

  resumeChat(chatId) {
    if (this.data.pauses[chatId] === undefined) return false;
    delete this.data.pauses[chatId];
    this.changed('pauses');
    return true;
  }

  /** Expiração da pausa, ou null se a conversa não está pausada. */
  pauseUntil(chatId, now = Date.now()) {
    const until = this.data.pauses[chatId];
    if (until === undefined) return null;
    if (until <= now) {
      delete this.data.pauses[chatId];
      this.changed('pauses');
      return null;
    }
    return until;
  }

  isPaused(chatId, now = Date.now()) {
    return this.pauseUntil(chatId, now) !== null;
  }
}

module.exports = { Store, ORDER_STATUSES, BOT_STATUSES, FAR_FUTURE };
