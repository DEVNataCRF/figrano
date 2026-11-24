'use strict';

const { randomBytes, randomUUID } = require('node:crypto');

/**
 * Ligação do Figrano com a plataforma Sabores da Sil (API única de festa + delivery).
 *
 * A API é a fonte da verdade: cardápio do delivery, regras da loja (horário, taxa,
 * pagamentos) e pedidos. Aqui fica só o que é do WhatsApp deste computador: conversas,
 * pausas, chamados e o código que liga um pedido do site à conversa certa.
 *
 * Sem modo offline: se a API não responde, o robô avisa o cliente e não grava nada.
 */

const POLL_MS = 5000;
const HEARTBEAT_MS = 30000;
const MENU_REFRESH_MS = 60000;
const LINK_TTL_MS = 3 * 24 * 60 * 60e3;

const STATUS_FROM_API = {
  AWAITING_PIX: 'awaiting_pix',
  NEW: 'new',
  PREPARING: 'preparing',
  OUT_FOR_DELIVERY: 'out',
  READY_FOR_PICKUP: 'ready',
  DONE: 'done',
  CANCELED: 'canceled',
};

const PAYMENT_LABELS = {
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  CASH: 'Dinheiro',
};
const PAYMENT_FROM_LABEL = Object.fromEntries(Object.entries(PAYMENT_LABELS).map(([k, v]) => [v.toLowerCase(), k]));

/** Rótulo de pagamento do robô ("Dinheiro", "pix"...) para o código da API. */
function paymentCode(label) {
  const clean = String(label || '').trim().toLowerCase();
  if (PAYMENT_FROM_LABEL[clean]) return PAYMENT_FROM_LABEL[clean];
  if (clean.includes('pix')) return 'PIX';
  if (clean.includes('dinheiro')) return 'CASH';
  if (clean.includes('débito') || clean.includes('debito')) return 'DEBIT_CARD';
  if (clean.includes('cart')) return 'CREDIT_CARD';
  return null;
}

/** "28999177660" ou "5528999177660" → "(28) 99917-7660" (formato que a API aceita). */
function brazilPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return '';
}

/** Mudança de status feita com o app fechado: avisa ao abrir, se foi nas últimas 2 h. */
const MISSED_STATUS_WINDOW_MS = 2 * 60 * 60e3;

class PlatformError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class Platform {
  /**
   * @param {object} deps
   * @param {import('./store').Store} deps.store dados locais (sessão, links, pausas)
   * @param {() => string} deps.getToken token de acesso salvo (criptografado pelo Windows)
   * @param {(token: string) => void} deps.saveToken
   * @param {() => string} [deps.getRefreshToken] token de renovação (criptografado pelo Windows)
   * @param {(token: string) => void} [deps.saveRefreshToken]
   * @param {(event: {type: string, order?: object, previous?: string}) => void} [deps.onEvent]
   * @param {typeof fetch} [deps.fetch]
   */
  constructor({ store, getToken, saveToken, getRefreshToken, saveRefreshToken, onEvent = () => {}, fetch: fetchImpl = globalThis.fetch }) {
    this.store = store;
    this.getToken = getToken;
    this.saveToken = saveToken;
    let memoryRefresh = '';
    this.getRefreshToken = getRefreshToken || (() => memoryRefresh);
    this.saveRefreshToken = saveRefreshToken || ((t) => { memoryRefresh = t; });
    this.refreshing = null;
    this.onEvent = onEvent;
    this.fetch = fetchImpl;
    this.user = null;
    this.menu = null; // DeliveryMenuDTO
    this.orders = []; // DeliveryOrderDTO[]
    this.knownStatus = new Map(); // id → status já visto (para avisar só mudanças)
    this.knownDelay = new Map(); // atraso já visto de cada pedido
    this.primed = false;
    this.timers = [];
    this.lastError = '';
    this.lastOkAt = 0;
    this.loginCodesSeen = new Map(); // id do código → quando foi entregue ao WhatsApp (não manda duas vezes)
    this.pollingCodes = false;
  }

  get settings() { return this.store.settings.platform; }

  get apiUrl() { return String(this.settings.apiUrl || '').replace(/\/+$/, ''); }

  get siteUrl() { return String(this.settings.siteUrl || '').replace(/\/+$/, ''); }

  connected() { return Boolean(this.getToken() && this.user); }

  /**
   * Renova a sessão própria do app com o token de renovação (a API dá tokens de acesso curtos).
   * Uma renovação por vez; se a API recusar, a sessão acaba e o painel pede login de novo.
   */
  refreshSession() {
    this.refreshing ??= (async () => {
      const refreshToken = this.getRefreshToken();
      if (!refreshToken) return false;
      try {
        const res = await this.fetch(`${this.apiUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client': 'figrano' },
          body: JSON.stringify({ refreshToken }),
          signal: AbortSignal.timeout(15000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false || !data.data?.accessToken) {
          if (res.status === 401) this.logout();
          return false;
        }
        this.saveToken(data.data.accessToken);
        this.saveRefreshToken(data.data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async request(method, pathname, body, { auth = true, timeoutMs = 15000, retried = false } = {}) {
    const token = auth ? this.getToken() : '';
    let response;
    try {
      response = await this.fetch(`${this.apiUrl}${pathname}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PlatformError('Sem conexão com o sistema Sabores da Sil.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      if (response.status === 401 && auth && data.error?.code === 'TOKEN_EXPIRED' && !retried) {
        if (await this.refreshSession()) return this.request(method, pathname, body, { auth, timeoutMs, retried: true });
      }
      if (response.status === 401 && auth) this.logout();
      throw new PlatformError(data.error?.message || `Erro do sistema (${response.status}).`, response.status, data.error?.code || '');
    }
    return data.data;
  }

  // ------------------------------------------------------------------ sessão

  /** Login com a conta do Sabores (a mesma do painel). */
  async login(email, password) {
    const data = await this.request('POST', '/auth/login', { email, password }, { auth: false });
    this.saveToken(data.accessToken);
    this.user = data.user;
    this.start();
    return { user: data.user, accessToken: data.accessToken };
  }

  /**
   * O painel já fez login e abriu uma sessão PRÓPRIA para o app ({ accessToken, refreshToken }):
   * o robô renova a dele sem derrubar a do painel. Aceita o formato antigo (só o token).
   */
  async adoptSession(session) {
    const token = typeof session === 'string' ? session : String(session?.accessToken || '');
    const refresh = typeof session === 'object' && session ? String(session.refreshToken || '') : '';
    this.saveToken(token);
    this.saveRefreshToken(refresh);
    const me = await this.request('GET', '/auth/me');
    this.user = me.user || me;
    this.start();
    return this.user;
  }

  async restore() {
    if (!this.getToken()) return null;
    try {
      const me = await this.request('GET', '/auth/me');
      this.user = me.user || me;
      this.start();
      return this.user;
    } catch {
      return null;
    }
  }

  logout() {
    this.stop();
    const token = this.getToken();
    const refreshToken = this.getRefreshToken();
    if (token || refreshToken) {
      // Encerra a sessão do app no servidor também (sem esperar: sair nunca trava)
      this.fetch(`${this.apiUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
    this.saveToken('');
    this.saveRefreshToken('');
    this.user = null;
    this.orders = [];
    this.knownStatus.clear();
    this.primed = false;
    this.onEvent({ type: 'session' });
  }

  // ------------------------------------------------------------------ ciclos

  start() {
    this.stop();
    if (!this.getToken()) return;
    this.timers.push(setInterval(() => this.pollOrders(), POLL_MS));
    this.timers.push(setInterval(() => this.heartbeat(), HEARTBEAT_MS));
    this.timers.push(setInterval(() => this.refreshMenu(), MENU_REFRESH_MS));
    this.timers.push(setInterval(() => this.pollLoginCodes(), POLL_MS));
    this.heartbeat();
    this.refreshMenu();
    this.pollOrders();
    this.onEvent({ type: 'session' });
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  ok() {
    this.lastOkAt = Date.now();
    if (this.lastError) { this.lastError = ''; this.onEvent({ type: 'connection' }); }
  }

  fail(error) {
    const message = error?.message || String(error);
    if (message !== this.lastError) {
      this.lastError = message;
      console.error('[sabores]', message);
      this.onEvent({ type: 'connection' });
    }
  }

  /** Avisa a API que o app da loja está ligado: sem isso, o site não aceita pedido. */
  async heartbeat() {
    if (!this.getToken()) return;
    try {
      await this.request('POST', '/delivery/heartbeat');
      this.ok();
    } catch (error) {
      this.fail(error);
    }
  }

  async refreshMenu() {
    try {
      this.menu = await this.request('GET', '/public/delivery/menu', null, { auth: false });
      this.ok();
      this.onEvent({ type: 'menu' });
    } catch (error) {
      this.fail(error);
    }
    return this.menu;
  }

  /**
   * Busca os pedidos e compara com o que já tinha visto: pedido novo do site e mudança
   * de status feita no painel viram eventos (o main avisa o cliente no WhatsApp).
   */
  async pollOrders() {
    if (!this.getToken() || this.polling) return;
    this.polling = true;
    try {
      const orders = await this.request('GET', '/delivery/orders');
      this.orders = orders;
      // Ao abrir o app, o "já visto" vem do disco: mudança feita com o app fechado ou reiniciando
      // ainda gera o aviso (só se mudou há pouco, para não mandar aviso velho).
      const saved = this.primed ? null : this.store.knownOrderStatuses?.() || {};
      for (const order of orders) {
        let previous = this.knownStatus.get(order.id);
        this.knownStatus.set(order.id, order.status);
        // Atraso avisado no painel: aumentou desde a última leitura → avisa o cliente
        const delayBefore = this.knownDelay.get(order.id);
        const delayNow = Number(order.delayMinutes) || 0;
        this.knownDelay.set(order.id, delayNow);
        if (this.primed && delayBefore !== undefined && delayNow > delayBefore) {
          this.onEvent({ type: 'order_delay', order: this.toLocal(order), added: delayNow - delayBefore });
        }
        if (!this.primed) {
          const before = saved[order.id];
          const recent = Date.now() - new Date(order.updatedAt || order.createdAt || 0).getTime() < MISSED_STATUS_WINDOW_MS;
          if (before && before !== order.status && recent) previous = before;
          else continue; // primeira leitura: só memoriza, não dispara avisos antigos
        }
        if (previous === undefined) this.onEvent({ type: 'order_new', order: this.toLocal(order) });
        else if (previous !== order.status) this.onEvent({ type: 'order_status', order: this.toLocal(order), previous });
      }
      this.primed = true;
      this.store.rememberOrderStatuses?.(Object.fromEntries(orders.map((o) => [o.id, o.status])));
      this.ok();
      this.onEvent({ type: 'orders' });
    } catch (error) {
      this.fail(error);
    } finally {
      this.polling = false;
    }
  }

  /**
   * "Entrar com o celular" no site: a API gera o código e este app, que tem o WhatsApp,
   * manda. Cada código vira um evento `login_code` uma única vez; o main envia e chama
   * `reportLoginCode` (a API apaga o código em texto).
   */
  async pollLoginCodes() {
    if (!this.getToken() || this.pollingCodes) return;
    this.pollingCodes = true;
    try {
      const jobs = await this.request('GET', '/delivery/login-codes/pending');
      const now = Date.now();
      // O código vale 10 min: depois disso o id não volta mais
      for (const [id, at] of this.loginCodesSeen) if (now - at > 15 * 60e3) this.loginCodesSeen.delete(id);
      for (const job of jobs || []) {
        if (this.loginCodesSeen.has(job.id)) continue;
        this.loginCodesSeen.set(job.id, now);
        this.onEvent({ type: 'login_code', job });
      }
    } catch (error) {
      // API antiga (sem a rota) ou sem rede: o ciclo dos pedidos já mostra a conexão
      if (error?.status !== 404) this.fail(error);
    } finally {
      this.pollingCodes = false;
    }
  }

  async reportLoginCode(id, sent) {
    try {
      await this.request('POST', `/delivery/login-codes/${encodeURIComponent(id)}/sent`, { sent: Boolean(sent) });
    } catch (error) {
      console.error('[sabores] falha ao confirmar envio do código:', error?.message || error);
    }
  }

  // --------------------------------------------- formato que o robô já conhece

  /** Regras da loja no formato do robô (settings.store do Figrano). */
  storeSettings(local) {
    const menu = this.menu;
    if (!menu) return { ...local, payments: local.payments || [] };
    const c = menu.config;
    return {
      ...local,
      name: menu.companyName || local.name,
      address: c.pickupAddress || local.address,
      phone: menu.whatsappPhone || local.phone,
      hours: c.enabled ? c.hours : Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { closed: true, open: '00:00', close: '00:00' }])),
      // Atalho "abrir/fechar agora" do painel (vale até override.until)
      override: c.override || null,
      deliveryFee: c.deliveryFee,
      neighborhoods: Array.isArray(c.neighborhoods) ? c.neighborhoods : [],
      minOrder: c.minOrder,
      prepMinutes: c.prepMinutes,
      payments: c.payments.map((p) => PAYMENT_LABELS[p]).filter(Boolean),
      delivery: c.acceptsDelivery,
      pickup: c.acceptsPickup,
    };
  }

  numberedItems() {
    const list = [];
    for (const category of this.menu?.categories || []) {
      for (const item of category.items) {
        list.push({
          number: list.length + 1,
          category: category.name,
          id: item.id,
          name: item.name,
          description: item.description || '',
          price: item.price,
          available: true,
        });
      }
    }
    return list;
  }

  /** Pedido da API no formato antigo do Figrano (robô, comanda, avisos). */
  toLocal(order) {
    return {
      id: order.id,
      number: order.number,
      customer: {
        chatId: this.chatIdForRef(order.chatRef),
        name: order.customerName,
        phone: String(order.customerPhone || '').replace(/\D/g, ''),
      },
      items: order.items.map((i) => ({ name: i.name, qty: i.quantity, price: i.unitPrice, notes: i.notes || '', options: Array.isArray(i.options) ? i.options : [] })),
      mode: order.mode === 'PICKUP' ? 'pickup' : 'delivery',
      address: order.address || '',
      neighborhood: order.neighborhood || '',
      delayMinutes: Number(order.delayMinutes) || 0,
      paymentMethod: order.paymentMethod,
      pixProofAt: order.pixProofAt || null,
      apiStatus: order.status,
      payment: PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod,
      changeFor: order.changeFor,
      notes: order.notes || '',
      subtotal: order.subtotal,
      fee: order.deliveryFee,
      total: order.total,
      status: STATUS_FROM_API[order.status] || 'new',
      source: { SITE: 'online', WHATSAPP: 'bot', COUNTER: 'manual' }[order.source] || 'bot',
      createdAt: new Date(order.createdAt).getTime(),
    };
  }

  localOrders() { return this.orders.map((o) => this.toLocal(o)); }

  /** Último pedido do cliente: pelo código da conversa ou, se pediu pelo site, pelo telefone. */
  lastOrderOf(chatId, phone = '') {
    const digits = String(phone || '').replace(/\D/g, '').slice(-8);
    const own = this.orders.filter((o) => (o.chatRef && this.chatIdForRef(o.chatRef) === chatId)
      || (digits.length === 8 && String(o.customerPhone).replace(/\D/g, '').endsWith(digits)));
    return own.length ? this.toLocal(own[0]) : null;
  }

  /** Página de acompanhamento do pedido no site (precisa dos 4 últimos dígitos do telefone). */
  trackingLinkFor(order) {
    const phone = String(order?.customer?.phone || '').replace(/\D/g, '');
    if (!this.siteUrl || !order?.id || phone.length < 4) return null;
    return `${this.siteUrl}/pedido/?id=${encodeURIComponent(order.id)}&t=${phone.slice(-4)}`;
  }

  /** Nota do cliente (1 a 5) depois da entrega. */
  async submitReview(orderId, rating, comment) {
    await this.request('POST', `/delivery/orders/${orderId}/review`, { rating, comment: comment || null });
  }

  /**
   * Grava no servidor o pedido montado pelo robô (ou lançado no balcão).
   * O servidor confere preço, taxa, mínimo e pagamento.
   */
  async createOrder({ customer, items, mode, address, neighborhood, payment, changeFor, notes, source = 'bot' }) {
    if (!this.getToken()) throw new PlatformError('O app não está conectado ao sistema.');
    const phone = brazilPhone(customer?.phone);
    if (!phone) throw new PlatformError('preciso do telefone com DDD para registrar o pedido');
    const method = paymentCode(payment);
    if (!method) throw new PlatformError(`forma de pagamento "${payment}" não reconhecida`);
    const chatRef = customer?.chatId ? this.refFor(customer.chatId) : null;
    const order = await this.request('POST', '/delivery/orders', {
      source: source === 'manual' ? 'COUNTER' : 'WHATSAPP',
      customer: { name: String(customer?.name || '').trim() || 'Cliente', phoneWhatsapp: phone },
      mode: mode === 'pickup' ? 'PICKUP' : 'DELIVERY',
      address: mode === 'pickup' ? null : address,
      neighborhood: mode === 'pickup' ? null : neighborhood || null,
      paymentMethod: method,
      changeFor: method === 'CASH' && changeFor ? Number(changeFor) : null,
      notes: notes || null,
      items: items.map((line) => ({
        productId: line.itemId || line.id,
        quantity: Math.max(1, Math.floor(Number(line.qty) || 1)),
        notes: line.notes || null,
      })),
      chatRef,
      idempotencyKey: `wa-${randomUUID()}`,
    });
    // Já conhecido: o próximo ciclo não trata como "pedido novo do site"
    this.knownStatus.set(order.id, order.status);
    this.orders = [order, ...this.orders.filter((o) => o.id !== order.id)];
    this.onEvent({ type: 'orders' });
    return this.toLocal(order);
  }

  /**
   * Pedido do site esperando o comprovante do Pix nesta conversa (pelo código do link
   * ou pelo telefone). É para ele que vai a imagem que o cliente mandar.
   */
  pendingPixOrderFor(chatId, phone) {
    const digits = String(phone || '').replace(/\D/g, '').slice(-8);
    const pending = this.orders.filter((o) => o.status === 'AWAITING_PIX');
    const match = pending.find((o) => o.chatRef && this.chatIdForRef(o.chatRef) === chatId)
      || (digits.length === 8 ? pending.find((o) => String(o.customerPhone).replace(/\D/g, '').endsWith(digits)) : null);
    return match ? this.toLocal(match) : null;
  }

  /** Marca na API que o comprovante chegou (a Sil ainda confere no painel). */
  async reportPixProof(orderId) {
    const order = await this.request('POST', `/delivery/orders/${orderId}/pix-proof`);
    this.orders = this.orders.map((o) => (o.id === order.id ? order : o));
    this.onEvent({ type: 'orders' });
    return this.toLocal(order);
  }

  // ------------------------------------------- link do site ↔ conversa

  /** Código curto que liga um pedido (do site ou do robô) à conversa do WhatsApp. */
  refFor(chatId) {
    const links = this.store.data.links;
    const now = Date.now();
    let ref = Object.keys(links).find((key) => links[key].chatId === chatId && now - links[key].at < LINK_TTL_MS);
    if (!ref) {
      for (const key of Object.keys(links)) if (now - links[key].at >= LINK_TTL_MS) delete links[key];
      ref = randomBytes(6).toString('hex');
    }
    links[ref] = { chatId, at: now };
    this.store.changed('links');
    return ref;
  }

  chatIdForRef(ref) {
    return (ref && this.store.data.links[ref]?.chatId) || '';
  }

  /** Link do site de delivery para mandar no WhatsApp (com o código da conversa). */
  linkFor(chatId) {
    // Sempre manda o link do cardápio digital: mesmo fechado, o site mostra itens e horário
    if (!this.siteUrl) return null;
    return `${this.siteUrl}/?r=${this.refFor(chatId)}`;
  }

  /** Página de orçamento do site do buffet (onde a Lívia atende). */
  buffetQuoteLink() {
    const site = String(this.settings.buffetUrl || '').replace(/\/+$/, '');
    return site ? `${site}/#orcamento` : '';
  }

  // ------------------------------------------------------------------ Lívia

  /** Assunto de festa: a Lívia (assistente do buffet) responde pela API. */
  async askLivia({ message, history }) {
    if (!this.getToken()) return null;
    // O modelo local pode levar um tempo para "acordar": o cliente do WhatsApp espera
    const data = await this.request(
      'POST',
      '/ai/livia/whatsapp',
      { message: message.slice(0, 1500), history: history.slice(-8), channel: 'WHATSAPP' },
      { timeoutMs: 60000 },
    );
    const site = String(this.settings.buffetUrl || '').replace(/\/+$/, '');
    const wantsQuote = (data.actions || []).some((a) => a.type === 'OPEN_QUOTE_FORM');
    return { reply: data.reply, link: wantsQuote && site ? `${site}/#orcamento` : '' };
  }
}

module.exports = { Platform, PlatformError, paymentCode, brazilPhone, STATUS_FROM_API, PAYMENT_LABELS };
